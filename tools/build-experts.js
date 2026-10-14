// 专家卡构建脚本：读取 docs/experts/*.md 源卡，提取元信息与注入版正文，
// 生成 experts/cards.js 供小程序运行时加载。源卡格式见 docs/expert-team-plan.md。
// 用法：node tools/build-experts.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'docs', 'experts');
const OUT_FILE = path.join(ROOT, 'experts', 'cards.js');
const START_MARK = '<!-- NIGHTCAT-EXPERT:START -->';
const END_MARK = '<!-- NIGHTCAT-EXPERT:END -->';
const PROMPT_WARN_LENGTH = 1500;

function unquote(value) {
  const text = String(value).trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(text);
  return quoted ? quoted[2] : text;
}

// 解析源卡头部 frontmatter；仅支持 key: value 标量与「key: 换行 + - 列表」两种形态。
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!match) return null;
  const meta = {};
  let listKey = null;
  match[1].split(/\r?\n/).forEach((line) => {
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (item && listKey) { meta[listKey].push(unquote(item[1])); return; }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) return;
    if (pair[2] === '') { meta[pair[1]] = []; listKey = pair[1]; }
    else { meta[pair[1]] = unquote(pair[2]); listKey = null; }
  });
  return meta;
}

// 提取 START/END 标记之间的注入版正文；缺失或重复返回 null。
function extractInjectionBlock(text) {
  const source = String(text || '');
  const start = source.indexOf(START_MARK);
  const end = source.indexOf(END_MARK);
  if (start === -1 || end === -1 || end <= start) return null;
  if (source.indexOf(START_MARK, start + START_MARK.length) !== -1) return null;
  return source.slice(start + START_MARK.length, end).trim();
}

// 由源卡文本解析出 { id, card, warnings }；格式不合法返回 { error }。
function parseExpertCard(text) {
  const meta = parseFrontmatter(text);
  if (!meta || typeof meta.expert !== 'string' || !meta.expert.trim()) {
    return { error: '缺少 frontmatter 或 expert 字段' };
  }
  const id = meta.expert.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { error: `expert 标识不合法：${id}` };
  const prompt = extractInjectionBlock(text);
  if (!prompt) return { error: '缺少或重复 NIGHTCAT-EXPERT 注入块' };
  const missing = ['label', 'title', 'intro', 'boundaries']
    .filter((key) => typeof meta[key] !== 'string' || !meta[key].trim());
  if (missing.length) return { error: `缺少必填字段：${missing.join('、')}` };
  const starters = Array.isArray(meta.starters) ? meta.starters.filter((item) => item && item.trim()) : [];
  const sources = Array.isArray(meta.sources) ? meta.sources.filter((item) => item && item.trim()) : [];
  if (!sources.length) return { error: '缺少 sources 来源清单（只认著作/论文/专业文献，条目格式「类型｜题名 (年份)」）' };
  const warnings = prompt.length > PROMPT_WARN_LENGTH
    ? [`注入版 ${prompt.length} 字，超过建议上限 ${PROMPT_WARN_LENGTH} 字`]
    : [];
  return {
    id,
    card: { label: meta.label, title: meta.title, intro: meta.intro, prompt, starters, sources, boundaries: meta.boundaries },
    warnings
  };
}

// 生成 experts/cards.js 源码；按标识排序稳定输出，便于 diff。
function buildCardsModule(cards) {
  const entries = Object.keys(cards).sort().map((name) => {
    const json = JSON.stringify(cards[name], null, 2).replace(/\n/g, '\n  ');
    return `  ${JSON.stringify(name)}: ${json}`;
  });
  return [
    '// 本文件由 tools/build-experts.js 从 docs/experts/*.md 自动生成，请勿手改。',
    '// 修改源卡后重新运行：node tools/build-experts.js',
    'module.exports = {',
    entries.join(',\n'),
    '};',
    ''
  ].join('\n');
}

// 构建：扫描全部源卡；任一源卡出错则整体不写出。
function run(options) {
  const opts = options || {};
  const srcDir = opts.srcDir || SRC_DIR;
  const outFile = opts.outFile || OUT_FILE;
  const cards = {};
  const warnings = [];
  const errors = [];
  const files = fs.existsSync(srcDir)
    ? fs.readdirSync(srcDir).filter((name) => name.endsWith('.md')).sort()
    : [];
  files.forEach((file) => {
    const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const meta = parseFrontmatter(text);
    if (!meta || !meta.expert) { warnings.push(`跳过 ${file}：没有 expert 元信息`); return; }
    const result = parseExpertCard(text);
    if (result.error) { errors.push(`${file}：${result.error}`); return; }
    if (cards[result.id]) { errors.push(`${file}：expert 标识重复（${result.id}）`); return; }
    cards[result.id] = result.card;
    result.warnings.forEach((line) => warnings.push(`${file}：${line}`));
  });
  if (errors.length) return { ok: false, cards, warnings, errors };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buildCardsModule(cards), 'utf8');
  return { ok: true, cards, warnings, errors };
}

if (require.main === module) {
  const result = run();
  result.warnings.forEach((line) => console.warn(`[警告] ${line}`));
  if (!result.ok) {
    result.errors.forEach((line) => console.error(`[错误] ${line}`));
    process.exitCode = 1;
  } else {
    const names = Object.keys(result.cards);
    if (names.length) {
      console.log(`已生成 ${names.length} 张专家卡（${names.join('、')}）→ experts/cards.js`);
    } else {
      console.log('未发现专家源卡（docs/experts/*.md），已生成空的 experts/cards.js');
      console.warn('[警告] experts/cards.js 为空：夜喵将不注入任何专家段。');
    }
  }
}

module.exports = { parseFrontmatter, extractInjectionBlock, parseExpertCard, buildCardsModule, run, START_MARK, END_MARK };
