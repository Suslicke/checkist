"""Модель и усилие Claude, выбранные администратором сервера на «Семье» (``accounts.ai.model_choice``).

Пользователи вымышленные; модель не вызывается (запуск ``claude`` подменён до старта процесса).
"""
import json
from pathlib import Path
from unittest import mock

from django.test import TestCase, override_settings, tag

from accounts import ai
from accounts.models import AiModelSetting
from api.tests.accounts_helpers import accounts_mode, make_user
from api.tests.test_owner_isolation import IsolationMixin
from recognition.providers.claude_cli import ClaudeCLIProvider, ClaudeConfig
from recognition.providers.base import ProviderError

URL = "/api/family/ai-model/"


@tag("integration")
class ModelChoiceTests(TestCase):
    @override_settings(RECEIPT_OCR_PROVIDER="claude_cli", RECEIPT_OCR_MODEL="claude-opus-5-5", RECEIPT_OCR_CLAUDE_EFFORT="medium")
    def test_without_a_row_the_settings_decide(self):
        self.assertEqual(ai.model_choice(), {"provider": "claude_cli", "model": "claude-opus-5-5", "effort": "medium", "source": "settings"})

    @override_settings(RECEIPT_OCR_PROVIDER="claude_cli", RECEIPT_OCR_MODEL="claude-opus-5-5", RECEIPT_OCR_CLAUDE_EFFORT="medium")
    def test_the_row_overrides_the_settings_for_claude(self):
        ai.set_model("sonnet", "high", actor=None)
        self.assertEqual(ai.model_choice(), {"provider": "claude_cli", "model": "sonnet", "effort": "high", "source": "database"})
        ai.set_model("haiku", "low", actor=None)  # одна строка на сервер
        self.assertEqual(AiModelSetting.objects.count(), 1)
        self.assertEqual(ai.model_choice()["model"], "haiku")

    @override_settings(RECEIPT_OCR_PROVIDER="codex_cli", RECEIPT_OCR_MODEL="gpt-6.1-sol")
    def test_codex_keeps_its_own_model(self):
        ai.set_model("sonnet", "high", actor=None)
        self.assertEqual(ai.model_choice(), {"provider": "codex_cli", "model": "gpt-6.1-sol", "effort": "medium", "source": "settings"})

    def test_rejects_unknown_values(self):
        for model, effort in (("gpt-6.1-sol", "medium"), ("sonnet", "max"), ("", "low")):
            with self.assertRaises(ValueError):
                ai.set_model(model, effort, actor=None)
        self.assertEqual(AiModelSetting.objects.count(), 0)


@tag("integration")
@override_settings(RECEIPT_OCR_PROVIDER="claude_cli", RECEIPT_OCR_CLAUDE_EXECUTABLE="nonexistent-checkist-claude",
                   RECEIPT_OCR_MODEL="claude-opus-5-5", RECEIPT_OCR_CLAUDE_EFFORT="medium")
class ProviderUsesTheChoiceTests(TestCase):
    def test_the_dynamic_config_reads_the_row_at_each_call(self):
        ai.set_model("haiku", "low", actor=None)
        provider = ClaudeCLIProvider(config=ClaudeConfig.from_settings())
        seen = {}

        def argv(executable, model, effort, *rest):
            seen.update(model=model, effort=effort)
            raise ProviderError("configuration_error")

        with mock.patch("recognition.providers.claude_cli.shutil.which", return_value="/usr/bin/claude"), \
                mock.patch("recognition.providers.claude_cli.build_argv", side_effect=argv), self.assertRaises(ProviderError):
            provider._invoke("text", "{}", None, mock.Mock())
        self.assertEqual(seen, {"model": "haiku", "effort": "low"})

    def test_an_explicit_config_is_fixed(self):
        ai.set_model("haiku", "low", actor=None)
        config = ClaudeConfig(executable="nonexistent-checkist-claude", model="sonnet", temp_root=Path("/tmp/x").resolve())
        self.assertFalse(config.dynamic)
        self.assertEqual(ClaudeCLIProvider(config=config).model_name, "sonnet")
        self.assertEqual(ClaudeCLIProvider(config=ClaudeConfig.from_settings()).model_name, "haiku")


@tag("integration")
@accounts_mode()
@override_settings(RECEIPT_OCR_PROVIDER="claude_cli", RECEIPT_OCR_MODEL="claude-opus-5-5", RECEIPT_OCR_CLAUDE_EFFORT="medium")
class AiModelApiTests(IsolationMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.staff = make_user("synthetic-staff", is_staff=True)

    def patch(self, account, body):
        return self.client_of(account, csrf=True).patch(URL, json.dumps(body), content_type="application/json")

    def test_only_staff_sees_and_changes_the_model(self):
        shown = self.client_of(self.staff).get("/api/family/").json()["ai_model"]
        self.assertEqual(shown, {"provider": "claude_cli", "model": "claude-opus-5-5", "effort": "medium", "source": "settings",
                                 "models": ["opus", "sonnet", "haiku"], "efforts": ["low", "medium", "high"]})
        self.assertNotIn("ai_model", self.client_of(self.first).get("/api/family/").json())
        changed = self.patch(self.staff, {"model": "sonnet", "effort": "high"})
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(changed.json()["ai_model"]["model"], "sonnet")
        self.assertEqual(changed.json()["ai_model"]["source"], "database")
        row = AiModelSetting.objects.get()
        self.assertEqual((row.model, row.effort, row.updated_by_id), ("sonnet", "high", self.staff.pk))
        refused = self.patch(self.first, {"model": "haiku", "effort": "low"})
        self.assertEqual((refused.status_code, refused.json()["error"]["code"]), (403, "staff_only"))
        self.assertEqual(AiModelSetting.objects.get().model, "sonnet")

    def test_rejects_bad_values_by_field(self):
        bad = self.patch(self.staff, {"model": "gpt-6.1-sol", "effort": "max"})
        self.assertEqual(bad.status_code, 400, bad.content)
        self.assertEqual(sorted(bad.json()["error"]["fields"]), ["effort", "model"])
        self.assertEqual(AiModelSetting.objects.count(), 0)
