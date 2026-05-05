#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WITH_MINERU=1
BUILD=1

usage() {
  cat <<'EOF'
Usage: scripts/start-all.sh [options]

Options:
  --no-mineru   Start the base stack only.
  --no-build    Reuse existing images instead of rebuilding.
  -h, --help    Show this help.

Environment:
  MINERU_APT_MIRROR  Ubuntu apt mirror for mineru-api builds.
                     Defaults to http://mirrors.aliyun.com/ubuntu.
                     Set to empty string to use the base image's original sources.
EOF
}

while (($# > 0)); do
  case "$1" in
    --no-mineru)
      WITH_MINERU=0
      ;;
    --no-build)
      BUILD=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is not available. Please start Docker Desktop or install Docker Compose." >&2
  exit 1
fi

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

compose_base=(docker compose -f docker-compose.yml)
compose_mineru=(docker compose -f docker-compose.yml -f docker-compose.mineru.yml)

retry() {
  local label="$1"
  shift

  for attempt in $(seq 1 30); do
    if "$@" >/dev/null 2>&1; then
      echo "OK: $label"
      return 0
    fi

    if [[ "$attempt" == "30" ]]; then
      echo "FAILED: $label" >&2
      "$@"
      return 1
    fi

    sleep 2
  done
}

up_args=(up -d)
if [[ "$BUILD" == "1" ]]; then
  up_args+=(--build)
else
  up_args+=(--no-build)
fi

echo "Starting base services..."
"${compose_base[@]}" "${up_args[@]}"
"${compose_base[@]}" restart nginx >/dev/null

if [[ "$WITH_MINERU" == "1" ]]; then
  mineru_mirror="${MINERU_APT_MIRROR-http://mirrors.aliyun.com/ubuntu}"

  echo "Starting mineru-api..."
  if [[ "$BUILD" == "1" ]]; then
    APT_MIRROR="$mineru_mirror" "${compose_mineru[@]}" up -d --build --no-deps mineru-api
  else
    "${compose_mineru[@]}" up -d --no-build --no-deps mineru-api
  fi

  echo "Restarting ai-service with MinerU wiring..."
  "${compose_mineru[@]}" up -d --no-build ai-service
  "${compose_mineru[@]}" restart nginx >/dev/null
fi

echo "Current service status:"
if [[ "$WITH_MINERU" == "1" ]]; then
  "${compose_mineru[@]}" ps
else
  "${compose_base[@]}" ps
fi

echo "Running health checks..."
retry "user-service via nginx" "${compose_base[@]}" exec -T nginx wget -qO- --header 'Host: localhost' http://127.0.0.1/api/user/health
retry "document-service via nginx" "${compose_base[@]}" exec -T nginx wget -qO- --header 'Host: localhost' http://127.0.0.1/api/doc/health
retry "ai-service via nginx" "${compose_base[@]}" exec -T nginx wget -qO- --header 'Host: localhost' http://127.0.0.1/api/ai/health
retry "sync-service via nginx" "${compose_base[@]}" exec -T nginx wget -qO- --header 'Host: localhost' http://127.0.0.1/api/sync/health
retry "collab-service health" "${compose_base[@]}" exec -T collab-service wget -qO- http://127.0.0.1:3004/health

if [[ "$WITH_MINERU" == "1" ]]; then
  retry "mineru-api openapi" "${compose_mineru[@]}" exec -T mineru-api python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/openapi.json', timeout=10).read()"
  retry "ai-service to mineru-api" "${compose_mineru[@]}" exec -T ai-service python -c "import os, urllib.request; url=os.environ['MINERU_API_URL']; urllib.request.urlopen(url + '/openapi.json', timeout=10).read()"
fi

nginx_port="${NGINX_PORT:-}"
if [[ -z "$nginx_port" && -f .env ]]; then
  nginx_port="$(sed -n 's/^NGINX_PORT=//p' .env | tail -n 1)"
fi
if [[ -z "$nginx_port" || "$nginx_port" == "80" ]]; then
  frontend_url="http://localhost"
else
  frontend_url="http://localhost:$nginx_port"
fi

echo "All services are ready."
echo "Frontend: $frontend_url"
if [[ "$WITH_MINERU" == "1" ]]; then
  echo "MinerU API docs: http://localhost:${MINERU_API_PORT:-8000}/docs"
fi
