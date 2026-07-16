/**
 * 行层：目标分组底带 + 行分隔线（行虚拟化：只渲染 [rowStart, rowEnd]）。
 * 行几何一律来自 rowLayout（与左侧网格严格同源）。bar/点阵在 BarsLayer 渲染。
 */
import { memo } from 'react';
import type { RowLayout } from './rowLayout';
import { GOAL_BAND_OPACITY } from './constants';

interface Props {
  layout: RowLayout;
  rowStart: number;
  rowEnd: number;
}

export const RowsLayer = memo(function RowsLayer({ layout, rowStart, rowEnd }: Props) {
  return (
    <div className="absolute inset-0" aria-hidden>
      {layout.rows.slice(rowStart, rowEnd + 1).map((r) => (
        <div
          key={r.id}
          className="absolute left-0 right-0"
          style={{
            top: r.top,
            height: r.height,
            borderBottom: '1px solid var(--border-subtle)',
            background: r.kind === 'goal' ? 'var(--bg-subtle)' : 'transparent',
            opacity: r.kind === 'goal' ? GOAL_BAND_OPACITY : 1,
          }}
        />
      ))}
    </div>
  );
});
