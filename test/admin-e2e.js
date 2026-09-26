const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.click('[data-nav="admin"]');
  await page.waitForTimeout(500);
  await page.fill('#admin-pass', 'mockmirror2026');
  await page.click('#admin-login .btn.primary');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test/shots/11-admin-dash.png' });
  await page.click('[data-atab="students"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test/shots/12-admin-students.png' });
  await page.click('[data-atab="bank"]');
  await page.waitForTimeout(800);
  await page.click('#atab-bank .btn.primary'); // 导入示例（先填模板）
  await page.click('text=填入示例模板');
  await page.click('#atab-bank .btn.primary');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test/shots/13-admin-bank.png' });
  // 回首页确认自定义岗位出现
  await page.click('[data-nav="home"]');
  await page.waitForTimeout(800);
  const posCount = await page.$$eval('.pos-card', els => els.length);
  console.log('positions on home:', posCount);
  console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : '✅ admin E2E OK');
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
