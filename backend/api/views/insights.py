"""ИИ о тратах (``/api/insights/``): разбор месяца, ответы на вопросы и беседы («Чат с ИИ»).

Доступ — как у «Траты словами»: ``accounts`` — вход, ``local_single`` — DEBUG + флаг + loopback; запись — с
CSRF. Строки видит только их владелец (не семья): чужая — ``404``. Модель спрашивает воркер
(``insights.queue``); до постановки в очередь — ``accounts.ai.use_ai`` (``403 ai_disabled`` / ``429 ai_quota``).
Цифры разбора (``figures``) — от сервера: сводка, которую получила модель, либо, пока разбора нет, она же сейчас.
Беседы (``/threads/``) — ``insights.chat``: сообщение беседы — та же строка запроса с ``thread_id`` и ``actions``;
действие модели исполняется только по ``POST …/actions/{index}/confirm/`` (``409 action_done`` повторно).
"""
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from accounts.access import request_user, visible_receipts_q
from api.common import get_or_404, utc_datetime
from api.params import Params
from api.recognition_serialization import executor_object
from budget.dashboard import Month
from config.exceptions import InvalidParameter, RecognitionApiError
from insights import chat, context, queue
from insights.models import InsightRequest, InsightThread
from receipts.models import Receipt

from .budget import read_month
from .receipts import manual_body
from .recognition import path_id
from .recognition_base import JsonObjectParser, LocalAPIView

Kind, Status = InsightRequest.Kind, InsightRequest.Status
UNFINISHED = [Status.QUEUED, Status.RUNNING]

# Коды сбоя -> фиксированные тексты; сырой ответ модели в API не попадает.
ERRORS = {
    "invalid_output": "Не удалось составить ответ. Попробуйте ещё раз.",
    "timeout": "Ответ не уложился в срок. Попробуйте ещё раз.",
    "expired": "Ответ не дождался исполнителя. Попробуйте позже.",
    "worker_lost": "Исполнитель остановился во время ответа. Попробуйте ещё раз.",
    "auth_required": "ИИ сейчас недоступен: исполнителю нужен вход в Codex.",
}
ERROR_DEFAULT = "ИИ сейчас недоступен. Попробуйте позже."


def figures(summary):
    """Цифры месяца для экрана: всё из ``focus`` сводки, её основная валюта и траты без курса."""
    return {"month": summary["month"], "currency": summary["currency"], **summary["focus"],
            "without_rate": summary["without_rate"]}


def row_object(row):
    if row is None:
        return None
    error = None
    if row.error_code:
        error = {"code": row.error_code, "message": ERRORS.get(row.error_code, ERROR_DEFAULT)}
    succeeded = row.status == Status.SUCCEEDED
    result = {
        "id": row.pk, "kind": row.kind, "month": f"{row.month:%Y-%m}", "question": row.question, "status": row.status,
        "answer": row.answer if succeeded else None, "unverified": queue.unverified(row) if succeeded else [],
        "error": error, "created_at": utc_datetime(row.created_at), "finished_at": utc_datetime(row.finished_at),
        "executor": executor_object(),
    }
    if row.kind == Kind.REVIEW:
        result["figures"] = figures(row.context)
    if row.kind == Kind.CHAT:
        result["thread_id"], result["actions"] = row.thread_id, row.actions if succeeded else None
    return result


def own(request):
    return InsightRequest.objects.filter(owner=request_user(request))


def review_month(params, today):
    """Месяц разбора: по умолчанию — прошлый; будущий — отказ."""
    current = Month.of(today)
    if params.raw("month") is None:
        return current.previous()
    month = read_month(params, today)
    if month is not None and (month.year, month.month) > (current.year, current.month):
        params.error("month", "Месяц не позже текущего, в формате ГГГГ-ММ.")
    return month


class InsightBodyParser(JsonObjectParser):
    pass


class ReviewView(LocalAPIView):
    """``GET ?month=`` — цифры месяца и его разбор; ``POST {"month"}`` — новый разбор в очередь, ``202``.

    ``review`` — последний готовый разбор месяца, без него — последний любой (идёт либо не удался);
    ``pending`` — идущий новее готового («Обновить»). Незавершённый разбор того же месяца ``POST`` возвращает
    сам, без нового запроса к ИИ.
    """

    http_method_names = ["get", "post", "options"]
    parser_classes = [InsightBodyParser]

    def get(self, request):
        params = Params(request.query_params)
        month = review_month(params, timezone.localdate())
        params.check()
        rows = own(request).filter(kind=Kind.REVIEW, month=month.first).order_by("-pk")
        review = rows.filter(status=Status.SUCCEEDED).first() or rows.first()
        pending = rows.filter(status__in=UNFINISHED, pk__gt=review.pk).first() if review is not None else None
        summary = review.context if review is not None else context.build(request_user(request), month)
        return Response({"month": month.label(), "figures": figures(summary), "review": row_object(review),
                         "pending": row_object(pending)})

    def post(self, request):
        data = manual_body(request)
        errors = {key: ["Неизвестное поле."] for key in data if key != "month"}
        value = data.get("month")
        if value is not None and not isinstance(value, str):
            errors["month"] = ["Месяц в формате ГГГГ-ММ."]
        params = Params({"month": value} if isinstance(value, str) else {})
        month = review_month(params, timezone.localdate())
        errors.update(params.errors)
        if errors:
            raise InvalidParameter(errors)
        row = queue.request_review(request_user(request), month)
        return Response(row_object(row), status=status.HTTP_202_ACCEPTED)


class AskView(LocalAPIView):
    """``GET`` — последние вопросы человека (только свои); ``POST {"question"}`` — вопрос в очередь, ``202``."""

    http_method_names = ["get", "post", "options"]
    parser_classes = [InsightBodyParser]

    def get(self, request):
        rows = own(request).filter(kind=Kind.ASK).order_by("-pk")[:queue.HISTORY]
        return Response({"results": [row_object(row) for row in rows]})

    def post(self, request):
        data = manual_body(request)
        errors = {key: ["Неизвестное поле."] for key in data if key != "question"}
        question = data.get("question")
        if not isinstance(question, str) or not question.strip():
            errors["question"] = ["Напишите вопрос о тратах."]
        elif len(question.strip()) > queue.QUESTION_MAX:
            errors["question"] = [f"Не длиннее {queue.QUESTION_MAX} символов."]
        if errors:
            raise InvalidParameter(errors)
        try:
            row = queue.request_ask(request_user(request), question.strip(), Month.of(timezone.localdate()))
        except queue.AskLimit:
            raise RecognitionApiError("parse_limit") from None
        return Response(row_object(row), status=status.HTTP_202_ACCEPTED)


class InsightView(LocalAPIView):
    """``GET`` — состояние и ответ одной своей строки; чужая — ``404``."""

    def get(self, request, pk):
        return Response(row_object(get_or_404(own(request), path_id(pk))))


# --- беседы («Чат с ИИ») ---

PREVIEW = 120
THREAD_FIELDS = ("kind", "receipt_id", "month", "question")


def thread_object(thread, preview=None):
    return {
        "id": thread.pk, "kind": thread.kind, "title": thread.title, "receipt_id": thread.receipt_id,
        "month": f"{thread.month:%Y-%m}" if thread.month else None, "created_at": utc_datetime(thread.created_at),
        "updated_at": utc_datetime(thread.updated_at), "last_answer_preview": preview,
    }


def previews(threads):
    """{thread_id: начало последнего готового ответа} одним запросом (``DISTINCT ON`` PostgreSQL)."""
    ids = [thread.pk for thread in threads]
    if not ids:
        return {}
    rows = (InsightRequest.objects.filter(thread_id__in=ids, status=Status.SUCCEEDED)
            .order_by("thread_id", "-pk").distinct("thread_id").values_list("thread_id", "answer"))
    return {thread_id: ((answer or {}).get("answer") or "")[:PREVIEW] or None for thread_id, answer in rows}


def own_threads(request):
    return InsightThread.objects.filter(owner=request_user(request))


def thread_page(thread):
    rows = thread.requests.order_by("pk")
    return {"thread": thread_object(thread, previews([thread]).get(thread.pk)), "messages": [row_object(row) for row in rows]}


def read_question(data, errors, *, required):
    question = data.get("question")
    if question is None and not required:
        return ""
    if not isinstance(question, str) or not question.strip():
        errors["question"] = ["Напишите сообщение."]
        return ""
    if len(" ".join(question.split())) > queue.QUESTION_MAX:
        errors["question"] = [f"Не длиннее {queue.QUESTION_MAX} символов."]
    return " ".join(question.split())


def queue_message(send):
    try:
        return send()
    except queue.AskLimit:
        raise RecognitionApiError("parse_limit") from None


class ThreadsView(LocalAPIView):
    """``GET`` — свои беседы, новые сверху; ``POST {kind, receipt_id?, month?, question?}`` — новая беседа, ``201``.

    ``spend`` требует ``receipt_id`` видимой траты, ``month`` — месяц ``ГГГГ-ММ``; с вопросом (у ``plans`` — всегда,
    свой вопрос заменяет вступление сервера) первое сообщение сразу в очереди: ``use_ai`` и лимиты как у вопроса,
    отказ не оставляет беседы.
    """

    http_method_names = ["get", "post", "options"]
    parser_classes = [InsightBodyParser]

    def get(self, request):
        threads = list(own_threads(request).order_by("-updated_at", "-pk")[:200])
        found = previews(threads)
        return Response({"results": [thread_object(thread, found.get(thread.pk)) for thread in threads]})

    def post(self, request):
        data = manual_body(request)
        errors = {key: ["Неизвестное поле."] for key in data if key not in THREAD_FIELDS}
        kind = data.get("kind")
        if kind not in InsightThread.Kind.values:
            errors["kind"] = ["Вид беседы: free, spend, plans или month."]
        receipt = month = None
        if kind == InsightThread.Kind.SPEND:
            pk = data.get("receipt_id")
            if isinstance(pk, int) and not isinstance(pk, bool) and 1 <= pk <= 10 ** 18:
                receipt = Receipt.objects.filter(visible_receipts_q(request), pk=pk).select_related("store__merchant").first()
            if receipt is None:
                errors["receipt_id"] = ["Трата не найдена."]
        if kind == InsightThread.Kind.MONTH:
            value = data.get("month")
            params = Params({"month": value} if isinstance(value, str) else {})
            month = read_month(params, timezone.localdate()) if isinstance(value, str) else None
            if month is None:
                errors["month"] = ["Месяц в формате ГГГГ-ММ."]
        question = read_question(data, errors, required=False)
        if errors:
            raise InvalidParameter(errors)
        thread = queue_message(lambda: chat.create_thread(request_user(request), kind, receipt=receipt, month=month,
                                                          question=question))
        return Response(thread_page(thread), status=status.HTTP_201_CREATED)


class ThreadView(LocalAPIView):
    """``GET`` — беседа и её сообщения по порядку; ``DELETE`` — беседа с сообщениями, ``204``. Чужая — ``404``."""

    http_method_names = ["get", "delete", "options"]

    def get(self, request, pk):
        return Response(thread_page(get_or_404(own_threads(request), path_id(pk))))

    def delete(self, request, pk):
        get_or_404(own_threads(request), path_id(pk)).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ThreadMessagesView(LocalAPIView):
    """``POST {question}`` — сообщение человека в свою беседу, ``202`` строка запроса."""

    http_method_names = ["post", "options"]
    parser_classes = [InsightBodyParser]

    def post(self, request, pk):
        thread = get_or_404(own_threads(request).select_related("receipt__store__merchant"), path_id(pk))
        data = manual_body(request)
        errors = {key: ["Неизвестное поле."] for key in data if key != "question"}
        question = read_question(data, errors, required=True)
        if errors:
            raise InvalidParameter(errors)
        row = queue_message(lambda: chat.send(thread, question))
        return Response(row_object(row), status=status.HTTP_202_ACCEPTED)


class ActionConfirmView(LocalAPIView):
    """``POST`` — подтвердить действие ``index`` своего готового сообщения: ``planned.services.apply_action``, ответ —
    строка запроса с ``done_at``/``result``. Повтор — ``409 action_done``; нет такого действия — ``400`` у ``index``;
    действие не применилось (план исчез, негодные значения) — ``400`` у ``action`` с причиной."""

    http_method_names = ["post", "options"]
    parser_classes = [InsightBodyParser]

    def post(self, request, pk, index):
        row = get_or_404(own(request).filter(kind=Kind.CHAT), path_id(pk))
        manual_body(request)
        try:
            row = chat.confirm_action(request_user(request), row, int(index))
        except chat.ActionDone:
            raise RecognitionApiError("action_done") from None
        except ValueError as error:
            field = "index" if str(error) == "index" else "action"
            raise InvalidParameter({field: ["Такого действия нет." if field == "index" else f"Не удалось выполнить: {error}."]}) from None
        return Response(row_object(row))
