"""Sign-in with Pocket ID (``accounts.pocket_id``; 2026-10-26). Every route is ``404`` while it is off.

- ``GET /api/auth/pocket-id/`` — ``{"enabled": true, "linked": bool | null, "linked_at"}``; ``linked`` is ``null`` for a
  guest. The login page asks it to decide whether to show «Войти через Pocket ID».
- ``GET /api/auth/pocket-id/login/`` — a navigation: ``302`` to Pocket ID (a signed-in person goes to ``/``).
- ``POST /api/auth/pocket-id/link/`` — signed in + CSRF: ``{"authorize_url"}`` to open;
  ``409 pocket_id_already_linked``.
- ``DELETE /api/auth/pocket-id/link/`` — signed in + CSRF: unlink, ``204`` (also when nothing was linked).
- ``GET /api/auth/pocket-id/callback/`` — Pocket ID returns here; ends with ``302`` to ``/`` (signed in),
  ``/account?pocket_id=linked`` or, refused, ``/login?pocket_id=<code>`` / ``/account?pocket_id=<code>``.
"""
import logging

from django.contrib.auth import login
from django.db import IntegrityError, transaction
from django.http import Http404, HttpResponseRedirect
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from accounts import pocket_id
from accounts.access import request_user
from accounts.models import PocketIdIdentity
from config.exceptions import ObjectNotFound, RecognitionApiError

from .auth import AccountsSignedIn
from .recognition_base import EmptyObjectParser, LocalAPIView

log = logging.getLogger(__name__)
CALLBACK_PATH = "/api/auth/pocket-id/callback/"
BACKEND = "accounts.backends.ThrottledModelBackend"


def redirect_uri(request):
    # The host is one of DJANGO_ALLOWED_HOSTS; the scheme is https behind the proxy (SECURE_PROXY_SSL_HEADER).
    return request.build_absolute_uri(CALLBACK_PATH)


class Enabled(AllowAny):
    def has_permission(self, request, view):
        if not pocket_id.enabled():
            raise ObjectNotFound()
        return True


class EnabledSignedIn(AccountsSignedIn):
    def has_permission(self, request, view):
        if not pocket_id.enabled():
            raise ObjectNotFound()
        return super().has_permission(request, view)


class PocketIdStatusView(LocalAPIView):
    permission_classes = [Enabled]

    def get(self, request):
        user = request.user
        if not user.is_authenticated:
            return Response({"enabled": True, "linked": None, "linked_at": None})
        row = PocketIdIdentity.objects.filter(user=user).first()
        return Response({"enabled": True, "linked": row is not None,
                         "linked_at": row.created_at.isoformat() if row else None})


class PocketIdLinkView(LocalAPIView):
    permission_classes = [EnabledSignedIn]
    http_method_names = ["post", "delete", "options"]
    parser_classes = [EmptyObjectParser]

    def post(self, request):
        user = request_user(request)
        if PocketIdIdentity.objects.filter(user=user).exists():
            raise RecognitionApiError("pocket_id_already_linked")
        try:
            url = pocket_id.begin(request._request, pocket_id.LINK, redirect_uri(request._request))
        except pocket_id.PocketIdError as exc:
            log.warning("pocket_id link start refused: %s", exc)
            raise RecognitionApiError("pocket_id_unavailable") from None
        return Response({"authorize_url": url})

    def delete(self, request):
        PocketIdIdentity.objects.filter(user=request_user(request)).delete()
        return Response(status=204)


@never_cache
@require_GET
def login_start(request):
    if not pocket_id.enabled():
        raise Http404
    if request.user.is_authenticated:
        return HttpResponseRedirect("/")
    try:
        return HttpResponseRedirect(pocket_id.begin(request, pocket_id.LOGIN, redirect_uri(request)))
    except pocket_id.PocketIdError as exc:
        log.warning("pocket_id login start refused: %s", exc)
        return HttpResponseRedirect(f"/login?pocket_id={exc.code}")


def _link(request, flow, claims):
    """Binds ``sub`` to the user who started the flow, in that very session; never replaces a binding."""
    if not pocket_id.same_session_user(request, flow):
        raise pocket_id.PocketIdError("session_changed", "link callback in another session")
    user = request.user
    try:
        with transaction.atomic():
            existing = PocketIdIdentity.objects.select_for_update().filter(
                issuer=claims["iss"], subject=claims["sub"]).first()
            if existing is not None:
                if existing.user_id != user.pk:
                    raise pocket_id.PocketIdError("already_linked", "sub bound to another user")
                return
            if PocketIdIdentity.objects.filter(user=user).exists():
                raise pocket_id.PocketIdError("already_linked", "user has another binding")
            PocketIdIdentity.objects.create(user=user, issuer=claims["iss"], subject=claims["sub"])
    except IntegrityError:
        raise pocket_id.PocketIdError("already_linked", "concurrent binding") from None


def _sign_in(request, claims):
    """Exactly the user bound to ``iss`` + ``sub``; anything else is refused. No email, no new users."""
    row = (PocketIdIdentity.objects.select_related("user")
           .filter(issuer=claims["iss"], subject=claims["sub"]).first())
    if row is None:
        raise pocket_id.PocketIdError("not_linked", "unknown sub")
    if not row.user.is_active:
        raise pocket_id.PocketIdError("not_linked", "inactive user")
    # A new session key and CSRF token, as with the password; another person's session is flushed.
    login(request, row.user, backend=BACKEND)
    PocketIdIdentity.objects.filter(pk=row.pk).update(last_login_at=timezone.now())


@never_cache
@require_GET
def callback(request):
    if not pocket_id.enabled():
        raise Http404
    purpose = pocket_id.LOGIN
    try:
        flow = pocket_id.take_flow(request, request.GET.get("state"))
        purpose = flow.get("purpose")
        if request.GET.get("error"):
            raise pocket_id.PocketIdError("denied", "provider error")
        claims = pocket_id.exchange(request.GET.get("code"), flow)
        if purpose == pocket_id.LINK:
            _link(request, flow, claims)
            return HttpResponseRedirect("/account?pocket_id=linked")
        if purpose != pocket_id.LOGIN:
            raise pocket_id.PocketIdError("failed", "purpose")
        _sign_in(request, claims)
        return HttpResponseRedirect("/")
    except pocket_id.PocketIdError as exc:
        log.warning("pocket_id callback refused (%s): %s", purpose, exc)
        page = "/account" if purpose == pocket_id.LINK else "/login"
        return HttpResponseRedirect(f"{page}?pocket_id={exc.code}")
