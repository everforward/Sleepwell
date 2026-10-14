const test = require('node:test');
const assert = require('node:assert/strict');
const agentMessages = require('../services/agent-messages');

function withStorage(store, fn) {
  const original = global.wx;
  global.wx = { getStorageSync: (key) => (store && store[key]) || '', setStorageSync: (key, value) => { store[key] = value; return true; } };
  try {
    return fn();
  } finally {
    if (original) global.wx = original; else delete global.wx;
  }
}

test('push keeps newest first, defaults to unread, and caps the inbox', () => {
  withStorage({}, () => {
    agentMessages.push([{ kind: 'bedtime', text: '到点啦' }]);
    agentMessages.push([{ kind: 'wake', text: '早上好' }]);
    const list = agentMessages.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].text, '早上好');
    assert.equal(list[0].kind, 'wake');
    assert.equal(list[0].read, false);
    assert.equal(agentMessages.unreadCount(), 2);
    // 同一批多条：后送达的排在上面
    agentMessages.push([{ kind: 'bedtime', text: '第一条' }, { kind: 'wake', text: '第二条' }]);
    const batch = agentMessages.list();
    assert.equal(batch[0].text, '第二条');
    assert.equal(batch[1].text, '第一条');
    for (let index = 0; index < 60; index += 1) agentMessages.push([{ kind: 'bedtime', text: `消息${index}` }]);
    assert.equal(agentMessages.list().length, agentMessages.LIMIT);
  });
});

test('push ignores empty items and blank text', () => {
  withStorage({}, () => {
    assert.equal(agentMessages.push([]), 0);
    assert.equal(agentMessages.push(null), 0);
    assert.equal(agentMessages.push([{ kind: 'bedtime' }, null]), 0);
    assert.equal(agentMessages.list().length, 0);
  });
});

test('markRead flips one row and markAllRead clears the unread count', () => {
  withStorage({}, () => {
    agentMessages.push([{ kind: 'bedtime', text: '第一条' }]);
    agentMessages.push([{ kind: 'bedtime', text: '第二条' }]);
    const id = agentMessages.list()[0].id;
    assert.equal(agentMessages.markRead(id), true);
    assert.equal(agentMessages.unreadCount(), 1);
    assert.deepEqual(agentMessages.list().map((item) => item.read), [true, false]);
    assert.equal(agentMessages.markRead(id), false); // 已是已读，不重复写
    assert.equal(agentMessages.markRead('msg-missing'), false);
    assert.equal(agentMessages.markAllRead(), 1);
    assert.equal(agentMessages.unreadCount(), 0);
    assert.equal(agentMessages.markAllRead(), 0);
  });
});

test('whenLabel describes today, yesterday and older dates', () => {
  const now = new Date(2026, 9, 14, 9, 5).getTime(); // 2026-10-14 09:05
  assert.equal(agentMessages.whenLabel(new Date(2026, 9, 14, 7, 30).getTime(), now), '今天 07:30');
  assert.equal(agentMessages.whenLabel(new Date(2026, 9, 13, 23, 30).getTime(), now), '昨天 23:30');
  assert.equal(agentMessages.whenLabel(new Date(2026, 9, 11, 22, 0).getTime(), now), '10 月 11 日 22:00');
  assert.equal(agentMessages.whenLabel('not-a-time', now), '');
});

test('kindLabel names the reminder types and tolerates unknown kinds', () => {
  assert.equal(agentMessages.kindLabel('bedtime'), '就寝提醒');
  assert.equal(agentMessages.kindLabel('wake'), '晨间唤醒');
  assert.equal(agentMessages.kindLabel('other'), '夜喵留言');
});
