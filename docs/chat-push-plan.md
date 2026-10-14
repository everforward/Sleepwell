# 夜喵卡片推送与选项提问（2026-10-14）

## 0. 目标

AI 推荐「书 / 助眠声 / 功能」时，回答下方附一组可点卡片（对齐「书中技能」卡的样式语言）；
需要用户在选项里拍板时，附一排可点选项。协议、目录与点卡动作全部落在本机，模型只管「推什么」。

## 1. 协议（services/agent-push.js + agent-client 解析）

- `@@PUSH@@[{"kind":"book","id":"brave"},{"kind":"sound","sound":"white","minutes":30},{"kind":"feature","id":"park"}]`
  - 数组 1-3 项；kind ∈ book / sound / feature；卡片文案、封面、按钮全部由本机目录装配，
    模型只给 kind + id，非法条目静默丢弃 —— 无法杜撰卡片内容，也无法触发目录外的操作。
- `@@ASK@@{"question":"想先从哪件事开始？","options":["聊聊心事","听点声音","先睡一会"]}`
  - question ≤30 字；options 2-4 个、每个 ≤12 字，去重；不满足整体作废。
- 四类标记互斥（@@REC@@ / @@PUSH@@ / @@ASK@@ / @@DO@@），取文本中最先出现者；
  流式期间 JSON 未闭合时对应项为 null，标记文本不进用户可见正文。
- @@REC@@ 保持原样：单一助眠声收尾（准备入睡场景）仍走大推荐卡；书 / 功能 / 多卡组合走 @@PUSH@@。

## 2. 目录

- 书（书中技能）：brave《被讨厌的勇气》边界感练习 / frog《蛤蟆先生去看心理医生》情绪识别 /
  beyond《自卑与超越》自我接纳。封面 `assets/books/{id}.jpg`（ImageGen 生成，576×720 JPEG，44-70KB）。
- 功能：park 取回寄存的心事（park_thoughts recall）/ guide 星夜慢行（bedtime_guide night）/
  journal 记下今晚的小温暖（say）/ dream 趁热记下这个梦（say）。
  skill 权限 off 的功能与助眠声不会进 prompt（模型不知道就不会推）。
- 助眠声：rain / breeze / lake / white；minutes 15 | 30。

## 3. 点卡动作（resolveCardAction，只认目录）

- sound → play_sound 技能直接执行（同「+」面板快捷：明确意图，不经确认），走技能反馈气泡。
- feature（skill 型）→ executeNow + 技能反馈气泡。
- feature（say 型）/ book → 替用户开口（如「我想学《被讨厌的勇气》里的「课题分离」」），走正常对话轮，
  由夜喵带着开始学。
- ask chip → 选项文本作为用户发言发出；该卡片锁定为已选；用户自行打字时，未作答的选项就地作废
  （closeOpenAsks），防止旧选项之后再被点。

## 4. UI

- 卡片托盘：回复气泡与消息操作之间，横向滑动；卡宽 330rpx，封面 106×134rpx；
  feature 用金色内联 SVG 磁贴；标签 chip + 金色动作文案；全部触控 ≥44px。
- 选项：问题一行 + 金边 chip 换行排列；已选变实金底，其余置灰（disabled）。
- `regenerate` 会清掉该气泡的卡片与选项。

## 5. 校验

- tests/agent-push.test.js（9 例）：目录净化、选项净化、动作解析防越权（含 args 拷贝隔离）、
  权限过滤 prompt、标记解析与互斥、沙箱页面流（卡片挂载 → 点书开口 → 点功能执行 → 选项作答 →
  打字作废 → 重新生成清卡）。
- 全量回归：149/149。

## 6. 边界与待办

- 预览器与 verify-nightcat.js 尚未加「卡片托盘 / 选项作答」截图走查；预览器对 scroll-view 的
  scroll-x 目前按 div + overflow-x auto 兜底渲染。
- 「书中技能 · 查看全部」独立页面未做：点书卡目前等价于在对话里开始学习，后续可与专区页打通。
- 书目录扩充与第二张专家卡（罗杰斯等）共用本目录机制。
