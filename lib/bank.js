/**
 * 岗位题库：加载 data/questions/*.json，构建面试题目计划
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
 * 每类题型内部随机洗牌（stage 有序），让多场面试不重复遇到同一套题。
 */
function buildPlan(position, rounds) {
  const b = getBank(position);
  if (!b) throw new Error('岗位不存在');
  const total = Math.max(3, Math.min(rounds || 6, b.questions.length));
  const byType = {};
  for (const q of b.questions) (byType[q.type] = byType[q.type] || []).push(q);
  // 每类题型内部按 stage 分组（warm → core → deep），组内随机洗牌
  const order = { warm: 0, core: 1, deep: 2 };
  for (const k of Object.keys(byType)) {
    byType[k].sort((a, c) => order[a.stage] - order[c.stage]);
    // 分段洗牌：相同 stage 内随机，避免确定性出题
    const shuffled = [];
    for (const st of ['warm', 'core', 'deep']) {
      const seg = byType[k].filter(q => (q.stage || 'core') === st);
      for (let i = seg.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seg[i], seg[j]] = [seg[j], seg[i]];
      }
      shuffled.push(...seg);
    }
    byType[k] = shuffled;
  }

  const plan = [];
  const types = ['behavior', 'tech', 'tech', 'project', 'scenario', 'tech', 'project', 'scenario', 'tech'];
  let ti = 0;
  while (plan.length < total) {
    const t = types[ti % types.length];
    const pool = (byType[t] || []).filter(q => !plan.includes(q));
    const stage = plan.length === 0 ? 'warm' : plan.length / Math.max(total - 1, 1) >= 0.65 ? 'deep' : 'core';
    if (pool.length) plan.push(pool.find(q => (q.stage || 'core') === stage) || pool[0]);
    ti++;
    if (ti > 50) break;
  }
  // 计划携带考察点与回答思路：前端可在面试中展示「本题押题卡」
  return plan.map(q => ({ id: q.id, type: q.type, text: q.text, points: q.points || [], hint: q.hint || '' }));
}

function findQuestion(position, qid) {
  const b = getBank(position);
  return b ? b.questions.find(q => q.id === qid) : null;
}

/* ---------- 题库只读快照（MCP / 练习工具） ---------- */

function rawBank(position) {
  const b = getBank(position);
  if (!b) return null;
  const { _file, ...rest } = b;
  return { ...rest, isCustom: !!_file && _file.startsWith('custom_') };
}

const normalizeText = s => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
function checkedString(value, field, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new Error(`${field} 必须是 ${min}–${max} 字符的文字`);
  return value.trim();
}
function checkedList(value, field, max) {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new Error(`${field} 必须是 1–${max} 项的数组`);
  return value.map((x, i) => checkedString(x, `${field}[${i + 1}]`, 1, 300));
}
function importQuestions(payload, dryRun = true) {
  if (!payload || payload.schemaVersion !== 1) throw new Error('schemaVersion 必须是数字 1，请使用下载的 JSON 模板');
  const b = getBank(payload.position);
  if (!b) throw new Error('position 必须是现有岗位 ID');
  if (!Array.isArray(payload.questions) || !payload.questions.length || payload.questions.length > 200) throw new Error('每次导入 1–200 道题');
  const seenIds = new Map(b.questions.map(q => [q.id, q]));
  const seenTexts = new Set(b.questions.map(q => normalizeText(q.text)));
  const additions = [], duplicates = [];
  // 整批校验后才允许落盘，任意一题错误都不会产生半批导入。
  payload.questions.forEach((raw, i) => {
    const at = `第 ${i + 1} 题`;
    if (!raw || typeof raw !== 'object') throw new Error(`${at} 必须是对象`);
    const q = {
      id: checkedString(raw.id, `${at} id`, 1, 64),
      type: raw.type, stage: raw.stage,
      text: checkedString(raw.text, `${at} text`, 5, 600),
      keywords: checkedList(raw.keywords, `${at} keywords`, 12),
      points: checkedList(raw.points, `${at} points`, 12),
      hint: checkedString(raw.hint, `${at} hint`, 5, 1200),
      reference: checkedString(raw.reference, `${at} reference`, 30, 6000),
      sources: raw.sources === undefined ? [] : raw.sources
    };
    if (!/^[a-zA-Z0-9_-]+$/.test(q.id)) throw new Error(`${at} id 仅允许英文字母、数字、下划线和短横线`);
    if (!['tech', 'project', 'scenario', 'behavior'].includes(q.type)) throw new Error(`${at} type 必须是 tech/project/scenario/behavior`);
    if (!['warm', 'core', 'deep'].includes(q.stage)) throw new Error(`${at} stage 必须是 warm/core/deep`);
    if (!Array.isArray(q.sources) || q.sources.length > 8) throw new Error(`${at} sources 必须是最多 8 项的 URL 数组`);
    q.sources = q.sources.map(url => {
      checkedString(url, `${at} sources`, 8, 1000);
      let parsed; try { parsed = new URL(url); } catch { throw new Error(`${at} 来源 URL 无效`); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`${at} 来源只支持无凭据的 HTTP/HTTPS 链接`);
      return parsed.href;
    });
    const key = normalizeText(q.text), prior = seenIds.get(q.id);
    if (prior && normalizeText(prior.text) !== key) throw new Error(`${at} id「${q.id}」已被其他题目使用，请更换 id`);
    if (prior || seenTexts.has(key)) { duplicates.push(q.id); return; }
    seenIds.set(q.id, q); seenTexts.add(key); additions.push(q);
  });
  if (b.questions.length + additions.length > 3000) throw new Error('单岗位最多保留 3000 题，请拆分或整理题库');
  const revision = crypto.createHash('sha256').update(JSON.stringify(b.questions)).digest('hex');
  if (!dryRun && payload.revision !== revision) throw new Error('题库已变化或尚未预览，请重新校验预览后再导入');
  if (!dryRun && additions.length) {
    const file = path.join(DIR, b._file);
    const next = { ...b, questions: [...b.questions, ...additions] }; delete next._file;
    fs.copyFileSync(file, file + '.bak');
    fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(file + '.tmp', file);
    b.questions = next.questions;
  }
  return { position: b.position, name: b.name, added: additions.length, skipped: duplicates.length,
    total: b.questions.length + (dryRun ? additions.length : 0), revision,
    preview: additions.map(q => ({ id: q.id, type: q.type, stage: q.stage, text: q.text })) };
}

function importTemplate(position = 'java-backend') {
  if (!getBank(position)) throw new Error('岗位不存在');
  return { schemaVersion: 1, position, questions: [{
    id: 'my_project_001', type: 'project', stage: 'core',
    text: '介绍你在项目中怎样处理接口超时，并说明如何验证改进效果？',
    keywords: ['超时', '监控', '验证'],
    points: ['说明问题与定位证据', '解释超时和重试的边界', '用改进前后的数据验证效果'],
    hint: '按背景、定位过程、解决方案和验证结果展开，避免只列出技术名词。',
    reference: '接口超时应区分连接、读取和整体请求期限。重试要限制次数，并检查操作是否幂等；通过成功率、延迟分位数和日志确认改动效果，不能仅凭平均耗时判断。',
    sources: []
  }] };
}

module.exports = { init, positionsMeta, getBank, buildPlan, findQuestion, rawBank, importQuestions, importTemplate };
