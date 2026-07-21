/**
 * 领域模型 — 唯一事实来源（SPEC 第三节）
 * 派生概念（应打卡日/缺卡/streak/计划偏移）不入库，见 src/lib/derive/。
 */

/** 年度目标 = 甘特图的一条泳道（swimlane），如 "SAP系统" */
export interface Goal {
  id: string; // nanoid
  name: string;
  color: string; // 主题色，取自预设色板（tokens.css --goal-N）
  icon?: string; // emoji
  order: number; // 泳道排序
  archived: boolean;
  completedAt?: string; // 手动标记完成的时间戳（ISO）；缺省 = 未完成。完成 ≠ 归档隐藏
  createdAt: string; // ISO
  updatedAt: string;
  deletedAt?: string; // 软删除（同步用）
}

/** 打卡规则：定义哪些天"应该做" */
export interface Recurrence {
  type: 'daily' | 'weekdays' | 'custom';
  daysOfWeek?: number[]; // custom：0=周日...6=周六，如篮球 = [1,3,6]
}

export type TaskStatus = 'planned' | 'active' | 'done' | 'paused';

/** 阶段任务 = 甘特图上的一根 bar，隶属某个 Goal */
export interface Task {
  id: string;
  goalId: string;
  name: string; // 如 "SAP MM 模块学习"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD（含当日）
  progress: number; // 0-100
  progressMode: 'manual' | 'auto'; // auto = 已打卡天数 / 截至今天的应打卡天数
  status: TaskStatus;
  note?: string; // markdown 备注
  recurrence?: Recurrence;
  order: number;
  dependsOn?: string[]; // 轻量依赖（仅可视化连线与冲突提示，不做自动重排）
  baseline?: { startDate: string; endDate: string }; // 基线快照（原计划）
  updatedAt: string;
  deletedAt?: string;
}

/** 里程碑 = 泳道上的菱形节点，如 "PMP 考试日" */
export interface Milestone {
  id: string;
  goalId: string;
  name: string;
  date: string;
  achieved: boolean;
  updatedAt: string;
  deletedAt?: string;
}

export type CheckInStatus = 'done' | 'partial' | 'skipped';

/** 每日打卡记录 */
export interface CheckIn {
  id: string;
  goalId: string;
  taskId?: string;
  date: string; // YYYY-MM-DD
  status: CheckInStatus; // 完成 / 做了一点 / 有意跳过
  minutes?: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** 免打卡区间：出差/生病/长假，期间不判缺卡、不断 streak */
export interface ExemptionPeriod {
  id: string;
  startDate: string;
  endDate: string;
  goalIds?: string[]; // 缺省 = 全部目标
  reason?: string; // 如 "春节回家"
  updatedAt: string;
  deletedAt?: string;
}

/** 月度复盘 */
export interface MonthlyReview {
  id: string;
  month: string; // YYYY-MM
  content: string; // markdown
  rating?: number; // 1-5
  updatedAt: string;
  deletedAt?: string;
}

export type GanttZoom = 'year' | 'quarter' | 'month' | 'week';

export interface GanttViewState {
  zoom: GanttZoom;
  scrollDate: string; // 视口左缘日期
  collapsedGoalIds: string[];
  gridColumns: string[]; // 左侧网格显示哪些列
  gridWidth: number; // 左侧面板宽度 px
  gridCollapsed: boolean; // 整体折叠左栏 = 纯图模式
  gridColWidths: Record<string, number>; // 列宽覆盖（key = 列 key）
  showDependencies: boolean;
  showBaseline: boolean;
  /** 筛选：缺省淡出不匹配行（保持空间感），hideOthers=true 才真正收起 */
  filter: { status?: TaskStatus[]; goalIds?: string[]; hideOthers?: boolean };
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  weekStartsOn: 0 | 1;
  yearInView: number;
  /** 甘特图视图状态持久化：下次打开恢复原样 */
  ganttView: GanttViewState;
}

/** 带同步元数据的实体（除 settings 外都满足） */
export interface SyncableEntity {
  id: string;
  updatedAt: string;
  deletedAt?: string;
}
