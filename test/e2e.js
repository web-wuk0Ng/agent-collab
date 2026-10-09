/* 端到端测试：首页 → 登录 → 选岗位 → 开始面试 → 多轮作答（触发追问）→ 生成报告 → 成长记录 → 知识库 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }).catch(e => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 850 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const shot = n => page.screenshot({ path: `test/shots/${n}.png`, fullPage: false });

  // 1. 首页
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await shot('01-home');

  // 2. 登录
  await page.fill('#login-name', '演示用户');
  await page.click('#login-card .btn.primary');
  await page.waitForSelector('.pos-card');
  await shot('02-positions');

  // 3. 选择岗位 + 开始面试 → 会前设备检测 → 加入会议
  await page.click('.pos-card:nth-child(2)'); // 第 2 个岗位卡：Python 算法工程师
  await page.selectOption('#opt-rounds', '4');
  await page.click('#btn-start');
  await page.waitForSelector('#pj-join', { state: 'visible' });
  await page.waitForTimeout(1500);            // 等待设备检测页预览与音量条渲染
  await shot('03-prejoin');
  const prejoinText = await page.textContent('#pj-meeting-id');
  if (!prejoinText || prejoinText === '-') throw new Error('会前检测页会议号未渲染');
  await page.click('#pj-join');
  await page.waitForSelector('.msg.ai');
  await page.waitForTimeout(600);
  await shot('03-interview-start');

  // 3.1 会议内视图切换 + 侧栏面板
  await page.click('#ctrl-view');
  await page.waitForTimeout(300);
  await shot('03b-grid-view');
  await page.click('#ctrl-view');
  await page.click('#ctrl-stats');
  await page.waitForTimeout(500);
  await shot('03c-side-stats');
  await page.click('#ctrl-chat');

  // 4. 三轮作答（针对实际题目作答难以预知，这里输入通用充分的回答）
  const answers = [
    '面试官你好，我是演示用户，浙江师范大学软件工程专业学生，系统学习过数据结构、操作系统、计算机网络，主要技术栈是 Vue3、TypeScript、JavaScript、CSS，做过校园活动报名系统和一个小组件库，求职方向是 Web 前端开发工程师，希望今天能有好的表现。',
    '这道题我的理解是：首先它解决的是渲染和更新的效率问题，核心思想是先在内存中计算差异，再最小化地更新真实节点。其次在实际项目里我配置过相关构建优化，比如按需加载和代码分割，首屏加载时间从三秒降到了一秒左右。最后我认为选择方案要看业务规模，小项目直接用原生方案就够了。',
    '我从三个层面回答：第一是基础原理层面，它涉及浏览器解析和执行机制；第二是工程实践层面，我在项目里遇到过类似问题，通过监控和日志定位到根因是资源加载顺序，调整后恢复正常；第三是优化层面，我会做缓存、懒加载和代码压缩，并用 Performance 面板量化效果。'
  ];
  for (let i = 0; i < 3; i++) {
    await page.fill('#answer-input', answers[i]);
    await page.click('.chat-input .btn.primary');
    await page.waitForTimeout(1200);
    await shot(`04-answer-${i + 1}`);
    // 若触发追问，再答一次
    const follow = await page.$('.msg.sys');
    const lastSys = follow ? await follow.textContent() : '';
    if (lastSys.includes('追问')) {
      await page.fill('#answer-input', '好的，我补充一下：具体来说它的实现依赖事件机制和异步调度，我在项目里用这个方法解决过列表渲染卡顿的问题，通过虚拟列表把 DOM 节点从一万个降到二十个，滚动帧率稳定在六十帧。');
      await page.click('.chat-input .btn.primary');
      await page.waitForTimeout(1200);
      await shot(`04-answer-${i + 1}-followup`);
    }
  }

  // 5. 结束会议生成报告
  await page.click('.mtg-bar .ctrl.end');
  await page.waitForSelector('.score-ring', { timeout: 30000 });
  await page.waitForTimeout(900);
  await shot('05-report-top');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.4));
  await page.waitForTimeout(300);
  await shot('06-report-mid');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await shot('07-report-plan');

  // 6. 成长记录
  await page.click('[data-nav="history"]');
  await page.waitForTimeout(600);
  await shot('08-history');

  // 7. 知识库
  await page.click('[data-nav="kb"]');
  await page.waitForTimeout(600);
  await page.fill('#kb-q', '事件循环');
  await page.waitForTimeout(800);
  await shot('09-kb');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : '✅ E2E OK, no console errors');
  await browser.close();
})().catch(e => { console.error('E2E FAIL:', e.message); process.exit(1); });
