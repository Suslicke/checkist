"""Планы семьи: месяц в основной валюте, открытые планы для «можно тратить в день», привязка траты, отложенное
на цели, совет «как накопить», депозит из совета и действия чата.

Месяц плана — месяц его ``due`` (план закрыт — тоже в своём месяце; день покупки траты не важен). Суммы —
в основной валюте семьи (``rates.convert.converter``) по курсу «дня месяца»: сегодня у текущего и будущих
месяцев, последний день — у прошлого (как у лимитов дашборда); факт закрытой траты — по курсу дня покупки.
План без курса не входит в суммы и считается в ``excluded``; план без срока (``due`` NULL) — в ``undated``, не в
месяце и не в «можно тратить в день». Число запросов от числа планов не зависит.

Видимость сквозь план (2026-10-26): закрывшая трата показывается и считается фактом только когда её видит сам
запрос (``visible_receipts_q``; скрытый главным платёж — только главному, строки раньше «видит с» — нет), иначе план
закрыт суммой плана и без траты (``visible_receipt_ids``). Цель плана видна только тем, кому видна сама цель
(``goals.access.goals_q``): личная цель одного члена семьи у семейного плана остальным не показывается и «отложено»
у них — ноль; привязать к плану можно только цель, видимую всем, кто видит план (``goal_allowed``).
"""
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.access import request_user, visible_receipts_q
from budget.dashboard import Month
from catalog.models import Category
from goals import services as goals_services
from goals.access import goals_q
from goals.models import Goal
from rates import convert
from receipts.models import Receipt
from stores.models import Currency

from . import advice as advisor
from .access import as_request, owner_fields, plans_q
from .models import PlannedSpend

ZERO = Decimal("0.00")
NBSP = "\u00a0"
DASHBOARD_ROWS = 3
AMOUNT_MAX = Decimal("999999999999.99")
GENITIVE = ("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября",
            "декабря")
NOMINATIVE = ("январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь",
              "декабрь")


class ReceiptTaken(Exception):
    """Трата уже закрывает другой план (``holder``)."""

    def __init__(self, holder):
        super().__init__("receipt_taken")
        self.holder = holder


@dataclass
class MonthView:
    month: Month
    today: date
    rows: list  # планы месяца по сроку
    undated: list  # планы без срока
    base: dict  # суммы месяца в основной валюте
    months: list = field(default_factory=list)  # месяцы с планами от текущего вперёд
    saved: dict = field(default_factory=dict)  # {plan.pk: Decimal | None} — отложено на цели в валюте плана
    visible_receipts: set = field(default_factory=set)  # id закрывших трат, которые видит запрос
    visible_goals: set = field(default_factory=set)  # id целей планов, которые видит запрос


def plans(request):
    return (PlannedSpend.objects.filter(plans_q(request))
            .select_related("category", "receipt__store__merchant", "goal", "created_by")
            .order_by("due", "name", "pk"))


def rate_day(month, today):
    """День курса месяца: последний день у прошлого, сегодня у текущего и будущих."""
    return min(month.last, today)


def _segment(plan, amount):
    return {"id": plan.pk, "name": plan.name, "category_id": plan.category_id, "amount": amount, "done": plan.done}


def visible_receipt_ids(request, rows):
    """id закрывших трат планов ``rows``, которые видит запрос (главный — и скрытые им); один запрос либо ни одного."""
    ids = {plan.receipt_id for plan in rows if plan.receipt_id is not None}
    if not ids:
        return set()
    return set(Receipt.objects.filter(visible_receipts_q(request, include_hidden=True), pk__in=ids)
               .values_list("pk", flat=True))


def visible_goal_ids(request, rows):
    """id целей планов ``rows``, которые видит запрос (``goals_q``); один запрос либо ни одного."""
    ids = {plan.goal_id for plan in rows if plan.goal_id is not None}
    if not ids:
        return set()
    return set(Goal.objects.filter(goals_q(request), pk__in=ids).values_list("pk", flat=True))


def goal_allowed(owner, goal):
    """Можно ли привязать ``goal`` к плану владельца ``owner`` (``{"household", "user"}``): цель должна быть видна
    всем, кто видит план — семейному плану только цель его семьи, личному — своя либо семейная."""
    if owner["household"] is not None:
        return goal.household_id == owner["household"].pk
    return goal.user_id == owner["user"].pk or goal.household_id is not None


def _sums(rows, converter, day, visible=frozenset()):
    expected = done = left = ZERO
    excluded = done_count = 0
    segments = []
    for plan in rows:
        if plan.done:
            done_count += 1
        amount = converter.convert(plan.amount, plan.currency_id, day)
        if amount is None:
            excluded += 1
            continue
        expected += amount
        segments.append(_segment(plan, amount))
        if plan.done:
            # Невидимая запросу трата — план закрыт суммой плана, её итог не раскрывается.
            fact = (converter.convert(plan.receipt.total, plan.receipt.currency_id, plan.receipt.purchased_on)
                    if plan.receipt_id in visible else None)
            done += fact if fact is not None else amount
        else:
            left += amount
    return {"expected": expected, "done": done, "left": left, "excluded": excluded, "count": len(rows),
            "done_count": done_count, "segments": segments}


def _needs(rows, day, visible):
    needs = {(plan.currency_id, day) for plan in rows}
    needs |= {(plan.receipt.currency_id, plan.receipt.purchased_on) for plan in rows if plan.receipt_id in visible}
    return needs


def saved_map(request, rows, today, visible=None):
    """{plan.pk: Decimal | None} — отложено на цели плана в валюте плана по курсу сегодня; без цели либо цель не видна
    запросу — ``None``. Взносы всех целей — один запрос (``goals.services.progress``), курсы — по запросу на валюту плана.
    """
    visible = visible_goal_ids(request, rows) if visible is None else visible
    with_goal = [plan for plan in rows if plan.goal_id in visible]
    result = {plan.pk: None for plan in rows}
    if not with_goal:
        return result
    goals = {plan.goal_id: plan.goal for plan in with_goal}
    progress = goals_services.progress(goals.values(), today)
    needs = {}
    for plan in with_goal:
        needs.setdefault(plan.currency_id, set()).add((plan.goal.currency_id, today))
    converters = {base: convert.converter(base, pairs) for base, pairs in needs.items()}
    for plan in with_goal:
        amount = progress[plan.goal_id].saved
        result[plan.pk] = converters[plan.currency_id].convert(amount, plan.goal.currency_id, today)
    return result


def saved(request, plan, today=None):
    """Отложено на цели плана в валюте плана; ``None`` — цели нет, она не видна запросу или нет курса."""
    return saved_map(request, [plan], today or timezone.localdate())[plan.pk]


def month_view(request, month, today=None):
    """Планы запроса в ``month``, без срока, суммы месяца и месяцы с планами от текущего вперёд."""
    today = today or timezone.localdate()
    rows = list(plans(request))
    in_month = [plan for plan in rows if plan.due is not None and month.first <= plan.due <= month.last]
    undated = [plan for plan in rows if plan.due is None]
    current = Month.of(today)
    later = {}
    for plan in rows:
        if plan.due is not None and plan.due >= current.first:
            later.setdefault((plan.due.year, plan.due.month), []).append(plan)
    base = convert.request_base_currency(request)
    visible = visible_receipt_ids(request, rows)
    goals = visible_goal_ids(request, rows)
    needs = _needs(in_month, rate_day(month, today), visible)
    for (year, number), items in later.items():
        needs |= _needs(items, rate_day(Month(year, number), today), visible)
    converter = convert.converter(base, needs)
    months = []
    for key in sorted(later):
        item = Month(*key)
        sums = _sums(later[key], converter, rate_day(item, today), visible)
        months.append({"month": item, **{name: sums[name] for name in ("expected", "count", "done_count", "segments")}})
    return MonthView(month, today, in_month, undated,
                     {"currency": base, **_sums(in_month, converter, rate_day(month, today), visible)},
                     months, saved_map(request, rows, today, goals), visible, goals)


def open_total(user, month, today=None):
    """(Decimal в основной валюте, число) открытых планов месяца — для ``budget.allowance.daily``; без курса не считаются."""
    today = today or timezone.localdate()
    if isinstance(month, date):
        month = Month.of(month)
    rows = list(PlannedSpend.objects.filter(plans_q(as_request(user)), receipt__isnull=True, due__gte=month.first,
                                            due__lte=month.last))
    day = rate_day(month, today)
    converter = convert.converter(convert.base_currency(user), {(plan.currency_id, day) for plan in rows})
    total, count = ZERO, 0
    for plan in rows:
        amount = converter.convert(plan.amount, plan.currency_id, day)
        if amount is not None:
            total, count = total + amount, count + 1
    return total, count


def dashboard_card(request, month, today=None):
    """Карточка «Планируем в месяце» для дашборда; ``None`` — планов месяца нет."""
    view = month_view(request, month, today)
    if not view.rows:
        return None
    open_rows = [plan for plan in view.rows if not plan.done][:DASHBOARD_ROWS]
    return {**{name: view.base[name] for name in ("currency", "expected", "left", "count", "done_count", "segments")},
            "rows": [{"id": plan.pk, "name": plan.name, "amount": plan.amount, "currency": plan.currency_id,
                      "category_id": plan.category_id} for plan in open_rows]}


def link(plan, receipt):
    """Закрыть план тратой; трата уже у другого плана — ``ReceiptTaken``. Повтор с той же тратой — то же состояние."""
    holder = PlannedSpend.objects.filter(receipt=receipt).exclude(pk=plan.pk).first()
    if holder is not None:
        raise ReceiptTaken(holder)
    plan.receipt = receipt
    try:
        with transaction.atomic():
            plan.save()
    except IntegrityError:
        raise ReceiptTaken(PlannedSpend.objects.filter(receipt=receipt).exclude(pk=plan.pk).first()) from None
    return plan


def unlink(plan):
    plan.receipt = None
    plan.save()
    return plan


def set_goal(plan, goal):
    plan.goal = goal
    plan.save()
    return plan


def advice(request, plan, today=None):
    """Совет «как накопить»: ``planned.advice.options`` по ставкам ``settings.PLANNED_RATES`` плюс ``currency``;
    «отложено» — только с видимой запросу цели."""
    today = today or timezone.localdate()
    result = advisor.options(plan.amount, saved(request, plan, today) or ZERO, plan.due, today, settings.PLANNED_RATES)
    return {**result, "currency": plan.currency_id}


def deposit(request, plan, option, today=None):
    """Открыть депозит по варианту совета: цель ``kind=deposit`` владельца плана (семейному плану — семьи, личному —
    пользователя) на недостающее к сроку, привязать. Вариант неизвестен или сейчас недоступен — ``ValueError`` с причиной.
    """
    today = today or timezone.localdate()
    result = advice(request, plan, today)
    chosen = next((row for row in result["options"] if row["key"] == option), None)
    if chosen is None:
        raise ValueError("unknown option")
    if not chosen["available"]:
        raise ValueError(chosen["reason"])
    with transaction.atomic():
        goal = Goal.objects.create(
            household=plan.household, user=plan.user, name=plan.name, amount=result["missing"], currency_id=plan.currency_id,
            deadline=plan.due, kind=Goal.Kind.DEPOSIT, rate=chosen["rate"], capitalization=Goal.Capitalization.MONTHLY,
            created_by=request_user(request))
        set_goal(plan, goal)
    return goal


# --- действия чата ---

def money(amount, currency):
    """«48 000 KZT» с неразрывными пробелами: текст стоит в заголовке беседы и в ответе действия, число не рвётся."""
    text = f"{amount:,.2f}".replace(",", NBSP)
    return f"{text[:-3] if text.endswith('.00') else text}{NBSP}{currency}"


def when(due, due_exact):
    if due is None:
        return "без срока"
    if due_exact:
        return f"к {due.day} {GENITIVE[due.month - 1]} {due.year}"
    return f"на {NOMINATIVE[due.month - 1]} {due.year}"


def _amount(value):
    if isinstance(value, bool) or value is None:
        raise ValueError("amount")
    try:
        amount = Decimal(str(value).strip().replace(",", "."))
    except InvalidOperation:
        raise ValueError("amount") from None
    if not amount.is_finite() or not 0 < amount <= AMOUNT_MAX or amount != amount.quantize(Decimal("0.01")):
        raise ValueError("amount")
    return amount


def _due(action):
    raw = action.get("due")
    if raw in (None, ""):
        return None, True
    try:
        due = date.fromisoformat(raw) if isinstance(raw, str) else None
    except ValueError:
        due = None
    if due is None:
        raise ValueError("due")
    exact = action.get("due_exact", True)
    if not isinstance(exact, bool):
        raise ValueError("due_exact")
    return (due if exact else due.replace(day=1)), exact


def _plan_of(request, action):
    plan_id = action.get("plan_id")
    if not isinstance(plan_id, int) or isinstance(plan_id, bool):
        raise ValueError("plan_id")
    plan = PlannedSpend.objects.filter(plans_q(request), pk=plan_id).first()
    if plan is None:
        raise ValueError("plan not found")
    return plan


def _move(request, action, today):
    plan = _plan_of(request, action)
    plan.due, plan.due_exact = _due(action)
    plan.save()
    return f"Перенесли «{plan.name}»: теперь {when(plan.due, plan.due_exact)}."


def _delete(request, action, today):
    plan = _plan_of(request, action)
    text = f"Удалили план «{plan.name}» ({money(plan.amount, plan.currency_id)})."
    plan.delete()
    return text


def _change(request, action, today):
    plan = _plan_of(request, action)
    before = money(plan.amount, plan.currency_id)
    plan.amount = _amount(action.get("amount"))
    plan.save()
    return f"Сумма плана «{plan.name}»: {before} → {money(plan.amount, plan.currency_id)}."


def _create(request, action, today):
    name = action.get("name")
    if not isinstance(name, str) or not 0 < len(name.strip()) <= 100:
        raise ValueError("name")
    currency = action.get("currency") or convert.request_base_currency(request)
    if not isinstance(currency, str) or not Currency.objects.filter(pk=currency.upper()).exists():
        raise ValueError("currency")
    category = None
    if action.get("category_id") is not None:
        category = Category.objects.filter(pk=action["category_id"]).first() if isinstance(action["category_id"], int) else None
        if category is None:
            raise ValueError("category_id")
    due, exact = _due(action)
    plan = PlannedSpend.objects.create(
        **owner_fields(request), name=name.strip(), amount=_amount(action.get("amount")), currency_id=currency.upper(),
        due=due, due_exact=exact, category=category, created_by=request_user(request))
    return f"Запланировали «{plan.name}» на {money(plan.amount, plan.currency_id)}, {when(plan.due, plan.due_exact)}."


ACTIONS = {"move_plan": _move, "delete_plan": _delete, "change_amount": _change, "create_plan": _create}


def apply_action(request, action, today=None):
    """Применить действие чата (``move_plan`` | ``delete_plan`` | ``change_amount`` | ``create_plan``) и вернуть текст
    «что сделано». Чужой или отсутствующий план и негодные значения — ``ValueError``."""
    if not isinstance(action, dict) or action.get("kind") not in ACTIONS:
        raise ValueError("kind")
    return ACTIONS[action["kind"]](request, action, today or timezone.localdate())
