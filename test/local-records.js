/* 只读验证：已有本地记录、个人成长曲线、历史报告与原始作答回放。 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.MOCKMIRROR_URL || 'http://127.0.0.1:3000';
(async () => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/db.json'), 'utf8'));
  const h = d.history.find(h => d.history.filter(x => x.userId === h.userId).length >= 2 &&
    (d.sessions[h.id]?.rounds || []).some(r => r.answer));
  assert(h, '需要一个已有两次以上练习且有作答内容的本地账户');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.evaluate(async user => {
      state.user = user;
      await loadPositions();
      go('history');
    }, d.users.find(u => u.id === h.userId));
    await page.waitForSelector('#growth-chart svg');
    assert.equal(await page.locator('#growth-chart svg circle').count(), Math.min(50, d.history.filter(x => x.userId === h.userId).length));
    assert.equal(await page.locator('#history-list .hist-item').count(), Math.min(50, d.history.filter(x => x.userId === h.userId).length));
    await page.evaluate(id => viewSession(id), h.id);
    assert(await page.locator('#view-report').isVisible());
    assert(await page.locator('.replay .rp-a').count() > 0);
    assert.deepEqual(errors, []);
    console.log('PASS 个人历史列表和成长曲线正确；重新打开本地报告可查看原始回答与追问；未写入数据');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
