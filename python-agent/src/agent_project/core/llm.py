"""OpenAI 兼容大模型客户端。

配置来源（优先级从高到低）：

1. 环境变量 ``MM_LLM_BASE_URL`` / ``MM_LLM_API_KEY`` / ``MM_LLM_MODEL``
   （同时兼容标准的 ``OPENAI_BASE_URL`` / ``OPENAI_API_KEY`` / ``OPENAI_MODEL``）
2. 与 Node 面试系统**共享**的本地配置文件 ``data/config.local.json``
   —— 也就是网页右上角「⚙ AI 设置」保存的那份，两边共用一套配置

未配置时不会抛错到业务层：面试官 Agent 会自动降级为规则引擎（离线可用）。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import httpx

# 仓库根目录：<repo>/python-agent/src/agent_project/core/llm.py
REPO_ROOT = Path(__file__).resolve().parents[4]
SHARED_CONFIG_FILE = Path(
    os.getenv("MM_LLM_CONFIG_FILE") or (REPO_ROOT / "data" / "config.local.json")
)


@dataclass
class LLMConfig:
    """大模型接入配置。"""

    base_url: str = ""
    api_key: str = ""
    model: str = ""

    @property
    def configured(self) -> bool:
        """是否已具备可用配置（base_url + model）。"""
        return bool(self.base_url and self.model)

    def describe(self) -> dict:
        """对外描述（**绝不返回 api_key**）。"""
        return {
            "configured": self.configured,
            "baseUrl": self.base_url,
            "model": self.model,
            "hasKey": bool(self.api_key),
            "source": str(SHARED_CONFIG_FILE),
        }


class LLMNotConfigured(RuntimeError):
    """未配置大模型时抛出，调用方负责降级。"""

    def __init__(self) -> None:
        super().__init__("LLM_NOT_CONFIGURED")


def _env(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    return ""


def load_config() -> LLMConfig:
    """读取配置：共享配置文件打底，环境变量覆盖。"""
    config = LLMConfig()

    try:
        raw = json.loads(SHARED_CONFIG_FILE.read_text(encoding="utf-8"))
        config.base_url = str(raw.get("baseUrl") or "").strip()
        config.api_key = str(raw.get("apiKey") or "").strip()
        config.model = str(raw.get("model") or "").strip()
    except (OSError, ValueError):
        pass

    config.base_url = (_env("MM_LLM_BASE_URL", "OPENAI_BASE_URL") or config.base_url).rstrip("/")
    config.api_key = _env("MM_LLM_API_KEY", "OPENAI_API_KEY") or config.api_key
    config.model = _env("MM_LLM_MODEL", "OPENAI_MODEL") or config.model
    return config


class LLMClient:
    """极简 OpenAI 兼容客户端（chat/completions）。"""

    def __init__(self, config: LLMConfig | None = None, timeout: float = 60.0) -> None:
        self.config = config or load_config()
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return self.config.configured

    def chat(
        self,
        messages: list[dict],
        temperature: float = 0.6,
        max_tokens: int = 1200,
        json_mode: bool = False,
    ) -> str:
        """发起一次对话补全，返回文本内容。"""
        config = self.config
        if not config.configured:
            raise LLMNotConfigured

        headers = {"Content-Type": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"
        body: dict = {
            "model": config.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(
                f"{config.base_url}/chat/completions", headers=headers, json=body
            )
        if response.status_code >= 400:
            raise RuntimeError(f"LLM {response.status_code}: {response.text[:300]}")

        choices = response.json().get("choices") or []
        if not choices:
            return ""
        return str((choices[0].get("message") or {}).get("content") or "").strip()

    def ping(self) -> dict:
        """连通性测试，供 /ai/status 与网页「测试连接」使用。"""
        if not self.configured:
            return {
                "ok": False,
                "error": (
                    "未配置大模型：可在网页「AI 设置」填写，"
                    "或设置环境变量 MM_LLM_BASE_URL / MM_LLM_API_KEY / MM_LLM_MODEL"
                ),
            }
        try:
            reply = self.chat(
                [{"role": "user", "content": "请只回复两个字：正常"}],
                temperature=0,
                max_tokens=10,
            )
            return {"ok": True, "reply": reply[:50], "model": self.config.model}
        except Exception as exc:  # noqa: BLE001 - 连通性测试需要吞掉所有异常
            return {"ok": False, "error": str(exc)}


def parse_json_loose(text: str) -> dict | None:
    """容错解析大模型输出的 JSON（剥离 markdown 代码围栏、前后废话）。"""
    if not text:
        return None
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except ValueError:
        pass

    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start : end + 1])
            return data if isinstance(data, dict) else None
        except ValueError:
            return None
    return None
