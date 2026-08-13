/**
 * 打卡点阵（月/周档，SPEC 4.4）：bar 正下方对齐日期列中心，只渲染应打卡日。
 * done=实心目标色 / partial=左半实心 / skipped=空心灰圈 / missed=淡红 /
 * 未来应打卡=8% 占位；今天的点外加一圈主色描边。列虚拟化：只画可视日期范围。
 *
 * 「有专注·未打卡」中间态（番茄钟规格 §8.6）：给 missed 与占位两种底态**加一圈 --warning 描边**。
 * 为什么是描边而不是「点内小竖线」：这两种底态恰好是全部五态里仅有的没有 stroke 的，描边是空闲
 * 维度；而 7px 直径里的 1px 竖线配上浮点 cx 必然落在半像素上，抗锯齿会把它糊成两列灰。
 * 今日环半径 4.5 > 点半径 3.5，两者本就分离、可以共存。
 * ⚠️ 该标记在 year / quarter 两档看不见 —— 日宽低于 HEAT_MODE_THRESHOLD 时点阵整体退化为
 * 热度条，这两档由打卡页补卡建议与 bar tooltip 兜底。
 */
import { memo } from 'react';
import type { TaskGantt } from '../lib/derive';
import { goalColor, goalColorAlpha } from '../lib/colors';
import { dayIndexOf, type TimeScale } from './timeScale';
import { BAR_DOT_GAP, BAR_H, BAR_TOP, DOT_D, DOT_FUTURE_ALPHA, DOT_ROW_H } from './constants';

interface Props {
  rowTop: number;
  /** bar 左缘 x（svg 原点） */
  x: number;
  width: number;
  scale: TimeScale;
  tg: TaskGantt;
  color: string;
  today: string;
  /** 可视日期范围（YYYY-MM-DD，闭区间），列虚拟化用 */
  visStartDate: string;
  visEndDate: string;
  taskId: string;
  /** 该任务当年有专注会话的日期（番茄钟 §8.6 中间态）；引用稳定，来自 GanttView 的单个 useMemo */
  focusDays?: Set<string>;
  /** 点击打卡点（≤今天）→ 就地 popover（SPEC 4.4）；未传则不可交互 */
  onDotClick?: (taskId: string, date: string, e: React.MouseEvent) => void;
}

/** 中间态描边（底态无 stroke 的两个分支才调用）；无专注时展开为空对象，零属性差异 */
function focusStroke(focusDays: Set<string> | undefined, date: string) {
  return focusDays?.has(date) ? { stroke: 'var(--warning)', strokeWidth: 1 } : {};
}

export const CheckinDots = memo(function CheckinDots({
  rowTop,
  x,
  width,
  scale,
  tg,
  color,
  today,
  visStartDate,
  visEndDate,
  taskId,
  focusDays,
  onDotClick,
}: Props) {
  const solid = goalColor(color);
  const r = DOT_D / 2;
  const cy = DOT_ROW_H / 2;
  const ringR = (DOT_ROW_H - 1) / 2;
  // 命中区半径：随日宽放大但不超过半列（避免相邻列重叠）
  const hitR = Math.max(r + 2, Math.min(scale.dayWidth / 2, 9));

  const dots = [];
  for (const d of tg.scheduledDays) {
    if (d < visStartDate || d > visEndDate) continue;
    const cx = (dayIndexOf(scale, d) + 0.5) * scale.dayWidth - x;
    const status = tg.statusByDate.get(d);
    const isToday = d === today;

    if (status === 'done') {
      dots.push(<circle key={d} cx={cx} cy={cy} r={r} fill={solid} />);
    } else if (status === 'partial') {
      dots.push(
        <g key={d}>
          <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} Z`} fill={solid} />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={solid} strokeWidth={1} />
        </g>,
      );
    } else if (status === 'skipped') {
      dots.push(
        <circle key={d} cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-strong)" strokeWidth={1} />,
      );
    } else if (tg.missedSet.has(d)) {
      // 走到这两个分支即「该任务该日没有打卡记录」⇒ 有专注就是中间态，无需再算一次「无打卡」
      dots.push(<circle key={d} cx={cx} cy={cy} r={r} fill="var(--missed-dot)" {...focusStroke(focusDays, d)} />);
    } else {
      // 今天未打 / 未来应打卡：占位点
      dots.push(
        <circle
          key={d}
          cx={cx}
          cy={cy}
          r={r}
          fill={goalColorAlpha(color, DOT_FUTURE_ALPHA)}
          {...focusStroke(focusDays, d)}
        />,
      );
    }
    if (isToday) {
      dots.push(
        <circle key={`${d}-ring`} cx={cx} cy={cy} r={ringR} fill="none" stroke="var(--accent)" strokeWidth={1} />,
      );
    }
    // 透明命中区（≤今天可点开 popover 打卡/补卡）
    if (onDotClick && d <= today) {
      dots.push(
        <circle
          key={`${d}-hit`}
          data-checkin-dot={d}
          cx={cx}
          cy={cy}
          r={hitR}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onClick={(e) => onDotClick(taskId, d, e)}
        />,
      );
    }
  }
  if (dots.length === 0) return null;

  return (
    <svg
      className="absolute"
      aria-hidden
      style={{ top: rowTop + BAR_TOP + BAR_H + BAR_DOT_GAP, left: x, overflow: 'visible' }}
      width={Math.max(1, width)}
      height={DOT_ROW_H}
    >
      {dots}
    </svg>
  );
});
