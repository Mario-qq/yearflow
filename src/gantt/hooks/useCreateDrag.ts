/**
 * 框选新建任务（SPEC 4.5）：任务行/幽灵行空白处按下水平拖出日期范围 →
 * 半透明预览条 → 松手进入 pending（名称气泡由 CreateOverlay 渲染）。
 * 目标行与行外空白不触发（留给多选框选）。
 */
import { useCallback, useState } from 'react';
import { rowAtY, type RowLayout } from '../rowLayout';
import { clampDayIndex, type TimeScale } from '../timeScale';
import { fmtDay, toDay } from '../../lib/date';
import { startPointerDrag } from '../lib/dragCore';
import { showDragHint, hideDragHint, fmtRangeHint } from '../lib/dragHint';

export interface CreatePreview {
  goalId: string;
  rowTop: number;
  rowKind: 'task' | 'ghost';
  startIdx: number;
  endIdx: number;
}

export interface CreatePending extends CreatePreview {
  startDate: string;
  endDate: string;
}

export const idxToDate = (scale: TimeScale, idx: number): string =>
  fmtDay(toDay(scale.yearStart).add(idx, 'day'));

export function useCreateDrag(args: {
  bodyRef: { current: HTMLDivElement | null };
  scaleRef: { current: TimeScale };
  layoutRef: { current: RowLayout };
}) {
  const { bodyRef, scaleRef, layoutRef } = args;
  const [preview, setPreview] = useState<CreatePreview | null>(null);
  const [pending, setPending] = useState<CreatePending | null>(null);

  const onBodyPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // bar、里程碑、气泡输入等交互元素上按下不触发框选
      if (target.closest('[data-task-bar],[data-milestone],[data-create-bubble]')) return;
      const body = bodyRef.current;
      if (!body) return;
      const scale = scaleRef.current;
      const layout = layoutRef.current;
      const bodyRect = body.getBoundingClientRect();
      const row = rowAtY(layout, e.clientY - bodyRect.top);
      if (!row || (row.kind !== 'task' && row.kind !== 'ghost')) return;
      const anchorIdx = clampDayIndex(scale, Math.floor((e.clientX - bodyRect.left) / scale.dayWidth));

      let cur: CreatePreview | null = null;
      startPointerDrag(e, {
        onStart: () => setPending(null),
        onMove: (s) => {
          const idx = clampDayIndex(scale, Math.floor((s.clientX - bodyRect.left) / scale.dayWidth));
          cur = {
            goalId: row.goalId,
            rowTop: row.top,
            rowKind: row.kind as 'task' | 'ghost',
            startIdx: Math.min(anchorIdx, idx),
            endIdx: Math.max(anchorIdx, idx),
          };
          setPreview(cur);
          showDragHint(
            s.clientX,
            s.clientY,
            fmtRangeHint(idxToDate(scale, cur.startIdx), idxToDate(scale, cur.endIdx)),
          );
        },
        onEnd: (s, committed) => {
          hideDragHint();
          setPreview(null);
          if (!s.started || !committed || !cur) return;
          setPending({
            ...cur,
            startDate: idxToDate(scale, cur.startIdx),
            endDate: idxToDate(scale, cur.endIdx),
          });
        },
      });
    },
    [bodyRef, scaleRef, layoutRef],
  );

  const clearPending = useCallback(() => setPending(null), []);
  return { onBodyPointerDown, preview, pending, clearPending };
}
