"""Agent 核心循环（骨架）。

协作提示：这是核心模块，改动请在 PR 中说明设计意图，并让熟悉此模块的队友 review。
"""

from dataclasses import dataclass, field


@dataclass
class Message:
    """一条对话消息。"""

    role: str  # "user" / "assistant" / "system" / "tool"
    content: str


@dataclass
class AgentState:
    """Agent 运行时状态，包含对话历史。"""

    history: list[Message] = field(default_factory=list)

    def add(self, role: str, content: str) -> None:
        self.history.append(Message(role=role, content=content))


class BaseAgent:
    """所有 Agent 的基类。

    子类需实现 think() 方法。核心循环：接收输入 -> 思考（可调用工具）-> 产出回复。
    """

    name: str = "base-agent"

    def __init__(self, name: str | None = None) -> None:
        if name:
            self.name = name
        self.state = AgentState()

    def run(self, user_input: str) -> str:
        """执行一轮对话。"""
        self.state.add("user", user_input)
        reply = self.think(user_input)
        self.state.add("assistant", reply)
        return reply

    def think(self, user_input: str) -> str:
        """子类实现：决定如何回应用户输入。"""
        raise NotImplementedError
