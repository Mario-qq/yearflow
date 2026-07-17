/**
 * 依赖连线的拖拽建立（SPEC 4.4）：从 bar 端点连接柄拖出虚线，落到另一根 bar 上建立 FS 依赖。
 * 右柄拖出 = 本任务为前置（指向后继）；左柄拖出 = 本任务为后继（选择前置）。
 * 拖动中命中的 bar 经 uiStore.hoverRowId 高亮。
 */
import { useCallback, useState } from 'react';
import { useStore } from '../../store/useStore';
import { addDependency } from '../../store/actions';
import { useGanttUi } from '../uiStore';
import { rowAtY, type RowLayout } from '../rowLayout';
import { dateToX, type TimeScale } from '../timeScale';
import { diffDays } from '../../lib/date';
import { startPointerDrag } from '../lib/dragCore';
import { BAR_H, BAR_TOP } from '../constants';

export type DepHandleSide = 'left' | 'right';

export interface DepLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 当前是否悬在合法目标上（虚线变实/变色） */
  snapped: boolean;
}

export function useDepDrag(args: {
  bodyRef: { current: HTMLDivElement | null };
  scaleRef: { current: TimeScale };
  layoutRef: { current: RowLayout };
}) {
  const { bodyRef, scaleRef, layoutRef } = args;
  const [depLine, setDepLine] = useState<DepLine | null>(null);

  const onDepDragStart = useCallback(
    (e: React.PointerEvent, taskId: string, side: DepHandleSide) => {
      if (e.button !== 0) return;
      const body = bodyRef.current;
      if (!body) return;
      const scale = scaleRef.current;
      const layout = layoutRef.current;
      const task = useStore.getState().tasks[taskId];
      const row = layout.rowById[taskId];
      if (!task || !row) return;
      const bodyRect = body.getBoundingClientRect();
      const x0 =
        side === 'right'
          ? dateToX(scale, task.startDate) + (diffDays(task.endDate, task.startDate) + 1) * scale.dayWidth
          : dateToX(scale, task.startDate);
      const y0 = row.top + BAR_TOP + BAR_H / 2;
      let hitId: string | null = null;

      startPointerDrag(e, {
        onMove: (s) => {
          const px = s.clientX - bodyRect.left;
          const py = s.clientY - bodyRect.top;
          hitId = null;
          const r = rowAtY(layout, py);
          if (r?.kind === 'task' && r.id !== taskId) {
            const t = useStore.getState().tasks[r.id];
            if (t) {
              const bx = dateToX(scale, t.startDate);
              const bw = (diffDays(t.endDate, t.startDate) + 1) * scale.dayWidth;
              if (px >= bx - 8 && px <= bx + bw + 8) hitId = r.id;
            }
          }
          useGanttUi.getState().setHoverRow(hitId);
          setDepLine({ x1: x0, y1: y0, x2: px, y2: py, snapped: !!hitId });
        },
        onEnd: (s, committed) => {
          setDepLine(null);
          useGanttUi.getState().setHoverRow(null);
          if (!s.started || !committed || !hitId) return;
          if (side === 'right') addDependency(taskId, hitId);
          else addDependency(hitId, taskId);
        },
      });
    },
    [bodyRef, scaleRef, layoutRef],
  );

  return { onDepDragStart, depLine };
}
