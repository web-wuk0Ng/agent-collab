"""测试全局夹具：在任何测试模块导入应用之前，隔离大模型配置。

pytest 会先加载本文件再收集测试模块，因此这里的环境变量设置
保证 core.llm 的配置路径指向不存在的文件、密钥类环境变量清空，
测试永远走离线规则引擎，不发起真实网络请求，也不依赖开发机上的
data/config.local.json（其中可能保存了真实 API Key）。
"""

from __future__ import annotations

import os
from pathlib import Path

os.environ["MM_LLM_CONFIG_FILE"] = str(Path(__file__).resolve().parent / "_no_such_config.json")
for _key in (
    "MM_LLM_API_KEY",
    "MM_LLM_BASE_URL",
    "MM_LLM_MODEL",
    "MM_LLM_ENGINE",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
):
    os.environ.pop(_key, None)
