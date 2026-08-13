import type {
  CheckIn,
  ExemptionPeriod,
  FocusSession,
  Goal,
  Milestone,
  MonthlyReview,
  Task,
} from '../types/domain';

/** 七张实体表（settings 单独处理，不进 undo 栈） */
export interface EntityOf {
  goals: Goal;
  tasks: Task;
  milestones: Milestone;
  checkIns: CheckIn;
  exemptions: ExemptionPeriod;
  reviews: MonthlyReview;
  focusSessions: FocusSession;
}

export type TableName = keyof EntityOf;

/**
 * ⚠️ 这一个数组驱动同步的推拉与墓碑三循环、replaceAllData、exportBundle、applyRemote、
 * 设置页计数。加新表时漏加这里不会编译报错，后果是「新表永不同步、不导出、不进墓碑清库」。
 */
export const TABLE_NAMES: TableName[] = [
  'goals',
  'tasks',
  'milestones',
  'checkIns',
  'exemptions',
  'reviews',
  'focusSessions',
];

/**
 * 一次原子变更：携带变更前后的完整实体，undo/redo 与持久化都由它驱动。
 * put + before 缺省 = 新建；put + before = 更新；delete = 软删除。
 */
export type Change = {
  [K in TableName]:
    | { table: K; type: 'put'; before?: EntityOf[K]; after: EntityOf[K] }
    | { table: K; type: 'delete'; before: EntityOf[K] };
}[TableName];

/** 一条可撤销命令 = 一次用户操作（可能含多个实体变更，如删目标级联删任务） */
export interface Command {
  label: string; // 撤销 toast 显示的内容摘要，如 "删除目标「英语」"
  changes: Change[];
}

/** 内存中的全量实体（Record 按 id 索引） */
export interface EntityMaps {
  goals: Record<string, Goal>;
  tasks: Record<string, Task>;
  milestones: Record<string, Milestone>;
  checkIns: Record<string, CheckIn>;
  exemptions: Record<string, ExemptionPeriod>;
  reviews: Record<string, MonthlyReview>;
  focusSessions: Record<string, FocusSession>;
}

/** 全库数据包（导出/导入/种子载入用） */
export interface DataBundle {
  goals: Goal[];
  tasks: Task[];
  milestones: Milestone[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  reviews: MonthlyReview[];
  focusSessions: FocusSession[];
}

/** 把 Change 反转（undo 用）：新建↔删除、更新↔回滚 */
export function invertChange(change: Change): Change {
  if (change.type === 'delete') {
    return { table: change.table, type: 'put', after: change.before } as Change;
  }
  if (change.before) {
    return {
      table: change.table,
      type: 'put',
      before: change.after,
      after: change.before,
    } as Change;
  }
  return { table: change.table, type: 'delete', before: change.after } as Change;
}
