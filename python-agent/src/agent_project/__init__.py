"""agent_project - 面镜 MockMirror 的 AI 面试官 Agent 服务。

- ``core``       Agent 核心循环（``BaseAgent``）与大模型客户端
- ``agents``     具体 Agent 实现（``InterviewerAgent``）
- ``knowledge``  岗位知识库 / 题库加载与 BM25 检索（RAG）
- ``tools``      工具注册中心
- ``api``        FastAPI 接口层
"""

__version__ = "0.2.0"
