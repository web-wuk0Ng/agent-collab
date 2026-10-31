/* 隔离副本 + 真实 HTTP/浏览器：不写用户题库、配置或面试记录。 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const net = require('node:net');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(__dirname, '.cache', 'bank-import-'));
const delay = ms => new Promise(r => setTimeout(r, ms));
let child, browser, passed = 0;
const ok = msg => { console.log('PASS', msg); passed++; };
(async () => {
  for (const dir of ['lib', 'data/questions', 'data/knowledge', 'public/js', 'public/css', 'public/guides']) {
    fs.cpSync(path.join(root, dir), path.join(temp, dir), { recursive: true });
  }
  for (const file of ['server.js', 'public/index.html']) fs.copyFileSync(path.join(root, file), path.join(temp, file));
  const sock = net.createServer();
  await new Promise(r => sock.listen(0, '127.0.0.1', r));
  const port = sock.address().port; await new Promise(r => sock.close(r));
  const base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], { cwd: temp, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  const api = async (url, body) => {
    const r = await fetch(base + url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    return { status: r.status, body: await r.json() };
  };
  let ready = false;
  for (let i = 0; i < 60; i++) { try { if ((await api('/api/health')).status === 200) { ready = true; break; } } catch {} await delay(100); }
  assert(ready, '隔离服务应启动');
  const initial = await api('/api/positions');
  assert.equal(initial.body.positions.reduce((n, p) => n + p.questionCount, 0), 213);
  ok('三个岗位题库共 213 题');
  const template = (await api('/api/bank/template?position=java-backend')).body;
  const file = path.join(temp, 'data/questions/java-backend.json');
  const before = fs.readFileSync(file, 'utf8');
  const q = { ...template.questions[0], id: 'test_import_001', text: '如何验证星河观测协议的请求版本与迟到响应？',
    reference: '星河观测协议通过单调递增的请求版本标识当前任务；每个回调必须核对任务状态与版本，只有当前任务能够更新页面。结束后释放监听和定时器，迟到响应直接丢弃。' };
  const payload = { ...template, questions: [q] };
  const preview = await api('/api/bank/preview-import', payload);
  assert.equal(preview.status, 200); assert.equal(preview.body.added, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  ok('预览返回新增数与题干，磁盘未写入');
  for (const bad of [
    { ...payload, schemaVersion: '1' },
    { ...payload, position: '../escape' },
    { ...payload, questions: [{ ...q, type: 'invalid' }] },
    { ...payload, questions: [{ ...q, reference: '太短' }] },
    { ...payload, questions: [q, { ...q, id: 'bad', stage: 'wrong' }] },
    { ...payload, questions: [{ ...q, sources: ['javascript:alert(1)'] }] }
  ]) assert.equal((await api('/api/bank/preview-import', bad)).status, 400);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  ok('格式、字段、路径、来源与整批校验错误均拒绝，题库未改变');
  const commit = await api('/api/bank/import', { ...payload, revision: preview.body.revision });
  assert.equal(commit.status, 200); assert.equal(commit.body.added, 1);
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), before);
  assert(JSON.parse(fs.readFileSync(file)).questions.some(x => x.id === q.id));
  ok('实际导入追加写入，原题保留，写前备份正确');
  const hit = await api('/api/rag-preview', { position: 'java-backend', query: '星河观测协议' });
  assert(hit.body.hits.some(x => x.text.includes('单调递增')));
  ok('导入参考材料立即进入真实 RAG 检索');
  const again = await api('/api/bank/preview-import', payload);
  assert.equal(again.body.added, 0); assert.equal(again.body.skipped, 1);
  assert.equal((await api('/api/bank/import', { ...payload, revision: preview.body.revision })).status, 400);
  assert.equal((await api('/api/bank/preview-import', { ...payload, questions: [{ ...q, text: '同一个 ID 不同的题干应该拒绝整批保存' }] })).status, 400);
  ok('重复导入去重、ID 冲突与过期预览保护生效');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(() => { closeAISettings(); go('kb'); });
  await page.waitForSelector('#kb-pos option', { state: 'attached' });
  const browserPayload = { ...payload, questions: [{ ...q, id: 'test_import_002', text: '介绍星河观测协议的取消测试与恢复验证流程？' }] };
  await page.fill('#bank-json', JSON.stringify(browserPayload));
  await page.click('#bank-check');
  await page.waitForFunction(() => !document.getElementById('bank-save').disabled);
  await page.fill('#bank-json', '{"schemaVersion":1}');
  assert(await page.locator('#bank-save').isDisabled());
  await page.fill('#bank-json', JSON.stringify(browserPayload));
  await page.click('#bank-check');
  await page.waitForFunction(() => !document.getElementById('bank-save').disabled);
  await page.click('#bank-save');
  await page.waitForFunction(() => document.getElementById('bank-import-status').textContent.includes('已保存到本机'));
  assert(JSON.parse(fs.readFileSync(file)).questions.some(x => x.id === 'test_import_002'));
  assert.equal((await api('/api/admin/login', {})).status, 404);
  assert.deepEqual(errors, []);
  ok('浏览器真实校验→修改失效→重新预览→保存成功，无管理员功能回归');
  console.log(`${passed} 组通过；测试数据仅保留在忽略的 test/.cache 隔离副本`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (child) child.kill();
});
