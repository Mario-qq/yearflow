/**
 * 打卡点阵（月/周档，SPEC 4.4）：bar 正下方对齐日期列中心，只渲染应打卡日。
 * done=实心目标色 / partial=左半实心 / skipped=空心灰圈 / missed=淡红 /
 * 未来应打卡=8% 占位；今天的点外加一圈主色描边。列虚拟化：只画可视日期范围。
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
}: Props) {
  const solid = goalColor(color);
  const r = DOT_D / 2;
  const cy = DOT_ROW_H / 2;
  const ringR = (DOT_ROW_H - 1) / 2;

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
      dots.push(<circle key={d} cx={cx} cy={cy} r={r} fill="var(--missed-dot)" />);
    } else {
      // 今天未打 / 未来应打卡：占位点
      dots.push(
        <circle key={d} cx={cx} cy={cy} r={r} fill={goalColorAlpha(color, DOT_FUTURE_ALPHA)} />,
      );
    }
    if (isToday) {
      dots.push(
        <circle key={`${d}-ring`} cx={cx} cy={cy} r={ringR} fill="none" stroke="var(--accent)" strokeWidth={1} />,
      );
    }
  }
  if (dots.length === 0) return null;

  return (
    <svg
      className="absolute"
      aria-hidden
      style={{ top: rowTop + BAR_TOP + BAR_H + BAR_DOT_GAP, left: x }}
      width={Math.max(1, width)}
      height={DOT_ROW_H}
    >
      {dots}
    </svg>
  );
});
