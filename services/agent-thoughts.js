// 心事寄存：睡不着时把心事交给夜喵保管，白天（晨间回顾）或用户主动取回时原样还回去。
const storage = require('./storage');

const LIMIT = 20;
const TEXT_MAX = 60;
const RECALL_LIMIT = 3;

function parked() {
  try {
    const list = storage.read(storage.KEYS.agentThoughts, []);
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return [];
  }
}

function park(text) {
  const trimmed = typeof text === 'string' ? text.trim().slice(0, TEXT_MAX) : '';
  if (!trimmed) return '';
  const list = parked();
  list.unshift({ id: `thought-${Date.now()}`, at: Date.now(), text: trimmed });
  return storage.write(storage.KEYS.agentThoughts, list.slice(0, LIMIT)) ? trimmed : '';
}

// 取回最近的几条：取走的移出寄存区，剩下的继续放在夜喵这里。
function take(limit) {
  const list = parked();
  const count = Number(limit) > 0 ? Number(limit) : RECALL_LIMIT;
  const moved = list.slice(0, count);
  if (moved.length) storage.write(storage.KEYS.agentThoughts, list.slice(moved.length));
  return moved;
}

module.exports = { parked, park, take, RECALL_LIMIT };
