/* 开场只提问一次；播放、停顿使用同一头像；首次音色加载和旧偏好不能切换形象。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');
const base = process.env.MOCKMIRROR_URL || 'http://127.0.0.1:3000';

(async () => {
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/llm.js'), 'utf8'), {
    module: mod, __dirname: path.join(__dirname, '../lib'), console,
    require(name) {
      if (name === 'fs') return { readFileSync: () => '{"engine":"offline"}' };
      if (name === './bank') return { getBank: () => ({ name: '后端开发' }) };
      if (name === './rag' || name === './agentClient') return {};
      return require(name);
    }
  });
  const question = '你为什么选择后端开发这个方向？未来 3 年的职业规划是什么？';
  const fallback = await mod.exports.interviewerGreeting('java-backend', { text: question }, 3);
  assert.equal(fallback.split(question).length - 1, 1);
  console.log('PASS 离线兜底开场包含完整首题，且只出现一次');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => route.fulfill({ json:
      route.request().url().endsWith('/ai-config') ? { configured: true, engine: 'llm', hasKey: true } : { available: false }
    }));
    await page.addInitScript(() => {
      localStorage.setItem('mm.tts.voice', 'male');
      const initial = [{ name: 'Microsoft Kangkang', lang: 'zh-CN' }];
      window.testSpeech = { voices: initial, spoken: [] };
      Object.defineProperty(window, 'speechSynthesis', { value: {
        getVoices: () => testSpeech.voices,
        speak: u => testSpeech.spoken.push({ text: u.text, voice: u.voice?.name }),
        cancel() {}, resume() {}
      }});
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    });
    await page.goto(base);
    const greeting = '你好，欢迎参加今天的面试，咱们就当平常聊天，别太紧张。那先聊聊你自己吧，你为什么选择后端开发这个方向，还有未来三年你有什么样的职业规划？';
    await page.evaluate(({ greeting, question }) => {
      state.user = { name: '开场回归' };
      state.positions = [];
      state.posId = 'java-backend';
      state.session = { id: 'iv_opening_test', mode: 'voice', currentQ: { index: 0 } };
      pending = { greeting, question: { text: question }, planSize: 3 };
      document.getElementById('auto-mic').checked = false;
      go('interview');
      joinMeeting();
    }, { greeting, question });
    assert.equal(await page.locator('.msg.ai .bubble').textContent(), greeting);
    assert.equal(await page.locator('#iv-video').count(), 0);
    assert(await page.locator('#iv-photo-img').isVisible());
    assert.equal(await page.evaluate(() => testSpeech.spoken.length), 0);
    await page.evaluate(() => { testSpeech.voices.push({ name: 'Microsoft Huihui', lang: 'zh-CN' }); });
    await page.waitForFunction(() => testSpeech.spoken.length > 0);
    assert.equal(await page.evaluate(() => testSpeech.spoken[0].voice), 'Microsoft Huihui');
    assert(await page.locator('#iv-photo-img').isVisible());
    await page.evaluate(() => {
      interruptInterviewer();
      testSpeech.voices.unshift({ name: 'Microsoft Xiaoxiao', lang: 'zh-CN' });
      speakText('我们继续下一题。');
    });
    assert.equal(await page.evaluate(() => testSpeech.spoken.at(-1).voice), 'Microsoft Huihui');
    assert(await page.locator('#iv-photo-img').isVisible());
    assert.equal(await page.evaluate(() => localStorage.getItem('mm.tts.voice')), null);
    await page.evaluate(() => { state.session = null; cleanupMeeting(); });
    assert.deepEqual(errors, []);
    console.log('PASS 开场显示和朗读不追加重复题干；首句等待音色加载；整场保持同一音色和头像；旧偏好已清除');
  } finally { await browser.close(); }
  for (const file of ['interviewer-talk.mp4', 'interviewer-male-backup.png']) {
    assert.equal(fs.existsSync(path.join(__dirname, '../public/assets', file)), false);
  }
  console.log('PASS 旧视频与备用模板已从项目删除');
})().catch(e => { console.error(e); process.exitCode = 1; });
