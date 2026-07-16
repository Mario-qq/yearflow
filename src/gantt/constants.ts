/**
 * 甘特图尺寸常量（SPEC 4.2）。颜色一律引用 tokens.css，这里只放几何量。
 *
 * 【铁律】滚动结构 = 单 scroller + CSS sticky（表头 sticky top、左栏 sticky left）。
 * scroller 之内、sticky 元素的任何祖先永远不得添加 transform / will-change / filter /
 * contain:paint —— 否则 sticky 在 Chrome 下会失效或错位。transform 只允许出现在
 * timeline body 内部的叶子元素上（任务 bar、拖拽虚影、落位动画）。
 */
import type { GanttZoom } from '../types/domain';

/** 四档缩放的日列宽（px/天）。dayWidth 是连续值（缩放动画/Ctrl+滚轮插值），布局全程浮点、paint 时才取整 */
export const ZOOM_DAY_WIDTH: Record<GanttZoom, number> = {
  year: 2.5,
  quarter: 8,
  month: 28,
  week: 56,
};

/** 行高 */
export const ROW_H_GOAL = 40; // 目标分组行
export const ROW_H_TASK = 48; // 任务行（bar 22 + 间距 4 + 点阵 10 + 上下留白 6×2）

/** 任务行内部纵向布局（Phase 2② 使用） */
export const BAR_H = 22;
export const BAR_DOT_GAP = 4;
export const DOT_ROW_H = 10;
export const DOT_D = 7; // 打卡点直径
export const HEAT_H = 3; // 热度条高度（紧贴 bar 底）
/** 日宽低于此值时打卡点阵退化为热度条 */
export const HEAT_MODE_THRESHOLD = 10;

/** 表头：双层各 28px */
export const HEADER_LAYER_H = 28;
export const HEADER_H = HEADER_LAYER_H * 2;

/** 左侧任务网格默认宽度 */
export const LEFT_W = 320;

/** 今日线 */
export const TODAY_LINE_W = 2;
/** 表头今天日期的主色圆底直径 */
export const TODAY_BADGE_D = 18;

/** 动效时长（与 tokens.css --dur-zoom 一致；平滑滚动按距离取值、封顶） */
export const DUR_ZOOM_MS = 150;
export const SCROLL_TWEEN_MAX_MS = 600;

/** mini-map（Phase 2② 使用） */
export const MINIMAP_H = 28;

/** 目标分组行底色不透明度（盖在周末底纹之上仍保留网格可见性） */
export const GOAL_BAND_OPACITY = 0.6;

/** 虚拟化：可视窗口量化档（跨档才触发 React 重渲），buffer 各留一档 */
export const VIEWPORT_H_CHUNK = 400; // 水平 px
export const VIEWPORT_V_CHUNK = 300; // 垂直 px
