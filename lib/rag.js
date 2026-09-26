/**
 * RAG 检索增强：将 knowledge/*.md 按二级标题切片，
 * 基于词频（BM25 简化版）做本地检索，返回与查询最相关的知识片段。
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'knowledge');
let corpus = {}; // position -> [{title, text, tf, len}]

function init() {
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.md'))) {
    const position = f.replace(/\.md$/, '');
    const md = fs.readFileSync(path.join(DIR, f), 'utf-8');
    // 按二级标题切片
    const parts = md.split(/\n(?=## )/);
    const chunks = [];
    for (const p of parts) {
      const m = p.match(/^## (.+)$/m);
      const title = m ? m[1].trim() : '概述';
      const text = p.replace(/^## .+$/m, '').trim(); // 正文不含标题行
      if (text.length < 30) continue;
      chunks.push({ title, text });
    }
    // 词频统计（中文按 2-gram + 英文按词）
    corpus[position] = chunks.map(c => {
      const tokens = tokenize(c.title + ' ' + c.text);
      const tf = {};
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      return { ...c, tf, len: tokens.length };
    });
  }
}

function tokenize(s) {
  const tokens = [];
  const en = s.toLowerCase().match(/[a-z][a-z0-9+.#/-]{1,}/g) || [];
  tokens.push(...en);
  const zh = s.replace(/[^\u4e00-\u9fa5]/g, ' ');
  for (const seg of zh.split(/\s+/)) {
    if (seg.length < 2) continue;
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
  }
  return tokens;
}

/**
 * 检索：返回最相关的 k 个片段
 */
function search(position, query, k = 4) {
  const chunks = corpus[position];
  if (!chunks) return [];
  const qtf = {};
  const qTokens = tokenize(query);
  for (const t of qTokens) qtf[t] = (qtf[t] || 0) + 1;
  const N = chunks.length;
  const avgLen = chunks.reduce((a, c) => a + c.len, 0) / N;
  const k1 = 1.5, b = 0.75;
  const scored = chunks.map(c => {
    let score = 0;
    for (const t of Object.keys(qtf)) {
      if (!(t in c.tf)) continue;
      const df = chunks.filter(x => t in x.tf).length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += idf * (c.tf[t] * (k1 + 1)) / (c.tf[t] + k1 * (1 - b + b * c.len / avgLen)) * qtf[t];
    }
    return { title: c.title, text: c.text, score: +score.toFixed(3) };
  });
  return scored.filter(s => s.score > 0).sort((a, x) => x.score - a.score).slice(0, k);
}

/** 检索并拼接为上下文文本（供 Prompt 使用） */
function context(position, query, k = 4) {
  const hits = search(position, query, k);
  if (!hits.length) return '';
  return hits.map((h, i) => `【参考资料${i + 1}·${h.title}】\n${h.text}`).join('\n\n');
}

module.exports = { init, search, context };
