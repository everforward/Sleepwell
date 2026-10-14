const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../services/storage');

test('dateKey and seven-day summary use local calendar days', () => {
  const now = new Date(2026, 7, 29, 12, 0).getTime();
  const sessions = [
    { id: 'a', startedAt: new Date(2026, 7, 29, 1).getTime(), cycles: 6, completed: true, outcome: 'relieved' },
    { id: 'b', startedAt: new Date(2026, 7, 28, 23).getTime(), cycles: 2, completed: false, outcome: 'tense' },
    { id: 'old', startedAt: new Date(2026, 7, 1).getTime(), cycles: 10, completed: true, outcome: 'same' }
  ];
  const summary = storage.getSevenDaySummary(now, sessions);
  assert.equal(summary.days.length, 7);
  assert.equal(summary.activeDays, 2);
  assert.equal(summary.completedSessions, 1);
  assert.deepEqual(summary.outcomes, { relieved: 1, same: 0, tense: 1 });
  assert.equal(storage.dateKey(new Date(2026, 7, 29, 23).getTime()), '2026-08-29');
});

test('summary tolerates old records without completion fields', () => {
  const summary = storage.getSevenDaySummary(new Date(2026, 7, 29).getTime(), [{ startedAt: new Date(2026, 7, 29).getTime(), cycles: 3 }]);
  assert.equal(summary.days[6].sessions, 1);
  assert.equal(summary.days[6].completed, 0);
  assert.deepEqual(summary.days[6].outcomes, { relieved: 0, same: 0, tense: 0 });
});

test('clears each personal record category without touching settings', () => {
  const writes = [];
  global.wx = {
    setStorageSync(key, value) { writes.push([key, value]); },
    getStorageSync() { return null; }
  };
  assert.equal(storage.clearPersonalRecords(), true);
  assert.deepEqual(
    writes.map((item) => item[0]).sort(),
    [storage.KEYS.agentFacts, storage.KEYS.agentFeedback, storage.KEYS.agentMemory, storage.KEYS.agentMessages, storage.KEYS.agentReviews, storage.KEYS.agentTasks, storage.KEYS.agentThoughts, storage.KEYS.journal, storage.KEYS.sessions, storage.KEYS.sleep].sort()
  );
  assert.equal(writes.some((item) => item[0] === storage.KEYS.settings), false);
  delete global.wx;
});

test('getSettings deep-merges skill permissions so new skills reach existing installs', () => {
  const store = {
    [storage.KEYS.settings]: {
      skillPermissions: { play_sound: 'off' },
      breathPatternVersion: 2
    }
  };
  global.wx = {
    getStorageSync: (key) => (key in store ? store[key] : ''),
    setStorageSync(key, value) { store[key] = value; }
  };
  const settings = storage.getSettings();
  // 老用户保存过的选择保留
  assert.equal(settings.skillPermissions.play_sound, 'off');
  // 同一份旧设置里没见过的技能拿到出厂默认
  assert.equal(settings.skillPermissions.dream_log, 'auto');
  assert.equal(settings.skillPermissions.bedtime_pledge, 'confirm');
  delete global.wx;
});
