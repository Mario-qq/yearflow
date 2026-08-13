# ANNUAL_SPEC — 年报（年度收官报告）规格书 v1

> 本文档是 `docs/SPEC.md` 的扩展章节。与 `docs/SPEC.md` 冲突时，**在年报范围内以本文档为准**。
> 前置阅读：`CLAUDE.md` → `docs/PROGRESS.md` → 本文档。
> 番茄钟相关口径以 `docs/POMODORO_SPEC.md` 为准，本文档只消费它定下的 `effectiveMs` 口径，不重新定义。

---

## 一、定位与分工

`/year` = **一页读完一年的叙事长图**。11 个 beat，每个 beat = 一句话结论 + 一个 hero 数字 + 一张自绘图。

与既有页面的分工，必须守住：

| 页面 | 性质 | 回答的问题 |
|---|---|---|
| `/gantt` | 主战场 | 我的计划长什么样、现在做到哪 |
| `/checkin` | 高频入口 | 我今天做没做 |
| `/review` 月度复盘 | 仪表盘 | 这个月的数字是多少 |
| `/review` 年度总览 | 仪表盘 | 这一年的数字是多少 |
| **`/year` 年报** | **叙事** | **这一年到底发生了什么、我不知道的是什么** |

**年报存在的唯一理由**：说出别处没说的话。凡是 `AnnualOverview` 已经说清楚的（按月堆叠面积、任务完成数、里程碑时间线、基线偏移排行、投入总时长），年报要么不重复，要么换成叙事口吻并给出既有页面给不了的对比。

### 1.1 频次问题与它的解法（设计约束，不是可选项）

年度报告的天然缺陷是"一年只看一次"。v1 用两件事抵消，**两者都是硬要求**：

1. **默认渲染「截至今天」的本年**。8 月打开 = 年中体检，12 月打开 = 收官报告。一年 365 天都成立。凡是被"截至今天"裁过的数字，界面必须显式标注（见 §4.1）。
2. **区间可切**：`全年 / 上半年 / 下半年 / Q1 / Q2 / Q3 / Q4`。**明确不做"月"** —— 那是月度复盘的地盘。

所有区间都是**整月对齐**的。这条不是偶然，它是 §3.2 能零重复复用 `effectiveMsByGoalPrefix` 的前提，**不得为了"自定义区间"破坏它**。

---

## 二、非目标（明确不做，及原因）

| 不做 | 原因 |
|---|---|
| 月报 | 月度复盘已占这一档，重叠即冗余 |
| 改动 `AnnualOverview` / `ReviewPage` | 本模块纯新增；允许数据重叠但共用同一套派生，零漂移 |
| 新增表 / 新增实体字段 / 动同步 | 年报是**纯派生页**。零 SQL、零 Dexie 升版、零同步改动 |
| 引入 recharts | 全仓唯一 recharts import 点必须仍只有 `review/AnnualOverview.tsx`。年报图全部自绘 SVG |
| 引入任何新依赖 | 长图导出用已在 `package.json` 的 `html-to-image` |
| 接 LLM 生成总结文案 | 本地优先应用必须离线可用。结论句一律规则驱动纯函数 + UI 层文案模板 |
| 分享链接 / 公开页 | 单人工具。导出 PNG 与打印足够 |
| 自动归档 / 自动重排 | beat 8 只建议；归档必须人点 + confirm |
| 占用单字母快捷键 | 低频入口不值得占稀缺资源。命令面板 + 导航即可（`R` 经审计空闲，用户要才加） |
| 移动端长图导出与打印打磨 | v1 桌面优先（与番茄钟 v1 同策略）。移动端可进可读，见 §5.3 |
| 跨年对比（2025 vs 2026） | v1 不做，留 P1。年份切换已能逐年回看 |

---

## 三、派生层：`src/lib/derive/annual.ts`

全部纯函数 + `annual.test.ts`。**不入库、不进 store、不进 undo。**

### 3.1 区间

```ts
export type RangeKind = 'full' | 'h1' | 'h2' | 'q1' | 'q2' | 'q3' | 'q4';

export interface AnnualRange {
  kind: RangeKind;
  year: number;
  start: string;        // YYYY-MM-DD，区间首日
  end: string;          // YYYY-MM-DD，区间末日（自然末日，不裁）
  /** min(end, today)。所有"应打卡/完成率"类统计的右端 */
  clippedEnd: string;
  /** clippedEnd < end ⇒ 界面必须标注「统计截至 X 月 X 日」 */
  clipped: boolean;
  /** 区间覆盖的月份前缀，如 ['2026-01','2026-02','2026-03']。整月对齐是硬约定 */
  monthPrefixes: string[];
}

export function rangeOf(year: number, kind: RangeKind, today: string): AnnualRange;
```

口径：
- `start` / `end` 是自然区间边界（`full` = 01-01 ~ 12-31）。
- `clippedEnd = min(end, today)`；若 `today < start`（看未来年份）⇒ `clippedEnd = start` 的前一天语义用**空区间**表达：`clipped = true` 且所有统计为 0（界面走空态，见 §4.2）。
- **投入时长类统计不需要裁**（会话与打卡记录不可能出现在未来），故用 `monthPrefixes`；**应打卡/完成率/缺卡类统计必须裁**，故用 `clippedEnd`。这条区分是 §3.2 的核心。

### 3.2 投入时长：零重复复用既有口径

**唯一权威口径是 `focus.ts` 的 `effectiveMsByGoalPrefix`**：`max(手填分钟, 番茄 focusMs)` 在 `(goal, task, date)` 粒度取 max 再求和，全程 ms。

POMODORO_SPEC 的原话是「两套「投入」数字是可信度杀手」。因此年报**不新写任何累加逻辑**，而是：

```ts
/** 区间内各目标投入毫秒。full 走一次年前缀；半年/季度按月前缀求和（月份互斥 ⇒ 求和精确） */
export function investedMsByGoal(
  checkIns: CheckIn[],
  sessions: FocusSession[],
  goalIds: string[],
  range: AnnualRange,
): Map<string, number>;
```

实现方式与复杂度（**已知代价，写在这里免得将来被当成疏漏**）：
- `full` ⇒ 每目标一次 `effectiveMsByGoalPrefix(…, 'YYYY-')`，共 G 次全表扫。
- 其它区间 ⇒ 每目标每月一次，共 G×M 次（最坏 10 目标 × 6 月 = 60 次）。
- 为什么不自己写一次遍历：那等于复制 `bucketOf` 的分桶逻辑，是口径漂移的入口。`effectiveMsByGoalByYear` 虽然一次遍历算完 12 个月，但它**返回已四舍五入的分钟**，而 `focus.ts` 明文警告"绝不要累加这里已四舍五入的月值"。
- 实测门槛见 §6；若 Y4 实测超预算，正确的解法是给 `focus.ts` 加一个导出的 ms 版聚合（一处改动），**而不是**在年报里抄第二份分桶。

```ts
/** 区间内投入总毫秒（含未归类会话；未归类不进 goal 级，故要单独报） */
export function investedTotals(
  checkIns: CheckIn[], sessions: FocusSession[], goalIds: string[], range: AnnualRange,
): { byGoal: Map<string, number>; goalTotalMs: number; unassignedMs: number; unassignedCount: number };

/** X 毫秒 = 多少个 8 小时工作日（不取整，取整在渲染层） */
export function equivalentWorkdays(ms: number, hoursPerDay?: number): number;
```

`unassignedMs` 的存在是硬要求：复盘页已有「另有 N 段未归类（M 分）未计入」的先例，年报的 hero 数字若静静吞掉未归类会话，就是在撒谎。

### 3.3 错配镜（beat 3）—— 本模块最需要小心的口径

```ts
export interface GoalShare {
  goalId: string;
  /** 计划任务·日数（见下） */
  plannedTaskDays: number;
  plannedShare: number;   // 0..1，占全部目标之和
  investedMs: number;
  investedShare: number;  // 0..1
  /** plannedShare 与 investedShare 的差（正 = 实际投入超过计划权重） */
  gap: number;
  /** 该目标区间内是否只有随缘任务 ⇒ plannedShare 天然为 0，不可判为"错配" */
  adhocOnly: boolean;
}

export function goalShares(args: {
  goals: Goal[]; tasks: Task[]; exemptions: ExemptionPeriod[];
  checkIns: CheckIn[]; sessions: FocusSession[]; range: AnnualRange;
}): GoalShare[];
```

**`plannedTaskDays` 口径 = 按任务求和，不是按日并集。** 明确记下理由与代价：

- 取的是 `Σ over tasks |expandScheduledDays(task, exemptions, clippedEnd) ∩ [start, clippedEnd]|`。
- **为什么不用并集**：错配镜比的是"计划投入的力气"vs"实际花的时间"。一个目标当天有 2 个并行任务就是 2 份力气，按日并集会把它压成 1 份，从而系统性低估多任务目标的计划权重 —— 恰好会把结论说反。
- **为什么这不算"第二套数字"**：它回答的问题与完成率的分母不同（完成率问"有多少天该打卡"，权重问"排了多少任务·日"）。界面上必须叫「计划任务·日占比」，**不得写成"应打卡天数占比"**，否则与月度复盘的数字对不上就是我们自找的。
- 免打卡区间照常扣除（`expandScheduledDays` 内建）。

**`adhocOnly` 是必须存在的逃生阀**：随缘（adhoc）任务不产生应打卡日 ⇒ `plannedTaskDays = 0`。一个"全随缘"的目标会显示"计划 0% / 实际 30%"，若不加标记就会被读成"严重错配"，而事实是它按设计就不排期。这类目标在 beat 3 里**单列一组并标注「随缘任务不产生计划权重」**，不参与错配排序，也不计入 `plannedShare` 分母。

### 3.4 月度画像与最强/最弱月（beat 4）

```ts
export interface MonthProfile {
  month: string;          // YYYY-MM
  /** 全目标合计完成率 = Σ score / Σ scheduled；无应打卡返回 null */
  rate: number | null;
  scheduled: number;
  score: number;
  focus: FocusStats;      // 直接复用 focus.ts 的 focusStats(sessions, month)
}

export function monthProfiles(args: {...; range: AnnualRange}): MonthProfile[];
export function bestWorstMonth(profiles: MonthProfile[]): { best: MonthProfile; worst: MonthProfile } | null;
```

口径：
- 每月 `scheduled` / `score` 逐目标调既有 `monthlyGoalStats` 再求和（零重复实现）。
- `rate` 是**合计率**（Σscore/Σscheduled），不是"各目标率的平均"——后者会让只有 1 天应打卡的目标与全月目标等权。
- `bestWorstMonth` 只在 `rate !== null` 的月份里选；**跳过尚未到来的月份**（`month > today.slice(0,7)`）与应打卡为 0 的月份。全部为 null ⇒ 返回 `null`（界面隐藏整个 beat，不显示"最弱月 = 1 月"这种假结论）。
- `best === worst`（只有一个有效月）⇒ 返回 `null`，界面改成单月摘要。对比 beat 的价值全在"两者之差"，一个月没有差。
- 结论句用的是 `focus.avgMs` 与 `focus.interruptedRate` 之差 —— 这是全仓从未展示过的对比。

### 3.5 最长连续与打断日（beat 5）

`streak.ts` 的 `calcStreak` 只给 `{current, longest}`，不给"最长那段在哪、被什么打断"。年报需要后者，且**不修改 `streak.ts`**。

```ts
export interface LongestRun {
  goalId: string;
  from: string; to: string; days: number;
  /** 打断该段的那一天；至今未被打断（跑到区间末）时为 undefined */
  breakDate?: string;
  /** 打断原因：missed = 应打卡无记录 */
  breakKind?: 'missed';
}
export function longestRunOf(args: {
  goalId: string; tasks: Task[]; checkIns: CheckIn[]; exemptions: ExemptionPeriod[];
  today: string; range: AnnualRange;
}): LongestRun | null;
```

口径必须与 `calcStreak` **逐字一致**（done/partial 延续，skipped 不打断不计数，missed 打断，今天未打不打断），实现方式是重走同一个 `expandScheduledDays` 并集 + `bestStatusByDate`。
**单测锁定**：同一份数据下 `longestRunOf(...).days === calcStreak(...).longest`（区间为 full 时）。这条断言是防漂移的护栏，比读代码可靠。

免打卡日不在应打卡并集里 ⇒ 天然不会被判为打断（与既有语义一致），所以 `breakKind` v1 只有 `'missed'` 一种；保留字段形状供将来扩展。

### 3.6 停滞与放弃（beat 8）

```ts
export type GoalOutcome = 'completed' | 'active' | 'stalled' | 'adhocOnly';

export interface GoalStatusCard {
  goalId: string;
  outcome: GoalOutcome;
  lastActivityDate?: string;   // 打卡与会话里最晚的一天；从无活动时 undefined
  /** 距今的"非免打卡"天数 —— 出差/长假不算放弃 */
  idleDays: number;
  progressPct: number;         // 目标下任务进度按跨度天数加权
}
export function goalOutcomes(args: {...; today: string; stallDays?: number}): GoalStatusCard[];
```

判定顺序（有序链，第一条命中即止）：
1. `goal.completedAt` 存在 ⇒ `completed`
2. 该目标全部未删除任务都是 `status === 'done'` ⇒ `completed`（实际已完成，只是没手动标记）
3. 剩余未完成任务全是 `recurrence.type === 'adhoc'` ⇒ `adhocOnly`（**随缘契约：不催、不指责**，只中性列出「最后一次 X」）
4. `idleDays > stallDays`（默认 30）⇒ `stalled`
5. 否则 ⇒ `active`

- `archived === true` 或 `deletedAt` 的目标整个不进列表。
- `idleDays` = `lastActivityDate`（或区间起点）到 `today` 之间**不处于该目标免打卡区间**的天数。这条让"出差两个月"不会被诬告成放弃。
- 卡上必须显示 `lastActivityDate` 原文（「最后一条记录 5-12，距今 93 天」），让误判**可当场被人眼否掉**。一个不能申辩的指控就是噪音。
- 唯一写库动作 `[归档]` 走既有 `patchGoal({archived: true})`，confirm 写明后果，一条 undo。

### 3.7 漂移排行（beat 6）

```ts
export interface DriftRow { taskId: string; goalId: string; name: string; driftDays: number; }
export function driftRanking(tasks: Task[], range: AnnualRange): { rows: DriftRow[]; totalDelayDays: number };
```
- 逐任务调既有 `baselineDrift(task)`，取 `endDriftDays`（正 = 延后）。
- 只收 `driftDays > 0` 的行，降序；`totalDelayDays` = 这些正值之和（不与提前抵消——"总共推迟了多少"问的是延后量）。
- 区间过滤：任务的 `[startDate, endDate]` 与 `[range.start, range.end]` 有交集即计入（用自然 `end`，不用 `clippedEnd`：计划漂移是计划属性，与"今天"无关）。
- 无 `baseline` 的任务不计入，且界面要提示「N 个任务没有基线，未参与统计」——否则"全年只推迟 3 天"会被误读成计划很准。

### 3.8 节律画像（beat 9）

```ts
export interface RhythmCell { dow: number; hour: number; ms: number; count: number; interruptedRate: number; }
export function focusByHourDow(sessions: FocusSession[], range: AnnualRange): RhythmCell[];
```
- **区间归属看 `s.date`**（与全仓所有统计一致）；**小时与星期取 `startAt` 的本地值**。
- 为什么不用 `date` 反推星期：`FocusSession.date` 允许被用户经结果卡「改归相邻日」显式覆盖，与 `startAt` 永久不一致；而节律问的是"你几点在专注"，答案只能来自 `startAt`。domain.ts 禁止的是"从 startAt 重算 date"，不是"读 startAt 的钟点"。
- 一段跨小时的会话**整段记在开始小时**（v1 不做跨格分摊）。理由：分摊需要按暂停切段，收益（格子更平滑）远小于复杂度，且"你几点开始专注"本身就是要看的信号。这条写进界面 tooltip 说明。
- `isCountedSession` 过滤（软删与 `discarded` 不算），与全仓一致。

### 3.9 一次算完：`annualIndex`

```ts
export function annualIndex(args: {
  goals: Goal[]; tasks: Task[]; milestones: Milestone[]; checkIns: CheckIn[];
  exemptions: ExemptionPeriod[]; sessions: FocusSession[];
  year: number; kind: RangeKind; today: string;
}): AnnualIndex;
```
页面**只调这一个函数一次**（一个 `useMemo`），产出全部 11 个 beat 需要的数据。禁止每个 beat 组件各自调派生扫全表。

---

## 四、界面规格

### 4.1 顶部条与"截至今天"标注

`2026 ▾` · `全年 | 上半年 | 下半年 | Q1 Q2 Q3 Q4` · `导出长图` · `打印`

- 年份下拉 = **有数据的年份 ∪ 当年**（数据 = 任一 checkIn/session/task 落在该年）。
- `range.clipped === true` 时，顶部条右侧常驻一行灰字「**统计截至 8 月 14 日**」。缺了它，"全年完成率 62%"会被读成"这一年只做到 62%"，而真相是年还没过完。这是可信度问题，不是装饰。

### 4.2 空态

- 该年该区间零数据 ⇒ 整页空态：「2025 没有记录」+ 可点的年份建议。**不许白屏、不许显示一堆 0**。
- 单个 beat 无数据 ⇒ 该 beat 整块隐藏（不留空壳标题）。`bestWorstMonth` 返回 null、`longestRunOf` 返回 null、无基线任务时的 beat 6 都走这条。

### 4.3 视觉

SPEC §八 明令「绝不做花哨仪表盘风」。年报的观感来自**排版与留白**：

- 一屏一 beat：巨号数字 + 一句结论 + 一张图，大量留白。
- 图全部自绘 SVG。坐标系可借 `gantt/timeScale.ts`（纯函数）。
- **新增唯一令牌 `--font-48`**（现阶封顶 `--font-32`，是番茄钟 hero 加的）。几何常量落 `src/annual/constants.ts`，禁散落魔数。
- 数字一律 `.tnum`；卡片 `--bg-raised` + `--border-default` + `--radius-lg`；目标色只用 `--goal-N` 令牌；语义色 `--success/--warning/--danger`。
- 深浅主题一等公民，两套都过截图门槛。
- 动效：滚动进入一次性淡入 + 数字滚动（叙事页的渐进揭示是功能性的），用 `--ease`；**`prefers-reduced-motion` 下静态直出**。
- 文案简体中文、动词开头；**结论允许直白，不许说教**（「它已经静默 93 天」可以，「你应该更自律」不行）。

### 4.4 回流甘特图

每条可定位的结论带 `[看一眼]`，复用既有事件通道 `gantt/bus.ts`：`locate-task`（任务）/ `scroll-to-date`（日期）。跨页需先 `navigate('/gantt')` 再延时 emit —— 沿用 `CommandPalette` 已验证的 `gotoGantt()` 模式（150ms），不另发明。

### 4.5 导出长图与打印

- 宽度固定 **900 CSS px**、`scale 2`、总高**硬上限 20000 px**（1800×20000 = 36M px，安全）。超出则按 beat 分页导出多张并 toast 说明。
- PROGRESS 已记载：`html-to-image` 的 resolve 包在 rAF 里 ⇒ **本机浏览器面板（`document.hidden=true`）下导出永挂**。导出路径**必须用 Playwright + 系统 Chrome 验证**（`channel:'chrome'`）。
- 打印走 `@media print`：隐藏顶栏/导航/按钮，beat 分页 `break-inside: avoid`，强制浅色。

---

## 五、集成与改动面

| 文件 | 改动 |
|---|---|
| `src/lib/derive/annual.ts` + `annual.test.ts` | 新增 |
| `src/lib/derive/index.ts` | 加导出（barrel） |
| `src/annual/*`（constants + 11 个 beat 组件 + 导出/打印） | 新增 |
| `src/pages/YearReportPage.tsx` | 新增 |
| `src/App.tsx` | `NAV` 加「年报」+ 一条 `lazy()` 路由 |
| `src/styles/tokens.css` | `+ --font-48` |
| `src/components/CommandPalette.tsx` | 加「打开年报」「导出年报长图」 |

`actions.ts` / `store/*` / `db/*` / `gantt/*` / `review/*` / `checkin/*` / `pomodoro/*` **一行不改**。

- 导航顺序：甘特图 / 打卡 / 复盘 / **年报** / 设置。移动 tab 4 格 → 5 格（每格 20%，高度仍 ≥44px）。
- `/year` 走 `lazy()` ⇒ **主包 gzip 增量目标 0**，甘特首屏 <1s 结构上不受影响。

### 5.3 移动端（v1 桌面优先）

可进、可读：beat 竖排单列、hero 巨字降一档（`--font-32`）、节律热力退化为「你最强的三个时段」文字列表、错配镜双列改上下堆叠。**长图导出与打印按钮在 <768px 隐藏**（不打磨、不假装可用）。

---

## 六、性能与容量

| 指标 | 门槛 |
|---|---|
| 报告页首屏（10 目标 × 8 任务 × 全年打卡 + 800 段会话） | **<500ms** |
| 主包 gzip 增量 | **0**（lazy 路由） |
| 甘特首屏 / 缩放 / 拖拽 | 不得回退（<1s / <150ms / 60fps），实测一次作对照组 |
| `annualIndex` 调用次数 | 每次渲染 **1 次**（一个 useMemo） |

`investedMsByGoal` 的 G×M 次全表扫是已知代价（§3.2）。Y4 实测若超 500ms，处方是给 `focus.ts` 加导出的 ms 版聚合，**不是**在年报里复制分桶逻辑。

---

## 七、测试清单

### 7.1 vitest（`annual.test.ts`）

- `rangeOf`：7 种 kind 的边界；`clipped` 与 `clippedEnd`；看未来年份 ⇒ 空区间；`monthPrefixes` 整月对齐
- `investedMsByGoal`：**口径交叉断言** —— `full` 的年前缀结果 === 逐月前缀求和（ms 级严格相等）；且逐月取整后 === `minutesByGoalByMonth` 对应值
- `investedTotals`：未归类会话进 `unassignedMs` 且不进任何 goal
- `goalShares`：多任务目标的 `plannedTaskDays` 按任务求和（不被并集压扁）；免打卡区间扣除；`adhocOnly` 目标 `plannedShare = 0` 且不进分母
- `monthProfiles` / `bestWorstMonth`：合计率而非平均率；跳过未来月与零应打卡月；全 null ⇒ null；只有一个有效月 ⇒ null
- `longestRunOf`：**与 `calcStreak().longest` 相等**（防漂移护栏）；skipped 不打断不计数；missed 打断并记 `breakDate`；跑到区间末 ⇒ 无 `breakDate`
- `goalOutcomes`：五条判定链逐条；`idleDays` 扣免打卡日；`adhocOnly` 不打 stalled；archived/deleted 不进列表
- `driftRanking`：只收正漂移、降序、`totalDelayDays` 不与提前抵消；无 baseline 任务不计入
- `focusByHourDow`：区间按 `date`、钟点按 `startAt`；`date` 被显式改过时钟点不受影响；`discarded`/软删不计
- `equivalentWorkdays`
- **既有 185 条测试一行不改仍全绿**（回归护栏）

### 7.2 Playwright + 系统 Chrome

- 11 个 beat 的关键文案与数字断言；年份/区间切换后数字联动；`clipped` 标注出现
- `[看一眼]` 跳甘特并闪烁定位；`[归档]` confirm 文案 + undo 栈恰好 +1
- 长图导出真实落盘且尺寸符合 §4.5；打印样式快照
- `prefers-reduced-motion` 下无动效
- 空态（切到无数据年份）
- 移动端 375×812：单列、导出按钮零节点

### 7.3 截图门槛 → `docs/screenshots/annual/`

11 beat 分组拼 8~10 张 × 深浅 + 空态 1 张 + 导出长图缩略 1 张 + 移动端 2 张。

---

## 八、批次

| | 内容 |
|---|---|
| **Y1** | 本规格 + `derive/annual.ts` + `annual.test.ts`（零 UI、零表改动） |
| **Y2** | 页面骨架（顶部条 / 年份与区间切换 / 滚动叙事容器 / 空态）+ beat 0–5 |
| **Y3** | beat 6–10 + 长图 PNG 导出 + 打印样式 |
| **Y4** | 移动端单列降级 + 命令面板 + 截图门槛 + 性能与包体实测 + 回填 SPEC/PROGRESS |

每批结尾：`tsc -b` + oxlint + vitest 全绿 → Playwright 实测 → git commit → 更新 `docs/PROGRESS.md`。

---

## 九、已知局限与升级路径

1. **`investedMsByGoal` 的 G×M 次全表扫**：见 §3.2 与 §6。升级 = `focus.ts` 加导出 ms 版聚合。
2. **节律画像不做跨小时分摊**：一段整记在开始小时（§3.8）。升级 = 按暂停切段后分摊到格。
3. **`plannedTaskDays` 与完成率分母口径不同**：故意的（§3.3），靠界面措辞区分。若将来觉得混乱，正确做法是在界面上并列展示两者，而不是把权重改成并集（会把结论说反）。
4. **无基线任务不参与漂移统计**：靠界面提示补齐（§3.7）。升级 = 顶栏「保存基线」的引导。
5. **不做跨年对比**：留 P1。
6. **beat 8 的停滞阈值固定 30 天**：不做成设置项（settings 不同步，且多一个旋钮不如一个可申辩的展示）。
