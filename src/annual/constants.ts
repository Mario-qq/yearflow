/**
 * 年报几何与阈值 —— 唯一来源（CLAUDE.md：尺寸/间距禁止散落魔数）。
 * 不塞 gantt/constants.ts（那是甘特域私有），也不塞 pomodoro/constants.ts。
 */

/** 叙事列宽。**必须与 Y3 导出长图的固定宽度同值**（规格 §4.5：900 CSS px） */
export const PAGE_W = 900;
/** 卡片内绘图区宽度 = PAGE_W − 页面左右 padding(24×2) − 卡片 padding(20×2) */
export const CHART_W = 812;

// ── 滚动揭示与数字滚动（规格 §4.3：叙事页的渐进揭示是功能性动效） ──────
/** 进入视口即揭示（阈值 0：beat 可能高于视口，用比例阈值会永不触发） */
export const REVEAL_THRESHOLD = 0;
/** 底部留 8% 余量，避免刚露一线就淡入 */
export const REVEAL_ROOT_MARGIN = '0px 0px -8% 0px';
/** hero 数字滚动时长 */
export const COUNT_DUR_MS = 520;

/** 跨页 emit 甘特事件的延时（沿用 CommandPalette 已验证的 gotoGantt 模式，不另发明） */
export const GOTO_GANTT_DELAY_MS = 150;

/**
 * SVG 里的条形圆角。**必须与 tokens.css 的 --radius-sm 同值**：
 * SVG 的 rx 是几何属性，attribute 形式不接受 var()，只能落成数字常量。
 */
export const SVG_RADIUS_SM = 4;

// ── 目标横条（beat 1） ──────────────────────────────────────────────
export const BAR_H = 16;
export const BAR_GAP = 12;
/** 左侧目标名列宽 */
export const BAR_LABEL_W = 148;
/** 右侧数值列宽 */
export const BAR_VALUE_W = 104;

// ── 月度完成率曲线（beat 2） ────────────────────────────────────────
export const LINE_H = 176;
export const LINE_PAD_T = 18;
export const LINE_PAD_B = 30;
export const LINE_PAD_L = 40;
export const LINE_PAD_R = 14;
export const LINE_DOT_R = 3.5;
/** 底部「应打卡量」参考柱的最大高度 */
export const LINE_COL_MAX_H = 34;
/** 参考柱宽占单月步宽的比例 */
export const LINE_COL_RATIO = 0.34;

// ── 错配镜双列对照（beat 3） ────────────────────────────────────────
export const MIRROR_ROW_H = 34;
export const MIRROR_PAD_T = 26;
export const MIRROR_PAD_B = 8;
/** 两列条形的宽度上限（各自向中线生长） */
export const MIRROR_COL_W = 258;
/** 两列之间留给目标名的通道宽 */
export const MIRROR_GAP = 172;
export const MIRROR_BAR_H = 14;

// ── 最强月 vs 最弱月的成组对照条（beat 4） ──────────────────────────
export const CMP_LABEL_W = 132;
export const CMP_VALUE_W = 132;
export const CMP_BAR_H = 13;
export const CMP_BAR_GAP = 5;
/** 一组 = 一个指标（两根条 + 组间距） */
export const CMP_GROUP_H = 2 * CMP_BAR_H + CMP_BAR_GAP + 20;

// ── 区间时间条（beat 0）与最长连续段（beat 5） ──────────────────────
export const TIMEBAR_H = 14;
export const TIMEBAR_TICK_H = 5;
export const TIMEBAR_LABEL_H = 18;
export const RUN_ROW_H = 26;
export const RUN_BAR_H = 12;
/** beat 5 左侧目标名列宽 */
export const RUN_LABEL_W = 148;
/** 打断日红点半径 */
export const RUN_BREAK_R = 4;
/** beat 5 最多列出多少条最长段（其余折叠为一行说明） */
export const RUN_MAX_ROWS = 8;

/** 完成率「达标」线：beat 2 结论句里的「过了 X%」 */
export const RATE_GOOD = 80;

// ── 漂移排行（beat 6） ──────────────────────────────────────────────
export const DRIFT_ROW_H = 24;
export const DRIFT_BAR_H = 12;
export const DRIFT_LABEL_W = 200;
export const DRIFT_VALUE_W = 56;
/** 最多列出多少个延后任务（其余折叠为一行说明，不无限拉长长图） */
export const DRIFT_MAX_ROWS = 10;

// ── 里程碑时间线（beat 7） ──────────────────────────────────────────
export const MS_AXIS_Y = 46;
export const MS_H = 96;
export const MS_DOT_R = 5;
/** 标签上下交错的纵向偏移 */
export const MS_LABEL_DY = 16;

// ── 节律热力（beat 9） ──────────────────────────────────────────────
/** 左侧星期名列宽 */
export const RHY_LABEL_W = 34;
export const RHY_CELL_H = 18;
export const RHY_CELL_GAP = 2;
/** 顶部小时刻度带高 */
export const RHY_AXIS_H = 14;
/** 热力最浅/最深的填充透明度（%），线性插值 */
export const RHY_ALPHA_MIN = 12;
export const RHY_ALPHA_MAX = 92;
/** 「最强时段」文字列表列出几条（同时供移动端降级用） */
export const RHY_TOP_N = 3;

// ── 停滞与放弃（beat 8） ────────────────────────────────────────────
/** 进度小条几何（卡片内，非 SVG 图） */
export const OUTCOME_BAR_H = 4;

// ── 导出长图（规格 §4.5） ──────────────────────────────────────────
/** 导出宽度固定 900 CSS px（= PAGE_W，两者必须同值） */
export const EXPORT_W = PAGE_W;
export const EXPORT_SCALE = 2;
/** 单张 PNG 的 CSS 高度硬上限：900×2 = 1800 宽，1800×20000 = 36M px，安全 */
export const EXPORT_MAX_H = 20000;
