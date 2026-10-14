const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const storage = require('../services/storage');
const agentPush = require('../services/agent-push');
const agentClient = require('../services/agent-client');

// —— 纯函数：卡片净化与目录解析 ——

test('sanitizePush assembles catalog cards and drops unknown entries', () => {
  const cards = agentPush.sanitizePush([
    { kind: 'book', id: 'brave' },
    { kind: 'sound', sound: 'white', minutes: 15 },
    { kind: 'feature', id: 'park' },
    { kind: 'book', id: 'not-a-book' },
    { kind: 'movie', id: 'x' },
    null,
    'oops'
  ]);
  assert.equal(cards.length, 3);
  assert.equal(cards[0].kind, 'book');
  assert.equal(cards[0].title, '被讨厌的勇气');
  assert.equal(cards[0].cover, '/assets/books/brave.jpg');
  assert.equal(cards[0].actionLabel, '开始学习');
  assert.equal(cards[1].kind, 'sound');
  assert.equal(cards[1].minutes, 15);
  assert.ok(cards[1].detail.indexOf('15 分钟') === 0);
  assert.equal(cards[2].kind, 'feature');
  assert.ok(cards[2].cover.indexOf('data:image/svg') === 0);
  assert.equal(agentPush.sanitizePush('nope'), null);
  assert.equal(agentPush.sanitizePush([{ kind: 'book', id: 'zzz' }]), null);
  const capped = agentPush.sanitizePush([
    { kind: 'book', id: 'brave' },
    { kind: 'book', id: 'frog' },
    { kind: 'book', id: 'beyond' },
    { kind: 'feature', id: 'park' }
  ]);
  assert.equal(capped.length, 3);
});

test('sanitizeAsk clamps question and options, rejects unusable inputs', () => {
  const ask = agentPush.sanitizeAsk({ question: ' 今晚想先做点什么？ ', options: ['聊聊天', '聊聊天', '', '听声音', '直接睡', '第五个', '第六个'] });
  assert.equal(ask.question, '今晚想先做点什么？');
  assert.deepEqual(ask.options, ['聊聊天', '听声音', '直接睡', '第五个']);
  assert.equal(agentPush.sanitizeAsk({ question: '', options: ['a', 'b'] }), null);
  assert.equal(agentPush.sanitizeAsk({ question: '只给一个选项？', options: ['a'] }), null);
  assert.equal(agentPush.sanitizeAsk(null), null);
});

test('resolveCardAction only resolves catalog entries and copies args', () => {
  assert.deepEqual(agentPush.resolveCardAction({ kind: 'sound', sound: 'lake', minutes: 15 }), {
    type: 'skill',
    call: { skill: 'play_sound', args: { sound: 'lake', minutes: 15 } }
  });
  assert.deepEqual(agentPush.resolveCardAction({ kind: 'book', id: 'frog' }), {
    type: 'say',
    text: '我想学《蛤蟆先生去看心理医生》里的「情绪觉察」'
  });
  assert.deepEqual(agentPush.resolveCardAction({ kind: 'feature', id: 'park' }), {
    type: 'skill',
    call: { skill: 'park_thoughts', args: { action: 'recall' } }
  });
  assert.deepEqual(agentPush.resolveCardAction({ kind: 'feature', id: 'journal' }), {
    type: 'say',
    text: '我想记下今晚的一件温暖小事'
  });
  assert.equal(agentPush.resolveCardAction({ kind: 'book', id: 'elsewhere' }), null);
  assert.equal(agentPush.resolveCardAction({ kind: 'sound', sound: 'disco' }), null);
  const first = agentPush.resolveCardAction({ kind: 'feature', id: 'park' });
  first.call.args.action = 'hacked';
  assert.deepEqual(agentPush.resolveCardAction({ kind: 'feature', id: 'park' }).call.args, { action: 'recall' });
});

test('prompt section lists only permitted features and sounds', () => {
  const store = {};
  global.wx = { getStorageSync: (key) => store[key] || '', setStorageSync: (key, value) => { store[key] = value; return true; } };
  global.getApp = () => null;
  try {
    const settings = storage.getSettings();
    settings.skillPermissions = Object.assign({}, settings.skillPermissions, { play_sound: 'off', park_thoughts: 'off' });
    storage.saveSettings(settings);
    const section = agentPush.buildPromptSection();
    assert.ok(section.indexOf(agentPush.PUSH_MARKER) !== -1);
    assert.ok(section.indexOf(agentPush.ASK_MARKER) !== -1);
    assert.ok(section.indexOf('brave') !== -1);
    assert.equal(section.indexOf('park：'), -1);
    assert.equal(section.indexOf('kind 为 "sound"'), -1);
    assert.ok(section.indexOf('guide：') !== -1);
    assert.ok(section.indexOf('journal：') !== -1);
  } finally {
    delete global.wx;
    delete global.getApp;
  }
});

// —— 标记解析：@@PUSH@@ / @@ASK@@ 与既有标记共存 ——

test('splitResponse extracts push cards and hides partial arrays while streaming', () => {
  const full = agentClient.splitResponse('这两本都很适合今晚。\n@@PUSH@@[{"kind":"book","id":"brave"},{"kind":"sound","sound":"white","minutes":30}]');
  assert.equal(full.text, '这两本都很适合今晚。');
  assert.equal(full.recommendation, null);
  assert.equal(full.push.length, 2);
  assert.equal(full.push[0].id, 'brave');
  assert.equal(full.push[1].id, 'white');
  assert.equal(full.ask, null);
  const partial = agentClient.splitResponse('慢慢来。\n@@PUSH@@[{"kind":"book","id":"br');
  assert.equal(partial.text, '慢慢来。');
  assert.equal(partial.push, null);
});

test('splitResponse extracts the ask payload and honours marker precedence', () => {
  const ask = agentClient.splitResponse('要不要先从轻的开始？\n@@ASK@@{"question":"想先从哪件开始？","options":["聊聊心事","听点声音"]}');
  assert.equal(ask.text, '要不要先从轻的开始？');
  assert.deepEqual(ask.ask.options, ['聊聊心事', '听点声音']);
  const recFirst = agentClient.splitResponse('好。\n@@REC@@{"sound":"rain","minutes":30}\n@@PUSH@@[{"kind":"book","id":"brave"}]');
  assert.equal(recFirst.recommendation.sound, 'rain');
  assert.equal(recFirst.push, null);
  const pushFirst = agentClient.splitResponse('好。\n@@PUSH@@[{"kind":"feature","id":"park"}]\n@@ASK@@{"question":"先聊还是先睡？","options":["聊聊","先睡"]}');
  assert.equal(pushFirst.push[0].id, 'park');
  assert.equal(pushFirst.ask, null);
});

// —— 页面沙箱：卡片挂载、点卡执行、选项作答 ——

function harness() {
  let page;
  const store = {};
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ top: 32, bottom: 64, left: 279 }),
    getStorageSync: (key) => store[key] || '',
    setStorageSync: (key, value) => { store[key] = value; return true; },
    showShareMenu() {}, hideKeyboard() {}, showToast() {},
    onKeyboardHeightChange() {}, offKeyboardHeightChange() {},
    navigateTo() {}, reLaunch() {}
  };
  const script = path.resolve(__dirname, '../pages/agent/index.js');
  global.wx = wx;
  global.getApp = () => null;
  const fake = { captured: null };
  const context = {
    wx,
    Page: (definition) => { page = definition; },
    require: (name) => {
      if (name === '../../services/agent-client') {
        // 网络层替身：只捕获请求选项，由测试手动把完整输出喂回 onComplete。
        return { chat(options) { fake.captured = options; return { abort() {} }; } };
      }
      return require(path.resolve(path.dirname(script), name));
    },
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), context);
  page.setData = (values) => Object.assign(page.data, values);
  page.onLoad();
  page.onShow();
  page.setData({ aiLocked: false }); // 本地 secrets 配了验证码，测试沙箱直接跳过门禁
  const complete = (text) => {
    const result = agentClient.splitResponse(text);
    fake.captured.onComplete(Object.assign({ fallback: false }, result));
  };
  const startChat = (text) => {
    page.openChat();
    page.onDraftChange({ detail: { value: text } });
    page.sendMessage();
  };
  return { page, fake, complete, startChat };
}

test('completed reply carries push cards that execute through the catalog', () => {
  const { page, fake, complete, startChat } = harness();
  startChat('最近状态不太好');
  assert.ok(fake.captured, 'chat request should be issued');
  complete('这两本都很适合晚上读。\n@@PUSH@@[{"kind":"book","id":"brave"},{"kind":"feature","id":"park"}]');
  const agentMsg = page.data.messages.find((item) => item.id === 'agent-1');
  assert.equal(agentMsg.done, true);
  assert.equal(agentMsg.push.length, 2);
  assert.equal(agentMsg.push[0].title, '被讨厌的勇气');
  assert.equal(page.data.recommendation, null);
  // 点书卡：替用户开口，进入学习轮
  page.tapPushCard({ currentTarget: { dataset: { id: 'agent-1', index: 0 } } });
  const userMsg = page.data.messages.find((item) => item.role === 'user' && item.text.indexOf('被讨厌的勇气') !== -1);
  assert.ok(userMsg, 'book tap should send the learning message');
  // 点功能卡：直接执行，产出技能气泡
  page.tapPushCard({ currentTarget: { dataset: { id: 'agent-1', index: 1 } } });
  const bubble = page.data.messages[page.data.messages.length - 1];
  assert.equal(bubble.role, 'skill');
  assert.ok(bubble.text.indexOf('寄存') !== -1);
});

test('ask chips answer as the user and stop responding once settled', () => {
  const { page, complete, startChat } = harness();
  startChat('今晚有点乱');
  complete('要不要先从轻的开始？\n@@ASK@@{"question":"想先从哪件开始？","options":["聊聊心事","听点声音","先睡一会"]}');
  const agentMsg = page.data.messages.find((item) => item.id === 'agent-1');
  assert.deepEqual(agentMsg.ask.options, ['聊聊心事', '听点声音', '先睡一会']);
  assert.equal(agentMsg.ask.done, undefined);
  page.answerAsk({ currentTarget: { dataset: { id: 'agent-1', index: 1 } } });
  const settled = page.data.messages.find((item) => item.id === 'agent-1');
  assert.equal(settled.ask.done, '听点声音');
  assert.ok(page.data.messages.find((item) => item.role === 'user' && item.text === '听点声音'), 'choice should be sent as a user message');
  const before = page.data.messages.length;
  page.answerAsk({ currentTarget: { dataset: { id: 'agent-1', index: 0 } } });
  assert.equal(page.data.messages.length, before);
});

test('typing a fresh message closes an open ask, and regenerate clears cards', () => {
  const { page, complete, startChat } = harness();
  startChat('今晚有点乱');
  complete('想先聊聊吗？\n@@ASK@@{"question":"想先从哪件开始？","options":["聊聊心事","先睡一会"]}');
  page.onDraftChange({ detail: { value: '其实我想先说说今天的事' } });
  page.sendMessage();
  const settled = page.data.messages.find((item) => item.id === 'agent-1');
  assert.equal(settled.ask.done, true);

  const second = harness();
  second.startChat('随便聊聊');
  second.complete('看看这张卡片。\n@@PUSH@@[{"kind":"feature","id":"park"}]');
  assert.equal(second.page.data.messages.find((item) => item.id === 'agent-1').push.length, 1);
  second.page.regenerate();
  const regenerated = second.page.data.messages.find((item) => item.id === 'agent-1');
  assert.equal(regenerated.push, null);
  assert.equal(regenerated.ask, null);
});
