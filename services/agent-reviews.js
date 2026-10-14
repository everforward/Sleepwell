// 夜喵收到的评价：赞 / 踩 + 「为什么」理由，逐条挂在消息上，可改口、可撤回。
// 与 agentFeedback（只有累计计数）互补：这里保留能读进 memory.md 的明细。

const storage = require('./storage');

const LIMIT = 30;
const REASON_MAX = 60;
const QUOTE_MAX = 24;
const VALUES = ['like', 'dislike'];

function list() {
  try {
    const stored = storage.read(storage.KEYS.agentReviews, []);
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    return [];
  }
}

function find(messageId) {
  if (!messageId) return null;
  return list().find((item) => item.messageId === messageId) || null;
}

// 写一条评价（按 messageId 合并，最新在前）：
// - value 传 '' 表示只留言不投票；非法值按 '' 处理。
// - reason / quote 传 undefined 表示保留上一次的值（改赞/踩时理由不会丢）。
// - value 与 reason 都为空则整条移除，不留下空格子。
function upsert(input) {
  const source = input || {};
  const messageId = typeof source.messageId === 'string' ? source.messageId.trim() : '';
  if (!messageId) return null;
  const previous = find(messageId);
  const value = VALUES.indexOf(source.value) >= 0 ? source.value : '';
  const reason = typeof source.reason === 'string'
    ? source.reason.trim().slice(0, REASON_MAX)
    : ((previous && previous.reason) || '');
  const quote = typeof source.quote === 'string' && source.quote.trim()
    ? source.quote.trim().slice(0, QUOTE_MAX)
    : ((previous && previous.quote) || '');
  if (!value && !reason) {
    remove(messageId);
    return null;
  }
  const entry = { messageId, value, reason, quote, at: Date.now() };
  const rest = list().filter((item) => item.messageId !== messageId);
  if (!storage.write(storage.KEYS.agentReviews, [entry].concat(rest).slice(0, LIMIT))) return null;
  return entry;
}

function remove(messageId) {
  if (!messageId) return false;
  const current = list();
  const rest = current.filter((item) => item.messageId !== messageId);
  if (rest.length === current.length) return false;
  return storage.write(storage.KEYS.agentReviews, rest);
}

function valueLabel(value) {
  if (value === 'like') return '赞';
  if (value === 'dislike') return '踩';
  return '留言';
}

module.exports = { list, find, upsert, remove, valueLabel };
