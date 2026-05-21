# 基于 AI 增强的协作式文档笔记系统

这是一个按 `docs/开发任务书.md` 与 `docs/开发计划书.md` 演进的可运行 monorepo。当前项目已经从基础骨架进入可演示产品阶段：邮箱验证码注册、Google 登录、富文本笔记、多人协同、PDF 解析成可编辑笔记、AI 摘要/问答/润色、离线同步、版本历史、分享权限、管理后台和 Electron 桌面端都已经接入现有前后端链路。

## 当前进展

### 已接入主流程

- 用户认证：邮箱验证码注册、密码登录、Google OAuth 登录、JWT 登录态、失败登录锁定、用户角色。
- 笔记编辑：React + TipTap 富文本编辑器、Markdown 快捷输入、自动保存、标题/正文分离保存。
- 实时协同：Yjs + WebSocket，同文档多人编辑、协同光标、在线人数、MongoDB 持久化 Yjs update。
- PDF 到笔记：上传 PDF 后写入 MinIO，调用 AI 服务解析，生成可编辑笔记，并将分块内容索引到 Chroma。
- AI 能力：摘要、RAG 问答、选中文本润色，前端支持 SSE 流式输出；默认 `AI_PROVIDER=mock` 可离线演示。
- 离线编辑：IndexedDB 本地缓存、离线创建/编辑/删除、恢复在线后同步、基于 `baseUpdatedAt` 的冲突提示与处理。
- 版本历史：协同服务自动快照，文档服务支持手动快照、版本列表、预览和恢复。
- 分享权限：按邮箱邀请协作者，支持只读/可编辑权限；共享笔记会出现在被分享者列表中。
- 管理后台：管理员可查看用户、调整角色，并查看主要服务健康状态。
- 深色模式：支持明暗主题切换，基于 CSS 变量实现。
- Electron 桌面端：基于 electron-vite + electron-builder，支持 macOS (dmg/zip)、Windows (nsis/portable)、Linux (AppImage/deb) 打包。

### 仍可继续完善

- 更细的协作者体验：邀请通知、分享入口提示、只读编辑器态。
- 生产化安全：强制配置内部服务密钥、生产级 JWT/SMTP/OAuth 配置、审计日志查询页面。
- PDF 高质量解析体验：MinerU 首次构建、模型缓存、解析进度和失败重试 UI。
- 自动化测试：核心接口、离线冲突、分享权限和版本恢复还需要更系统的测试覆盖。
- Electron 桌面端：自动更新、系统托盘、本地文件关联。

## 技术栈

```text
apps/web                    React + Vite + TypeScript + TipTap + Electron 桌面端
services/user-service       用户、OAuth、分享、管理后台 API（MySQL）
services/document-service   笔记、PDF、版本历史 API（MongoDB + MinIO）
services/collab-service     Yjs WebSocket 协同服务（MongoDB 持久化）
services/sync-service       离线同步服务（MongoDB）
services/ai-service         FastAPI AI 服务（PDF 解析、摘要、润色、RAG）
infra/nginx                 统一网关
infra/database              MySQL / MongoDB 初始化脚本
```

基础设施：

- MySQL：用户、分享、验证码、审计基础表。
- MongoDB：笔记、PDF 元数据、Yjs update、版本快照。
- Redis：协同/服务扩展预留。
- Chroma：PDF/文档分块向量检索（AI 服务内置，持久化到 Docker volume）。
- MinIO：PDF 原文件对象存储。

## 快速启动

### Docker 完整启动

推荐用 detached 模式启动，这样命令返回后服务仍会保持运行：

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

访问入口：

- 前端与网关：http://localhost
- MinIO 控制台：http://localhost:9001

默认 `AI_PROVIDER=mock`，没有外部 API Key 也能演示摘要、问答和润色。默认 `PDF_PARSE_PROVIDER=mineru`，如果没有配置 `MINERU_API_URL` 且镜像内没有 `mineru` 命令，会自动回退到 PyMuPDF 文本解析。

常用健康检查：

```bash
docker compose exec -T nginx wget -S -qO- --header 'Host: localhost' http://127.0.0.1/api/user/health
docker compose exec -T nginx wget -S -qO- --header 'Host: localhost' http://127.0.0.1/api/doc/health
docker compose exec -T nginx wget -S -qO- --header 'Host: localhost' http://127.0.0.1/api/ai/health
docker compose exec -T nginx wget -S -qO- --header 'Host: localhost' http://127.0.0.1/api/sync/health
```

> 说明：在部分本地沙箱环境里，宿主机直接 `curl localhost` 可能被代理或端口隔离影响。容器内通过 nginx 验证更可靠。

停止服务：

```bash
docker compose down
```

### 本地开发启动

1. 启动基础设施：

```bash
docker compose up -d mysql mongodb redis minio
```

2. 安装依赖：

```bash
npm install
```

3. 启动前端和 Node 服务：

```bash
npm run dev
```

`npm run dev` 会启动：

- Web：http://localhost:5173
- user-service：http://localhost:3001
- document-service：http://localhost:3002
- collab-service：http://localhost:3004
- sync-service：http://localhost:3005

4. 单独启动 AI 服务：

```bash
conda env create -f services/ai-service/environment.yml
conda activate note-taking-ai
python -m pip install -r services/ai-service/requirements.txt
python -m uvicorn app.main:app --app-dir services/ai-service --host 0.0.0.0 --port 3003 --reload
```

开发模式前端入口是：

```text
http://localhost:5173
```

### Electron 桌面端启动

开发模式（需要先启动后端服务）：

```bash
npm run dev:electron --workspace @notes/web
```

构建 Electron 应用：

```bash
npm run build:electron --workspace @notes/web
```

打包为桌面应用（生成 dmg/exe/AppImage 等安装包）：

```bash
npm run build:desktop --workspace @notes/web
```

打包产物在 `apps/web/release/` 目录。支持平台：
- macOS：dmg、zip
- Windows：nsis（安装程序）、portable（便携版）
- Linux：AppImage、deb

## MinerU 高质量 PDF 解析

普通 `docker compose up -d --build` 不会额外启动 MinerU API 容器。需要版面、公式、表格还原时，可以在 Linux + NVIDIA Docker 环境使用 MinerU 组合配置：

```bash
cp .env.example .env
npm run docker:up:mineru
```

等价命令：

```bash
docker compose -f docker-compose.yml -f docker-compose.mineru.yml up --build
```

启动前建议确认 GPU 可用：

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi
```

`.env.example` 已给出本机演示的保守默认值：

```env
PDF_PARSE_PROVIDER=mineru
MINERU_BACKEND=pipeline
MINERU_LANGUAGE=ch
MINERU_TIMEOUT_SECONDS=1200
MINERU_SHM_SIZE=8gb
NVIDIA_VISIBLE_DEVICES=all
NVIDIA_DRIVER_CAPABILITIES=compute,utility
```

启动后确认链路：

```bash
docker compose ps
docker compose exec -T ai-service env | grep MINERU
```

使用 `docker-compose.mineru.yml` 时，`ai-service` 会通过 `MINERU_API_URL=http://mineru-api:8000` 调用独立 MinerU API。上传 PDF 后返回的 `parser` 应为 `mineru-api`；如果是 `pymupdf`，说明当前走的是轻量回退链路。

如果构建时 `apt-get install` 遇到临时 `502 Bad Gateway`，可以使用镜像源重新构建：

```bash
docker compose build --build-arg APT_MIRROR=http://mirrors.aliyun.com/debian ai-service
docker compose -f docker-compose.yml -f docker-compose.mineru.yml build --build-arg APT_MIRROR=http://mirrors.aliyun.com/ubuntu mineru-api
```

## 使用流程

1. 打开 `http://localhost` 或开发模式的 `http://localhost:5173`。
2. 注册账号。邮箱验证码需要配置 SMTP；未配置 SMTP 时，验证码发送接口会返回配置错误。
3. 登录后新建笔记，使用编辑器编写内容。
4. 打开两个浏览器窗口进入同一篇笔记，验证协同编辑和在线人数。
5. 上传 PDF，系统会解析并创建一篇可编辑笔记。
6. 在编辑页使用摘要、问答、选中文本润色。
7. 点击分享邀请其他用户，并选择只读或可编辑权限。
8. 点击版本历史查看快照并恢复。
9. 管理员账号可访问 `/admin` 查看用户和服务状态。

## 网关路由

| 路径 | 转发目标 |
|------|----------|
| `/` | Web 前端 |
| `/api/user` | user-service |
| `/api/doc` | document-service |
| `/api/ai` | ai-service |
| `/api/sync` | sync-service |
| `/ws` | collab-service |

## API 概览

### 用户与分享 `/api/user`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/health` | 健康检查 | 否 |
| POST | `/verification-code` | 发送注册邮箱验证码 | 否 |
| POST | `/register` | 用户注册 | 否 |
| POST | `/login` | 用户登录 | 否 |
| GET | `/google` | 发起 Google OAuth 登录 | 否 |
| GET | `/google/callback` | Google OAuth 回调 | 否 |
| GET | `/me` | 获取当前用户 | 是 |
| POST | `/shares` | 分享文档给指定邮箱 | 是 |
| GET | `/shares?documentId=...` | 查看某篇文档的分享列表 | 是 |
| GET | `/shares/shared-with-me` | 查看分享给我的文档 | 是 |
| DELETE | `/shares/:id` | 撤销分享 | 是 |
| GET | `/admin/users` | 管理员查看用户列表 | 管理员 |
| PUT | `/admin/users/:id/role` | 管理员修改用户角色 | 管理员 |
| GET | `/admin/system-status` | 管理员查看服务状态 | 管理员 |

### 文档 `/api/doc`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/health` | 健康检查 | 否 |
| GET | `/notes` | 获取自己的笔记和分享给自己的笔记 | 是 |
| GET | `/notes/:id` | 获取单篇笔记 | 是 |
| POST | `/notes` | 创建笔记 | 是 |
| PUT | `/notes/:id` | 更新笔记，支持 `baseUpdatedAt` 冲突检测 | 是 |
| DELETE | `/notes/:id` | 删除笔记 | 是 |
| POST | `/pdf/jobs` | 推荐路径：上传 PDF、创建异步解析任务、写入 MinIO | 是 |
| GET | `/pdf/jobs/:jobId` | 查询 PDF 解析任务状态 | 是 |
| POST | `/pdf/jobs/:jobId/retry` | 重试失败的 PDF 解析任务 | 是 |
| POST | `/pdf/upload` | 兼容路径：同步上传 PDF、解析、创建笔记、写入 MinIO/Chroma | 是 |
| POST | `/notes/:id/versions` | 创建版本快照 | 是 |
| GET | `/notes/:id/versions` | 查看版本列表 | 是 |
| GET | `/notes/:id/versions/:versionId` | 查看版本详情 | 是 |
| POST | `/notes/:id/versions/:versionId/restore` | 恢复版本 | 是 |

### AI `/api/ai`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/health` | 健康检查，返回 provider/model/MinerU 配置 | 否 |
| POST | `/pdf/parse` | 解析 PDF 并索引分块 | 服务内部 |
| POST | `/documents/index` | 索引文档内容到 Chroma | 服务内部 |
| POST | `/summary` | 文本/笔记摘要，支持 `?stream=true` | 否 |
| POST | `/polish` | 文本润色，支持 `?stream=true` | 否 |
| POST | `/chat` | 基于 Chroma 检索的 RAG 问答，支持 `?stream=true` | 否 |

### 同步 `/api/sync`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/health` | 健康检查 | 否 |
| GET | `/pull?since=...` | 拉取当前用户笔记和共享笔记，可增量 | 是 |
| POST | `/push` | 推送离线 create/update/delete 队列 | 是 |

`/api/sync/push` 使用 `baseUpdatedAt` 判断冲突。如果客户端基于的版本早于服务器当前版本，会返回 `conflict` 和 `serverNote`，前端会保留本地草稿并提示用户选择“保留本地草稿”或“使用服务器版本”。

### 协同服务

| 协议 | 路径 | 描述 |
|------|------|------|
| HTTP | `/health` | 返回文档数、连接数和时间戳 |
| WebSocket | `/ws/collab/:documentId` | Yjs 协同编辑通道 |

协同连接会校验 JWT，并检查用户是否为文档所有者或被分享者。协同正文不会依赖文档服务的 3 秒自动保存；文档服务负责笔记标题、列表、创建、删除、PDF 和版本 API，协同服务负责正文实时同步和 Yjs update 持久化。

## 环境变量

参见 `.env.example`。常用变量：

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | JWT 签名密钥，生产环境必须修改 |
| `INTERNAL_SERVICE_SECRET` | 内部服务间访问校验密钥 |
| `AI_SERVICE_SECRET` | document-service 调用 ai-service 的可选 Bearer 密钥 |
| `ALLOWED_ORIGINS` | CORS 白名单，逗号分隔 |
| `APP_BASE_URL` | 前端访问地址，用于 OAuth 成功后跳回前端 |
| `SERVER_PUBLIC_URL` | 网关外部地址，用于生成 OAuth 回调 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 配置 |
| `GOOGLE_REDIRECT_URI` | Google OAuth 回调，Docker 默认 `http://localhost/api/user/google/callback` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | 邮箱验证码发信配置 |
| `AI_PROVIDER` | `mock` / `openai` / `deepseek` / `xiaomi` |
| `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL` | OpenAI-compatible 模型配置 |
| `PDF_PARSE_PROVIDER` | `mineru` 或 `pymupdf` |
| `MINERU_API_URL` | 外部或 compose 内 MinerU API 地址 |
| `MINERU_MODEL_SOURCE` | MinerU 模型来源，默认 `modelscope` |
| `MINIO_BUCKET` | PDF 原文件存储桶 |

Google OAuth 常用本地配置：

- `npm run dev`：来源 `http://localhost:5173`，回调 `http://localhost:5173/api/user/google/callback`
- Docker/Nginx：来源 `http://localhost`，回调 `http://localhost/api/user/google/callback`

## 开发检查

```bash
npm run build
python -m compileall services/ai-service/app
npm --workspace @notes/document-service test -- --runInBand pdf-jobs.test.ts
cd services/ai-service && pytest

# Electron 构建检查
npm run build:electron --workspace @notes/web
```

端到端 smoke 推荐在 Docker/Nginx 模式下执行：

```bash
docker compose up -d --build
docker compose ps
docker compose exec -T nginx wget -S -qO- --header 'Host: localhost' http://127.0.0.1/api/user/health
docker compose exec -T nginx wget -S -qO- --header 'Host: localhost' http://127.0.0.1/api/doc/health
docker compose exec -T nginx wget -S -qO- --header 'Host: localhost' http://127.0.0.1/api/ai/health
docker compose exec -T nginx wget -S -qO- --header 'Host: localhost' http://127.0.0.1/api/sync/health
```

可选安全检查：

```bash
npm audit --offline
```

## 离线编辑验收流程

1. 正常启动服务并登录，在线创建一篇笔记，输入内容后刷新页面，确认内容仍在。
2. 在浏览器 DevTools 中切到 Offline，新建笔记并编辑正文，侧边栏应显示“待同步”，编辑页应显示“离线编辑 / 待同步”。
3. 恢复 Online，点击侧边栏“同步”或等待自动同步，本地 `local-*` 路由应自动跳转到服务端真实笔记 ID，状态变为“已同步”。
4. 再次切到 Offline，编辑已有笔记或删除笔记；恢复 Online 后，修改或删除应同步到 MongoDB。
5. 用两个窗口打开同一篇笔记，在窗口 A 保存后，窗口 B 基于旧版本保存应进入“有冲突”状态。
6. 分别验证“保留本地草稿”和“使用服务器版本”都能恢复到“已同步”。

## PDF 解析任务排障

- 前端上传 PDF 默认走 `/api/doc/pdf/jobs`，返回 `202` 和 `jobId` 后轮询 `/api/doc/pdf/jobs/:jobId`。状态应从 `queued` 进入 `parsing`，最后变为 `parsed` 或 `failed`。
- 如果任务长时间停在 `queued`，优先看 `document-service` 日志和后台 worker 是否启动；测试环境会通过 `DISABLE_PDF_JOB_WORKER=true` 主动关闭 worker。
- 如果任务停在 `parsing` 后失败，查看任务返回的 `error`、`ai-service` 日志和 `/api/ai/health` 中的 `pdfParseProvider`、`mineruApiUrl`。
- `parser=pymupdf` 表示当前走轻量回退链路；需要高质量版面、图片、公式时，应启动 MinerU API 并确认上传结果展示 `parser=mineru-api`。
- 只有 `failed` 状态任务可以调用 `/api/doc/pdf/jobs/:jobId/retry`。重试会复用 MinIO 中的原始 PDF，不要求用户重新选择文件。

## 当前代码分析摘要

项目已进入产品化阶段，前端 `EditorPage` 承担了协同、离线、PDF、流式 AI、版本恢复、分享弹窗等复合工作流；后端从简单 CRUD 扩展成 user/document/collab/sync/ai 多服务协作。新增 Electron 桌面端支持，通过 electron-vite 实现开发热更新，electron-builder 支持 macOS/Windows/Linux 三平台打包。

当前质量收口重点是：PDF 异步解析任务、失败重试、离线冲突、版本恢复和 MinerU 图片/公式链路都有自动化或 smoke 覆盖，后续新增功能前应先保持这些检查为绿色。
