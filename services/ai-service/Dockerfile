# syntax=docker/dockerfile:1.7
FROM python:3.11-slim

WORKDIR /app
ARG APT_MIRROR=
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_DEFAULT_TIMEOUT=120
ENV UV_LINK_MODE=copy

RUN if [ -n "$APT_MIRROR" ]; then \
      find /etc/apt -type f -name "*.list" -o -name "*.sources" | xargs sed -i "s|http://deb.debian.org/debian|$APT_MIRROR|g"; \
    fi \
    && printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update \
    && apt-get install -y --no-install-recommends --fix-missing libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    --mount=type=cache,target=/root/.cache/uv \
    pip install --upgrade pip setuptools wheel uv \
    && uv pip install --system -r requirements.txt

COPY app ./app
EXPOSE 3003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3003"]
