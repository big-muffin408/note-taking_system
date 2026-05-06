import asyncio
import base64
import hashlib
import html
import json
import math
import mimetypes
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from os import getenv
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

try:
    import markdown as markdown_lib
except ImportError:
    markdown_lib = None

try:
    import fitz
except ImportError:
    fitz = None

ALLOWED_ORIGINS = [
    o.strip()
    for o in getenv("ALLOWED_ORIGINS", "http://localhost,http://localhost:5173,http://localhost:80").split(",")
    if o.strip()
]

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AI Service", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AI_SERVICE_SECRET = getenv("AI_SERVICE_SECRET", "")
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB

# Reusable async HTTP client (created once, reused across requests)
_http_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=60, trust_env=False)
    return _http_client


@app.on_event("shutdown")
async def shutdown_http_client():
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()

VECTOR_SIZE = 128
QDRANT_COLLECTION = getenv("QDRANT_COLLECTION", "note_chunks")
QDRANT_URL = getenv("QDRANT_URL", "http://localhost:6333").rstrip("/")
PDF_PARSE_PROVIDER = getenv("PDF_PARSE_PROVIDER", "mineru").lower()
MINERU_COMMAND = getenv("MINERU_COMMAND", "mineru")
MINERU_BACKEND = getenv("MINERU_BACKEND", "pipeline")
MINERU_LANGUAGE = getenv("MINERU_LANGUAGE", "").strip()
MINERU_TIMEOUT_SECONDS = int(getenv("MINERU_TIMEOUT_SECONDS", "600"))
MINERU_API_URL = getenv("MINERU_API_URL", "").rstrip("/")


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


def verify_service_auth(request: Request) -> None:
    """Verify that the request comes from an authorized internal service."""
    if not AI_SERVICE_SECRET:
        return  # No secret configured = open access (dev mode)
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer ") and auth_header[7:] == AI_SERVICE_SECRET:
        return
    raise HTTPException(status_code=403, detail="Unauthorized: invalid service credentials")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def provider_name() -> str:
    return getenv("AI_PROVIDER", "mock").lower()


def ai_model_name(provider: str) -> str:
    configured_model = getenv("AI_MODEL", "").strip()
    if configured_model:
        return configured_model
    if provider == "xiaomi":
        return "mimo-v2.5-pro"
    if provider == "openai":
        return "gpt-4o-mini"
    if provider == "deepseek":
        return "deepseek-chat"
    return "mock-model"


def ai_base_url(provider: str) -> str:
    configured_base_url = getenv("AI_BASE_URL", "").strip()
    if configured_base_url:
        return configured_base_url.rstrip("/")
    if provider == "deepseek":
        return "https://api.deepseek.com"
    if provider == "openai":
        return "https://api.openai.com/v1"
    if provider == "xiaomi":
        return "https://token-plan-cn.xiaomimimo.com/v1"
    raise HTTPException(status_code=400, detail=f"Unsupported AI_PROVIDER: {provider}")


def normalize_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def markdown_to_html(markdown: str) -> str:
    if markdown_lib:
        try:
            return markdown_lib.markdown(
                markdown,
                extensions=["extra", "sane_lists"],
                output_format="html5",
            )
        except Exception:
            pass

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


def choose_mineru_markdown(output_dir: Path) -> Path:
    markdown_files = [
        path for path in output_dir.rglob("*.md")
        if path.is_file() and not path.name.startswith(".")
    ]

    if not markdown_files:
        raise RuntimeError("MinerU did not produce a Markdown file.")

    return max(markdown_files, key=lambda path: path.stat().st_size)


def markdown_to_plain_text(markdown: str) -> str:
    text = re.sub(r"!\[[^\]]*]\([^)]+\)", " ", markdown)
    text = re.sub(r"\[([^\]]+)]\([^)]+\)", r"\1", text)
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)
    text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.M)
    text = re.sub(r"[*_~|]", " ", text)
    return normalize_text(text)


def count_pages_from_mineru_value(value: Any) -> int:
    if isinstance(value, dict):
        for key in ("pdf_info", "page_info", "pages"):
            candidate = value.get(key)
            if isinstance(candidate, list):
                return len(candidate)
            if isinstance(candidate, int):
                return candidate

        page_indexes = [
            item.get("page_idx")
            for item in value.get("content_list", [])
            if isinstance(item, dict) and isinstance(item.get("page_idx"), int)
        ]
        if page_indexes:
            return max(page_indexes) + 1

        return max((count_pages_from_mineru_value(item) for item in value.values()), default=0)

    if isinstance(value, list):
        page_indexes = [
            item.get("page_idx")
            for item in value
            if isinstance(item, dict) and isinstance(item.get("page_idx"), int)
        ]
        if page_indexes:
            return max(page_indexes) + 1

        return max((count_pages_from_mineru_value(item) for item in value), default=0)

    return 0


def count_pages_from_mineru_output(output_dir: Path) -> int:
    for json_path in output_dir.rglob("*.json"):
        try:
            payload = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        pages = count_pages_from_mineru_value(payload)
        if pages:
            return pages

    return 0


def is_supported_image_path(path: Path) -> bool:
    return path.suffix.lower() in {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".bmp",
        ".tif",
        ".tiff",
        ".svg",
    }


def make_image_asset(path: str, data: bytes) -> dict[str, Any]:
    mime_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return {
        "path": path.replace("\\", "/"),
        "mimeType": mime_type,
        "dataBase64": base64.b64encode(data).decode("ascii"),
    }


def collect_mineru_image_assets(output_dir: Path, markdown_path: Path) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    seen: set[str] = set()
    search_roots = [markdown_path.parent, output_dir]

    for root in search_roots:
        for image_path in root.rglob("*"):
            if not image_path.is_file() or not is_supported_image_path(image_path):
                continue

            relative_to_markdown = image_path.relative_to(markdown_path.parent).as_posix()
            if relative_to_markdown in seen:
                continue

            seen.add(relative_to_markdown)
            assets.append(make_image_asset(relative_to_markdown, image_path.read_bytes()))

    return assets


def decode_mineru_image_value(value: Any) -> bytes | None:
    if isinstance(value, bytes):
        return value
    if not isinstance(value, str) or not value:
        return None

    _, _, candidate = value.partition(",") if value.startswith("data:") else ("", "", value)
    try:
        return base64.b64decode(candidate, validate=True)
    except Exception:
        return None


def extract_mineru_api_image_assets(value: Any) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add_asset(path: str, image_value: Any) -> None:
        normalized_path = path.replace("\\", "/").lstrip("./")
        if not normalized_path or normalized_path in seen:
            return
        image_bytes = decode_mineru_image_value(image_value)
        if image_bytes is None:
            return
        seen.add(normalized_path)
        assets.append(make_image_asset(normalized_path, image_bytes))

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key in ("images", "image", "imgs"):
                candidate = node.get(key)
                if isinstance(candidate, dict):
                    for path, image_value in candidate.items():
                        add_asset(str(path), image_value)
                elif isinstance(candidate, list):
                    for item in candidate:
                        if isinstance(item, dict):
                            path = item.get("path") or item.get("name") or item.get("filename") or item.get("img_path")
                            image_value = item.get("data") or item.get("base64") or item.get("image") or item.get("content")
                            if path and image_value:
                                add_asset(str(path), image_value)

            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(value)
    return assets


async def parse_pdf_with_mineru(data: bytes, filename: str) -> dict[str, Any]:
    if MINERU_API_URL:
        return await parse_pdf_with_mineru_api(data, filename)

    if not shutil.which(MINERU_COMMAND):
        return parse_pdf_with_pymupdf(data, filename)

    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", filename or "document.pdf")
    if not safe_name.lower().endswith(".pdf"):
        safe_name = f"{safe_name}.pdf"

    with tempfile.TemporaryDirectory(prefix="mineru-parse-") as temp_root:
        temp_path = Path(temp_root)
        input_path = temp_path / safe_name
        output_path = temp_path / "output"
        input_path.write_bytes(data)
        output_path.mkdir(parents=True, exist_ok=True)

        command = [
            MINERU_COMMAND,
            "-p",
            str(input_path),
            "-o",
            str(output_path),
            "-b",
            MINERU_BACKEND,
        ]
        if MINERU_LANGUAGE:
            command.extend(["-l", MINERU_LANGUAGE])

        proc = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=MINERU_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError("MinerU parse timed out")

        if proc.returncode != 0:
            detail = (stderr.decode() or stdout.decode() or "").strip()
            raise RuntimeError(f"MinerU parse failed: {detail[:2000]}")

        markdown_path = choose_mineru_markdown(output_path)
        markdown = markdown_path.read_text(encoding="utf-8")
        text = markdown_to_plain_text(markdown)
        pages = count_pages_from_mineru_output(output_path)
        assets = collect_mineru_image_assets(output_path, markdown_path)

    return {
        "parser": "mineru",
        "pages": pages,
        "text": text,
        "markdown": markdown,
        "assets": assets,
    }


async def parse_pdf_with_mineru_api(data: bytes, filename: str) -> dict[str, Any]:
    file_stem = Path(filename or "document.pdf").stem
    lang = MINERU_LANGUAGE or "ch"
    form_data = {
        "lang_list": lang,
        "backend": MINERU_BACKEND,
        "parse_method": "auto",
        "formula_enable": "true",
        "table_enable": "true",
        "return_md": "true",
        "return_middle_json": "true",
        "return_model_output": "false",
        "return_content_list": "false",
        "return_images": "true",
        "response_format_zip": "false",
        "return_original_file": "false",
    }

    try:
        client = get_http_client()
        response = await client.post(
            f"{MINERU_API_URL}/file_parse",
            data=form_data,
            files={
                "files": (
                    filename or "document.pdf",
                    data,
                    "application/pdf",
                )
            },
            timeout=MINERU_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise RuntimeError(f"MinerU API parse failed: {error}") from error

    payload = response.json()
    results = payload.get("results") or {}
    candidates = [
        results.get(file_stem),
        results.get(filename),
        *results.values(),
    ]
    markdown = ""
    pages = 0
    selected_candidate: dict[str, Any] | None = None
    for candidate in candidates:
        if isinstance(candidate, dict) and candidate.get("md_content"):
            markdown = candidate["md_content"]
            pages = count_pages_from_mineru_value(candidate)
            selected_candidate = candidate
            break

    if not markdown:
        raise RuntimeError("MinerU API did not return md_content.")

    assets = extract_mineru_api_image_assets(selected_candidate or payload)

    return {
        "parser": "mineru-api",
        "pages": pages or count_pages_from_mineru_value(payload),
        "text": markdown_to_plain_text(markdown),
        "markdown": markdown,
        "assets": assets,
    }


def parse_pdf_with_pymupdf(data: bytes, filename: str) -> dict[str, Any]:
    if fitz is None:
        raise RuntimeError(
            f"MinerU command '{MINERU_COMMAND}' was not found and PyMuPDF is not installed. "
            "Install PyMuPDF, set MINERU_API_URL to a running mineru-api service, "
            "install MinerU, or set MINERU_COMMAND."
        )

    try:
        document = fitz.open(stream=data, filetype="pdf")
    except Exception as error:
        raise RuntimeError(f"PyMuPDF failed to open PDF: {error}") from error

    try:
        markdown_parts: list[str] = []
        text_parts: list[str] = []
        page_count = document.page_count
        metadata = document.metadata or {}
        title = normalize_text(metadata.get("title") or "") or Path(filename or "PDF 笔记").stem
        if title:
            markdown_parts.append(f"# {title}")

        for page_index, page in enumerate(document, start=1):
            page_text = normalize_text(page.get_text("text"))
            if not page_text:
                continue

            markdown_parts.append(f"## 第 {page_index} 页\n\n{page_text}")
            text_parts.append(page_text)
    finally:
        document.close()

    text = normalize_text("\n\n".join(text_parts))
    markdown = "\n\n".join(markdown_parts).strip()
    if not markdown:
        markdown = "# PDF 笔记\n\n未能从该 PDF 中提取到可用文本。"

    return {
        "parser": "pymupdf",
        "pages": page_count,
        "text": text,
        "markdown": markdown,
        "assets": [],
    }


async def parse_pdf_document(data: bytes, filename: str) -> dict[str, Any]:
    if PDF_PARSE_PROVIDER == "mineru":
        return await parse_pdf_with_mineru(data, filename)
    if PDF_PARSE_PROVIDER == "pymupdf":
        return parse_pdf_with_pymupdf(data, filename)

    raise HTTPException(status_code=400, detail="PDF_PARSE_PROVIDER must be mineru or pymupdf.")


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
    model = ai_model_name(provider)

    if provider == "mock" or not api_key:
        content = messages[-1]["content"]
        return f"Mock AI response: {content[:500]}"

    base_url = ai_base_url(provider)

    try:
        client = get_http_client()
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": messages, "temperature": 0.2},
            timeout=30,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        raise HTTPException(status_code=502, detail=f"AI provider returned {error.response.status_code}") from error
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"AI provider connection failed") from error

    try:
        data = response.json()
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise HTTPException(status_code=502, detail="AI provider returned unexpected response format") from error


async def stream_model(messages: list[dict[str, str]]) -> AsyncGenerator[str, None]:
    """Yield text chunks via SSE. For mock provider, simulate character-by-character output."""
    provider = provider_name()
    api_key = getenv("AI_API_KEY", "")
    model = ai_model_name(provider)

    if provider == "mock" or not api_key:
        content = messages[-1]["content"]
        mock_reply = f"Mock AI response: {content[:200]}"
        for char in mock_reply:
            yield char
        return

    base_url = ai_base_url(provider)

    try:
        client = get_http_client()
        async with client.stream(
            "POST",
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": messages, "temperature": 0.2, "stream": True},
            timeout=60,
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
    except httpx.HTTPStatusError as error:
        yield f"\n[错误: AI 服务返回 {error.response.status_code}]"
        return
    except httpx.HTTPError:
        yield "\n[错误: AI 服务连接失败]"
        return


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
        "model": ai_model_name(provider_name()),
        "pdfParseProvider": PDF_PARSE_PROVIDER,
        "mineruBackend": MINERU_BACKEND,
        "qdrantCollection": QDRANT_COLLECTION,
        "timestamp": now_iso(),
    }


@app.post("/pdf/parse")
async def parse_pdf(
    request: Request,
    file: UploadFile = File(...),
    document_id: Optional[str] = Form(default=None, alias="documentId"),
    note_id: Optional[str] = Form(default=None, alias="noteId"),
):
    verify_service_auth(request)
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    data = await file.read()
    try:
        parsed = await parse_pdf_document(data, file.filename or "PDF 笔记")
    except RuntimeError as error:
        if "timed out" in str(error).lower():
            raise HTTPException(status_code=504, detail="MinerU 解析超时") from error
        raise HTTPException(status_code=500, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    text = parsed["text"]
    markdown = parsed["markdown"]
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
        "parser": parsed["parser"],
        "pages": parsed["pages"],
        "wordCount": len(re.findall(r"[\w\u4e00-\u9fff]+", text)),
        "status": f"parsed:{parsed['parser']}",
        "text": text,
        "markdownDraft": markdown,
        "htmlDraft": html_draft,
        "chunks": len(chunks),
        "assets": parsed.get("assets", []),
    }


@app.post("/documents/index")
async def index_document(request: Request, payload: IndexRequest):
    verify_service_auth(request)
    chunks = await index_chunks(
        payload.text,
        markdown=payload.markdown,
        document_id=payload.document_id,
        note_id=payload.note_id,
        source_name=payload.source_name,
    )
    return {"status": "indexed", "chunks": len(chunks)}


@app.post("/summary")
async def summarize(request: Request, payload: TextRequest, stream: bool = False):
    verify_service_auth(request)
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
async def polish(request: Request, payload: TextRequest, stream: bool = False):
    verify_service_auth(request)
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
async def chat(request: Request, payload: ChatRequest, stream: bool = False):
    verify_service_auth(request)
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
