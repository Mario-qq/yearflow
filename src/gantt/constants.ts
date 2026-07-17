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
export const ROW_H_GHOST = 24; // 目标分组末尾「+ 添加任务」幽灵行（hover 时显示内容）

/** 任务行内部纵向布局（Phase 2② 使用） */
export const BAR_TOP = 6; // bar 距行顶偏移（= 上留白）
export const BAR_H = 22;
export const BAR_DOT_GAP = 4;
export const DOT_ROW_H = 10;
export const DOT_D = 7; // 打卡点直径
export const HEAT_H = 3; // 热度条高度（紧贴 bar 底）
/** 日宽低于此值时打卡点阵退化为热度条 */
export const HEAT_MODE_THRESHOLD = 10;

/** bar 外观（SPEC 4.4） */
export const BAR_REMAINDER_ALPHA = 25; // 右侧剩余段透明度 %
export const BAR_LABEL_PAD = 6; // bar 内/外标签水平内边距
export const BAR_LABEL_FONT = 12; // 标签字号（textWidth 测量用）
export const BEHIND_BADGE = 7; // 落后警示角标（右上角三角）边长
export const PAUSED_STRIPE_W = 4; // paused 斜纹条纹宽

/** 打卡可视化透明度（%，配 color-mix） */
export const DOT_FUTURE_ALPHA = 8; // 未来应打卡占位点
export const HEAT_ALPHA_STEPS = [15, 36, 57, 78, 100]; // 周完成率五档

/** 目标行：汇总条与里程碑 */
export const SUMMARY_BAR_H = 6;
export const SUMMARY_HEAT_GAP = 2; // 折叠时聚合热度条与汇总条的间距
export const MILESTONE_D = 14; // 菱形对角线
export const MILESTONE_LABEL_GAP = 4; // 菱形与名称标签间距

/** bar tooltip */
export const TOOLTIP_DELAY_MS = 400; // 悬停出现延时
export const TOOLTIP_W = 240;
export const TOOLTIP_OFFSET = 12; // 距光标偏移

/** 表头：双层各 28px */
export const HEADER_LAYER_H = 28;
export const HEADER_H = HEADER_LAYER_H * 2;

/** 左侧任务网格：默认/最小/最大宽度、折叠后的窄轨宽、底部「+ 新建目标」行高 */
export const GRID_DEFAULT_W = 320;
export const GRID_MIN_W = 200;
export const GRID_MAX_W = 600;
export const GRID_RAIL_W = 24; // 纯图模式保留的展开轨
export const GRID_FOOTER_H = 36;
export const GRID_DIVIDER_HIT = 6; // 分隔条拖拽热区宽

/** Ctrl+滚轮连续缩放：灵敏度（deltaY→倍率指数）与松开吸附档位的静默时长 */
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;
export const WHEEL_ZOOM_SNAP_MS = 180;

/** 定位闪烁时长（左栏点击定位 bar / 命令面板跳转共用） */
export const FLASH_MS = 1100;

/** 今日线 */
export const TODAY_LINE_W = 2;
/** 表头今天日期的主色圆底直径 */
export const TODAY_BADGE_D = 18;

/** 动效时长（与 tokens.css --dur-zoom 一致；平滑滚动按距离取值、封顶） */
export const DUR_ZOOM_MS = 150;
export const SCROLL_TWEEN_MAX_MS = 600;

/** mini-map（Phase 2② 使用） */
export const MINIMAP_H = 28;
export const MINIMAP_LINE_H = 2; // 每目标的任务分布线段高
export const MINIMAP_PAD_Y = 4; // 泳道区上下留白

/** 目标分组行底色不透明度（盖在周末底纹之上仍保留网格可见性） */
export const GOAL_BAND_OPACITY = 0.6;

/** 虚拟化：可视窗口量化档（跨档才触发 React 重渲），buffer 各留一档 */
export const VIEWPORT_H_CHUNK = 400; // 水平 px
export const VIEWPORT_V_CHUNK = 300; // 垂直 px
