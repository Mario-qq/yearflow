/**
 * 周热度条（年/季档，SPEC 4.4）：按周聚合完成率，目标色 15%→100% 五档透明度；
 * 整周全缺=淡红；无应打卡的周不渲染。weekHeat 已裁至今天（未来周不出现）。
 * 任务行紧贴 bar 底；折叠目标行由 GoalSummary 传聚合数据复用。
 */
import { memo } from 'react';
import type { WeekHeat } from '../lib/derive';
import { goalColorAlpha } from '../lib/colors';
import { dayIndexOf, type TimeScale } from './timeScale';
import { HEAT_ALPHA_STEPS, HEAT_H } from './constants';

interface Props {
  /** 绝对 top（任务行 = bar 底；目标行折叠 = 汇总条下方） */
  top: number;
  /** 裁剪范围左缘 x（bar / 汇总条左缘，svg 原点） */
  x: number;
  width: number;
  scale: TimeScale;
  weekHeat: WeekHeat[];
  color: string;
}

export const HeatStrip = memo(function HeatStrip({ top, x, width, scale, weekHeat, color }: Props) {
  const rects = [];
  for (const w of weekHeat) {
    if (w.rate === null) continue;
    const startIdx = dayIndexOf(scale, w.weekStart);
    const x0 = Math.max(0, startIdx * scale.dayWidth - x);
    const x1 = Math.min(width, (startIdx + 7) * scale.dayWidth - x);
    if (x1 <= x0) continue;
    const fill = w.allMissed
      ? 'var(--missed-dot)'
      : goalColorAlpha(color, HEAT_ALPHA_STEPS[Math.min(HEAT_ALPHA_STEPS.length - 1, Math.floor(w.rate * HEAT_ALPHA_STEPS.length))]);
    rects.push(<rect key={w.weekStart} x={x0} y={0} width={x1 - x0} height={HEAT_H} fill={fill} />);
  }
  if (rects.length === 0) return null;

  return (
    <svg
      className="absolute"
      aria-hidden
      style={{ top, left: x }}
      width={Math.max(1, width)}
      height={HEAT_H}
    >
      {rects}
    </svg>
  );
});
