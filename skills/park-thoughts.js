// 技能：心事寄存与取回。寄存进本机；晨间回顾或用户主动取回时原样还给你。
const storage = require('../services/storage');
const thoughts = require('../services/agent-thoughts');

module.exports = {
  name: 'park_thoughts',
  label: '寄存心事',
  prompt: [
    'park_thoughts：用户说“脑子里停不下来、有件事放不下、想先睡明天再想”、要你把心事先保管起来时调用寄存。',
    '参数：{"skill":"park_thoughts","args":{"text":"明天的组会汇报"}}',
    '用户说“把寄存的心事还给我 / 拿出来”时调用取回：{"skill":"park_thoughts","args":{"action":"recall"}}',
    'text 用用户自己的话，不超过 60 字。'
  ].join('\n'),
  needsResult: false,
  writes: [storage.KEYS.agentThoughts],
  execute(args) {
    const input = args || {};
    if (input.action === 'recall') {
      const list = thoughts.take();
      if (!list.length) return { ok: true, message: '我这没有寄存的心事。是不是都已经放下了？' };
      const shown = list.map((item, index) => `${index + 1}）${item.text}`).join('；');
      return { ok: true, message: `你寄存在我这的心事，原样还给你：${shown}。想现在聊一件，还是先放着？` };
    }
    const saved = thoughts.park(input.text);
    if (!saved) return { ok: false, message: '没听清要寄存的心事，再说一次吧。' };
    return { ok: true, message: `先把「${saved}」寄存在我这。今晚不用再想着它，想拿回时说一声就好。` };
  }
};
