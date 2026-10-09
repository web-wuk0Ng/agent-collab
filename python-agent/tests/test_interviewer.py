"""InterviewerAgent 测试（离线规则引擎路径，不依赖网络）。"""

from __future__ import annotations

from agent_project.agents.interviewer import InterviewerAgent
from agent_project.core.llm import LLMClient, LLMConfig
from agent_project.knowledge.store import KnowledgeStore

QUESTION = {
    "id": "jb-t1",
    "type": "tech",
    "stage": "warm",
    "text": "请你先简单介绍一下 HashMap 的底层实现原理，JDK 8 之后做了哪些改进？",
    "keywords": ["数组", "链表", "红黑树", "哈希", "扩容"],
    "points": ["数组+链表+红黑树"],
}
NEXT_QUESTION = {
    "id": "jb-t2",
    "type": "tech",
    "stage": "core",
    "text": "线程池的核心参数有哪些？实际项目里你怎么设置？",
    "keywords": ["核心线程数", "队列", "拒绝策略"],
}
POSITION = "java-backend"


def make_agent() -> InterviewerAgent:
    """构造一个「未配置大模型」的 Agent，强制走离线规则引擎。"""
    return InterviewerAgent(store=KnowledgeStore(), client=LLMClient(LLMConfig()))


def test_engine_falls_back_to_offline_without_config():
    agent = make_agent()
    assert agent.engine == "offline"
    assert agent.client.configured is False


def test_greeting_mentions_position_name():
    agent = make_agent()
    reply = agent.greeting(POSITION, QUESTION, rounds=4)
    assert reply.engine == "offline"
    assert "Java 后端" in reply.text
    assert "4 个问题" in reply.text


def test_follow_up_on_short_answer_asks_for_detail():
    agent = make_agent()
    reply = agent.follow_up(POSITION, QUESTION, "数组加链表吧。")
    assert "展开" in reply.text
    assert reply.references, "追问应带上知识库检索到的考点标题"


def test_follow_up_points_at_missing_keyword():
    agent = make_agent()
    long_answer = "HashMap 内部是数组加链表的结构，通过哈希值定位下标，元素多了会扩容。"
    reply = agent.follow_up(POSITION, QUESTION, long_answer)
    assert "红黑树" in reply.text or "具体讲讲" in reply.text


def test_next_line_contains_next_question():
    agent = make_agent()
    reply = agent.next_line(
        POSITION, QUESTION, "哈希表，用数组存。", next_question=NEXT_QUESTION, follow_count=1
    )
    assert NEXT_QUESTION["text"] in reply.text


def test_next_line_wraps_up_on_last_question():
    agent = make_agent()
    reply = agent.next_line(POSITION, QUESTION, "答完了。", next_question=None)
    assert "评估报告" in reply.text


def test_llm_client_requires_config():
    client = LLMClient(LLMConfig())
    assert client.configured is False
    result = client.ping()
    assert result["ok"] is False
    assert "未配置" in result["error"]


def test_offline_report_structure():
    agent = make_agent()
    rounds = [
        {
            "question": QUESTION,
            "answer": "数组+链表+红黑树，扩容是 2 倍。",
            "metrics": {"wpm": 180, "fillers": 1},
        },
        {"question": NEXT_QUESTION, "answer": "", "metrics": None},
    ]
    report = agent.report(POSITION, rounds)
    assert report["engine"] == "offline"
    assert 0 <= report["overall"] <= 100
    keys = [dim["key"] for dim in report["dimensions"]]
    assert keys == ["content", "depth", "logic", "match", "expression"]
    assert len(report["perRound"]) == 2
    assert len(report["plan"]) == 3
    assert report["advice"] and report["resources"]


def test_offline_report_appends_video_dimension():
    agent = make_agent()
    rounds = [{"question": QUESTION, "answer": "数组加链表，还有红黑树。", "metrics": None}]
    video = {"gazePct": 80, "steadyPct": 70, "presencePct": 95, "smilePct": 20, "samples": 42}
    report = agent.report(POSITION, rounds, video_metrics=video)
    keys = [dim["key"] for dim in report["dimensions"]]
    assert keys[-1] == "video"
    video_dim = report["dimensions"][-1]
    assert video_dim["name"] == "仪态表现"
    assert 0 <= video_dim["score"] <= 100
    assert "采样 42 次" in video_dim["comment"]


def test_jd_questions_requires_llm():
    agent = make_agent()
    assert (
        agent.generate_jd_questions(
            "招聘 Java 后端工程师，要求熟悉 Spring Boot 与 MySQL……", POSITION
        )
        is None
    )
