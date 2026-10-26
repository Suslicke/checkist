from django.contrib import admin

from .models import PlannedSpend


@admin.register(PlannedSpend)
class PlannedSpendAdmin(admin.ModelAdmin):
    """Планы; обычно их правят на экране «Планы», админка — запасной путь. Вердикт ИИ — только чтение."""

    list_display = ("name", "amount", "currency", "due", "due_exact", "category", "receipt_id", "goal", "ai_verdict",
                    "household", "user")
    list_filter = ("due_exact", "currency", "ai_verdict")
    search_fields = ("name", "category__name", "household__name", "user__username")
    raw_id_fields = ("receipt", "goal", "created_by")
    autocomplete_fields = ("user",)
    readonly_fields = ("ai_verdict", "ai_reason", "ai_at", "created_at", "updated_at")
    ordering = ("household", "user", "due", "name")
