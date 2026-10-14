// 技能：设定明早的温柔唤醒。写入本机任务；到点提醒走微信订阅消息（未配置时打开小程序补发）。
const storage = require('../services/storage');
const tasks = require('../services/agent-tasks');

module.exports = {
  name: 'wake_me',
  label: '设定温柔唤醒',
  prompt: [
    'wake_me：用户让你明早叫TA起床、想设一个温柔唤醒时调用。',
    '参数：{"skill":"wake_me","args":{"time":"07:30","note":"早八"}}',
    'time 必须是 24 小时制 HH:MM；note 是用户提到的原因，没有就省略。'
  ].join('\n'),
  needsResult: false,
  writes: [storage.KEYS.agentTasks],
  execute(args) {
    const input = args || {};
    const task = tasks.createTask({ kind: 'wake', time: input.time, note: input.note });
    if (!task) return { ok: false, message: '没听清几点叫你，再说一次时间吧，比如 07:30。' };
    const because = task.note ? `（${task.note}）` : '';
    return {
      ok: true,
      message: `好，明早 ${task.time} 夜喵轻轻叫你${because}。`,
      action: { type: 'subscribe', kinds: ['wake'] }
    };
  }
};
