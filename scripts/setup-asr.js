/* scripts/setup-asr.js —— 本地离线语音识别引擎安装（可选、全自动、跨平台）
 *
 * 作用：让 Chrome / 断网环境也能语音面试（浏览器自带的 Web Speech 在国内 Chrome 上不可用）。
 * 安装内容：sherpa-onnx Node 运行时（npm）+ zipformer 中文流式模型，共约 50MB，装在 vendor/（不入库）。
 *
 * 设计原则（给别人 clone 后一键跑）：
 *   1) 全自动、跨平台：按 os/arch 选对应的原生包（不再只装 win-x64）
 *   2) 多镜像兜底：npm 走 npmmirror → npmjs；模型走 hf-mirror → GitHub Releases → huggingface
 *   3) 永不阻塞：任何一步失败都只告警，程序照常启动（Edge 可用浏览器在线识别）
 *   4) 可跳过：MOCKMIRROR_SKIP_ASR=1 或 --skip 直接不安装
 *
 * 手动执行：node scripts/setup-asr.js [--skip]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'vendor', 'asr-runtime');
const MODEL_NAME = 'sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23';
const MODEL_DIR = path.join(ROOT, 'vendor', 'asr-model', MODEL_NAME);
const FILES = [
  'encoder-epoch-99-avg-1.int8.onnx',
  'decoder-epoch-99-avg-1.int8.onnx',
  'joiner-epoch-99-avg-1.int8.onnx',
  'tokens.txt'
];
const VERSION = '1.13.8';

/* ---------- 平台对应的原生包 ---------- */
function nativePkg() {
  const p = process.platform, a = process.arch;
  if (p === 'win32') return a === 'x64' ? 'sherpa-onnx-win-x64' : null;
  if (p === 'linux') return a === 'x64' ? 'sherpa-onnx-linux-x64' : a === 'arm64' ? 'sherpa-onnx-linux-aarch64' : null;
  if (p === 'darwin') return a === 'arm64' ? 'sherpa-onnx-osx-arm64' : a === 'x64' ? 'sherpa-onnx-osx-x64' : null;
  return null;
}

/* ---------- 下载（支持重定向 + 超时） ---------- */
function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000 }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && redirects > 0) {
        res.resume();
        try { fs.unlinkSync(dest); } catch {}
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        try { fs.unlinkSync(dest); } catch {}
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('下载超时')); });
    req.on('error', reject);
  });
}

async function fetchModels() {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  const sources = [
    `https://hf-mirror.com/csukuangfj/${MODEL_NAME}/resolve/main`,
    `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2#tarball`,
    `https://huggingface.co/csukuangfj/${MODEL_NAME}/resolve/main`
  ];
  for (const base of sources) {
    try {
      if (base.endsWith('#tarball')) return await fetchTarball(base.replace('#tarball', ''));
      for (const f of FILES) {
        process.stdout.write('  ↓ ' + f + ' … ');
        await download(`${base}/${f}`, path.join(MODEL_DIR, f));
        const size = fs.statSync(path.join(MODEL_DIR, f)).size;
        if (size < 1024) throw new Error('文件过小，疑似下载失败');
        console.log((size / 1048576).toFixed(1) + ' MB');
      }
      return true;
    } catch (e) {
      console.log('× ' + e.message);
      console.log('  换一个下载源重试…');
    }
  }
  return false;
}

/** GitHub Release 的 tar.bz2 需要本地解压（Windows 自带 tar / bsdtar，mac/Linux 有 tar） */
async function fetchTarball(url) {
  const tmp = path.join(MODEL_DIR, 'model.tar.bz2');
  process.stdout.write('  ↓ 模型压缩包 … ');
  await download(url, tmp);
  console.log((fs.statSync(tmp).size / 1048576).toFixed(1) + ' MB，解压中…');
  execFileSync('tar', ['-xjf', 'model.tar.bz2'], { cwd: MODEL_DIR, stdio: 'ignore' });
  try { fs.unlinkSync(tmp); } catch {}
  // 解压后文件在 <MODEL_NAME>/ 子目录下
  const inner = path.join(MODEL_DIR, MODEL_NAME);
  if (fs.existsSync(inner)) {
    for (const f of fs.readdirSync(inner)) {
      fs.renameSync(path.join(inner, f), path.join(MODEL_DIR, f));
    }
    fs.rmSync(inner, { recursive: true, force: true });
  }
  return FILES.every(f => fs.existsSync(path.join(MODEL_DIR, f)));
}

function installRuntime(pkg) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNTIME_DIR, 'package.json'), '{"name":"mockmirror-asr-runtime","private":true}');
  // 用 shell 执行：npm.cmd 未必在 PATH 里，交给系统 shell 解析最稳
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const registries = ['https://registry.npmmirror.com', 'https://registry.npmjs.org'];
  for (const reg of registries) {
    try {
      console.log('  使用镜像：' + reg);
      execSync(`${npm} install --registry=${reg} --no-audit --no-fund sherpa-onnx-node@${VERSION} ${pkg}@${VERSION}`,
        { cwd: RUNTIME_DIR, stdio: 'inherit', timeout: 600000 });
      return true;
    } catch (e) {
      console.log('  该镜像安装失败，换下一个…');
    }
  }
  return false;
}

async function main() {
  if (process.env.MOCKMIRROR_SKIP_ASR === '1' || process.argv.includes('--skip')) {
    console.log('[asr] 已按配置跳过本地识别引擎安装（Edge 浏览器仍可用在线识别）');
    return;
  }
  const runtimeOk = fs.existsSync(path.join(RUNTIME_DIR, 'node_modules', 'sherpa-onnx-node'));
  const modelOk = FILES.every(f => fs.existsSync(path.join(MODEL_DIR, f)));
  if (runtimeOk && modelOk) { console.log('[asr] 本地识别引擎已就绪，跳过安装'); return; }

  console.log('[asr] 首次使用：安装本地离线语音识别引擎（约 50MB，装一次即可）…');

  let ok = runtimeOk;
  if (!ok) {
    const pkg = nativePkg();
    if (!pkg) {
      console.log('[asr] 当前平台暂无预编译包（' + process.platform + '/' + process.arch + '），跳过本地引擎');
    } else {
      ok = installRuntime(pkg);
    }
  }
  let modelOkNow = modelOk;
  if (ok && !modelOkNow) {
    console.log('[asr] 下载中文识别模型…');
    modelOkNow = await fetchModels();
  }

  if (ok && modelOkNow) {
    // 自检：真能 require 才算装好
    try {
      require(path.join(RUNTIME_DIR, 'node_modules', 'sherpa-onnx-node'));
      console.log('[asr] ✔ 本地离线语音识别引擎安装完成');
    } catch (e) {
      console.log('[asr] 引擎自检未通过，将使用浏览器在线识别：' + e.message);
    }
  } else {
    console.log('[asr] 本地引擎未安装成功 —— 不影响使用：Edge 浏览器可用在线识别；' +
      'Chrome 用户如需语音作答，可联网后重新运行 npm run setup');
  }
}

main().catch(e => {
  console.log('[asr] 安装过程出错（不影响启动）：' + e.message);
});
