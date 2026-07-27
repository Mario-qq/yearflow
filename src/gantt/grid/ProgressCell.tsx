/**
 * 进度条 + 百分比 —— 任务行与轨道行共用的只读呈现。
 * 行内编辑（点击改进度）由调用方包在外层，轨道行的聚合进度不可直接编辑。
 */
import { memo } from 'react';

export const PROGRESS_PCT_W = 30;

export const ProgressMeter = memo(function ProgressMeter({
  value,
  color,
}: {
  /** 0-100 */
  value: number;
  color: string;
}) {
  return (
    <>
      <span
        className="relative min-w-0 flex-1 overflow-hidden"
        style={{ height: 4, borderRadius: 2, background: 'var(--bg-subtle)' }}
      >
        <span
          className="absolute bottom-0 left-0 top-0"
          style={{ width: `${value}%`, borderRadius: 2, background: color }}
        />
      </span>
      <span
        className="tnum"
        style={{
          fontSize: 'var(--font-11)',
          color: 'var(--text-tertiary)',
          width: PROGRESS_PCT_W,
          textAlign: 'right',
        }}
      >
        {value}%
      </span>
    </>
  );
});
