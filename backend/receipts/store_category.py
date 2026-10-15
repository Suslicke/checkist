"""Категория магазина (2026-10-15): гипермаркет продаёт в основном еду, и его неразобранные позиции не висят в
«Не разобрано», а сразу считаются в ``Store.default_category`` (например, «Супермаркет › Продукты»).

Строка чека с фото, у которой нет своей категории, а товар ещё в «Не разобрано» (или товара нет), получает
``ReceiptLine.category`` = категория магазина и пометку ``extra["category_source"] = "store"``. Товар получил настоящую
категорию (предположение ИИ, модератор, админка) — пометка снимается вместе с категорией строки, и строка считается
по товару. Человек сменил категорию строки в форме — пометку снимает ``receipts.manual``: это его выбор.
Пути чтения не меняются: категория строки и так важнее категории товара (``receipts.spending.line_category``).
Правило только здесь; вызывают импорт фото, сигналы товара и обобщённого продукта, смена категории магазина и
команда ``store_categories resync``.
"""
from django.db.models import Q

from classification.taxonomy import SERVICE_NAME

SOURCE_KEY = "category_source"
STORE = "store"

# Товар ещё не разобран: без товара либо его обобщённый продукт — служебный «Не разобрано».
UNSORTED = Q(product__isnull=True) | Q(product__generic__name__iexact=SERVICE_NAME)


def resync(lines):
    """Снимает прежние категории магазина у ``lines`` и ставит их заново по нынешним товарам и магазинам.

    ponytail: по строке за раз — объёмы чека, а не каталога; ``bulk_update``, если пересчёт магазина станет медленным.
    """
    from receipts.models import ReceiptLine

    ids = list(lines.values_list("pk", flat=True))
    for line in ReceiptLine.objects.filter(pk__in=ids, **{f"extra__{SOURCE_KEY}": STORE}):
        line.extra.pop(SOURCE_KEY, None)
        line.category_id = None
        line.save(update_fields=["category", "extra"])
    eligible = ReceiptLine.objects.filter(
        UNSORTED, pk__in=ids, category__isnull=True, kind=ReceiptLine.Kind.PRODUCT, receipt__source="photo",
        receipt__store__default_category__isnull=False,
    ).select_related("receipt__store")
    for line in eligible:
        line.category_id = line.receipt.store.default_category_id
        line.extra[SOURCE_KEY] = STORE
        line.save(update_fields=["category", "extra"])


def resync_products(product_ids):
    from receipts.models import ReceiptLine

    resync(ReceiptLine.objects.filter(product_id__in=product_ids))


def resync_store(store_id):
    from receipts.models import ReceiptLine

    resync(ReceiptLine.objects.filter(receipt__store_id=store_id))
