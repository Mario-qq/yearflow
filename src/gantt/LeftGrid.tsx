/**
 * 左侧任务网格 —— 本步为最简骨架（目标行 icon+名称+任务数 / 任务行名称），
 * 行几何与时间轴共用 rowLayout，保证两侧严格对齐。
 * 多列、行内编辑、折叠交互、hover 联动在 Phase 3 实现。
 */
import { memo } from 'react';
import type { Goal, Task } from '../types/domain';
import type { RowLayout } from './rowLayout';
import { LEFT_W } from './constants';
import { goalColor } from '../lib/colors';

interface Props {
  layout: RowLayout;
  rowStart: number;
  rowEnd: number;
  goals: Record<string, Goal>;
  tasks: Record<string, Task>;
}

export const LeftGrid = memo(function LeftGrid({ layout, rowStart, rowEnd, goals, tasks }: Props) {
  return (
    <div
      className="sticky left-0 z-20"
      style={{
        width: LEFT_W,
        flexShrink: 0,
        height: layout.totalHeight,
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border-default)',
      }}
    >
      {layout.rows.slice(rowStart, rowEnd + 1).map((r) => {
        if (r.kind === 'goal') {
          const goal = goals[r.id];
          if (!goal) return null;
          const count = layout.taskRowsByGoal[r.id]?.length ?? 0;
          return (
            <div
              key={r.id}
              className="absolute left-0 right-0 flex items-center gap-2"
              style={{
                top: r.top,
                height: r.height,
                padding: '0 12px',
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border-subtle)',
                borderLeft: `3px solid ${goalColor(goal.color)}`,
              }}
            >
              <span style={{ fontSize: 'var(--font-14)' }}>{goal.icon}</span>
              <span
                className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold"
                style={{ fontSize: 'var(--font-13)' }}
              >
                {goal.name}
              </span>
              {count > 0 && (
                <span
                  className="tnum ml-auto"
                  style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
                >
                  {count} 任务
                </span>
              )}
            </div>
          );
        }
        const task = tasks[r.id];
        if (!task) return null;
        return (
          <div
            key={r.id}
            className="absolute left-0 right-0 flex items-center"
            style={{
              top: r.top,
              height: r.height,
              padding: '0 12px 0 32px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <span
              className="overflow-hidden text-ellipsis whitespace-nowrap"
              style={{ fontSize: 'var(--font-13)', color: 'var(--text-secondary)' }}
            >
              {task.name}
            </span>
          </div>
        );
      })}
    </div>
  );
});
