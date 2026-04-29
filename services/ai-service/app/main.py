from datetime import datetime, timezone
from os import getenv
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="AI Service", version="0.1.0")


class TextRequest(BaseModel):
    text: str = Field(default="", description="Input text for AI processing.")
    document_id: Optional[str] = Field(default=None, alias="documentId")


class ChatRequest(BaseModel):
    question: str = Field(default="", description="Question for RAG chat.")
    document_id: Optional[str] = Field(default=None, alias="documentId")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/health")
def health():
    return {
        "service": "ai-service",
        "status": "ok",
        "provider": getenv("AI_PROVIDER", "mock"),
        "model": getenv("AI_MODEL", "mock-model"),
        "timestamp": now_iso(),
    }


@app.post("/summary")
def summarize(payload: TextRequest):
    preview = payload.text[:120] if payload.text else "这里将接入全文或选区摘要。"
    return {
        "type": "summary",
        "documentId": payload.document_id,
        "content": f"Mock summary: {preview}",
        "streaming": False,
    }


@app.post("/polish")
def polish(payload: TextRequest):
    return {
        "type": "polish",
        "documentId": payload.document_id,
        "content": payload.text or "这里将返回润色后的文本。",
        "message": "Mock polish response. Real AI provider integration is planned for a later iteration.",
    }


@app.post("/chat")
def chat(payload: ChatRequest):
    return {
        "type": "rag-chat",
        "documentId": payload.document_id,
        "question": payload.question,
        "answer": "Mock RAG answer. LlamaIndex and Qdrant retrieval will be wired in the next AI iteration.",
        "sources": [],
    }
