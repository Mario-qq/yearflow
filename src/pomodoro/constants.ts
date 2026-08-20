/**
 * 番茄钟常量 —— 尺寸/几何/阈值的唯一来源（CLAUDE.md：禁止散落魔数）。
 * 不塞进 gantt/constants.ts：那是甘特域私有（文件头就是甘特滚动铁律）。
 */

// ── localStorage 键（运行态不入库、不同步、不进 undo） ──────────────────
export const RUNNING_KEY = 'yearflow:pomodoro:running';
export const CYCLE_KEY = 'yearflow:pomodoro:cycle';
export const LAST_TASK_KEY = 'yearflow:pomodoro:lastTask';
export const RECENT_TASKS_KEY = 'yearflow:pomodoro:recentTasks';
/**
 * 到点提醒的跨窗口广播位。
 *
 * web 版不需要它：Document PiP 与主页面同一个 realm，一份 store 就够了。桌面版的小窗
 * 是独立窗口/独立 store，而响铃只发生在 Web Locks 选出的那一个 leader 上 —— 不广播的话
 * 「到点了」这件事只有 leader 那个窗口知道，另一个窗口一片安静。走 localStorage 而不是
 * IPC，是为了和 running/cycle 用同一条既有的 storage 事件通道，不新开一套机制。
 */
export const ALERT_KEY = 'yearflow:pomodoro:alert';
/**
 * 刚结算的那条 FocusSession 的广播位。
 *
 * 同样只有桌面版的双窗口需要：落库发生在 leader 那个窗口，另一个窗口的内存 store 不会
 * 自己知道，于是小窗的「今日 N 段 / 专注 X 分」会永远差最后一段。广播整条记录而不是
 * 发个「去重读 Dexie」的信号，是为了不和 persist.ts 的 500ms 防抖抢时序。
 */
export const COMMITTED_KEY = 'yearflow:pomodoro:committed';

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

/** 窗内自绘顶栏：Chromium 的系统标题栏只显示站点来源，网页改不了，阶段文案只能自己画 */
export const PIP_TOPBAR_H = 28;
/** 主操作（开始/暂停）实心圆直径 */
export const PIP_BTN_PRIMARY = 36;
/** 次操作（停止/跳过/知道了）描边圆直径 */
export const PIP_BTN_GHOST = 30;
/** 底部进度线高度 */
export const PIP_PROGRESS_H = 3;
/** 按钮内图标边长 */
export const PIP_ICON = 14;
/** 段点直径（顶栏右侧那排「第 N/M 段」） */
export const PIP_SEG_DOT = 5;
/** 完成印章（圆环 + 对勾）直径 */
export const PIP_STAMP = 40;

// ── 到点庆祝的纸屑（canvas 现场绘制，不引任何库） ──────────────────────
/** 两侧礼花筒各发多少片 */
export const CONFETTI_PER_CANNON = 26;
/** 总帧数 ≈ 2.2s @60fps，落完即清空画布，不做常驻动效 */
export const CONFETTI_FRAMES = 132;
/** 后 28% 帧数用于淡出 */
export const CONFETTI_FADE_FROM = 0.72;
/** 纸屑取哪几个目标色令牌：蓝 / 靛紫 / 青 / 橙 / 朱红（与 L3 底色同族） */
export const CONFETTI_TOKENS = ['--goal-1', '--goal-6', '--goal-7', '--goal-2', '--goal-5'] as const;
/** 纸片背面 = 正面压暗到这个比例（翻面时才看得出是一张纸而不是一个色块） */
export const CONFETTI_BACK_RATIO = 0.62;

// ── 提示音（OscillatorNode 现场合成，不引入音频文件） ─────────────────
export const CHIME_FREQS = [880, 1174] as const; // A5 → D6
export const CHIME_NOTE_MS = 90;
export const CHIME_GAIN = 0.16;
