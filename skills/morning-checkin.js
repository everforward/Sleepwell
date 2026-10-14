// 技能：晨间回顾。把昨晚的睡眠记录和寄存在夜喵这里的心事，在早上轻轻还给用户。
const storage = require('../services/storage');
const thoughts = require('../services/agent-thoughts');

function lastNightLine() {
  const records = storage.read(storage.KEYS.sleep, []);
  const latest = Array.isArray(records) && records.length ? records[0] : null;
  if (!latest || (!latest.bedTime && !latest.wakeTime)) return '昨晚的睡眠记录还没补上。';
  const bed = latest.bedTime || '—';
  const wake = latest.wakeTime || '—';
  const duration = latest.duration ? `，睡了${latest.duration}` : '';
  return `昨晚 ${bed} 上床、${wake} 起床${duration}。`;
}

module.exports = {
  name: 'morning_checkin',
  label: '晨间回顾',
  prompt: [
    'morning_checkin：用户清晨打招呼（“早上好”“我醒了”）、回应夜喵的叫醒、或早上想回顾昨晚时调用。',
    '参数：{"skill":"morning_checkin","args":{}}',
    '调用后正文只写一句很短的开场白，具体的回顾内容由技能自动接上。'
  ].join('\n'),
  needsResult: false,
  writes: [storage.KEYS.agentThoughts],
  // 可用性边界：只在清晨开放；取回心事会改写寄存区，仍属声明的写入范围。
  availability: {
    windows: [{ from: 4, to: 12 }],
    outside: '晨间回顾留给清晨。现在想聊昨晚的事，直接说就好，我在。'
  },
  execute() {
    const list = thoughts.take();
    const parts = [`早上好。${lastNightLine()}`];
    if (list.length) {
      const shown = list.map((item, index) => `${index + 1}）${item.text}`).join('；');
      parts.push(`睡前你寄存在我这的事：${shown}。现在想拿回哪一件吗？`);
    } else {
      parts.push('今天想从哪件事开始，还是先慢慢醒一醒？');
    }
    return { ok: true, message: parts.join('') };
  }
};
