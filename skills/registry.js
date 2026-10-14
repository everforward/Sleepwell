// 夜喵技能注册表：技能清单、system prompt 技能段、@@DO@@ 标记解析、权限检查与分发。
// 权限模型（个性化设置）：auto 直接执行 / confirm 每次确认 / off 停用（不注入 prompt，模型不会调用）。

const storage = require('../services/storage');

const DEFINITIONS = [
  require('./play-sound'),
  require('./stop-sound'),
  require('./journal'),
  require('./dream-log'),
  require('./park-thoughts'),
  require('./morning-checkin'),
  require('./remember'),
  require('./bedtime-pledge'),
  require('./wake-me'),
  require('./bedtime-guide')
];

const DO_MARKER = '@@DO@@';

function byName(name) {
  return DEFINITIONS.find((item) => item.name === name) || null;
}

// 读取个性化权限，未知技能或读取失败时视为 off。
function getPermission(name) {
  const skill = byName(name);
  if (!skill) return 'off';
  try {
    const settings = storage.getSettings();
    const saved = settings.skillPermissions && settings.skillPermissions[name];
    return saved === 'auto' || saved === 'confirm' ? saved : 'off';
  } catch (error) {
    return 'off';
  }
}

function setPermission(name, value) {
  if (!byName(name) || ['auto', 'confirm', 'off'].indexOf(value) === -1) return null;
  const settings = storage.getSettings();
  const next = Object.assign({}, settings, {
    skillPermissions: Object.assign({}, settings.skillPermissions, { [name]: value })
  });
  storage.saveSettings(next);
  return next;
}

// 生成注入 system prompt 的技能清单段；off 的技能不出现在清单里。
function buildSkillPromptSection() {
  const usable = DEFINITIONS.filter((item) => getPermission(item.name) !== 'off');
  if (!usable.length) {
    return '你没有任何可调用的技能，也不要假装执行过任何操作；涉及播放声音或写日记的请求，直接说明暂时做不到即可。';
  }
  return [
    '你可以调用以下技能帮用户做事。需要调用时，在回复正文之后另起一行，严格输出标记与一行 JSON（不使用代码块包裹）：',
    DO_MARKER + '{"skill":"play_sound","args":{"sound":"rain","minutes":15}}',
    '可用技能：',
    usable.map((item) => item.prompt).join('\n\n'),
    '技能调用规则（必须严格遵守）：',
    '- 你自己不能直接做任何事。只有输出技能标记的操作会被真正执行；没有输出标记，就什么都没有发生。',
    '- 因此绝对禁止口头假装执行：不能说“已为你播放”“已经关掉了”“换成微风了”这类话，除非同一条回复末尾确实输出了对应的技能标记。',
    '- 用户明确要求播放某个声音、切换声音（如“换成微风”）或停止声音时，必须调用对应技能，不要只用文字回应。',
    '- 用户要求停止或关闭声音时调用 stop_sound，此时不要输出推荐卡片。',
    '- 技能标记与推荐标记（@@REC@@）互斥，一次回复最多输出其中一个；只是在陪用户聊天时不要调用技能。'
  ].join('\n');
}

// 从模型完整输出中拆出 @@DO@@ 技能调用；JSON 未闭合时返回 null（流式期间继续等待）。
function parseSkillCall(text) {
  const index = text.indexOf(DO_MARKER);
  if (index === -1) return null;
  const payload = text.slice(index + DO_MARKER.length).trim();
  let end = -1;
  for (let i = 0, depth = 0, started = false; i < payload.length; i += 1) {
    const ch = payload[i];
    if (ch === '{') { depth += 1; started = true; }
    else if (ch === '}') { depth -= 1; }
    if (started && depth === 0) { end = i + 1; break; }
  }
  if (end === -1) return null; // JSON 尚未闭合
  try {
    const parsed = JSON.parse(payload.slice(0, end));
    if (!parsed || typeof parsed.skill !== 'string') return { invalid: true };
    return { skill: parsed.skill, args: parsed.args || {} };
  } catch (error) {
    return { invalid: true };
  }
}

// 可用性边界：技能可声明开放时段（from/to 为小时，from > to 表示跨午夜）。
function withinWindow(skill, nowMs) {
  const availability = skill.availability;
  if (!availability || !availability.windows || !availability.windows.length) return true;
  const hour = new Date(nowMs || Date.now()).getHours();
  return availability.windows.some((item) => (
    item.from <= item.to ? hour >= item.from && hour < item.to : hour >= item.from || hour < item.to
  ));
}

function unavailableOutcome(skill) {
  const outside = skill.availability && skill.availability.outside;
  return { status: 'unavailable', message: outside || '现在还不适合做这个，晚一点再来找我吧。' };
}

// 执行技能（权限应已由调用方确认）。返回 { status, message, followups, action }。
// status: executed / needConfirm / off / unknown / failed / unavailable
function run(call, nowMs) {
  if (!call || !call.skill) return { status: 'unknown', message: '' };
  const skill = byName(call.skill);
  if (!skill) return { status: 'unknown', message: '' };
  const permission = getPermission(call.skill);
  if (permission === 'off') return { status: 'off', message: '这个能力已停用，可在设置中开启' };
  if (!withinWindow(skill, nowMs)) return unavailableOutcome(skill);
  if (permission === 'confirm') return { status: 'needConfirm', message: '' };
  return executeNow(call, nowMs);
}

function executeNow(call, nowMs) {
  const skill = byName(call && call.skill);
  if (!skill) return { status: 'unknown', message: '' };
  if (!withinWindow(skill, nowMs)) return unavailableOutcome(skill);
  const outcome = skill.execute(call.args);
  return outcome && outcome.ok
    ? { status: 'executed', message: outcome.message, followups: outcome.followups || null, action: outcome.action || null }
    : { status: 'failed', message: (outcome && outcome.message) || '执行没有成功' };
}

function confirmText(call) {
  const skill = byName(call && call.skill);
  const label = skill ? skill.label : '这个操作';
  const detail = call && call.args
    ? Object.keys(call.args).map((key) => `${key}: ${String(call.args[key])}`).join('，')
    : '';
  return `夜喵想${label}${detail ? `（${detail}）` : ''}，要现在执行吗？`;
}

module.exports = {
  DEFINITIONS,
  DO_MARKER,
  byName,
  getPermission,
  setPermission,
  buildSkillPromptSection,
  parseSkillCall,
  run,
  executeNow,
  confirmText
};
