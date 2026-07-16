/**
 * 甘特派生数据缓存 —— per-goal 失效粒度（SPEC §9：打卡写入只使相关目标的缓存失效）。
 *
 * 原理：store 写入只替换整表 map、未动实体保持引用 → stableGroupBy 让未变目标的
 * tasks/checkIns 分组保持旧数组引用 → 该目标的 GoalGantt 直接复用上一轮结果，
 * 只有真正变化的目标才重算 deriveGoalGantt。
 */
import { useRef } from 'react';
import type { CheckIn, ExemptionPeriod, Goal, Task } from '../../types/domain';
import { deriveGoalGantt, type GoalGantt } from '../../lib/derive';
import { stableGroupBy } from '../../lib/stableSlices';

const EMPTY_TASKS: Task[] = [];
const EMPTY_CHECKINS: CheckIn[] = [];

/** dev 观测：deriveGoalGantt 实际重算次数（浏览器验证 per-goal 失效用） */
let deriveComputes = 0;

interface CacheEntry {
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  today: string;
  weekStartsOn: 0 | 1;
  value: GoalGantt;
}

interface State {
  goals?: Record<string, Goal>;
  tasks?: Record<string, Task>;
  checkIns?: Record<string, CheckIn>;
  exemptions?: Record<string, ExemptionPeriod>;
  today?: string;
  weekStartsOn?: 0 | 1;
  tasksByGoal: Map<string, Task[]>;
  checkInsByGoal: Map<string, CheckIn[]>;
  exemptionsArr: ExemptionPeriod[];
  cache: Map<string, CacheEntry>;
  result: Map<string, GoalGantt>;
}

export function useGanttDerive(
  goals: Record<string, Goal>,
  tasks: Record<string, Task>,
  checkIns: Record<string, CheckIn>,
  exemptions: Record<string, ExemptionPeriod>,
  today: string,
  weekStartsOn: 0 | 1,
): Map<string, GoalGantt> {
  const ref = useRef<State>({
    tasksByGoal: new Map(),
    checkInsByGoal: new Map(),
    exemptionsArr: [],
    cache: new Map(),
    result: new Map(),
  });
  const s = ref.current;

  // 全部输入未变 → 直接返回上一轮结果（保持 Map 引用稳定，下游 memo 不动）
  if (
    s.goals === goals &&
    s.tasks === tasks &&
    s.checkIns === checkIns &&
    s.exemptions === exemptions &&
    s.today === today &&
    s.weekStartsOn === weekStartsOn
  ) {
    return s.result;
  }

  if (s.tasks !== tasks) {
    s.tasksByGoal = stableGroupBy(Object.values(tasks), (t) => t.goalId, s.tasksByGoal);
  }
  if (s.checkIns !== checkIns) {
    s.checkInsByGoal = stableGroupBy(Object.values(checkIns), (c) => c.goalId, s.checkInsByGoal);
  }
  if (s.exemptions !== exemptions) {
    s.exemptionsArr = Object.values(exemptions);
  }

  const result = new Map<string, GoalGantt>();
  for (const goal of Object.values(goals)) {
    if (goal.deletedAt || goal.archived) continue;
    const gTasks = s.tasksByGoal.get(goal.id) ?? EMPTY_TASKS;
    const gCheckIns = s.checkInsByGoal.get(goal.id) ?? EMPTY_CHECKINS;
    const prev = s.cache.get(goal.id);
    if (
      prev &&
      prev.tasks === gTasks &&
      prev.checkIns === gCheckIns &&
      prev.exemptions === s.exemptionsArr &&
      prev.today === today &&
      prev.weekStartsOn === weekStartsOn
    ) {
      result.set(goal.id, prev.value);
      continue;
    }
    const value = deriveGoalGantt({
      goalId: goal.id,
      tasks: gTasks,
      checkIns: gCheckIns,
      exemptions: s.exemptionsArr,
      today,
      weekStartsOn,
    });
    s.cache.set(goal.id, {
      tasks: gTasks,
      checkIns: gCheckIns,
      exemptions: s.exemptionsArr,
      today,
      weekStartsOn,
      value,
    });
    result.set(goal.id, value);
    if (import.meta.env.DEV) {
      deriveComputes += 1;
      (window as unknown as Record<string, unknown>).__ganttDeriveComputes = deriveComputes;
    }
  }

  // 目标被删除/归档后清掉缓存
  for (const id of [...s.cache.keys()]) {
    if (!result.has(id)) s.cache.delete(id);
  }

  s.goals = goals;
  s.tasks = tasks;
  s.checkIns = checkIns;
  s.exemptions = exemptions;
  s.today = today;
  s.weekStartsOn = weekStartsOn;
  s.result = result;
  return result;
}
