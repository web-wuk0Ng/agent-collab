/**
 * 面试流程控制：处理回答、智能追问节奏、报告生成
 */
const bank = require('./bank');
const llm = require('./llm');
const agent = require('./agent');

/**
 * 提交一轮回答：
 * p = { sessionId, qIndex, answer, metrics? }
 * 每道题允许 0~1 次追问；追问后再次提交即进入下一题。
 * 返回 { nextLine, followUp, question, progress, done }
 */
/** 预取命中判定：候选人说话只增不改 → 预取时拿到的文本必须是提交文本的前缀。
 *  不再截 60 字签名（那样"答案很短 + 结尾说就这些"会因结尾追加而 miss）。 */
const rawOf = txt => String(txt || '').replace(/\s+/g, '');

/**
 * 一次完整决策（追问 / 换题 / 下一题），预取与正式提交共用同一条路径，
 * 保证"边说边备好的回应"与"正式提交的回应"质量、风格完全一致。
 */
/**
 * 一轮周转：调用面试官 Agent 决策，产出「追问」或「下一题」。
 * @param onDelta 可选：流式回调，Agent 一边生成一边把要说的字吐出来（前端可提前开念）
 */
async function computeTurn(s, qIndex, answer, onDelta = null, opts = {}) {
  const planSize = s.planSize || (s.planSize = s.plan.length);
  const q = s.plan[qIndex];
  if (!q) throw new Error('题目序号无效');
  const full = q.full || bank.findQuestion(s.position, q.id);
  if (!full) throw new Error('题目数据缺失');

  const round = { question: full, answer: String(answer || '').slice(0, 4000), metrics: null, followUps: [], followCount: 0 };
  const hasNext = qIndex + 1 < planSize;
  const defaultNextQ = hasNext ? (s.plan[qIndex + 1].full || bank.findQuestion(s.position, s.plan[qIndex + 1].id)) : null;

  const decision = await agent.decide(s, {
    question: full,
    answer: round.answer,
    defaultNext: defaultNextQ ? defaultNextQ.text : null,
    canSwitch: hasNext,                   // 最后一题：禁止再换题
    followCount: round.followCount || 0,  // 首答场景为 0
    remaining: Math.max(0, planSize - qIndex - 1),
    branch: opts.branch || '',
    difficulty: opts.difficulty || '',    // 口头指令：换简单一点 / 换难一点
    command: opts.command || ''           // 口头指令：下一题
  }, onDelta);

  // Agent 若通过 find_question 动态挑了新题，优先用 Agent 挑的（真 Agent 行为：可临时换题）
  let dynamicQ = null;
  const trace = decision.trace || [];
  if (hasNext) {
    for (let i = trace.length - 1; i >= 0; i--) {
      const obs = trace[i].observation;
      if (obs && obs.ok && obs.id && obs.text) { dynamicQ = { id: obs.id, type: obs.type, text: obs.text, points: obs.points || [], hint: obs.hint || '' }; break; }
    }
  }
  // 开放式知识树：题库里没有这个方向时，允许 Agent 自己出题（跟随候选人提到的任意新技术栈）
  if (hasNext && !dynamicQ && decision.nextQuestion && String(decision.nextQuestion).trim().length > 6) {
    const txt = String(decision.nextQuestion).trim().slice(0, 300);
    dynamicQ = { id: `gen_${qIndex + 1}_${Date.now()}`, type: 'tech', text: txt, points: [], hint: '', generated: true };
  }
  // 歧义兜底：Agent 判定「上下文不足以还原术语」→ 温和确认，本轮不推进工作流
  if (decision.clarify) {
    return {
      kind: 'clarify',
      nextLine: decision.line,
      followUp: false,
      question: briefOf(full, qIndex),
      progress: { done: qIndex, total: planSize },
      done: false,
      sameTurn: true,
      agent: { thought: decision.thought, tools: trace.map(t => t.tool), steps: trace.length, trace: briefTrace(trace) }
    };
  }

  // 判断 Agent 意图：是否要继续追问（没有走向下一题）
  const wantsNext = decision.wantsNext === true || !!dynamicQ
    || /下一题|下一个问题|我们再来看|换一道|下一道|换个方向|就到这里|就到这儿|到这儿|今天的面试|今天的问题|收尾/.test(decision.line || '');

  // 追问只在「后面还有题」时允许：否则最后一题会被无限追问，面试永远结束不了
  const canFollowUp = hasNext && !!(decision.line || '').trim();
  if (!wantsNext && canFollowUp) {
    return {
      kind: 'followUp',
      nextLine: decision.line,
      followUp: true,
      question: null,
      progress: { done: qIndex, total: planSize },
      done: false,
      agent: { thought: decision.thought, tools: trace.map(t => t.tool), steps: trace.length, trace: briefTrace(trace) }
    };
  }

  // 进入下一题：优先用 Agent 动态挑的题，否则用计划里的下一题
  const nextQ = hasNext ? (dynamicQ || defaultNextQ) : null;
  if (nextQ && dynamicQ) {
    // 把 Agent 新挑的题写进计划，保证后续统计/报告一致（下标一定在 planSize 内）
    s.plan[qIndex + 1] = Object.assign({}, s.plan[qIndex + 1], { id: nextQ.id, text: nextQ.text, points: nextQ.points || [], hint: nextQ.hint || '' });
  }
  let line = decision.line;
  if (nextQ && line && !line.includes(nextQ.text.slice(0, 8))) {
    line = line + ' ' + nextQ.text;
  }
  // 保险：最后一题若 Agent 仍以问句结尾（像在追问），补一句收尾，保证面试能正常结束
  if (!nextQ && /[？?]$/.test(String(line || '').trim())) {
    line = String(line).trim().replace(/[？?]\s*$/, '。') + ' 今天的面试就到这里，辛苦了。';
  }
  return {
    kind: 'next',
    nextLine: line || (nextQ ? nextQ.text : '今天的面试就到这里，辛苦了。'),
    followUp: false,
    question: nextQ ? briefOf(nextQ, qIndex + 1) : null,
    progress: { done: qIndex + 1, total: planSize },
    done: !nextQ,
    agent: { thought: decision.thought, tools: trace.map(t => t.tool), steps: trace.length, trace: briefTrace(trace) }
  };
}

/**
 * 边听边准备下一步（静默预取）：
 * 候选人还在说话时，后台就按"当前已说内容"预先跑一遍 Agent 决策，
 * 结果挂在 session 上；等他真的提交时若内容是预取文本的延续 → 直接复用，几乎零等待。
 * 同步注册在途任务（s.prefetchTask），正式提交时若预取还没跑完会先等它落地，
 * 而不是丢掉重跑一遍大模型 —— 这是"说完不卡"的关键。
 * 任何异常都静默失败，不影响正式提交。
 */
function prefetchNext(s, p) {
  try {
    const qIndex = p.qIndex | 0;
    const q = s.plan[qIndex];
    if (!q) return { ok: false };
    const answer = String(p.answer || '').slice(0, 4000);
    if (rawOf(answer).length < 2) return { ok: false };
    const task = computeTurn(s, qIndex, answer).then(
      payload => { s.prefetch = { raw: rawOf(answer), qIndex, payload, at: Date.now() }; },
      () => { /* 预取失败无感 */ }
    ).finally(() => { if (s.prefetchTask === task) s.prefetchTask = null; });
    s.prefetchTask = task;
    return { ok: true };
  } catch { return { ok: false }; }
}

// 下发给前端仅含题干与类型：考察点/回答思路是 Agent 评估用的内部数据，不能泄露给候选人
const briefOf = (q, i) => ({ id: q.id, type: q.type, text: q.text, ...(i !== undefined ? { index: i } : {}) });

/** 工具中文名：前端「Agent 工作台」展示用 */
const TOOL_LABEL = {
  analyze_answer: '分析回答',
  search_knowledge: '检索知识库',
  find_question: '动态挑题',
  record_observation: '记录观察',
  adjust_plan: '调整计划'
};

/** 把 Agent 的工具调用轨迹精简成可下发/可展示的结构（去掉大段原文，保留决策依据） */
function briefTrace(trace) {
  return (trace || []).map(t => {
    const o = t.observation || {};
    let obs;
    if (t.tool === 'analyze_answer') {
      obs = {
        命中: (o.hitPoints || []).slice(0, 4),
        遗漏: (o.missPoints || []).slice(0, 4),
        深度: o.depth, 含糊: !!o.vague,
        建议追问: String(o.suggestedProbe || '').slice(0, 60)
      };
    } else if (t.tool === 'find_question') {
      obs = { 选中: String(o.text || '').slice(0, 80), 类型: o.type, 命中: !!o.ok };
    } else if (t.tool === 'search_knowledge') {
      obs = { 检索词: String(o.query || '').slice(0, 40), 命中条数: (o.hits || []).length, 首条: String((o.hits || [])[0] || '').slice(0, 80) };
    } else if (t.tool === 'record_observation') {
      obs = { 记录: String(o.note || '').slice(0, 80), 累计: o.total };
    } else if (t.tool === 'adjust_plan') {
      obs = { 动作: o.action, 剩余题数: o.remaining };
    } else {
      obs = JSON.stringify(o).slice(0, 200);
    }
    return {
      step: t.step,
      thought: String(t.thought || '').slice(0, 120),
      tool: t.tool,
      label: TOOL_LABEL[t.tool] || t.tool,
      args: JSON.stringify(t.args || {}).slice(0, 120),
      observation: obs
    };
  });
}

async function handleAnswer(s, p, onDelta = null) {
  const qIndex = p.qIndex | 0;
  const q = s.plan[qIndex];
  // 终止边界固定为「原始计划长度」：Agent 可在计划内换题，但不会把面试无限延长
  const planSize = s.planSize || (s.planSize = s.plan.length);
  if (!q) throw new Error('题目序号无效');
  const full = q.full || bank.findQuestion(s.position, q.id);
  if (!full) throw new Error('题目数据缺失');
  const brief = (q, i) => briefOf(q, i);
  const answer = String(p.answer || '').slice(0, 4000);

  let round = s.rounds[qIndex];
  if (!round) {
    round = { question: full, answer: '', metrics: null, followUps: [], followCount: 0 };
    s.rounds[qIndex] = round;
  }

  if (!round.followCount) {
    // 首答（口头指令「下一题」只是跳过点评，不能把他的真实作答覆盖掉）
    if (!(p.command === 'next' && round.answer)) round.answer = answer;
    round.metrics = p.metrics || null;

    // 预取还在跑？先等它落地（候选人说完才提交时，预取往往已就绪或接近完成）。
    // 等待上限 12s：超时就放弃等待，走下面的现场决策，绝不无限等。
    const t0 = Date.now();
    while (s.prefetchTask && Date.now() - t0 < 12000) {
      await new Promise(r => setTimeout(r, 120));
    }

    // 命中预取：预取文本是提交文本的前缀（说话只增不改）→ 直接复用，零额外等待
    const pf = s.prefetch;
    s.prefetch = null;
    let payload;
    if (pf && pf.qIndex === qIndex && pf.raw && rawOf(round.answer).startsWith(pf.raw)) {
      payload = pf.payload;
      payload.agent = Object.assign({}, payload.agent, { prefetched: true });
    } else {
      // 未命中 → 现场走同一条 Agent 决策路径（与预取质量完全一致）
      payload = await computeTurn(s, qIndex, round.answer, onDelta, {
        command: p.command || '', difficulty: p.difficulty || '', branch: p.branch || ''
      });
    }
    if (payload.kind === 'followUp') {
      round.followCount++;
      round.followUps.push({ q: payload.nextLine, a: '' });
    }
    // 澄清/打扰说明类不消耗首答状态，等他确认后接着问这一题
    if (payload.sameTurn) round.followCount = 0;
    return payload;
  }

  // —— 追问的回答 → 记录后进入下一题 ——
  if (!round.followUps.length) throw new Error('追问记录缺失');
  round.followUps[round.followUps.length - 1].a = String(p.answer || '').slice(0, 4000);
  if (p.metrics) round.metrics = mergeMetrics(round.metrics, p.metrics);

  const hasNext = qIndex + 1 < planSize;
  const nextQ = hasNext ? (s.plan[qIndex + 1].full || bank.findQuestion(s.position, s.plan[qIndex + 1].id)) : null;
  const nextLine = await llm.interviewerNext(s, round, nextQ);
  return {
    nextLine,
    followUp: false,
    question: nextQ ? brief(nextQ, qIndex + 1) : null,
    progress: { done: qIndex + 1, total: planSize },
    done: !nextQ,
    agent: { thought: '候选人补充完了，一句话收掉这一题，进入下一题', tools: [], steps: 0 }
  };
}

/** 追问语句（Python Agent / 在线 LLM / 离线规则，由 llm 层统一逐级兜底） */
async function followUpLine(s, round) {
  return llm.interviewerFollowUp(s, round);
}

/**
 * 口头指令「解释这道题」：用通俗的话讲清本题的参考思路。
 * 不消耗题序、不算追问轮次 —— 讲完让候选人继续回答同一道题。
 */
async function explainCurrent(s, opts = {}) {
  const qIndex = opts.qIndex | 0;
  const q = s.plan[qIndex];
  if (!q) throw new Error('题目序号无效');
  const full = q.full || bank.findQuestion(s.position, q.id);
  if (!full) throw new Error('题目数据缺失');
  const line = await llm.chat([
    { role: 'system', content: '你是语音电话面试里的资深技术面试官。候选人要求你把这道题讲通俗一点。请用大白话讲解参考思路：先说这题想考察什么，再给一个通俗的类比或拆解方向，最后提示从哪个点开口回答。全程口语短句，不要 Markdown、不要代码块、不要列点符号，控制在 3 到 4 句话以内。' },
    { role: 'user', content: `岗位：${s.position}\n题目：${full.text}\n参考考察点：${JSON.stringify(full.points || [])}` }
  ], { temperature: 0.6, maxTokens: 320 });
  return {
    kind: 'sameTurn',
    nextLine: String(line || '这道题我们换个说法：它其实想看你有没有把核心原理讲清楚，你先说整体流程，再挑你最熟的一环展开就行。').trim(),
    followUp: false,
    sameTurn: true,
    question: briefOf(full, qIndex),
    progress: { done: qIndex, total: s.planSize || s.plan.length },
    done: false,
    agent: { thought: '候选人要求讲通俗一点，先搂一层再让他继续作答', tools: [], steps: 0 }
  };
}

/**
 * 口头指令「换简单一点 / 换难一点」：把当前题目重述成相应难度。
 * 不消耗题序、不算追问轮次 —— 讲完让他继续答同一道题，避免"卡在原地又没法继续"的窘境。
 */
async function coach(s, opts = {}) {
  const qIndex = opts.qIndex | 0;
  const q = s.plan[qIndex];
  if (!q) throw new Error('题目序号无效');
  const full = q.full || bank.findQuestion(s.position, q.id);
  if (!full) throw new Error('题目数据缺失');
  const want = opts.kind === 'harder' ? 'harder' : 'easier';
  const guide = want === 'easier'
    ? '候选人觉得这道题偏难，要求换简单一点。请把这一题改成一个更基础的问法：留在同一个知识点的大类里，先问他"知其然"的部分，给出具体场景引导，不要出现让人紧张的词汇。'
    : '候选人觉得这道题太浅，要求换难一点。请把这一题加深一层：追问源码实现、边界条件、线上故障排查或性能权衡，让他必须讲清原理和取舍。';
  const line = await llm.chat([
    {
      role: 'system', content:
        `你是语音电话面试里的资深技术面试官。${guide}\n` +
        '要求：口语短句，一句话带过调整难度的用意，然后抛出唯一一个问题；不要 Markdown、不要代码、不要列点符号，控制在 2 到 3 句话以内。'
    },
    { role: 'user', content: `岗位：${s.position}\n原题：${full.text}\n参考考察点：${JSON.stringify(full.points || [])}` }
  ], { temperature: 0.7, maxTokens: 260 });
  const fallback = want === 'easier'
    ? '好，我们换个基础一点的问法：这道题你先说说它解决什么问题、大概怎么用就行。'
    : '好，那我们聊深一点：原理层面你是怎么权衡的？';
  return {
    kind: 'sameTurn',
    nextLine: String(line || fallback).trim(),
    followUp: false,
    sameTurn: true,
    question: briefOf(full, qIndex),
    progress: { done: qIndex, total: s.planSize || s.plan.length },
    done: false,
    agent: {
      thought: want === 'easier' ? '候选人要求降低难度，回落到更基础的问法' : '候选人要求加深难度，往原理与线上场景钻',
      tools: [], steps: 0
    }
  };
}

function mergeMetrics(m1, m2) {
  if (!m1) return m2;
  if (!m2) return m1;
  return {
    wpm: Math.round((m1.wpm + m2.wpm) / 2),
    seconds: Math.round(((m1.seconds || 0) + (m2.seconds || 0)) * 10) / 10,
    fillers: (m1.fillers || 0) + (m2.fillers || 0),
    confidence: Math.round(((m1.confidence || 0) + (m2.confidence || 0)) / 2)
  };
}

async function generateReport(s) {
  for (let i = 0; i < s.plan.length; i++) {
    if (!s.rounds[i]) {
      s.rounds[i] = { question: s.plan[i].full || bank.findQuestion(s.position, s.plan[i].id), answer: '', metrics: null, followUps: [], followCount: 0 };
    }
  }
  return llm.evaluateReport(s);
}

/**
 * 智能回合判断：候选人语音停顿后，面试官判断其是否已说完。
 * 不写入会话数据，只做判断（不产生追问记录、不推进题目）。
 */
async function turnCheck(s, p) {
  const qIndex = p.qIndex | 0;
  const q = s.plan[qIndex];
  if (!q) throw new Error('题目序号无效');
  const full = q.full || bank.findQuestion(s.position, q.id);
  if (!full) throw new Error('题目数据缺失');
  const partial = String(p.answer || '').slice(0, 2000);
  return llm.turnCheck({ position: s.position, question: full, partial });
}

/** 反问环节：候选人提问，面试官回答（记录到会话，供报告参考） */
async function askCandidate(s, p) {
  const question = String(p.question || '').trim().slice(0, 500);
  if (!question) throw new Error('问题不能为空');
  const reply = await llm.answerCandidate({ position: s.position, question });
  s.candidateQs = s.candidateQs || [];
  s.candidateQs.push({ q: question, a: reply, time: Date.now() });
  return { reply };
}

module.exports = { handleAnswer, generateReport, turnCheck, askCandidate, prefetchNext, explainCurrent, computeTurn, coach };
