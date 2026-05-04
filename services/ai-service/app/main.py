import hashlib
import html
import json
import math
import re
import uuid
from datetime import datetime, timezone
from os import getenv
from typing import Any, AsyncGenerator, Optional

import fitz
import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI(title="AI Service", version="0.3.0")

VECTOR_SIZE = 128
QDRANT_COLLECTION = getenv("QDRANT_COLLECTION", "note_chunks")
QDRANT_URL = getenv("QDRANT_URL", "http://localhost:6333").rstrip("/")


class TextRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    text: str = Field(default="", description="Input text for AI processing.")
    document_id: Optional[str] = Field(default=None, alias="documentId")
    note_id: Optional[str] = Field(default=None, alias="noteId")


class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    question: str = Field(default="", description="Question for RAG chat.")
    document_id: Optional[str] = Field(default=None, alias="documentId")
    note_id: Optional[str] = Field(default=None, alias="noteId")


class IndexRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    text: str
    markdown: str = ""
    document_id: Optional[str] = Field(default=None, alias="documentId")
    note_id: Optional[str] = Field(default=None, alias="noteId")
    source_name: str = Field(default="note", alias="sourceName")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def provider_name() -> str:
    return getenv("AI_PROVIDER", "mock").lower()


def normalize_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def text_to_markdown(text: str, title: str) -> str:
    title = title.rsplit(".", 1)[0].strip() or "PDF 笔记"
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", normalize_text(text)) if p.strip()]
    body = "\n\n".join(paragraphs)
    return f"# {title}\n\n{body}" if body else f"# {title}\n\nPDF 中未提取到可用文本。"


def markdown_to_html(markdown: str) -> str:
    blocks = []
    for block in re.split(r"\n\s*\n", markdown.strip()):
        escaped = html.escape(block.strip())
        if not escaped:
            continue
        if escaped.startswith("# "):
            blocks.append(f"<h1>{escaped[2:].strip()}</h1>")
        elif escaped.startswith("## "):
            blocks.append(f"<h2>{escaped[3:].strip()}</h2>")
        else:
            blocks.append(f"<p>{escaped.replace(chr(10), '<br>')}</p>")
    return "".join(blocks) or "<p></p>"


def chunk_text(text: str, max_chars: int = 900) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", normalize_text(text)) if p.strip()]
    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(paragraph[i:i + max_chars] for i in range(0, len(paragraph), max_chars))
            continue

        candidate = f"{current}\n\n{paragraph}".strip()
        if len(candidate) > max_chars and current:
            chunks.append(current)
            current = paragraph
        else:
            current = candidate

    if current:
        chunks.append(current)
    return chunks


def embed_text(text: str) -> list[float]:
    vector = [0.0] * VECTOR_SIZE
    words = re.findall(r"[\w\u4e00-\u9fff]+", text.lower())
    for word in words:
        digest = hashlib.sha256(word.encode("utf-8")).digest()
        index = int.from_bytes(digest[:2], "big") % VECTOR_SIZE
        vector[index] += 1.0

    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


async def ensure_qdrant_collection() -> None:
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        response = await client.get(f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}")
        if response.status_code == 200:
            return
        if response.status_code != 404:
            response.raise_for_status()

        create = await client.put(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}",
            json={"vectors": {"size": VECTOR_SIZE, "distance": "Cosine"}},
        )
        create.raise_for_status()


async def index_chunks(
    text: str,
    *,
    markdown: str = "",
    document_id: Optional[str] = None,
    note_id: Optional[str] = None,
    source_name: str = "note",
) -> list[dict[str, Any]]:
    chunks = chunk_text(text)
    if not chunks:
        return []

    await ensure_qdrant_collection()
    points = []
    for index, chunk in enumerate(chunks):
        point_seed = f"{document_id or ''}:{note_id or ''}:{source_name}:{index}:{chunk}"
        point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, point_seed))
        points.append({
            "id": point_id,
            "vector": embed_text(chunk),
            "payload": {
                "documentId": document_id,
                "noteId": note_id,
                "sourceName": source_name,
                "chunkIndex": index,
                "text": chunk,
                "markdown": markdown[:2000],
                "indexedAt": now_iso(),
            },
        })

    async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
        response = await client.put(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points",
            params={"wait": "true"},
            json={"points": points},
        )
        response.raise_for_status()

    return [{"index": i, "text": chunk} for i, chunk in enumerate(chunks)]


def qdrant_filter(document_id: Optional[str], note_id: Optional[str]) -> dict[str, Any] | None:
    should = []
    if document_id:
        should.append({"key": "documentId", "match": {"value": document_id}})
    if note_id:
        should.append({"key": "noteId", "match": {"value": note_id}})
    return {"should": should} if should else None


async def search_chunks(query: str, document_id: Optional[str], note_id: Optional[str]) -> list[dict[str, Any]]:
    await ensure_qdrant_collection()
    body: dict[str, Any] = {
        "vector": embed_text(query),
        "limit": 5,
        "with_payload": True,
    }
    query_filter = qdrant_filter(document_id, note_id)
    if query_filter:
        body["filter"] = query_filter

    async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
        response = await client.post(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/search",
            json=body,
        )
        response.raise_for_status()

    result = response.json().get("result", [])
    return [
        {
            "score": item.get("score", 0),
            "text": item.get("payload", {}).get("text", ""),
            "sourceName": item.get("payload", {}).get("sourceName", ""),
            "chunkIndex": item.get("payload", {}).get("chunkIndex", 0),
        }
        for item in result
        if item.get("payload", {}).get("text")
    ]


async def call_model(messages: list[dict[str, str]]) -> str:
    provider = provider_name()
    api_key = getenv("AI_API_KEY", "")
    model = getenv("AI_MODEL", "deepseek-chat")

    if provider == "mock" or not api_key:
        content = messages[-1]["content"]
        return f"Mock AI response: {content[:500]}"

    if provider == "deepseek":
        base_url = (getenv("AI_BASE_URL") or "https://api.deepseek.com").rstrip("/")
    elif provider == "openai":
        base_url = (getenv("AI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported AI_PROVIDER: {provider}")

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": messages, "temperature": 0.2},
        )
        response.raise_for_status()

    return response.json()["choices"][0]["message"]["content"]


async def stream_model(messages: list[dict[str, str]]) -> AsyncGenerator[str, None]:
    """Yield text chunks via SSE. For mock provider, simulate character-by-character output."""
    provider = provider_name()
    api_key = getenv("AI_API_KEY", "")
    model = getenv("AI_MODEL", "deepseek-chat")

    if provider == "mock" or not api_key:
        content = messages[-1]["content"]
        mock_reply = f"Mock AI response: {content[:200]}"
        for char in mock_reply:
            yield char
        return

    if provider == "deepseek":
        base_url = (getenv("AI_BASE_URL") or "https://api.deepseek.com").rstrip("/")
    elif provider == "openai":
        base_url = (getenv("AI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported AI_PROVIDER: {provider}")

    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream(
            "POST",
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": messages, "temperature": 0.2, "stream": True},
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:].strip()
                if data == "[DONE]":
                    return
                try:
                    delta = json.loads(data)["choices"][0]["delta"].get("content", "")
                    if delta:
                        yield delta
                except (KeyError, json.JSONDecodeError):
                    continue


def make_sse_stream(
    messages: list[dict[str, str]],
    meta: dict[str, Any],
) -> AsyncGenerator[str, None]:
    """Wrap stream_model output as SSE event stream."""
    async def generator() -> AsyncGenerator[str, None]:
        # First event: metadata
        yield f"event: meta\ndata: {json.dumps(meta, ensure_ascii=False)}\n\n"
        full_text = ""
        async for chunk in stream_model(messages):
            full_text += chunk
            payload = json.dumps({"chunk": chunk}, ensure_ascii=False)
            yield f"event: chunk\ndata: {payload}\n\n"
        # Final event: done
        done_payload = json.dumps({"content": full_text}, ensure_ascii=False)
        yield f"event: done\ndata: {done_payload}\n\n"
    return generator()


@app.get("/health")
def health():
    return {
        "service": "ai-service",
        "status": "ok",
        "provider": provider_name(),
        "model": getenv("AI_MODEL", "mock-model"),
        "qdrantCollection": QDRANT_COLLECTION,
        "timestamp": now_iso(),
    }


@app.post("/pdf/parse")
async def parse_pdf(
    file: UploadFile = File(...),
    document_id: Optional[str] = Form(default=None, alias="documentId"),
    note_id: Optional[str] = Form(default=None, alias="noteId"),
):
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    data = await file.read()
    try:
        document = fitz.open(stream=data, filetype="pdf")
    except Exception as error:
        raise HTTPException(status_code=400, detail="PDF 解析失败") from error

    pages = []
    for page in document:
        pages.append(page.get_text("text"))

    text = normalize_text("\n\n".join(pages))
    markdown = text_to_markdown(text, file.filename or "PDF 笔记")
    html_draft = markdown_to_html(markdown)
    chunks = await index_chunks(
        text,
        markdown=markdown,
        document_id=document_id,
        note_id=note_id,
        source_name=file.filename or "PDF",
    )

    return {
        "documentId": document_id,
        "noteId": note_id,
        "fileName": file.filename,
        "pages": document.page_count,
        "wordCount": len(re.findall(r"[\w\u4e00-\u9fff]+", text)),
        "status": "parsed",
        "text": text,
        "markdownDraft": markdown,
        "htmlDraft": html_draft,
        "chunks": len(chunks),
    }


@app.post("/documents/index")
async def index_document(payload: IndexRequest):
    chunks = await index_chunks(
        payload.text,
        markdown=payload.markdown,
        document_id=payload.document_id,
        note_id=payload.note_id,
        source_name=payload.source_name,
    )
    return {"status": "indexed", "chunks": len(chunks)}


@app.post("/summary")
async def summarize(payload: TextRequest, stream: bool = False):
    source_text = normalize_text(payload.text)
    sources: list[dict[str, Any]] = []
    if not source_text and (payload.document_id or payload.note_id):
        sources = await search_chunks("摘要 核心观点 重点", payload.document_id, payload.note_id)
        source_text = "\n\n".join(source["text"] for source in sources)

    if not source_text:
        source_text = "这里将接入全文或选区摘要。"

    messages = [
        {"role": "system", "content": "你是文献笔记助手，请用中文生成简洁摘要，保留关键论点。"},
        {"role": "user", "content": f"请总结以下内容：\n\n{source_text[:6000]}"},
    ]

    if stream:
        meta = {
            "type": "summary",
            "documentId": payload.document_id,
            "noteId": payload.note_id,
            "sources": sources,
        }
        return StreamingResponse(
            make_sse_stream(messages, meta),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    content = await call_model(messages)
    return {
        "type": "summary",
        "documentId": payload.document_id,
        "noteId": payload.note_id,
        "content": content,
        "streaming": False,
        "sources": sources,
    }


@app.post("/polish")
async def polish(payload: TextRequest, stream: bool = False):
    source_text = payload.text or "这里将返回润色后的文本。"
    messages = [
        {"role": "system", "content": "你是中文写作助手，请润色文本：修正语法错误、优化表达，保持原意不变。直接返回润色后的文本，不加任何说明。"},
        {"role": "user", "content": source_text[:6000]},
    ]

    if stream:
        meta = {
            "type": "polish",
            "documentId": payload.document_id,
            "noteId": payload.note_id,
        }
        return StreamingResponse(
            make_sse_stream(messages, meta),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    content = await call_model(messages)
    return {
        "type": "polish",
        "documentId": payload.document_id,
        "noteId": payload.note_id,
        "content": content,
    }


@app.post("/chat")
async def chat(payload: ChatRequest, stream: bool = False):
    sources = await search_chunks(payload.question, payload.document_id, payload.note_id)
    context = "\n\n".join(
        f"[{index + 1}] {source['text']}" for index, source in enumerate(sources)
    )
    messages = [
        {"role": "system", "content": "你是 RAG 文档问答助手。请只根据给定上下文回答，不确定时说明缺少依据。"},
        {"role": "user", "content": f"问题：{payload.question}\n\n上下文：\n{context or '无可用上下文'}"},
    ]

    if stream:
        meta = {
            "type": "rag-chat",
            "documentId": payload.document_id,
            "noteId": payload.note_id,
            "question": payload.question,
            "sources": sources,
        }
        return StreamingResponse(
            make_sse_stream(messages, meta),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    answer = await call_model(messages)
    return {
        "type": "rag-chat",
        "documentId": payload.document_id,
        "noteId": payload.note_id,
        "question": payload.question,
        "answer": answer,
        "sources": sources,
    }
