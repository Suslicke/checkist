"""Планы — ожидаемые разовые траты: «куртка к 20 октября», «шины в ноябре», «подарок» без срока.

Не регулярные платежи и не лимиты: план ждёт одну настоящую трату и закрывается привязкой к ней
(``receipt``). Владелец — как у лимита (``budget.BudgetLimit``): семья, если она есть, иначе сам
пользователь; планы семьи видят и правят все её члены (``planned.access``). План без срока (``due``
NULL) в месяц и в «можно тратить в день» не входит. Деньги на план можно откладывать на цели
(``goal``); сколько отложено — расчёт при чтении (``planned.services.saved``), не хранится.
"""
from django.conf import settings
from django.db import models
from django.db.models import Q

OWNER_CONSTRAINT = Q(household__isnull=False, user__isnull=True) | Q(household__isnull=True, user__isnull=False)


class PlannedSpend(models.Model):
    class Verdict(models.TextChoices):
        KEEP = "keep", "Брать"
        WAIT = "wait", "Подождать"
        DROP = "drop", "Отказаться"

    household = models.ForeignKey(
        "accounts.Household", null=True, blank=True, on_delete=models.CASCADE, related_name="planned_spends")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="planned_spends")
    name = models.CharField(max_length=100)
    category = models.ForeignKey(
        "catalog.Category", null=True, blank=True, on_delete=models.PROTECT, related_name="planned_spends")
    currency = models.ForeignKey("stores.Currency", on_delete=models.PROTECT, related_name="planned_spends")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    due = models.DateField(null=True, blank=True)  # NULL — без срока
    due_exact = models.BooleanField(default=True)  # True — «к 20 октября»; False — «в октябре», ``due`` = 1-е число
    note = models.CharField(max_length=300, blank=True, default="")
    # Закрывшая трата: одна трата — один план; без обратной связи у чека (receipts.tests.test_samples).
    receipt = models.OneToOneField(
        "receipts.Receipt", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    goal = models.ForeignKey("goals.Goal", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    ai_verdict = models.CharField(max_length=8, choices=Verdict.choices, blank=True, default="")
    ai_reason = models.CharField(max_length=300, blank=True, default="")
    ai_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "planned spend"
        verbose_name_plural = "planned spends"
        constraints = [
            models.CheckConstraint(condition=OWNER_CONSTRAINT, name="planned_spend_one_owner"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="planned_spend_amount_positive"),
        ]
        indexes = [models.Index(fields=["household", "due"], name="planned_spend_household_due"),
                   models.Index(fields=["user", "due"], name="planned_spend_user_due")]

    def __str__(self):
        return self.name

    @property
    def done(self):
        return self.receipt_id is not None
