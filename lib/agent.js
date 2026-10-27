/* lib/agent.js —— 面试官 Agent 运行时（Plan → Act → Observe → Re-plan）
 *
 * 与"模板软件"的本质区别：
 *   - 软件：if/else 决定下一句（回答短就追问、否则下一题）—— 固定输入输出
 *   - Agent：每一步由大模型自主决策，并可**调用工具**：
 *       analyze_answer   分析回答（命中/缺失的考察点、深度、是否含糊）→ 真实调用 LLM
 *       search_knowledge 检索岗位知识库（RAG）→ 真实向量/关键词检索
 *       find_question    按知识点从题库里动态挑题（可临时换题/加题）
 *       record_observation 记录候选人画像（薄弱点/亮点），影响后续提问与报告
 *       adjust_plan      动态调整后续面试计划（加深/跳过/换方向）
 *     决策链：思考(thought) → 行动(action) → 观察(observation) → 再思考 → 输出
 *     最多 MAX_STEPS 步，避免死循环；任何异常自动降级到规则逻辑。
 *
 * 每一次决策与工具调用都会记入 s.agentTrace，供前端"面试官思考过程"展示。
 */
const llm = require('./llm');
const rag = require('./rag');
const bank = require('./bank');

const MAX_STEPS = 2;   // 一次交互最多 2 步（1 次工具 + 1 次收尾）；多数情况第 1 步就直接 final

/* ---------------- 工具实现 ---------------- */
const TOOLS = {
  /** 分析回答：命中/缺失的考察点、深度评分、是否含糊（真实 LLM 调用） */
  async analyze_answer(s, args) {
    const q = s.agentCtx && s.agentCtx.question;
    const answer = String(args.answer || s.agentCtx.lastAnswer || '').slice(0, 2000);
    if (!answer.trim()) return { ok: false, note: '候选人还没有实质回答' };
    const out = await llm.chat([
      { role: 'system', content: '你是面试评估助手，只输出合法 JSON，不要任何其他文字。' },
      {
        role: 'user', content:
`题目：${q ? q.text : '（未知）'}
考察要点：${JSON.stringify((q && q.points) || [])}
候选人回答：${answer}

请分析并输出：
{
  "hitPoints": ["已经回答到的考察点"],
  "missPoints": ["明显没答到或答错的考察点"],
  "depth": 1-5 的整数（回答深度，1=只说了名词，5=原理+实践+权衡），
  "vague": true/false（是否含糊、只讲概念没给细节或例子）,
  "mentioned": ["回答里提到的具体技术/概念名词"],
  "suggestedProbe": "如果要追问，最该追问哪个点（一句话）"
}`
      }
    ], { temperature: 0.2, maxTokens: 500, jsonMode: true });
    try {
      const j = JSON.parse(out.replace(/```json|```/g, '').trim());
      return { ok: true, ...j };
    } catch {
      return { ok: true, hitPoints: [], missPoints: [], depth: 3, vague: answer.length < 60, mentioned: [], suggestedProbe: '' };
    }
  },

  /** 检索岗位知识库（真实 RAG） */
  search_knowledge(s, args) {
    const pos = s.position;
    const q = String(args.query || (s.agentCtx.question && s.agentCtx.question.text) || '').slice(0, 200);
    const hits = rag.search(pos, q, 3) || [];
    return { ok: true, query: q, hits: hits.map(h => (h.text || String(h)).slice(0, 160)) };
  },

  /** 按知识点从题库动态挑题（Agent 可临时换题/加题，不再死板按固定顺序） */
  find_question(s, args) {
    // 收尾阶段禁止再换题，否则面试会被无限拉长、永远结束不了
    if (s.agentCtx && s.agentCtx.canSwitch === false) {
      return { ok: false, note: '已进入最后一题，不再换题，请就当前题目收尾。' };
    }
    const topic = String(args.topic || '').trim();
    const type = String(args.type || '').trim();
    const b = bank.getBank(s.position);
    if (!b) return { ok: false, note: '题库不存在' };
    const asked = new Set((s.plan || []).map(x => x.id).concat((s.agentMemory && s.agentMemory.askedIds) || []));
    let pool = b.questions.filter(q => !asked.has(q.id));
    if (type) pool = pool.filter(q => q.type === type);
    if (topic) {
      const kw = topic.toLowerCase();
      const scored = pool.map(q => {
        const text = (q.text + ' ' + (q.keywords || []).join(' ') + ' ' + (q.points || []).join(' ')).toLowerCase();
        return { q, score: (kw.split(/[\s,，、]+/).filter(Boolean).filter(k => text.includes(k)).length) };
      }).filter(x => x.score > 0).sort((a, c) => c.score - a.score);
      pool = scored.map(x => x.q);
    }
    if (!pool.length) return { ok: false, note: '没有匹配的候选题' };
    const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 3))];
    return { ok: true, id: pick.id, type: pick.type, text: pick.text, points: pick.points || [], hint: pick.hint || '' };
  },

  /** 记录候选人画像（影响后续提问与最终报告） */
  record_observation(s, args) {
    s.agentMemory = s.agentMemory || { observations: [], askedIds: [] };
    const note = String(args.note || '').slice(0, 200);
    if (note) s.agentMemory.observations.push({ at: Date.now(), note });
    if (args.tag === 'weak' || args.tag === 'strong') {
      s.agentMemory[args.tag === 'weak' ? 'weakPoints' : 'strongPoints'] =
        (s.agentMemory[args.tag === 'weak' ? 'weakPoints' : 'strongPoints'] || []).concat(String(args.topic || '')).filter(Boolean);
    }
    return { ok: true, note, total: s.agentMemory.observations.length };
  },

  /** 动态调整后续计划：deepen（本知识点继续深挖）/ skip（跳过）/ switch（换知识点） */
  adjust_plan(s, args) {
    const action = String(args.action || '').trim();
    s.agentPlan = s.agentPlan || { adjustments: [] };
    s.agentPlan.adjustments.push({ at: Date.now(), action, reason: String(args.reason || '').slice(0, 120) });
    s.agentPlan.lastAction = action;
    return { ok: true, action, remaining: (s.plan ? s.plan.length : 0) - (s.rounds ? s.rounds.length : 0) };
  }
};

const TOOL_DESC = `你可以使用以下工具（每次最多选一个，也可以直接输出 final 结束思考）：
- analyze_answer: 分析候选人刚才的回答（命中/缺失考察点、深度、是否含糊、最该追问的点）。参数 {"answer":"可选，默认用刚才的回答"}
- search_knowledge: 检索岗位知识库，获取该知识点的参考资料。参数 {"query":"检索词"}
- find_question: 按知识点/题型从题库动态挑一道还没问过的题。参数 {"topic":"知识点关键词","type":"tech|project|scenario|behavior"}
- record_observation: 记录对候选人的观察，会写入面试记忆并影响最终评估。参数 {"note":"观察内容","tag":"weak|strong","topic":"知识点"}
- adjust_plan: 调整后续面试计划。参数 {"action":"deepen|skip|switch","reason":"原因"}`;

/* ---------------- Agent 主循环 ---------------- */
/**
 * @param s      会话（含 plan / rounds / agentMemory / agentCtx）
 * @param opts   { question, answer, stage, allowNextQuestion }
 * @returns { line, thought, actions, usedTools, steps }
 */
async function run(s, opts = {}) {
  const trace = [];
  s.agentTrace = [];   // 每轮决策独立记账，避免跨轮累积把 prompt 撑爆
  s.agentCtx = Object.assign({}, s.agentCtx, {
    question: opts.question || (s.agentCtx && s.agentCtx.question),
    lastAnswer: opts.answer || '',
    canSwitch: opts.canSwitch !== false
  });
  const memory = s.agentMemory || { observations: [], askedIds: [] };
  const askedList = (s.rounds || []).map((r, i) => `${i + 1}. ${r.question ? r.question.text : ''}`).join('\n');
  const observations = memory.observations.slice(-6).map(o => '- ' + o.note).join('\n') || '（暂无）';
  const progress = `${(s.rounds || []).length}/${(s.plan || []).length}`;

  const system = {
    role: 'system',
    content:
`你是「${s.position}」岗位的资深面试官 Agent。你不是在念脚本，你要像真人面试官一样**边听边思考**，每次决策都要先想清楚再说话。

当前题目：${opts.question ? opts.question.text : '（无）'}
考察要点：${JSON.stringify((opts.question && opts.question.points) || [])}
候选人刚才的回答：${(opts.answer || '（还没回答）').slice(0, 1500)}
已问过的题：${askedList || '（无）'}
你对这位候选人的观察记忆：${observations}
进度：${progress}

可选策略（自己判断该用哪种，不要机械）：
1. deepen  —— 回答有料但能更深：就他提到的某个具体技术点追问一层（原理/踩坑/权衡）
2. probe   —— 回答含糊、只背概念、或明显答错：换一个角度让他讲清楚
3. switch  —— 他已经答不上来（说不会/不知道）：换一个知识点或降低难度
4. next    —— 回答已经充分或已追问过一次：一句简短点评，然后进入下一题

${opts.canSwitch === false
  ? '⚠ 这是本场最后一题，不允许再用 find_question 换题。请就当前题目给出追问或收尾（一句简短总结即可）。'
  : `你还剩 ${opts.remaining !== undefined ? opts.remaining : '若干'} 道题的余地，必要时可用 find_question 换一道更合适的题。`}
${(opts.followCount | 0) > 0 ? '⚠ 这道题你已经追问过一次了，不要再追问第二层，给一句简短点评后进入下一题。' : ''}

${TOOL_DESC}

⚠ 关于术语听不清的处理（很容易扣分，务必遵守）：
- 候选人的回答来自语音识别，技术名词可能被听成谐音、中英夹杂或被截断（例如"哈 map"其实是 HashMap）。
- 遇到认不出的技术名词时：**要么按他原话复述**（"你刚才提到的那个哈 map…"），
  **要么泛指**（"你提到的这块技术…"），然后用提问让他确认。
- 严禁自作主张把听不清的词替换成另一个你以为的技术名词
  （反面案例：候选人说"哈 map"，你回应"你提到的那个 MQ" —— 这是严重错误）。

严格按这个 JSON 格式输出（不要其他文字）：
{"thought":"你此刻的思考（一句话，会展示给候选人看到面试官在想什么）","action":{"tool":"工具名","args":{...}} 或 null,"final":"最终说的话（1-3 句口语化中文）；如果还要继续想就填空字符串"}

要求（关于速度，务必遵守）：
- 候选人正等着你开口，**每一次大模型往返都是 3~5 秒的真实等待**。
- 大多数情况（约八成）你看完回答就能直接决定 → 立即给 final，不要调任何工具。
- 只有当你确实需要工具结果才能做出决定时才调 action，且最多调一次。
- final 是你作为面试官说出口的话，1~2 句，自然口语化，不要念题目编号，不要给标准答案
- 若决定进入下一题，可先用 find_question 挑题（此时下一轮再输出 final 并把新题目自然说出来）`
  };

  let final = '', thought = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    const lastStep = step === MAX_STEPS - 1;
    let j;
    try {
      const messages = [system, ...trace.map(t => ({ role: 'user', content: t }))];
      if (lastStep) messages.push({ role: 'user', content: '这是最后一步，不允许再调用工具，必须给出 final（面试官要说出口的话）。' });
      const out = await llm.chat(messages, { temperature: 0.5, maxTokens: 320, jsonMode: true });
      j = JSON.parse(out.replace(/```json|```/g, '').trim());
    } catch (e) {
      break;   // 解析失败 → 交给上层规则兜底
    }
    if (j && j.thought) thought = j.thought;
    trace.push(`[思考] ${j.thought || ''}`);

    // 执行工具（最后一步不再执行工具，直接取 final）
    if (!lastStep && j.action && j.action.tool && TOOLS[j.action.tool]) {
      let obs;
      try {
        obs = await TOOLS[j.action.tool](s, j.action.args || {});
      } catch (e) {
        obs = { ok: false, error: e.message };
      }
      s.agentTrace = (s.agentTrace || []).concat([{ step: step + 1, thought: j.thought, tool: j.action.tool, args: j.action.args, observation: obs }]);
      trace.push(`[工具 ${j.action.tool} 返回] ${JSON.stringify(obs).slice(0, 900)}`);
      if (j.final && String(j.final).trim()) { final = String(j.final).trim(); break; }
      continue;
    }
    // 没有工具调用 → 直接用 final 结束
    if (j.final && String(j.final).trim()) { final = String(j.final).trim(); break; }
  }

  return {
    line: final,
    thought,
    trace: s.agentTrace || [],
    steps: trace.length
  };
}

/** 无 LLM / 大模型返回异常时的规则兜底（保证离线也能把整场面试走完） */
function offlineFallback(s, opts) {
  const q = opts.question || {};
  const answer = (opts.answer || '').trim();
  const len = answer.replace(/\s+/g, '').length;
  const hit = (q.keywords || []).filter(k => answer.includes(k)).length;
  const short = len < 50 || (hit === 0 && len < 150);
  const atLast = opts.canSwitch === false || !opts.defaultNext;
  const asked = (opts.followCount | 0) > 0;

  // 已经追问过一次、或已是最后一题 → 不再追问，直接推进，避免卡在同一题上
  if (asked || atLast || !short) {
    const line = opts.defaultNext
      ? `好的，这一题我们先到这里。${opts.defaultNext}`
      : '好的，这一题我们先到这里。';
    return {
      line,
      thought: atLast ? '已是最后一题，收尾' : '回答已充分，进入下一题',
      wantsNext: true, trace: [], steps: 0, offline: true
    };
  }
  return {
    line: '能再具体一点吗？比如结合你做过的项目，说说当时是怎么处理的。',
    thought: '回答偏短，需要追问细节',
    wantsNext: false, trace: [], steps: 0, offline: true
  };
}

/** 对外统一入口：在线走 Agent 循环，异常自动降级 */
async function decide(s, opts) {
  try {
    if (!llm.isConfigured || !llm.isConfigured()) return offlineFallback(s, opts);
    const r = await run(s, opts);
    if (!r.line) return offlineFallback(s, opts);
    return r;
  } catch (e) {
    console.error('[agent] fallback:', e.message);
    return offlineFallback(s, opts);
  }
}

module.exports = { decide, run, offlineFallback, TOOLS };
