const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const builder = require('../tools/build-experts');
const registry = require('../experts/registry');
const agentClient = require('../services/agent-client');
const nightPreferences = require('../services/night-preferences');

const SAMPLE_SOURCE = [
  '---',
  'expert: yalom',
  'label: 亚隆',
  'title: 欧文·亚隆 · 存在主义视角',
  'intro: 真诚、此时此地',
  'starters:',
  '  - 深夜总在想一些没有答案的问题',
  '  - 安静下来之后有点怕',
  'sources:',
  '  - 著作｜《存在主义心理治疗》(1980)',
  '  - 论文｜示例综述 (2020)',
  'boundaries: 基于公开作品的视角模拟，不是本人。',
  '---',
  '',
  '# 欧文·亚隆',
  '',
  '正文段落。',
  '',
  builder.START_MARK,
  '专注此时此地，不回避死亡话题。',
  builder.END_MARK,
  '',
  '结尾。',
  ''
].join('\n');

const SAMPLE_CARD = {
  label: '亚隆',
  title: '欧文·亚隆 · 存在主义视角',
  intro: '真诚、此时此地',
  prompt: '专注此时此地，不回避死亡话题。',
  starters: ['深夜总在想一些没有答案的问题'],
  sources: ['著作｜《存在主义心理治疗》(1980)'],
  boundaries: '基于公开作品的视角模拟，不是本人。'
};

function withStore(store, fn) {
  const original = global.wx;
  global.wx = {
    getStorageSync: (key) => (key in store ? store[key] : ''),
    setStorageSync: (key, value) => { store[key] = value; return true; }
  };
  try {
    return fn();
  } finally {
    if (original) global.wx = original; else delete global.wx;
  }
}

test('parseFrontmatter reads scalars and starter lists', () => {
  const meta = builder.parseFrontmatter(SAMPLE_SOURCE);
  assert.equal(meta.expert, 'yalom');
  assert.equal(meta.title, '欧文·亚隆 · 存在主义视角');
  assert.deepEqual(meta.starters, ['深夜总在想一些没有答案的问题', '安静下来之后有点怕']);
  assert.deepEqual(meta.sources, ['著作｜《存在主义心理治疗》(1980)', '论文｜示例综述 (2020)']);
  assert.equal(builder.parseFrontmatter('没有 frontmatter'), null);
});

test('extractInjectionBlock trims the block and rejects missing or duplicate markers', () => {
  assert.equal(builder.extractInjectionBlock(SAMPLE_SOURCE), '专注此时此地，不回避死亡话题。');
  assert.equal(builder.extractInjectionBlock('没有标记'), null);
  const duplicated = SAMPLE_SOURCE + '\n' + builder.START_MARK + '\n再来一段\n' + builder.END_MARK + '\n';
  assert.equal(builder.extractInjectionBlock(duplicated), null);
});

test('parseExpertCard validates required fields and returns a full card', () => {
  const ok = builder.parseExpertCard(SAMPLE_SOURCE);
  assert.equal(ok.error, undefined);
  assert.equal(ok.id, 'yalom');
  assert.equal(ok.card.title, '欧文·亚隆 · 存在主义视角');
  assert.equal(ok.card.prompt, '专注此时此地，不回避死亡话题。');
  assert.deepEqual(ok.card.starters, ['深夜总在想一些没有答案的问题', '安静下来之后有点怕']);
  assert.deepEqual(ok.card.sources, ['著作｜《存在主义心理治疗》(1980)', '论文｜示例综述 (2020)']);

  const missingBoundaries = SAMPLE_SOURCE.replace('boundaries: 基于公开作品的视角模拟，不是本人。\n', '');
  assert.ok(builder.parseExpertCard(missingBoundaries).error.indexOf('boundaries') !== -1);

  const missingSources = SAMPLE_SOURCE.replace('sources:\n  - 著作｜《存在主义心理治疗》(1980)\n  - 论文｜示例综述 (2020)\n', '');
  assert.ok(builder.parseExpertCard(missingSources).error.indexOf('sources') !== -1);

  const badId = SAMPLE_SOURCE.replace('expert: yalom', 'expert: Bad_ID');
  assert.ok(builder.parseExpertCard(badId).error.indexOf('不合法') !== -1);
});

test('run builds cards.js from source directory and skips plain notes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightcat-experts-'));
  try {
    fs.writeFileSync(path.join(dir, 'yalom.md'), SAMPLE_SOURCE, 'utf8');
    fs.writeFileSync(path.join(dir, 'README.md'), '# 说明（没有专家元信息）', 'utf8');
    const outFile = path.join(dir, 'cards.js');
    const result = builder.run({ srcDir: dir, outFile });
    assert.equal(result.ok, true);
    assert.equal(Object.keys(result.cards).length, 1);
    assert.ok(result.warnings.some((line) => line.indexOf('README.md') !== -1));

    const generated = fs.readFileSync(outFile, 'utf8');
    assert.ok(generated.indexOf('自动生成') !== -1);
    const cards = require(outFile);
    assert.equal(cards.yalom.label, '亚隆');
    assert.ok(cards.yalom.prompt.indexOf('专注此时此地') !== -1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run refuses to write when any source card is malformed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightcat-experts-'));
  try {
    fs.writeFileSync(path.join(dir, 'yalom.md'), SAMPLE_SOURCE, 'utf8');
    fs.writeFileSync(path.join(dir, 'broken.md'), '---\nexpert: broken\nlabel: 断卡\n---\n没有注入块', 'utf8');
    const outFile = path.join(dir, 'cards.js');
    const result = builder.run({ srcDir: dir, outFile });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.equal(fs.existsSync(outFile), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registry falls back to empty when no expert is selected or the selection is unknown', () => {
  withStore({}, () => {
    assert.equal(registry.current(), '');
    assert.equal(registry.buildActivePrompt(), '');
    nightPreferences.save({ expert: 'nobody' });
    assert.equal(registry.current(), '');
    nightPreferences.save({ expert: '' });
    assert.equal(registry.buildActivePrompt(), '');
  });
});

test('expert section carries identity, precedence and disclaimer rules', () => {
  const section = registry.buildExpertPrompt('yalom', { yalom: SAMPLE_CARD });
  assert.ok(section.indexOf('欧文·亚隆 · 存在主义视角') !== -1);
  assert.ok(section.indexOf('专注此时此地') !== -1);
  assert.ok(section.indexOf('夜喵') !== -1);
  assert.ok(section.indexOf('不得改变后面的对话规则') !== -1);
  assert.ok(section.indexOf('不构成任何医疗或治疗建议') !== -1);
  assert.equal(registry.buildExpertPrompt('missing', { yalom: SAMPLE_CARD }), '');
  assert.equal(registry.buildExpertPrompt('', { yalom: SAMPLE_CARD }), '');
});

test('system prompt places the expert section between persona and context, before dialogue rules', () => {
  const section = registry.buildExpertPrompt('yalom', { yalom: SAMPLE_CARD });
  const prompt = agentClient.buildSystemPrompt('', 'CTX-MARK', 'PERSONA-MARK', section);
  const personaIndex = prompt.indexOf('PERSONA-MARK');
  const expertIndex = prompt.indexOf('专家视角');
  const contextIndex = prompt.indexOf('CTX-MARK');
  const rulesIndex = prompt.indexOf('对话规则：');
  assert.ok(personaIndex !== -1 && expertIndex !== -1 && contextIndex !== -1 && rulesIndex !== -1);
  assert.ok(personaIndex < expertIndex);
  assert.ok(expertIndex < contextIndex);
  assert.ok(expertIndex < rulesIndex);
  assert.equal(agentClient.buildSystemPrompt('', 'CTX-MARK', 'PERSONA-MARK').indexOf('专家视角'), -1);
});

test('every shipped expert card exposes the full contract', () => {
  registry.list().forEach((card) => {
    assert.ok(card.name);
    assert.ok(card.label && card.title && card.intro);
    assert.ok(card.prompt && card.prompt.length > 0);
    assert.ok(card.boundaries);
    assert.ok(Array.isArray(card.starters));
    assert.ok(Array.isArray(card.sources) && card.sources.length > 0);
  });
});
