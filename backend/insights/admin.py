from django.contrib import admin

from .models import InsightRequest, InsightThread


class RequestInline(admin.TabularInline):
    """Сообщения беседы — только чтение: вопрос, состояние, когда."""

    model = InsightRequest
    fields = ("id", "question", "status", "error_code", "created_at", "finished_at")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(InsightThread)
class InsightThreadAdmin(admin.ModelAdmin):
    """Беседы с ИИ — только чтение (сводки и ответы модели не правят): кто, о чём, когда."""

    list_display = ("id", "owner", "kind", "title", "receipt_id", "month", "updated_at")
    list_filter = ("kind",)
    search_fields = ("title", "owner__username")
    readonly_fields = ("owner", "kind", "title", "receipt", "month", "created_at", "updated_at")
    ordering = ("-updated_at",)
    inlines = [RequestInline]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
