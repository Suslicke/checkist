"""MCP: подключение любой нейросети к Чекисту по личному токену (2026-10-15).

Транспорт — Streamable HTTP без состояния на одном адресе ``/mcp``: каждый JSON-RPC запрос — свой ``POST``, ответ —
один JSON (SSE и сессии не нужны: сервер не шлёт ничего сам), уведомление — ``202`` без тела, ``GET``/``DELETE`` —
``405``. Понимает и прежние ревизии с ``initialize`` (2025-03-26 … 2025-11-25), и 2026-07-28 без него.

Вход — ``Authorization: Bearer ck_…`` либо токен в адресе ``/mcp/<токен>`` (для клиентов, где вписать можно только
адрес). Каждый инструмент вызывает **существующий вью API** внутри процесса от имени владельца токена: видимость семьи,
скрытые траты, «видит с», права модератора и проверки тела — те же, что у приложения, второй копии правил нет.
Токен ``read`` получает только инструменты чтения, ``write`` — ещё и записи. Только режим ``accounts``.
"""
import hashlib
import json
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from django.http import HttpResponse, JsonResponse
from django.test.client import RequestFactory
from django.urls import resolve
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from accounts.access import ACCOUNTS, mode
from accounts.models import ApiToken

TOKEN_PREFIX = "ck_"
VERSIONS = ("2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26")
SERVER = {"name": "checkist", "title": "Чекист", "version": "1.0.0"}
BODY_MAX = 256 * 1024
INSTRUCTIONS = (
    "Checkist is a family budget: spends (receipts from photos, manual spends, bank statements), incomes, monthly "
    "limits by category, recurring payments and savings goals. Data and names are mostly Russian/Kazakh; money is a "
    "decimal string with its currency (KZT by default). Dates are YYYY-MM-DD, months YYYY-MM. Call list_categories "
    "before writing a category id. Never invent ids: read them first."
)


# ---- tokens -----------------------------------------------------------------------------------------------------

def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def issue(user, name, scope):
    """issue(user, name, scope) -> (ApiToken, token); the token itself is never stored."""
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    row = ApiToken.objects.create(user=user, name=name, scope=scope, token_hash=digest(token), prefix=token[:10])
    return row, token


def authenticate(token):
    """The live token row with its active user, or None."""
    if not token or not token.startswith(TOKEN_PREFIX) or len(token) > 100:
        return None
    row = ApiToken.objects.select_related("user").filter(token_hash=digest(token), revoked_at__isnull=True).first()
    if row is None or not row.user.is_active:
        return None
    now = timezone.now()
    if row.last_used_at is None or now - row.last_used_at > timedelta(minutes=1):
        ApiToken.objects.filter(pk=row.pk).update(last_used_at=now)
    return row


# ---- tools ------------------------------------------------------------------------------------------------------

def _s(description, **extra):
    return {"type": "string", "description": description, **extra}


def _i(description):
    return {"type": "integer", "description": description}


DATE = _s("YYYY-MM-DD")
MONTH = _s("YYYY-MM; default — the current month")
LINE = {"type": "object", "properties": {
    "id": _i("existing line id (update_spend only): kept with its product"), "name": _s("position name"),
    "amount": _s("sum to pay for the line, before the line discount"), "quantity": _s("default 1"),
    "unit": _s("pcs|kg|g|l|ml|m"), "unit_price": _s("price per unit"), "discount_amount": _s("line discount"),
    "category": _i("category id of this position"),
}, "required": ["name", "amount"]}
SPEND = {
    "total": _s("sum of the spend (without lines: required together with category)"),
    "currency": _s("ISO code, e.g. KZT"), "category": _i("category id (spend without lines)"),
    "purchased_on": DATE, "store_name": _s("place; empty — no place"), "note": _s("comment"),
    "payment_method": _s("kaspi_gold|forte|cash|crypto|card or empty"),
    "item_name": _s("what was bought, one catalog product (spend without lines)"),
    "lines": {"type": "array", "items": LINE, "description": "positions; the total is their sum"},
}


def _tool(name, description, method, path, *, query=(), body=(), properties=None, required=(), write=False,
          path_args=()):
    return {"name": name, "description": description, "method": method, "path": path, "query": query, "body": body,
            "path_args": path_args, "write": write,
            "schema": {"type": "object", "properties": properties or {}, "required": list(required),
                       "additionalProperties": False}}


TOOLS = [
    _tool("whoami", "Who the token belongs to: user, family, permissions, default currency.", "GET", "/api/me/"),
    _tool("dashboard", "Month overview: spent by top categories with limits, month budget, «can spend per day», "
          "last spends.", "GET", "/api/dashboard/", query=("month",), properties={"month": MONTH}),
    _tool("list_spends", "Spends (receipts) newest first, 50 per page. q searches place, product, comment and sum.",
          "GET", "/api/receipts/", query=("date_from", "date_to", "q", "store", "owner", "page", "page_size"),
          properties={"date_from": DATE, "date_to": DATE, "q": _s("search text or a sum"), "store": _i("store id"),
                      "owner": _s("family member login"), "page": _i("page, from 1"), "page_size": _i("1–200")}),
    _tool("get_spend", "One spend with its positions (lines, categories, discounts).", "GET", "/api/receipts/{id}/",
          path_args=("id",), properties={"id": _i("spend id")}, required=("id",)),
    _tool("spending_stats", "Spent over a period grouped by category (or generic product, product, store). With "
          "category — its subcategories.", "GET", "/api/stats/spending/",
          query=("date_from", "date_to", "group_by", "category", "currency", "limit"),
          properties={"date_from": DATE, "date_to": DATE, "group_by": _s("category|generic|product|store"),
                      "category": _i("category id to drill into"), "currency": _s("ISO code"),
                      "limit": _i("items before «other», 1–500")}),
    _tool("monthly_trends", "Spends by month and top category, change month to month.", "GET",
          "/api/stats/trends/monthly/", query=("months",), properties={"months": _i("1–60, default 12")}),
    _tool("list_categories", "The category tree of spends (id, name, path). Use these ids in writes.", "GET",
          "/api/categories/", query=("page_size",), properties={"page_size": _i("default — all")}),
    _tool("list_limits", "Monthly limits by category of the family.", "GET", "/api/budget/limits/"),
    _tool("list_incomes", "Incomes of a month visible to the user and the family total.", "GET", "/api/incomes/",
          query=("month",), properties={"month": MONTH}),
    _tool("list_recurring", "Recurring payments and incomes of a month and whether they are paid.", "GET",
          "/api/recurring/", query=("month",), properties={"month": MONTH}),
    _tool("list_goals", "Savings goals with progress and forecast.", "GET", "/api/goals/"),
    _tool("list_stores", "Places of the family with spend counts and other spellings.", "GET", "/api/store-merges/"),
    _tool("add_spend", "Add a spend (manual): either total + category, or lines. Returns the saved spend.", "POST",
          "/api/receipts/manual/", body=tuple(SPEND), properties=SPEND, write=True),
    _tool("update_spend", "Change a spend: any of its fields; lines replace all positions (keep id of a line to "
          "keep it). Read it with get_spend first.", "PATCH", "/api/receipts/{id}/", path_args=("id",),
          body=tuple(SPEND), properties={"id": _i("spend id"), **SPEND}, required=("id",), write=True),
    _tool("delete_spend", "Delete a spend (a photo receipt keeps its photo).", "DELETE", "/api/receipts/{id}/",
          path_args=("id",), properties={"id": _i("spend id")}, required=("id",), write=True),
    _tool("add_income", "Add an income. category — id of an income category (see list_incomes results).", "POST",
          "/api/incomes/", body=("amount", "category", "currency", "received_on", "note"),
          properties={"amount": _s("sum"), "category": _i("income category id"), "currency": _s("ISO code"),
                      "received_on": DATE, "note": _s("comment")}, required=("amount", "category"), write=True),
    _tool("add_limit", "Add a monthly limit of a category (in the family's base currency).", "POST",
          "/api/budget/limits/", body=("category_id", "currency", "amount"),
          properties={"category_id": _i("category id"), "currency": _s("ISO code"), "amount": _s("sum per month")},
          required=("category_id", "currency", "amount"), write=True),
    _tool("update_limit", "Change the sum of a limit.", "PATCH", "/api/budget/limits/{id}/", path_args=("id",),
          body=("amount",), properties={"id": _i("limit id"), "amount": _s("sum per month")},
          required=("id", "amount"), write=True),
]
BY_NAME = {tool["name"]: tool for tool in TOOLS}


def tools_for(scope):
    return [{"name": tool["name"], "description": tool["description"], "inputSchema": tool["schema"],
             "annotations": {"readOnlyHint": not tool["write"], "destructiveHint": tool["method"] == "DELETE"}}
            for tool in TOOLS if scope == ApiToken.Scope.WRITE or not tool["write"]]


def call_api(outer, user, method, path, query=None, body=None):
    """The API view of ``path`` answered for ``user``, inside this process: (status, data)."""
    factory = RequestFactory(HTTP_HOST=outer.get_host(), **{"wsgi.url_scheme": outer.scheme})
    url = path + ("?" + urlencode(query) if query else "")
    if body is None:
        inner = getattr(factory, method.lower())(url)
    else:
        inner = getattr(factory, method.lower())(url, data=json.dumps(body), content_type="application/json")
    inner.user = user
    # The address of the caller, never the factory's loopback: no view may take the call for a local one.
    inner.META["REMOTE_ADDR"] = outer.META.get("REMOTE_ADDR", "")
    # The token is not a cookie: CSRF guards cookies, there is nothing to forge here.
    inner._dont_enforce_csrf_checks = True
    match = resolve(path)
    response = match.func(inner, *match.args, **match.kwargs)
    if hasattr(response, "render"):
        response.render()
    content = response.content.decode() if response.content else ""
    try:
        data = json.loads(content) if content else None
    except ValueError:
        data = content
    return response.status_code, data


def _failure(text):
    return {"isError": True, "content": [{"type": "text", "text": text}]}


def run_tool(outer, token, name, arguments):
    tool = BY_NAME.get(name)
    if tool is None or (tool["write"] and token.scope != ApiToken.Scope.WRITE):
        return _failure(f"Unknown tool: {name}")
    arguments = arguments if isinstance(arguments, dict) else {}
    unknown = sorted(set(arguments) - set(tool["schema"]["properties"]))
    missing = [key for key in tool["schema"]["required"] if key not in arguments]
    if unknown or missing:
        return _failure(" ".join(filter(None, [unknown and f"Unknown arguments: {unknown}.",
                                               missing and f"Missing: {missing}."])))
    path = tool["path"]
    for key in tool["path_args"]:
        value = arguments[key]
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            return _failure(f"{key} must be a positive integer")
        path = path.replace("{" + key + "}", str(value))
    query = {key: arguments[key] for key in tool["query"] if arguments.get(key) not in (None, "")}
    body = {key: arguments[key] for key in tool["body"] if key in arguments} if tool["method"] in ("POST", "PATCH") else None
    status, data = call_api(outer, token.user, tool["method"], path, query, body)
    if name == "get_spend" and status == 200 and isinstance(data, dict):
        _, lines = call_api(outer, token.user, "GET", path + "lines/", {"page_size": 200})
        data = {**data, "lines": lines.get("results", lines) if isinstance(lines, dict) else lines}
    result = {"status": status, "data": data} if status >= 400 else (data if data is not None else {"status": status})
    return {"isError": status >= 400, "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
            **({"structuredContent": result} if isinstance(result, dict) else {})}


# ---- JSON-RPC over Streamable HTTP ------------------------------------------------------------------------------

def _error(id_, code, message, status=200):
    return JsonResponse({"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}, status=status)


def _result(id_, result):
    return JsonResponse({"jsonrpc": "2.0", "id": id_, "result": result})


def _bearer(request, path_token):
    header = request.headers.get("Authorization", "")
    return header[7:].strip() if header.startswith("Bearer ") else path_token


@csrf_exempt
def endpoint(request, path_token=None):
    if mode() != ACCOUNTS:
        return HttpResponse(status=404)
    if request.method != "POST":
        response = HttpResponse(status=405)
        response["Allow"] = "POST"
        return response
    token = authenticate(_bearer(request, path_token))
    if token is None:
        response = JsonResponse({"error": "invalid_token"}, status=401)
        response["WWW-Authenticate"] = 'Bearer error="invalid_token"'
        return response
    if len(request.body) > BODY_MAX:
        return _error(None, -32600, "Request too large", status=413)
    try:
        message = json.loads(request.body)
    except ValueError:
        return _error(None, -32700, "Parse error", status=400)
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
        return _error(None, -32600, "Invalid Request", status=400)
    method, params, id_ = message["method"], message.get("params") or {}, message.get("id")
    if "id" not in message:  # a notification (notifications/initialized and the like)
        return HttpResponse(status=202)
    if not isinstance(params, dict):
        return _error(id_, -32602, "Invalid params", status=400)
    if method == "initialize":
        asked = params.get("protocolVersion")
        return _result(id_, {
            "protocolVersion": asked if asked in VERSIONS else VERSIONS[1],
            "capabilities": {"tools": {"listChanged": False}}, "serverInfo": SERVER, "instructions": INSTRUCTIONS,
        })
    if method == "ping":
        return _result(id_, {})
    if method == "tools/list":
        return _result(id_, {"tools": tools_for(token.scope)})
    if method == "tools/call":
        if not isinstance(params.get("name"), str):
            return _error(id_, -32602, "Invalid params: name", status=400)
        return _result(id_, run_tool(request, token, params["name"], params.get("arguments")))
    return _error(id_, -32601, "Method not found", status=404)
