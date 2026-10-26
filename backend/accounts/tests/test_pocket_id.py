"""Sign-in with Pocket ID (accounts.pocket_id, api.views.pocket_id): binding by ``sub`` only, PKCE, ID token checks."""
import base64
import hashlib
import json
import time
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.contrib.auth import SESSION_KEY
from django.test import SimpleTestCase, TestCase, override_settings, tag
from rest_framework.test import APIClient

from accounts import mcp, pocket_id
from accounts.models import PocketIdIdentity
from api.tests.accounts_helpers import make_user, signed_in

ISSUER = "https://id.example.test"
CLIENT_ID = "checkist-client"
SECRET = "checkist-secret"
CALLBACK = "/api/auth/pocket-id/callback/"
ON = {"CHECKIST_AUTH_MODE": "accounts", "POCKET_ID_ISSUER": ISSUER, "POCKET_ID_CLIENT_ID": CLIENT_ID,
      "POCKET_ID_CLIENT_SECRET": SECRET}


def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def jwk_of(key, kid):
    numbers = key.public_key().public_numbers()
    return {"kty": "RSA", "kid": kid, "use": "sig", "alg": "RS256",
            "n": b64(numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, "big")),
            "e": b64(numbers.e.to_bytes(3, "big"))}


def sign(claims, key, header=None):
    head = b64(json.dumps(header or {"alg": "RS256", "kid": "k1", "typ": "JWT"}).encode())
    body = b64(json.dumps(claims).encode())
    signature = key.sign(f"{head}.{body}".encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{head}.{body}.{b64(signature)}"


class Answer:
    def __init__(self, data, status=200):
        self.status_code, self._data = status, data

    def json(self):
        return self._data


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakePocketId:
    """Discovery, JWKS and a token endpoint that checks PKCE and the client secret, then returns ``id_token``."""

    def __init__(self):
        self.sub = "sub-owner"
        self.claims = {}
        self.key = KEY
        self.header = None
        self.nonce = None
        self.challenge = None
        self.token_calls = []

    def get(self, url, **kwargs):
        if url == f"{ISSUER}/.well-known/openid-configuration":
            return Answer({"issuer": ISSUER, "authorization_endpoint": f"{ISSUER}/authorize",
                           "token_endpoint": f"{ISSUER}/api/oidc/token", "jwks_uri": f"{ISSUER}/.well-known/jwks.json"})
        if url == f"{ISSUER}/.well-known/jwks.json":
            return Answer({"keys": [jwk_of(KEY, "k1")]})
        return Answer({}, 404)

    def post(self, url, data=None, auth=None, **kwargs):
        self.token_calls.append(data)
        verifier = data.get("code_verifier", "")
        if (auth != (CLIENT_ID, SECRET) or data.get("grant_type") != "authorization_code"
                or b64(hashlib.sha256(verifier.encode()).digest()) != self.challenge):
            return Answer({"error": "invalid_grant"}, 400)
        now = int(time.time())
        claims = {"iss": ISSUER, "aud": CLIENT_ID, "sub": self.sub, "nonce": self.nonce, "iat": now, "exp": now + 300,
                  "email": "owner@example.test", **self.claims}
        return Answer({"id_token": sign(claims, self.key, self.header), "access_token": "x", "token_type": "Bearer"})


class PocketIdCase(TestCase):
    def setUp(self):
        pocket_id.reset_cache()
        self.fake = FakePocketId()
        patcher_get = mock.patch("accounts.pocket_id.requests.get", side_effect=self.fake.get)
        patcher_post = mock.patch("accounts.pocket_id.requests.post", side_effect=self.fake.post)
        patcher_get.start()
        patcher_post.start()
        self.addCleanup(patcher_get.stop)
        self.addCleanup(patcher_post.stop)
        self.addCleanup(pocket_id.reset_cache)
        self.owner = make_user("owner", email="owner@example.test")
        self.other = make_user("other", email="other@example.test")

    def remember(self, authorize_url):
        query = parse_qs(urlsplit(authorize_url).query)
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["response_type"], ["code"])
        self.assertEqual(query["client_id"], [CLIENT_ID])
        self.assertEqual(query["redirect_uri"], [f"http://testserver{CALLBACK}"])
        self.fake.nonce, self.fake.challenge = query["nonce"][0], query["code_challenge"][0]
        return query["state"][0]

    def start_login(self, client):
        response = client.get("/api/auth/pocket-id/login/")
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response["Location"].startswith(f"{ISSUER}/authorize?"))
        return self.remember(response["Location"])

    def start_link(self, client):
        response = client.post("/api/auth/pocket-id/link/", "{}", content_type="application/json")
        self.assertEqual(response.status_code, 200, response.content)
        return self.remember(response.json()["authorize_url"])

    def back(self, client, state, code="the-code"):
        return client.get(CALLBACK, {"code": code, "state": state})

    def signed_in_as(self, client):
        response = client.get("/api/me/")
        return response.json()["user"]["username"] if response.status_code == 200 else None

    def bind(self, user, sub="sub-owner"):
        return PocketIdIdentity.objects.create(user=user, issuer=ISSUER, subject=sub)


@tag("integration")
@override_settings(**ON)
class SignInTests(PocketIdCase):
    def test_bound_sub_signs_in_exactly_that_user(self):
        self.bind(self.other, "sub-other")
        self.bind(self.owner, "sub-owner")
        client = APIClient()
        response = self.back(client, self.start_login(client))
        self.assertEqual((response.status_code, response["Location"]), (302, "/"))
        self.assertEqual(self.signed_in_as(client), "owner")
        self.assertIsNotNone(PocketIdIdentity.objects.get(user=self.owner).last_login_at)

    def test_unbound_sub_is_refused_even_with_a_matching_email(self):
        # The ID token carries owner@example.test — the email of an existing user — and must not matter.
        client = APIClient()
        response = self.back(client, self.start_login(client))
        self.assertEqual(response["Location"], "/login?pocket_id=not_linked")
        self.assertIsNone(self.signed_in_as(client))
        self.assertFalse(PocketIdIdentity.objects.exists())

    def test_never_creates_users(self):
        from django.contrib.auth import get_user_model

        before = get_user_model().objects.count()
        self.fake.sub = "brand-new"
        client = APIClient()
        self.back(client, self.start_login(client))
        self.assertEqual(get_user_model().objects.count(), before)

    def test_inactive_user_is_refused(self):
        self.bind(self.owner)
        self.owner.is_active = False
        self.owner.save()
        client = APIClient()
        self.assertEqual(self.back(client, self.start_login(client))["Location"], "/login?pocket_id=not_linked")

    def test_state_is_single_use_and_must_match(self):
        self.bind(self.owner)
        client = APIClient()
        state = self.start_login(client)
        self.assertEqual(self.back(client, state + "x")["Location"], "/login?pocket_id=failed")
        # The wrong state consumed the flow: even the right one is refused now.
        self.assertEqual(self.back(client, state)["Location"], "/login?pocket_id=failed")
        self.assertIsNone(self.signed_in_as(client))
        self.assertEqual(self.fake.token_calls, [])

    def test_callback_without_a_flow_in_this_session_is_refused(self):
        self.bind(self.owner)
        attacker = APIClient()
        state = self.start_login(attacker)
        victim = APIClient()
        self.assertEqual(self.back(victim, state)["Location"], "/login?pocket_id=failed")
        self.assertIsNone(self.signed_in_as(victim))

    def test_expired_flow_is_refused(self):
        self.bind(self.owner)
        client = APIClient()
        state = self.start_login(client)
        with mock.patch("accounts.pocket_id.time.time", return_value=time.time() + pocket_id.FLOW_TTL + 5):
            self.assertEqual(self.back(client, state)["Location"], "/login?pocket_id=failed")

    def test_provider_error_is_refused(self):
        client = APIClient()
        state = self.start_login(client)
        response = client.get(CALLBACK, {"error": "access_denied", "state": state})
        self.assertEqual(response["Location"], "/login?pocket_id=denied")

    def assert_token_refused(self):
        self.bind(self.owner)
        client = APIClient()
        response = self.back(client, self.start_login(client))
        self.assertEqual(response["Location"], "/login?pocket_id=invalid_token")
        self.assertIsNone(self.signed_in_as(client))

    def test_bad_nonce(self):
        self.fake.claims = {"nonce": "another"}
        self.assert_token_refused()

    def test_bad_signature(self):
        self.fake.key = OTHER_KEY
        self.assert_token_refused()

    def test_alg_none_and_hs256_are_refused(self):
        self.fake.header = {"alg": "HS256", "kid": "k1"}
        self.assert_token_refused()

    def test_unknown_kid(self):
        self.fake.header = {"alg": "RS256", "kid": "k-missing"}
        self.assert_token_refused()

    def test_bad_issuer(self):
        self.fake.claims = {"iss": "https://evil.example.test"}
        self.assert_token_refused()

    def test_bad_audience(self):
        self.fake.claims = {"aud": "another-client"}
        self.assert_token_refused()

    def test_audience_list_needs_azp(self):
        self.fake.claims = {"aud": [CLIENT_ID, "another-client"]}
        self.assert_token_refused()

    def test_expired_token(self):
        self.fake.claims = {"exp": int(time.time()) - 3600}
        self.assert_token_refused()

    def test_missing_exp(self):
        self.fake.claims = {"exp": None}
        self.assert_token_refused()

    def test_token_endpoint_refusal(self):
        self.bind(self.owner)
        client = APIClient()
        state = self.start_login(client)
        self.fake.challenge = "not-the-challenge"  # PKCE verifier no longer matches
        self.assertEqual(self.back(client, state)["Location"], "/login?pocket_id=failed")

    def test_signed_in_person_is_sent_home(self):
        client = signed_in(self.owner)
        response = client.get("/api/auth/pocket-id/login/")
        self.assertEqual((response.status_code, response["Location"]), (302, "/"))

    def test_status_for_a_guest(self):
        self.assertEqual(APIClient().get("/api/auth/pocket-id/").json(),
                         {"enabled": True, "linked": None, "linked_at": None})


@tag("integration")
@override_settings(**ON)
class LinkTests(PocketIdCase):
    def test_link_needs_a_session(self):
        client = APIClient(enforce_csrf_checks=True)
        response = client.post("/api/auth/pocket-id/link/", "{}", content_type="application/json")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(client.delete("/api/auth/pocket-id/link/").status_code, 401)

    def test_link_needs_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)
        response = client.post("/api/auth/pocket-id/link/", "{}", content_type="application/json")
        self.assertEqual(response.status_code, 403)

    def test_link_then_sign_in(self):
        client = signed_in(self.owner, csrf=True)
        response = self.back(client, self.start_link(client))
        self.assertEqual(response["Location"], "/account?pocket_id=linked")
        row = PocketIdIdentity.objects.get()
        self.assertEqual((row.user, row.issuer, row.subject), (self.owner, ISSUER, "sub-owner"))
        self.assertEqual(client.get("/api/auth/pocket-id/").json()["linked"], True)
        guest = APIClient()
        self.back(guest, self.start_login(guest))
        self.assertEqual(self.signed_in_as(guest), "owner")

    def test_login_flow_callback_never_links(self):
        # A login flow that comes back into a signed-in session does not bind the unknown sub to it.
        client = APIClient()
        state = self.start_login(client)
        client.force_login(self.owner)
        self.assertEqual(self.back(client, state)["Location"], "/login?pocket_id=not_linked")
        self.assertFalse(PocketIdIdentity.objects.exists())

    def test_session_swap_mid_flow_is_refused(self):
        client = signed_in(self.owner, csrf=True)
        state = self.start_link(client)
        # The same browser session now belongs to another user, with the flow still in it.
        session = client.session
        session[SESSION_KEY] = str(self.other.pk)
        session.save()
        response = self.back(client, state)
        self.assertEqual(response["Location"], "/account?pocket_id=session_changed")
        self.assertFalse(PocketIdIdentity.objects.exists())

    def test_signed_out_mid_flow_is_refused(self):
        client = signed_in(self.owner, csrf=True)
        state = self.start_link(client)
        session = client.session
        flow = session[pocket_id.FLOW_KEY]
        client.logout()
        session = client.session
        session[pocket_id.FLOW_KEY] = flow
        session.save()
        self.assertEqual(self.back(client, state)["Location"], "/account?pocket_id=session_changed")
        self.assertFalse(PocketIdIdentity.objects.exists())

    def test_password_change_mid_flow_is_refused(self):
        client = signed_in(self.owner, csrf=True)
        state = self.start_link(client)
        self.owner.set_password("a-new-long-password-1")
        self.owner.save()
        self.assertEqual(self.back(client, state)["Location"], "/account?pocket_id=session_changed")
        self.assertFalse(PocketIdIdentity.objects.exists())

    def test_sub_of_another_user_is_never_moved(self):
        self.bind(self.other, "sub-owner")
        client = signed_in(self.owner, csrf=True)
        response = self.back(client, self.start_link(client))
        self.assertEqual(response["Location"], "/account?pocket_id=already_linked")
        self.assertEqual(PocketIdIdentity.objects.get().user, self.other)

    def test_existing_binding_is_never_replaced(self):
        self.bind(self.owner, "sub-old")
        client = signed_in(self.owner, csrf=True)
        response = client.post("/api/auth/pocket-id/link/", "{}", content_type="application/json")
        self.assertEqual((response.status_code, response.json()["error"]["code"]), (409, "pocket_id_already_linked"))
        self.assertEqual(PocketIdIdentity.objects.get().subject, "sub-old")

    def test_binding_added_during_the_flow_is_not_replaced(self):
        client = signed_in(self.owner, csrf=True)
        state = self.start_link(client)
        self.bind(self.owner, "sub-old")
        self.assertEqual(self.back(client, state)["Location"], "/account?pocket_id=already_linked")
        self.assertEqual(PocketIdIdentity.objects.get().subject, "sub-old")

    def test_bad_token_on_link_binds_nothing(self):
        self.fake.claims = {"aud": "another-client"}
        client = signed_in(self.owner, csrf=True)
        self.assertEqual(self.back(client, self.start_link(client))["Location"], "/account?pocket_id=invalid_token")
        self.assertFalse(PocketIdIdentity.objects.exists())

    def test_unlink(self):
        self.bind(self.owner)
        self.bind(self.other, "sub-other")
        client = signed_in(self.owner, csrf=True)
        self.assertEqual(client.delete("/api/auth/pocket-id/link/").status_code, 204)
        self.assertEqual(list(PocketIdIdentity.objects.values_list("subject", flat=True)), ["sub-other"])
        guest = APIClient()
        self.assertEqual(self.back(guest, self.start_login(guest))["Location"], "/login?pocket_id=not_linked")

    def test_mcp_tokens_unchanged(self):
        self.bind(self.owner)
        _, token = mcp.issue(self.owner, "ИИ", "read")
        self.assertEqual(mcp.authenticate(token).user, self.owner)
        response = APIClient().post("/mcp", json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
                                    content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(response.status_code, 200)


@tag("integration")
class DisabledTests(TestCase):
    ROUTES = ("/api/auth/pocket-id/", "/api/auth/pocket-id/login/", "/api/auth/pocket-id/callback/?state=x&code=y")

    def assert_hidden(self):
        owner = make_user("owner")
        for path in self.ROUTES:
            self.assertEqual(APIClient().get(path).status_code, 404, path)
        client = signed_in(owner, csrf=True)
        response = client.post("/api/auth/pocket-id/link/", "{}", content_type="application/json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(client.delete("/api/auth/pocket-id/link/").status_code, 404)

    @override_settings(CHECKIST_AUTH_MODE="accounts", POCKET_ID_ISSUER=ISSUER, POCKET_ID_CLIENT_ID="",
                       POCKET_ID_CLIENT_SECRET="")
    def test_without_client_id_and_secret(self):
        self.assert_hidden()

    @override_settings(CHECKIST_AUTH_MODE="accounts", POCKET_ID_ISSUER=ISSUER, POCKET_ID_CLIENT_ID=CLIENT_ID,
                       POCKET_ID_CLIENT_SECRET="")
    def test_without_secret(self):
        self.assert_hidden()

    @override_settings(CHECKIST_AUTH_MODE="local_single", DEBUG=True, **{k: v for k, v in ON.items()
                                                                         if k != "CHECKIST_AUTH_MODE"})
    def test_local_single(self):
        for path in self.ROUTES:
            self.assertEqual(APIClient().get(path).status_code, 404, path)

    @override_settings(CHECKIST_AUTH_MODE="accounts", POCKET_ID_ISSUER="", POCKET_ID_CLIENT_ID="",
                       POCKET_ID_CLIENT_SECRET="")
    def test_password_login_still_works(self):
        owner = make_user("owner")
        owner.set_password("a-long-password-1")
        owner.save()
        client = APIClient()
        response = client.post("/api/auth/login/", {"username": "owner", "password": "a-long-password-1"},
                               format="json")
        self.assertEqual(response.status_code, 200, response.content)


@override_settings(**ON)
class TokenVerificationTests(SimpleTestCase):
    """``verify_id_token`` alone, without a database."""

    def setUp(self):
        pocket_id.reset_cache()
        fake = FakePocketId()
        patcher = mock.patch("accounts.pocket_id.requests.get", side_effect=fake.get)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(pocket_id.reset_cache)
        self.now = int(time.time())

    def token(self, **claims):
        return sign({"iss": ISSUER, "aud": CLIENT_ID, "sub": "s", "nonce": "n", "iat": self.now, "exp": self.now + 60,
                     **claims}, KEY)

    def test_valid(self):
        self.assertEqual(pocket_id.verify_id_token(self.token(), "n")["sub"], "s")

    def test_refusals(self):
        cases = {
            "nonce": (self.token(), "other"),
            "iss": (self.token(iss=ISSUER + "/"), "n"),
            "aud": (self.token(aud="x"), "n"),
            "azp": (self.token(azp="x"), "n"),
            "exp": (self.token(exp=self.now - 3600), "n"),
            "iat": (self.token(iat=self.now + 3600), "n"),
            "sub": (self.token(sub=""), "n"),
            "malformed": ("a.b", "n"),
            "tampered": (self.token()[:-6] + "AAAAAA", "n"),
            "alg none": (b64(b'{"alg":"none","kid":"k1"}') + "." + self.token().split(".")[1] + ".", "n"),
        }
        for name, (token, nonce) in cases.items():
            with self.subTest(name), self.assertRaises(pocket_id.PocketIdError) as caught:
                pocket_id.verify_id_token(token, nonce)
            self.assertEqual(caught.exception.code, "invalid_token")

    def test_discovery_issuer_must_match(self):
        with mock.patch("accounts.pocket_id.requests.get",
                        return_value=Answer({"issuer": "https://evil.example.test", "authorization_endpoint": "https://a",
                                             "token_endpoint": "https://t", "jwks_uri": "https://j"})):
            with self.assertRaises(pocket_id.PocketIdError):
                pocket_id.discovery()
