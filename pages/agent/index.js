const navigation = require('../../utils/navigation');
const { getNavigationMetrics } = require('../../utils/layout');
const nightPreferences = require('../../services/night-preferences');
const storage = require('../../services/storage');
const guide = require('../../utils/agent-guide');
const agentContext = require('../../utils/agent-context');
const agentMemory = require('../../services/agent-memory');
const agentPersona = require('../../utils/agent-persona');
const agentClient = require('../../services/agent-client');
const accessCode = require('../../services/access-code');
const skillRegistry = require('../../skills/registry');
const agentIcons = require('../../utils/agent-icons');

const RENDER_THROTTLE_MS = 80;

Page({
  data: {
    nav: getNavigationMetrics(),
    topics: [
      { id: 'exam', label: '考试焦虑', icon: 'graduation-cap', prompt: '最近考试让我有点焦虑。' },
      { id: 'research', label: '论文 / 科研压力', icon: 'file-text', prompt: '论文和科研的压力让我难以放松。' },
      { id: 'dorm', label: '宿舍难以放松', icon: 'bed-double', prompt: '在宿舍里，我总是很难放松。' },
      { id: 'thoughts', label: '脑子停不下来', icon: 'brain', prompt: '到了晚上，我的脑子还是停不下来。' }
    ],
    showChat: false,
    homeState: 'initial', messages: [], answers: [], recommendation: null, activeTopic: '', scrollAnchor: '',
    showRecords: false,
    draft: '',
    canSend: false,
    awaitingFirst: false,
    message: '',
    chatState: 'idle',
    streamState: 'idle',
    keyboardHeight: 0,
    inputFocus: false,
    aiLocked: false,
    codeInput: '',
    codeError: false,
    gateFocus: false,
    recentSessions: [],
    icons: agentIcons,
    lastAgentId: '',
    totalBreaths: 0,
    sevenDay: { activeDays: 0, completedSessions: 0, outcomes: { relieved: 0, same: 0, tense: 0 } }
  },
  onLoad() {
    this.keyboardListener = (event) => {
      this.setData({ keyboardHeight: this.data.showChat ? Math.max(0, event.height || 0) : 0 });
    };
    if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this.keyboardListener);
  },
  onShow() {
    const preferences = nightPreferences.read();
    this.setData({ nav: getNavigationMetrics(), preferences, welcomeQuestion: preferences.question, displayMode: preferences.display, fontMode: preferences.fontSize, aiLocked: !accessCode.isUnlocked() });
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
  },
  onHide() {
    this.cancelPending();
    this.setData({ inputFocus: false, gateFocus: false, keyboardHeight: 0 });
  },
  onUnload() {
    this.cancelPending();
    if (wx.offKeyboardHeightChange && this.keyboardListener) wx.offKeyboardHeightChange(this.keyboardListener);
  },
  onShareAppMessage() { return { title: '夜喵，你的 AI 睡前陪伴助手', path: '/pages/agent/index' }; },
  onShareTimeline() { return { title: '夜喵，你的 AI 睡前陪伴助手' }; },
  noop() {},
  openSettings() { wx.navigateTo({ url: '/pages/night-settings/index' }); },
  goBreathe() { wx.reLaunch({ url: '/pages/breathe/index' }); },
  startGuide() { wx.navigateTo({ url: '/pages/focus/index' }); },
  goPage(event) {
    this.setData({ showRecords: false });
    wx.navigateTo({ url: event.currentTarget.dataset.url });
  },
  openRecords() { wx.reLaunch({ url: '/pages/record/index' }); },
  closeRecords() { this.setData({ showRecords: false }); },
  openChat() {
    if (this.data.homeState !== 'initial') return;
    this.beginConversation('');
    // 等对话层入场动画走完再聚焦输入框，避免键盘抢在面板动画之前弹出。
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      if (this.data.homeState === 'initial') return;
      if (this.data.aiLocked) this.setData({ gateFocus: true });
      else this.setData({ inputFocus: true });
    }, 280);
  },
  // 验证码门禁：输入正确前不发起对话，输入一次后本机记住。
  onCodeInput(event) {
    this.setData({ codeInput: event.detail.value, codeError: false });
  },
  submitCode() {
    const input = String(this.data.codeInput || '').trim();
    if (!input) return;
    if (!accessCode.save(input)) {
      this.setData({ codeError: true });
      if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响校验 */ } }
      return;
    }
    this.setData({ aiLocked: false, codeError: false, codeInput: '', gateFocus: false, inputFocus: true });
    wx.showToast({ title: '验证成功，可以开始聊了', icon: 'none' });
  },
  nudgeGate() {
    this.setData({ gateFocus: true });
    wx.showToast({ title: '请先输入验证码', icon: 'none' });
  },
  buildOpening(topic) {
    if (topic && guide.openings[topic]) return guide.openings[topic];
    // 个性化开场受记忆开关实时控制。
    if (nightPreferences.read().memoryEnabled) {
      const last = agentMemory.lastMemory();
      if (last && last.summary) return `上次你和我聊到「${last.summary}」。今晚还是这件事，还是有新的心事？`;
    }
    return this.data.welcomeQuestion || '今晚有什么让你难以放松？';
  },
  // 双锚点交替触发滚动，保证单次 setData 内完成（减少渲染开销）。
  flipAnchor() {
    this.anchorFlip = !this.anchorFlip;
    return this.anchorFlip ? 'conversation-end-a' : 'conversation-end-b';
  },
  beginConversation(topic) {
    this.setData({ homeState: 'chat', showChat: true, activeTopic: topic, answers: [], recommendation: null, messages: [{ id: 'intro', role: 'agent', text: this.buildOpening(topic) }], draft: '', canSend: false, awaitingFirst: false, inputFocus: false, scrollAnchor: 'conversation-end' });
  },
  playRecommendation() {
    const item = this.data.recommendation;
    if (item) wx.navigateTo({ url: `/pages/sound/index?sound=${item.sound}&minutes=${item.minutes}` });
  },
  openChatSettings() { wx.navigateTo({ url: '/pages/night-settings/index?from=chat' }); },
  chooseTopic(event) {
    const topic = this.data.topics.find((item) => item.id === event.currentTarget.dataset.id);
    if (!topic) return;
    this.beginConversation(topic.id);
  },
  closeChat() {
    this.cancelPending();
    if (this.focusTimer) { clearTimeout(this.focusTimer); this.focusTimer = null; }
    if (this.data.messages.length > 1) {
      // 后台生成对话摘要供下次开场使用；失败静默跳过，不阻塞返回首页。
      agentMemory.summarizeConversation(this.data.messages, this.data.activeTopic);
    }
    if (wx.hideKeyboard) wx.hideKeyboard();
    this.setData({ homeState: 'initial', showChat: false, messages: [], answers: [], recommendation: null, draft: '', canSend: false, awaitingFirst: false, chatState: 'idle', inputFocus: false, gateFocus: false, codeInput: '', codeError: false, keyboardHeight: 0 });
  },
  onDraftChange(event) { this.setData({ draft: event.detail.value, canSend: Boolean(event.detail.value.trim()) }); },
  onInputFocus() { this.setData({ inputFocus: true }); },
  onInputBlur() { this.setData({ inputFocus: false }); },
  cancelPending() {
    if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
    if (this.pendingAgent) {
      this.pendingAgent.abort();
      this.pendingAgent = null;
    }
    if (this.data.chatState === 'sending') this.setData({ chatState: 'error' });
  },
  // 执行一轮对话请求（发送与重试共用）：agentId 对应气泡已存在于 messages 中。
  runAgentTurn(turn) {
    const { agentId, history, answers } = turn;
    if (this.pendingAgent) this.pendingAgent.abort();
    this.renderedAgentText = null;
    this.latestStreamText = '';
    this.renderTimer = null;
    this.updateAgentText = (text) => {
      if (!text || text === this.renderedAgentText) return;
      this.latestStreamText = text;
      if (this.data.awaitingFirst) this.setData({ awaitingFirst: false, streamState: 'streaming' });
      if (this.renderTimer) return; // 已有排期，等节流窗口到期后统一渲染
      this.renderTimer = setTimeout(() => {
        this.renderTimer = null;
        this.flushAgentText(text);
      }, RENDER_THROTTLE_MS);
    };
    this.flushAgentText = (text) => {
      this.renderedAgentText = text;
      const index = this.data.messages.findIndex((item) => item.id === agentId);
      if (index === -1) return;
      const messages = this.data.messages.slice();
      messages[index] = Object.assign({}, messages[index], { text });
      this.setData({ messages, scrollAnchor: this.flipAnchor() });
    };
    this.pendingAgent = agentClient.chat({
      topic: this.data.activeTopic,
      history,
      answers,
      context: agentContext.buildUserContext(),
      persona: agentPersona.buildPersonaPrompt(),
      onDelta: (text) => this.updateAgentText(text),
      onComplete: (result) => {
        this.pendingAgent = null;
        if (this.data.homeState === 'initial') return; // 对话已被关闭，丢弃迟到的回复
        if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
        this.flushAgentText(result.text);
        const messages = this.data.messages.map((item) => (item.id === agentId ? Object.assign({}, item, { done: true }) : item));
        this.setData({
          messages,
          chatState: 'idle',
          awaitingFirst: false,
          streamState: 'idle',
          lastAgentId: agentId,
          recommendation: result.recommendation || null,
          homeState: result.recommendation ? 'recommendation' : 'chat'
        });
        if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响收尾 */ } }
        if (result.skillCall && !result.skillCall.invalid) this.handleSkillCall(result.skillCall);
      },
      onError: () => {
        this.pendingAgent = null;
        if (this.userStopped) {
          // 用户主动停止：保留已流出的文本，正常收尾而不是报错。
          this.userStopped = false;
          if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
          if (this.latestStreamText) this.flushAgentText(this.latestStreamText);
          const messages = this.data.messages.map((item) => (item.id === agentId ? Object.assign({}, item, { done: true }) : item));
          this.setData({ messages, chatState: 'idle', awaitingFirst: false, streamState: 'idle', lastAgentId: agentId });
          return;
        }
        this.setData({ chatState: 'error', awaitingFirst: false, streamState: 'idle' });
      }
    });
  },
  sendMessage() {
    const message = this.data.draft.trim();
    if (!message || this.data.chatState === 'sending') return;
    if (this.data.aiLocked) { this.nudgeGate(); return; }
    const answers = this.data.answers.concat(message);
    const history = this.data.messages.concat([{ id: `user-${answers.length}`, role: 'user', text: message }]);
    const agentId = `agent-${answers.length}`;
    this.setData({
      message,
      answers,
      messages: history.concat([{ id: agentId, role: 'agent', text: '' }]),
      recommendation: null,
      homeState: 'chat',
      draft: '',
      canSend: false,
      chatState: 'sending',
      awaitingFirst: true,
      streamState: 'listening',
      inputFocus: false,
      scrollAnchor: this.flipAnchor()
    });
    if (wx.hideKeyboard) wx.hideKeyboard();
    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响发送 */ } }
    this.lastTurn = { agentId, history, answers };
    this.runAgentTurn(this.lastTurn);
  },
  // 失败重试：复用同一轮的历史与气泡，不在消息列表中重复用户发言。
  retryTurn() {
    const turn = this.lastTurn;
    if (!turn || this.data.chatState === 'sending') return;
    const index = this.data.messages.findIndex((item) => item.id === turn.agentId);
    if (index === -1) return;
    const messages = this.data.messages.slice();
    messages[index] = Object.assign({}, messages[index], { text: '' });
    this.setData({ messages, chatState: 'sending', awaitingFirst: true, streamState: 'listening', recommendation: null, homeState: 'chat', scrollAnchor: this.flipAnchor() });
    this.runAgentTurn(turn);
  },
  // 模型发起技能调用：按个性化权限分流。
  handleSkillCall(call) {
    const permission = skillRegistry.getPermission(call.skill);
    if (permission === 'confirm') {
      const messages = this.data.messages.concat([{
        id: `skill-confirm-${Date.now()}`,
        role: 'skill-confirm',
        text: skillRegistry.confirmText(call),
        call
      }]);
      this.setData({ messages, scrollAnchor: '' });
      this.setData({ scrollAnchor: 'conversation-end' });
      return;
    }
    const outcome = skillRegistry.run(call);
    this.appendSkillOutcome(call, outcome);
  },
  appendSkillOutcome(call, outcome) {
    const messages = this.data.messages.concat([{
      id: `skill-${Date.now()}`,
      role: 'skill',
      text: outcome.message || '操作已完成',
      skill: call.skill
    }]);
    this.setData({ messages, scrollAnchor: this.flipAnchor() });
  },
  goSoundPage() { wx.navigateTo({ url: '/pages/sound/index' }); },
  // 确认卡：用户点「执行」。
  confirmSkill(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.messages.findIndex((item) => item.id === id);
    if (index === -1 || this.data.messages[index].role !== 'skill-confirm') return;
    const call = this.data.messages[index].call;
    const outcome = skillRegistry.executeNow(call);
    const messages = this.data.messages.slice();
    messages[index] = { id, role: 'skill', text: outcome.message || '操作已完成', skill: call.skill };
    this.setData({ messages, scrollAnchor: this.flipAnchor() });
  },
  // 确认卡：用户点「取消」。
  cancelSkill(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.messages.findIndex((item) => item.id === id);
    if (index === -1 || this.data.messages[index].role !== 'skill-confirm') return;
    const messages = this.data.messages.slice();
    messages[index] = { id, role: 'skill', text: '已取消，今晚先不做这个' };
    this.setData({ messages });
  },
  copyMessage(event) {
    const item = this.data.messages.find((message) => message.id === event.currentTarget.dataset.id);
    if (!item || !item.text) return;
    wx.setClipboardData({ data: item.text });
  },
  // 赞/踩互斥切换；再次点击同一枚取消。聚合计数写入本地存储。
  setFeedback(event) {
    const { id, value } = event.currentTarget.dataset;
    if (value !== 'like' && value !== 'dislike') return;
    let chosen = '';
    const messages = this.data.messages.map((item) => {
      if (item.id !== id) return item;
      chosen = item.feedback === value ? '' : value;
      return Object.assign({}, item, { feedback: chosen });
    });
    this.setData({ messages });
    if (chosen) this.rememberFeedback(chosen);
  },
  rememberFeedback(kind) {
    try {
      const counts = storage.read(storage.KEYS.agentFeedback, { like: 0, dislike: 0 });
      counts[kind] = (counts[kind] || 0) + 1;
      storage.write(storage.KEYS.agentFeedback, counts);
    } catch (error) { /* 反馈计数不影响对话 */ }
  },
  // 重新生成：清空最后一条夜喵回复并重跑上一轮，不重复用户消息。
  regenerate() {
    const turn = this.lastTurn;
    if (!turn || this.data.chatState === 'sending' || this.data.homeState === 'initial') return;
    const index = this.data.messages.findIndex((item) => item.id === turn.agentId);
    if (index === -1) return;
    const messages = this.data.messages.slice();
    messages[index] = Object.assign({}, messages[index], { text: '', done: false, feedback: '' });
    this.setData({ messages, chatState: 'sending', awaitingFirst: true, streamState: 'listening', recommendation: null, homeState: 'chat', scrollAnchor: this.flipAnchor() });
    this.runAgentTurn(turn);
  },
  stopGeneration() {
    if (!this.pendingAgent) return;
    this.userStopped = true;
    this.pendingAgent.abort();
  }
});
