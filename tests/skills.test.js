const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../skills/registry');
const playSound = require('../skills/play-sound');
const journal = require('../skills/journal');
const agentMemory = require('../services/agent-memory');
const storage = require('../services/storage');

function withWx(store, fn) {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  global.wx = {
    getStorageSync: (key) => (key in store ? store[key] : ''),
    setStorageSync: (key, value) => { store[key] = value; return true; }
  };
  global.getApp = () => null; // storage.saveSettings 会调用 getApp，测试环境无 App 实例
  try {
    return fn();
  } finally {
    if (originalWx) global.wx = originalWx; else delete global.wx;
    if (originalGetApp) global.getApp = originalGetApp; else delete global.getApp;
  }
}

test('registry defaults: safe skills auto, commitment skills confirm, unknown off', () => {
  withWx({}, () => {
    ['play_sound', 'stop_sound', 'journal', 'dream_log', 'park_thoughts', 'morning_checkin', 'bedtime_guide'].forEach((name) => {
      assert.equal(registry.getPermission(name), 'auto', name);
    });
    ['bedtime_pledge', 'wake_me', 'remember'].forEach((name) => {
      assert.equal(registry.getPermission(name), 'confirm', name);
    });
    assert.equal(registry.getPermission('unknown_skill'), 'off');
    registry.setPermission('journal', 'confirm');
    assert.equal(registry.getPermission('journal'), 'confirm');
    registry.setPermission('journal', 'off');
    assert.equal(registry.getPermission('journal'), 'off');
    assert.equal(registry.setPermission('nope', 'auto'), null);
  });
});

test('skill prompt section forbids pretending to act and includes the no-skill fallback', () => {
  withWx({}, () => {
    const all = registry.buildSkillPromptSection();
    assert.ok(all.indexOf('play_sound') !== -1);
    assert.ok(all.indexOf('stop_sound') !== -1);
    assert.ok(all.indexOf('bedtime_guide') !== -1);
    assert.ok(all.indexOf('绝对禁止口头假装执行') !== -1);
    registry.DEFINITIONS.forEach((skill) => registry.setPermission(skill.name, 'off'));
    assert.ok(registry.buildSkillPromptSection().indexOf('不要假装执行') !== -1);
  });
});

test('stop_sound pauses playback through the app audio api', () => {
  withWx({}, () => {
    const calls = [];
    global.getApp = () => ({ pauseSound: () => calls.push('pause') });
    const outcome = registry.run({ skill: 'stop_sound', args: {} });
    assert.equal(outcome.status, 'executed');
    assert.deepEqual(calls, ['pause']);
    assert.ok(outcome.message.indexOf('已停止') !== -1);
    delete global.getApp;
    global.getApp = () => null;
    assert.equal(registry.executeNow({ skill: 'stop_sound', args: {} }).status, 'failed');
  });
});

test('parseSkillCall waits for closed json and rejects malformed payloads', () => {
  assert.equal(registry.parseSkillCall('正文'), null);
  assert.equal(registry.parseSkillCall('正文\n@@DO@@{"skill":"play_sound"'), null); // 未闭合
  assert.deepEqual(
    registry.parseSkillCall('@@DO@@{"skill":"play_sound","args":{"sound":"rain","minutes":15}}'),
    { skill: 'play_sound', args: { sound: 'rain', minutes: 15 } }
  );
  // 没有花括号：视为尚未闭合，继续等待（流式期间可能只收到标记的一半）
  assert.equal(registry.parseSkillCall('@@DO@@not json'), null);
  // JSON 完整但缺 skill 字段：invalid
  assert.equal(registry.parseSkillCall('@@DO@@{"args":{}}').invalid, true);
  // JSON 闭合但语法错误：invalid
  assert.equal(registry.parseSkillCall('@@DO@@{"skill":oops}').invalid, true);
});

test('run respects permissions: auto executes, confirm asks, off refuses', () => {
  withWx({}, () => {
    const calls = [];
    global.getApp = () => ({ playSound: (...args) => calls.push(args) });
    const outcome = registry.run({ skill: 'play_sound', args: { sound: 'rain', minutes: 15 } });
    assert.equal(outcome.status, 'executed');
    assert.deepEqual(calls, [['rain', undefined, 15]]);

    registry.setPermission('play_sound', 'confirm');
    assert.equal(registry.run({ skill: 'play_sound', args: {} }).status, 'needConfirm');

    registry.setPermission('play_sound', 'off');
    assert.equal(registry.run({ skill: 'play_sound', args: {} }).status, 'off');
    assert.equal(registry.run({ skill: 'unknown' }).status, 'unknown');
  });
});

test('play_sound clamps sound and minutes to supported values', () => {
  withWx({}, () => {
    const calls = [];
    global.getApp = () => ({ playSound: (...args) => calls.push(args) });
    const outcome = playSound.execute({ sound: 'disco', minutes: 99 });
    assert.equal(outcome.ok, true);
    assert.deepEqual(calls, [['breeze', undefined, 30]]);
    assert.ok(outcome.message.indexOf('微风') !== -1);
    const missing = playSound.execute({});
    assert.equal(missing.ok, true);
    delete global.getApp;
    assert.equal(playSound.execute({}).ok, false);
  });
});

test('journal writes spoken items using the journal storage contract', () => {
  withWx({}, () => {
    const outcome = journal.execute({ items: ['室友帮我带了饭', '', '晚霞很好看', '多余的一条'] });
    assert.equal(outcome.ok, true);
    const entries = storage.read(storage.KEYS.journal, []);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].items, ['室友帮我带了饭', '晚霞很好看', '多余的一条']);
    assert.ok(journal.execute({ items: ['x'.repeat(60)] }).ok);
    assert.equal(storage.read(storage.KEYS.journal, [])[0].items[0].length, 24);
    assert.equal(journal.execute({ items: [] }).ok, false);
    assert.equal(journal.execute(null).ok, false);
  });
});

test('confirm text names the skill and summarizes its arguments', () => {
  assert.ok(registry.confirmText({ skill: 'play_sound', args: { sound: 'rain' } }).indexOf('播放环境声') !== -1);
  assert.ok(registry.confirmText({ skill: 'journal', args: { items: ['晚饭'] } }).indexOf('items') !== -1);
});

test('bedtime_pledge needs confirmation by default and creates a local bedtime task', () => {
  withWx({}, () => {
    const call = { skill: 'bedtime_pledge', args: { time: '23:30', note: '早八' } };
    assert.equal(registry.run(call).status, 'needConfirm');
    const outcome = registry.executeNow(call);
    assert.equal(outcome.status, 'executed');
    assert.ok(outcome.message.indexOf('23:30') !== -1);
    assert.ok(outcome.message.indexOf('早八') !== -1);
    assert.deepEqual(outcome.action, { type: 'subscribe', kinds: ['bedtime'] });
    const stored = storage.read(storage.KEYS.agentTasks, []);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].kind, 'bedtime');
    assert.equal(stored[0].status, 'pending');
    // 时间无法识别：失败且不落库
    assert.equal(registry.executeNow({ skill: 'bedtime_pledge', args: { time: '睡吧' } }).status, 'failed');
    assert.equal(storage.read(storage.KEYS.agentTasks, []).length, 1);
  });
});

test('wake_me schedules a morning wake task and asks for subscribe authorization', () => {
  withWx({}, () => {
    assert.equal(registry.run({ skill: 'wake_me', args: { time: '07:30' } }).status, 'needConfirm');
    const outcome = registry.executeNow({ skill: 'wake_me', args: { time: '7点半', note: '早八' } });
    assert.equal(outcome.status, 'executed');
    assert.ok(outcome.message.indexOf('07:30') !== -1);
    assert.deepEqual(outcome.action, { type: 'subscribe', kinds: ['wake'] });
    const stored = storage.read(storage.KEYS.agentTasks, []);
    assert.equal(stored[0].kind, 'wake');
    assert.equal(stored[0].note, '早八');
  });
});

test('dream_log writes dreams through the journal storage port with a kind marker', () => {
  withWx({}, () => {
    const outcome = registry.executeNow({ skill: 'dream_log', args: { items: ['在海上飞，水很亮', '', '猫开口说话了', '多余的一条'] } });
    assert.equal(outcome.status, 'executed');
    assert.ok(outcome.message.indexOf('梦已经收好了') !== -1);
    const entries = storage.read(storage.KEYS.journal, []);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'dream');
    assert.deepEqual(entries[0].items, ['在海上飞，水很亮', '猫开口说话了', '多余的一条']);
    // 空内容：失败且不写入
    assert.equal(registry.executeNow({ skill: 'dream_log', args: { items: [] } }).status, 'failed');
    assert.equal(storage.read(storage.KEYS.journal, []).length, 1);
  });
});

test('remember stores long-term facts and surfaces them in the memory archive', () => {
  withWx({}, () => {
    assert.equal(registry.run({ skill: 'remember', args: { fact: '周三有答辩' } }).status, 'needConfirm');
    const outcome = registry.executeNow({ skill: 'remember', args: { fact: '周三下午有答辩' } });
    assert.equal(outcome.status, 'executed');
    assert.ok(outcome.message.indexOf('周三下午有答辩') !== -1);
    assert.deepEqual(agentMemory.facts().map((item) => item.text), ['周三下午有答辩']);
    const markdown = agentMemory.renderMemoryMarkdown();
    assert.ok(markdown.indexOf('## 你让我记住的事') !== -1);
    assert.ok(markdown.indexOf('周三下午有答辩') !== -1);
    // 空白内容不入库
    assert.equal(registry.executeNow({ skill: 'remember', args: { fact: '   ' } }).status, 'failed');
    assert.equal(agentMemory.facts().length, 1);
  });
});

test('bedtime_guide streams scripted segments as paced followups', () => {
  withWx({}, () => {
    const night = new Date('2026-10-12T22:00:00').getTime();
    const outcome = registry.executeNow({ skill: 'bedtime_guide', args: { script: 'body' } }, night);
    assert.equal(outcome.status, 'executed');
    assert.ok(outcome.message.indexOf('身体扫描') !== -1);
    assert.ok(outcome.followups.length >= 4);
    outcome.followups.forEach((item, index) => {
      assert.ok(item.text.length > 0);
      assert.ok(item.delayMs > 0);
      if (index > 0) assert.ok(item.delayMs > outcome.followups[index - 1].delayMs);
    });
    // 未知脚本回退到 night
    assert.ok(registry.executeNow({ skill: 'bedtime_guide', args: { script: 'nope' } }, night).message.indexOf('星夜慢行') !== -1);
  });
});

test('park_thoughts stores thoughts locally and returns the most recent three', () => {
  withWx({}, () => {
    ['明天的组会汇报', '家里的电话还没回', '说错了一句话', '论文数据不对'].forEach((text) => {
      const outcome = registry.executeNow({ skill: 'park_thoughts', args: { text } });
      assert.equal(outcome.status, 'executed');
      assert.ok(outcome.message.indexOf(text) !== -1);
    });
    const recalled = registry.executeNow({ skill: 'park_thoughts', args: { action: 'recall' } });
    assert.equal(recalled.status, 'executed');
    assert.ok(recalled.message.indexOf('论文数据不对') !== -1);
    assert.ok(recalled.message.indexOf('家里的电话还没回') !== -1);
    assert.equal(recalled.message.indexOf('明天的组会汇报'), -1); // 只取回最近三条
    // 取走的移出寄存区，剩下的继续留着
    assert.equal(storage.read(storage.KEYS.agentThoughts, []).length, 1);
    // 空内容不入库
    assert.equal(registry.executeNow({ skill: 'park_thoughts', args: {} }).status, 'failed');
    registry.executeNow({ skill: 'park_thoughts', args: { action: 'recall' } });
    assert.ok(registry.executeNow({ skill: 'park_thoughts', args: { action: 'recall' } }).message.indexOf('没有寄存') !== -1);
  });
});

test('morning_checkin reviews last night and hands back parked thoughts once', () => {
  withWx({}, () => {
    const morning = new Date('2026-10-13T08:00:00').getTime();
    // 新用户：温和兜底不报错
    assert.ok(registry.executeNow({ skill: 'morning_checkin', args: {} }, morning).message.indexOf('还没补上') !== -1);
    storage.write(storage.KEYS.sleep, [{ nightDate: '10月13日', bedTime: '23:30', wakeTime: '07:10', duration: '7小时40分', feeling: 4 }]);
    registry.executeNow({ skill: 'park_thoughts', args: { text: '明天的组会汇报' } });
    const outcome = registry.executeNow({ skill: 'morning_checkin', args: {} }, morning);
    assert.equal(outcome.status, 'executed');
    assert.ok(outcome.message.indexOf('23:30') !== -1);
    assert.ok(outcome.message.indexOf('07:10') !== -1);
    assert.ok(outcome.message.indexOf('明天的组会汇报') !== -1);
    // 心事还给用户后不再重复出现
    assert.equal(storage.read(storage.KEYS.agentThoughts, []).length, 0);
    assert.equal(registry.executeNow({ skill: 'morning_checkin', args: {} }, morning).message.indexOf('明天的组会汇报'), -1);
  });
});

test('availability windows gate skills with a graceful redirect', () => {
  withWx({}, () => {
    const night = new Date('2026-10-12T22:00:00').getTime();
    const noon = new Date('2026-10-12T14:00:00').getTime();
    const morning = new Date('2026-10-13T08:00:00').getTime();
    // 晨间回顾：清晨之外由技能自己说明，run 与 executeNow 都拦截
    const early = registry.executeNow({ skill: 'morning_checkin', args: {} }, night);
    assert.equal(early.status, 'unavailable');
    assert.ok(early.message.indexOf('清晨') !== -1);
    assert.equal(registry.run({ skill: 'morning_checkin', args: {} }, night).status, 'unavailable');
    assert.equal(registry.executeNow({ skill: 'morning_checkin', args: {} }, morning).status, 'executed');
    // 入睡引导：夜里开放（含跨午夜），白天转向环境声或呼吸
    const guided = registry.run({ skill: 'bedtime_guide', args: {} }, noon);
    assert.equal(guided.status, 'unavailable');
    assert.ok(guided.message.indexOf('环境声') !== -1);
    assert.equal(registry.executeNow({ skill: 'bedtime_guide', args: {} }, night).status, 'executed');
    assert.equal(registry.executeNow({ skill: 'bedtime_guide', args: {} }, new Date('2026-10-13T01:00:00').getTime()).status, 'executed');
    // 边界：18:00 进入、06:00 退出
    assert.equal(registry.executeNow({ skill: 'bedtime_guide', args: {} }, new Date('2026-10-12T18:00:00').getTime()).status, 'executed');
    assert.equal(registry.executeNow({ skill: 'bedtime_guide', args: {} }, new Date('2026-10-13T06:00:00').getTime()).status, 'unavailable');
    // 无窗口的技能不受影响
    assert.equal(registry.run({ skill: 'bedtime_pledge', args: { time: '23:30' } }, noon).status, 'needConfirm');
  });
});

test('remember can read back the facts it was asked to keep', () => {
  withWx({}, () => {
    const empty = registry.executeNow({ skill: 'remember', args: { action: 'list' } });
    assert.equal(empty.status, 'executed');
    assert.ok(empty.message.indexOf('你还没让我记过什么') !== -1);
    registry.executeNow({ skill: 'remember', args: { fact: '周三下午有答辩' } });
    registry.executeNow({ skill: 'remember', args: { fact: '在戒咖啡' } });
    const listed = registry.executeNow({ skill: 'remember', args: { action: 'list' } });
    assert.ok(listed.message.indexOf('周三下午有答辩') !== -1);
    assert.ok(listed.message.indexOf('在戒咖啡') !== -1);
  });
});

const SAMPLE_ARGS = {
  play_sound: { sound: 'rain', minutes: 15 },
  stop_sound: {},
  journal: { items: ['测试一条'] },
  dream_log: { items: ['梦见大海'] },
  park_thoughts: { text: '一件心事' },
  morning_checkin: {},
  remember: { fact: '测试记忆' },
  bedtime_pledge: { time: '23:30' },
  wake_me: { time: '07:30' },
  bedtime_guide: { script: 'night' }
};

test('every skill writes only inside its declared scope', () => {
  const written = [];
  global.wx = {
    getStorageSync: () => '',
    setStorageSync: (key) => { written.push(key); return true; }
  };
  global.getApp = () => ({ playSound() {}, pauseSound() {} });
  try {
    registry.DEFINITIONS.forEach((skill) => {
      assert.ok(Array.isArray(skill.writes), `${skill.name} should declare writes`);
      assert.ok(SAMPLE_ARGS[skill.name], `${skill.name} needs sample args in the audit`);
      written.length = 0;
      skill.execute(SAMPLE_ARGS[skill.name]);
      written.forEach((key) => {
        assert.ok(skill.writes.indexOf(key) !== -1, `${skill.name} wrote undeclared key ${key}`);
      });
    });
  } finally {
    delete global.wx;
    delete global.getApp;
  }
});

test('skill metadata stays in sync with the settings page copy', () => {
  const settingsSource = fs.readFileSync(path.resolve(__dirname, '../pages/night-settings/index.js'), 'utf8');
  registry.DEFINITIONS.forEach((skill) => {
    assert.ok(skill.label, skill.name);
    assert.ok(skill.prompt.indexOf(skill.name) !== -1, `${skill.name} prompt should name itself`);
    assert.ok(settingsSource.indexOf(`${skill.name}:`) !== -1, `${skill.name} missing help copy in night-settings`);
  });
});
