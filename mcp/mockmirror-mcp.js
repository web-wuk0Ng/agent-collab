#!/usr/bin/env node
/**
 * MockMirror MCP Server —— 把「面镜」的面试能力暴露给外部 Agent（Claude / WorkBuddy / Cursor …）
 *
 * 传输：stdio（JSON-RPC 2.0，换行分隔），零第三方依赖，直接用 Node 内置模块。
 * 协议版本：2024-11-05
 *
 * 设计要点：
 *  1. 所有**写状态**的调用（开始面试 / 提交回答 / 结束面试）都通过 HTTP 转发给已在运行的
 *     面镜服务（默认 http://127.0.0.1:3000），保证会话状态唯一，避免多进程双写 db.json。
 *  2. 只读能力（题库 / 知识库 / 岗位列表）在 MCP 进程内直接读本地文件，服务没起也能用。
 *  3. stdout 只允许输出 JSON-RPC 消息（否则污染协议），所有日志走 stderr。
 *
 * 接入方式（以 Claude Desktop 为例，claude_desktop_config.json）：
 *  {
 *    "mcpServers": {
 *      "mockmirror": {
 *        "command": "node",
 *        "args": ["D:/2026misc/软件项目实训/mockmirror/mcp/mockmirror-mcp.js"]
 *      }
 *    }
 *  }
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.MOCKMIRROR_URL || 'http://127.0.0.1:3000';
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'mockmirror', version: '1.1.0' };

/* ------------------------------------------------------------------ */
/* 本地只读数据源                                                       */
/* ------------------------------------------------------------------ */

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function listBanks() {
  const dir = path.join(ROOT, 'data', 'questions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(dir, f)))
    .filter(Boolean);
}

function listKnowledge() {
  const dir = path.join(ROOT, 'data', 'knowledge');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    .map(f => ({ position: f.replace(/\.md$/, ''), file: f }));
}

/* ------------------------------------------------------------------ */
/* 转发到面镜服务（写状态 / 需要 LLM 的调用）                            */
/* ------------------------------------------------------------------ */

function httpJson(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(apiPath, BASE); } catch { return reject(new Error('地址非法: ' + apiPath)); }
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf-8');
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method,
      headers: Object.assign(
        { Accept: 'application/json' },
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
      )
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf-8');
        let j = null;
        try { j = JSON.parse(txt); } catch { /* 非 JSON */ }
        if (res.statusCode >= 400) {
          const msg = (j && j.error) ? j.error : `HTTP ${res.statusCode}`;
          const e = new Error(msg);
          e.code = (j && j.code) || ('HTTP_' + res.statusCode);
          return reject(e);
        }
        resolve(j !== null ? j : txt);
      });
    });
    req.on('error', e => reject(new Error(`无法连接面镜服务 ${BASE}：${e.message}。请先在 mockmirror 目录启动「启动面试.bat」或 node server.js`)));
    req.setTimeout(180000, () => req.destroy(new Error('请求超时（大模型生成较慢，请稍后重试）')));
    if (data) req.write(data);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* 工具定义                                                            */
/* ------------------------------------------------------------------ */

const TOOLS = [
  {
    name: 'list_positions',
    description: '列出面镜支持的所有面试岗位（含岗位简介、技能点、题库规模）。开始面试前先调用它拿岗位 position 值。',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'search_questions',
    description: '按关键词/题型检索某岗位题库，返回题干、考察点、回答思路。可用于押题、备课、生成复习清单。',
    inputSchema: {
      type: 'object',
      properties: {
        position: { type: 'string', description: '岗位标识，如 java-backend；用 list_positions 获取' },
        keyword: { type: 'string', description: '关键词，如 Redis / 线程池 / 动态规划' },
        type: { type: 'string', enum: ['tech', 'project', 'scenario', 'behavior'], description: '题型，可选' },
        limit: { type: 'number', description: '返回条数，默认 8，最多 30' }
      },
      required: ['position']
    }
  },
  {
    name: 'start_interview',
    description: '开启一场 AI 模拟面试，返回 sessionId、面试官开场白和第一道题。面试过程由面镜的面试官 Agent 自主主持（会自己决定追问/深挖/换题）。',
    inputSchema: {
      type: 'object',
      properties: {
        position: { type: 'string', description: '岗位标识' },
        user: { type: 'string', description: '候选人姓名，默认 MCP 候选人' },
        rounds: { type: 'number', description: '题目数量，默认 6，范围 3-8' },
        jd: { type: 'string', description: '可选：岗位 JD 原文，超过 30 字则 AI 按 JD 定制面试题' }
      },
      required: ['position']
    }
  },
  {
    name: 'submit_answer',
    description: '提交候选人对当前题目的回答，返回面试官 Agent 的下一句话（可能是追问、深挖、换知识点，或进入下一题）。同时返回 Agent 的思考过程与调用过的工具。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'start_interview 返回的会话 ID' },
        qIndex: { type: 'number', description: '当前题目序号，从 0 开始' },
        answer: { type: 'string', description: '候选人的回答原文' }
      },
      required: ['sessionId', 'qIndex', 'answer']
    }
  },
  {
    name: 'finish_interview',
    description: '结束面试并生成完整评估报告（多维评分、优缺点、逐题复盘、提升建议）。报告由评估 Agent 与陪练 Agent 协作产出。',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: '会话 ID' } },
      required: ['sessionId']
    }
  },
  {
    name: 'get_report',
    description: '读取某场已结束面试的评估报告与完整对话记录（题目 / 回答 / 追问）。',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: '会话 ID' } },
      required: ['sessionId']
    }
  },
  {
    name: 'analyze_answer',
    description: '单独评估一条回答：命中的考察点、遗漏的考察点、深度评分(1-5)、是否含糊、改进建议。不必开整场面试也能用，适合快速批改。',
    inputSchema: {
      type: 'object',
      properties: {
        position: { type: 'string', description: '岗位标识' },
        question: { type: 'string', description: '题目原文' },
        points: { type: 'array', items: { type: 'string' }, description: '该题目的考察点列表，可选' },
        answer: { type: 'string', description: '候选人回答原文' }
      },
      required: ['position', 'question', 'answer']
    }
  },
  {
    name: 'knowledge_lookup',
    description: '检索岗位知识库（本地 RAG，BM25），返回最相关的知识片段，用于给候选人讲解标准答案或生成学习资料。',
    inputSchema: {
      type: 'object',
      properties: {
        position: { type: 'string', description: '岗位标识' },
        query: { type: 'string', description: '检索词' },
        limit: { type: 'number', description: '返回条数，默认 4' }
      },
      required: ['position', 'query']
    }
  },
  {
    name: 'list_sessions',
    description: '列出历史上的模拟面试（候选人、岗位、时间、总分），用于跟踪练习进度与成长曲线。',
    inputSchema: {
      type: 'object',
      properties: { userId: { type: 'string', description: '用户 ID，可选；不传则返回最近场次' } },
      required: []
    }
  }
];

/* ------------------------------------------------------------------ */
/* 工具实现                                                            */
/* ------------------------------------------------------------------ */

const impl = {
  async list_positions() {
    const banks = listBanks();
    if (!banks.length) return text('题库目录为空，请检查 data/questions/');
    return text(banks.map(b => ({
      position: b.position, name: b.name, intro: b.intro,
      skills: b.skills, questionCount: (b.questions || []).length
    })));
  },

  async search_questions({ position, keyword, type, limit }) {
    const b = listBanks().find(x => x.position === position);
    if (!b) return errText(`岗位不存在：${position}。可用岗位：${listBanks().map(x => x.position).join(', ')}`);
    let pool = b.questions || [];
    if (type) pool = pool.filter(q => q.type === type);
    const kw = String(keyword || '').trim().toLowerCase();
    if (kw) {
      const keys = kw.split(/[\s,，、|]+/).filter(Boolean);
      pool = pool.map(q => {
        const hay = [q.text, (q.keywords || []).join(' '), (q.points || []).join(' ')].join(' ').toLowerCase();
        return { q, score: keys.filter(k => hay.includes(k)).length };
      }).filter(x => x.score > 0).sort((a, c) => c.score - a.score).map(x => x.q);
    }
    const n = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 30);
    const hits = pool.slice(0, n);
    if (!hits.length) return text(`没有匹配「${keyword || ''}」的题目。`);
    return text({
      position, total: pool.length, returned: hits.length,
      questions: hits.map(q => ({
        id: q.id, type: q.type, stage: q.stage, text: q.text,
        keywords: q.keywords || [], points: q.points || [], hint: q.hint || ''
      }))
    });
  },

  async start_interview({ position, user, rounds, jd }) {
    const name = String(user || 'MCP 候选人').slice(0, 20);
    const u = await httpJson('POST', '/api/login', { name });
    const r = await httpJson('POST', '/api/interview/start', {
      userId: u.user.id, position,
      rounds: Math.max(3, Math.min(parseInt(rounds, 10) || 6, 8)),
      mode: 'text', jd: jd || ''
    });
    return text({
      sessionId: r.sessionId,
      userId: u.user.id,
      greeting: r.greeting,
      currentQuestion: r.question,
      planSize: r.planSize,
      jdApplied: !!r.jdApplied,
      hint: '后续用 submit_answer 提交回答（qIndex 从 0 开始，每次返回 nextLine 与是否进入下一题）'
    });
  },

  async submit_answer({ sessionId, qIndex, answer }) {
    const r = await httpJson('POST', '/api/interview/answer', { sessionId, qIndex: qIndex | 0, answer });
    return text({
      nextLine: r.nextLine,
      isFollowUp: !!r.followUp,
      nextQuestion: r.question,
      progress: r.progress,
      done: !!r.done,
      agent: r.agent ? { thought: r.agent.thought, tools: r.agent.tools, steps: r.agent.steps, trace: r.agent.trace || [] } : null
    });
  },

  async finish_interview({ sessionId }) {
    const r = await httpJson('POST', '/api/interview/finish', { sessionId });
    return text({ report: r.report, transcript: r.transcript });
  },

  async get_report({ sessionId }) {
    const s = await httpJson('GET', `/api/session?id=${encodeURIComponent(sessionId)}`);
    const sess = s.session || s;
    return text({
      sessionId,
      position: sess.position,
      status: sess.status,
      startedAt: sess.startedAt ? new Date(sess.startedAt).toLocaleString('zh-CN') : null,
      report: sess.report || null,
      rounds: (sess.rounds || []).map((r, i) => ({
        index: i + 1,
        question: r.question && r.question.text,
        answer: r.answer,
        followUps: r.followUps || [],
        metrics: r.metrics || null
      }))
    });
  },

  async analyze_answer({ position, question, points, answer }) {
    const r = await httpJson('POST', '/api/agent/analyze', { position, question, points: points || [], answer });
    return text(r);
  },

  async knowledge_lookup({ position, query, limit }) {
    const r = await httpJson('POST', '/api/rag-preview', { position, query });
    const hits = (r.hits || []).slice(0, Math.min(Math.max(parseInt(limit, 10) || 4, 1), 10));
    if (!hits.length) return text(`知识库中没有与「${query}」相关的内容。`);
    return text({ position, query, hits: hits.map(h => ({ title: h.title, score: h.score, text: h.text })) });
  },

  async list_sessions({ userId }) {
    if (!userId) return text('请提供 userId（start_interview 返回值里有），或先调用 start_interview。');
    const r = await httpJson('GET', `/api/history?userId=${encodeURIComponent(userId)}`);
    return text((r.list || []).slice(0, 20).map(h => ({
      sessionId: h.id, position: h.position, at: new Date(h.startedAt || h.time || Date.now()).toLocaleString('zh-CN'),
      score: h.report && (h.report.totalScore || h.report.score) || null, rounds: (h.rounds || []).length
    })));
  }
};

/* ------------------------------------------------------------------ */
/* Resources                                                           */
/* ------------------------------------------------------------------ */

function resourceList() {
  const out = [
    { uri: 'mockmirror://positions', name: '岗位总览', mimeType: 'application/json', description: '所有可面试岗位及题库规模' }
  ];
  for (const b of listBanks()) {
    out.push({
      uri: `mockmirror://bank/${b.position}`,
      name: `题库 · ${b.name}`,
      mimeType: 'application/json',
      description: `${b.name} 岗位全部 ${(b.questions || []).length} 道题（含考察点与回答思路）`
    });
  }
  for (const k of listKnowledge()) {
    out.push({
      uri: `mockmirror://knowledge/${k.position}`,
      name: `知识库 · ${k.position}`,
      mimeType: 'text/markdown',
      description: `${k.position} 岗位知识库全文`
    });
  }
  return out;
}

function readResource(uri) {
  const m = String(uri).match(/^mockmirror:\/\/(bank|knowledge)\/(.+)$/);
  if (uri === 'mockmirror://positions') {
    return { uri, mimeType: 'application/json', text: JSON.stringify(listBanks().map(b => ({ position: b.position, name: b.name, intro: b.intro, skills: b.skills, questionCount: (b.questions || []).length })), null, 2) };
  }
  if (!m) throw new Error('不支持的资源 URI: ' + uri);
  const [, kind, key] = m;
  if (kind === 'bank') {
    const b = listBanks().find(x => x.position === key);
    if (!b) throw new Error('题库不存在: ' + key);
    return { uri, mimeType: 'application/json', text: JSON.stringify(b, null, 2) };
  }
  const p = path.join(ROOT, 'data', 'knowledge', `${key}.md`);
  if (!fs.existsSync(p)) throw new Error('知识库不存在: ' + key);
  return { uri, mimeType: 'text/markdown', text: fs.readFileSync(p, 'utf-8') };
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

const PROMPTS = [
  {
    name: 'mock_interview',
    description: '用面镜主持一场完整的 AI 模拟面试（选岗 → 逐题问答 → 出评估报告）',
    arguments: [
      { name: 'position', description: '岗位标识，如 java-backend', required: true },
      { name: 'rounds', description: '题目数量，默认 6', required: false }
    ]
  },
  {
    name: 'interview_review',
    description: '复盘一场已结束的模拟面试：逐题点评 + 薄弱知识点 + 学习计划',
    arguments: [{ name: 'sessionId', description: '面试会话 ID', required: true }]
  }
];

function promptGet(name, args) {
  if (name === 'mock_interview') {
    return {
      description: '模拟面试流程',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `请用 MockMirror 为我主持一场「${args.position}」岗位的模拟面试，共 ${args.rounds || 6} 题。

流程要求：
1. 调用 list_positions 确认岗位标识；
2. 调用 start_interview 开启面试，把面试官开场白和第一道题转述给我；
3. 我作答后，调用 submit_answer 提交我的原话，并把面试官的话转述给我；
4. 重复第 3 步直到 done 为 true；
5. 调用 finish_interview 生成评估报告，为我做一份复盘：整体评价、逐题点评、最该补的 3 个知识点、接下来一周的学习计划。

注意：每次只问我一道题，不要一次把题目全列出来。`
        }
      }]
    };
  }
  if (name === 'interview_review') {
    return {
      description: '面试复盘',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `请用 get_report 读取会话 ${args.sessionId} 的评估报告与对话记录，然后给我一份面试复盘：
- 整体表现与各维度得分
- 逐题点评（答到的点 / 漏掉的点 / 该怎么答更好）
- 最需要补的 3 个知识点，并用 knowledge_lookup 拉取对应知识库内容作为学习材料
- 接下来一周的练习计划`
        }
      }]
    };
  }
  throw new Error('未知 prompt: ' + name);
}

/* ------------------------------------------------------------------ */
/* 输出辅助                                                            */
/* ------------------------------------------------------------------ */

function text(payload) {
  const s = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text: s }] };
}
function errText(msg) {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

/* ------------------------------------------------------------------ */
/* JSON-RPC 主循环（stdio）                                            */
/* ------------------------------------------------------------------ */

function reply(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function sendError(id, code, message) {
  reply({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg || {};
  switch (method) {
    case 'initialize':
      return reply({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, resources: { subscribe: false }, prompts: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'MockMirror（面镜）是 AI 模拟面试系统。典型用法：list_positions 选岗位 → start_interview 开场 → ' +
            'submit_answer 逐题问答 → finish_interview 出评估报告。写状态的调用需要面镜网页服务已在 127.0.0.1:3000 运行并且已配置大模型。'
        }
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // 通知，不响应

    case 'ping':
      return reply({ jsonrpc: '2.0', id, result: {} });

    case 'tools/list':
      return reply({ jsonrpc: '2.0', id, result: { tools: TOOLS } });

    case 'tools/call': {
      const name = params && params.name;
      const fn = impl[name];
      // 未知工具走 isError 结果（而不是协议级报错）：模型能看到原因并自我纠正
      if (!fn) return reply({ jsonrpc: '2.0', id, result: errText(`未知工具: ${name}。可用工具：${TOOLS.map(t => t.name).join(', ')}`) });
      try {
        const r = await fn((params && params.arguments) || {});
        return reply({ jsonrpc: '2.0', id, result: r });
      } catch (e) {
        console.error('[mcp] tool error', name, e.message);
        return reply({ jsonrpc: '2.0', id, result: errText(`工具 ${name} 调用失败：${e.message}`) });
      }
    }

    case 'resources/list':
      return reply({ jsonrpc: '2.0', id, result: { resources: resourceList() } });

    case 'resources/read': {
      try {
        const uri = params && params.uri;
        return reply({ jsonrpc: '2.0', id, result: { contents: [readResource(uri)] } });
      } catch (e) {
        return sendError(id, -32602, e.message);
      }
    }

    case 'prompts/list':
      return reply({ jsonrpc: '2.0', id, result: { prompts: PROMPTS } });

    case 'prompts/get': {
      try {
        return reply({ jsonrpc: '2.0', id, result: promptGet(params && params.name, (params && params.arguments) || {}) });
      } catch (e) {
        return sendError(id, -32602, e.message);
      }
    }

    default:
      return sendError(id, -32601, `不支持的方法: ${method}`);
  }
}

let buf = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { console.error('[mcp] 忽略非法 JSON 行:', line.slice(0, 200)); continue; }
    Promise.resolve(handle(msg)).catch(e => {
      console.error('[mcp] handle error', e);
      sendError(msg && msg.id, -32603, e.message);
    });
  }
});
process.stdin.on('end', () => process.exit(0));

console.error(`[mcp] MockMirror MCP Server ${SERVER_INFO.version} 已就绪（stdio），面镜服务地址：${BASE}`);
