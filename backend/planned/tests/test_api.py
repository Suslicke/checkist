"""``/api/planned/``: месяц, создание и правка плана, привязка траты, совет и депозит, семья и чужие, дашборд.

Сегодня в тестах — 13 октября 2026. Данные вымышленные; модель не вызывается.
"""
from datetime import date
from decimal import Decimal
from unittest import mock

from django.test import TestCase, tag
from rest_framework.test import APIClient

from accounts.models import Household, Membership
from api.tests.accounts_helpers import (
    NOT_AUTHENTICATED, NOT_FOUND, TwoUsers, accounts_mode, local_single_mode, make_user,
)
from catalog.models import Category
from goals.models import Contribution, Goal
from planned.models import PlannedSpend
from rates.models import Rate
from receipts import manual
from receipts.models import Receipt
from receipts.ownership import local_user

D = Decimal
URL = "/api/planned/"
TODAY = date(2026, 10, 13)
DASHBOARD = "/api/dashboard/"


def today(day=TODAY):
    return mock.patch("django.utils.timezone.localdate", return_value=day)


def spend(owner, category, total, on, currency="KZT", **body):
    return manual.create(owner, {"total": str(total), "currency": currency, "category": category.pk,
                                 "purchased_on": on.isoformat(), **body})


def fields(response):
    return response.json()["error"]["fields"]


def body(**values):
    return {"name": "Куртка", "amount": "50000", "due": "2026-10-20", **values}


@tag("integration")
@local_single_mode()
class PlannedLocalTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = local_user()
        cls.clothes = Category.objects.create(name="Демо-одежда")
        Rate.objects.create(currency="USD", day=TODAY, value=D("500"))

    def setUp(self):
        self.client = APIClient()

    def create(self, **values):
        with today():
            response = self.client.post(URL, body(**values), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def get(self, url=URL, **query):
        with today():
            response = self.client.get(url, query)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def patch(self, pk, values):
        with today():
            return self.client.patch(f"{URL}{pk}/", values, format="json")

    def test_create_returns_the_plan(self):
        plan = self.create(category_id=self.clothes.pk, note="к зиме")
        self.assertEqual(plan, {
            "id": plan["id"], "name": "Куртка", "category": {"id": self.clothes.pk, "name": "Демо-одежда", "icon": None},
            "currency": "KZT", "amount": "50000.00", "due": "2026-10-20", "due_exact": True, "note": "к зиме",
            "receipt": None, "goal": None, "ai": None, "created_by": {"username": "local", "display_name": "local"},
            "created_at": plan["created_at"],
        })
        self.assertEqual(PlannedSpend.objects.get(pk=plan["id"]).user, self.owner)

    def test_in_a_month_means_its_first_day(self):
        plan = self.create(due="2026-11-20", due_exact=False, currency="usd")
        self.assertEqual((plan["due"], plan["due_exact"], plan["currency"]), ("2026-11-01", False, "USD"))
        undated = self.create(due=None)
        self.assertEqual((undated["due"], undated["due_exact"]), (None, True))

    def test_invalid_bodies(self):
        with today():
            empty = self.client.post(URL, {}, format="json")
            bad = self.client.post(URL, body(amount="0", due="2026-13-01", due_exact="да", category_id=999999999,
                                            currency="XXX", note="x" * 301, goal_id=999999999, extra=1), format="json")
        self.assertEqual(empty.status_code, 400, empty.content)
        self.assertEqual(sorted(fields(empty)), ["amount", "name"])
        self.assertEqual(sorted(fields(bad)), ["amount", "category_id", "currency", "due", "due_exact", "extra",
                                               "goal_id", "note"])
        plan = self.create()
        self.assertEqual(fields(self.patch(plan["id"], {})), {"body": ["Укажите хотя бы одно поле."]})
        self.assertEqual(fields(self.patch(plan["id"], {"receipt_id": 999999999})), {"receipt_id": ["Трата не найдена."]})
        self.assertEqual(self.client.get(f"{URL}999999999/").json(), NOT_FOUND)

    def test_month_view(self):
        jacket = self.create()
        hosting = self.create(name="Хостинг", amount="20", currency="USD", due="2026-10-25")
        gift = self.create(name="Подарок", amount="30000", due=None)
        self.create(name="Ноябрь", amount="15000", due="2026-11-05")
        receipt = spend(self.owner, self.clothes, 48000, date(2026, 10, 10), store_name="Демо-склад")
        linked = self.patch(jacket["id"], {"receipt_id": receipt.pk}).json()
        self.assertEqual(linked["receipt"], {"id": receipt.pk, "total": "48000.00", "currency": "KZT",
                                             "purchased_on": "2026-10-10", "store_name": "Демо-склад"})
        data = self.get()
        self.assertEqual((data["month"], data["today"], data["currency"]), ("2026-10", "2026-10-13", "KZT"))
        self.assertEqual([row["id"] for row in data["rows"]], [jacket["id"], hosting["id"]])
        self.assertEqual([row["id"] for row in data["undated"]], [gift["id"]])
        self.assertEqual(data["base"], {
            "currency": "KZT", "expected": "60000.00", "done": "48000.00", "left": "10000.00", "excluded": 0, "count": 2,
            "done_count": 1,
            "segments": [{"id": jacket["id"], "name": "Куртка", "category_id": None, "amount": "50000.00", "done": True},
                         {"id": hosting["id"], "name": "Хостинг", "category_id": None, "amount": "10000.00", "done": False}],
        })
        self.assertEqual([(item["month"], item["expected"], item["count"], item["done_count"]) for item in data["months"]],
                         [("2026-10", "60000.00", 2, 1), ("2026-11", "15000.00", 1, 0)])
        self.assertEqual([row["id"] for row in self.get(month="2026-11")["rows"]], [data["months"][1]["segments"][0]["id"]])
        with today():
            self.assertEqual(self.client.get(URL, {"month": "2026-1"}).status_code, 400)

    def test_receipt_taken_unlink_and_goal(self):
        jacket, other = self.create(), self.create(name="Другой")
        receipt = spend(self.owner, self.clothes, 48000, date(2026, 10, 10))
        self.assertEqual(self.patch(jacket["id"], {"receipt_id": receipt.pk}).status_code, 200)
        taken = self.patch(other["id"], {"receipt_id": receipt.pk})
        self.assertEqual((taken.status_code, taken.json()["error"]["code"]), (409, "receipt_taken"))
        self.assertEqual(self.patch(jacket["id"], {"receipt_id": receipt.pk}).status_code, 200)  # повтор — тот же план
        self.assertIsNone(self.patch(jacket["id"], {"receipt_id": None}).json()["receipt"])
        self.assertEqual(self.patch(other["id"], {"receipt_id": receipt.pk}).status_code, 200)
        goal = Goal.objects.create(user=self.owner, name="Куртка", amount=D("50000"), currency_id="KZT")
        Contribution.objects.create(goal=goal, amount=D("20000"), currency_id="KZT", date=date(2026, 10, 1), user=self.owner)
        with_goal = self.patch(jacket["id"], {"goal_id": goal.pk}).json()
        self.assertEqual(with_goal["goal"], {"id": goal.pk, "name": "Куртка", "kind": "saving", "saved": "20000.00",
                                             "share": 40})
        self.assertIsNone(self.patch(jacket["id"], {"goal_id": None}).json()["goal"])
        with today():
            self.assertEqual(self.client.delete(f"{URL}{jacket['id']}/").status_code, 204)
        self.assertFalse(PlannedSpend.objects.filter(pk=jacket["id"]).exists())
        self.assertTrue(Receipt.objects.filter(pk=receipt.pk).exists())

    def test_advice_and_deposit(self):
        plan = self.create(name="Отпуск", amount="600000", due="2027-04-13")
        data = self.get(f"{URL}{plan['id']}/advice/")
        self.assertEqual({key: data[key] for key in ("need", "saved", "missing", "currency", "due", "months")},
                         {"need": "600000.00", "saved": "0.00", "missing": "600000.00", "currency": "KZT",
                          "due": "2027-04-13", "months": 6})
        self.assertEqual([(option["key"], option["available"], option["risk"], option["liquid"]) for option in data["options"]],
                         [("lump_fixed", True, 1, False), ("monthly_flexible", True, 1, True), ("invest", False, 3, True)])
        lump = data["options"][0]
        self.assertEqual((lump["times"], lump["rate"], lump["until"], lump["reason"]), (1, "17.00", "2027-04-13", None))
        self.assertLess(D(lump["amount"]), D("600000"))
        self.assertEqual(D(lump["gain"]), D("600000") - D(lump["amount"]))
        with today():
            refused = self.client.post(f"{URL}{plan['id']}/deposit/", {"option": "invest"}, format="json")
            created = self.client.post(f"{URL}{plan['id']}/deposit/", {"option": "lump_fixed"}, format="json")
        self.assertEqual((refused.status_code, list(fields(refused))), (400, ["option"]))
        self.assertEqual(created.status_code, 201, created.content)
        goal = Goal.objects.get(pk=created.json()["goal"]["id"])
        self.assertEqual((goal.kind, goal.rate, goal.deadline, goal.amount, goal.name), ("deposit", D("17"), date(2027, 4, 13),
                                                                                       D("600000.00"), "Отпуск"))
        self.assertEqual(created.json()["goal"]["saved"], "0.00")

    def test_dashboard_carries_the_plans_of_the_month(self):
        self.assertIsNone(self.get(DASHBOARD)["planned"])
        jacket = self.create()
        hosting = self.create(name="Хостинг", amount="20", currency="USD", due="2026-10-25")
        self.create(name="Подарок", amount="30000", due=None)
        receipt = spend(self.owner, self.clothes, 48000, date(2026, 10, 10))
        self.patch(jacket["id"], {"receipt_id": receipt.pk})
        with today():
            self.client.post("/api/budget/month/", {"amount": "500000"}, format="json")
        data = self.get(DASHBOARD)
        self.assertEqual(data["planned"], {
            "currency": "KZT", "expected": "60000.00", "left": "10000.00", "count": 2, "done_count": 1,
            "segments": [{"id": jacket["id"], "name": "Куртка", "category_id": None, "amount": "50000.00", "done": True},
                         {"id": hosting["id"], "name": "Хостинг", "category_id": None, "amount": "10000.00", "done": False}],
            "rows": [{"id": hosting["id"], "name": "Хостинг", "amount": "20.00", "currency": "USD", "category_id": None}],
        })
        # (500 000 − 48 000 − 10 000) / 19
        self.assertEqual({key: data["allowance"][key] for key in ("planned", "planned_count", "per_day")},
                         {"planned": "10000.00", "planned_count": 1, "per_day": "23263.15"})


@tag("integration")
@accounts_mode()
class PlannedFamilyTests(TwoUsers, TestCase):
    """``first`` и ``third`` — одна семья, ``second`` вне её."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.third = make_user("synthetic-user-three")
        cls.clothes = Category.objects.create(name="Демо-одежда")
        cls.family = Household.objects.create(name="Демо-семья")
        for account in (cls.first, cls.third):
            Membership.objects.create(user=account, household=cls.family)

    def create(self, account, **values):
        with today():
            response = self.client_of(account, csrf=True).post(URL, body(**values), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_anonymous_gets_401(self):
        self.assertEqual(APIClient().get(URL).json(), NOT_AUTHENTICATED)

    def test_family_shares_plans(self):
        plan = self.create(self.first)
        saved = PlannedSpend.objects.get(pk=plan["id"])
        self.assertEqual((saved.household, saved.user, saved.created_by), (self.family, None, self.first))
        with today():
            rows = self.client_of(self.third).get(URL).json()["rows"]
            patched = self.client_of(self.third, csrf=True).patch(f"{URL}{plan['id']}/", {"amount": "55000"}, format="json")
        self.assertEqual([row["id"] for row in rows], [plan["id"]])
        self.assertEqual(patched.json()["amount"], "55000.00")
        # Трата члена семьи закрывает план; чужую трату привязать нельзя.
        own = spend(self.third, self.clothes, 55000, date(2026, 10, 12))
        foreign = spend(self.second, self.clothes, 55000, date(2026, 10, 12))
        with today():
            linked = self.client_of(self.first, csrf=True).patch(f"{URL}{plan['id']}/", {"receipt_id": own.pk}, format="json")
            refused = self.client_of(self.first, csrf=True).patch(f"{URL}{plan['id']}/", {"receipt_id": foreign.pk}, format="json")
        self.assertEqual(linked.json()["receipt"]["id"], own.pk)
        self.assertEqual((refused.status_code, list(fields(refused))), (400, ["receipt_id"]))

    def test_outsider_sees_nothing_and_gets_404(self):
        plan = self.create(self.first)
        outsider = self.client_of(self.second, csrf=True)
        with today():
            self.assertEqual(self.client_of(self.second).get(URL).json()["rows"], [])
            url = f"{URL}{plan['id']}/"
            self.assertEqual(self.client_of(self.second).get(url).json(), NOT_FOUND)
            self.assertEqual(outsider.patch(url, {"amount": "1"}, format="json").json(), NOT_FOUND)
            self.assertEqual(self.client_of(self.second).get(f"{url}advice/").json(), NOT_FOUND)
            self.assertEqual(outsider.post(f"{url}deposit/", {"option": "lump_fixed"}, format="json").json(), NOT_FOUND)
            self.assertEqual(outsider.delete(url).json(), NOT_FOUND)
        self.assertTrue(PlannedSpend.objects.filter(pk=plan["id"], amount=D("50000")).exists())
        own = self.create(self.second)
        self.assertEqual(PlannedSpend.objects.get(pk=own["id"]).user, self.second)
