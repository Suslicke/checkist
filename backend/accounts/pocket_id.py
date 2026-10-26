"""Sign-in with Pocket ID: OpenID Connect authorization code flow with PKCE (2026-10-26).

Checkist is its own confidential client of Pocket ID. On only in the ``accounts`` mode and only when
``POCKET_ID_ISSUER``, ``POCKET_ID_CLIENT_ID`` and ``POCKET_ID_CLIENT_SECRET`` are all set.

Rules (the same as JobSync and lead-platform):

- an account is found **only** by the pair ``iss`` + ``sub`` (``PocketIdIdentity``); email is never read, an unknown
  ``sub`` is refused and no user is ever created;
- a binding is created only by the signed-in user from «Аккаунт»; the callback checks that the same user's session is
  still the one that started the flow; a ``sub`` of another user or a second binding is refused, never replaced;
- the ID token is verified here: RS256 signature by the provider's JWKS, ``iss``, ``aud`` (and ``azp``), ``exp``,
  ``iat`` and the ``nonce`` of this flow; the state and the PKCE verifier live in the Django session, single use.

No new dependency: ``requests`` and ``cryptography`` are already in the image (pywebpush). mozilla-django-oidc was
not taken: it verifies neither ``iss`` nor ``aud``, has no "link from a signed-in session" flow and would add PyJWT.
"""
import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from urllib.parse import urlencode

import requests
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.conf import settings
from django.contrib.auth import HASH_SESSION_KEY, SESSION_KEY

from accounts.access import ACCOUNTS, mode

FLOW_KEY = "pocket_id_flow"
FLOW_TTL = 600  # seconds from the redirect to Pocket ID until the callback
LEEWAY = 60  # clock skew allowed for exp / iat
HTTP_TIMEOUT = 10
DISCOVERY_TTL = 3600
SCOPE = "openid"
LOGIN = "login"
LINK = "link"

_cache = {}
_lock = threading.Lock()


class PocketIdError(Exception):
    """A refused flow; ``code`` goes to the address of the page the person returns to."""

    def __init__(self, code, detail=""):
        super().__init__(detail or code)
        self.code = code


def config():
    """(issuer, client_id, client_secret) or ``None`` when the sign-in is off."""
    issuer = getattr(settings, "POCKET_ID_ISSUER", "")
    client_id = getattr(settings, "POCKET_ID_CLIENT_ID", "")
    secret = getattr(settings, "POCKET_ID_CLIENT_SECRET", "")
    if mode() != ACCOUNTS or not (issuer and client_id and secret):
        return None
    return issuer, client_id, secret


def enabled():
    return config() is not None


def reset_cache():
    with _lock:
        _cache.clear()


def _get_json(url):
    try:
        response = requests.get(url, timeout=HTTP_TIMEOUT, headers={"Accept": "application/json"})
    except requests.RequestException as exc:
        raise PocketIdError("unavailable", str(exc)) from None
    if response.status_code != 200:
        raise PocketIdError("unavailable", f"{url}: HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError:
        raise PocketIdError("unavailable", f"{url}: not JSON") from None
    if not isinstance(data, dict):
        raise PocketIdError("unavailable", f"{url}: not an object")
    return data


def discovery():
    """The provider's metadata; its ``issuer`` must equal ours exactly."""
    issuer = config()[0]
    now = time.monotonic()
    with _lock:
        cached = _cache.get("discovery")
        if cached and cached[0] == issuer and now - cached[1] < DISCOVERY_TTL:
            return cached[2]
    data = _get_json(f"{issuer}/.well-known/openid-configuration")
    if data.get("issuer") != issuer:
        raise PocketIdError("unavailable", "discovery issuer mismatch")
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        if not isinstance(data.get(key), str) or not data[key].startswith(("https://", "http://")):
            raise PocketIdError("unavailable", f"discovery without {key}")
    with _lock:
        _cache["discovery"] = (issuer, now, data)
    return data


def _b64decode(part):
    if not isinstance(part, str):
        raise ValueError("not text")
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def _b64encode(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _rsa_key(jwk):
    n = int.from_bytes(_b64decode(jwk["n"]), "big")
    e = int.from_bytes(_b64decode(jwk["e"]), "big")
    return rsa.RSAPublicNumbers(e, n).public_key()


def _signing_key(kid, refresh=False):
    """The RSA key ``kid`` of the provider's JWKS; an unknown ``kid`` re-reads the set once (key rotation)."""
    uri = discovery()["jwks_uri"]
    with _lock:
        cached = _cache.get("jwks")
    if refresh or not cached or cached[0] != uri:
        keys = _get_json(uri).get("keys")
        if not isinstance(keys, list):
            raise PocketIdError("unavailable", "JWKS without keys")
        cached = (uri, keys)
        with _lock:
            _cache["jwks"] = cached
    for jwk in cached[1]:
        if (isinstance(jwk, dict) and jwk.get("kty") == "RSA" and jwk.get("kid") == kid
                and jwk.get("use", "sig") == "sig" and jwk.get("alg", "RS256") == "RS256"):
            try:
                return _rsa_key(jwk)
            except (KeyError, ValueError, TypeError):
                raise PocketIdError("invalid_token", "bad JWK") from None
    if not refresh:
        return _signing_key(kid, refresh=True)
    raise PocketIdError("invalid_token", "unknown kid")


def verify_id_token(token, nonce, now=None):
    """The verified claims of ``token`` or ``PocketIdError("invalid_token")``."""
    issuer, client_id, _ = config()
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
        header = json.loads(_b64decode(header_b64))
        claims = json.loads(_b64decode(payload_b64))
        signature = _b64decode(signature_b64)
    except (AttributeError, ValueError, TypeError):
        raise PocketIdError("invalid_token", "malformed") from None
    if not isinstance(header, dict) or not isinstance(claims, dict):
        raise PocketIdError("invalid_token", "malformed")
    # Only RS256: "none", HS256 with the public key as a secret and the like never pass.
    if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
        raise PocketIdError("invalid_token", "alg")
    key = _signing_key(header["kid"])
    try:
        key.verify(signature, f"{header_b64}.{payload_b64}".encode(), padding.PKCS1v15(), hashes.SHA256())
    except InvalidSignature:
        raise PocketIdError("invalid_token", "signature") from None
    now = time.time() if now is None else now
    if claims.get("iss") != issuer:
        raise PocketIdError("invalid_token", "iss")
    audience = claims.get("aud")
    audiences = audience if isinstance(audience, list) else [audience]
    if client_id not in audiences or (len(audiences) > 1 and claims.get("azp") != client_id):
        raise PocketIdError("invalid_token", "aud")
    if "azp" in claims and claims["azp"] != client_id:
        raise PocketIdError("invalid_token", "azp")
    exp, iat = claims.get("exp"), claims.get("iat")
    if not isinstance(exp, (int, float)) or isinstance(exp, bool) or exp + LEEWAY < now:
        raise PocketIdError("invalid_token", "exp")
    if not isinstance(iat, (int, float)) or isinstance(iat, bool) or iat - LEEWAY > now:
        raise PocketIdError("invalid_token", "iat")
    if not isinstance(claims.get("nonce"), str) or not hmac.compare_digest(claims["nonce"], nonce):
        raise PocketIdError("invalid_token", "nonce")
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject or len(subject) > 255:
        raise PocketIdError("invalid_token", "sub")
    return claims


def begin(request, purpose, redirect_uri):
    """Starts a flow in this session and returns the address of Pocket ID's authorization page.

    ``link`` remembers who started it: the user id and the session's auth hash, re-checked by the callback.
    """
    issuer, client_id, _ = config()
    metadata = discovery()
    state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    flow = {"state": state, "nonce": nonce, "verifier": verifier, "purpose": purpose, "issuer": issuer,
            "redirect_uri": redirect_uri, "started": time.time()}
    if purpose == LINK:
        flow["user_id"] = str(request.session.get(SESSION_KEY, ""))
        flow["user_hash"] = request.session.get(HASH_SESSION_KEY, "")
    request.session[FLOW_KEY] = flow
    challenge = _b64encode(hashlib.sha256(verifier.encode()).digest())
    query = urlencode({"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri,
                       "scope": SCOPE, "state": state, "nonce": nonce, "code_challenge": challenge,
                       "code_challenge_method": "S256"})
    return f"{metadata['authorization_endpoint']}?{query}"


def take_flow(request, state):
    """The flow of this session for ``state``, removed from the session: one callback per flow."""
    flow = request.session.pop(FLOW_KEY, None)
    if not isinstance(flow, dict) or not isinstance(state, str) or not state:
        raise PocketIdError("failed", "no flow")
    if not hmac.compare_digest(str(flow.get("state", "")), state):
        raise PocketIdError("failed", "state")
    if time.time() - float(flow.get("started", 0)) > FLOW_TTL:
        raise PocketIdError("failed", "expired")
    if flow.get("issuer") != config()[0]:
        raise PocketIdError("failed", "issuer changed")
    return flow


def exchange(code, flow):
    """Code → verified ID token claims."""
    _, client_id, secret = config()
    if not isinstance(code, str) or not code or len(code) > 2048:
        raise PocketIdError("failed", "no code")
    try:
        response = requests.post(discovery()["token_endpoint"], timeout=HTTP_TIMEOUT, auth=(client_id, secret),
                                 headers={"Accept": "application/json"},
                                 data={"grant_type": "authorization_code", "code": code,
                                       "redirect_uri": flow["redirect_uri"], "code_verifier": flow["verifier"]})
    except requests.RequestException as exc:
        raise PocketIdError("unavailable", str(exc)) from None
    if response.status_code != 200:
        raise PocketIdError("failed", f"token endpoint HTTP {response.status_code}")
    try:
        token = response.json().get("id_token")
    except (ValueError, AttributeError):
        raise PocketIdError("failed", "token answer") from None
    if not isinstance(token, str):
        raise PocketIdError("failed", "no id_token")
    return verify_id_token(token, flow["nonce"])


def same_session_user(request, flow):
    """The link callback runs in the session of the user who started it, not merely in some signed-in session."""
    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated or not user.is_active:
        return False
    started_by, started_hash = flow.get("user_id", ""), flow.get("user_hash", "")
    if not started_by or not started_hash:
        return False
    return (str(user.pk) == started_by
            and str(request.session.get(SESSION_KEY, "")) == started_by
            and hmac.compare_digest(str(request.session.get(HASH_SESSION_KEY, "")), started_hash)
            and hmac.compare_digest(user.get_session_auth_hash(), started_hash))
