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
- **打卡口径**：目标级一天一条有效记录（同日多条取最强 done>partial>skipped）；upsert 原位更新保 id/createdAt；再点同状态=删除记录（toggle-off）
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
