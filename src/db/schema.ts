import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  CheckIn,
  ExemptionPeriod,
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
  }
}

export const db = new YearFlowDB();
