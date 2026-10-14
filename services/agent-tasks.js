// 夜喵的自动任务：就寝约定（bedtime）与温柔唤醒（wake）。
// 任务只保存在本机；真正「到点」依赖微信订阅消息（需要服务端发送）。
// 没有订阅通道时用「打开夜喵时补发」兜底：到点没见到你，就等你回来再喊。

const storage = require('./storage');

const KINDS = ['bedtime', 'wake'];
const LIMIT = 20;
// 过了窗口再打开小程序就不再补发，避免早上还在喊你睡觉。
const CATCH_UP = {
  bedtime: { windowMs: 3 * 60 * 60 * 1000, untilHour: 5 },
  wake: { windowMs: 4 * 60 * 60 * 1000, untilHour: 12 }
};

function readTasks() {
  const list = storage.read(storage.KEYS.agentTasks, []);
  return Array.isArray(list) ? list : [];
}

function writeTasks(list) {
  return storage.write(storage.KEYS.agentTasks, list.slice(0, LIMIT));
}

// 接受 23:30 / 23：30 / 23点30分 / 11点半 / 7点 / 2330 等写法，返回补零的 HH:MM；无法识别返回空串。
function normalizeTime(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  let hour = -1;
  let minute = -1;
  const digits = text.match(/^(\d{2})(\d{2})$/);
  if (digits) {
    hour = Number(digits[1]);
    minute = Number(digits[2]);
  } else {
    const match = text.match(/^(\d{1,2})\s*[:：.点时的]?\s*(半|\d{1,2})?\s*分?$/);
    if (!match) return '';
    hour = Number(match[1]);
    minute = match[2] === '半' ? 30 : match[2] ? Number(match[2]) : 0;
  }
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function nextDueAt(time, nowMs) {
  const [hour, minute] = time.split(':').map(Number);
  const now = new Date(nowMs || Date.now());
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
  return due.getTime();
}

function sanitizeNote(note) {
  return typeof note === 'string' ? note.trim().slice(0, 20) : '';
}

// 建立约定任务；同类型未完成的旧约定会被覆盖（重新拉钩）。
function createTask(input, nowMs) {
  const source = input || {};
  if (KINDS.indexOf(source.kind) === -1) return null;
  const time = normalizeTime(source.time);
  if (!time) return null;
  const now = nowMs || Date.now();
  const task = {
    id: `task-${now}-${source.kind}`,
    kind: source.kind,
    time,
    note: sanitizeNote(source.note),
    createdAt: now,
    dueAt: nextDueAt(time, now),
    status: 'pending'
  };
  const rest = readTasks().filter((item) => !(item.kind === task.kind && item.status === 'pending'));
  writeTasks([task].concat(rest));
  return task;
}

function pending() {
  return readTasks().filter((item) => item.status === 'pending');
}

function noteSuffix(task) {
  return task.note ? `你当时说要「${task.note}」。` : '';
}

function buildCatchUpText(task, nowMs) {
  const late = nowMs - task.dueAt > 60 * 60 * 1000;
  if (task.kind === 'bedtime') {
    return late
      ? `已经过了我们说好的 ${task.time}。没关系，现在放下手机还来得及。${noteSuffix(task)}`
      : `到点啦——我们说好 ${task.time} 睡的，夜喵来喊你了。${noteSuffix(task)}`;
  }
  return late
    ? `早上好呀，我们说好 ${task.time} 叫你。昨晚睡得怎么样？${noteSuffix(task)}`
    : `${task.time} 到啦，夜喵轻轻叫你一声。醒了吗？${noteSuffix(task)}`;
}

// 打开小程序时调用：到点且仍在合理窗口内的任务补发一次；错过窗口的任务安静作废。
// 返回 [{ id, kind, text }]，并把任务状态推进到位（补发即送达，不重复）。
function takeDueCatchUp(nowMs) {
  const now = nowMs || Date.now();
  const delivered = [];
  const list = readTasks();
  let changed = false;
  list.forEach((task) => {
    if (task.status !== 'pending' || !task.dueAt || task.dueAt > now) return;
    const rule = CATCH_UP[task.kind];
    const hour = new Date(now).getHours();
    const withinWindow = Boolean(rule) && now - task.dueAt <= rule.windowMs && hour < rule.untilHour;
    task.status = withinWindow ? 'delivered' : 'expired';
    task.statusAt = now;
    changed = true;
    if (withinWindow) delivered.push({ id: task.id, kind: task.kind, text: buildCatchUpText(task, now) });
  });
  if (changed) writeTasks(list);
  return delivered;
}

// 待完成约定的一句话摘要，供 system prompt 注入。
function pendingBrief() {
  return pending().map((task) => {
    const note = task.note ? `（${task.note}）` : '';
    return task.kind === 'bedtime'
      ? `你们约定今晚 ${task.time} 睡觉${note}`
      : `你们约定明早 ${task.time} 叫用户起床${note}`;
  });
}

module.exports = {
  KINDS,
  normalizeTime,
  nextDueAt,
  createTask,
  pending,
  pendingBrief,
  buildCatchUpText,
  takeDueCatchUp
};
