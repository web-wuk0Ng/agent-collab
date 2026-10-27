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
    let sessionId = null, stopped = true, pcmQueue = [], sending = false;
    let stoppedPromise = null;   // stop() 后 resolve（等待服务端精识别回填最终文本）

    const engine = {
      onstart: null, onresult: null, onerror: null, onend: null,

      async start() {
        stopped = false;
        sessionId = 'asr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const audio = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        if (deviceId) audio.deviceId = { exact: deviceId };
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio });
        } catch (e) {
          // 指定设备不可用 → 回退默认设备，别让整场面试失去语音
          if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
              });
            } catch { stream = null; }
          }
          if (!stream) {
            stopped = true;
            if (engine.onerror) engine.onerror({ error: 'not-allowed' });
            if (engine.onend) engine.onend();
            return;
          }
        }
        try {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        } catch {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        source = audioCtx.createMediaStreamSource(stream);
        processor = audioCtx.createScriptProcessor(2048, 1, 1);   // 128ms 一帧，延迟更低
        const nativeRate = audioCtx.sampleRate;
        pcmQueue = [];

        processor.onaudioprocess = ev => {
          if (stopped) return;
          let data = ev.inputBuffer.getChannelData(0);
          // 浏览器不保证 16k → 简单线性重采样
          if (nativeRate !== 16000) {
            const ratio = nativeRate / 16000;
            const out = new Float32Array(Math.floor(data.length / ratio));
            for (let i = 0; i < out.length; i++) out[i] = data[Math.floor(i * ratio)];
            data = out;
          }
          pcmQueue.push(new Float32Array(data));
          const total = pcmQueue.reduce((s, a) => s + a.length, 0);
          if (total >= 16000 * CHUNK_MS / 1000) flushPcm(false);
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
        if (engine.onstart) engine.onstart();
      },

      stop() {
        if (stopped) return Promise.resolve();
        stopped = true;
        stoppedPromise = flushPcm(true).catch(() => {});
        stoppedPromise.then(() => teardown());
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

    async function flushPcm(isLast) {
      // 收尾时若上一片还在发：等它发完再收，保证尾巴不丢
      if (isLast && sending) {
        await new Promise(r => setTimeout(r, 40));
        return flushPcm(true);
      }
      if (sending || !pcmQueue.length || !sessionId) {
        if (isLast && sessionId && !sending && !pcmQueue.length) {
          // 收尾：通知服务端结束，取回精识别全文（SenseVoice 二次识别，更准）
          try {
            const r = await fetch('/api/asr/end', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: sessionId })
            });
            const j = await r.json().catch(() => ({}));
            if (j && j.text && onRefined) onRefined(j.text);
          } catch { /* 精识别失败无感，用流式文本照常提交 */ }
        }
        return;
      }
      const parts = pcmQueue; pcmQueue = [];
      const total = parts.reduce((s, a) => s + a.length, 0);
      const merged = new Float32Array(total);
      let off = 0;
      for (const a of parts) { merged.set(a, off); off += a.length; }
      const i16 = new Int16Array(total);
      for (let i = 0; i < total; i++) {
        const v = Math.max(-1, Math.min(1, merged[i]));
        i16[i] = v < 0 ? v * 32768 : v * 32767;
      }
      sending = true;
      try {
        const r = await fetch('/api/asr/chunk', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sessionId, pcm: int16ToB64(i16) })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'asr failed');
        if (!stopped && engine.onresult) {
          // endpoint=true 表示"这一句说完了"（引擎检测到停顿）；此时 text 是本段完整文字，
          // 其余时刻 text 是同一段的增量结果，仅用于实时字幕预览（不追加，避免重复）
          if (j.endpoint) engine.onresult({ final: j.text || '', interim: '', endpoint: true });
          else if (j.text) engine.onresult({ final: '', interim: j.text, endpoint: false });
        }
      } catch (e) {
        if (!stopped && engine.onerror) engine.onerror({ error: 'local-asr-down' });
      } finally {
        sending = false;
        if (pcmQueue.length) flushPcm(stopped);   // stopped 时继续收尾，把剩余尾巴和 end 请求发完
      }
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
