/**
 * 面镜 MockMirror —— AI 模拟面试与能力提升软件
 * 服务入口：静态资源 + REST API
 * 启动：node server.js   （默认 http://localhost:3000）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const db = require('./lib/db');
const bank = require('./lib/bank');
const rag = require('./lib/rag');
const llm = require('./lib/llm');
const interview = require('./lib/interview');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

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
  'POST /api/ai-test': async () => ({ ok: await llm.testConnect() }),

  // 知识库检索预览（RAG 演示）
  'POST /api/rag-preview': (p) => ({ hits: rag.search(p.position, p.query, 4) }),

  // 开始一场面试
  'POST /api/interview/start': async (p) => {
    const user = db.getUser(p.userId);
    if (!user) throw new Error('请先登录');
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
    return { sessionId: session.id, greeting, question: { id: firstQ.id, type: firstQ.type, text: firstQ.text }, planSize: plan.length, jdApplied };
  },

  // 提交一轮回答（含追问），返回 AI 面试官下一句话
  'POST /api/interview/answer': async (p) => {
    const s = db.getSession(p.sessionId);
    if (!s || s.status !== 'ongoing') throw new Error('面试会话不存在或已结束');
    const result = await interview.handleAnswer(s, p);
    db.saveSession(s);
    return result;
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
  'POST /api/admin/login': (p) => ({ ok: db.adminPass() === String(p.passcode || '') }),
  'GET /api/admin/stats': (p, q, req) => { requireAdmin(req); return db.adminStats(); },
  'GET /api/admin/students': (p, q, req) => { requireAdmin(req); return { list: db.adminStudents() }; },
  'GET /api/admin/export': (p, q, req) => { requireAdmin(req); return { csv: db.adminExportCsv() }; },
  'GET /api/admin/bank': (p, q, req) => {
    requireAdmin(req);
    const positions = bank.positionsMeta();
    const detail = q.position ? bank.rawBank(q.position) : null;
    return { positions, detail };
  },
  'POST /api/admin/bank/import': (p, q, req) => { requireAdmin(req); return bank.importCustom(p); },
  'POST /api/admin/bank/delete': (p, q, req) => { requireAdmin(req); return bank.deleteCustom(p.position); }
};

function requireAdmin(req) {
  if (req.headers['x-admin-pass'] !== db.adminPass()) throw new Error('需要管理员权限，请先在管理中心登录');
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  // CORS（本地开发宽容处理）
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // API
  const routeKey = `${req.method} ${pathname}`;
  if (routes[routeKey]) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const out = await routes[routeKey](body, parsed.query, req);
      return send(res, 200, out);
    } catch (e) {
      console.error('[API]', routeKey, e.message);
      return send(res, 400, { error: e.message || '请求失败' });
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
  console.log('');
});
