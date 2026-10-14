// 技能：入睡引导。先说出第一段，其余段落交给页面按节奏逐段放出（followups），
// 用户随时开口说话即打断。未来安眠曲 / 听书沿用同一套逐段机制。
const { SCRIPTS } = require('../utils/sleep-guide');

const SEGMENT_DELAY_MS = 9000;

module.exports = {
  name: 'bedtime_guide',
  label: '入睡引导',
  prompt: [
    'bedtime_guide：用户说睡不着、想让你带着入睡、想要一段引导时调用。',
    '参数：{"skill":"bedtime_guide","args":{"script":"night"}}',
    'script 只能取 night（星夜慢行）或 body（身体扫描），犹豫时用 night。',
    '调用后正文只写一句很短的开场；剩下的引导会由脚本自动接上，不要再输出推荐标记。'
  ].join('\n'),
  needsResult: false,
  writes: [],
  // 可用性边界：入睡引导只在夜里开放，白天转向环境声或呼吸练习。
  availability: {
    windows: [{ from: 18, to: 6 }],
    outside: '入睡引导留给夜里。现在想放松的话，可以让我播一段环境声，或者去做一次呼吸练习。'
  },
  execute(args) {
    const key = SCRIPTS[args && args.script] ? args.script : 'night';
    const script = SCRIPTS[key];
    const first = script.segments[0] || '';
    return {
      ok: true,
      message: `（${script.title}）${first}`,
      followups: script.segments.slice(1).map((text, index) => ({
        delayMs: (index + 1) * SEGMENT_DELAY_MS,
        text
      }))
    };
  }
};
