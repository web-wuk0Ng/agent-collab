"""工具注册中心：演示工具注册协议。

新增工具请照此模式编写，并到 ``tests/`` 下补充对应测试。
面试官 Agent 的「知识库检索能力」也在这里注册，便于后续扩展成完整的工具调用链路。
"""

from collections.abc import Callable
from typing import Any

from agent_project.knowledge.store import get_store

TOOL_REGISTRY: dict[str, dict[str, Any]] = {}


def register_tool(name: str, description: str) -> Callable:
    """工具注册装饰器。"""

    def decorator(func: Callable) -> Callable:
        TOOL_REGISTRY[name] = {
            "fn": func,
            "description": description,
        }
        return func

    return decorator


def call_tool(name: str, **kwargs: Any) -> Any:
    """按名字调用已注册的工具。"""
    tool = TOOL_REGISTRY.get(name)
    if tool is None:
        raise KeyError(f"未注册的工具：{name}")
    return tool["fn"](**kwargs)


def list_tools() -> list[dict[str, str]]:
    """列出全部可用工具（供 /tools 接口展示）。"""
    return [
        {"name": name, "description": item["description"]} for name, item in TOOL_REGISTRY.items()
    ]


@register_tool(name="echo", description="原样返回输入文本，用于自检")
def echo(text: str) -> str:
    return text


@register_tool(
    name="retrieve_knowledge",
    description="从岗位知识库检索与查询最相关的考点片段（RAG 检索增强）",
)
def retrieve_knowledge(position: str, query: str, k: int = 4) -> list[dict]:
    return get_store().search(position, query, k)


@register_tool(name="list_positions", description="列出当前可面试的岗位及其题库规模")
def list_positions() -> list[dict]:
    return get_store().positions()


@register_tool(name="get_question", description="按岗位与题目 ID 取出题库原题（含考察关键词）")
def get_question(position: str, question_id: str) -> dict | None:
    return get_store().question(position, question_id)
