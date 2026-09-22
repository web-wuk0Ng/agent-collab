"""FastAPI 应用入口。

启动：uvicorn agent_project.api.main:app --reload
"""

from fastapi import FastAPI

from agent_project import __version__
from agent_project.core.agent import BaseAgent

app = FastAPI(title="agent-collab", version=__version__)


# TODO: 团队分工——把 DemoAgent 替换为你们真正的 Agent 实现
class DemoAgent(BaseAgent):
    """占位实现：把输入原样回显，方便联调接口。"""

    def think(self, user_input: str) -> str:
        return f"你说的是：{user_input}"


agent = DemoAgent(name="demo-agent")


@app.get("/health")
def health() -> dict:
    """健康检查（CI 冒烟测试会用到）。"""
    return {"status": "ok", "version": __version__}


@app.post("/chat")
def chat(payload: dict) -> dict:
    """对话接口：{"message": "..."} -> {"reply": "..."}"""
    message = payload.get("message", "")
    reply = agent.run(message)
    return {"reply": reply}
