import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

# 创建一个简单的FastAPI应用用于测试
app = FastAPI()

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ai-service"}

client = TestClient(app)

class TestHealthCheck:
    def test_health_status(self):
        """测试健康检查接口返回状态"""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "ai-service"}

    def test_health_content_type(self):
        """测试健康检查接口返回JSON格式"""
        response = client.get("/health")
        assert response.headers["content-type"] == "application/json"
