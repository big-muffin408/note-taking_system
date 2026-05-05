# 基于 AI 增强的协作式文档笔记系统

这是按 `docs/开发任务书.md` 与 `docs/开发计划书.md` 搭建的可运行 monorepo。当前已完成**第一次迭代**核心功能，并进入**第二迭代**：用户认证、TipTap 编辑器、笔记 CRUD、Yjs WebSocket 协同编辑、PDF 轻量解析、AI 摘要与 RAG 问答主链路已经可用。

## 已完成功能

### 第一次迭代
- ✅ 用户注册 / 登录（JWT + bcrypt + MySQL，支持 Google 登录）
- ✅ TipTap 富文本编辑器（Markdown 快捷键、工具栏）
- ✅ 笔记 CRUD（MongoDB 持久化）
- ✅ 前端多页面路由（React Router）
- ✅ 自动保存（防抖 3 秒 + Ctrl+S 手动保存）
- ✅ 前端路由保护（登录态校验）

### 第二次迭代（当前）
- ✅ 多人实时协同编辑（Yjs + TipTap Collaboration + WebSocket）
- ✅ 协同光标与在线人数状态
- ✅ 协同服务健康检查（文档数、连接数）
- ✅ 协同状态轻量持久化（MongoDB `document_updates`）
- ✅ PDF 上传与高质量解析（优先 MinerU，缺少本地 MinerU 命令时回退 PyMuPDF，原文件写入 MinIO）
- ✅ PDF 解析后自动生成可编辑笔记
- ✅ AI 摘要与 RAG 问答可演示链路（Qdrant 检索 + mock/deepseek/openai provider）

### 待开发
- ⬜ 离线编辑模式（IndexedDB + 同步）
- ⬜ 复杂分享权限与协作者邀请

## 目录结构

```text
apps/web                    React + Vite + TypeScript 前端
services/user-service       用户服务（JWT + MySQL）
services/document-service   文档服务（MongoDB CRUD）
services/collab-service     协同 WebSocket 服务（Yjs 同步 + MongoDB update 持久化）
services/sync-service       离线同步服务
services/ai-service         Python FastAPI AI 服务
infra/nginx                 Nginx 反向代理配置
infra/database              数据库初始化脚本
```

## 本地启动

### 1. 启动数据库

需要先启动 MySQL、MongoDB、Redis：

```bash
docker compose up -d mysql mongodb redis
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动前端和 Node 微服务

```bash
npm run dev
```

`npm run dev` 会同时启动：

- 前端 Web：http://localhost:5173
- 用户服务：http://localhost:3001
- 文档服务：http://localhost:3002
- 协同 WebSocket 服务：http://localhost:3004
- 同步服务：http://localhost:3005

### 4. 启动 AI 服务（可选）

AI 服务使用 Python FastAPI，需要单独启动：

```bash
conda env create -f services/ai-service/environment.yml
conda activate note-taking-ai
python -m pip install -r services/ai-service/requirements.txt
python -m uvicorn app.main:app --app-dir services/ai-service --host 0.0.0.0 --port 3003 --reload
```

### 5. 使用系统

启动完成后，访问前端：

```text
http://localhost:5173
```

1. 注册一个新账号
2. 登录后进入主界面
3. 点击「新建笔记」创建笔记
4. 在编辑器中编写内容（支持 Markdown 快捷键）
5. 标题会通过 HTTP 保存；正文会通过 Yjs WebSocket 协同同步

### 6. 验证多人协同

1. 打开两个浏览器窗口，登录同一账号或两个账号
2. 在两个窗口中打开同一篇笔记
3. 在窗口 A 输入内容，窗口 B 应实时显示
4. 在窗口 B 修改同一段内容，窗口 A 应同步更新
5. 刷新页面后，协同正文应从 MongoDB 持久化状态恢复

协同服务健康检查：

```bash
curl http://localhost:3004/health
```

返回内容会包含：

```json
{
  "service": "collab-service",
  "status": "ok",
  "documents": 0,
  "connections": 0
}
```

## Docker 完整启动

```bash
cp .env.example .env
docker compose up --build
```

该命令不会额外启动 MinerU API 容器；未提供 `MINERU_API_URL` 且镜像内没有 `mineru` 命令时，PDF 上传会自动回退到 PyMuPDF 文本解析。PyMuPDF 适合轻量文本提取；如果需要更高质量的版面、公式和表格还原，请使用下面的 MinerU API 部署方式。

CUDA / NVIDIA GPU 版本：

```bash
docker compose -f docker-compose.yml -f docker-compose.cuda.yml up --build
```

CUDA 版本会使用 `services/ai-service/Dockerfile.cuda`，默认 MinerU 后端为 `vlm-vllm-engine`；如需覆盖可设置 `CUDA_MINERU_BACKEND`。主机需要已安装 NVIDIA 驱动、Docker GPU runtime，并能通过 `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi` 验证 GPU 可见。

官方 MinerU Docker API 部署方式：

```bash
npm run docker:up:mineru
```

该方式会额外启动 `mineru-api` 服务，并让 `ai-service` 通过 `MINERU_API_URL=http://mineru-api:8000` 调用 MinerU 官方 FastAPI 的 `/file_parse` 接口。这样 `ai-service` 不再安装 MinerU，业务镜像构建会更快，MinerU 的大依赖与模型缓存隔离在 `mineru-api` 容器里。

首次构建 `mineru-api` 仍然会比较慢，这是 MinerU 官方镜像依赖和模型环境本身较大导致的；后续会复用 `mineru-cache` volume 和 Docker 构建缓存。

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

## API 接口

### 用户服务 `/api/user`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | /health | 健康检查 | 否 |
| POST | /verification-code | 发送注册邮箱验证码 | 否 |
| POST | /register | 用户注册（需邮箱验证码） | 否 |
| POST | /login | 用户登录 | 否 |
| GET | /google | 发起 Google OAuth 登录 | 否 |
| GET | /google/callback | Google OAuth 回调 | 否 |
| GET | /me | 获取当前用户信息 | 是 |

### 文档服务 `/api/doc`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | /health | 健康检查 | 否 |
| GET | /notes | 获取笔记列表 | 是 |
| GET | /notes/:id | 获取单篇笔记 | 是 |
| POST | /notes | 创建笔记 | 是 |
| PUT | /notes/:id | 更新笔记 | 是 |
| DELETE | /notes/:id | 删除笔记 | 是 |
| POST | /pdf/upload | PDF 上传、轻量解析并创建笔记 | 是 |

### AI 服务 `/api/ai`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | /health | 健康检查 | 否 |
| POST | /summary | 基于文本或笔记上下文生成摘要 | 否 |
| POST | /polish | 文本润色 | 否 |
| POST | /chat | 基于 Qdrant 检索的 RAG 问答 | 否 |

### 同步服务 `/api/sync`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | /health | 健康检查 | 否 |
| GET | /pull | 拉取变更（占位） | 否 |
| POST | /push | 推送变更（占位） | 否 |

### 协同服务

| 协议 | 路径 | 描述 |
|------|------|------|
| HTTP | /health | 健康检查，返回文档数与连接数 |
| WebSocket | /ws/collab/:documentId | Yjs 协同编辑通道 |

协同正文不会再依赖文档服务的 3 秒自动保存。文档服务仍负责笔记标题、列表、创建、删除等 CRUD；协同服务负责正文实时同步，并将 Yjs update 写入 MongoDB 的 `document_updates` 集合。

## 开发检查

```bash
npm run build
npm audit --offline
```

当前构建已覆盖前端、用户服务、文档服务、协同服务和同步服务的 TypeScript 编译。

## 环境变量

参见 `.env.example`，关键变量：

- `JWT_SECRET`：JWT 签名密钥（生产环境务必修改）
- `APP_BASE_URL`：前端访问地址，用于 Google 登录成功后跳回前端
- `SERVER_PUBLIC_URL`：网关外部访问地址，用于生成 Google OAuth 回调地址
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：Google OAuth 客户端配置
- `GOOGLE_REDIRECT_URI`：Google OAuth 回调地址，默认 `http://localhost/api/user/google/callback`
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM`：注册邮箱验证码的 SMTP 发信配置
- `EMAIL_VERIFICATION_TTL_MINUTES`：验证码有效期，默认 10 分钟
- `EMAIL_VERIFICATION_COOLDOWN_SECONDS`：同一邮箱发送间隔，默认 60 秒
- `AI_PROVIDER`：AI 服务提供者（mock / openai / deepseek）
- `AI_API_KEY`：AI API 密钥
- `PDF_PARSE_PROVIDER`：PDF 解析器，默认 `mineru`；也可设为 `pymupdf` 强制使用轻量文本解析。默认 `mineru` 在没有 `MINERU_API_URL` 且找不到 `MINERU_COMMAND` 时会回退到 PyMuPDF
- `MINERU_BACKEND`：MinerU 后端，默认 `pipeline`，适合 CPU 环境
- `MINERU_API_URL`：外部 MinerU FastAPI 地址；使用 `docker-compose.mineru.yml` 时会自动设为 `http://mineru-api:8000`
- `MINERU_MODEL_SOURCE`：MinerU 模型来源，默认 `modelscope`
