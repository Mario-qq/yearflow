import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  CheckIn,
  ExemptionPeriod,
  FocusSession,
  Goal,
  Milestone,
  MonthlyReview,
  Task,
} from '../types/domain';

/** settings 表单行记录，主键固定为 'app' */
export interface SettingsRow {
  id: string;
  value: AppSettings;
}

export class YearFlowDB extends Dexie {
  goals!: Table<Goal, string>;
  tasks!: Table<Task, string>;
  milestones!: Table<Milestone, string>;
  checkIns!: Table<CheckIn, string>;
  exemptions!: Table<ExemptionPeriod, string>;
  reviews!: Table<MonthlyReview, string>;
  focusSessions!: Table<FocusSession, string>;
  settings!: Table<SettingsRow, string>;

  constructor(name = 'yearflow') {
    super(name);
    this.version(1).stores({
      goals: 'id, order, updatedAt',
      tasks: 'id, goalId, startDate, updatedAt',
      milestones: 'id, goalId, date, updatedAt',
      checkIns: 'id, goalId, taskId, date, [goalId+date], updatedAt',
      exemptions: 'id, startDate, updatedAt',
      reviews: 'id, month, updatedAt',
      settings: 'id',
    });
    /**
     * v2：番茄钟专注会话表。只声明新表即可 —— version(1) 的 7 张表由 Dexie 自动继承
     * （Version.stores 对 _versions 累积，getSchemaDiff 只对新增表建表），既有数据不会丢。
     * 索引一次到位：updatedAt 是同步推送的硬依赖（engine 用 where('updatedAt').above）；
     * date 供将来窗口化载入（容量红线 8000 行）；[goalId+date] 对齐 checkIns 的复合索引形状。
     * ⚠️ IndexedDB 语义：keyPath 为 undefined 的行不进该索引 ⇒ 未归类会话（goalId 缺省）
     * 无法经 goalId / [goalId+date] 索引查到，找未归类必须全表过滤。
     */
    this.version(2).stores({
      focusSessions: 'id, goalId, taskId, date, updatedAt, [goalId+date]',
    });
  }
}

export const db = new YearFlowDB();
