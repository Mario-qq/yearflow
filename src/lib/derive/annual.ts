/**
 * 年报派生（docs/ANNUAL_SPEC.md §三）：区间引擎 + 11 个 beat 的数据源。
 *
 * 三条贯穿本文件的铁律：
 * 1. **投入时长口径只有一套** —— 一律走 focus.ts 的 effectiveMsByGoalPrefix（max(手填, 番茄)
 *    在 (goal, task, date) 粒度取 max 再求和）。本文件不写任何自己的分桶/累加逻辑。
 *    POMODORO_SPEC 原话：「两套「投入」数字是可信度杀手」。
 * 2. **完成率/应打卡类统计必须裁到 clippedEnd**（未来的应打卡日不算缺卡）；
 *    **投入时长类不需要裁**（记录不可能落在未来），故走 monthPrefixes。
 * 3. 全程 ms，只在渲染那一行取整。
 */
import type {
  CheckIn,
  ExemptionPeriod,
  FocusSession,
  Goal,
  Milestone,
  Task,
} from '../../types/domain';
import { diffDays, eachDay, fmtDay, toDay } from '../date';
import { calcAutoProgress, expandScheduledDays, isExempt } from './scheduled';
import { bestStatusByDate } from './streak';
import { baselineDrift } from './baseline';
import { monthlyGoalStats } from './review';
import { effectiveMsByGoalPrefix, focusStats, isCountedSession, type FocusStats } from './focus';
import { aggregateTrackProgress } from './tracks';

const MS_PER_HOUR = 3_600_000;

// ────────────────────────────────── 区间 ──────────────────────────────────

export type RangeKind = 'full' | 'h1' | 'h2' | 'q1' | 'q2' | 'q3' | 'q4';

export interface AnnualRange {
  kind: RangeKind;
  year: number;
  /** 区间首日 */
  start: string;
  /** 区间末日（自然末日，不裁） */
  end: string;
  /** min(end, today)：应打卡/完成率类统计的右端 */
  clippedEnd: string;
  /** clippedEnd < end ⇒ 界面必须标注「统计截至 X 月 X 日」（规格 §4.1） */
  clipped: boolean;
  /** 区间覆盖的月份前缀 YYYY-MM。整月对齐是硬约定，是复用 prefix 口径的前提 */
  monthPrefixes: string[];
}

/** kind → 起止月（1-12，闭区间） */
const KIND_MONTHS: Record<RangeKind, [number, number]> = {
  full: [1, 12],
  h1: [1, 6],
  h2: [7, 12],
  q1: [1, 3],
  q2: [4, 6],
  q3: [7, 9],
  q4: [10, 12],
};

export function rangeOf(year: number, kind: RangeKind, today: string): AnnualRange {
  const [m0, m1] = KIND_MONTHS[kind];
  const start = fmtDay(toDay(`${year}-${String(m0).padStart(2, '0')}-01`));
  const end = fmtDay(toDay(`${year}-${String(m1).padStart(2, '0')}-01`).endOf('month'));

  // today < start（看未来年份/未来季度）⇒ clippedEnd 落在 start 之前，
  // 于是 [start, clippedEnd] 自然是空集，全部统计归零，无需任何特例分支。
  const clippedEnd = today < start ? fmtDay(toDay(start).subtract(1, 'day')) : today < end ? today : end;

  const monthPrefixes: string[] = [];
  for (let m = m0; m <= m1; m += 1) monthPrefixes.push(`${year}-${String(m).padStart(2, '0')}`);

  return { kind, year, start, end, clippedEnd, clipped: clippedEnd < end, monthPrefixes };
}

/** 区间的月份集合（判断某条记录是否落在区间内；≤12 个元素，就地构造足够便宜） */
function monthSetOf(range: AnnualRange): Set<string> {
  return new Set(range.monthPrefixes);
}

// ─────────────────────────────── 投入时长 ───────────────────────────────

/**
 * 区间内各目标投入毫秒。
 * full ⇒ 每目标一次年前缀扫；其它区间 ⇒ 每目标每月一次（月份互斥 ⇒ ms 级求和精确）。
 *
 * ⚠️ 已知代价（规格 §3.2 / §九-1）：G×M 次全表扫。不自己写一次遍历是刻意的 ——
 * 那等于复制 focus.ts 的分桶逻辑，是口径漂移的入口；而 effectiveMsByGoalByYear
 * 返回的是**已四舍五入的分钟**，focus.ts 明文禁止累加它。
 * 若实测超预算，处方是给 focus.ts 加一个导出的 ms 版聚合，不是在这里抄第二份。
 */
export function investedMsByGoal(
  checkIns: CheckIn[],
  sessions: FocusSession[],
  goalIds: string[],
  range: AnnualRange,
): Map<string, number> {
  const out = new Map<string, number>();
  const prefixes =
    range.kind === 'full' ? [`${range.year}-`] : range.monthPrefixes;
  for (const goalId of goalIds) {
    let ms = 0;
    for (const p of prefixes) ms += effectiveMsByGoalPrefix(checkIns, sessions, goalId, p);
    out.set(goalId, ms);
  }
  return out;
}

export interface InvestedTotals {
  byGoal: Map<string, number>;
  /** 各目标之和（不含未归类） */
  goalTotalMs: number;
  /** 未归类会话时长。hero 数字若静静吞掉它就是撒谎（复盘页已有同款披露） */
  unassignedMs: number;
  unassignedCount: number;
}

export function investedTotals(
  checkIns: CheckIn[],
  sessions: FocusSession[],
  goalIds: string[],
  range: AnnualRange,
): InvestedTotals {
  const byGoal = investedMsByGoal(checkIns, sessions, goalIds, range);
  let goalTotalMs = 0;
  for (const ms of byGoal.values()) goalTotalMs += ms;

  const months = monthSetOf(range);
  let unassignedMs = 0;
  let unassignedCount = 0;
  for (const s of sessions) {
    if (!isCountedSession(s) || s.goalId || !months.has(s.date.slice(0, 7))) continue;
    unassignedMs += s.focusMs;
    unassignedCount += 1;
  }
  return { byGoal, goalTotalMs, unassignedMs, unassignedCount };
}

/** X 毫秒 = 多少个 hoursPerDay 小时工作日。不取整，取整留给渲染层 */
export function equivalentWorkdays(ms: number, hoursPerDay = 8): number {
  if (hoursPerDay <= 0) return 0;
  return ms / (hoursPerDay * MS_PER_HOUR);
}

// ──────────────────────────── 错配镜（beat 3） ────────────────────────────

export interface GoalShare {
  goalId: string;
  /**
   * 计划任务·日数 = Σ over tasks |应打卡日 ∩ [start, clippedEnd]|。
   * ⚠️ 按任务求和、**不是按日并集**（规格 §3.3）：错配镜比的是「计划投入的力气」，
   * 同一天两个并行任务就是两份力气；按日并集会把它压成一份，系统性低估多任务目标，
   * 从而把结论说反。界面必须叫「计划任务·日占比」，不得写成「应打卡天数占比」。
   */
  plannedTaskDays: number;
  plannedShare: number;
  investedMs: number;
  investedShare: number;
  /** investedShare - plannedShare，正 = 实际投入超过计划权重 */
  gap: number;
  /** 区间内有任务、且全是随缘 ⇒ 天然无计划权重，不可判为「错配」 */
  adhocOnly: boolean;
  /** plannedTaskDays === 0：随缘、或区间内无排期。界面单列一组说明原因，不进错配排序 */
  noPlan: boolean;
}

function overlapsRange(t: Task, range: AnnualRange): boolean {
  return t.startDate <= range.end && t.endDate >= range.start;
}

export function goalShares(args: {
  goals: Goal[];
  tasks: Task[];
  exemptions: ExemptionPeriod[];
  checkIns: CheckIn[];
  sessions: FocusSession[];
  range: AnnualRange;
}): GoalShare[] {
  const { goals, tasks, exemptions, checkIns, sessions, range } = args;
  const activeGoals = goals.filter((g) => !g.deletedAt);
  const goalIds = activeGoals.map((g) => g.id);
  const invested = investedMsByGoal(checkIns, sessions, goalIds, range);

  const plannedByGoal = new Map<string, number>();
  const inRangeCount = new Map<string, number>();
  const adhocCount = new Map<string, number>();
  const goalIdSet = new Set(goalIds);

  for (const t of tasks) {
    if (t.deletedAt || !goalIdSet.has(t.goalId)) continue;
    if (!overlapsRange(t, range)) continue;
    inRangeCount.set(t.goalId, (inRangeCount.get(t.goalId) ?? 0) + 1);
    if (t.recurrence?.type === 'adhoc') adhocCount.set(t.goalId, (adhocCount.get(t.goalId) ?? 0) + 1);
    // expandScheduledDays 已把右端裁到 min(endDate, clippedEnd)，左端在这里裁
    let n = 0;
    for (const d of expandScheduledDays(t, exemptions, range.clippedEnd)) {
      if (d >= range.start) n += 1;
    }
    plannedByGoal.set(t.goalId, (plannedByGoal.get(t.goalId) ?? 0) + n);
  }

  let totalPlanned = 0;
  for (const n of plannedByGoal.values()) totalPlanned += n;
  let totalInvested = 0;
  for (const ms of invested.values()) totalInvested += ms;

  return activeGoals.map((g) => {
    const plannedTaskDays = plannedByGoal.get(g.id) ?? 0;
    const investedMs = invested.get(g.id) ?? 0;
    const plannedShare = totalPlanned > 0 ? plannedTaskDays / totalPlanned : 0;
    const investedShare = totalInvested > 0 ? investedMs / totalInvested : 0;
    const inRange = inRangeCount.get(g.id) ?? 0;
    return {
      goalId: g.id,
      plannedTaskDays,
      plannedShare,
      investedMs,
      investedShare,
      gap: investedShare - plannedShare,
      adhocOnly: inRange > 0 && (adhocCount.get(g.id) ?? 0) === inRange,
      noPlan: plannedTaskDays === 0,
    };
  });
}

// ───────────────────── 月度画像 / 最强最弱月（beat 4） ─────────────────────

export interface MonthProfile {
  month: string;
  /** 全目标合计完成率 0-100 = Σscore / Σscheduled；无应打卡返回 null */
  rate: number | null;
  scheduled: number;
  score: number;
  focus: FocusStats;
  /**
   * 是否可参与最强/最弱评选：该月自然末日 ≤ clippedEnd（即整月已过完）。
   * 排除进行中的当月 —— 一个刚过 3 天的月份拿 100% 夺冠是假结论。
   */
  eligible: boolean;
}

export function monthProfiles(args: {
  goals: Goal[];
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  sessions: FocusSession[];
  range: AnnualRange;
  today: string;
}): MonthProfile[] {
  const { goals, tasks, checkIns, exemptions, sessions, range, today } = args;
  const activeGoals = goals.filter((g) => !g.deletedAt);

  return range.monthPrefixes.map((month) => {
    let scheduled = 0;
    let score = 0;
    for (const g of activeGoals) {
      // 逐目标调既有 monthlyGoalStats：完成率口径零重复实现（规格 §3.4）
      const st = monthlyGoalStats({
        goalId: g.id,
        tasks,
        checkIns,
        exemptions,
        month,
        today,
        sessions,
      });
      scheduled += st.scheduled;
      score += st.score;
    }
    const monthEnd = fmtDay(toDay(`${month}-01`).endOf('month'));
    return {
      month,
      scheduled,
      score,
      // 合计率而非「各目标率的平均」：后者会让只有 1 天应打卡的目标与全月目标等权
      rate: scheduled > 0 ? Math.round((score / scheduled) * 100) : null,
      focus: focusStats(sessions, month),
      eligible: scheduled > 0 && monthEnd <= range.clippedEnd,
    };
  });
}

/** 最强/最弱月。少于 2 个可评选月份时返回 null（对比 beat 的价值全在两者之差） */
export function bestWorstMonth(
  profiles: MonthProfile[],
): { best: MonthProfile; worst: MonthProfile } | null {
  const pool = profiles.filter((p) => p.eligible && p.rate !== null);
  if (pool.length < 2) return null;
  let best = pool[0];
  let worst = pool[0];
  for (const p of pool) {
    const r = p.rate as number;
    if (r > (best.rate as number)) best = p;
    // 并列时取更早的月份（pool 已按月序），故用严格小于
    if (r < (worst.rate as number)) worst = p;
  }
  return best.month === worst.month ? null : { best, worst };
}

// ─────────────────── 最长连续与打断日（beat 5） ───────────────────

export interface LongestRun {
  goalId: string;
  from: string;
  to: string;
  days: number;
  /** 打断该段的那一天；跑到区间末仍未断则为 undefined */
  breakDate?: string;
  breakKind?: 'missed';
}

/**
 * 区间内该目标的最长连续段（含起止与打断日）。
 * 口径与 streak.ts calcStreak 逐字一致：done/partial 延续，skipped 不打断不计数，
 * missed 打断，今天未打不打断。单测锁定 days === calcStreak().longest（全年区间下）。
 *
 * 免打卡日不在应打卡并集里 ⇒ 天然不会被判为打断，故 breakKind v1 只有 'missed'。
 */
export function longestRunOf(args: {
  goalId: string;
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  today: string;
  range: AnnualRange;
}): LongestRun | null {
  const { goalId, tasks, checkIns, exemptions, today, range } = args;
  const dayset = new Set<string>();
  for (const t of tasks) {
    if (t.deletedAt || t.goalId !== goalId) continue;
    for (const d of expandScheduledDays(t, exemptions, today)) {
      if (d >= range.start && d <= range.clippedEnd) dayset.add(d);
    }
  }
  const days = [...dayset].sort();
  if (days.length === 0) return null;
  const statusByDate = bestStatusByDate(checkIns, goalId);

  let best: LongestRun | null = null;
  let runFrom: string | null = null;
  let runTo: string | null = null;
  let run = 0;

  const commit = (breakDate?: string): void => {
    if (run > 0 && runFrom && runTo && (!best || run > best.days)) {
      best = {
        goalId,
        from: runFrom,
        to: runTo,
        days: run,
        ...(breakDate ? { breakDate, breakKind: 'missed' as const } : {}),
      };
    }
  };

  for (const day of days) {
    const status = statusByDate.get(day);
    if (status === 'done' || status === 'partial') {
      if (run === 0) runFrom = day;
      runTo = day;
      run += 1;
    } else if (status === 'skipped') {
      continue; // 有意跳过：不打断不计数
    } else if (day < today) {
      commit(day); // missed 打断
      run = 0;
      runFrom = null;
      runTo = null;
    }
    // day === today 且未打卡：不打断，等今天的卡
  }
  commit();
  return best;
}

// ──────────────── 完成与放弃（beat 8） ────────────────

export type GoalOutcome = 'completed' | 'active' | 'stalled' | 'adhocOnly';

export interface GoalStatusCard {
  goalId: string;
  outcome: GoalOutcome;
  /** 打卡与会话里最晚的一天（不晚于 clippedEnd）；从无活动时 undefined */
  lastActivityDate?: string;
  /** 距 clippedEnd 的「非免打卡」天数 —— 出差/长假不算放弃 */
  idleDays: number;
  /** 目标下任务进度按跨度天数加权（复用 tracks.ts aggregateTrackProgress） */
  progressPct: number;
}

export const DEFAULT_STALL_DAYS = 30;

export function goalOutcomes(args: {
  goals: Goal[];
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  sessions: FocusSession[];
  range: AnnualRange;
  today: string;
  stallDays?: number;
}): GoalStatusCard[] {
  const {
    goals,
    tasks,
    checkIns,
    exemptions,
    sessions,
    range,
    today,
    stallDays = DEFAULT_STALL_DAYS,
  } = args;

  // 最后活动日：打卡与会话取并集里最晚的一天，且不晚于区间右端
  // （看往年年报时「距今」应当相对那一年的末尾，而不是真实今天）
  const lastByGoal = new Map<string, string>();
  const bump = (goalId: string | undefined, date: string): void => {
    if (!goalId || date > range.clippedEnd) return;
    const prev = lastByGoal.get(goalId);
    if (!prev || date > prev) lastByGoal.set(goalId, date);
  };
  for (const c of checkIns) {
    if (c.deletedAt) continue;
    bump(c.goalId, c.date);
  }
  for (const s of sessions) {
    if (!isCountedSession(s)) continue;
    bump(s.goalId, s.date);
  }

  const tasksByGoal = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.deletedAt) continue;
    const list = tasksByGoal.get(t.goalId);
    if (list) list.push(t);
    else tasksByGoal.set(t.goalId, [t]);
  }

  const cards: GoalStatusCard[] = [];
  for (const g of goals) {
    if (g.deletedAt || g.archived) continue;
    const own = tasksByGoal.get(g.id) ?? [];
    const progressPct = aggregateTrackProgress(own, (id) => {
      const t = own.find((x) => x.id === id);
      if (!t) return 0;
      return t.progressMode === 'auto'
        ? calcAutoProgress(t, checkIns, exemptions, today)
        : t.progress;
    });

    const lastActivityDate = lastByGoal.get(g.id);
    // 间隔只数「非免打卡」天：出差两个月不该被诬告成放弃
    let idleDays = 0;
    const gapFrom = lastActivityDate ?? fmtDay(toDay(range.start).subtract(1, 'day'));
    if (gapFrom < range.clippedEnd) {
      for (const d of eachDay(fmtDay(toDay(gapFrom).add(1, 'day')), range.clippedEnd)) {
        if (!isExempt(d, g.id, exemptions)) idleDays += 1;
      }
    }

    const unfinished = own.filter((t) => t.status !== 'done');
    let outcome: GoalOutcome;
    if (g.completedAt) outcome = 'completed';
    else if (own.length > 0 && unfinished.length === 0) outcome = 'completed';
    else if (unfinished.length > 0 && unfinished.every((t) => t.recurrence?.type === 'adhoc'))
      outcome = 'adhocOnly'; // 随缘契约：不催、不指责，只中性列出最后一次
    else if (idleDays > stallDays) outcome = 'stalled';
    else outcome = 'active';

    cards.push({
      goalId: g.id,
      outcome,
      ...(lastActivityDate ? { lastActivityDate } : {}),
      idleDays,
      progressPct,
    });
  }
  return cards;
}

// ──────────────── 漂移排行（beat 6） ────────────────

export interface DriftRow {
  taskId: string;
  goalId: string;
  name: string;
  /** 结束日相对基线的偏移天数（正 = 延后） */
  driftDays: number;
}

/**
 * 计划 vs 现实。区间过滤用自然 end（计划漂移是计划属性，与「今天」无关）。
 * totalDelayDays 只累加正值：「总共推迟了多少」问的是延后量，不与提前抵消。
 * noBaselineCount 必须暴露给界面 —— 否则「全年只推迟 3 天」会被误读成计划很准。
 */
export function driftRanking(
  tasks: Task[],
  range: AnnualRange,
): { rows: DriftRow[]; totalDelayDays: number; noBaselineCount: number } {
  const rows: DriftRow[] = [];
  let totalDelayDays = 0;
  let noBaselineCount = 0;

  for (const t of tasks) {
    if (t.deletedAt || !overlapsRange(t, range)) continue;
    const drift = baselineDrift(t);
    if (!drift) {
      noBaselineCount += 1;
      continue;
    }
    if (drift.endDriftDays > 0) {
      rows.push({ taskId: t.id, goalId: t.goalId, name: t.name, driftDays: drift.endDriftDays });
      totalDelayDays += drift.endDriftDays;
    }
  }
  rows.sort((a, b) => b.driftDays - a.driftDays || a.name.localeCompare(b.name));
  return { rows, totalDelayDays, noBaselineCount };
}

// ──────────────── 里程碑（beat 7） ────────────────

export interface MilestoneStats {
  total: number;
  achieved: number;
  /** 按日期升序，供时间线渲染 */
  rows: { id: string; goalId: string; name: string; date: string; achieved: boolean }[];
}

export function milestoneStats(milestones: Milestone[], range: AnnualRange): MilestoneStats {
  const rows = milestones
    .filter((m) => !m.deletedAt && m.date >= range.start && m.date <= range.end)
    .map((m) => ({
      id: m.id,
      goalId: m.goalId,
      name: m.name,
      date: m.date,
      achieved: m.achieved,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { total: rows.length, achieved: rows.filter((r) => r.achieved).length, rows };
}

// ──────────────── 节律画像（beat 9） ────────────────

export interface RhythmCell {
  /** 0=周日…6=周六 */
  dow: number;
  hour: number;
  ms: number;
  count: number;
  /** 提前停止段数 / 段数 */
  interruptedRate: number;
}

/**
 * 星期 × 小时的专注分布。
 * **区间归属看 s.date**（与全仓所有统计一致）；**钟点与星期取 startAt 的本地值**。
 * 为什么不从 date 反推星期：FocusSession.date 允许被用户「改归相邻日」显式覆盖，
 * 与 startAt 永久不一致；而节律问的是「你几点在专注」，答案只能来自 startAt。
 * domain.ts 禁止的是「从 startAt 重算 date」，不是「读 startAt 的钟点」。
 *
 * 一段跨小时的会话整段记在开始小时（v1 不做跨格分摊，规格 §3.8 / §九-2）。
 */
export function focusByHourDow(sessions: FocusSession[], range: AnnualRange): RhythmCell[] {
  const months = monthSetOf(range);
  const acc = new Map<string, { ms: number; count: number; stopped: number }>();
  for (const s of sessions) {
    if (!isCountedSession(s) || !months.has(s.date.slice(0, 7))) continue;
    const d = new Date(s.startAt);
    const key = `${d.getDay()}:${d.getHours()}`;
    let cell = acc.get(key);
    if (!cell) {
      cell = { ms: 0, count: 0, stopped: 0 };
      acc.set(key, cell);
    }
    cell.ms += s.focusMs;
    cell.count += 1;
    if (s.outcome === 'stopped') cell.stopped += 1;
  }
  const out: RhythmCell[] = [];
  for (const [key, cell] of acc) {
    const [dow, hour] = key.split(':').map(Number);
    out.push({
      dow,
      hour,
      ms: cell.ms,
      count: cell.count,
      interruptedRate: cell.count > 0 ? cell.stopped / cell.count : 0,
    });
  }
  out.sort((a, b) => a.dow - b.dow || a.hour - b.hour);
  return out;
}

// ──────────────── 一次算完 ────────────────

export interface AnnualIndex {
  range: AnnualRange;
  /** 区间内是否完全没有数据 ⇒ 整页空态（规格 §4.2） */
  empty: boolean;
  /** 封面：区间已过天数 / 总天数 */
  elapsedDays: number;
  totalDays: number;
  checkInCount: number;
  invested: InvestedTotals;
  shares: GoalShare[];
  months: MonthProfile[];
  bestWorst: { best: MonthProfile; worst: MonthProfile } | null;
  runs: LongestRun[];
  outcomes: GoalStatusCard[];
  drift: { rows: DriftRow[]; totalDelayDays: number; noBaselineCount: number };
  milestones: MilestoneStats;
  rhythm: RhythmCell[];
}

/**
 * 页面只调这一个函数一次（一个 useMemo）。
 * 禁止每个 beat 组件各自调派生扫全表（规格 §六 性能门槛）。
 */
export function annualIndex(args: {
  goals: Goal[];
  tasks: Task[];
  milestones: Milestone[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  sessions: FocusSession[];
  year: number;
  kind: RangeKind;
  today: string;
}): AnnualIndex {
  const { goals, tasks, milestones, checkIns, exemptions, sessions, year, kind, today } = args;
  const range = rangeOf(year, kind, today);
  const activeGoals = goals.filter((g) => !g.deletedAt);
  const months2 = monthSetOf(range);

  let checkInCount = 0;
  for (const c of checkIns) {
    if (!c.deletedAt && months2.has(c.date.slice(0, 7))) checkInCount += 1;
  }

  const invested = investedTotals(
    checkIns,
    sessions,
    activeGoals.map((g) => g.id),
    range,
  );
  const monthList = monthProfiles({ goals, tasks, checkIns, exemptions, sessions, range, today });
  const runs: LongestRun[] = [];
  for (const g of activeGoals) {
    const r = longestRunOf({ goalId: g.id, tasks, checkIns, exemptions, today, range });
    if (r) runs.push(r);
  }
  runs.sort((a, b) => b.days - a.days);

  const totalDays = diffDays(range.end, range.start) + 1;
  const elapsedDays = range.clippedEnd < range.start ? 0 : diffDays(range.clippedEnd, range.start) + 1;

  return {
    range,
    empty:
      checkInCount === 0 &&
      invested.goalTotalMs === 0 &&
      invested.unassignedMs === 0 &&
      !tasks.some((t) => !t.deletedAt && overlapsRange(t, range)),
    elapsedDays,
    totalDays,
    checkInCount,
    invested,
    shares: goalShares({ goals, tasks, exemptions, checkIns, sessions, range }),
    months: monthList,
    bestWorst: bestWorstMonth(monthList),
    runs,
    outcomes: goalOutcomes({
      goals,
      tasks,
      checkIns,
      exemptions,
      sessions,
      range,
      today,
    }),
    drift: driftRanking(tasks, range),
    milestones: milestoneStats(milestones, range),
    rhythm: focusByHourDow(sessions, range),
  };
}
