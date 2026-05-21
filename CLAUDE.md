# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-enhanced collaborative Markdown note-taking system. Monorepo with npm workspaces containing a React frontend and 5 backend microservices, orchestrated via Docker Compose with Nginx as the API gateway.

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, TipTap editor, Yjs (CRDT), y-websocket, IndexedDB (offline), PWA/Service Worker, Electron (desktop app)
- **Backend (Node.js, all ESM)**: Express, TypeScript, tsx for dev
- **user-service** (3001): MySQL, JWT, bcryptjs, Google OAuth, nodemailer
- **document-service** (3002): MongoDB, MinIO (object storage), multer
- **collab-service** (3004): WebSocket (ws), Yjs, MongoDB, Redis
- **sync-service** (3005): MongoDB, offline push/pull with conflict detection
- **ai-service** (3003): Python FastAPI, PyMuPDF, MinerU (optional), LlamaIndex + Chroma (RAG), SSE streaming
- **Infra**: MySQL 8.4, MongoDB 6, Redis 7, MinIO, Nginx
- **E2E**: Playwright (Chromium, Firefox, WebKit)

## Common Commands

```bash
# Full Docker stack (recommended for end-to-end testing)
cp .env.example .env && docker compose up -d --build

# Docker with MinerU PDF parser (GPU required)
npm run docker:up:mineru

# Local Node dev (start infra first, then all Node services + frontend)
docker compose up -d mysql mongodb redis minio
npm install
npm run dev                  # starts web + 4 Node services via scripts/dev.mjs (NOT ai-service)

# AI service (separate, requires Python/conda)
conda env create -f services/ai-service/environment.yml
conda activate note-taking-ai
python -m pip install -r services/ai-service/requirements.txt
python -m uvicorn app.main:app --app-dir services/ai-service --host 0.0.0.0 --port 3003 --reload

# Build & lint (all workspaces)
npm run build
npm run lint

# Single workspace
npm run build --workspace @notes/web
npm run lint --workspace @notes/user-service

# Tests
npm run test                 # all Node workspaces (Jest + Vitest)
npm run test --workspace @notes/web          # frontend (vitest)
npm run test --workspace @notes/user-service  # backend (jest)

# AI service tests
cd services/ai-service && python -m pytest

# AI service syntax check
python -m compileall services/ai-service/app

# E2E tests (requires Docker stack running)
cd e2e && npx playwright test
```

## Architecture

```
Browser → Nginx :80
  ├── /                  → web:5173 (Vite dev server)
  ├── /api/user/         → user-service:3001
  ├── /api/doc/          → document-service:3002
  ├── /api/ai/           → ai-service:3003
  ├── /api/sync/         → sync-service:3005
  └── /ws/               → collab-service:3004 (WebSocket upgrade)
```

Services communicate internally via HTTP. JWT secret is shared across all services. Inter-service auth uses `INTERNAL_SERVICE_SECRET` header.

**Frontend API base**: In Docker/Nginx mode, `VITE_API_BASE_URL=""` (same-origin `/api/...`). In local Vite mode, proxy config in `apps/web/vite.config.ts` handles routing.

### Dual Content Model

- `documents.content` stores HTML — used for offline access and non-collaborative editing.
- `document_updates.update` stores Yjs binary — used for real-time collaboration.
- Collab state is authoritative during active editing. On version restore, both are updated.

### Offline-First Frontend

IndexedDB (`offlineDb.ts`) is the primary client-side data store. Server notes are cached locally. Changes are queued in a `sync_queue` store and pushed when online. Conflict detection uses `baseUpdatedAt` timestamp comparison. Multi-tab coordination uses `BroadcastChannel` and `navigator.locks`.

### PDF Processing Pipeline

Two modes: synchronous (`POST /pdf/upload`) and async job queue (`POST /pdf/jobs` → poll `GET /pdf/jobs/:id`). Pipeline: upload to MinIO → forward to ai-service for parsing → extract images to MinIO → rewrite image URLs → create document + Chroma index. Failed jobs can be retried via `POST /pdf/jobs/:id/retry`.

### Version History

Manual snapshots via `POST /notes/:id/versions` (50 version retention). Auto-snapshots every 5 minutes during active collaboration (collab-service) and on last collaborator disconnect. Restore via `POST /notes/:id/versions/:versionId/restore` (auto-snapshots current state first).

## Key Directories

- `apps/web/src/pages/` — Main pages (LoginPage, EditorPage, AdminPage)
- `apps/web/src/contexts/` — AuthContext (JWT/session), NotesContext (offline sync queue)
- `apps/web/src/components/` — Editor (TipTap), ShareDialog, VersionHistory
- `apps/web/src/lib/` — api.ts (HTTP/SSE client), offlineDb.ts (IndexedDB)
- `apps/web/electron/` — Electron main process (CJS), preload scripts
- `services/ai-service/app/main.py` — All AI logic: PDF parsing, LlamaIndex+Chroma, LLM providers
- `services/user-service/src/db.ts` — MySQL schema + `ensureUserSchema()` migration
- `infra/nginx/default.conf` — Gateway routing rules
- `infra/database/` — MySQL init.sql and MongoDB init.js
- `e2e/` — Playwright E2E tests with route mocking

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

- `JWT_SECRET` — shared across services, must change in production
- `AI_PROVIDER` — `mock` (default) / `deepseek` / `openai` / `xiaomi`
- `PDF_PARSE_PROVIDER` — `mineru` (default) / `pymupdf`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth (optional)
- `SMTP_*` — Email verification (optional)
- `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` — Embedding model for Chroma (falls back to local deterministic embedding if empty)

## Conventions

- All Node services are ESM (`"type": "module"`). Use `tsx` for dev, `tsc` for build. Electron main process is CJS.
- Frontend uses Vitest; backend services use Jest + supertest; E2E uses Playwright.
- AI service uses pytest (`services/ai-service/tests/`).
- When adding MySQL columns, update both `infra/database/mysql/init.sql` AND `services/user-service/src/db.ts` (`ensureUserSchema()`).
- When adding MongoDB collections, update `infra/database/mongodb/init.js`.
- New API routes must be added to `infra/nginx/default.conf` for gateway exposure.
- Frontend HTTP calls go through `apps/web/src/lib/api.ts`.
- SSE streaming uses three event types: `meta`, `chunk`, `done`.
- AI providers are extended in `services/ai-service/app/main.py` — add to `provider_name()`, `ai_model_name()`, `ai_base_url()`, `call_model()`, `stream_model()`.
- Offline sync changes require updates to: `offlineDb.ts`, `NotesContext.tsx`, and `sync-service/src/index.ts`.

## Current Limitations

- AI defaults to `mock` provider (no real LLM calls without configuration).
- PyMuPDF fallback does basic text extraction only (limited layout/formula/table support).
- Offline sync covers note CRUD only, not full CRDT offline merge.
