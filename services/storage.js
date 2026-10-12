const { DEFAULT_SETTINGS } = require('../utils/constants');

const KEYS = {
  settings: 'sleepwell.settings.v1',
  sessions: 'sleepwell.sessions.v1',
  journal: 'sleepwell.journal.v1',
  sleep: 'sleepwell.sleep.v1',
  agentMemory: 'sleepwell.agent-memory.v1',
  agentFeedback: 'sleepwell.agent-feedback.v1',
  accessCode: 'sleepwell.access-code.v1'
};

function read(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value || fallback;
  } catch (error) {
    return fallback;
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function getSettings() {
  const stored = read(KEYS.settings, {});
  const next = Object.assign({}, DEFAULT_SETTINGS, stored);
  if (stored.breathPatternVersion !== 2) {
    if (!stored.rhythm || stored.rhythm === 'soothe') Object.assign(next, { rhythm: '478', inhaleSeconds: 4, holdSeconds: 7, exhaleSeconds: 8 });
    next.breathPatternVersion = 2;
    write(KEYS.settings, next);
  }
  return next;
}

function saveSettings(settings) {
  const next = Object.assign({}, DEFAULT_SETTINGS, settings);
  write(KEYS.settings, next);
  const app = getApp();
  if (app && app.globalData) app.globalData.settings = next;
  return next;
}

function getSessions() {
  return read(KEYS.sessions, []);
}

function saveSession(session) {
  const sessions = getSessions();
  sessions.unshift(session);
  write(KEYS.sessions, sessions.slice(0, 100));
}

function upsertSession(session) {
  const sessions = getSessions();
  const index = sessions.findIndex((item) => item.id === session.id);
  if (index >= 0) {
    sessions[index] = Object.assign({}, sessions[index], session);
  } else {
    sessions.unshift(session);
  }
  write(KEYS.sessions, sessions.slice(0, 100));
}

function updateSessionOutcome(id, outcome) {
  const allowed = ['relieved', 'same', 'tense'];
  if (!id || (outcome !== null && allowed.indexOf(outcome) < 0)) return false;
  const sessions = getSessions();
  const index = sessions.findIndex((item) => item.id === id);
  if (index < 0) return false;
  sessions[index] = Object.assign({}, sessions[index], { outcome });
  return write(KEYS.sessions, sessions.slice(0, 100));
}

function dateKey(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getSevenDaySummary(now, sessions) {
  const end = new Date(now || Date.now());
  const days = [];
  const byDay = {};
  (sessions || getSessions()).forEach((session) => {
    const key = dateKey(session.startedAt || session.endedAt);
    if (!key) return;
    if (!byDay[key]) byDay[key] = { sessions: 0, completed: 0, cycles: 0, outcomes: { relieved: 0, same: 0, tense: 0 } };
    byDay[key].sessions += 1;
    byDay[key].cycles += Number(session.cycles) || 0;
    if (session.completed) byDay[key].completed += 1;
    if (byDay[key].outcomes[session.outcome] !== undefined) byDay[key].outcomes[session.outcome] += 1;
  });
  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - index);
    const key = dateKey(date.getTime());
    days.push(Object.assign({ key, label: `${date.getMonth() + 1}/${date.getDate()}` }, byDay[key] || { sessions: 0, completed: 0, cycles: 0, outcomes: { relieved: 0, same: 0, tense: 0 } }));
  }
  return {
    days,
    activeDays: days.filter((day) => day.sessions > 0).length,
    completedSessions: days.reduce((sum, day) => sum + day.completed, 0),
    outcomes: days.reduce((sum, day) => ({ relieved: sum.relieved + day.outcomes.relieved, same: sum.same + day.outcomes.same, tense: sum.tense + day.outcomes.tense }), { relieved: 0, same: 0, tense: 0 })
  };
}

function clearPersonalRecords() {
  const results = [write(KEYS.sessions, []), write(KEYS.journal, []), write(KEYS.sleep, []), write(KEYS.agentMemory, []), write(KEYS.agentFeedback, [])];
  return results.every(Boolean);
}

function resetSettings() {
  const next = Object.assign({}, DEFAULT_SETTINGS);
  const saved = write(KEYS.settings, next);
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app && app.globalData) app.globalData.settings = next;
  return saved;
}

module.exports = {
  KEYS,
  read,
  write,
  getSettings,
  saveSettings,
  getSessions,
  saveSession,
  upsertSession,
  updateSessionOutcome,
  getSevenDaySummary,
  clearPersonalRecords,
  resetSettings,
  dateKey
};
