// 技能：记录感恩日记。
// 把用户口述的感恩/温暖内容写入本地日记，复用日记页的存储契约。
const storage = require('../services/storage');

function normalizeItems(args) {
  const raw = args && (Array.isArray(args.items) ? args.items : [args.items]);
  if (!raw) return [];
  return raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 24))
    .slice(0, 3);
}

module.exports = {
  name: 'journal',
  label: '记录感恩日记',
  prompt: [
    'journal：用户表达感恩、想记下今晚温暖的事或想说点什么留给明天时调用。',
    '参数：{"skill":"journal","args":{"items":["今天室友帮我带了饭","晚霞很好看"]}}',
    'items 用用户自己的话概括，每条不超过 24 字，最多 3 条。'
  ].join('\n'),
  needsResult: false,
  writes: [storage.KEYS.journal],
  execute(args) {
    const items = normalizeItems(args);
    if (!items.length) return { ok: false, message: '没有听到想记下来的内容' };
    try {
      const entries = storage.read(storage.KEYS.journal, []);
      const now = new Date();
      entries.unshift({
        id: `journal-${Date.now()}`,
        createdAt: Date.now(),
        date: `${now.getMonth() + 1} 月 ${now.getDate()} 日`,
        items
      });
      if (!storage.write(storage.KEYS.journal, entries.slice(0, 30))) {
        return { ok: false, message: '日记保存未成功，可以稍后再试' };
      }
    } catch (error) {
      return { ok: false, message: '日记保存未成功，可以稍后再试' };
    }
    return { ok: true, message: `已记入今晚的感恩日记：${items.join('；')}` };
  }
};
