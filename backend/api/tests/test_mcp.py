"""MCP по личному токену (accounts.mcp): JSON-RPC на /mcp, права read/write, видимость как у приложения."""
import json

from django.test import TestCase, tag
from rest_framework.test import APIClient

from accounts import mcp
from accounts.models import ApiToken
from budget.models import BudgetLimit
from catalog.models import Category
from goals.models import Contribution, Goal
from planned.models import PlannedSpend
from receipts import manual
from receipts.models import Receipt

from .accounts_helpers import TwoUsers, accounts_mode, local_single_mode


def rpc(method, params=None, id_=1):
    return json.dumps({"jsonrpc": "2.0", "id": id_, "method": method, **({"params": params} if params is not None else {})})


@tag("integration")
@accounts_mode()
class McpTests(TwoUsers, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.food = Category.objects.create(name="Демо-еда")
        cls.mine = manual.create(cls.first, {"total": "1500", "currency": "KZT", "category": cls.food.pk, "store_name": "Кофейня"})
        cls.theirs = manual.create(cls.second, {"total": "700", "currency": "KZT", "category": cls.food.pk})

    def post(self, token, body, path="/mcp"):
        headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
        return APIClient().generic("POST", path, body, content_type="application/json", **headers)

    def call(self, token, name, arguments=None):
        response = self.post(token, rpc("tools/call", {"name": name, "arguments": arguments or {}}))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def test_handshake_lists_tools_by_scope(self):
        _, read = mcp.issue(self.first, "чтение", "read")
        _, write = mcp.issue(self.first, "запись", "write")
        init = self.post(read, rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                                  "clientInfo": {"name": "t", "version": "1"}})).json()["result"]
        self.assertEqual(init["protocolVersion"], "2025-06-18")
        self.assertIn("tools", init["capabilities"])
        self.assertEqual(self.post(read, json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"})).status_code, 202)
        names = lambda token: {tool["name"] for tool in self.post(token, rpc("tools/list")).json()["result"]["tools"]}
        self.assertIn("list_spends", names(read))
        self.assertNotIn("add_spend", names(read))
        self.assertIn("add_spend", names(write))
        # A read token cannot call a write tool even by its name.
        self.assertTrue(self.call(read, "add_spend", {"total": "1", "category": self.food.pk})["isError"])
        self.assertEqual(Receipt.objects.count(), 2)

    def test_reads_only_what_the_owner_sees_and_writes_as_the_owner(self):
        _, token = mcp.issue(self.first, "ИИ", "write")
        spends = self.call(token, "list_spends")["structuredContent"]
        self.assertEqual([row["id"] for row in spends["results"]], [self.mine.pk])
        foreign = self.call(token, "get_spend", {"id": self.theirs.pk})
        self.assertTrue(foreign["isError"])
        self.assertEqual(foreign["structuredContent"]["status"], 404)
        added = self.call(token, "add_spend", {"total": "250", "currency": "KZT", "category": self.food.pk, "note": "MCP"})
        self.assertFalse(added["isError"], added)
        saved = Receipt.objects.get(pk=added["structuredContent"]["id"])
        self.assertEqual((saved.owner_id, saved.note), (self.first.pk, "MCP"))
        bad = self.call(token, "add_spend", {"total": "-1", "category": self.food.pk})
        self.assertTrue(bad["isError"])
        self.assertEqual(bad["structuredContent"]["status"], 400)
        self.assertFalse(self.call(token, "delete_spend", {"id": saved.pk})["isError"])
        self.assertFalse(Receipt.objects.filter(pk=saved.pk).exists())

    def test_every_read_tool_answers(self):
        _, token = mcp.issue(self.first, "все", "read")
        for tool in mcp.TOOLS:
            if tool["write"] or tool["schema"]["required"]:
                continue
            with self.subTest(tool=tool["name"]):
                result = self.call(token, tool["name"])
                self.assertFalse(result["isError"], result["content"][0]["text"][:300])

    def test_a_read_token_does_not_see_the_new_write_tools(self):
        _, read = mcp.issue(self.first, "чтение", "read")
        listed = {tool["name"]: tool for tool in self.post(read, rpc("tools/list")).json()["result"]["tools"]}
        writes = {tool["name"] for tool in mcp.TOOLS if tool["write"]}
        for name in ("add_planned", "update_planned", "delete_planned", "planned_deposit", "add_goal", "update_goal",
                     "delete_goal", "add_contribution", "update_contribution", "delete_contribution",
                     "reconcile_deposit", "delete_limit", "set_month_budget", "clear_month_budget", "update_income",
                     "delete_income", "add_recurring", "update_recurring", "delete_recurring", "pay_recurring"):
            self.assertIn(name, writes)
            self.assertNotIn(name, listed)
        for name in ("list_planned", "get_planned", "planned_advice", "get_goal", "list_income_categories",
                     "get_month_budget"):
            self.assertTrue(listed[name]["annotations"]["readOnlyHint"], name)
        # Every tool that does not GET is a write tool.
        self.assertEqual({tool["name"] for tool in mcp.TOOLS if tool["method"] != "GET"}, writes)
        self.assertTrue(self.call(read, "delete_limit", {"id": 1})["isError"])

    def test_adds_a_planned_spend_in_a_month(self):
        _, token = mcp.issue(self.first, "ИИ", "write")
        added = self.call(token, "add_planned", {"name": "Шины", "amount": "80000", "due": "2027-11-15",
                                                 "due_exact": False, "category_id": self.food.pk})
        self.assertFalse(added["isError"], added)
        plan = PlannedSpend.objects.get(pk=added["structuredContent"]["id"])
        self.assertEqual((plan.name, str(plan.amount), plan.due.isoformat(), plan.due_exact, plan.category_id),
                         ("Шины", "80000.00", "2027-11-01", False, self.food.pk))
        listed = self.call(token, "list_planned", {"month": "2027-11"})["structuredContent"]
        self.assertEqual([row["id"] for row in listed["rows"]], [plan.pk])
        moved = self.call(token, "update_planned", {"id": plan.pk, "due": None})
        self.assertFalse(moved["isError"], moved)
        self.assertIsNone(moved["structuredContent"]["due"])
        self.assertFalse(self.call(token, "delete_planned", {"id": plan.pk})["isError"])
        self.assertFalse(PlannedSpend.objects.filter(pk=plan.pk).exists())

    def test_opens_a_deposit_and_puts_money_into_it(self):
        _, token = mcp.issue(self.first, "ИИ", "write")
        added = self.call(token, "add_goal", {"name": "Депозит", "amount": "1000000", "kind": "deposit", "rate": "14"})
        self.assertFalse(added["isError"], added)
        goal = Goal.objects.get(pk=added["structuredContent"]["id"])
        self.assertEqual((goal.kind, str(goal.rate), goal.capitalization, goal.user_id),
                         ("deposit", "14.00", "monthly", self.first.pk))
        put = self.call(token, "add_contribution", {"id": goal.pk, "amount": "50000"})
        self.assertFalse(put["isError"], put)
        self.assertEqual(put["structuredContent"]["contributions_count"], 1)
        contribution = Contribution.objects.get(goal=goal)
        self.assertEqual((str(contribution.amount), contribution.user_id), ("50000.00", self.first.pk))
        removed = self.call(token, "delete_contribution", {"id": goal.pk, "contribution_id": contribution.pk})
        self.assertFalse(removed["isError"], removed)
        self.assertFalse(Contribution.objects.filter(goal=goal).exists())
        self.assertFalse(self.call(token, "delete_goal", {"id": goal.pk})["isError"])
        self.assertFalse(Goal.objects.filter(pk=goal.pk).exists())

    def test_deletes_a_limit(self):
        _, token = mcp.issue(self.first, "ИИ", "write")
        added = self.call(token, "add_limit", {"category_id": self.food.pk, "currency": "KZT", "amount": "30000"})
        self.assertFalse(added["isError"], added)
        limit_id = added["structuredContent"]["id"]
        self.assertFalse(self.call(token, "delete_limit", {"id": limit_id})["isError"])
        self.assertFalse(BudgetLimit.objects.filter(pk=limit_id).exists())
        again = self.call(token, "delete_limit", {"id": limit_id})
        self.assertEqual((again["isError"], again["structuredContent"]["status"]), (True, 404))

    def test_recurring_and_incomes_are_written_through_their_views(self):
        _, token = mcp.issue(self.first, "ИИ", "write")
        added = self.call(token, "add_recurring", {"name": "Интернет", "category_id": self.food.pk, "currency": "KZT",
                                                   "amount": "9000", "due_day": 5})
        self.assertFalse(added["isError"], added)
        payment_id = added["structuredContent"]["id"]
        changed = self.call(token, "update_recurring", {"id": payment_id, "amount": "9500"})
        self.assertEqual(changed["structuredContent"]["amount"], "9500.00")
        self.assertFalse(self.call(token, "delete_recurring", {"id": payment_id})["isError"])
        category = self.call(token, "list_income_categories")["structuredContent"]["results"][0]["id"]
        income = self.call(token, "add_income", {"amount": "100000", "category": category})["structuredContent"]
        changed = self.call(token, "update_income", {"id": income["id"], "note": "аванс"})
        self.assertEqual(changed["structuredContent"]["note"], "аванс")
        self.assertFalse(self.call(token, "delete_income", {"id": income["id"]})["isError"])

    def test_refuses_without_a_live_token(self):
        row, token = mcp.issue(self.first, "старый", "read")
        self.assertEqual(self.post(None, rpc("tools/list")).status_code, 401)
        self.assertEqual(self.post("ck_wrong", rpc("tools/list")).status_code, 401)
        self.assertEqual(self.post(None, rpc("tools/list"), path=f"/mcp/{token}").status_code, 200)
        # A token in the address only reads, even a write token.
        _, writer = mcp.issue(self.first, "в адресе", "write")
        listed = APIClient().generic("POST", f"/mcp/{writer}", rpc("tools/list"), content_type="application/json").json()
        self.assertNotIn("add_spend", {tool["name"] for tool in listed["result"]["tools"]})
        ApiToken.objects.filter(pk=row.pk).update(revoked_at="2026-10-15T00:00:00Z")
        self.assertEqual(self.post(token, rpc("tools/list")).status_code, 401)
        self.assertEqual(APIClient().get("/mcp").status_code, 405)

    def test_tokens_are_issued_and_revoked_by_the_session_only(self):
        client = self.client_of(self.first, csrf=True)
        created = client.post("/api/auth/tokens/", {"name": "Claude", "scope": "write"}, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        token = created.json()["token"]
        self.assertTrue(token.startswith("ck_"))
        listed = self.client_of(self.first).get("/api/auth/tokens/").json()["results"]
        self.assertEqual([(row["name"], row["scope"]) for row in listed], [("Claude", "write")])
        self.assertNotIn("token", listed[0])
        self.assertFalse(ApiToken.objects.filter(token_hash=token).exists())  # only the hash is kept
        self.assertEqual(client.post("/api/auth/tokens/", {"name": "x", "scope": "admin"}, format="json").status_code, 400)
        # Another person cannot revoke it; the owner can.
        self.assertEqual(self.client_of(self.second, csrf=True).delete(f"/api/auth/tokens/{created.json()['id']}/").status_code, 404)
        self.assertEqual(client.delete(f"/api/auth/tokens/{created.json()['id']}/").status_code, 204)
        self.assertEqual(self.post(token, rpc("tools/list")).status_code, 401)
        self.assertEqual(APIClient().get("/api/auth/tokens/").status_code, 401)

    def test_a_password_change_revokes_the_tokens(self):
        from .accounts_helpers import make_user, signed_in
        account = make_user("synthetic-password-change", password="synthetic-password")
        _, token = mcp.issue(account, "до смены", "write")
        changed = signed_in(account, csrf=True).post("/api/auth/password/", {
            "current_password": "synthetic-password", "new_password": "Gx7-violet-harbor-91"}, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(self.post(token, rpc("tools/list")).status_code, 401)


@tag("integration")
@local_single_mode()
class McpLocalSingleTests(TestCase):
    def test_off_without_accounts(self):
        self.assertEqual(APIClient().generic("POST", "/mcp", rpc("tools/list"), content_type="application/json").status_code, 404)
