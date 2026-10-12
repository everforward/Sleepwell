# 夜喵 UI / 动效升级规划（2026-10-12）

## 0. 目标与硬性要求

- 视觉：清爽、精致，接近主流 Agent 工具（ChatGPT / Claude 类）的质感与呼吸感。
- 布局硬性要求：输入框固定在最下方。首页输入条固定在底部导航之上；对话页输入框贴底并随键盘上移。
- 动效：克制丝滑。时长 ≤ 360ms，以位移 + 透明度为主，缓动统一，全部可回退（纯 CSS 动画，不引入 JS 动画循环）。
- 范围（用户确认）：夜喵全流程 + 二级页（记录、夜喵设置、记忆、声音、日记、睡眠、关灯引导）。
  - 不含：呼吸页 / 身体页（Skyline 渲染，另开批次）、语音输入（未接 ASR）、任何新依赖。
- 不破坏：`tests/*.test.js` 全部通过；路由（agent → night-settings / focus / breathe / record）不变；记忆摘要逻辑不变；字号模式（大/小）与显示模式（完整/沉浸）继续生效。

## 1. 设计语言（Design Tokens）

颜色
- 背景：`linear-gradient(180deg, #020e14 0%, #061719 46%, #0a2422 100%)`（沿用）
- 面板：`rgba(18,38,40,.55)` + 1rpx `rgba(168,193,183,.14)` 描边（玻璃感，不加 blur 的地方用不透明回退）
- 主行动色：金 `#ebc979` / 渐变 `#f0d49a → #e2bd76`，深色文字 `#24312c`
- 文本：主 `#f1ebdd`、次 `#a8b9b6`、弱 `#7d8f8d`
- 用户气泡：金色渐变（保留品牌识别），Agent 气泡：深玻璃面板

圆角阶梯：8 / 16 / 24 / 32 / 48 / 圆形
间距：4 的倍数，页面横向 32rpx；卡片内边距 24rpx
动效 token
- `--ease-out: cubic-bezier(.22,.61,.36,1)`（默认）
- `--ease-spring: cubic-bezier(.34,1.2,.64,1)`（气泡、发送钮）
- 时长：按压 120ms / 入场 240ms / 面板 320ms

## 2. 批次 1：首页重构（首屏完整 + 底部输入条）

文件：`pages/agent/index.wxml`、`index.wxss`、`index.js`（少量）

- 页面骨架改为固定视口 flex 列：`hero 区 + 内容滚动区（flex:1）+ 底部停靠区（输入条）+ 底部导航`。
  输入条与导航常驻底部，不再随内容滚动 —— 解决「输入框在页面中部」的问题。
- 主视觉压缩：猫图高度 `520rpx`（约 1/3 屏高），底部渐隐融入背景；标题 / 副标题 / 设置入口悬浮其上。
- 问候气泡：小而精致，去掉尾巴，改为「内容卡片 + 夜喵小头像点」，保留 `displayMode !== '沉浸模式'` 条件。
- 话题：由横向滚动改为 **2×2 网格**（参考稿形态），icon + 文案 + 右侧箭头，48px 触控高度。
- 练习卡：补上封面图（复用 `moon-lake.jpg`），文案左、按钮右，保留「开始引导」路由。
- 底部输入条：保留 `night-composer` 类与 `openChat` 行为；点击后进入全屏对话并延时聚焦输入框。
- 底部导航：选中态金icon + 文本 + 底部指示点（带过渡）；按压反馈统一 `is-pressed`。
- 入场编排：hero 淡入（480ms）→ 标题 → 气泡 → 话题（错峰 40ms）→ 练习卡 → 输入条，全部 ≤ 360ms，只播一次。

验收：375×812 首屏内完整可见 问候语 / 话题 / 练习卡 / 输入条 / 导航；320 / 430 宽无横向溢出；截图存档。

## 3. 批次 2：全屏对话页

文件：`pages/agent/index.wxml`、`index.wxss`、`index.js`（少量）

- 删除行内对话结构，启用全屏对话层（复活并重做原 `wx:if="{{false}}"` 的 `night-chat` 思路）：
  - `position: fixed; inset: 0; bottom: {{keyboardHeight}}px; z-index: 40`，flex 列；
    `transition: bottom 220ms` 让输入框平滑跟随键盘。
  - 顶部栏（`padding-top: nav.navigationBottom`）：返回（= 结束对话，继续触发记忆摘要）、夜喵标题 + 在线状态胶囊、设置入口。
  - 消息流：`scroll-view` 占满剩余高度，双锚点自动滚动方案保留。
  - 底部输入行：胶囊输入框 + 圆形发送钮；发送中变为停止钮（呼吸圈动效）。
- 消息视觉：Agent 左（深玻璃气泡 + 名称小标）、用户右（金渐变气泡）；`lastAgent` 消息下方保留 赞/踩/复制/重新生成 图标行（弱化透明度）。
- 状态表达：聆听中（金点脉冲）/ 回复中（金点波纹）/ 在线（灰点）；流式输出末尾加闪烁光标。
- 对话尾部：小号 ghost 按钮「结束本次对话」；错误态为内联通知 + 重试（复用 `retryTurn`）。
- 技能卡（skill-feedback / skill-confirm）、推荐卡（agent-recommendation）按新设计语言重排。
- 移除废弃的语音按钮与旧 `showChat` 死代码；`keyboardHeight` / `inputFocus` / `showChat` 语义保持不变（测试依赖）。

验收：预览中打开话题进入对话 → 输入框贴底；模拟键盘 300px → 输入行不被遮挡；错误 / 重试 / 推荐 / 技能确认流程与现状一致。

## 4. 批次 3：动效系统

文件：`pages/agent/index.wxss`（+ 少量 JS 触感）

- keyframes 统一命名：`rise-in`（淡入上移）、`hero-in`、`pop-in`（弹性）、`caret-blink`、`dot-wave`、`ring-breathe`、`veil-in`、`screen-up`。
- 首页入场错峰；对话层入场 = 遮罩淡入 + 面板上移（320ms）；消息逐条 `rise-in`（新消息挂载即播）。
- 发送钮状态过渡：禁用（缩 0.92 / 透 45%）→ 可发送（弹回 1 / 240ms spring）；发送中呼吸圈。
- 键盘跟随过渡；按压反馈统一；触感反馈 `wx.vibrateShort`（发送成功 / 回复完成，try-catch 静默）。
- 性能：全部 animation/transition 仅用 transform / opacity / background / bottom；无 JS 逐帧动画。

验收：动效可在预览中逐张截图（静帧），关键状态（流式、错误、推荐、键盘）齐全；真机手感由用户确认。

## 5. 批次 4：二级页统一

文件：`pages/record/*`、`pages/night-settings/*`、`pages/night-memory/*`、`pages/sound/*`、`pages/journal/*`、`pages/sleep/*`、`pages/focus/*`

- 记录页：头图卡、日历（今日环 / 选中金）、周报横幅、日记行、详情底部抽屉（spring + 遮罩淡入）、底部导航与新首页一致。
- 夜喵设置 / 记忆：分区卡片化、行样式统一、switch 金色、面板抽屉动效统一。
- 声音 / 日记 / 睡眠 / 关灯：标题层级、玻璃卡片、主按钮圆角与按压态统一，加轻量入场。
- 约束：**不动 `app.wxss` 中被呼吸页使用的类**（`.page-shell`、`.topbar`、`.icon-button`、`.primary-button` 等），页面级样式在各自 wxss 内覆盖，避免影响 Skyline 页面。

## 6. 验证方式（每批次执行）

1. `node --test tests/*.test.js` — 全绿；不改测试语义（除非行为确有变化并在 README 说明）。
2. `node tools/nightcat-preview.js`（127.0.0.1:4180）+ 更新后的 `tools/verify-nightcat.js`（Playwright，本机运行命令见下）：
   - 320 / 375 / 430 三档：无横向溢出、图片资源完整、关键按钮 ≥ 44px、输入条贴底。
   - 对话：发送 → 错误态 → 重试 → 键盘 300px 不遮挡 → 返回首页 → 记录面板。
   - 截图与结果写入 `docs/design/preview-*.png`、`docs/design/browser-checks.json`。
3. Playwright 运行命令（本机路径）：
   `NIGHTCAT_NODE_MODULES=C:/Users/19237/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node tools/verify-nightcat.js`
4. 微信开发者工具 / 真机最终验收：**只能由用户在真机确认**（键盘避让、Skyline 页面、上传包体积）。本规划不宣称真机已通过。

## 7. 已知风险

- 预览器（nightcat-preview.js）每次 setData 全量重建 DOM，CSS 入场动画在预览动图里会重播；这是预览器特性，真机不受影响，静帧截图仍有效。
- 键盘避让依赖 `wx.onKeyboardHeightChange` + `adjust-position=false`，需真机确认 iOS / Android 差异。
- 首页首屏完整性在超小屏（≤320×568）会退化为可滚动，输入条与导航仍然常驻底部。

## 8. 执行状态（2026-10-12 更新）

- 批次 1 首页重构：完成（主题 320/375/430 三档校验通过）。
- 批次 2 全屏对话页：完成（门禁/流式/错误重试/推荐/键盘 300px 校验通过）；另实现验证码门禁（`services/access-code.js`，对话内输入卡片，网关请求头 `X-Verification-Code`）。
- 批次 3 动效系统：完成（统一 keyframes + 入场错峰 + 发送钮弹簧 + 键盘跟随 + 触感反馈）。
- 批次 4 二级页统一：完成。新增共享主题 `styles/night-theme.wxss`（tokens / is-pressed / 返回键放大 / keyframes），记录、夜喵设置、记忆、声音、日记、睡眠、关灯七个页面统一为夜喵设计语言；`app.wxss` 与呼吸页未改动。顺带修复：night-memory 返回键样式作用域缺失（40px→44px）、关灯页 `\n` 字面量换行、声音页标题与说明未分行。
- 验证：`node --test tests/*.test.js` 88/88；`tools/verify-nightcat.js` 首页 + 对话 + 七个二级页（320/375 双档：无横向溢出、资源完整、主要触控 ≥44px）全绿；`tools/verify-record.js` 记录页交互（回历六行、详情抽屉、长日记、安全区、导航）全绿。截图见 `docs/design/preview-*.png`、`record-data-*.png`。
- 待办（真机确认）：键盘避让 iOS/Android 差异、Skyline 呼吸页、上传包体积；日历格子（约 42px）为 7 列网格的既定例外。
