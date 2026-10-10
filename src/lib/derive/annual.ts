/**
 * 年报派生（docs/ANNUAL_SPEC.md §三）：区间引擎 + 封面与四节的全部数据。
 *
 * 三条贯穿本文件的铁律：
 * 1. **投入时长口径只有一套** —— 一律走 focus.ts 的 effectiveMsByGoalPrefix（max(手填, 番茄)
 *    在 (goal, task, date) 粒度取 max 再求和）。本文件不写任何自己的时长分桶/累加逻辑。
 * 2. **完成率/应打卡类统计必须裁到 clippedEnd**（未来的应打卡日不算缺卡）；
 *    投入时长类不需要裁（记录不可能落在未来），故按月前缀走。
 * 3. 全程 ms，只在渲染那一行取整。
 *
 * ⚠️ 本文件**不进 lib/derive 的 barrel**：barrel 被主包引用，经它导出会把年报派生拖进
 * 共享 chunk（Y2 实测主包 gzip +2.2kB）。年报页直连 `derive/annual`。
 */
import type {
  CheckIn,
  CheckInStatus,
  ExemptionPeriod,
  FocusSession,
  Goal,
  Milestone,
  MonthlyReview,
  Task,
} from '../../types/domain';
import { diffDays, eachDay, fmtDay, toDay } from '../date';
import { calcAutoProgress, expandScheduledDays, isExempt } from './scheduled';
import { bestStatusByDate } from './streak';
import { monthlyGoalStats } from './review';
import { effectiveMsByGoalPrefix, isCountedSession } from './focus';
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
  /** clippedEnd < end ⇒ 界面标注「统计截至 X 月 X 日」 */
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

  // today < start（看未来区间）⇒ clippedEnd 落在 start 之前，[start, clippedEnd] 自然是空集，
  // 全部统计归零，无需任何特例分支。
  const clippedEnd = today < start ? fmtDay(toDay(start).subtract(1, 'day')) : today < end ? today : end;

  const monthPrefixes: string[] = [];
  for (let m = m0; m <= m1; m += 1) monthPrefixes.push(`${year}-${String(m).padStart(2, '0')}`);

  return { kind, year, start, end, clippedEnd, clipped: clippedEnd < end, monthPrefixes };
}

function inMonths(date: string, months: Set<string>): boolean {
  return months.has(date.slice(0, 7));
}

// ─────────────────────────────── 投入时长（§01） ───────────────────────────────

export interface GoalInvest {
  goalId: string;
  ms: number;
  /** 占「全部投入（含未归类）」的比例 0..1 */
  share: number;
  /** 与 range.monthPrefixes 对齐的逐月毫秒 */
  byMonth: number[];
}

export interface Invested {
  /** ms > 0 的目标，按 ms 降序 */
  goals: GoalInvest[];
  goalTotalMs: number;
  /** 未归类会话。hero 数字若静静吞掉它就是撒谎，界面单列一段灰色 */
  unassignedMs: number;
  unassignedByMonth: number[];
  /** goalTotalMs + unassignedMs */
  totalMs: number;
}

/**
 * 逐目标逐月调 effectiveMsByGoalPrefix（月份互斥 ⇒ ms 级求和精确，单测锁定
 * 「逐月之和 === 年前缀」）。G×M 次扫表是刻意的：自己写一次遍历等于复制 focus.ts 的分桶。
 */
export function investedOf(
  checkIns: CheckIn[],
  sessions: FocusSession[],
  goalIds: string[],
  range: AnnualRange,
): Invested {
  const rows: GoalInvest[] = [];
  let goalTotalMs = 0;
  for (const goalId of goalIds) {
    const byMonth = range.monthPrefixes.map((p) => effectiveMsByGoalPrefix(checkIns, sessions, goalId, p));
    const ms = byMonth.reduce((a, b) => a + b, 0);
    goalTotalMs += ms;
    if (ms > 0) rows.push({ goalId, ms, share: 0, byMonth });
  }

  const monthIdx = new Map(range.monthPrefixes.map((p, i) => [p, i]));
  const unassignedByMonth = range.monthPrefixes.map(() => 0);
  let unassignedMs = 0;
  for (const s of sessions) {
    if (!isCountedSession(s) || s.goalId) continue;
    const i = monthIdx.get(s.date.slice(0, 7));
    if (i === undefined) continue;
    unassignedByMonth[i] += s.focusMs;
    unassignedMs += s.focusMs;
  }

  const totalMs = goalTotalMs + unassignedMs;
  for (const r of rows) r.share = totalMs > 0 ? r.ms / totalMs : 0;
  rows.sort((a, b) => b.ms - a.ms);
  return { goals: rows, goalTotalMs, unassignedMs, unassignedByMonth, totalMs };
}

// ───────────────────────────── 逐日活动（封面年轮 + §02 热力） ─────────────────────────────

export interface DayCell {
  date: string;
  /** 打卡分：各目标当日最强记录 done=1、partial=0.5 求和（与复盘页热力图 dailyActivityScores 同口径） */
  score: number;
  /** 当日计入的专注毫秒（含未归类） */
  focusMs: number;
  /**
   * 当日「主角」目标：权重 = 打卡分 + 专注小时，取最大者（并列取先出现的目标顺序）。
   * 只用于给年轮上色，不参与任何数字。
   */
  topGoalId?: string;
  /** date > clippedEnd：还没到的日子，界面画成虚的 */
  future: boolean;
}

const STATUS_W: Record<CheckInStatus, number> = { done: 1, partial: 0.5, skipped: 0 };
const STATUS_RANK: Record<CheckInStatus, number> = { done: 3, partial: 2, skipped: 1 };

export function dailyCells(
  checkIns: CheckIn[],
  sessions: FocusSession[],
  goalIds: string[],
  range: AnnualRange,
): DayCell[] {
  const goalSet = new Set(goalIds);
  // (goal|date) → 最强状态：同日多条只算一次，与 streak/review 口径一致
  const best = new Map<string, CheckInStatus>();
  for (const c of checkIns) {
    if (c.deletedAt || !goalSet.has(c.goalId) || c.date < range.start || c.date > range.end) continue;
    const key = `${c.goalId}|${c.date}`;
    const prev = best.get(key);
    if (!prev || STATUS_RANK[c.status] > STATUS_RANK[prev]) best.set(key, c.status);
  }

  const scoreByDate = new Map<string, number>();
  const focusByDate = new Map<string, number>();
  // date → goalId → 权重
  const weight = new Map<string, Map<string, number>>();
  const addW = (date: string, goalId: string, w: number): void => {
    if (w <= 0) return;
    let m = weight.get(date);
    if (!m) weight.set(date, (m = new Map()));
    m.set(goalId, (m.get(goalId) ?? 0) + w);
  };

  for (const [key, status] of best) {
    const w = STATUS_W[status];
    if (w === 0) continue;
    const bar = key.indexOf('|');
    const goalId = key.slice(0, bar);
    const date = key.slice(bar + 1);
    scoreByDate.set(date, (scoreByDate.get(date) ?? 0) + w);
    addW(date, goalId, w);
  }
  for (const s of sessions) {
    if (!isCountedSession(s) || s.date < range.start || s.date > range.end) continue;
    focusByDate.set(s.date, (focusByDate.get(s.date) ?? 0) + s.focusMs);
    if (s.goalId && goalSet.has(s.goalId)) addW(s.date, s.goalId, s.focusMs / MS_PER_HOUR);
  }

  const order = new Map(goalIds.map((id, i) => [id, i]));
  const out: DayCell[] = [];
  for (const date of eachDay(range.start, range.end)) {
    let topGoalId: string | undefined;
    let topW = 0;
    const m = weight.get(date);
    if (m) {
      for (const [goalId, w] of m) {
        if (w > topW || (w === topW && topGoalId && order.get(goalId)! < order.get(topGoalId)!)) {
          topW = w;
          topGoalId = goalId;
        }
      }
    }
    out.push({
      date,
      score: scoreByDate.get(date) ?? 0,
      focusMs: focusByDate.get(date) ?? 0,
      ...(topGoalId ? { topGoalId } : {}),
      future: date > range.clippedEnd,
    });
  }
  return out;
}

/** 最长「连续有打卡」的自然日段（任一目标 done/partial 即算）。热力图上能画成连着的一串格子 */
export function longestActiveSpan(cells: DayCell[]): { from: string; to: string; days: number } | null {
  let best: { from: string; to: string; days: number } | null = null;
  let from: string | null = null;
  let run = 0;
  let prev = '';
  for (const c of cells) {
    if (c.score > 0) {
      if (run === 0) from = c.date;
      run += 1;
      prev = c.date;
      if (!best || run > best.days) best = { from: from!, to: prev, days: run };
    } else {
      run = 0;
    }
  }
  return best;
}

// ─────────────────── 各目标最长连续（§02） ───────────────────

export interface LongestRun {
  goalId: string;
  from: string;
  to: string;
  days: number;
  /** 打断该段的那一天；跑到区间末仍未断则为 undefined */
  breakDate?: string;
}

/**
 * 区间内该目标的最长连续段（含起止与打断日）。
 * 口径与 streak.ts calcStreak 逐字一致：done/partial 延续，skipped 不打断不计数，
 * missed 打断，今天未打不打断。单测锁定 days === calcStreak().longest（全年区间下）。
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
      best = { goalId, from: runFrom, to: runTo, days: run, ...(breakDate ? { breakDate } : {}) };
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

// ──────────────── 目标结局（§03） ────────────────

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
  const { goals, tasks, checkIns, exemptions, sessions, range, today, stallDays = DEFAULT_STALL_DAYS } =
    args;

  // 最后活动日不晚于区间右端（看往年年报时「距今」应相对那一年的末尾，而不是真实今天）
  const lastByGoal = new Map<string, string>();
  const bump = (goalId: string | undefined, date: string): void => {
    if (!goalId || date > range.clippedEnd) return;
    const prev = lastByGoal.get(goalId);
    if (!prev || date > prev) lastByGoal.set(goalId, date);
  };
  for (const c of checkIns) if (!c.deletedAt) bump(c.goalId, c.date);
  for (const s of sessions) if (isCountedSession(s)) bump(s.goalId, s.date);

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
      return t.progressMode === 'auto' ? calcAutoProgress(t, checkIns, exemptions, today) : t.progress;
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
      outcome = 'adhocOnly'; // 随缘契约：不催、不指责
    else if (idleDays > stallDays) outcome = 'stalled';
    else outcome = 'active';

    cards.push({ goalId: g.id, outcome, ...(lastActivityDate ? { lastActivityDate } : {}), idleDays, progressPct });
  }
  return cards;
}

// ──────────────── 里程碑（§03） ────────────────

export interface MilestoneRow {
  id: string;
  goalId: string;
  name: string;
  date: string;
  achieved: boolean;
  /** 未达成且日子已过（date ≤ clippedEnd） */
  overdue: boolean;
}

export interface MilestoneStats {
  /** 区间内全部，按日期升序 */
  rows: MilestoneRow[];
  achieved: number;
  /** 已到期（date ≤ clippedEnd）的个数：兑现率的分母。还没到日子的不算失败 */
  due: number;
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
      overdue: !m.achieved && m.date <= range.clippedEnd,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return {
    rows,
    achieved: rows.filter((r) => r.achieved).length,
    due: rows.filter((r) => r.achieved || r.date <= range.clippedEnd).length,
  };
}

// ───────────────────── 月度起伏（§04） ─────────────────────

export interface MonthProfile {
  month: string;
  /** 全目标合计完成率 0-100 = Σscore / Σscheduled；无应打卡返回 null */
  rate: number | null;
  scheduled: number;
  score: number;
  /** 月度复盘的 1-5 星自评；没评过为 undefined */
  rating?: number;
  /** 整月已过完（月末 ≤ clippedEnd）。进行中的当月不参与最佳评选 —— 刚过 3 天拿 100% 是假结论 */
  complete: boolean;
}

export function monthProfiles(args: {
  goals: Goal[];
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  sessions: FocusSession[];
  reviews: MonthlyReview[];
  range: AnnualRange;
  today: string;
}): MonthProfile[] {
  const { goals, tasks, checkIns, exemptions, sessions, reviews, range, today } = args;
  const activeGoals = goals.filter((g) => !g.deletedAt);

  /*
   * 按目标预分桶 —— 同一套口径喂更小的输入：monthlyGoalStats 内部第一件事就是
   * `x.goalId !== goalId ⇒ continue`，先分桶再传逐字节等价。月×目标 次调用下
   * 这是全页最大的开销（Y4 实测 423 → 119ms）。
   */
  const tasksOf = new Map<string, Task[]>();
  const checkInsOf = new Map<string, CheckIn[]>();
  const sessionsOf = new Map<string, FocusSession[]>();
  for (const g of activeGoals) {
    tasksOf.set(g.id, []);
    checkInsOf.set(g.id, []);
    sessionsOf.set(g.id, []);
  }
  for (const t of tasks) tasksOf.get(t.goalId)?.push(t);
  for (const c of checkIns) checkInsOf.get(c.goalId)?.push(c);
  for (const s of sessions) if (s.goalId) sessionsOf.get(s.goalId)?.push(s);

  const ratingOf = new Map<string, number>();
  for (const r of reviews) if (!r.deletedAt && r.rating) ratingOf.set(r.month, r.rating);

  return range.monthPrefixes.map((month) => {
    /*
     * 把任务裁到本月再展开：recurrence 全按星期几判定、免打卡按日期判定，
     * 「整段展开再筛本月」与「只展开本月」是同一个集合，只是少做 11/12 的 dayjs 解析。
     */
    const mStart = `${month}-01`;
    const mEnd = fmtDay(toDay(mStart).endOf('month'));
    const clip = (t: Task): Task =>
      t.startDate >= mStart && t.endDate <= mEnd
        ? t
        : { ...t, startDate: t.startDate > mStart ? t.startDate : mStart, endDate: t.endDate < mEnd ? t.endDate : mEnd };
    let scheduled = 0;
    let score = 0;
    for (const g of activeGoals) {
      const st = monthlyGoalStats({
        goalId: g.id,
        tasks: tasksOf
          .get(g.id)!
          .filter((t) => t.startDate <= mEnd && t.endDate >= mStart)
          .map(clip),
        checkIns: checkInsOf.get(g.id)!,
        exemptions,
        month,
        today,
        sessions: sessionsOf.get(g.id)!,
      });
      scheduled += st.scheduled;
      score += st.score;
    }
    const rating = ratingOf.get(month);
    return {
      month,
      scheduled,
      score,
      // 合计率而非「各目标率的平均」：后者会让只有 1 天应打卡的目标与全月目标等权
      rate: scheduled > 0 ? Math.round((score / scheduled) * 100) : null,
      ...(rating ? { rating } : {}),
      complete: mEnd <= range.clippedEnd,
    };
  });
}

/** 最佳月：已过完、有应打卡的月份里完成率最高者（并列取更早）。没有可评选月份返回 null */
export function bestMonth(profiles: MonthProfile[]): MonthProfile | null {
  let best: MonthProfile | null = null;
  for (const p of profiles) {
    if (!p.complete || p.rate === null) continue;
    if (!best || p.rate > (best.rate as number)) best = p;
  }
  return best;
}

// ──────────────── 专注节律（§04） ────────────────

export interface RhythmCell {
  /** 0=周日…6=周六 */
  dow: number;
  hour: number;
  ms: number;
  count: number;
}

/**
 * 星期 × 小时的专注分布。
 * **区间归属看 s.date**（与全仓所有统计一致）；**钟点与星期取 startAt 的本地值**：
 * FocusSession.date 允许被「改归相邻日」显式覆盖，而节律问的是「你几点在专注」。
 * 一段跨小时的会话整段记在开始小时（v1 不做跨格分摊）。
 */
export function focusByHourDow(sessions: FocusSession[], range: AnnualRange): RhythmCell[] {
  const months = new Set(range.monthPrefixes);
  const acc = new Map<number, RhythmCell>();
  for (const s of sessions) {
    if (!isCountedSession(s) || !inMonths(s.date, months)) continue;
    const d = new Date(s.startAt);
    const dow = d.getDay();
    const hour = d.getHours();
    const key = dow * 24 + hour;
    let cell = acc.get(key);
    if (!cell) acc.set(key, (cell = { dow, hour, ms: 0, count: 0 }));
    cell.ms += s.focusMs;
    cell.count += 1;
  }
  return [...acc.values()].sort((a, b) => a.dow - b.dow || a.hour - b.hour);
}

// ──────────────── 一次算完 ────────────────

export interface AnnualIndex {
  range: AnnualRange;
  /** 区间内完全没有数据 ⇒ 整页空态 */
  empty: boolean;
  /** 区间已过天数 / 总天数 */
  elapsedDays: number;
  totalDays: number;
  /** 有打卡（done/partial）的天数 */
  activeDays: number;
  /** 区间内有任务排期或有投入的目标数 */
  goalCount: number;
  invested: Invested;
  days: DayCell[];
  activeSpan: { from: string; to: string; days: number } | null;
  /** 各目标最长连续，按天数降序 */
  runs: LongestRun[];
  outcomes: GoalStatusCard[];
  milestones: MilestoneStats;
  months: MonthProfile[];
  best: MonthProfile | null;
  rhythm: RhythmCell[];
  /** 计入的专注段数 */
  sessionCount: number;
}

/** 页面只调这一个函数一次（一个 useMemo）。禁止各节组件自己调派生扫全表 */
export function annualIndex(args: {
  goals: Goal[];
  tasks: Task[];
  milestones: Milestone[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  sessions: FocusSession[];
  reviews: MonthlyReview[];
  year: number;
  kind: RangeKind;
  today: string;
}): AnnualIndex {
  const { goals, tasks, milestones, checkIns, exemptions, sessions, reviews, year, kind, today } = args;
  const range = rangeOf(year, kind, today);
  // 归档目标照常进年报：年报是历史，抹掉会让百分比加不到 100。只有软删的才真正不算
  const activeGoals = goals.filter((g) => !g.deletedAt);
  const goalIds = activeGoals.map((g) => g.id);
  const liveTasks = tasks.filter((t) => !t.deletedAt);

  const invested = investedOf(checkIns, sessions, goalIds, range);
  const days = dailyCells(checkIns, sessions, goalIds, range);

  const runs: LongestRun[] = [];
  for (const g of activeGoals) {
    const r = longestRunOf({ goalId: g.id, tasks: liveTasks, checkIns, exemptions, today, range });
    if (r) runs.push(r);
  }
  runs.sort((a, b) => b.days - a.days);

  const months = monthProfiles({ goals: activeGoals, tasks: liveTasks, checkIns, exemptions, sessions, reviews, range, today });

  const inRangeTasks = liveTasks.filter((t) => t.startDate <= range.end && t.endDate >= range.start);
  const involved = new Set(inRangeTasks.map((t) => t.goalId));
  for (const g of invested.goals) involved.add(g.goalId);
  const goalCount = goalIds.filter((id) => involved.has(id)).length;

  const monthSet = new Set(range.monthPrefixes);
  let sessionCount = 0;
  for (const s of sessions) if (isCountedSession(s) && inMonths(s.date, monthSet)) sessionCount += 1;

  const activeDays = days.filter((d) => d.score > 0).length;
  const ms = milestoneStats(milestones, range);

  return {
    range,
    empty: activeDays === 0 && invested.totalMs === 0 && inRangeTasks.length === 0 && ms.rows.length === 0,
    elapsedDays: range.clippedEnd < range.start ? 0 : diffDays(range.clippedEnd, range.start) + 1,
    totalDays: diffDays(range.end, range.start) + 1,
    activeDays,
    goalCount,
    invested,
    days,
    activeSpan: longestActiveSpan(days),
    runs,
    outcomes: goalOutcomes({ goals: activeGoals, tasks: liveTasks, checkIns, exemptions, sessions, range, today }),
    milestones: ms,
    months,
    best: bestMonth(months),
    rhythm: focusByHourDow(sessions, range),
    sessionCount,
  };
}
