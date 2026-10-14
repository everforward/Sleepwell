// 技能：把用户明确要记住的事写进夜喵的记忆档案（memory.md 可见、可清除）。
const storage = require('../services/storage');
const agentMemory = require('../services/agent-memory');

module.exports = {
  name: 'remember',
  label: '记住一件事',
  prompt: [
    'remember：用户明确让你记住一件事（如“记住我周三有答辩”“帮我记着我在戒咖啡”）时调用。',
    '参数：{"skill":"remember","args":{"fact":"周三下午答辩"}}',
    'fact 用一句短话概括用户的话，不超过 40 字；不要记录密码、证件号等敏感信息。',
    '用户问“我让你记住过什么”时调用查看：{"skill":"remember","args":{"action":"list"}}'
  ].join('\n'),
  needsResult: false,
  writes: [storage.KEYS.agentFacts],
  execute(args) {
    const input = args || {};
    if (input.action === 'list') {
      const list = agentMemory.facts().slice(0, 5);
      if (!list.length) return { ok: true, message: '你还没让我记过什么。想让我记的事，说一声就好。' };
      const shown = list.map((item, index) => `${index + 1}）${item.text}`).join('；');
      return { ok: true, message: `你让我记住的事：${shown}。` };
    }
    const fact = String(input.fact || '').trim();
    if (!fact) return { ok: false, message: '没听清要记住什么，再说一次吧。' };
    const saved = agentMemory.addFact(fact);
    if (!saved) return { ok: false, message: '这次没记住，可以稍后再试。' };
    return { ok: true, message: `记住了：${saved}。以后我会在合适的时候想起它。` };
  }
};
