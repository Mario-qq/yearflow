/**
 * 年报几何常量（SVG 坐标单位 = CSS px，图都按 viewBox 等比缩放）。
 * 颜色一律走 tokens.css；这里只放尺寸与节奏。
 */

/** 页面列最大宽度 */
export const PAGE_MAX_W = 960;

/** 封面年轮：每天一根放射状刻度 */
export const RING = {
  /** viewBox 边长 */
  size: 380,
  /** 刻度内缘半径 */
  inner: 104,
  /** 刻度最大长度（活动最强的一天） */
  maxLen: 64,
  /** 无活动/未来日的短刻度 */
  minLen: 4,
  /** 刻度宽度上限（季度只有 90 天时不至于粗成扇形） */
  maxTickW: 5,
  /** 刻度宽度占每天弧长的比例 */
  tickFill: 0.62,
  /** 月份数字所在半径 */
  labelR: 186,
  /** 强度归一的分位数：取 p90 而非最大值，一天爆肝不把全年压扁 */
  normQuantile: 0.9,
} as const;

/** 打卡热力图 */
export const HEAT = {
  cell: 12,
  gap: 3,
  /** 左侧星期标签列宽 */
  labelW: 22,
  /** 顶部月份标签行高 */
  labelH: 18,
  radius: 2.5,
  /** 底部「最长连续」括号区高度 */
  bracketH: 26,
} as const;

/** 专注节律 7×24 */
export const RHYTHM = {
  cell: 22,
  gap: 3,
  labelW: 28,
  labelH: 18,
  radius: 3,
} as const;

/** 月度柱 */
export const MONTHS = {
  height: 168,
  /** 柱宽占每月槽宽的比例 */
  barFill: 0.56,
  /** 堆叠段之间的间隙 */
  segGap: 2,
  radius: 4,
} as const;

/** 目标卡片里的 12 个月迷你柱 */
export const SPARK = { width: 120, height: 28, gap: 2 } as const;

/** 目标结局卡的进度环 */
export const PROGRESS_RING = { size: 44, stroke: 4 } as const;

/** 热力色阶的四档不透明度（%），与复盘页 YearHeatmap 同一套 */
export const LEVEL_ALPHA = [28, 52, 76, 100] as const;

/** 数字滚动时长 */
export const COUNT_UP_MS = 1100;

/** 年轮刻度逐根入场的间隔（ms），365 根 ≈ 1.1s */
export const RING_STAGGER_MS = 3;

/** 「各目标最长连续」最多列几行 */
export const MAX_RUN_ROWS = 6;

/** navigate('/gantt') 后等甘特图挂载再 emit 定位（与 CommandPalette 同值） */
export const GOTO_GANTT_DELAY_MS = 150;
