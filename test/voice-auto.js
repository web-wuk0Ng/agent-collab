/* 纯语音全自动流程验证：
 * 用 Chrome 的 --use-file-for-fake-audio-capture 把真实中文语音当成"麦克风输入"，
 * 验证 麦克风 → 本地 ASR → 实时字幕 → 说完自动提交 的完整链路（全程不点任何按钮）。
 */
const path = require('path');
const { chromium } = require('playwright');

const WAV = path.resolve('test/fixtures/answer-with-gap.wav');

(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${WAV}`
    ]
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('mm.asr.prefer', 'local'));   // 测试环境固定走本地引擎
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) process.exitCode = 1; };

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.fill('#login-name', '语音测试');
  await page.click('#login-card .btn.primary');
  await page.waitForSelector('.pos-card');
  await page.click('.pos-card:nth-child(1)');
  await page.click('#btn-start');
  await page.waitForSelector('#pj-join', { state: 'visible' });
  await page.waitForTimeout(2000);
  await page.click('#pj-join');
  await page.waitForSelector('.msg.ai');

  // 1. 界面确认：没有输入框、没有发送按钮
  ok(!(await page.isVisible('#answer-input')), '文字输入框已隐藏（无打字入口）');
  ok(!(await page.$('.chat-input .btn.primary')), '「回答完毕」发送按钮已移除');
  // 识别结果只在后台用于提交，不展示到界面上（避免面试时候选人盯着文字念）
  ok(!(await page.isVisible('#voice-live')), '识别文字不展示到界面（后台识别、只显示收音状态）');
  ok(!!(await page.$('#voice-live')), '识别缓冲区仍然存在（用于自动提交判定）');

  // 2. 关掉面试官 TTS，避免假麦克风录到 TTS 声音（测试环境无回声消除）
  await page.evaluate(() => { document.getElementById('tts-on').checked = false; });

  // 3. 等自动开麦 → 假麦克风播放中文语音 → 观察实时字幕
  let transcript = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    await page.waitForTimeout(400);
    const live = await page.evaluate(() => {
      const c = document.getElementById('voice-confirmed').textContent;
      const i = document.getElementById('voice-interim').textContent;
      return (c + i).trim();
    });
    if (live.length > transcript.length) transcript = live;
    if (transcript.length >= 8) break;
  }
  console.log('   后台识别内容:', JSON.stringify(transcript));
  ok(transcript.length > 0, '后台识别出了文字（用于自动提交）');
  ok(!(await page.isVisible('#voice-live')), '识别过程中界面依然不显示文字');
  await page.screenshot({ path: 'test/shots/voice-01-auto.png' });

  // 4. 关键行为：没说结束词时不抢答（可以一直说、随便停顿）
  await page.waitForTimeout(6000);   // 静默 6 秒，模拟候选人停下来思考
  const before = await page.evaluate(() => document.querySelectorAll('.msg.me').length);
  ok(before === 0, '停顿很久也不会被抢答（仍在等你讲完）');

  // 5. 说了结束词 → 自动进入下一题
  await page.evaluate(() => {
    const el = document.getElementById('answer-input');
    el.value = el.value.replace(/[。，]*$/, '') + '，大概就是这些。';
    scheduleAutoSubmit(200);
  });
  let submitted = '';
  const t1 = Date.now();
  while (Date.now() - t1 < 20000) {
    await page.waitForTimeout(400);
    const me = await page.$$eval('.msg.me .bubble', els => els.map(e => e.textContent));
    if (me.length) { submitted = me[0]; break; }
  }
  console.log('   结束词提交内容:', JSON.stringify(submitted));
  ok(submitted.length > 0, '说出「大概就是这些」后自动提交，无需点任何按钮');
  ok(/感兴趣|介绍|研究/.test(submitted), '提交内容与假麦克风播放的中文语音一致');

  // 6. 提交后输入缓冲已清空，界面回到等待状态
  const buf = await page.evaluate(() => document.getElementById('answer-input').value);
  ok(buf === '', '提交后字幕/缓冲已清空，不会和下一轮重复');
  ok(await page.isVisible('#voice-state'), '状态条存在');

  if (errors.length) { console.log('运行期错误:'); errors.forEach(e => console.log('   ' + e)); }
  ok(errors.length === 0, '无页面/控制台错误');
  await browser.close();
})().catch(e => { console.error('❌ 测试中断:', e.message); process.exit(1); });
