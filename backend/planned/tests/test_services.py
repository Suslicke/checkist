"""``planned.services``: месяц в основной валюте, открытые планы для «можно тратить в день», привязка траты,
депозит из совета, действия чата.

Сегодня в тестах — 13 октября 2026. Данные вымышленные; модель не вызывается.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase, tag

from api.tests.accounts_helpers import make_user
from budget import allowance
from budget.dashboard import Month
from catalog.models import Category
from goals.models import Contribution, Goal
from planned import services
from planned.access import as_request
from planned.models import PlannedSpend
from rates.models import Rate
from receipts import manual
from receipts.ownership import local_user

D = Decimal
TODAY = date(2026, 10, 13)
OCTOBER = Month(2026, 10)


def spend(owner, category, total, on, currency="KZT", **body):
    return manual.create(owner, {"total": str(total), "currency": currency, "category": category.pk,
                                 "purchased_on": on.isoformat(), **body})


@tag("integration")
class Fixture(TestCase):
    """Куртка (закрыта тратой), хостинг в долларах, план без курса, подарок без срока, ноябрьский план «в месяце»."""

    @classmethod
    def setUpTestData(cls):
        cls.owner = local_user()
        cls.request = as_request(cls.owner)
        cls.clothes = Category.objects.create(name="Демо-одежда")
        cls.subs = Category.objects.create(name="Демо-подписки")
        Rate.objects.create(currency="USD", day=TODAY, value=D("500"))
        cls.jacket_spend = spend(cls.owner, cls.clothes, 48000, date(2026, 10, 10), store_name="Демо-склад")
        cls.jacket = cls.plan("Куртка", "50000", due=date(2026, 10, 20), category=cls.clothes, receipt=cls.jacket_spend)
        cls.hosting = cls.plan("Хостинг", "20", currency="USD", due=date(2026, 10, 25), category=cls.subs)
        cls.no_rate = cls.plan("Без курса", "10", currency="EUR", due=date(2026, 10, 5))
        cls.gift = cls.plan("Подарок", "30000")
        cls.november = cls.plan("Ноябрь", "15000", due=date(2026, 11, 1), due_exact=False)

    @classmethod
    def plan(cls, name, amount, *, owner=None, currency="KZT", **fields):
        return PlannedSpend.objects.create(user=owner or cls.owner, name=name, amount=D(amount), currency_id=currency,
                                           created_by=owner or cls.owner, **fields)


class MonthViewTests(Fixture):
    def test_rows_undated_and_base_in_the_base_currency(self):
        view = services.month_view(self.request, OCTOBER, TODAY)
        self.assertEqual([plan.pk for plan in view.rows], [self.no_rate.pk, self.jacket.pk, self.hosting.pk])
        self.assertEqual([plan.pk for plan in view.undated], [self.gift.pk])
        # Куртка 50 000 ₸ (закрыта тратой 48 000), хостинг 20 $ × 500 = 10 000 ₸ открыт, EUR без курса — excluded.
        self.assertEqual(view.base, {
            "currency": "KZT", "expected": D("60000.00"), "done": D("48000.00"), "left": D("10000.00"), "excluded": 1,
            "count": 3, "done_count": 1,
            "segments": [{"id": self.jacket.pk, "name": "Куртка", "category_id": self.clothes.pk, "amount": D("50000.00"),
                          "done": True},
                         {"id": self.hosting.pk, "name": "Хостинг", "category_id": self.subs.pk, "amount": D("10000.00"),
                          "done": False}],
        })
        # Месяцы с планами от текущего вперёд.
        self.assertEqual([(item["month"], item["expected"], item["count"], item["done_count"]) for item in view.months],
                         [(OCTOBER, D("60000.00"), 3, 1), (Month(2026, 11), D("15000.00"), 1, 0)])
        self.assertEqual([segment["id"] for segment in view.months[1]["segments"]], [self.november.pk])

    def test_a_past_month_takes_the_rate_of_its_last_day(self):
        Rate.objects.create(currency="USD", day=date(2026, 9, 30), value=D("480"))
        self.plan("Сентябрь", "10", currency="USD", due=date(2026, 9, 3))
        view = services.month_view(self.request, Month(2026, 9), TODAY)
        self.assertEqual((view.base["expected"], view.base["left"]), (D("4800.00"), D("4800.00")))
        self.assertEqual([item["month"] for item in view.months], [OCTOBER, Month(2026, 11)])

    def test_empty_month(self):
        view = services.month_view(self.request, Month(2027, 3), TODAY)
        self.assertEqual((view.rows, view.base["count"], view.base["expected"]), ([], 0, D("0.00")))

    def test_open_total_skips_closed_undated_and_unrated(self):
        self.assertEqual(services.open_total(self.owner, OCTOBER, TODAY), (D("10000.00"), 1))
        self.assertEqual(services.open_total(self.owner, Month(2026, 12), TODAY), (D("0.00"), 0))

    def test_allowance_sets_open_plans_aside(self):
        value = allowance.daily(self.owner, OCTOBER, income=D("200000"), today=TODAY)
        self.assertEqual((value.planned, value.planned_count), (D("10000.00"), 1))
        # (200 000 − 48 000 − 0 − 10 000) / 19
        self.assertEqual(value.per_day, D("7473.68"))

    def test_dashboard_card(self):
        card = services.dashboard_card(self.request, OCTOBER, TODAY)
        self.assertEqual({key: card[key] for key in ("currency", "expected", "left", "count", "done_count")},
                         {"currency": "KZT", "expected": D("60000.00"), "left": D("10000.00"), "count": 3, "done_count": 1})
        # Строки — открытые планы в своей валюте, план без курса тоже (сумму видно, в итоги не входит).
        self.assertEqual(card["rows"], [
            {"id": self.no_rate.pk, "name": "Без курса", "amount": D("10.00"), "currency": "EUR", "category_id": None},
            {"id": self.hosting.pk, "name": "Хостинг", "amount": D("20.00"), "currency": "USD", "category_id": self.subs.pk}])
        self.assertEqual([segment["id"] for segment in card["segments"]], [self.jacket.pk, self.hosting.pk])
        self.assertIsNone(services.dashboard_card(self.request, Month(2027, 3), TODAY))

    def test_dashboard_rows_are_at_most_three_open_plans(self):
        for day in (26, 27, 28, 29):
            self.plan(f"План {day}", "1000", due=date(2026, 10, day))
        card = services.dashboard_card(self.request, OCTOBER, TODAY)
        self.assertEqual([row["name"] for row in card["rows"]], ["Без курса", "Хостинг", "План 26"])


class LinkTests(Fixture):
    def test_link_unlink_and_taken(self):
        other = spend(self.owner, self.subs, 9000, date(2026, 10, 12))
        services.link(self.hosting, other)
        self.assertEqual(PlannedSpend.objects.get(pk=self.hosting.pk).receipt_id, other.pk)
        with self.assertRaises(services.ReceiptTaken):
            services.link(self.gift, other)
        services.link(self.hosting, other)  # повтор — то же состояние
        services.unlink(self.hosting)
        self.assertIsNone(PlannedSpend.objects.get(pk=self.hosting.pk).receipt_id)
        services.link(self.gift, other)
        self.assertEqual(PlannedSpend.objects.get(pk=self.gift.pk).receipt_id, other.pk)

    def test_saved_on_the_goal_in_the_plan_currency(self):
        goal = Goal.objects.create(user=self.owner, name="Куртка", amount=D("50000"), currency_id="KZT")
        Contribution.objects.create(goal=goal, amount=D("20000"), currency_id="KZT", date=date(2026, 10, 1), user=self.owner)
        Contribution.objects.create(goal=goal, amount=D("10"), currency_id="USD", date=TODAY, user=self.owner)
        services.set_goal(self.jacket, goal)
        self.assertEqual(services.saved(self.jacket, TODAY), D("25000.00"))
        # План в долларах, цель в тенге: 25 000 ₸ / 500 = 50 $.
        services.set_goal(self.hosting, goal)
        self.assertEqual(services.saved(self.hosting, TODAY), D("50.00"))
        self.assertIsNone(services.saved(self.gift, TODAY))


class DepositTests(Fixture):
    def test_creates_a_deposit_goal_for_the_missing_sum_and_links_it(self):
        due = date(2027, 4, 13)
        plan = self.plan("Отпуск", "600000", due=due)
        goal = services.deposit(self.request, plan, "lump_fixed", TODAY)
        self.assertEqual((goal.kind, goal.rate, goal.deadline, goal.amount, goal.currency_id, goal.name, goal.user),
                         ("deposit", D("17"), due, D("600000.00"), "KZT", "Отпуск", self.owner))
        self.assertEqual(PlannedSpend.objects.get(pk=plan.pk).goal_id, goal.pk)
        later = self.plan("Машина", "3000000", due=date(2028, 4, 13))
        self.assertEqual(services.deposit(self.request, later, "invest", TODAY).rate, D("10"))

    def test_unavailable_option_is_refused(self):
        with self.assertRaises(ValueError):
            services.deposit(self.request, self.gift, "lump_fixed", TODAY)  # без срока
        with self.assertRaises(ValueError):
            services.deposit(self.request, self.hosting, "nonsense", TODAY)


class ActionTests(Fixture):
    def test_move_delete_change_and_create(self):
        text = services.apply_action(self.request, {"kind": "move_plan", "plan_id": self.hosting.pk, "due": "2026-11-01",
                                                    "due_exact": False}, TODAY)
        self.assertIn("Хостинг", text)
        self.assertEqual((PlannedSpend.objects.get(pk=self.hosting.pk).due, PlannedSpend.objects.get(pk=self.hosting.pk).due_exact),
                         (date(2026, 11, 1), False))
        services.apply_action(self.request, {"kind": "change_amount", "plan_id": self.gift.pk, "amount": "25000"}, TODAY)
        self.assertEqual(PlannedSpend.objects.get(pk=self.gift.pk).amount, D("25000"))
        services.apply_action(self.request, {"kind": "create_plan", "name": "Шины", "amount": 120000, "due": "2026-11-15",
                                             "category_id": self.subs.pk}, TODAY)
        created = PlannedSpend.objects.get(name="Шины")
        self.assertEqual((created.amount, created.currency_id, created.due, created.due_exact, created.category_id,
                          created.user, created.created_by), (D("120000"), "KZT", date(2026, 11, 15), True, self.subs.pk,
                                                               self.owner, self.owner))
        services.apply_action(self.request, {"kind": "delete_plan", "plan_id": self.gift.pk}, TODAY)
        self.assertFalse(PlannedSpend.objects.filter(pk=self.gift.pk).exists())

    def test_foreign_or_missing_plan_and_bad_values_are_value_errors(self):
        stranger = make_user("synthetic-user-nine")
        foreign = self.plan("Чужой", "1", owner=stranger)
        for action in ({"kind": "delete_plan", "plan_id": foreign.pk}, {"kind": "delete_plan", "plan_id": 999999999},
                       {"kind": "change_amount", "plan_id": self.gift.pk, "amount": "0"},
                       {"kind": "move_plan", "plan_id": self.gift.pk, "due": "вчера"},
                       {"kind": "create_plan", "name": "", "amount": "1"},
                       {"kind": "create_plan", "name": "Шины", "amount": "1", "category_id": 999999999},
                       {"kind": "explode"}):
            with self.subTest(action=action), self.assertRaises(ValueError):
                services.apply_action(self.request, action, TODAY)
        self.assertTrue(PlannedSpend.objects.filter(pk=foreign.pk).exists())
