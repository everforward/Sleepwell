// 夜喵对话上下文：把用户本地记录（呼吸练习、睡眠、感恩日记）压缩成简短摘要，
// 注入 system prompt，让夜喵自然地"记得"用户近况。
// 所有读取都做了容错：任何记录缺失或读取失败都不影响对话。

const storage = require('../services/storage');
const agentMemory = require('../services/agent-memory');
const agentTasks = require('../services/agent-tasks');
const agentPersona = require('./agent-persona');
const nightPreferences = require('../services/night-preferences');

function safeRead(reader, fallback) {
  try {
    const value = reader();
    return value || fallback;
  } catch (error) {
    return fallback;
  }
}

function buildBreathLine(now) {
  const sessions = safeRead(() => storage.getSessions(), []);
  if (!Array.isArray(sessions) || !sessions.length) return '';
  const totalCycles = sessions.reduce((sum, item) => sum + (Number(item.cycles) || 0), 0);
  const summary = safeRead(() => storage.getSevenDaySummary(now, sessions), null);
  if (!summary) return '';
  const { completedSessions, activeDays, outcomes } = summary;
  const feeling = `放松 ${outcomes.relieved} 次、差不多 ${outcomes.same} 次、还紧绷 ${outcomes.tense} 次`;
  return `用户累计完成 ${totalCycles} 轮呼吸；近 7 天完成练习 ${completedSessions} 次（${activeDays} 天有练习），练后自评：${feeling}。`;
}

const FEELING_LABELS = { 1: '很差', 2: '较差', 3: '一般', 4: '不错', 5: '很好' };

function buildSleepLine() {
  const records = safeRead(() => storage.read(storage.KEYS.sleep, []), []);
  const last = Array.isArray(records) ? records[0] : null;
  if (!last || !last.bedTime) return '';
  const when = last.nightDate || last.date || '最近一晚';
  const duration = last.duration || '时长未记录';
  const raw = Number(last.feeling);
  const feeling = FEELING_LABELS[raw] || (last.feeling ? String(last.feeling) : '未记录');
  return `最近一晚睡眠（${when}）：${last.bedTime} 上床，${last.wakeTime || '起床时间未记录'} 起床，${duration}，感受「${feeling}」。`;
}

function buildJournalLine() {
  const entries = safeRead(() => storage.read(storage.KEYS.journal, []), []);
  const last = Array.isArray(entries) ? entries[0] : null;
  if (!last || !Array.isArray(last.items) || !last.items.length) return '';
  const items = last.items.filter((item) => typeof item === 'string' && item.trim()).slice(0, 3);
  if (!items.length) return '';
  return `最近的感恩日记（${last.date || '日期未记录'}）：${items.join('；')}。`;
}

function buildMemoryLine() {
  // 记忆注入受设置页「夜喵记忆」开关实时控制。
  const enabled = safeRead(() => nightPreferences.read().memoryEnabled, false);
  if (!enabled) return '';
  const last = safeRead(() => agentMemory.lastMemory(), null);
  if (!last || !last.summary) return '';
  return `用户上次和夜喵聊天（${agentMemory.formatWhen(last.at)}）聊到：${last.summary}。`;
}

function buildFactLine() {
  const enabled = safeRead(() => nightPreferences.read().memoryEnabled, false);
  if (!enabled) return '';
  const list = safeRead(() => agentMemory.facts(), []).slice(0, 5);
  if (!list.length) return '';
  return `用户让你记住的事：${list.map((item) => item.text).join('；')}。`;
}

function buildTaskLine() {
  const briefs = safeRead(() => agentTasks.pendingBrief(), []);
  if (!briefs.length) return '';
  return `你和用户的约定：${briefs.join('；')}。到点或合适时机自然地提一句，不要生硬。`;
}

// 返回注入用的上下文段落；无任何记录时返回空字符串。
function buildUserContext(now) {
  const personaContext = safeRead(() => agentPersona.buildPersonaContext(now), '');
  const lines = [buildBreathLine(now), buildSleepLine(), buildJournalLine(), buildMemoryLine(), buildFactLine(), buildTaskLine(), personaContext].filter(Boolean);
  if (!lines.length) return '';
  return [
    '以下是用户的本地记录摘要（仅你可见）。只在相关时机自然地引用一两处，不要一次性罗列，也不要让用户感觉被监控：',
    lines.join('\n')
  ].join('\n');
}

module.exports = { buildUserContext };
