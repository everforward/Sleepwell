const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const storage = require('../services/storage');

// 消息页沙箱：与 agent-ui.test.js 同款，按页面真实 require 装载。
function harness(store) {
  let page;
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ top: 32, bottom: 64, left: 279 }),
    getStorageSync: (key) => store[key] || '',
    setStorageSync: (key, value) => { store[key] = value; return true; },
    navigateBack() {}, reLaunch() {}
  };
  const script = path.resolve(__dirname, '../pages/night-messages/index.js');
  global.wx = wx;
  const context = {
    wx,
    Page: (definition) => { page = definition; },
    require: (name) => require(path.resolve(path.dirname(script), name))
  };
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), context);
  page.setData = (values) => Object.assign(page.data, values);
  page.onShow();
  return { page, store };
}

function seedStore() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const store = {};
  store[storage.KEYS.agentMessages] = [
    { id: 'msg-b', kind: 'wake', text: '07:30 到啦，夜喵轻轻叫你一声。醒了吗？', at: Date.now(), read: false },
    { id: 'msg-a', kind: 'bedtime', text: '到点啦——我们说好 23:30 睡的。', at: yesterday.getTime(), read: true }
  ];
  return store;
}

test('message page renders the inbox with unread marks and time labels', () => {
  const { page } = harness(seedStore());
  assert.equal(page.data.messages.length, 2);
  assert.equal(page.data.unread, 1);
  assert.equal(page.data.messages[0].kindLabel, '晨间唤醒');
  assert.ok(page.data.messages[0].when.indexOf('今天 ') === 0);
  assert.equal(page.data.messages[1].kindLabel, '就寝提醒');
  assert.ok(page.data.messages[1].when.indexOf('昨天 ') === 0);
  assert.equal(page.data.messages[1].read, true);
});

test('tapping a message marks it read and clears the unread count', () => {
  const { page, store } = harness(seedStore());
  page.openMessage({ currentTarget: { dataset: { id: 'msg-b' } } });
  assert.equal(page.data.unread, 0);
  assert.equal(page.data.messages[0].read, true);
  assert.equal(store[storage.KEYS.agentMessages].find((item) => item.id === 'msg-b').read, true);
});

test('mark all read settles every unread row', () => {
  const store = seedStore();
  store[storage.KEYS.agentMessages][1].read = false;
  const { page } = harness(store);
  assert.equal(page.data.unread, 2);
  page.markAllRead();
  assert.equal(page.data.unread, 0);
  assert.ok(page.data.messages.every((item) => item.read));
});

test('empty inbox renders without messages or unread marks', () => {
  const { page } = harness({});
  assert.deepEqual(page.data.messages, []);
  assert.equal(page.data.unread, 0);
});
