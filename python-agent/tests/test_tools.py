"""工具注册协议测试。"""

from agent_project.tools.registry import TOOL_REGISTRY, echo


def test_echo_registered():
    assert "echo" in TOOL_REGISTRY


def test_echo_works():
    assert echo("abc") == "abc"
