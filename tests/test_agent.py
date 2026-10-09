"""核心模块测试：BaseAgent 基础行为。"""

import pytest

from agent_project.core.agent import BaseAgent


class EchoAgent(BaseAgent):
    def think(self, user_input: str) -> str:
        return f"echo: {user_input}"


def test_agent_replies():
    agent = EchoAgent()
    assert agent.run("hello") == "echo: hello"


def test_agent_records_history():
    agent = EchoAgent()
    agent.run("hi")
    assert len(agent.state.history) == 2
    assert agent.state.history[0].role == "user"
    assert agent.state.history[1].role == "assistant"


def test_base_agent_think_not_implemented():
    with pytest.raises(NotImplementedError):
        BaseAgent().run("x")
