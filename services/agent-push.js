// 夜喵卡片推送协议：AI 推荐书 / 助眠声 / 功能时，在回答下方附一组可点卡片（@@PUSH@@）；
// 需要用户在选项里拍板时，附一排可点选项（@@ASK@@）。
// 模型只在标记后输出极简 JSON（kind + id），封面、文案与动作全部由本机目录装配，
// 模型无法杜撰卡片内容，也无法触发目录之外的操作。

const registry = require('../skills/registry');

const PUSH_MARKER = '@@PUSH@@';
const ASK_MARKER = '@@ASK@@';
const MAX_CARDS = 3;
const MAX_OPTIONS = 4;
const MAX_QUESTION_LEN = 30;
const MAX_OPTION_LEN = 12;
const SOUND_COVER = '/assets/agent/moon-lake.jpg';

const GOLD = '#e8c887';

function glyph(body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${GOLD}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// 功能卡的图标：与对话页内联 SVG 同一支画笔（24 视框、1.6 圆头描边）。
const FEATURE_GLYPHS = {
  recall: glyph('<path d="M5.8 9.2h9.4a3.9 3.9 0 1 1 0 7.8H9.6"/><path d="M9.2 5.8 5.8 9.2l3.4 3.4"/>'),
  guide: glyph('<path d="M13.9 4.4a7.2 7.2 0 1 0 5.8 11.3 8.5 8.5 0 0 1-5.8-11.3Z"/>'),
  journal: glyph('<rect x="6.2" y="4.6" width="11.6" height="14.8" rx="2.6"/><path d="M9.4 9.2h5.2"/><path d="M9.4 12.6h5.2"/><path d="M9.4 16h3"/>'),
  dream: glyph('<path d="M15.2 4.6a6.8 6.8 0 1 0 4.3 8.6 7.9 7.9 0 0 1-4.3-8.6Z"/><path d="M6 8.4l.5 1.3 1.3.5-1.3.5L6 12l-.5-1.3-1.3-.5 1.3-.5Z"/>')
};

// 书中技能目录：id 即 @@PUSH@@ 数组里引用的键；learn 是点「开始学习」后替用户开口的那句话。
const BOOKS = [
  { id: 'brave', title: '被讨厌的勇气', author: '岸见一郎 · 古贺史健', tag: '边界感练习', desc: '学会课题分离，建立边界感', learn: '我想学《被讨厌的勇气》里的「课题分离」' },
  { id: 'frog', title: '蛤蟆先生去看心理医生', author: '罗伯特·戴博德', tag: '情绪识别', desc: '觉察情绪，与自己和解', learn: '我想学《蛤蟆先生去看心理医生》里的「情绪觉察」' },
  { id: 'beyond', title: '自卑与超越', author: '阿尔弗雷德·阿德勒', tag: '自我接纳', desc: '接纳不完美的自己，走向成长', learn: '我想学《自卑与超越》里的「自我接纳」' }
];

// 功能目录：skill 字段用于按设置过滤（off 的不进 prompt）；action 决定点按后的去向。
const FEATURES = [
  {
    id: 'park', title: '取回寄存的心事', tag: '助眠练习', desc: '把上次交给我保管的心事拿回来，聊开或继续放下。',
    icon: 'recall', actionLabel: '去取回', hint: '用户提过寄存心事、或说心里有件事放不下时',
    skill: 'park_thoughts', action: { type: 'skill', call: { skill: 'park_thoughts', args: { action: 'recall' } } }
  },
  {
    id: 'guide', title: '星夜慢行', tag: '助眠练习', desc: '5 分钟轻柔引导，带你慢慢滑进睡意。',
    icon: 'guide', actionLabel: '开始引导', hint: '夜里用户想让你带着入睡时',
    skill: 'bedtime_guide', action: { type: 'skill', call: { skill: 'bedtime_guide', args: { script: 'night' } } }
  },
  {
    id: 'journal', title: '记下今晚的小温暖', tag: '就寝仪式', desc: '睡前记一件温暖的小事，留给明天的自己。',
    icon: 'journal', actionLabel: '去记录', hint: '用户表达了感恩、或想留个纪念时',
    skill: '', action: { type: 'say', text: '我想记下今晚的一件温暖小事' }
  },
  {
    id: 'dream', title: '趁热记下这个梦', tag: '就寝仪式', desc: '梦最好的赏味期，是刚醒来那几分钟。',
    icon: 'dream', actionLabel: '记个梦', hint: '用户说做了梦、怕忘记时',
    skill: '', action: { type: 'say', text: '我想把刚才的梦记下来' }
  }
];

const SOUNDS = {
  rain: { title: '雨声 · 慢慢来', detail: '顺着雨声慢下来' },
  breeze: { title: '微风 · 轻轻吹', detail: '像窗缝里溜进来的一点风' },
  lake: { title: '湖水 · 轻轻荡', detail: '水面一样平稳的起伏' },
  white: { title: '白噪音 · 遮住嘈杂', detail: '环境吵的时候也挡得住' }
};

function soundCard(entry) {
  const sound = SOUNDS[String(entry.sound || '')] ? String(entry.sound) : null;
  if (!sound) return null;
  const minutes = Number(entry.minutes) === 15 ? 15 : 30;
  return {
    kind: 'sound', id: sound, sound, minutes,
    title: SOUNDS[sound].title,
    detail: `${minutes} 分钟定时 · ${SOUNDS[sound].detail}`,
    tag: '助眠声', cover: SOUND_COVER, actionLabel: '播放'
  };
}

function bookCard(entry) {
  const book = BOOKS.find((item) => item.id === entry.id);
  if (!book) return null;
  return {
    kind: 'book', id: book.id, title: book.title, detail: book.desc,
    tag: book.tag, cover: `/assets/books/${book.id}.jpg`, actionLabel: '开始学习'
  };
}

function featureCard(entry) {
  const feature = FEATURES.find((item) => item.id === entry.id);
  if (!feature) return null;
  return {
    kind: 'feature', id: feature.id, title: feature.title, detail: feature.desc,
    tag: feature.tag, cover: FEATURE_GLYPHS[feature.icon], actionLabel: feature.actionLabel
  };
}

// 校验模型给出的卡片数组：只认目录内的 kind 与 id，最多 3 张，非法项静默丢弃。
function sanitizePush(raw) {
  if (!Array.isArray(raw)) return null;
  const cards = [];
  raw.slice(0, MAX_CARDS).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const card = entry.kind === 'sound' ? soundCard(entry) : entry.kind === 'book' ? bookCard(entry) : entry.kind === 'feature' ? featureCard(entry) : null;
    if (card) cards.push(card);
  });
  return cards.length ? cards : null;
}

// 校验模型的选项提问：问题 ≤30 字、2-4 个选项（去重、每个 ≤12 字），不满足则整体作废。
function sanitizeAsk(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const question = typeof raw.question === 'string' ? raw.question.trim().slice(0, MAX_QUESTION_LEN) : '';
  if (!question) return null;
  const options = [];
  (Array.isArray(raw.options) ? raw.options : []).forEach((option) => {
    const text = typeof option === 'string' ? option.trim().slice(0, MAX_OPTION_LEN) : '';
    if (text && options.indexOf(text) === -1 && options.length < MAX_OPTIONS) options.push(text);
  });
  if (options.length < 2) return null;
  return { question, options };
}

// 卡片 → 可执行动作。只在目录里解析，保证模型杜撰的卡片不会变成真操作。
function resolveCardAction(card) {
  if (!card || typeof card !== 'object') return null;
  if (card.kind === 'sound') {
    if (!SOUNDS[String(card.sound || '')]) return null;
    return { type: 'skill', call: { skill: 'play_sound', args: { sound: card.sound, minutes: Number(card.minutes) === 15 ? 15 : 30 } } };
  }
  if (card.kind === 'book') {
    const book = BOOKS.find((item) => item.id === card.id);
    return book ? { type: 'say', text: book.learn } : null;
  }
  if (card.kind === 'feature') {
    const feature = FEATURES.find((item) => item.id === card.id);
    if (!feature) return null;
    if (feature.action.type === 'skill') {
      return { type: 'skill', call: { skill: feature.action.call.skill, args: Object.assign({}, feature.action.call.args) } };
    }
    return { type: 'say', text: feature.action.text };
  }
  return null;
}

// 注入 system prompt 的卡片推送段：可用清单按技能权限实时过滤，off 的能力模型不会知道。
function buildPromptSection() {
  const usableFeatures = FEATURES.filter((item) => !item.skill || registry.getPermission(item.skill) !== 'off');
  const lines = [
    '卡片推送与选项提问（@@PUSH@@ / @@ASK@@ 与 @@REC@@、@@DO@@ 互斥，一次回复最多一个标记）：',
    '- 推荐「书 / 助眠声 / 功能」，或一次推荐多个东西时，正文之后另起一行输出标记与一行 JSON 数组（不使用代码块包裹）：',
    PUSH_MARKER + '[{"kind":"book","id":"brave"}]',
    '- 数组 1-3 项，每项只给 kind 与 id，卡片文案与按钮由客户端装配，不要自写。',
    '- 可推的书（书是慢功夫，一段对话最多认真推一本）：',
    '  ' + BOOKS.map((item) => `${item.id}：${item.title} —— ${item.desc}`).join('\n  ')
  ];
  if (usableFeatures.length) {
    lines.push('- 可推的功能：');
    lines.push('  ' + usableFeatures.map((item) => `${item.id}：${item.title}（${item.hint}）`).join('\n  '));
  }
  if (registry.getPermission('play_sound') !== 'off') {
    lines.push('- 助眠声：kind 为 "sound"，如 {"kind":"sound","sound":"white","minutes":30}；sound 取 rain / breeze / lake / white，minutes 取 15 / 30。单个声音陪着入睡仍优先用 @@REC@@ 收尾，只有和其他卡片一起推、或作为「挡住噪音」的功能推荐时才放进数组。');
  }
  lines.push(
    '- 需要用户在几个选项里拍板时才提问，正文之后另起一行输出：',
    ASK_MARKER + '{"question":"想先从哪件事开始？","options":["聊聊心事","听点声音","先睡一会"]}',
    '- options 2-4 个、每个不超过 12 个字，question 不超过 30 字；倾听阶段不要推卡片也不要提问。'
  );
  return lines.join('\n');
}

module.exports = {
  PUSH_MARKER,
  ASK_MARKER,
  BOOKS,
  FEATURES,
  SOUNDS,
  sanitizePush,
  sanitizeAsk,
  resolveCardAction,
  buildPromptSection
};
