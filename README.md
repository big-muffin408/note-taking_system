# 基于 AI 增强的协作式文档笔记系统

这是按 `docs/开发任务书.md` 与 `docs/开发计划书.md` 搭建的可运行 monorepo 骨架。当前阶段对应开发计划书第 3-4 周“基础环境与微服务搭建”，目标是完成基础微服务联通，不包含真实鉴权、PDF 解析、RAG 检索或协同合并逻辑。

## 目录结构

```text
apps/web                    React + Vite + TypeScript 前端
services/user-service       用户服务
services/document-service   文档服务
services/collab-service     协同 WebSocket 服务
services/sync-service       离线同步服务
services/ai-service         Python FastAPI AI 服务
infra/nginx                 Nginx 反向代理配置
infra/database              数据库初始化脚本占位
```

## 本地启动

### 快速启动

安装依赖：

```bash
npm install
```

启动前端和 Node 微服务：

```bash
npm run dev
```

`npm run dev` 会同时启动：

- 前端 Web：http://localhost:5173
- 用户服务：http://localhost:3001
- 文档服务：http://localhost:3002
- 协同 WebSocket 服务：http://localhost:3004
- 同步服务：http://localhost:3005

AI 服务使用 Python FastAPI，需要单独启动。如果首次运行，先创建环境并安装依赖：

```bash
conda env create -f services/ai-service/environment.yml
conda activate note-taking-ai
python -m pip install -r services/ai-service/requirements.txt
python -m uvicorn app.main:app --app-dir services/ai-service --host 0.0.0.0 --port 3003 --reload
```

如果环境已经创建过，直接执行：

```bash
conda run -n note-taking-ai python -m pip install -r services/ai-service/requirements.txt
conda run -n note-taking-ai python -m uvicorn app.main:app --app-dir services/ai-service --host 0.0.0.0 --port 3003
```

启动完成后，访问前端：

```text
http://localhost:5173
```

可用以下接口快速检查服务状态：

```bash
curl http://localhost:5173/api/user/health
curl http://localhost:5173/api/doc/health
curl http://localhost:5173/api/ai/health
curl http://localhost:5173/api/sync/health
```

## Docker 启动

```bash
cp .env.example .env
docker compose up --build
```

访问入口：

- 前端与网关：http://localhost
- MinIO 控制台：http://localhost:9001
- Qdrant：http://localhost:6333

## 网关路由

- `/` -> 前端 Web
- `/api/user` -> 用户服务
- `/api/doc` -> 文档服务
- `/api/ai` -> AI 服务
- `/api/sync` -> 离线同步服务
- `/ws` -> 协同服务

## 当前占位接口

- `GET /api/user/health`
- `POST /api/user/register`
- `POST /api/user/login`
- `GET /api/doc/notes`
- `POST /api/doc/notes`
- `POST /api/doc/pdf/upload`
- `POST /api/ai/summary`
- `POST /api/ai/polish`
- `POST /api/ai/chat`
- `GET /api/sync/pull`
- `POST /api/sync/push`
- `WS /ws/collab/:documentId`
