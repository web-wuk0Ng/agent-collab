/**
 * 视觉仪态分析（MediaPipe FaceMesh，本地推理，不上传任何画面）
 * 实时采样：出镜率 / 视线专注度（头部朝向代理）/ 头部稳定性 / 自然微笑
 * 开始前 3 秒对用户基线校准，之后按偏差统计。
 */
'use strict';

const VisionMonitor = (() => {
  let faceMesh = null;
  let running = false;
  let videoEl = null;
  let onStats = null;

  const S = {
    samples: 0, hit: 0, gaze: 0, steady: 0, smile: 0,
    calibrated: false, calibSamples: 0,
    baseYaw: 0, basePitch: 0, baseMouth: 0, lastCenter: null,
    error: null
  };

  // 关键点索引：33 左眼外角 263 右眼外角 1 鼻尖 10 额顶 152 下巴 61 左嘴角 291 右嘴角
  const IDX = { le: 33, re: 263, nose: 1, top: 10, chin: 152, ml: 61, mr: 291 };

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function analyze(lm) {
    if (!lm || lm.length < 468) return null;
    const p = i => lm[i];
    const faceW = dist(p(IDX.le), p(IDX.re));
    const faceH = dist(p(IDX.top), p(IDX.chin));
    if (faceW < 1e-6 || faceH < 1e-6) return null;
    // 水平偏移：鼻尖相对两眼中点的偏移比例（头部左右转/视线偏移）
    const eyeMidX = (p(IDX.le).x + p(IDX.re).x) / 2;
    const yaw = (p(IDX.nose).x - eyeMidX) / faceW;
    // 垂直偏移：鼻尖相对 额顶-下巴 中点的偏移比例（点头/抬头低头）
    const verMidY = (p(IDX.top).y + p(IDX.chin).y) / 2;
    const pitch = (p(IDX.nose).y - verMidY) / faceH;
    // 嘴宽比例（微笑代理）
    const mouth = dist(p(IDX.ml), p(IDX.mr)) / faceW;
    return { yaw, pitch, mouth, cx: eyeMidX, cy: verMidY };
  }

  function onResults(res) {
    if (!running) return;
    const a = analyze(res.multiFaceLandmarks && res.multiFaceLandmarks[0]);
    if (!a) {
      S.samples++; // 未检出人脸 → 出镜缺席
      emit();
      return;
    }
    S.samples++; S.hit++;
    if (!S.calibrated) {
      // 校准阶段（约 3 秒 / 6 个样本）
      S.baseYaw += a.yaw; S.basePitch += a.pitch; S.baseMouth += a.mouth;
      if (++S.calibSamples >= 6) {
        S.baseYaw /= S.calibSamples; S.basePitch /= S.calibSamples; S.baseMouth /= S.calibSamples;
        S.calibrated = true;
      }
      emit();
      return;
    }
    const dYaw = Math.abs(a.yaw - S.baseYaw);
    const dPitch = Math.abs(a.pitch - S.basePitch);
    if (dYaw < 0.055 && dPitch < 0.05) S.gaze++;          // 视线朝向镜头方向
    if (S.lastCenter) {
      const move = Math.hypot(a.cx - S.lastCenter.cx, a.cy - S.lastCenter.cy);
      if (move < 0.02) S.steady++;                        // 头部稳定
    }
    if (a.mouth - S.baseMouth > 0.025) S.smile++;         // 自然微笑
    S.lastCenter = { cx: a.cx, cy: a.cy };
    emit();
  }

  function pct(n) { return S.samples ? Math.round(100 * n / S.samples) : 0; }

  function emit() {
    if (onStats) onStats(summary());
  }

  function summary() {
    return {
      presencePct: pct(S.hit),
      gazePct: pct(S.gaze),
      steadyPct: pct(S.steady),
      smilePct: pct(S.smile),
      samples: S.samples,
      calibrated: S.calibrated,
      calibrating: !S.calibrated && S.calibSamples > 0
    };
  }

  async function start(video, statsCb) {
    videoEl = video;
    onStats = statsCb;
    // 重置统计
    Object.assign(S, { samples: 0, hit: 0, gaze: 0, steady: 0, smile: 0, calibrated: false, calibSamples: 0, baseYaw: 0, basePitch: 0, baseMouth: 0, lastCenter: null, error: null });
    if (!faceMesh) {
      faceMesh = new FaceMesh({ locateFile: f => `/vendor/mediapipe/${f}` });
      faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      faceMesh.onResults(onResults);
      await faceMesh.initialize();
    }
    running = true;
    const loop = async () => {
      if (!running || !videoEl) return;
      if (videoEl.readyState >= 2) { try { await faceMesh.send({ image: videoEl }); } catch (e) { S.error = e.message; } }
      requestAnimationFrame(() => setTimeout(loop, 400)); // ~2.5 样本/秒
    };
    loop();
  }

  function stop() { running = false; }

  return { start, stop, summary };
})();
