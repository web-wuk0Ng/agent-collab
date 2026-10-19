/**
 * 面镜 MockMirror —— AI 模拟面试与能力提升软件
 * 服务入口：静态资源 + REST API
 * 启动：node server.js   （默认 http://localhost:3000）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const db = require('./lib/db');
const bank = require('./lib/bank');
const rag = require('./lib/rag');
const llm = require('./lib/llm');
const interview = require('./lib/interview');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------- 通用错误 / 安全工具 ---------------- */

/** 抛出带 HTTP 状态码的业务错误 */
function apiError(message, status = 400, code = '') {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/** 同源白名单：只允许本机页面跨源调用 API（防任意站点调用本地服务） */
function corsOrigin(origin) {
  if (!origin) return '';                                   // 同源请求 / curl 无 Origin
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ? origin : '';
}

/** 滑动窗口限流：key 维度，windowMs 内最多 max 次 */
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.first > windowMs) { buckets.set(key, { first: now, count: 1 }); return true; }
  b.count += 1;
  if (b.count > max) return false;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now - v.first > 30 * 60 * 1000) buckets.delete(k);
}, 10 * 60 * 1000).unref();

/** 管理员会话：登录成功签发随机 token（内存态，2 小时过期），替代明文口令重传 */
const adminSessions = new Map();   // token -> expiresAt
const ADMIN_TTL = 2 * 60 * 60 * 1000;
function issueAdminToken() {
  const t = crypto.randomBytes(24).toString('hex');
  adminSessions.set(t, Date.now() + ADMIN_TTL);
  return t;
}
function requireAdmin(req) {
  const t = String(req.headers['x-admin-token'] || '');
  const exp = adminSessions.get(t);
  if (!exp || exp < Date.now()) throw apiError('需要管理员权限，请先在管理中心登录', 401, 'ADMIN_REQUIRED');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

function send(res, code, data, type = 'application/json; charset=utf-8') {
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  if (Buffer.isBuffer(data)) { res.writeHead(code, headers); return res.end(data); }
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 5 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* ---------------- API 路由 ---------------- */

const routes = {
  // 元信息：岗位列表与题库规模
  'GET /api/positions': () => ({ positions: bank.positionsMeta() }),

  // 用户（本地轻量账户：仅用于隔离面试历史）
  'POST /api/login': (p) => {
    const name = String(p.name || '').trim().slice(0, 20);
    if (!name) throw new Error('请输入姓名');
    const user = db.findOrCreateUser(name);
    return { user: { id: user.id, name: user.name } };
  },

  // AI 配置（保存在服务端本地 config.local.json，永不上传）
  'GET /api/ai-config': () => llm.publicConfig(),
  'POST /api/ai-config': (p) => llm.saveConfig(p),
  'POST /api/ai-test': () => llm.testConnect(),
  // Python 面试官 Agent 服务状态（引擎切换面板展示用）
  'GET /api/agent-status': () => llm.pythonStatus(),

  // 知识库检索预览（RAG 演示）
  'POST /api/rag-preview': (p) => ({ hits: rag.search(p.position, p.query, 4) }),

  // 开始一场面试 —— AI 功能有前置条件：必须完成大模型配置（企业级门禁）
  'POST /api/interview/start': async (p) => {
    if (!llm.isConfigured() || llm.publicConfig().engine === 'offline') {
      throw apiError('AI 面试尚未配置：请先在右上角「AI 设置」中完成大模型接入（Base URL / API Key / 模型名），测试通过后即可开始面试。', 428, 'AI_NOT_CONFIGURED');
    }
    if (!rateLimit(`start:${p.userId || 'anon'}`, 10, 60 * 1000)) throw apiError('操作过于频繁，请稍后再试', 429, 'RATE_LIMITED');
    const user = db.getUser(p.userId);
    if (!user) throw apiError('请先登录', 401, 'LOGIN_REQUIRED');
    const pos = String(p.position || '');
    if (!bank.getBank(pos)) throw apiError('岗位不存在，请重新选择', 400, 'BAD_POSITION');
    let plan = bank.buildPlan(p.position, p.rounds || 6)
      .map(e => ({ ...e, full: bank.findQuestion(p.position, e.id) }));
    let jdApplied = false;
    // 企业落地：粘贴岗位 JD，AI 定制面试题（在线模式）
    const jd = String(p.jd || '').trim();
    if (jd.length > 30 && llm.isConfigured()) {
      const gen = await llm.generateJdQuestions(jd, p.position);
      if (gen) {
        plan = gen.slice(0, Math.max(3, Math.min(8, p.rounds || 6))).map((q, i) => ({
          id: `jd_${i}`, type: ['tech', 'project', 'scenario', 'behavior'].includes(q.type) ? q.type : 'tech',
          text: String(q.text).slice(0, 500),
          full: { id: `jd_${i}`, type: q.type || 'tech', text: String(q.text).slice(0, 500), keywords: (q.keywords || []).map(String).slice(0, 8), points: [] }
        }));
        jdApplied = true;
      }
    }
    const firstQ = plan[0];
    const session = {
      id: db.newId('iv'),
      userId: user.id,
      position: p.position,
      mode: p.mode || 'text',          // video | voice | text
      jdApplied,
      status: 'ongoing',
      startedAt: Date.now(),
      rounds: [],                       // {qIndex, question, type, answer, metrics, followUps:[]}
      plan                             // 计划的题目序列（含内嵌完整题目）
    };
    // 用 LLM 生成面试官开场白（离线引擎也有对应实现）
    const greeting = await llm.interviewerGreeting(p.position, firstQ, p.rounds || 6);
    db.saveSession(session);
    return { sessionId: session.id, greeting, question: { id: firstQ.id, type: firstQ.type, text: firstQ.text, index: 0 }, planSize: plan.length, jdApplied };
  },

  // 提交一轮回答（含追问），返回 AI 面试官下一句话
  'POST /api/interview/answer': async (p) => {
    const s = db.getSession(p.sessionId);
    if (!s || s.status !== 'ongoing') throw new Error('面试会话不存在或已结束');
    const result = await interview.handleAnswer(s, p);
    db.saveSession(s);
    return result;
  },

  // 智能回合判断：候选人语音停顿后，面试官判断"说完了还是卡住了"（不写入会话数据）
  'POST /api/interview/turn-check': async (p) => {
    const s = db.getSession(p.sessionId);
    if (!s || s.status !== 'ongoing') throw new Error('面试会话不存在或已结束');
    return await interview.turnCheck(s, p);
  },

  // 结束面试并生成评估报告
  'POST /api/interview/finish': async (p) => {
    const s = db.getSession(p.sessionId);
    if (!s) throw new Error('面试会话不存在');
    // 视频面试仪态指标（前端本地分析结果）
    if (p.videoMetrics && typeof p.videoMetrics === 'object') {
      const v = p.videoMetrics;
      s.videoMetrics = {
        presencePct: +v.presencePct || 0, gazePct: +v.gazePct || 0,
        steadyPct: +v.steadyPct || 0, smilePct: +v.smilePct || 0,
        samples: +v.samples || 0
      };
    }
    const report = await interview.generateReport(s);
    s.status = 'finished';
    s.finishedAt = Date.now();
    s.report = report;
    db.saveSession(s);
    db.addHistory(s);
    return { report };
  },

  // 单条会话 / 历史 / 成长曲线
  'GET /api/session': (p, query) => {
    const s = db.getSession(query.id);
    if (!s) throw new Error('会话不存在');
    return { session: s };
  },
  'GET /api/history': (p, query) => ({ list: db.historyOf(query.userId) }),
  'GET /api/growth': (p, query) => ({ curve: db.growthOf(query.userId) }),

  /* ---------- 管理中心（企业/教师视角） ---------- */
  'POST /api/admin/login': (p, q, req) => {
    if (!rateLimit(`admin:${req.socket.remoteAddress}`, 5, 10 * 60 * 1000)) {
      throw apiError('尝试次数过多，请 10 分钟后再试', 429, 'RATE_LIMITED');
    }
    if (!db.verifyAdminPass(p.passcode)) {
      db.audit('admin.login.fail', req.socket.remoteAddress);
      throw apiError('口令不正确', 401, 'ADMIN_BAD_PASS');
    }
    const token = issueAdminToken();
    db.audit('admin.login.ok', req.socket.remoteAddress);
    return { ok: true, token };
  },
  'GET /api/admin/stats': (p, q, req) => { requireAdmin(req); return db.adminStats(); },
  'GET /api/admin/students': (p, q, req) => { requireAdmin(req); return { list: db.adminStudents() }; },
  'GET /api/admin/audits': (p, q, req) => { requireAdmin(req); return { list: db.adminAudits() }; },
  'GET /api/admin/export': (p, q, req) => { requireAdmin(req); return { csv: db.adminExportCsv() }; },
  'GET /api/admin/bank': (p, q, req) => {
    requireAdmin(req);
    const positions = bank.positionsMeta();
    const detail = q.position ? bank.rawBank(q.position) : null;
    return { positions, detail };
  },
  'POST /api/admin/bank/import': (p, q, req) => { requireAdmin(req); return bank.importCustom(p); },
  'POST /api/admin/bank/delete': (p, q, req) => { requireAdmin(req); return bank.deleteCustom(p.position); },

  // 健康检查（部署探针 / 可观测性）
  'GET /api/health': () => ({ status: 'ok', name: 'MockMirror', ai: llm.publicConfig(), db: db.stats() })
};

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  // CORS（仅同源白名单：本机页面；第三方站点不允许跨源调用本地服务）
  const allowOrigin = corsOrigin(req.headers.origin);
  if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Token');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // API
  const routeKey = `${req.method} ${pathname}`;
  if (routes[routeKey]) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const out = await routes[routeKey](body, parsed.query, req);
      return send(res, 200, out);
    } catch (e) {
      console.error('[API]', routeKey, e.code || '', e.message);
      return send(res, e.status || 400, { error: e.message || '请求失败', code: e.code || '' });
    }
  }
  if (pathname.startsWith('/api/')) return send(res, 404, { error: '接口不存在' });

  // 静态资源
  let file = pathname === '/' ? '/index.html' : pathname;
  const fp = path.join(PUBLIC_DIR, path.normalize(file).replace(/^([.][.][/\\])+/, ''));
  if (!fp.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(fp, (err, buf) => {
    if (err) return send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
    send(res, 200, buf, MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream');
  });
});

db.init();
bank.init();
rag.init();

server.listen(PORT, () => {
  console.log('');
  console.log('  面镜 MockMirror —— AI 模拟面试与能力提升软件');
  console.log(`  ✔ 服务已启动: http://localhost:${PORT}`);
  console.log(`  ✔ 岗位题库: ${bank.positionsMeta().map(p => p.name).join(' / ')}`);
  console.log(`  ✔ AI 模式: ${llm.modeLabel()}`);
  console.log(llm.isConfigured() ? '  ✔ AI 已就绪，可以开始模拟面试' : '  ⚠ AI 尚未配置：请在网页右上角「AI 设置」完成大模型接入后开始面试');
  console.log('');
});
