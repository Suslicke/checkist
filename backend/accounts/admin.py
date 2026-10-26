from django.contrib import admin

from .models import AiModelSetting, Household, LoginFailure, Membership, PocketIdIdentity


@admin.register(LoginFailure)
class LoginFailureAdmin(admin.ModelAdmin):
    """Счётчики неудачных входов: только чтение, их пишет ``accounts.throttle``."""

    list_display = ("key", "failures", "window_started_at")
    search_fields = ("key",)
    ordering = ("-window_started_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 1
    fields = ("user", "role", "visible_from")
    autocomplete_fields = ("user",)


@admin.register(Household)
class HouseholdAdmin(admin.ModelAdmin):
    """Семьи заводит администратор: название и члены; пользователь — не больше чем в одной.

    ИИ семьи: включатель (его же меняет главный на «Семье») и дневная квота запросов — только здесь.
    """

    list_display = ("name", "ai_enabled", "ai_daily_limit", "created_at")
    search_fields = ("name", "memberships__user__username")
    inlines = (MembershipInline,)


@admin.register(AiModelSetting)
class AiModelSettingAdmin(admin.ModelAdmin):
    """Одна строка: модель и усилие Claude для всех вызовов сервера (то же, что карточка на «Семье»)."""

    list_display = ("model", "effort", "updated_at", "updated_by")
    readonly_fields = ("updated_at", "updated_by")

    def save_model(self, request, obj, form, change):
        obj.pk, obj.updated_by = 1, request.user
        super().save_model(request, obj, form, change)


@admin.register(PocketIdIdentity)
class PocketIdIdentityAdmin(admin.ModelAdmin):
    """Привязки Pocket ID: видны и удаляются (отвязка); создаёт их только сам пользователь на «Аккаунте»."""

    list_display = ("user", "subject", "issuer", "created_at", "last_login_at")
    search_fields = ("user__username", "subject")
    readonly_fields = ("user", "issuer", "subject", "created_at", "last_login_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
