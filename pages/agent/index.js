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
const expertRegistry = require('../../experts/registry');
const agentTasks = require('../../services/agent-tasks');
const agentMessages = require('../../services/agent-messages');
const agentReviews = require('../../services/agent-reviews');
const agentPush = require('../../services/agent-push');
const subscribe = require('../../utils/subscribe');
const agentIcons = require('../../utils/agent-icons');

const RENDER_THROTTLE_MS = 80;

// 对话页「+」面板：无需打字的快捷技能与助眠声；icon 名对应 utils/agent-icons 的导出。
const QUICK_SKILLS = [
  { key: 'guide-night', skill: 'bedtime_guide', args: { script: 'night' }, label: '星夜慢行', icon: 'guideNight' },
  { key: 'guide-body', skill: 'bedtime_guide', args: { script: 'body' }, label: '身体扫描', icon: 'guideBody' },
  { key: 'recall', skill: 'park_thoughts', args: { action: 'recall' }, label: '取回心事', icon: 'recall' },
  { key: 'stop-sound', skill: 'stop_sound', args: {}, label: '停止播放', icon: 'pause' }
];
const QUICK_SOUNDS = [
  { key: 'sound-rain', skill: 'play_sound', args: { sound: 'rain', minutes: 30 }, label: '雨声', icon: 'rain' },
  { key: 'sound-breeze', skill: 'play_sound', args: { sound: 'breeze', minutes: 30 }, label: '微风', icon: 'breeze' },
  { key: 'sound-lake', skill: 'play_sound', args: { sound: 'lake', minutes: 30 }, label: '湖水', icon: 'lake' },
  { key: 'sound-noise', skill: 'play_sound', args: { sound: 'white', minutes: 30 }, label: '白噪音', icon: 'noise' }
];

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
    practiceOpen: false,
    panelOpen: false,
    drawerOpen: false,
    expertCards: [], activeExpert: '', activeExpertLabel: '', starters: [], quickSkills: [], quickSounds: [],
    lullabies: [
      { key: 'cradle', title: '摇篮曲' },
      { key: 'piano', title: '夜航钢琴' },
      { key: 'forest', title: '森林低语' }
    ],
    // 未来板块入口（听书 / 电台待搭建）：先占位，页面上线后把跳转接进 tapChannel。
    channels: [
      { key: 'listen', title: '听书', hint: '夜航书架 · 睡前伴读', icon: 'listen' },
      { key: 'radio', title: '电台', hint: '深夜人声 · 陪你入眠', icon: 'radio' }
    ],
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
    sevenDay: { activeDays: 0, completedSessions: 0, outcomes: { relieved: 0, same: 0, tense: 0 } },
    messageBadge: 0,
    sendEcho: '',
    menuForId: '',
    reviewForId: '',
    reviewDraft: '',
    reviewQuote: '',
    reviewVote: '',
    reviewHadReason: false,
    canSubmitReview: false
  },
  onLoad() {
    this.keyboardListener = (event) => {
      this.setData({ keyboardHeight: this.data.showChat ? Math.max(0, event.height || 0) : 0 });
    };
    if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this.keyboardListener);
  },
  onShow() {
    const preferences = nightPreferences.read();
    this.setData(Object.assign({
      nav: getNavigationMetrics(), preferences, welcomeQuestion: preferences.question, displayMode: preferences.display,
      fontMode: preferences.fontSize, aiLocked: !accessCode.isUnlocked(), practiceOpen: false, drawerOpen: false
    }, this.panelState()));
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    this.deliverDueTasks();
    this.refreshMessageBadge();
    this.startDueWatch();
  },
  onHide() {
    this.stopDueWatch();
    this.cancelPending();
    this.cancelFollowups();
    this.setData({ inputFocus: false, gateFocus: false, keyboardHeight: 0 });
  },
  onUnload() {
    this.stopDueWatch();
    this.cancelPending();
    this.cancelFollowups();
    if (wx.offKeyboardHeightChange && this.keyboardListener) wx.offKeyboardHeightChange(this.keyboardListener);
  },
  onShareAppMessage() { return { title: '夜喵，你的 AI 睡前陪伴助手', path: '/pages/agent/index' }; },
  onShareTimeline() { return { title: '夜喵，你的 AI 睡前陪伴助手' }; },
  noop() {},
  openSettings() { wx.navigateTo({ url: '/pages/night-settings/index' }); },
  goBreathe() { wx.reLaunch({ url: '/pages/breathe/index' }); },
  startGuide() { wx.navigateTo({ url: '/pages/focus/index' }); },
  // 练习卡：默认收缩，点按整行丝滑展开 / 收起。
  togglePractice() {
    const practiceOpen = !this.data.practiceOpen;
    this.setData({ practiceOpen });
    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响展开 */ } }
  },
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
    this.setData(Object.assign({
      homeState: 'chat', showChat: true, activeTopic: topic, answers: [], recommendation: null, panelOpen: false, drawerOpen: false,
      messages: [{ id: 'intro', role: 'agent', text: this.buildOpening(topic) }],
      draft: '', canSend: false, awaitingFirst: false, inputFocus: false, scrollAnchor: 'conversation-end'
    }, this.panelState()));
  },
  playRecommendation() {
    const item = this.data.recommendation;
    if (item) wx.navigateTo({ url: `/pages/sound/index?sound=${item.sound}&minutes=${item.minutes}` });
  },
  openChatSettings() { wx.navigateTo({ url: '/pages/night-settings/index?from=chat' }); },
  // 「+」面板的完整状态：专家卡、当前专家、开场白与两支快捷清单（按权限过滤）。
  panelState() {
    const cards = expertRegistry.list().map((card) => Object.assign({}, card, {
      emblem: card.name === 'yalom' ? agentIcons.emblemRipple : agentIcons.emblemStar
    }));
    const current = expertRegistry.current();
    const active = cards.find((item) => item.name === current) || null;
    const allow = (item) => skillRegistry.getPermission(item.skill) !== 'off';
    return {
      expertCards: cards,
      activeExpert: active ? active.name : '',
      activeExpertLabel: active ? active.label : '',
      activeExpertEmblem: active ? active.emblem : '',
      starters: active && active.starters ? active.starters : [],
      quickSkills: QUICK_SKILLS.filter(allow),
      quickSounds: QUICK_SOUNDS.filter(allow)
    };
  },
  // 「+」开合：展开前先收键盘，面板顶替键盘位置，避免两者叠加占位。
  togglePanel() {
    const panelOpen = !this.data.panelOpen;
    if (wx.hideKeyboard) wx.hideKeyboard();
    this.setData({ panelOpen, drawerOpen: false, inputFocus: false, scrollAnchor: panelOpen ? this.flipAnchor() : this.data.scrollAnchor });
    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响面板开合 */ } }
  },
  // 右侧抽屉：详细功能（专家视角详版、新对话、对话设置、安眠曲占位）。
  openDrawer() {
    if (wx.hideKeyboard) wx.hideKeyboard();
    this.setData({ drawerOpen: true, panelOpen: false, inputFocus: false });
    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响抽屉开合 */ } }
  },
  closeDrawer() { this.setData({ drawerOpen: false }); },
  toggleDrawer() { if (this.data.drawerOpen) this.closeDrawer(); else this.openDrawer(); },
  // 新对话：先收尾旧的一轮（后台生成摘要供记忆），再开一段干净的新对话。
  startNewSession() {
    if (this.data.messages.length > 1) {
      try { agentMemory.summarizeConversation(this.data.messages, this.data.activeTopic); } catch (error) { /* 摘要失败不阻塞新开对话 */ }
    }
    this.cancelPending();
    this.cancelFollowups();
    this.lastTurn = null;
    this.beginConversation('');
    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响新开对话 */ } }
  },
  // 安眠曲占位：曲库未上线，点按只给提示。
  tapLullaby(event) {
    const title = event.currentTarget.dataset.title || '安眠曲';
    if (wx.showToast) wx.showToast({ title: `${title}正在调音，很快上线`, icon: 'none' });
    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响占位提示 */ } }
  },
  // 内容频道占位：听书 / 电台板块未搭建，点按只给提示。
  tapChannel(event) {
    const title = event.currentTarget.dataset.title || '内容';
    if (wx.showToast) wx.showToast({ title: `${title}板块正在搭建，很快见面`, icon: 'none' });
    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响占位提示 */ } }
  },
  chooseExpert(event) { this.applyExpert(event.currentTarget.dataset.name || ''); },
  clearExpert() { this.applyExpert(''); },
  applyExpert(name) {
    nightPreferences.save({ expert: name });
    const card = this.data.expertCards.find((item) => item.name === name);
    const text = card
      ? `好，接下来我会带着「${card.label}」的视角陪你。`
      : '好，切回夜喵本体的陪伴。';
    const messages = this.data.messages.concat([{ id: `expert-${Date.now()}`, role: 'skill', text }]);
    this.setData(Object.assign({ messages, panelOpen: false, drawerOpen: false, inputFocus: false, scrollAnchor: this.flipAnchor() }, this.panelState()));
    if (wx.hideKeyboard) wx.hideKeyboard();
    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响切换 */ } }
  },
  // 点专家开场白：填入输入框供用户增删后发送。
  useStarter(event) {
    const text = event.currentTarget.dataset.text || '';
    if (!text) return;
    this.setData({ draft: text, canSend: true, panelOpen: false, drawerOpen: false, inputFocus: true });
  },
  // 点快捷技能/助眠声：明确意图，直接执行并收起面板，结果走技能反馈气泡。
  quickSkill(event) {
    const key = event.currentTarget.dataset.key;
    const item = this.data.quickSkills.concat(this.data.quickSounds).find((entry) => entry.key === key);
    if (!item) return;
    const call = { skill: item.skill, args: item.args };
    const outcome = skillRegistry.executeNow(call);
    this.appendSkillOutcome(call, outcome);
    if (wx.hideKeyboard) wx.hideKeyboard();
    this.setData({ panelOpen: false, inputFocus: false });
    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响执行 */ } }
  },
  // 推送卡片：声音与练习类直接执行；书与记录类替用户开口，走正常对话轮。
  tapPushCard(event) {
    const { id, index } = event.currentTarget.dataset;
    const message = this.data.messages.find((item) => item.id === id);
    const card = message && message.push ? message.push[Number(index)] : null;
    if (!card) return;
    const action = agentPush.resolveCardAction(card);
    if (!action) return;
    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (error) { /* 触感反馈失败不影响卡片点按 */ } }
    if (action.type === 'skill') {
      const outcome = skillRegistry.executeNow(action.call);
      this.appendSkillOutcome(action.call, outcome);
      return;
    }
    this.setData({ draft: action.text, canSend: true });
    this.sendMessage();
  },
  // 选项提问：点即作答，按普通用户发言发出；未作答的旧选项随用户开口自动收起。
  answerAsk(event) {
    const { id, index } = event.currentTarget.dataset;
    const message = this.data.messages.find((item) => item.id === id);
    const ask = message && message.ask;
    if (!ask || ask.done) return;
    const choice = ask.options[Number(index)];
    if (!choice) return;
    const messages = this.data.messages.map((item) => (
      item.id === id ? Object.assign({}, item, { ask: Object.assign({}, ask, { done: choice }) }) : item
    ));
    this.setData({ messages, draft: choice, canSend: true });
    this.sendMessage();
  },
  // 用户自己开口了：还没作答的选项卡就地作废，防止旧选项之后再被点。
  closeOpenAsks(messages) {
    if (!messages.some((item) => item.ask && !item.ask.done)) return messages;
    return messages.map((item) => (item.ask && !item.ask.done ? Object.assign({}, item, { ask: Object.assign({}, item.ask, { done: true }) }) : item));
  },
  chooseTopic(event) {
    const topic = this.data.topics.find((item) => item.id === event.currentTarget.dataset.id);
    if (!topic) return;
    this.beginConversation(topic.id);
  },
  // 打开小程序时补发到点的约定任务：没有订阅消息通道时，这是「到点提醒」的兜底。
  // 前台轮询（startDueWatch）也复用这里，应用开着时到点同样能收到。
  deliverDueTasks() {
    let due = [];
    try { due = agentTasks.takeDueCatchUp(); } catch (error) { due = []; }
    if (!due.length) return;
    this.pushMessages(due);
    this.refreshMessageBadge();
    const now = Date.now();
    if (this.data.homeState === 'initial') {
      this.beginConversation('');
      const messages = this.data.messages.slice();
      messages[0] = Object.assign({}, messages[0], { text: due[0].text, done: true });
      for (let index = 1; index < due.length; index += 1) {
        messages.push({ id: `catch-up-${now}-${index}`, role: 'agent', text: due[index].text, done: true });
      }
      this.setData({ messages, scrollAnchor: this.flipAnchor() });
      return;
    }
    const messages = this.data.messages.concat(due.map((task, index) => ({
      id: `catch-up-${now}-${index}`,
      role: 'agent',
      text: task.text,
      done: true
    })));
    this.setData({ messages, scrollAnchor: this.flipAnchor() });
  },
  // 消息中心留档：补发内容同步写入「消息」列表（未读），入口角标随之点亮。
  pushMessages(due) {
    try {
      agentMessages.push(due.map((task) => ({ kind: task.kind, text: task.text })));
    } catch (error) { /* 消息落档失败不影响对话内补发 */ }
  },
  refreshMessageBadge() {
    let count = 0;
    try { count = agentMessages.unreadCount(); } catch (error) { count = 0; }
    this.setData({ messageBadge: count });
  },
  openMessages() { wx.navigateTo({ url: '/pages/night-messages/index' }); },
  // 应用停在前台时到点也能收到提醒：轻量轮询，走与打开时相同的补发逻辑。
  startDueWatch() {
    if (this.dueWatcher || typeof setInterval !== 'function') return;
    this.dueWatcher = setInterval(() => this.deliverDueTasks(), 30000);
  },
  stopDueWatch() {
    if (!this.dueWatcher) return;
    clearInterval(this.dueWatcher);
    this.dueWatcher = null;
  },
  closeChat() {
    this.cancelPending();
    this.cancelFollowups();
    if (this.focusTimer) { clearTimeout(this.focusTimer); this.focusTimer = null; }
    if (this.data.messages.length > 1) {
      // 后台生成对话摘要供下次开场使用；失败静默跳过，不阻塞返回首页。
      agentMemory.summarizeConversation(this.data.messages, this.data.activeTopic);
    }
    if (wx.hideKeyboard) wx.hideKeyboard();
    this.setData({ homeState: 'initial', showChat: false, messages: [], answers: [], recommendation: null, draft: '', canSend: false, awaitingFirst: false, chatState: 'idle', inputFocus: false, gateFocus: false, codeInput: '', codeError: false, keyboardHeight: 0, panelOpen: false, drawerOpen: false, sendEcho: '', menuForId: '', reviewForId: '', reviewDraft: '', reviewQuote: '', reviewVote: '', reviewHadReason: false, canSubmitReview: false });
  },
  onDraftChange(event) { this.setData({ draft: event.detail.value, canSend: Boolean(event.detail.value.trim()) }); },
  onInputFocus() { this.setData({ inputFocus: true, panelOpen: false, drawerOpen: false }); },
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
      expert: expertRegistry.buildActivePrompt(),
      onDelta: (text) => this.updateAgentText(text),
      onComplete: (result) => {
        this.pendingAgent = null;
        if (this.data.homeState === 'initial') return; // 对话已被关闭，丢弃迟到的回复
        if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
        this.flushAgentText(result.text);
        // 推送卡片与选项提问挂在回复气泡上（有才挂，避免 wx:if 里判空）。
        const extras = { done: true };
        if (result.push && result.push.length) extras.push = result.push;
        if (result.ask) extras.ask = result.ask;
        const messages = this.data.messages.map((item) => (item.id === agentId ? Object.assign({}, item, extras) : item));
        this.setData({
          messages,
          chatState: 'idle',
          awaitingFirst: false,
          streamState: 'idle',
          lastAgentId: agentId,
          recommendation: result.recommendation || null,
          homeState: result.recommendation ? 'recommendation' : 'chat'
        });
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
    this.cancelFollowups(); // 用户开口说话即打断入睡引导
    const answers = this.data.answers.concat(message);
    const history = this.closeOpenAsks(this.data.messages).concat([{ id: `user-${answers.length}`, role: 'user', text: message }]);
    const agentId = `agent-${answers.length}`;
    // 发送涟漪：a/b 交替保证同一个节点上动画每次重放（同 flipAnchor 的重播技巧）
    this.echoFlip = !this.echoFlip;
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
      panelOpen: false,
      drawerOpen: false,
      sendEcho: this.echoFlip ? 'a' : 'b',
      menuForId: '',
      scrollAnchor: this.flipAnchor()
    });
    if (wx.hideKeyboard) wx.hideKeyboard();
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
    // 重试不是新一轮发送：清掉回波类，避免停止键重新挂载时重放涟漪
    this.setData({ messages, chatState: 'sending', awaitingFirst: true, streamState: 'listening', recommendation: null, homeState: 'chat', sendEcho: '', scrollAnchor: this.flipAnchor() });
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
    const now = Date.now();
    const messages = this.data.messages.concat([{
      id: `skill-${now}`,
      role: 'skill',
      text: outcome.message || '操作已完成',
      skill: call.skill
    }]);
    if (outcome.action && outcome.action.type === 'subscribe') {
      messages.push(this.buildActionMessage(outcome.action, now));
    }
    this.setData({ messages, scrollAnchor: this.flipAnchor() });
    if (outcome.followups && outcome.followups.length) this.scheduleFollowups(outcome.followups);
  },
  // 订阅消息授权卡片：到点提醒需要用户在微信里点一次「允许」。
  buildActionMessage(action, now) {
    return {
      id: `skill-action-${now}`,
      role: 'skill-action',
      text: `想要夜喵${subscribe.labelFor(action.kinds)}，需要在微信里允许一次提醒。`,
      action
    };
  },
  subscribeSkill(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.messages.findIndex((item) => item.id === id);
    if (index === -1 || this.data.messages[index].role !== 'skill-action') return;
    const action = this.data.messages[index].action;
    subscribe.request(action.kinds, (result) => {
      const current = this.data.messages.findIndex((item) => item.id === id);
      if (current === -1) return;
      const text = result.ok
        ? '已经开启——到点前夜喵会在微信里喊你。'
        : result.unavailable
          ? '微信提醒还没配置好。先记住这条约定：到点打开夜喵，我会喊你。'
          : '这次没有开启微信提醒。没关系，打开夜喵时我照样会喊你。';
      const messages = this.data.messages.slice();
      messages[current] = { id, role: 'skill', text, skill: 'reminder' };
      this.setData({ messages });
    });
  },
  dismissAction(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.messages.findIndex((item) => item.id === id);
    if (index === -1 || this.data.messages[index].role !== 'skill-action') return;
    const messages = this.data.messages.slice();
    messages[index] = { id, role: 'skill', text: '好，先不开启。打开夜喵时我照样会喊你。', skill: 'reminder' };
    this.setData({ messages });
  },
  // 入睡引导的后续段落：按脚本节奏逐段放出，用户开口或离开页面即打断。
  scheduleFollowups(followups) {
    this.cancelFollowups();
    this.guideTimers = [];
    followups.forEach((step) => {
      const timer = setTimeout(() => {
        this.guideTimers = (this.guideTimers || []).filter((item) => item !== timer);
        if (this.data.homeState === 'initial' || !this.data.showChat) return;
        const messages = this.data.messages.concat([{
          id: `guide-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          role: 'agent',
          text: step.text,
          done: true
        }]);
        this.setData({ messages, scrollAnchor: this.flipAnchor() });
      }, Number(step.delayMs) || 9000);
      this.guideTimers.push(timer);
    });
  },
  cancelFollowups() {
    if (!this.guideTimers) { this.guideTimers = []; return; }
    this.guideTimers.forEach((timer) => clearTimeout(timer));
    this.guideTimers = [];
  },
  goSoundPage() { wx.navigateTo({ url: '/pages/sound/index' }); },
  // 确认卡：用户点「执行」。
  confirmSkill(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.messages.findIndex((item) => item.id === id);
    if (index === -1 || this.data.messages[index].role !== 'skill-confirm') return;
    const call = this.data.messages[index].call;
    const outcome = skillRegistry.executeNow(call);
    const now = Date.now();
    const messages = this.data.messages.slice();
    messages[index] = { id, role: 'skill', text: outcome.message || '操作已完成', skill: call.skill };
    if (outcome.action && outcome.action.type === 'subscribe') {
      messages.push(this.buildActionMessage(outcome.action, now));
    }
    this.setData({ messages, scrollAnchor: this.flipAnchor() });
    if (outcome.followups && outcome.followups.length) this.scheduleFollowups(outcome.followups);
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
  // 赞/踩互斥切换；再次点击同一枚取消。聚合计数写入本地存储，明细评价同步落一条（进 memory.md）。
  setFeedback(event) {
    const { id, value } = event.currentTarget.dataset;
    if (value !== 'like' && value !== 'dislike') return;
    let chosen = '';
    let text = '';
    const messages = this.data.messages.map((item) => {
      if (item.id !== id) return item;
      chosen = item.feedback === value ? '' : value;
      text = item.text || '';
      return Object.assign({}, item, { feedback: chosen });
    });
    this.setData({ messages });
    // 改口时已写过的理由会保留；取消评价则整条撤回。
    if (chosen) {
      agentReviews.upsert({ messageId: id, value: chosen, quote: text.slice(0, 24) });
      this.rememberFeedback(chosen);
    } else {
      agentReviews.remove(id);
    }
  },
  // 三点菜单：单条消息的更多操作（写评价理由 / 看夜喵记忆）。
  openMessageMenu(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ menuForId: this.data.menuForId === id ? '' : id });
  },
  // 评价弹层：带上这条回复的节选与当前态度，已写过的理由回填可改。
  openReview(event) {
    const id = event.currentTarget.dataset.id;
    const message = this.data.messages.find((item) => item.id === id);
    if (!message) return;
    const existing = agentReviews.find(id);
    const reason = (existing && existing.reason) || '';
    const text = message.text || '';
    this.setData({
      menuForId: '',
      reviewForId: id,
      reviewVote: message.feedback || '',
      reviewQuote: text.length > 24 ? `${text.slice(0, 24)}…` : text,
      reviewDraft: reason,
      reviewHadReason: Boolean(reason),
      canSubmitReview: Boolean(reason),
      inputFocus: false,
      panelOpen: false
    });
    if (wx.hideKeyboard) wx.hideKeyboard();
  },
  onReviewInput(event) {
    const value = event.detail.value || '';
    this.setData({ reviewDraft: value, canSubmitReview: Boolean(value.trim()) || this.data.reviewHadReason });
  },
  closeReview() {
    this.setData({ reviewForId: '', reviewDraft: '', reviewQuote: '', reviewVote: '', reviewHadReason: false, canSubmitReview: false });
  },
  // 提交流程：写理由（保留当前赞/踩）；清空理由表示删掉这句话；无态度无理由则不落任何记录。
  submitReview() {
    const id = this.data.reviewForId;
    if (!id) return;
    const message = this.data.messages.find((item) => item.id === id);
    if (!message) { this.closeReview(); return; }
    const reason = this.data.reviewDraft.trim();
    if (!reason && !this.data.reviewHadReason) return;
    const entry = agentReviews.upsert({ messageId: id, value: message.feedback || '', reason, quote: (message.text || '').slice(0, 24) });
    this.closeReview();
    if (!reason) {
      wx.showToast({ title: '这条理由已删掉', icon: 'none' });
      return;
    }
    if (entry) wx.showToast({ title: '已记进夜喵的记忆', icon: 'none' });
    else wx.showToast({ title: '保存失败，再试一次', icon: 'none' });
  },
  openMemory() {
    this.setData({ menuForId: '' });
    wx.navigateTo({ url: '/pages/night-memory/index' });
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
    messages[index] = Object.assign({}, messages[index], { text: '', done: false, feedback: '', push: null, ask: null });
    // 回复被重写，旧回复上的评价（含理由）随之作废。
    agentReviews.remove(turn.agentId);
    this.setData({ messages, chatState: 'sending', awaitingFirst: true, streamState: 'listening', recommendation: null, homeState: 'chat', sendEcho: '', scrollAnchor: this.flipAnchor() });
    this.runAgentTurn(turn);
  },
  stopGeneration() {
    if (!this.pendingAgent) return;
    this.userStopped = true;
    this.pendingAgent.abort();
  }
});
