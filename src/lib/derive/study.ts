/**
 * 学习防忘派生（DESK_SPEC §五）：今天学什么、学没学、本周几天、昨天断没断、该不该提醒、专注结束要不要自动打卡。
 * 全部纯函数、不入库；单测见 study.test.ts。
 *
 * 口径（负责人 2026-10-16 拍板 + 规格 §五）：
 * - 学习任务 = 设置里勾选的「学习目标」下的甘特任务；「今天该学的」= 当天应打卡的那些（复用 dayEntries，与年度计划分区同一口径）。
 * - 某天「学过了」= 学习目标有一条「完成 / 做了一点」的打卡，或学习目标的专注净时长 ≥ 短版分钟数（短版做完也算）。
 * - 「学够了」（自动打卡记「完成」而不是「做了一点」）= 当天学习专注合计 ≥ 每次学习分钟数。
 */
import type { CheckIn, CheckInStatus, DeskSettings, ExemptionPeriod, FocusSession, Goal, StudyAnchor, Task } from '../../types/domain';
import { diffDays, fmtDay, toDay } from '../date';
import { dayEntries } from './dayPanel';
import { isCountedSession } from './focus';
import { timeProgressPct } from './gantt';
import { calcAutoProgress } from './scheduled';

const MIN = 60_000;

export interface StudyData {
  goals: Goal[];
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  sessions: FocusSession[];
}

/** 学习目标集合（已删除/归档的目标自动剔除） */
export function studyGoalSet(goals: Goal[], studyGoalIds: string[]): Set<string> {
  const live = new Set(goals.filter((g) => !g.deletedAt && !g.archived).map((g) => g.id));
  return new Set(studyGoalIds.filter((id) => live.has(id)));
}

// ── 学过没有：按日期建一次索引，周点阵 / 连续天数 / 昨天断没断都查它 ──────────────

export interface StudyLedger {
  /** 学习目标在这天有「完成 / 做了一点」打卡 */
  checked: Set<string>;
  /** 学习目标在这天的专注净毫秒 */
  focusMs: Map<string, number>;
}

export function buildStudyLedger(study: Set<string>, checkIns: CheckIn[], sessions: FocusSession[]): StudyLedger {
  const checked = new Set<string>();
  for (const c of checkIns) {
    if (c.deletedAt || !study.has(c.goalId)) continue;
    if (c.status === 'done' || c.status === 'partial') checked.add(c.date);
  }
  const focusMs = new Map<string, number>();
  for (const s of sessions) {
    if (!isCountedSession(s) || !s.goalId || !study.has(s.goalId)) continue;
    focusMs.set(s.date, (focusMs.get(s.date) ?? 0) + s.focusMs);
  }
  return { checked, focusMs };
}

export function studiedOn(ledger: StudyLedger, date: string, shortMinutes: number): boolean {
  return ledger.checked.has(date) || (ledger.focusMs.get(date) ?? 0) >= shortMinutes * MIN;
}

export const studyMinutesOn = (ledger: StudyLedger, date: string): number => Math.round((ledger.focusMs.get(date) ?? 0) / MIN);

// ── 今天学什么 ───────────────────────────────────────────────────────────

export interface StudyPick {
  goalId: string;
  taskId: string;
  taskName: string;
  /** 当天应打卡（否则只是在办、今天不在排程里） */
  due: boolean;
  /** 落后计划的百分点（时间进度 − 实际进度），不落后 = 0 */
  behind: number;
  /** 最近一次打卡或专注的日期；从没碰过 = undefined */
  lastTouched?: string;
  /** 这个任务当天的打卡状态 */
  status?: CheckInStatus;
}

function lastTouchedOf(task: Task, checkIns: CheckIn[], sessions: FocusSession[], today: string): string | undefined {
  let last: string | undefined;
  for (const c of checkIns) {
    if (c.deletedAt || c.goalId !== task.goalId || c.date > today) continue;
    if (c.taskId && c.taskId !== task.id) continue;
    if (c.status === 'skipped') continue;
    if (!last || c.date > last) last = c.date;
  }
  for (const s of sessions) {
    if (!isCountedSession(s) || s.taskId !== task.id || s.date > today) continue;
    if (!last || s.date > last) last = s.date;
  }
  return last;
}

/**
 * 学习候选，排好序：今天应打卡的在前；其后按「落后计划最多 → 最久没碰（从没碰过最久）」。
 * 今天没排学习时，候选是还在办的学习任务（日期范围内、未完成、不在免打卡区间），供「想学也可以」。
 */
export function studyPicks(today: string, data: StudyData, study: Set<string>): StudyPick[] {
  const entries = dayEntries({ date: today, goals: data.goals, tasks: data.tasks, checkIns: data.checkIns, exemptions: data.exemptions });
  const dueStatus = new Map<string, CheckInStatus | undefined>();
  for (const e of entries) {
    if (!study.has(e.goalId) || e.exempt) continue;
    for (const t of e.taskEntries) dueStatus.set(t.taskId, t.status);
  }
  const exemptGoals = new Set(entries.filter((e) => e.exempt).map((e) => e.goalId));

  const out: StudyPick[] = [];
  for (const t of data.tasks) {
    if (t.deletedAt || !study.has(t.goalId) || t.status === 'done') continue;
    // 随缘任务没有排程：照样列为候选（能学），只是不算「今天该学」
    if (today < t.startDate || today > t.endDate || exemptGoals.has(t.goalId)) continue;
    const progress = t.progressMode === 'auto' ? calcAutoProgress(t, data.checkIns, data.exemptions, today) : t.progress;
    const behind = Math.max(0, Math.round(timeProgressPct(t, today) - progress));
    out.push({
      goalId: t.goalId,
      taskId: t.id,
      taskName: t.name,
      due: dueStatus.has(t.id),
      behind,
      lastTouched: lastTouchedOf(t, data.checkIns, data.sessions, today),
      status: dueStatus.get(t.id),
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.due) - Number(a.due) ||
      b.behind - a.behind ||
      (a.lastTouched ?? '').localeCompare(b.lastTouched ?? '') ||
      a.taskName.localeCompare(b.taskName),
  );
}

/** 某天有没有排学习（学习目标有当天应打卡、且不在免打卡区间的任务） */
export function studyDueOn(date: string, data: StudyData, study: Set<string>): boolean {
  return dayEntries({ date, goals: data.goals, tasks: data.tasks, checkIns: data.checkIns, exemptions: data.exemptions }).some(
    (e) => study.has(e.goalId) && !e.exempt && e.taskEntries.length > 0,
  );
}

// ── 周目标 / 不连断 ──────────────────────────────────────────────────────

/** 本周（周一起）每天学没学：长度 7 */
export function weekStudyDays(monday: string, ledger: StudyLedger, shortMinutes: number): boolean[] {
  return Array.from({ length: 7 }, (_, n) => studiedOn(ledger, fmtDay(toDay(monday).add(n, 'day')), shortMinutes));
}

/**
 * 连续学习天数：从昨天往回数（今天学了再 +1）。没排学习、也没学的日子跳过不断（周末不排学习不该清零），
 * 排了却没学 ⇒ 断。最多回看 lookback 天。
 */
export function studyStreak(
  today: string,
  ledger: StudyLedger,
  shortMinutes: number,
  dueOn: (date: string) => boolean,
  lookback = 60,
): number {
  let n = studiedOn(ledger, today, shortMinutes) ? 1 : 0;
  for (let i = 1; i <= lookback; i++) {
    const d = fmtDay(toDay(today).subtract(i, 'day'));
    if (studiedOn(ledger, d, shortMinutes)) n++;
    else if (dueOn(d)) break;
  }
  return n;
}

/** 昨天排了学习却没学（今天的卡片文案变成「昨天断了一天，今天别连断」） */
export function brokeYesterday(today: string, ledger: StudyLedger, shortMinutes: number, dueOn: (date: string) => boolean): boolean {
  const y = fmtDay(toDay(today).subtract(1, 'day'));
  return dueOn(y) && !studiedOn(ledger, y, shortMinutes);
}

// ── 锚点与提醒 ───────────────────────────────────────────────────────────

/** 这一天的锚点：按星期覆盖优先（覆盖里没写的字段沿用默认） */
export function anchorFor(desk: Pick<DeskSettings, 'anchor' | 'anchorByDow'>, date: string): StudyAnchor {
  const o = desk.anchorByDow[toDay(date).day()];
  if (!o) return desk.anchor;
  if (o.off) return { ...desk.anchor, ...o, off: true };
  return { time: o.time || desk.anchor.time, text: o.text || desk.anchor.text };
}

export type StudyNudge = 'anchor' | 'lastCall';

/**
 * 现在该不该提醒、提醒哪一次。nowHm = 本地 HH:mm（字符串比较即时间比较）。
 * 规则：今天排了学习、还没学、没在学 ⇒ 到锚点时间提醒一次；到最晚时间还没学再提醒一次（只要错过了锚点就不再补发锚点那次）。
 * 每天每种最多一次（sent 由调用方按日期记住）。
 */
export function studyNudgeDue(args: {
  nowHm: string;
  anchor: StudyAnchor;
  lastCall?: string;
  remind: boolean;
  due: boolean;
  studied: boolean;
  running: boolean;
  sent: { anchor?: boolean; lastCall?: boolean };
}): StudyNudge | null {
  const { nowHm, anchor, lastCall, sent } = args;
  if (!args.remind || !args.due || args.studied || args.running || anchor.off) return null;
  if (lastCall && nowHm >= lastCall) return sent.lastCall ? null : 'lastCall';
  if (anchor.time && nowHm >= anchor.time && !sent.anchor) return 'anchor';
  return null;
}

// ── 专注结束自动打卡 ─────────────────────────────────────────────────────

/**
 * 一段专注落库后，要不要给它的学习任务自动打卡、打成什么：
 * 只认「跑到计划终点」的学习任务专注；当天学习专注合计 ≥ 每次学习分钟数 ⇒ 完成，否则「做了一点」。
 * 已有「完成」不动；已有「做了一点」只升不降；返回 null = 不打。
 */
export function studyAutoCheckIn(
  session: FocusSession,
  ctx: { study: Set<string>; studyMinutes: number; sessions: FocusSession[]; checkIns: CheckIn[] },
): { goalId: string; taskId: string; date: string; status: 'done' | 'partial' } | null {
  if (session.outcome !== 'completed' || !session.goalId || !session.taskId || !ctx.study.has(session.goalId)) return null;
  let ms = 0;
  const seen = new Set<string>();
  for (const s of [session, ...ctx.sessions]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    if (isCountedSession(s) && s.date === session.date && s.goalId && ctx.study.has(s.goalId)) ms += s.focusMs;
  }
  const status = ms >= ctx.studyMinutes * MIN ? 'done' : 'partial';
  const existing = ctx.checkIns.find(
    (c) => !c.deletedAt && c.goalId === session.goalId && c.date === session.date && (c.taskId ?? undefined) === session.taskId,
  );
  if (existing?.status === 'done') return null;
  if (existing?.status === 'partial' && status === 'partial') return null;
  return { goalId: session.goalId, taskId: session.taskId, date: session.date, status };
}

/** 「N 天没碰」：从没碰过 = null */
export const untouchedDays = (pick: StudyPick, today: string): number | null => (pick.lastTouched ? diffDays(today, pick.lastTouched) : null);
