/* 面镜 MockMirror 前端逻辑 */
'use strict';

const $ = id => document.getElementById(id);
const API = (path, body) => fetch(path, body ? {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
} : undefined).then(async r => {
  const j = await r.json();
  if (!r.ok) { const e = new Error(j.error || '请求失败'); e.code = j.code || ''; e.status = r.status; throw e; }
  return j;
});
// 管理员 API：附带登录时签发的会话 token（口令不再随请求重传）
const AAPI = (path, body) => fetch(path, {
  method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json', 'x-admin-token': sessionStorage.adminToken || '' },
  body: body ? JSON.stringify(body) : undefined
}).then(async r => {
  const j = await r.json();
  if (!r.ok) { const e = new Error(j.error || '请求失败'); e.code = j.code || ''; e.status = r.status; throw e; }
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
  document.querySelectorAll('.topnav a').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
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
    // 企业级门禁：AI 模拟面试必须先完成大模型配置
    if (!(await ensureAIReady())) { toast('开始面试前，请先完成 AI 面试官配置'); openAISettings(true); }
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

/* ---- 语音识别结果润色：离线引擎不带标点，这里按语义补上，让回答通顺可读 ---- */
const PUNCT_END = '。！？，、；：';
/** 句末判定：以"了/的/呢/吧/啊/吗/吧/啦/哦"等收尾或含疑问词，视为一句结束 */
function isSentenceEnd(text) {
  const t = (text || '').trim();
  if (!t) return false;
  if (/[吗呢吧啊啦嘛呀哦了]$/.test(t)) return true;
  if (/^(什么|为什么|怎么|如何|哪里|谁)/.test(t) || /(吗|呢|吧)$/.test(t)) return true;
  return false;
}
/** 给一段识别文本补上合适的标点（不重复补） */
function punctuate(text, { final = false } = {}) {
  let t = (text || '').trim();
  if (!t) return '';
  if (PUNCT_END.includes(t[t.length - 1])) return t;
  // 说话时的"嗯/啊/然后"等口头禅保留（报告要统计），只补标点
  return final ? (isSentenceEnd(t) || t.length >= 12 ? t + '。' : t + '，') : t + '，';
}

function pickPos(id) {
  state.posId = id;
  document.querySelectorAll('.pos-card').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
  loadBankPreview(id);   // 右侧押题面板随岗位切换
}

/* ---- 牛客式首页：右侧「面试押题」预览面板 ---- */
async function loadBankPreview(posId) {
  const box = $('bank-preview');
  if (!box) return;
  try {
    const r = await API('/api/bank/preview?position=' + encodeURIComponent(posId));
    const typeMap = { tech: '技能题', project: '项目题', scenario: '场景题', behavior: '行为题' };
    box.innerHTML =
      `<div class="bp-head"><b>面试押题</b><span class="bp-count">共 ${r.total} 题</span></div>` +
      r.questions.map((q, i) => `
        <div class="bp-item">
          <div class="bp-q"><i>${i + 1}</i><span>${esc(q.text)}</span></div>
          <div class="bp-meta"><span class="tag ${q.type}">${typeMap[q.type] || '技能题'}</span></div>
          ${q.hint ? `<div class="bp-hint">回答思路：${esc(q.hint)}</div>` : ''}
        </div>`).join('');
  } catch {
    box.innerHTML = '<div class="bp-head"><b>面试押题</b></div><p class="bp-empty">题库加载中…</p>';
  }
}

/* ---------------- 面试流程：会前设备检测 → 视频会议 ---------------- */
let pending = null;         // 会议开始前的开场信息
let pjStream = null;        // 会前摄像头预览流
let micStream = null;       // 麦克风音量检测流
let micCtx = null, micAnalyser = null, micRaf = null;
let callTimer = null, callStart = 0;
let aiSpeakTimer = null, aiCaptionTimer = null;
let micMuted = false, micOn = true;

/* ---- 麦克风设备选择（真机多设备场景：外接麦 / 耳机麦 / 蓝牙耳机 需手动切） ---- */
const MIC_KEY = 'mm.mic.deviceId';
let micDeviceId = localStorage.getItem(MIC_KEY) || '';
let micDevices = [];

/** 统一音频约束：所有采集（音量检测 / 本地识别）都走这里，保证用的是同一个设备 */
function audioConstraints() {
  const c = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (micDeviceId) c.deviceId = { exact: micDeviceId };
  return c;
}

/** 枚举输入设备并刷新两处下拉框（会前 / 会中） */
async function refreshMicDevices(verbose = false) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    micDevices = all.filter(d => d.kind === 'audioinput');
  } catch { micDevices = []; }

  // 已选设备被拔掉 → 自动回落到默认设备，避免采集一直失败
  if (micDeviceId && micDevices.length && !micDevices.some(d => d.deviceId === micDeviceId)) {
    micDeviceId = '';
    localStorage.removeItem(MIC_KEY);
    toast('原来的麦克风已断开，已自动切换回系统默认设备');
  }

  const opts = [];
  micDevices.forEach((d, i) => {
    const label = d.label && d.label.trim() ? d.label : `麦克风 ${i + 1}（未授权名称）`;
    opts.push(`<option value="${d.deviceId}">${label.replace(/</g, '&lt;')}</option>`);
  });
  if (!opts.length) opts.push('<option value="">未检测到麦克风</option>');

  ['pj-mic-select', 'mtg-mic-select'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.innerHTML = opts.join('');
    el.value = micDeviceId || (micDevices[0] ? micDevices[0].deviceId : '');
    el.disabled = !micDevices.length;
  });

  const cur = micDevices.find(d => d.deviceId === micDeviceId) || micDevices[0];
  const hint = micDeviceId && cur ? `当前使用：${cur.label || '已选设备'}` : '当前使用：系统默认设备';
  if (micDevices.length && hint) setCk('mic', micStream ? 'ok' : 'pending', (micStream ? '✓ ' : '') + hint);
  else setCk('mic', 'fail', '✕ 未检测到麦克风，插入设备后点 🔄 重扫');
  if (verbose) toast(micDevices.length ? `已重新扫描，共 ${micDevices.length} 个麦克风` : '未检测到麦克风设备');
}

/** 切换麦克风：保存偏好 → 重建音量检测流 → 正在收音则用新设备无缝续听 */
async function selectMicDevice(id) {
  micDeviceId = id || '';
  if (micDeviceId) localStorage.setItem(MIC_KEY, micDeviceId); else localStorage.removeItem(MIC_KEY);
  await refreshMicDevices();

  const wasListening = !!recog;
  const wasAuto = listenState && listenState.auto;
  if (wasListening) quietStopListening(true);   // 静默停掉旧设备的收音，避免两个流抢麦

  stopMicMeter();
  const ok = await startMicMeter();
  if (ok) {
    const cur = micDevices.find(d => d.deviceId === micDeviceId);
    setCk('mic', 'ok', '✓ 已切换到：' + (cur ? (cur.label || '已选设备') : '系统默认设备'));
  }
  if (!ok) {
    toast('该麦克风无法使用（可能被其他程序占用），已回退到系统默认设备');
    micDeviceId = '';
    localStorage.removeItem(MIC_KEY);
    await startMicMeter();
    await refreshMicDevices();
  }
  // 收音中切设备：用新设备继续听，用户打断感最小
  if (wasListening && state.session && !micMuted) setTimeout(() => startListening({ auto: wasAuto }), 200);
}

function toggleDevPanel() {
  const p = $('dev-panel');
  if (!p) return;
  const show = p.classList.contains('hidden');
  p.classList.toggle('hidden', !show);
  $('ctrl-dev').classList.toggle('active', show);
  if (show) {
    refreshMicDevices();
    if ($('mtg-asr-select')) $('mtg-asr-select').value = asrPrefer;
    if ($('mtg-voice-select')) $('mtg-voice-select').value = ttsVoicePref;
    if ($('mtg-rate')) $('mtg-rate').value = String(ttsRate);
    if ($('mtg-rate-val')) $('mtg-rate-val').textContent = ttsRate.toFixed(2) + '×';
    // 音色自然度提示：没有神经网络音时给出升级路径
    loadVoices();
    const v = pickVoice();
    const hint = $('voice-hint');
    if (hint) {
      hint.textContent = v
        ? (/natural|online|neural/i.test(v.name)
          ? '当前音色：' + v.name.replace(/\s*-\s*Chinese.*$/, '') + '（神经网络自然音，接近真人）'
          : '当前音色：' + v.name.replace(/\s*-\s*Chinese.*$/, '') + '（系统传统音色，机械感略强）。想要更像真人：Windows 设置 → 时间和语言 → 语音 → 添加中文（中国）自然语音，或改用 Edge 联网后使用 Xiaoxiao/Yunxi 在线音色。')
        : '未检测到中文语音包，请先在系统中安装中文语音。';
    }
  }
}

const newMeetingId = () => 'MM-' + Math.random().toString(36).slice(2, 5).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();

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
    state.mtgId = newMeetingId();
    state.nudgeCount = 0;
    state.reverseMode = false;
    state.reverseCount = 0;
    state.autoFinishAfterSpeech = false;
    state.thinkUntil = null;
    $('answer-input').placeholder = '语音作答（自动提交）';
    pending = { greeting: r.greeting, question: r.question, planSize: r.planSize, jdApplied: r.jdApplied };
    const pos = state.positions.find(p => p.id === state.posId);
    // 会前设备检测页信息
    $('pj-pos').textContent = pos ? pos.name : state.posId;
    $('pj-rounds').textContent = `${r.planSize} 题`;
    $('pj-meeting-id').textContent = state.mtgId;
    $('pj-mode').textContent = mode === 'video' ? '视频面试（摄像头 + 语音 + 文字）'
      : mode === 'voice' ? '语音面试（语音 + 文字）' : '文字面试（仅文字）';
    $('pj-hint').textContent = mode === 'video'
      ? '💡 建议佩戴耳机、保持环境安静、正对摄像头；AI 面试官会实时分析你的仪态与表达。'
      : '💡 建议佩戴耳机、保持环境安静；AI 面试官会结合语音指标分析你的表达。';
    showPrejoin();
    go('interview');
    await prejoinPrepare(mode);
  } catch (e) {
    toast(e.message);
    // 企业级门禁：AI 未配置时直接拉起配置向导
    if (e.code === 'AI_NOT_CONFIGURED' || e.status === 428) openAISettings(true);
  }
  finally { $('btn-start').disabled = false; }
}

function showPrejoin() {
  document.body.classList.remove('in-meeting');
  $('meeting').classList.add('hidden');
  $('prejoin').classList.remove('hidden');
  updateNetStatus();
}

/** 会前退出：结束本次会话邀请，回到岗位选择 */
function leavePrejoin() {
  cleanupMeeting();
  state.session = null;
  pending = null;
  go('home');
}

/* ===== 会前设备检测（牛客式检测清单） ===== */
/** 检测清单行状态：pending 待检 / ok 通过 / fail 异常 */
function setCk(id, state, text) {
  const row = $('ck-' + id), st = $('ck-' + id + '-st');
  if (!row) return;
  row.classList.remove('ok', 'fail');
  if (state === 'ok') { row.classList.add('ok'); st.textContent = text || '✓ 已通过'; }
  else if (state === 'fail') { row.classList.add('fail'); st.textContent = text || '✕ 异常'; }
  else st.textContent = text || '—';
}

async function prejoinPrepare(mode) {
  const textMode = mode === 'text';
  const pjLeft = document.querySelector('.pj-modal .pj-left');
  $('pj-cam-btn').classList.toggle('hidden', textMode);
  $('pj-mic-btn').classList.toggle('hidden', textMode);
  pjLeft.classList.toggle('hidden', textMode);
  setCk('net', 'ok', '✓ 本机服务正常');
  if (textMode) {
    setCk('cam', 'ok', '— 文字模式无需摄像头');
    setCk('mic', 'ok', '— 文字模式无需麦克风');
    setCk('spk', 'ok', '— 文字模式无需扬声器');
    $('pj-hint').textContent = '⌨ 文字面试模式：无需麦克风与摄像头，直接进入面试间即可开始作答。';
    return;
  }
  refreshMicDevices();   // 先给出已知设备，授权成功后会带上真实设备名再刷一次
  // 浏览器诊断：Chrome 的在线语音识别走 Google 服务，在国内常不稳定甚至无结果
  const ua = navigator.userAgent;
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    $('pj-hint').textContent += ' ℹ️ 你在用 Chrome：它的在线识别服务在国内不可用，本系统已自动改用内置的本地离线识别引擎（语音不出本机，识别效果一致）。';
  }
  await startMicMeter();
  if (mode === 'video') await prejoinCameraOn();
  else setCk('cam', 'ok', '— 文字模式无需摄像头');
  refreshCamDevices();
}

async function startMicMeter() {
  if (micStream) return true;
  setCk('mic', 'pending', '检测中…');
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
  } catch (e) {
    // 指定的设备不可用（拔了/被占用）→ 清掉偏好，回退系统默认设备再试一次
    if (micDeviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
      micDeviceId = '';
      localStorage.removeItem(MIC_KEY);
      try { micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() }); }
      catch (e2) { return micFailUI(e2); }
    } else {
      return micFailUI(e);
    }
  }
  // 权限已授予：此时设备名（label）才可读，刷新下拉框
  refreshMicDevices();
  setCk('mic', 'ok', '✓ 正常，说话时下方音量条会动');
  try {
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = micCtx.createMediaStreamSource(micStream);
    micAnalyser = micCtx.createAnalyser();
    micAnalyser.fftSize = 512;
    src.connect(micAnalyser);
    const buf = new Uint8Array(micAnalyser.frequencyBinCount);
    const tick = () => {
      if (!micAnalyser) return;
      micAnalyser.getByteFrequencyData(buf);
      let sum = 0; for (const v of buf) sum += v;
      const level = micMuted ? 0 : Math.min(100, Math.round(sum / buf.length * 2.2));
      const a = $('pj-meter-fill'), b = $('bar-meter-fill'), c = $('dev-panel-meter');
      if (a) a.style.width = level + '%';
      if (b) b.style.width = level + '%';
      if (c) c.style.width = level + '%';
      micRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) { console.warn('音量检测不可用:', e.message); }
  return true;
}

function micFailUI(e) {
  $('pj-mic-btn').classList.remove('on'); $('pj-mic-btn').classList.add('off');
  micOn = false;
  const why = e && e.name === 'NotAllowedError'
    ? '麦克风权限被拒绝：请点浏览器地址栏左侧图标允许麦克风后刷新页面'
    : '麦克风无法打开（可能被其他会议软件占用：' + (e && e.name ? e.name : '未知') + '），可换一个设备或关闭占用程序';
  $('pj-hint').textContent = '⚠️ ' + why;
  setCk('mic', 'fail', '✕ ' + (e && e.name === 'NotAllowedError' ? '权限被拒绝' : '无法打开'));
  return false;
}

function stopMicMeter() {
  if (micRaf) { cancelAnimationFrame(micRaf); micRaf = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  micAnalyser = null;
  if (micCtx) { try { micCtx.close(); } catch {} micCtx = null; }
}

/* ---- 摄像头设备选择（与麦克风同款体验） ---- */
const CAM_KEY = 'mm.cam.deviceId';
let camDeviceId = localStorage.getItem(CAM_KEY) || '';
let camDevices = [];

async function refreshCamDevices(verbose = false) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    camDevices = all.filter(d => d.kind === 'videoinput');
  } catch { camDevices = []; }
  if (camDeviceId && camDevices.length && !camDevices.some(d => d.deviceId === camDeviceId)) {
    camDeviceId = '';
    localStorage.removeItem(CAM_KEY);
  }
  const el = $('pj-cam-select');
  if (el) {
    el.innerHTML = camDevices.length
      ? camDevices.map((d, i) => `<option value="${d.deviceId}">${(d.label || `摄像头 ${i + 1}`).replace(/</g, '&lt;')}</option>`).join('')
      : '<option value="">未检测到摄像头</option>';
    el.value = camDeviceId || (camDevices[0] ? camDevices[0].deviceId : '');
    el.disabled = !camDevices.length;
  }
  if (verbose) toast(camDevices.length ? `已重新扫描，共 ${camDevices.length} 个摄像头` : '未检测到摄像头设备');
}

async function selectCamDevice(id) {
  camDeviceId = id || '';
  if (camDeviceId) localStorage.setItem(CAM_KEY, camDeviceId); else localStorage.removeItem(CAM_KEY);
  await refreshCamDevices();
  if (pjStream) { prejoinCameraOff(); await prejoinCameraOn(); }
}

async function prejoinCameraOn() {
  if (pjStream) return true;
  setCk('cam', 'pending', '检测中…');
  try {
    const vc = { width: 1280, height: 720 };
    if (camDeviceId) vc.deviceId = { exact: camDeviceId };
    try {
      pjStream = await navigator.mediaDevices.getUserMedia({ video: vc, audio: false });
    } catch (e) {
      if (camDeviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        camDeviceId = ''; localStorage.removeItem(CAM_KEY);
        pjStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      } else throw e;
    }
    $('pj-video').srcObject = pjStream;
    $('pj-video-off').classList.remove('show');
    $('pj-cam-btn').classList.add('on'); $('pj-cam-btn').classList.remove('off');
    setCk('cam', 'ok', '✓ 正常');
    refreshCamDevices();
    return true;
  } catch (e) {
    $('pj-video-off').classList.add('show');
    $('pj-cam-btn').classList.remove('on'); $('pj-cam-btn').classList.add('off');
    $('pj-hint').textContent = e.name === 'NotAllowedError'
      ? '⚠️ 摄像头权限被拒绝：视频面试的仪态分析需要摄像头。可在浏览器地址栏允许后重试，或直接加入（将不含仪态分析）。'
      : '⚠️ 摄像头开启失败：' + e.message + '，可继续加入会议用语音/文字作答。';
    return false;
  }
}

function prejoinCameraOff() {
  if (pjStream) { pjStream.getTracks().forEach(t => t.stop()); pjStream = null; }
  $('pj-video').srcObject = null;
  $('pj-video-off').classList.add('show');
  $('pj-cam-btn').classList.remove('on'); $('pj-cam-btn').classList.add('off');
  setCk('cam', 'pending', '已关闭 · 点击开启');
}

async function prejoinToggleCam() {
  if (pjStream) prejoinCameraOff(); else await prejoinCameraOn();
}

function prejoinToggleMic() {
  micOn = !micOn;
  $('pj-mic-btn').classList.toggle('on', micOn);
  $('pj-mic-btn').classList.toggle('off', !micOn);
  if (micStream) micStream.getAudioTracks().forEach(t => t.enabled = micOn);
  setCk('mic', micOn ? 'ok' : 'fail', micOn ? '✓ 已开启' : '✕ 已静音');
  toast(micOn ? '麦克风已开启' : '麦克风已静音');
}

function prejoinTestSpeaker() {
  try {
    speechSynthesis.cancel();
    loadVoices();
    const u = new SpeechSynthesisUtterance('你好，这里是面镜模拟面试的扬声器测试，听到声音说明设备正常。');
    u.lang = 'zh-CN'; u.rate = ttsRate || 1;
    const v = pickVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
    setCk('spk', 'ok', '✓ 正在播放测试语音，听到了吗');
    toast('🔊 正在播放测试语音…');
  } catch (e) { setCk('spk', 'fail', '✕ 播放失败'); toast('扬声器测试失败：' + e.message); }
}

/* ---------------- 语音识别自检（会前） ----------------
 * 一键验证"麦克风 → 识别引擎 → 出字"整条链路，8 秒内出结果。
 * 你说话但识别不到时，用它立刻定位：是麦克风没声音，还是浏览器识别服务不可用。
 */
let selfTestRecog = null;

function voiceSelfTest() {
  const box = $('pj-voice-result');
  const btn = $('pj-voice-btn');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  box.classList.remove('hidden');
  if (selfTestRecog) { try { selfTestRecog.stop(); } catch {} return; }

  // 与面试中一致的引擎选择：Chrome / 不支持在线识别 → 本地离线引擎
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
  const isEdge = /Edg\//.test(navigator.userAgent);
  const localOk = window.LocalASR && LocalASR.available !== false;
  const useLocal = !SR ? localOk : (isChrome && localOk);
  if (!SR && !localOk) {
    box.innerHTML = '❌ 当前浏览器不支持语音识别，且本地识别引擎未就绪。请改用 <b>Edge</b> 或 Chrome，或直接打字作答。';
    return;
  }

  let r;
  if (useLocal) {
    r = LocalASR.createEngine({ deviceId: micDeviceId });
  } else {
    r = new SR();
    r.lang = 'zh-CN'; r.continuous = true; r.interimResults = true;
  }
  selfTestRecog = r;
  btn.classList.add('on');
  box.innerHTML = `🎙 请对着麦克风说几句话（例如"你好，我来参加面试"）…<br><small>当前引擎：${useLocal ? '本地离线识别（语音不出本机）' : '浏览器在线识别'}</small><span class="vr-live"></span>`;

  let heard = false, finished = false;
  const wrapUp = (ok, msg) => {
    if (finished) return; finished = true;
    selfTestRecog = null;
    btn.classList.remove('on');
    box.innerHTML = msg;
  };
  r.onresult = e => {
    heard = true;
    let txt = '';
    if (useLocal) txt = e.final || e.interim || '';
    else for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
    const live = box.querySelector('.vr-live');
    if (live) live.textContent = ' 听到：' + txt.slice(-30);
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      wrapUp(false, '❌ 麦克风权限被拒绝：请点浏览器地址栏左侧的锁形图标，允许麦克风后重试。');
    } else if (e.error === 'local-asr-down') {
      wrapUp(false, '❌ 本地识别服务异常：请重启服务（双击 启动面试.bat）后重试。');
    } else if (e.error === 'network') {
      wrapUp(false, '❌ 在线识别服务连接失败（network）。请重试——面试中会自动切换到本地离线引擎，或改用 Edge。');
    } else if (e.error === 'no-speech') {
      wrapUp(false, '⚠️ 引擎正常但没有听到声音：请检查麦克风是否被系统静音、是否选对了输入设备。');
    } else {
      wrapUp(false, '⚠️ 识别出错：' + e.error + '。可重试，或改用 Edge / 打字作答。');
    }
  };
  r.onend = () => {
    if (finished) return;
    if (heard) wrapUp(true, `✅ 语音识别正常（${useLocal ? '本地离线引擎' : '在线识别'}）！刚才你说的话已成功识别，可以放心加入会议。`);
    else wrapUp(false, '⚠️ 8 秒内没有收到任何识别结果。' + (isChrome
      ? '如多次失败请改用 Edge，面试中也会自动切换本地离线引擎兜底。'
      : isEdge ? '请确认麦克风没静音、系统输入设备选对后重试。' : '建议改用 Edge 浏览器。') + '也可以直接打字作答。');
  };
  try {
    r.start();
    setTimeout(() => { if (selfTestRecog) { try { selfTestRecog.stop(); } catch {} } }, 8000);
  } catch (e) { wrapUp(false, '❌ 启动失败：' + e.message); }
}

/* ===== 加入会议 ===== */
async function joinMeeting() {
  if (!state.session || !pending) return toast('面试会话已失效，请重新开始');
  $('prejoin').classList.add('hidden');
  $('meeting').classList.remove('hidden');
  document.body.classList.add('in-meeting');

  const pos = state.positions.find(p => p.id === state.posId);
  const posName = pos ? pos.name : state.posId;
  $('mtg-title').textContent = `${posName} · 模拟面试`;
  $('mtg-id').textContent = state.mtgId;
  $('me-name').textContent = state.user ? state.user.name : '我';
  $('iv-position').textContent = posName;
  $('iv-skills').innerHTML = (pos ? pos.skills : []).map(s => `<li>${esc(s)}</li>`).join('');
  $('me-mute').classList.toggle('hidden', !micMuted);
  $('btn-cam').classList.toggle('off', !pjStream);
  startCallTimer();

  // 会前预览流交接给会议中的画面
  if (pjStream) {
    camStream = pjStream; pjStream = null;
    $('cam-video').srcObject = camStream;
    $('cam-video').classList.remove('hidden');
    $('cam-placeholder').classList.add('hidden');
  }

  $('chat-log').innerHTML = '';
  setVoiceState('idle', '🎙 面试开始，先听面试官提问');
  $('mic-status').textContent = '面试官说完会自动开麦，你直接开口作答即可';
  renderVoice('');
  updateProgress(0, pending.planSize);
  setCurrentQ(pending.question.text);
  addMsg('ai', pending.greeting + '\n\n' + pending.question.text, true);
  startThinkCountdown(15);   // 第一题也给 15 秒思考时间
  if (pending.jdApplied) addMsg('sys', '🏢 本次面试题目已根据你粘贴的岗位 JD 由大模型定制生成');

  if (state.session.mode === 'video') {
    if (camStream) {
      $('stats-hint').classList.add('hidden');
      await VisionMonitor.start($('cam-video'), renderCamStats);
      addMsg('sys', '🎥 已接入摄像头，AI 面试官将实时分析你的仪态表现（画面仅本机处理，不上传不录制）');
    } else {
      addMsg('sys', '⚠️ 未开启摄像头，本次面试不含仪态分析，可继续用语音/文字作答');
    }
  }
  pending = null;
}

/* ===== 会议内控制 ===== */
function startCallTimer() {
  callStart = Date.now();
  clearInterval(callTimer);
  const tick = () => {
    const s = Math.floor((Date.now() - callStart) / 1000);
    $('mtg-timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  callTimer = setInterval(tick, 1000);
}
function stopCallTimer() { clearInterval(callTimer); callTimer = null; }

function mtgSide(tab) {
  document.querySelectorAll('.side-tab').forEach(b => b.classList.toggle('active', b.dataset.mtab === tab));
  $('mtab-chat').classList.toggle('hidden', tab !== 'chat');
  $('mtab-stats').classList.toggle('hidden', tab !== 'stats');
  $('ctrl-chat').classList.toggle('on', tab === 'chat');
  $('ctrl-stats').classList.toggle('on', tab === 'stats');
}

function toggleViewMode() {
  const on = $('mtg-stage').classList.toggle('grid');
  $('ctrl-view').classList.toggle('on', on);
  toast(on ? '已切换为宫格视图' : '已切换为演讲者视图');
}

function toggleMute() {
  micMuted = !micMuted;
  $('ctrl-mute').classList.toggle('off', micMuted);
  $('ctrl-mute').querySelector('i').textContent = micMuted ? '🔇' : '🎙';
  $('me-mute').classList.toggle('hidden', !micMuted);
  if (micStream) micStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
  if (micMuted) quietStopListening();
  toast(micMuted ? '已静音（语音作答暂停，可继续用文字）' : '已解除静音，面试官提问后会自动开麦');
}

/* AI 面试官说话动画 + 实时字幕 */
function setAvatarTalking(on) {
  const v = $('iv-video'), img = $('iv-photo-img');
  if (!v || !img) return;
  if (on) {
    img.classList.add('hidden');
    v.classList.remove('hidden');
    v.play().catch(() => {});
  } else {
    v.pause();
    v.classList.add('hidden');
    img.classList.remove('hidden');
  }
}

function setAiSpeaking(text) {
  const tile = $('tile-ai');
  if (!tile) return;
  tile.classList.add('speaking');
  setAvatarTalking(true);
  $('ai-badge').textContent = '正在提问';
  if ($('listen-pill')) $('listen-pill').classList.add('hidden');   // 面试官说话时收起收音状态条
  const cap = $('ai-caption');
  if (cap && text) {
    cap.textContent = text.replace(/\s+/g, ' ').trim().slice(0, 140);
    cap.classList.remove('hidden');
  }
  clearTimeout(aiSpeakTimer); clearTimeout(aiCaptionTimer);
  const dur = Math.min(9000, 1500 + (text ? text.length * 60 : 0));
  aiSpeakTimer = setTimeout(() => { tile.classList.remove('speaking'); setAvatarTalking(false); }, dur);
  if (cap) aiCaptionTimer = setTimeout(() => cap.classList.add('hidden'), dur + 2600);
}

function setMeSpeaking(on) {
  $('tile-me').classList.toggle('speaking', !!on);
  $('ai-badge').textContent = on ? '正在聆听' : '正在提问';
}

function updateNetStatus() {
  const el = $('mtg-net');
  if (!el) return;
  const ok = navigator.onLine;
  el.textContent = ok ? '网络良好' : '网络不佳';
  el.classList.toggle('bad', !ok);
}

function updateProgress(done, total) { $('iv-progress').textContent = `进度 ${done} / ${total}`; }

function setCurrentQ(text) {
  const el = $('current-q');
  if (el) el.textContent = text ? `📌 ${text}` : '';
  renderQBrief(state.session && state.session.currentQ);
}

/** 本题押题卡：考察点 + 回答思路（牛客押题风，题目切换即更新） */
function renderQBrief(q) {
  const box = $('q-brief');
  if (!box) return;
  if (!q || (!q.points || !q.points.length) && !q.hint) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const typeMap = { tech: '技术题', project: '项目题', scenario: '场景题', behavior: '行为题' };
  box.innerHTML =
    `<div class="qb-head"><b>📋 本题押题卡</b><span class="tag">${typeMap[q.type] || q.type || ''}</span></div>` +
    (q.points && q.points.length
      ? `<div class="qb-sec"><label>考察点</label><div class="qb-points">${q.points.map(p => `<i>${esc(p)}</i>`).join('')}</div></div>` : '') +
    (q.hint ? `<div class="qb-sec"><label>回答思路</label><p>${esc(q.hint)}</p></div>` : '') +
    `<p class="qb-tip">💡 思考时可参考，作答请用自己的话；卡片会在你作答时自动收起。</p>`;
}

function addMsg(kind, text, speak = false) {
  const log = $('chat-log');
  const div = document.createElement('div');
  div.className = 'msg ' + kind;
  const who = kind === 'ai' ? '🧑‍💼 面试官' : kind === 'me' ? '我' : '系统';
  div.innerHTML = `<div class="who">${who}</div><div class="bubble">${esc(text)}</div>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  if (kind === 'ai') {
    setMeSpeaking(false);
    setAiSpeaking(text);
    if (speak && $('tts-on').checked) speakText(text);
    else if (state.autoFinishAfterSpeech) { state.autoFinishAfterSpeech = false; setTimeout(() => finishInterview(true), 2200); }
    else scheduleAutoListen(900); // 未开 TTS 时也要自动收音
  }
  return div;
}

function showTyping() {
  const log = $('chat-log');
  const div = document.createElement('div');
  div.className = 'msg ai';
  div.id = 'typing';
  div.innerHTML = `<div class="who">🧑‍💼 面试官</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
function hideTyping() { const t = $('typing'); if (t) t.remove(); }

/* ===== 反问环节（对标大易六大板块：候选人向面试官提问，最多 3 轮） ===== */
function enterReverseMode() {
  state.reverseMode = true;
  state.reverseCount = 0;
  skipThink();
  $('bar-status').textContent = '反问环节';
  $('voice-placeholder').textContent = '轮到你了：有什么想反问面试官的？直接开口说，说完自动提交（团队、岗位职责、技术栈、培养机制都可以）';
  renderVoice('');
  updateProgress(state.session.planSize || 0, state.session.planSize || 0);
  addMsg('ai', '我的提问就到这里。按照面试惯例，最后留一点时间给你——你有什么想问我的吗？团队情况、岗位日常工作、技术栈都可以聊。', true);
}

async function askInterviewer(text) {
  const sess = state.session;
  const input = $('answer-input');
  addMsg('me', text);
  input.value = '';
  showTyping();
  try {
    const r = await API('/api/interview/ask', { sessionId: sess.id, question: text });
    hideTyping();
    state.reverseCount++;
    if (state.reverseCount >= 3) {
      // 第 3 个问题回答完 → 面试官收尾 → 说完自动生成报告
      state.autoFinishAfterSpeech = true;
      addMsg('ai', r.reply + ' 时间关系，今天的面试就到这里。感谢你的参与，我正在为你生成评估报告。', true);
      if (!$('tts-on').checked) setTimeout(() => finishInterview(true), 3000);
    } else {
      addMsg('ai', r.reply, true);
    }
  } catch (e) {
    hideTyping();
    toast(e.message);
  }
}

async function submitAnswer(fromVoice) {
  const input = $('answer-input');
  const text = input.value.trim();
  if (!text) return toast(state.reverseMode ? '请先说出你想反问的问题' : '请先开口作答');
  if (!state.session) return;
  if (submitLock) return;
  submitLock = true;
  clearTimeout(autoSubmitTimer);

  // 语音自动提交：先安静地停掉收音，避免把面试官的话也录进去
  if (recog || listenState) quietStopListening();

  // 反问环节：候选人提问，面试官回答
  if (state.reverseMode) {
    try { await askInterviewer(text); } finally { submitLock = false; }
    return;
  }

  const metrics = collectMetrics(text);
  addMsg('me', text);
  input.value = '';
  listenState = null;
  renderVoice('');
  if ($('q-brief')) $('q-brief').classList.add('hidden');   // 作答即收起押题卡
  setVoiceState('thinking', '⏳ 已自动提交，面试官正在思考…');
  $('mic-status').textContent = '说完就自动发出去了，无需点任何按钮';
  $('answer-input').disabled = true;
  showTyping();

  try {
    const r = await API('/api/interview/answer', {
      sessionId: state.session.id,
      qIndex: state.session.currentQ.index,
      answer: text,
      metrics
    });
    hideTyping();
    state.nudgeCount = 0;   // 进入下一环节，面试官引导次数清零
    if (r.followUp) {
      // 面试官追问，题目不变
      $('ai-badge').textContent = '⚡ 追问';
      addMsg('ai', r.nextLine, true);
      addMsg('sys', '⚡ AI 面试官针对你的回答进行了追问，请继续作答');
    } else if (r.done) {
      addMsg('ai', r.nextLine, true);
      enterReverseMode();          // 面试官提问环节结束 → 反问环节
      return;
    } else {
      addMsg('ai', r.nextLine, true);
      state.session.currentQ = r.question;
      setCurrentQ(r.question.text);
      updateProgress(r.progress.done, r.progress.total);
      startThinkCountdown(15);     // 新题目 → 15 秒思考时间（对标 HireVue/大易）
    }
  } catch (e) {
    hideTyping();
    toast(e.message);
    setVoiceState('idle', '⚠️ 提交失败');
    $('mic-status').textContent = '网络或服务异常，已恢复收音，请再说一次';
  } finally {
    submitLock = false;
    $('answer-input').disabled = false;
  }
}

/* ---------------- 语音输入（Web Speech API · 语音优先） ----------------
 * 设计目标：
 *  1) 默认语音作答：面试官说完自动开麦（auto-mic 开关可关）
 *  2) 识别快：interimResults 实时上屏；Chrome 因静音自动断流时 250ms 内无缝续听
 *  3) 智能回合交接：停顿几秒后由面试官 AI 判断你是说完了（进入下一环节）
 *     还是卡住了（说一句引导语帮你继续），绝不机械地按停顿打断你
 *  4) 可打断：面试官说话时你直接开口即可插话（检测到持续人声立即停播并开麦）
 */
let recog = null;
let asrPrefer = localStorage.getItem('mm.asr.prefer') || 'auto';   // auto | webspeech | local
/** 切换识别引擎（会中即时生效，无需重开会议） */
function setAsrPrefer(v) {
  asrPrefer = v;
  localStorage.setItem('mm.asr.prefer', v);
  const sel = $('mtg-asr-select');
  if (sel) sel.value = v;
  const wasListening = !!recog;
  if (wasListening) quietStopListening(true);
  const label = v === 'local' ? '本地离线识别' : v === 'webspeech' ? '浏览器在线识别' : '自动选择';
  toast('识别引擎已切换为：' + label);
  if (wasListening && state.session && !micMuted) setTimeout(() => startListening({ auto: true }), 250);
}
let listenState = null;   // { baseLen, auto, stopped, lastSpeech, restartTimer, gotResult, noResultTimer }
let aiSpeakingNow = false;
let turnCheckTimer = null;
let turnChecking = false;
let bargeRaf = null;      // 打断检测（面试官说话期间的人声监听）
let levelRaf = null;      // 收音音量条动画
const TURN_CHECK_IDLE_MS = 1800;   // 说完停顿 1.8 秒 → 直接自动提交（不再等大模型判断，快）
const TURN_CHECK_EMPTY_MS = 6000;  // 一直没开口，6 秒后面试官主动鼓励
const AUTO_SUBMIT_MIN_CHARS = 8;   // 至少 8 个字才自动提交，避免把"嗯、对"当完整回答
const TURN_NUDGE_MAX = 3;          // 每道题面试官最多主动引导 3 次，之后安静等你

function micBtnUI(rec) {
  const b = $('btn-mic');
  if (!b) return;
  b.classList.toggle('rec', !!rec);
  b.textContent = rec ? '🔴' : '🎙';
  b.title = rec ? '正在收音（点一下＝我说完了，立即提交）' : '点一下开始作答';
}

/* ===== 纯语音作答界面：实时字幕 + 说完自动提交 ===== */
let autoSubmitTimer = null;
let submitLock = false;

/** 状态：idle 待机 / live 正在听 / thinking 面试官思考 / done 已提交（同步到舞台状态条） */
function setVoiceState(kind, text) {
  const el = $('voice-state');
  if (el) {
    el.className = 'voice-state ' + kind;
    el.textContent = text;
  }
  // 舞台底部状态条（牛客面试间同款"请回答，我在听"）
  const pill = $('listen-pill');
  if (pill) {
    const live = kind === 'live' && !aiSpeakingNow;
    pill.classList.toggle('hidden', !live);
    if (live) pill.textContent = '🎙 ' + (text || '请回答，我在听').replace(/^🔴\s*/, '');
  }
}

/** 渲染实时字幕：已确认文字 + 灰色临时文字 */
function renderVoice(interim = '') {
  const buf = $('answer-input').value;
  const c = $('voice-confirmed'), i = $('voice-interim'), box = $('voice-live'), ph = $('voice-placeholder');
  if (!c) return;
  c.textContent = buf;
  i.textContent = interim ? (buf ? ' ' : '') + interim : '';
  const empty = !buf && !interim;
  box.classList.toggle('empty', empty);
  if (ph) ph.style.display = empty ? '' : 'none';
  box.scrollTop = box.scrollHeight;
  // 舞台字幕（牛客同款）：正在收音时把你说的话实时投到大画面上
  const pill = $('listen-pill');
  if (pill) {
    const live = !!(listenState && !listenState.stopped);
    pill.classList.toggle('hidden', !live);
    if (live) {
      const tail = (buf + ' ' + interim).trim().slice(-46);
      pill.textContent = '🎙 ' + (tail || '请回答，我在听');
      const cap = $('ai-caption');
      if (cap) cap.classList.add('hidden');   // 轮到你说了，收起面试官的字幕，避免两条字幕叠在一起
    }
  }
}

/** 说完自动提交（延迟极短，无需任何点击） */
function scheduleAutoSubmit(delay) {
  clearTimeout(autoSubmitTimer);
  autoSubmitTimer = setTimeout(() => {
    if (submitLock || aiSpeakingNow || !state.session) return;
    if (!listenState || listenState.stopped) return;
    if (Date.now() - listenState.lastSpeech < 1000) return;   // 你还在说 → 让保底判断接手
    const t = $('answer-input').value.trim();
    if (t.length < AUTO_SUBMIT_MIN_CHARS) return;
    submitAnswer(true);
  }, delay);
}

/** 当前麦克风音量（RMS 0~1），复用会前检测建立的 AudioContext */
function micRms() {
  if (!micAnalyser) return 0;
  const buf = new Uint8Array(micAnalyser.fftSize);
  micAnalyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
  return Math.sqrt(sum / buf.length);
}

/** 收音音量条：让你一眼看到"麦克风确实在收你的声音" */
function startMicLevel() {
  if (!micAnalyser) return;
  const bar = $('mic-level');
  bar.classList.remove('hidden');
  cancelAnimationFrame(levelRaf);
  const tick = () => {
    if (!recog) { bar.classList.add('hidden'); levelRaf = null; return; }
    bar.firstElementChild.style.width = Math.min(100, Math.round(micRms() * 320)) + '%';
    levelRaf = requestAnimationFrame(tick);
  };
  levelRaf = requestAnimationFrame(tick);
}

/** 打断面试官：面试官语音播放期间监听人声，持续说话 ≥450ms 即停播并开麦 */
function startBargeInWatch() {
  stopBargeInWatch();
  if (!micAnalyser || !micStream || micMuted || !micOn) return;
  const startAt = Date.now();
  let hotMs = 0, prev = performance.now();
  const tick = () => {
    if (!aiSpeakingNow) { bargeRaf = null; return; }
    const now = performance.now();
    // 前 800ms 不检测，给扬声器回声留出余量；建议佩戴耳机
    if (Date.now() - startAt > 800) {
      if (micRms() > 0.05) hotMs += now - prev; else hotMs = Math.max(0, hotMs - (now - prev) * 1.5);
      if (hotMs > 450) { bargeRaf = null; interruptInterviewer(); return; }
    }
    prev = now;
    bargeRaf = requestAnimationFrame(tick);
  };
  bargeRaf = requestAnimationFrame(tick);
}
function stopBargeInWatch() { if (bargeRaf) { cancelAnimationFrame(bargeRaf); bargeRaf = null; } }

function interruptInterviewer() {
  speechSynthesis.cancel();
  aiSpeakingNow = false;
  clearTimeout(ttsWatchdog); clearInterval(ttsResumeTimer);
  stopBargeInWatch();
  setAvatarTalking(false);
  skipThink();
  $('tile-ai').classList.remove('speaking');
  $('ai-caption').classList.add('hidden');
  clearTimeout(aiSpeakTimer); clearTimeout(aiCaptionTimer);
  // 留 250ms 让扬声器里的余音散掉，避免把自己的回声当成你的回答
  setTimeout(() => { if (!recog && !micMuted && state.session) startListening({ auto: true }); }, 250);
  $('mic-status').textContent = '🎙 已打断面试官，请讲';
}

function toggleMic() {
  if (micMuted) return toast('麦克风已静音，请先点击底部「静音」解除静音');
  skipThink();   // 手动开麦 = 跳过思考倒计时
  if (recog) { userStopListening(); return; }
  // 面试官正在说话时手动点麦 = 打断面试官
  if (aiSpeakingNow) { interruptInterviewer(); return; }
  startListening({ auto: false });
}

function startListening({ auto = false } = {}) {
  if (recog || !state.session) return;
  if (micMuted) { if (!auto) toast('麦克风已静音，请先解除静音'); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // 引擎选择：Edge 用浏览器在线识别（快而稳）；Chrome 的在线识别走 Google 服务，
  // 国内不可用 → 直接用本地离线引擎（sherpa-onnx，语音不出本机）
  const isChromeOnly = /Chrome/.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
  const localOk = window.LocalASR && LocalASR.available !== false;
  let useLocal;
  if (asrPrefer === 'local') useLocal = true;
  else if (asrPrefer === 'webspeech') useLocal = false;
  else useLocal = !SR ? localOk : (isChromeOnly && localOk);
  if (!SR && !localOk) {
    if (!auto) toast('当前浏览器不支持语音识别，且本地识别引擎未就绪。请使用 Chrome / Edge，或改用文字输入');
    return;
  }
  if (useLocal && !localOk) useLocal = false;   // 本地引擎不可用则退回浏览器识别

  const input = $('answer-input');
  listenState = {
    baseLen: input.value.length,
    auto, stopped: false, gotResult: false, lastFinal: '',
    engine: useLocal ? 'local' : 'webspeech',
    lastSpeech: Date.now(), restartTimer: null, noResultTimer: null
  };
  if (!state.voiceSession || state.voiceSession.endTime) state.voiceSession = { startTime: Date.now(), used: true };

  let r;
  if (useLocal) {
    r = LocalASR.createEngine({ deviceId: micDeviceId });
  } else {
    r = new SR();
    r.lang = 'zh-CN';
    r.continuous = true;
    r.interimResults = true;   // 关键：边说边上屏，不等整句
    r.maxAlternatives = 1;
  }
  recog = r;

  r.onstart = () => {
    micBtnUI(true);
    skipThink();   // 一开口就结束"思考计时"，避免界面还在数秒
    const tag = listenState.engine === 'local' ? '本地离线识别' : '在线识别';
    if ($('voice-engine')) $('voice-engine').textContent = tag + ' · 语音不出本机';
    setVoiceState('live', '🔴 正在听你说…');
    $('mic-status').textContent = '说完停顿一下就自动提交（点 🎙 也可立即提交）';
    setMeSpeaking(true);
    startMicLevel();
    scheduleTurnCheck();
    // 诊断：开麦 6 秒无任何识别结果 → 识别链路异常
    clearTimeout(listenState.noResultTimer);
    listenState.noResultTimer = setTimeout(() => {
      if (recog && listenState && !listenState.stopped && !listenState.gotResult) {
        setVoiceState('idle', '⚠️ 没听到声音');
        $('mic-status').textContent = '已开麦但没收到识别结果：检查麦克风是否静音/选错设备（底栏「设备」可切换），或稍后重试';
      }
    }, 6000);
  };

  // 两个引擎统一的结果处理（final=本段已确认文字，interim=正在说的临时文字，endpoint=这句说完了）
  const handleResult = (final, interim, endpoint) => {
    if (!listenState || listenState.stopped) return;
    if (final || interim) {
      listenState.gotResult = true;
      clearTimeout(listenState.noResultTimer);
    }
    if (final && final !== listenState.lastFinal) {   // 去重：同一段落文本只追加一次
      // 离线引擎不带标点 → 按语义补上，答案读起来才通顺（报告里也更好看）
      const pretty = punctuate(final, { final: true });
      input.value += pretty;
      listenState.lastFinal = final;
      listenState.baseLen = input.value.length;
    }
    if (final || interim) listenState.lastSpeech = Date.now();
    renderVoice(interim || '');
    setVoiceState('live', '🔴 正在听你说…');
    $('mic-status').textContent = '说完停顿一下就自动提交（点 🎙 也可立即提交）';
    // 引擎判定"这句说完了" → 短暂留出尾巴时间后立即提交，不用等、不用点
    if (endpoint) {
      listenState.lastFinal = '';                     // 新一段重新计
      if (input.value.trim().length >= AUTO_SUBMIT_MIN_CHARS) scheduleAutoSubmit(1200);
    }
    scheduleTurnCheck();
  };

  if (useLocal) {
    r.onresult = e => handleResult(e.final || '', e.interim || '', !!e.endpoint);
  } else {
    r.onresult = e => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      handleResult(final, interim, false);
    };
  }

  r.onerror = e => {
    if (!listenState) return;   // 已结束/已提交的引擎异步报错直接忽略，避免空指针
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      listenState.stopped = true;
      setVoiceState('idle', '❌ 麦克风没权限');
      $('mic-status').textContent = '麦克风权限被拒绝：点地址栏左侧图标允许麦克风后刷新页面';
    } else if (e.error === 'local-asr-down') {
      listenState.stopped = true;
      setVoiceState('idle', '❌ 识别服务异常');
      $('mic-status').textContent = '本地识别服务异常：请重启服务（双击 启动面试.bat）后重试';
    } else if (e.error === 'network') {
      // 浏览器在线识别连不上：无缝切换到本地离线引擎（不置 stopped，onend 会自动续听并换引擎）
      listenState.netErrs = (listenState.netErrs || 0) + 1;
      if (window.LocalASR && LocalASR.available !== false) {
        asrPrefer = 'local';
        $('mic-status').textContent = '🔄 正在切换到本地离线识别引擎…';
      } else if (listenState.netErrs >= 2) {
        listenState.stopped = true;
        setVoiceState('idle', '❌ 识别服务不可用');
        $('mic-status').textContent = '在线识别连不上、本地引擎未就绪：请重启服务后重试';
      }
    } else if (e.error === 'no-speech') {
      // 静音超时，交给 onend 自动续听即可，不提示
    } else {
      $('mic-status').textContent = '识别重连中…';
    }
  };

  r.onend = () => {
    recog = null;
    micBtnUI(false);
    const canRestart = listenState && !listenState.stopped
      && state.session && !aiSpeakingNow && !$('answer-input').disabled && !micMuted;
    if (canRestart) {
      // 断流 → 立刻无缝续听（若刚发生 network 错误，本次重启会换成本地引擎）
      listenState.restartTimer = setTimeout(() => startListening({ auto: listenState.auto }), 200);
      return;
    }
    // 识别服务不可用导致的停止：保留报错文案
    if (listenState && listenState.stopped && $('mic-status').textContent.startsWith('❌')) { setMeSpeaking(false); return; }
    finishListenUI('已停止收音');
  };
  try {
    const p = r.start();
    if (p && p.catch) p.catch(e => { recog = null; toast('语音识别启动失败：' + e.message); });
  } catch (e) { recog = null; toast('语音识别启动失败：' + e.message); }
}

function userStopListening() {
  if (listenState) {
    listenState.stopped = true;
    clearTimeout(listenState.restartTimer);
    clearTimeout(listenState.noResultTimer);
    clearTimeout(turnCheckTimer);
  }
  if (recog) { try { recog.stop(); } catch {} }
  micBtnUI(false);
  // 点 🎙 ＝「我说完了」→ 有内容就直接提交，不让用户再多点一次
  const t = $('answer-input').value.trim();
  clearTimeout(autoSubmitTimer);
  if (t.length >= 4 && state.session && !aiSpeakingNow) { submitAnswer(true); return; }
  finishListenUI('已停止收音');
}

function quietStopListening(keepVoice) {
  if (listenState) {
    listenState.stopped = true;
    clearTimeout(listenState.restartTimer);
    clearTimeout(listenState.noResultTimer);
    clearTimeout(autoSubmitTimer);
  }
  clearTimeout(turnCheckTimer);
  if (recog) { try { recog.stop(); } catch {} }
  recog = null;
  micBtnUI(false);
  setMeSpeaking(false);
  // keepVoice=true（面试官插话引导）：保留语速统计起点，等候选人继续
  if (!keepVoice && state.voiceSession) state.voiceSession.endTime = Date.now();
}

function finishListenUI(msg) {
  if (state.voiceSession) state.voiceSession.endTime = Date.now();
  $('mic-status').textContent = msg;
  if (!aiSpeakingNow) setVoiceState('idle', $('answer-input').value.trim() ? '🎙 已暂停收音' : '🎙 等待面试官提问');
  setMeSpeaking(false);
}

/** 面试官智能回合判断：有内容就快速直接提交；长时间没开口才请面试官引导 */
function scheduleTurnCheck() {
  if (!listenState || listenState.stopped) return;
  clearTimeout(turnCheckTimer);
  const hasContent = $('answer-input').value.trim().length >= AUTO_SUBMIT_MIN_CHARS;
  const wait = hasContent ? TURN_CHECK_IDLE_MS : TURN_CHECK_EMPTY_MS;
  turnCheckTimer = setTimeout(runTurnCheck, wait);
}

async function runTurnCheck() {
  if (!recog || !listenState || listenState.stopped || turnChecking || aiSpeakingNow) return;
  const text = $('answer-input').value.trim();
  const hasContent = text.length >= AUTO_SUBMIT_MIN_CHARS;
  const idle = Date.now() - listenState.lastSpeech;
  const need = hasContent ? TURN_CHECK_IDLE_MS : TURN_CHECK_EMPTY_MS;
  if (idle < need - 300) { scheduleTurnCheck(); return; }      // 用户还在说/刚又说了一句
  // 说完了 → 立即提交，不再绕大模型（省 1~2 秒，体验更快）
  if (hasContent) { submitAnswer(true); return; }
  if ((state.nudgeCount || 0) >= TURN_NUDGE_MAX) {
    $('mic-status').textContent = '🔴 仍在听你说。说完停顿一下就会自动提交，也可以点一下 🎙 立即提交';
    return;                                                     // 引导次数用完，安静等待
  }
  turnChecking = true;
  const lastAt = listenState.lastSpeech;                        // 快照：判断期间用户若又开口则作废
  setVoiceState('thinking', '🤔 等你开口…');
  $('mic-status').textContent = '还没听到你的回答，面试官准备提示你';
  try {
    const r = await API('/api/interview/turn-check', {
      sessionId: state.session.id,
      qIndex: state.session.currentQ.index,
      answer: text
    });
    if (!listenState || listenState.stopped || !recog) return;
    if (listenState.lastSpeech !== lastAt) { scheduleTurnCheck(); return; } // 你又开口了，继续听
    // 面试官觉得你没说完/卡住了 → 说一句引导语，说完自动重新开麦
    state.nudgeCount = (state.nudgeCount || 0) + 1;
    quietStopListening(true);                                  // 暂停收音，避免把面试官的话录进你的回答
    addMsg('ai', r.nudge, true);
  } catch {
    scheduleTurnCheck();                                         // 网络抖动：过一会再判断
  } finally {
    turnChecking = false;
  }
}

/** 面试官说完 → 自动开麦（语音优先的核心）；若处于思考倒计时，则等倒计时结束 */
function scheduleAutoListen(delay = 400) {
  if (!$('auto-mic') || !$('auto-mic').checked) return;
  if (!state.session || state.session.mode === 'text') return;
  if (micMuted || recog || aiSpeakingNow) return;
  // 不再等"思考倒计时"结束：面试官一说完就开麦，你想提前开口也录得到
  setTimeout(() => {
    if (!recog && !aiSpeakingNow && state.session && !$('answer-input').disabled) startListening({ auto: true });
  }, delay);
}

/* ===== 思考倒计时（对标 HireVue/大易：每题给候选人 15 秒组织思路） ===== */
let thinkTimer = null;

function startThinkCountdown(sec = 15) {
  skipThink();
  state.thinkUntil = Date.now() + sec * 1000;
  if ($('btn-skip-think')) $('btn-skip-think').classList.remove('hidden');
  const tick = () => {
    const left = Math.ceil((state.thinkUntil - Date.now()) / 1000);
    if (left <= 0 || !state.thinkUntil) {
      skipThink();
      return;
    }
    $('bar-status').textContent = `⏳ 思考时间 ${left}s（可直接开口或点 🎙 跳过）`;
  };
  tick();
  thinkTimer = setInterval(tick, 500);
}

function skipThink() {
  clearInterval(thinkTimer); thinkTimer = null;
  state.thinkUntil = null;
  if ($('btn-skip-think')) $('btn-skip-think').classList.add('hidden');
  $('bar-status').textContent = state.reverseMode ? '反问环节' : '面试进行中';
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

/* ---------------- 摄像头 · 仪态分析（仅本机推理，不上传） ---------------- */
let camStream = null;

function renderCamStats(s) {
  if (!s) return;
  $('cam-stats').classList.remove('hidden');
  $('stats-hint').classList.add('hidden');
  $('st-gaze').textContent = s.gazePct + '%';
  $('st-steady').textContent = s.steadyPct + '%';
  $('st-smile').textContent = s.smilePct + '%';
  $('st-presence').textContent = s.presencePct + '%';
  $('cam-calibrating').classList.toggle('hidden', !s.calibrating);
}

async function enableCamera() {
  if (camStream) return true;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    $('cam-video').srcObject = camStream;
    $('cam-video').classList.remove('hidden');
    $('cam-placeholder').classList.add('hidden');
    $('btn-cam').classList.remove('off');
    if (state.session && state.session.mode === 'video') {
      $('stats-hint').classList.add('hidden');
      await VisionMonitor.start($('cam-video'), renderCamStats);
    }
    return true;
  } catch (e) {
    toast(e.name === 'NotAllowedError'
      ? '摄像头权限被拒绝：请在浏览器地址栏允许摄像头后重试'
      : '摄像头开启失败：' + e.message);
    return false;
  }
}

async function toggleCamera() {
  if (camStream) {
    VisionMonitor.stop();
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
    $('cam-video').srcObject = null;
    $('cam-video').classList.add('hidden');
    $('cam-placeholder').classList.remove('hidden');
    $('cam-stats').classList.add('hidden');
    $('stats-hint').classList.remove('hidden');
    $('cam-calibrating').classList.add('hidden');
    $('btn-cam').classList.add('off');
    return;
  }
  await enableCamera();
}

/* ---------------- TTS 语音播报（自然拟人化） ----------------
 * 目标：像豆包/真人面试官，而不是系统朗读机器。
 * 做法：① 优先挑"神经网络自然音色"（Xiaoxiao 女声 / Yunxi 男声 等），
 *      ② 按标点断句逐句播报，句间自然停顿；
 *      ③ 语速放慢到 0.95~1.0 并做轻微起伏，避免平直机械感；
 *      ④ 保留看门狗：Chrome 的 onend 丢失会导致 aiSpeakingNow 卡死 → 永不自动开麦。
 */
let ttsWatchdog = null, ttsResumeTimer = null;
let ttsVoicePref = localStorage.getItem('mm.tts.voice') || 'auto';   // auto | female | male
let ttsRate = parseFloat(localStorage.getItem('mm.tts.rate') || '1') || 1;
let ttsVoices = [];

/** 浏览器语音列表异步加载，取一次并缓存 */
function loadVoices() {
  if (!window.speechSynthesis) return;
  const vs = speechSynthesis.getVoices() || [];
  if (vs.length) ttsVoices = vs;
}

/** 按自然度排序挑音色：优先"Online/Natural"神经网络音，其次常见自然音名 */
function pickVoice() {
  const zh = ttsVoices.filter(v => /^zh/i.test(v.lang) || /Chinese|中文|普通话/i.test(v.name));
  if (!zh.length) return null;
  const preferFemale = ['Xiaoxiao', '晓晓', 'Xiaoyi', '晓伊', 'Yaoyao', 'Huihui', 'Tingting', 'Google 普通话'];
  const preferMale = ['Yunxi', '云希', 'Yunyang', '云扬', 'Yunye', '云野', 'Kangkang', '康康', 'Liang'];
  const wants = ttsVoicePref === 'male' ? preferMale : ttsVoicePref === 'female' ? preferFemale : [...preferFemale, ...preferMale];
  for (const name of wants) {
    const hit = zh.find(v => v.name.includes(name));
    if (hit) return hit;
  }
  // 兜底：优先带 Natural / Online 标记的音色，再退回第一个中文音
  const neural = zh.find(v => /natural|online|neural/i.test(v.name));
  return neural || zh[0];
}

function setTtsVoice(pref) {
  ttsVoicePref = pref;
  localStorage.setItem('mm.tts.voice', pref);
  const sel = $('mtg-voice-select');
  if (sel) sel.value = pref;
  toast('面试官音色已切换，下一句话生效');
}
function setTtsRate(v) {
  ttsRate = Math.min(1.3, Math.max(0.7, parseFloat(v) || 1));
  localStorage.setItem('mm.tts.rate', String(ttsRate));
  const lbl = $('mtg-rate-val');
  if (lbl) lbl.textContent = ttsRate.toFixed(2) + '×';
}

/** 试听一句（设备面板 🔊）：用当前音色和语速念一句面试官的话 */
function tryVoice() {
  loadVoices();
  const v = pickVoice();
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance('你好，我是今天的面试官。请介绍一下你自己，说说你和这个岗位相关的经历。');
    u.lang = 'zh-CN';
    if (v) u.voice = v;
    u.rate = ttsRate; u.pitch = 1;
    speechSynthesis.speak(u);
    toast('试听中：' + (v ? v.name.replace(/\s*-\s*Chinese.*$/, '') : '系统默认音色'));
  } catch (e) { toast('试听失败：' + e.message); }
}

/** 把长句按标点切成"一口气"的小段，句间自然停顿（机械感主要来自一口气念完） */
function splitSentences(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!raw) return [];
  const parts = raw.split(/(?<=[。！？；!?;])/).filter(s => s.trim());
  const out = [];
  for (const p of parts) {
    if (p.length <= 42) { out.push(p); continue; }
    // 长句再按逗号拆
    let buf = '';
    for (const seg of p.split(/(?<=[，,、])/)) {
      if ((buf + seg).length > 42 && buf) { out.push(buf); buf = seg; }
      else buf += seg;
    }
    if (buf) out.push(buf);
  }
  return out;
}

function speakText(text) {
  const chunks = splitSentences(text);
  const total = chunks.join('').length || 1;
  const estMs = Math.min(30000, 1200 + total * 300);
  const forceDone = () => {   // 看门狗：onend 丢失时强制复位，保证候选人能开麦
    if (!aiSpeakingNow) return;
    try { speechSynthesis.cancel(); } catch {}
    finishSpeech();
  };
  try {
    speechSynthesis.cancel();
    loadVoices();
    const voice = pickVoice();
    const baseRate = ttsRate;
    aiSpeakingNow = true;
    startBargeInWatch();   // 播放期间允许候选人直接开口打断
    setAvatarTalking(true);

    let i = 0;
    const speakNext = () => {
      if (i >= chunks.length) { finishSpeech(); return; }
      const seg = chunks[i++];
      const u = new SpeechSynthesisUtterance(seg);
      u.lang = 'zh-CN';
      if (voice) u.voice = voice;
      // 语速与音高做轻微随机起伏：真人说话不会每句完全一样
      const jitter = (Math.random() - 0.5) * 0.08;
      u.rate = Math.max(0.7, Math.min(1.3, baseRate + jitter));
      u.pitch = 1 + (Math.random() - 0.5) * 0.12;
      u.volume = 1;
      u.onend = () => setTimeout(speakNext, 90);   // 句间 90ms 停顿，像真人换气
      u.onerror = () => setTimeout(speakNext, 60);
      speechSynthesis.speak(u);
    };
    speakNext();

    // Chrome 长文本假死缓解：周期性 resume
    clearInterval(ttsResumeTimer);
    ttsResumeTimer = setInterval(() => { try { speechSynthesis.resume(); } catch {} }, 4000);
    // 看门狗：超过估算时长 + 缓冲仍未结束 → 强制收尾
    clearTimeout(ttsWatchdog);
    ttsWatchdog = setTimeout(forceDone, estMs + 5000);
  } catch (e) {
    aiSpeakingNow = false;
    scheduleAutoListen(400);
  }
}

function finishSpeech() {
  if (!aiSpeakingNow) return;   // 防止 onend/onerror/看门狗重复触发
  aiSpeakingNow = false;
  clearTimeout(ttsWatchdog);
  clearInterval(ttsResumeTimer);
  stopBargeInWatch();
  setAvatarTalking(false);
  const t = $('tile-ai'); if (t) t.classList.remove('speaking');
  // 反问环节结束语说完 → 直接收尾生成报告
  if (state.autoFinishAfterSpeech) {
    state.autoFinishAfterSpeech = false;
    finishInterview(true);
    return;
  }
  // 说完 → 稍等 0.6s（避开回声）自动开麦收音
  $('mic-status').textContent = '🎙 面试官说完了，正在为你开麦…';
  scheduleAutoListen(600);
}

/* ---------------- 结束会议与报告 ---------------- */
function cleanupMeeting() {
  stopCallTimer();
  stopMicMeter();
  stopBargeInWatch();
  if ($('dev-panel')) { $('dev-panel').classList.add('hidden'); $('ctrl-dev').classList.remove('active'); }
  skipThink();
  try { speechSynthesis.cancel(); } catch {}
  aiSpeakingNow = false;
  clearTimeout(ttsWatchdog); clearInterval(ttsResumeTimer);
  quietStopListening();
  clearTimeout(aiSpeakTimer); clearTimeout(aiCaptionTimer);
  setMeSpeaking(false);
  $('tile-ai').classList.remove('speaking');
  $('ai-caption').classList.add('hidden');
  VisionMonitor.stop();
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  if (pjStream) { pjStream.getTracks().forEach(t => t.stop()); pjStream = null; }
  $('cam-video').srcObject = null;
  $('pj-video').srcObject = null;
  $('cam-video').classList.add('hidden');
  $('cam-placeholder').classList.remove('hidden');
  $('cam-stats').classList.add('hidden');
  $('meeting').classList.add('hidden');
  $('prejoin').classList.add('hidden');
  document.body.classList.remove('in-meeting');
}

async function finishInterview(auto = false) {
  if (!state.session) return;
  const sess = state.session;
  try {
    const videoMetrics = (sess.mode === 'video' && camStream) ? VisionMonitor.summary() : null;
    const { report, transcript } = await API('/api/interview/finish', { sessionId: sess.id, videoMetrics });
    state.lastReportSessionId = sess.id;
    state.session = null;
    pending = null;
    cleanupMeeting();
    renderReport(report, null, transcript);
    go('report');
    if (!auto) toast('已离开会议，评估报告已生成');
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

function renderReport(rep, sessionMeta, transcript) {
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
          <p class="muted small">评估引擎：${rep.engine === 'python' ? 'Python 面试官 Agent（RAG + Agent 评估）' : rep.engine === 'llm' ? '大模型深度评估' : '离线演示引擎'} · 生成于 ${new Date(rep.generatedAt).toLocaleString('zh-CN')}</p>
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

    ${transcript && transcript.length ? `
    <section class="card"><h2>🗒 面试全程回放（你说的原话 + 追问）</h2>
      <div class="replay">${transcript.map(t => `
        <div class="rp-item">
          <div class="rp-q">面试官 ${t.index}：${esc(t.question)}</div>
          <div class="rp-a"><b>你的回答</b><p>${esc(t.answer || '（未作答）')}</p></div>
          ${(t.followUps || []).map(f => `
            <div class="rp-f"><span>追问</span>${esc(f.q)}</div>
            ${f.a ? `<div class="rp-a small"><b>补充回答</b><p>${esc(f.a)}</p></div>` : ''}`).join('')}
          ${t.metrics ? `<div class="rp-m">语速 ${t.metrics.wpm || '-'} 字/分 · 时长 ${t.metrics.seconds || '-'}s · 口头禅 ${t.metrics.fillers || 0} 次 · 自信度 ${t.metrics.confidence || '-'}</div>` : ''}
        </div>`).join('')}
      </div>
    </section>` : ''}

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
function onEngineChange() {
  const engine = $('cfg-engine').value;
  $('cfg-llm-fields').classList.toggle('hidden', engine !== 'llm');
  $('cfg-agent-fields').classList.toggle('hidden', engine !== 'python');
  if (engine === 'python') refreshAgentStatus();
}
async function refreshAgentStatus() {
  const box = $('agent-status');
  box.textContent = '正在探测 Agent 服务…';
  try {
    const s = await API('/api/agent-status');
    box.innerHTML = s.online
      ? `✅ 服务在线 · v${esc(s.version || '')} · 内部引擎 ${esc(s.engine || '')}<br>岗位 ${s.knowledge.positions} 个 / 考点片段 ${s.knowledge.knowledgeChunks} 个 · 工具 ${(s.tools || []).length} 个`
      : `❌ 未连接（${esc(s.url || '')}）：${esc(s.error || '')}`;
  } catch (e) { box.textContent = '探测失败：' + e.message; }
}
/** AI 就绪检查：已配置（llm 引擎已填模型，或 python 服务可用）返回 true */
async function ensureAIReady() {
  let cfg;
  try { cfg = await API('/api/ai-config'); } catch { return false; }
  updateAIBadge(cfg);
  const ready = cfg.engine === 'python' ? true : cfg.engine === 'llm' && !!cfg.configured;
  const bar = $('ai-warn-bar');
  if (bar) bar.classList.toggle('hidden', ready);
  return ready;
}

/** DeepSeek 快速填入：只需粘贴自己的 API Key */
function fillDeepSeek() {
  $('cfg-engine').value = 'llm';
  $('cfg-url').value = 'https://api.deepseek.com';
  $('cfg-model').value = 'deepseek-chat';
  onEngineChange();
  $('cfg-key').focus();
  $('ai-test-detail').textContent = '已填入 DeepSeek 官方接口地址与模型名，只需粘贴你的 API Key（platform.deepseek.com 申请）。';
}

async function openAISettings(gated) {
  const cfg = await API('/api/ai-config');
  $('cfg-engine').value = cfg.engine || 'offline';
  $('cfg-url').value = cfg.baseUrl || '';
  $('cfg-model').value = cfg.model || '';
  $('cfg-key').value = '';
  $('cfg-key').placeholder = cfg.hasKey ? '已保存（输入新值可覆盖）' : 'sk-…（仅保存在本机，不会上传）';
  $('cfg-agent-url').value = cfg.agentUrl || '';
  $('ai-test-result').textContent = '';
  $('ai-test-detail').textContent = '';
  $('ai-gate-tip').classList.toggle('hidden', !gated);
  onEngineChange();
  $('ai-modal').classList.remove('hidden');
}
function closeAISettings() { $('ai-modal').classList.add('hidden'); }
async function saveAISettings() {
  try {
    const cfg = await API('/api/ai-config', {
      engine: $('cfg-engine').value,
      baseUrl: $('cfg-url').value.trim(),
      apiKey: $('cfg-key').value.trim(),
      model: $('cfg-model').value.trim(),
      agentUrl: $('cfg-agent-url').value.trim()
    });
    updateAIBadge(cfg);
    await ensureAIReady();
    toast(cfg.engine === 'python' ? '已切换为 Python 面试官 Agent 引擎 🐍'
      : cfg.engine === 'llm' ? '已接入大模型 ✅' : '已保存（当前为离线演示模式）');
  } catch (e) { toast(e.message); }
}
async function testAISettings() {
  $('ai-test-result').textContent = '测试中…';
  await saveAISettings();
  const r = await API('/api/ai-test', {});
  $('ai-test-result').textContent = r.ok ? '✅ 连接成功' : '❌ 连接失败';
  $('ai-test-detail').textContent = r.ok ? (r.engine === 'python' ? r.reply : `模型回复：${r.reply}`) : r.error;
  if ($('cfg-engine').value === 'python') refreshAgentStatus();
  if (r.ok) { const cfg = await API('/api/ai-config'); updateAIBadge(cfg); }
}
function updateAIBadge(cfg) {
  const b = $('ai-mode-badge');
  const engine = cfg.engine || (cfg.mode === 'llm' ? 'llm' : 'offline');
  if (engine === 'python') {
    b.textContent = 'AI 引擎 · Python Agent';
    b.classList.add('on');
    b.title = '面试官对话与评估由 python-agent 服务（FastAPI + BaseAgent）完成';
  } else if (engine === 'llm') {
    b.textContent = `AI 已接入 · ${cfg.model}`;
    b.classList.add('on');
    b.title = '大模型直连模式';
  } else {
    b.textContent = 'AI 未配置（离线演示）';
    b.classList.remove('on');
    b.title = '点击右上角「AI 设置」接入大模型或 Python Agent';
  }
}

/* ---------------- 管理中心（企业/教师视角） ---------------- */
const DIM_NAMES = { content: '技术正确性', depth: '知识深度', logic: '逻辑严谨性', match: '岗位匹配度', expression: '语言表达', video: '仪态表现' };

function goAdmin() {
  go('admin');
  adminTab('dash');
  if (!sessionStorage.adminToken) {
    $('admin-login').classList.remove('hidden');
    $('admin-dash').classList.add('hidden');
  } else {
    loadDash();
  }
}

async function adminLogin() {
  const pass = $('admin-pass').value;
  try {
    const { ok, token } = await API('/api/admin/login', { passcode: pass });
    if (!ok || !token) { $('admin-login-err').textContent = '口令错误'; return; }
    sessionStorage.adminToken = token;
    $('admin-pass').value = '';
    $('admin-login').classList.add('hidden');
    loadDash();
  } catch (e) { $('admin-login-err').textContent = e.message; }
}

function adminTab(tab) {
  document.querySelectorAll('#view-admin .btn.tab').forEach(b => b.classList.toggle('active', b.dataset.atab === tab));
  for (const t of ['dash', 'students', 'bank', 'audits']) $('atab-' + t).classList.toggle('hidden', t !== tab);
  if (!sessionStorage.adminToken) { $('admin-login').classList.remove('hidden'); $('admin-dash').classList.add('hidden'); return; }
  if (tab === 'dash') loadDash();
  if (tab === 'students') loadStudents();
  if (tab === 'bank') loadBankTab();
  if (tab === 'audits') loadAudits();
}

async function loadAudits() {
  try {
    const { list } = await AAPI('/api/admin/audits');
    const NAME = { 'user.register': '学员注册', 'interview.finish': '面试完成', 'admin.login.ok': '管理员登录', 'admin.login.fail': '登录失败' };
    $('atab-audits').innerHTML = `<div class="card"><h2>🛡 操作审计（最近 ${list.length} 条）</h2>
      ${list.length ? `<table class="rep-table"><tr><th>时间</th><th>操作</th><th>详情</th></tr>
        ${list.map(a => `<tr><td class="muted">${new Date(a.at).toLocaleString('zh-CN')}</td><td>${esc(NAME[a.action] || a.action)}</td><td class="muted">${esc(a.detail || '-')}</td></tr>`).join('')}</table>`
      : '<div class="empty">暂无审计记录</div>'}</div>`;
  } catch (e) { toast(e.message); }
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
    sessionStorage.removeItem('adminToken');
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
  try { await ensureAIReady(); } catch {}
  window.addEventListener('online', updateNetStatus);
  window.addEventListener('offline', updateNetStatus);
  window.addEventListener('beforeunload', () => { try { cleanupMeeting(); } catch {} });
  // 插拔麦克风/耳机时自动刷新设备列表（并回落到可用设备）
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      refreshMicDevices();
      if (micStream) {   // 采集流已失效（设备拔出）→ 重建
        const dead = micStream.getAudioTracks().every(t => t.readyState === 'ended');
        if (dead) { stopMicMeter(); startMicMeter(); }
      }
    });
  }
  // 预热语音列表（异步加载，尽早拿到自然音色）
  if (window.speechSynthesis) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
})();
