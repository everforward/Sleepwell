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
      smallTargets: rects('.topic-chip, .practice-main, .guide-button, .night-composer, .night-nav-item').filter((box) => box.height < minTap),
      outsideViewport: rects('.topic-chip, .practice-main, .guide-button, .night-composer, .night-nav-item').filter((box) => box.left < -0.5 || box.right > innerWidth + 0.5)
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

    // 练习卡：默认收缩（引导按钮被裁切不可点），点按整行丝滑展开，再点收起。
    const collapsedCard = await page.locator('.practice-card').boundingBox();
    const collapsedClipped = await page.evaluate(() => {
      const extra = document.querySelector('.practice-extra').getBoundingClientRect();
      const guide = document.querySelector('.guide-button').getBoundingClientRect();
      return extra.height < 1 && guide.top >= extra.bottom - 1;
    });
    if (!collapsedClipped) throw new Error('Practice card should start collapsed with the guide button clipped away');
    await page.locator('.practice-main').click();
    await page.locator('.practice-card.is-open').waitFor();
    await page.waitForTimeout(420);
    const expandedCard = await page.locator('.practice-card').boundingBox();
    const expandedGuide = await page.locator('.guide-button').boundingBox();
    const composerBox = await page.locator('.night-composer').boundingBox();
    await page.screenshot({ path: path.join(root, 'docs/design/preview-practice-open.png') });
    const practice = { collapsed: +collapsedCard.height.toFixed(1), expanded: +expandedCard.height.toFixed(1), guide: +expandedGuide.height.toFixed(1) };
    console.log('Practice', JSON.stringify(practice));
    if (expandedCard.height - collapsedCard.height < 30) throw new Error(`Practice card did not expand: ${collapsedCard.height} -> ${expandedCard.height}`);
    if (expandedGuide.height < MIN_TAP) throw new Error(`Guide button under ${MIN_TAP}px when expanded: ${expandedGuide.height}`);
    if (expandedCard.y + expandedCard.height > composerBox.y + 0.5) throw new Error('Expanded practice card overlaps the composer');
    await page.locator('.practice-main').click();
    await page.waitForTimeout(420);
    const recollapsedCard = await page.locator('.practice-card').boundingBox();
    if (await page.locator('.practice-card.is-open').count()) throw new Error('is-open class should be removed after collapsing');
    if (Math.abs(recollapsedCard.height - collapsedCard.height) > 1) throw new Error(`Practice card did not collapse back: ${recollapsedCard.height} vs ${collapsedCard.height}`);

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

    // 「+」面板：瘦身后的直执区（助眠练习 + 助眠声），贴底、可点、可直接执行。
    await page.locator('.chat-plus').click();
    await page.locator('.chat-panel.is-open').waitFor();
    await settle(page, '.panel-inner');
    await page.waitForTimeout(380);
    const panelBox = await page.locator('.chat-panel').boundingBox();
    const streamBox = await page.locator('.chat-stream').boundingBox();
    const panelCounts = await page.evaluate(() => ({
      titles: document.querySelectorAll('.chat-panel .panel-title').length,
      experts: document.querySelectorAll('.chat-panel .expert-card, .chat-panel .expert-item').length,
      skills: document.querySelectorAll('.quick-item').length,
      sounds: document.querySelectorAll('.sound-chip').length
    }));
    const panelTaps = await page.evaluate((selectors) => selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((el) => {
      const label = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12);
      return { selector, label, height: +el.getBoundingClientRect().height.toFixed(1) };
    })), ['.chat-plus', '.chat-panel .quick-item', '.chat-panel .sound-chip']);
    const panelSmall = panelTaps.filter((box) => box.height < MIN_TAP);
    await page.screenshot({ path: path.join(root, 'docs/design/preview-chat-panel.png') });
    const panel = { titles: panelCounts.titles, experts: panelCounts.experts, skills: panelCounts.skills, sounds: panelCounts.sounds, height: +panelBox.height.toFixed(1), streamHeight: +streamBox.height.toFixed(1), bottom: +(panelBox.y + panelBox.height).toFixed(1) };
    console.log('Panel', JSON.stringify(panel));
    if (panelCounts.titles !== 2) throw new Error(`Slim panel should keep exactly 2 sections: ${panelCounts.titles}`);
    if (panelCounts.experts !== 0) throw new Error(`Expert cards should live in the drawer, not the panel: ${panelCounts.experts}`);
    if (panelCounts.skills !== 4) throw new Error(`Quick skill count unexpected: ${panelCounts.skills}`);
    if (panelCounts.sounds !== 4) throw new Error(`Quick sound count unexpected: ${panelCounts.sounds}`);
    if (panelBox.height > 240) throw new Error(`Panel still too tall after slim-down: ${panelBox.height}`);
    if (panelSmall.length) throw new Error(`Panel tap target under ${MIN_TAP}px: ${JSON.stringify(panelSmall)}`);
    if (streamBox.height < 40) throw new Error(`Chat stream squeezed by panel: ${streamBox.height}`);
    if (Math.abs(panelBox.y + panelBox.height - 812) > 1) throw new Error(`Panel not pinned to viewport bottom: ${panelBox.y + panelBox.height}`);

    // 面板直执：点「雨声」应真正播放（技能反馈气泡），面板随即收起。
    await page.locator('.sound-chip', { hasText: '雨声' }).click();
    await page.waitForTimeout(360);
    const soundText = (await page.locator('.skill-feedback-text').last().innerText()).replace(/\s+/g, ' ').trim();
    if (!soundText.includes('已为你播放雨声')) throw new Error(`Sound quick action did not execute: ${soundText}`);
    if (await page.locator('.chat-panel.is-open').count()) throw new Error('Panel should close after a quick action');

    // 右侧抽屉：专家详版 + 工具（新对话 / 对话设置）+ 安眠曲占位；贴右、全高、触控达标。
    await page.locator('.chat-more').click();
    await page.locator('.drawer.is-open').waitFor();
    await settle(page, '.drawer');
    await page.waitForTimeout(380);
    const drawerBox = await page.locator('.drawer').boundingBox();
    const drawerCounts = await page.evaluate(() => ({
      experts: document.querySelectorAll('.drawer .expert-item').length,
      actions: document.querySelectorAll('.drawer .drawer-action').length,
      lullabies: document.querySelectorAll('.drawer .lullaby-item').length,
      badges: document.querySelectorAll('.drawer .lullaby-badge').length,
      channels: document.querySelectorAll('.drawer .channel-item').length,
      chevrons: document.querySelectorAll('.drawer .channel-chevron').length,
      tags: document.querySelectorAll('.drawer .expert-item-tag').length
    }));
    const drawerTaps = await page.evaluate((selectors) => selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((el) => {
      const label = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12);
      return { selector, label, height: +el.getBoundingClientRect().height.toFixed(1) };
    })), ['.chat-more', '.drawer-close', '.drawer .expert-item', '.drawer .drawer-action', '.drawer .lullaby-item', '.drawer .channel-item']);
    const drawerSmall = drawerTaps.filter((box) => box.height < MIN_TAP);
    await page.screenshot({ path: path.join(root, 'docs/design/preview-chat-drawer.png') });
    const drawer = { experts: drawerCounts.experts, actions: drawerCounts.actions, lullabies: drawerCounts.lullabies, channels: drawerCounts.channels, badges: drawerCounts.badges, chevrons: drawerCounts.chevrons, tags: drawerCounts.tags, width: +drawerBox.width.toFixed(1), right: +(drawerBox.x + drawerBox.width).toFixed(1) };
    console.log('Drawer', JSON.stringify(drawer));
    if (drawerCounts.experts !== 2) throw new Error(`Drawer expert rows unexpected: ${drawerCounts.experts}`);
    if (drawerCounts.actions !== 2) throw new Error(`Drawer tool rows unexpected: ${drawerCounts.actions}`);
    if (drawerCounts.lullabies !== 3) throw new Error(`Lullaby placeholders unexpected: ${drawerCounts.lullabies}`);
    if (drawerCounts.badges !== 3) throw new Error(`Lullaby badges missing: ${drawerCounts.badges}`);
    if (drawerCounts.channels !== 2) throw new Error(`Future channel rows unexpected: ${drawerCounts.channels}`);
    if (drawerCounts.chevrons !== 2) throw new Error(`Channel jump chevrons missing: ${drawerCounts.chevrons}`);
    if (drawerCounts.tags !== 1) throw new Error(`Active expert tag count unexpected: ${drawerCounts.tags}`);
    if (drawerSmall.length) throw new Error(`Drawer tap target under ${MIN_TAP}px: ${JSON.stringify(drawerSmall)}`);
    if (Math.abs(drawerBox.x + drawerBox.width - 375) > 1) throw new Error(`Drawer not pinned to the right edge: ${drawerBox.x + drawerBox.width}`);
    if (Math.abs(drawerBox.y) > 0.5 || Math.abs(drawerBox.y + drawerBox.height - 812) > 1) throw new Error(`Drawer not full height: top=${drawerBox.y} bottom=${drawerBox.y + drawerBox.height}`);
    if (drawerBox.width > 320) throw new Error(`Drawer should be a side sheet, got ${drawerBox.width}px wide`);

    // 安眠曲占位：点按只回「即将上线」提示，抽屉保持展开。
    await page.locator('.drawer .lullaby-item').first().click();
    await page.waitForTimeout(240);
    const lullabyToast = await page.evaluate(() => window.lastToast || '');
    if (!lullabyToast.includes('很快上线')) throw new Error(`Lullaby placeholder toast missing: ${lullabyToast}`);
    if (!(await page.locator('.drawer.is-open').count())) throw new Error('Drawer should stay open after a lullaby tap');

    // 深夜频道占位（听书 / 电台）：点按回「正在搭建」提示，抽屉保持展开。
    await page.locator('.drawer .channel-item').first().click();
    await page.waitForTimeout(240);
    const channelToast = await page.evaluate(() => window.lastToast || '');
    if (!channelToast.includes('搭建')) throw new Error(`Channel placeholder toast missing: ${channelToast}`);
    if (!(await page.locator('.drawer.is-open').count())) throw new Error('Drawer should stay open after a channel tap');

    // 新对话：清空当前屏、从新的问候开始，抽屉随之收起。
    await page.locator('.drawer-action', { hasText: '新对话' }).click();
    await page.waitForFunction(() => !document.querySelector('.drawer.is-open'));
    const fresh = await page.evaluate(() => ({
      user: document.querySelectorAll('.chat-message--user').length,
      agent: document.querySelectorAll('.chat-message--agent').length
    }));
    if (fresh.user !== 0 || fresh.agent !== 1) throw new Error(`New session did not reset the stream: ${JSON.stringify(fresh)}`);

    // 咨询师视角：抽屉里选亚隆 → 胶囊出现、偏好落盘、确认气泡、抽屉收起。
    await page.locator('.chat-more').click();
    await page.locator('.drawer.is-open').waitFor();
    await page.waitForTimeout(380);
    await page.locator('.drawer .expert-item', { hasText: '亚隆' }).click();
    await page.waitForFunction(() => !document.querySelector('.drawer.is-open'));
    await page.locator('.expert-chip').waitFor();
    await page.waitForTimeout(240);
    const chipBox = await page.locator('.expert-chip').boundingBox();
    if (chipBox.height < MIN_TAP) throw new Error(`Expert chip under ${MIN_TAP}px: ${chipBox.height}`);
    const expertText = (await page.locator('.skill-feedback-text').last().innerText()).replace(/\s+/g, ' ').trim();
    if (!expertText.includes('亚隆')) throw new Error(`Expert confirmation bubble missing: ${expertText}`);
    const savedExpert = await page.evaluate(() => { try { return (JSON.parse(localStorage.getItem('sleepwell.night.preferences.v1') || '{}').expert) || ''; } catch (error) { return ''; } });
    if (savedExpert !== 'yalom') throw new Error(`Expert preference not persisted: ${savedExpert}`);
    await page.screenshot({ path: path.join(root, 'docs/design/preview-chat-expert.png') });

    // 开场句位于抽屉：选中专家后出现，点按填入输入框并收起抽屉。
    await page.locator('.chat-more').click();
    await page.locator('.drawer.is-open').waitFor();
    await settle(page, '.drawer');
    await page.waitForTimeout(380);
    const starterCount = await page.locator('.drawer .starter-chip').count();
    if (starterCount !== 3) throw new Error(`Expert starters missing: ${starterCount}`);
    const starterBox = await page.locator('.drawer .starter-chip').first().boundingBox();
    if (starterBox.height < MIN_TAP) throw new Error(`Starter chip under ${MIN_TAP}px: ${starterBox.height}`);
    await page.screenshot({ path: path.join(root, 'docs/design/preview-chat-drawer-starters.png') });
    await page.locator('.drawer .starter-chip').first().click();
    await page.waitForFunction(() => !document.querySelector('.drawer.is-open'));
    await page.waitForTimeout(240);
    const draftValue = await page.locator('.chat-input').inputValue();
    if (!draftValue.trim()) throw new Error('Starter did not fill the draft');
    await page.locator('.chat-input').fill('');

    await page.locator('.expert-chip').click();
    await page.locator('.expert-chip').waitFor({ state: 'detached' });
    const clearedExpert = await page.evaluate(() => { try { return (JSON.parse(localStorage.getItem('sleepwell.night.preferences.v1') || '{}').expert) || ''; } catch (error) { return ''; } });
    if (clearedExpert !== '') throw new Error(`Expert preference not cleared: ${clearedExpert}`);
    const clearedText = (await page.locator('.skill-feedback-text').last().innerText()).replace(/\s+/g, ' ').trim();
    if (!clearedText.includes('夜喵本体')) throw new Error(`Expert clear bubble missing: ${clearedText}`);

    // 抽屉两种收起：右上 × 与点按遮罩空白区。
    await page.locator('.chat-more').click();
    await page.locator('.drawer.is-open').waitFor();
    await page.waitForTimeout(380);
    await page.locator('.drawer-close').click();
    await page.waitForFunction(() => !document.querySelector('.drawer.is-open'));
    await page.locator('.chat-more').click();
    await page.locator('.drawer.is-open').waitFor();
    await page.waitForTimeout(380);
    await page.locator('.drawer-mask').click({ position: { x: 30, y: 400 } });
    await page.waitForFunction(() => !document.querySelector('.drawer.is-open'));
    const expert = { selected: 'yalom', starters: starterCount, cleared: true, lullabyToast: true, channelToast: true, newSession: true, xClose: true, maskClose: true };
    console.log('Expert', JSON.stringify(expert));

    await page.locator('.chat-input').fill('今晚脑子停不下来，我想先慢慢听点雨声');
    await page.waitForTimeout(240);
    await page.screenshot({ path: path.join(root, 'docs/design/preview-chat-send-ready.png') });
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
      ['/focus', 'preview-focus.png', '.primary-button, .icon-button--back, .focus-back']
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
    fs.writeFileSync(path.join(root, 'docs/design/browser-checks.json'), JSON.stringify({ checks, convo, gate, panel, drawer, expert, practice, keyboardRow, secondary: secondaryReports, errors }, null, 2));
    console.log('Browser verification passed');
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
