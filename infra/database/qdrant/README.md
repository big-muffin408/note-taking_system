# Qdrant 初始化说明

Qdrant 当前通过 Docker volume 持久化数据。集合创建将在后续 RAG 服务实现时由 AI 服务或文档服务完成。

计划集合：

- `note_chunks`：存储笔记与 PDF 切片向量。
- `document_chunks`：存储单篇文档的结构化片段向量。
