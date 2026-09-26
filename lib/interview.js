/**
 * 面试流程控制：处理回答、智能追问节奏、报告生成
 */
const bank = require('./bank');
const llm = require('./llm');

/**
 * 提交一轮回答：
 * p = { sessionId, qIndex, answer, metrics? }
 * 每道题允许 0~1 次追问；追问后再次提交即进入下一题。
 * 返回 { nextLine, followUp, question, progress, done }
 */
async function handleAnswer(s, p) {
  const qIndex = p.qIndex | 0;
  const q = s.plan[qIndex];
  if (!q) throw new Error('题目序号无效');
  const full = q.full || bank.findQuestion(s.position, q.id);
  if (!full) throw new Error('题目数据缺失');

  let round = s.rounds[qIndex];
  if (!round) {
    round = { question: full, answer: '', metrics: null, followUps: [], followCount: 0 };
    s.rounds[qIndex] = round;
  }

  if (!round.followCount) {
    // 首答
    round.answer = String(p.answer || '').slice(0, 4000);
    round.metrics = p.metrics || null;
  } else {
    // 追问的回答 → 记录后进入下一题
    if (!round.followUps.length) throw new Error('追问记录缺失');
    round.followUps[round.followUps.length - 1].a = String(p.answer || '').slice(0, 4000);
    if (p.metrics) round.metrics = mergeMetrics(round.metrics, p.metrics);

    const hasNext = qIndex + 1 < s.plan.length;
    const nextQ = hasNext ? (s.plan[qIndex + 1].full || bank.findQuestion(s.position, s.plan[qIndex + 1].id)) : null;
    const nextLine = await llm.interviewerNext(s, round, nextQ);
    return {
      nextLine,
      followUp: false,
      question: nextQ ? { id: nextQ.id, type: nextQ.type, text: nextQ.text, index: qIndex + 1 } : null,
      progress: { done: qIndex + 1, total: s.plan.length },
      done: !nextQ
    };
  }

  // —— 首答之后：决定是否追问 ——
  const len = round.answer.length;
  const hit = (full.keywords || []).filter(k => round.answer.includes(k)).length;
  // 宽松策略：回答过短、或明显没提到任何要点时追问；回答充分则直接过
  const shouldFollowUp = len > 0 && round.followCount === 0 && (len < 50 || (hit === 0 && len < 150));

  if (shouldFollowUp) {
    round.followCount++;
    round.followUps.push({ q: '', a: '' });
    const line = await followUpLine(s, round);
    round.followUps[0].q = line; // 记录追问内容
    return {
      nextLine: line,
      followUp: true,
      question: null,
      progress: { done: qIndex, total: s.plan.length },
      done: false
    };
  }

  // 不追问 → 过渡到下一题
  const hasNext = qIndex + 1 < s.plan.length;
  const nextQ = hasNext ? (s.plan[qIndex + 1].full || bank.findQuestion(s.position, s.plan[qIndex + 1].id)) : null;
  const nextLine = await llm.interviewerNext(s, round, nextQ);
  return {
    nextLine,
    followUp: false,
    question: nextQ ? { id: nextQ.id, type: nextQ.type, text: nextQ.text, index: qIndex + 1 } : null,
    progress: { done: qIndex + 1, total: s.plan.length },
    done: !nextQ
  };
}

/** 追问语句（在线 LLM 优先，离线规则兜底） */
async function followUpLine(s, round) {
  const cfg = llm.publicConfig();
  if (cfg.mode === 'llm') {
    try {
      const rag = require('./rag');
      const ctx = rag.context(s.position, round.question.text, 2);
      const userMsg =
`当前题目（类型：${round.question.type}）：${round.question.text}
候选人首答：${round.answer}
${round.metrics ? `语音指标：语速 ${round.metrics.wpm} 字/分、口头禅 ${round.metrics.fillers} 次。` : ''}
${ctx ? '岗位知识库参考资料：\n' + ctx : ''}
请针对这个回答提出一个追问：聚焦其含糊、错误或只答表面的部分，一次只问一个问题，不要给标准答案，不要过渡到下一题。输出 1~2 句话。`;
      return await llm.chat([llm.interviewerSystem(s.position), { role: 'user', content: userMsg }], { temperature: 0.7, maxTokens: 300 });
    } catch (e) { console.error('[llm] followup fallback:', e.message); }
  }
  // 离线规则追问
  const kws = round.question.keywords || [];
  const miss = kws.find(k => !round.answer.includes(k));
  if (round.answer.length < 30) return '这个回答有点简短，能再展开讲讲吗？比如它的工作机制或者你实际用过的场景。';
  return miss
    ? `你刚才的回答里，我想再确认一个点：「${miss}」你能具体讲讲吗？`
    : '这个思路不错，能结合你自己的实际项目再深入讲一层吗？';
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

module.exports = { handleAnswer, generateReport };
