"""Ограничения БД у плана: ровно один владелец, сумма больше нуля, одна трата — один план."""
from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase, tag

from accounts.models import Household
from catalog.models import Category
from planned.models import PlannedSpend
from receipts import manual
from receipts.ownership import local_user

D = Decimal


@tag("integration")
class ConstraintTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = local_user()
        cls.family = Household.objects.create(name="Демо-семья")

    def plan(self, **fields):
        values = {"user": self.owner, "name": "Куртка", "currency_id": "KZT", "amount": D("50000"), **fields}
        with transaction.atomic():
            return PlannedSpend.objects.create(**values)

    def test_exactly_one_owner(self):
        with self.assertRaises(IntegrityError):
            self.plan(user=None, household=None)
        with self.assertRaises(IntegrityError):
            self.plan(household=self.family)
        self.assertEqual(self.plan(user=None, household=self.family).household, self.family)

    def test_amount_is_positive(self):
        with self.assertRaises(IntegrityError):
            self.plan(amount=D("0"))
        with self.assertRaises(IntegrityError):
            self.plan(amount=D("-1"))

    def test_one_receipt_closes_one_plan(self):
        category = Category.objects.create(name="Демо-одежда")
        receipt = manual.create(self.owner, {"total": "48000", "currency": "KZT", "category": category.pk,
                                             "purchased_on": "2026-10-10"})
        self.plan(receipt=receipt, due=date(2026, 10, 20))
        with self.assertRaises(IntegrityError):
            self.plan(name="Второй", receipt=receipt)

    def test_defaults(self):
        plan = self.plan()
        self.assertEqual((plan.due, plan.due_exact, plan.note, plan.receipt, plan.goal, plan.ai_verdict, plan.ai_reason,
                          plan.ai_at), (None, True, "", None, None, "", "", None))
