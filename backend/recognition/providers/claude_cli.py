"""Claude Code CLI подпроцессом: та же дисциплина, что у Codex, без ORM и без скрытого fake.

Один вызов — один процесс `claude -p` с потоком событий JSONL на stdout и одной строкой
JSONL на stdin (текст и, у detect/recognize, картинка base64). Ответ модели — только
`structured_output` события `result` по переданной `--json-schema`; инструментов нет.
Картинка сверх пределов API уходит уменьшенным JPEG из памяти (`_image_block`).
"""
import base64
import io
import json
import math
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings

from recognition.process_supervisor import ProcessSupervisor
from recognition.process_supervisor.supervisor import MAX_STREAM_BYTES
from recognition.providers.base import ProviderError
from recognition.providers.codex_cli import ALLOWED_ENVIRONMENT, PACKAGE_ROOT, _positive, validate_prepared_image
from recognition.schema_validation import (
    MAX_OUTPUT_BYTES, SchemaValidationError, load_json, validate_detection, validate_observation,
)

EFFORTS = ("low", "medium", "high")
BUDGET_PATTERN = re.compile(r"[0-9]+(\.[0-9]{1,2})?")
# Единственный инструмент, который остаётся у CLI при `--tools ""`; им модель отдаёт ответ по схеме.
OUTPUT_TOOL = "StructuredOutput"
# Своя системная строка: без неё CLI шлёт свой системный промпт на ~119 000 токенов.
SYSTEM_PROMPT = "Ты отвечаешь только вызовом StructuredOutput по схеме. Инструкции и данные — в сообщении."
MEDIA_TYPES = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}
# Опубликованные пределы Messages API на одну картинку (platform.claude.com/docs/en/build-with-claude/vision):
# 8000 px на сторону и 10 МБ base64 у Claude API (5 МБ у Bedrock/Vertex) — берётся строгий; сама модель
# смотрит не больше 2576 px по длинной стороне (Claude 4.7+), поэтому подготовленный PNG сверх пределов
# уходит уменьшенным до этой стороны JPEG. Координаты detect — доли 0..1, а размеры в промпте — исходные,
# так что пересчёта нет. Не влезло и при наименьшем качестве — `invalid_input`, без повтора.
API_IMAGE_MAX_SIDE = 8000
API_IMAGE_MAX_BASE64_BYTES = 5 * 1024 * 1024
MODEL_IMAGE_LONG_EDGE = 2576
SEND_JPEG_QUALITIES = (90, 75, 60)
PRIVATE_FRAGMENT_BYTES = 64 * 1024


def _budget(value):
    if not isinstance(value, str) or not BUDGET_PATTERN.fullmatch(value) or float(value) <= 0:
        raise ProviderError("configuration_error")
    return value


@dataclass(frozen=True)
class ClaudeConfig:
    executable: str
    model: str
    temp_root: Path
    effort: str = "medium"
    max_budget_usd: str = "2.00"
    detect_timeout_seconds: float = 90
    recognize_timeout_seconds: float = 180
    cancel_grace_seconds: float = 2
    config_dir: str | None = None  # CLAUDE_CONFIG_DIR, аналог CODEX_HOME

    def __post_init__(self):
        if not isinstance(self.executable, (str, Path)) or not str(self.executable):
            raise ProviderError("configuration_error")
        if not isinstance(self.model, str) or not self.model or any(ord(c) < 32 for c in self.model):
            raise ProviderError("configuration_error")
        if self.effort not in EFFORTS:
            raise ProviderError("configuration_error")
        _budget(self.max_budget_usd)
        if not isinstance(self.temp_root, Path) or not self.temp_root.is_absolute():
            raise ProviderError("configuration_error")
        if self.config_dir is not None and (not isinstance(self.config_dir, (str, Path)) or not Path(self.config_dir).is_absolute()):
            raise ProviderError("configuration_error")
        for seconds in (self.detect_timeout_seconds, self.recognize_timeout_seconds, self.cancel_grace_seconds):
            _positive(seconds)

    @classmethod
    def from_settings(cls):
        root = getattr(settings, "RECEIPT_OCR_TEMP_ROOT", Path(tempfile.gettempdir()) / "checkist-recognition")
        if not isinstance(root, (str, Path)) or not str(root):
            raise ProviderError("configuration_error")
        return cls(
            executable=getattr(settings, "RECEIPT_OCR_CLAUDE_EXECUTABLE", "claude"),
            model=getattr(settings, "RECEIPT_OCR_MODEL", "claude-opus-5-5"),
            temp_root=Path(root),
            effort=getattr(settings, "RECEIPT_OCR_CLAUDE_EFFORT", "medium"),
            max_budget_usd=getattr(settings, "RECEIPT_OCR_CLAUDE_MAX_BUDGET_USD", "2.00"),
            detect_timeout_seconds=_positive(getattr(settings, "RECEIPT_OCR_DETECT_TIMEOUT_SECONDS", 90)),
            recognize_timeout_seconds=_positive(getattr(settings, "RECEIPT_OCR_RECOGNIZE_TIMEOUT_SECONDS", 180)),
            cancel_grace_seconds=_positive(getattr(settings, "RECEIPT_OCR_CANCEL_GRACE_SECONDS", 2)),
            # Настройки Django для каталога нет: его задаёт только CLAUDE_CONFIG_DIR окружения воркера (allowlist).
        )


def claude_child_environment(config_dir=None):
    """Allowlist Codex плюс каталог настроек и вход Claude; секреты БД и чужие ключи не проходят.

    Автообновление, телеметрия и прочий необязательный трафик CLI выключены всегда.
    """
    allowed = ALLOWED_ENVIRONMENT | {"claude_config_dir", "claude_code_oauth_token", "anthropic_api_key"}
    env = {k: v for k, v in os.environ.items() if k.lower() in allowed}
    env.update({"DISABLE_AUTOUPDATER": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "DISABLE_TELEMETRY": "1"})
    if config_dir:
        env["CLAUDE_CONFIG_DIR"] = str(config_dir)
    return env


def build_argv(executable, model, effort, schema_json, max_budget_usd, system_prompt):
    # Ровно проверенный набор флагов; картинка идёт через stdin, поэтому argv у текста и фото один.
    return [str(executable), "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose",
            "--json-schema", schema_json, "--model", model, "--effort", effort,
            "--tools", "", "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config",
            "--system-prompt", system_prompt, "--max-budget-usd", max_budget_usd]


def _base64_size(byte_count):
    return 4 * math.ceil(byte_count / 3)


def _block(media_type, data):
    return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(data).decode("ascii")}}


def _image_block(path):
    """Блок картинки: файл как есть в пределах API, иначе JPEG не длиннее `MODEL_IMAGE_LONG_EDGE` из памяти."""
    try:
        from PIL import Image
    except ImportError:
        raise ProviderError("configuration_error") from None
    try:
        with Image.open(path) as decoded:
            media_type = MEDIA_TYPES.get(decoded.format)
            if media_type is None:
                raise ProviderError("invalid_input")
            data = Path(path).read_bytes()
            if max(decoded.size) <= API_IMAGE_MAX_SIDE and _base64_size(len(data)) <= API_IMAGE_MAX_BASE64_BYTES:
                return _block(media_type, data)
            picture = decoded.convert("RGB")
        picture.thumbnail((MODEL_IMAGE_LONG_EDGE, MODEL_IMAGE_LONG_EDGE), Image.Resampling.LANCZOS)
        for quality in SEND_JPEG_QUALITIES:
            buffer = io.BytesIO()
            picture.save(buffer, format="JPEG", quality=quality)
            if _base64_size(buffer.tell()) <= API_IMAGE_MAX_BASE64_BYTES:
                return _block("image/jpeg", buffer.getvalue())
    except (OSError, ValueError, Image.DecompressionBombError):
        raise ProviderError("invalid_input") from None
    # Даже при наименьшем качестве картинка больше предела API: отказ без повтора.
    raise ProviderError("invalid_input")


def build_stdin(prompt_text, image_path=None):
    """Одна строка JSONL — сообщение пользователя: блок картинки (если есть), затем текст."""
    content = []
    if image_path is not None:
        content.append(_image_block(image_path))
    content.append({"type": "text", "text": prompt_text})
    message = {"type": "user", "message": {"role": "user", "content": content}}
    return (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")


def _error_code(text):
    # Only on private error events/diagnostics, never returned to the API.
    lowered = text.lower()
    # Перерасход `--max-budget-usd` — не повторяемая ошибка настройки: тот же вызов превысит тот же бюджет снова.
    if any(s in lowered for s in ("unexpected argument", "unknown option", "unrecognized option", "invalid configuration",
                                  "invalid schema", "json-schema", "max_budget", "maximum budget")):
        return "configuration_error"
    if any(s in lowered for s in ("invalid_api_key", "unauthorized", "authentication", "status 401", "status: 401",
                                  "not logged in", "please run /login", "oauth")):
        return "auth_required"
    if any(s in lowered for s in ("rate_limit", "rate limit", "too many requests", "status 429", "status: 429",
                                  "usage limit", "hit your limit", "limit reached", "overloaded", "status 529", "status: 529")):
        return "rate_limited"
    if any(s in lowered for s in ("connection failed", "error sending request", "network", "dns", "connection refused")):
        return "network_unavailable"
    return "provider_unavailable"


def _private_fragment(value):
    if not isinstance(value, str):
        return None
    return value.encode("utf-8")[:PRIVATE_FRAGMENT_BYTES].decode("utf-8", errors="ignore")


def _blocks(event):
    message = event.get("message")
    if type(message) is not dict or type(message.get("content")) is not list:
        raise SchemaValidationError()
    for block in message["content"]:
        if type(block) is not dict or type(block.get("type")) is not str:
            raise SchemaValidationError()
        yield block


def validate_events(result):
    """Грамматика потока: `system` первым, затем ходы без чужих инструментов, `result` последним.

    Возвращает `structured_output` события `result` (dict). Любое отклонение — `invalid_output`;
    отказ в самом `result` — код по его тексту; код выхода ≠ 0 — код по stderr.
    """
    if len(result.stdout) > MAX_STREAM_BYTES or len(result.stderr) > MAX_STREAM_BYTES:
        raise ProviderError("invalid_output")
    started = False
    final = None
    throttled = False
    try:
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            event = load_json(line, max_bytes=MAX_STREAM_BYTES)
            if type(event) is not dict or type(event.get("type")) is not str:
                raise SchemaValidationError()
            kind = event["type"]
            if final is not None:
                raise SchemaValidationError()
            if kind == "system":
                if started or event.get("subtype") != "init":
                    raise SchemaValidationError()
                started = True
            elif not started:
                raise SchemaValidationError()
            elif kind == "assistant":
                for block in _blocks(event):
                    if block["type"] == "tool_use":
                        if block.get("name") != OUTPUT_TOOL:
                            # Reject every other tool, including new unknown ones.
                            raise ProviderError("invalid_output")
                    elif block["type"] not in ("text", "thinking", "redacted_thinking"):
                        raise SchemaValidationError()
            elif kind == "user":
                for block in _blocks(event):
                    if block["type"] != "tool_result":
                        raise SchemaValidationError()
            elif kind == "rate_limit_event":
                info = event.get("rate_limit_info")
                if type(info) is dict and info.get("status") != "allowed":
                    throttled = True
            elif kind == "result":
                final = event
            else:
                raise SchemaValidationError()
    except SchemaValidationError:
        raise ProviderError("invalid_output") from None
    if final is not None and (final.get("is_error") or final.get("subtype") != "success" or final.get("terminal_reason") != "completed"):
        errors = final.get("errors")
        text = json.dumps([final.get("subtype"), final.get("terminal_reason"), final.get("result"),
                           errors if type(errors) is list else None])
        code = _error_code(text)
        raise ProviderError("rate_limited" if throttled and code == "provider_unavailable" else code)
    if result.returncode:
        # Returncode alone never implies auth or cancellation.
        raise ProviderError(_error_code(result.stderr.decode("utf-8", errors="replace")))
    if final is None:
        raise ProviderError("invalid_output")
    data = final.get("structured_output")
    if type(data) is not dict:
        error = ProviderError("invalid_output")
        error.private_output = _private_fragment(final.get("result"))
        raise error
    if len(json.dumps(data, ensure_ascii=False).encode("utf-8")) > MAX_OUTPUT_BYTES:
        raise ProviderError("invalid_output")
    return data


def _schema_text(path):
    # Схема читается из файла и уходит одной строкой: CLI принимает JSON Schema аргументом.
    return json.dumps(json.loads(Path(path).read_text(encoding="utf-8")), ensure_ascii=False)


class ClaudeCLIProvider:
    def __init__(self, *, config=None, supervisor=None):
        self.config = config or ClaudeConfig.from_settings()
        self.supervisor = supervisor or ProcessSupervisor(cancel_grace_seconds=self.config.cancel_grace_seconds)

    def detect(self, prepared_image, run):
        return self._call("detect", prepared_image, run)

    def recognize(self, prepared_crop, run):
        return self._call("recognize", prepared_crop, run)

    def _call(self, phase, image, run):
        timeout = self.config.detect_timeout_seconds if phase == "detect" else self.config.recognize_timeout_seconds
        run = run.limited(_positive(timeout))
        run.stage(phase)
        image_path = validate_prepared_image(image)
        run.check()
        name = "detect" if phase == "detect" else "receipt"
        try:
            prompt = (PACKAGE_ROOT / "prompts" / f"{name}.txt").read_text(encoding="utf-8")
            schema_json = _schema_text(PACKAGE_ROOT / "schemas" / f"{name}.schema.json")
        except (OSError, ValueError):
            raise ProviderError("configuration_error") from None
        if phase == "detect":
            prompt = prompt.format(width=image.width, height=image.height)
        else:
            angle = image.rotation_degrees
            if type(angle) not in (int, float) or not math.isfinite(angle) or not -180 <= angle <= 180:
                raise ProviderError("invalid_input")
            prompt = prompt.format(rotation_degrees=angle)
        data = self._invoke(prompt, schema_json, image_path, run)
        try:
            if phase == "detect":
                if (type(data.get("receipt_count")) is int and data["receipt_count"] > 10) or (
                        type(data.get("warnings")) is list and "too_many_receipts" in data["warnings"]):
                    raise ProviderError("invalid_output", reason="too_many_receipts")
                value = validate_detection(data, width=image.width, height=image.height)
            else:
                value = validate_observation(data)
        except SchemaValidationError:
            # ponytail: фрагмент — разобранный structured_output заново в JSON, а не сырой текст модели.
            error = ProviderError("invalid_output")
            error.private_output = _private_fragment(json.dumps(data, ensure_ascii=False))
            raise error from None
        except ProviderError as error:
            if error.code == "invalid_output":
                error.private_output = _private_fragment(json.dumps(data, ensure_ascii=False))
            raise
        run.check()
        return value

    def run_text(self, *, prompt, schema, timeout_seconds, run, stage="classify"):
        """One text-only structured call: the parsed `structured_output`, or ProviderError.

        The caller owns the prompt, the schema file and the check of the value
        against that schema; the same private attempt directory and event checks as _call.
        """
        run = run.limited(_positive(timeout_seconds))
        run.stage(stage)
        if not isinstance(prompt, str) or not prompt:
            raise ProviderError("invalid_input")
        try:
            schema_json = _schema_text(schema)
        except (OSError, ValueError, TypeError):
            raise ProviderError("configuration_error") from None
        return self._invoke(prompt, schema_json, None, run)

    def _invoke(self, prompt, schema_json, image_path, run):
        executable = shutil.which(str(self.config.executable))
        if executable is None or (os.name == "nt" and Path(executable).suffix.lower() != ".exe"):
            raise ProviderError("configuration_error")
        if not self.config.model or any(ord(c) < 32 for c in self.config.model):
            raise ProviderError("configuration_error")
        root = self.config.temp_root.resolve()
        media = getattr(settings, "MEDIA_ROOT", "")
        if media and root.is_relative_to(Path(media).resolve()):
            raise ProviderError("configuration_error")
        try:
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            with tempfile.TemporaryDirectory(prefix="attempt-", dir=root) as folder:
                work = Path(folder).resolve()
                argv = build_argv(executable, self.config.model, self.config.effort, schema_json,
                                  self.config.max_budget_usd, SYSTEM_PROMPT)
                result = self.supervisor.run(
                    argv, cwd=work, env=claude_child_environment(self.config.config_dir),
                    stdin=build_stdin(prompt, image_path), run=run, output_path=None,
                )
                run.check()
                data = validate_events(result)
                run.check()
                return data
        except (OSError, ValueError):
            raise ProviderError("configuration_error") from None
