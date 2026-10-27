// 流式流畅度回归：验证「边生成边出声」链路真的可用，并测出真实延迟指标
// 指标1 TTFW：从提交回答到收到第一个字的耗时（决定"说完就能听到回应"的体感）
// 指标2 首句可念：第一个可朗读小句到达的耗时
// 指标3 全文完成耗时
const base = 'http://127.0.0.1:3000';
const call = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());

let pass = 0, fail = 0;
const check = (ok, name, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' —— ' + extra : ''}`);
  ok ? pass++ : fail++;
};

/** 把只回一次 done 事件的 SSE 接口读成普通对象（如「解释这道题」） */
async function ssePayload(pathname, body) {
  const res = await fetch(base + pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let pending = '', payload = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += dec.decode(value, { stream: true });
    const blocks = pending.split('\n\n');
    pending = blocks.pop() || '';
    for (const b of blocks) {
      const line = b.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      try { const ev = JSON.parse(line.slice(5).trim()); if (ev.type === 'done') payload = ev.payload; } catch {}
    }
  }
  return payload;
}

async function streamAnswer(sessionId, qIndex, answer, command) {
  const t0 = Date.now();
  const res = await fetch(base + '/api/interview/answer-stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, qIndex, answer, metrics: null, command: command || '' })
  });
  check(res.ok, 'SSE 连接建立', 'HTTP ' + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let pending = '', first = null, firstSentence = null, acc = '', payload = null;
  const SENT = /[。！？；，、]/;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += dec.decode(value, { stream: true });
    const blocks = pending.split('\n\n');
    pending = blocks.pop() || '';
    for (const b of blocks) {
      const line = b.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === 'delta') {
        if (first === null) first = Date.now() - t0;
        acc += ev.text;
        if (firstSentence === null && SENT.test(acc)) firstSentence = Date.now() - t0;
      } else if (ev.type === 'done') {
        payload = ev.payload;
      }
    }
  }
  return { first, firstSentence, total: Date.now() - t0, acc, payload };
}

(async () => {
  console.log('流式流畅度回归\n');
  const u = await call('/api/login', { name: '流畅度测试' });
  const s = await call('/api/interview/start', { userId: u.user.id, position: 'java-backend', mode: 'text', rounds: 4 });
  const sid = (s.session && s.session.id) || s.sessionId;

  // 1. 正式回答走流式
  const r1 = await streamAnswer(sid, 0,
    '底的话就是说呃平常会看各种各样的博客，中英文的博客进行学习。然后最近学会的用在项目里的例子就是呃比如说这个呃后端项目中的哈 map的相关的一些知识，大概就是这些了。');
  check(r1.first !== null, '收到首个字（可以立刻开念）', `${r1.first} ms`);
  check(r1.first !== null && r1.first < 3500, '首个字到达 < 3.5s', `${r1.first} ms`);
  check(r1.firstSentence !== null && r1.firstSentence < 5000, '首句可读 < 5s', `${r1.firstSentence} ms`);
  const hasMap = /map/i.test(r1.payload ? r1.payload.nextLine || '' : '') || /Map/.test(r1.acc);
  const notMQ = !/MQ/.test(r1.acc);
  check(notMQ, '没有把听不清的词臆断成 MQ', JSON.stringify(r1.acc.slice(0, 60)));
  console.log(`   累计文本：${JSON.stringify(r1.acc.slice(0, 80))}`);
  console.log(`   全文完成：${r1.total} ms`);

  // 2. 口头指令「下一题」
  const r2 = await streamAnswer(sid, 0, '', 'next');
  check(!!(r2.payload && (r2.payload.progress)), '口头指令「下一题」返回新进度', JSON.stringify(r2.payload && r2.payload.progress));
  check(r2.first !== null && r2.first < 3500, '「下一题」也是流式响应', `${r2.first} ms`);

  // 3. 解释这道题 / 难度调整
  const ex = await ssePayload('/api/interview/explain', { sessionId: sid, qIndex: 1 });
  check(!!(ex && ex.nextLine && ex.sameTurn), '「解释这道题」返回通俗讲解且不消耗题序', JSON.stringify((ex.nextLine || '').slice(0, 40)));
  const easy = await call('/api/interview/coach', { sessionId: sid, qIndex: 1, kind: 'easier' });
  check(!!(easy && easy.nextLine && easy.sameTurn), '「换简单一点」返回更简单问法', JSON.stringify((easy.nextLine || '').slice(0, 40)));

  await call('/api/interview/finish', { sessionId: sid });
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
