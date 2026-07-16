/** 今日线：2px 主红色垂直线（「今」标签渲染在 sticky 表头里，见 TimelineHeader） */
import { TODAY_LINE_W } from './constants';

export function TodayLine({ x }: { x: number }) {
  return (
    <div
      className="absolute bottom-0 top-0"
      style={{
        left: Math.round(x) - TODAY_LINE_W / 2,
        width: TODAY_LINE_W,
        background: 'var(--danger)',
      }}
      aria-hidden
    />
  );
}
