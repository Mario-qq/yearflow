/**
 * bar 拖拽（SPEC 4.5）：移动 / 左右缘 resize / 跨泳道，全程 60fps——
 * 拖拽中只直写被拖 bar 的 style（transform 或 left/width），不触发 React 重渲；
 * React 仅在开始/结束时渲染原位虚影与状态。
 *
 * 几何：contentDx = 指针位移 + scrollLeft 位移（边缘自动滚动时指针不动 bar 也要走）。
 * 视觉连续跟手；提示与提交值吸附到天。松手：同泳道 120ms 归位动画后提交；
 * 跨泳道直接提交（React 重排到新泳道行）。Esc：120ms 归位不提交。
 */
import { useCallback, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { patchTask } from '../../store/actions';
import { useGanttUi } from '../uiStore';
import { rowAtY, type RowLayout } from '../rowLayout';
import { dateToX, type TimeScale } from '../timeScale';
import { diffDays, fmtDay, toDay } from '../../lib/date';
import { startPointerDrag } from '../lib/dragCore';
import { showDragHint, hideDragHint, fmtRangeHint } from '../lib/dragHint';
import { DUR_DROP_MS, EDGE_SCROLL_MAX_SPEED, EDGE_SCROLL_ZONE } from '../constants';

export type BarDragMode = 'move' | 'resize-l' | 'resize-r';

export interface DragGhost {
  taskId: string;
  x: number;
  width: number;
  rowTop: number;
  color: string;
}

const addDays = (date: string, n: number): string => fmtDay(toDay(date).add(n, 'day'));

export function useBarDrag(args: {
  scrollerRef: { current: HTMLDivElement | null };
  bodyRef: { current: HTMLDivElement | null };
  scaleRef: { current: TimeScale };
  layoutRef: { current: RowLayout };
  leftW: number;
}) {
  const { scrollerRef, bodyRef, scaleRef, layoutRef } = args;
  const leftWRef = useRef(args.leftW);
  leftWRef.current = args.leftW;
  const [ghost, setGhost] = useState<DragGhost | null>(null);

  const onBarDragStart = useCallback(
    (e: React.PointerEvent, taskId: string, mode: BarDragMode) => {
      if (e.button !== 0) return;
      const store = useStore.getState();
      const task = store.tasks[taskId];
      const scroller = scrollerRef.current;
      const body = bodyRef.current;
      const barEl = body?.querySelector<HTMLElement>(`[data-task-bar="${taskId}"]`);
      const scale = scaleRef.current;
      const layout = layoutRef.current;
      const originRow = layout.rowById[taskId];
      if (!task || !scroller || !body || !barEl || !originRow) return;

      const goalOf = (id: string) => useStore.getState().goals[id];
      const totalDays = diffDays(task.endDate, task.startDate) + 1;
      const x0 = dateToX(scale, task.startDate);
      const w0 = totalDays * scale.dayWidth;
      const startScrollLeft = scroller.scrollLeft;
      const startScrollTop = scroller.scrollTop;

      // 拖拽期间的实时值（提交时读取）
      let deltaDays = 0; // move：整体位移；resize：对应缘位移
      let targetGoalId = task.goalId;
      const pointer = { x: e.clientX, y: e.clientY };
      let rafId = 0;
      let active = false;

      const setBarTransition = (on: boolean) => {
        barEl.style.transition = on
          ? `transform ${DUR_DROP_MS}ms var(--ease), left ${DUR_DROP_MS}ms var(--ease), width ${DUR_DROP_MS}ms var(--ease)`
          : '';
      };

      const applyVisual = () => {
        const dxContent = pointer.x - e.clientX + (scroller.scrollLeft - startScrollLeft);
        const dyContent = pointer.y - e.clientY + (scroller.scrollTop - startScrollTop);
        if (mode === 'move') {
          deltaDays = Math.round(dxContent / scale.dayWidth);
          // 跨泳道：以指针所在行判定目标泳道（任意行类型均可）
          const bodyRect = body.getBoundingClientRect();
          const row = rowAtY(layout, pointer.y - bodyRect.top);
          targetGoalId = row ? row.goalId : task.goalId;
          useGanttUi.getState().setHoverRow(row && targetGoalId !== task.goalId ? row.id : null);
          barEl.style.transform = `translate(${dxContent}px, ${dyContent}px)`;
          showDragHint(
            pointer.x,
            pointer.y,
            fmtRangeHint(addDays(task.startDate, deltaDays), addDays(task.endDate, deltaDays)) +
              (targetGoalId !== task.goalId ? ` → ${goalOf(targetGoalId)?.name ?? ''}` : ''),
          );
        } else if (mode === 'resize-l') {
          // 左缘：吸附后最短 1 天
          deltaDays = Math.min(Math.round(dxContent / scale.dayWidth), totalDays - 1);
          const px = Math.min(dxContent, w0 - scale.dayWidth);
          barEl.style.left = `${x0 + px}px`;
          barEl.style.width = `${w0 - px}px`;
          showDragHint(pointer.x, pointer.y, fmtRangeHint(addDays(task.startDate, deltaDays), task.endDate));
        } else {
          deltaDays = Math.max(Math.round(dxContent / scale.dayWidth), -(totalDays - 1));
          barEl.style.width = `${Math.max(scale.dayWidth, w0 + dxContent)}px`;
          showDragHint(pointer.x, pointer.y, fmtRangeHint(task.startDate, addDays(task.endDate, deltaDays)));
        }
      };

      // 拖近视口左右边缘：匀速自动滚动（速度随深入线性加大）
      const edgeLoop = () => {
        if (!active) return;
        const rect = scroller.getBoundingClientRect();
        const tlLeft = rect.left + leftWRef.current;
        let v = 0;
        if (pointer.x < tlLeft + EDGE_SCROLL_ZONE) {
          v = -Math.min(EDGE_SCROLL_MAX_SPEED, ((tlLeft + EDGE_SCROLL_ZONE - pointer.x) / EDGE_SCROLL_ZONE) * EDGE_SCROLL_MAX_SPEED);
        } else if (pointer.x > rect.right - EDGE_SCROLL_ZONE) {
          v = Math.min(EDGE_SCROLL_MAX_SPEED, ((pointer.x - (rect.right - EDGE_SCROLL_ZONE)) / EDGE_SCROLL_ZONE) * EDGE_SCROLL_MAX_SPEED);
        }
        if (v !== 0) {
          scroller.scrollLeft += v;
          applyVisual();
        }
        rafId = requestAnimationFrame(edgeLoop);
      };

      const cleanup = () => {
        active = false;
        if (rafId) cancelAnimationFrame(rafId);
        hideDragHint();
        useGanttUi.getState().setDragTask(null);
        useGanttUi.getState().setHoverRow(null);
        setGhost(null);
        document.body.style.cursor = '';
      };

      /** 归位/落位动画后复原 style 并执行 done */
      const settleTo = (transform: string, left: number, width: number, done?: () => void) => {
        setBarTransition(true);
        barEl.style.transform = transform;
        barEl.style.left = `${left}px`;
        barEl.style.width = `${width}px`;
        setTimeout(() => {
          setBarTransition(false);
          barEl.style.transform = '';
          barEl.style.left = `${x0}px`;
          barEl.style.width = `${w0}px`;
          done?.();
        }, DUR_DROP_MS);
      };

      startPointerDrag(e, {
        onStart: () => {
          active = true;
          setBarTransition(false);
          useGanttUi.getState().setDragTask(taskId);
          setGhost({ taskId, x: x0, width: w0, rowTop: originRow.top, color: goalOf(task.goalId)?.color ?? 'goal-1' });
          document.body.style.cursor = mode === 'move' ? 'grabbing' : 'col-resize';
          rafId = requestAnimationFrame(edgeLoop);
        },
        onMove: (s) => {
          pointer.x = s.clientX;
          pointer.y = s.clientY;
          applyVisual();
        },
        onEnd: (s, committed) => {
          if (!s.started) return; // 单击：交给 hover/tooltip，不动数据
          const crossGoal = targetGoalId !== task.goalId;
          const noChange = deltaDays === 0 && !crossGoal;

          if (!committed || noChange) {
            // Esc 或原地松手：归位动画，不提交
            cleanup();
            settleTo('translate(0px, 0px)', x0, w0);
            return;
          }

          if (mode === 'move') {
            const patch: Parameters<typeof patchTask>[1] = {
              startDate: addDays(task.startDate, deltaDays),
              endDate: addDays(task.endDate, deltaDays),
            };
            let label = `移动任务「${task.name}」${deltaDays > 0 ? '+' : ''}${deltaDays}天`;
            if (crossGoal) {
              patch.goalId = targetGoalId;
              const siblings = Object.values(useStore.getState().tasks).filter(
                (t) => !t.deletedAt && t.goalId === targetGoalId,
              );
              patch.order = siblings.reduce((m, t) => Math.max(m, t.order), -1) + 1;
              label = `移动任务「${task.name}」→「${goalOf(targetGoalId)?.name ?? ''}」`;
            }
            cleanup();
            if (crossGoal) {
              // 跨泳道：立即提交，React 重排到新泳道（bar 颜色随目标色过渡）
              barEl.style.transform = '';
              patchTask(taskId, patch, label);
            } else {
              // 同泳道：120ms 吸附落位动画后提交
              settleTo(`translate(${deltaDays * scale.dayWidth}px, 0px)`, x0, w0, () =>
                patchTask(taskId, patch, label),
              );
            }
          } else if (mode === 'resize-l') {
            cleanup();
            settleTo('', x0 + deltaDays * scale.dayWidth, w0 - deltaDays * scale.dayWidth, () =>
              patchTask(taskId, { startDate: addDays(task.startDate, deltaDays) }, `调整任务「${task.name}」开始日`),
            );
          } else {
            cleanup();
            settleTo('', x0, w0 + deltaDays * scale.dayWidth, () =>
              patchTask(taskId, { endDate: addDays(task.endDate, deltaDays) }, `调整任务「${task.name}」结束日`),
            );
          }
        },
      });
    },
    [scrollerRef, bodyRef, scaleRef, layoutRef],
  );

  return { onBarDragStart, ghost };
}
