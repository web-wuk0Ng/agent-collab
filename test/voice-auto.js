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
  ok(await page.isVisible('#voice-live'), '实时字幕区存在');

  // 2. 关掉面试官 TTS，避免假麦克风录到 TTS 声音（测试环境无回声消除）
  await page.evaluate(() => { document.getElementById('tts-on').checked = false; });

  // 3. 等自动开麦 → 假麦克风播放中文语音 → 观察字幕与自动提交
  let transcript = '', submitted = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await page.waitForTimeout(400);
    const live = await page.evaluate(() => {
      const c = document.getElementById('voice-confirmed').textContent;
      const i = document.getElementById('voice-interim').textContent;
      return (c + i).trim();
    });
    if (live.length > transcript.length) transcript = live;
    const me = await page.$$eval('.msg.me .bubble', els => els.map(e => e.textContent));
    if (me.length) { submitted = me[0]; break; }
  }
  console.log('   字幕内容:', JSON.stringify(transcript));
  console.log('   自动提交内容:', JSON.stringify(submitted));
  ok(transcript.length > 0, '实时字幕出现了识别文字');
  ok(submitted.length > 0, '没有任何点击，回答被自动提交到对话里');
  ok(/感兴趣|介绍|研究/.test(submitted), '提交内容与假麦克风播放的中文语音一致');
  await page.screenshot({ path: 'test/shots/voice-01-auto.png' });

  // 4. 提交后输入缓冲已清空，界面回到等待状态
  const buf = await page.evaluate(() => document.getElementById('answer-input').value);
  ok(buf === '', '提交后字幕/缓冲已清空，不会和下一轮重复');
  ok(await page.isVisible('#voice-state'), '状态条存在');

  if (errors.length) { console.log('运行期错误:'); errors.forEach(e => console.log('   ' + e)); }
  ok(errors.length === 0, '无页面/控制台错误');
  await browser.close();
})().catch(e => { console.error('❌ 测试中断:', e.message); process.exit(1); });
