/**
 * 数据层（企业级增强版）—— 单文件 JSON 引擎，零第三方依赖
 *
 * 可靠性设计：
 *  1. 原子写：先写同目录临时文件，再 rename 覆盖，杜绝「写一半进程崩溃 → 整库损坏」
 *  2. 写前备份：每次落盘前把上一份完好数据轮换为 db.json.bak
 *  3. 启动自愈：主文件损坏自动降级读取 .bak；两者都坏才重建空库（并打印告警）
 *  4. 每日快照：data/backups/db-YYYY-MM-DD.json，保留最近 7 份
 *  5. Schema 版本与迁移：data.schema 逐版本升级，旧库自动补默认值
 *  6. 口令安全：管理员口令不再明文存储，启动时自动迁移为 sha256(salt+pass)
 *  7. 索引：userId → history 的内存索引，查询 O(1)，避免每次全表扫描
 *  8. 写合并：同一事件循环内的多次写合并为一次 IO，降低磁盘压力
 *  9. 审计：保留最近 200 条关键操作记录（登录/改配置/题库导入等），管理中心可查
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const BAK_FILE = FILE + '.bak';
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SCHEMA_VERSION = 2;
const KEEP_BACKUPS = 7;
const KEEP_AUDITS = 200;

let data = null;
let saveScheduled = false;
let lastSavedAt = 0;
const historyIdx = new Map();   // userId -> [history, ...]

/* ---------------- 基础工具 ---------------- */

function sha256(s) { return crypto.createHash('sha256').update(String(s), 'utf-8').digest('hex'); }

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function freshData() {
  return { schema: SCHEMA_VERSION, users: [], sessions: {}, history: [], seq: 0, audits: [], admin: {} };
}

function warn(...msg) { console.warn('[db]', ...msg); }

/* ---------------- 加载 / 迁移 / 自愈 ---------------- */

function tryRead(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

/** Schema 迁移：任何旧版本库补齐缺失字段并规范化类型 */
function migrate(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return freshData();

  if (!Array.isArray(d.users)) d.users = [];
  if (!d.sessions || typeof d.sessions !== 'object' || Array.isArray(d.sessions)) d.sessions = {};
  if (!Array.isArray(d.history)) d.history = [];
  if (!Number.isFinite(d.seq)) d.seq = 0;
  if (!Array.isArray(d.audits)) d.audits = [];
  if (!d.admin || typeof d.admin !== 'object' || Array.isArray(d.admin)) d.admin = {};

  // 口令安全迁移：明文 pass → sha256(salt+pass)，迁移后不再保留明文
  if (typeof d.admin.pass === 'string' && d.admin.pass) {
    const salt = crypto.randomBytes(8).toString('hex');
    d.admin = { salt, hash: sha256(salt + d.admin.pass) };
    warn('已将管理员口令从明文迁移为加盐哈希');
  } else if (!d.admin.salt || !d.admin.hash) {
    const salt = crypto.randomBytes(8).toString('hex');
    d.admin = { salt, hash: sha256(salt + 'mockmirror2026') };  // 默认口令，可改
    warn('使用默认管理员口令（建议尽快在 data/db.json 修改或启动时设置 ADMIN_PASS 环境变量）');
  }

  // users 规范化：剔除脏数据，字段收敛
  d.users = d.users
    .filter(u => u && u.id && u.name)
    .map(u => ({ id: String(u.id).slice(0, 64), name: String(u.name).slice(0, 20), createdAt: Number(u.createdAt) || Date.now() }));

  // history 规范化
  d.history = d.history.filter(h => h && h.id && h.userId);

  // 环境变量可覆盖默认口令（部署期配置，不落代码）
  if (process.env.ADMIN_PASS) {
    const salt = crypto.randomBytes(8).toString('hex');
    d.admin = { salt, hash: sha256(salt + process.env.ADMIN_PASS) };
  }

  d.schema = SCHEMA_VERSION;
  return d;
}

function load() {
  let d = tryRead(FILE);
  if (d) return migrate(d);
  warn('主库不可读或不存在，尝试从备份恢复…');
  d = tryRead(BAK_FILE);
  if (d) { warn('已从 db.json.bak 恢复'); return migrate(d); }
  warn('备份亦不可用，创建全新数据库');
  return freshData();
}

/** 每日快照：一天一份，滚动保留 KEEP_BACKUPS 份 */
function dailyBackup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const name = `db-${new Date().toISOString().slice(0, 10)}.json`;
    const target = path.join(BACKUP_DIR, name);
    if (fs.existsSync(FILE) && !fs.existsSync(target)) fs.copyFileSync(FILE, target);
    const all = fs.readdirSync(BACKUP_DIR).filter(f => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    while (all.length > KEEP_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, all.shift()));
  } catch (e) { warn('每日快照失败:', e.message); }
}

/* ---------------- 落盘（写合并 + 原子写 + 写前备份） ---------------- */

function flush() {
  try {
    // 写前把当前完好数据轮换为 .bak
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BAK_FILE);
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf-8');
    fs.renameSync(tmp, FILE);        // 同目录 rename，Windows/POSIX 均为原子操作
    lastSavedAt = Date.now();
  } catch (e) {
    warn('落盘失败(数据仍在内存，将在下次写入重试):', e.message);
  }
}

/** 同一事件循环内的多次修改合并为一次真实 IO */
function persist() {
  if (saveScheduled) return;
  saveScheduled = true;
  setImmediate(() => { saveScheduled = false; flush(); });
}

/* ---------------- 审计 ---------------- */

function audit(action, detail) {
  data.audits.push({ at: Date.now(), action, detail: String(detail || '').slice(0, 200) });
  if (data.audits.length > KEEP_AUDITS) data.audits.splice(0, data.audits.length - KEEP_AUDITS);
}

/* ---------------- 初始化 ---------------- */

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  data = load();
  rebuildIndex();
  dailyBackup();
  flush();
  console.log(`  ✔ 数据库: schema v${data.schema} · ${data.users.length} 用户 · ${data.history.length} 场面试记录 · 备份目录 data/backups/`);
}

function rebuildIndex() {
  historyIdx.clear();
  for (const h of data.history) {
    if (!historyIdx.has(h.userId)) historyIdx.set(h.userId, []);
    historyIdx.get(h.userId).push(h);
  }
  for (const list of historyIdx.values()) list.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
}

/* ---------------- 用户 ---------------- */

function newId(prefix) {
  data.seq += 1;
  return `${prefix}_${Date.now().toString(36)}${data.seq.toString(36)}`;
}

function findOrCreateUser(name) {
  const clean = String(name || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 20);
  if (!clean) throw new Error('请输入姓名');
  let u = data.users.find(x => x.name === clean);
  if (!u) {
    u = { id: newId('u'), name: clean, createdAt: Date.now() };
    data.users.push(u);
    audit('user.register', clean);
    persist();
  }
  return u;
}

function getUser(id) {
  if (typeof id !== 'string' || !/^u_[\w-]+$/.test(id)) return null;
  return data.users.find(u => u.id === id) || null;
}

/* ---------------- 会话 ---------------- */

function saveSession(s) {
  if (!s || typeof s !== 'object' || !s.id || !s.userId) throw new Error('会话数据不合法');
  if (!['ongoing', 'finished'].includes(s.status)) s.status = 'ongoing';
  data.sessions[s.id] = s;
  persist();
}

function getSession(id) {
  if (typeof id !== 'string' || !/^iv_[\w-]+$/.test(id)) return null;
  return data.sessions[id] || null;
}

/* ---------------- 历史 / 成长曲线 ---------------- */

function addHistory(session) {
  const r = session.report || {};
  const entry = {
    id: session.id,
    userId: session.userId,
    position: session.position,
    mode: session.mode,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    rounds: (session.rounds || []).length,
    overall: r.overall || 0,
    dims: r.dimensions ? Object.fromEntries(r.dimensions.map(d => [d.key, d.score])) : {}
  };
  data.history.push(entry);
  if (!historyIdx.has(entry.userId)) historyIdx.set(entry.userId, []);
  historyIdx.get(entry.userId).unshift(entry);   // unshift 保持新→旧
  audit('interview.finish', `${entry.position} · 综合 ${entry.overall}`);
  persist();
}

function historyOf(userId) {
  return (historyIdx.get(String(userId)) || []).slice(0, 50);
}

function growthOf(userId) {
  const list = historyOf(userId).slice().reverse(); // 时间正序
  return list.map((h, i) => ({
    index: i + 1,
    label: new Date(h.finishedAt).toLocaleDateString('zh-CN'),
    position: h.position,
    overall: h.overall,
    dims: h.dims
  }));
}

/* ---------------- 运行状态（可观测性） ---------------- */

function stats() {
  return {
    schema: data.schema,
    users: data.users.length,
    activeSessions: Object.values(data.sessions).filter(s => s.status === 'ongoing').length,
    finishedSessions: Object.values(data.sessions).filter(s => s.status === 'finished').length,
    history: data.history.length,
    lastSavedAt,
    backupDir: 'data/backups'
  };
}

/* ---------------- 管理中心（企业/教师视角） ---------------- */

function verifyAdminPass(input) {
  return safeEqual(sha256((data.admin.salt || '') + String(input || '')), data.admin.hash);
}

function adminStats() {
  const h = data.history;
  const mean = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const posMap = {};
  for (const x of h) {
    (posMap[x.position] = posMap[x.position] || { count: 0, sum: 0 }).count++;
    posMap[x.position].sum += x.overall || 0;
  }
  const dimSum = {}, dimCnt = {};
  for (const x of h) for (const [k, v] of Object.entries(x.dims || {})) { dimSum[k] = (dimSum[k] || 0) + v; dimCnt[k] = (dimCnt[k] || 0) + 1; }
  return {
    totalUsers: data.users.length,
    totalInterviews: h.length,
    avgOverall: mean(h.map(x => x.overall || 0)),
    byPosition: Object.entries(posMap).map(([position, v]) => ({ position, count: v.count, avg: Math.round(v.sum / v.count) })),
    dimAvg: Object.keys(dimSum).map(k => ({ key: k, avg: Math.round(dimSum[k] / dimCnt[k]) })),
    recent: h.slice().sort((a, b) => b.finishedAt - a.finishedAt).slice(0, 10).map(x => {
      const u = data.users.find(u => u.id === x.userId);
      return { id: x.id, user: u ? u.name : '未知', position: x.position, overall: x.overall, at: x.finishedAt };
    })
  };
}

function adminStudents() {
  return data.users.map(u => {
    const hist = data.history.filter(x => x.userId === u.id);
    const avg = hist.length ? Math.round(hist.reduce((a, x) => a + (x.overall || 0), 0) / hist.length) : 0;
    const last = hist.length ? Math.max(...hist.map(x => x.finishedAt)) : 0;
    const weak = {};
    for (const x of hist) for (const [k, v] of Object.entries(x.dims || {})) (weak[k] = weak[k] || []).push(v);
    const weakest = Object.entries(weak).map(([k, arr]) => [k, arr.reduce((a, b) => a + b, 0) / arr.length]).sort((a, b) => a[1] - b[1])[0];
    return { id: u.id, name: u.name, count: hist.length, avg, last, weakestKey: weakest ? weakest[0] : '', weakestAvg: weakest ? Math.round(weakest[1]) : 0 };
  }).sort((a, b) => b.count - a.count || b.avg - a.avg);
}

function adminAudits() {
  return data.audits.slice().sort((a, b) => b.at - a.at);
}

function adminExportCsv() {
  const rows = [['姓名', '岗位', '综合分', '轮次', '模式', '开始时间', '结束时间', ...Object.keys((data.history[0] && data.history[0].dims) || {})]];
  for (const x of data.history) {
    const u = data.users.find(u => u.id === x.userId);
    rows.push([
      u ? u.name : '未知', x.position, x.overall, x.rounds, x.mode === 'voice' ? '语音' : x.mode === 'video' ? '视频' : '文字',
      new Date(x.startedAt).toLocaleString('zh-CN'), new Date(x.finishedAt).toLocaleString('zh-CN'),
      ...Object.values((x.dims) || {})
    ]);
  }
  return '\ufeff' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

module.exports = {
  init, newId, findOrCreateUser, getUser, saveSession, getSession, addHistory,
  historyOf, growthOf, verifyAdminPass, adminStats, adminStudents, adminAudits, adminExportCsv,
  stats, audit, flush
};
