/**
 * 番茄钟常量 —— 尺寸/几何/阈值的唯一来源（CLAUDE.md：禁止散落魔数）。
 * 不塞进 gantt/constants.ts：那是甘特域私有（文件头就是甘特滚动铁律）。
 */

// ── localStorage 键（运行态不入库、不同步、不进 undo） ──────────────────
export const RUNNING_KEY = 'yearflow:pomodoro:running';
export const CYCLE_KEY = 'yearflow:pomodoro:cycle';
export const LAST_TASK_KEY = 'yearflow:pomodoro:lastTask';
export const RECENT_TASKS_KEY = 'yearflow:pomodoro:recentTasks';

/** Web Locks 选主锁名：请求一把永不释放的锁，拿到者即 leader（标签崩溃自动释放） */
export const LOCK_NAME = 'yearflow-pomodoro';

// ── 时间阈值（规格按值执行） ──────────────────────────────────────────
/** 心跳间隔：崩溃/杀进程没有任何回调，心跳是唯一手段，最多丢这么久 */
export const HEARTBEAT_MS = 5_000;
/** 失联多久算「刚才不在」：超过则走结算对话或附 needsReview */
export const GAP_ASK_MS = 90_000;
/** 硬截断：一段专注从开始起超过 4 小时，强制结算并标记待确认 */
export const HARD_CUT_MS = 4 * 60 * 60 * 1000;
/** 不足 1 分钟不落库（误触噪音防线）：结算函数返回 null，不产生命令、不进 undo */
export const MIN_SESSION_MS = 60_000;
/** 暂停段上限：超出时合并最早的相邻两段，防狂点暂停把同步行撑大 */
export const PAUSE_LIMIT = 20;
/** 节律计数空闲清零：昨晚那几段不该污染今早的节奏 */
export const CYCLE_IDLE_RESET_MS = 2 * 60 * 60 * 1000;
/** 同文档内时钟跳变探测阈值（Date.now() 与 performance.now() 之差） */
export const CLOCK_JUMP_MS = 2_000;
/** 休息段错过多久就不补响铃了 */
export const BREAK_CHIME_GRACE_MS = 60_000;
/**
 * 自动开始休息的新鲜度窗口：只有「刚刚才到点」的结算才自动进休息。
 * 合盖两小时后回来补算的那一段，休息时间早就过去了，再弹一段休息倒计时是纯噪音。
 */
export const AUTO_BREAK_FRESH_MS = 60_000;
/**
 * follower 兜底结算的等待时长。leader 恰好是被冻结的后台标签时，
 * 它的闹钟根本不会触发 ⇒ 到点后没有任何标签结算、响铃。follower 等这么久后复查，
 * 运行态还在就自己接手（重复由预生成 sessionId + settledIds + storage 事件三重兜住）。
 */
export const ALARM_FALLBACK_MS = 3_000;

// ── 进度环几何（仓内第三处手写进度环，前两处：LeftGrid MonthRing、DayStrip） ──
export const RING_SIZE = 48; // 直径 px
export const RING_STROKE = 3;
export const RING_R = (RING_SIZE - RING_STROKE) / 2;
export const RING_CIRCUM = 2 * Math.PI * RING_R;

// ── 任务选择器下拉几何（TaskPicker：面板底部那批 compact 选择器离视口下沿很近） ──
/** 选项列表理想高度（原 max-h-56） */
export const PICKER_LIST_MAX = 224;
/** 列表再挤也不低于这个高度，否则宁可翻到上方开 */
export const PICKER_LIST_MIN = 96;
/** 下拉框除列表外的固定高度：搜索框 + 分组标题 + 底部「暂不归类」+ 内边距 */
export const PICKER_CHROME_H = 104;
/** 下拉框与触发按钮的间距（等价 mt-1） */
export const PICKER_GAP = 4;
/** 下拉框与视口边沿的安全距离 */
export const PICKER_VIEWPORT_MARGIN = 12;
/** 「最近」分组保留多少条（队列上限），以及下拉里最多显示几条 */
export const RECENT_TASKS_LIMIT = 8;
export const PICKER_RECENT_SHOWN = 5;

// ── 悬浮小窗（Document PiP）几何 ────────────────────────────────────────
export const PIP_W = 260;
export const PIP_H = 172;
/** 到点提醒态自动消退时长（照 title 闪烁的同一口径） */
export const ALERT_TTL_MS = 30_000;

// ── 提示音（OscillatorNode 现场合成，不引入音频文件） ─────────────────
export const CHIME_FREQS = [880, 1174] as const; // A5 → D6
export const CHIME_NOTE_MS = 90;
export const CHIME_GAIN = 0.16;
