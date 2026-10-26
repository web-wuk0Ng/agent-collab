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
/** 预取签名：回答前缀一致才算命中（避免用户又说了新内容却用了旧结果） */
const sigOf = txt => String(txt || '').replace(/\s+/g, '').slice(0, 60);

/**
 * 边听边准备下一步（静默预取）：
 * 候选人还在说话时，后台就按"当前已说内容"预先生成 追问语 / 下一题过渡语，
 * 结果挂在 session 上；等他真的提交时若签名一致直接复用 → 几乎零等待。
 * 任何异常都静默失败，不影响正式提交。
 */
async function prefetchNext(s, p) {
  try {
    const qIndex = p.qIndex | 0;
    const q = s.plan[qIndex];
    if (!q) return { ok: false };
    const full = q.full || bank.findQuestion(s.position, q.id);
    if (!full) return { ok: false };
    const answer = String(p.answer || '').slice(0, 4000);
    const len = answer.replace(/\s+/g, '').length;
    const hit = (full.keywords || []).filter(k => answer.includes(k)).length;
    const willFollowUp = len > 0 && (len < 50 || (hit === 0 && len < 150));

    const round = { question: full, answer, metrics: null, followUps: [], followCount: 0 };
    const hasNext = qIndex + 1 < s.plan.length;
    const nextQ = hasNext ? (s.plan[qIndex + 1].full || bank.findQuestion(s.position, s.plan[qIndex + 1].id)) : null;

    const payload = willFollowUp
      ? { kind: 'followUp', line: await llm.interviewerFollowUp(s, round) }
      : { kind: 'next', line: await llm.interviewerNext(s, round, nextQ), nextQ: nextQ ? briefOf(nextQ, qIndex + 1) : null };
    s.prefetch = { sig: sigOf(answer), qIndex, payload, at: Date.now() };
    return { ok: true, willFollowUp };
  } catch { return { ok: false }; }
}

const briefOf = (q, i) => ({ id: q.id, type: q.type, text: q.text, points: q.points || [], hint: q.hint || '', ...(i !== undefined ? { index: i } : {}) });

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

async function handleAnswer(s, p) {
  const qIndex = p.qIndex | 0;
  const q = s.plan[qIndex];
  // 终止边界固定为「原始计划长度」：Agent 可在计划内换题，但不会把面试无限延长
  const planSize = s.planSize || (s.planSize = s.plan.length);
  if (!q) throw new Error('题目序号无效');
  const full = q.full || bank.findQuestion(s.position, q.id);
  if (!full) throw new Error('题目数据缺失');
  const brief = (q, i) => briefOf(q, i);

  let round = s.rounds[qIndex];
  if (!round) {
    round = { question: full, answer: '', metrics: null, followUps: [], followCount: 0 };
    s.rounds[qIndex] = round;
  }

  if (!round.followCount) {
    // 首答
    round.answer = String(p.answer || '').slice(0, 4000);
    round.metrics = p.metrics || null;

    // 命中预取：候选人说的内容与预热时一致 → 直接复用，省掉一次大模型往返
    const pf = s.prefetch;
    if (pf && pf.qIndex === qIndex && pf.sig === sigOf(round.answer) && pf.payload) {
      s.prefetch = null;
      if (pf.payload.kind === 'followUp') {
        round.followCount++;
        round.followUps.push({ q: pf.payload.line, a: '' });
        return {
          nextLine: pf.payload.line,
          followUp: true,
          question: null,
          progress: { done: qIndex, total: planSize },
          done: false,
          agent: { thought: '候选人还在说话时已预判需要追问，回应已备好', tools: [], steps: 0, prefetched: true }
        };
      }
      return {
        nextLine: pf.payload.line,
        followUp: false,
        question: pf.payload.nextQ || null,
        progress: { done: qIndex + 1, total: planSize },
        done: !pf.payload.nextQ,
        agent: { thought: '候选人还在说话时已预判回答充分，过渡语已备好', tools: [], steps: 0, prefetched: true }
      };
    }
  } else {
    // 追问的回答 → 记录后进入下一题
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

  // —— 首答之后：交给 Agent 自主决策（追问 / 深挖 / 换知识点 / 进入下一题）——
  const hasNext = qIndex + 1 < planSize;
  const defaultNextQ = hasNext ? (s.plan[qIndex + 1].full || bank.findQuestion(s.position, s.plan[qIndex + 1].id)) : null;

  const decision = await agent.decide(s, {
    question: full,
    answer: round.answer,
    defaultNext: defaultNextQ ? defaultNextQ.text : null,
    canSwitch: hasNext,                   // 最后一题：禁止再换题
    followCount: round.followCount || 0,  // 已追问过一次：提醒它别再追问第二层
    remaining: Math.max(0, planSize - qIndex - 1)
  });

  // Agent 若通过 find_question 动态挑了新题，优先用 Agent 挑的（真 Agent 行为：可临时换题）
  let dynamicQ = null;
  const trace = decision.trace || [];
  if (hasNext) {
    for (let i = trace.length - 1; i >= 0; i--) {
      const obs = trace[i].observation;
      if (obs && obs.ok && obs.id && obs.text) { dynamicQ = { id: obs.id, type: obs.type, text: obs.text, points: obs.points || [], hint: obs.hint || '' }; break; }
    }
  }

  // 判断 Agent 意图：是否要继续追问（没有走向下一题）
  const wantsNext = decision.wantsNext === true || !!dynamicQ
    || /下一题|下一个问题|我们再来看|换一道|下一道|换个方向|就到这里|就到这儿|到这儿|今天的面试|今天的问题|收尾/.test(decision.line || '');

  // 追问只在「后面还有题」时允许：否则最后一题会被无限追问，面试永远结束不了
  const canFollowUp = round.followCount === 0 && hasNext && !!(decision.line || '').trim();
  if (!wantsNext && canFollowUp) {
    // Agent 决定继续在本知识点上追问 / 深挖
    round.followCount++;
    round.followUps.push({ q: decision.line, a: '' });
    return {
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
    nextLine: line || (nextQ ? nextQ.text : '今天的面试就到这里，辛苦了。'),
    followUp: false,
    question: nextQ ? brief(nextQ, qIndex + 1) : null,
    progress: { done: qIndex + 1, total: planSize },
    done: !nextQ,
    agent: { thought: decision.thought, tools: trace.map(t => t.tool), steps: trace.length, trace: briefTrace(trace) }
  };
}

/** 追问语句（Python Agent / 在线 LLM / 离线规则，由 llm 层统一逐级兜底） */
async function followUpLine(s, round) {
  return llm.interviewerFollowUp(s, round);
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

module.exports = { handleAnswer, generateReport, turnCheck, askCandidate, prefetchNext };
