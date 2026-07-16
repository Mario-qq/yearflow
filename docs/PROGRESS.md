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
## Phase 3 — 交互与编辑 【未开始】
## Phase 4 — 打卡与复盘 【未开始】
## Phase 5 — 云同步与部署 【未开始，等 Supabase 凭据】
