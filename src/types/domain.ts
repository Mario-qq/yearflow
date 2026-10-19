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
  /**
   * 屏幕时间关联：手机上这些应用的前台时长自动折算成本任务的打卡（scripts/screentime 采集，
   * 规则见 derive/screenTime.ts）。缺省 = 不关联 ⇒ 老数据零迁移。
   */
  screenTime?: ScreenTimeRule;
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

/**
 * 屏幕时间规则：
 * reach = 累计型（学习类）：关联应用合计 ≥ minutes 记「完成」，>0 不足记「做了一点」，0 不记
 * cap   = 上限型（娱乐类）：合计 ≤ minutes 记「完成」，超出不记（当天按缺卡显示）。
 *         上限型的时长只写进备注、不写 CheckIn.minutes —— minutes 会被统计成「投入时间」
 */
export interface ScreenTimeRule {
  apps: string[]; // 鸿蒙包名，如 yylx.danmaku.bili
  mode: 'reach' | 'cap';
  minutes: number; // reach = 目标分钟；cap = 上限分钟
}

/**
 * 一天的手机应用前台时长（原始数据，电脑端 scripts/screentime 经 hdc 读系统事件日志算出）。
 * id = date，一天一行；重采同一天整行覆盖。规则改了可按它重算历史打卡。
 */
export interface ScreenTimeDay {
  id: string; // = date
  date: string; // YYYY-MM-DD
  apps: Record<string, number>; // 包名 → 前台分钟（一位小数）
  collectedAt: string; // ISO，采集时刻
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
  /** 'screentime' = 屏幕时间自动打卡写入（重采时可被覆盖）；缺省 = 手动/卡片，自动打卡不改它的状态 */
  source?: 'screentime';
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

// ── 工作台（docs/DESK_SPEC.md §七）─────────────────────────────────────────

/** 紧急度三档：urgent 紧急（今天必须）/ soon 尽快（本周内）/ normal 普通 */
export type Urgency = 'urgent' | 'soon' | 'normal';
/** 工作 / 生活。工作类例行只在工作日出现（遵守休/班标记） */
export type WorkScope = 'work' | 'life';
/** dropped = 「不做了」，与「做完了」分开计数 */
export type WorkItemStatus = 'open' | 'done' | 'dropped';

/**
 * 工作台事项：待办与跟进同表（跟进 = 带对象的待办），排期、顺延、挪动同一套。
 * date 缺省 = 待处理（还没排日子）。过去没做完的不改 date，由派生层显示到今天。
 */
export interface WorkItem {
  id: string;
  kind: 'todo' | 'followup';
  title: string;
  note?: string;
  urgency: Urgency;
  scope: WorkScope;
  date?: string; // 排期日 YYYY-MM-DD；缺省 = 待处理
  dueDate?: string; // 截止日
  person?: string; // 跟进对象（kind=followup 必有）
  mode?: 'inform' | 'dispatch'; // 待告知 / 待下发
  goalId?: string; // 仅标签与筛选，不计入甘特进度
  /** 重要（艾森豪威尔矩阵的另一轴）：与紧急度独立；缺省 = 不重要 ⇒ 老数据零迁移 */
  important?: boolean;
  /** 「要事」：这件是 focusOn 那天必须做完的（每天最多 MAX_FOCUS 件，Ivy Lee 法）；不是那天就不算 */
  focusOn?: string;
  status: WorkItemStatus;
  doneAt?: string; // ISO，status 变 done/dropped 的时刻
  deferCount?: number; // 被往后挪的次数（拖延信号），缺省 0 ⇒ 老数据零迁移
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** 例行规则。weekday / daysOfWeek 一律 0=周日…6=周六（与 Recurrence 同口径） */
export type RoutineRule =
  | { type: 'daily' }
  | { type: 'workday' }
  | { type: 'weekly'; daysOfWeek: number[] }
  | { type: 'monthlyDay'; monthDay: number } // 1–31；-1 = 月末；超出当月天数落在月末
  | { type: 'monthlyNth'; nth: number; weekday: number }; // 第 nth 个周 X；nth=-1 = 最后一个

/** 例行事项（日常/周常/月常），按规则铺到周历上；每次完成记一条 RoutineLog */
export interface Routine {
  id: string;
  title: string;
  note?: string;
  scope: WorkScope;
  rule: RoutineRule;
  time?: string; // HH:mm，只用于排序与提醒
  startDate: string; // 规则从哪天起生效
  endDate?: string;
  paused?: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/**
 * 例行的一次发生的处理结果。id = `${routineId}:${date}`（确定性 id ⇒ 两台设备同时勾选不会出两条）。
 * date 永远是规则算出的原日期；moved = 这一次改到 movedTo 那天（规则不变），在新日期完成时 doneAt 记在本条。
 */
export interface RoutineLog {
  id: string;
  routineId: string;
  date: string;
  status: 'done' | 'skipped' | 'moved';
  movedTo?: string;
  doneAt?: string; // ISO
  doneOn?: string; // YYYY-MM-DD，实际在哪天做的（补做 = 晚于 date）
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** 休/班标记（调休、节假日）：只影响工作台「工作日」判定，不改甘特图 weekdays 规则口径 */
export interface DayMark {
  id: string; // = date
  date: string;
  type: 'off' | 'work';
  note?: string;
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
  /**
   * 悬浮小窗不透明度百分比，默认 100，取值 [30, 100]。
   * 仅桌面版生效（原生窗口的 setOpacity）；web 版的 Document PiP 无此能力，设置项也不渲染。
   * 下限 30 是硬约束：再低就看不清倒计时，而这个窗存在的唯一理由就是「到点了要看得见」。
   */
  pipOpacity: number;
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
  /** 工作台偏好（本地，不同步；DESK_SPEC §五 学习防忘） */
  desk: DeskSettings;
}

/** 学习锚点：「我会在 [午饭后] [12:30] 学习」。time 缺省 = 没定时间（不发第一次提醒） */
export interface StudyAnchor {
  time?: string; // HH:mm
  text?: string;
  /** 按星期覆盖时：这天不提醒 */
  off?: boolean;
}

export interface DeskSettings {
  /** 哪些目标算「学习」：学习卡只从这些目标当天该打卡的任务里挑 */
  studyGoalIds: string[];
  /** 「开始」一次学多久（分钟），也是「今天学够了」的口径；取值 [5, 180] */
  studyMinutes: number;
  /** 短版（分钟）：做完也算今天学过；取值 [5, 60] */
  shortMinutes: number;
  /** 每周学几天（周目标环）；取值 [1, 7] */
  weekTarget: number;
  /** 固定学习时间（第一次提醒） */
  anchor: StudyAnchor;
  /** 按星期分别设：下标 0=周日…6=周六；null/缺省 = 用 anchor */
  anchorByDow: (StudyAnchor | null)[];
  /** 最晚提醒 HH:mm：还没学再提醒一次「15 分钟也算」；缺省 = 不提醒 */
  lastCall?: string;
  /** 到点提醒总开关（只在桌面版生效） */
  remind: boolean;
  /** 工作台「年度计划」不显示的目标 / 任务（甘特图当天该打卡的不一定都想在工作台看到） */
  planHiddenGoals: string[];
  planHiddenTasks: string[];
  /** 下班收尾时间 HH:mm：到点后头部提示「收尾今天」，桌面版发一次通知；'' = 不提醒（缺省按 17:30） */
  shutdownAt?: string;
}

/** 带同步元数据的实体（除 settings 外都满足） */
export interface SyncableEntity {
  id: string;
  updatedAt: string;
  deletedAt?: string;
}
