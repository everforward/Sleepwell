// 技能：播放环境声（轻音乐拉取）。
// 直接调用全局音频接口，不跳转页面，睡前场景零打扰。
const SOUNDS = { rain: '雨声', breeze: '微风', lake: '湖水', white: '白噪音' };
const MINUTES = [15, 30, 60];

module.exports = {
  name: 'play_sound',
  label: '播放环境声',
  prompt: [
    'play_sound：用户想听自然声音、想要背景声助眠、提到环境吵想遮蔽，或想切换正在播放的声音（如“换成微风”）时调用。',
    '参数：{"skill":"play_sound","args":{"sound":"rain|breeze|lake|white","minutes":15}}',
    'minutes 只能取 15、30、60；用户提到吵、噪音、室友时优先 white；切换声音时再次调用本技能即可。'
  ].join('\n'),
  needsResult: false,
  writes: [], // 只控制播放器，不写入本机数据
  execute(args) {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (!app || typeof app.playSound !== 'function') return { ok: false, message: '当前环境暂时无法播放声音' };
    const input = args || {};
    const sound = SOUNDS[input.sound] ? input.sound : 'breeze';
    const minutes = MINUTES.indexOf(Number(input.minutes)) !== -1 ? Number(input.minutes) : 30;
    try {
      app.playSound(sound, undefined, minutes);
    } catch (error) {
      return { ok: false, message: '播放没有成功，可以稍后再试' };
    }
    return { ok: true, message: `已为你播放${SOUNDS[sound]} · ${minutes} 分钟定时` };
  }
};
