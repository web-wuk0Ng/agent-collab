/* public/js/localasr.js —— 本地离线语音识别（前端采集层）
 *
 * Chrome 的 Web Speech 在线识别在国内不可用，本模块提供等效的本地引擎：
 * 麦克风 → AudioContext(16kHz) → PCM 分片(0.6s) → POST /api/asr/chunk →
 * 服务端 sherpa-onnx 流式识别 → 返回实时文本。全程不出本机，Chrome/Edge/断网可用。
 *
 * 对外暴露与 Web Speech 相似的事件接口，供 app.js 统一接线：
 *   const engine = LocalASR.createEngine();
 *   engine.onstart / onresult({final, interim}) / onerror({error}) / onend
 *   engine.start() / engine.stop()
 */
(function () {
  const CHUNK_MS = 160;   // 分片越短，字幕出得越快（160ms 一片，接近实时字幕）
  let availableCache = null;

  async function check() {
    try {
      const r = await fetch('/api/asr/status');
      const j = await r.json();
      availableCache = !!j.available;
    } catch { availableCache = false; }
    return availableCache;
  }

  function int16ToB64(i16) {
    const u8 = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(bin);
  }

  function createEngine(opts) {
    const deviceId = (opts && opts.deviceId) || '';
    const onRefined = (opts && opts.onRefined) || null;
    let audioCtx = null, source = null, processor = null, stream = null;
    let sessionId = null, stopped = true, pcmQueue = [];
    let requestChain = Promise.resolve(), stoppedPromise = null;

    const engine = {
      onstart: null, onresult: null, onerror: null, onend: null,
      get stoppedPromise() { return stoppedPromise; },

      async start() {
        stopped = false;
        sessionId = 'asr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const audio = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        if (deviceId) audio.deviceId = { exact: deviceId };
        try {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio });
          } catch (e) {
            if (!deviceId || !['OverconstrainedError', 'NotFoundError'].includes(e.name)) throw e;
            stream = await navigator.mediaDevices.getUserMedia({
              audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
          }
          // 权限弹窗期间可能已经结束面试，拿到的流必须立即释放。
          if (stopped) { teardown(); return; }
          try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          } catch {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          }
          source = audioCtx.createMediaStreamSource(stream);
          processor = audioCtx.createScriptProcessor(2048, 1, 1);
          const nativeRate = audioCtx.sampleRate;
          processor.onaudioprocess = ev => {
            if (stopped) return;
            let data = ev.inputBuffer.getChannelData(0);
            if (nativeRate !== 16000) {
              const ratio = nativeRate / 16000;
              const out = new Float32Array(Math.floor(data.length / ratio));
              for (let i = 0; i < out.length; i++) out[i] = data[Math.floor(i * ratio)];
              data = out;
            }
            pcmQueue.push(new Float32Array(data));
            if (pcmQueue.reduce((n, a) => n + a.length, 0) >= 16000 * CHUNK_MS / 1000) flushPcm();
          };
          source.connect(processor);
          processor.connect(audioCtx.destination);
          if (engine.onstart) engine.onstart();
        } catch (e) {
          const wasStopped = stopped;
          stopped = true;
          teardown();
          if (!wasStopped && engine.onerror) engine.onerror({ error: e.name === 'NotAllowedError' ? 'not-allowed' : 'local-asr-down' });
          if (!wasStopped && engine.onend) engine.onend();
        }
      },

      stop() {
        if (stoppedPromise) return stoppedPromise;
        stopped = true;
        // 采集立即释放；尾帧上传和精识别仍严格串行完成。
        teardown();
        flushPcm();
        stoppedPromise = requestChain.then(async () => {
          if (!sessionId) return;
          const r = await fetch('/api/asr/end', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: sessionId }), signal: AbortSignal.timeout(10000)
          });
          const j = await r.json();
          if (r.ok && j.text && onRefined) onRefined(j.text);
        }).catch(() => {});
        if (engine.onend) engine.onend();
        return stoppedPromise;
      }
    };

    function teardown() {
      try { processor && processor.disconnect(); } catch {}
      try { source && source.disconnect(); } catch {}
      try { audioCtx && audioCtx.close(); } catch {}
      try { stream && stream.getTracks().forEach(t => t.stop()); } catch {}
      audioCtx = source = processor = stream = null;
    }

    function flushPcm() {
      if (!pcmQueue.length || !sessionId) return;
      const parts = pcmQueue; pcmQueue = [];
      const total = parts.reduce((n, a) => n + a.length, 0);
      const i16 = new Int16Array(total);
      let off = 0;
      for (const part of parts) {
        for (const sample of part) {
          const v = Math.max(-1, Math.min(1, sample));
          i16[off++] = v < 0 ? v * 32768 : v * 32767;
        }
      }
      const pcm = int16ToB64(i16);
      requestChain = requestChain.then(async () => {
        const r = await fetch('/api/asr/chunk', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sessionId, pcm }), signal: AbortSignal.timeout(8000)
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'asr failed');
        if (!stopped && engine.onresult) {
          if (j.endpoint) engine.onresult({ final: j.text || '', interim: '', endpoint: true });
          else if (j.text) engine.onresult({ final: '', interim: j.text, endpoint: false });
        }
      }).catch(() => {
        if (!stopped && engine.onerror) engine.onerror({ error: 'local-asr-down' });
      });
    }

    return engine;
  }

  window.LocalASR = {
    check,
    get available() { return availableCache; },
    createEngine
  };
  // 页面加载即探测本地引擎是否就绪
  check();
})();
