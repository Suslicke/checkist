"""Советчик «как накопить» на план: чистые расчёты поверх ``goals.forecast``, без базы и часов.

Вход — нужно ``need``, отложено ``saved``, срок ``due`` (``None`` — без срока), сегодня и ставки годовых
(``settings.PLANNED_RATES``; ponytail: per-family rates when asked). Горизонт — месяцы до срока по
``goals.services.months`` (30,44 дня, вверх, не меньше одного; срок сегодня или прошёл — 0). Три варианта:

- ``lump_fixed`` — срочный вклад без снятия: одна сумма сегодня, которая с процентами даст недостающее к сроку;
  доступен при сроке от 3 месяцев;
- ``monthly_flexible`` — вклад с пополнением и снятием: взнос в конце каждого месяца; доступен при сроке от
  1 месяца; без срока — «при N в месяц хватит к <месяц>», N — 10 % недостающего, округлённо вверх до двух
  значащих цифр (``nice``);
- ``invest`` — инвестиции / крипта (риск 3): тот же ежемесячный взнос по своей ставке; доступен при сроке больше
  12 месяцев.

Арифметика та же, что у цели-депозита (``goals.forecast``: проценты месяца на остаток, капитализация ежемесячно,
взнос в конце месяца), поэтому «Открыть депозит» по варианту даёт цель с теми же числами. Суммы округляются вверх
до копейки — чтобы хватило; ``gain`` — сколько принесут проценты (недостающее минус свои деньги).
"""
from datetime import date
from decimal import ROUND_CEILING, ROUND_UP, Decimal

from goals import forecast
from goals.services import months as months_of

KEYS = ("lump_fixed", "monthly_flexible", "invest")
LUMP_MIN_MONTHS = 3
INVEST_MIN_MONTHS = 13  # больше года
UNDATED_SHARE = Decimal("0.1")
ZERO = Decimal(0)
CENT = Decimal("0.01")
# Риск 1..3 и можно ли снять раньше срока.
RISK = {"lump_fixed": 1, "monthly_flexible": 1, "invest": 3}
LIQUID = {"lump_fixed": False, "monthly_flexible": True, "invest": True}
RATE_OF = {"lump_fixed": "fixed", "monthly_flexible": "flexible", "invest": "invest"}
REASONS = {
    "nothing_missing": "Нужная сумма уже отложена.",
    "due_passed": "Срок уже прошёл.",
    "undated": "Без срока этот вариант не подобрать.",
    "lump_short": "Срочный вклад подходит при сроке от трёх месяцев.",
    "invest_short": "Инвестиции подходят при сроке больше года.",
    "too_long": "При таком взносе копить дольше пятидесяти лет.",
}


def horizon(due, today):
    """Месяцев до срока: ``None`` — без срока, 0 — срок сегодня или прошёл."""
    if due is None:
        return None
    if due <= today:
        return 0
    return months_of((due - today).days)


def shift_month(day, count):
    """Первое число месяца через ``count`` месяцев после месяца ``day``."""
    index = day.year * 12 + day.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def nice(value):
    """Вверх до двух значащих цифр: 12 345,6 → 13 000; 999 → 1 000; 0,5 → 0,5."""
    if value <= 0:
        return value
    step = Decimal(1).scaleb(value.adjusted() - 1)
    result = (value / step).to_integral_value(rounding=ROUND_CEILING) * step
    return result.quantize(Decimal(1)) if result == result.to_integral_value() else result


def _ceil(value):
    return value.quantize(CENT, rounding=ROUND_UP)


def _option(key, rate, **fields):
    return {"key": key, "available": False, "reason": None, "amount": None, "times": None, "gain": None, "rate": rate,
            "risk": RISK[key], "liquid": LIQUID[key], "until": None, **fields}


def _lump(missing, months, due, rate):
    if months is None:
        return _option("lump_fixed", rate, reason=REASONS["undated"])
    if months < LUMP_MIN_MONTHS:
        return _option("lump_fixed", rate, reason=REASONS["lump_short"])
    factor = forecast.project(forecast.State(Decimal(1)), rate, True, months).total
    amount = _ceil(missing / factor)
    return _option("lump_fixed", rate, available=True, amount=amount, times=1, gain=missing - amount, until=due)


def _monthly(key, missing, months, due, today, rate):
    if months is None:
        payment = nice(missing * UNDATED_SHARE)
        count = forecast.months_to(forecast.State(), rate, True, missing, payment)
        if count is None:
            return _option(key, rate, reason=REASONS["too_long"])
        return _option(key, rate, available=True, amount=payment, times=count, gain=missing - payment * count,
                       until=shift_month(today, count))
    amount = _ceil(forecast.need(forecast.State(), rate, True, months, missing))
    return _option(key, rate, available=True, amount=amount, times=months, gain=missing - amount * months, until=due)


def _invest(missing, months, due, today, rate):
    if months is None:
        return _option("invest", rate, reason=REASONS["undated"])
    if months < INVEST_MIN_MONTHS:
        return _option("invest", rate, reason=REASONS["invest_short"])
    return _monthly("invest", missing, months, due, today, rate)


def options(need, saved, due, today, rates):
    """{need, saved, missing, due, months, options: [lump_fixed, monthly_flexible, invest]} — суммы ``Decimal``."""
    missing = max(need - saved, ZERO)
    months = horizon(due, today)
    rate = {key: Decimal(rates[RATE_OF[key]]) for key in KEYS}
    if missing <= 0 or months == 0:
        reason = REASONS["nothing_missing"] if missing <= 0 else REASONS["due_passed"]
        rows = [_option(key, rate[key], reason=reason) for key in KEYS]
    else:
        rows = [_lump(missing, months, due, rate["lump_fixed"]),
                _monthly("monthly_flexible", missing, months, due, today, rate["monthly_flexible"]),
                _invest(missing, months, due, today, rate["invest"])]
    return {"need": need, "saved": saved, "missing": missing, "due": due, "months": months, "options": rows}
