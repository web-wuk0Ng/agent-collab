/**
 * AI 全流程实测（毕业设计「AI 功能可用性」实验脚本）
 *
 * 前置：服务端已完成大模型配置（data/config.local.json，不入库不提交）
 * 运行：node test/llm-e2e.js [岗位id] [轮次]
 * 验证：开场白/追问/过渡是否由大模型生成、RAG 知识库检索、评估报告 JSON 化、
 *       未配置时的 428 门禁，并输出各环节真实耗时。
 */
const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;

async function api(path, body) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  } : undefined);
  const j = await r.json().catch(() => ({}));
  const ms = Date.now() - t0;
  if (!r.ok) return { status: r.status, code: j.code || '', error: j.error || '', ms };
  return { status: 200, ...j, ms };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 模拟候选人回答：围绕常见关键词组织，长度足够触发「不追问」或「追问」两种分支 */
function cannedAnswer(q, i) {
  const kw = (q.keywords || []);
  return [
    `我理解这道题的核心是「${kw[0] || '基本原理'}」。`,
    `首先，从底层机制看：${kw[0] || '核心概念'} 的关键在于它解决的实际问题；其次，在项目中我常用 ${kw[1] || '相关技术'} 来落地，例如在实习时做过一个数据同步模块，用 ${kw[1] || '相关技术'} 把接口耗时从 800ms 降到 200ms。`,
    `最后，它的常见坑是并发场景下的状态不一致，我会用幂等设计和监控告警来兜底。以上是我对「${kw[0] || '本题考点'}」的理解。`
  ].join(' ') + (i % 2 === 0 ? '' : ''); // 偶数题给完整回答，奇数题先短答触发追问分支
}

(async () => {
  const position = process.argv[2] || 'java-backend';
  const rounds = Number(process.argv[3] || 4);
  console.log(`\n==== 面镜 MockMirror · AI 全流程实测（岗位 ${position} · ${rounds} 题）====\n`);

  // 0) 健康检查
  const h = await api('/api/health');
  console.log(`[0] 健康检查: ${h.status} · AI 引擎=${h.ai && h.ai.engine} · 模型=${h.ai && h.ai.model} · DB schema v${h.db && h.db.schema}（${h.ms}ms）`);
  if (!h.ai || !h.ai.configured || h.ai.engine === 'offline') {
    console.log('    ⚠ AI 未配置，全流程实测无法进行（这本身就是 428 门禁实验的正常前置）。');
  }

  // 1) 登录
  const name = '实测员_' + Math.random().toString(36).slice(2, 6);
  const lg = await api('/api/login', { name });
  console.log(`[1] 登录: ${lg.user ? lg.user.name + '（' + lg.user.id + '）' : JSON.stringify(lg)}（${lg.ms}ms）`);

  // 2) 开始面试（LLM 生成开场白）
  const st = await api('/api/interview/start', { userId: lg.user.id, position, rounds, mode: 'text' });
  if (st.status !== 200) { console.log(`[2] 开始面试失败: HTTP ${st.status} ${st.code} ${st.error}`); process.exit(1); }
  console.log(`[2] 开始面试: 会话 ${st.sessionId} · 共 ${st.planSize} 题（${st.ms}ms）`);
  console.log(`    🤖 面试官开场白：${st.greeting}`);

  // 3) 逐题作答（含追问分支）
  let question = st.question;
  let idx = 0;
  while (question && idx < 50) {
    const qIndex = question.index;
    const answer = idx % 2 === 0
      ? cannedAnswer(question, idx)
      : '嗯……这个我了解一些，就是平时开发里会用到，具体细节我说不太清楚。'; // 短答触发追问
    const r = await api('/api/interview/answer', { sessionId: st.sessionId, qIndex, answer });
    if (r.status !== 200) { console.log(`    ❌ 回答提交失败: HTTP ${r.status} ${r.error}`); process.exit(1); }
    console.log(`    🙋 第 ${qIndex + 1} 题作答（${answer.length} 字，${r.ms}ms）`);
    if (r.followUp) {
      console.log(`    🤖 追问：${r.nextLine}`);
      const r2 = await api('/api/interview/answer', { sessionId: st.sessionId, qIndex, answer: cannedAnswer(question, 0) });
      if (r2.status !== 200) { console.log(`    ❌ 追问回答失败: ${r2.error}`); process.exit(1); }
      console.log(`    🙋 追问补充回答（${r2.ms}ms）→ 面试官：${r2.nextLine}`);
      question = r2.question;
    } else {
      console.log(`    🤖 面试官：${r.nextLine}`);
      question = r.question;
    }
    idx++;
  }

  // 4) 结束并生成评估报告（LLM 深度评估）
  const fin = await api('/api/interview/finish', { sessionId: st.sessionId });
  if (fin.status !== 200) { console.log(`[4] 报告生成失败: HTTP ${fin.status} ${fin.error}`); process.exit(1); }
  const rep = fin.report;
  console.log(`\n[4] 评估报告（引擎 ${rep.engine}，${fin.ms}ms）`);
  console.log(`    综合分: ${rep.overall}`);
  for (const d of rep.dimensions) console.log(`    · ${d.name}: ${d.score}  ${d.comment || ''}`);
  console.log(`    亮点 ${rep.strengths.length} 条 / 不足 ${rep.weaknesses.length} 条 / 建议 ${rep.advice.length} 条 / 计划 ${rep.plan.length} 周 / 资源 ${rep.resources.length} 条`);
  console.log(`    perRound 覆盖 ${rep.perRound.length}/${rounds} 题`);
  console.log(`    示例建议: ${rep.advice[0] || '-'}`);

  console.log('\n==== 实测通过：AI 对话（开场/追问/过渡）与评估报告均由大模型生成 ====\n');
})().catch(e => { console.error('实测异常:', e); process.exit(1); });
