勘察完成。以下是接缝点与既有约定的全量清单。

# 番茄钟接入点勘察（UI 与交互接缝）

> 全部 path:line 基于当前工作树。凡「代码与 SPEC/PROGRESS 不一致」处已标注，以代码为准。

## 1. 全局骨架 `src/App.tsx`

### 顶栏结构（h-12 = 48px，`App.tsx:155-215`）
| 位置 | 内容 | line | 备注 |
|---|---|---|---|
| 左 | `YearFlow` 品牌字 | `App.tsx:159-161` | font-16 semibold |
| 左 | 主导航 4 项 | `App.tsx:162-178` | `max-md:hidden`；NAV 常量 `App.tsx:21-26` |
| 中 | `GanttToolbarSlot` | `App.tsx:179-181` | `flex-1 justify-center max-md:hidden`；仅 `/gantt` 渲染（`App.tsx:62-66`），内容见 `gantt/GanttToolbar.tsx:68-193`（年份◀▶/四档 radio/今天/FilterMenu/Active Tasks/连线/基线/保存基线/导出）——**中间槽已经很挤** |
| 右 | `SyncIndicator` | `App.tsx:183` | 组件 `components/SyncIndicator.tsx:43-129`，7×7 方按钮 + `absolute` 下拉（非 portal） |
| 右 | `?` 速查表按钮 | `App.tsx:184-198` | `max-md:hidden` |
| 右 | 主题按钮 | `App.tsx:199-213` | 文案「主题：浅色/深色/跟随系统」，`THEME_LABEL/THEME_NEXT` `App.tsx:58-59` |

### 路由表 `App.tsx:217-231`
`/`→`HomeRedirect`（`App.tsx:69-72`，`matchMedia('(max-width: 767px)')` 决定落 `/checkin` 或 `/gantt`）、`/gantt`、`/checkin`、`/review`（唯一 lazy + Suspense，`App.tsx:19` / `221-228`）、`/settings`、`*`→`/`。

### 移动端 `MobileTabBar` `App.tsx:29-56`
`md:hidden`、`border-t`、`paddingBottom: env(safe-area-inset-bottom)`、每项 `min-h-12 flex-1`、icon font-16 + label font-11、active 用 `--accent`。**页面底部在 <768px 已被它 + safe-area 占满。**

### 全局键盘监听（两个独立 window listener）
- `App.tsx:105-123` 撤销/重做：**必须带 ctrl/meta**（`App.tsx:107` 早退），输入态守卫 `App.tsx:108-110`（INPUT/TEXTAREA/isContentEditable）。
- `App.tsx:126-146` 命令面板与速查表：`Ctrl+K` toggle `App.tsx:130-134`（在 typing 守卫之前）；然后 `App.tsx:135` `if (typing || ctrl || meta || alt) return`；`/` `App.tsx:136-138`；`?` `App.tsx:139-142`。

### 浮层挂载点 `App.tsx:233-237`
`<MobileTabBar/>` → `<Toasts/>` → `<Celebration/>` → `<CommandPalette/>` → `<ShortcutHelp/>`，全部是 `BrowserRouter` 内、`<main>` 之后的兄弟节点（因此拿得到 router context）。**常驻迷你计时器的天然位置就是这一串的末尾**（与 Toasts 同级），或作为第 6 个兄弟。

### 常驻迷你计时器会抢的空间（实测 z-index 与几何）
| 竞争者 | 位置 | z | line |
|---|---|---|---|
| `Toasts` | `fixed bottom-4 left-4` | z-50 | `components/Toasts.tsx:10` |
| `BulkBar`（甘特多选时） | `fixed left-1/2 -translate-x-1/2`，`bottom = MINIMAP_H + 12` = 40px | z-40 | `gantt/BulkBar.tsx:38-48`，`MINIMAP_H=28` `gantt/constants.ts:111` |
| `MiniMap` | scroller 之外的底部 28px 常驻带 | — | `gantt/GanttView.tsx:754-761` |
| `TaskDrawer` | `fixed right-0 top:48 bottom:0 width:380` | z-40 | `gantt/TaskDrawer.tsx:69-79`，`DRAWER_W` `:14` |
| `dragHint` 单例 | 跟随光标 fixed | zIndex 60 | `gantt/lib/dragHint.ts:15` |
| `Celebration` | `fixed inset-0` | z-[60] | `components/Celebration.tsx:46` |
| 全部 popover/dialog | — | z-50 | CheckinPopover `:123`、ContextMenu `:347`、BarTooltip `:51`、CommandPalette `:166`、ShortcutHelp `:42`、BackfillDialog `:70`、FilterMenu `:73`、GoalIconPicker `:127`、SyncIndicator 下拉 `:63`、GridHeader `:45` |
| 甘特 sticky 表头 / 左栏 | z-30 / z-40 | — | `gantt/GanttView.tsx:582` / `:584` |

**结论性接缝**：左下被 Toasts 占；底部居中被 BulkBar（仅甘特多选态）+ MiniMap 占；右侧 380px 被 TaskDrawer 占；<768px 底部被 MobileTabBar 占。未被占用的常驻位只有 **顶栏右侧簇（`App.tsx:182`）**、**右上角（TaskDrawer 之上、header 之下）**、**左下 Toasts 之上（bottom ≥ 4rem+）**。

### `ShortcutHelp` 已占用按键全表（`components/ShortcutHelp.tsx:2-36`）
导航与视图：`T`、`+ / −`、`Ctrl+滚轮`、`← / →`、`Shift+← / →`、`Shift+滚轮`、`空格+拖拽`、`B`、`双击目标行`
编辑：`N`、`M`、`Ctrl+Z`、`Ctrl+Shift+Z / Ctrl+Y`、`Del`、`Esc`
其他：`/ 或 Ctrl+K`、`D`、`?`

处理器层实际占用（速查表未列全的部分）：
- `gantt/GanttView.tsx:457-525` switch：`t/T`、`+`、`=`（等号也是放大）、`-`、`ArrowLeft/Right`（Shift=30 天）、`b/B`、`d/D`、`n/N`、`m/M`、`Delete`。**只在 `/gantt`（GanttView 挂载）生效**，守卫 `:452-454`。
- `gantt/GanttView.tsx:239-248` `Escape` → 清多选。
- 空格：`gantt/hooks/useSpacePan.ts:26`。
- `Esc` 消费者共 9 处（会互相竞争，注意 capture 顺序）：`CheckinPopover.tsx:72-77`（**capture=true，早于甘特清多选**）、`ContextMenu.tsx:322`、`TaskDrawer.tsx:49-51`、`FilterMenu.tsx:24-26`、`GoalIconPicker.tsx:93-95`、`lib/dragCore.ts:84-94`（capture）、`grid/InlineInput.tsx:53`、`CommandPalette.tsx:206`、`BackfillDialog.tsx:74`。

**未占用的单字母键**：`P`（番茄钟的自然首选）、`A/C/E/F/G/H/I/J/K/L/O/Q/R/S/U/V/W/X/Y/Z`（无修饰时）。注意 `Y`、`Z`、`K` 已被 ctrl 组合占。
**约定**：新增全局单键必须复刻 `App.tsx:129`/`:135` 的 typing 守卫；两个 window listener 之间没有 stopPropagation，`/gantt` 上会同时触发 App 层与 GanttView 层，新键不得与 GanttView switch 的 case 撞。新增快捷键**必须同时补进** `components/ShortcutHelp.tsx:2-36` 的 GROUPS（既有约定：速查表是快捷键的唯一文档）。

---

## 2. 打卡页 `src/pages/CheckInPage.tsx` + `src/checkin/*`

### 页面层结构
`CheckInPage.tsx:136` 容器 `mx-auto max-w-2xl p-6 max-md:p-4`：
- 标题行 `:137-165`（`今日打卡`/`补卡 · M月D日`、`回到今天`、右侧 `批量补卡` 按钮 `ml-auto`）
- 年度进度文字 + 3px 细条 `:166-178`
- `DayStrip` `:180`
- 列表容器 `:189`（`ref={listRef} mt-3 flex flex-col gap-2`）：全部完成庆祝卡 `:190-212` → `待打卡·N` `:214-215` → `已完成·N` `:217-218` → `休息中·N` `:220-221`
- `AdhocSection` `:225`
- 昨日缺卡入口 `:227-249`
- `BackfillDialog` `:251`

分组口径 `:100-103`：`pending/finished/resting` 由 `entry.exempt` 与 `entry.allRecorded` 决定（`allRecorded` = 该目标当日全部在办任务都有记录，定义在 `lib/derive/dayPanel.ts:47-48`）。
展开态 `:45` `expandedGoalId` 是**单开手风琴**，只服务单任务目标；多任务目标每行自管展开（`GoalCheckCard.tsx:210`）。

### 每目标 / 每任务行结构（`src/checkin/GoalCheckCard.tsx`）
- 卡片外壳 `:253-263`：`borderRadius: --radius-lg`、`background: --bg-panel`、`borderLeft: 3px solid goalColor`、`data-flip-id={goal.id}`（**FLIP 锚点**）。
- 卡头 `:264-307`：emoji `:265-267` → 名称 + 🔥streak `:269-276` → 副行（休息中 / `N 个任务` / 单任务名）`:277-283` → 右侧：exempt 徽标 `:286-297` 或 单任务的 `StatusButtons + ExpandChevron` `:300-305`。
- 单任务展开区 `:309-313` → `TaskEditor`。
- 多任务：逐任务 `TaskRow` `:315-317`（**内部组件，未导出**，`:209-232`；行结构 = 任务名 `:214-216` + `N分` `:217-221` + `StatusButtons compact` `:222` + `ExpandChevron` `:223`，展开区 `:225-229`）。
- 旧记录（未分任务）提示条 `:319-338`。

### 导出与复用方式（这是最重要的接缝）
`GoalCheckCard.tsx` 导出 3 个可复用件：
- `StatusButtons` `:38-89`——props `{goalId, date, te, compact?, statuses?}`；`pick` `:51-58` 即存，再点同状态 = `removeCheckIn`（toggle-off）；`springPress` `:21-32` 自守卫 reduced-motion。
- `TaskEditor` `:92-192`——分钟 chips `:128-147`、自定义分钟 input `:148-172`、一句话备注 input `:173-189`。
- `ExpandChevron` `:194-206`。

`AdhocSection.tsx:10` 就是复用样板：`:15` 把 `AdhocEntry` 手工整成 `DayTaskEntry` 同形对象，再喂给这三个（`:33`、`:38`）。**番茄钟入口要复用同一条路：拿到 `te: DayTaskEntry` 即拿到 `(goalId, taskId, date)` 三元键。**

### 分钟写入语义（关键约定，与番茄钟直接冲突）
`TaskEditor.saveMinutes` `GoalCheckCard.tsx:102-113` 是**替换/toggle 语义**：`record.minutes === minutes` 则清空，否则整值覆盖；无记录时 `setCheckIn(status:'done', minutes)`。
`CheckinPopover.tsx:97-108` 同语义。
`actions.setCheckIn` `store/actions.ts:340-370` 的 upsert 也是 `minutes: args.minutes ?? existing.minutes`（**不累加**）。
→ 「番茄钟结束累加 25 分钟」在现有 action 层**没有任何累加入口**，这是必须新开的接缝（要么新 action，要么 `patchCheckIn(id, {minutes: (record.minutes ?? 0) + n})` 由调用方算）。

### 分钟档常量已重复两处
`GoalCheckCard.tsx:12` `MINUTE_CHIPS = [10, 15, 30, 60]`、`CheckinPopover.tsx:14` 同值。（SPEC `docs/SPEC.md:255` 与 PROGRESS `:137` 写的是 15/30/60/90 —— 已被最近提交改掉，代码为准。）番茄钟若再抄一份就是第三份，违反 CLAUDE.md「禁止散落魔数」。

### FLIP 动效约束 `src/checkin/useFlip.ts`
`useFlip(listRef, dep)` `:8-32`，dep 在 `CheckInPage.tsx:107` = `entries.map(e => goalId:allRecorded).join('|') + selectedDate`。实现扫 `[data-flip-id]` `:15`，用 Web Animations `node.animate` `:25-28`（260ms），reduced-motion 自守卫 `:13/:21`（因为 `index.css:64-71` 的全局降级只管 CSS animation/transition，管不到 WAAPI）。
→ 任何放进 `listRef` 子树、带 `data-flip-id` 的元素都会被 FLIP 平移；卡内的运行中计时器会随卡片一起被 translate 动画（视觉上会跟着漂）。

### 「启动/记录」入口最合适的层
按数据键的可得性排序（不给方案，只列各层拿到什么）：
- `TaskRow` 行内（`GoalCheckCard.tsx:213-224`）与单任务卡头簇（`:300-305`）：拿到完整 `te`（taskId + record）+ `goalId` + `date`，与 `StatusButtons` 并列，是 `(goal, task, date)` 三元键唯一齐备的层。
- `TaskEditor` 展开区（`:126` 那一排）：同键，但默认折叠、需两次点击。
- `AdhocSection.AdhocRow`（`AdhocSection.tsx:18-35`）：随缘任务同键，注意它只给 `done/partial` 两键（`:33`）。
- 卡头目标级（`:264`）：只有 `goalId`，多任务目标下**拿不到 taskId**，与「按任务统计真实投入」的需求相悖。
- 页面顶部（`CheckInPage.tsx:137-165` 标题行 `ml-auto` 区，`批量补卡` 旁）：无任务上下文，只适合「无归属地起一个番茄，事后再挂任务」。

### `DayStrip.tsx`
`:25-85` memo 组件；`R=9`/`CIRC` `:22-23`；按钮 `min-h-11 min-w-11` `:38`；小环 svg 24×24 `:54-79`（底环 `--border-default`、进度环 `pct>=1 ? --success : --accent`、`strokeDasharray` + `rotate(-90)`）。**这是仓内两处「进度环」实现之一。**

### `BackfillDialog.tsx`（对话框样板）
`:68-89`：`fixed inset-0 z-50` + `rgba(0,0,0,0.35)` 遮罩 + 点外部关 + `w-96 max-w-[calc(100vw-32px)]` + `role="dialog"`；dryRun 预览与写入同一函数（`:50` vs `:63`）。

---

## 3. 甘特图 `src/gantt/*`

### `uiStore.ts` 瞬态状态模式（新增浮层必须照此办）
`:41-77` 状态字段 + setter 成对声明；`:81-124` 实现，`set` 前先比对去重（`:95-103`、`:114-119`）；`:79/:105-109` flash 定时器模式；`:127-129` DEV 暴露 `window.__ganttUi`。
既有浮层锚点类型：`ContextMenuState` `:15-23`（`kind: 'bar'|'canvas'|'goal'|'milestone'` + taskId/goalId/milestoneId/date）、`CheckinPopoverState` `:26-32`（`goalId, taskId?, date, x, y`）、`IconPickerState` `:35-39`。
**铁律**（PROGRESS `docs/PROGRESS.md:119`）：hover/选择/编辑/拖拽/菜单/抽屉全在这里，不持久化、不进 undo。

### `CheckinPopover.tsx`（打卡点就地 popover）
- 记录解析 `:33-41`：`goalId + date + taskId 严格相等`（`(c.taskId ?? undefined) !== (anchor.taskId ?? undefined)` `:38`），同键多条取最强（`STATUS_RANK` `:15`）。
- **portal 定位 clamp 的权威写法** `:46-58`：`useLayoutEffect` 里读自身 `offsetWidth/offsetHeight` → `left = x - w/2`、`top = y + 12` → 右/左边缘 clamp 8px → 下方放不下则翻到 `y - h - 12`；定位完成前 `visibility: hidden`（`:127`）。
- 点外部/Esc 关闭 `:66-84`，两者都 **capture=true**（`:78-79`），Esc 还 `stopPropagation` `:74` 以免触发甘特清多选。
- 内容 `:136-246`：目标色点+日期+`目标 · 任务` `:136-149`、三状态键 `:151-173`、分钟 chips + 自定义 `:175-217`、备注 `:219-235`、删除记录 `:237-246`。宽度 `w-64` `:123`。
- 命中区来源：`CheckinDots.tsx:83-96`（`data-checkin-dot` 透明圆，`hitR` `:47` 不超半列，`≤ today` 才可点），点击回调 `GanttView.tsx:547-558`；`GanttView.tsx:187` 的 body pointerdown 分流对 `[data-checkin-dot]` 放行。

### `BarTooltip.tsx`
`:32-80` memo + portal（`:49`）；`rows` 数组 `:38-47`（日期·天数 / 进度（状态）/ 应打卡·已打卡·缺卡 / 连续 / 偏移），渲染 `:71-76`；clamp `:35-36` 用 `TOOLTIP_W`、`TOOLTIP_OFFSET`（`constants.ts:69-70`），`pointer-events-none` `:51`；hover 400ms 由 `TOOLTIP_DELAY_MS` `constants.ts:68` + `hooks/useBarTooltip.ts` 控制。
数据来自 `tg: TaskGantt`（`lib/derive/gantt.ts`）与 `streak`。

### `TaskDrawer.tsx` 字段清单（380px，`:69-79`）
名称 `:106-121` / 所属目标 select `:123-141` / 开始·结束 date `:143-174` / 状态 4 键 `:176-199` / 进度（模式 select + range）`:201-238` / 打卡规则 4 键 + custom 星期 `:240-322`（adhoc 分支 `:266-275` 与说明 `:287-291`）/ 前置依赖列表 `:324-361` / 基线 `:363-390` / 备注 textarea `:392-405` / 底部删除危险区 `:409-422`。
共用样式 `field` `:17-26`、`Label` `:28-32`；滑入 200ms 靠 `entered` + rAF `:41/:48/:77-78`；`onKeyDown={e => e.stopPropagation()}` `:118/:403`（防甘特快捷键）。

### `ContextMenu.tsx` 四类右键分流
构建入口 `buildItems` `:88`；分支：`bar` `:92-166`（顶部先插 `trackItems` `:51-86`，然后 编辑详情/标记完成/暂停恢复/复制并顺延/从此日拆分/保存为基线/删除；右键落在多选集内自动批量语义 `:96-98`）、`goal` `:169-239`、`milestone` `:242-269`、`canvas` `:272-308`。
分流判定在 `GanttView.tsx:198-236`：里程碑 `:207-216` → bar `:217-225` → 空白 `:226-235`（附 `goalId` = `rowAtY` 命中行、`date` = 像素反算）。
菜单渲染 `:311-386`：`Item`/`'divider'` 两种 Entry `:36-43`、宽 208 + 估高 `items*30` 贴边翻转 `:338-342`、外部 pointerdown/Esc/blur 关闭 `:316-333`。
**新增菜单项 = 往对应分支的数组里插一个 `{label, onClick}`，零结构改动。**

### 番茄钟数据在甘特图上的可插位置与代价
| 位置 | 文件:行 | 代价 |
|---|---|---|
| **bar tooltip 加一行** | `BarTooltip.tsx:38-47` | 最便宜。纯 additive；但需要把"番茄数/专注分钟"喂进来——目前只有 `tg: TaskGantt` 与 `streak` 两个数据入口，要么扩 `lib/derive/gantt.ts` 的 `TaskGantt`（会进 per-goal 缓存，天然按目标失效），要么加新 prop（要改 `GanttView.tsx:762-764` 与 memo 依赖） |
| **打卡点阵改视觉** | `CheckinDots.tsx:49-97` 五态循环 | 中等。点几何被死锁：`DOT_D=7`、`DOT_ROW_H=10`（`constants.ts:34-35`），点心必须对齐日列中心（`:52`）。可用维度只剩「点内小环/点半径/描边」，而今日环 `:77-81` 已占了外描边一圈 |
| **热度条改语义** | `HeatStrip.tsx:23-49` | 贵。`HEAT_H=3`（`constants.ts:36`），且该组件被三处原样复用：`BarsLayer.tsx:186`、`GoalSummary.tsx:66`、`TrackSummary.tsx:70`（PROGRESS `:261` 明确写「HeatStrip 原样复用，一行未改」）。改它 = 同时改任务行/目标折叠行/轨道折叠行三种语义 |
| **任务行新增一层（独立番茄条）** | `constants.ts:21` `ROW_H_TASK=48` | 最贵。48 = `BAR_TOP 6 + BAR_H 22 + BAR_DOT_GAP 4 + DOT_ROW_H 10 + 6`（`constants.ts:31-35`）**已无空余像素**；改行高会动 `rowLayout.ts`（行对齐唯一来源）及其单测、`rowAtY/visibleRowRange`、以及所有 `r.top + ...` 计算（`BarsLayer.tsx:161/175/187/196`）。且 `top + BAR_TOP + BAR_H` 这个槽位已被基线条（`BarsLayer.tsx:170-184`，`BASELINE_H=4` `constants.ts:59`）与热度条（`:187`）争用 |
| **bar 本体着色/角标** | `TaskBar.tsx` | 贵且拥挤：进度实色/25% 剩余段/done 降饱和+✓/paused 斜纹/active 落后角标/深色内描边，六种状态已挤满（SPEC `docs/SPEC.md:216`） |
| **点 popover 加一块** | `CheckinPopover.tsx:136-246` | 便宜且键最全：`(goalId, taskId, date)` 现成（`:87-90`），可直接展示当日该任务的番茄/分钟，或放「启动」入口 |
| **抽屉加一节** | `TaskDrawer.tsx:105-405` | 便宜（additive section），但粒度是"任务全周期"，不是"某天" |
| **右键菜单加项** | `ContextMenu.tsx:92-166`（bar）/ `:272-308`（canvas） | 便宜；但见第 8 节 (c)：右键类功能在浏览器面板里**无法验证** |

### sticky 铁律（会限制任何进入 scroller 的动画）
`constants.ts:4-8` + PROGRESS `docs/PROGRESS.md:45`：scroller 内、sticky 元素的**任何祖先**永不加 `transform / will-change / filter / contain:paint`；transform 只允许出现在 timeline body 的叶子元素上。→ 运行中的进度环/脉冲若放进甘特 scroller，只能落在叶子节点，或 portal 到 body。

---

## 4. 复盘与统计 `src/pages/ReviewPage.tsx` + `src/review/*`

### 卡片结构
`ReviewPage.tsx:19-35` 本地 `Card({title, children})`（border-subtle / radius-lg / bg-panel / p-4 / h2 font-14）。`AnnualOverview.tsx:28-44` **又定义了一份同名同实现的 `Card`**（两处重复，非导出）。
月度视图卡序 `:179-270`：各目标完成率（标题内嵌 `投入 X · 缺卡 N 天`）→ 本月甘特缩略 → 年度热力图 → Streak 榜 → 复盘笔记。
年度视图 `:170-176` → `AnnualOverview`，其卡序 `:169-392`：投入时长（小时/月，堆叠面积）→ **投入总时长（小时/年，按目标）** → 任务完成数 → 里程碑时间线 → 基线偏移排行。

### recharts 懒加载分包边界（硬约束）
唯一切点是 `App.tsx:19` `lazy(() => import('./pages/ReviewPage'))`。`vite.config.ts:11-44` **没有 manualChunks**，分包纯靠这一处动态 import。`AnnualOverview.tsx:6-14` 是全仓唯一 recharts import 点。
→ 任何引入 recharts 的番茄钟图表**必须只被 ReviewPage 的模块图可达**；若被打卡页/甘特页/App 直接或间接 import，recharts 会回落主包（PROGRESS `docs/PROGRESS.md:155` 记录主包 532KB / review 分包 366KB 的既有分界）。

### 现有「投入总时长」卡：算法与视觉
算法 `AnnualOverview.tsx:116-130`：遍历 `checkIns`，跳过 `deletedAt || !minutes || !date.startsWith(`${year}-`)` `:120`；按 `goalId` 累加分钟 `:121`；`hours = Math.round(min/60*10)/10` `:124`；`hours > 0` 过滤 `:125`、降序 `:126`；`grand` 由 hours 再加总 `:127`；`max = Math.max(1, ...)` `:128`。注释 `:115` 明确「直接从 checkIns 累加，避免累加已四舍五入的月值」。
视觉 `:222-267`：空态文案 `:224-226`；头部 font-20 tabular 数字 + `小时 · 全年合计` `:229-236`；横条行 `:238-262`（`w-28` 名称 / `h-3 rounded-999` 轨道 `bg-subtle` / `goalColor` 填充按 `hours/max` / `w-16` 右对齐小时）。
月度侧同口径来源 `lib/derive/review.ts:50-54`（`monthlyGoalStats.minutes`）与 `:97-111`（`minutesByGoalByMonth`）。

### 番茄钟统计的连带关系（无需推测，是数据流事实）
`monthlyGoalStats.minutes` `derive/review.ts:51-54` 与 `minutesByGoalByMonth` `:104-108` 都**只按 goalId 聚合、不看 taskId、不看 status**（`skipped` 带 minutes 也会计入）。
→ 若番茄结果写进 `CheckIn.minutes`，则 `ReviewPage.tsx:179`（标题「投入 X」）、`:214`（每目标时长列）、`AnnualOverview.tsx:98-109`（面积图）、`:116-130`（投入总时长卡）**四处自动生效，零改动**。
→ 若番茄结果落新表/新字段，这四处都要新增聚合路径，且 `AnnualOverview` 的 recharts 边界不能被打破。
→ 现有全部时长口径都是**目标级 roll-up**（PROGRESS `docs/PROGRESS.md:209`、`:221` 反复确认）；「按任务看真实投入」在复盘页**目前无任何呈现位**（唯一按任务的卡是「任务完成数」`:269-300`，统计的是 done 计数不是时长）。

### 其他两个 review 组件
`YearHeatmap.tsx`：`CELL=11 / GAP=2 / LEVEL_ALPHA=[30,55,78,100]` `:11-13`；数据 `dailyActivityScores` `:26-29`；按年最大值归一 `:30`。
`MiniMonthGantt.tsx`：`CELL=16 / GAP=2 / NAME_W=112 / BAR_H=5 / ROW_H=30` `:11-15`。
`NotesEditor.tsx`：防抖 800ms 自动保存 `:30-38`，星评即存 `:40-45`。

---

## 5. 设置页 `src/pages/SettingsPage.tsx`

### 分区结构
`Section({title, children})` `:20-36`（同 Card 样式）；`buttonStyle` `:38-45`。
四个区 `:103-194`：**外观**（主题 select `:107-116` + 每周从 select `:120-128`）→ **数据**（各表计数 `:135-145`、载入示例/导出/导入/清空 `:146-174`、message 行 `:175-185`）→ **免打卡区间** `:188-190` → **云同步** `:192-194`。
容器 `:98` `mx-auto max-w-2xl flex-col gap-4 p-6`。**新增「番茄钟」区 = 插一个 `<Section title="番茄钟">`，零结构改动**；位置语义上属「外观」之后（设备本地偏好）或「免打卡区间」之前。

### `ExemptionManager` 行内编辑即存模式（`src/checkin/ExemptionManager.tsx`）
- 日期 `onChange` 直接 `updateExemption` `:90`、`:100`；文本 `onBlur` 比对后才写 `:109-112`；Enter → blur `:113-115`。
- chip 多选：空/缺省 = 全部，点选在「全部」与具体集合间切换 `:67-76`（`next.length === goalList.length ? undefined : next`）。
- 折叠状态**只存组件 useState、不入库、不进 undo** `:62-65`（PROGRESS `docs/PROGRESS.md:187` 明确记录这一取舍）。
- 添加走独立 `AddRow` 子表单 `:227-290`（本地 state → 一次 `createExemption`）。
- `inputStyle` `:12-19` 是该文件私有常量（与 `TaskDrawer.field`、`BackfillDialog.inputStyle`、`SyncSection.inputStyle` 各自一份，**仓内 4 份近似 input 样式，无共享件**）。

### `SyncSection`（`src/components/SyncSection.tsx`）
`isSyncConfigured` 早退 `:47-54`；未登录表单 `:81-126`；已登录信息 + 立即同步/退出 `:128-168`。`STATUS_LABEL` `:8-14`。

### 番茄钟设置存哪 —— `AppSettings 不同步` 的确切含义
- `AppSettings` 定义 `types/domain.ts:123-131`；默认值 `store/defaults.ts:5-23`；写入唯一入口 `useStore.updateSettings` `store/useStore.ts:143-147` → `queuePersistSettings` `store/persist.ts:87-93`（**防抖 500ms**，`persist.ts:25`）。
- 不同步的三重证据：`store/types.ts:22-29` `TABLE_NAMES` 不含 settings；`db/sync/engine.ts:24-31` `REMOTE_TABLE` 不含 settings；`db/schema.ts:36` settings 是单行表（主键 `'app'`，`db/schema.ts:12-16`）。PROGRESS `docs/PROGRESS.md:244` 明文「settings 不同步（设备本地偏好，SPEC 六表之外）」。
- **含义 1**：时长/长休息/声音/通知放 AppSettings → 电脑与手机各存一份，改了不互通（PROGRESS `docs/PROGRESS.md:269` 记录过轨道归属就是因为这一点被否掉存 settings 的方案）。
- **含义 2（隐藏坑）**：`lib/backup.ts:112-117` 的 `settingsSchema` 是显式字段列表，zod 默认 strip 未声明键——现有 `colorNormalized`（`types/domain.ts:130`）就**不在** schema 里，即已经会在 JSON 导入时被静默丢弃。新增番茄设置字段若不同步补进 `backup.ts:112-117`，备份往返即丢失。老备份兼容的既有写法是 `.default(...)`（`backup.ts:97`、`:101`、`:102`）。
- **含义 3**：若番茄会话记录要算作用户数据（跨设备统计），它就不能进 settings，需要第 7 张实体表，改动面（逐条核对过）：`types/domain.ts` 新接口 → `store/types.ts:11-18` `EntityOf` + `:22-29` `TABLE_NAMES` → `db/schema.ts:29-37` **需 `version(2)` 升级（当前只有 version(1)）** → `db/repos/index.ts` 新 repo → `store/persist.ts:16-23` `repoByTable` → `db/sync/engine.ts:24-31` `REMOTE_TABLE` → `supabase/migrations/` 新 SQL + `upsert_rows` RPC 的硬编码表名白名单 → `lib/backup.ts:119-132` + `:123-130` → `store/useStore.ts:32-34/84-104/154-179/181-188/190-204`（emptyMaps/hydrate/replaceAllData/exportBundle/applyRemote）→ `SettingsPage.tsx:11-18` `TABLE_LABEL`。
  （PROGRESS `docs/PROGRESS.md:256`、`:270` 提供了另一条既有先例：**给现有实体加业务字段对 Supabase 是透明的**，因为每表 `data jsonb` 存整实体，只有 `updated_at/deleted_at` 是冗余列——加字段零 SQL、零 Dexie 升版。）

---

## 6. 设计令牌 `src/styles/tokens.css` 全量清单 + `src/index.css` 工具类

### tokens.css（浅色 `:7-105`，深色覆盖 `:107-149`）
- **中性色** `:9-12` `--bg-base / --bg-panel / --bg-subtle / --bg-raised`
- **边框** `:14-16` `--border-subtle / --border-default / --border-strong`
- **文字** `:18-21` `--text-primary / --text-secondary / --text-tertiary / --text-disabled`
- **特殊底纹** `:24-28` `--weekend-tint / --exemption-stripe / --row-hover / --bar-inner-stroke / --missed-dot`
- **目标色 10 档** `:31-40` `--goal-1..--goal-10`，+ 40% 档 `:41-50`、15% 档 `:51-60`（其余透明度走 `goalColorAlpha` 的 color-mix，`lib/colors.ts:42-48`）
- **语义色** `:63-70` `--accent`、`--accent-soft`(12%)、`--success`、`--warning`、`--danger`、`--danger-soft`(15%)、`--info`、`--text-on-accent`
- **圆角** `:73-75` `--radius-sm:4 / --radius-md:6 / --radius-lg:10`
- **阴影** `:78-79` `--shadow-sm / --shadow-lg`
- **间距** `:82-88` `--space-1:4 / -2:8 / -3:12 / -4:16 / -5:20 / -6:24 / -8:32`
- **字号** `:91-96` `--font-11 / -12 / -13 / -14 / -16 / **--font-20（上限）**`
- **动效** `:99-102` `--ease: cubic-bezier(0.25,1,0.5,1)`、`--dur-drop:120ms`、`--dur-zoom:150ms`、`--dur-drawer:200ms`
- 深色差异要点：`--bar-inner-stroke` 由 transparent 变 `rgba(255,255,255,0.1)` `:125`；10 个目标色整体提亮 `:128-137`；语义色提亮 `:139-143`；阴影加重 `:145-146`。

### index.css 工具类
- `@theme` 桥接 `:4-17` → Tailwind 可用 `bg-base/bg-panel/bg-subtle/bg-raised`、`text-primary/secondary/tertiary`、`text-accent/success/warning/danger`（实际用得最多的是 `hover:bg-subtle`、`text-tertiary`）。
- body 字体栈 `:29-31`（中文优先 PingFang SC / Microsoft YaHei）、`font-size: --font-14`、`line-height 1.5`。
- **`.tnum`** `:39-41`（`font-variant-numeric: tabular-nums`）——CLAUDE.md 要求数字一律用它。
- `button { font: inherit; color: inherit }` `:43-46`。
- `bar-flash` keyframes + class `:49-62`（outline 脉冲，`FLASH_MS=1100` `gantt/constants.ts:89`）。
- `@media (prefers-reduced-motion: reduce)` 全局把 animation/transition duration 压到 0.01ms `:64-71`——**不覆盖 Web Animations API**，故 `useFlip.ts:13`、`GoalCheckCard.tsx:22`、`Celebration.tsx:34`、`gantt/lib/tween.ts:28/45` 各自再守卫一次。

### 番茄钟视觉元素 vs 现有令牌
| 需求 | 能否只用现有令牌 | 缺口 / 既有替代 |
|---|---|---|
| **大数字倒计时** | ❌ | 字号阶封顶 `--font-20`（`tokens.css:96`）。全仓最大字号就是 20px（`ReviewPage.tsx:119`、`AnnualOverview.tsx:230`、`SettingsPage.tsx:99` 都是它）。一个 hero 级 `25:00` 需要 32~48px → **必须新增字号令牌**（唯一确定的令牌缺口） |
| **进度环** | ⚠️ 颜色/线宽可用令牌，几何无令牌、无共享组件 | 两处手写先例：`gantt/LeftGrid.tsx:40-59`（`MonthRing`，r=5.5、strokeWidth 2.5、15×15、`rotate(-90)`）与 `checkin/DayStrip.tsx:22-23/54-79`（R=9、24×24）。**再写一份就是第三份**；CLAUDE.md 禁散落魔数 → 几何量需落在某个 constants 模块（`gantt/constants.ts` 是甘特域私有，其头注释 `:1-8` 就是甘特滚动铁律，不宜塞番茄常量） |
| **迷你条** | ✅ | 三种现成写法：`gantt/grid/ProgressCell.tsx:9-41`（`ProgressMeter`，height 4 硬编码、可复用组件）、`CheckInPage.tsx:169-178`（3px 年度进度条）、`HeatStrip` 的 `HEAT_H=3` |
| 运行中/休息中/完成 语义色 | ✅ | `--accent` / `--warning` / `--success`（`tokens.css:63-69`），无需新增 |
| 浮层容器（迷你计时器外壳） | ✅ | `--bg-raised` + `--border-default` + `--radius-lg` + `--shadow-lg` 是全部浮层的既定组合（Toasts `:16-21`、CheckinPopover `:128-131`、ContextMenu `:351-355`、BulkBar `:43-46`） |
| 动效时长 | ⚠️ | 有 `--dur-drop/zoom/drawer`（120/150/200ms），**没有「秒级/循环」类时长令牌**；spring 反馈可复用 `GoalCheckCard.springPress:21-32`（280ms，内联 keyframes） |
| 深色适配 | ✅ | 全部引用的令牌在 `tokens.css:107-149` 都有深色覆盖；注意 `--bar-inner-stroke` 只在深色非透明 `:125` |

---

## 7. 可复用工具与共用组件

| 工具 | 位置 | 关键 API / 约定 |
|---|---|---|
| toast 总线 | `lib/toast.ts` | `showToast(text)` `:21-29`（MAX_VISIBLE=3 `:14`、TOAST_MS=2600 `:15`）、`subscribeToasts` `:31-37`；消费者 `components/Toasts.tsx:5-30`，**占 `fixed bottom-4 left-4 z-50`** |
| 彩带总线 | `lib/celebrate.ts` | `celebrate(x, y)` `:17-20` / `subscribeCelebrate` `:22-27`；`components/Celebration.tsx:30-…`，reduced-motion 直接不渲染 `:34-35`，LIFE_MS 950 `:10`，z-[60] `:46`。先例用法：目标标记完成 `ContextMenu.tsx:213` |
| 主题 | `lib/theme.ts` | `resolveTheme:5-8` / `applyTheme:10-17`（写 localStorage `'yearflow-theme'` `:3` + `html[data-theme]`）/ `subscribeSystemTheme:20-26` |
| 移动端断点 | `lib/useIsMobile.ts:12-14` | matchMedia 767px + `useSyncExternalStore`（`GanttView.tsx:81` 唯一现用点） |
| 日期 | `lib/date.ts` | `toDay/fmtDay:13-14`、`todayStr:17`、`eachDay:20-27`、`weekStartOf:30-34`、`diffDays:37-39`；dayjs 在此 extend（isoWeek/customParseFormat `:5-6`）并 re-export `:8`。**全无时刻/时长格式化助手**——`HH:mm:ss` 的既有做法是直接 `import dayjs from 'dayjs'`（`SyncIndicator.tsx:3/:85`、`SyncSection.tsx:2/:144`），或 `toLocaleTimeString`（`NotesEditor.tsx:36`） |
| 颜色 | `lib/colors.ts` | `GOAL_PALETTE:2-13`、`pickGoalColor:19-34`、`goalColor:37-39`（色板键 → `var(--goal-N)`）、`goalColorAlpha:42-48`（40/15 走令牌，其余 color-mix） |
| 下载 | `lib/download.ts` | `downloadBlob:6-13`、`downloadBackupJSON:15-19` |
| 拖拽提示单例 | `gantt/lib/dragHint.ts` | 直写 DOM 的 fixed 单例 `:7-29`（zIndex 60 `:15`，**内联 style 里也用 `var(--...)` 令牌**），`showDragHint:31-37`/`hideDragHint:39-41`/`fmtRangeHint:49-51`/`fmtDayHint:54-56`。**零 React 重渲的浮动读数样板** |
| 拖拽内核 | `gantt/lib/dragCore.ts` | `startPointerDrag:30-95`；3px 阈值 `:36`、`setPointerCapture` 必 try/catch `:45-49`（PROGRESS `docs/PROGRESS.md:73`）、Esc capture `:84-94`、`onEnd(committed)` 语义 `:23-27` |
| 文本测宽 | `gantt/lib/textWidth.ts:23-36` | 离屏 canvas 按字符串缓存 |
| 补间 | `gantt/lib/tween.ts` | `ease:8-25`、`prefersReducedMotion:27-29`、`tween:43-63`。**`:44-45` document.hidden 时立即落终值 —— 这是 UI 动画助手，绝不能当计时器用** |
| 行内编辑输入 | `gantt/grid/InlineInput.tsx:13-59` | 挂载即 focus+select `:17-20`、Enter/blur 提交（`doneRef` 防重复 `:15/:22-31`）、Esc 取消、`e.stopPropagation()` `:54` 防触发全局快捷键、`onPointerDown` 也阻断 `:57` |
| 进度条 | `gantt/grid/ProgressCell.tsx:9-41` | `ProgressMeter({value, color})` + `PROGRESS_PCT_W=7` |
| portal + clamp | 5 种写法 | ① 测量式（最严谨）`CheckinPopover.tsx:46-58` + `createPortal(…, document.body)` `:120/:248`，未定位前 `visibility:hidden` `:127`；② 常量 clamp `BarTooltip.tsx:35-36` + portal `:49`；③ 估高贴边翻转 `ContextMenu.tsx:338-342`（**不 portal**，直接 fixed div 挂在 GanttView 树内 `GanttView.tsx:765`）；④ 同③ `GoalIconPicker.tsx:120-122`；⑤ 顶栏下拉用 `relative` 父 + `absolute` 子，不 portal（`SyncIndicator.tsx:44/:62-71`、`FilterMenu.tsx:54`） |
| 外部关闭 | 三种 | `window.addEventListener('pointerdown', …, true)` capture（`CheckinPopover.tsx:78`、`ContextMenu.tsx:325`、`FilterMenu.tsx:27`、`GoalIconPicker.tsx:96`）／`document.addEventListener('pointerdown', …)` 非 capture（`SyncIndicator.tsx:28`）／遮罩 `onPointerDown` 判 `e.target === e.currentTarget`（`ShortcutHelp.tsx:44-46`、`CommandPalette.tsx:168-170`） |
| DEV 观测句柄 | `store/useStore.ts:207-210` `window.__store`；`gantt/uiStore.ts:127-129` `window.__ganttUi`；PROGRESS `:249` `window.__syncStore`；PROGRESS `:55` `window.__ganttDeriveComputes` | **验证脚本全靠这些**，新 store 不暴露就没法自动验 |

---

## 8. 本机开发/验证盲区 —— 对计时器类功能的具体含义

（逐条从 `docs/PROGRESS.md` 挖出，并在代码里核实）

### (a) 浏览器面板 `document.hidden === true`，rAF / scroll 事件全挂起
出处：PROGRESS `:51`、`:48`、`:126`；代码证据 `gantt/lib/tween.ts:44-45`（hidden 时直接落终值）、PROGRESS `:126`（html-to-image 的 resolve 包在 rAF 里 → 面板下导出**永挂**）。
对计时器的含义：
1. **绝不能用 rAF 驱动倒计时** —— 面板里一帧都不会来；真实后台 tab 里 rAF 也停摆。
2. `setInterval` 在隐藏/后台 tab 被 Chrome 夹到 ≥1000ms，且后台数分钟后进一步降频 → **剩余时间必须由绝对结束时刻（`Date.now()` / `endsAt`）反算，不能靠每 tick 自减**，否则最小化一小时回来会少走一小时。
3. 面板里**无法验证「它真的在走」**：只能改状态 + 读状态（见 (f)），或用 Playwright 真实 Chrome 跑挂钟对照。
4. 环形进度若用 CSS animation / WAAPI，面板下不动，**视觉正确性在面板里不可验**。

### (b) 截图接口本机超时
出处：PROGRESS `:31`、`:188`、`:194`、`:212`（四次复发，稳定坑）。
含义：番茄钟的**全部视觉门槛**（进度环、大数字、迷你条、深浅主题、移动端）在面板里拿不到截图。面板下的替代手段（PROGRESS 已验证可用）：`get_page_text`、`read_page`（无障碍树）、`javascript_tool` 做 JS 度量、直接读 IndexedDB。真正的视觉门槛必须写成 Playwright 脚本，照 `scripts/capture-*.mjs` 的模板（`capture-tracks.mjs:13` `chromium.launch({ channel: 'chrome' })` —— **用系统 Chrome，不下载 playwright 浏览器**）。

### (c) 面板里 `dispatchEvent` 合成 `contextmenu` 不触发 React 委托处理器
出处：PROGRESS `:182`（`element.click()` 可以，`contextmenu` 不行）。
含义：若番茄钟在 `ContextMenu.tsx:92-166`（bar 右键）或 `:272-308`（空白右键）加入口，**该入口在面板里无法验证**，必须 Playwright 真实右键。同理，PROGRESS `:200` 记录过合成 PointerEvent 全链路是可行的（拖拽/柄），所以 pointer 类交互面板可验、contextmenu 不可验。

### (d) settings 落库防抖 500ms，写完立刻整页跳转会丢改动
出处：PROGRESS `:170`、`:275`；代码 `store/persist.ts:25`（`PERSIST_DEBOUNCE_MS = 500`）、`:87-93`（settings 走同一防抖）；脚本对策 `capture-tracks.mjs:51`（`waitForTimeout(800)`）与 `:55`（`waitForTimeout(700)` 注释「settings 落库防抖 500ms，早跳转会丢主题」）。
含义：
1. 番茄设置若进 `AppSettings`，任何「写设置 → reload/goto」的验证都要等 ~700ms。
2. 更要紧：**运行中的计时器状态若靠 `updateSettings` 持久化，硬刷新/崩溃会丢最后 ≤500ms 的写入**，且高频写会不断 reset 这个 debounce（永不落库）。
3. 实体写入同样是 500ms 防抖（`persist.ts:56-62`）+ 落库后 3s 触发云同步（`persist.ts:53` `emitLocalWrite`，PROGRESS `:231`）→ **每秒 tick 写 store 会同时污染 undo 栈（100 步上限 `store/useStore.ts:30`）、刷爆落库防抖、并 3 秒一次触发云推送**。既有「一次操作一条命令」先例：`batchCheckIn`（`store/actions.ts:429-431`）、`saveReview` 无变化早退（`:455`）。

### (e) PowerShell 跑 node 会静默挂起（零输出超时）
出处：PROGRESS `:250`（「Playwright/node 脚本一律用 Bash 工具跑」）。
含义：所有番茄钟的 Playwright 验证脚本、`vitest`、`tsc -b` 都用 Bash 工具执行。dev server 走 `.claude/launch.json`（`autoPort: true`，`vite.config.ts:40` 读 `PORT` 环境变量）。

### (f) 面板里同步读 DOM 会读到 React 提交前的旧渲染
出处：PROGRESS `:169`（「验证一律『一次调用做操作、下一次调用读结果』，或直接读 zustand 状态」）。
含义：番茄钟的计时状态必须能从 `window.__*` 读到（照 `store/useStore.ts:207-210` / `gantt/uiStore.ts:127-129` 的 DEV-only 暴露），否则面板里**既不能截图、又读不到 DOM 新值 → 完全无法自动验证**。

### (g) sticky 铁律限制动画落点
出处 `gantt/constants.ts:4-8` + PROGRESS `:45`。含义：番茄相关的任何 transform/will-change 动画不能落在甘特 scroller 内 sticky 元素的祖先上；安全落点 = 叶子元素，或 portal 到 body（`dragHint` 与全部 popover 都是这么绕的）。

### (h) per-goal 派生缓存的引用约定
出处 PROGRESS `:69`、`:120`、`:243`（「写入只构造受影响实体新对象，未动实体保持引用」；`useGanttDerive` 靠顶层引用比较跳过重算；PROGRESS `:127` 记录过 filter map 没 memo 导致全量重算的真实事故）。
含义：计时器的 1Hz 状态更新**必须留在一个独立的瞬态 store**（uiStore 模式），一旦经过 `useStore`/`execute`，`checkIns` map 换引用 → 甘特每秒全量重算+重渲，直接违反「拖拽 60fps / 缩放 <150ms」门槛（`docs/SPEC.md:295`）。

### (i) 只能人工验证的部分（无自动路径、且仓内零先例）
grep 全仓确认：`Notification` / `new Audio` / `AudioContext` / `Worker` / `wakeLock` **零使用**；只有 `db/sync/engine.ts:217` 用 `visibilitychange`、`:232` 用 `setInterval`、`gantt/lib/tween.ts:44` 读 `document.hidden`。因此：
- **声音**：脚本听不到，只能人工。零封装可复用。
- **系统通知**：`Notification.requestPermission()` 需用户手势 + 浏览器级权限弹窗；Playwright 能用 context permissions 绕过，但**真机授权流程与手机端表现无法自动复现** → 人工。
- **PWA standalone / 手机锁屏后的计时准确性**：PWA 侧只有 `scripts/check-pwa.mjs`（manifest + SW 冒烟，`:11-25`），无后台行为验证能力 → 人工真机。
- **后台 tab 长时间 throttle 的真实表现**（>5 分钟）：只能真机长跑对照挂钟。
- **移动端布局避让**：`<768px` 底部是 `MobileTabBar`（`App.tsx:29-56`）+ `env(safe-area-inset-bottom)`，`useIsMobile` 判定 767px（`lib/useIsMobile.ts:3`）；PROGRESS `:172` 记录移动端强制月档「只在进入时一次」的教训 —— 移动端视觉需 Playwright 改 viewport 验（`capture-phase4.mjs` 已有移动端断言先例，PROGRESS `:162`）。

### (j) 截图脚本的两个既有坑（写番茄门槛脚本时会撞）
PROGRESS `:275-276` + `capture-tracks.mjs`：① 写完 store 立刻 `page.goto` 会丢改动，须 `waitForTimeout(700~800)`（`:51`、`:55`）；② 缩放档位是 `role="radio"` 不是 button（`:67`，对应 `GanttToolbar.tsx:105-107`）。另外脚本约定：`page.on('dialog', d => d.accept())`（`:20`，因为删除/保存基线都用原生 `confirm`）+ `page.on('pageerror')` 直接 throw（`:21-23`）。

---

## 附：跨节的既有约定速查（写码时会被卡的硬规则）

1. **写入唯一入口**：UI → `src/store/actions.ts` → `execute(label, Change[])`（`store/useStore.ts:106-114`）。UI 不碰 Dexie/Supabase（CLAUDE.md）。
2. **软删除**：删除一律 `deletedAt`（`store/types.ts:35-39` 的 `delete` change 实为软删，`persist.ts:51` `softDelete`）。
3. **label 是 undo toast 文案**（`store/types.ts:43`，动词开头，简体中文）。
4. **打卡记录键**：`目标 + 任务 + 日期`，严格 taskId 匹配（`actions.ts:319-328`、`CheckinPopover.tsx:38`、`dayPanel.ts` 的 `taskEntries`）；同键多条取最强 done>partial>skipped；再点同状态 = 删记录。
5. **timer 类状态归属**：瞬态 → 新 store（照 `gantt/uiStore.ts`）；设备偏好 → `AppSettings`（不同步，需补 `backup.ts:112-117`）；用户数据 → 第 7 张表（成本见 §5）或**给 `CheckIn` 加字段**（对 Supabase 透明，PROGRESS `:270`）。
6. **数字必须 `.tnum`**（`index.css:39-41`）；尺寸/颜色/间距只允许令牌或常量文件（CLAUDE.md）；文案简体中文、动词开头。
7. **reduced-motion 要自己守卫 WAAPI**（`index.css:64-71` 只管 CSS）。