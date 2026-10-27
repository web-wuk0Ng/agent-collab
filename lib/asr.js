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


let recognizer = null;
let initError = null;
const streams = new Map(); // id -> { stream, lastText, utt, parts, pending }

/* ---------- 精识别（SenseVoice，可选） ----------
 * 流式模型负责实时字幕与断句；每说完一段（endpoint），把整段音频交给
 * 常驻工作线程里的 SenseVoice 二次识别 —— 中文准确率显著更高、自带数字规整。
 * 提交回答时（/api/asr/end）把各段精识别文本拼接回传，替换流式结果。
 * 模型未安装时自动静默降级：纯流式照常工作，零影响。 */
const REFINE_DIR = path.join(MODEL_ROOT, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17');
let refineWorker = null, refineSeq = 0;

function offlinePaths() {
  const model = path.join(REFINE_DIR, 'model.int8.onnx');
  const tokens = path.join(REFINE_DIR, 'tokens.txt');
  return fs.existsSync(model) && fs.existsSync(tokens) ? { model, tokens } : null;
}

function getRefineWorker() {
  if (refineWorker) return refineWorker;
  const p = offlinePaths();
  if (!p || !fs.existsSync(path.join(RUNTIME_DIR, 'node_modules', 'sherpa-onnx-node'))) return null;
  try {
    const { Worker } = require('worker_threads');
    refineWorker = new Worker(path.join(__dirname, 'asr-refine-worker.js'));
    refineWorker.on('error', () => { refineWorker = null; });
    refineWorker.on('exit', () => { refineWorker = null; });
    refineWorker.unref();   // 不阻止进程退出
    refineWorker.postMessage({ model: p.model, tokens: p.tokens });   // 预热：先加载模型
  } catch {
    refineWorker = null;
  }
  return refineWorker;
}

/** 把一段完整音频送去精识别（异步）。streamText 是该段的流式结果，作兜底。 */
function refineUtterance(s, samples, streamText) {
  s.parts.push({ text: streamText, refined: null });
  const w = getRefineWorker();
  if (!w) return;
  const idx = s.parts.length - 1;
  const id = ++refineSeq;
  const buf = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength);
  const task = new Promise(resolve => {
    const done = m => {
      clearTimeout(timer);
      w.off('message', onMsg); w.off('error', failed); w.off('exit', failed);
      const part = s.parts[idx];
      if (part && m && !m.error && m.text) part.refined = m.text;
      resolve();
    };
    const onMsg = m => { if (m.id === id) done(m); };
    const failed = () => done(null);
    const timer = setTimeout(failed, 6000);
    w.on('message', onMsg); w.once('error', failed); w.once('exit', failed);
    try { w.postMessage({ id, samples: buf }, [buf]); } catch { failed(); }
  });
  s.pending.push(task);
}

// 停顿只是字幕断句；精识别保留约 8 秒的中英上下文，避免 Agent 等短词被独立解码丢字。
function bufferRefinement(s, samples, text, force = false) {
  if (samples.length) s.refineAudio.push(samples);
  if (text) s.refineText.push(text);
  const length = s.refineAudio.reduce((n, a) => n + a.length, 0);
  if (length && (force || length >= 16000 * 8)) {
    refineUtterance(s, mergeF32(s.refineAudio), s.refineText.join(' '));
    s.refineAudio = []; s.refineText = [];
  }
}

/** 双语模型按官方 BPE 词表编码技术热词；缺少词表时照常识别。 */
function hotwordConfig() {
  const bpeVocab = path.join(MODEL_DIR, 'bpe.vocab');
  if (!fs.existsSync(bpeVocab)) return {};
  // SentencePiece 的 Windows 文件读取不支持含中文的绝对路径，优先用相对路径。
  const vocabPath = path.relative(process.cwd(), bpeVocab);
  if (/[^\x00-\x7f]/.test(vocabPath)) return {};
  const words = ['AGENT', 'MULTI AGENT', 'DEEPSEEK', 'LANGCHAIN', 'LANGGRAPH', 'MCP', 'LLM', 'RAG', 'LORA', 'PROMPT', 'TOKEN', 'EMBEDDING', 'REDIS', 'MYSQL', 'JAVA', 'PYTHON', 'DOCKER', 'KAFKA', 'SPRING', 'VUE', 'REACT', 'TYPESCRIPT', 'JAVASCRIPT', 'HTTP', 'API', 'JVM'];
  const file = path.join(MODEL_DIR, 'interview-hotwords.txt');
  fs.writeFileSync(file, words.join('\n') + '\n');
  return { modelConfig: { modelingUnit: 'cjkchar+bpe', bpeVocab: vocabPath }, decodingMethod: 'modified_beam_search', maxActivePaths: 4, hotwordsFile: path.relative(process.cwd(), file), hotwordsScore: 1.5 };
}

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
    const { modelConfig: termModel = {}, ...termOptions } = hotwordConfig();
    recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: p.encoder, decoder: p.decoder, joiner: p.joiner },
        tokens: p.tokens,
        ...termModel,
        numThreads: 4,   // 大模型并行度拉满，实测 RTF≈0.04，远快于实时
        provider: 'cpu',
        debug: 0
      },
      decodingMethod: 'greedy_search',
      ...termOptions,
      enableEndpoint: 1,
      // 停顿判定调短：真面试里约 0.5 秒静音就断句，字幕分段更自然、自动提交更快
      rule1MinTrailingSilence: 1.6,
      // 长句也要求 ~1.6s 静音才判定结束：候选人边想边说不会被打断
      rule2MinTrailingSilence: 1.6,
      rule3MinUtteranceLength: 15
    });
    console.log('  ✔ 本地离线语音识别引擎已加载（sherpa-onnx zipformer-zh）');
    getRefineWorker(); // 会前预热，避免首次提交才加载精识别模型
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
    s = { stream: recognizer.createStream(), lastText: '', utt: [], parts: [], pending: [], refineAudio: [], refineText: [] };
    streams.set(id, s);
    // 防御：流数量上限，避免内存泄漏
    if (streams.size > 20) {
      const oldest = streams.keys().next().value;
      streams.delete(oldest);
    }
  }
  return s;
}

/** 合并多段 Float32 为一段 */
function mergeF32(arr) {
  if (arr.length === 1) return arr[0];
  const total = arr.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const a of arr) { out.set(a, off); off += a.length; }
  return out;
}

/** 喂入一段 16kHz Int16 PCM（Buffer，小端），返回 { text, endpoint } */
function acceptPcm(id, pcmBuf) {
  const s = getStream(id);
  const n = Math.floor(pcmBuf.length / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = pcmBuf.readInt16LE(i * 2) / 32768.0;
  s.utt.push(samples);
  s.stream.acceptWaveform({ sampleRate: 16000, samples });
  while (recognizer.isReady(s.stream)) recognizer.decode(s.stream);
  const raw = recognizer.getResult(s.stream).text || '';
  const endpoint = recognizer.isEndpoint(s.stream);
  if (endpoint) {
    // 这一段说完了：整段音频送去精识别（异步、不阻塞实时字幕），流式结果作兜底
    const merged = mergeF32(s.utt);
    bufferRefinement(s, merged, raw);
    s.utt = [];
    recognizer.reset(s.stream);
  }
  s.lastText = endpoint ? '' : raw;
  return { text: raw, endpoint };
}

/** 结束会话：等在途精识别完成（≤3s），返回整场最优文本并释放 */
async function finish(id) {
  const s = streams.get(id);
  if (!s) return { text: '' };
  try {
    s.stream.inputFinished();
    while (recognizer.isReady(s.stream)) recognizer.decode(s.stream);
    const tail = recognizer.getResult(s.stream).text || s.lastText || '';
    // 最后一段（没等到 endpoint 的尾巴）也送去精识别
    if (s.utt.length) {
      const merged = mergeF32(s.utt);
      bufferRefinement(s, merged, tail, true);
      s.utt = [];
    }
    bufferRefinement(s, new Float32Array(0), '', true);
    const hasRefine = !!getRefineWorker();
    if (hasRefine) await Promise.allSettled(s.pending);
    // 每段优先用精识别文本（更准），没有就用流式兜底；都没有则用整段流式结果
    let text = s.parts.map(p => p.refined || p.text).filter(Boolean).join(' ');
    if (!text) text = tail;
    // SenseVoice 是多语模型，中文音频偶发吐出个别韩/日字符 → 清理掉（保留中英文与常用标点）
    text = text.replace(/[\u3040-\u30FF\u31F0-\u31FF\u3130-\u318F\uAC00-\uD7AF]+/g, '')
               .replace(/^[，。、,.\s]+|[，。、,.\s]+$/g, '');
    return { text, refined: hasRefine && s.parts.some(p => p.refined) };
  } finally {
    streams.delete(id);
  }
}

module.exports = { available, acceptPcm, finish };
