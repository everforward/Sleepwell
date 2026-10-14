const storage = require('./storage');
const KEY = 'sleepwell.night.preferences.v1';
const DEFAULTS = { personality: '温柔陪伴', voice: '温柔女声', bedtime: '23:00', companion: '温柔陪伴', concerns: [], memoryEnabled: false, suggestions: true, question: '什么让你难以放松？', display: '完整模式', fontSize: '标准', expert: '' };
function read() { return Object.assign({}, DEFAULTS, storage.read(KEY, {})); }
function save(changes) { const next = Object.assign({}, read(), changes); return storage.write(KEY, next) ? next : null; }
function clearMemory() { return save({ bedtime: '23:00', companion: '温柔陪伴', concerns: [], memoryEnabled: false }); }
module.exports = { read, save, clearMemory };
