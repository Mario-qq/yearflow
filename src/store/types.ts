import type {
  CheckIn,
  DayMark,
  ExemptionPeriod,
  FocusSession,
  Goal,
  Habit,
  HabitLog,
  Interaction,
  Milestone,
  MonthlyReview,
  Note,
  Person,
  Routine,
  RoutineLog,
  ScreenTimeDay,
  Task,
  WorkItem,
} from '../types/domain';

/** 十七张实体表（settings 单独处理，不进 undo 栈） */
export interface EntityOf {
  goals: Goal;
  tasks: Task;
  milestones: Milestone;
  checkIns: CheckIn;
  exemptions: ExemptionPeriod;
  reviews: MonthlyReview;
  focusSessions: FocusSession;
  screenTimeDays: ScreenTimeDay;
  workItems: WorkItem;
  routines: Routine;
  routineLogs: RoutineLog;
  dayMarks: DayMark;
  habits: Habit;
  habitLogs: HabitLog;
  people: Person;
  interactions: Interaction;
  notes: Note;
}

export type TableName = keyof EntityOf;

/**
 * 表清单的唯一来源。写成 Record<TableName, true> 是为了编译期穷举：EntityOf 加了表而这里漏写，
 * tsc 直接报错（以前是手写数组，漏加不报错，后果是「新表永不同步、不导出、不进墓碑清库」）。
 */
const TABLE_SET: Record<TableName, true> = {
  goals: true,
  tasks: true,
  milestones: true,
  checkIns: true,
  exemptions: true,
  reviews: true,
  focusSessions: true,
  screenTimeDays: true,
  workItems: true,
  routines: true,
  routineLogs: true,
  dayMarks: true,
  habits: true,
  habitLogs: true,
  people: true,
  interactions: true,
  notes: true,
};

/** 驱动同步推拉与墓碑、replaceAllData、exportBundle、applyRemote、hydrate、设置页计数 */
export const TABLE_NAMES = Object.keys(TABLE_SET) as TableName[];

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
  /** 合并键：连续几次 execute 带同一个键 ⇒ 合成栈顶这一条（如一次编辑会话里的多次自动保存） */
  mergeKey?: string;
}

/**
 * 把 next 并进 prev（同一实体保留最早的 before、取最新的 after）。
 * 新建后又改 ⇒ 仍是新建；新建后又删 ⇒ 两条抵消。
 */
export function mergeChanges(prev: Change[], next: Change[]): Change[] {
  const out = [...prev];
  for (const c of next) {
    const id = c.type === 'put' ? c.after.id : c.before.id;
    const i = out.findIndex((o) => o.table === c.table && (o.type === 'put' ? o.after.id : o.before.id) === id);
    if (i < 0) {
      out.push(c);
      continue;
    }
    const o = out[i];
    const before = o.type === 'put' ? o.before : o.before;
    if (c.type === 'delete') {
      if (before) out[i] = { table: c.table, type: 'delete', before } as Change;
      else out.splice(i, 1);
    } else {
      out[i] = { table: c.table, type: 'put', before, after: c.after } as Change;
    }
  }
  return out;
}

/** 内存中的全量实体（Record 按 id 索引）—— 由 EntityOf 映射，加表无需再改 */
export type EntityMaps = { [K in TableName]: Record<string, EntityOf[K]> };

/** 全库数据包（导出/导入/种子载入用）—— 同上 */
export type DataBundle = { [K in TableName]: EntityOf[K][] };

/** 空数据包（清空数据 / 种子补齐用） */
export function emptyBundle(): DataBundle {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, []])) as unknown as DataBundle;
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
