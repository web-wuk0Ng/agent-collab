/**
 * 本地 JSON 数据层（data/db.json）
 * 用户 / 面试会话 / 历史 / 成长曲线
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'db.json');
let data = null;

function init() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  if (fs.existsSync(FILE)) {
    try { data = JSON.parse(fs.readFileSync(FILE, 'utf-8')); }
    catch { data = null; }
  }
  if (!data) data = { users: [], sessions: {}, history: [], seq: 0 };
  if (!data.admin) data.admin = { pass: 'mockmirror2026' }; // 管理中心默认口令，可在 data/db.json 修改
  compact();
  persist();
}

/** 数据压缩：进行中的超 24h 清理；已结束会话只保留最近 30 场（摘要在 history） */
function compact() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const finished = Object.keys(data.sessions)
    .filter(id => data.sessions[id].status === 'finished')
    .sort((a, b) => (data.sessions[b].finishedAt || 0) - (data.sessions[a].finishedAt || 0));
  const drop = new Set(finished.slice(30));
  for (const id of Object.keys(data.sessions)) {
    const s = data.sessions[id];
    if (drop.has(id) || (s.status === 'ongoing' && s.startedAt < cutoff)) delete data.sessions[id];
  }
}

function persist() {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1), 'utf-8');
}

function newId(prefix) {
  data.seq += 1;
  return `${prefix}_${Date.now().toString(36)}${data.seq.toString(36)}`;
}

function findOrCreateUser(name) {
  let u = data.users.find(x => x.name === name);
  if (!u) {
    u = { id: newId('u'), name, createdAt: Date.now() };
    data.users.push(u);
    persist();
  }
  return u;
}

function getUser(id) { return data.users.find(u => u.id === id); }

function saveSession(s) {
  data.sessions[s.id] = s;
  persist();
}

function getSession(id) { return data.sessions[id] || null; }

function addHistory(session) {
  const r = session.report || {};
  data.history.push({
    id: session.id,
    userId: session.userId,
    position: session.position,
    mode: session.mode,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    rounds: (session.rounds || []).length,
    overall: r.overall || 0,
    dims: r.dimensions ? Object.fromEntries(r.dimensions.map(d => [d.key, d.score])) : {}
  });
  compact();
  persist();
}

function historyOf(userId) {
  return data.history
    .filter(h => h.userId === userId)
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, 50);
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

/* ---------- 管理中心（企业/教师视角） ---------- */

function adminPass() { return (data.admin && data.admin.pass) || 'mockmirror2026'; }

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

module.exports = { init, newId, findOrCreateUser, getUser, saveSession, getSession, addHistory, historyOf, growthOf, adminPass, adminStats, adminStudents, adminExportCsv };
