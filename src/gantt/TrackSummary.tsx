/**
 * 执行轨道行时间轴侧：
 * - 折叠：包络汇总条（成员区间实心分段 + 间隙浅色）+ 下方聚合热度条；只读，
 *   单击某段 → 展开轨道并定位到那一段任务。
 * - 展开：只留一条低对比度的包络"括号"条，把下面的成员行圈起来，不再重复画热度。
 */
import { memo } from 'react';
import type { TrackGantt, Track } from '../lib/derive';
import { goalColorAlpha } from '../lib/colors';
import { dateToX, type TimeScale } from './timeScale';
import { diffDays } from '../lib/date';
import { HeatStrip } from './HeatStrip';
import { SummaryBar } from './SummaryBar';
import {
  ROW_H_TRACK,
  SUMMARY_BAR_H,
  SUMMARY_HEAT_GAP,
  TRACK_BRACKET_ALPHA,
  TRACK_SEG_GAP_ALPHA,
} from './constants';

interface Props {
  track: Track;
  tk: TrackGantt;
  rowTop: number;
  expanded: boolean;
  /** 目标色 key */
  color: string;
  scale: TimeScale;
  onSegmentClick: (trackId: string, segmentIndex: number) => void;
}

export const TrackSummary = memo(function TrackSummary({
  track,
  tk,
  rowTop,
  expanded,
  color,
  scale,
  onSegmentClick,
}: Props) {
  const barTop = rowTop + (ROW_H_TRACK - SUMMARY_BAR_H) / 2;

  if (expanded) {
    return (
      <SummaryBar
        top={barTop}
        scale={scale}
        segments={[tk.span]}
        color={goalColorAlpha(color, TRACK_BRACKET_ALPHA)}
      />
    );
  }

  const spanX = dateToX(scale, tk.span.startDate);
  const spanW = (diffDays(tk.span.endDate, tk.span.startDate) + 1) * scale.dayWidth;

  return (
    <>
      <SummaryBar
        top={barTop}
        scale={scale}
        span={tk.span}
        segments={tk.segments}
        color={goalColorAlpha(color, 55)}
        gapColor={goalColorAlpha(color, TRACK_SEG_GAP_ALPHA)}
        title={`${track.name} · ${track.memberIds.length} 步 · 聚合进度 ${Math.round(tk.progress)}%（点击展开）`}
        onSegmentClick={(i) => onSegmentClick(track.id, i)}
      />
      <HeatStrip
        top={barTop + SUMMARY_BAR_H + SUMMARY_HEAT_GAP}
        x={spanX}
        width={spanW}
        scale={scale}
        weekHeat={tk.heat}
        color={color}
      />
    </>
  );
});
