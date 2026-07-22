/**
 * 今日打卡面板派生（SPEC 第五节）：某一天各目标的应打卡条目与当日完成率。
 * 口径：目标级——一天对一个目标最多一条有效记录（同日多条取最强，与 streak 一致）。
 */
import type {
  CheckIn,
  CheckInStatus,
  ExemptionPeriod,
  Goal,
  Task,
} from '../../types/domain';
import { toDay } from '../date';
import { isScheduledDow } from './scheduled';

const STATUS_RANK: Record<CheckInStatus, number> = { done: 3, partial: 2, skipped: 1 };

/** 从一组同目标同日记录中取"最强"（done > partial > skipped）。 */
function strongest(records: CheckIn[]): CheckIn | undefined {
  let best: CheckIn | undefined;
  for (const c of records) {
    if (!best || STATUS_RANK[c.status] > STATUS_RANK[best.status]) best = c;
  }
  return best;
}

/** 单个在办任务在某日的打卡条目（任务级：记录按 目标+任务+日期 解析）。 */
export interface DayTaskEntry {
  taskId: string;
  name: string;
  /** 该任务当日最强打卡状态（无记录 = undefined） */
  status?: CheckInStatus;
  /** 该任务当日已解析的打卡记录（用于就地更新分钟/备注/状态） */
  record?: CheckIn;
}

export interface DayGoalEntry {
  goalId: string;
  /** 该日应打卡的任务 id（免打卡区间内为空数组） */
  dueTaskIds: string[];
  /** 该日各在办任务的打卡条目（免打卡区间内为空数组） */
  taskEntries: DayTaskEntry[];
  /** 该日处于命中该目标的免打卡区间 → 面板显示"休息中"而非按钮 */
  exempt: boolean;
  exemptReason?: string;
  /** 当日目标级最强打卡状态（各任务记录取最强；供小环/热度口径） */
  status?: CheckInStatus;
  /** 是否每个在办任务都已有记录（供"待打卡/已完成"分组） */
  allRecorded: boolean;
  /** 旧数据遗留：该目标当日未分配到具体任务的记录（taskId 空），供 UI 提示手动清除 */
  legacyRecord?: CheckIn;
}

/**
 * 某一天的打卡面板条目：仅包含"当天本应打卡"的目标
 * （任务日期范围 ∩ recurrence 命中；免打卡区间内的目标保留并标记 exempt）。
 */
export function dayEntries(args: {
  date: string;
  goals: Goal[];
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
}): DayGoalEntry[] {
  const { date, goals, tasks, checkIns, exemptions } = args;
  const dow = toDay(date).day();

  // 该日全部有效记录按目标分组（任务级解析在下方按 taskId 细分）
  const recordsByGoal = new Map<string, CheckIn[]>();
  for (const c of checkIns) {
    if (c.deletedAt || c.date !== date) continue;
    const list = recordsByGoal.get(c.goalId) ?? [];
    list.push(c);
    recordsByGoal.set(c.goalId, list);
  }

  const entries: DayGoalEntry[] = [];
  for (const goal of [...goals].filter((g) => !g.deletedAt && !g.archived).sort((a, b) => a.order - b.order)) {
    const due = tasks
      .filter(
        (t) =>
          !t.deletedAt &&
          t.goalId === goal.id &&
          t.status !== 'done' &&
          date >= t.startDate &&
          date <= t.endDate &&
          isScheduledDow(t.recurrence, dow),
      )
      .sort((a, b) => a.order - b.order);
    if (due.length === 0) continue;
    const hit = exemptions.find(
      (e) =>
        !e.deletedAt &&
        date >= e.startDate &&
        date <= e.endDate &&
        (!e.goalIds || e.goalIds.length === 0 || e.goalIds.includes(goal.id)),
    );

    const goalRecords = recordsByGoal.get(goal.id) ?? [];
    // 任务级解析：每任务取「该任务 id 的记录」中最强；未分配任务的旧记录单列
    const taskEntries: DayTaskEntry[] = hit
      ? []
      : due.map((t) => {
          const record = strongest(goalRecords.filter((c) => c.taskId === t.id));
          return { taskId: t.id, name: t.name, status: record?.status, record };
        });
    const legacyRecord = hit ? undefined : strongest(goalRecords.filter((c) => !c.taskId));

    entries.push({
      goalId: goal.id,
      dueTaskIds: hit ? [] : due.map((t) => t.id),
      taskEntries,
      exempt: !!hit,
      exemptReason: hit?.reason,
      status: strongest(goalRecords)?.status,
      allRecorded: taskEntries.length > 0 && taskEntries.every((e) => e.record),
      legacyRecord,
    });
  }
  return entries;
}

/** 随缘（不定期）任务在某日的记录条目：供打卡页「不定期」区随手补记。 */
export interface AdhocEntry {
  goalId: string;
  taskId: string;
  /** 任务名 */
  name: string;
  /** 该任务当日已解析的打卡记录（无 = 未记录） */
  record?: CheckIn;
  status?: CheckInStatus;
}

/**
 * 某一天可补记的随缘任务（recurrence.type==='adhoc'）：
 * 不进每日「待打卡」，仅在其日期范围内、未完成时列出，供用户想记时补一次。
 * 按目标 order、再任务 order 排序（携带 goalOrder/taskOrder 供调用方排序）。
 */
export function adhocEntries(args: {
  date: string;
  goals: Goal[];
  tasks: Task[];
  checkIns: CheckIn[];
}): AdhocEntry[] {
  const { date, goals, tasks, checkIns } = args;
  const goalById = new Map(goals.filter((g) => !g.deletedAt && !g.archived).map((g) => [g.id, g]));

  const recordsByKey = new Map<string, CheckIn[]>();
  for (const c of checkIns) {
    if (c.deletedAt || c.date !== date || !c.taskId) continue;
    const key = `${c.goalId}:${c.taskId}`;
    const list = recordsByKey.get(key) ?? [];
    list.push(c);
    recordsByKey.set(key, list);
  }

  const rows = tasks
    .filter(
      (t) =>
        !t.deletedAt &&
        t.recurrence?.type === 'adhoc' &&
        t.status !== 'done' &&
        goalById.has(t.goalId) &&
        date >= t.startDate &&
        date <= t.endDate,
    )
    .map((t) => {
      const record = strongest(recordsByKey.get(`${t.goalId}:${t.id}`) ?? []);
      const goal = goalById.get(t.goalId)!;
      return { goalId: t.goalId, taskId: t.id, name: t.name, record, status: record?.status, _g: goal.order, _t: t.order };
    })
    .sort((a, b) => a._g - b._g || a._t - b._t);

  return rows.map(({ _g, _t, ...e }) => e);
}

/**
 * 当日完成率（微型日历小环，0-1）：done=1、partial=0.5；
 * skipped 与休息中不入分母；分母为 0 返回 null（环不渲染）。
 */
export function dayCompletionRate(entries: DayGoalEntry[]): number | null {
  let total = 0;
  let score = 0;
  for (const e of entries) {
    if (e.exempt || e.status === 'skipped') continue;
    total += 1;
    if (e.status === 'done') score += 1;
    else if (e.status === 'partial') score += 0.5;
  }
  return total === 0 ? null : score / total;
}
