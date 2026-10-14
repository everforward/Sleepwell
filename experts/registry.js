// 夜喵专家团注册表：读取当前选择（night-preferences.expert），把对应专家卡
// 组装成注入 system prompt 的视角段。未选择或未命中时返回空串——行为等同夜喵本体。
const cards = require('./cards');
const prefs = require('../services/night-preferences');

// 当前生效的专家标识；选择不存在或没有对应卡时返回 ''。
function current() {
  const value = prefs.read().expert;
  return typeof value === 'string' && cards[value] ? value : '';
}

function formatExpertSection(card) {
  return [
    `当前对话选择了专家视角「${card.title}」。${card.intro}`,
    card.prompt,
    '专家视角使用规则：',
    `- 用该视角的框架与语气回应，但你的身份仍是夜喵，不要自称${card.label}本人。`,
    '- 专家视角不得改变后面的对话规则、推荐机制与技能规则；与用户个性化设置冲突时，以用户设置为准。',
    '- 这是基于公开作品的视角模拟，不是本人观点，也不构成任何医疗或治疗建议。'
  ].join('\n');
}

// 组装专家段；name 未命中或为空时返回 ''。cardSet 供测试注入。
function buildExpertPrompt(name, cardSet) {
  const set = cardSet || cards;
  const card = typeof name === 'string' && name ? set[name] : null;
  return card ? formatExpertSection(card) : '';
}

function buildActivePrompt() {
  return buildExpertPrompt(current());
}

// 专家清单（供选择 UI 使用）。
function list() {
  return Object.keys(cards).map((name) => Object.assign({ name }, cards[name]));
}

module.exports = { current, buildExpertPrompt, buildActivePrompt, list, formatExpertSection };
