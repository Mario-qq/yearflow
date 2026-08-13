export {
  isScheduledDow,
  isExempt,
  expandScheduledDays,
  checkedDatesFor,
  getMissedDays,
  calcAutoProgress,
} from './scheduled';
export { calcStreak, bestStatusByDate, statusByDateFor, type StreakResult } from './streak';
export { weeklyHeat, type WeekHeat } from './heat';
export { baselineDrift, type BaselineDrift } from './baseline';
export {
  dayEntries,
  dayCompletionRate,
  adhocEntries,
  type DayGoalEntry,
  type DayTaskEntry,
  type AdhocEntry,
} from './dayPanel';
export {
  monthlyGoalStats,
  dailyActivityScores,
  minutesByGoalByMonth,
  type MonthGoalStats,
} from './review';
export {
  isCountedSession,
  netFocusMs,
  pausedTotalMs,
  plannedEndOf,
  isPaused,
  settleSession,
  planRecovery,
  shouldLongBreak,
  focusMsByTaskDate,
  todayFocusMs,
  unassignedSessions,
  effectiveMsByGoalPrefix,
  effectiveMsByGoalDate,
  effectiveMsByGoalByYear,
  focusIndexForGantt,
  focusStats,
  type GanttFocusIndex,
  type FocusStats,
  type RecoveryKind,
  type RecoveryPlan,
  type SettleOpts,
} from './focus';
export {
  buildTracks,
  aggregateTrackProgress,
  memberAtDate,
  type Track,
  type TrackIndex,
  type TrackSegment,
} from './tracks';
export {
  timeProgressPct,
  deriveTaskGantt,
  deriveGoalGantt,
  goalMonthlyRate,
  type TaskGantt,
  type GoalGantt,
  type TrackGantt,
} from './gantt';
/*
 * ⚠️ 年报派生（annual.ts）**故意不从这个 barrel 导出**，请直接 `from './annual'`
 * 或 `from '../lib/derive/annual'`。
 *
 * 原因是包体，不是洁癖：本 barrel 被主包（甘特/复盘）引用着，一旦它再 re-export
 * annual.ts，该模块就同时被主包 chunk 与 /year 的 lazy chunk 引用 ⇒ Rolldown 只能
 * 把它提到共享的 index chunk 里，实测主包 +6.4kB / gzip +2.2kB，直接违反
 * ANNUAL_SPEC §六「主包 gzip 增量 0」。移出后 annual.ts 干净地留在 lazy chunk 内。
 */
