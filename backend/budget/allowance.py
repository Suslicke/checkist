"""«Можно тратить в день» на Главной (волна 2, 2026-10-13).

(основа − потрачено − неоплаченные регулярные платежи − открытые планы месяца) / оставшиеся дни месяца, включая сегодня; только
для текущего месяца. Основа — общий бюджет месяца (``MonthlyBudget``), без него — ``income`` (доход месяца
в основной валюте; ``None`` — показателя нет). Лимиты категорий основой не бывают (2026-10-13, жалоба
человека: лимит одной квартиры давал «438 ₸ в день» — остаток аренды на дни месяца). Потрачено — все
видимые траты месяца (``visible_receipts_q``, без скрытых), как «Потрачено» Главной. Всё в основной валюте
семьи (``rates.convert``): траты — по курсу дня покупки, бюджет, платежи и планы — по сегодняшнему; сумма без
курса не учитывается. Планы (``planned.services.open_total``, 2026-10-26) — открытые планы со сроком в этом
месяце; план без срока сюда не входит. Ушли в минус — ``overspent`` вместо ``per_day``.
"""
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_DOWN, Decimal

from django.db.models import Sum
from django.utils import timezone

from accounts.access import visible_receipts_q
from rates import convert
from receipts.models import Receipt

from .access import limits_q
from .dashboard import Month, days_left
from .history import budget_at

_ZERO = Decimal("0.00")
_CENT = Decimal("0.01")


@dataclass(frozen=True)
class Allowance:
    currency: str
    basis: str  # "budget" | "income"
    amount: Decimal  # основа: бюджет либо доход
    spent: Decimal
    unpaid: Decimal
    unpaid_count: int
    planned: Decimal  # открытые планы месяца (planned.services.open_total)
    planned_count: int
    days_left: int
    per_day: Decimal | None  # None — перерасход
    overspent: Decimal | None


def _sum(values):
    return sum((value for value in values if value is not None), _ZERO)


def daily(user, month, *, income=None, today=None, payments=None):
    """daily(user, month, *, income=None, payments=None) -> Allowance | None; ``None`` — не текущий месяц либо основы нет.

    ``month`` — ``budget.dashboard.Month`` либо дата внутри месяца; ``income`` — доход месяца в основной
    валюте (``incomes.services.month_income``) либо функция без аргументов, которая его вернёт: основа только
    без бюджета, и функция зовётся только тогда. ``payments`` — готовый список ``recurring.services.unpaid``
    (Главная сверяет платежи один раз, 2026-10-26); без него платежи читаются здесь.
    """
    from planned.services import open_total  # planned и recurring зависят от budget: импорт внутри
    from recurring.access import as_request
    from recurring.services import unpaid

    today = today or timezone.localdate()
    if isinstance(month, date):
        month = Month.of(month)
    if month != Month.of(today):
        return None
    request = as_request(user)
    base = convert.base_currency(user)
    spends = list(Receipt.objects.filter(visible_receipts_q(request), purchased_on__gte=month.first,
                                         purchased_on__lte=month.last)
                  .values("currency_id", "purchased_on").annotate(total_sum=Sum("total")).order_by()
                  .values_list("currency_id", "purchased_on", "total_sum"))
    budget = budget_at(limits_q(request), month.first)
    if budget is not None and budget.amount is None:
        budget = None
    if payments is None:
        payments = unpaid(user, month, today)
    converter = convert.converter(base, {
        *((currency, day) for currency, day, _total in spends),
        *((payment["currency"], today) for payment in payments),
        *(((budget.currency_id, today),) if budget is not None else ()),
    })
    if budget is not None:
        basis, amount = "budget", converter.convert(budget.amount, budget.currency_id, today)
    else:
        basis, amount = "income", income() if callable(income) else income
    if amount is None:
        return None
    spent = _sum(converter.convert(total, currency, day) for currency, day, total in spends)
    owed = [converter.convert(payment["amount"], payment["currency"], today) for payment in payments]
    unpaid_total = _sum(owed)
    planned_total, planned_count = open_total(user, month, today)
    days = days_left(month, today)
    rest = amount - spent - unpaid_total - planned_total
    over = rest < 0
    return Allowance(
        currency=base, basis=basis, amount=amount, spent=spent, unpaid=unpaid_total,
        unpaid_count=sum(1 for value in owed if value is not None), planned=planned_total, planned_count=planned_count,
        days_left=days,
        per_day=None if over else (rest / days).quantize(_CENT, rounding=ROUND_DOWN),
        overspent=-rest if over else None,
    )
