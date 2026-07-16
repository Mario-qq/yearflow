/**
 * 行层：目标分组底带 + 行分隔线。Phase 2② 在此之上渲染任务 bar / 打卡点阵 / 汇总条。
 * 行几何一律来自 rowLayout（与左侧网格严格同源）。
 */
import { memo } from 'react';
import type { RowLayout } from './rowLayout';
import { GOAL_BAND_OPACITY } from './constants';

interface Props {
  layout: RowLayout;
}

export const RowsLayer = memo(function RowsLayer({ layout }: Props) {
  return (
    <div className="absolute inset-0" aria-hidden>
      {layout.rows.map((r) => (
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
