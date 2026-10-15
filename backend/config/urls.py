from django.contrib import admin
from django.urls import include, path, re_path

from accounts import mcp, media

admin.site.site_header = "Checkist — администрирование"
admin.site.site_title = "Checkist"
admin.site.index_title = "Данные чеков"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", include("health.urls")),
    path("api/", include("api.urls")),
    # No DEBUG condition: the view itself decides by the auth mode and the owner of the photo.
    re_path(r"^media/(?P<path>.+)$", media.serve),
    # MCP for any AI client by a personal token (accounts.mcp): the header, or the token in the address.
    re_path(r"^mcp/?$", mcp.endpoint),
    re_path(r"^mcp/(?P<path_token>ck_[A-Za-z0-9_-]{20,90})/?$", mcp.endpoint),
]
