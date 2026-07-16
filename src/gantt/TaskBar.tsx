/**
 * 任务 bar（SPEC 4.4）：左侧实色 = 进度，右侧 25% 透明 = 剩余；
 * done 降饱和 + ✓，paused 45° 斜纹，active 落后 → 右上角警示角标。
 * bar 是 timeline body 内叶子元素（Phase 3 拖拽 transform 直接落在此元素）。
 */
import { memo } from 'react';
import type { Task } from '../types/domain';
import type { TaskGantt } from '../lib/derive';
import { goalColor, goalColorAlpha } from '../lib/colors';
import { barLabelWidth } from './lib/textWidth';
import {
  BAR_H,
  BAR_LABEL_PAD,
  BAR_REMAINDER_ALPHA,
  BAR_TOP,
  BEHIND_BADGE,
  PAUSED_STRIPE_W,
} from './constants';

interface Props {
  task: Task;
  /** 所在行 top（行几何来自 rowLayout） */
  rowTop: number;
  x: number;
  width: number;
  /** 目标色键（goal-1..5 或 hex） */
  color: string;
  tg: TaskGantt;
  onHover: (taskId: string | null, e?: { clientX: number; clientY: number }) => void;
}

export const TaskBar = memo(function TaskBar({ task, rowTop, x, width, color, tg, onHover }: Props) {
  const solid = goalColor(color);
  const fill =
    task.status === 'done' ? `color-mix(in srgb, ${solid} 55%, var(--bg-panel))` : solid;
  const label = task.status === 'done' ? `${task.name} ✓` : task.name;
  const labelW = barLabelWidth(label);
  const inside = labelW + BAR_LABEL_PAD * 2 <= width;
  const fillW = (width * tg.effectiveProgress) / 100;
  const labelOnFill = inside && fillW >= labelW + BAR_LABEL_PAD * 2;

  return (
    <>
      <div
        data-task-bar={task.id}
        className="absolute overflow-hidden"
        style={{
          top: rowTop + BAR_TOP,
          left: x,
          width,
          height: BAR_H,
          borderRadius: 'var(--radius-md)',
          background: goalColorAlpha(color, BAR_REMAINDER_ALPHA),
          boxShadow: 'inset 0 0 0 1px var(--bar-inner-stroke)',
          pointerEvents: 'auto',
        }}
        onPointerEnter={(e) => onHover(task.id, { clientX: e.clientX, clientY: e.clientY })}
        onPointerLeave={() => onHover(null)}
      >
        <div
          className="absolute bottom-0 left-0 top-0"
          style={{ width: `${tg.effectiveProgress}%`, background: fill }}
        />
        {task.status === 'paused' && (
          <div
            className="absolute inset-0"
            style={{
              background: `repeating-linear-gradient(45deg, var(--exemption-stripe) 0 ${PAUSED_STRIPE_W}px, transparent ${PAUSED_STRIPE_W}px ${PAUSED_STRIPE_W * 2}px)`,
            }}
          />
        )}
        {inside && (
          <span
            className="absolute overflow-hidden whitespace-nowrap"
            style={{
              left: BAR_LABEL_PAD,
              right: BAR_LABEL_PAD,
              lineHeight: `${BAR_H}px`,
              fontSize: 'var(--font-12)',
              color: labelOnFill ? 'var(--text-on-accent)' : 'var(--text-primary)',
            }}
          >
            {label}
          </span>
        )}
        {tg.isBehind && (
          <div
            className="absolute right-0 top-0"
            style={{
              width: 0,
              height: 0,
              borderTop: `${BEHIND_BADGE}px solid var(--warning)`,
              borderLeft: `${BEHIND_BADGE}px solid transparent`,
            }}
          />
        )}
      </div>
      {!inside && (
        <span
          className="absolute whitespace-nowrap"
          style={{
            top: rowTop + BAR_TOP,
            left: x + width + BAR_LABEL_PAD,
            lineHeight: `${BAR_H}px`,
            fontSize: 'var(--font-12)',
            color: 'var(--text-primary)',
          }}
        >
          {label}
        </span>
      )}
    </>
  );
});
