"""``manage.py store_categories resync`` — пересчитать категории магазина у всех строк чеков (receipts.store_category).

Нужно после склейки дублей товаров (она переносит строки ``update()`` без сигналов) либо правки базы руками.
Повтор ничего не меняет.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from receipts import store_category
from receipts.models import ReceiptLine


class Command(BaseCommand):
    help = "Пересчитать категории магазина у строк чеков с фото."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["resync"])

    def handle(self, *args, **options):
        with transaction.atomic():
            store_category.resync(ReceiptLine.objects.filter(receipt__source="photo"))
        marked = ReceiptLine.objects.filter(**{f"extra__{store_category.SOURCE_KEY}": store_category.STORE}).count()
        self.stdout.write(f"Строк с категорией магазина: {marked}")
