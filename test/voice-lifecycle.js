/* 浏览器回归：取消朗读、迟到的 AI 回复、尾帧精识别和麦克风释放。
 * node test/voice-lifecycle.js（需要 Playwright；不调用付费 AI，不写面试记录） */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.MOCKMIRROR_URL || 'http://127.0.0.1:3000';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname;
      let body = {};
      if (p === '/api/ai-config') body = { engine: 'llm', configured: true, hasKey: true, model: 'deepseek-chat' };
      if (p === '/api/asr/status') body = { available: true };
      if (p === '/api/interview/finish') body = { report: { overall: 75, dimensions: [] }, transcript: [] };
      if (p === '/api/interview/answer-stream') {
        await new Promise(r => setTimeout(r, 350));
        body = { followUp: true, nextLine: '这条迟到的追问不应播放。' };
        return route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ type: 'done', payload: body }) + '\n\n' });
      }
      await route.fulfill({ json: body });
    });
    await page.addInitScript(() => {
      window.testSpeech = { spoken: [], pending: [] };
      Object.defineProperty(window, 'speechSynthesis', { value: {
        getVoices: () => [{ name: 'Microsoft Huihui', lang: 'zh-CN' }], resume() {},
        speak(u) { testSpeech.spoken.push(u.text); testSpeech.pending.push(u); },
        cancel() {
          for (const u of testSpeech.pending.splice(0)) {
            const cb = u.onerror;
            if (cb) setTimeout(() => cb({ error: 'canceled' }), 20);
          }
        }
      }});
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    });
    await page.goto(base);
    const setup = () => page.evaluate(() => {
      state.session = { id: 'iv_voice_regression', mode: 'voice', currentQ: { index: 0 } };
      document.getElementById('auto-mic').checked = false;
      document.getElementById('tts-on').checked = true;
      document.getElementById('answer-input').disabled = false;
      document.getElementById('answer-input').value = '';
      document.getElementById('chat-log').innerHTML = '';
      go('interview');
      document.getElementById('meeting').classList.remove('hidden');
    });
    const count = () => page.evaluate(() => testSpeech.spoken.length);
    page.on('dialog', d => d.accept());

    await setup();
    await page.evaluate(() => speakText('这是第一句。结束后不应说第二句。'));
    const playing = await count();
    await page.click('.ctrl.end');
    await page.waitForTimeout(200);
    assert.equal(await count(), playing, '取消事件不能复活后续句子');
    assert.equal(await page.evaluate(() => aiSpeakingNow), false);
    assert.equal(await page.locator('#meeting').isVisible(), false);
    console.log('PASS 点击结束面试：停止当前句，取消事件不会续播');

    await setup();
    await page.evaluate(() => {
      speakText('句间暂停测试。下一句不应播放。');
      testSpeech.pending.at(-1).onend();
      finishInterview(true);
    });
    const gapCount = await count();
    await page.waitForTimeout(200);
    assert.equal(await count(), gapCount, '句间 timer 必须取消');
    console.log('PASS 句间停顿结束面试：定时器不会续播');

    await setup();
    await page.evaluate(() => {
      document.getElementById('answer-input').value = '我使用 Agent 编排工具调用，回答完毕。';
      submitAnswer(true);
    });
    await page.waitForTimeout(80);
    await page.evaluate(() => finishInterview(true));
    const lateCount = await count();
    await page.waitForTimeout(550);
    assert.equal(await count(), lateCount, '结束后的迟到 AI 回复必须丢弃');
    console.log('PASS 回答请求在途时结束：迟到回复不会发声');

    await setup();
    await page.evaluate(() => {
      speakText('被替换的旧朗读。旧的下一句。');
      speakText('新的朗读。');
    });
    const replacementCount = await count();
    await page.waitForTimeout(160);
    assert.equal(await count(), replacementCount, '旧播放链不能干扰新播放链');
    await page.locator('#tts-on').uncheck({ force: true });
    assert.equal(await page.evaluate(() => aiSpeakingNow), false);
    console.log('PASS 替换朗读与关闭面试官语音：旧回调全部作废');

    const local = await page.evaluate(async () => {
      const nativeFetch = window.fetch;
      const calls = [];
      let released = 0, processor;
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() { released++; } }] })
      }});
      window.AudioContext = class {
        constructor() { this.sampleRate = 16000; this.destination = {}; }
        createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
        createScriptProcessor() { processor = { connect() {}, disconnect() {} }; return processor; }
        close() {}
      };
      window.fetch = async (url, opts) => {
        calls.push(url);
        if (url.endsWith('/chunk')) await new Promise(r => setTimeout(r, 40));
        return { ok: true, json: async () => url.endsWith('/end') ? { text: '我使用 Agent 和 DeepSeek。' } : { text: 'A整', endpoint: false } };
      };
      let refined = '';
      const engine = LocalASR.createEngine({ onRefined: t => { refined = t; } });
      await engine.start();
      processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096) } });
      processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(500) } });
      const stopped = engine.stop();
      const immediateRelease = released;
      const samePromise = stopped === engine.stop() && stopped === engine.stoppedPromise;
      await stopped;
      window.fetch = nativeFetch;
      return { calls, refined, immediateRelease, samePromise };
    });
    assert.deepEqual(local.calls, ['/api/asr/chunk', '/api/asr/chunk', '/api/asr/end']);
    assert.equal(local.immediateRelease, 1);
    assert.equal(local.samePromise, true);
    assert.match(local.refined, /Agent 和 DeepSeek/);
    console.log('PASS 尾帧顺序上传、只结束一次、等待精识别、麦克风立即释放');

    await setup();
    const actual = await page.evaluate(async () => {
      const nativeFetch = window.fetch;
      let submitted = '';
      const base = document.getElementById('answer-input');
      base.value = '粗识别 A整';
      const promise = new Promise(r => setTimeout(() => { base.value = '我使用 Agent 和 DeepSeek。'; r(); }, 100));
      recog = { stoppedPromise: promise, stop() { return promise; } };
      listenState = { stopped: false };
      window.fetch = async (url, opts) => {
        if (url.endsWith('/answer-stream')) {
          submitted = JSON.parse(opts.body).answer;
          return new Response('data: ' + JSON.stringify({ type: 'done', payload: { followUp: true, nextLine: '继续。' } }) + '\n\n');
        }
        return { ok: true, json: async () => ({ followUp: true, nextLine: '继续。' }) };
      };
      await submitAnswer(true);
      window.fetch = nativeFetch;
      stopSpeech();
      return submitted;
    });
    assert.equal(actual, '我使用 Agent 和 DeepSeek。');
    console.log('PASS 正式回答等待精识别，不发送粗识别错词');

    await setup();
    const webAnswer = await page.evaluate(async () => {
      const nativeFetch = window.fetch;
      let submitted = '';
      window.SpeechRecognition = class extends EventTarget {
        start() { this.onstart(); }
        stop() {
          setTimeout(() => {
            const final = [{ transcript: '我使用 agent 调用工具' }];
            final.isFinal = true;
            this.onresult({ resultIndex: 0, results: [final] });
            this.onend();
            this.dispatchEvent(new Event('end'));
          }, 30);
        }
      };
      asrPrefer = 'webspeech';
      startListening({ auto: true });
      window.fetch = async (url, opts) => {
        if (url.endsWith('/answer-stream')) {
          submitted = JSON.parse(opts.body).answer;
          return new Response('data: ' + JSON.stringify({ type: 'done', payload: { followUp: true, nextLine: '收到。' } }) + '\n\n');
        }
        return { ok: true, json: async () => ({ followUp: true, nextLine: '收到。' }) };
      };
      await submitAnswer(true);
      window.fetch = nativeFetch;
      stopSpeech();
      return submitted;
    });
    assert.match(webAnswer, /agent 调用工具/i);
    console.log('PASS 浏览器在线引擎等待最终词句，保留原始术语供上下文理解');
    assert.equal(await page.locator('[data-nav="admin"], #view-admin').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS 无管理员入口、无浏览器运行错误');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
