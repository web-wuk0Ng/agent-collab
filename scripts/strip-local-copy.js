const fs = require('fs');
const f = 'public/js/app.js';
let s = fs.readFileSync(f, 'utf8');
const reps = [
  ["$('voice-engine').textContent = tag + ' · 语音不出本机';", "$('voice-engine').textContent = '';   // 引擎来源是实现细节，界面不展示"],
  ["' ℹ️ 你在用 Chrome：它的在线识别服务在国内不可用，本系统已自动改用内置的本地离线识别引擎（语音不出本机，识别效果一致）。'",
   "' ℹ️ 你在用 Chrome：已自动为你切换到内置识别引擎，语音作答不受影响。'"],
  ["${useLocal ? '本地离线识别（语音不出本机）' : '浏览器在线识别'}", "${useLocal ? '内置识别引擎' : '浏览器识别'}"],
  ["addMsg('sys', '🎥 已接入摄像头，AI 面试官将实时分析你的仪态表现（画面仅本机处理，不上传不录制）')",
   "addMsg('sys', '🎥 已接入摄像头，AI 面试官将实时分析你的仪态表现')"],
  ["setCk('net', 'ok', '✓ 本机服务正常');", "setCk('net', 'ok', '✓ 服务正常');"],
  ["const label = v === 'local' ? '本地离线识别' : v === 'webspeech' ? '浏览器在线识别' : '自动选择';",
   "const label = v === 'local' ? '内置识别引擎' : v === 'webspeech' ? '浏览器识别' : '自动选择';"],
  ["$('mic-status').textContent = '🔄 正在切换到本地离线识别引擎…';", "$('mic-status').textContent = '🔄 正在切换识别引擎…';"],
  ["const tag = listenState.engine === 'local' ? '本地离线识别' : '在线识别';", "const tag = listenState.engine === 'local' ? '内置识别' : '在线识别';"]
];
let n = 0;
for (const [a, b] of reps) {
  if (s.includes(a)) { s = s.split(a).join(b); n++; }
  else console.log('未匹配:', a.slice(0, 46));
}
fs.writeFileSync(f, s, 'utf8');
console.log('替换数:', n);
