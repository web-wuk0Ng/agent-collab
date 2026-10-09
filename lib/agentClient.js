/**
 * Python Agent 服务客户端（面试系统 ↔ agent-collab 的 Python 面试官 Agent）
 *
 * 面试系统网页右上角「AI 设置」把引擎切换为「Python Agent 服务」后，
 * 面试官的开场白、追问、过渡与评估报告都会转发给 Python 服务完成，
 * 由它统一做「知识库检索 → 追问决策 → 结构化评估」。
 *
 * 服务地址默认 http://127.0.0.1:8000，可在页面配置或环境变量 MM_AGENT_URL 指定。
 */

const DEFAULT_URL = process.env.MM_AGENT_URL || 'http://127.0.0.1:8000';
const TIMEOUT_MS = 90000;

function baseUrl(cfg) {
  return String((cfg && cfg.agentUrl) || DEFAULT_URL).trim().replace(/\/+$/, '');
}

async function request(cfg, method, path, payload) {
  const url = `${baseUrl(cfg)}${path}`;
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Python Agent ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

/** 健康检查：确认 Python Agent 服务在线 */
async function health(cfg) {
  const data = await request(cfg, 'GET', '/health');
  return {
    online: data.status === 'ok',
    version: data.version,
    engine: data.engine,
    knowledge: data.knowledge
  };
}

/** 服务与知识库状态（用于设置面板展示） */
const status = (cfg) => request(cfg, 'GET', '/ai/status');

const positions = (cfg) => request(cfg, 'GET', '/positions');

/** 开场白：{ text, engine, references } */
const greeting = (cfg, payload) => request(cfg, 'POST', '/interview/greeting', payload);

/** 追问：{ reply, engine, references } */
const followUp = (cfg, payload) => request(cfg, 'POST', '/interview/followup', payload);

/** 点评 + 过渡到下一题：{ reply, engine, references } */
const next = (cfg, payload) => request(cfg, 'POST', '/interview/next', payload);

/** 评估报告：{ report } */
const report = (cfg, payload) => request(cfg, 'POST', '/interview/report', payload);

/** 按 JD 定制出题：{ questions, applied } */
const jdQuestions = (cfg, payload) => request(cfg, 'POST', '/interview/jd-questions', payload);

/** 知识库检索演示：{ hits } */
const knowledgeSearch = (cfg, payload) => request(cfg, 'POST', '/knowledge/search', payload);

module.exports = {
  DEFAULT_URL,
  baseUrl,
  health,
  status,
  positions,
  greeting,
  followUp,
  next,
  report,
  jdQuestions,
  knowledgeSearch
};
