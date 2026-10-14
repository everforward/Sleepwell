// 小程序内的消息中心：到点的就寝 / 唤醒提醒在这里留档，可回看、可标已读。
// 微信订阅消息不可用时，这是「到点提醒」在本机内的落点。

const storage = require('./storage');

const LIMIT = 50;
const KIND_LABELS = { bedtime: '就寝提醒', wake: '晨间唤醒' };

function list() {
  const value = storage.read(storage.KEYS.agentMessages, []);
  return Array.isArray(value) ? value : [];
}

function write(items) {
  return storage.write(storage.KEYS.agentMessages, items.slice(0, LIMIT));
}

// 追加消息（最新在前）。入参按送达顺序给出，后送达的显示在更上面。
function push(items) {
  const valid = (items || []).filter((item) => item && item.text);
  if (!valid.length) return 0;
  const now = Date.now();
  const next = valid.map((item, index) => ({
    id: item.id || `msg-${now}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    kind: item.kind === 'wake' ? 'wake' : 'bedtime',
    text: String(item.text),
    at: item.at || now,
    read: false
  }));
  write(next.reverse().concat(list()));
  return next.length;
}

function unreadCount() {
  return list().filter((item) => !item.read).length;
}

function markRead(id) {
  const items = list();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1 || items[index].read) return false;
  items[index] = Object.assign({}, items[index], { read: true });
  write(items);
  return true;
}

function markAllRead() {
  const items = list();
  const count = items.filter((item) => !item.read).length;
  if (!count) return 0;
  write(items.map((item) => (item.read ? item : Object.assign({}, item, { read: true }))));
  return count;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

// 列表时间展示：今天 23:30 / 昨天 07:30 / 10 月 12 日 23:30
function whenLabel(at, nowMs) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date(nowMs || Date.now());
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, now)) return `今天 ${clock}`;
  if (sameDay(date, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return `昨天 ${clock}`;
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${clock}`;
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || '夜喵留言';
}

module.exports = {
  LIMIT,
  list,
  push,
  unreadCount,
  markRead,
  markAllRead,
  whenLabel,
  kindLabel
};
