/**
 * Agent 工作台面板验证（真实浏览器 + 真实大模型）：
 *   1. 面试间侧栏出现「Agent 工作台」
 *   2. 4 个 Agent 角色卡渲染正确（含各自工具）
 *   3. 提交回答后，面试官 Agent 的「思考 → 工具 → 观察 → 决定」实时画在面板上
 *   4. 结束面试后，报告页出现评估官复核与陪练官提升计划
 * 运行：node test/agent-panel.js（需服务已启动且已配置大模型）
 */
const { chromium } = require('playwright');

const ANSWERS = [
  '我做过一个电商订单系统，用 Spring Boot 加 MySQL，订单表按用户 ID 分库分表，热点商品详情用 Redis 缓存，接口响应时间从 200 毫秒降到 40 毫秒。',
  '线程池的核心参数有核心线程数、最大线程数、存活时间、队列和拒绝策略，我们下单接口用线程池异步发券，核心线程数设的是 CPU 核数的两倍。'
];

(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));   // 结束面试的确认弹窗自动确认
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const ok = (c, m, extra) => { console.log((c ? '✅ ' : '❌ ') + m + (c ? '' : '  → ' + (extra || ''))); if (!c) process.exitCode = 1; };

  console.log('\nAgent 工作台面板验证\n');

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.fill('#login-name', 'Agent 面板测试');
  await page.click('#login-card .btn.primary');
  await page.waitForSelector('.pos-card');
  await page.click('.pos-card:nth-child(1)');
  await page.click('#btn-start');
  await page.waitForSelector('#pj-join', { state: 'visible' });
  await page.waitForTimeout(1800);
  await page.click('#pj-join');
  await page.waitForSelector('.msg.ai');
  // 关掉面试官语音，避免等待朗读
  await page.evaluate(() => { document.getElementById('tts-on').checked = false; });

  // 1. Agent 工作台 tab
  const tabText = await page.textContent('.side-tab[data-mtab="agent"]');
  ok(/Agent/.test(tabText || ''), '侧栏出现「Agent 工作台」页签', tabText);

  await page.click('.side-tab[data-mtab="agent"]');
  await page.waitForSelector('#mtab-agent', { state: 'visible' });
  ok(await page.isVisible('#mtab-agent'), '点击后 Agent 工作台面板可见');
  ok(!(await page.isVisible('#mtab-chat')), '切走后面试对话面板隐藏');

  // 2. 4 个角色卡
  await page.waitForSelector('.ar-card', { timeout: 8000 });
  const roles = await page.$$eval('.ar-card', els => els.map(e => ({
    role: e.dataset.role,
    name: e.querySelector('b') ? e.querySelector('b').textContent : '',
    tools: [...e.querySelectorAll('.ar-tools em')].map(x => x.textContent)
  })));
  ok(roles.length === 4, `渲染 4 个 Agent 角色卡（实际 ${roles.length}）`);
  ok(roles.map(r => r.role).join(',') === 'interviewer,evaluator,coach,writer', '角色齐全：面试官/评估官/陪练官/出题官', roles.map(r => r.role).join(','));
  ok(roles.every(r => r.tools.length >= 3), '每个角色都列出了自己可用的工具', JSON.stringify(roles.map(r => r.tools.length)));
  console.log('   ' + roles.map(r => `${r.name}(${r.tools.length} 工具)`).join(' · '));

  // 3. 提交回答 → 思考链可视化
  ok(await page.isVisible('.at-empty'), '初始状态提示「等你提交第一个回答」');

  for (let i = 0; i < ANSWERS.length; i++) {
    await page.evaluate(t => { document.getElementById('answer-input').value = t; }, ANSWERS[i]);
    await page.evaluate(() => submitAnswer(false));
    await page.waitForFunction(n => document.querySelectorAll('#agent-trace .at-card').length >= n, i + 1, { timeout: 60000 });
  }

  const cards = await page.$$eval('#agent-trace .at-card', els => els.map(e => ({
    tag: e.querySelector('.at-tag') ? e.querySelector('.at-tag').textContent : '',
    decision: e.querySelector('.at-conclusion') ? e.querySelector('.at-conclusion').textContent : '',
    steps: [...e.querySelectorAll('.at-step')].map(s => ({
      think: s.querySelector('.at-think') ? s.querySelector('.at-think').textContent : '',
      tool: s.querySelector('.at-tool code') ? s.querySelector('.at-tool code').textContent : '',
      obs: s.querySelector('.at-obs') ? s.querySelector('.at-obs').textContent : ''
    }))
  })));
  ok(cards.length >= 2, `提交 ${ANSWERS.length} 次后生成 ${cards.length} 张决策卡`);
  ok(cards.every(c => /第 \d+ 次决策/.test(c.tag)), '每张卡标注了第几次决策与步数', JSON.stringify(cards.map(c => c.tag)));
  const allSteps = cards.flatMap(c => c.steps);
  ok(allSteps.length > 0, `面板展示出 ${allSteps.length} 条工具调用步骤`);
  ok(allSteps.every(s => s.think && s.tool && s.obs), '每步都完整展示「思考 / 调用 / 看到」三要素');
  const toolsUsed = [...new Set(allSteps.map(s => s.tool))];
  ok(toolsUsed.length > 0, '面板能看到具体被调用的工具：' + toolsUsed.join(' · '));
  console.log('   示例步骤：' + (allSteps[0] ? `${allSteps[0].tool} → ${allSteps[0].obs.slice(0, 70)}…` : '无'));
  ok((await page.$$eval('#agent-trace .at-card', e => e.length)) <= 4, '面板最多保留最近 4 次决策，不会无限变长');

  // 4. 结束面试 → 报告页多 Agent 区块
  await page.click('#ctrl-stop');   // 不触发中断歧义，直接点结束
  await page.evaluate(() => finishInterview(false));
  await page.waitForSelector('#view-report', { state: 'visible', timeout: 90000 });
  await page.waitForSelector('#report-body .card', { timeout: 15000 });

  const agentCards = await page.$$eval('#report-body .agent-card h2', els => els.map(e => e.textContent.trim()));
  ok(agentCards.length >= 1, '报告页出现多 Agent 区块：' + agentCards.join(' / '));
  const hasReview = /评估官/.test(agentCards.join(' '));
  ok(hasReview, '报告含「评估官 Agent 复核」');
  if (hasReview) {
    const verdict = await page.textContent('.ag-verdict').catch(() => '');
    ok((verdict || '').length > 10, '评估官给出整体结论：' + String(verdict).slice(0, 60) + '…');
    const rows = await page.$$eval('.ag-row', els => els.length).catch(() => 0);
    ok(rows > 0, `评估官给出 ${rows} 条逐题复盘`);
    const better = await page.$$eval('.ag-row p em.b', els => els.length).catch(() => 0);
    ok(better > 0, `逐题复盘里给出了 ${better} 条「该怎么答」`);
  }
  const hasCoach = /陪练官/.test(agentCards.join(' '));
  ok(hasCoach, '报告含「陪练官 Agent 提升计划」');
  if (hasCoach) {
    const focus = await page.$$eval('.ag-focus span', els => els.map(e => e.textContent)).catch(() => []);
    ok(focus.length >= 1, '陪练官列出重点补缺：' + focus.join(' / '));
    const days = await page.$$eval('.ag-day', els => els.length).catch(() => 0);
    ok(days >= 1, `陪练官给出 ${days} 天的具体练习安排`);
    const drills = await page.$$eval('.ag-drill', els => els.length).catch(() => 0);
    ok(drills >= 1, `陪练官额外给了 ${drills} 道针对性练习题`);
  }

  // 5. 无 JS 报错
  ok(errors.length === 0, '全程无 JS 报错', errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: 'test/shots/agent-report.png', fullPage: true });
  await browser.close();
  console.log('\n截图：test/shots/agent-report.png');
})().catch(e => { console.error('验证异常：', e.message); process.exit(1); });
