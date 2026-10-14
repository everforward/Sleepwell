# 夜喵对话页升级规划（2026-10-14）

## 0. 目标

首页冻结（用户决定：练习卡折叠后不再改）。本轮聚焦对话页：

1. **「+」面板**：输入条左侧加号，展开三块：咨询师能力（专家卡）、助眠练习（技能）、助眠声（快捷播放）。
2. **独特 SVG 功能图标**：对话页全部功能图标改为夜喵专属内联 SVG（24 视框、1.6 圆头描边、星屑细节），与消息操作图标同一语言。
3. **独特发送**：发送/停止从圆形改为金色方圆角（squircle），配定制箭头图标；面板入口「+」展开时旋转成「×」。

## 1. 「+」面板规格

- 位置：输入条内左侧（`[＋][输入][发送]`）；面板在输入条**下方**展开（与键盘同位，微信习惯），输入条随之上移。
- 动效：`max-height 0 → 内容高` + 透明度 + 内容 `translateY(14rpx) → 0`，320ms `--ease-out`；「+」旋转 45° 260ms。
- 收起时机：再点「+」/ 输入框聚焦 / 发送 / 选完专家或技能 / 关闭对话。
- 板块（顺序）：
  1. **咨询师能力**：横向专家卡（夜喵本体 + `experts/registry.list()`），选中金边高亮；选中后卡下列出该专家 starters，点 starter 填入输入框；输入条上方出现「亚隆视角 · 点按切回」胶囊。
  2. **助眠练习**（技能，`skillPermissions !== 'off'` 才显示）：星夜慢行（bedtime_guide night）、身体扫描（bedtime_guide body）、取回心事（park_thoughts recall）、停止播放（stop_sound）。
  3. **助眠声**：雨声 / 微风 / 湖水 / 白噪音（play_sound ×30 分钟）。
- 手动点按 = 明确意图：直接 `skillRegistry.executeNow`（不再确认）；结果走既有技能反馈气泡（含订阅授权卡与引导 followups）。
- 专家切换：`nightPreferences.save({ expert })`；反馈气泡「已切换到「欧文·亚隆 · 存在主义视角」…」/「已切回夜喵本体的陪伴。」；`''` = 夜喵本体。
- 注入链路不变：`agentClient.chat({ expert: expertRegistry.buildActivePrompt() })`。

## 2. 图标系统（utils/agent-icons.js 扩展）

- 新增：`plus`、`back`、`tune`（日轮齿轮）、`sendInk` / `sendMuted`、`emblemStar`（夜喵：月牙+星）、`emblemRipple`（亚隆：涟漪）、`guideNight`、`guideBody`（扫描线）、`recall`（回环箭头）、`pause`、`rain`、`breeze`、`lake`、`noise`（频谱柱）。
- 色彩：`MUTED #8a9b9b` / `GOLD #e8c887` / `RED #c98a8a` / `INK #24312c`（发送箭头深墨）。
- 形式：data-URI 内联，无新增包内文件；既有 like/dislike/copy/regenerate/stop 不动。
- 对话页头部返回、设置按钮由 PNG 换成内联 SVG（首页不动）。

## 3. 发送按钮

- `.chat-send` / `.chat-stop`：圆形 → 圆角方形（88rpx，radius 28rpx），保留金色渐变 + 内高光 + spring 按压。
- 发送图标：`sendInk`（箭头 + 星屑尾迹）；禁用态换 `sendMuted` + 现灰底。

## 4. 校验

- 单测 `tests/agent-panel.test.js`：面板初始态、开关、专家选择持久化 + 气泡、切回夜本体、快捷技能执行 + 收起、off 技能过滤。
- `verify-nightcat.js`：门禁后新增 —— 开面板（板块数、专家 ≥2、技能 4、声音 4、触控 ≥43.9px、面板贴底、流区不挤没）→ 点「雨声」（气泡含「雨声」、面板收起）→ 切「亚隆」（`localStorage` expert=yalom、胶囊出现）→ 点胶囊切回（expert 清空）。截图 `preview-chat-panel.png`、`preview-chat-expert.png`。
- 预览器 `app` 桩补 `playSound/pauseSound`，让声音技能在预览里真实成功。

## 5. 风险

- 320×640 下 面板 + 头部 + 输入条可能挤压流区 → 面板内容高度受控（≈700rpx），校验断言流区 > 40px。
- 专家卡横向滚动：预览器用 `overflow-x: auto` 兜底；真机走 scroll-view。
- 面板与键盘不同时出现：开面板必先 `hideKeyboard`；输入框聚焦必收面板。

## 6. 执行状态（2026-10-14 完成）

- **图标与发送**：`utils/agent-icons.js` 新增 15 枚内联 SVG（plus/back/tune/emblem/send/quick 系）；`.chat-send/.chat-stop` 改 88rpx 方圆角（radius 28rpx）；面板入口「+」展开旋转 45°。对话页头部返回/设置 PNG → SVG。
- **面板**：实现与 §1 一致；四处细节落定 —— ①专家确认气泡文案取 label：`好，接下来我会带着「亚隆」的视角陪你。`；②切回文案 `好，切回夜喵本体的陪伴。`；③快速动作直执后必收面板并震动；④专家 starters 面板内以虚线芯片列出，点按填草稿并聚焦输入框。
- **预览保真修复**：`.chat-input/.chat-gate-input` 显式 `background: transparent`（真机默认透明，预览器 HTML input 默认白底 + 描边会污染截图）；预览器全局重置补 `input,textarea{border:0;background:transparent}`（需重启预览服务进程生效）。
- **校验结果**：`node --test` 126/126（含 `tests/agent-panel.test.js` 7 例）；`verify-nightcat` 320/375/430 全绿 —— 面板 3 板块 / 2 专家卡 / 4 技能 / 4 声音、全部触控 ≥43.9px、面板贴底 812、流区剩 208.7px；点「雨声」真实播放出「已为你播放雨声 · 30 分钟定时」并收纳面板；选亚隆后 `sleepwell.night.preferences.v1.expert=yalom` 落盘、胶囊出现、3 枚 starters 可填草稿；点胶囊切回、偏好清空。截图：`preview-chat-panel.png`、`preview-chat-expert.png`、`preview-chat-send-ready.png`（金色发送激活态）。
- **遗留接线（批次 2 后续）**：专家卡 `sources` 字段一旦由 `tools/build-experts.js` 产出（专家团来源档案硬标准），面板专家卡需补「来源档案」展示入口。
- 未提交：与仓库内并行未提交改动共存，待用户经微信开发者工具走查后一并处理。

## 7. 修订 v2：面板瘦身 + 右侧抽屉（2026-10-14 二轮）

用户反馈「+ 面板太过臃肿」→ 面板只留即时直执，详细/有状态功能迁移到右侧抽屉，安眠曲先占位。

- **「+」面板瘦身**：三板块 → 两板块（助眠练习 / 助眠声），芯片由等宽网格改自适应胶囊单行排布（`flex-wrap` 兜底 320px）；专家卡移出面板。面板高 208px（原 ≈420px），校验加 `height ≤ 240` 防回胖守卫 + 断言面板内专家卡为 0。
- **右侧抽屉（`chat-more`「…」入口）**：宽 `min(76%, 620rpx)`，贴右全高，遮罩 + 滑入 300ms；内容三节：
  1. **咨询师能力**：竖向详版专家行（徽记 / 名称 / 头衔 / 两行简介），夜喵本体在内；选中后下方展开 starters（全宽左对齐芯片）；点按选中即收起抽屉 + 胶囊 + 气泡。
  2. **工具**：新对话（`startNewSession`：摘要旧对话→重置为单条问候，保留专家视角）、对话设置（跳 `night-settings`，取代头部原设置钮）。
  3. **安眠曲占位**：摇篮曲 / 夜航钢琴 / 森林低语，虚线行 +「即将上线」徽标，点按 toast「正在调音，很快上线」，不假装播放。
- **互斥**：面板与抽屉互斥；输入聚焦 / 发送 / 开面板 / 关对话 / 选专家 / 选 starter 均收抽屉。
- **新图标**：`dots`、`close`、`newChat`（气泡+加号）、`lullaby`（八分音符+星）。
- **校验**：`node --test` 140/140（`agent-panel` 增抽屉互斥 / 新对话保留专家 / 占位 toast，harness 补 showToast 捕获）；`verify-nightcat` 面板断言更新 + 新增抽屉块：2 专家行 / 2 工具行 / 3 安眠曲 / 3 徽标、触控 ≥43.9px、贴右（right=375）全高、宽 285<320、点安眠曲 toast 含「很快上线」且抽屉不关、新对话后 user=0/agent=1、亚隆选中落盘、× 与遮罩两种收起全部通过；截图 `preview-chat-drawer.png`、`preview-chat-drawer-starters.png` 新增；修复：starter 芯片基础样式随面板瘦身一并迁移到 `.drawer .starter-*`（否则只剩 min-height，边框/底色丢失）。预览器 `wx.showToast` 桩改为记录 `window.lastToast`（需重启预览服务）。
- **仍未提交**：同上，与仓库内并行未提交改动共存。

## 8. 修订 v3：抽屉精修 + 未来板块入口（2026-10-14 三轮）

- **抽屉精修**：头部加副标题「视角 · 内容 · 工具」；关闭钮改环形描边圆钮；抽屉底叠右上径向金光；正文开合时 340ms 上浮入场（`drawer-rise`）；激活专家行右端加「当前」胶囊标记（随选中切换）。
- **板块重排**：咨询师能力 → 安眠曲 → 深夜频道 → 工具（工具类动作沉底，内容板块聚拢，抽屉读起来更顺）。
- **深夜频道（未来板块入口）**：听书（夜航书架 · 睡前伴读）/ 电台（深夜人声 · 陪你入眠），行内「搭建中」徽标 + 右向箭头提示「将可跳转」；点按 toast「X板块正在搭建，很快见面」，不假跳转；页面建成后把 `navigateTo` 接进 `tapChannel` 即可，入口无需再动。
- **新图标**：`listen`（耳机）、`radio`（话筒）、`chevron`（右向箭头 + 星屑）。
- **校验**：`node --test` 150/150（新增 `tapChannel` toast 用例、channels 数据断言）；`verify-nightcat` 抽屉断言扩到 channels=2 / chevrons=2 / 「当前」标记=1，频道点按 toast 含「搭建」且抽屉保持展开；截图 `preview-chat-drawer.png`、`preview-chat-drawer-starters.png` 复查通过。
- **顺带同步**：`tests/storage-helpers.test.js` 期望列表补 `KEYS.agentReviews`——并行改动（对话评价）已把该键写进 `clearPersonalRecords` 但测试未同步，导致全量套件 1 例红；补齐后全绿（非本轮 UI 工作）。
- **仍未提交**：同上。
