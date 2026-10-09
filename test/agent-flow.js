/**
 * 「Python Agent 引擎」全链路测试
 *
 * 前置：① 面试系统已启动（node server.js）
 *      ② Python Agent 已启动（python-agent → uvicorn ... --port 8000）
 *
 * 用法：node test/agent-flow.js
 * 作用：把 AI 引擎切到 python → 跑完整面试（开场→回答→追问→报告）→ 校验
 *      报告确实由 Python Agent 产出 → 恢复原引擎设置。
 */

const BASE = process.env.MM_BASE || 'http://localhost:3000';
const AGENT = process.env.MM_AGENT_URL || 'http://127.0.0.1:8000';

const api = async (path, body) => {
  const resp = await fetch(BASE + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  } : undefined);
  const json = await resp.json();
  if (!resp.ok) throw new Error(`${path} -> ${json.error || resp.status}`);
  return json;
};

const answers = [
  '我是测试同学，软件工程专业，熟悉 Java、Spring Boot、MySQL 和 Redis，做过校园二手交易平台的后端开发。',
  'HashMap 底层是数组加链表，JDK8 之后链表过长会转成红黑树，扩容时容量翻倍。',
  '线程池的核心参数有核心线程数、最大线程数、任务队列和拒绝策略，我一般用有界队列防止内存溢出。'
];

(async () => {
  const backup = await api('/api/ai-config');

  // 0. 探测 Agent 服务
  const health = await fetch(`${AGENT}/health`).then(r => r.json());
  console.log(`[agent] online: v${health.version} · 内部引擎 ${health.engine} · 知识库 ${health.knowledge.positions} 岗位 / ${health.knowledge.knowledgeChunks} 片段`);

  // 1. 切换引擎
  const cfg = await api('/api/ai-config', { engine: 'python', agentUrl: AGENT });
  console.log(`[engine] -> ${cfg.engine} (${cfg.agentUrl})`);

  const test = await api('/api/ai-test', {});
  if (!test.ok) throw new Error('测试连接失败：' + test.error);
  console.log(`[test] ${test.reply}`);

  try {
    // 2. 完整跑一场面试
    const { user } = await api('/api/login', { name: 'Agent联调' });
    const start = await api('/api/interview/start', {
      userId: user.id, position: 'java-backend', rounds: 3, mode: 'text'
    });
    console.log(`[start] greeting(${start.greeting.length} 字): ${start.greeting.slice(0, 60)}…`);

    let step = 0;
    let qIndex = 0;
    let state = start;
    while (!state.done && step < 10) {
      const answer = answers[Math.min(qIndex, answers.length - 1)];
      const res = await api('/api/interview/answer', { sessionId: start.sessionId, qIndex, answer });
      console.log(`[turn ${step + 1}] ${res.followUp ? '追问' : '下一题'} → ${res.nextLine.slice(0, 60)}…`);
      state = res;
      step++;
      if (state.followUp) continue;   // 追问后重新答同一题
      qIndex = state.question ? state.question.index : qIndex + 1;
      if (state.done) break;
    }

    const { report } = await api('/api/interview/finish', { sessionId: start.sessionId });
    console.log(`[report] 引擎=${report.engine} 综合分=${report.overall} 维度=${report.dimensions.map(d => `${d.name}:${d.score}`).join(' ')}`);
    if (report.engine !== 'python') throw new Error(`报告不是 Python Agent 产出的（engine=${report.engine}）`);
    if (report.dimensions.length < 5) throw new Error('报告维度不足');
    console.log('✅ Python Agent 全链路打通：开场白 / 追问 / 过渡 / 评估报告 均由 python-agent 服务生成');
  } finally {
    // 3. 恢复原设置
    await api('/api/ai-config', backup);
    console.log(`[restore] 引擎已恢复为 ${backup.engine}`);
  }
})().catch(err => { console.error('❌ FAIL:', err.message); process.exit(1); });
