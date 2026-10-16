/**
 * 工作台派生（DESK_SPEC §三/§七）：某天出现哪些例行、顺延与拖延、紧急度提档、跟进按人聚合、挪动目标日。
 * 全部纯函数、不入库；单测见 desk.test.ts。周一为一周之首（负责人的手工周历是周一~周日）。
 */
import type { DayMark, Routine, RoutineLog, RoutineRule, Urgency, WorkItem } from '../../types/domain';
import { diffDays, fmtDay, toDay } from '../date';

// ── 日历 ─────────────────────────────────────────────────────────────────

export const weekMonday = (date: string): string => fmtDay(toDay(date).startOf('isoWeek'));
export const addDays = (date: string, n: number): string => fmtDay(toDay(date).add(n, 'day'));

/** 休/班标记优先；没有标记时周一~周五为工作日 */
export function isWorkday(date: string, marks: Record<string, DayMark>): boolean {
  const m = marks[date];
  if (m && !m.deletedAt) return m.type === 'work';
  const dow = toDay(date).day();
  return dow !== 0 && dow !== 6;
}

// ── 例行 ─────────────────────────────────────────────────────────────────

/** 规则本身是否命中这一天（不看暂停/起止/工作日范围） */
export function ruleHits(rule: RoutineRule, date: string, marks: Record<string, DayMark>): boolean {
  const d = toDay(date);
  switch (rule.type) {
    case 'daily':
      return true;
    case 'workday':
      return isWorkday(date, marks);
    case 'weekly':
      return rule.daysOfWeek.includes(d.day());
    case 'monthlyDay': {
      const last = d.daysInMonth();
      const target = rule.monthDay === -1 ? last : Math.min(rule.monthDay, last); // 31 号在小月落到月末
      return d.date() === target;
    }
    case 'monthlyNth': {
      if (d.day() !== rule.weekday) return false;
      if (rule.nth === -1) return d.date() + 7 > d.daysInMonth();
      return Math.ceil(d.date() / 7) === rule.nth;
    }
  }
}

/** 例行在这一天是否该出现：未暂停、在起止范围内、规则命中；工作类还要求是工作日 */
export function routineActiveOn(r: Routine, date: string, marks: Record<string, DayMark>): boolean {
  if (r.deletedAt || r.paused) return false;
  if (date < r.startDate || (r.endDate && date > r.endDate)) return false;
  if (r.scope === 'work' && !isWorkday(date, marks)) return false;
  return ruleHits(r.rule, date, marks);
}

export const routineLogId = (routineId: string, date: string): string => `${routineId}:${date}`;

export interface RoutineOccurrence {
  routine: Routine;
  /** 规则算出的原日期（RoutineLog 的主键日期） */
  origDate: string;
  log?: RoutineLog;
  status: 'open' | 'done' | 'skipped';
  /** 漏做的周常/月常挂到今天补做，或改期后没做完顺延到今天 */
  makeup: boolean;
  /** 从别的日子「这一次改到」这天的 */
  movedIn: boolean;
}

/** 漏做可以补到什么时候：周常到本周日、月常到月底；日常/工作日不补 */
function makeupWindowStart(rule: RoutineRule, today: string): string | null {
  if (rule.type === 'weekly') return weekMonday(today);
  if (rule.type === 'monthlyDay' || rule.type === 'monthlyNth') return fmtDay(toDay(today).startOf('month'));
  return null;
}

const liveLog = (logs: Record<string, RoutineLog>, id: string): RoutineLog | undefined => {
  const l = logs[id];
  return l && !l.deletedAt ? l : undefined;
};

/**
 * 某天出现的例行：
 * ① 规则命中这天、且这一次没被改走的；
 * ② 从别的日子改到这天的（moved → movedTo）；
 * ③ 只在今天：本周漏做的周常、本月漏做的月常（补做）；改期后没做完的也顺延到今天。
 * 在今天补做完的，今天照样显示（已完成），不会凭空消失。
 */
export function routineOccurrencesOn(
  date: string,
  today: string,
  routines: Routine[],
  logs: Record<string, RoutineLog>,
  marks: Record<string, DayMark>,
): RoutineOccurrence[] {
  const out: RoutineOccurrence[] = [];
  const byId = new Map(routines.filter((r) => !r.deletedAt).map((r) => [r.id, r]));

  for (const r of byId.values()) {
    if (!routineActiveOn(r, date, marks)) continue;
    const log = liveLog(logs, routineLogId(r.id, date));
    if (log?.status === 'moved') continue;
    out.push({ routine: r, origDate: date, log, status: log ? (log.status as 'done' | 'skipped') : 'open', makeup: false, movedIn: false });
  }

  for (const log of Object.values(logs)) {
    if (log.deletedAt || log.status !== 'moved' || !log.movedTo) continue;
    const r = byId.get(log.routineId);
    if (!r) continue;
    const done = Boolean(log.doneAt);
    const here = log.movedTo === date;
    const rolled = date === today && log.movedTo < today && !done;
    if (here || rolled) out.push({ routine: r, origDate: log.date, log, status: done ? 'done' : 'open', makeup: rolled, movedIn: true });
  }

  if (date === today) {
    for (const r of byId.values()) {
      const from = makeupWindowStart(r.rule, today);
      if (!from) continue;
      for (let d = from; d < today; d = addDays(d, 1)) {
        if (!routineActiveOn(r, d, marks)) continue;
        const log = liveLog(logs, routineLogId(r.id, d));
        if (!log) out.push({ routine: r, origDate: d, status: 'open', makeup: true, movedIn: false });
        else if (log.status === 'done' && log.doneOn === today)
          out.push({ routine: r, origDate: d, log, status: 'done', makeup: true, movedIn: false });
      }
    }
  }

  return out.sort(
    (a, b) =>
      (a.routine.time ?? '99:99').localeCompare(b.routine.time ?? '99:99') ||
      a.routine.order - b.routine.order ||
      a.origDate.localeCompare(b.origDate),
  );
}

// ── 事项 ─────────────────────────────────────────────────────────────────

export const URGENCY_RANK: Record<Urgency, number> = { urgent: 2, soon: 1, normal: 0 };

/** 显示用紧急度：已过截止 ⇒ 紧急；明天及以前截止 ⇒ 至少尽快。只影响显示，不改数据 */
export function effectiveUrgency(item: WorkItem, today: string): Urgency {
  if (item.status !== 'open' || !item.dueDate) return item.urgency;
  if (item.dueDate < today) return 'urgent';
  if (diffDays(item.dueDate, today) <= 1 && item.urgency === 'normal') return 'soon';
  return item.urgency;
}

export function compareItems(a: WorkItem, b: WorkItem, today: string): number {
  return (
    URGENCY_RANK[effectiveUrgency(b, today)] - URGENCY_RANK[effectiveUrgency(a, today)] ||
    (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
    a.order - b.order
  );
}

const live = (i: WorkItem) => !i.deletedAt;

export interface DayItems {
  /** 只在今天：过去没做完、顺延过来的（按紧急度排） */
  rolled: WorkItem[];
  open: WorkItem[];
  done: WorkItem[];
}

export function itemsOnDay(items: WorkItem[], date: string, today: string): DayItems {
  const cmp = (a: WorkItem, b: WorkItem) => compareItems(a, b, today);
  const own = items.filter((i) => live(i) && i.date === date);
  return {
    rolled:
      date === today ? items.filter((i) => live(i) && i.status === 'open' && i.date !== undefined && i.date < today).sort(cmp) : [],
    open: own.filter((i) => i.status === 'open').sort(cmp),
    done: own.filter((i) => i.status === 'done'),
  };
}

/** 待处理 = 未完成且还没排日子 */
export function pendingItems(items: WorkItem[], today: string): WorkItem[] {
  return items.filter((i) => live(i) && i.status === 'open' && !i.date).sort((a, b) => compareItems(a, b, today));
}

/** 过期顺延了几天（没顺延 = 0） */
export function rolledDays(item: WorkItem, today: string): number {
  return item.status === 'open' && item.date && item.date < today ? diffDays(today, item.date) : 0;
}

/** 拖延信号：被往后挪 ≥3 次，或过期顺延 ≥3 天 */
export function isStale(item: WorkItem, today: string): boolean {
  return item.status === 'open' && ((item.deferCount ?? 0) >= 3 || rolledDays(item, today) >= 3);
}

export interface PersonGroup {
  person: string;
  items: WorkItem[];
  /** 最久那件挂了几天（从创建日算） */
  oldestDays: number;
}

/** 未完成跟进按人聚合（人物卡、今日脉搏用）：件数多的在前，同件数挂得久的在前 */
export function followupsByPerson(items: WorkItem[], today: string): PersonGroup[] {
  const map = new Map<string, WorkItem[]>();
  for (const i of items) {
    if (!live(i) || i.kind !== 'followup' || i.status !== 'open' || !i.person) continue;
    const list = map.get(i.person) ?? [];
    list.push(i);
    map.set(i.person, list);
  }
  return [...map.entries()]
    .map(([person, list]) => {
      const sorted = list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { person, items: sorted, oldestDays: Math.max(0, diffDays(today, sorted[0].createdAt.slice(0, 10))) };
    })
    .sort((a, b) => b.items.length - a.items.length || b.oldestDays - a.oldestDays);
}

// ── 挪动 ─────────────────────────────────────────────────────────────────

export type MoveHow = 'tomorrow' | 'nextMonday' | 'sameDayNextWeek';

/** 挪动的起点：过期顺延的、待处理的都按今天算 */
export const moveBase = (date: string | undefined, today: string): string => (date && date >= today ? date : today);

export function moveTarget(how: MoveHow, date: string | undefined, today: string): string {
  const base = moveBase(date, today);
  if (how === 'tomorrow') return addDays(base, 1);
  if (how === 'nextMonday') return addDays(weekMonday(base), 7);
  return addDays(base, 7);
}

/**
 * 挪一件事项：只改 date，不碰紧急度与截止日；往后挪 deferCount + 1（往前、进待处理不加）。
 * pastDue = 挪到了截止日之后（UI 提示一次）。
 */
export function moveItem(item: WorkItem, to: string | null, stamp: string): { item: WorkItem; pastDue: boolean } {
  const next: WorkItem = { ...item, updatedAt: stamp };
  if (to === null) delete next.date;
  else next.date = to;
  if (to !== null && item.date !== undefined && to > item.date) next.deferCount = (item.deferCount ?? 0) + 1;
  return { item: next, pastDue: to !== null && item.dueDate !== undefined && to > item.dueDate };
}
