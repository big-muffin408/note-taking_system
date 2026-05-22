#!/usr/bin/env bash
# ============================================================================
# start-all.sh — One-click startup for the AI collaborative note-taking system.
#
# Builds and starts the full Docker Compose stack, waits for the API gateway to
# become reachable, then prints access URLs.
#
# Usage:  scripts/start-all.sh [options]      (or: npm run start:all)
# ============================================================================

set -euo pipefail

# --- Resolve repo root (this script lives in scripts/) ---------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# --- Defaults --------------------------------------------------------------
COMPOSE_FILES=(-f docker-compose.yml)
STACK_LABEL="default"
BUILD=1
FOLLOW_LOGS=0
ACTION="up"

usage() {
  cat <<'EOF'
Usage: scripts/start-all.sh [options]

Options:
  --mineru      Include the MinerU PDF parser overlay (GPU required)
  --cuda        Include the CUDA overlay for the AI service (GPU required)
  --no-build    Skip image rebuild — faster when nothing changed
  --logs        Follow combined container logs after startup
  --down        Stop and remove the stack, then exit
  -h, --help    Show this help

With no options: builds and starts the full stack in the background.
EOF
}

# --- Parse arguments -------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mineru)   COMPOSE_FILES+=(-f docker-compose.mineru.yml); STACK_LABEL="mineru" ;;
    --cuda)     COMPOSE_FILES+=(-f docker-compose.cuda.yml);   STACK_LABEL="cuda" ;;
    --no-build) BUILD=0 ;;
    --logs)     FOLLOW_LOGS=1 ;;
    --down)     ACTION="down" ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "❌ Unknown option: $1" >&2; echo ""; usage; exit 1 ;;
  esac
  shift
done

dc() { docker compose "${COMPOSE_FILES[@]}" "$@"; }

# Read a value from .env, falling back to a default.
env_val() {
  local key="$1" default="${2:-}" val=""
  if [[ -f .env ]]; then
    val="$(grep -E "^${key}=" .env | tail -n1 | cut -d= -f2- || true)"
  fi
  echo "${val:-$default}"
}

# --- Pre-flight checks -----------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker is not installed or not on PATH" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "❌ 'docker compose' is unavailable — update Docker to a recent version" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker daemon is not running — start Docker Desktop and retry" >&2
  exit 1
fi

# --- Stop action -----------------------------------------------------------
if [[ "$ACTION" == "down" ]]; then
  echo "🛑 Stopping the stack..."
  dc down
  echo "✅ Stack stopped"
  exit 0
fi

# --- Ensure .env exists ----------------------------------------------------
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    echo "⚠️  .env not found — creating it from .env.example"
    cp .env.example .env
    echo "   Review .env and set secrets before using this in production."
  else
    echo "❌ Neither .env nor .env.example found" >&2
    exit 1
  fi
fi

NGINX_PORT="$(env_val NGINX_PORT 80)"
MINIO_CONSOLE_PORT="$(env_val MINIO_CONSOLE_PORT 9001)"

# --- Start the stack -------------------------------------------------------
echo "🚀 Starting the note-taking system stack (profile: ${STACK_LABEL})"
if [[ $BUILD -eq 1 ]]; then
  dc up -d --build
else
  dc up -d
fi

# --- Wait for the API gateway to become reachable --------------------------
echo ""
echo "⏳ Waiting for the API gateway on port ${NGINX_PORT} ..."
HEALTH_URL="http://localhost:${NGINX_PORT}/api/user/health"
ready=0
for i in $(seq 1 60); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    ready=1
    echo "✅ Gateway healthy after ~$((i * 3))s"
    break
  fi
  sleep 3
done

echo ""
dc ps

if [[ $ready -ne 1 ]]; then
  echo ""
  echo "⚠️  Gateway did not answer within ~180s."
  echo "   Services may still be initializing (databases, AI service build)."
  echo "   Inspect logs with:  docker compose logs -f"
  exit 1
fi

# --- Report access URLs ----------------------------------------------------
HOST_PORT_SUFFIX=""
[[ "$NGINX_PORT" != "80" ]] && HOST_PORT_SUFFIX=":${NGINX_PORT}"

echo ""
echo "============================================================"
echo "✅ All services are up."
echo ""
echo "  App / API gateway : http://localhost${HOST_PORT_SUFFIX}"
echo "  MinIO console     : http://localhost:${MINIO_CONSOLE_PORT}"
echo ""
echo "  Follow logs       : docker compose logs -f"
echo "  Stop the stack    : scripts/start-all.sh --down"
echo "============================================================"

# --- Optionally follow logs ------------------------------------------------
if [[ $FOLLOW_LOGS -eq 1 ]]; then
  echo ""
  echo "📜 Following logs (Ctrl-C to detach; containers keep running)..."
  dc logs -f
fi
