const navigation = require('../../utils/navigation');
const { getNavigationMetrics } = require('../../utils/layout');
const agentMemory = require('../../services/agent-memory');

Page({
  data: { nav: getNavigationMetrics(), content: '', empty: true },
  onShow() {
    this.setData({ nav: getNavigationMetrics() });
    this.refresh();
  },
  // 每次打开都重新渲染并落盘，档案永远与最新记录一致。
  refresh() {
    agentMemory.writeMemoryFile();
    const content = agentMemory.readMemoryFile() || agentMemory.renderMemoryMarkdown();
    this.setData({ content, empty: !content.trim() });
  },
  goBack() { navigation.backOrHome(); },
  clearMemory() {
    wx.showModal({
      title: '清除聊天记忆？',
      content: '夜喵会忘记和你聊过的话题、你让它记住的事、寄存在它这里的心事，以及你留下的评价。练习、睡眠和日记记录会保留。',
      confirmText: '清除',
      confirmColor: '#b87878',
      success: ({ confirm }) => {
        if (!confirm) return;
        if (agentMemory.clearConversationMemory()) {
          this.refresh();
          wx.showToast({ title: '记忆已清除', icon: 'none' });
        } else {
          wx.showToast({ title: '清除失败，请重试', icon: 'none' });
        }
      }
    });
  },
  noop() {}
});
