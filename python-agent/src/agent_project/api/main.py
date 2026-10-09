"""FastAPI 应用入口：面镜 MockMirror 的「AI 面试官 Agent」服务。

启动：

```bash
cd python-agent
uvicorn agent_project.api.main:app --reload --port 8000
```

接口文档：http://127.0.0.1:8000/docs

面试系统的 Node 服务在「AI 引擎 = Python Agent 服务」时会调用这里的
``/interview/greeting``、``/interview/followup``、``/interview/next``、
``/interview/report`` 四个接口，把面试官的「思考」交给本服务完成。
"""

from fastapi import FastAPI, HTTPException

from agent_project import __version__
from agent_project.agents.interviewer import InterviewerAgent
from agent_project.api.schemas import (
    ChatIn,
    FollowUpIn,
    GreetingIn,
    JdIn,
    KnowledgeSearchIn,
    NextIn,
    ReportIn,
)
from agent_project.core.llm import load_config
from agent_project.knowledge.store import get_store, reload_store
from agent_project.tools.registry import list_tools

app = FastAPI(
    title="MockMirror AI 面试官 Agent",
    description=(
        "面镜 MockMirror 的面试官 Agent 服务：知识库检索（RAG）+ 追问决策 + 多维度评估报告。"
        "与面试系统共享同一份 data/ 语料与 AI 配置。"
    ),
    version=__version__,
)

agent = InterviewerAgent()


# ======================================================================
# 基础信息
# ======================================================================


@app.get("/")
def index() -> dict:
    """服务简介与入口。"""
    return {
        "service": "MockMirror AI 面试官 Agent",
        "version": __version__,
        "docs": "/docs",
        "endpoints": [
            "/health",
            "/ai/status",
            "/positions",
            "/tools",
            "/knowledge/search",
            "/interview/greeting",
            "/interview/followup",
            "/interview/next",
            "/interview/report",
            "/interview/jd-questions",
        ],
    }


@app.get("/health")
def health() -> dict:
    """健康检查（CI 冒烟测试与 Node 端「测试连接」会用到）。"""
    return {
        "status": "ok",
        "version": __version__,
        "engine": "llm" if load_config().configured else "offline",
        "knowledge": get_store().stats(),
    }


@app.get("/ai/status")
def ai_status() -> dict:
    """大模型配置与知识库加载情况。"""
    config = load_config()
    return {
        "agent": agent.name,
        "engine": "llm" if config.configured else "offline",
        "llm": config.describe(),
        "knowledge": get_store().stats(),
        "tools": [tool["name"] for tool in list_tools()],
        "version": __version__,
    }


@app.get("/positions")
def positions() -> dict:
    """岗位列表（读取共享题库）。"""
    store = get_store()
    return {"positions": store.positions(), "dataDir": str(store.dir)}


@app.get("/tools")
def tools() -> dict:
    """已注册的工具清单。"""
    return {"tools": list_tools()}


@app.post("/knowledge/search")
def knowledge_search(payload: KnowledgeSearchIn) -> dict:
    """知识库检索（RAG 演示）：返回命中的考点片段与相关度得分。"""
    hits = get_store().search(payload.position, payload.query, payload.k)
    return {"hits": hits, "query": payload.query, "position": payload.position}


@app.post("/knowledge/reload")
def knowledge_reload() -> dict:
    """热加载语料（导入新题库后调用）。"""
    store = reload_store()
    return {"stats": store.stats()}


# ======================================================================
# 对话
# ======================================================================


@app.post("/chat")
def chat(payload: ChatIn) -> dict:
    """自由对话接口：{"message": "..."} -> {"reply": "..."}"""
    if payload.position:
        agent.position = payload.position
    return {"reply": agent.run(payload.message), "engine": agent.engine}


# ======================================================================
# 面试三大能力：开场 / 追问与过渡 / 评估
# ======================================================================


@app.post("/interview/greeting")
def interview_greeting(payload: GreetingIn) -> dict:
    """生成开场白并抛出第一道题。"""
    _require_bank(payload.position)
    reply = agent.greeting(payload.position, payload.question.model_dump(), payload.rounds)
    return {"text": reply.text, "engine": reply.engine, "references": reply.references}


@app.post("/interview/followup")
def interview_followup(payload: FollowUpIn) -> dict:
    """针对不充分的回答提出一个追问。"""
    _require_bank(payload.position)
    reply = agent.follow_up(
        payload.position,
        payload.question.model_dump(),
        payload.answer,
        payload.metrics,
    )
    return _reply(reply)


@app.post("/interview/next")
def interview_next(payload: NextIn) -> dict:
    """点评当前回答并过渡到下一题（``nextQuestion`` 为空表示收尾）。"""
    _require_bank(payload.position)
    reply = agent.next_line(
        payload.position,
        payload.question.model_dump(),
        payload.answer,
        payload.metrics,
        payload.follow_count,
        payload.next_question.model_dump() if payload.next_question else None,
    )
    return _reply(reply)


@app.post("/interview/report")
def interview_report(payload: ReportIn) -> dict:
    """生成多维度评估报告（六维含仪态表现）。"""
    _require_bank(payload.position)
    rounds = [item.model_dump() for item in payload.rounds]
    report = agent.report(payload.position, rounds, payload.video_metrics)
    return {"report": report}


@app.post("/interview/jd-questions")
def interview_jd_questions(payload: JdIn) -> dict:
    """按企业岗位 JD 定制面试题（需已配置大模型）。"""
    questions = agent.generate_jd_questions(payload.jd, payload.position)
    return {"questions": questions, "applied": bool(questions)}


# ======================================================================
# 内部工具
# ======================================================================


def _reply(reply) -> dict:
    return {"reply": reply.text, "engine": reply.engine, "references": reply.references}


def _require_bank(position: str) -> None:
    if not get_store().bank(position):
        raise HTTPException(status_code=404, detail=f"岗位不存在：{position}")
