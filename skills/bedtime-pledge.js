// 技能：和夜喵约定就寝时间。写入本机任务；到点提醒走微信订阅消息（未配置时打开小程序补发）。
const storage = require('../services/storage');
const tasks = require('../services/agent-tasks');

module.exports = {
  name: 'bedtime_pledge',
  label: '约定就寝时间',
  prompt: [
    'bedtime_pledge：用户说今晚想几点睡、要早睡、让你到点提醒睡觉、和你拉钩约定时调用。',
    '参数：{"skill":"bedtime_pledge","args":{"time":"23:30","note":"明天早八"}}',
    'time 必须是 24 小时制 HH:MM；note 是用户提到的原因，没有就省略。'
  ].join('\n'),
  needsResult: false,
  writes: [storage.KEYS.agentTasks],
  execute(args) {
    const input = args || {};
    const task = tasks.createTask({ kind: 'bedtime', time: input.time, note: input.note });
    if (!task) return { ok: false, message: '没听清几点睡，再说一次时间吧，比如 23:30。' };
    const because = task.note ? `，因为${task.note}` : '';
    return {
      ok: true,
      message: `拉钩：今晚 ${task.time} 睡觉${because}。到点夜喵会来喊你。`,
      action: { type: 'subscribe', kinds: ['bedtime'] }
    };
  }
};
