const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const storage = require('../services/storage');

// 对话页「+」面板沙箱：与 agent-ui 测试同构，仅需本地存储与页面方法。
function harness() {
  let page;
  const store = {};
  const toasts = [];
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ top: 32, bottom: 64, left: 279 }),
    getStorageSync: (key) => store[key] || '',
    setStorageSync: (key, value) => { store[key] = value; return true; },
    showShareMenu() {}, hideKeyboard() {},
    onKeyboardHeightChange() {}, offKeyboardHeightChange() {},
    navigateTo() {}, reLaunch() {},
    showToast: (opts) => { toasts.push((opts && opts.title) || ''); }
  };
  const script = path.resolve(__dirname, '../pages/agent/index.js');
  global.wx = wx;
  global.getApp = () => null; // storage.saveSettings 会调用 getApp，测试环境无 App 实例
  const context = {
    wx,
    Page: (definition) => { page = definition; },
    require: (name) => require(path.resolve(path.dirname(script), name)),
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), context);
  page.setData = (values) => Object.assign(page.data, values);
  page.onLoad();
  page.onShow();
  return { page, store, toasts };
}

test('panel state exposes experts, quick skills and sounds', () => {
  const { page } = harness();
  assert.equal(page.data.panelOpen, false);
  assert.equal(page.data.drawerOpen, false);
  assert.equal(page.data.expertCards.length, 1);
  assert.equal(page.data.expertCards[0].name, 'yalom');
  assert.deepEqual([...page.data.quickSkills.map((item) => item.label)], ['星夜慢行', '身体扫描', '取回心事', '停止播放']);
  assert.deepEqual([...page.data.quickSounds.map((item) => item.label)], ['雨声', '微风', '湖水', '白噪音']);
  assert.deepEqual([...page.data.lullabies.map((item) => item.title)], ['摇篮曲', '夜航钢琴', '森林低语']);
  assert.deepEqual([...page.data.channels.map((item) => item.title)], ['听书', '电台']);
  assert.deepEqual([...page.data.channels.map((item) => item.icon)], ['listen', 'radio']);
  assert.equal(page.data.activeExpert, '');
});

test('toggling the panel flips state, closes the drawer and blurs the input', () => {
  const { page } = harness();
  page.setData({ inputFocus: true, drawerOpen: true });
  page.togglePanel();
  assert.equal(page.data.panelOpen, true);
  assert.equal(page.data.drawerOpen, false);
  assert.equal(page.data.inputFocus, false);
  page.togglePanel();
  assert.equal(page.data.panelOpen, false);
});

test('drawer opens exclusively with the panel and closes on toggle', () => {
  const { page } = harness();
  page.setData({ panelOpen: true });
  page.toggleDrawer();
  assert.equal(page.data.drawerOpen, true);
  assert.equal(page.data.panelOpen, false);
  assert.equal(page.data.inputFocus, false);
  page.toggleDrawer();
  assert.equal(page.data.drawerOpen, false);
});

test('focusing the input closes both panel and drawer', () => {
  const { page } = harness();
  page.setData({ panelOpen: true, drawerOpen: true });
  page.onInputFocus();
  assert.equal(page.data.panelOpen, false);
  assert.equal(page.data.drawerOpen, false);
  assert.equal(page.data.inputFocus, true);
});

test('starting a new session resets the stream but keeps the expert', () => {
  const { page, store } = harness();
  page.openChat();
  page.applyExpert('yalom');
  page.setData({ messages: page.data.messages.concat([{ id: 'u1', role: 'user', text: '有点睡不着' }, { id: 'a1', role: 'agent', text: '我在呢' }]), drawerOpen: true });
  page.startNewSession();
  assert.equal(page.data.messages.length, 1);
  assert.equal(page.data.messages[0].role, 'agent');
  assert.equal(page.data.drawerOpen, false);
  assert.equal(page.data.activeExpert, 'yalom');
  assert.equal(page.lastTurn, null);
  assert.equal(store['sleepwell.night.preferences.v1'].expert, 'yalom');
});

test('lullaby placeholder rows answer with a toast', () => {
  const { page, toasts } = harness();
  page.tapLullaby({ currentTarget: { dataset: { title: '摇篮曲' } } });
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].includes('摇篮曲'));
  assert.ok(toasts[0].includes('很快上线'));
});

test('channel placeholder rows answer with a toast', () => {
  const { page, toasts } = harness();
  page.tapChannel({ currentTarget: { dataset: { title: '听书' } } });
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].includes('听书'));
  assert.ok(toasts[0].includes('搭建'));
});

test('choosing an expert persists the preference, offers starters, closes the drawer and announces', () => {
  const { page, store } = harness();
  page.openChat();
  page.setData({ drawerOpen: true });
  page.chooseExpert({ currentTarget: { dataset: { name: 'yalom' } } });
  assert.equal(page.data.activeExpert, 'yalom');
  assert.equal(page.data.activeExpertLabel, '亚隆');
  assert.ok(page.data.activeExpertEmblem.includes('data:image/svg'));
  assert.equal(page.data.starters.length, 3);
  assert.equal(page.data.panelOpen, false);
  assert.equal(page.data.drawerOpen, false);
  const bubble = page.data.messages[page.data.messages.length - 1];
  assert.equal(bubble.role, 'skill');
  assert.ok(bubble.text.includes('亚隆'));
  assert.equal(store['sleepwell.night.preferences.v1'].expert, 'yalom');
});

test('clearing the expert falls back to the nightcat persona', () => {
  const { page } = harness();
  page.openChat();
  page.chooseExpert({ currentTarget: { dataset: { name: 'yalom' } } });
  page.clearExpert();
  assert.equal(page.data.activeExpert, '');
  assert.equal(page.data.activeExpertEmblem, '');
  const bubble = page.data.messages[page.data.messages.length - 1];
  assert.ok(bubble.text.includes('夜喵本体'));
});

test('quick skill runs on tap, collapses the panel and reports in a bubble', () => {
  const { page } = harness();
  page.openChat();
  page.setData({ panelOpen: true });
  page.quickSkill({ currentTarget: { dataset: { key: 'recall' } } });
  assert.equal(page.data.panelOpen, false);
  const bubble = page.data.messages[page.data.messages.length - 1];
  assert.equal(bubble.role, 'skill');
  assert.ok(bubble.text.includes('寄存'));
});

test('disabled skills are filtered out of the panel', () => {
  const { page } = harness();
  const settings = storage.getSettings();
  settings.skillPermissions = Object.assign({}, settings.skillPermissions, { stop_sound: 'off', play_sound: 'off' });
  storage.saveSettings(settings);
  page.onShow();
  assert.equal(page.data.quickSkills.some((item) => item.skill === 'stop_sound'), false);
  assert.equal(page.data.quickSounds.length, 0);
});

test('tapping a starter fills the draft for editing', () => {
  const { page } = harness();
  page.openChat();
  page.applyExpert('yalom');
  page.setData({ panelOpen: true, drawerOpen: true });
  page.useStarter({ currentTarget: { dataset: { text: '想到人总会死，有点喘不过气' } } });
  assert.equal(page.data.draft, '想到人总会死，有点喘不过气');
  assert.equal(page.data.canSend, true);
  assert.equal(page.data.panelOpen, false);
  assert.equal(page.data.drawerOpen, false);
});
