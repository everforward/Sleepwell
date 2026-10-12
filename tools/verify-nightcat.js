// 夜喵页面浏览器校验：三档宽度布局检查 + 首页/对话/键盘/推荐态截图。
// 运行：NIGHTCAT_NODE_MODULES=<playwright 所在 node_modules> node tools/verify-nightcat.js
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const dependencyRoot = process.env.NIGHTCAT_NODE_MODULES || 'C:/Users/19237/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const runtimeRequire = createRequire(path.join(dependencyRoot, 'runtime.js'));
const { chromium } = runtimeRequire('playwright');
const root = path.resolve(__dirname, '..');
const accessCode = require(path.join(root, 'services/access-code'));
const BASE = process.env.NIGHTCAT_PREVIEW_URL || 'http://127.0.0.1:4180';

const MIN_TAP = 43.9;

function describe(box) {
  return box ? `top=${box.top.toFixed(1)} bottom=${box.bottom.toFixed(1)} h=${box.height.toFixed(1)}` : 'missing';
}

async function measure(page) {
  return page.evaluate((minTap) => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
    };
    const rects = (selector) => [...document.querySelectorAll(selector)].map((el) => {
      const b = el.getBoundingClientRect();
      return { label: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 20), top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
    });
    return {
      innerHeight,
      innerWidth,
      overflow: document.body.scrollWidth > innerWidth + 1,
      assets: [...document.images].every((img) => img.complete && img.naturalWidth > 0),
      composer: rect('.night-composer'),
      nav: rect('.night-nav'),
      welcome: rect('.welcome-card'),
      topics: rect('.topic-grid'),
      practice: rect('.practice-card'),
      topicChips: rects('.topic-chip'),
      guideButton: rect('.guide-button'),
      navItems: rects('.night-nav-item'),
      smallTargets: rects('.topic-chip, .guide-button, .night-composer, .night-nav-item').filter((box) => box.height < minTap),
      outsideViewport: rects('.topic-chip, .guide-button, .night-composer, .night-nav-item').filter((box) => box.left < -0.5 || box.right > innerWidth + 0.5)
    };
  }, MIN_TAP);
}

function assertBox(label, box, viewportWidth) {
  if (!box) throw new Error(`${label} missing`);
  if (box.left < -0.5 || box.right > viewportWidth + 0.5) throw new Error(`${label} outside viewport: left=${box.left} right=${box.right}`);
  return box;
}

// 预览器每次 setData 都会重建 DOM，入场动画随之重播；测量前先等动画停稳。
async function settle(page, selector) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const transform = getComputedStyle(el).transform;
    return transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
  }, selector, { timeout: 5000 });
  await page.waitForTimeout(60);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.NIGHTCAT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => { errors.push(error.message); console.error('Browser error:', error.message); });
    const checks = [];

    // 每次校验从干净的本地存储开始，保证验证码门禁一定出现。
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());

    for (const [width, height] of [[320, 640], [375, 812], [430, 932]]) {
      await page.setViewportSize({ width, height });
      await page.goto(BASE);
      await page.locator('.night-composer').waitFor();
      await page.waitForTimeout(700); // 入场动画结束后的静帧
      const check = await measure(page);
      checks.push({ width, height, ...check });
      console.log('Home', width, JSON.stringify({ overflow: check.overflow, assets: check.assets, composer: describe(check.composer), nav: describe(check.nav) }));
      if (check.overflow) throw new Error(`Horizontal overflow at ${width}`);
      if (!check.assets) throw new Error(`Broken image asset at ${width}`);
      if (check.smallTargets.length) throw new Error(`Tap target under ${MIN_TAP}px at ${width}: ${JSON.stringify(check.smallTargets)}`);
      if (check.outsideViewport.length) throw new Error(`Button outside viewport at ${width}: ${JSON.stringify(check.outsideViewport)}`);
      const composer = assertBox('composer', check.composer, width);
      const nav = assertBox('nav', check.nav, width);
      // 输入条必须停靠在底部导航之上，导航必须贴住视口底部。
      if (composer.bottom > nav.top + 1) throw new Error(`Composer not docked above nav at ${width}: composer bottom ${composer.bottom} > nav top ${nav.top}`);
      if (nav.bottom > check.innerHeight + 1 || nav.bottom < check.innerHeight - 1) throw new Error(`Nav not pinned to viewport bottom at ${width}: ${nav.bottom} vs ${check.innerHeight}`);
      // 首屏完整：问候语 / 话题 / 练习卡都在视口内，输入条以下为零。
      const welcome = assertBox('welcome', check.welcome, width);
      const topics = assertBox('topics', check.topics, width);
      const practice = assertBox('practice', check.practice, width);
      if (welcome.top < 0) throw new Error(`Welcome card above fold at ${width}`);
      if (topics.bottom > composer.top + 1) throw new Error(`Topic grid pushed under composer at ${width}`);
      if (practice.bottom > composer.top + 1) throw new Error(`Practice card pushed under composer at ${width}`);
      await page.screenshot({ path: path.join(root, `docs/design/preview-${width}.png`) });
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await page.locator('.night-composer').waitFor();
    console.log('Opening chat from composer');
    await page.getByRole('button', { name: '和夜喵说说今晚的心情' }).click();
    await page.locator('.chat-screen').waitFor();
    await settle(page, '.chat-screen');
    const chatBox = await page.locator('.chat-screen').boundingBox();
    if (Math.abs(chatBox.y) > 0.5) throw new Error(`Chat screen not pinned to top: ${chatBox.y}`);
    const inputRow = await page.locator('.chat-input-row').boundingBox();
    if (inputRow.y + inputRow.height < 810 || inputRow.y + inputRow.height > 814) throw new Error(`Input row not at viewport bottom: ${inputRow.y + inputRow.height}`);
    if (await page.locator('.night-nav').isVisible()) throw new Error('Bottom nav should be hidden inside chat');

    // 验证码门禁：首次进入对话应被锁住，输错有提示，输对解锁后才可发送。
    await page.locator('.chat-gate').waitFor();
    await page.screenshot({ path: path.join(root, 'docs/design/preview-gate.png') });
    const gateLocked = await page.evaluate(() => window.previewPage.data.aiLocked);
    if (!gateLocked) throw new Error('Chat should start locked before the code is entered');
    await page.locator('.chat-gate-input').fill('not-the-code');
    await page.getByRole('button', { name: '确认' }).click();
    await page.locator('.chat-gate-error').waitFor();
    if (!(await page.evaluate(() => window.previewPage.data.aiLocked))) throw new Error('Wrong code should keep the chat locked');
    await page.locator('.chat-gate-input').fill(accessCode.required());
    await page.getByRole('button', { name: '确认' }).click();
    await page.locator('.chat-gate').waitFor({ state: 'detached' });
    const gate = { lockedOnEntry: true, wrongCodeRejected: true, code: 'configured' };
    console.log('Gate', JSON.stringify(gate));

    await page.locator('.chat-input').fill('今晚脑子停不下来，我想先慢慢听点雨声');
    await page.getByRole('button', { name: '发送' }).click();
    await page.locator('.chat-end-chip').waitFor();
    await page.waitForTimeout(300);
    const convo = await page.evaluate(() => ({
      user: document.querySelectorAll('.chat-message--user').length,
      agent: document.querySelectorAll('.chat-message--agent').length,
      bubbles: [...document.querySelectorAll('.chat-bubble')].map((el) => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 40))
    }));
    console.log('Conversation', JSON.stringify(convo));
    if (convo.user !== 1 || convo.agent < 2) throw new Error('Conversation bubbles missing');
    await page.screenshot({ path: path.join(root, 'docs/design/preview-chat.png') });

    await page.evaluate(() => window.previewPage.setData({ chatState: 'error' }));
    await page.locator('.chat-error').waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(root, 'docs/design/preview-chat-error.png') });
    await page.getByRole('button', { name: '重试' }).click();
    await page.waitForTimeout(200);
    if (await page.locator('.chat-error').count()) throw new Error('Retry did not clear the error state');

    await page.evaluate(() => window.previewPage.setData({
      recommendation: { sound: 'rain', minutes: 30, title: '雨声 · 慢慢来', detail: '30 分钟定时 · 自然环境声' },
      homeState: 'recommendation'
    }));
    await page.locator('.agent-recommendation').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(root, 'docs/design/preview-recommendation.png') });

    await page.evaluate(() => window.keyboardListener({ height: 300 }));
    await page.waitForTimeout(360);
    await settle(page, '.chat-screen');
    const keyboardRow = await page.locator('.chat-input-row').boundingBox();
    if (keyboardRow.y + keyboardRow.height > 812 - 300 + 2) throw new Error(`Input row overlaps keyboard: bottom=${keyboardRow.y + keyboardRow.height}`);
    console.log('Keyboard check', JSON.stringify({ bottom: keyboardRow.y + keyboardRow.height }));
    await page.screenshot({ path: path.join(root, 'docs/design/preview-keyboard.png') });
    await page.evaluate(() => window.keyboardListener({ height: 0 }));

    await page.getByRole('button', { name: '返回夜喵首页' }).click();
    await page.locator('.night-composer').waitFor();
    const backHome = await page.locator('.chat-screen').count();
    if (backHome) throw new Error('Chat screen should be removed after closing the conversation');

    // 二级页扫查：无脚本错误、无横向溢出、资源完整、主要触控 ≥ 44px、关键状态截图。
    const secondary = [
      ['/record', 'preview-record.png', '.record-nav button, .month-arrow, .month-current, .all-button, .journal-entry, .journal-row, .more-button, .edit-button'],
      ['/night-settings', 'preview-night-settings.png', '.ns-row, .ns-back, .ns-memory-actions button'],
      ['/night-memory', 'preview-night-memory.png', '.nm-clear, .ns-back'],
      ['/sound', 'preview-sound.png', '.sound-row, .play-button, .timer-options button, .icon-button--back'],
      ['/journal', 'preview-journal.png', '.primary-button, .icon-button--back'],
      ['/sleep', 'preview-sleep.png', '.feeling-button, .primary-button, .time-field, .icon-button--back'],
      ['/focus', 'preview-focus.png', '.primary-button, .icon-button--back']
    ];
    const secondaryReports = {};
    for (const [route, shot, tapSelector] of secondary) {
      const perWidth = [];
      for (const width of [320, 375]) {
        await page.setViewportSize({ width, height: width === 320 ? 640 : 812 });
        await page.goto(BASE + route);
        await page.waitForTimeout(700); // 入场动画结束后的静帧
        const report = await page.evaluate(({ selector, minTap }) => {
          const rects = [...document.querySelectorAll(selector)].map((el) => {
            const b = el.getBoundingClientRect();
            return { label: (el.innerText || el.className || '').replace(/\s+/g, ' ').trim().slice(0, 24), left: b.left, right: b.right, height: b.height };
          });
          return {
            overflow: document.body.scrollWidth > innerWidth + 1,
            assets: [...document.images].every((img) => img.complete && img.naturalWidth > 0),
            outside: rects.filter((box) => box.left < -0.5 || box.right > innerWidth + 0.5),
            small: rects.filter((box) => box.height < minTap)
          };
        }, { selector: tapSelector, minTap: MIN_TAP });
        perWidth.push({ width, overflow: report.overflow, assets: report.assets, small: report.small, outside: report.outside });
        console.log('Secondary', route, width, JSON.stringify({ overflow: report.overflow, assets: report.assets, small: report.small, outside: report.outside }));
        if (report.overflow) throw new Error(`Horizontal overflow at ${route} @${width}`);
        if (!report.assets) throw new Error(`Broken image asset at ${route} @${width}`);
        if (report.small.length) throw new Error(`Tap target under ${MIN_TAP}px at ${route} @${width}: ${JSON.stringify(report.small)}`);
        if (report.outside.length) throw new Error(`Control outside viewport at ${route} @${width}: ${JSON.stringify(report.outside)}`);
        if (width === 375) await page.screenshot({ path: path.join(root, 'docs/design/' + shot) });
      }
      secondaryReports[route] = perWidth;
    }

    if (errors.length) throw new Error(errors.join('\n'));
    fs.writeFileSync(path.join(root, 'docs/design/browser-checks.json'), JSON.stringify({ checks, convo, gate, keyboardRow, secondary: secondaryReports, errors }, null, 2));
    console.log('Browser verification passed');
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
