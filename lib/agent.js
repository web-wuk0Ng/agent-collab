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

/** 构造决策上下文（流式与非流式共用同一份提示词，保证两条路径行为一致） */
function buildContext(s, opts) {
  const streamMode = opts.stream === true;
  s.agentCtx = Object.assign({}, s.agentCtx, {
    question: opts.question || (s.agentCtx && s.agentCtx.question),
    lastAnswer: opts.answer || '',
    canSwitch: opts.canSwitch !== false
  });
  const memory = s.agentMemory || { observations: [], askedIds: [] };
  const askedList = (s.rounds || []).map((r, i) => `${i + 1}. ${r.question ? r.question.text : ''}`).join('\n');
  const observations = memory.observations.slice(-6).map(o => '- ' + o.note).join('\n') || '（暂无）';
  const weakPoints = (memory.weakPoints || []).slice(-6).join('、') || '（暂无）';
  const progress = `${(s.rounds || []).length}/${(s.plan || []).length}`;

  const difficultyLine = opts.difficulty === 'easier'
    ? '⚠ 候选人刚刚要求「换简单一点」：立刻降低难度，回到基础概念、给具体场景引导，不要再深挖。'
    : opts.difficulty === 'harder'
      ? '⚠ 候选人刚刚要求「换难一点」：往源码、线上故障、边界条件、性能权衡方向继续深挖。'
      : '';
  const cmdLine = opts.command === 'next'
    ? '⚠ 候选人要求「下一题」：不要点评，直接一句话过渡并出新题（题目用 find_question 或自己生成）。'
    : '';

  return {
    role: 'system',
    content:
`你是一场真实语音电话面试中的资深技术面试官。你不是在念脚本，而是**边听边思考**的真人，
候选人正在等你开口，你的每句话都会被直接念给他听。

【岗位】${s.position}
【当前讨论分支】${opts.branch || '由当前题目所属技术领域决定，可随候选人提到的新技术自然延伸到任何方向'}
【当前题目】${opts.question ? opts.question.text : '（无）'}
【参考考察点】${JSON.stringify((opts.question && opts.question.points) || [])}
【候选人刚才说的话（语音识别原始文本，可能有谐音/断句错误）】${(opts.answer || '（还没回答）').slice(0, 1500)}
【本场已问过】${askedList || '（无）'}
【你对他的观察记忆】${observations}
【已知薄弱点】${weakPoints}
【进度】${progress}
${difficultyLine}${cmdLine}

=== 一、怎么理解他刚才说的话（最重要）===
他的话来自语音识别，会有谐音、发音混淆、断句错乱、陌生名词跑偏。靠上下文推断他原本要表达的意思：
1. 禁止固定术语对照表式的机械替换；用「本场上下文 + 当前技术领域 + 前后端常识」推理语义。
2. 优先级：上下文主线 > 字面读音（聊打包工具时"vite"谐音 → Vite；聊 Java 中间件时同音 → 中间件概念）。
3. 陌生的框架 / 小众库 / 自研组件 / 新 API：不要默认是识别错误，当成你不了解的技术正常追问细节。
4. 上下文不足以锁定、存在多种可能时：禁止脑补改写，温和确认一句"刚刚你说的是 XXX 吗？"，此时不要推进流程。
5. 内部消化即可，不要对他说"你识别错了/我没听清"，也不要频繁复述原话。

=== 二、出题推进（开放式知识树，不限固定技术栈）===
技术栈是无限的：JS/TS、浏览器、框架、构建、网络、数据库、缓存、Java/Go/Python 生态、消息队列、
分布式、容器云、工程化、监控、CI/CD，以及任何新兴小众方向 —— 他提到 Rust 后端、SolidJS 之类，
你直接跟过去提问，不需要预配置。
- 答得完整（能讲原理、边界、踩坑）→ 同分支往底层 / 源码 / 线上场景钻
- 有思路但浅或要点缺失 → 留在同一层级，针对缺口续问，不跨分支乱跳
- 理解错误或不会 → 给一点引导，回落基础难度，换同大类的基础问题，绝不卡死
- 已充分或已追问过一次 → 一句简短点评后进下一题

=== 三、说话的方式（会被直接念出来）===
- 口语短句，像一个正常的大厂面试官在聊天：自然平稳，不要播音腔、不要书面长难句。
- 不要输出 Markdown、代码块、特殊符号、括号嵌套、项目符号；纯口语文字。
- 一题一问：永远只抛出**一个**问题，禁止一次给好几道题。
- 点评规范：他答完后先肯定亮点，再点出缺失或错误，**点到为止**，不要长篇讲课。
- 不允许打压式提问；答错以引导为主。

${opts.canSwitch === false
  ? '⚠ 这是本场最后一题，不允许再换新题。请就当前题目追问或直接收尾。'
  : `你还剩 ${opts.remaining !== undefined ? opts.remaining : '若干'} 道题的余地，必要时可用 find_question 换一道更合适的题（也可以自己出题，直接写在 nextQuestion 里）。`}
${(opts.followCount | 0) > 0 ? '⚠ 这道题你已经追问过一次了，不要再追问第二层，给一句简短点评后进入下一题。' : ''}

${streamMode ? '' : TOOL_DESC + '\n\n'}

严格按这个 JSON 格式输出（不要其他文字，不要 Markdown）。
字段顺序很重要 —— 请把 final 放在最前面，这样你的话会被最先生成、最先念出来：
{"final":"你要说出口的话（口语化中文，1-2 句，务必先写它）","thought":"你此刻的思考（一句话，会展示给候选人看你在想什么）","understood":"你对候选人原话的还原理解（他要表达的意思；可以直接用原话，不要写备注）","action":{"tool":"工具名","args":{...}} 或 null,"clarify":true/false,"nextQuestion":"若决定进入下一题，新题目的完整问法；没有就填空字符串"}

要求（关于速度，务必遵守）：
- 候选人正等着你开口，**每一次大模型往返都是他真切的等待**。
- 大多数情况（约八成）你看完回答就能直接决定 → 立即给 final，不要调任何工具。
- 只有确实需要工具结果才能决定时才调 action，且最多调一次。
- final 里不要念题目编号，不要直接给标准答案。`
  };
}

/**
 * 增量读取 JSON 字符串字段：模型还在往外吐字时就把已经成形的部分拿到手。
 * 这是"边生成边念出声"的关键 —— 不等整段 JSON 收完。
 * @returns null（还没看到这个字段） | { text, done }
 */
function readStringField(buf, key) {
  const keyIdx = buf.indexOf(`"${key}"`);
  if (keyIdx < 0) return null;
  const colon = buf.indexOf(':', keyIdx + key.length + 2);
  if (colon < 0) return null;
  let i = colon + 1;
  while (i < buf.length && /\s/.test(buf[i])) i++;
  if (buf[i] !== '"') return null;
  i++;
  let out = '';
  const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
  for (; i < buf.length; i++) {
    const ch = buf[i];
    if (ch === '\\') {
      const nx = buf[i + 1];
      if (nx === undefined) break;   // 转义符还没到齐，等下一个分片
      out += (map[nx] !== undefined ? map[nx] : nx);
      i++;
      continue;
    }
    if (ch === '"') return { text: out, done: true };
    out += ch;
  }
  return { text: out, done: false };
}

/**
 * Agent 主循环。
 * @param onDelta 可选：流式回调（拿到 final 字段的新增内容就立刻回调一次，用于提前开念）
 */
async function run(s, opts = {}, onDelta = null) {
  const useStream = typeof onDelta === 'function';
  const trace = [];
  s.agentTrace = [];   // 每轮决策独立记账，避免跨轮累积把 prompt 撑爆
  const system = buildContext(s, Object.assign({}, opts, { stream: useStream }));

  let final = '', thought = '', understood = '', clarify = false, nextQuestion = '';
  // 实时对话（流式）只允许一步：候选人正等着开口，不能让他等第二次大模型往返。
  // 工具调用留给后台预取路径，既保证速度又不丢 Agent 的自主性。
  const maxSteps = useStream ? 1 : MAX_STEPS;

  for (let step = 0; step < maxSteps; step++) {
    const lastStep = step === maxSteps - 1;
    const messages = [system, ...trace.map(t => ({ role: 'user', content: t }))];
    if (lastStep) messages.push({ role: 'user', content: '这是最后一步，不允许再调用工具，必须给出 final（你要说出口的话）。' });

    let j = null;
    if (useStream) {
      // —— 流式：一边生成一边把 final 的增量交给调用方（前端可立即开始朗读）——
      let stepBuf = '', emitted = 0, suppressed = false;
      const raw = await llm.chatStream(messages, { temperature: 0.5, maxTokens: 360, jsonMode: true }, chunk => {
        stepBuf += chunk;
        // 这一步若已出现工具调用，说明 final 不是最终答复（可能只是空串），先不播
        if (!suppressed && /"action"\s*:\s*\{/.test(stepBuf)) suppressed = true;
        if (suppressed) return;
        const cur = readStringField(stepBuf, 'final');
        if (cur && cur.text.length > emitted) {
          const delta = cur.text.slice(emitted);
          emitted = cur.text.length;
          if (delta.trim()) onDelta(delta);
        }
      });
      j = parseStep(raw) || {};
      if (!j.final && emitted > 0) j.final = (readStringField(raw, 'final') || {}).text || '';
    } else {
      try {
        const out = await llm.chat(messages, { temperature: 0.5, maxTokens: 360, jsonMode: true });
        j = parseStep(out) || {};
      } catch {
        break;   // 解析失败 → 交给上层规则兜底
      }
    }

    if (j.thought) thought = j.thought;
    if (j.understood) understood = j.understood;
    if (j.clarify === true) clarify = true;
    if (j.nextQuestion) nextQuestion = String(j.nextQuestion);
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
      if (String(j.final || '').trim()) { final = String(j.final).trim(); break; }
      continue;
    }
    if (String(j.final || '').trim()) { final = String(j.final).trim(); break; }
  }

  return {
    line: final,
    thought,
    understood,
    clarify,
    nextQuestion,
    trace: s.agentTrace || [],
    steps: trace.length
  };
}

/** 一步输出里挑出 JSON 对象（容忍代码块围栏、前后夹带） */
function parseStep(out) {
  try { return JSON.parse(String(out).replace(/```json|```/g, '').trim()); } catch {}
  try {
    const m = String(out).match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch {}
  return null;
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

/** 对外统一入口：在线走 Agent 循环，异常自动降级
 *  @param onDelta 可选：流式回调（边生成边把要说的字交给前端去念，实现"边想边说"） */
async function decide(s, opts, onDelta = null) {
  try {
    if (!llm.isConfigured || !llm.isConfigured()) return offlineFallback(s, opts);
    const r = await run(s, opts, onDelta);
    if (!r.line) return offlineFallback(s, opts);
    return r;
  } catch (e) {
    console.error('[agent] fallback:', e.message);
    return offlineFallback(s, opts);
  }
}

module.exports = { decide, run, offlineFallback, TOOLS };
