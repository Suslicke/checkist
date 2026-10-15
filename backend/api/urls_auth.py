from django.urls import re_path

from .views.api_tokens import ApiTokensView, ApiTokenView
from .views.auth import CsrfView, LoginView, LogoutView, MeView, PasswordView, SettingsView

urlpatterns = [
    re_path(r"^auth/csrf/$", CsrfView.as_view(), name="auth-csrf"),
    re_path(r"^auth/login/$", LoginView.as_view(), name="auth-login"),
    re_path(r"^auth/logout/$", LogoutView.as_view(), name="auth-logout"),
    re_path(r"^auth/password/$", PasswordView.as_view(), name="auth-password"),
    re_path(r"^auth/tokens/$", ApiTokensView.as_view(), name="auth-tokens"),
    re_path(r"^auth/tokens/(?P<pk>[^/]+)/$", ApiTokenView.as_view(), name="auth-token"),
    re_path(r"^me/$", MeView.as_view(), name="me"),
    re_path(r"^me/settings/$", SettingsView.as_view(), name="me-settings"),
]
