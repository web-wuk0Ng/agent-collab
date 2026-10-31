# 面镜 MockMirror · AI 模拟面试与能力提升软件

> 2026"数字马力杯"浙江省大学生服务外包创新应用大赛 · A11 赛题（锐捷网络）
> 团队：浙江师范大学「面镜 MockMirror」

本仓库由两部分组成，**第一部分是主交付物，克隆下来双击就能跑；第二部分是可选的 AI 增强服务**：

| # | 部分 | 位置 | 技术栈 | 是否必需 |
|---|---|---|---|---|
| ① | **面镜 MockMirror 面试系统**（岗位题库 / 视频面试 / 六维评估 / 个人成长记录） | 仓库根目录 | Node.js（零依赖） | ✅ 必需，开箱即用 |
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
> - 语音识别双引擎，自动选择：Edge 用浏览器在线识别；**Chrome 自动切换到内置的本地识别引擎**（首次启动自动安装，双语约 190MB，加精识别约 230MB，装一次即可，断网也能用）。会前页可点「识别测试」一键验证
> - **本地识别引擎是"可选增强项"**：装不上也完全不影响使用（Edge 可用在线识别；Chrome 用户也可用文字之外的在线引擎兜底），启动脚本会自动判断——**装失败只会提示一句，绝不卡住启动**
> - 想跳过安装（例如内网/无网环境）：`npm run setup:skip`，或设置环境变量 `MOCKMIRROR_SKIP_ASR=1`
> - 想手动重装：`npm run setup`
> - 🔊 **面试官音色**：默认自动挑选系统中最自然的中文女声；会中底栏「设备」可调整语速（0.8×~1.25×）并试听，整场保持同一音色。若想获得神经网络级真人音色（Xiaoxiao），在 Windows 中：**Win+R → `ms-settings:speech` → 管理语音 → 添加语音**（下载中文语音后重启浏览器即可，程序会自动优先使用）。仓库也提供了可选的 **`安装中文语音包.bat`**（右键管理员运行）用于补齐系统语音能力包
> - 需要数据库吗？**不需要**。需要 `npm install` 吗？**不需要**（面试系统本体零第三方依赖；本地识别引擎由启动脚本自动下载到 `vendor/`，不入库，支持 Windows / macOS / Linux）
> - ⚠️ **AI 模拟面试必须先配置大模型**：首次进入会自动弹出「AI 设置」，填入 Base URL / API Key / 模型名并测试通过即可（支持 DeepSeek / 智谱 / 通义 / OpenAI 等 OpenAI 兼容接口，弹窗内可一键填入 DeepSeek 官方参数）。API Key **仅保存在本机** `data/config.local.json`（已被 Git 忽略，永不入库、永不上传）
> - 离线演示模式仅用于体验界面流程，不产生 AI 对话与评估

---

语音改进：本地识别优先使用中英双语模型，为 Agent、DeepSeek、MCP、RAG 等技术词启用热词；提交前等待完整尾音和 SenseVoice 精识别。精识别保留连续片段的上下文，不按每次短暂停顿把英文词单独切开。浏览器在线识别与本地识别共用术语表。结束面试会立即释放采集并取消所有后续朗读，迟到的 AI 回复不会重启声音。

## 自己添加题目

在「知识库」页面下载 JSON 标准模板，填写题干、考察点和参考材料，校验预览后保存。只追加、自动去重、写前备份，新题参考材料立即进入本地 RAG。现有 3 个岗位共 **213 题**（Java 72、Python/算法 70、前端 71），本次新增 54 题均附参考材料与来源。操作步骤、字段约束和例子见 [题库导入说明](docs/题库导入说明.md)，文档来源见 [题库来源](docs/题库来源.md)。

## 🧠 多 Agent 协作（不是一句提示词包打天下）

一场面试由 **4 个专职 Agent 分工完成**，每个都在「思考 → 调工具 → 看结果 → 再决策」的循环里工作：

| Agent | 职责 | 可用工具 |
|---|---|---|
| **面试官 Agent** | 主持对话：边听边决定追问 / 深挖 / 换知识点 / 下一题 | `analyze_answer` `search_knowledge` `find_question` `record_observation` `adjust_plan` |
| **评估官 Agent** | 面试结束后基于真实作答数据打分、逐题复盘、修正初版分数 | `stat_rounds` `lookup_knowledge` `bank_reference` |
| **陪练官 Agent** | 针对薄弱点检索知识库，产出可执行的一周提升计划与练习题 | `lookup_knowledge` `stat_rounds` `bank_reference` |
| **出题官 Agent** | 按 JD / 知识点生成新题（可导入题库） | `bank_reference` `lookup_knowledge` `draft_question` |

关键在于**决策来自模型 + 工具返回的真实数据**，而不是 if/else：

- 候选人答偏了 → 面试官 Agent 自己发现"他答的是线程池不是 HashMap"，把话拉回来
- 候选人说"不会" → 它调 `find_question` 换一道更基础的题，而不是机械念下一题
- 报告里"综合分"不是凭空写的 → 评估官先调 `stat_rounds` 拿到每题字数、关键词命中率、放弃次数，再据此打分并修正初版报告

面试间右侧的 **🧠 Agent 工作台** 会把这些过程**实时画出来**（第几次决策、调了什么工具、工具返回了什么、因此决定说什么），面试不是黑箱。

## 🔌 MCP：把面试能力开放给外部 Agent

面镜内置一个**零依赖的 MCP Server**（`mcp/mockmirror-mcp.js`，stdio / JSON-RPC 2.0），Claude Desktop、WorkBuddy、Cursor 等支持 MCP 的客户端可以直接调用：

```json
{
  "mcpServers": {
    "mockmirror": {
      "command": "node",
      "args": ["<你的路径>/mockmirror/mcp/mockmirror-mcp.js"]
    }
  }
}
```

> 使用前先启动面镜（`启动面试.bat` 或 `node server.js`）。写状态的操作会转发给本机服务，只读能力（题库 / 知识库 / 岗位）不依赖服务。
> 想换端口：设置环境变量 `MOCKMIRROR_URL=http://127.0.0.1:3001`。

**9 个工具**：`list_positions`、`search_questions`、`start_interview`、`submit_answer`、`finish_interview`、`get_report`、`analyze_answer`、`knowledge_lookup`、`list_sessions`

**3 类资源**：`mockmirror://positions`、`mockmirror://bank/{position}`、`mockmirror://knowledge/{position}`

**2 个 Prompt 模板**：`mock_interview`（引导外部 Agent 主持一整场面试）、`interview_review`（复盘某场面试并生成学习计划）

一句话效果：在 Claude 里说"用 MockMirror 帮我面一场 Java 后端"，它会自己调 `list_positions → start_interview → submit_answer × N → finish_interview`，最后给你复盘。

## 🔐 企业级特性

- **AI 接入门禁**：未配置大模型时，服务端直接拒绝开始面试（HTTP 428 + 引导），杜绝"看起来能 AI 实际是脚本"的假体验
- **密钥安全**：Key 只落本机、接口永不回传（仅 `hasKey` 布尔）、全 Git 历史可检索验证零泄露
- **数据库可靠性**：原子写（tmp+rename）· 写前 `.bak` 备份 · 启动损坏自愈 · 每日快照（保留 7 份）· Schema 版本迁移 · 内存索引 · 写合并
- **个人本地记录**：面试历史、逐题复盘和成长曲线保存于本机 `data/db.json`，按姓名区分练习记录；无管理员后台、学员管理或管理接口。保留本地备份、CORS 同源白名单与前端 HTML 转义。
- **可观测性**：`GET /api/health` 一键查看 AI 引擎与数据库状态

## 🧪 测试

```bash
node test/opening.js                  # 开场去重、首句音色与形象一致性回归（Playwright）
node test/voice-lifecycle.js          # 结束播放与精识别提交回归（Playwright，无付费 AI 调用）
node test/local-records.js            # 只读检查个人历史、成长曲线及回放（Playwright）
node test/asr-refine.js               # 本地语音识别与精识别端到端
node test/mcp.js                      # MCP 协议自检（18 项，无需大模型）
node test/mcp-live.js                 # 用 MCP 工具跑完整场面试（12 项，需已配置大模型）
node test/llm-e2e.js java-backend 4   # AI 全流程实测（需已配置大模型）
node test/ai-safety.js                # AI 安全/边界实验：提示注入、幻觉、空回答
node test/agent-panel.js              # Agent 工作台面板（Playwright，24 项）
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

报告与设计文档（需求 / 设计 / 测试 / 团队报告 / 5 份个人实训报告 / 答辩 PPT）不随仓库发布，随交付材料包本地提供。仓库内保留以下协作文档：

| 文档 | 内容 |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | 团队协作规范（分支命名、提交信息规范、Code Review 要求） |
| [python-agent/](python-agent/) | Python Agent 服务源码与测试 |

---

## 🗂 目录结构

```
agent-collab/
├── 启动面试.bat / start.sh     # 一键启动脚本（Windows / macOS·Linux）
├── server.js                   # ① 面试系统服务入口（静态资源 + REST API）
├── lib/                        #   数据层 / 题库 / RAG / LLM / 面试流程控制
│   ├── agent.js                #   面试官 Agent 运行时（工具调用 + 观察-决策循环）
│   └── agentTeam.js            #   多 Agent 协作（评估官 / 陪练官 / 出题官）
├── mcp/mockmirror-mcp.js       #   MCP Server（零依赖，stdio）—— 开放给外部 Agent 调用
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


## 作答控时与卡壳救援

每题提供两分钟参考时间条，剩20秒温和提醒，到时不自动提交。答题区可直接点「再说一遍」「给点提示」「跳过这题」；重听与提示保留已说内容。流式尾句播放与取消逻辑已修复，静音停顿不会触发抢答。结束后先整理评估再展示总分与详细内容。完整行为及验证范围见 [交互优化说明](docs/交互优化说明.md)。

浏览器自动化测试（`test:bank`、`test:experience` 等）需要开发环境已安装 Playwright，并可启动 Edge；应用本体运行仍无需 npm install。
