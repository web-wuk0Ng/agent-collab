# python-agent · AI 面试官 Agent 服务

> 面镜 MockMirror 的「面试官大脑」：用本仓库的 `BaseAgent` 骨架实现，FastAPI 对外提供接口。
> 它与根目录的 Node 面试系统**共享同一份语料**（`../data/questions`、`../data/knowledge`）
> 和**同一份 AI 配置**（`../data/config.local.json`，即网页「AI 设置」保存的那个文件）。

## 它做什么

| 能力 | 说明 | 接口 |
|---|---|---|
| 知识库检索（RAG） | BM25 检索岗位考点片段，为追问与评估提供事实依据 | `POST /knowledge/search` |
| 开场白 | 结合岗位与第一道题生成自然的开场 | `POST /interview/greeting` |
| 追问 | 回答含糊/过短时，聚焦缺口提一个追问 | `POST /interview/followup` |
| 点评过渡 | 一句点评 + 抛出下一题（最后一题则收尾） | `POST /interview/next` |
| 评估报告 | 五维评分 + 逐题点评 + 三周提升计划（视频面试另加「仪态表现」维度） | `POST /interview/report` |
| JD 定制出题 | 按企业招聘描述生成专属面试题 | `POST /interview/jd-questions` |
| 自由问答 | `BaseAgent.run()` 驱动的通用对话 | `POST /chat` |

> 未配置大模型时，全部能力自动降级为**规则引擎**（离线可用），面试流程不会中断。

## 快速开始

```bash
cd python-agent

python -m venv .venv
source .venv/bin/activate      # macOS / Linux
.venv\Scripts\activate         # Windows

pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

- 接口文档：<http://127.0.0.1:8000/docs>
- 健康检查：<http://127.0.0.1:8000/health>
- 在网页右上角「⚙ AI 设置」把 **AI 引擎** 切换为「Python 面试官 Agent」并「测试连接」即可打通。

## 接入大模型

两种方式（环境变量优先）：

```bash
# 方式一：环境变量
export MM_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
export MM_LLM_API_KEY=你的key
export MM_LLM_MODEL=glm-4-flash
```

方式二：直接在网页「AI 设置」里填（写入 `../data/config.local.json`，两端共用）。
也可用 `MM_LLM_CONFIG_FILE` 指定其它配置文件，用 `MM_DATA_DIR` 指定语料目录。

## 目录结构

```
python-agent/
├── src/agent_project/
│   ├── core/agent.py          # BaseAgent 核心循环（团队共用骨架）
│   ├── core/llm.py            # OpenAI 兼容客户端 + 配置读取 + 容错 JSON 解析
│   ├── agents/interviewer.py  # InterviewerAgent：检索 → 决策 → 评估
│   ├── knowledge/store.py     # 题库/知识库加载 + BM25 检索（与 Node 端一致）
│   ├── tools/registry.py      # 工具注册中心（echo / retrieve_knowledge / …）
│   └── api/main.py            # FastAPI 接口层
├── tests/                     # pytest（含接口冒烟测试）
├── requirements*.txt
└── pyproject.toml
```

## 测试

```bash
pytest -v
ruff check src tests && ruff format --check src tests
```
