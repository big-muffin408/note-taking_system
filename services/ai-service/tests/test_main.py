import os

# Ensure mock provider for tests
os.environ.setdefault("AI_PROVIDER", "mock")
os.environ.setdefault("PDF_PARSE_PROVIDER", "pymupdf")
os.environ.setdefault("CHROMA_PERSIST_DIR", "/tmp/test_chroma_data")

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


class TestHealthCheck:
    def test_health_status(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "provider" in data
        assert "model" in data

    def test_health_content_type(self):
        response = client.get("/health")
        assert "application/json" in response.headers["content-type"]


class TestSummary:
    def test_summary_with_text(self):
        response = client.post("/summary", json={"text": "This is a test document about AI."})
        assert response.status_code == 200
        data = response.json()
        assert "content" in data
        assert len(data["content"]) > 0

    def test_summary_returns_structured_response(self):
        response = client.post("/summary", json={"text": "Hello world."})
        data = response.json()
        assert data["type"] == "summary"
        assert "sources" in data

    def test_summary_stream(self):
        response = client.post("/summary?stream=true", json={"text": "Test text for streaming summary."})
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]


class TestPolish:
    def test_polish_with_text(self):
        response = client.post("/polish", json={"text": "This sentence have some grammar error."})
        assert response.status_code == 200
        data = response.json()
        assert "content" in data

    def test_polish_stream(self):
        response = client.post("/polish?stream=true", json={"text": "Polish this text."})
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]


class TestChat:
    def test_chat_with_question(self):
        response = client.post("/chat", json={"question": "What is AI?"})
        assert response.status_code == 200
        data = response.json()
        assert "answer" in data
        assert len(data["answer"]) > 0

    def test_chat_returns_structured_response(self):
        response = client.post("/chat", json={"question": "What is AI?"})
        data = response.json()
        assert data["type"] == "rag-chat"
        assert "sources" in data
        assert "question" in data

    def test_chat_stream(self):
        response = client.post("/chat?stream=true", json={"question": "Tell me about AI."})
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

    def test_chat_sources_include_preview(self):
        client.post("/documents/index", json={
            "text": "Alpha beta gamma is a source preview test document.",
            "markdown": "# Source Preview\nAlpha beta gamma.",
            "documentId": "preview-doc",
            "noteId": "preview-note",
            "sourceName": "preview.pdf"
        })
        response = client.post("/chat", json={
            "question": "What does alpha beta gamma describe?",
            "documentId": "preview-doc",
            "noteId": "preview-note",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["sources"]
        assert "textPreview" in data["sources"][0]


class TestDocumentsIndex:
    def test_index_document(self):
        response = client.post("/documents/index", json={
            "text": "This is a test document.",
            "markdown": "# Test\nThis is a test document.",
            "documentId": "test-doc-1",
            "noteId": "test-note-1",
            "sourceName": "test.md"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "indexed"

    def test_index_returns_chunk_count(self):
        response = client.post("/documents/index", json={"text": "Short text."})
        data = response.json()
        assert "chunks" in data


class TestServiceAuth:
    def test_protected_endpoint_without_secret(self):
        """When AI_SERVICE_SECRET is empty, endpoints are open (dev mode)."""
        response = client.post("/documents/index", json={
            "text": "test",
        })
        assert response.status_code == 200
