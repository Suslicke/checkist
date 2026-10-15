"""Категория магазина: неразобранные позиции чеков гипермаркета считаются в его категории (receipts.store_category)."""
from django.test import TestCase, override_settings, tag
from rest_framework.test import APIClient

from api.tests.test_recognition_api import public_data
from catalog.models import Category, GenericProduct
from receipts.models import ReceiptLine


@tag("integration")
@override_settings(DEBUG=True, ALLOW_LOCAL_RECOGNITION_API=True)
class StoreCategoryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.photo, self.job, self.receipt, self.line = public_data()
        self.product = self.line.product
        self.sorted_generic = self.product.generic
        unsorted = Category.objects.create(name="Не разобрано")
        self.unsorted = GenericProduct.objects.create(name="Не разобрано", category=unsorted, base_unit="pcs")
        self.food = Category.objects.create(name="Продукты")
        self.product.generic = self.unsorted
        self.product.save()

    def line_state(self):
        line = ReceiptLine.objects.get(pk=self.line.pk)
        return line.category_id, line.extra.get("category_source")

    def set_category(self, category):
        response = self.client.post("/api/store-merges/category/", {"store": self.receipt.store_id, "category": category},
                                    format="json")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_unsorted_lines_follow_the_shop_until_the_product_is_sorted(self):
        body = self.set_category(self.food.pk)
        self.assertEqual([row["default_category"] for row in body["stores"] if row["id"] == self.receipt.store_id], [self.food.pk])
        self.assertEqual(self.line_state(), (self.food.pk, "store"))
        # The product got a real category (the AI, a moderator): the line counts by it again.
        self.product.generic = self.sorted_generic
        self.product.save(update_fields=["generic"])
        self.assertEqual(self.line_state(), (None, None))
        # Back to «Не разобрано» (a rejected suggestion): the shop's category again.
        self.product.generic = self.unsorted
        self.product.save(update_fields=["generic"])
        self.assertEqual(self.line_state(), (self.food.pk, "store"))
        self.set_category(None)
        self.assertEqual(self.line_state(), (None, None))

    def test_a_category_of_the_line_itself_is_never_replaced(self):
        own = Category.objects.create(name="Своя")
        ReceiptLine.objects.filter(pk=self.line.pk).update(category=own)
        self.set_category(self.food.pk)
        self.assertEqual(self.line_state(), (own.pk, None))

    def test_refuses_an_unknown_category(self):
        response = self.client.post("/api/store-merges/category/", {"store": self.receipt.store_id, "category": 999999}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["fields"], {"category": ["Категория не найдена."]})
