# 夜喵首页 · 质感与排布升级规划（2026-10-14）

## 0. 目标与硬性要求

- 用户反馈：首页「感觉有点乱」；要求 质感升级、UI 升级、排布合理；先规划，并优化配图提示词。
- 硬性不变：底部输入条 + 导航常驻；路由与行为不变（话题预填、开始引导、设置、记录）；`tests/*.test.js` 全绿；字号模式（大/小）与显示模式（完整/沉浸）条件保留。
- 范围：首页 `pages/agent/*`；配图与提示词本轮不动（用户决定：先制作排版，见 §4）；对话页与二级页不动。
- 校验兼容：`tools/verify-nightcat.js` 依赖类名 `.welcome-card` `.topic-grid` `.practice-card` `.topic-chip` `.guide-button` `.night-composer` `.night-nav-item` —— 类名只增不改。

## 1. 现状诊断（375 预览 + 窄屏截图）

1. 标题区压猫脸：居中标题 + 副标题叠在猫面部，副标题与毛发糊在一起；「夜喵」在标题与副标题内重复。
2. 练习卡三列挤压：封面 + 文案 + 金色胶囊并排，375 下 detail 折行留「松」孤字，320 更糟。
3. 输入条窄屏折行：占位文案在 320 折为两行，发闷。
4. 盒子同质：问候卡 / 话题格 / 练习卡 / 输入条 均为「描边 + 圆角 + 深底」，轻重不分 → 乱。
5. 底部空档：内容不足一屏时，练习卡与输入条之间大片留白，比例失衡。
6. 素材与版式脱节：猫脸恰被文字压住；两张配图提示词为通用描述，未考虑 UI 文字区与配色对齐。

## 2. 方案：「安静的一屏」——少盒子、强主次、稳节奏

视觉权重自上而下：**问候（纯文字）→ 话题（轻格）→ 练习卡（唯一金 CTA）→ 输入条（常驻 dock）**。

- Hero（540rpx 高度不变）
  - 标题区保留居中但整体上移入顶部暗色带（2026-10-14 用户确认）：标题 `夜喵` + 短副标题 `你的 AI 睡前陪伴`（去重复、缩小、收紧间距），文字不再压猫脸，中心区干净不杂乱；设置键居右。
- 问候：去掉卡片盒子 → 48rpx 头像 + 两行纯排版（第二行暖金），无描边无底。
- 话题格：chevron 降透明度（约 .45）；竖距 16rpx；触控高度维持。
- 练习卡（排布核心修正）：两段式 ——
  - 上排：封面 112rpx + 文案（近满宽，detail 不再孤字折行）；
  - 下排：整宽金色胶囊 `开始引导`（44px 高），主行动唯一且明确；
  - 320 下不再隐藏封面。
- 输入条：占位文案 `nowrap + ellipsis`，窄屏优雅截断；结构（sparkles / divider / send）保留。
- 节奏：统一 20rpx 竖距；375×812 首屏完整；320×640 允许滚动（dock 常驻，既有约定）。

## 3. 质感升级（token 级、克制）

- 卡片：统一 `border-radius: 32rpx`；加顶部高光 `inset 0 1rpx 0 rgba(255,255,255,.05)`；阴影分两级（卡片 `0 10rpx 28rpx` / dock `0 12rpx 32rpx`）。
- Hero：标题加投影 `0 2rpx 16rpx rgba(0,0,0,.5)`；shade 渐变更顺防色带；标题字距 8rpx、副标题 2rpx。
- 金色 CTA：渐变 + 内高光 + 按压 spring（沿用 `--ease-spring`）。
- 动效：保留入场错峰（60 / 110 / 160 / 200ms）与 ≤360ms 约束；新元素沿用 `home-up`。

## 4. 配图提示词优化（v2，暂缓）

2026-10-14 用户决定：本轮不改提示词、不重新生成配图，先制作排版。以下 v2 提示词存档备用，后续可另行启用。

目标（启用时）：素材与版式互相成就 —— 为标题区留白、配色对齐 token、细节更贵。

**Cat prompt v2（3:2，1536×1024 → 压缩）**

> A fluffy grey tabby and white kitten asleep on dark teal bedding, eyes closed, white muzzle and pink nose, one white paw stretched toward the viewer, body curled to the right. Framed slightly right of center and low, keeping the upper-left third calm and uncluttered (soft curtain wall in shadow) as negative space for UI text. Warm amber moonlight rims the fur; soft window glow with a crescent moon upper right, indoor plant softly out of focus at the left edge. Deep emerald-teal night palette (#061719 / #0a2422) with muted gold accents (#eccb8a); fine fur micro-detail, atmospheric haze and faint dust motes in the moonbeam, shallow depth of field, painterly and cinematic. Wide 3:2 composition, key subject within the central 90%, no people, text, UI, border or watermark.

**Cover prompt v2（1:1，1024）**

> Square painterly nighttime illustration: a pale golden crescent moon with a soft glow halo above a quiet dark-teal mountain lake, thin mist over the water, faint stars, golden moonlight rippling on the still surface, dandelion flowers and seed heads in soft-focus foreground, a few drifting seeds and tiny fireflies catching the light. Deep emerald-teal palette with muted gold specular highlights, rich tonal depth, gentle grain, calm and dreamy. No text, UI, frame or watermark.

- 压缩：Pillow（本机已装）JPEG q82 progressive，单图 ≤ 200KB。
- 文档：更新 `docs/design/README.md` 的 Assets 段（v2 提示词 + 文件字节数）。

配图执行方式：本轮暂缓执行（启用时默认 A：本机生成 → 压缩 → 预览比对；亦可 B：自行生成后替换）。

## 5. 批次与验证

- 批次 A · 排布重构：`pages/agent/index.wxml` + `index.wxss`。
- 批次 B · 质感 tokens：`index.wxss`。
- 批次 C · 全量验证与档案：预览 320/375/430 截图、`browser-checks.json`、规划文档状态。
- 每批间：`node --test tests/*.test.js` 全绿；C 后跑 `node tools/verify-nightcat.js`（320/375/430：无横向溢出、资源完整、触控 ≥44px、输入条贴底）并更新 `docs/design/preview-*.png`。

## 6. 验收

- 375×812 首屏完整；320 无横向溢出、练习卡无孤字、输入条单行；430 比例不失衡。
- `verify-nightcat.js` 全绿；`node --test` 88/88；截图档案更新。
- 真机手感（键盘避让等）由用户确认；本规划不宣称真机通过。

## 7. 已知风险

- 类名改动会破坏校验脚本 → 类名只增不改。
- 新图体积超标时回退旧图，或降低 JPEG 质量压到阈值。
- 320×640 首屏不能全见 → 允许滚动（既有约定）。
- 标题上移需与猫图裁切配合，320 窄屏为最严场景，以截图校准。

## 8. 执行状态（2026-10-14）

- [x] 规划确认（2026-10-14：标题保持居中、上移去杂乱；配图暂缓，先制作排版）
- [x] 批次 A 排布重构
- [x] 批次 B 质感 tokens
- [x] 批次 C 全量验证与档案

执行要点：猫图整体下移 120rpx（`.hero` 加 `overflow: hidden`），标题带与猫耳分离；顶部渐隐加强，融合图片上边缘；问候去盒改纯排版；练习卡两段式（图文近满宽 + 整宽金 CTA）；输入条 `nowrap + ellipsis`；卡片加顶部高光与两级阴影。

验证：`node --test` 88/88；`tools/verify-nightcat.js` 三档（320 / 375 / 430）全绿 —— 320×640 首屏完整（练习卡底 498px < 输入条顶 507px）、无横向溢出、资源完整、触控 ≥44px、输入条贴底；截图与 `browser-checks.json` 已更新。

待办（真机确认）：标题区与猫图的观感、键盘避让手感。

## 9. 增量：练习卡折叠 + 高屏排布（2026-10-14）

- 练习卡默认收缩：仅封面 + 标题行 + 金色箭头；点按整行丝滑展开，露出整宽「开始引导」CTA，再点收起。
- 动效：`max-height 0 → 160rpx` + opacity + `translateY(-8rpx)`，340ms `--ease-out`（≤360ms 约定）；箭头 280ms 旋转 45°→225°；展开态卡边描金加深；`practice-main` 按压 opacity .78。
- 状态：`practiceOpen`（onShow 复位为 false）；`togglePractice` 轻触感（沿用 try/catch 静默风格）；整行可点（≥44px）。
- 高屏加强 `@media (min-height: 720px)`：hero 540→600rpx、话题/练习卡竖距 20→24rpx，与矮屏画面占比对齐（375×812、430×932 生效）。
- 校验升级：`verify-nightcat.js` 增练习卡「收缩→展开→收起」断言（collapsed 80px → expanded 133px，guide 44px ≥ 43.9；展开态不压输入条；收起后高度回差 ≤1px）与 `preview-practice-open.png`；`browser-checks.json` 增 `practice` 字段。
- 修复：预览器 `moduleSources()` 补 walk `experts/`（新专家模块未被加载，对话流程报 `buildActivePrompt is not a function`）。
- 结果：`node --test` 111/111；三档校验全绿；练习卡底边余量（收缩态）：320 56.8px / 375 127.2px / 430 158.9px；320 展开态仍余约 5px，不作为常驻状态。
