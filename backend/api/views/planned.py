"""Планы — ожидаемые разовые траты (``/api/planned/``): месяц, планы, совет «как накопить», депозит из совета.

Доступ — как у лимитов и записи трат: ``accounts`` — вход, ``local_single`` — DEBUG + флаг + loopback; запись —
с CSRF. Планы семьи видят и правят все её члены, чужой — ``404``. Суммы месяца — ``planned.services`` (основная
валюта семьи). Трата для привязки (``receipt_id``) должна быть видна запросу (``visible_receipts_q``); занята другим
планом — ``409 receipt_taken``. Цель (``goal_id``) — из видимых запросу (``goals_q``).
"""
import re
from datetime import date

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from accounts.access import request_user, visible_receipts_q
from accounts.people import person
from catalog.models import Category
from config.exceptions import ApiError, InvalidParameter
from goals.access import goals_q
from goals.models import Goal
from planned import advice as advisor, services
from planned.access import owner_fields
from planned.models import PlannedSpend
from rates.convert import request_base_currency
from receipts.models import Receipt
from stores.models import Currency

from .. import common
from ..params import Params
from .budget import _amount, read_month
from .goals import EARLIEST, _latest
from .receipts import manual_body
from .recognition import path_id
from .recognition_base import JsonObjectParser, LocalAPIView

FIELDS = ("name", "amount", "currency", "due", "due_exact", "category_id", "note", "goal_id", "receipt_id")
NAME_MAX = 100
NOTE_MAX = 300
MESSAGES = {
    "unknown_field": "Неизвестное поле.",
    "required": "Обязательное поле.",
    "name": f"Название — от 1 до {NAME_MAX} символов.",
    "amount": "Сумма больше нуля, не больше двух знаков после запятой.",
    "currency": "Валюта не найдена.",
    "due": "Дата в формате ГГГГ-ММ-ДД (с 2000 года, не дальше 50 лет) либо null.",
    "due_exact": "Ожидается true или false.",
    "category": "Категория не найдена.",
    "note": f"Комментарий не длиннее {NOTE_MAX} символов.",
    "goal": "Цель не найдена.",
    "receipt": "Трата не найдена.",
    "empty": "Укажите хотя бы одно поле.",
    "option": "Вариант — lump_fixed, monthly_flexible или invest, и он должен быть доступен.",
}


class PlannedConflict(ApiError):
    status_code = status.HTTP_409_CONFLICT
    code = "receipt_taken"
    message = "Эта трата уже закрывает другой план."


class PlannedBodyParser(JsonObjectParser):
    pass


def _id(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 < value < 2**63 else None


def _due(value, today):
    if not (isinstance(value, str) and len(value) == 10):
        return None
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return None
    return day if EARLIEST <= day <= _latest(today) else None


def read_plan(data, request, *, partial, today):
    """Проверенные поля тела (только присланные при ``partial``); ``receipt_id`` — только у правки."""
    errors, values = {}, {}
    for key in data:
        if key not in FIELDS or (key == "receipt_id" and not partial):
            errors[key] = [MESSAGES["unknown_field"]]
    for key in FIELDS:
        if key not in data:
            if not partial and key in ("name", "amount"):
                errors[key] = [MESSAGES["required"]]
            continue
        value = data[key]
        if key == "name":
            text = value.strip() if isinstance(value, str) else ""
            if not 0 < len(text) <= NAME_MAX:
                errors[key] = [MESSAGES["name"]]
            values["name"] = text
        elif key == "amount":
            amount = _amount(value)
            if amount is None:
                errors[key] = [MESSAGES["amount"]]
            values["amount"] = amount
        elif key == "currency":
            code = value.strip().upper() if isinstance(value, str) and re.fullmatch(r"[A-Za-z]{3}", value.strip()) else None
            if code is None or not Currency.objects.filter(pk=code).exists():
                errors[key] = [MESSAGES["currency"]]
            values["currency_id"] = code
        elif key == "due":
            if value is not None:
                day = _due(value, today)
                if day is None:
                    errors[key] = [MESSAGES["due"]]
                values["due"] = day
            else:
                values["due"] = None
        elif key == "due_exact":
            if not isinstance(value, bool):
                errors[key] = [MESSAGES["due_exact"]]
            values["due_exact"] = value
        elif key == "category_id":
            category = Category.objects.filter(pk=_id(value)).first() if value is not None else None
            if value is not None and category is None:
                errors[key] = [MESSAGES["category"]]
            values["category"] = category
        elif key == "note":
            if not isinstance(value, str) or len(value.strip()) > NOTE_MAX:
                errors[key] = [MESSAGES["note"]]
            values["note"] = value.strip() if isinstance(value, str) else ""
        elif key == "goal_id":
            goal = Goal.objects.filter(goals_q(request), pk=_id(value)).first() if value is not None else None
            if value is not None and goal is None:
                errors[key] = [MESSAGES["goal"]]
            values["goal"] = goal
        else:
            receipt = (Receipt.objects.filter(visible_receipts_q(request), pk=_id(value)).select_related("store__merchant").first()
                       if value is not None else None)
            if value is not None and receipt is None:
                errors[key] = [MESSAGES["receipt"]]
            values["receipt"] = receipt
    if not partial and "currency" not in data:
        values["currency_id"] = request_base_currency(request)
    if partial and not errors and not values:
        errors["body"] = [MESSAGES["empty"]]
    if errors:
        raise InvalidParameter(errors)
    return values


def apply(plan, values):
    """Записать поля и сохранить; «в месяце» — срок становится первым числом; трата — через ``services.link``."""
    receipt = values.pop("receipt", ...)
    for name, value in values.items():
        setattr(plan, name, value)
    if plan.due is not None and not plan.due_exact:
        plan.due = plan.due.replace(day=1)
    if receipt is ...:
        plan.save()
    elif receipt is None:
        services.unlink(plan)
    else:
        try:
            services.link(plan, receipt)
        except services.ReceiptTaken:
            raise PlannedConflict() from None
    return plan


def _receipt(receipt):
    if receipt is None:
        return None
    return {"id": receipt.pk, "total": common.amount(receipt.total), "currency": receipt.currency_id,
            "purchased_on": common.iso_date(receipt.purchased_on),
            "store_name": common.store_name(receipt.store) if receipt.store_id is not None else None}


def _goal(plan, saved):
    if plan.goal_id is None:
        return None
    share = int(saved * 100 // plan.amount) if saved else 0
    return {"id": plan.goal.pk, "name": plan.goal.name, "kind": plan.goal.kind, "saved": common.amount(saved),
            "share": min(share, 100)}


def _ai(plan):
    if not plan.ai_verdict:
        return None
    return {"verdict": plan.ai_verdict, "reason": plan.ai_reason, "at": common.utc_datetime(plan.ai_at)}


def plan_object(plan, tree, saved):
    return {
        "id": plan.pk, "name": plan.name,
        "category": None if plan.category_id is None else {
            "id": plan.category_id, "name": plan.category.name, "icon": tree.icon(plan.category_id) if plan.category_id in tree else None},
        "currency": plan.currency_id, "amount": common.amount(plan.amount), "due": common.iso_date(plan.due),
        "due_exact": plan.due_exact, "note": plan.note, "receipt": _receipt(plan.receipt), "goal": _goal(plan, saved),
        "ai": _ai(plan), "created_by": person(plan.created_by) if plan.created_by else None,
        "created_at": common.utc_datetime(plan.created_at),
    }


def _segments(segments):
    return [{**segment, "amount": common.amount(segment["amount"])} for segment in segments]


def base_object(base):
    return {**base, **{name: common.amount(base[name]) for name in ("expected", "done", "left")},
            "segments": _segments(base["segments"])}


def planned_card(card):
    """Карточка дашборда «Планируем в месяце» (``services.dashboard_card``) строками сумм; ``None`` остаётся ``None``."""
    if card is None:
        return None
    return {**card, "expected": common.amount(card["expected"]), "left": common.amount(card["left"]),
            "segments": _segments(card["segments"]),
            "rows": [{**row, "amount": common.amount(row["amount"])} for row in card["rows"]]}


def one(request, plan, today):
    """Объект одного плана: цель и отложенное — свежим чтением."""
    plan = services.plans(request).get(pk=plan.pk)
    return plan_object(plan, common.CategoryTree.load(), services.saved_map([plan], today)[plan.pk])


class PlansView(LocalAPIView):
    """``GET`` — месяц ``?month=ГГГГ-ММ`` (по умолчанию текущий), ``POST`` — новый план."""

    http_method_names = ["get", "post", "head", "options"]
    parser_classes = [PlannedBodyParser]

    def get(self, request):
        today = timezone.localdate()
        params = Params(request.query_params)
        month = read_month(params, today)
        params.check()
        view = services.month_view(request, month, today)
        tree = common.CategoryTree.load()
        return Response({
            "month": month.label(), "today": common.iso_date(today), "currency": view.base["currency"],
            "rows": [plan_object(plan, tree, view.saved[plan.pk]) for plan in view.rows],
            "undated": [plan_object(plan, tree, view.saved[plan.pk]) for plan in view.undated],
            "base": base_object(view.base),
            "months": [{**item, "month": item["month"].label(), "expected": common.amount(item["expected"]),
                        "segments": _segments(item["segments"])} for item in view.months],
        })

    def post(self, request):
        today = timezone.localdate()
        values = read_plan(manual_body(request), request, partial=False, today=today)
        plan = apply(PlannedSpend(**owner_fields(request), created_by=request_user(request)), values)
        return Response(one(request, plan, today), status=status.HTTP_201_CREATED)


class PlanView(LocalAPIView):
    """Один план: ``GET``, ``PATCH`` (любые поля плюс ``receipt_id``), ``DELETE``. Чужой — ``404``."""

    http_method_names = ["get", "patch", "delete", "head", "options"]
    parser_classes = [PlannedBodyParser]

    def get(self, request, pk):
        plan = common.get_or_404(services.plans(request), path_id(pk))
        return Response(one(request, plan, timezone.localdate()))

    def patch(self, request, pk):
        today = timezone.localdate()
        plan = common.get_or_404(services.plans(request), path_id(pk))
        apply(plan, read_plan(manual_body(request), request, partial=True, today=today))
        return Response(one(request, plan, today))

    def delete(self, request, pk):
        common.get_or_404(services.plans(request), path_id(pk)).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _option(row):
    return {**row, "amount": common.amount(row["amount"]), "gain": common.amount(row["gain"]),
            "rate": common.decimal_string(row["rate"], 2), "until": common.iso_date(row["until"])}


def advice_object(result):
    return {
        "need": common.amount(result["need"]), "saved": common.amount(result["saved"]), "missing": common.amount(result["missing"]),
        "currency": result["currency"], "due": common.iso_date(result["due"]), "months": result["months"],
        "options": [_option(row) for row in result["options"]],
    }


class AdviceView(LocalAPIView):
    """``GET`` — «как накопить»: нужно, отложено, недостаёт и три варианта (``planned.advice``)."""

    def get(self, request, pk):
        plan = common.get_or_404(services.plans(request), path_id(pk))
        return Response(advice_object(services.advice(plan, timezone.localdate())))


class DepositView(LocalAPIView):
    """``POST {"option"}`` — открыть депозит по варианту совета: цель ``deposit`` на недостающее, привязанная к плану.

    Ответ — ``201`` план с целью; вариант неизвестен или недоступен — ``400`` у ``option``.
    """

    http_method_names = ["post", "options"]
    parser_classes = [PlannedBodyParser]

    def post(self, request, pk):
        today = timezone.localdate()
        plan = common.get_or_404(services.plans(request), path_id(pk))
        data = manual_body(request)
        errors = {key: [MESSAGES["unknown_field"]] for key in data if key != "option"}
        option = data.get("option")
        if option not in advisor.KEYS:
            errors["option"] = [MESSAGES["option"]]
        if errors:
            raise InvalidParameter(errors)
        try:
            services.deposit(request, plan, option, today)
        except ValueError:
            raise InvalidParameter({"option": [MESSAGES["option"]]}) from None
        return Response(one(request, plan, today), status=status.HTTP_201_CREATED)
