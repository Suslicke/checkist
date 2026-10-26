"""«Чат с ИИ»: беседы, вход модели, ответ с вердиктами и действиями, подтверждение, API.

Настоящая модель не вызывается: fake либо подменённый провайдер. Имена и суммы вымышленные.
"""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import Mock, patch

from django.test import TestCase, tag
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.ai import AiRefused
from accounts.models import Household, Membership
from api.tests.accounts_helpers import accounts_mode, local_single_mode, make_user
from api.tests.test_owner_isolation import IsolationMixin
from budget.dashboard import Month
from budget.history import save_limit
from budget.models import BudgetLimit
from catalog.models import Category
from insights import chat, queue
from insights.models import InsightRequest, InsightThread
from planned.models import PlannedSpend
from receipts import manual
from receipts.ownership import local_user
from recognition.management.commands import recognition_worker
from recognition.tests.test_worker_classification import WorkerClassificationEnvironment

THREADS = "/api/insights/threads/"
D = Decimal


def spend(owner, day, total, category, store=None, lines=None):
    data = {"currency": "KZT", "purchased_on": day.isoformat(), "total": f"{total:.2f}", "category": category.pk,
            "payment_method": "cash"}
    if store:
        data["store_name"] = store
    if lines:
        data["lines"] = lines
    return manual.create(owner, data)


class ChatData:
    """Трата с позициями в «Складе» (лимит категории превышен), шесть прежних трат там же, два открытых плана."""

    @classmethod
    def seed(cls, owner):
        cls.today = timezone.localdate()
        cls.month = Month.of(cls.today)
        cls.clothes = Category.objects.create(name="Синтетическая одежда")
        cls.shoes = Category.objects.create(name="Синтетическая обувь", parent=cls.clothes)
        for index in range(7):  # the seventh is older than the six the subject shows
            spend(owner, cls.month.first - timedelta(days=index + 1), 1000 + index, cls.clothes, "Склад")
        cls.receipt = spend(owner, cls.month.first, 48000, cls.clothes, "Склад", lines=[
            {"name": "Куртка", "amount": "45000", "quantity": "1", "unit": "pcs", "unit_price": "45000"},
            {"name": "Носки", "amount": "3000", "quantity": "3", "unit": "pcs", "unit_price": "1000", "category": cls.shoes.pk},
        ])
        save_limit(BudgetLimit(user=owner, category=cls.clothes, currency_id="KZT", amount=D("40000")))
        cls.jacket = PlannedSpend.objects.create(user=owner, name="Пальто", amount=D("90000"), currency_id="KZT",
                                                 due=cls.month.first + timedelta(days=20), category=cls.clothes,
                                                 created_by=owner)
        cls.gift = PlannedSpend.objects.create(user=owner, name="Подарок", amount=D("30000"), currency_id="KZT",
                                               created_by=owner)


def chat_output(**extra):
    """Ответ модели по схеме: все ключи на месте, как их требует валидатор (``null`` — «нет»)."""
    return {"answer": "Хорошая трата.", "verdicts": None, "actions": None, **extra}


def action(**values):
    """Действие модели со всеми ключами схемы."""
    return {key: None for key in ("plan_id", "due", "due_exact", "amount", "name", "category_id")} | values


@tag("integration")
class ThreadTests(ChatData, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = local_user()
        cls.seed(cls.owner)

    def test_threads_of_every_kind_their_titles_and_the_plans_opener(self):
        free = chat.create_thread(self.owner, "free", question="Почему " + "очень " * 20 + "дорого?")
        self.assertEqual((free.kind, len(free.title), free.title[-1], free.requests.count()), ("free", 60, "…", 1))
        plans = chat.create_thread(self.owner, "plans")
        opener = plans.requests.get()
        self.assertEqual((plans.title, opener.question, opener.kind, opener.status), ("Планы", chat.PLANS_OPENER, "chat", "queued"))
        thread = chat.create_thread(self.owner, "spend", receipt=self.receipt)
        self.assertEqual((thread.title, thread.receipt_id, thread.requests.count()), ("Трата: Склад · 48\u00a0000\u00a0KZT", self.receipt.pk, 0))
        month = chat.create_thread(self.owner, "month", month=Month(2026, 10))
        self.assertEqual((month.title, month.month), ("Октябрь 2026", date(2026, 10, 1)))
        with self.assertRaises(ValueError):
            chat.create_thread(self.owner, "other")

    def test_spend_subject_carries_lines_limit_place_and_last_spends_at_the_store(self):
        thread = chat.create_thread(self.owner, "spend", receipt=self.receipt)
        row = chat.send(thread, "Это дорого?", self.today)
        subject = row.context["subject"]
        self.assertEqual((subject["kind"], subject["date"], subject["store"], subject["total"], subject["currency"],
                          subject["payment_method"]), ("spend", self.month.first.isoformat(), "Склад", "48000.00", "KZT", "Наличные"))
        self.assertEqual(subject["category"], ["Синтетическая одежда"])
        self.assertEqual(subject["lines"], [
            {"name": "Куртка", "quantity": "1.000", "unit": "pcs", "amount": "45000.00", "category": "Синтетическая одежда"},
            {"name": "Носки", "quantity": "3.000", "unit": "pcs", "amount": "3000.00", "category": "Синтетическая обувь"}])
        self.assertEqual(subject["limit"], {"category": "Синтетическая одежда", "limit": "40000.00", "spent": "48000.00",
                                            "over": "8000.00"})
        self.assertEqual([item["total"] for item in subject["store_spends"]],
                         ["1000.00", "1001.00", "1002.00", "1003.00", "1004.00", "1005.00"])
        self.assertEqual(row.month, self.month.first)
        self.assertEqual([plan["name"] for plan in row.context["plans"]], ["Пальто", "Подарок"])
        self.assertEqual(row.context["plans"][0], {
            "id": self.jacket.pk, "name": "Пальто", "amount": "90000.00", "due": self.jacket.due.isoformat(), "due_exact": True,
            "category": "Синтетическая одежда", "saved": None, "goal": None})
        self.assertEqual(chat.subject(chat.create_thread(self.owner, "plans")), {"kind": "plans", "ask": "verdicts"})
        self.assertIsNone(chat.subject(chat.create_thread(self.owner, "free")))

    def test_build_input_ends_with_history_and_the_question(self):
        thread = chat.create_thread(self.owner, "free")
        for index in range(22):
            row = chat.send(thread, f"Вопрос {index}")
            InsightRequest.objects.filter(pk=row.pk).update(status="succeeded", answer={"answer": f"Ответ {index}"})
        InsightRequest.objects.filter(pk=row.pk).update(status="failed", answer=None, error_code="timeout")
        current = chat.send(thread, "Итог?")
        payload = queue.build_input(current)
        self.assertEqual(list(payload)[-2:], ["history", "question"])
        self.assertEqual(payload["question"], "Итог?")
        self.assertEqual(len(payload["history"]), 20)  # the failed one is left out, the oldest fall off
        self.assertEqual(payload["history"][-1], {"question": "Вопрос 20", "answer": "Ответ 20"})
        self.assertIn("focus", payload)
        self.assertIsNone(payload["subject"])

    def test_use_ai_refusal_and_limits_create_nothing(self):
        def refuse(user):
            raise AiRefused("ai_disabled")

        with patch.object(chat, "use_ai", side_effect=refuse), self.assertRaises(AiRefused):
            chat.create_thread(self.owner, "plans")
        self.assertFalse(InsightThread.objects.exists())
        self.assertFalse(InsightRequest.objects.exists())
        thread = chat.create_thread(self.owner, "free")
        with patch.object(chat, "use_ai"):
            for index in range(queue.MAX_UNFINISHED):
                chat.send(thread, f"Вопрос {index}")
            with self.assertRaises(queue.AskLimit):
                chat.send(thread, "Ещё?")
        self.assertEqual(thread.requests.count(), queue.MAX_UNFINISHED)

    def test_answer_from_output_accepts_and_rejects(self):
        context = {"plans": [{"id": self.jacket.pk, "name": "Пальто"}]}
        move = action(kind="move_plan", label="Перенести пальто", plan_id=self.jacket.pk, due="2026-12-01", due_exact=False)
        answer = queue.answer_from_output("chat", chat_output(
            verdicts=[{"plan_id": self.jacket.pk, "verdict": "wait", "reason": "Лимит превышен."},
                      {"plan_id": 999999, "verdict": "drop", "reason": "Нет такого плана."}],
            actions=[move, action(kind="move_plan", label="Чужой", plan_id=999999, due="2026-12-01"),
                     action(kind="create_plan", label="Без суммы", name="Шины")]), context)
        self.assertEqual(answer["answer"], "Хорошая трата.")
        # The unknown plan is kept for the text, without a name; the known one carries the name the model saw.
        self.assertEqual([(item["plan_id"], item["name"]) for item in answer["verdicts"]], [(self.jacket.pk, "Пальто"), (999999, None)])
        # Unknown plan / incomplete actions are dropped; stored actions carry only the values the model gave.
        self.assertEqual(answer["actions"], [{"kind": "move_plan", "label": "Перенести пальто", "plan_id": self.jacket.pk,
                                              "due": "2026-12-01", "due_exact": False, "done_at": None, "result": None}])
        plain = queue.answer_from_output("chat", chat_output(), context)
        self.assertEqual((plain["verdicts"], plain["actions"]), (None, []))
        for bad in (chat_output(answer=""), chat_output(answer="x" * 1201), chat_output(verdicts=[{"plan_id": 1, "verdict": "buy", "reason": "x"}]),
                    chat_output(actions=[action(kind="explode", label="x")]), chat_output(actions=[move] * 6),
                    chat_output(actions=[{**move, "extra": 1}]), chat_output(actions=[{"kind": "delete_plan", "label": "x"}]),
                    {"verdicts": [], "actions": None}, {"answer": "Текст"}):
            with self.subTest(bad=str(bad)[:60]), self.assertRaises(queue.OutputError):
                queue.answer_from_output("chat", bad, context)

    def test_fake_writer_answers_with_a_verdict_and_an_action_then_the_verdict_is_on_the_plan(self):
        thread = chat.create_thread(self.owner, "plans", today=self.today)
        row = queue.execute(queue.claim(), writer=queue.FakeWriter())
        self.assertEqual((row.status, row.error_code), ("succeeded", ""))
        self.assertIn("Пальто", row.answer["answer"])
        self.assertEqual(row.answer["verdicts"][0]["plan_id"], self.jacket.pk)
        self.assertEqual((row.actions[0]["kind"], row.actions[0]["plan_id"], row.actions[0]["done_at"]), ("move_plan", self.jacket.pk, None))
        self.assertEqual(queue.unverified(row), [])
        plan = PlannedSpend.objects.get(pk=self.jacket.pk)
        self.assertEqual((plan.ai_verdict, plan.ai_reason), ("wait", row.answer["verdicts"][0]["reason"]))
        self.assertIsNotNone(plan.ai_at)
        self.assertEqual(PlannedSpend.objects.get(pk=self.gift.pk).ai_verdict, "")
        self.assertEqual(queue.FakeWriter("chat").scenario, "chat")
        thread.refresh_from_db()
        self.assertGreaterEqual(thread.updated_at, row.created_at)

    def test_verdicts_of_unknown_or_foreign_plans_are_ignored(self):
        stranger = make_user("synthetic-user-nine")
        foreign = PlannedSpend.objects.create(user=stranger, name="Чужой", amount=D("1"), currency_id="KZT", created_by=stranger)
        thread = chat.create_thread(self.owner, "plans")
        row = thread.requests.get()
        row.status, row.answer = "succeeded", {"answer": "x", "verdicts": [
            {"plan_id": foreign.pk, "verdict": "drop", "reason": "чужое"}, {"plan_id": 999999, "verdict": "keep", "reason": "нет"},
            {"plan_id": self.gift.pk, "verdict": "keep", "reason": "Подарок нужен."}]}
        self.assertEqual(chat.apply_verdicts(row), 1)
        self.assertEqual(PlannedSpend.objects.get(pk=foreign.pk).ai_verdict, "")
        self.assertEqual(PlannedSpend.objects.get(pk=self.gift.pk).ai_verdict, "keep")

    def test_confirm_action_applies_once(self):
        thread = chat.create_thread(self.owner, "plans")
        row = queue.execute(queue.claim(), writer=queue.FakeWriter())
        with self.assertRaises(ValueError):
            chat.confirm_action(self.owner, row, 1)
        done = chat.confirm_action(self.owner, row, 0)
        self.assertIn("Перенесли «Пальто»", done.actions[0]["result"])
        self.assertIsNotNone(done.actions[0]["done_at"])
        moved = PlannedSpend.objects.get(pk=self.jacket.pk)
        self.assertEqual((moved.due, moved.due_exact), (date.fromisoformat(row.actions[0]["due"]), False))
        with self.assertRaises(chat.ActionDone):
            chat.confirm_action(self.owner, done, 0)
        PlannedSpend.objects.filter(pk=self.jacket.pk).delete()
        row.actions[0]["done_at"] = None
        row.save(update_fields=["actions"])
        with self.assertRaises(ValueError):  # the plan is gone: planned.services refuses, nothing is marked done
            chat.confirm_action(self.owner, row, 0)
        self.assertIsNone(InsightRequest.objects.get(pk=row.pk).actions[0]["done_at"])

    def test_codex_prompt_carries_the_subject_and_the_history(self):
        thread = chat.create_thread(self.owner, "spend", receipt=self.receipt)
        first = chat.send(thread, "Это дорого?")
        InsightRequest.objects.filter(pk=first.pk).update(status="succeeded", answer={"answer": "Дорого: 48 000 ₸ при лимите 40 000 ₸."})
        chat.send(thread, "А что делать?")
        provider = Mock()
        provider.run_text.return_value = {"answer": "Подождите\nс пальто.", "verdicts": [], "actions": None}
        result = queue.execute(queue.claim(), writer=queue.CodexWriter(provider))
        self.assertEqual((result.status, result.answer), ("succeeded", {"answer": "Подождите с пальто.", "verdicts": None}))
        self.assertEqual(result.actions, [])
        call = provider.run_text.call_args.kwargs
        self.assertEqual(call["schema"].name, "chat.schema.json")
        for text in ("INPUT JSON:", "Это дорого?", "А что делать?", '"subject"', '"plans"', "Куртка"):
            self.assertIn(text, call["prompt"])
        self.assertEqual(call["prompt"].count("А что делать?"), 1)

    def test_numbers_missing_from_the_input_are_unverified(self):
        thread = chat.create_thread(self.owner, "spend", receipt=self.receipt)
        first = chat.send(thread, "Хватит ли 70 000?")
        InsightRequest.objects.filter(pk=first.pk).update(status="succeeded", answer={"answer": "Да, 70 000 хватит на 123 456."})
        row = chat.send(thread, "Что дальше?")
        row.status = "succeeded"
        row.answer = {"answer": "Трата 48 000 ₸ при лимите 40 000 ₸, сверх него 8 000; раньше 123 456; было 1 005 ₸.",
                      "verdicts": [{"plan_id": self.jacket.pk, "verdict": "wait", "reason": "Пальто за 90 000 подождёт до 555."}]}
        row.actions = [{"kind": "delete_plan", "label": "Удалить подарок за 30 000 и 777", "plan_id": self.gift.pk,
                        "done_at": None, "result": None}]
        self.assertEqual(queue.unverified(row), ["555", "777"])


@tag("integration")
@local_single_mode()
class LocalApiTests(ChatData, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = local_user()
        cls.seed(cls.owner)

    def setUp(self):
        self.client = APIClient()

    def post(self, url, body):
        return self.client.post(url, body, format="json")

    def test_thread_life_from_creation_to_the_confirmed_action(self):
        created = self.post(THREADS, {"kind": "plans"})
        self.assertEqual(created.status_code, 201, created.content)
        thread, messages = created.json()["thread"], created.json()["messages"]
        self.assertEqual({key: thread[key] for key in ("kind", "title", "receipt_id", "month", "last_answer_preview")},
                         {"kind": "plans", "title": "Планы", "receipt_id": None, "month": None, "last_answer_preview": None})
        self.assertEqual((messages[0]["status"], messages[0]["thread_id"], messages[0]["actions"], messages[0]["question"]),
                         ("queued", thread["id"], None, chat.PLANS_OPENER))
        self.assertEqual(self.client.get(THREADS).json()["results"][0]["id"], thread["id"])
        queue.execute(queue.claim(), writer=queue.FakeWriter())
        page = self.client.get(f"{THREADS}{thread['id']}/").json()
        message = page["messages"][0]
        self.assertEqual((message["status"], message["unverified"], message["error"]), ("succeeded", [], None))
        self.assertEqual(message["actions"][0]["done_at"], None)
        self.assertTrue(page["thread"]["last_answer_preview"].startswith(message["answer"]["answer"][:20]))
        confirmed = self.post(f"/api/insights/{message['id']}/actions/0/confirm/", {})
        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        self.assertIn("Перенесли", confirmed.json()["actions"][0]["result"])
        again = self.post(f"/api/insights/{message['id']}/actions/0/confirm/", {})
        self.assertEqual((again.status_code, again.json()["error"]["code"]), (409, "action_done"))
        bad = self.post(f"/api/insights/{message['id']}/actions/5/confirm/", {})
        self.assertEqual((bad.status_code, list(bad.json()["error"]["fields"])), (400, ["index"]))
        sent = self.post(f"{THREADS}{thread['id']}/messages/", {"question": "  А подарок?  "})
        self.assertEqual((sent.status_code, sent.json()["question"], sent.json()["status"]), (202, "А подарок?", "queued"))
        self.assertEqual(self.client.get(f"/api/insights/{sent.json()['id']}/").json()["thread_id"], thread["id"])
        self.assertEqual(len(self.client.get(f"{THREADS}{thread['id']}/").json()["messages"]), 2)
        gone = self.client.delete(f"{THREADS}{thread['id']}/")
        self.assertEqual((gone.status_code, InsightRequest.objects.count(), InsightThread.objects.count()), (204, 0, 0))

    def test_threads_about_a_spend_and_a_month_and_the_refusals(self):
        created = self.post(THREADS, {"kind": "spend", "receipt_id": self.receipt.pk, "question": "Дорого?"})
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual((created.json()["thread"]["title"], created.json()["thread"]["receipt_id"], len(created.json()["messages"])),
                         ("Трата: Склад · 48\u00a0000\u00a0KZT", self.receipt.pk, 1))
        month = self.post(THREADS, {"kind": "month", "month": "2026-09"}).json()["thread"]
        self.assertEqual((month["title"], month["month"]), ("Сентябрь 2026", "2026-09"))
        cases = [
            ({"kind": "spend"}, "receipt_id"), ({"kind": "spend", "receipt_id": 999999999}, "receipt_id"),
            ({"kind": "month"}, "month"), ({"kind": "month", "month": "2026-9"}, "month"),
            ({"kind": "other"}, "kind"), ({}, "kind"), ({"kind": "free", "question": "x" * 301}, "question"),
            ({"kind": "free", "question": 5}, "question"), ({"kind": "free", "other": 1}, "other"),
        ]
        for body, field in cases:
            with self.subTest(field=field, body=body):
                response = self.post(THREADS, body)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn(field, response.json()["error"]["fields"])
        thread = self.post(THREADS, {"kind": "free"}).json()["thread"]
        self.assertEqual(self.post(f"{THREADS}{thread['id']}/messages/", {"question": " "}).status_code, 400)
        self.post(f"{THREADS}{thread['id']}/messages/", {"question": "Раз"})
        self.post(f"{THREADS}{thread['id']}/messages/", {"question": "Два"})
        refused = self.post(f"{THREADS}{thread['id']}/messages/", {"question": "Три"})
        self.assertEqual((refused.status_code, refused.json()["error"]["code"]), (429, "parse_limit"))
        self.assertEqual(self.post("/api/insights/999999/actions/0/confirm/", {}).status_code, 404)


@tag("integration")
@accounts_mode()
class AccountsApiTests(IsolationMixin, TestCase):
    """``first`` — главный семьи с ИИ, ``third`` — член семьи; ``second`` — без семьи и не администратор."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.third = make_user("synthetic-user-three")
        cls.family = Household.objects.create(name="Синтетическая семья", ai_enabled=True)
        Membership.objects.create(user=cls.first, household=cls.family, role="head")
        Membership.objects.create(user=cls.third, household=cls.family)
        cls.clothes = Category.objects.create(name="Синтетическая одежда")
        cls.receipt = spend(cls.first, timezone.localdate(), 5000, cls.clothes, "Склад")

    def post(self, account, url, body):
        return self.client_of(account, csrf=True).post(url, body, format="json")

    def test_threads_are_seen_only_by_their_owner(self):
        created = self.post(self.first, THREADS, {"kind": "spend", "receipt_id": self.receipt.pk, "question": "Дорого?"})
        self.assertEqual(created.status_code, 201, created.content)
        thread, message = created.json()["thread"], created.json()["messages"][0]
        foreign = self.client_of(self.third)
        self.assert_same_as_missing(foreign.get(f"{THREADS}{thread['id']}/"), foreign.get(f"{THREADS}999999999/"))
        self.assertEqual(foreign.get(THREADS).json()["results"], [])
        self.assertEqual(self.post(self.third, f"{THREADS}{thread['id']}/messages/", {"question": "Моё?"}).status_code, 404)
        self.assertEqual(self.client_of(self.third, csrf=True).delete(f"{THREADS}{thread['id']}/").status_code, 404)
        self.assertEqual(self.post(self.third, f"/api/insights/{message['id']}/actions/0/confirm/", {}).status_code, 404)
        self.assertEqual(InsightThread.objects.count(), 1)
        # A spend of the family is a valid subject for a member; a foreign spend is not.
        self.assertEqual(self.post(self.third, THREADS, {"kind": "spend", "receipt_id": self.receipt.pk}).status_code, 201)
        stranger = spend(self.second, timezone.localdate(), 10, self.clothes)
        refused = self.post(self.first, THREADS, {"kind": "spend", "receipt_id": stranger.pk})
        self.assertEqual((refused.status_code, list(refused.json()["error"]["fields"])), (400, ["receipt_id"]))
        self.assertEqual(APIClient().get(THREADS).status_code, 401)

    def test_ai_refusal_leaves_no_thread(self):
        refused = self.post(self.second, THREADS, {"kind": "plans"})
        self.assertEqual((refused.status_code, refused.json()["error"]["code"]), (403, "ai_disabled"))
        self.assertFalse(InsightThread.objects.exists())
        empty = self.post(self.second, THREADS, {"kind": "free"})  # no question: no AI call, the thread exists
        self.assertEqual(empty.status_code, 201, empty.content)


@tag("integration")
class WorkerChatTests(WorkerClassificationEnvironment):
    def test_chat_request_goes_through_the_insight_step(self):
        from stores.models import Currency

        Currency.objects.get_or_create(code="KZT", defaults={"name": "Tenge"})
        Category.objects.create(name="Кафе и рестораны")
        thread = chat.create_thread(local_user(), "free", question="Сколько ушло на кафе?")
        row = thread.requests.get()
        self.assertEqual(self.worker(), [f"Insight {row.pk}: succeeded"])
        row.refresh_from_db()
        self.assertEqual((row.status, row.actions), ("succeeded", []))
        self.assertIsNotNone(recognition_worker.build_insight_writer())
