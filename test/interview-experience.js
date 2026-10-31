/* 控时、救援按钮、流式尾队列与安全取消；不写真实会话或使用付费 AI。 */
const assert = require('node:assert/strict');
const bank = require('../lib/bank');
const interview = require('../lib/interview');
const llm = require('../lib/llm');
const agent = require('../lib/agent');
const { chromium } = require('playwright');
const base = process.env.MOCKMIRROR_URL || 'http://127.0.0.1:3000';

(async () => {
  bank.init();
  const q = bank.getBank('java-backend').questions[0];
  const s = { id: 'iv_test_experience', status: 'ongoing', position: 'java-backend', planSize: 2,
    plan: [{ ...q, full: q }, { ...q, id: 'second', text: '第二题如何处理？', full: { ...q, id: 'second', text: '第二题如何处理？' } }], rounds: [] };
  const chat = llm.chat, decide = agent.decide;
  try {
    let requested = '';
    llm.chat = async messages => { requested = messages.map(x => x.content).join('\n'); return '可以先从一个熟悉的使用场景开始吗？'; };
    const hint = await interview.hintCurrent(s, { qIndex: 0 });
    assert(hint.sameTurn); assert.match(requested, /不给解法/);
    assert.equal(s.rounds.length, 0);
    const skipped = await interview.handleAnswer(s, { qIndex: 0, answer: '这是我已经说过的部分', command: 'next' });
    assert.equal(skipped.question.index, 1); assert(s.rounds[0].skipped);
    assert.equal(s.rounds[0].answer, '这是我已经说过的部分');
    console.log('PASS 提示不记为回答、不消耗题序；跳题保留部分作答并确定推进');

    const originalPlan = JSON.stringify(s.plan);
    agent.decide = async snapshot => {
      snapshot.plan[1].text = '预推理不能提前改真实题目';
      snapshot.agentMemory.observations.push({ note: '预观察' });
      return { line: '你能具体说说这个场景吗？', trace: [] };
    };
    interview.prefetchNext(s, { qIndex: 0, answer: '已经说了一段相当完整的回答' });
    await s.prefetchTask;
    assert.equal(JSON.stringify(s.plan), originalPlan);
    assert.equal(s.agentMemory, undefined);
    assert(s.prefetch);
    console.log('PASS 增量预推理使用快照，不提前改题或写入能力观察');
  } finally { llm.chat = chat; agent.decide = decide; }

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/api/interview/turn-check') {
        const body = route.request().postDataJSON();
        if (body.answer.includes('模型判断时继续说')) await new Promise(r => setTimeout(r, 120));
        const finished = !body.answer.includes('我想想');
        return route.fulfill({ json: { finished, confidence: 0.98, nudge: '我在听。' } });
      }
      if (p === '/api/interview/finish') return route.fulfill({ json: { report: { overall: 77, dimensions: [] }, transcript: [] } });
      if (p === '/api/interview/hint') return route.fulfill({ json: { nextLine: '先从一个熟悉的场景想起，可以吗？', sameTurn: true } });
      if (p === '/api/interview/answer-stream') {
        const payload = { nextLine: '没关系，第二题如何处理？', question: { id: 'q2', index: 1, text: '第二题如何处理？' }, progress: { done: 1, total: 2 } };
        return route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ type: 'done', payload }) + '\n\n' });
      }
      return route.fulfill({ json: p === '/api/ai-config' ? { configured: true, engine: 'llm', hasKey: true } : { available: false } });
    });
    await page.addInitScript(() => {
      window.testSpeech = { spoken: [], autoEnd: true, last: null };
      Object.defineProperty(window, 'speechSynthesis', { value: {
        getVoices: () => [{ name: 'Microsoft Huihui', lang: 'zh-CN' }],
        cancel() {}, resume() {},
        speak(u) { testSpeech.spoken.push(u.text); testSpeech.last = u; if (testSpeech.autoEnd) setTimeout(() => u.onend?.(), 15); }
      }});
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    });
    await page.goto(base);
    await page.evaluate(() => {
      state.user = { id: 'u_test', name: '体验回归' };
      state.session = { id: 'iv_ux_test', mode: 'voice', currentQ: { id: 'q1', index: 0, text: '第一题如何思考？' } };
      state.reverseMode = false;
      document.getElementById('auto-mic').checked = false;
      document.getElementById('tts-on').checked = true;
      go('interview'); document.getElementById('meeting').classList.remove('hidden');
      prepareAnswerBudget();
    });
    const timer = await page.evaluate(() => {
      startAnswerBudget();
      answerBudget.startedAt = Date.now() - 101000;
      const mic = { stop() { throw new Error('提醒不能停止麦克风'); } };
      recog = mic;
      renderAnswerBudget(); renderAnswerBudget();
      const reminderCount = testSpeech.spoken.filter(t => t.includes('收尾')).length;
      answerBudget.startedAt = Date.now() - 125000;
      renderAnswerBudget();
      const result = { warning: document.getElementById('answer-budget').classList.contains('warning'),
        value: document.getElementById('answer-budget-time').textContent, reminderCount,
        sameMic: recog === mic, sameQuestion: state.session.currentQ.index === 0 };
      recog = null; pauseAnswerBudget();
      return result;
    });
    assert(timer.warning && timer.sameMic && timer.sameQuestion);
    assert.equal(timer.value, '00:00'); assert.equal(timer.reminderCount, 1);
    console.log('PASS 开口计时、20秒变色且只提醒一次，到时不停麦、不抢答、不交卷');

    await page.evaluate(() => { document.getElementById('answer-input').value = '这是我先前说过的部分回答'; });
    await page.click('#rescue-repeat');
    await page.waitForTimeout(160);
    assert.equal(await page.inputValue('#answer-input'), '这是我先前说过的部分回答');
    assert.equal(await page.evaluate(() => state.session.currentQ.index), 0);
    await page.click('#rescue-hint');
    await page.waitForTimeout(160);
    assert.equal(await page.inputValue('#answer-input'), '这是我先前说过的部分回答');
    assert.equal(await page.evaluate(() => state.session.currentQ.index), 0);
    await page.click('#rescue-skip');
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => state.session.currentQ.index), 1);
    assert.equal(await page.inputValue('#answer-input'), '');
    assert.equal(await page.locator('#ai-caption').isVisible(), false);
    assert.equal(await page.locator('#current-q').isVisible(), false);
    console.log('PASS 三个可见救援按钮生效，重听/提示保留草稿，跳过换题且重置预算，字幕不重复');

    const turns = await page.evaluate(async () => {
      stopSpeech();
      const before = document.querySelectorAll('.msg.me').length;
      const listen = text => {
        document.getElementById('answer-input').value = text;
        recog = { stop: () => Promise.resolve() };
        listenState = { stopped: false, lastSpeech: Date.now() - 3000, interim: '' };
      };
      listen('这个地方我想想，我还需要组织一下具体的过程。');
      await runTurnCheck();
      const waited = document.querySelectorAll('.msg.me').length === before && !!recog;
      listen('模型判断时继续说，我正在解释刚才的实现过程。');
      setTimeout(() => { if (listenState) listenState.lastSpeech = Date.now(); }, 30);
      await runTurnCheck();
      const continued = document.querySelectorAll('.msg.me').length === before && !!recog;
      listen('我们在线上用请求版本隔离旧回调，结束后释放监听和定时器，最后用并发用例验证了修复效果。');
      await runTurnCheck();
      const naturalEnd = document.querySelectorAll('.msg.me').length === before + 1;
      return { waited, continued, naturalEnd };
    });
    assert(turns.waited && turns.continued && turns.naturalEnd);
    await page.waitForTimeout(350);
    console.log('PASS 语义未完继续等，判断期间续说使旧判断失效，自然讲完无需固定结束口令');

    const streamed = await page.evaluate(async () => {
      stopSpeech();
      const sess = state.session;
      await beginStreamSpeech(sess);
      pushStreamSpeech('第一小句。第二小句。');
      endStreamSpeech('末尾也必须播放。');
      await new Promise(r => setTimeout(r, 400));
      return { spoken: testSpeech.spoken.slice(-3), speaking: aiSpeakingNow, queued: streamSpeech.queue.length };
    });
    assert.deepEqual(streamed.spoken, ['第一小句。', '第二小句。', '末尾也必须播放。']);
    assert.equal(streamed.speaking, false); assert.equal(streamed.queued, 0);
    console.log('PASS SSE结束后队列继续排空，尾句完整播放，恢复自动开麦状态');
    const canceled = await page.evaluate(async () => {
      testSpeech.autoEnd = false;
      await beginStreamSpeech(state.session);
      pushStreamSpeech('当前句。旧的下一句。');
      const callback = testSpeech.last.onend;
      const before = testSpeech.spoken.length;
      state.session = null; cleanupMeeting();
      callback();
      pushStreamSpeech('迟到片段。'); endStreamSpeech('迟到尾句。');
      await new Promise(r => setTimeout(r, 120));
      return { before, after: testSpeech.spoken.length, active: streamSpeech.active };
    });
    assert.equal(canceled.before, canceled.after); assert.equal(canceled.active, false);
    const reportTime = await page.evaluate(async () => {
      state.session = { id: 'iv_ux_report', mode: 'voice', currentQ: { index: 0 } };
      const started = performance.now();
      const pending = finishInterview(true);
      const staging = document.querySelectorAll('.report-stages span').length;
      await pending;
      return { elapsed: performance.now() - started, staging, score: document.querySelector('#report-body .val b')?.textContent };
    });
    assert(reportTime.elapsed >= 3000); assert.equal(reportTime.staging, 4); assert.equal(reportTime.score, '77');
    console.log('PASS 报告展示整理过程后出现总分，快速响应也不闪跳出分');
    assert.deepEqual(errors, []);
    console.log('PASS 流式取消后，旧回调和迟到文字均不能重新发声；浏览器无运行错误');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
