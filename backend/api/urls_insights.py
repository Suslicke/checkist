from django.urls import re_path

from .views.insights import (
    ActionConfirmView, AskView, InsightView, ReviewView, ThreadMessagesView, ThreadView, ThreadsView,
)
from .views.recognition import LocalNotFoundView

urlpatterns = [
    re_path(r"^insights/review/$", ReviewView.as_view(), name="insights-review"),
    re_path(r"^insights/ask/$", AskView.as_view(), name="insights-ask"),
    re_path(r"^insights/threads/$", ThreadsView.as_view(), name="insights-threads"),
    re_path(r"^insights/threads/(?P<pk>[1-9][0-9]{0,18})/$", ThreadView.as_view(), name="insights-thread"),
    re_path(r"^insights/threads/(?P<pk>[1-9][0-9]{0,18})/messages/$", ThreadMessagesView.as_view(),
            name="insights-thread-messages"),
    re_path(r"^insights/(?P<pk>[1-9][0-9]{0,18})/$", InsightView.as_view(), name="insights-detail"),
    re_path(r"^insights/(?P<pk>[1-9][0-9]{0,18})/actions/(?P<index>[0-9]{1,3})/confirm/$", ActionConfirmView.as_view(),
            name="insights-action-confirm"),
    re_path(r"^insights/(?:.*/)?$", LocalNotFoundView.as_view(), name="insights-not-found"),
]
