"""接口层测试（TestClient，全部走离线规则引擎，不发起真实网络请求）。"""

from __future__ import annotations

import os
from pathlib import Path

# 必须在导入应用之前隔离大模型配置，保证测试与外部服务解耦
os.environ["MM_LLM_CONFIG_FILE"] = str(Path(__file__).resolve().parent / "_no_such_config.json")
for _key in (
    "MM_LLM_API_KEY",
    "MM_LLM_BASE_URL",
    "MM_LLM_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
):
    os.environ.pop(_key, None)

from fastapi.testclient import TestClient  # noqa: E402

from agent_project.api.main import app  # noqa: E402

client = TestClient(app)

POSITION = "java-backend"
QUESTION = {
    "id": "jb-t1",
    "type": "tech",
    "text": "请你先简单介绍一下 HashMap 的底层实现原理，JDK 8 之后做了哪些改进？",
    "keywords": ["数组", "链表", "红黑树", "扩容"],
}
NEXT_QUESTION = {
    "id": "jb-t2",
    "type": "tech",
    "text": "线程池的核心参数有哪些？",
    "keywords": ["核心线程数", "队列", "拒绝策略"],
}


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["engine"] == "offline"


def test_ai_status_lists_knowledge_and_tools():
    resp = client.get("/ai/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["knowledge"]["positions"] >= 3
    assert "retrieve_knowledge" in body["tools"]
    assert "apiKey" not in str(body["llm"]) or body["llm"]["hasKey"] is False


def test_positions_and_tools():
    resp = client.get("/positions")
    assert resp.status_code == 200
    assert len(resp.json()["positions"]) >= 3

    tools = client.get("/tools").json()["tools"]
    names = {item["name"] for item in tools}
    assert {"echo", "retrieve_knowledge", "list_positions", "get_question"} <= names


def test_knowledge_search():
    resp = client.post(
        "/knowledge/search",
        json={"position": POSITION, "query": "HashMap 红黑树 扩容", "k": 3},
    )
    assert resp.status_code == 200
    hits = resp.json()["hits"]
    assert hits and hits[0]["score"] > 0


def test_interview_greeting():
    resp = client.post(
        "/interview/greeting",
        json={"position": POSITION, "question": QUESTION, "rounds": 6},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["engine"] == "offline"
    assert "Java 后端" in body["text"]


def test_interview_followup_and_next():
    follow = client.post(
        "/interview/followup",
        json={"position": POSITION, "question": QUESTION, "answer": "数组加链表。"},
    )
    assert follow.status_code == 200
    assert follow.json()["reply"]
    assert follow.json()["references"]

    nxt = client.post(
        "/interview/next",
        json={
            "position": POSITION,
            "question": QUESTION,
            "answer": "数组加链表加红黑树，负载因子 0.75 触发扩容。",
            "followCount": 1,
            "nextQuestion": NEXT_QUESTION,
        },
    )
    assert nxt.status_code == 200
    assert NEXT_QUESTION["text"] in nxt.json()["reply"]


def test_interview_report_with_video_metrics():
    resp = client.post(
        "/interview/report",
        json={
            "position": POSITION,
            "rounds": [{"question": QUESTION, "answer": "数组 + 链表 + 红黑树。", "metrics": None}],
            "videoMetrics": {
                "gazePct": 75,
                "steadyPct": 80,
                "presencePct": 96,
                "smilePct": 18,
                "samples": 30,
            },
        },
    )
    assert resp.status_code == 200
    report = resp.json()["report"]
    keys = [dim["key"] for dim in report["dimensions"]]
    assert keys == ["content", "depth", "logic", "match", "expression", "video"]


def test_unknown_position_returns_404():
    resp = client.post(
        "/interview/greeting",
        json={"position": "not-exist", "question": QUESTION},
    )
    assert resp.status_code == 404
