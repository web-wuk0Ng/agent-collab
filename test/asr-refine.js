/* test/asr-refine.js —— 本地语音识别 + SenseVoice 精识别 端到端验证
 * 用法：node test/asr-refine.js [wav文件]
 * 流程：wav → 16k PCM 分片 → /api/asr/chunk（流式）→ /api/asr/end（精识别回填）
 * 断言：能出文本；若精识别模型已装，end 返回的 refined=true 且文本非空。
 */
const fs = require('fs');
const path = require('path');

const wav = process.argv[2] || path.join(__dirname, 'fixtures', 'answer-with-gap.wav');
const base = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, msg) => { console.log((c ? '  ✔ ' : '  ✘ ') + msg); c ? pass++ : fail++; };

async function post(p, body) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

(async () => {
  console.log('ASR 精识别端到端（' + path.basename(wav) + '）\n');
  const status = await (await fetch(base + '/api/asr/status')).json();
  ok(status.available === true, '本地识别引擎可用');

  const buf = fs.readFileSync(wav);
  // 标准 PCM wav：44 字节头之后是 16kHz 单声道 Int16
  const pcm = buf.subarray(44);
  const id = 'asr-test-' + Date.now();
  const CHUNK = 16000 * 2 * 0.16;   // 160ms 一片
  let lastText = '';
  for (let off = 0; off < pcm.length; off += CHUNK) {
    const j = await post('/api/asr/chunk', { id, pcm: pcm.subarray(off, Math.min(off + CHUNK, pcm.length)).toString('base64') });
    if (j.error) { ok(false, 'chunk 报错：' + j.error); process.exit(1); }
    if (j.text) lastText = j.text;
  }
  ok(!!lastText, '流式识别出文本：' + JSON.stringify(lastText.slice(0, 50)));

  const t0 = Date.now();
  const fin = await post('/api/asr/end', { id });
  const ms = Date.now() - t0;
  ok(!!fin.text, 'end 返回最终文本（' + ms + 'ms）：' + JSON.stringify((fin.text || '').slice(0, 60)));
  if (fin.refined !== undefined) {
    ok(fin.refined === true, 'SenseVoice 精识别已生效（refined=true）');
  } else {
    console.log('  ℹ 精识别模型未安装，本次为纯流式结果（不影响功能）');
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e.message); process.exit(1); });
