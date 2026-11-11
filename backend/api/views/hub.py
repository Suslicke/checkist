"""Приём файла от хаба владельца (admin-hub, его Telegram-бот): ``POST /api/hub/import/`` (2026-11-11).

Тело — сырые байты одного файла: фото, скриншот или PDF. ``Content-Type`` и ``X-Filename`` не читаются: формат
узнаётся по байтам, имя файла Чекист не хранит. Вход — личный токен ``write`` в ``Authorization: Bearer``, тот же,
что у ``/mcp`` (``accounts.access.ApiTokenAuthentication`` / ``WriteToken``), только ``accounts``; CSRF нет — токен
не cookie. Сервис сам разбирает, что куда:

- PDF выписки Kaspi Gold либо ForteBank с операциями — черновик выписки, как ``POST /api/statements/``
  (``statements.drafts.accept``: тот же файл — прежний черновик);
- всё остальное — фото чека, как ``POST /api/recognition/photos/`` (``receive_photo``: ИИ семьи, пределы и форматы,
  PDF до 3 страниц, повтор тех же байтов, задание).

Ответ — одна строка ``message`` для чата и id, без мест, сумм и имён. Ошибки — те же коды и статусы, что у
приложения, но плоско: ``{"error": код, "message": строка, …}`` — хаб показывает ``message`` в чате.
"""
import hashlib
from io import BytesIO

from django.conf import settings
from rest_framework.response import Response

from accounts.access import ApiTokenAuthentication, WriteToken, request_user
from api.recognition_serialization import executor_object
from config.exceptions import InvalidRequest, RecognitionApiError
from recognition.models import SourcePhoto
from statements import drafts
from statements.extract import MAX_BYTES as STATEMENT_MAX_BYTES, StatementError, is_pdf
from statements.parsers import BANK_LABELS
from statements.rules import visible_q

from .recognition import receive_photo
from .recognition_base import LimitedStream, LocalAPIView
from .statements import StatementApiError

CHUNK = 64 * 1024


def read_body(request):
    """The raw body; more than the larger file limit, declared or actual, — ``413 upload_too_large``."""
    limit = max(settings.RECEIPT_IMAGE_MAX_BYTES, STATEMENT_MAX_BYTES)
    try:
        declared = int(request.META.get("CONTENT_LENGTH") or 0)
    except ValueError:
        raise InvalidRequest() from None
    if declared > limit:
        raise RecognitionApiError("upload_too_large")
    stream = LimitedStream(request._request, limit)
    chunks = []
    while chunk := stream.read(CHUNK):
        chunks.append(chunk)
    return b"".join(chunks)


def as_statement(request, owner, data):
    """``(StatementImport, created)`` when the PDF ``data`` is a bank statement, otherwise None.

    A statement is what ``POST /api/statements/`` accepts: Kaspi Gold or ForteBank with operations. A PDF the owner
    already sent as a receipt stays a receipt. Any other refusal (another bank or none, no operations, unreadable,
    encrypted, too many pages) means «not a statement»: the receipt path gives its own answer. Only a statement too
    large to take is refused here.
    """
    if SourcePhoto.objects.filter(owner=owner, sha256=hashlib.sha256(data).hexdigest()).exists():
        return None
    try:
        return drafts.accept(owner, data, rule_scope=visible_q(request))
    except StatementError as error:
        if error.code == "statement_too_large":
            raise StatementApiError(error.code) from None
        return None


def receipt_message(job, created):
    if not created:
        return f"Этот файл уже был загружен — задание #{job.pk}"
    if executor_object()["available"]:
        return f"Чек принят, распознаю — задание #{job.pk}"
    return f"Чек принят — задание #{job.pk}; распознаю, когда запустится обработчик"


def statement_message(statement, created):
    if not created:
        return f"Эта выписка уже загружена — черновик #{statement.pk}"
    return f"Это выписка {BANK_LABELS[statement.bank]} — черновик #{statement.pk}: проверьте траты и сохраните их в Чекисте"


def flat(data):
    """``{"error": {"code", "message", "fields"?}, …}`` of ``config.exceptions`` → ``{"error": code, "message", …}``."""
    error = data.get("error") if isinstance(data, dict) else None
    if not isinstance(error, dict):
        return data
    rest = {key: value for key, value in data.items() if key != "error"}
    return {"error": error.get("code"), "message": error.get("message"),
            **{key: value for key, value in error.items() if key not in ("code", "message")}, **rest}


class HubImportView(LocalAPIView):
    """``POST`` — сырые байты файла → ``{"message", "kind", "photo", "job", "statement", "reused"}``.

    Фото чека: ``202`` новое, ``200`` повтор (как ``/api/recognition/photos/``). Выписка: ``201`` новый черновик,
    ``200`` повтор (как ``/api/statements/``).
    """

    authentication_classes = [ApiTokenAuthentication]
    permission_classes = [WriteToken]
    http_method_names = ["post"]

    def post(self, request):
        owner = request_user(request)
        data = read_body(request)
        found = as_statement(request, owner, data) if is_pdf(data) else None
        if found is not None:
            statement, created = found
            return Response({"message": statement_message(statement, created), "kind": "statement", "photo": None,
                             "job": None, "statement": statement.pk, "reused": not created},
                            status=201 if created else 200)
        photo, job, created = receive_photo(owner, BytesIO(data))
        return Response({"message": receipt_message(job, created), "kind": "receipt", "photo": photo.pk,
                         "job": job.pk, "statement": None, "reused": not created},
                        status=202 if created else 200)

    def handle_exception(self, exc):
        response = super().handle_exception(exc)
        response.data = flat(response.data)
        return response
