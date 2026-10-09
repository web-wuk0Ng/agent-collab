/**
 * AI 引擎设置面板 UI 测试（Playwright）
 * 用法：BROWSER_CHANNEL=msedge node test/ai-settings.js
 * 验证：① 设置弹窗正常打开；② 切换三种引擎时字段联动；③ 测试连接结果正确；④ 徽章同步；⑤ 无控制台报错
 */

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.fill('#login-name', '引擎测试');
  await page.click('#login-card .btn.primary');
  await page.waitForSelector('.pos-card');

  // 打开 AI 设置
  await page.click('text=⚙ AI 设置');
  await page.waitForSelector('#ai-modal:not(.hidden)');
  await page.selectOption('#cfg-engine', 'llm');
  await page.waitForTimeout(200);
  const llmVisible = await page.$eval('#cfg-llm-fields', el => !el.classList.contains('hidden'));
  const agentHidden = await page.$eval('#cfg-agent-fields', el => el.classList.contains('hidden'));
  console.log(`llm 字段可见: ${llmVisible} / agent 字段隐藏: ${agentHidden}`);

  // 切到 Python Agent 引擎
  await page.selectOption('#cfg-engine', 'python');
  await page.waitForTimeout(1200);
  const agentVisible = await page.$eval('#cfg-agent-fields', el => !el.classList.contains('hidden'));
  const status = await page.textContent('#agent-status');
  console.log(`agent 字段可见: ${agentVisible} · 探测结果: ${status.replace(/\s+/g, ' ').slice(0, 90)}`);
  await page.screenshot({ path: 'test/shots/14-ai-settings-agent.png' });

  // 测试连接
  await page.click('#ai-modal .btn.ghost');
  await page.waitForTimeout(2500);
  const result = await page.textContent('#ai-test-result');
  const detail = await page.textContent('#ai-test-detail');
  console.log(`测试连接: ${result} · ${String(detail).slice(0, 80)}`);
  await page.screenshot({ path: 'test/shots/15-ai-test.png' });

  const badge = await page.textContent('#ai-mode-badge');
  console.log(`顶栏徽章: ${badge}`);

  // 恢复离线引擎，避免影响后续演示
  await page.selectOption('#cfg-engine', 'offline');
  await page.click('#ai-modal .btn.primary');
  await page.waitForTimeout(600);
  console.log(`恢复后徽章: ${await page.textContent('#ai-mode-badge')}`);

  await browser.close();
  if (errs.length) { console.error('❌ 页面报错:\n' + errs.join('\n')); process.exit(1); }
  if (!agentVisible || !llmVisible || !agentHidden) { console.error('❌ 字段联动异常'); process.exit(1); }
  if (!/连接成功/.test(result)) { console.error('❌ 测试连接失败（请先启动 python-agent 服务）'); process.exit(1); }
  console.log('✅ AI 引擎设置面板正常，Python Agent 连接成功');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
