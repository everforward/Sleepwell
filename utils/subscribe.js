// 微信订阅消息授权：自动任务「到点提醒」的通道。
// 模板 ID 需在小程序后台「订阅消息」申请后填入 utils/constants.js 的 REMINDER_TMPL_IDS；
// 模板未配置或环境不支持时返回 unavailable，由页面降级为「打开夜喵时提醒」。

const { REMINDER_TMPL_IDS } = require('./constants');

const REMINDER_LABELS = {
  bedtime: '到点提醒你睡觉',
  wake: '早上叫你起床'
};

function labelFor(kinds) {
  const labels = (kinds || []).map((kind) => REMINDER_LABELS[kind]).filter(Boolean);
  return labels.length ? labels.join('、') : '到点提醒你';
}

function templateIds(kinds) {
  return (kinds || []).map((kind) => REMINDER_TMPL_IDS[kind]).filter(Boolean);
}

// 必须在用户点击回调里调用。done({ ok, accepted?, unavailable? })。
function request(kinds, done) {
  const callback = typeof done === 'function' ? done : () => {};
  const tmplIds = templateIds(kinds);
  if (!tmplIds.length || typeof wx === 'undefined' || typeof wx.requestSubscribeMessage !== 'function') {
    callback({ ok: false, unavailable: true });
    return;
  }
  wx.requestSubscribeMessage({
    tmplIds,
    success(res) {
      const accepted = tmplIds.filter((id) => res && res[id] === 'accept');
      callback({ ok: accepted.length > 0, accepted });
    },
    fail() {
      callback({ ok: false });
    }
  });
}

module.exports = { request, labelFor };
