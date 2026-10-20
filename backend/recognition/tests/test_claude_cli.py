"""Провайдер `claude_cli`: argv, stdin, окружение, грамматика событий и дисциплина вызова.

Настоящий `claude` здесь никогда не запускается: подменённый supervisor либо
Python-скрипт-заменитель, печатающий поток событий.
"""
import base64
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.test import SimpleTestCase, override_settings
from PIL import Image

from recognition.dto import PreparedImage, PreparedReceiptImage
from recognition.process_supervisor import ProcessResult
from recognition.providers import ProviderError, RunContext, get_provider
from recognition.providers.claude_cli import (
    API_IMAGE_MAX_BASE64_BYTES, MODEL_IMAGE_LONG_EDGE, SYSTEM_PROMPT, ClaudeCLIProvider, ClaudeConfig, build_argv, build_stdin,
    claude_child_environment, validate_events,
)
from recognition.providers.fake import detection_payload, receipt_payload

SCHEMA = (settings.BASE_DIR / "recognition" / "schemas" / "detect.schema.json").read_text(encoding="utf-8")


def init_event():
    return {"type": "system", "subtype": "init", "tools": ["StructuredOutput"], "model": "claude-opus-5-5"}


def result_event(payload, **overrides):
    event = {"type": "result", "subtype": "success", "is_error": False, "terminal_reason": "completed",
             "structured_output": payload, "result": json.dumps(payload), "errors": None, "num_turns": 1,
             "total_cost_usd": 0.001}
    event.update(overrides)
    return event


def tool_use(name="StructuredOutput"):
    return {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "name": name, "input": {}}]}}


def events_for(payload):
    return [init_event(), tool_use(),
            {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": "ok"}]}},
            result_event(payload)]


def stream(events):
    return b"\n".join(json.dumps(e).encode("utf-8") for e in events)


def noise_png(path, size=(1500, 1100)):
    # Несжимаемый PNG: 1500 x 1100 x 3 байта — больше предела API в base64, сторона в пределах.
    Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3)).save(path, format="PNG")
    return path


def sent_image(block):
    data = base64.b64decode(block["source"]["data"])
    with Image.open(io.BytesIO(data)) as decoded:
        return decoded.format, decoded.size, len(block["source"]["data"])


class StubProcess:
    def __init__(self, test, *, payload=None, mode="success", events=None, code=0, stderr=b"", stdout=None):
        self.test, self.payload, self.mode = test, payload, mode
        self.events, self.code, self.stderr, self.stdout = events, code, stderr, stdout
        self.calls = []

    def run(self, argv, *, cwd, env, stdin, run, output_path):
        self.calls.append((argv, cwd, env, stdin))
        self.test.assertIsNone(output_path)
        self.test.assertTrue(Path(cwd).is_dir())
        json.loads(argv[argv.index("--json-schema") + 1])  # a JSON Schema string, not a path
        if self.mode == "timeout":
            raise ProviderError("timeout")
        if self.mode == "cancelled":
            raise ProviderError("cancelled")
        if self.mode == "late":
            time.sleep(0.02)
        events = self.events if self.events is not None else events_for(self.payload)
        stdout = self.stdout if self.stdout is not None else stream(events)
        return ProcessResult(self.code, stdout, self.stderr)


class ArgvStdinEnvironmentTests(SimpleTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="checkist-claude-io-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_argv_is_exactly_the_verified_flag_list(self):
        self.assertEqual(
            build_argv("/usr/local/bin/claude", "claude-opus-5-5", "high", '{"type":"object"}', "0.50", "системная строка"),
            ["/usr/local/bin/claude", "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose",
             "--json-schema", '{"type":"object"}', "--model", "claude-opus-5-5", "--effort", "high",
             "--tools", "", "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config",
             "--system-prompt", "системная строка", "--max-budget-usd", "0.50"],
        )
        self.assertNotIn("--bare", build_argv("claude", "m", "low", "{}", "1", "s"))
        self.assertNotIn("--setting-sources", build_argv("claude", "m", "low", "{}", "1", "s"))

    def test_stdin_is_one_jsonl_line_with_the_image_before_the_text(self):
        for suffix, fmt, media_type in (("png", "PNG", "image/png"), ("jpg", "JPEG", "image/jpeg"), ("webp", "WEBP", "image/webp")):
            with self.subTest(fmt=fmt):
                path = self.root / f"снимок.{suffix}"
                Image.new("RGB", (8, 6), "white").save(path, format=fmt)
                raw = build_stdin("Промпт «чек»", path)
                self.assertTrue(raw.endswith(b"\n"))
                lines = raw.decode("utf-8").splitlines()
                self.assertEqual(len(lines), 1)
                message = json.loads(lines[0])
                self.assertEqual((message["type"], message["message"]["role"]), ("user", "user"))
                image, text = message["message"]["content"]
                self.assertEqual(image["type"], "image")
                self.assertEqual(image["source"]["type"], "base64")
                self.assertEqual(image["source"]["media_type"], media_type)
                self.assertEqual(base64.b64decode(image["source"]["data"]), path.read_bytes())
                self.assertEqual(text, {"type": "text", "text": "Промпт «чек»"})
        message = json.loads(build_stdin("Только текст\nвторая строка").decode("utf-8"))
        self.assertEqual(message["message"]["content"], [{"type": "text", "text": "Только текст\nвторая строка"}])
        broken = self.root / "broken.png"
        broken.write_bytes(b"not an image")
        with self.assertRaises(ProviderError) as raised:
            build_stdin("x", broken)
        self.assertEqual(raised.exception.code, "invalid_input")

    def test_images_over_the_api_limits_are_sent_as_a_bounded_jpeg(self):
        # Over the byte limit, within the side limit: same dimensions, JPEG, base64 within the limit.
        heavy = noise_png(self.root / "heavy.png")
        self.assertGreater(len(base64.b64encode(heavy.read_bytes())), API_IMAGE_MAX_BASE64_BYTES)
        image, text = json.loads(build_stdin("Промпт", heavy).decode("utf-8"))["message"]["content"]
        self.assertEqual(image["source"]["media_type"], "image/jpeg")
        fmt, size, encoded = sent_image(image)
        self.assertEqual((fmt, size), ("JPEG", (1500, 1100)))
        self.assertLessEqual(encoded, API_IMAGE_MAX_BASE64_BYTES)
        self.assertEqual(text, {"type": "text", "text": "Промпт"})
        # Over the side limit: downscaled to the model's long edge, aspect kept.
        wide = self.root / "wide.png"
        Image.new("L", (8001, 10), "white").save(wide, format="PNG")
        image, _ = json.loads(build_stdin("x", wide).decode("utf-8"))["message"]["content"]
        self.assertEqual(image["source"]["media_type"], "image/jpeg")
        fmt, size, _ = sent_image(image)
        self.assertEqual((fmt, size), ("JPEG", (MODEL_IMAGE_LONG_EDGE, 3)))
        # Exactly at the side limit and small: sent as is.
        edge = self.root / "edge.png"
        Image.new("L", (8000, 2), "white").save(edge, format="PNG")
        image, _ = json.loads(build_stdin("x", edge).decode("utf-8"))["message"]["content"]
        self.assertEqual(image["source"]["media_type"], "image/png")
        self.assertEqual(base64.b64decode(image["source"]["data"]), edge.read_bytes())
        # Not even the lowest quality fits: fail closed, never retry.
        with patch("recognition.providers.claude_cli.API_IMAGE_MAX_BASE64_BYTES", 64), self.assertRaises(ProviderError) as raised:
            build_stdin("x", heavy)
        self.assertEqual((raised.exception.code, raised.exception.retryable), ("invalid_input", False))

    def test_child_environment_allowlist_passes_sign_in_and_drops_secrets(self):
        with patch.dict(os.environ, {"CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-token", "ANTHROPIC_API_KEY": "key",
                                     "CLAUDE_CONFIG_DIR": "/srv/claude", "CODEX_HOME": "/srv/codex", "HOME": "/home/x",
                                     "POSTGRES_PASSWORD": "secret", "OPENAI_API_KEY": "secret", "DB_PASSWORD": "secret",
                                     "DJANGO_SECRET_KEY": "secret", "ORCA_DISPATCH_ID": "secret"}):
            env = claude_child_environment()
            self.assertEqual(env["CLAUDE_CODE_OAUTH_TOKEN"], "sk-ant-oat01-token")
            self.assertEqual(env["ANTHROPIC_API_KEY"], "key")
            self.assertEqual(env["CLAUDE_CONFIG_DIR"], "/srv/claude")
            self.assertEqual(env["HOME"], "/home/x")
            for key in ("POSTGRES_PASSWORD", "OPENAI_API_KEY", "DB_PASSWORD", "DJANGO_SECRET_KEY", "ORCA_DISPATCH_ID"):
                self.assertNotIn(key, env)
            self.assertEqual((env["DISABLE_AUTOUPDATER"], env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"], env["DISABLE_TELEMETRY"]),
                             ("1", "1", "1"))
            self.assertEqual(claude_child_environment("/var/lib/claude")["CLAUDE_CONFIG_DIR"], "/var/lib/claude")
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(claude_child_environment(),
                             {"DISABLE_AUTOUPDATER": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "DISABLE_TELEMETRY": "1"})


class ValidateEventsTests(SimpleTestCase):
    payload = {"answer": [1, "два", None]}

    def check(self, events=None, *, code=0, stderr=b"", stdout=None):
        return validate_events(ProcessResult(code, stream(events) if stdout is None else stdout, stderr))

    def test_success_returns_structured_output_and_ignores_text_thinking_and_rate_limit_events(self):
        self.assertEqual(self.check(events_for(self.payload)), self.payload)
        chatty = [init_event(),
                  {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "…"},
                                                                                      {"type": "text", "text": "Готово"}]}},
                  {"type": "rate_limit_event", "rate_limit_info": {"status": "allowed"}},
                  tool_use(), result_event(self.payload)]
        self.assertEqual(self.check(chatty), self.payload)
        self.assertEqual(self.check([init_event(), result_event(self.payload)]), self.payload)

    def test_malformed_streams_are_invalid_output(self):
        cases = {
            "empty": [],
            "no_result": [init_event(), tool_use()],
            "no_system": [tool_use(), result_event(self.payload)],
            "system_not_first": [tool_use(), init_event(), result_event(self.payload)],
            "system_not_init": [{"type": "system", "subtype": "other"}, result_event(self.payload)],
            "two_systems": [init_event(), init_event(), result_event(self.payload)],
            "two_results": [init_event(), result_event(self.payload), result_event(self.payload)],
            "after_result": [init_event(), result_event(self.payload), tool_use()],
            "foreign_tool": [init_event(), tool_use("Bash"), result_event(self.payload)],
            "unknown_block": [init_event(), {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "image"}]}},
                              result_event(self.payload)],
            "user_without_tool_result": [init_event(), {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "x"}]}},
                                         result_event(self.payload)],
            "unknown_type": [init_event(), {"type": "new.unknown"}, result_event(self.payload)],
            "typeless": [init_event(), {"subtype": "init"}, result_event(self.payload)],
            "output_not_object": [init_event(), result_event([1, 2])],
        }
        for name, events in cases.items():
            with self.subTest(case=name), self.assertRaises(ProviderError) as raised:
                self.check(events)
            self.assertEqual(raised.exception.code, "invalid_output")
            self.assertFalse(raised.exception.retryable)
        for stdout in (b"not-json", b'{"type":"system","type":"result"}', b"[]\n", stream([init_event()]) + b"\n{"):
            with self.subTest(stdout=stdout), self.assertRaises(ProviderError) as raised:
                self.check(stdout=stdout)
            self.assertEqual(raised.exception.code, "invalid_output")
        with self.assertRaises(ProviderError) as raised:
            self.check(stdout=b"x" * (8 * 1024 * 1024 + 1))
        self.assertEqual(raised.exception.code, "invalid_output")

    def test_missing_structured_output_keeps_the_model_text_privately(self):
        text = "Вот чек: {\"total\": \"4.42\"} private receipt"
        final = result_event(self.payload, result=text)
        del final["structured_output"]
        with self.assertRaises(ProviderError) as raised:
            self.check([init_event(), tool_use(), final])
        self.assertEqual(raised.exception.code, "invalid_output")
        self.assertEqual(raised.exception.private_output, text)
        self.assertNotIn("private receipt", str(raised.exception))
        final = result_event(self.payload, result="я" * 70_000)
        del final["structured_output"]
        with self.assertRaises(ProviderError) as raised:
            self.check([init_event(), final])
        self.assertLessEqual(len(raised.exception.private_output.encode("utf-8")), 64 * 1024)

    def test_error_results_are_normalized_without_private_text(self):
        cases = (
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "Not logged in · Please run /login private"},
             "auth_required"),
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "Invalid authentication credentials private"},
             "auth_required"),
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "OAuth token has expired private"},
             "auth_required"),
            ({"subtype": "error_max_budget_usd", "terminal_reason": "budget_exhausted", "result": "",
              "errors": ["Reached maximum budget ($0.05) private"]}, "configuration_error"),
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "You've hit your limit · resets 3pm private"},
             "rate_limited"),
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "API Error: 429 rate_limit_error private"},
             "rate_limited"),
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "API Error: 529 overloaded_error private"},
             "rate_limited"),
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "API Error: status 529 private"},
             "rate_limited"),
            # Bare digits are not a status: a request id or a cost is not a rate limit.
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "req_0529 failed, cost $0.0529 private"},
             "provider_unavailable"),
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "Connection failed: error sending request private"},
             "network_unavailable"),
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "Invalid --json-schema private"},
             "configuration_error"),
            ({"subtype": "error_during_execution", "terminal_reason": "api_error", "result": "unknown upstream private"},
             "provider_unavailable"),
            ({"is_error": True, "result": "unknown upstream private"}, "provider_unavailable"),
            ({"terminal_reason": "interrupted", "result": "private"}, "provider_unavailable"),
            # Each condition alone, with is_error false: a non-success subtype, a non-completed terminal reason.
            ({"is_error": False, "subtype": "error_during_execution", "result": "private"}, "provider_unavailable"),
            ({"is_error": False, "terminal_reason": "interrupted", "result": "private"}, "provider_unavailable"),
        )
        for overrides, expected in cases:
            final = result_event(self.payload, **overrides)
            final.setdefault("is_error", True)
            with self.subTest(expected=expected, overrides=overrides), self.assertRaises(ProviderError) as raised:
                self.check([init_event(), final])
            self.assertEqual(raised.exception.code, expected)
            self.assertNotIn("private", str(raised.exception))
            self.assertIsNone(raised.exception.private_output)
        # A refused rate limit event turns an otherwise unknown failure into rate_limited.
        throttled = [init_event(), {"type": "rate_limit_event", "rate_limit_info": {"status": "rejected"}},
                     result_event(self.payload, is_error=True, subtype="error_during_execution", terminal_reason="api_error",
                                  result="Request failed private")]
        with self.assertRaises(ProviderError) as raised:
            self.check(throttled)
        self.assertEqual(raised.exception.code, "rate_limited")
        # A nonzero exit without a result event is read from stderr, never as auth or cancellation.
        for stderr, expected in ((b"error: unknown option '--json-schema' private", "configuration_error"),
                                 (b"segmentation fault private", "provider_unavailable")):
            with self.subTest(stderr=stderr), self.assertRaises(ProviderError) as raised:
                self.check([], code=2, stderr=stderr)
            self.assertEqual(raised.exception.code, expected)
            self.assertNotIn("private", str(raised.exception))
        with self.assertRaises(ProviderError) as raised:
            self.check(events_for(self.payload), code=1, stderr=b"")
        self.assertEqual(raised.exception.code, "provider_unavailable")


class ProviderTests(SimpleTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="checkist-claude-provider-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        path = self.root / "снимок с пробелом.png"
        Image.new("RGB", (80, 110), "white").save(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        self.image = PreparedImage(path, digest, 80, 110)
        self.crop = PreparedReceiptImage(path, digest, 80, 110, position=1)
        self.config = ClaudeConfig(sys.executable, "claude-opus-5-5", self.root / "scratch")

    def run_context(self, **kwargs):
        return RunContext(time.monotonic() + 5, **kwargs)

    def provider(self, **kwargs):
        kwargs.setdefault("payload", detection_payload(self.image))
        stub = StubProcess(self, **kwargs)
        return ClaudeCLIProvider(config=self.config, supervisor=stub), stub

    def message(self, stub, call=0):
        return json.loads(stub.calls[call][3].decode("utf-8"))["message"]["content"]

    def test_detect_argv_stdin_isolation_and_cleanup(self):
        stages = []
        provider, stub = self.provider()
        with patch.dict(os.environ, {"POSTGRES_PASSWORD": "secret", "ORCA_DISPATCH_ID": "secret", "OPENAI_API_KEY": "secret",
                                     "CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-token"}):
            self.assertEqual(provider.detect(self.image, self.run_context(on_stage=stages.append)).receipt_count, 2)
            self.assertEqual(provider.detect(self.image, self.run_context()).receipt_count, 2)
        self.assertEqual(stages, ["detect"])
        argv, work, env, stdin = stub.calls[0]
        self.assertNotEqual(work, stub.calls[1][1])
        self.assertFalse(work.exists())
        self.assertTrue(work.is_relative_to(self.config.temp_root.resolve()))
        self.assertEqual(list(self.config.temp_root.iterdir()), [])
        self.assertEqual(argv, build_argv(sys.executable, "claude-opus-5-5", "medium", argv[argv.index("--json-schema") + 1], "2.00", SYSTEM_PROMPT))
        self.assertEqual(json.loads(argv[argv.index("--json-schema") + 1]), json.loads(SCHEMA))
        image, text = self.message(stub)
        self.assertEqual(image["source"]["media_type"], "image/png")
        self.assertEqual(base64.b64decode(image["source"]["data"]), self.image.path.read_bytes())
        self.assertIn("80 x 110", text["text"])
        for key in ("POSTGRES_PASSWORD", "ORCA_DISPATCH_ID", "OPENAI_API_KEY"):
            self.assertNotIn(key, env)
        self.assertEqual(env["CLAUDE_CODE_OAUTH_TOKEN"], "sk-ant-oat01-token")

    def test_recognize_decimal_total_and_signed_rotation(self):
        provider, stub = self.provider(payload=receipt_payload())
        observation = provider.recognize(replace(self.crop, rotation_degrees=-12), self.run_context())
        self.assertEqual(str(observation.total), "4.42")
        _, text = self.message(stub)
        self.assertIn("schema v2", text["text"])
        self.assertIn("rotation_degrees=-12", text["text"])
        self.assertIn('"schema_version"', stub.calls[0][0][stub.calls[0][0].index("--json-schema") + 1])
        for angle in (True, float("nan"), 270):
            provider, stub = self.provider(payload=receipt_payload())
            with self.subTest(angle=angle), self.assertRaises(ProviderError) as raised:
                provider.recognize(replace(self.crop, rotation_degrees=angle), self.run_context())
            self.assertEqual((raised.exception.code, stub.calls), ("invalid_input", []))

    def test_invalid_payloads_are_invalid_output_with_private_fragment(self):
        for payload in ({"total": 4.42}, {**detection_payload(self.image), "receipts": "no"}):
            provider, _ = self.provider(payload=payload)
            with self.subTest(payload=payload), self.assertRaises(ProviderError) as raised:
                provider.detect(self.image, self.run_context())
            self.assertEqual((raised.exception.code, raised.exception.retryable), ("invalid_output", False))
            self.assertIsInstance(raised.exception.private_output, str)
            self.assertIn("4.42" if "total" in payload else '"no"', raised.exception.private_output)
        provider, _ = self.provider(payload={"total": "4.42"})
        with self.assertRaises(ProviderError) as raised:
            provider.recognize(self.crop, self.run_context())
        self.assertEqual(raised.exception.code, "invalid_output")

    def test_oversized_prepared_image_is_sent_bounded_and_checked_against_its_own_dimensions(self):
        path = noise_png(self.root / "heavy.png")
        image = PreparedImage(path, hashlib.sha256(path.read_bytes()).hexdigest(), 1500, 1100)
        provider, stub = self.provider(payload=detection_payload(image))
        self.assertEqual(provider.detect(image, self.run_context()).receipt_count, 2)
        block, text = self.message(stub)
        self.assertEqual(block["source"]["media_type"], "image/jpeg")
        fmt, size, encoded = sent_image(block)
        self.assertEqual((fmt, size), ("JPEG", (1500, 1100)))
        self.assertLessEqual(encoded, API_IMAGE_MAX_BASE64_BYTES)
        self.assertIn("1500 x 1100", text["text"])
        self.assertEqual(list(self.config.temp_root.iterdir()), [])
        provider, stub = self.provider(payload=detection_payload(image))
        with patch("recognition.providers.claude_cli.API_IMAGE_MAX_BASE64_BYTES", 64), self.assertRaises(ProviderError) as raised:
            provider.detect(image, self.run_context())
        self.assertEqual((raised.exception.code, raised.exception.retryable, stub.calls), ("invalid_input", False, []))

    def test_too_many_receipts_has_fixed_domain_hint(self):
        for payload in (detection_payload(self.image, 11), {**detection_payload(self.image, 0), "warnings": ["too_many_receipts"]}):
            provider, _ = self.provider(payload=payload)
            with self.subTest(count=payload["receipt_count"]), self.assertRaises(ProviderError) as raised:
                provider.detect(self.image, self.run_context())
            self.assertEqual((raised.exception.code, raised.exception.reason), ("invalid_output", "too_many_receipts"))

    def test_error_events_and_exit_codes_are_normalized(self):
        failing = result_event(None, is_error=True, subtype="error_during_execution", terminal_reason="api_error",
                               result="Not logged in · Please run /login private receipt")
        provider, _ = self.provider(events=[init_event(), failing])
        with self.assertRaises(ProviderError) as raised:
            provider.detect(self.image, self.run_context())
        self.assertEqual(raised.exception.code, "auth_required")
        self.assertNotIn("private receipt", str(raised.exception))
        provider, _ = self.provider(events=[], code=2, stderr=b"error: unknown option '--effort' private receipt")
        with self.assertRaises(ProviderError) as raised:
            provider.detect(self.image, self.run_context())
        self.assertEqual(raised.exception.code, "configuration_error")
        provider, _ = self.provider(events=[init_event(), tool_use("Read"), result_event(detection_payload(self.image))])
        with self.assertRaises(ProviderError) as raised:
            provider.detect(self.image, self.run_context())
        self.assertEqual(raised.exception.code, "invalid_output")

    def test_cancellation_timeout_and_late_completion_override_zero_exit(self):
        for mode, code in (("cancelled", "cancelled"), ("timeout", "timeout"), ("late", "timeout")):
            provider, _ = self.provider(mode=mode)
            run = RunContext(time.monotonic() + (0.01 if mode == "late" else 2))
            with self.subTest(mode=mode), self.assertRaises(ProviderError) as raised:
                provider.detect(self.image, run)
            self.assertEqual(raised.exception.code, code)
        provider, stub = self.provider()
        with self.assertRaises(ProviderError) as raised:
            provider.detect(self.image, self.run_context(is_cancelled=lambda: True))
        self.assertEqual((raised.exception.code, stub.calls), ("cancelled", []))

    def test_input_and_configuration_are_checked_before_spawn(self):
        provider, stub = self.provider()
        with self.assertRaises(ProviderError) as raised:
            provider.detect(PreparedImage(self.image.path, "a" * 64, 80, 110), self.run_context())
        self.assertEqual((raised.exception.code, stub.calls), ("invalid_input", []))
        missing = ClaudeCLIProvider(config=replace(self.config, executable="nonexistent-checkist-claude"), supervisor=stub)
        with self.assertRaises(ProviderError) as raised:
            missing.detect(self.image, self.run_context())
        self.assertEqual(raised.exception.code, "configuration_error")
        with override_settings(MEDIA_ROOT=self.root), self.assertRaises(ProviderError) as raised:
            provider.detect(self.image, self.run_context())
        self.assertEqual((raised.exception.code, stub.calls), ("configuration_error", []))

    def test_invalid_configuration_is_normalized(self):
        for kwargs in ({"model": None}, {"model": ""}, {"temp_root": Path("relative")}, {"config_dir": "relative"},
                       {"effort": "max"}, {"effort": ""}, {"max_budget_usd": "0"}, {"max_budget_usd": "1.234"},
                       {"max_budget_usd": "-1"}, {"max_budget_usd": "много"}, {"max_budget_usd": 2.0},
                       {"detect_timeout_seconds": float("nan")}, {"recognize_timeout_seconds": False}, {"cancel_grace_seconds": -1}):
            values = {**self.config.__dict__, **kwargs}
            with self.subTest(kwargs=kwargs), self.assertRaises(ProviderError) as raised:
                ClaudeConfig(**values)
            self.assertEqual(raised.exception.code, "configuration_error")
        for budget in ("2", "0.05", "10.5"):
            self.assertEqual(ClaudeConfig(**{**self.config.__dict__, "max_budget_usd": budget}).max_budget_usd, budget)

    @override_settings(RECEIPT_OCR_PROVIDER="claude_cli", RECEIPT_OCR_CLAUDE_EXECUTABLE="nonexistent-checkist-claude",
                       RECEIPT_OCR_MODEL="sonnet", RECEIPT_OCR_CLAUDE_EFFORT="high", RECEIPT_OCR_CLAUDE_MAX_BUDGET_USD="0.75")
    def test_factory_and_settings(self):
        provider = get_provider()
        self.assertIsInstance(provider, ClaudeCLIProvider)
        self.assertEqual((provider.config.executable, provider.config.model, provider.config.effort, provider.config.max_budget_usd),
                         ("nonexistent-checkist-claude", "sonnet", "high", "0.75"))
        self.assertEqual(provider.config.temp_root, Path(settings.RECEIPT_OCR_TEMP_ROOT))
        self.assertIsNone(provider.config.config_dir)  # only CLAUDE_CONFIG_DIR of the worker environment
        with self.assertRaises(ProviderError) as raised:
            provider.detect(self.image, self.run_context())
        self.assertEqual(raised.exception.code, "configuration_error")
        with override_settings(RECEIPT_OCR_CLAUDE_EFFORT="max"), self.assertRaises(ProviderError):
            get_provider()

    def test_adapter_with_real_supervised_substitute_process(self):
        # A safe Python stand-in that speaks the verified event stream, never an installed Claude invocation.
        payload = detection_payload(self.image)
        script = self.root / "substitute.py"
        script.write_text(
            "import base64, json, sys\n"
            "lines = sys.stdin.buffer.read().decode('utf-8').splitlines()\n"
            "assert len(lines) == 1\n"
            "image, text = json.loads(lines[0])['message']['content']\n"
            "assert image['source']['media_type'] == 'image/png' and base64.b64decode(image['source']['data'])[:8] == b'\\x89PNG\\r\\n\\x1a\\n'\n"
            "assert '80 x 110' in text['text']\n"
            "assert sys.argv[sys.argv.index('--tools') + 1] == ''\n"
            "assert sys.argv[sys.argv.index('--max-budget-usd') + 1] == '2.00'\n"
            "assert json.loads(sys.argv[sys.argv.index('--json-schema') + 1])['required']\n"
            "assert 'POSTGRES_PASSWORD' not in __import__('os').environ\n"
            f"print({json.dumps(json.dumps(init_event()))})\n"
            f"print({json.dumps(json.dumps(tool_use()))})\n"
            f"print({json.dumps(json.dumps(result_event(payload)))})\n",
            encoding="utf-8",
        )
        def substitute(*args):
            return [sys.executable, str(script), *build_argv(*args)[1:]]
        with patch("recognition.providers.claude_cli.build_argv", side_effect=substitute), \
                patch.dict(os.environ, {"POSTGRES_PASSWORD": "secret"}):
            provider = ClaudeCLIProvider(config=self.config)
            self.assertEqual(provider.detect(self.image, RunContext(time.monotonic() + 30)).to_dict(), payload)
        self.assertEqual(list(self.config.temp_root.iterdir()), [])


class TextCallTests(SimpleTestCase):
    """run_text: тот же вызов, что detect/recognize, без картинки и без знания схемы."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="checkist-claude-text-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.schema = self.root / "any.schema.json"
        self.schema.write_text('{"type": "object",\n "additionalProperties": false}', encoding="utf-8")
        self.config = ClaudeConfig(sys.executable, "claude-opus-5-5", self.root / "scratch", effort="low", max_budget_usd="0.50")

    def call(self, provider, **kwargs):
        kwargs.setdefault("run", RunContext(time.monotonic() + 5))
        return provider.run_text(prompt="Текст запроса\nINPUT JSON:\n{}", schema=self.schema, timeout_seconds=5, **kwargs)

    def provider(self, **kwargs):
        kwargs.setdefault("payload", {"answer": [1, "два", None]})
        stub = StubProcess(self, **kwargs)
        return ClaudeCLIProvider(config=self.config, supervisor=stub), stub

    def test_text_call_argv_stdin_schema_string_isolation_and_cleanup(self):
        stages = []
        provider, stub = self.provider()
        with patch.dict(os.environ, {"POSTGRES_PASSWORD": "secret", "ORCA_DISPATCH_ID": "secret", "OPENAI_API_KEY": "secret"}):
            run = RunContext(time.monotonic() + 5, on_stage=stages.append)
            self.assertEqual(self.call(provider, run=run), {"answer": [1, "два", None]})
            self.call(provider, stage="other")
        self.assertEqual(stages, ["classify"])
        argv, work, env, stdin = stub.calls[0]
        self.assertNotEqual(work, stub.calls[1][1])
        self.assertFalse(work.exists())
        self.assertTrue(work.is_relative_to(self.config.temp_root.resolve()))
        self.assertEqual(argv, build_argv(sys.executable, "claude-opus-5-5", "low", '{"type": "object", "additionalProperties": false}',
                                          "0.50", SYSTEM_PROMPT))
        message = json.loads(stdin.decode("utf-8"))
        self.assertEqual(message["message"]["content"], [{"type": "text", "text": "Текст запроса\nINPUT JSON:\n{}"}])
        for key in ("POSTGRES_PASSWORD", "ORCA_DISPATCH_ID", "OPENAI_API_KEY"):
            self.assertNotIn(key, env)

    def test_events_are_checked_as_for_an_image_call(self):
        for events in ([], [init_event()], [init_event(), result_event({"a": 1}), result_event({"a": 1})],
                       [init_event(), tool_use("Bash"), result_event({"a": 1})], [{"type": "new.unknown"}]):
            provider, _ = self.provider(events=events)
            with self.subTest(events=events), self.assertRaises(ProviderError) as raised:
                self.call(provider)
            self.assertEqual(raised.exception.code, "invalid_output")
        provider, _ = self.provider(stdout=b"not-json")
        with self.assertRaises(ProviderError) as raised:
            self.call(provider)
        self.assertEqual(raised.exception.code, "invalid_output")
        final = result_event(None, result="plain text private")
        del final["structured_output"]
        provider, _ = self.provider(events=[init_event(), final])
        with self.assertRaises(ProviderError) as raised:
            self.call(provider)
        self.assertEqual((raised.exception.code, raised.exception.private_output), ("invalid_output", "plain text private"))
        self.assertNotIn("private", str(raised.exception))

    def test_provider_failures_are_normalized_without_private_text(self):
        for message, expected in (("Not logged in · Please run /login private text", "auth_required"),
                                  ("You've hit your limit private text", "rate_limited"),
                                  ("Connection failed: error sending request private text", "network_unavailable"),
                                  ("unknown upstream private text", "provider_unavailable")):
            final = result_event(None, is_error=True, subtype="error_during_execution", terminal_reason="api_error", result=message)
            provider, _ = self.provider(events=[init_event(), final])
            with self.subTest(expected=expected), self.assertRaises(ProviderError) as raised:
                self.call(provider)
            self.assertEqual(raised.exception.code, expected)
            self.assertNotIn("private text", str(raised.exception))
            self.assertIsNone(raised.exception.private_output)
        budget = result_event(None, is_error=True, subtype="error_max_budget_usd", terminal_reason="budget_exhausted",
                              result="", errors=["Reached maximum budget ($0.50) private text"])
        provider, _ = self.provider(events=[init_event(), budget])
        with self.assertRaises(ProviderError) as raised:
            self.call(provider)
        # The same call would overrun the same budget again: never retried.
        self.assertEqual((raised.exception.code, raised.exception.retryable), ("configuration_error", False))
        provider, _ = self.provider(events=[], code=2, stderr=b"error: unknown option private text")
        with self.assertRaises(ProviderError) as raised:
            self.call(provider)
        self.assertEqual(raised.exception.code, "configuration_error")

    def test_cancellation_timeout_and_late_completion(self):
        for mode, code in (("cancelled", "cancelled"), ("timeout", "timeout"), ("late", "timeout")):
            provider, _ = self.provider(mode=mode)
            run = RunContext(time.monotonic() + (0.01 if mode == "late" else 2))
            with self.subTest(mode=mode), self.assertRaises(ProviderError) as raised:
                self.call(provider, run=run)
            self.assertEqual(raised.exception.code, code)
        provider, stub = self.provider()
        with self.assertRaises(ProviderError) as raised:
            self.call(provider, run=RunContext(time.monotonic() + 5, is_cancelled=lambda: True))
        self.assertEqual((raised.exception.code, stub.calls), ("cancelled", []))
        provider, _ = self.provider(mode="late")
        with self.assertRaises(ProviderError) as raised:
            provider.run_text(prompt="x", schema=self.schema, timeout_seconds=0.01, run=RunContext(time.monotonic() + 5))
        self.assertEqual(raised.exception.code, "timeout")

    def test_invalid_call_and_configuration_before_spawn(self):
        provider, stub = self.provider()
        for prompt in ("", None, b"bytes"):
            with self.subTest(prompt=prompt), self.assertRaises(ProviderError) as raised:
                provider.run_text(prompt=prompt, schema=self.schema, timeout_seconds=5, run=RunContext(time.monotonic() + 5))
            self.assertEqual(raised.exception.code, "invalid_input")
        broken = self.root / "broken.schema.json"
        broken.write_text("{not json", encoding="utf-8")
        for schema in (self.root / "absent.json", broken):
            with self.subTest(schema=schema.name), self.assertRaises(ProviderError) as raised:
                provider.run_text(prompt="x", schema=schema, timeout_seconds=5, run=RunContext(time.monotonic() + 5))
            self.assertEqual(raised.exception.code, "configuration_error")
        for seconds in (0, -1, True, "many"):
            with self.subTest(seconds=seconds), self.assertRaises(ProviderError) as raised:
                provider.run_text(prompt="x", schema=self.schema, timeout_seconds=seconds, run=RunContext(time.monotonic() + 5))
            self.assertEqual(raised.exception.code, "configuration_error")
        missing = ClaudeCLIProvider(config=replace(self.config, executable="nonexistent-checkist-claude"), supervisor=stub)
        with self.assertRaises(ProviderError) as raised:
            self.call(missing)
        self.assertEqual(raised.exception.code, "configuration_error")
        with override_settings(MEDIA_ROOT=str(self.root)), self.assertRaises(ProviderError) as raised:
            self.call(provider)
        self.assertEqual((raised.exception.code, stub.calls), ("configuration_error", []))

    def test_text_call_with_real_supervised_substitute_process(self):
        # A safe Python stand-in, never an installed Claude invocation.
        script = self.root / "substitute.py"
        script.write_text(
            "import json, sys\n"
            "lines = sys.stdin.buffer.read().decode('utf-8').splitlines()\n"
            "(text,) = json.loads(lines[0])['message']['content']\n"
            "assert json.loads(sys.argv[sys.argv.index('--json-schema') + 1]) == {'type': 'object', 'additionalProperties': False}\n"
            "payload = {'echo': text['text']}\n"
            f"print({json.dumps(json.dumps(init_event()))})\n"
            "print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'terminal_reason': 'completed',"
            " 'structured_output': payload, 'result': json.dumps(payload), 'errors': None}))\n",
            encoding="utf-8",
        )
        def substitute(*args):
            return [sys.executable, str(script), *build_argv(*args)[1:]]
        with patch("recognition.providers.claude_cli.build_argv", side_effect=substitute):
            provider = ClaudeCLIProvider(config=self.config)
            self.assertEqual(self.call(provider, run=RunContext(time.monotonic() + 30)), {"echo": "Текст запроса\nINPUT JSON:\n{}"})
        self.assertEqual(list(self.config.temp_root.iterdir()), [])


NAMES = ("RECEIPT_OCR_PROVIDER", "RECEIPT_OCR_MODEL", "RECEIPT_OCR_CLAUDE_EXECUTABLE",
         "RECEIPT_OCR_CLAUDE_EFFORT", "RECEIPT_OCR_CLAUDE_MAX_BUDGET_USD")


class ClaudeSettingsTests(SimpleTestCase):
    def load(self, **overrides):
        environment = os.environ.copy()
        for name in NAMES:
            environment.pop(name, None)
        environment.update(overrides)
        # The process environment and the defaults, independently of any local root .env.
        return subprocess.run(
            [sys.executable, "-X", "utf8", "-c",
             "from unittest.mock import patch\n"
             "with patch('dotenv.load_dotenv'):\n"
             "    import config.settings as s\n"
             f"    print(*[getattr(s, name) for name in {NAMES!r}])\n"],
            cwd=settings.BASE_DIR, env=environment, capture_output=True, text=True, encoding="utf-8", timeout=30,
        )

    def test_defaults_follow_the_provider(self):
        result = self.load()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.split(), ["codex_cli", "gpt-6.1-sol", "claude", "medium", "2.00"])
        result = self.load(RECEIPT_OCR_PROVIDER="claude_cli")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.split(), ["claude_cli", "claude-opus-5-5", "claude", "medium", "2.00"])
        result = self.load(RECEIPT_OCR_PROVIDER="claude_cli", RECEIPT_OCR_MODEL="sonnet", RECEIPT_OCR_CLAUDE_EXECUTABLE="/usr/local/bin/claude",
                           RECEIPT_OCR_CLAUDE_EFFORT="high", RECEIPT_OCR_CLAUDE_MAX_BUDGET_USD="0.5")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.split(), ["claude_cli", "sonnet", "/usr/local/bin/claude", "high", "0.5"])

    def test_invalid_values_are_rejected_at_settings_load(self):
        for name, values in (("RECEIPT_OCR_PROVIDER", ("openai", "claude", "")),
                             ("RECEIPT_OCR_CLAUDE_EFFORT", ("max", "Medium", "")),
                             ("RECEIPT_OCR_CLAUDE_MAX_BUDGET_USD", ("0", "0.00", "-1", "1.234", "много", ".5", ""))):
            for value in values:
                with self.subTest(name=name, value=value):
                    result = self.load(**{name: value})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("ImproperlyConfigured", result.stderr)
                    self.assertIn(name, result.stderr)
