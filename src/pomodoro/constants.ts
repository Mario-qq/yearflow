/**
 * 番茄钟常量 —— 尺寸/几何/阈值的唯一来源（CLAUDE.md：禁止散落魔数）。
 * 不塞进 gantt/constants.ts：那是甘特域私有（文件头就是甘特滚动铁律）。
 */

// ── localStorage 键（运行态不入库、不同步、不进 undo） ──────────────────
export const RUNNING_KEY = 'yearflow:pomodoro:running';
export const CYCLE_KEY = 'yearflow:pomodoro:cycle';
export const LAST_TASK_KEY = 'yearflow:pomodoro:lastTask';

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

// ── 进度环几何（仓内第三处手写进度环，前两处：LeftGrid MonthRing、DayStrip） ──
export const RING_SIZE = 48; // 直径 px
export const RING_STROKE = 3;
export const RING_R = (RING_SIZE - RING_STROKE) / 2;
export const RING_CIRCUM = 2 * Math.PI * RING_R;

// ── 提示音（OscillatorNode 现场合成，不引入音频文件） ─────────────────
export const CHIME_FREQS = [880, 1174] as const; // A5 → D6
export const CHIME_NOTE_MS = 90;
export const CHIME_GAIN = 0.16;
