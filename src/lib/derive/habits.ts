/**
 * 日常习惯的派生（DESK_SPEC §十二）：哪天要做、今天什么状态、连续几天、是不是断了。
 * 「别连着断两天」（Atomic Habits）：断一天是琥珀色提醒「今天接上」，连断两天才是红色。
 */
import type { Habit, HabitLog } from '../../types/domain';
import { toDay } from '../date';
import { addDays } from './desk';

/** 往回数连续天数的上限（10 年），防止 startDate 写坏时死循环 */
const STREAK_LIMIT = 3650;

export const habitLogId = (habitId: string, date: string): string => `${habitId}:${date}`;

/** 这天要不要做：暂停的、开始之前的、不在选定星期的都不要 */
export function habitDueOn(h: Habit, date: string): boolean {
  if (h.paused || date < h.startDate) return false;
  return !h.daysOfWeek?.length || h.daysOfWeek.includes(toDay(date).day());
}

/**
 * 某天的状态：
 * do    → done 做了 / open 今天还没做 / missed 过去漏了
 * avoid → kept 守住了（今天 = 到现在还守着）/ slip 破了一次
 * off   → 这天不用做（暂停、没开始、不在选定星期）
 */
export type HabitDay = 'done' | 'open' | 'missed' | 'kept' | 'slip' | 'off';

export function habitDayState(h: Habit, logs: Record<string, HabitLog>, date: string, today: string): HabitDay {
  const log = logs[habitLogId(h.id, date)];
  if (log && !log.deletedAt) return log.status === 'done' ? (h.kind === 'do' ? 'done' : 'kept') : 'slip';
  if (!habitDueOn(h, date)) return 'off';
  if (h.kind === 'avoid') return 'kept';
  return date < today ? 'missed' : 'open';
}

const ok = (s: HabitDay) => s === 'done' || s === 'kept';
const bad = (s: HabitDay) => s === 'missed' || s === 'slip';

/** 今天之前最近的 n 个「要做的日子」的状态（新的在前） */
function recentDue(h: Habit, logs: Record<string, HabitLog>, today: string, n: number): HabitDay[] {
  const out: HabitDay[] = [];
  let d = addDays(today, -1);
  for (let i = 0; i < STREAK_LIMIT && out.length < n && d >= h.startDate; i++, d = addDays(d, -1)) {
    const s = habitDayState(h, logs, d, today);
    if (s !== 'off') out.push(s);
  }
  return out;
}

export interface HabitView {
  habit: Habit;
  /** 今天的状态 */
  state: HabitDay;
  /**
   * 连续天数（只数要做的日子，不要做的日子跳过不断）。
   * do：今天做了算进去，今天还没做从昨天往回数；avoid：从昨天往回数守住的天数（今天还没过完）。
   */
  streak: number;
  /** 别连着断两天：0 没断 / 1 上一个要做的日子断了（今天接上）/ 2 连着断了两次 */
  broke: 0 | 1 | 2;
  /** 最近 14 天（旧的在前，含今天），悬停小格子用 */
  last14: HabitDay[];
}

export function habitView(h: Habit, logs: Record<string, HabitLog>, today: string): HabitView {
  const state = habitDayState(h, logs, today, today);
  let streak = state === 'done' ? 1 : 0;
  let d = addDays(today, -1);
  for (let i = 0; i < STREAK_LIMIT && d >= h.startDate; i++, d = addDays(d, -1)) {
    const s = habitDayState(h, logs, d, today);
    if (s === 'off') continue;
    if (!ok(s)) break;
    streak++;
  }
  if (state === 'slip') streak = 0;

  let broke: 0 | 1 | 2 = 0;
  // 今天做了 = 已经接上；今天破了的忍住类按今天算
  if (state !== 'done') {
    const [a, b] = state === 'slip' ? ['slip' as HabitDay, ...recentDue(h, logs, today, 1)] : recentDue(h, logs, today, 2);
    if (a && bad(a)) broke = b && bad(b) ? 2 : 1;
  }

  const last14: HabitDay[] = [];
  for (let n = 13; n >= 0; n--) last14.push(habitDayState(h, logs, addDays(today, -n), today));
  return { habit: h, state, streak, broke, last14 };
}

/** 工作台今天要显示的习惯：没暂停、已开始；今天不用做的也显示（淡），让人知道它还在 */
export function habitViews(habits: Habit[], logs: Record<string, HabitLog>, today: string): HabitView[] {
  return habits
    .filter((h) => !h.deletedAt && !h.paused && h.startDate <= today)
    .sort((a, b) => a.order - b.order)
    .map((h) => habitView(h, logs, today));
}

/**
 * 到点提醒：设了时间、今天要做、过了那个点、今天还没发过 ⇒ 提醒。
 * do 只在还没做时提醒；avoid 在没破时提醒（提醒自己忍住），破了就不再说。
 */
export function habitNudgesDue(views: HabitView[], nowHm: string, sent: string[]): HabitView[] {
  return views.filter((v) => v.habit.time && nowHm >= v.habit.time && !sent.includes(v.habit.id) && (v.state === 'open' || (v.habit.kind === 'avoid' && v.state === 'kept')));
}

/** 完整的一句话（悬停说明）：锚点 / 连续 / 断了 */
export function habitHint(v: HabitView): string {
  const { habit: h, state, streak, broke } = v;
  if (state === 'off') return '今天不用';
  if (h.kind === 'avoid') {
    if (state === 'slip') return broke === 2 ? '连着破了两天' : '今天破了，明天接着守';
    if (broke) return '昨天破了，今天守住';
    return streak ? `守住 ${streak} 天` : '第 1 天';
  }
  if (state === 'done') return streak > 1 ? `连续 ${streak} 天` : '做了';
  if (broke === 2) return '连断两次了，今天接上';
  if (broke === 1) return '昨天断了，今天接上';
  return h.cue || (streak ? `连续 ${streak} 天` : '今天还没做');
}

/** 胶囊上的短标记：只在有信息量时出现，保证一排放得下（完整说法见 habitHint） */
export function habitBadge(v: HabitView): string {
  const { habit: h, state, streak, broke } = v;
  if (state === 'off') return '';
  if (h.kind === 'avoid') {
    if (state === 'slip') return '今天破了';
    if (broke) return '昨天破了';
    return streak ? `${streak}天` : '';
  }
  if (state !== 'done' && broke === 2) return '连断2次';
  if (state !== 'done' && broke === 1) return '昨天断了';
  return streak > 1 || (streak === 1 && state !== 'done') ? `${streak}天` : '';
}
