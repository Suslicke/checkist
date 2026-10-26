"""Главная после переработки (2026-10-26): пульс месяца по дням, «Требует внимания», плитки и экран «Деньги».

Всё здесь — только из того, что сервер уже считает: траты месяца — ``budget.dashboard.collect_month``
(``spending.Collected.day_totals``), лимиты — блок основной валюты ``currency_blocks``, платежи —
``recurring.services.month_view``, планы — ``planned.services.month_view``, цели — ``goals.services.progress``.
Деньги — в основной валюте семьи через ``rates.convert.Converter`` запроса: траты по курсу дня покупки, платежи и
цели — по сегодняшнему; сумма без курса не входит (как везде). БД этот модуль не трогает, кроме ``load``
(платежи, планы, цели — число запросов от объёма не зависит) и ``income_entered`` (один ``EXISTS``).

«Требует внимания» — только о текущем месяце (срок «через 2 дня» и вопросы о прошлом месяце имеют смысл лишь
сегодня); о другом месяце строк нет. Порядок — просрочено, срок ≤ 2 дней, лимит > 100 %, доход не внесён (1-е … 10-е,
есть регулярный доход, доходов месяца у семьи нет), лимит ≥ 80 %, вердикты ИИ «подождать» / «отказаться» по открытым
планам месяца, вопросы о прошлом месяце. Тексты — без денег: сумму и валюту несут ``amount`` / ``currency``, клиент
показывает их своим ``money()``.
"""
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal

from goals import services as goals_services
from goals.access import goals_q
from goals.models import Goal
from planned import services as planned_services
from planned.models import PlannedSpend
from receipts.decimal_math import price_context, round_decimal
from recurring import services as recurring_services

from .dashboard import Month

ZERO = Decimal("0.00")
ATTENTION_ROWS = 3
DUE_SOON_DAYS = 2
INCOME_REMINDER_DAY = 10
LIMIT_NEAR_PERCENT = 80
QUESTION_NAMES = 3
GOALS_TOP = 2
MONTHS_NOMINATIVE = recurring_services.MONTH_NAMES
MONTHS_GENITIVE = planned_services.GENITIVE
VERDICT_TEXT = {PlannedSpend.Verdict.WAIT: "лучше подождать", PlannedSpend.Verdict.DROP: "лучше отказаться"}
SETTLED = (recurring_services.PAID, recurring_services.ELSEWHERE)
COUNTED = SETTLED + recurring_services.UNPAID  # платёж месяца: оплачен, оплачен иначе, ждёт либо просрочен


@dataclass(frozen=True)
class Row:
    kind: str
    title: str
    meta: str
    href: str
    amount: Decimal | None = None
    currency: str | None = None


@dataclass
class Loaded:
    """Платежи, планы и цели месяца для Главной и «Денег»."""

    payments: object  # recurring.services.MonthView
    plans: object  # planned.services.MonthView
    goals: list
    progress: dict  # {goal.pk: goals.services.Progress}

    def needs(self, today):
        """Пары ``(валюта, день)`` для ``Converter``: платежи и цели — по сегодняшнему курсу."""
        return ({(row.payment.currency_id, today) for row in self.payments.payments}
                | {(goal.currency_id, today) for goal in self.goals})


def load(request, month, today):
    """Один набор на оба экрана; планы и платежи — своими модулями, цели — ``goals_q`` и ``progress``."""
    goals = list(Goal.objects.filter(goals_q(request)).order_by("pk"))
    return Loaded(
        payments=recurring_services.month_view(request, month, today, suggestions=False),
        plans=planned_services.month_view(request, month, today),
        goals=goals, progress=goals_services.progress(goals, today),
    )


# --- пульс месяца ---

def day_totals(day_rows, converter):
    """``{день: Σ}`` трат в основной валюте по строкам ``(валюта, день, сумма)`` либо ``DayTotal``; без курса — мимо."""
    totals = {}
    with price_context():
        for row in day_rows:
            currency, day, total = (row.currency, row.day, row.total) if hasattr(row, "day") else row
            value = converter.convert(total, currency, day)
            if value is not None:
                totals[day] = totals.get(day, ZERO) + value
    return totals


def by_day(totals, month):
    """``[(день, сумма)]`` на каждый день месяца по порядку; день без трат — 0."""
    return [(month.first + timedelta(days=offset), totals.get(month.first + timedelta(days=offset), ZERO))
            for offset in range((month.last - month.first).days + 1)]


def average_day(totals, month, today):
    """Средний день: сумма месяца / прошедшие дни (включая сегодня); прошлый месяц — / дни месяца.

    ``None`` — трат с курсом в месяце нет либо месяц ещё не начался.
    """
    if not totals:
        return None
    current = Month.of(today)
    if month == current:
        days = today.day
    elif (month.year, month.month) < (current.year, current.month):
        days = month.last.day
    else:
        return None
    with price_context():
        return round_decimal(sum(totals.values(), ZERO) / days, 2)


# --- «Требует внимания» ---

def _plural(number, one, few, many):
    tail, tens = number % 10, number % 100
    if tail == 1 and tens != 11:
        return one
    if 2 <= tail <= 4 and not 12 <= tens <= 14:
        return few
    return many


def _days(number):
    return f"{number} {_plural(number, 'день', 'дня', 'дней')}"


def _on(day):
    return f"{day.day} {MONTHS_GENITIVE[day.month - 1]}"


def _payment_rows(payments, today):
    overdue, soon = [], []
    for row in sorted(payments, key=lambda row: (row.due, row.payment.name, row.payment.pk)):
        if row.payment.kind != recurring_services.SPEND:
            continue
        name, amount, currency = row.payment.name, row.payment.amount, row.payment.currency_id
        if row.state == recurring_services.OVERDUE:
            late = (today - row.due).days
            overdue.append(Row("payment_overdue", f"{name}: просрочено на {_days(late)}", f"Срок был {_on(row.due)}",
                               "/recurring", amount, currency))
        elif row.state == recurring_services.DUE and (row.due - today).days <= DUE_SOON_DAYS:
            left = (row.due - today).days
            when = "сегодня" if left == 0 else "завтра" if left == 1 else f"через {_days(left)}"
            soon.append(Row("payment_due", f"{name} {when}", f"Срок {_on(row.due)}", "/recurring", amount, currency))
    return overdue, soon


def _limit_rows(block):
    """Строки лимитов блока основной валюты (с вложенными): ``(процент, Row)`` у ≥ 80 %."""
    found = []

    def walk(rows):
        for row in rows:
            if row.limit is not None and row.limit > 0:
                with price_context():
                    percent = int(row.spent * 100 // row.limit)
                if row.spent > row.limit:
                    found.append((percent, Row("limit_over", f"Лимит «{row.name}» превышен", f"{percent} % лимита",
                                               "/budget/limits", row.spent - row.limit, block.currency)))
                elif percent >= LIMIT_NEAR_PERCENT:
                    found.append((percent, Row("limit_near", f"Лимит «{row.name}» {percent} %", "Осталось до лимита",
                                               "/budget/limits", row.limit - row.spent, block.currency)))
            walk(row.children)

    if block is not None:
        walk(block.categories)
    found.sort(key=lambda item: (-item[0], item[1].title))
    over = [row for percent, row in found if row.kind == "limit_over"]
    near = [row for percent, row in found if row.kind == "limit_near"]
    return over, near


def _income_row(payments, month, today, income_entered):
    """«Доход за октябрь не внесён»: с 1-го по 10-е, при включённом регулярном доходе и без доходов семьи в месяце."""
    templates = [row.payment for row in payments
                 if row.payment.kind == recurring_services.INCOME and row.state != recurring_services.INACTIVE]
    if not templates or today.day > INCOME_REMINDER_DAY or income_entered():
        return None
    currencies = {template.currency_id for template in templates}
    amount = sum((template.amount for template in templates), ZERO) if len(currencies) == 1 else None
    return Row("income_missing", f"Доход за {MONTHS_NOMINATIVE[month.month - 1]} не внесён",
               ", ".join(template.name for template in templates), "/receipts/new?kind=income",
               amount, currencies.pop() if amount is not None else None)


def _verdict_rows(plans):
    rows = []
    for item in sorted(plans, key=lambda item: (item.due, item.name, item.pk)):
        if not item.done and item.ai_verdict in VERDICT_TEXT:
            rows.append(Row("plan_verdict", f"{item.name}: {VERDICT_TEXT[item.ai_verdict]}", item.ai_reason, "/planned",
                            item.amount, item.currency_id))
    return rows


def _question_row(questions):
    if not questions:
        return None
    month = questions[0].month
    names = [item.payment.name for item in questions]
    meta = ", ".join(names[:QUESTION_NAMES]) + (" …" if len(names) > QUESTION_NAMES else "")
    count = len(questions)
    return Row("plans_question",
               f"За {MONTHS_NOMINATIVE[month.month - 1]} не нашёл {count} {_plural(count, 'оплату', 'оплаты', 'оплат')}",
               meta, "/recurring")


def attention(loaded, block, month, today, income_entered):
    """Все строки «Требует внимания» по порядку; клиент (и вью) показывают первые ``ATTENTION_ROWS``.

    ``block`` — блок основной валюты дашборда (``None`` — валюты нет), ``income_entered`` — функция без
    аргументов: есть ли у семьи доход в этом месяце (зовётся только когда нужна).
    """
    if month != Month.of(today):
        return []
    overdue, soon = _payment_rows(loaded.payments.payments, today)
    over, near = _limit_rows(block)
    income = _income_row(loaded.payments.payments, month, today, income_entered)
    question = _question_row(loaded.payments.questions)
    return [*overdue, *soon, *over, *([income] if income else []), *near, *_verdict_rows(loaded.plans.rows),
            *([question] if question else [])]


# --- плитки и «Деньги» ---

@dataclass(frozen=True)
class PaymentsTile:
    paid: int
    total: int
    left: Decimal  # неоплаченные в основной валюте по сегодняшнему курсу
    currency: str
    segments: list  # [bool] по сроку: оплачен ли
    next: object = None  # ближайший неоплаченный: recurring.services.PaymentMonth


def payments_tile(loaded, converter, today):
    """Платежи месяца: оплачены / всего, осталось оплатить, по одному сегменту на платёж. ``None`` — платежей нет."""
    rows = [row for row in loaded.payments.payments if row.payment.kind == recurring_services.SPEND and row.state in COUNTED]
    if not rows:
        return None
    rows.sort(key=lambda row: (row.due, row.payment.name, row.payment.pk))
    unpaid = [row for row in rows if row.state in recurring_services.UNPAID]
    with price_context():
        left = sum((value for value in (converter.convert(row.payment.amount, row.payment.currency_id, today)
                                        for row in unpaid) if value is not None), ZERO)
    upcoming = [row for row in unpaid if row.due >= today]
    nearest = min(upcoming, key=lambda row: row.due) if upcoming else (max(unpaid, key=lambda row: row.due) if unpaid else None)
    return PaymentsTile(paid=sum(1 for row in rows if row.state in SETTLED), total=len(rows), left=left,
                        currency=converter.base, segments=[row.state in SETTLED for row in rows], next=nearest)


@dataclass(frozen=True)
class GoalsTile:
    count: int
    share: int  # накоплено / сумма всех целей, в процентах (вниз)
    saved: Decimal  # в основной валюте по сегодняшнему курсу
    currency: str
    top: list  # [(название, процент)] — до двух самых полных


def goal_share(goal, progress):
    """Процент цели, как ``percent`` в ``/api/goals/``."""
    return int(progress.saved * 100 // goal.amount) if progress.saved > 0 else 0


def goals_tile(loaded, converter, today):
    """Цели: сколько, общая доля, накоплено в основной валюте, две самые полные. ``None`` — целей нет."""
    if not loaded.goals:
        return None
    saved = amount = ZERO
    shares = []
    with price_context():
        for goal in loaded.goals:
            progress = loaded.progress[goal.pk]
            shares.append((goal.name, goal_share(goal, progress)))
            value, total = (converter.convert(progress.saved, goal.currency_id, today),
                            converter.convert(goal.amount, goal.currency_id, today))
            if value is not None and total is not None:
                saved, amount = saved + value, amount + total
        share = int(saved * 100 // amount) if amount > 0 and saved > 0 else 0
    shares.sort(key=lambda item: (-item[1], item[0]))
    return GoalsTile(count=len(loaded.goals), share=share, saved=saved, currency=converter.base, top=shares[:GOALS_TOP])


def plans_summary(loaded):
    """Для плитки «Деньги»: осталось по открытым планам месяца, сколько их, сколько без срока; ``None`` — планов нет."""
    view = loaded.plans
    if not view.rows and not view.undated:
        return None
    return {"left": view.base["left"], "count": view.base["count"] - view.base["done_count"],
            "undated_count": len(view.undated)}
