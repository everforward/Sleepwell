// 夜喵 Agent 客户端：对接大赛模型网关（OpenAI 兼容 chat completions）。
// 优先走 SSE 流式输出；网络失败或基础库不支持分块时回退到 utils/agent-guide 规则引擎，
// 保证离线或网关异常时夜喵仍能完成基础陪伴对话。

let secrets;
try {
  secrets = require('./secrets');
} catch (error) {
  // 本地未配置真实密钥时使用模板，便于新环境跑通结构与测试。
  secrets = require('./secrets.example.js');
}

const stream = require('../utils/llm-stream');
const guide = require('../utils/agent-guide');
const registry = require('../skills/registry');
const pushCards = require('./agent-push');
const accessCode = require('./access-code');

const REC_MARKER = '@@REC@@';
const SOUND_WHITELIST = ['rain', 'breeze', 'lake', 'white'];
const HISTORY_LIMIT = 12;
const REQUEST_TIMEOUT_MS = 30000;

const TOPIC_LABELS = {
  exam: '考试焦虑',
  research: '论文 / 科研压力',
  dorm: '宿舍难以放松',
  thoughts: '脑子停不下来'
};

function buildSystemPrompt(topic, context, persona, expert) {
  const topicLine = topic && TOPIC_LABELS[topic] ? `用户选择的倾诉话题是「${TOPIC_LABELS[topic]}」。` : '';
  const contextBlock = context ? `\n${context}\n` : '';
  const personaBlock = persona ? `\n${persona}\n` : '';
  const expertBlock = expert ? `\n${expert}\n` : '';
  const skillBlock = registry.buildSkillPromptSection();
  return [
    '你是“夜喵”，一个面向大学生的深夜睡前陪伴 AI，帮助用户在睡前放下压力、慢慢平静。',
    topicLine,
    personaBlock,
    expertBlock,
    contextBlock,
    '对话规则：',
    '- 语气温暖、平静、不评判，像一位可靠的朋友在深夜陪伴。',
    '- 每次回复 1-3 句话，总共不超过 60 个字；不使用列表、标题或表情符号。',
    '- 一次只问一个开放式问题，引导用户把心事说出来。',
    '- 对话前两轮先倾听和共情，不要急着给建议。',
    '- 不提供医疗诊断或用药建议。若用户提到自伤或严重危机，温和而明确地建议联系学校心理中心、辅导员或信任的人，并继续陪伴。',
    '推荐机制（重要，必须遵守）：',
    '- 判断用户准备入睡或需要实际帮助的信号：说想安静、想休息、想睡、想要帮助，或倾诉已充分、情绪稍被接住。',
    '- 一旦出现这些信号，本次回复必须以推荐标记结尾：在正文之后另起一行，严格输出标记与一行 JSON（不使用代码块包裹）：',    REC_MARKER + '{"sound":"rain","minutes":30,"title":"雨声 · 慢慢来","detail":"30 分钟定时 · 自然环境声","reason":"给今晚一段不用思考的安静时间。"}',
    '- sound 只能取 rain、breeze、lake、white 之一；minutes 只能取 15 或 30；用户提到环境吵、室友、噪音时优先选 white。',
    '- 示例（只示意格式，不要照抄内容）：用户说“我现在只想安静下来睡一觉”，你回复“今晚就先放下这些吧。”后另起一行输出标记与 JSON。',
    '- 仍然在倾听阶段、用户明显还想继续倾诉时，才不要输出推荐标记。',
    '- 用户明确点名要听某个声音或要关掉声音时，用播放/停止技能直接执行，不要用推荐卡片。',
    pushCards.buildPromptSection(),
    skillBlock
  ].filter(Boolean).join('\n');
}

function sanitizeRecommendation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sound = SOUND_WHITELIST.indexOf(raw.sound) !== -1 ? raw.sound : 'breeze';
  const minutes = Number(raw.minutes) === 15 ? 15 : 30;
  const text = (value, fallback) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : fallback);
  return {
    sound,
    minutes,
    title: text(raw.title, '今晚慢慢来'),
    detail: text(raw.detail, `${minutes} 分钟定时 · 自然环境声`),
    reason: text(raw.reason, '给今晚一段不用思考的安静时间。')
  };
}

// 截取 payload 中第一个括号平衡的 JSON 对象文本；未闭合返回 null。
function extractBalancedJson(payload) {
  const text = String(payload || '');
  let end = -1;
  for (let i = 0, depth = 0, started = false; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') { depth += 1; started = true; }
    else if (ch === '}') depth -= 1;
    if (started && depth === 0) { end = i + 1; break; }
  }
  return end === -1 ? null : text.slice(0, end);
}

// 截取 payload 中第一个括号平衡的 JSON 数组文本；未闭合返回 null。
function extractBalancedArray(payload) {
  const text = String(payload || '');
  let end = -1;
  for (let i = 0, depth = 0, started = false; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '[') { depth += 1; started = true; }
    else if (ch === ']') depth -= 1;
    if (started && depth === 0) { end = i + 1; break; }
  }
  return end === -1 ? null : text.slice(0, end);
}

function safeParse(json, sanitize) {
  if (!json) return null;
  try {
    return sanitize(JSON.parse(json));
  } catch (error) {
    return null;
  }
}

// 把模型完整输出拆成「可见文本 + 推荐卡片 + 推送卡片 + 选项提问 + 技能调用」。
// 四类标记（@@REC@@ / @@PUSH@@ / @@ASK@@ / @@DO@@）互斥，取先出现者；流式期间 JSON 未闭合时对应项为 null。
function splitResponse(fullText) {
  const text = String(fullText || '');
  const markers = [
    { kind: 'do', index: text.indexOf(registry.DO_MARKER), marker: registry.DO_MARKER },
    { kind: 'rec', index: text.indexOf(REC_MARKER), marker: REC_MARKER },
    { kind: 'push', index: text.indexOf(pushCards.PUSH_MARKER), marker: pushCards.PUSH_MARKER },
    { kind: 'ask', index: text.indexOf(pushCards.ASK_MARKER), marker: pushCards.ASK_MARKER }
  ].filter((item) => item.index !== -1).sort((a, b) => a.index - b.index);
  if (!markers.length) return { text: text.trim(), recommendation: null, skillCall: null, push: null, ask: null };
  const chosen = markers[0];
  const base = { text: text.slice(0, chosen.index).trim(), recommendation: null, skillCall: null, push: null, ask: null };
  if (chosen.kind === 'do') {
    const parsed = registry.parseSkillCall(text);
    if (!parsed) return base; // JSON 未闭合
    return Object.assign(base, { skillCall: parsed.invalid ? { invalid: true } : { skill: parsed.skill, args: parsed.args } });
  }
  if (chosen.kind === 'rec') {
    return Object.assign(base, {
      recommendation: safeParse(extractBalancedJson(text.slice(chosen.index + REC_MARKER.length)), sanitizeRecommendation)
    });
  }
  if (chosen.kind === 'push') {
    return Object.assign(base, {
      push: safeParse(extractBalancedArray(text.slice(chosen.index + pushCards.PUSH_MARKER.length)), pushCards.sanitizePush)
    });
  }
  return Object.assign(base, {
    ask: safeParse(extractBalancedJson(text.slice(chosen.index + pushCards.ASK_MARKER.length)), pushCards.sanitizeAsk)
  });
}

// 向后兼容旧签名：只取文本与推荐。
function splitRecommendation(fullText) {
  const result = splitResponse(fullText);
  return { text: result.text, recommendation: result.recommendation };
}

function mapHistory(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-HISTORY_LIMIT)
    .map((item) => ({
      role: item && item.role === 'user' ? 'user' : 'assistant',
      content: String((item && item.text) || '')
    }));
}

// 发起一次对话。回调：
// - onDelta(visibleText)：流式过程中当前应显示的完整可见文本（已剔除推荐标记）
// - onComplete({ text, recommendation, fallback })：对话结束
// - onError(reason)：仅在被中断或彻底失败时触发（内部已包含规则引擎回退）
// 返回 { abort() } 用于取消请求。
function gatewayHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${secrets.modelGateway.apiKey}`
  };
  // 大赛模型试验验证码：使用者在本机输入过就带输入的，否则退回配置值。
  const code = accessCode.current();
  if (code) headers['X-Verification-Code'] = code;
  return headers;
}

function chat(options) {
  const opts = options || {};
  const { topic = '', history = [], answers = [], context = '', persona = '', expert = '' } = opts;
  const onDelta = typeof opts.onDelta === 'function' ? opts.onDelta : null;
  const onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : null;
  const onError = typeof opts.onError === 'function' ? opts.onError : null;

  const messages = [{ role: 'system', content: buildSystemPrompt(topic, context, persona, expert) }].concat(mapHistory(history));
  let full = '';
  let settled = false;
  let aborted = false;
  let requestTask = null;

  function completeOnce(result) {
    if (settled) return;
    settled = true;
    if (onComplete) onComplete(result);
  }

  function fallback() {
    if (settled || aborted) {
      if (!settled && onError) onError('aborted');
      return;
    }
    // 请求中断（如切后台 5s 后 fail interrupted）但模型已流出一部分文本：
    // 保留已有内容收尾，不要用规则话术整段覆盖，避免体验断裂。
    const partial = splitResponse(full);
    if (partial.text) {
      completeOnce({ text: partial.text, recommendation: partial.recommendation, push: partial.push, ask: partial.ask, fallback: true });
      return;
    }
    const result = guide.next(topic, answers);
    const reply = result.reply || '我在这里，今晚慢慢来。';
    if (onDelta) onDelta(reply);
    completeOnce({ text: reply, recommendation: result.recommendation || null, push: null, ask: null, fallback: true });
  }

  function handlePayload(payload) {
    if (payload === '[DONE]') return;
    const delta = stream.parseDelta(payload);
    if (!delta) return;
    full += delta;
    if (onDelta) onDelta(splitResponse(full).text);
  }

  function requestNonStreaming() {
    try {
      requestTask = wx.request({
        url: secrets.modelGateway.baseUrl,
        method: 'POST',
        timeout: REQUEST_TIMEOUT_MS,
        header: gatewayHeaders(),
        data: { model: secrets.modelGateway.model, stream: false, temperature: 0.7, max_tokens: 400, messages },
        success(res) {
          const content = res && res.data && res.data.choices && res.data.choices[0]
            && res.data.choices[0].message && res.data.choices[0].message.content;
          if (typeof content === 'string' && content) {
            const parsed = splitResponse(content);
            if (onDelta) onDelta(parsed.text);
            completeOnce({ text: parsed.text, recommendation: parsed.recommendation, push: parsed.push, ask: parsed.ask, fallback: false });
          } else {
            fallback();
          }
        },
        fail() {
          fallback();
        }
      });
    } catch (error) {
      fallback();
    }
  }

  try {
    requestTask = wx.request({
      url: secrets.modelGateway.baseUrl,
      method: 'POST',
      enableChunked: true,
      timeout: REQUEST_TIMEOUT_MS,
      header: gatewayHeaders(),
      data: { model: secrets.modelGateway.model, stream: true, temperature: 0.7, max_tokens: 400, messages },
      success() {
        // 分块传输结束；若一个字节都没收到则视为失败并回退。
        if (!full) fallback();
        else completeOnce(Object.assign({ fallback: false }, splitResponse(full)));
      },
      fail() {
        fallback();
      }
    });

    if (!requestTask || typeof requestTask.onChunkReceived !== 'function') {
      // 基础库不支持分块接收，降级为非流式请求。
      if (requestTask && typeof requestTask.abort === 'function') requestTask.abort();
      requestNonStreaming();
      return { abort() {} };
    }

    const decoder = stream.createUtf8Decoder();
    const parser = stream.createSseParser(handlePayload);
    requestTask.onChunkReceived((res) => {
      const text = decoder.push(res && res.data ? res.data : new ArrayBuffer(0));
      if (text) parser.push(text);
    });
  } catch (error) {
    fallback();
    return { abort() {} };
  }

  return {
    abort() {
      if (aborted || settled) return;
      aborted = true;
      if (requestTask && typeof requestTask.abort === 'function') {
        try { requestTask.abort(); } catch (error) { /* 已结束的请求无需处理 */ }
      }
      if (!settled && onError) onError('aborted');
      settled = true;
    }
  };
}

module.exports = { chat, splitResponse, splitRecommendation, sanitizeRecommendation, buildSystemPrompt, gatewayHeaders, extractBalancedArray, REC_MARKER };
