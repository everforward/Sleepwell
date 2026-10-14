const navigation = require('../../utils/navigation');
const { getNavigationMetrics } = require('../../utils/layout');
const agentMessages = require('../../services/agent-messages');

Page({
  data: { nav: getNavigationMetrics(), messages: [], unread: 0 },
  onShow() {
    this.refresh();
  },
  // 每次回到本页都重读存储：角标、未读点与消息列表保持同一份事实。
  refresh() {
    const messages = agentMessages.list().map((item) => ({
      id: item.id,
      kindLabel: agentMessages.kindLabel(item.kind),
      text: item.text,
      when: agentMessages.whenLabel(item.at),
      read: Boolean(item.read)
    }));
    this.setData({
      nav: getNavigationMetrics(),
      messages,
      unread: messages.filter((item) => !item.read).length
    });
  },
  openMessage(event) {
    if (agentMessages.markRead(event.currentTarget.dataset.id)) this.refresh();
  },
  markAllRead() {
    if (agentMessages.markAllRead()) this.refresh();
  },
  goBack() { navigation.backOrHome(); }
});
