"""API 接口冒烟测试。"""

from fastapi.testclient import TestClient

from agent_project.api.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_chat():
    resp = client.post("/chat", json={"message": "hi"})
    assert resp.status_code == 200
    assert "reply" in resp.json()
