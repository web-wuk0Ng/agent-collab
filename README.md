# 面镜 MockMirror · AI 模拟面试与能力提升软件

> 2026"数字马力杯"浙江省大学生服务外包创新应用大赛 · A11 赛题（锐捷网络）
> 团队：浙江师范大学「面镜 MockMirror」

本仓库由两部分组成，**第一部分是主交付物，克隆下来双击就能跑；第二部分是可选的 AI 增强服务**：

| # | 部分 | 位置 | 技术栈 | 是否必需 |
|---|---|---|---|---|
| ① | **面镜 MockMirror 面试系统**（岗位题库 / 视频面试 / 六维评估 / 管理中心） | 仓库根目录 | Node.js（零依赖） | ✅ 必需，开箱即用 |
| ② | **Python AI 面试官 Agent 服务**（面试官对话与评估引擎） | [`python-agent/`](python-agent/) | Python 3.11 + FastAPI | ⭕ 可选，增强项 |

---

## 🚀 三步跑起来（最简，无需 npm install）

**第 1 步：安装 [Node.js](https://nodejs.org/)（18 或以上，一路下一步即可）**

**第 2 步：下载项目**

```bash
git clone https://github.com/web-wuk0Ng/agent-collab.git
cd agent-collab
```

> 不想用 Git？在网页上点 **Code → Download ZIP**，解压后进入文件夹，效果一样。

**第 3 步：启动**

- **Windows**：双击 **`启动面试.bat`**
- **macOS / Linux**：终端执行 **`bash start.sh`**
- 或命令行：`node server.js`

浏览器会自动打开 **<http://localhost:3000>**（没自动打开就手动访问）。

> - 视频面试 / 语音作答建议用 **Chrome / Edge**，浏览器弹窗点「允许」即可
> - 语音识别双引擎，自动选择：Edge 用浏览器在线识别；**Chrome 自动切换到内置的本地识别引擎**（首次启动自动安装，约 50MB，装一次即可，断网也能用）。会前页可点「识别测试」一键验证
> - **本地识别引擎是"可选增强项"**：装不上也完全不影响使用（Edge 可用在线识别；Chrome 用户也可用文字之外的在线引擎兜底），启动脚本会自动判断——**装失败只会提示一句，绝不卡住启动**
> - 想跳过安装（例如内网/无网环境）：`npm run setup:skip`，或设置环境变量 `MOCKMIRROR_SKIP_ASR=1`
> - 想手动重装：`npm run setup`
> - 🔊 **面试官音色**：默认自动挑选系统中最自然的中文女声；会中底栏「设备」可切换音色与语速（0.8×~1.25×）并试听。若想获得神经网络级真人音色（Xiaoxiao / Yunxi），在 Windows 中：**Win+R → `ms-settings:speech` → 管理语音 → 添加语音**（下载中文语音后重启浏览器即可，程序会自动优先使用）。仓库也提供了可选的 **`安装中文语音包.bat`**（右键管理员运行）用于补齐系统语音能力包
> - 需要数据库吗？**不需要**。需要 `npm install` 吗？**不需要**（面试系统本体零第三方依赖；本地识别引擎由启动脚本自动下载到 `vendor/`，不入库，支持 Windows / macOS / Linux）
> - ⚠️ **AI 模拟面试必须先配置大模型**：首次进入会自动弹出「AI 设置」，填入 Base URL / API Key / 模型名并测试通过即可（支持 DeepSeek / 智谱 / 通义 / OpenAI 等 OpenAI 兼容接口，弹窗内可一键填入 DeepSeek 官方参数）。API Key **仅保存在本机** `data/config.local.json`（已被 Git 忽略，永不入库、永不上传）
> - 离线演示模式仅用于体验界面流程，不产生 AI 对话与评估

---

## 🔐 企业级特性

- **AI 接入门禁**：未配置大模型时，服务端直接拒绝开始面试（HTTP 428 + 引导），杜绝"看起来能 AI 实际是脚本"的假体验
- **密钥安全**：Key 只落本机、接口永不回传（仅 `hasKey` 布尔）、全 Git 历史可检索验证零泄露
- **数据库可靠性**：原子写（tmp+rename）· 写前 `.bak` 备份 · 启动损坏自愈 · 每日快照（保留 7 份）· Schema 版本迁移 · 内存索引 · 写合并
- **安全加固**：管理员口令加盐哈希存储 + 2 小时会话令牌 + 登录限流（5 次/10 分钟）· 操作审计（最近 200 条）· CORS 同源白名单 · 前端全量 HTML 转义
- **可观测性**：`GET /api/health` 一键查看 AI 引擎与数据库状态

## 🧪 测试

```bash
node test/llm-e2e.js java-backend 4   # AI 全流程实测（需已配置大模型）
node test/ai-safety.js                # AI 安全/边界实验：提示注入、幻觉、空回答
cd python-agent && python -m pytest   # Python Agent 回归（31 例）
```

详见 [docs/测试文档.md](docs/测试文档.md)（含提示注入 / 幻觉实验的真实执行记录：注入攻击下综合分 6 分、虚构技术被报告点名「使用虚构技术名词」）。

## 🤖 进阶：启动 Python AI 面试官 Agent（可选）

这个服务用仓库原有的 `BaseAgent` 骨架实现了一个真正的**面试官 Agent**：它自己完成「知识库检索 → 决定追问还是换题 → 评估打分」的思考链路，对外提供 FastAPI 接口。启动后可在网页里把 AI 引擎切换成它。

**方式一：一键启动（最省事）**

- **Windows**：双击 **`python-agent\启动PythonAgent.bat`**（首次会自动建虚拟环境并装依赖）
- **macOS / Linux**：`bash python-agent/start-agent.sh`

**方式二：手动三步**

```bash
cd python-agent

python -m venv .venv
source .venv/bin/activate          # macOS / Linux
.venv\Scripts\activate             # Windows

pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

打开 <http://127.0.0.1:8000/docs> 可以看到自动生成的接口文档。

然后回到面试系统网页：**右上角 ⚙ AI 设置 → AI 引擎选「Python 面试官 Agent」→ 点「测试连接」**，显示 ✅ 即打通。此时面试官的开场白、追问、评估报告全部由 Python Agent 生成。

> 只启动第 ① 部分也完全可用；两部分彼此独立，互不依赖。不配置任何大模型也能跑（两端都内置规则引擎兜底）。

---

## 📖 文档

| 文档 | 内容 |
|---|---|
| [docs/项目说明.md](docs/项目说明.md) | 完整功能清单、技术栈、AI 使用说明、API 一览、FAQ |
| [docs/测试文档.md](docs/测试文档.md) | 功能测试用例表、AI 安全边界实验（提示注入/幻觉）、数据可靠性实验、复现步骤 |
| [docs/演示视频脚本.md](docs/演示视频脚本.md) | 3–5 分钟原型演示分镜脚本（含录制检查清单） |
| [docs/团队协作指南.md](docs/团队协作指南.md) | 0 基础同学也能照抄的 Git 协作流程（分支模型 / PR / 急救包） |
| [docs/git-cheatsheet.md](docs/git-cheatsheet.md) | Git 常用命令速查表 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 团队协作规范（分支命名、提交信息规范、Code Review 要求） |
| [python-agent/](python-agent/) | Python Agent 服务源码与测试 |

---

## 🗂 目录结构

```
agent-collab/
├── 启动面试.bat / start.sh     # 一键启动脚本（Windows / macOS·Linux）
├── server.js                   # ① 面试系统服务入口（静态资源 + REST API）
├── lib/                        #   数据层 / 题库 / RAG / LLM / 面试流程控制
├── public/                     #   前端单页应用 + MediaPipe 本地视觉模型
├── data/                       #   岗位题库、知识库语料（运行时数据自动生成）
├── test/e2e.js                 #   Playwright 端到端测试
├── python-agent/               # ② Python AI 面试官 Agent 服务
│   ├── 启动PythonAgent.bat      #   一键启动（Windows）
│   ├── start-agent.sh          #   一键启动（macOS / Linux）
│   ├── src/agent_project/
│   │   ├── core/               #   BaseAgent 核心循环 + 大模型客户端
│   │   ├── agents/             #   InterviewerAgent（面试官 Agent 实现）
│   │   ├── knowledge/          #   知识库 / 题库加载与 BM25 检索（复用 ① 的语料）
│   │   ├── tools/              #   工具注册协议
│   │   └── api/                #   FastAPI 接口层
│   ├── tests/                  #   pytest 单元测试
│   └── pyproject.toml
├── docs/                       # 文档
└── .github/workflows/ci.yml    # CI：Node 语法检查 + Python lint/pytest
```

---

## 👥 团队分工

| 成员 | 角色 | 主要分工 |
|---|---|---|
| 王涛（队长） | 项目负责人 / 后端 | 系统架构、面试流程 API、LLM 服务层与 RAG 检索、Python Agent 服务 |
| 谭绍卿 | 前端开发 | 会议式面试房间交互、语音输入 / TTS 集成、报告与成长曲线可视化 |
| 夏艺凡 | 算法 / 数据 | 岗位题库设计、知识库编写、评估维度与评分规则 |
| 覃佳维 | 测试 / 文档 | 功能测试、AI 安全边界测试（提示注入）、测试文档 |
| 江帆帆 | 产品 / 运营 | 需求调研、原型设计、演示视频与答辩材料 |

## 📄 许可

[MIT](LICENSE)
