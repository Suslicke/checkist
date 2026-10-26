# Планы (ожидаемые траты) и чат с ИИ — дизайн и контракт (2026-10-26)

Просьба человека: «Планируемые/ожидаемые траты — не платежи, не регулярные; планировать со сроком (к какому
числу нужна часть денег) и без срока; сопрячь с депозитом (предлагать варианты по риску и сроку); кнопка ИИ,
которая смотрит планы и отговаривает; отдельный чат с ИИ про любую трату; действия из чата с кнопкой
подтверждения — сразу». Макет (утверждён): `frontend/planned-preview/index.html` (v5: герой с сегментной
полосой месяца, карточки месяцев, строки с полосой план/факт/отложено, «Без срока», «Как накопить», «Взгляд со
стороны» с вердиктами, карточка на Главной). Решения: закрытие плана — привязка к настоящей трате; план без
срока не входит в месяц и в «можно тратить в день»; ИИ ничего не меняет сам — действия только после
подтверждения человеком в сообщении.

## Сервер

### Приложение `planned`
`PlannedSpend`: владелец как у лимита (`household` | `user`, `budget.access.limits_q` / `limit_owner`, семья
видит и правит всё), `name` (100), `category` FK nullable PROTECT, `currency` FK PROTECT, `amount` > 0,
`due` DateField null (null — без срока), `due_exact` bool (True — «к 20 октября», False — «в октябре»: `due` =
первое число), `note` (300), `receipt` FK `receipts.Receipt` null SET_NULL (есть — план закрыт этой тратой; одна
трата — один план, unique), `goal` FK `goals.Goal` null SET_NULL (деньги отложены на этой цели), `ai_verdict`
(`""`|`keep`|`wait`|`drop`), `ai_reason` (300), `ai_at` null, `created_by`, `created_at`, `updated_at`.
Миграция `planned.0001_initial`, откат `migrate planned zero`.

Сервис `planned/services.py`:
- `month_view(request, month, today)` → строки месяца (`due` в месяце, закрытые тоже; `receipt.purchased_on`
  не важен) + `undated` + `base` (основная валюта по `rates.convert.converter`, день — сегодня/последний день
  месяца как у `recurring._base`): `expected` (все планы месяца), `done` (факт закрытых), `left` (открытые),
  `excluded`, `count`, `done_count`, `segments` (по плану: id, name, category_id, amount в базе, done);
  `months` — с текущего месяца вперёд все месяцы с планами: `month, expected, count, done_count, segments`.
- `open_total(user, month, today)` → `(Decimal в базе, count)` открытых планов текущего месяца — для
  `budget.allowance.daily` (вычитается как неоплаченные платежи; поля `planned`, `planned_count` в `Allowance` и
  в JSON дашборда `allowance`), и `dashboard_card(request, month, today)` для `GET /api/dashboard/` → поле
  `planned`: `{expected, left, count, done_count, segments, rows: до 3 открытых (id, name, amount, currency,
  category_id)}` либо `null`, когда планов месяца нет.
- `link(plan, receipt)` / `unlink`, `set_goal`, `saved(plan)` — отложено на цели в валюте плана (`goals.services
  .progress`, пересчёт по курсу), `advice(plan, today)` — советчик.
- Действия для чата: `apply_action(request, action)` — `move_plan {plan_id, due, due_exact}`, `delete_plan
  {plan_id}`, `change_amount {plan_id, amount}`, `create_plan {name, amount, currency?, due?, due_exact?,
  category_id?}`; возвращает текст «что сделано»; чужой/отсутствующий план — ValueError.

Советчик `planned/advice.py` (чистые расчёты поверх `goals.forecast`): вход — нужно `amount`, отложено
`saved`, срок `due` (null — без срока); ставки — `settings.PLANNED_RATES = {"fixed": 17, "flexible": 15,
"invest": 10}` (годовых, % — env `PLANNED_RATE_FIXED/FLEXIBLE/INVEST`; `# ponytail: per-family rates when asked`).
Варианты: `lump_fixed` (срочный без снятия: одна сумма сегодня, доступен при сроке ≥ 3 мес), `monthly_flexible`
(с пополнением и снятием: взнос в месяц, доступен при сроке ≥ 1 мес; без срока — «при N в месяц хватит к
<месяц>» для N = 10 % суммы, округлённо), `invest` (инвестиции/крипта, риск 3, доступен при сроке > 12 мес, иначе
`reason`). Ответ `GET /api/planned/{id}/advice/`:
`{need, saved, missing, currency, due, months, options:[{key, available, reason, amount, times, gain, rate,
risk (1..3), liquid, until}]}` — суммы строками, как везде. `POST /api/planned/{id}/deposit/ {option}` создаёт
`Goal(kind=deposit, rate по варианту, deadline=due, amount=missing, name=план)` общую на семью и привязывает.

### API `/api/planned/` (доступ как у лимитов; тело — `JsonObjectParser`, ошибки `invalid_parameter` с `fields`)
- `GET ?month=YYYY-MM` → `{month, today, currency, rows, undated, base, months}`. План:
  `{id, name, category: {id, name, icon}|null, currency, amount, due, due_exact, note, receipt: {id, total,
  currency, purchased_on, store_name}|null, goal: {id, name, kind, saved, share}|null, ai: {verdict, reason,
  at}|null, created_by, created_at}`.
- `POST` → 201 план (`name, amount, currency?` (профиль → основная), `due?`, `due_exact?`, `category_id?`,
  `note?`, `goal_id?`); `GET/PATCH/DELETE /{id}/` (PATCH принимает те же поля плюс `receipt_id` (null — снять;
  трата должна быть видна `visible_receipts_q`; занята другим планом — `409 receipt_taken`) и `goal_id` (цель из
  `goals_q`)).
- `GET /{id}/advice/`, `POST /{id}/deposit/`.
- Трата из плана: клиент ведёт в `/receipts/new?planned={id}` (имя, категория, сумма, валюта предзаполнены),
  после сохранения — `PATCH /api/planned/{id}/ {receipt_id}`.

### Чат — в `insights`
`InsightThread`: `owner`, `kind` (`free`|`spend`|`plans`|`month`), `title` (120), `receipt` FK null SET_NULL,
`month` DateField null, `created_at`, `updated_at`. `InsightRequest` получает `thread` FK null CASCADE,
`kind` `chat`, `actions` JSON (список действий модели с `done_at`/`result`), `verdicts` сохраняются в `answer`.
Миграции `insights.0002_chat` (откат — `migrate insights 0001_initial`). История беседы — запросы треда по
порядку (`question` — сообщение человека, `answer.answer` — ответ модели). Видит только владелец.

Вход модели (`queue.build_input` для `chat`): сводка `context.build` (как у разбора) + `plans` (все открытые
планы семьи: id, name, amount в базе, due, category, saved, goal) + `subject` (у `spend` — трата целиком:
дата, место, сумма, способ, категория, позиции, место в лимите категории месяца, последние 6 трат в этом месте;
у `month` — месяц; у `plans` — «оцени планы») + `history` (до 20 последних пар вопрос/ответ треда) +
`question`. Промпт `insights/prompts/chat.txt` (по-русски, на «вы», 1–6 предложений, не считать сумм, числа
только из входа; про планы — вердикт каждому с причиной; действия предлагать только из списка и только когда
человек просит изменить или модель отговаривает; никаких медицинских/юридических советов), схема
`chat.schema.json`: `{answer (≤1200), verdicts?: [{plan_id, verdict: keep|wait|drop, reason ≤200}], actions?:
[{kind: move_plan|delete_plan|change_amount|create_plan, label ≤80, plan_id?, due?, due_exact?, amount?,
name?, category_id?}] (≤5)}`. После `succeeded` вердикты пишутся в `PlannedSpend.ai_*` видимых планов.
Первое сообщение треда `plans` сервер задаёт сам («Посмотрите мои планы: что брать, что отложить, от чего
отговорите»); `/ask?q=` клиента = новый тред `free` с вопросом.

API: `GET /api/insights/threads/` (свои, новые сверху: id, kind, title, updated_at, last_answer_preview),
`POST /api/insights/threads/ {kind, receipt_id?, month?, question?}` → 201 тред (+ первый запрос, если есть
вопрос или kind=plans; `202`-семантика запроса как у `ask`: `use_ai`, лимит 2 незавершённых / 30 в час → `429
parse_limit`), `GET /api/insights/threads/{id}/` → `{thread, messages: [request objects с question, status,
answer, actions, unverified, error_code]}`, `POST /api/insights/threads/{id}/messages/ {question}` → 202 запрос,
`DELETE /api/insights/threads/{id}/`. Опрос — прежний `GET /api/insights/{id}/`. Действие: `POST
/api/insights/{id}/actions/{index}/confirm/` → применяет через `planned.services.apply_action` (повтор — `409
action_done`), записывает `done_at`, `result`, отвечает запросом. Прежние `/review` и `/ask` не меняются.

## Клиент
- `/planned` (`features/planned`, часть в `screens.ts`, пункт «Планы» в «Деньги»): по макету — герой
  (`ck-hero-figure` «ещё ждём», сегментная полоса, легенда), «＋ Запланировать» + «✦ Спросить ИИ» (создаёт тред
  `plans` и ведёт в `/chat/{id}`), карточки месяцев (`ChipScroller` на телефоне, сетка от 960), «Октябрь» (строки:
  значок категории `categoryIcon`, подложка `categoryTone`, полоса план/отложено/факт/перерасход, пилюли
  «+7 400 ₸» / «−2 000 ₸» / «ИИ: подождать» / «ИИ: отговаривает»), «Без срока», советчик «Как накопить» в
  листе плана (`Sheet`: «Это она» — выбор траты месяца из `GET /api/receipts/`; «Добавить трату»; «Как накопить»
  с вариантами и «Открыть депозит»; «Перенести»; «Удалить»), форма добавления (лист: что, сумма-калькулятор,
  срок — «без срока / в месяце / к дате», категория, комментарий). Цвета — токены, размеры — `--ck-text-*`,
  новые правила компьютера — блок `desktop.css`, `shape="columns"`.
- Главная: карточка «Планируем в <месяце>» (сегментная полоса, 3 строки, «ещё ждём … · уже учтено в «можно
  тратить в день»»), `allowance` — «из них N планируемых».
- `/chat`, `/chat/{id}` (`features/chat`, пункт «Чат с ИИ» в «Деньги»): список бесед (на компьютере слева
  280 px), лента сообщений (человек справа, модель слева; «печатает…» — скелет; непроверенные числа как в
  разборе), вердикты карточкой в сообщении, действия — кнопками «Подтвердить: перенести «Куртку» на ноябрь»
  (после — «Сделано: …»), ввод внизу (липкий над меню телефона). Входы: страница траты — «Спросить ИИ об этой
  трате»; «Планы» — «Спросить ИИ»; «Разбор месяца» — «Обсудить». `/ask` → `/chat` (с `?q=` — новый тред).
- Выгрузка, MCP, push, автосовпадение — не делаются.
