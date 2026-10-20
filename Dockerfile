# Server images of Checkist, built by compose.prod.yaml (deploy/docker/deploy.sh).
# The dev/QA image is backend/Dockerfile; this file does not replace it.
#
# Targets: `app` (web and celery), `recognition` (app + Codex CLI + Claude Code CLI), `proxy` (Caddy + the built SPA
# + admin static). `frontend-build` and `static` are build stages only: Node never reaches a server.

# Codex CLI release and the SHA-256 of its archives; change the five values together.
# codex-code-mode-host ships as a separate archive of the same release: without it Codex
# prints an `error` item before the turn, and the worker rejects every answer as invalid_output.
ARG CODEX_VERSION=0.162.0
ARG CODEX_SHA256_AMD64=8daf67f6261161aa5939d8d42a516032d760406216779d7ce6040f242140ff73
ARG CODEX_SHA256_ARM64=15162a9b59edf8e512b27414ec0b7db22e6424a1262b0eee8666643e0d295c2f
ARG CODEX_HOST_SHA256_AMD64=dee8bf3df637c68e1495b928d643b76d4ad44f94e4f0ed79fe8482fa79e23d97
ARG CODEX_HOST_SHA256_ARM64=18d99b055d2ef4a2af51f1144919bd8a208f4f79ace389b7775341d6903cf7e9

# Claude Code CLI release and the SHA-256 of its native Linux (glibc) binaries; change the three values
# together. The address and the sums are those the official https://claude.ai/install.sh reads:
# https://downloads.claude.ai/claude-code-releases/<version>/manifest.json, `platforms.linux-x64.checksum`
# and `platforms.linux-arm64.checksum` (the base image is Debian, so not the musl builds).
ARG CLAUDE_CODE_VERSION=2.1.304
ARG CLAUDE_CODE_SHA256_AMD64=ea0f135784631619a7a409d07322ecec964f9cc4fd377508ed1ba3f141f27912
ARG CLAUDE_CODE_SHA256_ARM64=c487117526509ab6d2ee6013e14f181faf68d6d6afe6bb0d4b2b4a9feca5ecb3


FROM node:24.21.0-trixie-slim AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# `tsc -b` checks the whole of src/, and its preview pages import the reference answers of the server.
COPY backend/api/tests/fixtures/stats/ /src/backend/api/tests/fixtures/stats/
# vite.config.ts reads ../.env; the build context has none, so the API base is the default /api.
RUN npm run build


FROM python:3.13.16-slim-trixie AS app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# pg_dump / pg_restore / createdb / psql of the server major version for `manage.py backup`.
# The data directories exist in the image with their owner, so a new named volume inherits it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 checkist \
    && useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash checkist \
    && install -d -o checkist -g checkist -m 0750 /var/lib/checkist /var/lib/checkist/media \
    && install -d -o checkist -g checkist -m 0700 /var/lib/checkist-scratch /home/checkist/.codex
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && python -m pip check
COPY backend/ /app/backend/
COPY deploy/gunicorn.conf.py /app/deploy/gunicorn.conf.py
USER checkist
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "-c", "/app/deploy/gunicorn.conf.py", "--bind", "0.0.0.0:8000"]


# Admin styles and scripts. A build stage: DEBUG=1 only spares a secret key, the output is the same.
FROM app AS static
RUN DJANGO_DEBUG=1 DJANGO_STATIC_ROOT=/var/lib/checkist/static python manage.py collectstatic --noinput


FROM scratch AS codex-amd64
ARG CODEX_VERSION
ARG CODEX_SHA256_AMD64
ARG CODEX_HOST_SHA256_AMD64
ADD --checksum=sha256:${CODEX_SHA256_AMD64} \
    https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-x86_64-unknown-linux-musl.tar.gz \
    /codex.tar.gz
ADD --checksum=sha256:${CODEX_HOST_SHA256_AMD64} \
    https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz \
    /codex-code-mode-host.tar.gz

FROM scratch AS codex-arm64
ARG CODEX_VERSION
ARG CODEX_SHA256_ARM64
ARG CODEX_HOST_SHA256_ARM64
ADD --checksum=sha256:${CODEX_SHA256_ARM64} \
    https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-aarch64-unknown-linux-musl.tar.gz \
    /codex.tar.gz
ADD --checksum=sha256:${CODEX_HOST_SHA256_ARM64} \
    https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-code-mode-host-aarch64-unknown-linux-musl.tar.gz \
    /codex-code-mode-host.tar.gz

FROM codex-${TARGETARCH} AS codex-archive


FROM scratch AS claude-amd64
ARG CLAUDE_CODE_VERSION
ARG CLAUDE_CODE_SHA256_AMD64
ADD --checksum=sha256:${CLAUDE_CODE_SHA256_AMD64} \
    https://downloads.claude.ai/claude-code-releases/${CLAUDE_CODE_VERSION}/linux-x64/claude \
    /claude

FROM scratch AS claude-arm64
ARG CLAUDE_CODE_VERSION
ARG CLAUDE_CODE_SHA256_ARM64
ADD --checksum=sha256:${CLAUDE_CODE_SHA256_ARM64} \
    https://downloads.claude.ai/claude-code-releases/${CLAUDE_CODE_VERSION}/linux-arm64/claude \
    /claude

FROM claude-${TARGETARCH} AS claude-binary


# The recognition worker next to Codex CLI and Claude Code CLI. The Codex sign-in lives in the
# `codex_home` volume (/home/checkist/.codex), the settings of Claude in `claude_home`
# (/home/checkist/.claude, CLAUDE_CONFIG_DIR); only this service mounts them. Which CLI runs is
# RECEIPT_OCR_PROVIDER of the environment file; the Claude sign-in is CLAUDE_CODE_OAUTH_TOKEN there.
FROM app AS recognition
USER root
# bubblewrap: the Linux sandbox of Codex (`-s read-only`) looks for a system bwrap.
RUN --mount=type=bind,from=codex-archive,source=/codex.tar.gz,target=/tmp/codex.tar.gz \
    --mount=type=bind,from=codex-archive,source=/codex-code-mode-host.tar.gz,target=/tmp/codex-code-mode-host.tar.gz \
    --mount=type=bind,from=claude-binary,source=/claude,target=/tmp/claude \
    apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /tmp/codex \
    && tar -xzf /tmp/codex.tar.gz -C /tmp/codex \
    && tar -xzf /tmp/codex-code-mode-host.tar.gz -C /tmp/codex \
    && install -m 0755 /tmp/codex/codex-code-mode-host-*-unknown-linux-musl /usr/local/bin/codex-code-mode-host \
    && rm /tmp/codex/codex-code-mode-host-*-unknown-linux-musl \
    && install -m 0755 /tmp/codex/codex-*-unknown-linux-musl /usr/local/bin/codex \
    && rm -rf /tmp/codex \
    && install -m 0755 /tmp/claude /usr/local/bin/claude \
    && install -d -o checkist -g checkist -m 0700 /home/checkist/.claude
USER checkist
CMD ["python", "manage.py", "recognition_worker"]


# Caddy with the files it serves itself. MEDIA is not here: uploaded files go through Django only.
FROM caddy:2.11.7-alpine AS proxy
COPY deploy/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-build /src/frontend/dist /opt/checkist/frontend/dist
COPY --from=static /var/lib/checkist/static /var/lib/checkist/static
