# AI 协作笔记系统 API 文档

## 概述

本文档描述了 AI 协作笔记系统的后端 API 接口。所有 API 都通过 Nginx 网关进行路由。

## 基础信息

- **基础URL**: `http://localhost:80` (开发环境) 或 `https://your-domain.com` (生产环境)
- **认证方式**: Bearer Token (JWT)
- **内容类型**: `application/json`

## 用户服务 (User Service)

### 健康检查

```
GET /api/user/health
```

**响应示例**:
```json
{
  "service": "user-service",
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 发送验证码

```
POST /api/user/verification-code
```

**请求体**:
```json
{
  "email": "user@example.com"
}
```

**响应示例**:
```json
{
  "message": "验证码已发送"
}
```

### 用户注册

```
POST /api/user/register
```

**请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "用户名",
  "verificationCode": "123456"
}
```

**响应示例**:
```json
{
  "token": "jwt-token",
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "displayName": "用户名",
    "role": "user"
  }
}
```

### 用户登录

```
POST /api/user/login
```

**请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**响应示例**:
```json
{
  "token": "jwt-token",
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "displayName": "用户名",
    "role": "user"
  }
}
```

### 获取当前用户信息

```
GET /api/user/me
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "id": "user-id",
  "email": "user@example.com",
  "displayName": "用户名",
  "role": "user"
}
```

### 发起 Google OAuth 登录

```
GET /api/user/google
```

**说明**: 重定向到 Google 授权页面。需要配置 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`，否则返回“Google 登录尚未配置”。

### Google OAuth 回调

```
GET /api/user/google/callback?code=...&state=...
```

**说明**: Google 授权后回调此接口。user-service 用 `code` 换取 token、读取用户信息、创建或绑定本地用户，然后重定向回前端 `/auth/callback#token=<jwt>`。前端 `OAuthCallbackPage` 从 hash 中读取 JWT 并调用 `/api/user/me`。

### 创建分享

```
POST /api/user/shares
```

**请求头**:
```
Authorization: Bearer <token>
```

**请求体**:
```json
{
  "documentId": "document-id",
  "email": "sharee@example.com",
  "permission": "read" // 或 "write"
}
```

**响应示例**:
```json
{
  "id": "share-id",
  "documentId": "document-id",
  "shareeId": "sharee-id",
  "shareeName": "被分享者",
  "permission": "read"
}
```

### 获取分享列表

```
GET /api/user/shares?documentId=<document-id>
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "items": [
    {
      "id": "share-id",
      "documentId": "document-id",
      "shareeId": "sharee-id",
      "shareeEmail": "sharee@example.com",
      "shareeName": "被分享者",
      "permission": "read",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### 删除分享

```
DELETE /api/user/shares/:id
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "deleted": true
}
```

### 获取分享给我的文档

```
GET /api/user/shares/shared-with-me
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "items": [
    {
      "id": "share-id",
      "documentId": "document-id",
      "sharerId": "owner-id",
      "sharerName": "分享者",
      "permission": "read",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### 管理员：用户列表

```
GET /api/user/admin/users
```

**请求头**:
```
Authorization: Bearer <token>   // 需要 admin 角色
```

**说明**: 仅 `role = admin` 的用户可访问，返回系统用户列表。

### 管理员：修改用户角色

```
PUT /api/user/admin/users/:id/role
```

**请求头**:
```
Authorization: Bearer <token>   // 需要 admin 角色
```

**请求体**:
```json
{
  "role": "admin"
}
```

### 管理员：查看服务状态

```
GET /api/user/admin/system-status
```

**请求头**:
```
Authorization: Bearer <token>   // 需要 admin 角色
```

**说明**: 聚合返回各后端服务的健康状态，供管理后台展示。

## 文档服务 (Document Service)

### 健康检查

```
GET /api/doc/health
```

**响应示例**:
```json
{
  "service": "document-service",
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 获取笔记列表

```
GET /api/doc/notes
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "items": [
    {
      "id": "note-id",
      "title": "笔记标题",
      "content": "笔记内容",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

### 创建笔记

```
POST /api/doc/notes
```

**请求头**:
```
Authorization: Bearer <token>
```

**请求体**:
```json
{
  "title": "笔记标题",
  "content": "笔记内容"
}
```

**响应示例**:
```json
{
  "id": "note-id",
  "title": "笔记标题",
  "content": "笔记内容",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### 获取单个笔记

```
GET /api/doc/notes/:id
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "id": "note-id",
  "title": "笔记标题",
  "content": "笔记内容",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### 更新笔记

```
PUT /api/doc/notes/:id
```

**请求头**:
```
Authorization: Bearer <token>
```

**请求体**:
```json
{
  "title": "更新后的标题",
  "content": "更新后的内容"
}
```

**响应示例**:
```json
{
  "id": "note-id",
  "title": "更新后的标题",
  "content": "更新后的内容",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### 删除笔记

```
DELETE /api/doc/notes/:id
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "deleted": true
}
```

### 上传 PDF（推荐：异步任务）

```
POST /api/doc/pdf/jobs
```

**请求头**:
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**请求体**:
- `file`: PDF 文件

**响应示例**:
```json
{
  "jobId": "665000000000000000000001",
  "pdfId": "665000000000000000000002",
  "status": "queued"
}
```

### 查询 PDF 解析任务

```
GET /api/doc/pdf/jobs/:jobId
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "jobId": "665000000000000000000001",
  "pdfId": "665000000000000000000002",
  "noteId": "665000000000000000000003",
  "fileName": "example.pdf",
  "bytes": 102400,
  "status": "parsed",
  "parser": "mineru-api",
  "pages": 10,
  "wordCount": 5000,
  "chunks": 50,
  "assetCount": 3,
  "warnings": [],
  "createdAt": "2026-05-12T00:00:00.000Z",
  "updatedAt": "2026-05-12T00:00:30.000Z"
}
```

`status` 取值为 `queued`、`parsing`、`parsed`、`failed`。只有 `failed` 状态可以重试：

```
POST /api/doc/pdf/jobs/:jobId/retry
```

重试会复用 MinIO 中已上传的原始 PDF，成功响应仍为 `202`，随后继续轮询任务状态。

### 上传 PDF（兼容：同步解析）

```
POST /api/doc/pdf/upload
```

**请求头**:
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**请求体**:
- `file`: PDF 文件

**响应示例**:
```json
{
  "pdfId": "pdf-id",
  "noteId": "note-id",
  "fileName": "example.pdf",
  "bytes": 102400,
  "pages": 10,
  "parser": "mineru-api",
  "wordCount": 5000,
  "chunks": 50,
  "assetCount": 3,
  "warnings": [],
  "status": "parsed",
  "markdownDraft": "Markdown 内容..."
}
```

### 获取版本历史

```
GET /api/doc/notes/:id/versions
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "items": [
    {
      "id": "version-id",
      "noteId": "note-id",
      "content": "版本内容",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

### 创建版本快照

```
POST /api/doc/notes/:id/versions
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "id": "version-id",
  "noteId": "note-id",
  "label": "手动快照",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### 获取版本详情

```
GET /api/doc/notes/:id/versions/:versionId
```

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "id": "version-id",
  "noteId": "note-id",
  "title": "笔记标题",
  "content": "版本内容（文本或 HTML 预览）",
  "label": "自动快照",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### 恢复版本

```
POST /api/doc/notes/:id/versions/:versionId/restore
```

**请求头**:
```
Authorization: Bearer <token>
```

**说明**: 恢复指定版本，会自动快照当前状态后再恢复。如果版本包含 Yjs 更新数据，会写入协同状态；否则恢复 HTML 内容。

**响应示例**:
```json
{
  "restored": true,
  "noteId": "note-id",
  "versionId": "version-id"
}
```

### 上传图片

```
POST /api/doc/images/upload
```

**请求头**:
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**请求体**:
- `file`: 图片文件（JPEG / PNG / GIF / WebP / SVG / BMP / TIFF）

**响应示例**:
```json
{
  "url": "/api/doc/images/<key>",
  "key": "user-id/images/uuid.png",
  "fileName": "diagram.png",
  "bytes": 20480
}
```

### 读取图片

```
GET /api/doc/images/:key
```

**说明**: 按对象 key 从 MinIO 读取图片并回传二进制内容，无需认证（key 本身包含用户前缀，作为非公开但可猜测度低的访问凭据）。编辑器中的图片 URL 即指向此接口。

## AI 服务 (AI Service)

> **注意**: AI 服务的所有业务端点（`/pdf/parse`、`/documents/index`、`/summary`、`/polish`、`/chat`）都通过 `verify_service_auth` 校验服务间认证：当配置了 `AI_SERVICE_SECRET` 时，请求头必须为 `Authorization: Bearer <AI_SERVICE_SECRET>`，否则返回 403；未配置时为开放访问（开发模式）。前端不直接调用这些端点，而是通过 document-service 代理转发，无需直接配置此 token。

### 健康检查

```
GET /api/ai/health
```

**响应示例**:
```json
{
  "service": "ai-service",
  "status": "ok",
  "provider": "mock",
  "model": "mock-model",
  "mineruBackend": "pipeline",
  "chromaCollection": "note_chunks",
  "embeddingModel": "text-embedding-3-small",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 解析 PDF（服务内部）

```
POST /api/ai/pdf/parse
```

**请求头**:
```
Authorization: Bearer <AI_SERVICE_SECRET>
Content-Type: multipart/form-data
```

**请求体**:
- `file`: PDF 文件
- `documentId`（可选）、`noteId`（可选）

**说明**: 由 document-service 调用。使用 MinerU 解析 PDF，返回 markdown/html 草稿、提取的图片资源，并将分块索引到 Chroma。

### 索引文档内容（服务内部）

```
POST /api/ai/documents/index
```

**请求头**:
```
Authorization: Bearer <AI_SERVICE_SECRET>
Content-Type: application/json
```

**请求体**:
```json
{
  "text": "要索引的文本内容",
  "markdown": "可选 markdown",
  "documentId": "document-id",
  "noteId": "note-id",
  "sourceName": "来源名称"
}
```

**响应示例**:
```json
{
  "status": "indexed",
  "chunks": 12
}
```

### AI 问答

```
POST /api/ai/chat?stream=true
```

**请求头**:
```
Authorization: Bearer <token>
Content-Type: application/json
Accept: text/event-stream
```

**请求体**:
```json
{
  "question": "这个问题的答案是什么？",
  "documentId": "document-id" // 可选，指定文档进行 RAG 问答
}
```

**响应**: SSE 流式响应

### 文本摘要

```
POST /api/ai/summary?stream=true
```

**请求头**:
```
Authorization: Bearer <token>
Content-Type: application/json
Accept: text/event-stream
```

**请求体**:
```json
{
  "text": "需要摘要的文本内容...",
  "documentId": "document-id" // 可选
}
```

**响应**: SSE 流式响应

### 文本润色

```
POST /api/ai/polish?stream=true
```

**请求头**:
```
Authorization: Bearer <token>
Content-Type: application/json
Accept: text/event-stream
```

**请求体**:
```json
{
  "text": "需要润色的文本内容..."
}
```

**响应**: SSE 流式响应

## 协同服务 (Collab Service)

### 健康检查

> **注意**: 协同服务健康检查仅可通过内部端口访问，Nginx 网关未配置此路由。

```
GET /health (容器内部: http://collab-service:3004/health)
```

**响应示例**:
```json
{
  "service": "collab-service",
  "status": "ok",
  "documents": 5,
  "connections": 10,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### WebSocket 连接

```
ws://localhost:80/ws/collab/:documentId
```

**连接参数**:
- `documentId`: 文档 ID
- `token`: JWT Token (通过查询参数或消息传递)

## 同步服务 (Sync Service)

### 健康检查

```
GET /api/sync/health
```

**响应示例**:
```json
{
  "service": "sync-service",
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 拉取变更

```
GET /api/sync/pull?since=<timestamp>
```

**请求头**:
```
Authorization: Bearer <token>
```

**说明**: 拉取当前用户自己的笔记和分享给自己的笔记。提供 `since`（ISO 时间戳）时仅返回 `updatedAt > since` 的笔记，实现增量同步。返回的 `cursor` 应作为下次拉取的 `since`。

**响应示例**:
```json
{
  "cursor": "2024-01-01T00:00:00.000Z",
  "notes": [
    {
      "id": "note-id",
      "title": "笔记标题",
      "content": "笔记内容",
      "ownerId": "user-id",
      "sourcePdfId": null,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### 推送变更

```
POST /api/sync/push
```

**请求头**:
```
Authorization: Bearer <token>
```

**请求体**: `changes` 为离线队列项数组，每项含 `id`（队列项 ID）、`noteId`（服务端笔记 ID，create 时可空）、`type`（`create` / `update` / `delete`）以及可选的 `title`、`content`、`baseUpdatedAt`、`createdAt`。

```json
{
  "changes": [
    {
      "id": "queue-item-id",
      "noteId": "note-id",
      "type": "update",
      "title": "更新后的标题",
      "content": "更新后的内容",
      "baseUpdatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**响应示例**:
```json
{
  "accepted": true,
  "results": [
    {
      "queueId": "queue-item-id",
      "noteId": "note-id",
      "status": "updated",
      "note": {
        "id": "note-id",
        "title": "更新后的标题",
        "content": "更新后的内容",
        "updatedAt": "2024-01-01T00:00:01.000Z"
      }
    }
  ]
}
```

每个结果项的 `status` 取值：

- `created`：create 成功，附带 `remoteId`（服务端新笔记 ID）与 `note`。
- `updated`：update 成功，附带最新 `note`。
- `deleted`：delete 成功（或笔记已不存在）。
- `conflict`：`baseUpdatedAt` 早于服务端当前版本，附带 `serverNote` 供前端选择“保留本地草稿”或“使用服务器版本”。
- `error`：处理失败，附带 `message`。

## 错误响应

所有 API 在发生错误时都会返回统一的错误响应格式：

```json
{
  "error": "错误信息",
  "code": "ERROR_CODE"
}
```

### 常见错误码

- `VALIDATION_ERROR`: 请求参数验证失败
- `AUTHENTICATION_ERROR`: 认证失败
- `AUTHORIZATION_ERROR`: 权限不足
- `NOT_FOUND`: 资源不存在
- `CONFLICT`: 资源冲突
- `RATE_LIMIT`: 请求过于频繁
- `INTERNAL_ERROR`: 服务器内部错误

### HTTP 状态码

- `200`: 成功
- `201`: 创建成功
- `400`: 请求参数错误
- `401`: 未授权
- `403`: 禁止访问
- `404`: 资源不存在
- `409`: 资源冲突
- `429`: 请求过于频繁
- `500`: 服务器内部错误
