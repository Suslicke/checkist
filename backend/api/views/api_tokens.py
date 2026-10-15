"""Токены MCP (2026-10-15): ``GET``/``POST /api/auth/tokens/``, ``DELETE /api/auth/tokens/{id}/``.

Только вход по сессии (``accounts``; в ``local_single`` — ``404``): сам MCP этих путей не вызывает. ``POST``
``{"name", "scope": "read" | "write"}`` → ``201`` с полем ``token`` — единственный раз, когда он виден. Отзыв —
``revoked_at``, строка остаётся в списке. Список — свои токены, новые сверху; отозванные — последние 20.
"""
from django.utils import timezone
from rest_framework.response import Response

from accounts import mcp
from accounts.access import request_user
from accounts.models import ApiToken
from config.exceptions import InvalidParameter, ObjectNotFound

from .auth import AccountsSignedIn
from .receipts import manual_body
from .recognition import path_id
from .recognition_base import JsonObjectParser, LocalAPIView

NAME_MAX = 60
TOKENS_MAX = 20  # живых токенов у человека


def token_object(row):
    return {"id": row.pk, "name": row.name, "scope": row.scope, "prefix": row.prefix,
            "created_at": row.created_at.isoformat(), "last_used_at": row.last_used_at and row.last_used_at.isoformat(),
            "revoked_at": row.revoked_at and row.revoked_at.isoformat()}


class ApiTokensView(LocalAPIView):
    permission_classes = [AccountsSignedIn]
    http_method_names = ["get", "post", "options"]
    parser_classes = [JsonObjectParser]

    def get(self, request):
        rows = ApiToken.objects.filter(user=request_user(request))
        live = [token_object(row) for row in rows.filter(revoked_at__isnull=True)]
        revoked = [token_object(row) for row in rows.filter(revoked_at__isnull=False)[:20]]
        return Response({"results": live + revoked})

    def post(self, request):
        data = manual_body(request)
        errors = {key: ["Неизвестное поле."] for key in data if key not in ("name", "scope")}
        name = data.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > NAME_MAX or "\x00" in name:
            errors["name"] = [f"Название — от 1 до {NAME_MAX} символов."]
        if data.get("scope") not in ApiToken.Scope.values:
            errors["scope"] = ["Права — read либо write."]
        user = request_user(request)
        if not errors and ApiToken.objects.filter(user=user, revoked_at__isnull=True).count() >= TOKENS_MAX:
            errors["name"] = [f"Не больше {TOKENS_MAX} действующих токенов: отзовите ненужный."]
        if errors:
            raise InvalidParameter(errors)
        row, token = mcp.issue(user, name.strip(), data["scope"])
        return Response({**token_object(row), "token": token}, status=201)


class ApiTokenView(LocalAPIView):
    permission_classes = [AccountsSignedIn]
    http_method_names = ["delete", "options"]

    def delete(self, request, pk):
        updated = ApiToken.objects.filter(pk=path_id(pk), user=request_user(request), revoked_at__isnull=True).update(
            revoked_at=timezone.now())
        if not updated and not ApiToken.objects.filter(pk=path_id(pk), user=request_user(request)).exists():
            raise ObjectNotFound()
        return Response(status=204)
