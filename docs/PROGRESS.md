# PROGRESS — YearFlow 实施进度

> 每个 Phase 完成后更新本文件：勾选验收项、记录关键实现决策。新会话接手先读 CLAUDE.md → 本文件 → SPEC.md 对应章节。

## 会话安排建议
- 在 `D:\Agent\yearflow` 目录打开 Claude Code，每个 Phase 一个会话
- Phase 2 工作量最大，可拆两个会话：①时间轴/表头/网格/今日线 ②bar/点阵/热度条/里程碑/mini-map/虚拟化
- 每 Phase 结束：vitest 全绿 → 浏览器截图自查 → git commit → 更新本文件
- Phase 5 前用户注册 Supabase，自行把 URL + anon key 填入 `.env.local`

## Phase 1 — 骨架与数据层 【已完成 2026-07-16】
- [x] Vite + React 18 + TS 脚手架，依赖装齐（zustand/dexie/dayjs/nanoid/react-router-dom/zod/tailwind v4/vitest）
- [x] tokens.css 设计令牌（深浅主题，`html[data-theme]` 切换，index.html 首帧脚本防闪屏）
- [x] 领域模型 types/domain.ts
- [x] Dexie schema + 6 个 repo（软删除 + updatedAt，checkIns 建 [goalId+date] 复合索引）
- [x] Zustand store + undo/redo（execute(command)，栈上限 100 步）
- [x] 派生纯函数 + vitest 单测（应打卡日/缺卡/streak/周热度/基线偏移/自动进度，29 测试全绿）
- [x] 种子数据（2026 五目标 + 最近 45 天打卡 + 2 个 baseline 偏移，确定性 PRNG）
- [x] JSON 导出/导入（zod 校验 + schemaVersion=1 + 迁移钩子，单测覆盖往返无损）
- [x] 路由四页壳 + 主题切换 + 移动端默认落打卡页
- [x] 验收：单测全绿 / 浏览器实测（今日应打卡项按 recurrence 精确命中、streak 正确、刷新数据与设置均不丢、深浅主题令牌生效、控制台无错误）

### 关键决策（后续 Phase 需知）
- React 钉 18（模板默认 19，按 SPEC 改回）；Tailwind v4 走 `@tailwindcss/vite` 插件，无 tailwind.config；tsconfig 开了 `erasableSyntaxOnly`（禁构造函数参数属性写法）
- Goal.color 存色板键（`goal-1`..`goal-5`），UI 经 `src/lib/colors.ts` 解析为 `var(--goal-N)`；透明度档用 `--goal-N-40/-15`
- undo/redo：Change 自带 before/after 完整实体，`invertChange` 反转即 undo；持久化不回读 store（persist.ts 直接消费 Change 载荷），防抖 500ms
- CheckIn 与任务的归属匹配口径（derive/scheduled.ts `checkedDatesFor`）：goalId 相同且（无 taskId 或 taskId 一致）
- streak 口径：done/partial 计数延续，skipped 与免打卡日不打断不计数，missed 打断，今天未打不打断（单测锁定）
- 完成率/自动进度计权统一：done=1、partial=0.5
- 打卡页/甘特页当前是占位壳，仅展示派生数据；交互分别在 Phase 4 / Phase 2-3 实现
- 浏览器面板 screenshot 接口在本机会超时，自查用 get_page_text/read_page/javascript_tool 替代；Phase 2 的 8 张截图自查建议用 Playwright

## Phase 2 — 甘特图静态渲染 【①已完成 2026-07-16 / ②已完成 2026-07-17】

### ① 时间轴四档缩放 / 双层表头 / 网格底纹 / 今日线 【已完成】
- [x] `src/gantt/` 地基：constants（全部几何常量）、timeScale（单一坐标系+刻度生成，纯函数）、rowLayout（行对齐唯一来源，纯函数），19 个新单测（合计 48 全绿）
- [x] 四档缩放（年 2.5/季 8/月 28/周 56 px/天），150ms rAF 插值真实 dayWidth + 锚点保持（今日线在视口内锚今日，否则锚视口中心），浏览器实测锚点数学精确命中
- [x] 双层 sticky 表头：年=「2026」+Q1-Q4+月 / 季=月+ISO 周号（跨年周 clamp）/ 月周=「2026年3月」+日+星期；今天单元格主色圆底；月份标签 position:sticky 钉扎在时间轴左缘
- [x] 背景网格：日/周线最淡、月线加深、季线最深；周末列合并 rect 底纹（年视图不渲染）；免打卡区间 45° 斜纹 pattern + 表头 reason 标注（种子新增 7/20-24 出差、10/1-7 国庆两条演示数据）
- [x] 今日线 2px + 表头「今」标签；工具栏（年份◀▶/缩放分段/今天）融入全局顶栏（仅 /gantt 渲染，bus 事件通道）
- [x] 开屏定位：持久化 scrollDate 瞬时恢复（实测刷新后 px 级精确复位）；首次使用平滑滚今日线至视口 1/3；「今天」按钮同路径
- [x] 验证：tsc/oxlint/vitest 全绿；浏览器 JS 度量实测（行左右对齐、sticky 双向零漂移、Shift+滚轮横移、深浅主题令牌切换、四档表头内容、斜纹位置与宽度全部精确命中）

#### ① 关键决策（②与 Phase 3 依赖，勿推翻）
- **单 scroller + CSS sticky**（否决双 pane 同步）：铁律——scroller 内 sticky 元素的祖先永不加 transform/will-change/filter（见 constants.ts 注释）；transform 只允许出现在 body 内叶子元素
- **全宽 SVG + 子元素裁剪**：GridBackground 宽=totalWidth（周视图 ≈20440px 无问题），只渲染可视范围元素；1px 线 Math.round+0.5；表头是 HTML div（非 SVG）
- **dayWidth 是连续浮点值**：缩放动画逐帧真实重排（否决 scaleX），Phase 3 Ctrl+滚轮连续缩放直接复用；布局全程浮点、paint 时取整
- **量化可视窗口**：chunk 是 px 语义（400/300px 档），跨档才 setState；**dayWidth 变化必须 useLayoutEffect 同帧重算 chunks**（px→日期映射随缩放变化）；程序化滚动主动调 compute（后台页不派发 scroll 事件）
- **tween 三跳变路径**：reduced-motion / document.hidden / from==to 都立即落终值；缩放锚点的清空必须放在 layout effect 应用完最终校正之后（onDone 同步早于 React 处理最后一帧 setState，提前清空会丢失最终校正）
- 表头上层月份标签用 position:sticky 钉扎，**cell 不能加 overflow-hidden**（会成为 sticky 的滚动参照导致钉扎失效）
- 本机浏览器面板 document.hidden=true、rAF/scroll 事件全挂起：动画类验证用 JS 度量替代；8 张截图门槛留到 ② 完成时用 Playwright

### ② bar / 打卡点阵 / 热度条 / 里程碑 / mini-map / 行虚拟化 【已完成】
- [x] 派生层：`statusByDateFor`（任务归属口径每日最强状态）、`derive/gantt.ts`（timeProgressPct / deriveTaskGantt / deriveGoalGantt）、`lib/stableSlices.ts` 稳定分组；20 个新单测（合计 68 全绿）
- [x] `useGanttDerive` per-goal 缓存：打卡写入只重算相关目标（浏览器实测 delta=1 而非 5，`window.__ganttDeriveComputes` dev 计数）
- [x] 任务 bar：进度实色 + 25% 剩余段、标签 canvas 测宽内/外自适应（实色段覆盖时用 --text-on-accent）、done 降饱和+✓、paused 斜纹、active 落后警示角标、深色 1px 内描边（--bar-inner-stroke）
- [x] 打卡点阵（dayWidth≥10）：五态（done 实心/partial 左半/skipped 空心/missed 淡红/未来 8% 占位）+ 今日 accent 描边环；圆心精确对齐日列中心（月档 mod28=14.00、周档 mod56=28.00 实测）；列虚拟化按可视日期区间
- [x] 热度条（dayWidth<10）：周聚合五档 alpha（15/36/57/78/100）、全缺淡红（--missed-dot）、未来周不渲染；rect 宽=7×dayWidth 实测精确
- [x] 目标行：6px 汇总条（40% 目标色，跨子任务范围）、14px 菱形里程碑（achieved 实心+勾）、折叠时聚合热度条
- [x] bar tooltip：hover 400ms，portal 到 body；任务名/日期·天数/进度/应打卡·已打卡·缺卡/streak/基线偏移
- [x] mini-map：底部 28px，每目标 2px 任务分布线段 + 今日红线；取景框 scroll 同步直写 DOM（rAF 节流，零 React 重渲）；框内拖动保持抓取偏移、框外点击中心跳转（拖动实测 delta -808.0 vs 期望 -807.9）
- [x] 行虚拟化：visibleRowRange 切片 RowsLayer/LeftGrid/BarsLayer（107 行数据 DOM 仅 14 根 bar）
- [x] 性能实测：10 目标×8 任务×半年打卡（2070 实体）写入+派生+渲染 114ms；缩放切换 65ms（<150ms 门槛）；undo 单命令完整还原
- [x] Playwright 截图门槛：`scripts/capture-phase2.mjs` 四档缩放 × 深浅主题 8 张 → docs/screenshots/phase2/

#### ② 关键决策（Phase 3 依赖）
- **BarsLayer 挂在 RowsLayer 与 Overlay(TodayLine) 之间**：容器 pointer-events-none、bar 元素单独 auto；bar 是叶子 div（Phase 3 拖拽 transform 直接落 bar 上，不违反 sticky 铁律）
- **点阵/热度模式由连续 dayWidth < HEAT_MODE_THRESHOLD(10) 判定**：缩放动画/Phase 3 连续缩放中自然切换，无需档位判断
- **per-goal 缓存失效链**：store 写入只换整表 map → stableGroupBy 未变目标组保持旧引用 → useGanttDerive 引用比对跳过重算。Phase 3/4 的写入路径不得破坏「未动实体保持引用」这一约定
- **weekHeat/counts 一律预裁到 today**：未来周不产生假 allMissed；点阵的未来占位点用全范围 scheduledDays
- bar 标签测宽用离屏 canvas（`gantt/lib/textWidth.ts` 按字符串缓存）；done 降饱和 = color-mix 55% 向 --bg-panel
- mini-map 在 scroller 之外（flex column 底部），取景框同步不走 React state；dev 全局 `window.__store` 供控制台/Playwright 脚本操作 store（生产剔除）
- setPointerCapture 一律 try/catch（合成事件/指针已释放会抛 NotFoundError）
## Phase 3 — 交互与编辑 【已完成 2026-07-17】

分五个子批次实现（每批 tsc/oxlint/vitest 全绿 + 浏览器 JS 度量实测后提交）：

### ① 交互地基 + 左侧任务网格完全体
- [x] Ctrl+滚轮以鼠标为锚连续缩放（[年,周] 区间 log 插值），静默 180ms 吸附最近档位；空格抓手平移
- [x] hover 十字定位：表头日期高亮 + 行/列淡背景横贯两侧（uiStore 细粒度订阅，pointermove 零整树重渲）
- [x] 左栏多列（名称/起止/进度/状态 + 可选打卡率/偏移），列宽拖调、⚙/右键列显隐菜单，全部持久化
- [x] 行内编辑即存进 undo：改名 / 进度（auto 任务输入即转 manual）/ 状态点循环切换
- [x] 目标行：折叠箭头 + 本月完成率迷你环形（新增 goalMonthlyRate 派生 + 单测）+ 🔥streak + 任务数
- [x] 左右联动：行 hover ↔ bar 目标色描边；点击左行空白定位 bar（水平+垂直带入视口）并闪烁
- [x] 分组末尾幽灵行「+ 添加任务」（hover 分组浮现）、底部常驻「+ 新建目标」、分隔条拖宽（双击复位）、纯图模式（24px 轨）
- [x] store/actions.ts：Phase 3 起所有 UI 写入唯一入口（含级联软删除/批量单命令）

### ② bar 拖拽 / resize / 跨泳道 / 框选新建 / 里程碑
- [x] 拖拽内核 dragCore（3px 阈值 / pointer capture / Esc 取消）+ dragHint 浮动日期气泡（直写 DOM 单例）
- [x] bar 移动：原位 30% 虚影、transform 连续跟手、提交吸附到天、拖近边缘匀速自动滚动（rAF 循环补偿 scrollLeft 位移）、120ms 落位动画
- [x] 左右缘 8px resize 热区（col-resize，最短 1 天，窄 bar 自动隐藏热区）；跨泳道垂直拖拽改 goalId（目标行高亮，提示追加目标名，order 排末尾）
- [x] 框选新建：任务/幽灵行空白水平拖 → 虚线预览条 → 迷你名称气泡回车创建（Esc/失焦取消）
- [x] 里程碑拖动吸附改日期、单击切换 achieved；实测浏览器全链路（+7 天移动/Esc 复原/undo label）

### ③ 多选 / 批量操作条 / 右键菜单 / undo toast
- [x] 多选：点选独占、Ctrl 增减、Shift 按行序连续、目标行/行外空白框选矩形实时命中；accent 双层描边；Esc/空白单击清除
- [x] 批量操作条（底部浮动）：数量、±N 天平移、改状态、改目标、删除——均一条命令一次 undo
- [x] bar 右键：编辑详情/标记完成/暂停恢复/复制并顺延（FS 依赖+「续」名）/从此日拆分（一条命令双 change）/保存为基线/删除；右键落在多选集内自动批量语义
- [x] 空白右键：在此日新建任务（命中行目标）/新建里程碑/添加免打卡区间
- [x] 全局 Ctrl+Z / Ctrl+Shift+Z(Y)，左下角 toast 显示被撤销命令摘要

### ④ 依赖连线 / 基线 / 任务详情抽屉
- [x] DependencyLayer：FS 圆角折线（正向走中线，回绕走行间通道）+ 箭头；灰→hover 相关任务变目标色→冲突（后继开始<前置结束）红色；透明加粗命中区点击删除
- [x] 连接柄：hover bar 两端圆点拖出虚线（吸附目标 bar 变实线）建立依赖；右柄=作为前置，左柄=作为后继
- [x] 基线：顶栏「保存基线」全量快照（一条命令）+ 连线/基线开关；bar 下 4px 灰色原计划条
- [x] 任务详情抽屉 380px 滑出（200ms）：全字段编辑即存（名称/目标/起止/状态/进度模式/打卡规则含自定义星期/依赖管理/基线/备注/删除）
- [x] 实测：冲突红线、点击删线、柄拖建依赖、抽屉开关与字段全绿

### ⑤ 命令面板 / 快捷键 / 聚焦 / 筛选 / PNG 导出
- [x] 命令面板（/ 或 Ctrl+K）：模糊搜任务/目标/命令（切月/缩放/导出/基线/导航），回车跳转+闪烁定位（跨页 navigate 后延时 emit）
- [x] 快捷键全套：T/+−/←→(Shift=月)/B/D/N/M/Del/Esc + 顶栏 ? 速查表（Shift+/）
- [x] 聚焦模式：双击目标行 → 其余折叠为汇总条 + 自动选档滚到该目标时间范围；再双击完整恢复折叠与缩放
- [x] 筛选：状态/目标多选；缺省两侧淡出（保持空间感），「仅显示匹配项」才收起；mini-map/依赖线同步过滤
- [x] PNG 导出（含左侧网格）：离屏克隆 + sticky transform 补偿，仅光栅化视口大小画布；Playwright 真实 Chrome 验证下载成功
- [x] 性能抽查（10 目标×8 任务×180 天打卡=1890 实体）：注入+重渲 389ms、缩放切换 35ms（<150ms 门槛）
- [x] 截图门槛：`scripts/capture-phase3.mjs` 四档×深浅 8 张 + 特写 5 张 → docs/screenshots/phase3/

### 关键决策（Phase 4/5 需知）
- **uiStore（gantt/uiStore.ts）与数据 store 分离**：hover/选择/行内编辑/拖拽/右键菜单/抽屉全是瞬态 zustand，细粒度 selector 订阅；不持久化不进 undo
- **写入路径铁律**：UI 一律走 `store/actions.ts`（组装 Change[] → execute）；只构造受影响实体新对象，未动实体保持引用（per-goal 派生缓存依赖此约定）
- **拖拽 60fps 实现**：拖拽中只直写被拖元素 style（move=transform、resize=left/width），React 仅在开始/结束渲染虚影；提示气泡是直写 DOM 单例（lib/dragHint）
- **幽灵行进 rowLayout**（kind:'ghost'，24px 常驻空间、内容 hover 才显示）：跨泳道/框选命中都靠 rowAtY 二分
- **左栏宽是动态 leftW**（gridWidth/gridCollapsed）贯穿 useViewport/useZoomAnimation/MiniMap/TimelineHeader，LEFT_W 常量已删除
- **Ctrl+滚轮缩放**：setDayWidth 后必须同帧镜像 dayWidthRef（同帧多 wheel 事件才能叠加）；吸附经 wheelAnchorRef 把鼠标锚点交给档位切换 effect
- **PNG 导出不能对整棵 content toCanvas**（周档 20440px×2 超 canvas 单边上限挂死）：离屏克隆 + 三个 sticky 元素 transform 补偿，只光栅化视口
- **本机浏览器面板验证盲区**：html-to-image 的 resolve 包在 rAF 里 → 面板（document.hidden）下导出永挂，必须用 Playwright 真实 Chrome 验证
- **筛选 hideOthers 的过滤 map 必须 useMemo 保引用**，否则 useGanttDerive 顶层引用比较失效导致全量重算；淡出用 wrapper div opacity（不动 layout）
- 种子数据里 status=done 但 progressMode=auto 的任务 effectiveProgress 按打卡计算（可能为 0）——bar 以降饱和+✓ 标识 done，进度列如实显示 auto 值（口径与 Phase 2 一致）

## Phase 4 — 打卡与复盘 【已完成 2026-07-17】

分五个子批次实现（每批 tsc/oxlint/vitest 全绿 + 浏览器实测后提交）：

### ① 打卡域 actions + 今日打卡面板完全体
- [x] actions：setCheckIn（同目标同日 upsert 原位更新，保 id/createdAt）/patchCheckIn/removeCheckIn/findCheckIn
- [x] 派生 derive/dayPanel.ts：dayEntries（当日应打卡条目，免打卡区间保留标 exempt+reason）+ dayCompletionRate（skipped/休息中不入分母），10 个新单测
- [x] 打卡页：日期+第N天+年度进度细条、最近 7 天完成率小环日历（点击切日补卡 + 回到今天）、按目标三大按钮点击即存（spring 微缩放 + FLIP 滑向已完成分组）、展开分钟 chips(15/30/60/90/自定义)+一句话备注、昨日缺卡入口、休息中徽标、全部完成 🎉+streak 汇总+按日轮换鼓励语
- [x] 实测：打卡/改状态/再点同状态取消、分钟与备注即存、undo 单命令还原、分组 FLIP 动效

### ② 甘特图打卡点就地 popover
- [x] 点阵透明命中区（≤今天，半径随日宽自适应不超半列，svg overflow:visible 保命中）
- [x] CheckinPopover：状态按钮+分钟 chips+备注+删除记录，点外部/Esc 即关（capture 拦截不误清多选），portal 定位 clamp 视口
- [x] body pointerdown 对 [data-checkin-dot] 放行（不误触框选）；dev 暴露 window.__ganttUi

### ③ 批量补卡 + 免打卡区间管理
- [x] batchCheckIn：日期范围×目标，只补「应打卡且无记录」（免打卡/已有记录跳过），dryRun 实时预览，一条命令一次 undo（实测 140→144→undo→redo 往返）
- [x] BackfillDialog（打卡页入口）：日期范围 + 目标 chips + done/skipped + 将补 N 条预览
- [x] ExemptionManager（设置页）：行内编辑即存（起止/原因/目标范围 chips，全选=缺省全部）、进行中徽标、添加/删除；createExemption 增 goalIds、updateExemption/deleteExemption

### ④ 月度复盘页 + 年度总览
- [x] 派生 derive/review.ts：monthlyGoalStats（月并集应打卡/score/rate/minutes/缺卡）、dailyActivityScores（热力图日分值，同目标同日取最强）、minutesByGoalByMonth，5 个新单测（合计 83 全绿）
- [x] saveReview 按月 upsert（内容/星评无变化不产生命令）；笔记+1-5 星防抖 800ms 自动保存
- [x] 月度复盘：完成率横条（+时长/缺卡列）、本月甘特只读缩略（任务 span+逐日热度格+周末纹+今日线）、GitHub 年度热力图（四档 alpha 按年最大值归一，全部/单目标切换）、streak 榜、上/下月切换
- [x] 年度总览：recharts 堆叠面积图（目标令牌色、主题化 tooltip、图例）、任务完成数、里程碑时间线（达成实心✓、标签交错）、基线偏移排行
- [x] recharts 仅进 ReviewPage 懒加载分包（主包 532KB / review 分包 366KB）；色板过 dataviz 六项验证（浅色全过；深色 CVD/对比度过，lightness band 为风格项不动令牌）

### ⑤ 移动端适配 + PWA + 截图门槛
- [x] 底部 tab 导航（<768px，icon+label，≥44px 触达，safe-area），顶栏 nav/工具栏/? 移动端隐藏；默认路由落打卡页
- [x] 甘特移动端只读月视图：进入强制 month 档（一次性）、左栏收 24px rail、禁 bar 拖拽/框选/右键长按，保留横滚+点打卡点 popover
- [x] 触摸双指缩放进 useZoomAnimation：两指间距比例→dayWidth、锚定两指中点、松手吸附档位；scroller touch-action: pan-x pan-y
- [x] PWA：vite-plugin-pwa（autoUpdate）+ manifest（standalone/主题色/192/512/maskable）+ apple-touch-icon；scripts/gen-icons.mjs 由 icon.svg 生成 PNG；scripts/check-pwa.mjs 实测 manifest 可达 + SW activated
- [x] 截图门槛：scripts/capture-phase4.mjs → docs/screenshots/phase4/（打卡/复盘月度/复盘年度 × 深浅 6 张 + popover/补卡/免打卡特写 3 张 + 移动端 2 张，含移动端断言）

### 关键决策（Phase 5 需知）
- **打卡口径**（2026-07-21 起改为任务级，见「后续修补」）：记录按 `目标+任务+日期` upsert（`findCheckIn(goalId,date,taskId)`）；同键多条取最强 done>partial>skipped；原位更新保 id/createdAt；再点同状态=删除记录（toggle-off）。streak/热度/时长统计仍按目标 roll-up（max/sum），天然兼容一目标多条任务记录
- **面板与甘特 popover 共用 actions**（setCheckIn/patchCheckIn/removeCheckIn），无记录时选分钟/写备注自动生成 done 记录
- 批量补卡的 dryRun 与写入同一函数（batchCheckIn 第二参），预览与提交零口径漂移
- 复盘笔记走 execute 进 undo（防抖 800ms 合并击键）；无变化早退不污染 undo 栈
- **浏览器面板同步读 DOM 会读到 React 提交前的旧渲染**（面板下 scheduler 时序），验证一律「一次调用做操作、下一次调用读结果」，或直接读 zustand 状态
- settings 落库防抖 500ms：截图脚本切主题后必须等 ~700ms 再整页跳转，否则回读旧主题
- vite dev server 读 PORT 环境变量（预览代理需要）；launch.json autoPort: true
- 移动端判定用 useIsMobile（matchMedia 767px + useSyncExternalStore）；强制月档只在进入时一次，双指缩放后不反复覆盖

## 后续修补

### 2026-07-18 补齐目标/里程碑删除入口
- deleteGoal/deleteMilestone action 早已实现但无 UI 触发点（功能缺口）
- 左栏目标行右键菜单：重命名 / 新建任务 / 删除目标…（confirm 列出级联数量：N 个任务、M 个里程碑、K 条打卡记录）
- 里程碑菱形右键菜单：标记达成⇄取消 / 删除里程碑（无级联，直删 + toast 提示可撤销）
- ContextMenuState.kind 扩展 'goal' | 'milestone'；时间轴右键分流顺序：里程碑 → bar → 空白
- Playwright 真实 Chrome 实测：真实右键全链路（菜单项/confirm 文案/级联软删/undo 完整还原）全绿
- 注：浏览器面板里 dispatchEvent 合成 contextmenu 不触发 React 委托处理器（element.click() 可以），右键类验证必须走 Playwright

### 2026-07-21 免打卡区间按年份分组折叠
- 设置页 ExemptionManager 列表按 startDate 年份分组（跨年区间归入开始年份），年份倒序；每组头部显示「N 段 · 共 M 天」，点击展开/收起
- 默认展开策略：当年及未来年份展开，过去年份默认收起——避免多年数据堆叠成长列表
- 折叠状态只存组件内 useState，不入库、不进 undo，刷新回到默认展开范围
- 浏览器实测：造 2024/2025/2026 三年数据，分组与默认展开/收起、点击切换均命中；截图接口本机再次超时，改读无障碍树核对

### 2026-07-21 年度总览补「投入总时长」卡
- 原年度总览只有按月堆叠面积图，无处一眼看到各目标全年累计投入（面积图只能 hover 单月单目标）——功能缺口，非 SPEC 设计
- AnnualOverview 面积图卡之后新增「投入总时长（小时 / 年，按目标）」卡：横条排行榜按小时降序 + 顶部全年合计；口径小时保留 1 位小数
- 总时长直接从 checkIns 按目标累加分钟再换算（不累加已四舍五入的月值，避免误差累积）；沿用「任务完成数」卡的横条视觉与令牌
- 浏览器实测：注入 4 目标 22 条打卡，横条降序与数字全部核对一致（SAP 6.8 / 健身 4.8 / 英语 3.3 / 篮球 1.2 = 合计 16.1），无控制台报错；测试数据已清理，截图接口本机超时改读页面文本核对

### 2026-07-21 修复里程碑无法重命名 + 依赖连线拖不动
- **里程碑重命名（功能缺口）**：里程碑创建后固定名「新里程碑」，右键菜单/双击/内联编辑处处无改名入口。修复：里程碑右键菜单加「重命名」→ 走 uiStore.editing（新增 field 'milestoneName'）→ GoalSummary 在 SVG 菱形旁复用 InlineInput 行内改名（Enter/blur 提交进 undo、Esc 取消）；单击切换达成/拖动改期不受影响
- **依赖连线拖不动（bug）**：连接柄只在 hover 本行（linked=hoverRowId===task.id）时渲染，而 useDepDrag 拖动中会把 hoverRow 改成命中目标行 → 源任务 linked 立即变 false → 柄 DOM 卸载 → pointer capture 随之丢失 → 拖拽被 pointercancel 中止（表现为「一按就弹回、连不上线」）
- 修复：uiStore 增瞬态 depDragTaskId，useDepDrag 起手 setDepDragTask(源)、结束清空；TaskBar 渲染条件改 `(linked || depDragging) && !dragging`，拖动全程保持源柄挂载，capture 不丢
- 浏览器面板实测（合成 PointerEvent 全链路）：里程碑右键→重命名→输入→提交名称落地；拖 sap-3 右柄至 sap-4（已存边，addDependency 去重 6→6，证明命中目标）、再拖至 en-1（新边 6→7）；两次拖动中 `document.contains(源柄)` 均为 true（回归锁定）

### 2026-07-21 打卡改为任务级（多任务目标各自记录耗时）
- **问题（结构性）**：打卡实为目标级（`一天对一个目标最多一条有效记录`），`findCheckIn/setCheckIn` upsert 键 = 目标+日期，`GoalCheckCard` 每目标一张卡一个时长输入且仅单任务时带 taskId。→ 同一目标下多个并行任务无法各自记录耗时（互相覆盖）；甘特 popover 也忽略 taskId，点任务 B 覆盖任务 A。数据模型早有 `CheckIn.taskId`，缺口在 UI + 写入/解析层
- **方案（完整任务级，模型不变、无数据迁移）**：记录改按 `目标+任务+日期` 解析/upsert
  - `dayPanel.dayEntries`：新增 `taskEntries[{taskId,name,status,record}]`（按 taskId 严格解析）、`allRecorded`（每个在办任务都记了才 true，供待办/已完成分组）、`legacyRecord`（旧的未分任务记录，仅提示手动清除）；目标级 `status` 仍取当日全部记录最强（供小环/热度口径）
  - `GoalCheckCard`：单任务目标布局手感不变；多任务目标 = 目标卡头 +「N 个任务」+ 每任务一行（各自状态键 + 展开分钟/备注）；检测到 legacyRecord 显示「旧记录·清除」chip 避免与任务级记录重复计时
  - `actions`：`findCheckIn(goalId,date,taskId?)` 严格匹配 taskId；`setCheckIn` 透传；`batchCheckIn` 多任务日改为每任务一条
  - `CheckinPopover`：记录解析带上 anchor.taskId（修「点 B 覆盖 A」）
  - streak/热度/时长统计（streak.ts/heat.ts/review.ts）**不改**——按目标 max/sum 聚合，天然兼容一目标多条任务记录；目标总时长因不再被单条封顶反而变准
- **历史数据**：旧的多任务「未分任务」记录（taskId 空）不迁移、不改，仍计入目标总时长；单任务目标旧记录本就带 taskId，完全不受影响
- 单测：dayPanel.test.ts 增 4 例（多任务各自解析/allRecorded/legacyRecord/单任务）；全量 97 测试绿
- 浏览器面板实测：英语目标临时加第 2 个并行任务，07-17 卡显示「2 个任务」两行独立；点任务1「跳过」后读 IndexedDB 确认仅 en-1 变 skipped、en-tmp 仍 done，两条记录各带 60 分钟互不覆盖；单任务卡（SAP SD模块）布局回归无变化；测试数据已清理复原。截图接口本机超时，改读无障碍树 + IndexedDB 核对

### 2026-07-22 新增「随缘」打卡规则（不定期任务，不催打卡）
- **问题（体验）**：投篮训练这类"一年随时可能记一次、但某月 99% 的天不记录"的任务，只能选每天/工作日/自定义——都会天天进「待打卡」、不打就算缺卡断 streak，想不缺卡只能天天手动点「跳过」，打扰严重
- **方案**：`Recurrence.type` 加第 4 种 `'adhoc'`（界面名「随缘」），模型仅扩union、无数据迁移、jsonb 存储不动同步
  - 派生一处收口：`isScheduledDow` 对 adhoc 恒返回 false → `expandScheduledDays` 为空 → 自动级联「无应打卡日 / 永不缺卡 / 不断 streak / 自动进度分母 0」；streak/热度/缺卡逻辑均不改
  - `dayPanel`：adhoc 任务天然不入 `dayEntries`（isScheduledDow false）；新增 `adhocEntries`（按目标·任务 order 排序，仅列在日期范围内、未完成、目标未归档者，携带当日该任务记录）
  - 打卡页底部新增默认折叠的「不定期 · N」区（`AdhocSection`），点开才列出供随手补记；复用 `GoalCheckCard` 导出的 `StatusButtons`（限 done/partial，随缘无「跳过」）/`TaskEditor`/`ExpandChevron`；写入走 setCheckIn 带 taskId（任务级）
  - `TaskDrawer`：打卡规则加「随缘」按钮，切换即 `{recurrence:{type:'adhoc'}, progressMode:'manual'}` 一条命令（自动进度分母为 0，故禁用 auto 选项 + 行为说明）
- 记录的时长仍按目标 roll-up 计入年度总览投入时长（review.ts 不改，按目标 sum 天然兼容）
- 单测：derive.test.ts +4（adhoc 无应打卡日/无缺卡/自动进度 0/不进 streak）、dayPanel.test.ts +3（不入 dayEntries 改由 adhocEntries、taskId 严格解析、范围外/已完成/归档过滤 + order 排序）；全量 104 测试绿；tsc/oxlint 干净
- 浏览器面板实测（注入「篮球」目标：日常「体能训练」+ 随缘「投篮训练」）：待打卡仅列体能训练、投篮训练不出现；底部「不定期 · 1」折叠区展开显示「篮球 · 投篮训练」两键（无跳过）；点完成后 IndexedDB 记录带 `taskId:'a1'` 任务级归属；甘特页无控制台报错。注入数据仅在内存（setState 未落库），刷新即净，无需清理

## Phase 5 — 云同步与部署 【已完成 2026-07-18】

- [x] SQL migration（supabase/migrations/0001_init.sql，用户已在 SQL Editor 执行）：6 表（id+user_id 复合主键、data jsonb 存完整实体、updated_at/deleted_at 冗余列）+ RLS（user_id = auth.uid() 全操作）+ server_updated_at 触发器（clock_timestamp）+ upsert_rows RPC（条件 upsert：excluded.updated_at > 现值才覆盖）
- [x] supabase-js 客户端（src/db/sync/client.ts）：未配 .env.local 时为 null，纯本地模式，同步 UI 整体隐藏
- [x] 同步引擎（src/db/sync/engine.ts）：先拉后推增量双向；拉取游标=server_updated_at（服务端触发器盖章，防客户端时钟偏差），推送游标=本地 updatedAt；游标按用户存 localStorage（丢失只导致一次幂等全量重同步）；单飞防重入，同步中再触发结束后补跑
- [x] LWW 归并纯函数（merge.ts + 10 单测，合计 93 全绿）：远端严格更新才赢、回声跳过、墓碑传播、分页重复取最新
- [x] 触发链全套：登录/启动（INITIAL_SESSION）、窗口 focus/visibilitychange、online 恢复、本地写入防抖 3s（persist flush 后经 signal.ts 事件通道，斩断循环导入）、每 5 分钟、手动
- [x] 邮箱认证：设置页登录/注册/退出（注册默认需邮箱确认，UI 已提示）；首次登录无游标=本地全量上传合并；退出保留本地数据与游标
- [x] 顶栏同步状态点（SyncIndicator）：✓/⟳/○/⚠ 四态+未登录，点击弹详情（帐号/上次同步/错误/立即同步/去登录）
- [x] 软删除传播：replaceAllData 改墓碑式清库（清空/导入产生的删除也能传播）；同步后 30 天墓碑真删（本地+云端，每会话清理一次）
- [x] 全链路浏览器实测（真实 Supabase 项目）：种子 158 实体全量上传行数逐表核对一致 → 本地打卡 3s 后推送可查 → RPC 模拟设备 B 改写经 focus 拉回应用 → 异地删除墓碑拉回（内存移除/Dexie 留墓碑）→ 旧 updated_at 推送被服务端 where 拒绝 → 本地删除上行 → undo 恢复上行 → offline/online 事件路径 → 刷新会话恢复自动同步数据完整
- [x] 部署文档：README 重写（Supabase 建表步骤/Vercel 部署/PWA 安装/备份兜底）+ vercel.json SPA 回落 + .env.example
- [x] 性能：syncApi.ts 懒加载门面，supabase-js + engine 切进 208KB 异步分包，主包 538KB（167KB gzip）与 Phase 4 持平，首屏关键路径零增量
- [x] 截图门槛：scripts/capture-phase5.mjs → docs/screenshots/phase5/（设置页登录区 + 状态点 popover × 深浅 4 张，含未登录态断言）

### 关键决策
- **双保险 LWW**：拉取侧客户端裁决必须对照 Dexie 原始行（含本地墓碑）——只看内存会把「本地已删、远端旧版」错误复活（单测锁定）；推送侧 upsert_rows 的 where 兜底，离线设备迟到的旧改动推不倒服务器新版本；顺序固定先拉后推
- **同步引擎直接读写 Dexie 原始表**（不经 repo）：repo 会重盖 updatedAt，拉取行必须保留远端时间戳；引擎属数据层，不违反「UI 不碰 Dexie」
- **applyRemote 不进 undo 栈不触发落库**，只拷贝受影响表、未动实体保持引用（per-goal 派生缓存约定不破坏）
- **settings 不同步**（ganttView/主题是设备本地偏好，SPEC 六表之外）
- 同步开始必先 flushNow()：把 500ms 防抖中的本地写入落库后再基于 Dexie 推拉，否则漏推
- onAuthStateChange 回调内不得同步调 supabase API（官方告诫，setTimeout 出让）；token 刷新事件同 uid 不重复触发同步
- 推送 t0 游标在读脏行前采集：推送期间新写入 updatedAt ≥ t0 留给下一轮，幂等不丢
- **UI 只从 syncApi.ts 导入同步功能**（懒加载门面）：直接 import engine/client 会把 supabase-js 拖回主包；isSyncConfigured 只读 env 不触发加载
- 实测辅助：dev 暴露 window.__syncStore；RPC + REST（带 access_token）可从页面模拟第二设备
- 本机 PowerShell 工具跑 node 脚本会静默挂起（零输出超时），Playwright/node 脚本一律用 Bash 工具跑

## 执行轨道（track）—— 长期迭代项目收成一行 【已完成 2026-07-27】

起因：一个目标（如「AI Agent Project」）下同时有"迭代很快就结束的短命项目"和"持续迭代的长期项目"。后者被拍平成多行散落在时间轴各处，既看不出整条执行路径（6.29 一直延伸到 8.02），又把年度视图淹没。加一层介于目标与任务之间的分组「轨道」：默认折叠 = 一个项目一行（年度视角），展开 = 完整执行路径（项目视角）。规格见 SPEC 4.3.1。

- [x] 领域字段：`Task.trackId?: string`（显式归属）+ `GanttViewState.expandedTrackIds`（默认折叠，故记"已展开"）。Supabase 零 SQL 改动、Dexie 零版本升级 —— 实体整体存 `data jsonb`，加业务字段对 SQL 透明；backup.ts zod 补两处（老备份 `expandedTrackIds` 走 `.default([])`）
- [x] 派生纯函数 `src/lib/derive/tracks.ts` + 16 单测：`buildTracks`（按 `goalId::trackId` 分组、<2 成员不成轨道、head 三级并列规则、区间并集含"相邻一天"合并）/ `aggregateTrackProgress`（按跨度天数加权）/ `memberAtDate`
- [x] `GoalGantt.perTrack`：轨道包络/分段/聚合热度/聚合进度，复用既有 `unionDays + weeklyHeat + bestStatusByDate`，`useGanttDerive` 的 per-goal 缓存零改动
- [x] `rowLayout.ts` 新增 `kind:'track'` 行 + task 行 `depth`，输出加 `trackRowByTrackId / unitRowsByGoal / memberRowsByTrack`；`buildRowLayout` 的 `opts` 缺省时行为与改造前完全一致（既有 6 条测试一行未改仍全绿，是本次改造的回归护栏），新增 6 条覆盖轨道分支；`rowAtY / visibleRowRange` 零改动
- [x] 左栏 `TrackRow` + `TaskRow` 的 depth 缩进与导引线；抽 `grid/ProgressCell.tsx` 共用进度条
- [x] 时间轴：抽 `SummaryBar.tsx`（多分段 + 间隙浅色底条），`GoalSummary` 改用它且视觉零变化；新 `TrackSummary.tsx`（`HeatStrip` 原样复用，一行未改）
- [x] 建轨道三入口：多选右键「合成一条轨道」/ 单个右键「归入轨道「X」」「移出轨道」/ 目标行右键「按依赖链建轨道」（一次性辅助导入，整体可撤销）
- [x] 拖拽改按"排序单元"：轨道整块移动（成员 order 一并平移），成员行禁拖并给出提示
- [x] 依赖线端点上浮 + 轨道内部线隐藏 + 多条收拢去重；筛选保全整条轨道 / 部分命中临时展开；聚焦模式展开全部轨道并在退出时还原；`locate-task` 统一走新的 `revealTask`
- [x] 截图门槛：`scripts/capture-tracks.mjs` → `docs/screenshots/tracks/`（四档缩放 × 深浅 8 张折叠态 + 2 张展开态，含「N 步」徽标渲染断言）
- [x] 全量 131 测试绿、`tsc -b` 与 oxlint 干净

### 关键决策
- **归属用显式 `Task.trackId`，不从 `dependsOn` 推导**：一开始走的是"零字段改动、靠依赖链连通分量推轨道"，被两点否掉 —— ① 依赖表达时序、轨道表达归属，同项目的并行任务串不起来，有先后但无关的任务会被强行合并且用户无法修正；② 若把归属存进 `AppSettings` 则不同步（`TABLE_NAMES` 不含 settings），手机与电脑各存一份。归属是用户数据，必须跟着 tasks 走
- **加字段的成本被高估过**：Supabase 每表 `data jsonb` 存整实体，只有 `updated_at/deleted_at` 是冗余列，加业务字段零 SQL、零 Dexie 升版
- **轨道名派生自最早成员**，不另开实体表：省掉 9 处改动（含 SQL 白名单与 Dexie 升版），代价是轨道不能单独命名/上色（见 SPEC 4.3.1 局限清单与升级路径）
- **`expandedTrackIds` 而非 collapsed**：默认折叠时只有记"已展开"语义才自洽；`trackId` 是稳定 id，不随头任务改期漂移，故无需交集判定或迁移代码
- **展开后保留轨道汇总行**：折叠按钮位置不跳、可对照总路径看具体步骤，代价是每条轨道多占 40px
- **`buildRowLayout` 加可选参数而非改签名**：缺省等价于改造前，旧测试即回归护栏
- 截图脚本两处坑：`updateSettings/execute` 落库防抖 500ms，写完立刻 `page.goto` 会丢改动（主题不生效、轨道消失），须 `waitForTimeout(700)`；缩放档位是 `role="radio"` 不是 button

## 番茄钟模块 —— 专注计时与真实投入统计 【规格已定稿，S1+S2 完成 2026-08-13，待 S3 实施】

起因：现有 `CheckIn.minutes` 是手填估算（chips 10/15/30/60），只能表达「这天这个任务大概花了多久」，无法回答「实际专注了多少、什么时段、被打断几次」。加一个番茄钟：日常工作时集中注意力，并把年度总览的「投入时长」从估算升级为实测。

规格书：**`docs/POMODORO_SPEC.md`（983 行，SPEC 扩展，番茄钟范围内以它为准；S2 评审后定稿）**
前置事实依据：`docs/pomodoro/01~04-facts-*.md`（4 份勘察/研究报告，共 ~10 万字符，区分【读码确认】与【推断】）

### 会话规划（5 个会话，每个独立可提交）
- **S1 抢救落盘 + 规格书初稿** 【已完成】
- **S2 对抗评审 + 规格定稿** 【已完成】
- **S3 数据层 + 计时内核**：SPEC §四 20 项 + `0002` SQL + `derive/focus.ts` + `src/pomodoro/` 内核 + 单测
- **S4 桌面 UI 完全体**：顶栏胶囊 + 面板 + 结果卡 + 声音/通知/title + `P` 键 + 设置区 + 打卡页入口
- **S5 统计可视化 + 打磨验收**：甘特中间态 + 补卡建议 + 会话历史/补录 + 性能实测 + 截图门槛 + 人工验收

纪律（额度保护）：每会话开头读 CLAUDE.md → 本文件 → POMODORO_SPEC.md；除 S2 外不用 agent；到 85% 额度无条件收手并留交接；结尾 `tsc -b` + oxlint + vitest 全绿再 commit。

### S2 产出（2026-08-13）：两名评审员对抗证伪 → 规格定稿

方式：数据正确性视角 + 手感/性能/平台视角各一名 agent 并发，纪律是「每条断言回到真实代码核 `path:line`，禁止『看起来合理所以通过』」。规格从 757 行增至 983 行，**新增 §十五 评审留档**（含被裁决为不改的 3 条与「初稿是对的、不必再纠结」的 12 条，S3 不要重复论证）。

**9 条致命问题（都已回填规格）**：
1. 忘执行 0002 时 `pullAll` 先抛错 ⇒ **六张老表也停止同步**（不是初稿说的「只有新表不同步」）。⇒ S3 必须同时改同步引擎为「单表失败不中断整轮」，这对既有 6 表也是净收益
2. 第 4 处无编译护栏 `replaceAllData` 的 `set()`（见上）
3. `deleteTasks` 批量删除是独立路径，级联漏改 ⇒ 孤儿会话仍计入统计且 UI 无法清理
4. `clockAnchor` 持久化 ⇒ 刷新一次就 `needsReview`，徽标沦为噪音
5. `cycleIndex` 存 `RunningState` ⇒ v1 每段回 idle 即删 key ⇒ 恒为 0，长休息永不触发。改为独立 key + 三条清零规则
6. 恢复判定「暂停总时长」未定义 ⇒ 可能把**暂停中的会话按 completed 全额结算**
7. 恢复判定完全没覆盖休息阶段 ⇒ 会**把一段休息写成专注会话**污染统计
8. 到点 timeout 与「停止」竞态 ⇒ 一次会话两格 undo（幂等 id 只保 Dexie 行数、保不住 undo 栈）。⇒ §5.3b 硬性终止序列
9. 「`ReviewPage` 零改动自动生效」错误 ⇒ 不传 `sessions` 就是番茄数据永不进复盘，且 tsc/测试全绿

**其它已定稿的实现约束**：口径全程 ms（初稿「逐段 round 再求和」与自己立的规矩冲突）；`planRecovery` 改带优先级的有序链 + `needsReview` 作横切标记；心跳暂停期间照写（否则「暂停去开会」天天弹结算对话）；Web Locks 必须模块顶层非 effect（StrictMode 双调用 + 永不释放 = 结构性泄漏）；内核全部模块单例、与组件挂载无关、且不得在 `hydrated` 前 `execute`；点阵中间态改用**点描边**（竖线在 7px 点里会糊）并承认 **year/quarter 档看不见**（`HEAT_MODE_THRESHOLD=10`）；DEV 句柄改为显式测试面（否则 §11.2 两条用例无法执行）。

### S1 产出与已拍板的核心决策
- [x] 4 份事实包从 workflow journal 抢救进 `docs/pomodoro/`（上一轮 workflow 跑完前 2 阶段后额度中断，结果只存在于临时 journal，仓库零文件）
- [x] `docs/POMODORO_SPEC.md` 全 14 章（领域模型 / 存储同步备份改动清单含完整 SQL / 计时内核状态机 / 与打卡口径 / 派生统计 / UI 逐界面规格 / 边界故障表 / 性能与容量红线 / 测试清单 / S3-S5 批次 / 局限与升级路径 / 被否决方案附录）
- [x] 用户拍板三项：范围 = 规格定稿 + 全部实现；打卡耦合 = 独立新表 + 人确认打卡；**v1 纯桌面（移动端不做）**

**核心决策（S3 起直接执行，不再重新论证）**
- **新增第 7 张实体表 `focusSessions`**（远端 `focus_sessions`）。一条记录 = 一次专注会话（`startAt/endAt/pauses[]` + 结算后的 `focusMs`），**不含任何需要累加的字段** —— 这是 append-only 行在整行 LWW 下天然安全的原因。塞 `CheckIn.minutes`（LWW + 累加 = 静默丢数）与塞 `AppSettings`（永不同步）都已被结构性否决，理由见 SPEC §十四
- **运行中状态存 localStorage，不入库不同步不进 undo**；只有「已结束的会话」走一次 `execute`。心跳绝不走 `persist`——否则 `emitLocalWrite` 会不断重置同步的 3 秒防抖，番茄运行期间云同步被无限推迟
- **时长唯一权威 = `Date.now()` 差值**；`performance.now()` 只用于**同文档内**探测时钟跳变与动画（**绝不持久化 anchor**：它跨文档归零，存进 localStorage 会让每次刷新都误报 `needsReview`）；闹钟用**单根长 `setTimeout`**（链长 1 ⇒ 免疫 intensive 档，但**不免疫 frozen**，故 `visibilitychange→visible` 补算是必需路径而非兜底；回调里下一根 timer 要先跳宏任务，否则链长会累积）；绝不 tick 累加、绝不用 rAF
- **到点自动结算**是消灭「忘记停」的主手段；页面被冻结时按计划终点结算；`focusMs` 无条件 clamp 到 `plannedMs` ⇒ 休眠 3 小时结构上不可能记成 3 小时；4h 硬截断 + `gap > 90s` 结算对话 + 跳变标 `needsReview`
- **打卡 `status`/streak/热度/点阵/自动进度全部不动**（既有事实：`streak.ts`/`heat.ts`/`scheduled.ts`/`dayPanel.ts`/`derive/gantt.ts`/`tracks.ts` 全部只看 `status`、不消费 `minutes`）⇒ 131 个既有测试零风险。唯一连接点是结果卡上的 `[✓ 记为完成]` 独立命令
- **统计层一处收口 `effectiveMinutes`**：在 `(goal, task, date)` 粒度取 `max(自动, 手填)` 再求和（按任务分桶是关键：目标级取 max 会丢掉「A 手填 60 + B 番茄 25」里的 25）。**全程 ms、只在渲染那一行取整**；消费端 **4 处**（`review.ts` 两处 + `AnnualOverview` + `ReviewPage` 传参，S2 纠正）。新增 `sessions` 参数缺省 ⇒ 既有 review 单测一行不改即回归护栏
- **多标签用 Web Locks 选主**（永不释放的 exclusive 锁；标签崩溃锁自动释放，无需心跳超时，胜过 BroadcastChannel）；显示一致性免费（剩余时间 = f(记录, `Date.now()`)）；结算用预生成 id 幂等兜底
- **v1 不碰 Service Worker / PWA 配置**：纯桌面用 `new Notification()` 即可，从而避开「改 SW → 已 code-split 的懒加载 chunk 部署后 404」风险区。已核实全仓零 `virtual:pwa-register` 引用 ⇒ SW 更新不会自动 reload，不会打断运行中的计时（若将来有人加 `registerSW({immediate:true})`，此结论失效）
- **顶栏胶囊是主形态**，倒计时**直写 DOM（零 React 重渲）**。若每秒 setState，甘特页每秒重渲会直接违反「拖拽 60fps」门槛。⚠️ 不能照抄 `dragHint`（那是 React 树外的 `createElement` 元素）：胶囊在顶栏 JSX 里，承载元素必须是**零 children 的空 `<span ref>`**，否则 App 重渲会刷掉 ticker 写的值；面板 hero 数字与进度环共用同一个 1s 单例 ticker
- 快捷键 **`P`**（已核实空闲）；**不抢空格、不用 Esc**（Esc 全仓 9 个消费者）；必须补进 `ShortcutHelp` GROUPS
- **唯一令牌缺口**：`tokens.css` 字号封顶 `--font-20`，面板 hero 倒计时需新增 **`--font-32`**；进度环几何落新建的 `src/pomodoro/constants.ts`（仓内已有两处手写环，不塞 `gantt/constants.ts`）
- **容量红线 8000 行**（约 1.4-2.7 年）：v1 全量 hydrate（与既有 7 表一致、零特例），越线后启用「近 400 天窗口化 hydrate + `exportBundle` 该表改读 Dexie + **`replaceAllData` 墓碑差集改读 Dexie** + 往年 async 补载」。`date` 索引在 v1 一次建好 ⇒ 将来切换无需再升 Dexie 版本。设置页计数须改 `db.*.count()`，否则窗口化会把观测手段自己封顶在 6400
- **同步游标**：推送游标是全局单值，但 `BaseRepo` 无条件重盖 `updatedAt` 且 `persist.ts` 是唯一应用层通道 ⇒ 结构上不可能漏推（S2 复核，从「坑」降级为文档性约定）
- ⚠️ **加表的 4 处无编译护栏**（漏改静默出错）：`TABLE_NAMES`（漏 = 新表永不同步/不导出）、`hydrate` 的 `set({...})`（漏 = 表在但内存永远空）、**`replaceAllData` 的 `set({...})`（漏 = 内存与 Dexie 分叉，已软删数据复活并推上云——S2 新发现，严重度最高）**、`SettingsPage.TABLE_LABEL`（漏 = 界面渲染 undefined）
