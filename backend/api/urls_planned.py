from django.urls import re_path

from .views.planned import AdviceView, DepositView, PlansView, PlanView
from .views.recognition import LocalNotFoundView

ID = r"(?P<pk>[1-9][0-9]{0,18})"

urlpatterns = [
    re_path(r"^planned/$", PlansView.as_view(), name="planned"),
    re_path(rf"^planned/{ID}/$", PlanView.as_view(), name="planned-plan"),
    re_path(rf"^planned/{ID}/advice/$", AdviceView.as_view(), name="planned-advice"),
    re_path(rf"^planned/{ID}/deposit/$", DepositView.as_view(), name="planned-deposit"),
    re_path(r"^planned/(?:.*/)?$", LocalNotFoundView.as_view(), name="planned-not-found"),
]
