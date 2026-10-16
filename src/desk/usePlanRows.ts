/** 今天「年度计划」分区的数据：甘特图当天应打卡的任务（derive/dayPanel.dayEntries），免打卡区间内的目标不出现 */
import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { dayEntries } from '../lib/derive';
import { goalColor } from '../lib/colors';

export interface PlanRowData {
  goalId: string;
  goalName: string;
  color: string;
  taskId: string;
  taskName: string;
  status?: 'done' | 'partial' | 'skipped';
  recordId?: string;
}

export function usePlanRows(today: string): PlanRowData[] {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const checkIns = useStore((s) => s.checkIns);
  const exemptions = useStore((s) => s.exemptions);
  return useMemo(() => {
    const entries = dayEntries({
      date: today,
      goals: Object.values(goals),
      tasks: Object.values(tasks),
      checkIns: Object.values(checkIns),
      exemptions: Object.values(exemptions),
    });
    return entries
      .filter((e) => !e.exempt)
      .flatMap((e) =>
        e.taskEntries.map((t) => ({
          goalId: e.goalId,
          goalName: goals[e.goalId]?.name ?? '',
          color: goalColor(goals[e.goalId]?.color ?? 'goal-1'),
          taskId: t.taskId,
          taskName: t.name,
          status: t.status,
          recordId: t.record?.id,
        })),
      );
  }, [today, goals, tasks, checkIns, exemptions]);
}

