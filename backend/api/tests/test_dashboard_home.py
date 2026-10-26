"""Главная после переработки (2026-10-26): ``by_day``, ``average_day``, «Требует внимания», плитки и ``GET /api/money/``.

Сегодня в тестах — 13 октября 2026 (в тесте порядка строк внимания — 8 октября). Данные вымышленные; модель
распознавания не вызывается.
"""
from datetime import date, datetime
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

from django.db import connection
from django.test import TestCase, tag
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Household, Membership
from api.tests.accounts_helpers import TwoUsers, accounts_mode, local_single_mode, make_user
from budget import history
from budget.models import BudgetLimit
from catalog.models import Category
from goals.models import Contribution, Goal
from incomes.models import Income, IncomeCategory
from insights.models import InsightRequest
from planned.models import PlannedSpend
from rates.models import Rate
from receipts import manual
from receipts.ownership import local_user
from recurring.models import RecurringDecision, RecurringPayment

D = Decimal
DASHBOARD = "/api/dashboard/"
MONEY = "/api/money/"
TODAY = date(2026, 10, 13)
LONG_AGO = datetime(2026, 1, 1, 12, tzinfo=ZoneInfo("Asia/Almaty"))
THIS_MONTH = datetime(2026, 10, 1, 12, tzinfo=ZoneInfo("Asia/Almaty"))  # заведён в октябре: вопросов о сентябре нет
ROW_KEYS = {"kind", "title", "meta", "href", "amount", "currency"}


def spend(owner, category, total, on, currency="KZT", **body):
    return manual.create(owner, {"total": str(total), "currency": currency, "category": category.pk,
                                 "purchased_on": on.isoformat(), **body})


def today(day=TODAY):
    return mock.patch("django.utils.timezone.localdate", return_value=day)


def built_in(name):
    return IncomeCategory.objects.get_or_create(name=name, household=None, user=None)[0]


def payment(owner, name, category, amount, due_day, since=THIS_MONTH, **fields):
    row = RecurringPayment.objects.create(name=name, category=category, currency_id="KZT", amount=D(amount),
                                          due_day=due_day, **{"user": owner, **fields})
    RecurringPayment.objects.filter(pk=row.pk).update(created_at=since)
    return row


def salary_template(owner, **fields):
    # Регулярный доход видят автор и главный: ``created_by`` обязателен.
    row = RecurringPayment.objects.create(kind="income", name="Зарплата", currency_id="KZT", amount=D("650000"),
                                          due_day=10, income_category=built_in("Зарплата"), created_by=owner,
                                          **{"user": owner, **fields})
    RecurringPayment.objects.filter(pk=row.pk).update(created_at=THIS_MONTH)
    return row


def plan(owner, name, amount, due, **fields):
    return PlannedSpend.objects.create(name=name, amount=D(amount), currency_id="KZT", due=due, **{"user": owner, **fields})


def goal(owner, name, amount, saved, on=date(2026, 9, 1), **fields):
    row = Goal.objects.create(name=name, amount=D(amount), currency_id="KZT", **{"user": owner, **fields})
    if saved:
        Contribution.objects.create(goal=row, amount=D(saved), currency_id="KZT", date=on)
    return row


class Fixture:
    """Октябрь: еда 2-го и 13-го, дом 5-го; сентябрь и июль — для прошлых месяцев и ряда «Статистики»."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        owner = cls.spender()
        cls.food = Category.objects.create(name="Демо-еда")
        cls.home = Category.objects.create(name="Демо-дом")
        cls.rent = Category.objects.create(name="Демо-аренда", parent=cls.home)
        cls.subs = Category.objects.create(name="Демо-подписки")
        spend(owner, cls.food, 30000, date(2026, 10, 2), store_name="Демо-магазин")
        spend(owner, cls.home, 70000, date(2026, 10, 5), note="Коммуналка")
        spend(owner, cls.food, 12000, date(2026, 10, 13))
        spend(owner, cls.food, 50000, date(2026, 9, 20))
        spend(owner, cls.food, 1000, date(2026, 7, 10))

    @classmethod
    def spender(cls):
        return local_user()


@tag("integration")
@local_single_mode()
class PulseTests(Fixture, TestCase):
    def get(self, query="", day=TODAY):
        with today(day):
            response = APIClient().get(DASHBOARD + query)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_by_day_covers_every_day_and_sums_to_spent(self):
        body = self.get()
        self.assertEqual(len(body["by_day"]), 31)
        self.assertEqual([row["day"] for row in body["by_day"]][:3], ["2026-10-01", "2026-10-02", "2026-10-03"])
        self.assertEqual(body["by_day"][-1]["day"], "2026-10-31")
        by_day = {row["day"]: row["spent"] for row in body["by_day"]}
        self.assertEqual((by_day["2026-10-01"], by_day["2026-10-02"], by_day["2026-10-05"], by_day["2026-10-13"]),
                         ("0.00", "30000.00", "70000.00", "12000.00"))
        self.assertEqual(sum(D(row["spent"]) for row in body["by_day"]), D(body["base"]["spent"]))
        self.assertEqual(body["base"]["spent"], "112000.00")

    def test_by_day_is_in_the_base_currency_and_skips_spends_without_a_rate(self):
        Rate.objects.create(currency="USD", day=date(2026, 10, 3), value=D("500"))
        spend(local_user(), self.food, 10, date(2026, 10, 3), currency="USD")
        spend(local_user(), self.food, 7, date(2026, 10, 20), currency="EUR")  # курса нет
        body = self.get()
        by_day = {row["day"]: row["spent"] for row in body["by_day"]}
        self.assertEqual((by_day["2026-10-03"], by_day["2026-10-20"]), ("5000.00", "0.00"))
        self.assertEqual(body["excluded"], [{"currency": "EUR", "receipts_count": 1, "total": "7.00"}])

    def test_average_day_of_the_current_month_divides_by_elapsed_days(self):
        self.assertEqual(self.get()["average_day"], "8615.38")  # 112 000 / 13 дней, включая сегодня
        self.assertEqual(self.get(day=date(2026, 10, 2))["average_day"], "56000.00")  # 112 000 / 2

    def test_average_day_of_a_past_month_divides_by_its_days(self):
        self.assertEqual(self.get("?month=2026-09")["average_day"], "1666.67")  # 50 000 / 30

    def test_average_day_is_null_without_spends(self):
        self.assertIsNone(self.get("?month=2026-08")["average_day"])
        self.assertIsNone(self.get("?month=2026-11")["average_day"])

    def test_old_fields_stay(self):
        body = self.get()
        for key in ("month", "previous_month", "days_left", "members", "people", "currencies", "base_currency", "base",
                    "excluded", "recent", "budget", "allowance", "planned"):
            self.assertIn(key, body)
        self.assertIsNone(body["planned"])
        self.assertEqual(body["base"]["spent"], "112000.00")


@tag("integration")
@local_single_mode()
class AttentionTests(Fixture, TestCase):
    """8 октября: аренда просрочена на 3 дня, интернет через 2 дня, лимит дома превышен, доход не внесён,
    лимит еды 84 %, план с вердиктом «подождать», три платежа сентября не найдены."""

    DAY = date(2026, 10, 8)

    def get(self, query="", day=None):
        with today(day or self.DAY):
            response = APIClient().get(DASHBOARD + query)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def rows(self, query="", day=None):
        body = self.get(query, day)
        return body["attention"], body["attention_more"]

    def all_kinds(self):
        owner = local_user()
        self.rent_payment = payment(owner, "Аренда", self.rent, "70000", 5, since=LONG_AGO)
        self.net = payment(owner, "Интернет", self.subs, "6700", 10, since=LONG_AGO)
        payment(owner, "Подписка", self.subs, "2000", 25, since=LONG_AGO)
        self.home_limit = BudgetLimit.objects.create(user=owner, category=self.home, currency_id="KZT", amount=D("60000"))
        salary_template(owner)
        self.food_limit = BudgetLimit.objects.create(user=owner, category=self.food, currency_id="KZT", amount=D("50000"))
        plan(owner, "Куртка", "48000", date(2026, 10, 20), ai_verdict="wait", ai_reason="Лимит одежды уже выбран")

    def test_order_three_rows_and_the_rest_counted(self):
        self.all_kinds()
        rows, more = self.rows()
        self.assertEqual([row["kind"] for row in rows], ["payment_overdue", "payment_due", "limit_over"])
        self.assertEqual(more, 4)
        self.assertEqual(rows[0], {
            "kind": "payment_overdue", "title": "Аренда: просрочено на 3 дня", "meta": "Срок был 5 октября",
            "href": "/recurring", "amount": "70000.00", "currency": "KZT"})
        self.assertEqual(rows[1], {
            "kind": "payment_due", "title": "Интернет через 2 дня", "meta": "Срок 10 октября",
            "href": "/recurring", "amount": "6700.00", "currency": "KZT"})
        self.assertEqual(rows[2], {
            "kind": "limit_over", "title": "Лимит «Демо-дом» превышен", "meta": "116 % лимита",
            "href": "/budget/limits", "amount": "10000.00", "currency": "KZT"})
        # Платежи отвечены, лимит дома поднят — следующие три.
        for row in (self.rent_payment, self.net):
            RecurringDecision.objects.create(payment=row, month=date(2026, 10, 1), decision="skipped")
        BudgetLimit.objects.filter(pk=self.home_limit.pk).update(amount=D("100000"))
        rows, more = self.rows()
        self.assertEqual([row["kind"] for row in rows], ["income_missing", "limit_near", "plan_verdict"])
        self.assertEqual(more, 1)
        self.assertEqual(rows[0], {
            "kind": "income_missing", "title": "Доход за октябрь не внесён", "meta": "Зарплата",
            "href": "/receipts/new?kind=income", "amount": "650000.00", "currency": "KZT"})
        self.assertEqual(rows[1], {
            "kind": "limit_near", "title": "Лимит «Демо-еда» 84 %", "meta": "Осталось до лимита",
            "href": "/budget/limits", "amount": "8000.00", "currency": "KZT"})
        self.assertEqual(rows[2], {
            "kind": "plan_verdict", "title": "Куртка: лучше подождать", "meta": "Лимит одежды уже выбран",
            "href": "/planned", "amount": "48000.00", "currency": "KZT"})
        # Доход внесён, лимит еды поднят — остались вердикт и вопрос о сентябре.
        Income.objects.create(owner=local_user(), received_on=date(2026, 10, 5), amount=D("650000"), currency_id="KZT",
                              category=built_in("Зарплата"))
        BudgetLimit.objects.filter(pk=self.food_limit.pk).update(amount=D("100000"))
        rows, more = self.rows()
        self.assertEqual([row["kind"] for row in rows], ["plan_verdict", "plans_question"])
        self.assertEqual(more, 0)
        self.assertEqual(rows[1], {
            "kind": "plans_question", "title": "За сентябрь не нашёл 3 оплаты", "meta": "Аренда, Интернет, Подписка",
            "href": "/recurring", "amount": None, "currency": None})
        self.assertTrue(all(set(row) == ROW_KEYS for row in rows))

    def test_nothing_to_attend(self):
        self.assertEqual(self.rows(), ([], 0))

    def test_payment_due_only_within_two_days(self):
        row = payment(local_user(), "Интернет", self.subs, "6700", 11)
        self.assertEqual(self.rows(), ([], 0))  # через 3 дня — рано
        RecurringPayment.objects.filter(pk=row.pk).update(due_day=9)
        self.assertEqual(self.rows()[0][0]["title"], "Интернет завтра")
        RecurringPayment.objects.filter(pk=row.pk).update(due_day=8)
        self.assertEqual(self.rows()[0][0]["title"], "Интернет сегодня")
        spend(local_user(), self.subs, 6700, date(2026, 10, 7))  # оплачен — строки нет
        self.assertEqual(self.rows(), ([], 0))

    def test_overdue_counts_days_and_an_inactive_payment_is_silent(self):
        row = payment(local_user(), "Аренда", self.rent, "70000", 1)
        self.assertEqual(self.rows()[0][0]["title"], "Аренда: просрочено на 7 дней")
        RecurringPayment.objects.filter(pk=row.pk).update(active=False)
        self.assertEqual(self.rows(), ([], 0))

    def test_income_missing_needs_a_regular_income_and_the_first_decade(self):
        self.assertEqual(self.rows(), ([], 0))  # регулярного дохода нет — не спрашиваем
        salary_template(local_user())
        self.assertEqual(self.rows()[0][0]["kind"], "income_missing")
        self.assertEqual(self.rows(day=date(2026, 10, 10))[0][0]["kind"], "income_missing")
        self.assertEqual(self.rows(day=date(2026, 10, 11)), ([], 0))  # после 10-го не напоминаем
        Income.objects.create(owner=local_user(), received_on=date(2026, 10, 3), amount=D("1"), currency_id="KZT",
                              category=built_in("Подработка"))  # любой доход месяца
        self.assertEqual(self.rows(), ([], 0))

    def test_limit_rows_at_eighty_and_over_hundred_percent(self):
        limit = BudgetLimit.objects.create(user=local_user(), category=self.food, currency_id="KZT", amount=D("53000"))
        self.assertEqual(self.rows(), ([], 0))  # 79 %
        BudgetLimit.objects.filter(pk=limit.pk).update(amount=D("52500"))
        self.assertEqual(self.rows()[0][0]["title"], "Лимит «Демо-еда» 80 %")
        BudgetLimit.objects.filter(pk=limit.pk).update(amount=D("42000"))
        self.assertEqual(self.rows()[0][0]["kind"], "limit_near")  # ровно 100 % — ещё не превышен
        BudgetLimit.objects.filter(pk=limit.pk).update(amount=D("41999.99"))
        self.assertEqual(self.rows()[0][0]["kind"], "limit_over")

    def test_sub_limit_is_watched_too(self):
        BudgetLimit.objects.create(user=local_user(), category=self.rent, currency_id="KZT", amount=D("10000"))
        spend(local_user(), self.rent, 9000, date(2026, 10, 6))
        self.assertEqual(self.rows()[0][0]["title"], "Лимит «Демо-аренда» 90 %")

    def test_plan_verdict_only_open_plans_of_the_month_with_wait_or_drop(self):
        owner = local_user()
        plan(owner, "Куртка", "48000", date(2026, 10, 20), ai_verdict="keep", ai_reason="Можно")
        plan(owner, "Подарок", "5000", None, ai_verdict="drop", ai_reason="Без срока")
        plan(owner, "Шины", "90000", date(2026, 11, 3), ai_verdict="wait", ai_reason="Ноябрь")
        self.assertEqual(self.rows(), ([], 0))
        dropped = plan(owner, "Куртка-2", "48000", date(2026, 10, 25), ai_verdict="drop", ai_reason="Дорого")
        self.assertEqual(self.rows()[0][0]["title"], "Куртка-2: лучше отказаться")
        dropped.receipt = spend(owner, self.food, 48000, date(2026, 10, 7))
        dropped.save()
        self.assertEqual(self.rows(), ([], 0))  # закрытый план не беспокоит

    def test_questions_about_the_previous_month(self):
        payment(local_user(), "Подписка", self.subs, "2000", 25, since=LONG_AGO)
        rows, more = self.rows()
        self.assertEqual(rows, [{"kind": "plans_question", "title": "За сентябрь не нашёл 1 оплату", "meta": "Подписка",
                                 "href": "/recurring", "amount": None, "currency": None}])

    def test_attention_is_only_about_the_current_month(self):
        self.all_kinds()
        self.assertEqual(self.rows("?month=2026-09"), ([], 0))
        self.assertEqual(self.rows("?month=2026-11"), ([], 0))


@tag("integration")
@local_single_mode()
class TilesTests(Fixture, TestCase):
    def get(self, query="", day=TODAY):
        with today(day):
            response = APIClient().get(DASHBOARD + query)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["tiles"]

    def test_empty_tiles(self):
        self.assertEqual(self.get(), {"payments": None, "plans": None, "goals": None})

    def test_payments_tile(self):
        owner = local_user()
        rent = payment(owner, "Аренда", self.rent, "70000", 5)
        net = payment(owner, "Интернет", self.subs, "6700", 15)
        skipped = payment(owner, "Подписка", self.subs, "2000", 25)
        payment(owner, "Старое", self.subs, "1", 1, active=False)
        salary_template(owner)  # доход — не платёж
        spend(owner, self.subs, 6700, date(2026, 10, 14))
        self.assertEqual(self.get()["payments"], {
            "paid": 1, "total": 3, "left": "72000.00", "currency": "KZT",
            "segments": [{"paid": False}, {"paid": True}, {"paid": False}]})
        RecurringDecision.objects.create(payment=rent, month=date(2026, 10, 1), decision="elsewhere")
        RecurringDecision.objects.create(payment=skipped, month=date(2026, 10, 1), decision="skipped")
        self.assertEqual(self.get()["payments"], {
            "paid": 2, "total": 2, "left": "0.00", "currency": "KZT", "segments": [{"paid": True}, {"paid": True}]})

    def test_payments_left_in_the_base_currency(self):
        Rate.objects.create(currency="USD", day=TODAY, value=D("500"))
        RecurringPayment.objects.create(user=local_user(), name="Демо-подписка", category=self.subs, currency_id="USD",
                                        amount=D("10"), due_day=20)
        RecurringPayment.objects.create(user=local_user(), name="Демо-журнал", category=self.subs, currency_id="EUR",
                                        amount=D("3"), due_day=21)  # курса нет — в сумму не входит
        self.assertEqual(self.get()["payments"]["left"], "5000.00")

    def test_plans_tile_is_the_planned_card(self):
        plan(local_user(), "Куртка", "48000", date(2026, 10, 20))
        tiles = self.get()
        self.assertEqual((tiles["plans"]["left"], tiles["plans"]["count"], tiles["plans"]["rows"][0]["name"]),
                         ("48000.00", 1, "Куртка"))

    def test_goals_tile(self):
        owner = local_user()
        goal(owner, "Отпуск", "300000", "90000")
        goal(owner, "Ноутбук", "100000", "50000")
        goal(owner, "Пустая", "10000", None)
        self.assertEqual(self.get()["goals"], {
            "count": 3, "share": 34, "saved": "140000.00", "currency": "KZT",  # 140 000 / 410 000
            "top": [{"name": "Ноутбук", "share": 50}, {"name": "Отпуск", "share": 30}]})


@tag("integration")
@local_single_mode()
class MoneyTests(Fixture, TestCase):
    def get(self, query="", day=TODAY):
        with today(day):
            response = APIClient().get(MONEY + query)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_month_with_income(self):
        owner = local_user()
        Income.objects.create(owner=owner, received_on=date(2026, 10, 5), amount=D("650000"), currency_id="KZT",
                              category=built_in("Зарплата"))
        payment(owner, "Аренда", self.rent, "70000", 5)
        payment(owner, "Интернет", self.subs, "6700", 15)
        plan(owner, "Куртка", "48000", date(2026, 10, 20))
        plan(owner, "Подарок", "5000", None)
        goal(owner, "Отпуск", "300000", "90000", on=date(2026, 9, 1))
        Contribution.objects.create(goal=Goal.objects.get(name="Отпуск"), amount=D("20000"), currency_id="KZT",
                                    date=date(2026, 10, 3))
        self.assertEqual(self.get(), {
            "month": "2026-10", "currency": "KZT", "income": "650000.00", "spent": "112000.00", "set_aside": "20000.00",
            "flow": {"spent": "112000.00", "payments_ahead": "76700.00", "plans_ahead": "48000.00", "free": "413300.00"},
            "payments": {"paid": 0, "total": 2, "left": "76700.00",
                         "next": {"name": "Интернет", "due_date": "2026-10-15", "days": 2}},
            "plans": {"left": "48000.00", "count": 1, "undated_count": 1},
            "goals": {"count": 1, "share": 36, "saved": "110000.00", "currency": "KZT",
                      "top": [{"name": "Отпуск", "share": 36}]},
            "months": [{"month": "2026-05", "spent": "0.00"}, {"month": "2026-06", "spent": "0.00"},
                       {"month": "2026-07", "spent": "1000.00"}, {"month": "2026-08", "spent": "0.00"},
                       {"month": "2026-09", "spent": "50000.00"}, {"month": "2026-10", "spent": "112000.00"}],
            "review": None,
        })

    def test_budget_only(self):
        with today():
            history.set_budget({"household": None, "user": local_user()}, "KZT", D("500000"))
        body = self.get()
        self.assertEqual((body["income"], body["flow"]["free"]), (None, "388000.00"))

    def test_nothing(self):
        body = self.get()
        self.assertEqual((body["income"], body["set_aside"], body["flow"]["free"]), (None, "0.00", None))
        self.assertEqual(body["payments"], {"paid": 0, "total": 0, "left": "0.00", "next": None})
        self.assertEqual((body["plans"], body["goals"], body["review"]), (None, None, None))
        self.assertEqual(body["flow"], {"spent": "112000.00", "payments_ahead": "0.00", "plans_ahead": "0.00", "free": None})

    def test_next_payment_when_only_overdue(self):
        payment(local_user(), "Аренда", self.rent, "70000", 5)
        self.assertEqual(self.get()["payments"]["next"], {"name": "Аренда", "due_date": "2026-10-05", "days": -8})

    def test_months_of_a_past_month_end_with_it(self):
        body = self.get("?month=2026-09")
        self.assertEqual([row["month"] for row in body["months"]], ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
                                                                   "2026-09"])
        self.assertEqual((body["spent"], body["months"][-1]["spent"]), ("50000.00", "50000.00"))

    def test_review_tile_is_the_last_succeeded_review_of_the_previous_month(self):
        owner = local_user()

        def review(month, status, **fields):
            return InsightRequest.objects.create(owner=owner, kind="review", month=month, status=status,
                                                 context={"focus": {"change_previous": "-12000.00"}}, **fields)

        review(date(2026, 9, 1), "succeeded", answer={"summary": "ок", "changes": None, "limits": None,
                                                       "advice": ["меньше кофе", "отложить"]})
        review(date(2026, 9, 1), "failed", error_code="timeout")  # позже, но не удался
        review(date(2026, 8, 1), "succeeded", answer={"summary": "ок", "changes": None, "limits": None, "advice": []})
        self.assertEqual(self.get()["review"], {"month": "2026-09", "change_previous": "-12000.00", "tips": 2})
        self.assertEqual(self.get("?month=2026-09")["review"], {"month": "2026-08", "change_previous": "-12000.00",
                                                                 "tips": 0})
        self.assertIsNone(self.get("?month=2026-08")["review"])

    def test_invalid_month_and_post(self):
        self.assertEqual(APIClient().get(MONEY + "?month=2026-13").status_code, 400)
        self.assertEqual(APIClient().post(MONEY, {}, format="json").status_code, 405)

    def test_query_count_does_not_grow(self):
        owner = local_user()
        payment(owner, "Аренда", self.rent, "70000", 5)
        plan(owner, "Куртка", "48000", date(2026, 10, 20))
        goal(owner, "Отпуск", "300000", "90000")
        with today():
            with CaptureQueriesContext(connection) as before:
                APIClient().get(MONEY)
                APIClient().get(DASHBOARD)
        for day in range(1, 6):
            spend(owner, self.subs, 100, date(2026, 10, day))
            payment(owner, f"Платёж {day}", self.subs, "100", day + 10)
            plan(owner, f"План {day}", "100", date(2026, 10, day + 15))
            goal(owner, f"Цель {day}", "1000", "100")
        with today():
            with CaptureQueriesContext(connection) as after:
                APIClient().get(MONEY)
                APIClient().get(DASHBOARD)
        self.assertEqual(len(after), len(before))


@tag("integration")
@accounts_mode()
class FamilyTests(TwoUsers, TestCase):
    """Семья ``first`` и ``third``: чужой ``second`` не считается нигде — ни в пульсе, ни в плитках, ни в «Деньгах»."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.third = make_user("synthetic-user-three")
        cls.family = Household.objects.create(name="Демо-семья")
        Membership.objects.create(user=cls.first, household=cls.family, role="head")
        Membership.objects.create(user=cls.third, household=cls.family, role="member")
        cls.food = Category.objects.create(name="Демо-еда")
        spend(cls.first, cls.food, 1000, date(2026, 10, 2))
        spend(cls.third, cls.food, 200, date(2026, 10, 2))
        spend(cls.second, cls.food, 50000, date(2026, 10, 2))
        # Платежи заведены сейчас: вопросов о сентябре у них нет.
        RecurringPayment.objects.create(household=cls.family, name="Семейный", category=cls.food, currency_id="KZT",
                                        amount=D("100"), due_day=20)
        RecurringPayment.objects.create(user=cls.second, name="Чужой", category=cls.food, currency_id="KZT",
                                        amount=D("999"), due_day=20)
        plan(cls.second, "Чужой план", "999", date(2026, 10, 20), ai_verdict="drop", ai_reason="х")
        goal(cls.second, "Чужая цель", "1000", "500")
        goal(cls.first, "Семейная цель", "1000", "250", user=None, household=cls.family)
        Income.objects.create(owner=cls.second, received_on=date(2026, 10, 5), amount=D("5"), currency_id="KZT",
                              category=built_in("Зарплата"))

    def get(self, account, url):
        with today():
            response = self.client_of(account).get(url)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_dashboard_counts_the_family_only(self):
        for account in (self.first, self.third):
            body = self.get(account, DASHBOARD)
            self.assertEqual(sum(D(row["spent"]) for row in body["by_day"]), D("1200.00"))
            self.assertEqual(body["attention"], [])
            self.assertEqual(body["tiles"]["payments"]["total"], 1)
            self.assertEqual(body["tiles"]["goals"]["count"], 1)
            self.assertEqual(body["tiles"]["plans"], None)
        body = self.get(self.second, DASHBOARD)
        self.assertEqual(sum(D(row["spent"]) for row in body["by_day"]), D("50000.00"))
        self.assertEqual([row["kind"] for row in body["attention"]], ["plan_verdict"])

    def test_money_counts_the_family_only(self):
        body = self.get(self.third, MONEY)
        self.assertEqual((body["income"], body["spent"], body["payments"]["total"], body["plans"], body["goals"]["count"]),
                         (None, "1200.00", 1, None, 1))
        self.assertEqual(body["months"][-1], {"month": "2026-10", "spent": "1200.00"})
        body = self.get(self.second, MONEY)
        self.assertEqual((body["income"], body["spent"], body["goals"]["count"]), ("5.00", "50000.00", 1))
