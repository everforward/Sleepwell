const storage = require('../../services/storage');
const { WORLDS, RHYTHMS } = require('../../utils/constants');
const navigation = require('../../utils/navigation');
const { getNavigationMetrics } = require('../../utils/layout');

Page({
  data: {
    settings: storage.getSettings(),
    worlds: WORLDS,
    rhythms: RHYTHMS,
    worldName: '蒲公英',
    rhythmName: '舒缓',
    nav: getNavigationMetrics()
  },

  onLoad() { this.sync(); },
  onShow() { this.setData({ nav: getNavigationMetrics() }); this.sync(); },
  sync() {
    const settings = storage.getSettings();
    this.setData({
      settings,
      worldName: (WORLDS.find((item) => item.id === settings.world) || WORLDS[0]).name,
      rhythmName: (RHYTHMS.find((item) => item.id === settings.rhythm) || RHYTHMS[0]).name
    });
  },
  goBack() { navigation.backOrHome(); },
  onWorldChange(event) {
    const world = WORLDS[Number(event.detail.value)];
    const settings = storage.saveSettings(Object.assign({}, this.data.settings, { world: world.id }));
    this.setData({ settings, worldName: world.name });
  },
  onRhythmChange(event) {
    const rhythm = RHYTHMS[Number(event.detail.value)];
    const settings = storage.saveSettings(Object.assign({}, this.data.settings, { rhythm: rhythm.id, inhaleSeconds: rhythm.inhale, holdSeconds: rhythm.hold || 0, exhaleSeconds: rhythm.exhale }));
    this.setData({ settings, rhythmName: rhythm.name });
  },
  onToggleChange(event) {
    const settings = storage.saveSettings(Object.assign({}, this.data.settings, { [event.currentTarget.dataset.key]: event.detail.value }));
    this.setData({ settings });
  },
  goSound() { wx.navigateTo({ url: '/pages/sound/index' }); },
  clearRecords() {
    wx.showModal({
      title: '清除个人记录？',
      content: '呼吸、感恩日记、睡眠记录、对话记忆和消息会从本机删除，偏好设置会保留。',
      confirmText: '清除',
      confirmColor: '#b87878',
      success: (result) => {
        if (!result.confirm) return;
        storage.clearPersonalRecords();
        wx.showToast({ title: '记录已清除', icon: 'none' });
      }
    });
  },
  resetPreferences() {
    wx.showModal({
      title: '恢复默认偏好？',
      content: '呼吸世界、节奏、声音和提示设置会恢复默认，个人记录不会删除。',
      confirmText: '恢复',
      success: (result) => {
        if (!result.confirm) return;
        storage.resetSettings();
        getApp().resetAudioPreferences();
        this.sync();
        wx.showToast({ title: '已恢复默认', icon: 'none' });
      }
    });
  }
});
