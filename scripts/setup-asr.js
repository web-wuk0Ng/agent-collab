/* scripts/setup-asr.js —— 本地离线语音识别引擎首次安装
 *
 * 下载 sherpa-onnx Node 运行时（npm）+ zipformer 中文流式模型（hf-mirror）。
 * 安装到 vendor/（已 gitignore，不入库）。启动面试.bat 会在缺失时自动调用。
 * 手动执行：node scripts/setup-asr.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'vendor', 'asr-runtime');
const MODEL_DIR = path.join(ROOT, 'vendor', 'asr-model', 'sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23');
const HF_BASE = 'https://hf-mirror.com/csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23/resolve/main';
const FILES = [
  'encoder-epoch-99-avg-1.int8.onnx',
  'decoder-epoch-99-avg-1.int8.onnx',
  'joiner-epoch-99-avg-1.int8.onnx',
  'tokens.txt'
];

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && redirects > 0) {
        file.close(); fs.unlinkSync(dest);
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects - 1));
      }
      if (res.statusCode !== 200) { file.close(); fs.unlinkSync(dest); return reject(new Error('HTTP ' + res.statusCode)); }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', e => { try { file.close(); fs.unlinkSync(dest); } catch {} reject(e); });
  });
}

async function main() {
  const runtimeOk = fs.existsSync(path.join(RUNTIME_DIR, 'node_modules', 'sherpa-onnx-node'));
  const modelOk = FILES.every(f => fs.existsSync(path.join(MODEL_DIR, f)));
  if (runtimeOk && modelOk) { console.log('[asr] 本地语音识别引擎已就绪，跳过安装'); return; }

  if (!runtimeOk) {
    console.log('[asr] 安装 sherpa-onnx 运行时（npm，约 25MB）…');
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(path.join(RUNTIME_DIR, 'package.json'), '{"name":"mockmirror-asr-runtime","private":true}');
    const reg = process.env.ASR_NPM_REGISTRY || 'https://registry.npmmirror.com';
    execSync(`npm install --registry=${reg} --no-audit --no-fund sherpa-onnx-node@1.13.8 sherpa-onnx-win-x64@1.13.8`,
      { cwd: RUNTIME_DIR, stdio: 'inherit' });
  }

  if (!modelOk) {
    console.log('[asr] 下载中文识别模型（约 25MB）…');
    fs.mkdirSync(MODEL_DIR, { recursive: true });
    for (const f of FILES) {
      process.stdout.write('  ' + f + ' … ');
      await download(`${HF_BASE}/${f}`, path.join(MODEL_DIR, f));
      console.log('ok');
    }
  }
  console.log('[asr] 本地离线语音识别引擎安装完成 ✔');
}

main().catch(e => {
  console.warn('[asr] 本地语音识别安装失败（不影响使用，浏览器在线识别仍可用）：' + e.message);
});
