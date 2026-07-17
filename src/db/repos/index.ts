import { db } from '../schema';
import { BaseRepo } from './baseRepo';
import type {
  AppSettings,
  CheckIn,
  ExemptionPeriod,
  Goal,
  Milestone,
  MonthlyReview,
  Task,
} from '../../types/domain';
import { DEFAULT_SETTINGS } from '../../store/defaults';

class CheckInRepo extends BaseRepo<CheckIn> {
  /** 某目标在日期范围内的打卡（复盘/派生计算按需查询用） */
  async getByGoalAndRange(goalId: string, start: string, end: string): Promise<CheckIn[]> {
    const rows = await this.table
      .where('[goalId+date]')
      .between([goalId, start], [goalId, end], true, true)
      .toArray();
    return rows.filter((e) => !e.deletedAt);
  }
}

class SettingsRepo {
  private static KEY = 'app';

  async get(): Promise<AppSettings> {
    const row = await db.settings.get(SettingsRepo.KEY);
    // 与默认值合并（ganttView 深合并一层），老数据缺新字段时自动补齐
    return {
      ...DEFAULT_SETTINGS,
      ...row?.value,
      ganttView: { ...DEFAULT_SETTINGS.ganttView, ...row?.value?.ganttView },
    };
  }

  async put(value: AppSettings): Promise<void> {
    await db.settings.put({ id: SettingsRepo.KEY, value });
  }
}

export const goalRepo = new BaseRepo<Goal>(db.goals);
export const taskRepo = new BaseRepo<Task>(db.tasks);
export const milestoneRepo = new BaseRepo<Milestone>(db.milestones);
export const checkInRepo = new CheckInRepo(db.checkIns);
export const exemptionRepo = new BaseRepo<ExemptionPeriod>(db.exemptions);
export const reviewRepo = new BaseRepo<MonthlyReview>(db.reviews);
export const settingsRepo = new SettingsRepo();

/** 清空全库（JSON 导入重建 / 清空示例数据） */
export async function clearAllData(): Promise<void> {
  await Promise.all([
    db.goals.clear(),
    db.tasks.clear(),
    db.milestones.clear(),
    db.checkIns.clear(),
    db.exemptions.clear(),
    db.reviews.clear(),
  ]);
}
