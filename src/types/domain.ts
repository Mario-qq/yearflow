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

/**
 * 打卡规则：定义哪些天"应该做"。
 * adhoc（随缘）= 不排期：不进每日「待打卡」、永不缺卡、不断 streak、进度只能手动；
 * 想记录时在打卡页「不定期」区随手补一次即可（见 derive/dayPanel adhocEntries）。
 */
export interface Recurrence {
  type: 'daily' | 'weekdays' | 'custom' | 'adhoc';
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
  /**
   * 执行轨道归属：同一 goal 内 trackId 相同的任务收成一条可折叠的轨道
   * （长期迭代项目的多段执行）。缺省 = 不属于任何轨道，独占一行。
   * 显式字段而非从 dependsOn 推导：依赖表达时序，轨道表达项目归属，二者不等价。
   */
  trackId?: string;
  /**
   * 不需要专注计时：番茄钟任务选择器默认不列出它（仍可搜索到，仍可手动选）。
   * 反向存储（缺省 = 参与）⇒ 老数据零迁移。只影响选择器的默认可见性，不影响任何统计口径。
   */
  noFocus?: boolean;
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

/** 一次暂停（ISO 时刻对）。until 缺省 = 该暂停尚未结束（仅出现在运行中状态，落库时必闭合） */
export interface FocusPause {
  at: string; // ISO
  until?: string; // ISO
}

/**
 * 会话结局：
 * completed = 跑到计划终点（含「到点自动结算」与「恢复时按计划终点结算」）
 * stopped   = 用户提前停止，按实际净时长记账
 * discarded = 用户主动丢弃 / 恢复时选择「不算」，不计入任何统计（留痕仅供审计）
 */
export type FocusOutcome = 'completed' | 'stopped' | 'discarded';

/**
 * 专注会话 = 一次专注（不是「一个番茄」）。是「真实投入时间」的唯一事实来源。
 * 只有已结束的会话入库；运行中状态在 localStorage（见 RunningState），不入库、不同步、不进 undo。
 * 行语义近似不可变：不含任何需要累加的字段 —— 这正是 append-only 行在整行 LWW 下天然安全的原因。
 */
export interface FocusSession {
  id: string; // nanoid。运行开始时预生成并存进 localStorage，结算时作为落库 id ⇒ 天然幂等
  goalId?: string; // 缺省 = 未归类（面板常驻「N 段未归类」清理入口）
  taskId?: string; // 缺省 = 只挂到目标，或完全未归类
  /**
   * YYYY-MM-DD。从 startAt 派生一次后冻结在字段里，绝不每次显示时重算（跨时区旅行会让整片历史漂移）。
   * ⚠️ 用户可经结果卡「一键改归相邻日」显式覆盖它 ⇒ date 与 startAt 允许永久不一致，
   * 任何迁移/修复脚本禁止从 startAt 重算 date（会把用户的显式修正静默改回去）。
   */
  date: string;
  startAt: string; // ISO，专注开始时刻
  endAt: string; // ISO，结算时刻
  focusMs: number; // 净专注毫秒：已扣暂停、已 clamp。结算后的权威值，不由 pauses 反算
  plannedMs: number; // 计划专注毫秒（结算截断上限）。手动补录时 = focusMs
  pauses?: FocusPause[]; // 审计与展示用；空数组不写。上限 PAUSE_LIMIT 段，超出合并最早的相邻两段
  outcome: FocusOutcome;
  source: 'timer' | 'manual'; // manual = 手动补录或事后编辑过时长；标记中性，不做降权
  needsReview?: boolean; // 结算异常待人确认（时钟跳变 / 超长 / 长时间失联后补算）
  note?: string;
  createdAt: string;
  updatedAt: string; // 补录/编辑一律用当前时间，不用会话发生时间（同步游标依赖它）
  deletedAt?: string;
}

/** 番茄钟阶段。休息段只存在于运行态，永不落库 */
export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak';

/** 运行态里的一次暂停（毫秒时刻，与 FocusPause 的 ISO 口径区分开） */
export interface RunningPause {
  at: number;
  until?: number;
}

/**
 * 运行中状态：localStorage `yearflow:pomodoro:running`，不入库、不同步、不进 undo。
 * 放在领域模型里是因为它是 settleSession/planRecovery 的输入契约（CLAUDE.md：领域模型唯一定义在此）。
 */
export interface RunningState {
  sessionId: string; // 预生成的 nanoid，结算时作为落库 id ⇒ 重复结算幂等
  phase: PomodoroPhase;
  goalId?: string;
  taskId?: string;
  startAt: number; // Date.now()，本段开始
  plannedMs: number;
  pauses: RunningPause[]; // 末条 until 缺省 = 正在暂停中
  lastHeartbeatAt: number; // 心跳，5 秒一次 + hidden/pagehide 各强制一次
}

/** 节律计数：localStorage `yearflow:pomodoro:cycle`，独立于 RunningState（后者每回 idle 即删） */
export interface CycleState {
  date: string; // YYYY-MM-DD
  completed: number; // 只有 outcome === 'completed' 才递增
  lastAt: number;
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
  /** 轨道默认折叠，故记「已展开」而非「已折叠」 */
  expandedTrackIds: string[];
  gridColumns: string[]; // 左侧网格显示哪些列
  gridWidth: number; // 左侧面板宽度 px
  gridCollapsed: boolean; // 整体折叠左栏 = 纯图模式
  gridColWidths: Record<string, number>; // 列宽覆盖（key = 列 key）
  showDependencies: boolean;
  showBaseline: boolean;
  /** 筛选：缺省淡出不匹配行（保持空间感），hideOthers=true 才真正收起 */
  filter: { status?: TaskStatus[]; goalIds?: string[]; hideOthers?: boolean };
}

/** 番茄钟偏好。属设备本地偏好（settings 不同步），故换设备需各配一次 */
export interface PomodoroSettings {
  focusMin: number; // 默认 25，取值 [1, 180]
  shortBreakMin: number; // 默认 5，取值 [1, 60]
  longBreakMin: number; // 默认 15，取值 [1, 120]
  longBreakEvery: number; // 默认 4，取值 [1, 12]（每 4 段专注后进长休息）
  sound: boolean; // 默认 true
  notify: boolean; // 默认 false（需浏览器授权，开启时才请求权限）
  /**
   * 专注到点后自动进入短/长休息倒计时，默认 true。
   * 只自动开休息，不自动开下一段专注 —— 自动续开 × 忘记停 = 整夜假记录。
   */
  autoBreak: boolean;
  /** 开始专注时自动弹出悬浮小窗（Document PiP），默认 false */
  pipAuto: boolean;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  weekStartsOn: 0 | 1;
  yearInView: number;
  /** 甘特图视图状态持久化：下次打开恢复原样 */
  ganttView: GanttViewState;
  /** 番茄钟偏好（取值范围在设置页 onBlur clamp 与 backup zod schema 两处强制） */
  pomodoro: PomodoroSettings;
  /** 一次性迁移标记：旧数据（5 色轮转）目标撞色已重新分配过（本地，不同步） */
  colorNormalized?: boolean;
}

/** 带同步元数据的实体（除 settings 外都满足） */
export interface SyncableEntity {
  id: string;
  updatedAt: string;
  deletedAt?: string;
}
