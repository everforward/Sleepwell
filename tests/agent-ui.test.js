const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const storage = require('../services/storage');
const agentMessages = require('../services/agent-messages');

// 页面级测试沙箱：可配置 wx.request 行为（流式任务 / 直接抛错）。
function harness({ request } = {}) {
  let page;
  let timer;
  const store = {};
  const clipboard = [];
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ top: 32, bottom: 64, left: 279 }),
    getStorageSync: (key) => store[key] || '',
    setStorageSync: (key, value) => { store[key] = value; return true; },
    showShareMenu() {}, hideKeyboard() {}, showToast() {},
    onKeyboardHeightChange() {}, offKeyboardHeightChange() {},
    setClipboardData: ({ data }) => clipboard.push(data),
    navigateTo() {}, reLaunch() {},
    request: request || (() => { throw new Error('network down'); })
  };
  const script = path.resolve(__dirname, '../pages/agent/index.js');
  global.wx = wx; // 服务模块（agent-client/storage）从 Node global 读取 wx
  const context = {
    wx,
    Page: (definition) => { page = definition; },
    require: (name) => require(path.resolve(path.dirname(script), name)),
    setTimeout: (fn) => { timer = fn; return 1; },
    clearTimeout: () => { timer = null; }
  };
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), context);
  page.setData = (values) => Object.assign(page.data, values);
  page.onLoad();
  return { page, store, clipboard, wx, finish: () => { const fn = timer; timer = null; if (fn) fn(); } };
}

function startChat(page, text) {
  page.openChat();
  page.onDraftChange({ detail: { value: text } });
  page.sendMessage();
}

test('like and dislike toggle exclusively and aggregate counts persist', () => {
  const { page, store } = harness();
  startChat(page, '最近睡不着');
  const agentMsg = page.data.messages.find((item) => item.role === 'agent' && item.done);
  assert.ok(agentMsg, 'agent reply should be marked done');
  page.setFeedback({ currentTarget: { dataset: { id: agentMsg.id, value: 'like' } } });
  assert.equal(page.data.messages.find((item) => item.id === agentMsg.id).feedback, 'like');
  // 明细评价同步落一条：带回复节选，进 memory.md
  let reviews = store[storage.KEYS.agentReviews] || [];
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].value, 'like');
  assert.equal(reviews[0].quote, agentMsg.text.slice(0, 24));
  page.setFeedback({ currentTarget: { dataset: { id: agentMsg.id, value: 'dislike' } } });
  assert.equal(page.data.messages.find((item) => item.id === agentMsg.id).feedback, 'dislike');
  reviews = store[storage.KEYS.agentReviews] || [];
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].value, 'dislike');
  // 再次点击取消：明细随投票整条撤回
  page.setFeedback({ currentTarget: { dataset: { id: agentMsg.id, value: 'dislike' } } });
  assert.equal(page.data.messages.find((item) => item.id === agentMsg.id).feedback, '');
  assert.equal((store[storage.KEYS.agentReviews] || []).length, 0);
  const counts = store[storage.KEYS.agentFeedback];
  assert.equal(counts.like, 1);
  assert.equal(counts.dislike, 1);
});

test('three-dot menu opens the review sheet and writes the reason into memory', () => {
  const { page, store } = harness();
  startChat(page, '总是三点才睡');
  const agentMsg = page.data.messages.find((item) => item.role === 'agent' && item.done);
  // 菜单开合：点同一枚消息的 ··· 切换
  page.openMessageMenu({ currentTarget: { dataset: { id: agentMsg.id } } });
  assert.equal(page.data.menuForId, agentMsg.id);
  page.openMessageMenu({ currentTarget: { dataset: { id: agentMsg.id } } });
  assert.equal(page.data.menuForId, '');
  // 先投票再写理由：弹层带当前态度与回复节选，空理由不可提交
  page.setFeedback({ currentTarget: { dataset: { id: agentMsg.id, value: 'like' } } });
  page.openMessageMenu({ currentTarget: { dataset: { id: agentMsg.id } } });
  page.openReview({ currentTarget: { dataset: { id: agentMsg.id } } });
  assert.equal(page.data.menuForId, '', 'opening the sheet should close the menu');
  assert.equal(page.data.reviewForId, agentMsg.id);
  assert.equal(page.data.reviewVote, 'like');
  assert.equal(page.data.reviewDraft, '');
  assert.equal(page.data.canSubmitReview, false);
  page.onReviewInput({ detail: { value: '这句话让我安心' } });
  assert.equal(page.data.canSubmitReview, true);
  page.submitReview();
  assert.equal(page.data.reviewForId, '');
  let entry = (store[storage.KEYS.agentReviews] || [])[0];
  assert.equal(entry.value, 'like');
  assert.equal(entry.reason, '这句话让我安心');
  assert.equal(entry.quote, agentMsg.text.slice(0, 24));
  // 改口成踩：已写下的理由保留
  page.setFeedback({ currentTarget: { dataset: { id: agentMsg.id, value: 'dislike' } } });
  entry = (store[storage.KEYS.agentReviews] || [])[0];
  assert.equal(entry.value, 'dislike');
  assert.equal(entry.reason, '这句话让我安心');
  // 重新打开：理由回填；清空提交 = 删掉这句话（态度保留）
  page.openReview({ currentTarget: { dataset: { id: agentMsg.id } } });
  assert.equal(page.data.reviewDraft, '这句话让我安心');
  assert.equal(page.data.canSubmitReview, true);
  page.onReviewInput({ detail: { value: '' } });
  assert.equal(page.data.canSubmitReview, true, 'clearing an existing reason is still submittable');
  page.submitReview();
  entry = (store[storage.KEYS.agentReviews] || [])[0];
  assert.equal(entry.value, 'dislike');
  assert.equal(entry.reason, '');
});

test('a bare note without a vote still lands in the review list', () => {
  const { page, store } = harness();
  startChat(page, '今晚好累');
  const agentMsg = page.data.messages.find((item) => item.role === 'agent' && item.done);
  page.openReview({ currentTarget: { dataset: { id: agentMsg.id } } });
  assert.equal(page.data.reviewVote, '');
  assert.equal(page.data.reviewForId, agentMsg.id);
  page.onReviewInput({ detail: { value: '其实我想听你说更多' } });
  page.submitReview();
  const entry = (store[storage.KEYS.agentReviews] || [])[0];
  assert.equal(entry.value, '');
  assert.equal(entry.reason, '其实我想听你说更多');
  // 重新生成会作废旧回复上的评价
  page.regenerate();
  assert.equal((store[storage.KEYS.agentReviews] || []).length, 0);
});

test('copy sends the message text to the clipboard', () => {
  const { page, clipboard } = harness();
  startChat(page, '你好');
  const agentMsg = page.data.messages.find((item) => item.role === 'agent' && item.done);
  page.copyMessage({ currentTarget: { dataset: { id: agentMsg.id } } });
  assert.deepEqual(clipboard, [agentMsg.text]);
});

test('regenerate reruns the last turn without duplicating the user message', () => {
  const { page } = harness();
  startChat(page, '考试让我焦虑');
  const before = page.data.messages.length;
  page.regenerate();
  assert.equal(page.data.messages.length, before);
  assert.equal(page.data.messages.filter((item) => item.role === 'user').length, 1);
  const agentMsg = page.data.messages.find((item) => item.role === 'agent' && item.id !== 'intro');
  assert.ok(agentMsg.text.length > 0);
  assert.equal(agentMsg.done, true);
});

test('stop generation keeps streamed text and settles to idle', () => {
  let chunkHandler = null;
  const { page } = harness({
    request: () => ({ onChunkReceived: (cb) => { chunkHandler = cb; }, abort() {} })
  });
  startChat(page, '陪我聊一会');
  assert.equal(page.data.chatState, 'sending');
  chunkHandler({ data: Buffer.from('data: {"choices":[{"delta":{"content":"我在，慢慢说。"}}]}\n\n', 'utf8') });
  page.stopGeneration();
  const agentMsg = page.data.messages.find((item) => item.role === 'agent' && item.id !== 'intro');
  assert.equal(agentMsg.text, '我在，慢慢说。');
  assert.equal(agentMsg.done, true);
  assert.equal(page.data.chatState, 'idle');
  assert.equal(page.data.awaitingFirst, false);
});

test('sending pulses the ripple class without any haptic, and retry never replays it', () => {
  const { page, wx } = harness();
  let vibrated = 0;
  wx.vibrateShort = () => { vibrated += 1; };
  startChat(page, '今晚想早点睡');
  const firstEcho = page.data.sendEcho;
  assert.ok(firstEcho === 'a' || firstEcho === 'b');
  page.onDraftChange({ detail: { value: '在的' } });
  page.sendMessage();
  assert.notEqual(page.data.sendEcho, firstEcho);
  // 重试沿用同一轮，不重放涟漪
  page.regenerate();
  assert.equal(page.data.sendEcho, '');
  assert.equal(vibrated, 0);
});

test('message action icons are exposed to the view layer', () => {
  const { page } = harness();
  assert.ok(page.data.icons.like.indexOf('data:image/svg+xml') === 0);
  assert.ok(page.data.icons.stop.indexOf('data:image/svg+xml') === 0);
  assert.notEqual(page.data.icons.like, page.data.icons.likeActive);
});

test('full skill flow: streamed marker becomes a confirm card, then a subscribe card that degrades gracefully', () => {
  let opts = null;
  let chunkHandler = null;
  const { page, store } = harness({
    request: (options) => {
      opts = options;
      return { onChunkReceived: (cb) => { chunkHandler = cb; }, abort() {} };
    }
  });
  startChat(page, '今晚 23:30 提醒我睡觉，明天早八');
  assert.equal(page.data.chatState, 'sending');
  const content = '好，那我们拉钩。\n@@DO@@{"skill":"bedtime_pledge","args":{"time":"23:30","note":"早八"}}';
  chunkHandler({ data: Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`, 'utf8') });
  opts.success();
  const confirmMsg = page.data.messages.find((item) => item.role === 'skill-confirm');
  assert.ok(confirmMsg, 'streamed skill marker should raise a confirm card');
  assert.ok(confirmMsg.text.indexOf('约定就寝时间') !== -1);
  // 用户点「执行」：任务落库，随后给出订阅授权卡片
  page.confirmSkill({ currentTarget: { dataset: { id: confirmMsg.id } } });
  const storedTasks = store[storage.KEYS.agentTasks] || [];
  assert.equal(storedTasks.length, 1);
  assert.equal(storedTasks[0].kind, 'bedtime');
  assert.equal(storedTasks[0].time, '23:30');
  assert.equal(storedTasks[0].note, '早八');
  assert.ok(page.data.messages.every((item) => item.role !== 'skill-confirm'));
  const actionMsg = page.data.messages.find((item) => item.role === 'skill-action');
  assert.ok(actionMsg, 'confirmed pledge should offer subscribe authorization');
  // 模板未配置：点击后降级提示，不报错
  page.subscribeSkill({ currentTarget: { dataset: { id: actionMsg.id } } });
  const settled = page.data.messages.find((item) => item.id === actionMsg.id);
  assert.equal(settled.role, 'skill');
  assert.ok(settled.text.indexOf('还没配置好') !== -1);
});

test('opening after the pledged time delivers the catch-up message into the chat', () => {
  const realNow = Date.now;
  const { page, store } = harness();
  store[storage.KEYS.agentTasks] = [{
    id: 'task-seed',
    kind: 'bedtime',
    time: '23:30',
    note: '早八',
    createdAt: new Date('2026-10-12T22:00:00').getTime(),
    dueAt: new Date('2026-10-12T23:30:00').getTime(),
    status: 'pending'
  }];
  Date.now = () => new Date('2026-10-13T00:10:00').getTime();
  try {
    page.deliverDueTasks();
  } finally {
    Date.now = realNow;
  }
  assert.equal(page.data.homeState, 'chat');
  const first = page.data.messages[0];
  assert.equal(first.role, 'agent');
  assert.ok(first.text.indexOf('到点啦') !== -1);
  assert.ok(first.text.indexOf('23:30') !== -1);
  assert.equal(store[storage.KEYS.agentTasks][0].status, 'delivered');
  // 同一条提醒同步落进「消息」列表（未读），入口角标点亮
  const inbox = store[storage.KEYS.agentMessages] || [];
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].kind, 'bedtime');
  assert.equal(inbox[0].read, false);
  assert.ok(inbox[0].text.indexOf('23:30') !== -1);
  assert.equal(page.data.messageBadge, 1);
  // 消息页标记已读后回到夜喵页：刷新角标归零
  agentMessages.markRead(inbox[0].id);
  page.refreshMessageBadge();
  assert.equal(page.data.messageBadge, 0);
});
