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

## 番茄钟 P1（2026-08-14）—— 自动休息循环 · 悬浮小窗 · 到点提醒可靠化 · 选择器收窄

用户日用四条反馈，两条是真缺陷、两条是范围切错。`tsc -b` + oxlint + vitest **225 通过 / 12 文件** 全绿。

### 一、休息循环从「空档」变成真能跑（缺陷）

`shortBreakMin` / `longBreakMin` 在 domain、defaults、设置页 UI、backup zod 里全量存在，但全仓**唯一**的 `phase:` 赋值点是 `kernel.ts` 的 `phase: 'focus'` —— 没有任何代码路径能启动休息段。用户设了「短休息 5 分」得到的是**零行为**。

**这次修的是规划错误，不只是代码**（复盘留档，别再犯）：
- **表层**：规格 §二/§十三 把「自动开始休息」定为 P1，这个决定本身没错；错在同一份规格的 §三 又把三个休息设置项**全量写进 v1 设置页**。设置项是产品对用户的承诺。规矩应是**能力与其配置项同生同死**——要么一起做，要么一起不出现。
- **中层**：范围裁剪的判据用了「哪些能省」，正确的判据是「去掉之后它还叫不叫这个东西」。「专注—休息交替」是番茄工作法的定义本身，`focusMin` 与 `shortBreakMin` 是同一机制的两半。可以砍全屏模式、砍成就系统，不能砍循环。
- **底层（最值得记）**：§11.3 把「连续跑 4 段确认长休息节律」列为人工验收项，而 v1 **结构上永远走不到长休息**（§5.2b 自己论证过每段到点后 100% 回 `idle`）。这条验收项写下时就该炸出矛盾；它没炸，是因为那 6 条被整体标记为「待用户本人过」，于是永远没有执行者。⇒ **任何"推迟给人工"的验收项，落笔时必须先做一次纸面自查（这条在当前代码里走得到吗）**，否则等于没写。

**实现**：新增 `kernel.startBreak(kind, owner)`（与 `startFocus` 同构，休息仍不落库）；接线点只有一处 —— `terminate()` 的末尾，三道闸缺一不可：① 只有 `outcome === 'completed'` 才进（`stopped`/`discarded` 是用户主动中断，此时弹休息是骚扰）；② 只有 `Date.now() - endAt < AUTO_BREAK_FRESH_MS`(60s) 才进（合盖两小时后回来补算的那段，休息早就过完了）；③ leader 门禁（其余标签靠 `storage` 事件同步）。新增设置项 `autoBreak`（默认开）。`startBreak` **不清 `lastResult`**（结果卡要继续留在面板上）。

**实测（本机 Chrome，真实等待）**：`cycle` 预置 3 → 跑一段 61 秒专注 → 落库 `focusMs 61000 / completed`、`cycle` 3→4、**自动进入 `longBreak`（15 分）** + `alert: focusEnd`。这正是 v1 那条结构上无法通过的验收项，现在真跑通了。

### 二、悬浮小窗（Document PiP）

`documentPictureInPicture.requestWindow()`，Chrome/Edge 116+ 桌面。选它而不是自绘浮层：它是**真正的系统级窗口**，浮在所有窗口之上、最小化浏览器后依然可见 —— 这正是「到点了我在别的软件里，什么都看不到」的解药。小窗与主页面**同一个 JS realm**，kernel / ticker / store 直接可用，零跨窗通信。

新文件 `src/pomodoro/pip.ts`（窗口生命周期 + 样式表搬运 + 主题 `MutationObserver` 跟随）与 `PipView.tsx`（portal 内容，倒计时仍走那一个 1s 单例 ticker + ref 直写，零每秒重渲）。入口：面板底部「悬浮小窗」按钮 + 设置项 `pipAuto`（默认关，「开始专注时弹出」）。⚠️ `requestWindow` 需要 transient user activation ⇒ 只有「开始专注」这类手势路径能自动开窗；自动进休息、恢复结算不是手势，那些路径只更新已开的小窗。不支持的浏览器**不渲染入口**（安静降级，不提示）。

**实测（`scripts/check-pip.mjs`，系统 Chrome 有头）**：空闲 `25:00 | 待开始 | 开始` → 专注中 `0:03 | 专注 · 第 1/4 段 | 🧩 SAP系统 · … | 暂停 停止 丢弃` → 到点整窗醒目态 `这段专注到点了，休息一下 | 知道了`（此时 `phase` 已是 `shortBreak`）→ 点「知道了」回到 `4:59 | 短休息` → 切深色主题小窗背景 `#f7f7f8 → #101014` 跟随。
⚠️ **本机浏览器面板建不出 PiP 窗口**（`InvalidStateError: Internal error: no window`，API 存在但宿主没有真实窗口）⇒ 这一条只能用系统 Chrome 有头模式验，已固化为 `scripts/check-pip.mjs`。

### 三、到点提醒为什么「开了也没效果」（缺陷）

三个独立成因，逐个修：

1. **补算路径完全没有可见出口**（主因）。`chime.ts` 的 `if (!document.hidden) return` 之后什么都不做。而页面一旦被浏览器冻结（`frozen` 态下所有 timer 都不跑），到点时闹钟根本没触发，等用户切回来走 `catchUp()` 补算结算 —— **此刻页面已经 visible** ⇒ 只响一声铃，面板不点开就什么都看不见。⇒ 新增 `alert` 状态并把置位**挪到 `document.hidden` 判断之前**，小窗的醒目态与结果卡都挂在它上面。
2. **多标签下 leader 被冻结 = 全员静默**。`onAlarm` 里 `!isLeader && leaderKnown` 让 follower 直接 return；leader 恰好是被冻结的后台标签时，没有任何标签会结算、响铃。⇒ follower 改为等 `ALARM_FALLBACK_MS`(3s) 后复查运行态，还在就自己接手（`terminate({forced:true})` 绕过 leader 门禁负责响铃与起休息）。重复由预生成 `sessionId` + `settledIds` + `storage` 事件三重兜住，最坏是响两声而不是丢数据。
3. **权限层不可观测**。设置页只显示开关是「开」，而通知可能被 Chrome 站点权限、Windows 通知设置、专注助手任一层吞掉。⇒ 加「通知权限：未授权/已授权/已拒绝/不支持」实时状态 + **「发送测试通知」按钮**，一次点击就能把三层分离；诚实说明补上「只在最小化或切到后台时发送」与「后台可能延迟」。

### 四、任务选择器收窄（`Task.noFocus` + 最近使用）

- `Task` 加 `noFocus?: boolean`，**反向存储**（缺省 = 参与）⇒ 老数据零迁移；给现有实体加字段对 Supabase 透明，**零 SQL、零 Dexie 升版**。同步补进 `backup.ts` 的 `taskSchema`（zod 默认 strip 未声明键，漏了就是导入备份后标记被静默丢弃）。
- 三个写入入口，全走现成的 `patchTask`/`patchTasks` ⇒ 自动进 undo：任务抽屉「打卡规则」区下方一行开关、甘特右键菜单一项（多选时整批翻转）、**选择器行内 hover 的 `⊘`**（在被打扰的当下就能清掉，下拉不关闭）。
- 选择器改三段：`最近`（localStorage `yearflow:pomodoro:recentTasks`，上限 8 存 5 显，不受 `noFocus` 与「今日在办」约束）/ `今日在办`（过滤 `noFocus`）/ `显示全部（另有 N 个已标不计时）` 折叠区。**搜索模式不受任何过滤影响** —— 搜得到才叫逃生阀。`dayEntries + adhocEntries` 合并去重那三条规格铁律一行未动。
- 实测：⊘ 一下 → 该任务移入折叠区、计数正确；`Ctrl+Z` 后 `noFocus` 计数归 0。

**新增文件**：`src/pomodoro/pip.ts`、`src/pomodoro/PipView.tsx`、`scripts/check-pip.mjs`、`scripts/capture-pomodoro-p1.mjs`（4 张截图：休息中面板 × 选择器三段分组 × 深浅）。

**仍待用户本人真机过**：① 最小化浏览器 25 分钟，看小窗倒计时是否卡住、到点提醒是否准时（**开着 PiP 小窗时 opener 大概率不被冻结，但这是行为观察不是规范承诺**，小窗倒计时卡住本身就是最好的自检信号）；② 设置页「发送测试通知」→ 若没弹，依次查 Chrome 站点权限 / Windows 通知设置 / 专注助手；③ 双标签只响一声。

---

## 番茄钟模块 —— 专注计时与真实投入统计 【S1~S5 全部完成 2026-08-13】

起因：现有 `CheckIn.minutes` 是手填估算（chips 10/15/30/60），只能表达「这天这个任务大概花了多久」，无法回答「实际专注了多少、什么时段、被打断几次」。加一个番茄钟：日常工作时集中注意力，并把年度总览的「投入时长」从估算升级为实测。

规格书：**`docs/POMODORO_SPEC.md`（983 行，SPEC 扩展，番茄钟范围内以它为准；S2 评审后定稿）**
前置事实依据：`docs/pomodoro/01~04-facts-*.md`（4 份勘察/研究报告，共 ~10 万字符，区分【读码确认】与【推断】）

### 会话规划（5 个会话，每个独立可提交）
- **S1 抢救落盘 + 规格书初稿** 【已完成】
- **S2 对抗评审 + 规格定稿** 【已完成】
- **S3 数据层 + 计时内核** 【已完成】：§四 21 项 + `0002` SQL + `derive/focus.ts`（47 条单测）+ `src/pomodoro/` 内核
- **S4 桌面 UI 完全体** 【已完成】：顶栏胶囊 + 面板 + 结果卡 + 结算对话 + 声音/通知/title + `P`/`Shift+P` + 设置区 + 打卡页入口
- **S5 统计可视化 + 打磨验收** 【已完成】：甘特中间态 + 补卡建议 + 会话历史/补录 + 复盘专注指标 + 性能实测 + 截图门槛

纪律（额度保护）：每会话开头读 CLAUDE.md → 本文件 → POMODORO_SPEC.md；除 S2 外不用 agent；到 85% 额度无条件收手并留交接；结尾 `tsc -b` + oxlint + vitest 全绿再 commit。

### 修复（2026-08-13）：任务选择器长列表被压扁 + 下拉顶出视口

用户报告：番茄钟选任务时「任务太多会被截断」。实测下来不是数据被截断，是**每一行都在、但被压扁到 13px 且滚不动**。

**根因**：`TaskPicker` 的列表是 `flex flex-col overflow-y-auto`，而每个选项行自带 `truncate`（即 `overflow: hidden`）。CSS 规范里 flex item 的 `min-height: auto` 只有在 `overflow: visible` 时才解析为内容高度；子项一旦 `overflow: hidden`，自动最小尺寸退化为 **0** ⇒ 16 行被硬塞进 `max-h-56`（224px），每行压到 ~13px 文字上下削平，且因为「内容装得下」滚动条根本不出现。

**修复**：
1. 列表内所有 flex 子项（选项行 / 分组标题 / 空态 / 搜索框 / 底部「暂不归类」）一律 `shrink-0` ⇒ 行高恢复 26px、溢出、滚动条正常工作。
2. 下拉改为**打开时量视口**（`useLayoutEffect` + resize 监听）：下方装不下且上方更宽裕 ⇒ 翻到上方开；否则就地把列表高度压到 `min(224, 可用空间 - chrome)`，但不低于 96px。几何常量进 `pomodoro/constants.ts`（`PICKER_*`），不散落魔数。面板底部那批 compact 选择器（未归类归类行、`SessionHistory` 补录行）以前展开会直接顶出屏幕，现在必定完整可见。

**实测**（`scripts/capture-picker.mjs`，注入 24 个每日任务撑爆列表，系统 Chrome）：行高最小 26px（修复前 13px）、`scrollHeight 203 > clientHeight 96` 且能滚到底；视口压到 620px 时补录选择器 `flippedUp: true` 且完整落在视口内；深浅两主题各 3 张图 → `docs/screenshots/pomodoro/picker-*.png`。`tsc -b` + oxlint + vitest 185 通过。

### S5 产出（2026-08-13）：统计可视化 + 打磨验收（番茄钟模块收尾）

`tsc -b` + oxlint + vitest **185 通过 / 11 文件**（既有 131 条仍一行未改 ⇒ 回归护栏依然成立）。主包 **187.75 → 190.21 KB gzip（S5 +2.46KB；番茄钟全模块累计 +11.4KB，门槛 ≤15KB）**，recharts 仍只在 review 分包（107.01KB gzip），新增依赖 0 个。

**新增/改动**：`derive/focus.ts` 加 `focusIndexForGantt` 与 `focusStats`（+7 条单测）；`CheckinDots`（中间态描边）、`BarsLayer`/`GanttView`（`focusIndex` 独立 `useMemo`，与 `useGanttDerive` 平行）、`BarTooltip`（「专注」行走新 prop）；`CheckinPopover`（专注时长 + 一键补卡）；`GoalCheckCard` 新增导出组件 `FocusAutoBadge`（自动值徽标 + 补卡，**替掉了三处重复的展示 span**）；`CheckinPage`（「这天你专注了 X · N 段」）；`ReviewPage`（未归类灰字 + 专注指标卡 + `Stat` 小组件）；新文件 `src/pomodoro/SessionHistory.tsx`；`scripts/capture-pomodoro.mjs` 扩到 **28 张**（S4 14 张 + S5 14 张）。

**一处对规格签名的修改（已回填 SPEC §七）**：`focusIndexForGantt` 初稿是 `(checkIns, sessions, year) → noCheckInDaysByGoal`。实现时发现两点：① 「无打卡」在渲染侧本来就成立——`CheckinDots` 只给 missed 与占位两个分支加描边，而这两个分支的定义就是「该任务该日没有打卡记录」，派生层再算一遍是重复且更弱的判断；② goal 粒度会串味——目标下任务 A 已打卡、任务 B 只跑了番茄时，goal 级交集会把 B 的标记整个抹掉，**恰恰是 §6.3 要解决的那个场景**。⇒ 改成 `(sessions, year) → { focusDaysByTask, msByTask }`，依赖收窄为 `[focusSessions, year]`，顺带消掉了「每次打卡编辑全表重扫」那笔已知代价。

**一处实现期发现的缺陷（写代码时就修了，值得记住）**：`SessionHistory` 起初 `createPortal` 到 body —— 胶囊的「点外部关闭」是 `rootRef.contains(e.target)` 的 DOM 包含判断，portal 出去的节点不在 rootRef 里，**点对话框任何一处都会把面板连同对话框一起卸载**（表现为「点一下就消失」）。改成与 `AskDialog` 一样挂在胶囊的 relative 容器内（`fixed` 相对视口，父容器不影响定位）。

**§11.2 自动化实测（Playwright + 系统 Chrome，本机 dev）**：
- 中间态：删掉某任务最近 3 天打卡 + 注入 3 段会话 ⇒ month 档 `circle[stroke="var(--warning)"]` 恰好 3 个；4x 放大自查（深浅两主题）与「纯 missed 点」「今日环」三者清晰可分
- bar tooltip：`专注 1 小时 40 分`（25+25+50），且 hover 期间 `__ganttDeriveComputes` 增量 **0**（没把 `focusSessions` 拖进那个 hook）
- 打卡点 popover：`专注 50 分` + `一键补卡` ⇒ 写出 `status: done, minutes: 50`
- 打卡页：切到有会话的日期 ⇒ 「这天你专注了 1 小时 20 分 · 2 段」+ 行内「补卡」按钮 1 个，点击后打卡数 100 → 101
- 复盘页：`另有 1 段未归类（30 分）未计入` + 专注指标卡（4 段 / 平均 33 分 / 被打断率 25% / 合计 2 小时 10 分）
- 专注记录对话框：列出 4 段、改时长 25 → 42 落库且 undo 栈恰好 +1、**点对话框不会把面板关掉**、补录一段写出 `source: 'manual'`
- 移动端 375×812：番茄入口零节点

**§10.1 性能实测（800 段会话 + 番茄钟运行中，并做「清空会话」对照组）**：
| 指标 | 实测 | 门槛 |
|---|---|---|
| 首屏（生产构建 `vite preview`，导航 → 首根 bar） | **269ms**（dev server 下 959ms，是 Vite 未打包模块图的成本） | <1s |
| 缩放四档收敛（含 150ms 插值动画 + 3 帧稳定判定） | 199~278ms／对照组 198~329ms（**开会话反而略快 ⇒ 差异是噪音**） | 切换 <150ms |
| 拖 bar 帧间隔 | 中位 **16.7ms**、p95 16.9ms、>32ms 帧 1 个／对照组 0 个 | 60fps |
| 拖拽期间 `__ganttDeriveComputes` 增量 | **1**（落手提交那一次，与不开番茄一致） | 不额外触发 |
| 番茄跑 3 秒期间派生重算 | **0** | 每秒 0 次重渲 |

**§11.3 六条人工清单仍待用户本人过**（无自动路径，需真实硬件与真实等待）：到点提示音音色、系统通知弹出与点击回焦、后台标签跑满 25 分是否准点、合盖休眠 30 分后的结算对话、双标签只响一声、连续 4 段确认长休息节律。

### S4 产出（2026-08-13）：桌面 UI 完全体

`tsc -b` + oxlint + vitest **178 通过 / 11 文件**（一条既有测试未改）。主包 **178.81 → 187.75 KB gzip（+8.9KB）**，门槛 ≤15KB ⇒ 面板不必拆 `lazy()`。新增依赖 **0 个**（Web Locks / AudioContext / Notification 全是平台 API）。

**新增文件**：`src/pomodoro/` 下 `ticker.ts`（1s 单例 ticker）、`format.ts`（mmss / 中文时长）、`title.ts`（隐藏时倒计时 + 闪烁降级 + 幂等 `restoreTitle`）、`chime.ts`（OscillatorNode 合成 + 通知 + 权限请求）、`api.ts`（所有「开始」手势的统一入口，保证 AudioContext 在手势里解锁）、`useSelLabel.ts`、`TaskPicker.tsx`、`PomodoroPanel.tsx`、`ResultCard.tsx`、`PomodoroWidget.tsx`（胶囊 + 结算对话 + 快捷键）、`PomodoroSettings.tsx`、`StartFocusButton.tsx`；`scripts/capture-pomodoro.mjs`（14 张截图 → `docs/screenshots/pomodoro/`）。
**改动点**：`tokens.css` 只加 `--font-32`；`App.tsx` 插胶囊 + typing 守卫补 `SELECT`；`GanttView.tsx` 同款守卫；`ShortcutHelp` 加 `P` / `Shift+P`；`SettingsPage` 加「番茄钟」区；`CheckInPage` / `GoalCheckCard` / `AdhocSection` 接自动值与 ▶ 入口。

**性能门槛实测（甘特页 + 面板打开态，6 秒 MutationObserver）**：DOM 变更 18 次**全部**是倒计时/进度环/title 的 ref 直写，**其它变更 0 次** ⇒ React 重渲每秒 0 次；`window.__ganttDeriveComputes` 15 → 15（开着番茄钟不触发任何额外派生）。

**§11.2 主要项实测（本机 dev + 双标签）**：
- 暂停：剩余量冻结、胶囊转 `⏸`、**暂停期间心跳照写**（否则「暂停去开会」回来必弹一次无谓对话）
- 停止：恰好 1 行、undo **+1 格**、`outcome: 'stopped'`、`pauses` 1 段、运行态 key 已清、title 已恢复
- **终止竞态**：`plannedMs` 1.5s 后立刻停止 ⇒ 仍只 1 行 / 只 +1 格，`stopped` 没被随后的 timeout 改写成 `completed`
- 恢复：刷新无缝续跑（含移动端宽度下）；`gap > 90s` ⇒ 结算对话，`算到刚才 5 分` 落库正好 300000ms（走 `netFocusMs`，暂停未被重复扣）
- `> 4h` ⇒ `hardCut`：`focusMs` clamp 到 `plannedMs`、`needsReview` 徽标出现，`[知道了]` 清掉徽标且**不动时长、不置 `source:'manual'`**
- `< 60s` ⇒ 不落库 + 轻 toast「这段不足 1 分钟，未记录」
- 未归类 → 面板「N 段未归类 · 去归类」→ 选任务 ⇒ `改归属为「…」` 一条 undo，计数归零
- 「✓ 记为完成」是**独立一条 undo**（`打卡「SAP系统」完成`），按钮即时回显「已完成 ✓」；未归类时禁用并说明原因
- 打卡页：▶ 起跑归属正确带 `taskId`，行内并列显示「25 分（自动）」，分钟框 placeholder「自动 25 分」且**不预填**；运行中该行图标转 🍅
- 设置页数字框 clamp：`999 → 180`、`0 → 1`，都写回并回显
- 移动端 375×812 冷启动：番茄入口**零节点**，但计时照常跑（拉宽即无缝接上）
- 双标签：显示天然一致（follower 也走 `Date.now()` 现算）；**修正后**只有 leader 落库/响铃，follower 零写入零 undo

**一条 S4 实测发现并修正的缺陷（已回填规格 §5.6 第 3 条）**：`kernel.ts` 的 `leaderKnown` 原本写在 Web Locks 授予回调里 —— 那是 leader 视角，而消费者是 follower 的门禁。结果排队中的 follower 永远认为「还没选出 leader」⇒ 每个标签各自结算各自响铃；双标签实测**由 follower 抢先落库**，结果卡与响铃跑到用户没在看的标签，声音响两遍（Dexie 行数靠幂等 id 仍是 1，所以不丢数、不报错，极易被当成玄学）。改为「只要 `navigator.locks.request` 存在就立刻置位，request reject 才降级」。

**两条实现细节值得记住**：
- 胶囊/hero/环的文本都由 ticker 经 ref 写，但**额外挂了一个每次重渲后补写的 `useLayoutEffect`**：状态迁移（开始/暂停/结算）与设置改动要立刻反映，否则最长会空着一整秒才刷新。
- 任何来源起的一段专注都把选择同步回面板 `sel`（`running.sessionId` 变化时）。少了它：从打卡页 ▶ 起跑，这段结束后面板回显「暂不归类」，用户接着按 `P` 就起了一段没归属的会话。

**本机环境两个坑（下次别再踩）**：① Playwright 里 `getByRole('button', {name})` 匹配的是**可及名**，任务选择器的可及名来自「目标 · 任务」文本会随数据变，要按 `title` 定位；② 用 `dispatchEvent(new Event('blur'))` 验不了 React 的 `onBlur`（React 走 `focusout`），必须真实点走焦点。

### S3 产出（2026-08-13）：数据层 + 计时内核落地（UI 留给 S4）

`tsc -b` + oxlint + vitest **178 通过 / 11 文件**（既有 131 条一行未改仍全绿 ⇒ 回归护栏成立）。

**新增文件**：`src/lib/derive/focus.ts`（结算 / 恢复判定 / 投入口径，纯函数）+ `focus.test.ts`（47 条）；`src/pomodoro/constants.ts`（阈值 + 进度环几何 + localStorage 键）、`running.ts`（运行态与节律计数的 localStorage 存取）、`store.ts`（瞬态 zustand，**只存状态迁移时才变的字段**）、`kernel.ts`（闹钟 / 心跳 / Web Locks 选主 / 终止序列 / 恢复 / DEV 测试面）；`supabase/migrations/0002_focus_sessions.sql`。

**§四 21 项全部打勾**，其中四处无编译护栏的处理方式：
- `TABLE_NAMES` / `hydrate` 的 `set()` / `TABLE_LABEL`：逐处加键并就地留下「漏改不报错 + 后果」的注释。
- **`replaceAllData` 的 `set()` 改为 `TABLE_NAMES` 驱动**（`Object.fromEntries` + `toMap`），与同函数的写盘循环同源 ⇒ 这一处的风险**结构性消除**，将来加表不可能再漏。
- `TABLE_LABEL` 类型从 `Record<string,string>` 收紧为 `Record<TableName,string>` ⇒ 从此有编译护栏。

**三条实施期新发现（都已回填规格）**：
1. **同步引擎「单表失败不中断整轮」被否决**（详见 POMODORO_SPEC §4.2 与 §十五「裁决为不改」第 4 条）：`pushAll` 推送游标是全局单值且在表循环之后才推进，吞掉单表异常会让该表脏行**永久低于游标、再也不被推送**；现状 fail-fast 反而安全（游标不动 ⇒ 下轮重试）。用户已执行 0002 ⇒ 永久性失败条件消失。`engine.ts` 只加 `REMOTE_TABLE` 一个键。
2. **§11.2 的 `start({plannedMs: 3000})` 用例结构上跑不通**：3 秒 < `MIN_SESSION_MS` ⇒ `settleSession` 必然返回 `null`，永远落不了库。已改为 62 秒，或用「注入 `startAt` 在数分钟前的运行态 + `forceSettle()`」。
3. **`backup.ts` 的 `pomodoro` 默认值直接引用 `DEFAULT_SETTINGS.pomodoro`**，不手抄第二份：手抄就必须与 `defaults.ts` 逐字段深相等，否则 `backup.test.ts` 那条 `toEqual(DEFAULT_SETTINGS)` 会失败。顺手也给 `SettingsRepo.get()` 加了 `pomodoro` 的深合并（与 `ganttView` 同款），老 settings 行缺字段时自动补齐。

**浏览器实测（本机 dev）**：
- **Dexie v1 → v2 迁移决定性验证**：用 Dexie 自己按 v1 原始 schema 建库 → 写入 goal/checkIn/settings → 换新 schema 打开 ⇒ `verno` 1→2、老 7 表与数据全部保留、`settings.value` 完好、新表 5 个索引（`goalId/taskId/date/updatedAt/[goalId+date]`）全部可查。
- **落库 / undo 链路**：注入 5 分钟前的运行态 → `forceSettle()` ⇒ 恰好 1 条 Dexie 行、undo 栈 **+1 格**、label「记录专注 5 分钟（未归类）」、`outcome: 'stopped'`、运行态 key 已清、**节律计数未递增**（stopped 不算）；连调两次 `forceSettle()` 无重复写入；`Ctrl+Z` 后内存移除且 Dexie 留墓碑（供同步传播删除）、redo 栈保留。
- **`replaceAllData` 七键路径**：载入示例数据后内存与 Dexie 逐表完全一致（103 打卡 / 12 任务 / 5 目标…），无分叉；空 `sessions` 下 `monthlyGoalStats.minutes` 与纯手填累加**逐分钟相等**（225 == 225）。
- 设置页「数据」区已多出「专注会话 N」，且计数改为直接数 Dexie（容量红线的观测手段不会被将来的窗口化封顶）。

**S4 起注意**：内核已在 `App.tsx` 的 `hydrated` 之后 `initPomodoro()` 一次；`window.__pomodoro = {store, remainingMs, start, forceSettle}`（DEV）。响铃/通知走 `setChimeHandler(fn)` 注入，**排在落库之后**（音频异常绝不阻断数据写入）。v1 没有任何路径会进入休息阶段（自动休息是 P1），休息态代码只为「残留态清理 + 将来升级」存在。

### S2 产出（2026-08-13）：两名评审员对抗证伪 → 规格定稿

方式：数据正确性视角 + 手感/性能/平台视角各一名 agent 并发，纪律是「每条断言回到真实代码核 `path:line`，禁止『看起来合理所以通过』」。规格从 757 行增至 983 行，**新增 §十五 评审留档**（含被裁决为不改的 3 条与「初稿是对的、不必再纠结」的 12 条，S3 不要重复论证）。

**9 条致命问题（都已回填规格）**：
1. 忘执行 0002 时 `pullAll` 先抛错 ⇒ **六张老表也停止同步**（不是初稿说的「只有新表不同步」）。⚠️ **诊断成立但处方在 S3 被否决**（吞掉单表异常会让该表永久漏推，见上「S3 产出」第 1 条）
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

## 年报模块 —— 年度收官报告（叙事长图）【Y1 完成 2026-08-14】

起因：现有 `AnnualOverview` 只回答「数字是多少」，不回答「这一年到底发生了什么、我不知道的是什么」。加一个 `/year` 叙事长页：11 个 beat，每个 beat = 一句话结论 + 一个 hero 数字 + 一张自绘图，读完 3 分钟，可导出长图 / 打印，每条结论能一键跳回甘特图。

规格书：**`docs/ANNUAL_SPEC.md`（SPEC 扩展，年报范围内以它为准）**

**本模块最大的结构性优势：纯派生页**——不加表、不加字段、无 SQL、无 Dexie 升版、无同步改动。番茄钟那 21 项加表清单的成本整个消失，风险面只有「新页面本身」。

### 批次规划（4 个会话，每个独立可提交）
- **Y1 规格定稿 + 派生层 + 单测** 【已完成】
- **Y2 页面骨架 + beat 0–5**（顶部条 / 年份与区间切换 / 滚动叙事容器 / 空态）
- **Y3 beat 6–10 + 长图 PNG 导出 + 打印样式**
- **Y4 移动端单列降级 + 命令面板 + 截图门槛 + 性能与包体实测 + 回填 SPEC**

用户已拍板三项：范围 = 年度收官报告（**先不做周维度**）；移动端 = **桌面优先**（同番茄钟 v1 策略）；存储 = 纯派生零新表。

### Y1 产出（2026-08-14）：规格 + 派生层（零 UI、零表改动）

`tsc -b` + oxlint + vitest **225 通过 / 12 文件**（既有 185 条**一行未改**仍全绿 ⇒ 回归护栏成立）。新增依赖 **0 个**，主包零增量（本批次不含任何 UI）。

**新增文件**：`docs/ANNUAL_SPEC.md`（九章：定位分工 / 非目标 / 派生层逐函数口径 / 界面 / 集成改动面 / 性能容量 / 测试清单 / 批次 / 已知局限）、`src/lib/derive/annual.ts`（13 个导出纯函数）、`src/lib/derive/annual.test.ts`（40 条）。**改动**：`src/lib/derive/index.ts` 加 barrel 导出（唯一改动的既有文件）。

**六处口径决策（都写进规格，Y2 起不再重新论证）**

1. **投入时长零重复实现**：`investedMsByGoal` 一律转调既有 `effectiveMsByGoalPrefix`。全年走年前缀、半年/季度按月前缀求和（**月份互斥 ⇒ ms 级求和精确**）。代价是 G×M 次全表扫（最坏 10 目标 × 6 月 = 60 次），**这是刻意的**：自己写一次遍历等于复制 `focus.ts` 的分桶逻辑，而 `effectiveMsByGoalByYear` 返回的是**已四舍五入的分钟**，`focus.ts` 明文禁止累加它。若 Y4 实测超 500ms，处方是给 `focus.ts` 加导出的 ms 版聚合，**不是**在年报里抄第二份。
2. **区间必须整月对齐**（`full/h1/h2/q1..q4`，**不做"月"**——那是月度复盘的地盘）。这不是偶然，它是第 1 条能复用 prefix 口径的前提，不得为了"自定义区间"破坏。
3. **裁与不裁的分界**：应打卡/完成率类统计裁到 `clippedEnd`（未来的应打卡日不算缺卡）；投入时长类**不裁**（记录不可能落在未来）。看未来年份时 `clippedEnd` 落在 `start` 之前 ⇒ `[start, clippedEnd]` 自然为空集，**全部统计归零且无需任何特例分支**。
4. **错配镜的 `plannedTaskDays` 按任务求和、不按日并集**：错配比的是「计划投入的力气」，同一天两个并行任务就是两份力气；按日并集会系统性低估多任务目标，**把结论说反**。这与完成率分母（并集）口径不同是故意的，靠界面措辞区分（必须叫「计划任务·日占比」，不得写成「应打卡天数占比」）。另设 `adhocOnly` / `noPlan` 两个逃生阀：全随缘目标 `plannedTaskDays` 天然为 0，不加标记就会被读成"严重错配"，而事实是它按设计不排期。
5. **最强/最弱月排除进行中的当月**（`eligible` = 该月自然末日 ≤ `clippedEnd`）：一个刚过 3 天的月份拿 100% 夺冠是假结论。可评选月份 < 2 个 ⇒ `bestWorstMonth` 返回 `null`，界面隐藏整个 beat（对比的价值全在两者之差）。
6. **节律画像：区间归属看 `date`、钟点与星期取 `startAt`**。`FocusSession.date` 允许被用户「改归相邻日」显式覆盖、与 `startAt` 永久不一致；而节律问的是「你几点在专注」，答案只能来自 `startAt`。`domain.ts` 禁止的是「从 `startAt` 重算 `date`」，不是「读 `startAt` 的钟点」。跨小时会话整段记在开始小时（v1 不分摊）。

**两条防漂移护栏（单测锁定，比读代码可靠）**
- `investedMsByGoal` 的年前缀结果 **=== 逐月前缀求和**（ms 级严格相等），且逐月取整后 **=== `minutesByGoalByMonth`** 对应值 ⇒ 年报与复盘页数字永不分叉。
- `longestRunOf(...).days` **=== `calcStreak(...).longest`**（全年区间下）⇒ 新写的"最长连续 + 起止 + 打断日"与 `streak.ts` 口径逐字一致，且 `streak.ts` 一行未改。

**一处实现期发现**：`streak.ts` 的 `calcStreak` 只给 `{current, longest}`，拿不到"最长那段在哪、被什么打断"——beat 5 的全部叙事价值都在后者。解法是在 `annual.ts` 里重走同一个 `expandScheduledDays` 并集 + `bestStatusByDate`，用上面那条相等断言锁死口径，而不是去改 `streak.ts`（它有 6 个消费者）。免打卡日不在应打卡并集里 ⇒ 天然不会被判为打断，故 `breakKind` v1 只有 `'missed'`。

**Y2 起注意**：页面**只调 `annualIndex` 一次**（一个 `useMemo`），禁止每个 beat 组件各自调派生扫全表；`/year` 必须走 `lazy()`（主包 gzip 增量目标 0）；**报告一个 recharts 都不引**（全仓唯一 import 点必须仍只有 `AnnualOverview.tsx`），图全部自绘 SVG，坐标系可借 `gantt/timeScale.ts`；唯一新令牌是 `--font-48`。

### Y2 产出（2026-08-14）：页面骨架 + beat 0–5

`tsc -b` + oxlint（0 warning）+ vitest **225 通过 / 12 文件**（派生层一行未改 ⇒ 全绿）。Playwright + 系统 Chrome 14 条断言全过。新增依赖 **0 个**。

**11 个 beat 的编号在这一批定稿**（规格只点名了 3/4/5/6/8/9，其余是本批按 `AnnualIndex` 字段补齐的，Y3 直接沿用）：
`0` 封面（区间进度）· `1` 投入（目标分布）· `2` 节奏（逐月合计完成率）· `3` 错配镜 · `4` 最强月 vs 最弱月 · `5` 最长连续 —— 以上 Y2 完成；
`6` 漂移排行 · `7` 里程碑 · `8` 停滞与放弃 · `9` 节律画像 · `10` 收尾 —— Y3。

**新增文件**：`src/annual/`（`constants.ts` 几何与阈值 / `annual.css` 揭示与打印 / `format.ts` 文案 / `Beat.tsx` 外壳+HeroNumber+ChartBox+LookButton / `useLocate.ts` / `AnnualTopBar.tsx` / `BeatCover` `BeatInvested` `BeatCadence` `BeatMismatch` `BeatBestWorst` `BeatStreak`）、`src/pages/YearReportPage.tsx`、`scripts/capture-annual.mjs`、`docs/screenshots/annual/*`（17 张）。
**改动既有文件 3 个**：`App.tsx`（NAV 加「年报」+ 一条 lazy 路由，移动 tab 4→5 格）、`tokens.css`（`+ --font-48`）、`lib/derive/index.ts`（**移除** annual 的 barrel 再导出，见下）。`actions.ts` / `store/*` / `db/*` / `gantt/*` / `review/*` / `checkin/*` / `pomodoro/*` **一行未改**。

**包体：主包 gzip 增量 0.2kB（≈0），annual 全落 lazy chunk**
实测 baseline `index` 619.44kB/gzip 190.42 → 现 619.97kB/gzip 190.63（+0.53/+0.21kB，就是 NAV 项与 lazy 路由本身）；`YearReportPage` chunk 30.67kB/gzip 10.30 + 0.37kB CSS。
⚠️ **过程中的真坑**：Y1 给 `lib/derive/index.ts` 加的 annual barrel 再导出，在 Y1 时被 tree-shake 掉了（baseline 主包里搜不到 `plannedTaskDays`），但 Y2 一旦有 lazy chunk 引用它，`annual.ts` 就同时被「主包里的 barrel」与「lazy chunk」引用 ⇒ Rolldown 只能把它提到共享的 index chunk，主包 **+6.4kB / gzip +2.2kB**。仅把 import 改成直连 `derive/annual` **无效**（barrel 那条引用边还在，chunk 哈希一字未变）。唯一解是**把 annual 从 barrel 移出**，代价是年报违反「派生统一走 barrel」的仓内惯例 —— 已在 `index.ts` 原地写明原因，避免将来被人「顺手修回去」。**Y3 加 beat 6–10 时不要再往 barrel 里加年报导出。**

**Y2 期间踩到并已固化的 4 条实现约束**
1. **揭示用 ref 对象，绝不用内联 ref 回调**：内联回调每次渲染换身份 ⇒ React detach/attach 一轮 ⇒ 回调里 `setState` 就是「Maximum update depth exceeded」。实测炸过一次，`Beat.tsx` 里已写死注释。
2. **截图不能用 `fullPage`，也不能整列一张**：滚动容器是 App 的 `<main>`（body 自身不滚），`fullPage` 只截视口那一屏；叙事列高 2300+px 时 `captureBeyondViewport` 会把 sticky 顶栏错位、并把视口外的 beat 截成**空白**（曾误判成「揭示失败」）。**逐 beat 截元素**是唯一可靠做法，正好对应规格 §7.3 的分组方式。
3. **验证脚本注入的会话是纯内存的**，任何 `page.goto` reload 都会丢；改主题/切区间走 SPA 内交互即可，不要 goto。新建 browser context = 独立 IndexedDB，得各自种一遍数据。
4. **SVG 的 `rx` 不接受 `var()`**（几何属性），故 `constants.ts` 里有 `SVG_RADIUS_SM = 4`，**必须与 `--radius-sm` 同值**。

**三处口径/文案取舍（Y3 沿用，不再重新论证）**
- **归档目标照常进年报**：年报是历史，`annualIndex` 的分母也含它们，从这一年抹掉会让百分比加不到 100。只有软删的才真正不算。（beat 8 的 `goalOutcomes` 排除归档，那是它自己的语义，不冲突。）
- **beat 1 的 hero、工作日折算、目标条三者同底**（都只含已归类到目标的投入）。初版把未归类混进折算，出现「103.7 小时 ≈ 13.7 个工作日」这种读者一算就发现对不上的数字；未归类改为只在脚注披露。
- **beat 4 的两种颜色只区分月份（accent / warning），不表达好坏**：被打断率是越低越好，把强月一律涂绿会在那一行说反话。语义色只留给真正有方向的量。
- beat 2 结论句在「一个月都没过 80%」时改说最高的那个月 ——「0 个月做到了 80%」是句废话。

**实测数字（dev server + 系统 Chrome，1440×1000）**：`/year` 首屏含 lazy chunk 载入 539–562ms。规格 §六 门槛是 <500ms，**但这是 dev 未压缩 + 冷加载 chunk 的读数，不是结论**；Y4 用生产构建 + 10 目标×8 任务×全年打卡×800 会话的压力数据正式复测，届时若真超，处方仍是给 `focus.ts` 加导出的 ms 版聚合（规格 §九-1），不是在年报里抄第二份分桶。

**Y3 起注意**：beat 6–10 的数据在 `AnnualIndex` 里已经齐了（`drift` / `milestones` / `outcomes` / `rhythm`），照样只读 props，不许新调派生；`annual.css` 里已备好 `@media print` 的揭示覆盖（没滚到的 beat 不会在长图里留白），Y3 补其余打印规则即可；导出长图必须用 Playwright + 系统 Chrome 验证（`html-to-image` 的 resolve 包在 rAF 里，本机浏览器面板 `document.hidden=true` 下永挂）。

### Y3 产出（2026-08-14）：beat 6–10 + 长图 PNG 导出 + 打印样式

`tsc -b` + oxlint（154 文件 0 diagnostics）+ vitest **225 通过 / 12 文件**（**派生层一行未改** ⇒ 全绿，年报仍是纯派生页）。Playwright + 系统 Chrome：Y3 脚本 22 条断言全过，Y2 脚本 14 条复跑仍全过。新增依赖 **0 个**。

**11 个 beat 全部就位**：`6` 计划漂移 · `7` 里程碑 · `8` 停滞与放弃 · `9` 节律画像 · `10` 收尾。

**新增文件**：`src/annual/BeatDrift / BeatMilestones / BeatOutcomes / BeatRhythm / BeatClosing.tsx`、`src/annual/exportLong.ts`、`scripts/capture-annual-y3.mjs`、`docs/screenshots/annual/annual-beat6–10-{light,dark}.png` + `annual-print-light.png` + `annual-export-thumb.png`。
**改动既有文件 5 个（全在年报域内）**：`annual/constants.ts`（beat 6/7/8/9 几何 + 导出三常量）、`annual/annual.css`（打印规则）、`annual/Beat.tsx`（`LookButton` 加 `data-annual-noprint`）、`annual/AnnualTopBar.tsx`（导出/打印按钮，<768px 隐藏）、`pages/YearReportPage.tsx`（挂 beat 6–10 + 导出/打印）。`actions.ts` / `store/*` / `db/*` / `gantt/*` / `review/*` / `checkin/*` / `pomodoro/*` / `lib/derive/*` **一行未改**。

**包体：主包 gzip 增量仍 ≈0**。实测 `index` 619.97kB/gzip 190.63（Y2）→ 620.00/190.65（+0.03/+0.02kB）；`YearReportPage` chunk 30.67/10.30 → 52.37/16.43，新增全部落在 lazy chunk。`html-to-image` 早已被甘特导出拉进主包，年报复用它 ⇒ 零新增。

**⚠️ Y3 最大的坑：交给 `html-to-image` 的节点自身不能是 `position:fixed` 的离屏节点，否则导出一张白板**
`toCanvas` 把节点连同计算样式塞进 SVG `<foreignObject>`，`left:-100000px` 在那个坐标系里照样生效 ⇒ 内容被推出画布，只剩背景色。**尺寸、文件大小、文件名全都对，只有像素是空的**——初版就这样过了三条断言，是肉眼看图才发现的。实测同一个 beat：直接截 fixed 舞台得 **0** 个非背景像素，套一层「外壳 fixed 离屏 + 内层 stage 静态」后得 **196741** 个。
⇒ 两条固化：`exportLong.ts` 的 `makeStage` 返回 `{host, stage}`（host 负责离屏，stage 负责被截）；验收脚本**必须把落盘的 PNG 送回浏览器解码数非背景像素**，尺寸/大小断言完全抓不到这个 bug。
🔴 **既有 `src/gantt/lib/exportPng.ts` 有同一个 bug**（实测导出 2880×1848、108kB、非背景像素 **0**）。Y3 的改动面禁止碰 `gantt/*`，故只记录不修；修法与上面同构（外壳 fixed，内层静态，`toCanvas(inner)`）。
✅ **已于「年报收尾补丁」修复并配了回归脚本**，见本文档末节。

**四处口径/实现取舍（Y4 沿用）**
- **beat 7 的兑现率分母只算「已到期」里程碑**（`date ≤ clippedEnd`）。复盘页的时间线把「过期未达成」和「还没到期」画成同一种未达成，于是「10 个达成 3 个」看着像一场失败，而真相可能是另外 6 个 11 月才到期。年报要说的就是这条分界，所以额外单列「过了日子仍未达成」并给出过期天数。
- **beat 8 是全篇唯一写库的一 beat**：`[归档]` → `window.confirm`（写明「数据一条不删」「Ctrl+Z 可撤销」）→ 既有 `patchGoal({archived:true})`，实测 undo 栈恰好 +1、撤销后回到原位。卡上必须印「最后一条记录 X，距今 N 天（已扣除免打卡区间）」——一个不能当场被人眼否掉的指控就是噪音。
- **beat 9 热力图只画有数据的小时跨度**（不足 8 格时向两侧补齐）：24 格铺满时通常一半是空的，会把有效格压成细条，反而读不出「哪个时段最强」。同时并排给「最强的 3 个时段」文字列表——热力图读趋势，具体数字要有一处能逐字读到（这一份也正好是 Y4 移动端降级要用的形态）。
- **beat 10 不再画第五张图**：收尾要的是一眼扫完，记分卡（6 格）+ 规则驱动的「接下来」就是它的图。每条建议都对应一个可读的判断式（静默目标 / 过期里程碑 / 未归类会话 / 无基线任务），**离线可用、不接任何在线模型**。

**打印（规格 §4.5）**
- 全部规则挂在 `body.annual-page` 作用域下（`YearReportPage` 挂载时加、卸载时摘）。不加作用域的话，这份 CSS 随 lazy chunk 常驻文档，用户看过年报再去打印甘特图会连顶栏一起被隐藏。
- **强制浅色用 `beforeprint` 临时改 `<html data-theme>`，不走 `updateSettings`**：走 store 会写库、进同步、连带别的标签页一起变深浅——一次打印不该有这些副作用。`afterprint` 还原（实测无残留）。用事件而非按钮内改，是为了 Ctrl+P 也走同一条路径。
- 顶栏/导航/`[data-annual-noprint]` 全隐藏，另有 `.annual-print-title` 打印专用行顶替被隐藏的顶部条（否则纸上读不到年份与区间）；App 的 `h-full + overflow-auto` 三层壳必须在 print 下解开，不然只印得出一屏。

**实测数字**：长图 1800 × 8654 实际像素（= 900 CSS px × scale 2，11 个 beat 单张未触 20000 CSS px 上限，分页逻辑按 beat 边界贪心，单个 beat 超限则独占一页）；`/year` dev 首屏 677ms（Y2 是 539–562ms，多了 5 个 beat；**dev 未压缩 + 冷加载 chunk，不是结论**，生产构建的正式复测仍在 Y4）。

**验收脚本的运行顺序**：先 `capture-annual.mjs`（Y2）再 `capture-annual-y3.mjs`（Y3）。两个脚本都会逐 beat 截图，但 Y3 脚本额外注入了「过期未达成的里程碑」与「一个静默目标」，beat 7/8 的有效截图只有它能产出。

**Y4 起注意**：移动端降级（beat 竖排单列 / hero 降 `--font-32` / 节律热力退化成已经写好的「最强 3 个时段」文字列表 / 导出与打印按钮 `<768px` 已隐藏）；命令面板加「打开年报」「导出年报长图」；性能与包体用**生产构建 + 压力数据**正式复测；回填 `docs/SPEC.md`。导出相关的任何改动，**必须用非背景像素数断言**，不能只看尺寸和文件大小。

### Y4 产出（2026-08-14）：移动端降级 + 命令面板 + 性能与包体正式复测 + 回填规格

`tsc -b` + oxlint（0 diagnostics）+ vitest **225 通过 / 12 文件**。Playwright + 系统 Chrome 三个脚本全过：Y2 14 条、Y3 27 条、**Y4 新增 20 条**，共 61 条。新增依赖 **0 个**。年报模块到此收尾。

**新增文件**：`src/annual/bus.ts`、`scripts/capture-annual-y4.mjs`（移动端 + 命令面板 + reduced-motion）、`scripts/perf-annual.mjs`（生产构建性能复测）、`scripts/gen-stress-backup.mjs`（压力数据生成器）、`docs/screenshots/annual/annual-mobile-{top-light,top-dark,mismatch,rhythm}.png`。
**改动既有文件 7 个**：`annual/{constants,annual.css,Beat.tsx,AnnualTopBar,BeatRhythm,BeatMismatch}`、`pages/YearReportPage.tsx`、`components/CommandPalette.tsx`、`lib/derive/annual.ts`（性能，见下）、`docs/ANNUAL_SPEC.md`。`store/*` / `db/*` / `gantt/*` / `review/*` / `checkin/*` / `pomodoro/*` / `lib/derive/` 的其余文件**一行未改**。

#### 🔴 Y4 最重要的一条：规格 §九-1 的性能预判是错的，实测推翻了它

Y1 起写在规格里的预判是「`investedMsByGoal` 的 G×M 次全表扫是瓶颈，超预算就给 `focus.ts` 加 ms 版聚合」。生产构建 + 压力数据下逐段实测的分布是：

| | 耗时 |
|---|---|
| `annualIndex` 总计 | 565ms |
| └ `monthProfiles` | **423ms** |
| └ `goalShares` | 41ms |
| └ `longestRunOf × G` | 33ms |
| └ **`investedMsByGoal`** | **0.7ms** ← 预判找错了人 |

真正的开销在 `monthlyGoalStats` 被调 `月 × 目标` 次（全年 = 120 次），**每次都把任务的应打卡日整段展开再筛本月**，而展开的内层是 `toDay(date).day()` 逐日 dayjs parse。一个跨 4 个月的任务在 12 个月里被完整展开 12 遍，8 遍颗粒无收、4 遍只有 1/4 有用。

**处方（已实施，全在 `annual.ts` 的 `monthProfiles` 里）**：不改口径，只**收窄喂进去的输入**。
1. 按目标预分桶 `tasks/checkIns/sessions` —— `monthlyGoalStats` 内部第一件事就是 `x.goalId !== goalId ⇒ continue`，先分桶等价。
2. 只传与本月有交集的任务，且**把任务裁到本月**（`startDate/endDate` 夹到月边界）。
   之所以逐字节等价：recurrence 全按星期几判定（`isScheduledDow`：daily/weekdays/custom/adhoc），**不以 `startDate` 为锚点**；免打卡也按日期判定。所以「整段展开再筛本月」与「只展开本月这一段」是同一个集合。**分桶与计分逻辑一行都没有被复制**（规格 §3.4 的「零重复实现」仍成立），225 条既有测试是护栏。

实测 `monthProfiles` 423 → **119ms**，`annualIndex` 565 → **280ms**，`/year` 首屏 ~870 → **282–342ms**。

**还剩的升级空间（不要顺手做）**：`expandScheduledDays` 的 `toDay(date).day()` 改成按 epoch 天数递推星期几（纯算术）能再快一个量级，且惠及甘特/打卡/复盘 —— 但那是 `scheduled.ts` 的改动，牵动 6 个消费者，应当单独成批配自己的回归。当前已在门槛内，不构成阻塞。

#### 性能与包体正式复测（规格 §六，全部达标）

| 指标 | 门槛 | 实测 |
|---|---|---|
| `/year` 首屏（生产构建 + 压力数据） | <500ms | **282 / 307 / 342ms**（三轮中位） |
| 主包 gzip 增量（相对 Y3） | 0 | **+0.19kB**（620.00→620.54kB，gzip 190.65→190.84） |
| 甘特首屏（对照组） | <1s | **275–360ms**，未回退 |
| 区间切换重算 | — | **72–87ms**（`annualIndex` 一次算完） |
| `YearReportPage` lazy chunk | — | 54.65kB / gzip 17.00 |

**复测方法学（这部分比数字更重要）**：
- **生产构建 + `vite preview`**，不是 dev server（Y2/Y3 那两次 539/677ms 是未压缩 dev 读数，从来不是结论）。
- 压力数据走 `scripts/gen-stress-backup.mjs`（确定性伪随机，同种子同数据：10 目标 / 80 任务 / 1587 打卡 / 800 会话）+ 产品自己的「导入 JSON 备份」落 IndexedDB。**不能用 `window.__store` 注入** —— 那个全局有 `import.meta.env.DEV` 守卫，生产构建里根本不存在。
- 计时基准取 `performance.timeOrigin`（导航开始）而非「脚本注入进页面的那一刻」：后者受 CDP 往返抖动影响，实测能差出几百毫秒，量的是驱动不是应用。
- 取三次**中位**不取最小值：min 会把「HTTP 缓存已热」的最好情况当结论。

#### 移动端降级（规格 §5.3）

规格点名的四条：竖排单列（本来就是）、hero `--font-48 → --font-32`、节律热力退化为「最强的 3 个时段」文字列表（这个形态 Y3 就已经在桌面版并排给出，不是为移动端新造）、错配镜双列镜像改上下堆叠。导出/打印按钮 <768px **零节点**（不是 `visibility:hidden`）。

**实现期补的三条（规格里没有，但少了就不满足「可读」，已回填 §5.3）**：
1. **宽图横滚，不等比压扁**。`CHART_W`(804) 等比缩到 343px 时 `--font-11` 轴标签只剩 4.6px —— 图还在但读不了。窄屏下 SVG 保持 `MOBILE_CHART_W`(720)、外层横滚。落在 `ChartBox` 一处，覆盖全部 7 张自绘图。
2. **顶部条的引导语窄屏隐藏**。整条顶部条 `sticky`，375×812 上年份带区间已吃掉约 150px，再加两行说明首屏就没了。那行是一次性引导，不是数据。
3. **hero 字号从内联 style 移到 `.annual-hero` 类**。内联 style 只能被 `!important` 盖过；把降档规则留在 CSS 里更干净。

⚠️ **断点三处同值**：`lib/useIsMobile.ts` 的 `QUERY`、`annual/constants.ts` 的 `MOBILE_MAX_W`、`annual.css` 的 `@media` —— CSS 读不到 TS 常量，只能靠注释锁住。

#### 命令面板（规格 §5.4，本批唯一新改的年报域外文件）

`打开年报` 直接 `navigate`。`导出年报长图` **不能直接 import `exportAnnualPng`** —— 命令面板在主包里，那样会把整个年报域拖进主包，「主包 gzip 增量 0」当场作废（Y2 已在 barrel 上踩过同型的坑）。走 `annual/bus.ts`：与 `gantt/bus.ts` 同构，**且必须保持零 import**。

不在年报页时用**闩锁**（命令面板置位 → 页面挂载时取走），不用 `setTimeout`：甘特那条 150ms 成立是因为 `GanttView` 在主包里；年报走 `lazy()`，chunk 何时落地取决于网络与磁盘，赌延时数字迟早会漏。

⚠️ **取闩锁的 effect 不能挂可清理的定时器**：StrictMode 下是 mount → cleanup → mount，第一次 mount 已把闩锁取走，若在 cleanup 里 `clearTimeout`，第二次 mount 再也找不到请求，**导出静默不发生**（实测踩到，Playwright 等下载等到超时）。用 `queueMicrotask` 且不回收。

#### 两条环境坑（Y4 新踩到，记下来省得下次再查）

1. **先确认 dev server 真的在你以为的端口上**。机器上已有一个 5173 的 dev server 时，`npx vite --port 5173` 会静默改用 5174，验证脚本连过去读的是**旧代码**——表现为「改了的东西查无此物」，极易误判成实现有 bug。跑脚本前先看一眼 `vite` 的启动日志。
2. **Playwright 的 `reducedMotion: 'reduce'` 会给全页元素强塞 `transition-duration: 1e-05s`**，所以断言不能量 `transitionDuration`（永远不是 `0s`）。`transition: none` 生效的可观测证据是 `transitionProperty === 'none'`。

#### 截图门槛（规格 §7.3）

`docs/screenshots/annual/` 共 33 张：11 beat × 深浅 22 张 + 空态 1 + 打印 1 + 导出长图缩略 1 + **移动端 4 张（首屏深浅 + 错配镜堆叠 + 节律文字列表）**。

#### 年报模块收尾状态

11 个 beat 全部就位，桌面 / 移动 / 打印 / 长图导出四条呈现路径都过实测。规格 §二 的六条非目标全部守住：零新表、零新依赖、零 recharts（全仓唯一 import 点仍只有 `AnnualOverview.tsx`）、零 LLM、零分享链接、零自动归档。规格 §九 的其余 5 条已知局限维持原状，留 P1。

---

## 年报收尾补丁 — 甘特图 PNG 导出修复 + 年报版式（2026-08-14）

两件事：修掉 Y3 只记录未修的那个 🔴，以及把年报页的版式从「卡片列表」调成叙事长图该有的样子。

### 一、`gantt/lib/exportPng.ts`：两个叠在一起的 bug

**Bug 1 — 白板**。与 Y3 记录的完全同型：`position:fixed; left:-100000px` 的舞台被直接交给 `toCanvas`，那条 `left` 在 `<foreignObject>` 坐标系里照样生效，内容被推出画布。修法照抄 `annual/exportLong.ts`：`host` 负责 fixed 离屏，`stage`（`position:relative`，给 `inner` 当定位祖先）负责被截。

**Bug 2 — 左侧网格整条消失**。这条是修完 Bug 1、肉眼看图才发现的：图有内容了，但左边的目标/任务列不见了。根因是原实现给克隆里的三个 sticky 元素（表头行 / 角块 / 左栏）**手工补了一层 `translate`**，理由写的是「克隆是静态快照，sticky 不生效」——**这个前提是错的**：`stage` 自带 `overflow:hidden` ⇒ 它就是克隆的滚动祖先，`scrollLeft/Top` 恒为 0，`inner` 把内容整体平移 `-scrollLeft/-scrollTop` 之后，sticky **自己**就把这三者吸回了 stage 的左/上边。再叠一层补偿等于把左栏往右推 `scrollLeft` 像素，推出了画面。删掉补偿即正确。

实测（1440×900，滚到 `scrollLeft 600 / scrollTop 164` 再导出）：

| | 非背景像素（前 3000 行） | 最左 600px 内 |
|---|---|---|
| 修复前 | **0** | 0 |
| 只修 Bug 1 | 2466191 | **0**（左栏丢失） |
| 两个都修 | 2401494 | **236743** |

**新增 `scripts/check-gantt-export.mjs`（6 条断言）**。这条功能此前**从来没被自动验过**，所以它坏了很久没人发现。三条设计要点：
1. **必须数非背景像素**——文件名/尺寸/体积三条断言对白板全部绿灯（修复前那张 108kB 的纯色 PNG 就是这么混过去的）。
2. **必须给左栏单独一条断言**。整图 240 万个像素里左栏只占 20 多万，左栏整条丢掉，总数那条断言纹丝不动。Bug 2 就是这么漏出去的。
3. **导出前必须先滚开两个方向**。`scrollLeft/Top` 都是 0 时，sticky 补偿对不对根本看不出来。

### 二、年报版式：四处「不留缝隙」

用户反馈「统计模块上下左右都不留缝隙」。复核后确认是实现问题，不是观感差异：

1. **页面列没有 `padding-top`**（`px-6 pb-16`，四个方向缺一个）。全仓其他四个页面都是 `p-6`，只有年报页漏了 —— 「年报」标题直接顶在 App 顶栏上。
   修法**不是给列加 `pt-6`**：那段留白会随滚动划走，sticky 条贴顶后又变回零间距。改成把 `pt-5` 挂在 sticky 条自身 ⇒ 初始态与贴顶态上边距一致。
2. **卡片间距(24) ≈ 卡片内边距(20)**。两者几乎相同时，11 个 beat 读起来是一列均匀格子，而不是规格 §4.3 要的「一屏一 beat」。改成 `PAGE_GAP = 40` / 卡片 `p-6`(24)，间距明显大于内边距才有节拍。`exportLong` 的 `STAGE_GAP` 直接引用 `PAGE_GAP`，长图节奏与屏幕一致。
3. **卡片内有两条左边缘**。序号 `01` 原来在流里占一列，把标题推进约 24px，而 hero 数字和图都从卡片内边距起画。改成序号与 eyebrow 同处第一行、标题独占第二行 ⇒ 标题/hero/图三者同一条左边缘。
4. **sticky 条的 `border-b` 比 App 顶栏的边短一截**，贴顶时两条不等长的横线并排看着是碎的。加 `-mx-6 px-6`（移动端 `-mx-4 px-4`）撑到列的 padding 外沿。

⚠️ **`CHART_W` 必须跟着卡片内边距走**：`PAGE_W(900) − 页面 padding(24×2) − 卡片 padding(24×2) = 804`（原 812 对应 `p-5`）。全部 7 张自绘图都从这个常量取宽，改一处即可；没有任何脚本或测试硬编码过 812。

### 验证

- `tsc --noEmit` + `oxlint` 干净；`vitest` **225 全绿**（版式改动不碰派生层）。
- Playwright + 系统 Chrome 四个脚本全过：`capture-annual`(14) + `capture-annual-y3`(22) + `capture-annual-y4`(25) + **新增 `check-gantt-export`(6)**。
- 截图 33 张已按新版式重生成。`/year` 首屏 283ms（门槛 <500ms，未回退）。

---

## 番茄钟小窗重做 —— 顶栏 / 图标控制 / 到点庆祝（2026-08-14）

用户反馈小窗「难看」。原版是「大数字 + 两行小字 + 三个文字按钮」的堆叠：信息层级平、按钮像表单控件、任务名把 260px 撑满，到点提醒更是「满色底 + 一句话 + 两个白胶囊」的系统 toast 长相。

先出静态设计预览（8 状态 × 深浅主题 → 到点庆祝六套深色配色 → 淡亮四套 + 全图标按钮），三轮确认后定稿 **L3 柔和渐层**，再动组件。**先给预览再改代码**这条在纯观感需求上省了大量返工。

### 一、运行态：`src/pomodoro/PipView.tsx` 重写

- **阶段文案进窗内自绘顶栏**。Chromium（Chrome/Edge 同内核）给 Document PiP 画的系统标题栏只显示站点来源，[WICG 规范](https://wicg.github.io/document-picture-in-picture/)没有给任何改写它的 API ⇒ 窗内 28px 顶栏才是阶段文案唯一可靠的出口。`document.title` 也写了一行（任务栏/Alt-Tab 有机会取），但**不承诺可见**。
- 顶栏右侧 `longBreakEvery` 颗段点（已完成实心 / 当前描边 / 未来空心），把「第 3/4 段」变成一眼可读的形；任务名与「丢弃」不再露出（丢弃仍在主面板）。
- 倒计时 32px → `--font-48`，中性色；颜色只走「状态点 + 主按钮 + 底部 3px 进度线」这一条线。
- 控制键全部图标化（手写内联 SVG，不引图标库）：播放/暂停/停止/跳过/杯子/叉，每颗带 `aria-label` + `title`。
- 底部进度线与倒计时**挤在同一个 `paint()` 里**，只改 `transform: scaleX()`，铁律不破（零 setState）。

### 二、到点庆祝

满底强调色换成**恒为淡亮的三段柔和渐层**（`--accent` → `--goal-6` → `--goal-7`，全部 `color-mix` 兑白；休息结束换 `--success` 打头）。内容从一句话补成「完成印章 + 刚点亮的段点 + 专注 X 分钟 + 今日累计」——庆祝得先有值得庆祝的事实。入场：环画出 → 勾落笔 → 文字浮起 → 一次性外扩光环。

`src/pomodoro/confetti.ts`（canvas 手写，不引库）三条反「库默认效果」的做法：每片是**会翻面的纸**（绕横轴翻转、正面亮背面暗一档、宽度随翻转角收缩）、**两侧礼花筒斜射**而非正中央炸开、颜色取自目标色令牌跟随主题。2.2 秒落尽即清空画布。

⚠️ **rAF 必须用小窗自己的 `window`**：主页面被最小化时它的 rAF 会被节流/冻结，而那时小窗恰恰是唯一可见的东西——用主窗 rAF 会让庆祝卡在半空。

### 三、两个真 bug（都是肉眼看图才发现的）

1. **`25:00` 残留在印章上**。运行态与庆祝态两棵树的根都是 `div`，React 复用了同一批 DOM 节点；而 hero 的文本是 ticker 经 ref **直写**的、React 不知情，复用后就留在了印章位置。修法：两个根给不同 `key` 强制卸载重挂（顺带让入场动效每次到点重播）。**凡是 ref 直写 DOM 的组件，分支切换必须给 key。**
2. **庆祝屏的已完成段点被洗成灰点**。`.pip-celebrate .pip-seg`(0,2,0) 权重高于 `.pip-seg--done`(0,1,0)，只覆写底色会连状态色一起吃掉。改动清单里三条必须一起写。

另修：待开始态的主按钮原本跟随阶段色（灰），看着像禁用——它是那屏唯一的行动号召，单独走 `--pip-action-color` 用 `accent`。

### 四、验证

- `tsc --noEmit` + `oxlint` 干净；`vitest` **225 全绿**；`npm run build` 通过。
- `scripts/check-pip.mjs` 五步全过（已改为按 `aria-label` 断言/点击，图标按钮没有 textContent）。
- **PiP 窗口在 Playwright 里就是 `context.pages()` 里的一个 page**（系统 Chrome 有头模式），可以直接 `setViewportSize({260,172})` + `screenshot` ——此前一直以为截不到，其实能截，这是这次能做视觉自查的关键。
- 截图 14 张：待开始/专注/暂停/短休息 × 深浅，外加庆祝态四张。
- **真实到点路径单独跑了一遍**（62 秒的一段，`≥MIN_SESSION_MS` 才落库）：到点显示「第 1 段完成 / 专注 1 分 / 今日 1 段 · 1 分」，`outcome: completed`，点杯子进短休息，进度线半程 `scaleX(0.484)`。短于 1 分钟的那条路径（不落库）回落到 `alert.text`，`check-pip.mjs` 覆盖。

---

## 桌面化 —— Electron 壳 + 小窗改原生窗口（2026-08-20）

用户想要「小窗能自由拉伸、不要地址栏」。先否掉了「把番茄钟拆成独立小应用」：番茄钟不是孤岛，`gantt/` `checkin/` `annual/` `lib/derive/focus.ts` 都直接读同一份 `focusSessions`，拆出去等于跨进程重造数据通道 + 复制一份领域模型，还会让计时数据与项目数据脱钩。改为**整个应用包成 Electron 桌面版**：业务代码基本不动，数据仍在同一个 IndexedDB，同步逻辑零改动。

网页版（GH Pages，手机在用）的 Document PiP 路径**一行没改**，所有分叉都在最前面按 `window.yearflowDesktop` 是否存在跳走。

### 一、核心难点：小窗的跨窗口桥

Document PiP 与主页面**同一个 JS realm**，所以旧实现是 `createPortal(<PipView/>, pipHost)`，`pipHost` 就是全部的跨窗口机制——零 IPC。原生窗口是独立 renderer，这条路直接没了。

**没有新造 IPC 镜像状态，而是复用了现成的多 tab 机制**：计时权威状态本来就在 localStorage（`running.ts`），跨上下文通知靠 `storage` 事件（`kernel.ts onStorage`），只有一个上下文响铃由 `navigator.locks` 选主保证。**在番茄钟眼里，小窗就是「另一个 tab」**，那套为多 tab 写的代码原样复用（`isLeader` / `leaderKnown` 门控一个没删——删了会重新打开双响铃、双 undo 的失败模式）。

⚠️ 动手前先做了 Phase 0 spike（`electron/spike/`，`npm run electron:spike`）验四项，全绿才继续：两个 `BrowserWindow` 之间 ① `storage` 事件互通 ② `navigator.locks` 真互斥 ③ 共享同一个 IndexedDB ④ 最小化下 20s 长 timer 漂移 **8ms**（`backgroundThrottling: false`）。这四条不成立的话整套设计就得推翻，所以它是门禁而不是练手。

**实测暴露出两处必须补广播的状态**（都是「只有 leader 那个窗口知道」）：

1. **`alert`（到点提醒）在内存 store 里** ⇒ 不广播的话到点时只有主窗变脸，小窗一片安静，而小窗恰恰是那时唯一可见的东西。新增 `ALERT_KEY`，`setAlert()` 成为唯一写入点（setState + 广播），`PipView` 的 dismiss / TTL 也走它 ⇒ 两个窗口一起收。
2. **刚落库的那条 `FocusSession`** ⇒ 落库发生在 leader 那侧，另一窗的内存 store 不知道，小窗的「今日 N 段」和结果卡永远差最后一段（自查里抓到的就是「今日 1 段」+ 泛用文案而不是「专注 1 分」）。新增 `COMMITTED_KEY` 广播整条记录，接收侧走 `applyRemote()`（入内存、不进 undo、不再落库）。广播整条而不是发「去重读 Dexie」的信号，是为了不和 `persist.ts` 的 500ms 防抖抢时序。

### 二、加载路径：用 `app://` 自定义协议，不用 `file://`

注册成 `standard + secure` 的协议 ⇒ 有真实 origin、是 secure context，于是一次性绕开三个坑：`App.tsx` 的 `BrowserRouter` 与 `import.meta.env.BASE_URL` 不用动、`index.html` 里 `/favicon.svg` 这类绝对路径继续有效、`vite.config.ts` 的 `base` 保持 `'/'`。协议处理器对无扩展名路径回退 `index.html`（SPA 深链接），并做了 `normalize` 后必须仍在 `dist` 内的目录穿越防护。`file://` 下这三条全废，且 `navigator.locks` 也没了——**桥的地基就没了**。

`ELECTRON=1` 时另外：关掉 VitePWA（service worker 在桌面壳里只添乱），`build.rollupOptions.input` 多一个 `pip.html` 入口。

### 三、原生化替换

- 小窗：**无边框 + 置顶 + 可拉伸**。保留 `PipView` 那条 28px 自绘顶栏（它本来就是为了绕开 PiP 系统标题栏改不了才存在的），补上无边框窗口缺的两件事——`-webkit-app-region: drag` 拖动层与关闭按钮，几何对齐 `PIP_TOPBAR_H`，`PipView` 视觉零改动。
- `confetti.ts` 几何改为**现量** `getBoundingClientRect()`，常量只作兜底。原先写死 `PIP_W/PIP_H`，窗口一拉伸礼花筒就跑到窗外、纸屑在半空消失。
- 通知走主进程原生通知（无网页权限层，`notifyPermission()` 恒 `granted`）；`sendTestNotification` 那三条「地址栏左侧站点设置」的浏览器文案换成 Windows 通知设置的指引。
- `catchUp()` 多一路触发源：`powerMonitor` 的 `resume`/`unlock-screen`。tab 冻结的理由在桌面端消失，但被 **OS 睡眠/锁屏**取代，`planRecovery` 那条补算路径照旧必要。
- `pipOpen` 取代 `pipHost` 作为「小窗开着吗」的判据（`pipHost` 只有 web 版有值）；用户从小窗自己的 × 关掉时靠主进程的 `pip:state` 广播回填。

### 四、验收

- `tsc -b`（含新增的 `electron/tsconfig.json` project）+ `oxlint` 干净；`vitest` **225 全绿**。
- `npm run desktop:e2e`（Playwright 的 Electron 驱动，跑 vite dev 以拿 DEV 观测句柄）**21 项全过**：小窗独立开出/可拉伸/置顶、主窗开始专注→小窗同步到同一 `sessionId`、暂停/继续双向跟随、三档拉伸尺寸正确、深浅主题跟随、**到点只写一条 `focusSession`**、小窗也看到那条记录且文案是「专注 1 分」、小窗自关后 `pipOpen` 回填。
- `npm run desktop:smoke`（**打包形态**，走 `app://`，e2e 那条 http://localhost 恰好绕开了协议注册）**17 项全过**：真实 origin、secure context、无 service worker、`BrowserRouter` 落 `/gantt`、`/settings` 上刷新不白屏、四档缩放 × 深浅主题 8 张甘特图均有内容、无 console error。
  ⚠️ 生产构建里**没有** `window.__store` / `window.__pomodoro`（`import.meta.env.DEV` 才挂），这个脚本一律走 UI 与 DOM。
- 8 张甘特图 + 小窗 7 张截图已人工过目（`screenshots/desktop/`）：窗控与自绘顶栏几何对齐、段点没被压住、200×132 到 640×200 版式都成立。

### 五、坑

- **打包前必须先停掉 vite dev server**。`electron-builder` 一直 `EPERM: rename win-unpacked.tmp → win-unpacked`，排查后是 vite 的文件监听占着那个**目录句柄**（目录内没有任何文件被锁，是目录本身）。杀掉 vite 进程后立刻能 rename。同一现象在沙箱里还会伪装成 `EXDEV: cross-device link not permitted`，更容易带错方向。
- **origin 变了 ⇒ localStorage 与 IndexedDB 都不继承**。桌面版第一次打开是空库（甘特图显示「还没有目标」），这是预期状态：用 `lib/backup.ts` 在网页版导出 JSON、桌面版设置页导入。未覆盖的 `yearflow-theme`、`yearflow:sync:*` 游标、`yearflow:pomodoro:*` 全部可再生。Supabase 需重新登录一次（无损，登出保留数据与游标）；账号是邮箱密码登录、无 OAuth ⇒ **没有回调 URL 问题**。

### 六、遗留：安装包尚未产出

`electronDist` 那条绕法让 `release/win-unpacked/` 顺利生成（275MB，解压步骤已不再被 SEP 干掉），但**NSIS / portable 安装包这一步还没跑完**，`release/` 下暂时只有 `win-unpacked`。压缩 275MB 叠加 SEP 扫描很慢，也有可能仍在被拦。

这不影响使用：`npm run electron:start` 已可正常跑桌面版，`release/win-unpacked/` 里的可执行文件也是完整应用（只是文件名还是 `electron.exe`，重命名与图标注入发生在打包后段）。下次接手就从 `npm run electron:pack` 继续，跑之前**先确认没有 vite dev server 在跑**。

### 七、首版明确未做

托盘图标、自动更新、代码签名、原生保存对话框（备份导出继续走 anchor 点击）、以及「把多 tab 机制简化掉」的重构。
