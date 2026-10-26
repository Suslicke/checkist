from django.conf import settings
from django.db import models
from django.db.models import Q


class InsightThread(models.Model):
    """Беседа с ИИ: о чём-то одном (``spend`` — трата, ``month`` — месяц, ``plans`` — планы) либо свободная (``free``).

    Сообщения — запросы ``InsightRequest`` треда по порядку (``question`` — слова человека, ``answer.answer`` —
    ответ модели). Видит только владелец. Правила — ``insights.chat``; тред сам ничего не меняет.
    """

    class Kind(models.TextChoices):
        FREE = "free"
        SPEND = "spend"
        PLANS = "plans"
        MONTH = "month"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="insight_threads")
    kind = models.CharField(max_length=8, choices=Kind.choices)
    title = models.CharField(max_length=120, blank=True, default="")
    # Трата беседы ``spend``; удалённая трата оставляет беседу (SET_NULL).
    receipt = models.ForeignKey("receipts.Receipt", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    month = models.DateField(null=True, blank=True)  # первое число месяца беседы ``month``
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["owner", "-updated_at"], name="insights_thread_owner_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(kind__in=["free", "spend", "plans", "month"]),
                                   name="insights_thread_kind_check"),
        ]

    def __str__(self):
        return f"{self.pk} {self.kind} {self.title}"


class InsightRequest(models.Model):
    """ИИ о тратах: разбор месяца (``review``), ответ на вопрос (``ask``) либо сообщение беседы (``chat``) ждёт воркера.

    ``context`` — сводка, которую получила модель (``insights.context``): экран разбора показывает её
    цифры рядом с текстом модели, так что модель — не единственный источник сумм. Строку видит только
    владелец. Очередь и исполнение — ``insights.queue``; траты и каталог строка не меняет. У ``chat``
    ``context`` несёт ещё ``plans`` и ``subject`` беседы, ``actions`` — действия, предложенные моделью
    (каждое — ``done_at``/``result`` после подтверждения человеком; само по себе ничего не делает).
    """

    class Kind(models.TextChoices):
        REVIEW = "review"
        ASK = "ask"
        CHAT = "chat"

    class Status(models.TextChoices):
        QUEUED = "queued"
        RUNNING = "running"
        SUCCEEDED = "succeeded"
        FAILED = "failed"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="insight_requests")
    thread = models.ForeignKey(InsightThread, null=True, blank=True, on_delete=models.CASCADE, related_name="requests")
    kind = models.CharField(max_length=8, choices=Kind.choices)
    # Первое число месяца: разбираемого либо того, в котором задан вопрос.
    month = models.DateField()
    question = models.CharField(max_length=300, blank=True, default="")
    context = models.JSONField()
    actions = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    answer = models.JSONField(null=True, blank=True)
    error_code = models.CharField(max_length=32, blank=True, default="")
    run_token = models.UUIDField(null=True, blank=True)
    lease_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["status", "id"], name="insights_status_idx"),
            models.Index(fields=["owner", "kind", "month"], name="insights_owner_idx"),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(kind__in=["review", "ask", "chat"]), name="insights_kind_check"),
            models.CheckConstraint(condition=Q(status__in=["queued", "running", "succeeded", "failed"]),
                                   name="insights_status_check"),
        ]

    def __str__(self):
        return f"{self.pk} {self.kind} {self.status}"
