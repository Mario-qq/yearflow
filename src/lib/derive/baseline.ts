import type { Task } from '../../types/domain';
import { diffDays } from '../date';

export interface BaselineDrift {
  /** 实际开始 - 基线开始（正 = 延后 N 天） */
  startDriftDays: number;
  /** 实际结束 - 基线结束 */
  endDriftDays: number;
}

/** 计划偏移：无 baseline 返回 null */
export function baselineDrift(
  task: Pick<Task, 'startDate' | 'endDate' | 'baseline'>,
): BaselineDrift | null {
  if (!task.baseline) return null;
  return {
    startDriftDays: diffDays(task.startDate, task.baseline.startDate),
    endDriftDays: diffDays(task.endDate, task.baseline.endDate),
  };
}
