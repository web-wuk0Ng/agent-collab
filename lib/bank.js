/**
 * 岗位题库：加载 data/questions/*.json，构建面试题目计划
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'questions');
let banks = [];

function init() {
  banks = fs.readdirSync(DIR).filter(f => f.endsWith('.json'))
    .map(f => ({ ...JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8')), _file: f }));
}

function positionsMeta() {
  return banks.map(b => ({
    id: b.position,
    name: b.name,
    intro: b.intro,
    skills: b.skills,
    questionCount: b.questions.length,
    custom: !!b._file && b._file.startsWith('custom_')
  }));
}

function getBank(position) {
  return banks.find(b => b.position === position);
}

/**
 * 构建一次面试的题目计划：
 * 保证覆盖 4 类题型，顺序遵循 面试节奏（warm → core → deep），
 * 行为题开场（自我介绍），技术题穿插，深挖与场景压轴。
 */
function buildPlan(position, rounds) {
  const b = getBank(position);
  if (!b) throw new Error('岗位不存在');
  const total = Math.max(3, Math.min(rounds || 6, b.questions.length));
  const byType = {};
  for (const q of b.questions) (byType[q.type] = byType[q.type] || []).push(q);
  // 每类题型内部按 stage 排序：warm → core → deep
  const order = { warm: 0, core: 1, deep: 2 };
  for (const k of Object.keys(byType)) byType[k].sort((a, c) => order[a.stage] - order[c.stage]);

  const plan = [];
  const types = ['behavior', 'tech', 'tech', 'project', 'scenario', 'tech', 'project', 'scenario', 'tech'];
  let ti = 0;
  while (plan.length < total) {
    const t = types[ti % types.length];
    const pool = (byType[t] || []).filter(q => !plan.includes(q));
    if (pool.length) plan.push(pool[0]);
    ti++;
    if (ti > 50) break;
  }
  return plan.map(q => ({ id: q.id, type: q.type, text: q.text }));
}

function findQuestion(position, qid) {
  const b = getBank(position);
  return b ? b.questions.find(q => q.id === qid) : null;
}

/* ---------- 企业自定义题库（管理中心） ---------- */

function rawBank(position) {
  const b = getBank(position);
  if (!b) return null;
  const { _file, ...rest } = b;
  return { ...rest, isCustom: !!_file && _file.startsWith('custom_') };
}

function validateBank(p) {
  if (!p || !String(p.name || '').trim()) throw new Error('岗位名称不能为空');
  if (!Array.isArray(p.questions) || p.questions.length < 3) throw new Error('题目至少 3 道');
  const types = ['tech', 'project', 'scenario', 'behavior'];
  for (const q of p.questions) {
    if (!q || !String(q.text || '').trim()) throw new Error('存在缺少题干的题目');
    if (!types.includes(q.type)) throw new Error(`题型必须是 ${types.join('/')} 之一`);
  }
}

function importCustom(p) {
  validateBank(p);
  const slug = (String(p.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pos').slice(0, 24);
  const position = `custom_${slug}_${Date.now().toString(36).slice(-4)}`;
  const data = {
    position,
    name: String(p.name).trim().slice(0, 30),
    intro: String(p.intro || '企业自定义岗位').slice(0, 200),
    skills: (Array.isArray(p.skills) ? p.skills : []).map(s => String(s).slice(0, 20)).slice(0, 12),
    questions: p.questions.map((q, i) => ({
      id: `c${i + 1}`, type: q.type, stage: ['warm', 'core', 'deep'][i % 3],
      text: String(q.text).trim().slice(0, 500),
      keywords: (Array.isArray(q.keywords) ? q.keywords : []).map(k => String(k).slice(0, 30)).slice(0, 8),
      points: (Array.isArray(q.points) ? q.points : []).map(s => String(s).slice(0, 120)).slice(0, 6)
    }))
  };
  fs.writeFileSync(path.join(DIR, `custom_${position}.json`), JSON.stringify(data, null, 2), 'utf-8');
  init(); // 重新加载
  return { position, name: data.name, questionCount: data.questions.length };
}

function deleteCustom(position) {
  const b = getBank(position);
  if (!b || !b._file || !b._file.startsWith('custom_')) throw new Error('内置岗位题库不允许删除，仅可删除企业自定义题库');
  fs.unlinkSync(path.join(DIR, b._file));
  init();
  return { ok: true };
}

module.exports = { init, positionsMeta, getBank, buildPlan, findQuestion, rawBank, importCustom, deleteCustom };
