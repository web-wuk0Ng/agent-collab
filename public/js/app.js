/* 面镜 MockMirror 前端逻辑 */
'use strict';

const $ = id => document.getElementById(id);
const API = (path, body) => fetch(path, body ? {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
} : undefined).then(async r => {
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || '请求失败');
  return j;
});
// 管理员 API：附带口令头
const AAPI = (path, body) => fetch(path, {
  method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json', 'x-admin-pass': sessionStorage.adminPass || '' },
  body: body ? JSON.stringify(body) : undefined
}).then(async r => {
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || '请求失败');
  return j;
});
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  user: null,
  positions: [],
  posId: null,
  session: null,        // {id, mode, currentQ:{index,id,text,type}}
  voiceSession: null,   // {startTime, chars}
  lastReportSessionId: null
};

/* ---------------- 视图切换 ---------------- */
function go(view) {
  for (const v of ['home', 'interview', 'report', 'history', 'kb', 'admin']) $('view-' + v).classList.add('hidden');
  $('view-' + view).classList.remove('hidden');
  if (view === 'history') renderHistory();
  if (view === 'kb') renderKB();
  if (view === 'home' && state.user) $('login-card').classList.add('hidden');
}

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ---------------- 登录 ---------------- */
async function login() {
  const name = $('login-name').value.trim();
  if (!name) return toast('请输入姓名');
  try {
    const { user } = await API('/api/login', { name });
    state.user = user;
    $('user-badge').textContent = `👤 ${user.name}`;
    $('user-badge').classList.remove('hidden');
    $('login-card').classList.add('hidden');
    $('setup-card').classList.remove('hidden');
    await loadPositions();
    toast(`欢迎，${user.name}！选择一个岗位开始练习`);
  } catch (e) { toast(e.message); }
}
function logout() { location.reload(); }

/* ---------------- 岗位选择 ---------------- */
async function loadPositions() {
  const { positions } = await API('/api/positions');
  state.positions = positions;
  $('position-list').innerHTML = positions.map(p => `
    <div class="pos-card" data-id="${p.id}" onclick="pickPos('${p.id}')">
      <b>${esc(p.name)}</b>
      <div class="pos-meta">${esc(p.intro)}</div>
      <div class="pos-q">题库 ${p.questionCount} 题 · 考察：${p.skills.slice(0, 4).join(' / ')}</div>
    </div>`).join('');
  pickPos(positions[0].id);
}

function pickPos(id) {
  state.posId = id;
  document.querySelectorAll('.pos-card').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
}

/* ---------------- 面试流程 ---------------- */
async function startInterview() {
  if (!state.user) return toast('请先输入姓名登录');
  try {
    $('btn-start').disabled = true;
    const mode = $('opt-mode').value;
    const r = await API('/api/interview/start', {
      userId: state.user.id,
      position: state.posId,
      rounds: +$('opt-rounds').value,
      mode,
      jd: ($('opt-jd') && $('opt-jd').value.trim()) || ''
    });
    state.session = { id: r.sessionId, mode, currentQ: { ...r.question, index: 0 } };
    const pos = state.positions.find(p => p.id === state.posId);
    $('iv-position').textContent = pos ? pos.name : state.posId;
    $('iv-skills').innerHTML = (pos ? pos.skills : []).map(s => `<li>${esc(s)}</li>`).join('');
    $('chat-log').innerHTML = '';
    updateProgress(0, r.planSize);
    setCurrentQ(r.question.text);
    addMsg('ai', r.greeting + '\n\n' + r.question.text, true);
    go('interview');
    if (r.jdApplied) addMsg('sys', '🏢 本次面试题目已根据你粘贴的岗位 JD 由大模型定制生成');
    if (mode === 'video') {
      // 视频面试：自动请求摄像头权限并启动仪态分析
      addMsg('sys', '🎥 视频面试模式：正在请求摄像头权限，AI 面试官将实时分析你的临场表现（画面仅本机分析）');
      const ok = await enableCamera();
      if (!ok) addMsg('sys', '⚠️ 未能开启摄像头，本次面试将不包含仪态分析，可继续用语音/文字作答');
    }
  } catch (e) { toast(e.message); }
  finally { $('btn-start').disabled = false; }
}

function updateProgress(done, total) { $('iv-progress').textContent = `进度 ${done} / ${total}`; }

function setCurrentQ(text) {
  $('current-q').textContent = text ? `当前题目：${text}` : '';
}

function addMsg(kind, text, speak = false) {
  const log = $('chat-log');
  const div = document.createElement('div');
  div.className = 'msg ' + kind;
  const who = kind === 'ai' ? '🤖 AI 面试官' : kind === 'me' ? '我' : '系统';
  div.innerHTML = `<div class="who">${who}</div><div class="bubble">${esc(text)}</div>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  if (kind === 'ai' && speak && $('tts-on').checked) speakText(text);
  return div;
}

function showTyping() {
  const log = $('chat-log');
  const div = document.createElement('div');
  div.className = 'msg ai';
  div.id = 'typing';
  div.innerHTML = `<div class="who">🤖 AI 面试官</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
function hideTyping() { const t = $('typing'); if (t) t.remove(); }

async function submitAnswer() {
  const input = $('answer-input');
  const text = input.value.trim();
  if (!text) return toast('请先说出或输入你的回答');
  if (!state.session) return;

  const metrics = collectMetrics(text);
  addMsg('me', text);
  input.value = '';
  $('btn-mic') && ($('answer-input').disabled = true);
  showTyping();

  try {
    const r = await API('/api/interview/answer', {
      sessionId: state.session.id,
      qIndex: state.session.currentQ.index,
      answer: text,
      metrics
    });
    hideTyping();
    if (r.followUp) {
      // 面试官追问，题目不变
      addMsg('ai', r.nextLine, true);
      addMsg('sys', '⚡ AI 面试官针对你的回答进行了追问，请继续作答');
    } else if (r.done) {
      addMsg('ai', r.nextLine, true);
      addMsg('sys', '🎉 面试结束！正在为你生成评估报告…');
      await finishInterview(true);
      return;
    } else {
      addMsg('ai', r.nextLine, true);
      state.session.currentQ = r.question;
      setCurrentQ(r.question.text);
      updateProgress(r.progress.done, r.progress.total);
    }
  } catch (e) {
    hideTyping();
    toast(e.message);
  } finally {
    $('answer-input').disabled = false;
    $('answer-input').focus();
  }
}

/* ---------------- 语音输入（Web Speech API） ---------------- */
let recog = null;

function toggleMic() {
  if (recog) { recog.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast('当前浏览器不支持语音识别，请使用 Chrome / Edge，或改用文字输入');
    return;
  }
  recog = new SR();
  recog.lang = 'zh-CN';
  recog.continuous = true;
  recog.interimResults = true;
  let baseLen = $('answer-input').value.length;
  state.voiceSession = { startTime: Date.now(), used: true };

  recog.onstart = () => {
    $('btn-mic').classList.add('rec');
    $('mic-status').textContent = '🔴 正在聆听…请开始作答（再次点击麦克风结束）';
  };
  recog.onresult = e => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    if (final) {
      $('answer-input').value += final;
      baseLen = $('answer-input').value.length;
    }
    $('mic-status').textContent = '🔴 聆听中：' + ($('answer-input').value.slice(baseLen) + interim).slice(-60);
  };
  recog.onerror = e => {
    $('mic-status').textContent = e.error === 'not-allowed' ? '❌ 麦克风权限被拒绝，请在浏览器地址栏允许麦克风' : '语音识别出错：' + e.error;
  };
  recog.onend = () => {
    recog = null;
    $('btn-mic').classList.remove('rec');
    if (state.voiceSession) state.voiceSession.endTime = Date.now();
    $('mic-status').textContent = '已停止聆听。可以继续补充或点击"提交回答"';
  };
  try { recog.start(); } catch (e) { toast('语音识别启动失败：' + e.message); }
}

function collectMetrics(text) {
  const vs = state.voiceSession;
  state.voiceSession = null;
  if (!vs) return null;
  const seconds = Math.max(3, ((vs.endTime || Date.now()) - vs.startTime) / 1000);
  const fillers = (text.match(/嗯|啊|然后|就是|那个|这个/g) || []).length;
  const wpm = Math.round(text.length / (seconds / 60));
  // 置信度代理：语速越接近 180 字/分、口头禅越少，自信度越高
  const speedScore = Math.max(0, 100 - Math.abs(wpm - 180) / 1.5);
  const conf = Math.max(30, Math.min(100, Math.round(speedScore - fillers * 2)));
  return { wpm, seconds: +seconds.toFixed(1), fillers, confidence: conf };
}

/* ---------------- 摄像头 · 视频面试分析（仅本机推理，不上传） ---------------- */
let camStream = null;

function renderCamStats(s) {
  if (!s) return;
  $('cam-stats').classList.remove('hidden');
  $('st-gaze').textContent = s.gazePct + '%';
  $('st-steady').textContent = s.steadyPct + '%';
  $('st-smile').textContent = s.smilePct + '%';
  $('st-presence').textContent = s.presencePct + '%';
  $('cam-calibrating').classList.toggle('hidden', !s.calibrating);
}

async function enableCamera() {
  if (camStream) return true;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    $('cam-video').srcObject = camStream;
    $('cam-video').classList.remove('hidden');
    $('cam-placeholder').classList.add('hidden');
    $('btn-cam').textContent = '关闭摄像头';
    if (state.session && state.session.mode === 'video') {
      await VisionMonitor.start($('cam-video'), renderCamStats);
    }
    return true;
  } catch (e) {
    toast(e.name === 'NotAllowedError'
      ? '摄像头权限被拒绝：视频面试需要摄像头，请在浏览器地址栏允许后重试'
      : '摄像头开启失败：' + e.message);
    return false;
  }
}

async function toggleCamera() {
  if (camStream) {
    VisionMonitor.stop();
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
    $('cam-video').classList.add('hidden');
    $('cam-placeholder').classList.remove('hidden');
    $('cam-stats').classList.add('hidden');
    $('cam-calibrating').classList.add('hidden');
    $('btn-cam').textContent = '开启摄像头';
    return;
  }
  await enableCamera();
}

/* ---------------- TTS 语音播报 ---------------- */
function speakText(text) {
  try {
    speechSynthesis.cancel();
    const clean = text.replace(/\s+/g, ' ').slice(0, 300);
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'zh-CN';
    u.rate = 1.05;
    const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('zh'));
    if (vs.length) u.voice = vs[0];
    speechSynthesis.speak(u);
  } catch (e) { /* TTS 失败不影响流程 */ }
}

/* ---------------- 结束与报告 ---------------- */
async function finishInterview(auto = false) {
  if (!state.session) return;
  try {
    const videoMetrics = (state.session.mode === 'video' && camStream) ? VisionMonitor.summary() : null;
    VisionMonitor.stop();
    const { report } = await API('/api/interview/finish', { sessionId: state.session.id, videoMetrics });
    state.lastReportSessionId = state.session.id;
    state.session = null;
    try { speechSynthesis.cancel(); } catch {}
    if (camStream) toggleCamera(); // 释放摄像头
    renderReport(report);
    go('report');
    if (!auto) toast('评估报告已生成');
  } catch (e) { toast(e.message); }
}

function scoreClass(s) { return s >= 80 ? 's-good' : s >= 60 ? 's-mid' : 's-low'; }

function ringSVG(score) {
  const R = 62, C = 2 * Math.PI * R;
  const col = score >= 80 ? '#18a058' : score >= 60 ? '#e6a23c' : '#e5484d';
  return `<svg width="150" height="150" viewBox="0 0 150 150">
    <circle cx="75" cy="75" r="${R}" fill="none" stroke="#eef1f7" stroke-width="12"/>
    <circle cx="75" cy="75" r="${R}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${(C * score / 100).toFixed(1)} ${C.toFixed(1)}"/>
  </svg><div class="val"><b class="${scoreClass(score)}">${score}</b><small>综合得分</small></div>`;
}

function renderReport(rep, sessionMeta) {
  const dims = (rep.dimensions || []).map(d => `
    <div class="dim-bar">
      <div class="lbl"><span>${esc(d.name)}</span><b>${d.score}</b></div>
      <div class="track"><div class="fill" style="width:${d.score}%"></div></div>
      <div class="small muted">${esc(d.comment)}</div>
    </div>`).join('');

  const perRound = (rep.perRound || []).map((r, i) => `
    <tr><td>${i + 1}</td><td>${esc(r.question)}</td><td><b class="${scoreClass(r.score)}">${r.score}</b></td>
    <td>${esc(r.good)}</td><td>${esc(r.bad)}</td><td>${esc(r.keyPoint)}</td></tr>`).join('');

  $('report-body').innerHTML = `
    <section class="card">
      <div class="rep-head">
        <div class="score-ring">${ringSVG(rep.overall)}</div>
        <div class="rep-sum">
          <h2>面试评估报告 ${sessionMeta ? `<span class="tag">${esc(sessionMeta.position)}</span> <span class="muted small">${new Date(sessionMeta.time).toLocaleString('zh-CN')}</span>` : ''}</h2>
          <p class="muted small">评估引擎：${rep.engine === 'llm' ? '大模型深度评估' : '离线演示引擎'} · 生成于 ${new Date(rep.generatedAt).toLocaleString('zh-CN')}</p>
          <div class="dim-bars">${dims}</div>
        </div>
      </div>
    </section>

    <div class="rep-grid">
      <section class="card"><h2>✅ 你的亮点</h2><ul class="rep-list good">${(rep.strengths || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul></section>
      <section class="card"><h2>⚠️ 待改进</h2><ul class="rep-list bad">${(rep.weaknesses || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul></section>
    </div>

    <section class="card"><h2>📝 逐题点评</h2>
      <div style="overflow-x:auto"><table class="rep-table">
        <tr><th>#</th><th>题目</th><th>得分</th><th>亮点</th><th>不足</th><th>考察要点</th></tr>
        ${perRound}
      </table></div>
    </section>

    <section class="card"><h2>💡 改进建议</h2><ul class="rep-list advice">${(rep.advice || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul></section>

    <section class="card"><h2>🗓 三周提升计划</h2>
      <div class="plan-steps">${(rep.plan || []).map(p => `<div class="plan-step"><b>${esc(p.week)}</b><p>${esc(p.task)}</p></div>`).join('')}</div>
    </section>

    <section class="card"><h2>📚 推荐学习资源</h2><ul class="rep-list res">${(rep.resources || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul></section>

    <div class="row">
      <button class="btn primary" onclick="go('home')">再来一场</button>
      <button class="btn ghost" onclick="go('history')">查看成长曲线</button>
    </div>`;
}

/* ---------------- 成长记录 ---------------- */
async function renderHistory() {
  if (!state.user) {
    $('growth-chart').innerHTML = '<div class="empty">请先在「开始面试」页输入姓名登录</div>';
    $('history-list').innerHTML = '';
    return;
  }
  const [{ curve }, { list }] = await Promise.all([API('/api/growth?userId=' + state.user.id), API('/api/history?userId=' + state.user.id)]);

  $('growth-chart').innerHTML = curve.length >= 2 ? lineChart(curve) :
    `<div class="empty">${curve.length === 1 ? `已完成 ${curve.length} 次面试，综合得分 ${curve[0].overall} 分。再完成一次即可看到成长曲线 📈` : '暂无面试记录，先去完成一场模拟面试吧！'}</div>`;

  $('history-list').innerHTML = list.length ? list.map(h => {
    const pos = state.positions.find(p => p.id === h.position);
    return `<div class="hist-item" onclick="viewSession('${h.id}')">
      <div><span class="tag">${esc(pos ? pos.name : h.position)}</span>
        <span class="muted small"> ${new Date(h.finishedAt).toLocaleString('zh-CN')} · ${h.rounds} 轮 · ${h.mode === 'voice' ? '语音模式' : '文字模式'}</span></div>
      <div class="score ${scoreClass(h.overall)}">${h.overall} 分</div>
    </div>`;
  }).join('') : '<div class="empty">暂无面试记录</div>';
}

function lineChart(curve) {
  const W = 640, H = 220, P = 44;
  const xs = i => P + i * (W - 2 * P) / Math.max(1, curve.length - 1);
  const ys = v => H - P - v * (H - 2 * P) / 100;
  const pts = curve.map((c, i) => `${xs(i).toFixed(1)},${ys(c.overall).toFixed(1)}`).join(' ');
  const grid = [0, 25, 50, 75, 100].map(v =>
    `<line x1="${P}" y1="${ys(v)}" x2="${W - P}" y2="${ys(v)}" stroke="#eef1f7"/>
     <text x="${P - 8}" y="${ys(v) + 4}" font-size="11" fill="#9aa3b5" text-anchor="end">${v}</text>`).join('');
  const dots = curve.map((c, i) =>
    `<circle cx="${xs(i)}" cy="${ys(c.overall)}" r="5" fill="#2f6bff" stroke="#fff" stroke-width="2"/>
     <text x="${xs(i)}" y="${ys(c.overall) - 12}" font-size="12" font-weight="700" fill="#1c2333" text-anchor="middle">${c.overall}</text>
     <text x="${xs(i)}" y="${H - P + 18}" font-size="11" fill="#9aa3b5" text-anchor="middle">#${c.index}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    ${grid}
    <polyline points="${pts}" fill="none" stroke="#2f6bff" stroke-width="2.5" stroke-linejoin="round"/>
    ${dots}
    <text x="${W / 2}" y="18" font-size="13" fill="#5a6478" text-anchor="middle">历次模拟面试综合得分趋势</text>
  </svg>`;
}

async function viewSession(id) {
  try {
    const { session } = await API('/api/session?id=' + id);
    renderReport(session.report || { overall: 0, dimensions: [] }, { position: session.position, time: session.finishedAt });
    go('report');
  } catch (e) { toast(e.message); }
}

/* ---------------- 知识库（RAG 演示） ---------------- */
let kbTimer = null;
async function renderKB() {
  if (!$('kb-pos').options.length) {
    const { positions } = await API('/api/positions');
    $('kb-pos').innerHTML = positions.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  }
  kbSearch();
}
function kbSearchDebounced() { clearTimeout(kbTimer); kbTimer = setTimeout(kbSearch, 300); }
async function kbSearch() {
  const q = $('kb-q').value.trim() || '面试重点';
  const { hits } = await API('/api/rag-preview', { position: $('kb-pos').value, query: q });
  $('kb-hits').innerHTML = hits.length ? hits.map((h, i) => `
    <div class="kb-hit"><b>命中 #${i + 1} · ${esc(h.title)}</b> <span class="muted small">相关度 ${h.score}</span>
    <pre>${esc(h.text.slice(0, 400))}${h.text.length > 400 ? '…' : ''}</pre></div>`).join('')
    : '<div class="empty">未命中，换个关键词试试</div>';
}

/* ---------------- AI 设置 ---------------- */
async function openAISettings() {
  const cfg = await API('/api/ai-config');
  $('cfg-url').value = cfg.baseUrl || '';
  $('cfg-model').value = cfg.model || '';
  $('cfg-key').value = '';
  $('cfg-key').placeholder = cfg.hasKey ? '已保存（输入新值可覆盖）' : 'sk-…（仅保存在本机）';
  $('ai-test-result').textContent = '';
  $('ai-test-detail').textContent = '';
  $('ai-modal').classList.remove('hidden');
}
function closeAISettings() { $('ai-modal').classList.add('hidden'); }
async function saveAISettings() {
  try {
    const cfg = await API('/api/ai-config', {
      baseUrl: $('cfg-url').value.trim(),
      apiKey: $('cfg-key').value.trim(),
      model: $('cfg-model').value.trim()
    });
    updateAIBadge(cfg);
    toast(cfg.mode === 'llm' ? '已接入大模型 ✅' : '已保存（当前为离线演示模式）');
  } catch (e) { toast(e.message); }
}
async function testAISettings() {
  $('ai-test-result').textContent = '测试中…';
  await saveAISettings();
  const r = await API('/api/ai-test', {});
  $('ai-test-result').textContent = r.ok ? '✅ 连接成功' : '❌ 连接失败';
  $('ai-test-detail').textContent = r.ok ? `模型回复：${r.reply}` : r.error;
  if (r.ok) { const cfg = await API('/api/ai-config'); updateAIBadge(cfg); }
}
function updateAIBadge(cfg) {
  const b = $('ai-mode-badge');
  if (cfg.mode === 'llm') { b.textContent = `AI 已接入 · ${cfg.model}`; b.classList.add('on'); }
  else { b.textContent = 'AI 未配置（离线演示）'; b.classList.remove('on'); }
}

/* ---------------- 管理中心（企业/教师视角） ---------------- */
const DIM_NAMES = { content: '技术正确性', depth: '知识深度', logic: '逻辑严谨性', match: '岗位匹配度', expression: '语言表达', video: '仪态表现' };

function goAdmin() {
  go('admin');
  adminTab('dash');
  if (!sessionStorage.adminPass) {
    $('admin-login').classList.remove('hidden');
    $('admin-dash').classList.add('hidden');
  } else {
    loadDash();
  }
}

async function adminLogin() {
  const pass = $('admin-pass').value;
  const { ok } = await API('/api/admin/login', { passcode: pass });
  if (!ok) { $('admin-login-err').textContent = '口令错误'; return; }
  sessionStorage.adminPass = pass;
  $('admin-login').classList.add('hidden');
  loadDash();
}

function adminTab(tab) {
  document.querySelectorAll('#view-admin .btn.tab').forEach(b => b.classList.toggle('active', b.dataset.atab === tab));
  for (const t of ['dash', 'students', 'bank']) $('atab-' + t).classList.toggle('hidden', t !== tab);
  if (!sessionStorage.adminPass) { $('admin-login').classList.remove('hidden'); $('admin-dash').classList.add('hidden'); return; }
  if (tab === 'dash') loadDash();
  if (tab === 'students') loadStudents();
  if (tab === 'bank') loadBankTab();
}

async function loadDash() {
  try {
    const s = await AAPI('/api/admin/stats');
    $('admin-login').classList.add('hidden');
    $('admin-dash').classList.remove('hidden');
    const posName = id => (state.positions.find(p => p.id === id) || {}).name || id;
    $('admin-dash').innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><b>${s.totalUsers}</b><span>注册学员</span></div>
        <div class="stat-card"><b>${s.totalInterviews}</b><span>累计面试场次</span></div>
        <div class="stat-card"><b>${s.avgOverall}</b><span>平均综合分</span></div>
      </div>
      <div class="admin-two">
        <div class="card"><h2>各岗位使用情况</h2>
          ${s.byPosition.length ? s.byPosition.map(p => `
            <div class="dim-bar"><div class="lbl"><span>${esc(posName(p.position))}</span><b>${p.count} 场 · 均 ${p.avg} 分</b></div>
            <div class="track"><div class="fill" style="width:${Math.min(100, p.count * 12)}%"></div></div></div>`).join('') : '<div class="empty">暂无数据</div>'}
        </div>
        <div class="card"><h2>能力维度平均分（全体学员）</h2>
          ${s.dimAvg.length ? s.dimAvg.map(d => `
            <div class="dim-bar"><div class="lbl"><span>${DIM_NAMES[d.key] || d.key}</span><b>${d.avg}</b></div>
            <div class="track"><div class="fill" style="width:${d.avg}%"></div></div></div>`).join('') : '<div class="empty">暂无数据</div>'}
          <p class="muted small" style="margin-top:10px">维度均分偏低的项即学员群体共性短板，可针对性安排就业指导课程</p>
        </div>
      </div>
      <div class="card"><h2>最近面试动态</h2>
        ${s.recent.length ? `<table class="rep-table"><tr><th>学员</th><th>岗位</th><th>得分</th><th>时间</th></tr>
          ${s.recent.map(r => `<tr><td>${esc(r.user)}</td><td>${esc(posName(r.position))}</td><td><b class="${scoreClass(r.overall)}">${r.overall}</b></td><td class="muted">${new Date(r.at).toLocaleString('zh-CN')}</td></tr>`).join('')}</table>` : '<div class="empty">暂无数据</div>'}
      </div>`;
  } catch (e) {
    sessionStorage.removeItem('adminPass');
    $('admin-login').classList.remove('hidden');
    $('admin-login-err').textContent = e.message;
  }
}

async function loadStudents() {
  try {
    const { list } = await AAPI('/api/admin/students');
    const posMap = {}; (await API('/api/positions')).positions.forEach(p => posMap[p.id] = p.name);
    $('atab-students').innerHTML = `<div class="card"><h2>👥 学员管理（${list.length} 人）</h2>
      ${list.length ? `<table class="rep-table"><tr><th>姓名</th><th>面试场次</th><th>平均分</th><th>最薄弱维度</th><th>最近练习</th></tr>
        ${list.map(u => `<tr><td>${esc(u.name)}</td><td>${u.count}</td><td><b class="${scoreClass(u.avg)}">${u.avg || '-'}</b></td>
          <td>${u.weakestKey ? `${DIM_NAMES[u.weakestKey] || u.weakestKey}（${u.weakestAvg} 分）` : '-'}</td>
          <td class="muted">${u.last ? new Date(u.last).toLocaleString('zh-CN') : '-'}</td></tr>`).join('')}</table>` : '<div class="empty">暂无学员数据</div>'}
    </div>`;
  } catch (e) { toast(e.message); }
}

async function loadBankTab() {
  try {
    const { positions } = await API('/api/positions');
    state._bankPositions = positions;
    $('ab-bank-sel').innerHTML = positions.map(p => `<option value="${p.id}">${esc(p.name)}${p.custom ? '（自定义）' : ''}</option>`).join('');
    await renderBankDetail();
  } catch (e) { toast(e.message); }
}

async function renderBankDetail() {
  const id = $('ab-bank-sel').value;
  const { detail } = await AAPI('/api/admin/bank?position=' + encodeURIComponent(id));
  state._bankDetail = detail;
  $('ab-bank-meta').textContent = `${detail.questions.length} 题 · ${detail.isCustom ? '企业自定义题库' : '内置题库'}`;
  const T = { tech: '技术', project: '项目深挖', scenario: '场景', behavior: '行为' };
  $('ab-bank-detail').innerHTML = detail.questions.map(q => `
    <div class="q-item"><div class="q-meta">[${T[q.type] || q.type}] ${esc((q.keywords || []).join('、'))}</div>${esc(q.text)}</div>`).join('');
}

function fillBankTemplate() {
  $('ab-import').value = JSON.stringify({
    name: 'Golang 后端工程师',
    intro: '负责公司核心服务开发，要求熟悉 Go 语言、高并发与微服务。',
    skills: ['Go', 'Goroutine', 'MySQL', 'Redis', '微服务'],
    questions: [
      { type: 'tech', text: 'Goroutine 和线程有什么区别？GMP 调度模型是怎样的？', keywords: ['GMP', '调度', '栈', '轻量'] },
      { type: 'tech', text: 'channel 的底层实现是什么？无缓冲和有缓冲 channel 的区别？', keywords: ['hchan', '缓冲', '阻塞', '锁'] },
      { type: 'scenario', text: '设计一个支持十万并发的 WebSocket 推送服务，说说你的方案。', keywords: ['连接管理', '心跳', '扩容', '消息队列'] },
      { type: 'behavior', text: '请做一个自我介绍，重点讲 Go 相关的项目经历。', keywords: ['项目', '技能', '成果'] }
    ]
  }, null, 2);
}

async function importBank() {
  try {
    const data = JSON.parse($('ab-import').value);
    const r = await AAPI('/api/admin/bank/import', data);
    $('ab-import-result').textContent = `✅ 已导入「${r.name}」（${r.questionCount} 题），学员端立即可见`;
    await loadBankTab();
    toast('题库导入成功');
  } catch (e) {
    $('ab-import-result').textContent = '❌ ' + e.message;
  }
}

async function adminExport() {
  try {
    const { csv } = await AAPI('/api/admin/export');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mockmirror-面试记录.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast(e.message); }
}

/* ---------------- 初始化 ---------------- */
(async function init() {
  try {
    const cfg = await API('/api/ai-config');
    updateAIBadge(cfg);
  } catch {}
  $('answer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitAnswer();
  });
  if (speechSynthesis) speechSynthesis.getVoices(); // 预热语音列表
})();
