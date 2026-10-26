/**
 * lib/agentTeam.js —— 多 Agent 协作团队
 *
 * 一场模拟面试由 4 个专职 Agent 分工完成，而不是一个大模型包打天下：
 *
 *   ┌─ 出题官 Agent (writer)     按 JD / 薄弱知识点动态生成题目，可扩充题库
 *   ├─ 面试官 Agent (interviewer) 主持对话：边听边决策（追问 / 深挖 / 换知识点 / 下一题）
 *   ├─ 评估官 Agent (evaluator)   基于真实作答数据打分，逐题复盘，产出结构化报告
 *   └─ 陪练官 Agent (coach)       针对薄弱点检索知识库，给出可执行的提升计划
 *
 * 每个 Agent 都遵循同一套运行时：思考(thought) → 调工具(action) → 看结果(observation) → 再思考 → 输出(final)。
 * 所有中间过程记入 trace，可在界面「Agent 工作台」里逐条查看，面试不是黑箱。
 */
const llm = require('./llm');
const rag = require('./rag');
const bank = require('./bank');
const interviewer = require('./agent');

/* ---------------- 团队共享工具 ---------------- */
const TOOLS = {
  /** 统计本场面试的客观作答数据（不调用大模型，纯数据工具） */
  stat_rounds(s) {
    const rounds = s.rounds || [];
    const stats = rounds.map((r, i) => {
      const q = r.question || {};
      const ans = String(r.answer || '').replace(/\s+/g, '');
      const followAns = (r.followUps || []).map(f => String(f.a || '')).join('');
      const all = (ans + followAns);
      const hit = (q.keywords || []).filter(k => all.includes(k)).length;
      return {
        index: i + 1,
        type: q.type || '',
        question: q.text || '',
        points: q.points || [],
        answerChars: ans.length,
        keywordHit: hit,
        keywordTotal: (q.keywords || []).length,
        followUps: (r.followUps || []).length,
        gaveUp: /不会|不知道|不清楚|没接触过|不了解/.test(all.slice(-40)),
        wpm: r.metrics && r.metrics.wpm || null
      };
    });
    const totalChars = stats.reduce((a, x) => a + x.answerChars, 0);
    return {
      ok: true,
      rounds: stats,
      summary: {
        roundCount: stats.length,
        avgChars: stats.length ? Math.round(totalChars / stats.length) : 0,
        gaveUpCount: stats.filter(x => x.gaveUp).length,
        thinCount: stats.filter(x => x.answerChars < 60).length,
        hitRate: stats.length
          ? +(stats.reduce((a, x) => a + (x.keywordTotal ? x.keywordHit / x.keywordTotal : 0), 0) / stats.length).toFixed(2)
          : 0
      }
    };
  },

  /** 检索岗位知识库，用于核对标准答案 / 生成学习材料 */
  lookup_knowledge(s, args) {
    const hits = rag.search(s.position, String(args.query || '').slice(0, 200), args.limit || 3) || [];
    return { ok: true, query: args.query, hits: hits.map(h => ({ title: h.title, text: String(h.text).slice(0, 400) })) };
  },

  /** 取题库里某题的标准考察点与回答思路（评估时的客观参照） */
  bank_reference(s, args) {
    const b = bank.getBank(s.position);
    if (!b) return { ok: false, note: '题库不存在' };
    const kw = String(args.keyword || '').toLowerCase();
    const q = kw
      ? b.questions.find(x => (x.text + (x.keywords || []).join('')).toLowerCase().includes(kw))
      : null;
    if (!q) return { ok: true, points: [], hint: '', note: '未找到完全匹配的题库条目' };
    return { ok: true, text: q.text, points: q.points || [], hint: q.hint || '', keywords: q.keywords || [] };
  },

  /** 出题：按知识点生成新题（出题官专用，返回题目草稿，可入库） */
  draft_question(s, args) {
    return { ok: true, note: '题目草稿由大模型生成，见 final 字段', topic: String(args.topic || '') };
  }
};

const TOOL_DESC_BY_ROLE = {
  evaluator: `- stat_rounds: 统计本场面试的客观数据（每题字数、关键词命中率、放弃次数）。参数 {}
- lookup_knowledge: 检索岗位知识库，核对某题的标准答案要点。参数 {"query":"知识点","limit":3}
- bank_reference: 取题库中某题的标准考察点与回答思路。参数 {"keyword":"关键词"}`,
  coach: `- lookup_knowledge: 检索岗位知识库，拿到该知识点的学习材料。参数 {"query":"知识点","limit":3}
- stat_rounds: 再看一遍本场作答的客观数据，定位最薄弱的环节。参数 {}
- bank_reference: 查看某道题的标准回答思路，用于给出示范。参数 {"keyword":"关键词"}`,
  writer: `- bank_reference: 查看题库里是否已有同类题，避免重复出题。参数 {"keyword":"关键词"}
- lookup_knowledge: 检索知识库，确保出的题有标准答案可依。参数 {"query":"知识点","limit":3}`
};

/* ---------------- 通用角色运行时 ---------------- */
async function runRole(role, s, ctx) {
  const trace = [];
  const roleName = { evaluator: '评估官 Agent', coach: '陪练官 Agent', writer: '出题官 Agent' }[role] || role;
  const system = {
    role: 'system',
    content:
`你是「面镜 MockMirror」多 Agent 面试团队中的${roleName}，负责${roleName.replace(' Agent', '')}环节。
岗位：${s.position || '通用'}
${ctx.task}

你可以先用工具拿到真实数据（不要凭空编造），再给出结论。

可用工具（每次最多 ${ctx.maxSteps || 2} 次，也可以不用工具直接给结论）：
${TOOL_DESC_BY_ROLE[role]}

严格按 JSON 输出（不要其他文字）：
{"thought":"你此刻的判断（一句话）","action":{"tool":"工具名","args":{...}} 或 null,"final":${ctx.finalShape}}

${ctx.extra || ''}`
  };

  let final = null, thought = '';
  const maxSteps = ctx.maxSteps || 2;
  for (let step = 0; step < maxSteps; step++) {
    const lastStep = step === maxSteps - 1;
    let j;
    try {
      const messages = [system, ...trace.map(t => ({ role: 'user', content: t }))];
      // 最后一步强制收口：不允许再调工具，必须给出结论，否则 Agent 会一直"查资料"不给结果
      if (lastStep) messages.push({ role: 'user', content: `这是最后一步，不允许再调用工具，必须输出 final，格式：${ctx.finalShape}` });
      const out = await llm.chat(messages, { temperature: 0.3, maxTokens: ctx.maxTokens || 1600, jsonMode: true });
      j = JSON.parse(String(out).replace(/```json|```/g, '').trim());
      if (lastStep && !j.final) {
        console.error(`[agentTeam] ${role} 最后一步未产出 final，原始输出：${String(out).slice(0, 400)}`);
      }
    } catch (e) {
      console.error(`[agentTeam] ${role} 解析失败：${e.message}`);
      break;
    }
    if (j && j.thought) thought = j.thought;
    trace.push(`[思考] ${j.thought || ''}`);

    if (!lastStep && j.action && j.action.tool && TOOLS[j.action.tool]) {
      let obs;
      try { obs = await TOOLS[j.action.tool](s, j.action.args || {}); }
      catch (e) { obs = { ok: false, error: e.message }; }
      trace.push(`[工具 ${j.action.tool} 返回] ${JSON.stringify(obs).slice(0, 1200)}`);
      if (j.final) { final = j.final; if (!ctx.keepGoing) break; }
      continue;
    }
    if (j.final) { final = j.final; break; }
  }

  // 结果校验：字段不全 / 写了"待核对"这类占位文字 → 再要一次，直到产出真结论
  if (ctx.validate && !ctx.validate(final)) {
    const retryMsg = '上一次输出不完整或含占位文字（如"待核对"）。请直接输出完整的 final JSON，每个字段都必须有实质内容，不要解释、不要留空。';
    try {
      const out = await llm.chat(
        [system, ...trace.map(t => ({ role: 'user', content: t })), { role: 'user', content: retryMsg }],
        { temperature: 0.2, maxTokens: ctx.maxTokens || 1600, jsonMode: true }
      );
      const j2 = JSON.parse(String(out).replace(/```json|```/g, '').trim());
      if (j2 && j2.final) { final = j2.final; if (j2.thought) thought = j2.thought; trace.push('[校验重试] 首次输出不完整，已重新产出结论'); }
    } catch (e) {
      console.error(`[agentTeam] ${role} 校验重试失败：${e.message}`);
    }
  }

  return { role, roleName, thought, final, trace, steps: trace.length, ok: !!(final && (!ctx.validate || ctx.validate(final))) };
}

/* ---------------- 评估官 Agent ---------------- */
async function evaluate(s, baseReport) {
  const dims = (baseReport && baseReport.dimensions) || [];
  const r = await runRole('evaluator', s, {
    task:
`本场面试已结束，请基于候选人的真实作答数据做一次严谨评估。
评分维度（scoreAdjust 必须用这些名字作为 key）：${dims.map(d => d.name).join('、') || '技术正确性、表达逻辑、项目经验、应变能力'}
已有初版报告（可作参考，不要照抄）：${JSON.stringify(baseReport || {}).slice(0, 900)}`,
    finalShape:
`{"verdict":"一句话整体评价","highlights":["候选人答得好的 2-3 个具体点"],"gaps":["明显薄弱的 2-3 个具体点"],"perQuestion":[{"index":1,"question":"题目","level":"优秀|良好|一般|不足","hit":"答到了什么","miss":"漏了什么","better":"该怎么答更好（2-3 句）"}],"scoreAdjust":{"专业深度":0,"表达逻辑":0,"项目经验":0,"应变能力":0}（相对初版报告的加减分，整数，范围 -15~+15）}`,
    maxSteps: 2,
    maxTokens: 2000,
    extra: 'perQuestion 要与 stat_rounds 返回的题目顺序一一对应，不要漏题。每个字段都要有实质内容，禁止写"待核对""略"这类占位文字。',
    validate: f => !!f && typeof f.verdict === 'string' && f.verdict.length >= 8
      && Array.isArray(f.perQuestion) && f.perQuestion.length > 0
      && !/待核对|待确认|略|同上/.test(f.verdict)
  });
  return r;
}

/* ---------------- 陪练官 Agent ---------------- */
async function coach(s, baseReport) {
  const r = await runRole('coach', s, {
    task:
`基于候选人的薄弱点，产出一份"接下来一周真的做得到"的提升计划。
评估结论：${baseReport ? JSON.stringify(baseReport).slice(0, 800) : '（暂无）'}`,
    finalShape:
`{"focus":["最该补的 3 个知识点（按优先级排序）"],"plan":[{"day":"第1天","topic":"学什么","action":"具体怎么做（可验证）","material":"用什么资料"}],"drills":[{"question":"给他一道针对性的练习面试题","hint":"回答思路"}],"encourage":"一句鼓励（不要空话）"}`,
    maxSteps: 2,
    maxTokens: 1800,
    extra: 'plan 至少 3 天、最多 7 天；drills 给 2-3 道题，题目不要与本场已问过的重复。每个字段都要有实质内容，禁止占位文字。',
    validate: f => !!f && Array.isArray(f.focus) && f.focus.length >= 1 && Array.isArray(f.plan) && f.plan.length >= 1
  });
  return r;
}

/* ---------------- 出题官 Agent ---------------- */
async function writeQuestions(s, { topic, count = 3, jd }) {
  const r = await runRole('writer', s, {
    task:
`请为「${s.position}」岗位生成 ${count} 道高质量面试题${topic ? `，聚焦知识点：${topic}` : ''}${jd ? `，贴合这份 JD：${String(jd).slice(0, 600)}` : ''}。`,
    finalShape:
`{"questions":[{"type":"tech|project|scenario|behavior","stage":"warm|core|deep","text":"题干","keywords":["关键词"],"points":["考察点"],"hint":"回答思路"}]}`,
    maxSteps: 2,
    maxTokens: 1600,
    extra: '题目要能区分"背过八股"和"真的做过"，points 写清楚答到什么算合格。',
    validate: f => !!f && Array.isArray(f.questions) && f.questions.length > 0
      && f.questions.every(q => q && q.text && Array.isArray(q.points))
  });
  return r;
}

/**
 * 面试收尾：评估官与陪练官并行作业，合并进最终报告。
 * 任一 Agent 失败都不影响主流程（降级为仅初版报告）。
 */
async function finalize(s, baseReport) {
  const team = { version: 2 };
  try {
    const [ev, co] = await Promise.all([
      evaluate(s, baseReport).catch(e => ({ role: 'evaluator', ok: false, error: e.message })),
      coach(s, baseReport).catch(e => ({ role: 'coach', ok: false, error: e.message }))
    ]);
    team.evaluator = ev;
    team.coach = co;
    if (ev && ev.ok && ev.final) {
      baseReport.agentVerdict = ev.final.verdict || '';
      baseReport.agentHighlights = ev.final.highlights || [];
      baseReport.agentGaps = ev.final.gaps || [];
      baseReport.agentPerQuestion = ev.final.perQuestion || [];
      // 按 Agent 的加减分修正初版打分（限幅 ±15，防止大模型乱改分）
      if (ev.final.scoreAdjust && Array.isArray(baseReport.dimensions) && baseReport.dimensions.length) {
        for (const d of baseReport.dimensions) {
          const adj = Number(ev.final.scoreAdjust[d.name] ?? ev.final.scoreAdjust[d.key]);
          if (Number.isFinite(adj) && Number.isFinite(d.score)) {
            d.score = Math.max(0, Math.min(100, d.score + Math.max(-15, Math.min(15, Math.round(adj)))));
            d.adjustedBy = '评估官 Agent';
          }
        }
        baseReport.overall = Math.round(baseReport.dimensions.reduce((a, x) => a + x.score, 0) / baseReport.dimensions.length);
      }
    }
    if (co && co.ok && co.final) {
      baseReport.coachPlan = co.final;
    }
  } catch (e) {
    console.error('[agentTeam] finalize 失败，降级为初版报告:', e.message);
  }
  return { report: baseReport, team };
}

/** 单条回答的即时批改（MCP / 练习模式用） */
async function analyzeOne({ position, question, points, answer }) {
  const s = { position, rounds: [], plan: [] };
  const r = await runRole('evaluator', s, {
    task: `只批改这一条回答，不要臆测其他轮次。\n题目：${question}\n考察点：${JSON.stringify(points || [])}`,
    finalShape:
`{"hit":["答到的点"],"miss":["漏掉或答错的点"],"depth":1-5,"vague":true/false,"score":0-100,"comment":"一句总体点评","better":"该怎么答更好（3 句以内，给出示范要点）"}`,
    maxSteps: 2,
    maxTokens: 900,
    extra: `候选人回答：${String(answer).slice(0, 2500)}`,
    validate: f => !!f && f.depth !== undefined && !!f.better && Array.isArray(f.hit)
  });
  return r;
}

module.exports = {
  ROLES: ['interviewer', 'evaluator', 'coach', 'writer'],
  interviewer,
  evaluate, coach, writeQuestions, finalize, analyzeOne, runRole, TOOLS
};
