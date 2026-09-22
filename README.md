# agent-collab

> 3-5 人小团队协作开发的 Python Agent 项目（软件项目实训）

## 项目简介

基于 Python 的 Agent 项目，从零搭建，使用标准 Git 协作流程开发。

## 技术栈

- **语言**: Python 3.11+
- **框架**: FastAPI（Agent 服务接口）
- **测试**: pytest
- **代码规范**: ruff（lint + format）

## 快速开始

```bash
# 1. 克隆仓库
git clone <repo-url>
cd agent-collab

# 2. 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# 3. 安装依赖
pip install -r requirements.txt -r requirements-dev.txt

# 4. 运行测试
pytest

# 5. 启动开发服务
uvicorn agent_project.api.main:app --reload
```

## 项目结构

```
.
├── src/
│   └── agent_project/      # 主包
│       ├── core/           # Agent 核心逻辑
│       ├── tools/          # Agent 工具集
│       └── api/            # FastAPI 接口层
├── tests/                  # 测试
├── docs/                   # 项目文档
├── .github/                # CI / 协作规范
├── pyproject.toml          # 项目配置（依赖、工具链）
└── CONTRIBUTING.md         # 协作指南（必读）
```

## 协作流程（摘要）

1. 从 `main` 拉出 feature 分支：`git checkout -b feat/你的功能名`
2. 开发 + 提交（使用 Conventional Commits，如 `feat: xxx`）
3. 推送并发起 Pull Request
4. 至少 1 名队友 review 通过后合并
5. 严禁直接 push 到 `main`

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。
