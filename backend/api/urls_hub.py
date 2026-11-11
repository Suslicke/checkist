from django.urls import re_path

from .views.hub import HubImportView

urlpatterns = [
    re_path(r"^hub/import/$", HubImportView.as_view(), name="hub-import"),
]
