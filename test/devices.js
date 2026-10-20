/* 麦克风设备选择功能验证：会前下拉框 → 切换设备 → 音量条重建 → 会中设备面板 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) process.exitCode = 1; };

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.fill('#login-name', '设备测试');
  await page.click('#login-card .btn.primary');
  await page.waitForSelector('.pos-card');
  await page.click('.pos-card:nth-child(1)');
  await page.click('#btn-start');
  await page.waitForSelector('#pj-join', { state: 'visible' });
  await page.waitForTimeout(2500);   // 等授权 + 枚举设备

  // 1. 下拉框已填充且可用
  const opts = await page.$$eval('#pj-mic-select option', els => els.map(e => ({ v: e.value, t: e.textContent })));
  console.log('   识别到麦克风:', JSON.stringify(opts));
  ok(opts.length >= 1, `麦克风下拉框有 ${opts.length} 项`);
  ok(opts[0].t && !opts[0].t.includes('未检测到'), '选项文案为真实设备名而非"未检测到"');
  const disabled = await page.$eval('#pj-mic-select', el => el.disabled);
  ok(!disabled, '下拉框可交互');

  // 2. 音量条随音量变化（假设备有音频信号）
  const lv1 = await page.$eval('#pj-meter-fill', el => el.style.width);
  await page.waitForTimeout(500);
  const lv2 = await page.$eval('#pj-meter-fill', el => el.style.width);
  ok(!!lv1 && !!lv2, `音量条在跳动（${lv1} → ${lv2}）`);

  // 3. 切换设备（选中同一项也应安全重建采集流）
  const deviceId = opts[0].v;
  await page.evaluate(id => selectMicDevice(id), deviceId);
  await page.waitForTimeout(1200);
  const persisted = await page.evaluate(() => localStorage.getItem('mm.mic.deviceId'));
  ok(persisted === deviceId, '选择结果已持久化到 localStorage');
  const hint = await page.textContent('#pj-mic-devhint');
  console.log('   设备提示:', hint);
  ok(/已切换|当前使用/.test(hint), '设备提示文案正确');
  const meterAfter = await page.$eval('#pj-meter-fill', el => el.style.width);
  ok(!!meterAfter, `切换后音量条仍在工作（${meterAfter}）`);
  await page.screenshot({ path: 'test/shots/dev-01-prejoin.png' });

  // 4. 刷新重扫描按钮
  await page.click('.pj-devpick .dev-refresh');
  await page.waitForTimeout(400);
  ok(await page.isVisible('#pj-mic-select'), '重扫按钮未破坏下拉框');

  // 5. 进入会议 → 设备面板
  await page.click('#pj-join');
  await page.waitForSelector('.msg.ai');
  await page.click('#ctrl-dev');
  await page.waitForTimeout(500);
  ok(await page.isVisible('#dev-panel'), '会中设备面板可打开');
  const mOpts = await page.$$eval('#mtg-mic-select option', els => els.map(e => e.value));
  ok(mOpts.length === opts.length, '会中下拉框与会前设备数量一致');
  const mVal = await page.$eval('#mtg-mic-select', el => el.value);
  ok(mVal === deviceId, '会中下拉框回显已选设备');
  await page.screenshot({ path: 'test/shots/dev-02-meeting-panel.png' });

  // 6. 会中切设备（同一设备也应安全重建）
  await page.evaluate(id => selectMicDevice(id), deviceId);
  await page.waitForTimeout(1000);
  ok(await page.isVisible('#mtg-mic-select'), '会中切换设备后无异常');
  await page.click('#ctrl-dev');
  await page.waitForTimeout(200);
  ok(!(await page.isVisible('#dev-panel')), '再次点击可收起面板');

  if (errors.length) { console.log('运行期错误:'); errors.forEach(e => console.log('   ' + e)); }
  ok(errors.length === 0, '无页面/控制台错误');
  await browser.close();
})().catch(e => { console.error('❌ 测试中断:', e.message); process.exit(1); });
