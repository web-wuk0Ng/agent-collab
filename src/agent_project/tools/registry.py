"""示例工具：演示工具注册协议。

新工具请照此模式编写，并到 tests/ 下补充对应测试。
"""

from collections.abc import Callable
from typing import Any

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


@register_tool(name="echo", description="原样返回输入文本，用于自检")
def echo(text: str) -> str:
    return text
