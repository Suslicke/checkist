from django.urls import re_path

from .views.recognition import LocalNotFoundView
from .views.store_merges import StoreCategoryView, StoreDismissView, StoreMergesView, StoreMergeView

urlpatterns = [
    re_path(r"^store-merges/$", StoreMergesView.as_view(), name="store-merges"),
    re_path(r"^store-merges/merge/$", StoreMergeView.as_view(), name="store-merges-merge"),
    re_path(r"^store-merges/dismiss/$", StoreDismissView.as_view(), name="store-merges-dismiss"),
    re_path(r"^store-merges/category/$", StoreCategoryView.as_view(), name="store-merges-category"),
    re_path(r"^store-merges/(?:.*/)?$", LocalNotFoundView.as_view(), name="store-merges-not-found"),
]
