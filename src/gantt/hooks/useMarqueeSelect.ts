/**
 * 行间空白框选多个 bar（SPEC 4.5 多选）：目标行/行外空白按下拖出矩形，
 * 与矩形相交的任务 bar 实时进入选中集；Esc 恢复原选择；未拖动的单击清除选择。
 *（任务行/幽灵行的空白拖动 = 框选新建，见 useCreateDrag——GanttView 按行类型分流）
 */
import { useCallback, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useGanttUi } from '../uiStore';
import type { RowLayout } from '../rowLayout';
import { dateToX, type TimeScale } from '../timeScale';
import { diffDays } from '../../lib/date';
import { startPointerDrag } from '../lib/dragCore';
import { BAR_H, BAR_TOP } from '../constants';

export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function useMarqueeSelect(args: {
  bodyRef: { current: HTMLDivElement | null };
  scaleRef: { current: TimeScale };
  layoutRef: { current: RowLayout };
}) {
  const { bodyRef, scaleRef, layoutRef } = args;
  const [rect, setRect] = useState<MarqueeRect | null>(null);

  const onMarqueeDown = useCallback(
    (e: React.PointerEvent) => {
      const body = bodyRef.current;
      if (!body) return;
      const bodyRect = body.getBoundingClientRect();
      const x0 = e.clientX - bodyRect.left;
      const y0 = e.clientY - bodyRect.top;
      const prevSelection = useGanttUi.getState().selectedTaskIds;

      startPointerDrag(e, {
        onMove: (s) => {
          const x1 = s.clientX - bodyRect.left;
          const y1 = s.clientY - bodyRect.top;
          const r: MarqueeRect = {
            x: Math.min(x0, x1),
            y: Math.min(y0, y1),
            w: Math.abs(x1 - x0),
            h: Math.abs(y1 - y0),
          };
          setRect(r);
          // 命中检测：任务 bar 矩形与框选矩形相交（按行序保序）
          const scale = scaleRef.current;
          const layout = layoutRef.current;
          const tasks = useStore.getState().tasks;
          const ids: string[] = [];
          for (const row of layout.rows) {
            if (row.kind !== 'task') continue;
            const t = tasks[row.id];
            if (!t) continue;
            const bx = dateToX(scale, t.startDate);
            const bw = (diffDays(t.endDate, t.startDate) + 1) * scale.dayWidth;
            const by = row.top + BAR_TOP;
            if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + BAR_H > r.y) {
              ids.push(row.id);
            }
          }
          useGanttUi.getState().setSelection(ids, ids[0] ?? null);
        },
        onEnd: (s, committed) => {
          setRect(null);
          const ui = useGanttUi.getState();
          if (!s.started) {
            ui.clearSelection(); // 空白单击 = 清除选择
            return;
          }
          if (!committed) ui.setSelection(prevSelection); // Esc 恢复
        },
      });
    },
    [bodyRef, scaleRef, layoutRef],
  );

  return { onMarqueeDown, marqueeRect: rect };
}
