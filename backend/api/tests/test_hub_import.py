"""Приём файла от хаба (api.views.hub): ``POST /api/hub/import/``, сырые байты файла по личному токену ``write``.

Фото и PDF — синтетические (``image_bytes``, ``recognition.tests.pdf_factories``), выписки — вымышленные
``statements.demo``; модель не вызывается, воркера нет.
"""
import re
import tempfile
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings, tag
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import mcp
from accounts.ai import AiRefused
from accounts.models import AiUsage, ApiToken, Household, Membership
from config.exceptions import RecognitionApiError
from recognition.models import ProcessingJob, SourcePhoto
from recognition.queue import request_cancel
from recognition.storage import StorageError
from recognition.tests.pdf_factories import pdf_bytes
from statements import demo
from statements.extract import StatementError
from statements.models import StatementImport

from .accounts_helpers import TwoUsers, accounts_mode, allow_ai, local_single_mode, make_user
from .test_recognition_api import image_bytes, upload

URL = "/api/hub/import/"
END = date(2026, 10, 12)
ABSENT = {"available": False, "state": "absent", "last_seen_at": None}
IDLE = {"available": True, "state": "idle", "last_seen_at": None}
INVALID_TOKEN = {"error": "invalid_token", "message": "Токен Чекиста не подошёл: его нет, он неверный или отозван."}
READ_ONLY = {"error": "permission_denied",
             "message": "Токен Чекиста только читает: для загрузки нужен токен с правом записи."}


def refusal(code):
    return {"error": code, "message": RecognitionApiError.ERRORS[code][1]}


def kaspi_statement():
    return demo.pdf_bytes(demo.demo_kaspi_lines(END))


class HubClient:
    """Временный MEDIA и запрос хаба: сырые байты, ``application/octet-stream``, ``Bearer`` и ``X-Filename``."""

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory(prefix="checkist-hub-import-test-")
        self.addCleanup(directory.cleanup)
        override = override_settings(MEDIA_ROOT=directory.name)
        override.enable()
        self.addCleanup(override.disable)

    def send(self, token, data, *, client=None, content_type="application/octet-stream", **headers):
        if token is not None:
            headers["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        headers.setdefault("HTTP_X_FILENAME", "IMG_0001.jpg")
        return (client or APIClient()).generic("POST", URL, data, content_type=content_type, **headers)

    def answer(self, response, status):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(response["Cache-Control"], "no-store")
        return response.json()


@tag("integration")
@accounts_mode()
class HubImportTests(HubClient, TwoUsers, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        allow_ai(cls.first, cls.second)
        _, cls.writer = mcp.issue(cls.first, "хаб", "write")
        _, cls.reader = mcp.issue(cls.first, "чтение", "read")
        _, cls.second_writer = mcp.issue(cls.second, "хаб", "write")

    def counts(self):
        return SourcePhoto.objects.count(), ProcessingJob.objects.count(), StatementImport.objects.count()

    # --- вход ---

    def test_refuses_without_a_live_write_token_and_keeps_nothing(self):
        revoked, revoked_token = mcp.issue(self.first, "старый", "write")
        ApiToken.objects.filter(pk=revoked.pk).update(revoked_at=timezone.now())
        quiet = make_user("synthetic-inactive")
        _, inactive_token = mcp.issue(quiet, "хаб", "write")
        quiet.is_active = False
        quiet.save(update_fields=["is_active"])
        cases = [
            ("нет заголовка", {}, None),
            ("чужая схема", {"HTTP_AUTHORIZATION": "Basic c3ludGhldGljOnN5bnRoZXRpYw=="}, None),
            ("пустой Bearer", {"HTTP_AUTHORIZATION": "Bearer "}, None),
            ("неверный", {}, "ck_wrong"),
            ("отозван", {}, revoked_token),
            ("владелец неактивен", {}, inactive_token),
        ]
        for name, headers, token in cases:
            with self.subTest(name):
                response = self.send(token, image_bytes(), **headers)
                self.assertEqual(self.answer(response, 401), INVALID_TOKEN)
                self.assertEqual(response["WWW-Authenticate"], 'Bearer error="invalid_token"')
        response = self.send(self.reader, image_bytes())
        self.assertEqual(self.answer(response, 403), READ_ONLY)
        self.assertEqual(response["WWW-Authenticate"], 'Bearer error="insufficient_scope", scope="write"')
        self.assertEqual(self.counts(), (0, 0, 0))

    def test_needs_no_csrf_and_ignores_the_session(self):
        # A browser session of another person with CSRF checks on: the token decides whose upload it is.
        browser = APIClient(enforce_csrf_checks=True)
        browser.force_login(self.second)
        body = self.answer(self.send(self.writer, image_bytes(), client=browser), 202)
        self.assertEqual(SourcePhoto.objects.get(pk=body["photo"]).owner_id, self.first.pk)
        # The session alone, without a token, is not enough.
        self.assertEqual(self.answer(self.send(None, image_bytes("JPEG"), client=browser), 401), INVALID_TOKEN)

    def test_only_post(self):
        self.assertEqual(self.answer(APIClient().get(URL, HTTP_AUTHORIZATION=f"Bearer {self.writer}"), 405),
                         {"error": "method_not_allowed", "message": "Метод не поддерживается."})
        self.assertEqual(self.answer(APIClient().get(URL), 401), INVALID_TOKEN)
        # Without the trailing slash: the common refusal of /api/ before the view, in its own form.
        response = APIClient().generic("POST", URL.rstrip("/"), image_bytes(), content_type="application/octet-stream",
                                       HTTP_AUTHORIZATION=f"Bearer {self.writer}")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.counts(), (0, 0, 0))

    # --- фото чека ---

    def test_image_becomes_a_photo_and_a_queued_job_of_the_token_owner(self):
        with patch("api.views.hub.executor_object", return_value=IDLE):
            body = self.answer(self.send(self.writer, image_bytes()), 202)
        photo = SourcePhoto.objects.get()
        job = ProcessingJob.objects.get()
        self.assertEqual(body, {"message": f"Чек принят, распознаю — задание #{job.pk}", "kind": "receipt",
                                "photo": photo.pk, "job": job.pk, "statement": None, "reused": False})
        self.assertEqual((photo.owner_id, photo.content_type, job.photo_id, job.status),
                         (self.first.pk, "image/png", photo.pk, "queued"))
        self.assertEqual(Path(photo.original_file.path).read_bytes(), image_bytes())
        # The job is the person's own: the app shows it to them and to nobody else.
        self.assertEqual(self.client_of(self.first).get(f"/api/recognition/jobs/{job.pk}/").status_code, 200)
        self.assertEqual(self.client_of(self.second).get(f"/api/recognition/jobs/{job.pk}/").status_code, 404)

    def test_without_a_worker_the_message_says_it_waits(self):
        with patch("api.views.hub.executor_object", return_value=ABSENT):
            body = self.answer(self.send(self.writer, image_bytes("JPEG")), 202)
        self.assertEqual(body["message"], f"Чек принят — задание #{body['job']}; распознаю, когда запустится обработчик")

    def test_same_bytes_reuse_the_photo_and_its_latest_job_like_the_app(self):
        data = image_bytes("WEBP")
        app = self.client_of(self.first, csrf=True).post("/api/recognition/photos/", {"file": upload(data)},
                                                         format="multipart")
        self.assertEqual(app.status_code, 202, app.content)
        photo, job = app.json()["photo"]["id"], app.json()["job"]["id"]
        for attempt in range(2):
            with self.subTest(attempt=attempt):
                body = self.answer(self.send(self.writer, data, HTTP_X_FILENAME="другое%20имя.webp"), 200)
                self.assertEqual(body, {"message": f"Этот файл уже был загружен — задание #{job}", "kind": "receipt",
                                        "photo": photo, "job": job, "statement": None, "reused": True})
        # A cancelled job is not started again by the same file: a new run is an explicit retry.
        request_cancel(job)
        self.assertEqual(self.answer(self.send(self.writer, data), 200)["job"], job)
        self.assertEqual(ProcessingJob.objects.get(pk=job).status, "cancelled")
        # The same bytes of another person are their own photo and job.
        theirs = self.answer(self.send(self.second_writer, data), 202)
        self.assertNotEqual((theirs["photo"], theirs["job"]), (photo, job))
        self.assertEqual(SourcePhoto.objects.get(pk=theirs["photo"]).owner_id, self.second.pk)
        self.assertEqual(self.counts(), (2, 2, 0))

    def test_content_type_and_filename_are_not_read(self):
        for data, content_type, filename, stored in (
            (image_bytes("JPEG"), "application/pdf", "..%2F..%2Fetc%2Fpasswd", "image/jpeg"),
            (image_bytes("PNG"), "text/plain", "%00%ZZ", "image/png"),
            (image_bytes("WEBP"), "image/heic", "чек.heic", "image/webp"),
        ):
            with self.subTest(stored=stored):
                body = self.answer(self.send(self.writer, data, content_type=content_type, HTTP_X_FILENAME=filename), 202)
                photo = SourcePhoto.objects.get(pk=body["photo"])
                self.assertEqual(photo.content_type, stored)
                self.assertRegex(photo.original_file.name, r"^originals/[0-9a-f-]{36}/source\.(jpg|png|webp)$")
        # No header at all is the same.
        self.assertEqual(self.send(self.writer, image_bytes(size=(12, 20)), HTTP_X_FILENAME="").status_code, 202)

    def test_pdf_receipt_becomes_a_photo_with_its_document(self):
        data = pdf_bytes(pages=2)
        body = self.answer(self.send(self.writer, data), 202)
        photo = SourcePhoto.objects.get(pk=body["photo"])
        self.assertEqual((body["kind"], photo.content_type, photo.document_pages, photo.document_bytes),
                         ("receipt", "image/png", 2, len(data)))
        self.assertTrue(photo.document_file.name.endswith("/source.pdf"))
        replay = self.answer(self.send(self.writer, data), 200)
        self.assertEqual((replay["photo"], replay["job"], replay["reused"]), (photo.pk, body["job"], True))
        self.assertEqual(self.counts(), (1, 1, 0))

    def test_refusals_have_the_codes_of_the_app_and_keep_nothing(self):
        cases = [
            (pdf_bytes(pages=4), 400, "pdf_too_many_pages"),
            (pdf_bytes(encrypted=True), 400, "pdf_encrypted"),
            (b"%PDF-1.7\nbroken", 400, "invalid_pdf"),
            (image_bytes("GIF"), 400, "unsupported_format"),
            (b"\x00\x00\x00\x18ftypavif" + b"\0" * 20, 400, "unsupported_format"),
            (b"\x89PNG\r\n\x1a\ninvalid", 400, "invalid_image"),
            (b"", 400, "invalid_image"),
        ]
        for data, status, code in cases:
            with self.subTest(code=code, size=len(data)):
                self.assertEqual(self.answer(self.send(self.writer, data), status), refusal(code))
        self.assertEqual(self.counts(), (0, 0, 0))

    def test_twenty_mib_is_the_limit(self):
        data = image_bytes()
        boundary = self.send(self.writer, data + b"\0" * (20 * 1024 * 1024 - len(data)))
        self.assertEqual(self.answer(boundary, 202)["kind"], "receipt")
        over = self.send(self.writer, image_bytes("JPEG") + b"\0" * (20 * 1024 * 1024))
        self.assertEqual(self.answer(over, 413), refusal("upload_too_large"))
        # A larger declared body is refused before reading: the test payload has only a few bytes to read.
        declared = self.send(self.writer, image_bytes("WEBP"), CONTENT_LENGTH=str(20 * 1024 * 1024 + 1))
        self.assertEqual(self.answer(declared, 413), refusal("upload_too_large"))
        self.assertEqual(self.counts(), (1, 1, 0))

    def test_family_ai_rules_apply_to_a_receipt(self):
        family = Household.objects.create(name="Демо-семья", ai_enabled=False, ai_daily_limit=1)
        account = make_user("synthetic-family-head")
        Membership.objects.create(user=account, household=family, role="head")
        _, token = mcp.issue(account, "хаб", "write")
        off = self.send(token, image_bytes())
        self.assertEqual(self.answer(off, 403), {"error": "ai_disabled", "message": AiRefused.ERRORS["ai_disabled"][1]})
        Household.objects.filter(pk=family.pk).update(ai_enabled=True)
        self.assertEqual(self.send(token, image_bytes()).status_code, 202)
        over = self.send(token, image_bytes("JPEG"))
        tomorrow = timezone.localdate() + timedelta(days=1)
        self.assertEqual(self.answer(over, 429), {"error": "ai_quota", "message": AiRefused.ERRORS["ai_quota"][1],
                                                  "resets_at": f"{tomorrow.isoformat()}T00:00:00Z"})
        self.assertGreater(int(over["Retry-After"]), 0)
        self.assertEqual(AiUsage.objects.get(household=family).count, 1)
        self.assertEqual(SourcePhoto.objects.filter(owner=account).count(), 1)

    def test_storage_and_unknown_errors_say_nothing_inside(self):
        with patch("api.views.recognition.accept_upload", side_effect=StorageError()):
            self.assertEqual(self.answer(self.send(self.writer, image_bytes()), 503), refusal("storage_unavailable"))
        with patch("api.views.recognition.accept_upload", side_effect=RuntimeError("PRIVATE /srv/media/secret")):
            response = self.send(self.writer, image_bytes())
        self.assertEqual(self.answer(response, 500), {"error": "internal_error", "message": "Внутренняя ошибка сервера."})
        self.assertNotIn(b"PRIVATE", response.content)
        self.assertNotIn(b"Traceback", response.content)

    # --- выписка ---

    def test_statement_pdf_becomes_a_statement_draft(self):
        data = kaspi_statement()
        body = self.answer(self.send(self.writer, data), 201)
        statement = StatementImport.objects.get()
        self.assertEqual(body, {
            "message": f"Это выписка Kaspi Gold — черновик #{statement.pk}: проверьте траты и сохраните их в Чекисте",
            "kind": "statement", "photo": None, "job": None, "statement": statement.pk, "reused": False})
        self.assertEqual((statement.owner_id, statement.bank, statement.rows.count()), (self.first.pk, "kaspi_gold", 20))
        replay = self.answer(self.send(self.writer, data), 200)
        self.assertEqual(replay, {"message": f"Эта выписка уже загружена — черновик #{statement.pk}", "kind": "statement",
                                  "photo": None, "job": None, "statement": statement.pk, "reused": True})
        # The app sees the same draft, and the same file there is the same draft.
        app = self.client_of(self.first, csrf=True).post(
            "/api/statements/", {"file": upload(data, "statement.pdf", "application/pdf")}, format="multipart")
        self.assertEqual((app.status_code, app.json()["statement"]["id"]), (200, statement.pk))
        self.assertEqual(self.client_of(self.second).get(f"/api/statements/{statement.pk}/").status_code, 404)
        forte = self.answer(self.send(self.writer, demo.pdf_bytes(demo.demo_forte_lines(END))), 201)
        self.assertTrue(forte["message"].startswith("Это выписка ForteBank — черновик #"))
        self.assertEqual(self.counts(), (0, 0, 2))

    def test_statement_needs_no_ai_up_front_and_a_receipt_does(self):
        account = make_user("synthetic-without-ai")
        _, token = mcp.issue(account, "хаб", "write")
        self.assertEqual(self.answer(self.send(token, kaspi_statement()), 201)["kind"], "statement")
        self.assertEqual(self.answer(self.send(token, image_bytes()), 403)["error"], "ai_disabled")
        self.assertEqual(SourcePhoto.objects.filter(owner=account).count(), 0)

    def test_a_bank_paper_without_operations_is_a_receipt(self):
        data = demo.pdf_bytes(demo.kaspi_header(END, END))
        body = self.answer(self.send(self.writer, data), 202)
        self.assertEqual(body["kind"], "receipt")
        self.assertEqual(SourcePhoto.objects.get(pk=body["photo"]).document_pages, 1)
        self.assertEqual(self.counts(), (1, 1, 0))

    def test_a_pdf_sent_as_a_receipt_before_stays_a_receipt(self):
        data = kaspi_statement()
        app = self.client_of(self.first, csrf=True).post(
            "/api/recognition/photos/", {"file": upload(data, "bill.pdf", "application/pdf")}, format="multipart")
        self.assertEqual(app.status_code, 202, app.content)
        body = self.answer(self.send(self.writer, data), 200)
        self.assertEqual((body["kind"], body["photo"], body["reused"]), ("receipt", app.json()["photo"]["id"], True))
        self.assertEqual(self.counts(), (1, 1, 0))

    def test_a_statement_too_large_is_refused_as_in_the_app(self):
        with patch("statements.drafts.accept", side_effect=StatementError("statement_too_large")):
            response = self.send(self.writer, kaspi_statement())
        self.assertEqual(self.answer(response, 400), {"error": "statement_too_large",
                                                      "message": "Выписка слишком большая. Выберите период короче."})
        self.assertEqual(self.counts(), (0, 0, 0))

    def test_the_answer_keeps_places_amounts_and_names_out(self):
        bodies = [self.answer(self.send(self.writer, kaspi_statement()), 201),
                  self.answer(self.send(self.writer, image_bytes()), 202)]
        for body in bodies:
            with self.subTest(kind=body["kind"]):
                self.assertEqual(set(body), {"message", "kind", "photo", "job", "statement", "reused"})
                self.assertIsNone(re.search(r"\d[\d  ]*[.,]\d\d|₸|KZT|MAGNUM|synthetic", body["message"]))


@tag("integration")
@local_single_mode()
class HubImportLocalSingleTests(HubClient, TestCase):
    def test_off_without_accounts(self):
        from receipts.ownership import local_user

        _, token = mcp.issue(local_user(), "хаб", "write")
        response = self.send(token, image_bytes())
        self.assertEqual(self.answer(response, 404), {"error": "not_found", "message": "Не найдено."})
        self.assertEqual(SourcePhoto.objects.count(), 0)
