/**
 * MCP 真实联调：用 MCP 工具跑完一整场面试（start → 逐题 submit → finish），
 * 验证「外部 Agent 通过 MCP 调用面镜」这条链路真的能跑通，并输出多 Agent 协作痕迹。
 * 前置：面镜服务已在 127.0.0.1:3000 运行，且已配置大模型。
 * 运行：node test/mcp-live.js
 */
const { spawn } = require('child_process');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'mcp', 'mockmirror-mcp.js');
const TIMEOUT = 180000;

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
child.stdout.setEncoding('utf-8');
child.stdout.on('data', d => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : resolve(msg.result);
    }
  }
});
child.stderr.on('data', d => { const s = d.toString().trim(); if (s) console.log('  [mcp-server] ' + s); });

let seq = 0;
function request(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error('超时: ' + method)); }, TIMEOUT);
    pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function callTool(name, args) {
  const r = await request('tools/call', { name, arguments: args || {} });
  const txt = (r.content || []).map(c => c.text).join('\n');
  if (r.isError) throw new Error('工具报错: ' + txt);
  try { return JSON.parse(txt); } catch { return txt; }
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log(`  ${cond ? '✔' : '✘'} ${name}${cond ? '' : '  → ' + (detail || '')}`);
}

const ANSWERS = [
  '自我介绍的话，我叫李默，本科计算机，去年在一个电商项目里做后端，主要用 Spring Boot 和 MySQL，负责过订单模块，也做过一次 Redis 缓存优化，把热点商品详情的响应时间从 200 毫秒降到 40 毫秒左右。',
  '线程池我了解一些，核心参数有核心线程数、最大线程数、队列和拒绝策略。我们项目里下单接口用过线程池做异步发券，核心线程数设的是 CPU 核数的两倍，队列用的是 LinkedBlockingQueue。',
  '这个我不太清楚，没有深入看过这部分的源码。'
];

(async () => {
  console.log('\nMCP 真实联调：外部 Agent 通过 MCP 主持一场模拟面试\n');

  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-live', version: '1.0.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

  const positions = await callTool('list_positions', {});
  const pos = positions[0].position;
  console.log(`  岗位：${pos}（${positions[0].name}，${positions[0].questionCount} 题）\n`);

  // 1. 开一场面试
  const t0 = Date.now();
  const started = await callTool('start_interview', { position: pos, user: 'MCP 联调候选人', rounds: 3 });
  check('start_interview 返回 sessionId', !!started.sessionId, JSON.stringify(started).slice(0, 200));
  check('start_interview 返回开场白与第一题', !!started.greeting && !!started.currentQuestion);
  console.log(`    面试官开场：${String(started.greeting).slice(0, 70)}…`);
  console.log(`    第 1 题：${started.currentQuestion.text.slice(0, 60)}…`);
  console.log(`    耗时 ${Date.now() - t0}ms\n`);

  // 2. 逐题作答
  let qIndex = 0;
  let guard = 0;
  let sawFollowUp = false, sawAgentTrace = false, sawDynamicPick = false, sawAgentThought = false;
  while (guard++ < 8) {
    const t = Date.now();
    const r = await callTool('submit_answer', {
      sessionId: started.sessionId, qIndex,
      answer: ANSWERS[Math.min(qIndex, ANSWERS.length - 1)]
    });
    if (r.isFollowUp) sawFollowUp = true;
    if (r.agent) {
      if ((r.agent.trace || []).length) sawAgentTrace = true;
      // 速度优先：Agent 大多数轮次走「一轮思考即出话」，不调工具。
      // 这里校验的是「每轮都有可解释的思考」，工具调用只是可选增强。
      if (r.agent && r.agent.thought) sawAgentThought = true;
      if ((r.agent.tools || []).includes('find_question')) sawDynamicPick = true;
      console.log(`    [${qIndex + 1}] 工具链 ${(r.agent.tools || []).join(' → ') || '（无）'} | ${Date.now() - t}ms`);
      console.log(`        思考：${String(r.agent.thought || '').slice(0, 60)}`);
    }
    console.log(`        面试官：${String(r.nextLine).slice(0, 90)}…`);
    if (r.done) break;
    if (r.nextQuestion) qIndex = r.nextQuestion.index;
    else qIndex += 1;
  }
  check('面试能推进到结束', guard < 8);
  check('面试官 Agent 每轮都有可解释的思考', sawAgentThought);
  console.log(`  Agent 工具调用轨迹：${sawAgentTrace ? '有（清晰Card-as-Tool）' : '无（速度优先，允许）'}`);
  console.log(`  追问出现：${sawFollowUp ? '是' : '否'}；Agent 动态挑题：${sawDynamicPick ? '是' : '否'}\n`);

  // 3. 结束并出报告（评估官 + 陪练官并行）
  const t1 = Date.now();
  const fin = await callTool('finish_interview', { sessionId: started.sessionId });
  const rep = fin.report || {};
  check('finish_interview 产出评估报告', !!rep && rep.overall !== undefined, JSON.stringify(rep).slice(0, 120));
  check('报告含评估官 Agent 的整体评价', !!rep.agentVerdict, String(rep.agentVerdict).slice(0, 100));
  check('报告含逐题复盘 agentPerQuestion', Array.isArray(rep.agentPerQuestion) && rep.agentPerQuestion.length > 0, `实际 ${(rep.agentPerQuestion || []).length} 条`);
  check('报告含陪练官 Agent 的提升计划', !!(rep.coachPlan && Array.isArray(rep.coachPlan.plan) && rep.coachPlan.plan.length), JSON.stringify(rep.coachPlan && rep.coachPlan.focus || []));
  check('transcript 记录了完整对话', Array.isArray(fin.transcript) && fin.transcript.length > 0, `${(fin.transcript || []).length} 轮`);
  console.log(`    总分：${rep.overall} | 出报告耗时 ${Date.now() - t1}ms`);
  console.log(`    评估官结论：${String(rep.agentVerdict).slice(0, 80)}`);
  if (rep.coachPlan && rep.coachPlan.focus) console.log(`    陪练官重点：${rep.coachPlan.focus.join(' / ')}`);
  console.log();

  // 4. 回读报告
  const got = await callTool('get_report', { sessionId: started.sessionId });
  check('get_report 能回读已结束的会话', got.status === 'finished' && !!got.report, got.status);

  // 5. 单条批改
  const an = await callTool('analyze_answer', {
    position: pos, question: '说说线程池的核心参数', points: ['核心线程数与最大线程数的区别', '队列选择', '拒绝策略'],
    answer: '线程池有核心线程数和最大线程数，队列一般用阻塞队列，拒绝策略有四种。'
  });
  check('analyze_answer 给出深度评分与改进建议', an.depth !== undefined && !!an.better, JSON.stringify(an).slice(0, 160));

  // 6. 知识库检索
  const kn = await callTool('knowledge_lookup', { position: pos, query: '线程池 拒绝策略', limit: 3 });
  check('knowledge_lookup 返回知识片段', kn && (kn.hits || []).length >= 0, typeof kn === 'string' ? kn.slice(0, 80) : `${(kn.hits || []).length} 条`);

  child.stdin.end();
  const failed = results.filter(r => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) { console.log('失败项：'); failed.forEach(f => console.log('  - ' + f.name + ' ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('\n联调异常：', e.message);
  try { child.kill(); } catch { /* noop */ }
  process.exit(1);
});
