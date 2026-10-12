// 夜喵访问验证码：分享者把验证码告诉使用者，使用者在对话页输入一次，本机记住。
// 输入正确前对话页会显示输入卡片；验证通过后请求会带上该验证码访问大赛模型网关。

const storage = require('./storage');

let secrets;
try {
  secrets = require('./secrets');
} catch (error) {
  secrets = require('./secrets.example.js');
}

// 约定的正确验证码来源：secrets.modelGateway.verificationCode。留空表示不设限。
function required() {
  const value = secrets.modelGateway && secrets.modelGateway.verificationCode;
  return typeof value === 'string' ? value.trim() : '';
}

function read() {
  try {
    const value = storage.read(storage.KEYS.accessCode, '');
    return typeof value === 'string' ? value.trim() : '';
  } catch (error) {
    return '';
  }
}

function isValid(input) {
  const need = required();
  if (!need) return true;
  return String(input || '').trim() === need;
}

function isUnlocked() {
  return isValid(read());
}

function save(input) {
  const need = required();
  if (!need) return false;
  const code = String(input || '').trim();
  if (code !== need) return false;
  return storage.write(storage.KEYS.accessCode, code);
}

// 随请求头带给网关的验证码：本机输入过且仍有效的优先，否则退回约定值。
function current() {
  const code = read();
  return isValid(code) ? code : required();
}

module.exports = { required, read, isValid, isUnlocked, save, current };
