// 夜喵专属 SVG 图标：24 视框、1.6 圆头描边、每枚带一点星屑细节，呼应星穹主题。
// 以 data-URI 内联，避免包内文件格式兼容问题，源码可读可改。

const MUTED = '#8a9b9b';
const GOLD = '#e8c887';
const RED = '#c98a8a';
const INK = '#24312c';

function uri(color, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function star(color, transform) {
  return `<path${transform ? ` transform="${transform}"` : ''} d="M18.7 3.1l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6Z" fill="${color}" stroke="none"/>`;
}

const THUMB = '<path d="M7.2 10.4v9.4H5a1.9 1.9 0 0 1-1.9-1.9v-5.6A1.9 1.9 0 0 1 5 10.4h2.2Z"/><path d="M7.2 10.4 10.7 4a2.3 2.3 0 0 1 2.2 2.9l-.8 3h6.2a2 2 0 0 1 2 2.5l-1.4 5.9a2 2 0 0 1-2 1.5H7.2"/>';

const like = uri(MUTED, THUMB + star(MUTED));
const likeActive = uri(GOLD, THUMB + star(GOLD));
const dislike = uri(MUTED, `<g transform="rotate(180 12 12)">${THUMB}</g>` + star(MUTED));
const dislikeActive = uri(RED, `<g transform="rotate(180 12 12)">${THUMB}</g>` + star(RED));

const copy = (color) => uri(color, '<rect x="8.6" y="8.6" width="10.8" height="10.8" rx="3"/><path d="M15.4 5.4H8a3 3 0 0 0-3 3v7.4"/>' + star(color));
const regenerate = (color) => uri(color, '<path d="M19.8 12a7.8 7.8 0 1 1-2.3-5.5"/><path d="M19.8 4.2v4.2h-4.2"/>' + star(color));
const stop = uri(GOLD, '<rect x="7.2" y="7.2" width="9.6" height="9.6" rx="3"/>' + star(GOLD));

// —— 对话页功能图标 ——
const plus = uri(MUTED, '<path d="M12 5.6v12.8"/><path d="M5.6 12h12.8"/>' + star(MUTED));
const back = uri(MUTED, '<path d="M14.8 5.9 8.7 12l6.1 6.1"/>' + star(MUTED));
const tune = uri(MUTED, '<circle cx="12" cy="12" r="3"/><path d="M12 4.8v2.4M12 16.8v2.4M4.8 12h2.4M16.8 12h2.4M6.9 6.9l1.7 1.7M15.4 15.4l1.7 1.7M17.1 6.9l-1.7 1.7M8.6 15.4l-1.7 1.7"/>' + star(MUTED));
const sendArrow = (color) => uri(color, '<path d="M12 19.4V7.2"/><path d="M7 12.2l5-5 5 5"/>' + star(color, 'translate(-7.3 14.6) scale(.72)'));
const sendInk = sendArrow(INK);
const sendMuted = sendArrow(MUTED);

// —— 专家徽记 ——
const emblemStar = uri(GOLD, '<path d="M13.9 4.4a7.2 7.2 0 1 0 5.8 11.3 8.5 8.5 0 0 1-5.8-11.3Z"/>' + star(GOLD));
const emblemRipple = uri(GOLD, '<circle cx="12" cy="8.4" r="1.6"/><path d="M8.6 12.4c1-1.1 2.1-1.7 3.4-1.7s2.4.6 3.4 1.7"/><path d="M6.1 15.5c1.6-1.7 3.6-2.5 5.9-2.5s4.3.8 5.9 2.5"/><path d="M3.6 18.6c2.1-2.2 4.9-3.3 8.4-3.3s6.3 1.1 8.4 3.3"/>');

// —— 助眠练习与助眠声 ——
const guideNight = uri(MUTED, '<path d="M13.9 4.4a7.2 7.2 0 1 0 5.8 11.3 8.5 8.5 0 0 1-5.8-11.3Z"/>' + star(MUTED));
const guideBody = uri(MUTED, '<path d="M5.4 8.4h13.2"/><path d="M7.6 12h8.8"/><path d="M4.6 15.6h14.8"/>' + star(MUTED));
const recall = uri(MUTED, '<path d="M5.8 9.2h9.4a3.9 3.9 0 1 1 0 7.8H9.6"/><path d="M9.2 5.8 5.8 9.2l3.4 3.4"/>' + star(MUTED));
const pause = uri(MUTED, '<circle cx="12" cy="12" r="8.3"/><path d="M10 9.4v5.2M14 9.4v5.2"/>');
const rain = uri(MUTED, '<path d="M12 4.6c3 3.7 5 6.4 5 8.9a5 5 0 0 1-10 0c0-2.5 2-5.2 5-8.9Z"/>' + star(MUTED));
const breeze = uri(MUTED, '<path d="M4.6 9.3h9.2a2.6 2.6 0 1 0-2.6-2.6"/><path d="M4.6 14.7h12.6a2.5 2.5 0 1 1-2.5 2.5"/>' + star(MUTED));
const lake = uri(MUTED, '<path d="M4.4 10c2.5-2 4.6-2 7.1 0s4.6 2 7.1 0"/><path d="M4.4 14.9c2.5-2 4.6-2 7.1 0s4.6 2 7.1 0"/>' + star(MUTED));
const noise = uri(MUTED, '<path d="M6.8 13.8V10.2M10.3 16.4V7.6M13.7 14.6V9.4M17.2 12.9V11.1"/>' + star(MUTED));

// —— 抽屉与工具 ——
const dots = uri(MUTED, '<circle cx="5.9" cy="12" r="1.5" fill="' + MUTED + '" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="' + MUTED + '" stroke="none"/><circle cx="18.1" cy="12" r="1.5" fill="' + MUTED + '" stroke="none"/>' + star(MUTED));
const close = uri(MUTED, '<path d="M7.6 7.6l8.8 8.8"/><path d="M16.4 7.6l-8.8 8.8"/>' + star(MUTED));
const newChat = uri(MUTED, '<path d="M19.6 11.7c0 3.5-3.4 6.3-7.6 6.3-.8 0-1.6-.1-2.3-.3l-3.3 1.4.9-2.9c-1.5-1.1-2.5-2.7-2.5-4.5 0-3.5 3.4-6.3 7.6-6.3s7.2 2.8 7.2 6.3Z"/><path d="M12 9.5v4.2M9.9 11.6h4.2"/>' + star(MUTED));
const lullaby = uri(MUTED, '<path d="M15.8 6.2v8.6"/><path d="M15.8 6.2c1.5.4 2.6 1.1 3.3 2.3"/><circle cx="13.3" cy="15.6" r="2.5"/>' + star(MUTED));

// —— 内容频道（听书 / 电台）——
const listen = uri(MUTED, '<path d="M5.2 15.6v-3.2a6.8 6.8 0 0 1 13.6 0v3.2"/><rect x="4" y="14.4" width="3.6" height="5.4" rx="1.8"/><rect x="16.4" y="14.4" width="3.6" height="5.4" rx="1.8"/>' + star(MUTED));
const radio = uri(MUTED, '<rect x="9.4" y="4.4" width="5.2" height="9" rx="2.6"/><path d="M6.8 11.2a5.2 5.2 0 0 0 10.4 0"/><path d="M12 16.6v2.8"/><path d="M9.4 19.4h5.2"/>' + star(MUTED));
const chevron = uri(MUTED, '<path d="M9.4 5.9 15.5 12l-6.1 6.1"/>' + star(MUTED));

module.exports = {
  like,
  likeActive,
  dislike,
  dislikeActive,
  copy: copy(MUTED),
  regenerate: regenerate(MUTED),
  stop,
  plus,
  back,
  tune,
  sendInk,
  sendMuted,
  emblemStar,
  emblemRipple,
  guideNight,
  guideBody,
  recall,
  pause,
  rain,
  breeze,
  lake,
  noise,
  dots,
  close,
  newChat,
  lullaby,
  listen,
  radio,
  chevron
};
