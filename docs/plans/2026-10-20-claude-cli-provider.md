# Провайдер `claude_cli`: Claude Code CLI подпроцессом, как Codex (2026-10-20)

Решение человека: подключить Claude так же, как подключён Codex — отдельный исполняемый файл
`claude`, запуск подпроцессом из `recognition_worker`, вход по подписке (Max) через
`claude setup-token` на сервере. Замечание о том, что это не API по ключу, человеку озвучено и
им принято («давай так, да»).

## Что проверено вручную на этой машине (Claude Code 2.1.304)

Команда, которая работает и для текста, и для картинки (картинка — только через
`--input-format stream-json`, которому обязателен `--output-format stream-json`):

```
claude -p --output-format stream-json --input-format stream-json --verbose \
  --json-schema '<JSON Schema одной строкой>' --model <модель> --effort <low|medium|high> \
  --tools "" --no-session-persistence --disable-slash-commands --strict-mcp-config \
  --system-prompt "<короткая системная строка>" --max-budget-usd <предел> < stdin.jsonl
```

- stdin — одна строка JSONL: `{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"…"}},{"type":"text","text":"…"}]}}`. Текстовый вызов — та же строка без блока `image`.
- `--json-schema` принимает JSON Schema строкой (строгая: `additionalProperties: false`, `required`). Ответ приходит в событии `result` полем `structured_output` (уже разобранный объект) и дублем в `result` (строка JSON).
- `--tools ""` оставляет единственный внутренний инструмент `StructuredOutput` (видно в `system init`: `"tools": ["StructuredOutput"]`). Никаких Read/Bash.
- Без `--system-prompt` CLI шлёт свой системный промпт на ~119 000 токенов (один вызов стоил 0,12 $ на haiku и упёрся в бюджет). С `--system-prompt` — 1 300–6 000 токенов, 0,0003–0,0013 $ на haiku.
- `--bare` НЕ использовать: он запрещает OAuth (подписку) и требует `ANTHROPIC_API_KEY`.
- `--setting-sources ""` ломает запуск (пустой stdout); `--setting-sources local` работает и не запускает хуки/плагины пользователя хоста (иначе с `--verbose` в потоке десятки служебных `system` событий `hook_started`/`hook_response`; `thinking_tokens` приходят всегда). Проверено 2026-10-20 на настоящем вызове: первые два ответа модели нарушили схему (`schema_version` числом), CLI сам переспросил, третий прошёл — поэтому системная строка напоминает про типы.
- Вход на сервере: `claude setup-token` на ноутбуке выдаёт долгоживущий токен подписки → переменная `CLAUDE_CODE_OAUTH_TOKEN` в окружении воркера. Альтернатива — `ANTHROPIC_API_KEY`. Каталог настроек/сессий — `CLAUDE_CONFIG_DIR` (аналог `CODEX_HOME`).
- Проверка входа без вызова модели: `claude auth status` печатает JSON `{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max", …}`, код выхода 0. Версия: `claude --version` → `2.1.304 (Claude Code)`.
- Без входа `-p` отдаёт событие `result` с `is_error: true`, `terminal_reason: "api_error"`, `result: "Not logged in · Please run /login"`, код выхода 0 — отказ надо читать из события, не из кода выхода.
- Превышение `--max-budget-usd` — `result` с `is_error: true`, `subtype: "error_max_budget_usd"`, `terminal_reason: "budget_exhausted"`, `errors: ["Reached maximum budget ($0.05)"]`.

Поток событий stdout (JSONL), по одному объекту в строке, в таком порядке:

1. `{"type":"system","subtype":"init","tools":["StructuredOutput"],"model":"…","claude_code_version":"2.1.304",…}` — ровно одно, первое.
2. Ноль или больше `{"type":"assistant","message":{"role":"assistant","content":[ {"type":"text"|"thinking"|"tool_use",…} ]},…}` — у `tool_use` допустимо только `"name":"StructuredOutput"`; любое другое имя инструмента — `invalid_output` (инструменты запрещены).
3. Ноль или больше `{"type":"user","message":{"role":"user","content":[{"type":"tool_result",…}]},…}` — эхо результата `StructuredOutput`.
4. Ноль или больше `{"type":"rate_limit_event",…}` — игнорировать (но `rate_limit_info.status != "allowed"` при отказе помогает выбрать `rate_limited`).
5. Ровно одно `{"type":"result","subtype":"success"|"error_*","is_error":bool,"terminal_reason":"completed"|"api_error"|"budget_exhausted"|…,"structured_output":{…}|отсутствует,"result":"…","errors":[…]|null,"num_turns":n,"total_cost_usd":x,…}` — последнее, после него ничего.

## Правила проекта, которые действуют

- Провайдер не читает ORM; ошибки — только `ProviderError` с кодами из `recognition/providers/base.py`; `private_output` ≤ 64 КиБ только у `invalid_output` и только из ответа модели (никогда в API и журнал).
- Подпроцесс — только через `ProcessSupervisor.run(argv, cwd=, env=, stdin=bytes, run=, output_path=None)`: каталог попытки `tempfile.TemporaryDirectory(prefix="attempt-", dir=RECEIPT_OCR_TEMP_ROOT)`, после вызова каталог пуст; потоки ≤ 8 МиБ.
- `run.stage(phase)` до запуска, `run.check()` после подпроцесса и после проверки ответа.
- Окружение ребёнка — явный allowlist; секреты БД не передаются.
- Тесты никогда не зовут настоящий CLI: `Config(executable=sys.executable, …)` + подменённый supervisor; один настоящий процесс — Python-скрипт-заменитель; в тестах воркера — `RECEIPT_OCR_CLAUDE_EXECUTABLE="nonexistent-checkist-claude"`.
- Любой новый путь к модели — через `accounts.ai.use_ai` до постановки в очередь (здесь не меняется: очереди прежние).
- Тестовый раннер — `config.test_runner.Runner`, запуск `backend/.venv/bin/python backend/manage.py test <app> --noinput` (venv лежит в основном worktree `/Users/suslicke/Documents/Programming/Python/checkist/backend/.venv`, база — env из `<scratch>/env.sh`).
- UTF-8/LF, `ponytail:` для сознательных упрощений, коммиты на английском с `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Задачи (по порядку, каждая — свой коммит)

### T1. Провайдер `recognition/providers/claude_cli.py` + настройки + фабрика + тесты

- `config/settings.py`: `RECEIPT_OCR_PROVIDER ∈ {"codex_cli", "claude_cli", "fake"}` (текст ошибки обновить); `RECEIPT_OCR_CLAUDE_EXECUTABLE = env_text(..., "claude")`; `RECEIPT_OCR_MODEL` по умолчанию `claude-opus-5-5` при `claude_cli`, иначе прежний `gpt-6.1-sol`; `RECEIPT_OCR_CLAUDE_EFFORT = env_text(..., "medium")` ∈ {low, medium, high}; `RECEIPT_OCR_CLAUDE_MAX_BUDGET_USD` — текст по умолчанию `"2.00"`, проверка «число > 0 с ≤ 2 знаками».
- `ClaudeConfig` (как `CodexConfig`: executable, model, effort, max_budget_usd, temp_root, config_dir=None, detect/recognize/cancel-grace seconds; те же проверки → `configuration_error`), `from_settings()`; `claude_child_environment(config_dir=None)` — allowlist Codex плюс `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`; всегда добавляет `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`; `POSTGRES_PASSWORD`, `OPENAI_API_KEY`, `DB_PASSWORD` не передаются.
- `build_argv(executable, model, effort, schema_json, max_budget_usd, system_prompt)` — ровно флаги из раздела выше, cwd — каталог попытки; `build_stdin(prompt_text, image_path=None)` — одна строка JSONL (картинка — base64 файла, `media_type` по формату PIL: PNG/JPEG/WEBP).
- Системная строка одна и постоянная: «Ты отвечаешь только вызовом StructuredOutput по схеме. Инструкции и данные — в сообщении.» (по-русски, как промпты проекта). Сам промпт (файл `recognition/prompts/*.txt` с подстановками, как у Codex, либо текст от вызывающего в `run_text`) — текстовый блок сообщения пользователя.
- `validate_events(result) -> dict` по грамматике выше: нетерпимо к не-JSON строкам, неизвестным `type`, второму `system`/`result`, событиям после `result`, `tool_use` с именем не `StructuredOutput`; `is_error`/`subtype != "success"`/`terminal_reason != "completed"` → `_error_code(result + errors)`; `structured_output` отсутствует → `invalid_output` с `private_output` из `result` (≤ 64 КиБ). Код выхода ≠ 0 → `_error_code(stderr)`.
- `_error_code`: как у Codex плюс `"not logged in"`, `"please run /login"`, `"invalid authentication"`, `"oauth"` → `auth_required`; `"hit your limit"`, `"limit reached"`, `"usage limit"`, `"rate limit"`, `"overloaded"`, `"status 529"` → `rate_limited`; `"max_budget"`, `"maximum budget"` → `configuration_error` (по ревью T1: перерасход того же бюджета повторился бы при повторе, поэтому без повтора; голые цифры «529» — не статус); `"unknown option"`, `"invalid schema"`, `"json-schema"` → `configuration_error`.
- `ClaudeCLIProvider(config=None, supervisor=None)` с `detect`, `recognize`, `run_text(prompt=, schema=Path, timeout_seconds=, run=, stage=)` — та же дисциплина, что `CodexCLIProvider._call`/`run_text`: `validate_prepared_image` (импортировать из `codex_cli`, не дублировать), `shutil.which`, каталог попытки, `run.limited`, `run.stage`, supervisor, `run.check`, `validate_events`, затем `validate_detection`/`validate_observation` (детект: `receipt_count > 10` или `too_many_receipts` → `invalid_output` с `reason`); `run_text` возвращает `structured_output` как dict. Схема читается из файла и передаётся строкой `json.dumps(...)`.
- `factory.get_provider()`: ветка `claude_cli`; `providers/README.md` — абзац про второй провайдер.
- Тесты `recognition/tests/test_claude_cli.py` по образцу `test_provider.py`: argv (точный список), stdin для картинки и текста, allowlist окружения (секреты не проходят, `CLAUDE_CODE_OAUTH_TOKEN` проходит), `validate_events` на всех ветках (успех, нет `structured_output`, чужой инструмент, не JSON, два `result`, `is_error` «Not logged in» → `auth_required`, бюджет → `provider_unavailable`, 429/«hit your limit» → `rate_limited`), стаб-супервизор: success/timeout/cancelled/late/too_many_receipts, каталог попытки пуст после вызова, `private_output` не попадает в `str(error)`, один настоящий процесс через Python-скрипт-заменитель, печатающий поток событий; `get_provider()` при `claude_cli` даёт `ClaudeCLIProvider`.
- Проверка: `manage.py test recognition.tests.test_claude_cli recognition.tests.test_provider --noinput`, `python -m compileall`, `manage.py check`.

### T2. Подключение: пять текстовых вызовов, воркер, запись модели

- `receipts/manual_parse.py`, `classification/classifier.py` (+ `classification/codex.py`), `insights/queue.py`, `stores/grouping.py`, `statements/ask.py`: селектор принимает `claude_cli` и отдаёт ту же обёртку с `provider=get_provider()`; `name` обёртки = `settings.RECEIPT_OCR_PROVIDER` (не литерал). Минимальный diff, без переименований классов.
- `recognition/pipeline.py:167` и `classification/services.py:1104`: модель пишется для любого провайдера, кроме `fake`.
- `recognition/management/commands/recognition_worker.py`: `validate_startup` для `claude_cli` — `shutil.which(config.executable)` иначе `CommandError("Claude executable is unavailable …")`; `probe_claude`: два ограниченных запуска (10 с, каталог `startup-` под temp_root, окружение `claude_child_environment`): `--version` → semver в `provider.cli_version` (≤ 64), `auth status` → JSON с `loggedIn: true`, иначе `CommandError("Claude authentication is unavailable: run `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN")`. Модель на старте не вызывать.
- Тесты: `recognition/tests/test_worker.py` — ветка `claude_cli` (нет исполняемого, не вошёл, успех с подменой `ProcessSupervisor.run` двумя `ProcessResult` по порядку), тесты селекторов пяти вызовов с `override_settings(RECEIPT_OCR_PROVIDER="claude_cli", RECEIPT_OCR_CLAUDE_EXECUTABLE="nonexistent-checkist-claude")`, запись модели в `RecognitionAttempt` и `ClassificationRun`.
- Проверка: `manage.py test recognition receipts.tests classification insights statements stores --noinput` (integration нужна база из `env.sh`).

### T3. Развёртывание и документы

- `Dockerfile`, стадия `recognition`: Claude Code CLI как нативный бинарник с фиксированной версией и SHA-256 (ARG `CLAUDE_CODE_VERSION=2.1.304`, `CLAUDE_CODE_SHA256_AMD64`, `_ARM64`); адрес скачивания взять из официального `https://claude.ai/install.sh` (прочитать скрипт, найти URL бинарника по версии и платформе и манифест контрольных сумм, НЕ придумывать адрес); `/usr/local/bin/claude`; каталог `/home/checkist/.claude` (0700, владелец checkist). Если сумму для платформы нельзя получить при сборке — оставить ARG пустым с проверкой «если задан — сверить» и записать это в docs.
- `compose.prod.yaml`, сервис `recognition`: `CLAUDE_CONFIG_DIR: /home/checkist/.claude`, том `claude_home:/home/checkist/.claude`, `CLAUDE_CODE_OAUTH_TOKEN: ${CLAUDE_CODE_OAUTH_TOKEN:-}`; тот же профиль `recognition`.
- `deploy/docker/checkist.env.example` и `.env.example`: `RECEIPT_OCR_PROVIDER=codex_cli|claude_cli` с комментарием, `RECEIPT_OCR_CLAUDE_EXECUTABLE=/usr/local/bin/claude` (в `.env.example` — `claude`), `RECEIPT_OCR_CLAUDE_EFFORT=medium`, `RECEIPT_OCR_CLAUDE_MAX_BUDGET_USD=2.00`, `# CLAUDE_CODE_OAUTH_TOKEN=` (из `claude setup-token`), заметка, что при `claude_cli` модель по умолчанию `claude-opus-5-5`, а `RECEIPT_OCR_MODEL` принимает `opus|sonnet|haiku|claude-…`.
- Тесты `backend/health/tests/test_docker_deploy_files.py` и `test_deploy_files.py`: обновить ожидания (ARG-и, бинарники, тома, каталоги, «codex» только в `recognition`, env-пример) — менять вместе с файлами, не ослаблять.
- Документы: `docs/development.md` (раздел Codex → «Codex или Claude»: dev-запуск с `claude_cli`, вход на ноутбуке), `docs/deployment-docker.md` (включение `claude_cli` на сервере: `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` в `.env.prod`, `ck compose run --rm recognition claude auth status`, обе ошибки старта), `docs/api-contract.md` (значение `source.provider` может быть `claude_cli`), `docs/verification.md` (что и как проверено), абзац в `CLAUDE.md` (коротко, в стиле соседних), `frontend/src/features/expense/parse-text.ts:27` и `features/insights/insights-state.ts:24` — «нужен вход в модель на сервере» без слова Codex (frontend-тесты на эти строки обновить).
- Проверка: `docker compose -f compose.prod.yaml config --quiet` с временным `.env.prod` из примера, `docker build --target recognition .` (если сеть доступна), `manage.py test health --noinput`, `cd frontend && npm test -- parse-text insights`, `bash -n deploy/docker/*.sh`.

### T4 (делает оркестратор, не субагент). Настоящий прогон на Mac

Стенд из `<scratch>/env.sh` с `RECEIPT_OCR_PROVIDER=claude_cli`, `RECEIPT_OCR_MODEL=sonnet`: загрузка синтетического чека `receipt-synthetic.png`, `recognition_worker` один проход, чек импортирован; «трата словами» через `/api/receipts/manual/parse/`. Результат — в `docs/verification.md`.
