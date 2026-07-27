/**
 * 汇总条几何渲染 —— 目标行与执行轨道行共用。
 * 单段（目标行）= 一条覆盖总跨度的细条；
 * 多段（轨道行）= 跨度上先铺一条浅色底条表示"没有任务覆盖"的间隙，
 * 再画各段实心，一眼看出这条执行路径在哪些区间真的在推进。
 */
import { memo } from 'react';
import { dateToX, type TimeScale } from './timeScale';
import { diffDays } from '../lib/date';
import { SUMMARY_BAR_H } from './constants';

export interface SummarySeg {
  startDate: string;
  endDate: string;
}

interface Props {
  top: number;
  scale: TimeScale;
  /** 总跨度（画间隙底条用；不传则不画底条） */
  span?: SummarySeg;
  segments: SummarySeg[];
  /** 实心段颜色（已含透明度） */
  color: string;
  /** 间隙底条颜色；不传则不画底条 */
  gapColor?: string;
  /** 段点击（轨道折叠条用；不传则整条不可交互） */
  onSegmentClick?: (index: number) => void;
  title?: string;
}

const segX = (scale: TimeScale, s: SummarySeg) => ({
  left: dateToX(scale, s.startDate),
  width: Math.max(1, (diffDays(s.endDate, s.startDate) + 1) * scale.dayWidth),
});

export const SummaryBar = memo(function SummaryBar({
  top,
  scale,
  span,
  segments,
  color,
  gapColor,
  onSegmentClick,
  title,
}: Props) {
  const gap = span && gapColor ? segX(scale, span) : null;
  return (
    <>
      {gap && (
        <div
          className="absolute"
          aria-hidden
          style={{
            top,
            left: gap.left,
            width: gap.width,
            height: SUMMARY_BAR_H,
            borderRadius: 'var(--radius-sm)',
            background: gapColor,
          }}
        />
      )}
      {segments.map((s, i) => {
        const { left, width } = segX(scale, s);
        return (
          <div
            key={`${s.startDate}-${s.endDate}`}
            className="absolute"
            title={title}
            style={{
              top,
              left,
              width,
              height: SUMMARY_BAR_H,
              borderRadius: 'var(--radius-sm)',
              background: color,
              pointerEvents: onSegmentClick ? 'auto' : undefined,
              cursor: onSegmentClick ? 'pointer' : undefined,
            }}
            onClick={onSegmentClick ? () => onSegmentClick(i) : undefined}
          />
        );
      })}
    </>
  );
});
