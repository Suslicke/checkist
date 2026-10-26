"""«Деньги» (``GET /api/money/?month=ГГГГ-ММ``, 2026-10-26): сводка месяца одним ответом для экрана ``/money``.

Доступ — как у ``/api/dashboard/``. Всё в основной валюте семьи (``rates.convert``): доход и траты — по курсу дня,
платежи и цели — по сегодняшнему; суммы без курса не входят. Траты — ``visible_receipts_q``, доходы семьи —
``owner_q`` (как ``incomes.services.month_income``), платежи, планы и цели — их правила (``budget.home.load``).
Разбор — последний удавшийся ``review`` прошлого месяца своего пользователя (чужие не видны). Число запросов от
объёма данных не зависит.
"""
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from rest_framework.response import Response

from accounts.access import owner_q, request_user, visible_receipts_q
from budget import dashboard, history, home
from budget.access import limits_q
from goals.models import Contribution
from incomes.models import Income
from insights.models import InsightRequest
from receipts import trends
from receipts.decimal_math import price_context
from receipts.models import Receipt

from .. import common, stats_common
from ..params import Params
from .budget import goals_tile_object, read_month
from .recognition_base import LocalAPIView

MONTHS = 6
ZERO = Decimal("0.00")


def _day_rows(queryset, day_field, amount_field):
    return list(queryset.values("currency_id", day_field).annotate(total_sum=Sum(amount_field)).order_by()
                .values_list("currency_id", day_field, "total_sum"))


def _converted_sum(rows, converter):
    """Сумма строк ``(валюта, день, сумма)`` в основной валюте; без курса — мимо."""
    with price_context():
        return sum((value for value in (converter.convert(total, currency, day) for currency, day, total in rows)
                    if value is not None), ZERO)


def _review(user, month):
    """Последний удавшийся разбор месяца ``month``: его изменение к прошлому месяцу и число советов."""
    row = (InsightRequest.objects.filter(owner=user, kind=InsightRequest.Kind.REVIEW, month=month.first,
                                         status=InsightRequest.Status.SUCCEEDED)
           .order_by("-pk").values_list("context", "answer").first())
    if row is None:
        return None
    context, answer = row
    focus = context.get("focus") if isinstance(context, dict) else None
    advice = answer.get("advice") if isinstance(answer, dict) else None
    return {"month": month.label(), "change_previous": focus.get("change_previous") if isinstance(focus, dict) else None,
            "tips": len(advice) if isinstance(advice, list) else 0}


def _payments_object(tile, today):
    """Платежи месяца; без платежей — нули и ``next: null`` (объект всегда есть, в отличие от плитки дашборда)."""
    if tile is None:
        return {"paid": 0, "total": 0, "left": common.amount(ZERO), "next": None}
    nearest = tile.next
    return {"paid": tile.paid, "total": tile.total, "left": common.amount(tile.left),
            "next": None if nearest is None else {"name": nearest.payment.name, "due_date": common.iso_date(nearest.due),
                                                  "days": (nearest.due - today).days}}


def _plans_object(summary):
    if summary is None:
        return None
    return {"left": common.amount(summary["left"]), "count": summary["count"], "undated_count": summary["undated_count"]}


class MoneyView(LocalAPIView):
    """Доход, потрачено, отложено, поток месяца, платежи, планы, цели, шесть месяцев трат и разбор прошлого месяца."""

    def get(self, request):
        today = timezone.localdate()
        params = Params(request.query_params)
        month = read_month(params, today)
        params.check()
        user = request_user(request)
        months = trends.window(month.last, MONTHS)
        receipts = Receipt.objects.filter(visible_receipts_q(request), purchased_on__gte=months[0],
                                          purchased_on__lte=month.last)
        spends = _day_rows(receipts, "purchased_on", "total")
        incomes = _day_rows(Income.objects.filter(owner_q(request, since="received_on"), received_on__gte=month.first,
                                                  received_on__lte=month.last), "received_on", "amount")
        loaded = home.load(request, month, today)
        contributions = _day_rows(
            Contribution.objects.filter(goal__in=loaded.goals, kind=Contribution.Kind.DEPOSIT,
                                        date__gte=month.first, date__lte=month.last), "date", "amount",
        ) if loaded.goals else []
        budget = history.budget_at(limits_q(request), month.first)
        rate_day = dashboard.limit_day(month, today)
        converter = stats_common.converter(request, loaded.needs(today) | {
            *((currency, day) for currency, day, _total in spends + incomes + contributions),
            *(((budget.currency_id, rate_day),) if budget is not None else ())})
        totals = home.day_totals(spends, converter)
        by_month = {first: ZERO for first in months}
        with price_context():
            for day, value in totals.items():
                by_month[trends.month_start(day)] += value
        spent = by_month[month.first]
        income = _converted_sum(incomes, converter) if incomes else None
        set_aside = _converted_sum(contributions, converter)
        payments = home.payments_tile(loaded, converter, today)
        payments_ahead = payments.left if payments is not None else ZERO
        plans_ahead = loaded.plans.base["left"]
        basis = income
        if basis is None and budget is not None and budget.amount is not None:
            basis = converter.convert(budget.amount, budget.currency_id, rate_day)
        with price_context():
            free = None if basis is None else basis - spent - payments_ahead - plans_ahead
        return Response({
            "month": month.label(), "currency": converter.base,
            "income": common.amount(income), "spent": common.amount(spent), "set_aside": common.amount(set_aside),
            "flow": {"spent": common.amount(spent), "payments_ahead": common.amount(payments_ahead),
                     "plans_ahead": common.amount(plans_ahead), "free": common.amount(free)},
            "payments": _payments_object(payments, today),
            "plans": _plans_object(home.plans_summary(loaded)),
            "goals": goals_tile_object(home.goals_tile(loaded, converter, today)),
            "months": [{"month": trends.label(first), "spent": common.amount(by_month[first])} for first in months],
            "review": _review(user, month.previous()),
        })
