/* lib/asr-refine-worker.js —— 精识别工作线程（SenseVoice）
 *
 * 为什么用 worker：SenseVoice 解码是重 CPU 同步计算（一段 8s 音频约 0.5~1s），
 * 若在主线程跑会把整个服务卡住；放到常驻线程里异步跑，字幕/请求完全不受影响。
 * 模型只加载一次（约 1~2s），之后每段音频一条消息搞定。
 */
const { parentPort } = require('worker_threads');
const path = require('path');

let rec = null;

parentPort.on('message', msg => {
  try {
    if (!rec) {
      // eslint-disable-next-line
      const sherpa = require(path.join(__dirname, '..', 'vendor', 'asr-runtime', 'node_modules', 'sherpa-onnx-node'));
      rec = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          senseVoice: { model: msg.model, language: '', useInverseTextNormalization: 1 },
          tokens: msg.tokens,
          numThreads: 3,
          provider: 'cpu',
          debug: 0
        },
        decodingMethod: 'greedy_search'
      });
      if (!msg.id) { parentPort.postMessage({ ready: true }); return; }   // 预热消息
    }
    const stream = rec.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(msg.samples) });
    rec.decode(stream);
    parentPort.postMessage({ id: msg.id, text: rec.getResult(stream).text || '' });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: e.message });
  }
});
