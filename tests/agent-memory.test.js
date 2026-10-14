const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../services/storage');
const agentMemory = require('../services/agent-memory');
const agentReviews = require('../services/agent-reviews');

function withStorage(store, fn) {
  const original = global.wx;
  global.wx = { getStorageSync: (key) => (store && store[key]) || '', setStorageSync: (key, value) => { store[key] = value; return true; } };
  try {
    return fn();
  } finally {
    if (original) global.wx = original; else delete global.wx;
  }
}

test('remember stores summaries newest first and caps at three entries', () => {
  withStorage({}, () => {
    agentMemory.remember({ at: 1, topic: 'exam', summary: '第一次对话的摘要' });
    agentMemory.remember({ at: 2, topic: '', summary: '第二次对话的摘要' });
    agentMemory.remember({ at: 3, topic: '', summary: '第三次对话的摘要' });
    agentMemory.remember({ at: 4, topic: '', summary: '第四次对话的摘要' });
    const list = agentMemory.recall();
    assert.equal(list.length, 3);
    assert.equal(list[0].summary, '第四次对话的摘要');
    assert.equal(agentMemory.lastMemory().summary, '第四次对话的摘要');
  });
});

test('remember rejects blank and oversized summaries', () => {
  withStorage({}, () => {
    assert.equal(agentMemory.remember({ summary: '   ' }), false);
    assert.equal(agentMemory.remember(null), false);
    agentMemory.remember({ summary: 'x'.repeat(200) });
    assert.equal(agentMemory.lastMemory().summary.length, 40);
  });
});

test('buildTranscript keeps the tail and marks speaker roles', () => {
  const messages = [
    { role: 'agent', text: '开场' },
    { role: 'user', text: '第一句' },
    ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'user' : 'agent', text: `填充${i}` })),
    { role: 'agent', text: '结尾' }
  ];
  const transcript = agentMemory.buildTranscript(messages);
  const lines = transcript.split('\n');
  assert.equal(lines.length, 8);
  assert.equal(lines[lines.length - 1], '夜喵：结尾');
});

test('summarizeConversation skips when there is no user turn or no wx.request', () => {
  let requested = 0;
  let outcome = null;
  // 无用户发言：直接跳过
  agentMemory.summarizeConversation([{ role: 'agent', text: '开场' }], '', (s) => { outcome = s; });
  assert.equal(outcome, null);
  // 有用户发言但环境没有 wx.request
  withStorage({}, () => {
    global.wx = { getStorageSync: () => '', setStorageSync: () => true }; // 无 request
    requested = 0;
    agentMemory.summarizeConversation([{ role: 'user', text: '睡不着' }], 'thoughts', (s) => { outcome = s; });
    assert.equal(requested, 0);
    assert.equal(outcome, null);
    delete global.wx;
  });
});

test('summarizeConversation persists the gateway summary', () => {
  let request = null;
  const store = {};
  global.wx = {
    getStorageSync: (key) => store[key] || '',
    setStorageSync: (key, value) => { store[key] = value; return true; },
    request(opts) { request = opts; }
  };
  let outcome = 'pending';
  agentMemory.summarizeConversation(
    [{ role: 'user', text: '考试焦虑睡不着' }, { role: 'agent', text: '我在这里。' }],
    'exam',
    (s) => { outcome = s; }
  );
  assert.equal(request.data.stream, false);
  request.success({ data: { choices: [{ message: { content: '因考试焦虑而失眠' } }] } });
  assert.equal(outcome, '因考试焦虑而失眠');
  assert.equal(agentMemory.lastMemory().topic, 'exam');
  assert.equal(agentMemory.lastMemory().summary, '因考试焦虑而失眠');
  delete global.wx;
});

test('summarizeConversation swallows gateway failures', () => {
  let request = null;
  const store = {};
  global.wx = {
    getStorageSync: (key) => store[key] || '',
    setStorageSync: (key, value) => { store[key] = value; return true; },
    request(opts) { request = opts; }
  };
  let outcome = 'pending';
  agentMemory.summarizeConversation([{ role: 'user', text: '睡不着' }], '', (s) => { outcome = s; });
  request.fail({ errMsg: 'request:fail timeout' });
  assert.equal(outcome, null);
  assert.equal(agentMemory.recall().length, 0);
  delete global.wx;
});

test('formatWhen renders a friendly date and tolerates invalid timestamps', () => {
  assert.equal(agentMemory.formatWhen(new Date('2026-10-11T22:00:00').getTime()), '10月11日');
  assert.equal(agentMemory.formatWhen('not-a-date'), '上次');
});

test('renderMemoryMarkdown builds a readable archive from all record types', () => {
  const now = Date.now();
  withStorage({
    [storage.KEYS.sessions]: [{ id: 'a', startedAt: now, cycles: 6, completed: true, outcome: 'relieved' }],
    [storage.KEYS.sleep]: [{ nightDate: '2026-10-11', bedTime: '23:30', wakeTime: '07:10', duration: '7小时40分', feeling: 4 }],
    [storage.KEYS.journal]: [{ date: '10月11日', items: ['晚霞很好看'] }],
    [storage.KEYS.agentMemory]: [{ at: now, topic: 'exam', summary: '因考试焦虑而失眠' }],
    [storage.KEYS.agentThoughts]: [{ at: now, text: '明天的组会汇报' }]
  }, () => {
    const md = agentMemory.renderMemoryMarkdown();
    assert.ok(md.indexOf('# 夜喵的记忆') === 0);
    assert.ok(md.indexOf('累计完成 6 轮呼吸') !== -1);
    assert.ok(md.indexOf('感受「不错」') !== -1);
    assert.ok(md.indexOf('晚霞很好看') !== -1);
    assert.ok(md.indexOf('因考试焦虑而失眠') !== -1);
    assert.ok(md.indexOf('我们聊过') !== -1);
    assert.ok(md.indexOf('你寄存在我这的心事') !== -1);
    assert.ok(md.indexOf('明天的组会汇报') !== -1);
  });
});

test('renderMemoryMarkdown lists received reviews with vote, quote and reason', () => {
  const at = new Date('2026-10-11T22:00:00').getTime();
  withStorage({
    [storage.KEYS.agentReviews]: [
      { messageId: 'm1', value: 'dislike', reason: '有点说教', quote: '早点休息哦', at },
      { messageId: 'm2', value: 'like', reason: '', quote: '我在的', at }
    ]
  }, () => {
    const md = agentMemory.renderMemoryMarkdown();
    assert.ok(md.indexOf('## 夜喵收到的评价') !== -1);
    assert.ok(md.indexOf('10月11日 · 踩「早点休息哦」——原因：有点说教') !== -1);
    assert.ok(md.indexOf('10月11日 · 赞「我在的」') !== -1);
  });
});

test('renderMemoryMarkdown shows a gentle placeholder for a fresh user', () => {
  withStorage({}, () => {
    const md = agentMemory.renderMemoryMarkdown();
    assert.ok(md.indexOf('夜喵还没有记住什么') !== -1);
  });
});

test('writeMemoryFile and clearConversationMemory degrade without a filesystem', () => {
  withStorage({}, () => {
    assert.equal(agentMemory.writeMemoryFile(), false); // 无 getFileSystemManager
    assert.equal(agentMemory.readMemoryFile(), '');
    // clearConversationMemory 在无文件系统时仍清除 storage 记忆（摘要与评价一起清）
    agentMemory.remember({ at: 1, summary: '一次对话' });
    agentReviews.upsert({ messageId: 'm1', value: 'like', quote: '好' });
    assert.equal(agentMemory.clearConversationMemory(), true);
    assert.equal(agentMemory.recall().length, 0);
    assert.equal(agentReviews.list().length, 0);
  });
});
