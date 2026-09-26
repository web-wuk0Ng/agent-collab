/**
 * LLM 服务层：
 * 1) OpenAI 兼容接口客户端（baseUrl / apiKey / model 可配置，保存在本地 config.local.json）
 * 2) 未配置时的离线演示引擎（规则生成追问 + 启发式评估），保证全流程可运行
 */
const fs = require('fs');
const path = require('path');
const rag = require('./rag');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.local.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); }
  catch { return { baseUrl: '', apiKey: '', model: '' }; }
}

function saveConfig(p) {
  const cfg = {
    baseUrl: String(p.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(p.apiKey || '').trim(),
    model: String(p.model || '').trim()
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  return publicConfig();
}

function publicConfig() {
  const c = loadConfig();
  return {
    configured: !!(c.baseUrl && c.model),
    baseUrl: c.baseUrl,
    model: c.model,
    mode: (c.baseUrl && c.model) ? 'llm' : 'offline',
    hasKey: !!c.apiKey
    // 注意：apiKey 永远不回传前端
  };
}

function modeLabel() {
  const c = loadConfig();
  return (c.baseUrl && c.model) ? `在线大模型（${c.model}）` : '离线演示引擎（未配置大模型，可在页面右上角「AI 设置」接入）';
}

/** OpenAI 兼容 chat/completions 调用 */
async function chat(messages, { temperature = 0.6, maxTokens = 1200, jsonMode = false } = {}) {
  const c = loadConfig();
  if (!(c.baseUrl && c.model)) throw new Error('LLM_NOT_CONFIGURED');
  const headers = { 'Content-Type': 'application/json' };
  if (c.apiKey) headers.Authorization = `Bearer ${c.apiKey}`;
  const body = { model: c.model, messages, temperature, max_tokens: maxTokens };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const resp = await fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LLM ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
}

/** 容错 JSON 解析（剥离 markdown 代码围栏等） */
function parseJsonLoose(s) {
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

/* ============ 离线演示引擎 ============ */

const OPENERS = {
  warm: '好的，我们进入下一部分。',
  core: '好的，接下来是技术环节。',
  deep: '很好，那我们聊深入一点。'
};

function offlineFollowUp(position, q, answer, metrics) {
  const len = (answer || '').length;
  const kwHit = (q.keywords || []).filter(k => answer.includes(k));
  if (len < 30) return '这个回答有点简短。能再展开讲讲吗？比如它的工作机制或者你实际用过的地方。';
  if (kwHit.length === 0) return `嗯，我听到了你的思路。不过我想追问一下：你能结合具体细节再说明一下「${(q.keywords && q.keywords[0]) || '核心概念'}」吗？`;
  if (kwHit.length >= 3 && q.type !== 'behavior') return `不错，基础点你都覆盖了。那追问一个：在实际项目中它可能带来什么问题，你会怎么规避？`;
  return '明白。那你能结合一个具体的场景或例子，再深入一层讲讲吗？';
}

function offlineGreeting(position, rounds) {
  const b = require('./bank').getBank(position);
  const name = b ? b.name : position;
  return `你好，欢迎参加本次模拟面试。我是你的 AI 面试官，今天面试的岗位方向是「${name}」，大约 ${rounds || 6} 个问题，请放轻松，尽量把你的思考过程讲清楚。那我们开始第一个问题：`;
}

function isConfigured() { const c = loadConfig(); return !!(c.baseUrl && c.model); }

/**
 * 企业落地：根据岗位 JD 定制面试题（仅在线模式可用，失败返回 null 走标准题库）
 */
async function generateJdQuestions(jd, position) {
  try {
    const out = await chat([
      { role: 'system', content: '你是资深技术面试官与出题专家，只输出合法 JSON。' },
      {
        role: 'user',
        content:
`以下是某企业发布的一个技术岗位的招聘描述（JD），岗位大类是「${position}」。请针对该 JD 定制 6 道模拟面试题，要求：2 道技术知识题（紧扣 JD 中的技术栈要求）、2 道项目/场景题（模拟该岗位真实工作场景）、1 道项目经历深挖题、1 道行为题。每题给出考察关键词（3~6 个）。

岗位JD：
${jd.slice(0, 2000)}

严格输出 JSON：{"questions":[{"type":"tech|project|scenario|behavior","text":"题目","keywords":["关键词"]}]}`
      }
    ], { temperature: 0.5, maxTokens: 1800, jsonMode: true });
    const j = parseJsonLoose(out);
    const qs = j && Array.isArray(j.questions) ? j.questions.filter(q => q && q.text) : null;
    return qs && qs.length >= 3 ? qs : null;
  } catch (e) { console.error('[llm] jd gen fallback:', e.message); return null; }
}

/* ============ 面试官对话（在线优先，离线兜底） ============ */

const INTERVIEWER_SYSTEM = position => ({
  role: 'system',
  content:
`你是一位严谨、专业但友善的技术面试官，正在对一名计算机专业学生进行「${position}」岗位的模拟面试。
规则：
1. 你会收到面试题目、候选人回答、以及从岗位知识库检索到的参考资料。
2. 你要决定下一句话：如果回答明显有可深挖的点（含糊、错误、只答表面），就提出一个追问（围绕本题，一次只问一个问题）；如果回答已充分或已追问过一次，就用一句简短点评过渡并抛出指定的下一道题。
3. 语言自然口语化，像真人面试官，每次输出 1~3 句话，不要输出任何多余格式。不要直接给出标准答案。`
});

function interviewerSystem(position) { return INTERVIEWER_SYSTEM(position); }

async function interviewerGreeting(position, firstQ, rounds) {
  const c = loadConfig();
  if (c.baseUrl && c.model) {
    try {
      return await chat([
        INTERVIEWER_SYSTEM(position),
        { role: 'user', content: `面试开始。第一道题目是：「${firstQ.text}」。请输出开场欢迎语并自然地抛出这道题。` }
      ], { temperature: 0.7, maxTokens: 300 });
    } catch (e) { console.error('[llm] greeting fallback:', e.message); }
  }
  return offlineGreeting(position, rounds);
}

/**
 * 生成面试官下一句话
 * @param s 会话
 * @param round 当前轮 {question(题库原文), answer, metrics, followCount}
 * @param nextQ 下一题（可为 null 表示最后一轮）
 */
async function interviewerNext(s, round, nextQ) {
  const c = loadConfig();
  const q = round.question;
  if (c.baseUrl && c.model) {
    try {
      const ctx = rag.context(s.position, q.text, 2);
      const userMsg =
`当前题目（类型：${q.type}）：${q.text}
候选人回答：${round.answer || '（未作答）'}
${round.metrics ? `语音表达指标：语速 ${round.metrics.wpm} 字/分钟，时长 ${round.metrics.seconds} 秒，口头禅 ${round.metrics.fillers} 次。` : ''}
${round.followCount > 0 ? '（本题已经追问过一次，请过渡到下一题）' : ''}
${ctx ? '岗位知识库参考资料：\n' + ctx : ''}
${nextQ ? `下一道题目：「${nextQ.text}」` : '（这是最后一题，请用一两句收尾，感谢候选人，不问新问题）'}`;
      return await chat([INTERVIEWER_SYSTEM(s.position), { role: 'user', content: userMsg }], { temperature: 0.7, maxTokens: 400 });
    } catch (e) { console.error('[llm] next fallback:', e.message); }
  }
  // 离线引擎
  if (!nextQ) return '好的，今天的面试就到这里。你的整体表现不错，稍后会为你生成一份详细的评估报告，感谢你的时间。';
  return 'OK，这题先聊到这。下一个问题：' + nextQ.text;
}

/* ============ 评估报告 ============ */

/* ---- 仪态表现维度（视频面试，由前端本地视觉分析结果计算） ---- */

function videoDimension(vm) {
  const score = Math.round(
    Math.max(0, Math.min(100,
      0.40 * vm.gazePct + 0.25 * vm.steadyPct + 0.25 * vm.presencePct +
      0.10 * Math.min(vm.smilePct * 1.6, 100)
    ))
  );
  const parts = [];
  parts.push(vm.presencePct >= 90 ? '全程保持出镜' : vm.presencePct >= 70 ? '偶尔离开画面' : '较多时间不在镜头内');
  parts.push(vm.gazePct >= 70 ? '视线专注度高，基本直视镜头' : vm.gazePct >= 45 ? '视线偶有偏移' : '频繁看向别处，目光接触不足');
  parts.push(vm.steadyPct >= 70 ? '头部姿态稳定' : '头部晃动较多');
  parts.push(vm.smilePct >= 15 ? '表情自然，有适度微笑' : '表情偏严肃紧张');
  return {
    key: 'video', name: '仪态表现', score,
    comment: parts.join('；') + `（采样 ${vm.samples} 次）`
  };
}

async function evaluateReport(s) {
  const c = loadConfig();
  if (c.baseUrl && c.model) {
    try { return await llmEvaluate(s); }
    catch (e) { console.error('[llm] report fallback:', e.message); }
  }
  return offlineEvaluate(s);
}

async function llmEvaluate(s) {
  const roundsDesc = s.rounds.map((r, i) => {
    const m = r.metrics ? `\n[语音指标] 语速 ${r.metrics.wpm} 字/分、时长 ${r.metrics.seconds}s、口头禅 ${r.metrics.fillers} 次、识别置信参考 ${r.metrics.confidence}` : '';
    return `### 第${i + 1}题（类型：${r.question.type}）\n题目：${r.question.text}\n回答：${r.answer || '（未作答）'}${m}\n追问及回答：${(r.followUps || []).map(f => `问：${f.q} 答：${f.a || '（未答）'}`).join('；') || '无'}`;
  }).join('\n\n');

  const kbCtx = rag.context(s.position, s.rounds.map(r => r.question.text).join(' '), 3);
  const vm = s.videoMetrics;
  const prompt =
`你是资深技术面试评估专家。请基于岗位知识库参考资料，对以下「${s.position}」岗位模拟面试的问答记录做深度评估。

${vm ? `注：本次为视频面试，系统已通过本地视觉分析测得仪态指标——出镜率 ${vm.presencePct}%、视线专注 ${vm.gazePct}%、头部稳定 ${vm.steadyPct}%、自然微笑 ${vm.smilePct}%（该维度由系统单独计分，你无需评分，但可在建议中结合临场表现给出提升建议）。\n` : ''}
${kbCtx ? '岗位知识库参考资料：\n' + kbCtx + '\n' : ''}
问答记录：
${roundsDesc}

请严格输出如下 JSON（不要输出其它内容）：
{
  "overall": 0-100 的综合分,
  "dimensions": [
    {"key":"content","name":"技术正确性","score":0-100,"comment":"一句话点评"},
    {"key":"depth","name":"知识深度","score":0-100,"comment":"一句话点评"},
    {"key":"logic","name":"逻辑严谨性","score":0-100,"comment":"一句话点评"},
    {"key":"match","name":"岗位匹配度","score":0-100,"comment":"一句话点评"},
    {"key":"expression","name":"语言表达","score":0-100,"comment":"结合语速/口头禅/时长等语音指标点评"}
  ],
  "perRound": [{"question":"题干摘要","score":0-100,"good":"亮点一句话","bad":"不足一句话","keyPoint":"本题考察的核心要点与标准方向"}],
  "strengths": ["亮点1","亮点2","亮点3"],
  "weaknesses": ["不足1","不足2","不足3"],
  "advice": ["具体改进建议1（要可执行）","建议2","建议3"],
  "plan": [{"week":"第1周","task":"练习任务"},{"week":"第2周","task":"练习任务"},{"week":"第3周","task":"练习任务"}],
  "resources": ["推荐学习资源1（知识点/文章/题目）","资源2","资源3"]
}`;
  const out = await chat([
    { role: 'system', content: '你是严谨的面试评估引擎，只输出合法 JSON。' },
    { role: 'user', content: prompt }
  ], { temperature: 0.3, maxTokens: 2500, jsonMode: true });
  const j = parseJsonLoose(out);
  if (!j || !Array.isArray(j.dimensions)) throw new Error('评估 JSON 解析失败');
  return normalizeReport(j, s);
}

function normalizeReport(j, s) {
  const DIMS = { content: '技术正确性', depth: '知识深度', logic: '逻辑严谨性', match: '岗位匹配度', expression: '语言表达' };
  const dimensions = (j.dimensions || []).map(d => ({
    key: d.key, name: d.name || DIMS[d.key] || d.key,
    score: clampScore(d.score), comment: String(d.comment || '')
  }));
  if (s.videoMetrics && s.videoMetrics.samples > 0) dimensions.push(videoDimension(s.videoMetrics));
  const avg = dimensions.length ? Math.round(dimensions.reduce((a, d) => a + d.score, 0) / dimensions.length) : 60;
  return {
    generatedAt: Date.now(),
    engine: loadConfig().model ? 'llm' : 'offline',
    overall: avg,
    dimensions,
    perRound: (j.perRound || []).slice(0, s.rounds.length).map(r => ({
      question: String(r.question || ''), score: clampScore(r.score),
      good: String(r.good || ''), bad: String(r.bad || ''), keyPoint: String(r.keyPoint || '')
    })),
    strengths: (j.strengths || []).map(String).slice(0, 5),
    weaknesses: (j.weaknesses || []).map(String).slice(0, 5),
    advice: (j.advice || []).map(String).slice(0, 6),
    plan: (j.plan || []).slice(0, 6).map(p => ({ week: String(p.week || ''), task: String(p.task || '') })),
    resources: (j.resources || []).map(String).slice(0, 6)
  };
}

function clampScore(n) { n = Number(n); if (!isFinite(n)) return 0; return Math.max(0, Math.min(100, Math.round(n))); }

/* ---- 离线评估：启发式规则 ---- */

function offlineEvaluate(s) {
  const dims = { content: [], depth: [], logic: [], match: [], expression: [] };
  const perRound = [];
  for (const r of s.rounds) {
    const ans = r.answer || '';
    const len = ans.length;
    const kws = r.question.keywords || [];
    const hit = kws.filter(k => ans.includes(k));
    const kwRatio = kws.length ? hit.length / kws.length : 0.5;
    // 内容分：关键词覆盖 + 长度合理性
    let content = 40 + kwRatio * 45 + Math.min(len / 10, 15);
    // 深度分：长度 + 是否有举例/数字/对比词
    const depthSignals = (ans.match(/例如|比如|项目|实际|场景|因为|所以|对比|原因/g) || []).length;
    let depth = 35 + Math.min(len / 12, 30) + Math.min(depthSignals * 5, 25);
    // 逻辑分：结构词
    const logicSignals = (ans.match(/首先|其次|然后|最后|第一|第二|第三|综上|分两个|一方面|另一方面/g) || []).length;
    let logic = 40 + Math.min(logicSignals * 10, 35) + Math.min(len / 15, 25);
    // 表达分：语速与口头禅
    let expression = 75;
    if (r.metrics) {
      const w = r.metrics.wpm;
      if (w >= 140 && w <= 230) expression = 85; else if (w < 100 || w > 280) expression = 62;
      expression -= Math.min(r.metrics.fillers * 3, 15);
    }
    if (r.question.type === 'behavior') { content = Math.max(content, 55); depth = Math.max(depth, 55); }
    dims.content.push(content); dims.depth.push(depth); dims.logic.push(logic);
    dims.match.push(content * 0.7 + depth * 0.3); dims.expression.push(expression);
    perRound.push({
      question: r.question.text.slice(0, 40) + (r.question.text.length > 40 ? '…' : ''),
      score: Math.round(content * 0.5 + depth * 0.3 + logic * 0.2),
      good: hit.length ? `提到了 ${hit.slice(0, 3).join('、')} 等关键点` : '回答态度端正，有一定展开',
      bad: kwRatio < 0.4 ? '对核心考点的覆盖不足，有遗漏关键概念' : '部分表述可以更精炼、更有结构',
      keyPoint: `本题考察：${kws.slice(0, 4).join('、') || '综合表达'}（可参考知识库对应章节）`
    });
  }
  const mean = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  const dimensions = [
    { key: 'content', name: '技术正确性', score: mean(dims.content), comment: '' },
    { key: 'depth', name: '知识深度', score: mean(dims.depth), comment: '' },
    { key: 'logic', name: '逻辑严谨性', score: mean(dims.logic), comment: '' },
    { key: 'match', name: '岗位匹配度', score: mean(dims.match), comment: '' },
    { key: 'expression', name: '语言表达', score: mean(dims.expression), comment: '' }
  ].map(d => ({ ...d, comment: d.score >= 80 ? '表现较好，保持节奏' : d.score >= 60 ? '基本达标，仍有提升空间' : '需要重点加强' }));
  if (s.videoMetrics && s.videoMetrics.samples > 0) dimensions.push(videoDimension(s.videoMetrics));

  const overall = mean(dimensions.map(d => d.score));
  const weakest = dimensions.slice().sort((a, b) => a.score - b.score)[0];
  return {
    generatedAt: Date.now(),
    engine: 'offline',
    overall,
    dimensions,
    perRound,
    strengths: [
      perRound.filter(r => r.score >= 60).length ? '多数问题能够展开作答，思路完整' : '面对提问能够保持表达，具备练习基础',
      '回答中能结合关键词展开，具备一定的知识储备',
      '面试过程完整，抗压表现稳定'
    ],
    weaknesses: [
      `「${weakest.name}」相对薄弱，是当前主要短板`,
      '部分回答缺少结构化组织（可尝试"结论先行+分点展开"）',
      '对核心概念的底层原理阐述不够深入'
    ],
    advice: [
      '每道题练习时先给结论，再用"第一/第二/第三"分点论证',
      '对照知识库中的「考点」章节，逐条自查知识盲区',
      '用手机录音自测语速，控制在每分钟 160~220 字，减少"嗯/然后"等口头禅',
      '针对薄弱维度，本周内再做 2 次同岗位模拟并对比分数变化'
    ],
    plan: [
      { week: '第1周', task: `补齐「${weakest.name}」相关知识点：精读知识库对应章节并整理笔记` },
      { week: '第2周', task: '完成 2 次同岗位模拟面试，重点练习结构化表达' },
      { week: '第3周', task: '复盘历次报告，把不足项逐条改写为自己的标准答法并背熟' }
    ],
    resources: [
      '本平台「知识库」模块中该岗位的全部考点章节',
      '岗位技能清单中标注的 2~3 个薄弱技术栈的官方文档',
      '常见面试题合集：每日精练 3 题并录音复盘'
    ]
  };
}

/** 连通性测试：发送一条极短的对话验证配置可用 */
async function testConnect() {
  const c = loadConfig();
  if (!(c.baseUrl && c.model)) return { ok: false, error: '请先填写 Base URL 和模型名' };
  try {
    const out = await chat([{ role: 'user', content: '请只回复两个字：正常' }], { temperature: 0, maxTokens: 10 });
    return { ok: true, reply: out.slice(0, 50) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { publicConfig, saveConfig, modeLabel, isConfigured, testConnect, chat, interviewerSystem, interviewerGreeting, interviewerNext, evaluateReport, generateJdQuestions };
