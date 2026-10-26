"""«Чат с ИИ»: беседы (``InsightThread``) и их сообщения — правило в одном месте.

Беседа — о трате (``spend``), о месяце (``month``), о планах (``plans``) либо свободная (``free``); сообщение —
``InsightRequest`` вида ``chat`` в общей очереди ``insights.queue`` (тот же шаг воркера, тот же ``use_ai`` и те же
лимиты вопросов, что у «вопроса о тратах»). Вход модели — сводка ``insights.context`` месяца беседы, открытые планы
семьи (``plans_input``), предмет беседы (``subject``), история беседы (``history``) и вопрос; планы и предмет
снимаются при постановке и лежат в ``context`` строки — так числа ответа сверяются с тем, что модель видела.

Модель сама ничего не меняет: после ответа на планы пишутся только вердикты (``apply_verdicts`` — поля ``ai_*``
видимых планов), а действия (перенос, удаление, сумма, новый план) ждут подтверждения человека —
``confirm_action`` применяет их через ``planned.services.apply_action`` и помечает ``done_at``/``result``.
"""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from accounts.access import visible_receipts_q
from accounts.ai import use_ai
from api.common import CategoryTree, amount, iso_date, quantity, store_name, utc_datetime
from budget.dashboard import Month
from planned import services as planned_services
from planned.access import as_request, plans_q
from planned.models import PlannedSpend
from rates import convert
from receipts.models import Receipt

from . import context as summary
from . import queue
from .models import InsightRequest, InsightThread

Kind = InsightThread.Kind
Status = InsightRequest.Status
PLANS_OPENER = "Посмотрите мои планы: что брать, что отложить, от чего отговорите"
TITLE_MAX = 60
STORE_SPENDS = 6
LINES_MAX = 60
ACTION_KEYS = ("plan_id", "due", "due_exact", "amount", "name", "category_id")
# Без этих полей действие применить нельзя (``planned.services.apply_action``); такое действие модели отбрасывается.
ACTION_REQUIRED = {"move_plan": ("plan_id", "due"), "delete_plan": ("plan_id",), "change_amount": ("plan_id", "amount"),
                   "create_plan": ("name", "amount")}


class ActionDone(Exception):
    """Действие уже подтверждено и выполнено."""


# --- беседы ---

def _month_date(month):
    if month is None:
        return None
    return month if isinstance(month, date) else month.first


def _month_title(first):
    return f"{planned_services.NOMINATIVE[first.month - 1].capitalize()} {first.year}"


def title_for(thread, question=""):
    """Заголовок беседы: «Планы», «Октябрь 2026», «Трата: <место> · <сумма>» либо начало первого вопроса."""
    if thread.kind == Kind.PLANS:
        return "Планы"
    if thread.kind == Kind.MONTH and thread.month is not None:
        return _month_title(thread.month)
    if thread.kind == Kind.SPEND and thread.receipt_id is not None:
        receipt = thread.receipt
        place = store_name(receipt.store) if receipt.store_id is not None else "Без места"
        return f"Трата: {place} · {planned_services.money(receipt.total, receipt.currency_id)}"[:120]
    question = " ".join(question.split())
    if not question:
        return "Беседа"
    return question if len(question) <= TITLE_MAX else question[:TITLE_MAX - 1].rstrip() + "…"


def create_thread(owner, kind, *, receipt=None, month=None, question="", today=None):
    """Новая беседа; с вопросом (у ``plans`` — всегда, ``PLANS_OPENER``) — сразу и первое сообщение в очередь.

    Отказ ИИ (``AiRefused``) или лимита (``queue.AskLimit``) откатывает и беседу: ничего не создаётся.
    """
    if kind not in Kind.values:
        raise ValueError("kind")
    with transaction.atomic():
        thread = InsightThread(owner=owner, kind=kind, receipt=receipt if kind == Kind.SPEND else None,
                               month=_month_date(month) if kind == Kind.MONTH else None)
        thread.title = title_for(thread, question)
        thread.save()
        text = " ".join(question.split()) or (PLANS_OPENER if kind == Kind.PLANS else "")
        if text:
            send(thread, text, today)
    return thread


def _month_of(thread, today):
    if thread.kind == Kind.MONTH and thread.month is not None:
        return Month.of(thread.month)
    if thread.kind == Kind.SPEND and thread.receipt_id is not None:
        return Month.of(thread.receipt.purchased_on)
    return Month.of(today)


def send(thread, question, today=None):
    """Сообщение человека в беседу: сводка, планы и предмет снимаются сейчас, строка ``queued`` ждёт воркера.

    ``use_ai`` и лимиты вопросов (как у ``queue.request_ask``, общие с вопросами о тратах) — в одной транзакции.
    """
    today = today or timezone.localdate()
    owner = thread.owner
    month = _month_of(thread, today)
    context = summary.build(owner, month, today)
    context["plans"] = plans_input(owner, today)
    context["subject"] = subject(thread, context)
    with transaction.atomic():
        use_ai(owner)
        get_user_model().objects.select_for_update().filter(pk=owner.pk).first()
        own = InsightRequest.objects.filter(owner=owner, kind__in=[InsightRequest.Kind.ASK, InsightRequest.Kind.CHAT])
        if (own.filter(status__in=[Status.QUEUED, Status.RUNNING]).count() >= queue.MAX_UNFINISHED
                or own.filter(created_at__gte=timezone.now() - timedelta(hours=1)).count() >= queue.MAX_PER_HOUR):
            raise queue.AskLimit()
        row = InsightRequest.objects.create(owner=owner, thread=thread, kind=InsightRequest.Kind.CHAT, month=month.first,
                                            question=question, context=context)
        thread.save(update_fields=["updated_at"])
    return row


# --- вход модели ---

def _line_category(line):
    if line.category_id is not None:
        return line.category_id
    if line.product_id is not None and line.product.generic_id is not None:
        return line.product.generic.category_id
    return None


def _spend_subject(thread, summary_data):
    request = as_request(thread.owner)
    receipt = (Receipt.objects.filter(visible_receipts_q(request), pk=thread.receipt_id)
               .select_related("store__merchant").first())
    if receipt is None:
        return {"kind": "spend", "deleted": True}
    tree = CategoryTree.load()
    lines, sums = [], defaultdict(Decimal)
    for line in receipt.lines.select_related("product__generic", "category").order_by("position", "pk")[:LINES_MAX]:
        category_id = _line_category(line)
        paid = line.amount - line.discount_amount
        if category_id is not None and category_id in tree:
            sums[category_id] += paid
        lines.append({"name": line.raw_name, "quantity": quantity(line.quantity), "unit": line.unit, "amount": amount(paid),
                      "category": tree.name(category_id) if category_id in tree else None})
    main = max(sums, key=lambda key: (sums[key], -key)) if sums else None
    path = [tree.name(node) for node in tree.path_ids(main)] if main is not None else None
    limit = None
    if path and summary_data is not None:
        limit = next((item for item in summary_data.get("focus", {}).get("limits", []) if item["category"] == path[0]), None)
    store_spends = []
    if receipt.store_id is not None:
        store_spends = [{"date": iso_date(day), "total": amount(total), "currency": currency}
                        for day, total, currency in Receipt.objects.filter(visible_receipts_q(request), store_id=receipt.store_id)
                        .exclude(pk=receipt.pk).order_by("-purchased_on", "-pk")
                        .values_list("purchased_on", "total", "currency_id")[:STORE_SPENDS]]
    method = Receipt.PaymentMethod(receipt.payment_method).label if receipt.payment_method else None
    return {
        "kind": "spend", "id": receipt.pk, "date": iso_date(receipt.purchased_on),
        "store": store_name(receipt.store) if receipt.store_id is not None else None, "total": amount(receipt.total),
        "currency": receipt.currency_id, "payment_method": method, "category": path, "lines": lines, "limit": limit,
        "store_spends": store_spends,
    }


def subject(thread, summary_data=None):
    """Предмет беседы для модели: трата целиком, месяц, «оцени планы»; у свободной беседы — ``None``.

    ``summary_data`` — сводка месяца беседы: место траты в лимите корневой категории берётся из её ``focus.limits``,
    лишних запросов нет (у траты — три: чек, строки, последние траты места, плюс дерево категорий).
    """
    if thread.kind == Kind.PLANS:
        return {"kind": "plans", "ask": "verdicts"}
    if thread.kind == Kind.MONTH:
        return {"kind": "month", "month": Month.of(thread.month).label() if thread.month else None}
    if thread.kind == Kind.SPEND:
        return _spend_subject(thread, summary_data)
    return None


def plans_input(user, today=None):
    """Открытые планы семьи для модели: суммы в основной валюте по курсу сегодня (без курса — ``null``)."""
    today = today or timezone.localdate()
    request = as_request(user)
    rows = list(PlannedSpend.objects.filter(plans_q(request), receipt__isnull=True)
                .select_related("category", "goal").order_by("due", "name", "pk"))
    if not rows:
        return []
    converter = convert.converter(convert.base_currency(user), {(plan.currency_id, today) for plan in rows})
    saved = planned_services.saved_map(request, rows, today)
    result = []
    for plan in rows:
        kept = saved[plan.pk]
        in_base = converter.convert(plan.amount, plan.currency_id, today)
        saved_base = converter.convert(kept, plan.currency_id, today) if kept is not None else None
        result.append({"id": plan.pk, "name": plan.name, "amount": amount(in_base) if in_base is not None else None,
                       "due": iso_date(plan.due), "due_exact": plan.due_exact,
                       "category": plan.category.name if plan.category_id is not None else None,
                       "saved": amount(saved_base) if saved_base is not None else None,
                       "goal": plan.goal.name if kept is not None else None})
    return result


def history(thread, limit=queue.HISTORY, before=None):
    """Последние ``limit`` готовых пар «вопрос — ответ» беседы по порядку; ``before`` — не считая эту и более новые строки."""
    rows = InsightRequest.objects.filter(thread=thread, status=Status.SUCCEEDED).only("question", "answer")
    if before is not None:
        rows = rows.filter(pk__lt=before.pk)
    return [{"question": row.question, "answer": (row.answer or {}).get("answer", "")}
            for row in reversed(list(rows.order_by("-pk")[:limit]))]


# --- после ответа ---

def apply_verdicts(row):
    """Вердикты готового ответа — в ``ai_verdict`` / ``ai_reason`` / ``ai_at`` видимых владельцу планов.

    Планы, которых владелец не видит или которых нет, пропускаются. Возвращает число записанных вердиктов.
    """
    verdicts = (row.answer or {}).get("verdicts") or []
    ids = {item["plan_id"] for item in verdicts}
    if not ids:
        return 0
    visible = set(PlannedSpend.objects.filter(plans_q(as_request(row.owner)), pk__in=ids).values_list("pk", flat=True))
    now = timezone.now()
    count = 0
    for item in verdicts:
        if item["plan_id"] in visible:
            PlannedSpend.objects.filter(pk=item["plan_id"]).update(ai_verdict=item["verdict"], ai_reason=item["reason"][:300],
                                                                    ai_at=now)
            count += 1
    return count


def confirm_action(user, row, index):
    """Подтверждение действия ``index`` ответа: применить через ``planned.services.apply_action``, записать ``done_at`` и
    ``result``. Повтор — ``ActionDone``; негодный индекс, чужой план или негодные значения — ``ValueError`` (ничего не
    меняется)."""
    if isinstance(index, bool) or not isinstance(index, int) or index < 0:
        raise ValueError("index")
    with transaction.atomic():
        locked = InsightRequest.objects.select_for_update().get(pk=row.pk)
        actions = list(locked.actions or [])
        if index >= len(actions):
            raise ValueError("index")
        action = dict(actions[index])
        if action.get("done_at"):
            raise ActionDone()
        payload = {key: value for key, value in action.items() if key in ("kind", *ACTION_KEYS)}
        result = planned_services.apply_action(as_request(user), payload)
        action["done_at"], action["result"] = utc_datetime(timezone.now()), result
        actions[index] = action
        locked.actions = actions
        locked.save(update_fields=["actions"])
        if locked.thread_id is not None:
            InsightThread.objects.filter(pk=locked.thread_id).update(updated_at=timezone.now())
    return locked
