/**
 * 背景网格（SPEC 4.2）：全宽 SVG，只渲染可视范围内的元素（由 buildTicks 裁剪）。
 * 1px 线取 Math.round(x)+0.5 保证清晰；免打卡区间用 45° 斜纹 pattern。
 */
import { memo } from 'react';
import type { GridLineLevel, ShadeCol, Ticks } from './timeScale';

const LINE_COLOR: Record<GridLineLevel, string> = {
  day: 'var(--border-subtle)',
  week: 'var(--border-subtle)',
  month: 'var(--border-default)',
  quarter: 'var(--border-strong)',
};

interface Props {
  width: number;
  height: number;
  ticks: Ticks;
  exemptionCols: ShadeCol[];
}

export const GridBackground = memo(function GridBackground({
  width,
  height,
  ticks,
  exemptionCols,
}: Props) {
  return (
    <svg
      width={width}
      height={height}
      className="absolute left-0 top-0"
      style={{ display: 'block' }}
      aria-hidden
    >
      <defs>
        <pattern
          id="exemption-hatch"
          patternUnits="userSpaceOnUse"
          width="6"
          height="6"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--exemption-stripe)" strokeWidth="2.5" />
        </pattern>
      </defs>
      {ticks.weekendCols.map((c) => (
        <rect
          key={c.key}
          x={c.x}
          y={0}
          width={c.width}
          height={height}
          fill="var(--weekend-tint)"
        />
      ))}
      {exemptionCols.map((c) => (
        <rect
          key={c.key}
          x={c.x}
          y={0}
          width={c.width}
          height={height}
          fill="url(#exemption-hatch)"
        />
      ))}
      {ticks.gridLines.map((l) => {
        const x = Math.round(l.x) + 0.5;
        return (
          <line
            key={`${l.level}-${l.x}`}
            x1={x}
            y1={0}
            x2={x}
            y2={height}
            stroke={LINE_COLOR[l.level]}
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
});
