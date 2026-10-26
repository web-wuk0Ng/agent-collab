/**
 * MCP Server 自检：模拟一个 MCP 客户端，通过 stdio 走完整协议流程。
 * 覆盖 initialize → tools/list → resources/list → prompts/list → tools/call（只读工具）
 * 运行：node test/mcp.js
 */
const { spawn } = require('child_process');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'mcp', 'mockmirror-mcp.js');
const TIMEOUT = 20000;

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
const pending = new Map();
child.stdout.setEncoding('utf-8');
child.stdout.on('data', d => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : resolve(msg.result);
    }
  }
});
child.stderr.on('data', d => process.stderr.write('  [server] ' + d.toString()));

let seq = 0;
function request(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error('超时: ' + method)); }, TIMEOUT);
    pending.set(id, {
      resolve: v => { clearTimeout(t); resolve(v); },
      reject: e => { clearTimeout(t); reject(e); }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log(`  ${cond ? '✔' : '✘'} ${name}${cond ? '' : '  → ' + (detail || '')}`);
}

function callTool(name, args) {
  return request('tools/call', { name, arguments: args || {} });
}

(async () => {
  console.log('\nMCP Server 自检（stdio / JSON-RPC 2.0）\n');

  // 1. initialize
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-smoke', version: '1.0.0' }
  });
  check('initialize 返回协议版本 2024-11-05', init.protocolVersion === '2024-11-05', init.protocolVersion);
  check('initialize 返回 serverInfo.name=mockmirror', init.serverInfo && init.serverInfo.name === 'mockmirror');
  check('initialize 声明 tools 能力', !!(init.capabilities && init.capabilities.tools));
  check('initialize 附 instructions 指引', typeof init.instructions === 'string' && init.instructions.length > 30);

  notify('notifications/initialized', {});

  // 2. tools/list
  const tools = await request('tools/list', {});
  const names = (tools.tools || []).map(t => t.name);
  check('tools/list 返回 9 个工具', (tools.tools || []).length === 9, `实际 ${(tools.tools || []).length}`);
  const required = ['list_positions', 'search_questions', 'start_interview', 'submit_answer', 'finish_interview', 'get_report', 'analyze_answer', 'knowledge_lookup', 'list_sessions'];
  check('工具集包含全部核心能力', required.every(r => names.includes(r)), required.filter(r => !names.includes(r)).join(','));
  check('每个工具都有 description 与 inputSchema', (tools.tools || []).every(t => t.description && t.inputSchema && t.inputSchema.type === 'object'));

  // 3. resources/list
  const res = await request('resources/list', {});
  check('resources 至少 4 条（岗位总览 + 3 题库 + 知识库）', (res.resources || []).length >= 4, `实际 ${(res.resources || []).length}`);
  check('resource URI 均为 mockmirror:// 协议', (res.resources || []).every(r => r.uri.startsWith('mockmirror://')));

  // 4. resources/read
  const bankUri = (res.resources || []).find(r => r.uri.startsWith('mockmirror://bank/'));
  if (bankUri) {
    const rd = await request('resources/read', { uri: bankUri.uri });
    const c = (rd.contents || [])[0];
    check('resources/read 能读出题库 JSON', !!(c && c.text && JSON.parse(c.text).questions), bankUri.uri);
  }

  // 5. prompts/list + get
  const pr = await request('prompts/list', {});
  check('prompts 含 mock_interview 与 interview_review',
    (pr.prompts || []).some(p => p.name === 'mock_interview') && (pr.prompts || []).some(p => p.name === 'interview_review'));
  const pg = await request('prompts/get', { name: 'mock_interview', arguments: { position: 'java-backend', rounds: 5 } });
  check('prompts/get 返回可用的面试引导词', !!((pg.messages || [])[0] && /start_interview/.test(pg.messages[0].content.text)));

  // 6. 只读工具：list_positions
  const pos = await callTool('list_positions', {});
  let posJson = null;
  try { posJson = JSON.parse(pos.content[0].text); } catch { /* noop */ }
  check('list_positions 返回岗位数组', Array.isArray(posJson) && posJson.length >= 3, `实际 ${posJson ? posJson.length : '解析失败'}`);
  const firstPos = posJson && posJson[0] && posJson[0].position;

  // 7. 只读工具：search_questions
  const sq = await callTool('search_questions', { position: firstPos, keyword: '缓存', limit: 5 });
  let sqJson = null;
  try { sqJson = JSON.parse(sq.content[0].text); } catch { /* noop */ }
  check('search_questions 返回结果含 questions 字段', !!(sqJson && Array.isArray(sqJson.questions)), sq.content[0].text.slice(0, 120));
  check('search_questions 每条都带考察点 points', !!(sqJson && sqJson.questions.every(q => Array.isArray(q.points))));

  // 8. 未知工具 → 走 isError 而不是崩溃
  const bad = await callTool('no_such_tool', {});
  check('未知工具返回 isError 而非崩溃', bad.isError === true);

  // 9. 未知方法 → JSON-RPC 错误码 -32601
  let unknownOk = false, unknownDetail = '';
  try {
    await request('no/such/method', {});
  } catch (e) {
    unknownOk = /-32601/.test(e.message);
    unknownDetail = e.message;
  }
  check('未知方法返回 -32601', unknownOk, unknownDetail);

  // 10. ping
  const pong = await request('ping', {});
  check('ping 正常响应', pong && typeof pong === 'object');

  child.stdin.end();

  const failed = results.filter(r => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) { console.log('失败项：'); failed.forEach(f => console.log('  - ' + f.name + ' ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('\n自检异常：', e.message);
  try { child.kill(); } catch { /* noop */ }
  process.exit(1);
});
