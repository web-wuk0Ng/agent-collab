/* test/prefetch-hit.js —— 验证"边说边预取 → 提交命中 → 零等待"链路
 * 模拟真实时序：说话途中发 prefetch → 相同文本提交 → 服务端应命中预取。
 */
const base = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, msg) => { console.log((c ? '  ✔ ' : '  ✘ ') + msg); c ? pass++ : fail++; };

async function post(p, body) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

(async () => {
  console.log('预取命中链路验证\n');
  const u = await post('/api/login', { name: '预取测试' });
  const started = await post('/api/interview/start', { userId: u.user.id, position: 'java-backend', mode: 'text', rounds: 3 });
  const sid = started.sessionId;
  const qIndex = 0;

  // 1) 候选人"说了一半"时发预取
  const half = 'HashMap 底层是数组加链表，JDK8 之后引入了红黑树，当链表长度超过八且数组长度大于等于六十四时会转成红黑树，扩容是容量翻倍，负载因子零点七五';
  const t0 = Date.now();
  await post('/api/interview/prefetch', { sessionId: sid, qIndex, answer: half });
  console.log(`  预取已发出（耗时 ${Date.now() - t0}ms，后台在跑）`);

  // 2) 提交完整相同文本（语义有修改时不能复用旧判断）
  const full = half;
  const t1 = Date.now();
  const r = await post('/api/interview/answer', { sessionId: sid, qIndex, answer: full });
  const ms = Date.now() - t1;
  ok(!!r.nextLine, '提交拿到面试官回应：' + JSON.stringify((r.nextLine || '').slice(0, 40)));
  ok(r.agent && r.agent.prefetched === true, `预取命中（${ms}ms）`);
  ok(ms < 3000, `响应够快（${ms}ms < 3000ms）`);

  // 3) 完全没预取的现场决策延迟（衡量 Agent 单轮真实耗时）
  const q2 = r.question;
  if (q2) {
    const t2 = Date.now();
    const r2 = await post('/api/interview/answer', {
      sessionId: sid, qIndex: q2.index,
      answer: '这个我之前在项目里用过，我们用 Redis 做缓存，用了布隆过滤器防止缓存穿透，还设置了过期时间加随机值防止雪崩，同时用互斥锁保证只有一个请求去回源数据库。'
    });
    const ms2 = Date.now() - t2;
    ok(!!r2.nextLine, `未命中路径（现场 Agent 决策）正常：${JSON.stringify((r2.nextLine || '').slice(0, 30))}`);
    ok(ms2 < 15000, `现场决策 ${ms2}ms（优化前约 10~20s）`);
    console.log(`\n  现场决策 Agent 信息：${JSON.stringify(r2.agent)}`);
  }

  await post('/api/interview/finish', { sessionId: sid });
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e.message); process.exit(1); });
