from django.apps import AppConfig


class ReceiptsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "receipts"

    def ready(self):
        from django.db.models.signals import post_save

        from catalog.models import GenericProduct, Product
        from receipts import store_category

        # A product that got a real category (the AI, a moderator, the admin) takes its lines back from the shop's
        # category, and one sent back to «Не разобрано» gives them to it again (receipts.store_category).
        # ponytail: bulk .update() of the merges skips signals — `manage.py store_categories resync` repairs that.
        def product_saved(sender, instance, created, update_fields=None, **kwargs):
            if not created and (update_fields is None or "generic" in update_fields):
                store_category.resync_products([instance.pk])

        def generic_saved(sender, instance, created, update_fields=None, **kwargs):
            if not created and (update_fields is None or "category" in update_fields or "name" in update_fields):
                store_category.resync_products(Product.objects.filter(generic=instance).values("pk"))

        post_save.connect(product_saved, sender=Product, weak=False, dispatch_uid="receipts.store_category.product")
        post_save.connect(generic_saved, sender=GenericProduct, weak=False, dispatch_uid="receipts.store_category.generic")
