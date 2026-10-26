/* lib/asr.js —— 本地离线语音识别引擎（sherpa-onnx 流式中文识别）
 *
 * 目的：Chrome 的 Web Speech 在线识别走 Google 服务，国内不可用。
 * 本模块在服务端跑 sherpa-onnx（zipformer 中文流式模型），浏览器采集 16kHz PCM
 * 分片上传到 /api/asr/chunk，服务端实时返回识别文本。
 * 全程不经过任何云端服务，Chrome/Edge/断网均可用，语音数据不出本机。
 *
 * 运行时与模型不入 git，由 scripts/setup-asr.js 首次运行时自动下载。
 * 若未安装，available() 返回 false，前端自动回退到浏览器识别。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'vendor', 'asr-runtime');
const MODEL_ROOT = path.join(ROOT, 'vendor', 'asr-model');
/* 模型优先级：
 * ① 中英双语大模型（默认）—— 词表含英文，能识别 "AI / Redis / LoRA" 这类技术词；
 *    实测 RTF≈0.04（8.8 秒音频 360ms 解码），CPU 完全扛得住，约 190MB
 * ② 纯中文小模型 —— 体积小（25MB），作为双语模型缺失时的兜底（无英文词表）
 */
const CANDIDATES = [
  { dir: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20', files: { encoder: 'encoder-epoch-99-avg-1.int8.onnx', decoder: 'decoder-epoch-99-avg-1.int8.onnx', joiner: 'joiner-epoch-99-avg-1.int8.onnx' } },
  { dir: 'sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23', files: { encoder: 'encoder-epoch-99-avg-1.int8.onnx', decoder: 'decoder-epoch-99-avg-1.int8.onnx', joiner: 'joiner-epoch-99-avg-1.int8.onnx' } }
];
const MODEL_DIR = path.join(MODEL_ROOT, (CANDIDATES.find(c => fs.existsSync(path.join(MODEL_ROOT, c.dir, 'tokens.txt'))) || CANDIDATES[1]).dir);

const terms = require('./terms');

let recognizer = null;
let initError = null;
const streams = new Map(); // id -> { stream, lastText }

function modelPaths() {
  // 优先 int8（快、省内存），退回 fp32
  const encInt8 = path.join(MODEL_DIR, 'encoder-epoch-99-avg-1.int8.onnx');
  const encFp32 = path.join(MODEL_DIR, 'encoder-epoch-99-avg-1.onnx');
  const enc = fs.existsSync(encInt8) ? encInt8 : encFp32;
  const decInt8 = path.join(MODEL_DIR, 'decoder-epoch-99-avg-1.int8.onnx');
  const decFp32 = path.join(MODEL_DIR, 'decoder-epoch-99-avg-1.onnx');
  const dec = fs.existsSync(decInt8) ? decInt8 : decFp32;
  const joiInt8 = path.join(MODEL_DIR, 'joiner-epoch-99-avg-1.int8.onnx');
  const joiFp32 = path.join(MODEL_DIR, 'joiner-epoch-99-avg-1.onnx');
  const joi = fs.existsSync(joiInt8) ? joiInt8 : joiFp32;
  return { encoder: enc, decoder: dec, joiner: joi, tokens: path.join(MODEL_DIR, 'tokens.txt') };
}

function installed() {
  const p = modelPaths();
  return fs.existsSync(path.join(RUNTIME_DIR, 'node_modules', 'sherpa-onnx-node'))
    && ['encoder', 'decoder', 'joiner', 'tokens'].every(k => fs.existsSync(p[k]));
}

function init() {
  if (recognizer || initError) return;
  if (!installed()) { initError = new Error('未安装（运行 scripts/setup-asr.js）'); return; }
  try {
    // eslint-disable-next-line
    const sherpa = require(path.join(RUNTIME_DIR, 'node_modules', 'sherpa-onnx-node'));
    const p = modelPaths();
    recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: p.encoder, decoder: p.decoder, joiner: p.joiner },
        tokens: p.tokens,
        numThreads: 4,   // 大模型并行度拉满，实测 RTF≈0.04，远快于实时
        provider: 'cpu',
        debug: 0
      },
      decodingMethod: 'greedy_search',
      enableEndpoint: 1,
      // 停顿判定调短：真面试里约 0.5 秒静音就断句，字幕分段更自然、自动提交更快
      rule1MinTrailingSilence: 1.6,
      rule2MinTrailingSilence: 0.8,
      rule3MinUtteranceLength: 15
    });
    console.log('  ✔ 本地离线语音识别引擎已加载（sherpa-onnx zipformer-zh）');
  } catch (e) {
    initError = e;
    console.warn('  ⚠ 本地语音识别初始化失败：' + e.message);
  }
}

function available() { init(); return !!recognizer; }

function getStream(id) {
  if (!recognizer) throw new Error('本地识别引擎不可用');
  let s = streams.get(id);
  if (!s) {
    s = { stream: recognizer.createStream(), lastText: '' };
    streams.set(id, s);
    // 防御：流数量上限，避免内存泄漏
    if (streams.size > 20) {
      const oldest = streams.keys().next().value;
      streams.delete(oldest);
    }
  }
  return s;
}

/** 喂入一段 16kHz Int16 PCM（Buffer，小端），返回 { text, endpoint } */
function acceptPcm(id, pcmBuf) {
  const s = getStream(id);
  const n = Math.floor(pcmBuf.length / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = pcmBuf.readInt16LE(i * 2) / 32768.0;
  s.stream.acceptWaveform({ sampleRate: 16000, samples });
  while (recognizer.isReady(s.stream)) recognizer.decode(s.stream);
  const raw = recognizer.getResult(s.stream).text || '';
  const text = terms.normalize(raw);   // 专业名词纠偏（含口音谐音变体）
  const endpoint = recognizer.isEndpoint(s.stream);
  if (endpoint) recognizer.reset(s.stream);
  s.lastText = text;
  return { text, endpoint };
}

/** 结束会话，取最终结果并释放 */
function finish(id) {
  const s = streams.get(id);
  if (!s) return { text: '' };
  try {
    s.stream.inputFinished();
    while (recognizer.isReady(s.stream)) recognizer.decode(s.stream);
    const text = terms.normalize(recognizer.getResult(s.stream).text || s.lastText || '');
    return { text };
  } finally {
    streams.delete(id);
  }
}

module.exports = { available, acceptPcm, finish };
