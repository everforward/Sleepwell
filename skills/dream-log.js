// 技能：记下梦境。走感恩日记的存储端口，用 kind 标记区分（日记页与记忆档案都可见）。
const storage = require('../services/storage');

function normalizeItems(args) {
  const raw = args && (Array.isArray(args.items) ? args.items : [args.items]);
  if (!raw) return [];
  return raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 40))
    .slice(0, 3);
}

module.exports = {
  name: 'dream_log',
  label: '记下梦境',
  prompt: [
    'dream_log：用户说做了梦、梦见什么、半夜醒来想趁还没忘赶紧记下来时调用。',
    '参数：{"skill":"dream_log","args":{"items":["在海上飞，水很亮","猫开口说话了"]}}',
    'items 用用户自己的话，每条不超过 40 字，最多 3 条。'
  ].join('\n'),
  needsResult: false,
  writes: [storage.KEYS.journal],
  execute(args) {
    const items = normalizeItems(args);
    if (!items.length) return { ok: false, message: '没有听到想记的梦，再讲讲吧。' };
    try {
      const entries = storage.read(storage.KEYS.journal, []);
      const now = new Date();
      entries.unshift({
        id: `dream-${Date.now()}`,
        createdAt: Date.now(),
        date: `${now.getMonth() + 1} 月 ${now.getDate()} 日`,
        items,
        kind: 'dream'
      });
      if (!storage.write(storage.KEYS.journal, entries.slice(0, 30))) {
        return { ok: false, message: '梦没有存得住，可以稍后再试。' };
      }
    } catch (error) {
      return { ok: false, message: '梦没有存得住，可以稍后再试。' };
    }
    return { ok: true, message: `梦已经收好了：${items.join('；')}。醒来会看到它。` };
  }
};
