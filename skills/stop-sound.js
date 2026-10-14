// 技能：停止环境声播放。
module.exports = {
  name: 'stop_sound',
  label: '停止播放',
  prompt: [
    'stop_sound：用户想关掉、停止声音或觉得不用再放了时调用。',
    '参数：{"skill":"stop_sound","args":{}}'
  ].join('\n'),
  needsResult: false,
  writes: [], // 只控制播放器，不写入本机数据
  execute() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (!app || typeof app.pauseSound !== 'function') return { ok: false, message: '当前环境暂时无法控制声音' };
    try {
      app.pauseSound();
    } catch (error) {
      return { ok: false, message: '停止没有成功，可以稍后再试' };
    }
    return { ok: true, message: '已停止播放，今晚安静地睡吧' };
  }
};
