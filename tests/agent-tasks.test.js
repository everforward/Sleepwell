const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../services/storage');
const tasks = require('../services/agent-tasks');

function withWx(store, fn) {
  const originalWx = global.wx;
  global.wx = {
    getStorageSync: (key) => (key in store ? store[key] : ''),
    setStorageSync: (key, value) => { store[key] = value; return true; }
  };
  try {
    return fn();
  } finally {
    if (originalWx) global.wx = originalWx; else delete global.wx;
  }
}

test('normalizeTime accepts common spoken formats', () => {
  assert.equal(tasks.normalizeTime('23:30'), '23:30');
  assert.equal(tasks.normalizeTime('23：05'), '23:05');
  assert.equal(tasks.normalizeTime('7点'), '07:00');
  assert.equal(tasks.normalizeTime('11点半'), '11:30');
  assert.equal(tasks.normalizeTime('23点30分'), '23:30');
  assert.equal(tasks.normalizeTime('2330'), '23:30');
  assert.equal(tasks.normalizeTime('24:00'), '');
  assert.equal(tasks.normalizeTime('25点'), '');
  assert.equal(tasks.normalizeTime('睡吧'), '');
  assert.equal(tasks.normalizeTime(''), '');
});

test('createTask computes the next occurrence and replaces pending same-kind pledges', () => {
  const evening = new Date('2026-10-12T22:00:00').getTime();
  withWx({}, () => {
    const pledged = tasks.createTask({ kind: 'bedtime', time: '23:30', note: '早八' }, evening);
    assert.equal(pledged.time, '23:30');
    assert.equal(pledged.dueAt, new Date('2026-10-12T23:30:00').getTime());
    // 时间点已过则落到第二天
    const wake = tasks.createTask({ kind: 'wake', time: '07:30' }, evening);
    assert.equal(wake.dueAt, new Date('2026-10-13T07:30:00').getTime());
    // 同类型重新拉钩会覆盖旧约定，且不合并 note
    tasks.createTask({ kind: 'bedtime', time: '23:00' }, evening + 1000);
    const pendings = tasks.pending().filter((item) => item.kind === 'bedtime');
    assert.equal(pendings.length, 1);
    assert.equal(pendings[0].time, '23:00');
    assert.equal(pendings[0].note, '');
    // 非法输入不入库
    assert.equal(tasks.createTask({ kind: 'bedtime', time: '睡吧' }, evening), null);
    assert.equal(tasks.createTask({ kind: 'unknown', time: '23:00' }, evening), null);
  });
});

test('takeDueCatchUp delivers inside the window and never repeats', () => {
  withWx({}, () => {
    tasks.createTask({ kind: 'bedtime', time: '23:30' }, new Date('2026-10-12T22:00:00').getTime());
    const night = tasks.takeDueCatchUp(new Date('2026-10-13T00:10:00').getTime());
    assert.equal(night.length, 1);
    assert.equal(night[0].kind, 'bedtime');
    assert.ok(night[0].text.indexOf('23:30') !== -1);
    // 已送达不再补发
    assert.equal(tasks.takeDueCatchUp(new Date('2026-10-13T00:20:00').getTime()).length, 0);
    assert.equal(tasks.pending().length, 0);
    assert.equal(storage.read(storage.KEYS.agentTasks, []).length, 1);
  });
});

test('takeDueCatchUp expires tasks opened outside the night or morning window', () => {
  const evening = new Date('2026-10-12T22:00:00').getTime();
  withWx({}, () => {
    tasks.createTask({ kind: 'bedtime', time: '23:30' }, evening);
    // 早上七点打开：已经不该再喊睡觉
    assert.equal(tasks.takeDueCatchUp(new Date('2026-10-13T07:00:00').getTime()).length, 0);
    tasks.createTask({ kind: 'wake', time: '07:30' }, evening);
    // 下午三点打开：早上叫你的事安静作废
    assert.equal(tasks.takeDueCatchUp(new Date('2026-10-13T15:00:00').getTime()).length, 0);
    assert.equal(tasks.pending().length, 0);
  });
});

test('takeDueCatchUp delivers a wake task in the morning window with a morning voice', () => {
  const evening = new Date('2026-10-12T22:00:00').getTime();
  withWx({}, () => {
    tasks.createTask({ kind: 'wake', time: '07:30', note: '早八' }, evening);
    const due = tasks.takeDueCatchUp(new Date('2026-10-13T07:40:00').getTime());
    assert.equal(due.length, 1);
    assert.ok(due[0].text.indexOf('07:30') !== -1);
    assert.ok(due[0].text.indexOf('醒了吗') !== -1);
    assert.ok(due[0].text.indexOf('早八') !== -1);
  });
});

test('takeDueCatchUp greets late risers with a morning hello inside the wake window', () => {
  const evening = new Date('2026-10-12T22:00:00').getTime();
  withWx({}, () => {
    tasks.createTask({ kind: 'wake', time: '07:30' }, evening);
    const due = tasks.takeDueCatchUp(new Date('2026-10-13T10:00:00').getTime());
    assert.equal(due.length, 1);
    assert.ok(due[0].text.indexOf('早上好') !== -1);
  });
});

test('buildCatchUpText uses a late voice after the grace hour', () => {
  const task = { kind: 'bedtime', time: '23:30', note: '', dueAt: new Date('2026-10-12T23:30:00').getTime() };
  assert.ok(tasks.buildCatchUpText(task, new Date('2026-10-13T00:10:00').getTime()).indexOf('到点啦') !== -1);
  assert.ok(tasks.buildCatchUpText(task, new Date('2026-10-13T01:30:00').getTime()).indexOf('已经过了') !== -1);
});

test('pendingBrief summarizes agreements for prompt context', () => {
  withWx({}, () => {
    tasks.createTask({ kind: 'bedtime', time: '23:30', note: '早八' }, Date.now());
    const briefs = tasks.pendingBrief();
    assert.equal(briefs.length, 1);
    assert.ok(briefs[0].indexOf('23:30') !== -1);
    assert.ok(briefs[0].indexOf('早八') !== -1);
  });
});
