/**
 * 任务 bar（SPEC 4.4 / 4.5）：左侧实色 = 进度，右侧 25% 透明 = 剩余；
 * done 降饱和 + ✓，paused 45° 斜纹，active 落后 → 右上角警示角标。
 * 交互：整体 pointerdown 拖拽移动；左右缘 8px 热区 resize；拖拽中提升 z 并抑制 tooltip。
 * bar 是 timeline body 内叶子元素（拖拽 transform 直接落在此元素，不违反 sticky 铁律）。
 */
import { memo } from 'react';
import type { Task } from '../types/domain';
import type { TaskGantt } from '../lib/derive';
import { goalColor, goalColorAlpha } from '../lib/colors';
import { useGanttUi } from './uiStore';
import type { BarDragMode } from './hooks/useBarDrag';
import type { DepHandleSide } from './hooks/useDepDrag';
import { barLabelWidth } from './lib/textWidth';
import {
  BAR_H,
  BAR_LABEL_PAD,
  BAR_REMAINDER_ALPHA,
  BAR_TOP,
  BEHIND_BADGE,
  DEP_HANDLE_D,
  DEP_HANDLE_GAP,
  PAUSED_STRIPE_W,
  RESIZE_HANDLE_W,
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
  onDragStart: (e: React.PointerEvent, taskId: string, mode: BarDragMode) => void;
  onDepDragStart: (e: React.PointerEvent, taskId: string, side: DepHandleSide) => void;
}

export const TaskBar = memo(function TaskBar({
  task,
  rowTop,
  x,
  width,
  color,
  tg,
  onHover,
  onDragStart,
  onDepDragStart,
}: Props) {
  // 左右联动：hover 左侧行或本行任意处 → bar 加目标色描边；定位跳转 → 闪烁动画
  const linked = useGanttUi((s) => s.hoverRowId === task.id);
  const flashing = useGanttUi((s) => s.flashTaskId === task.id);
  const dragging = useGanttUi((s) => s.dragTaskId === task.id);
  // 依赖拖拽进行中，源任务的柄要一直挂载（哪怕 hover 已移到目标行），否则 capture 丢失
  const depDragging = useGanttUi((s) => s.depDragTaskId === task.id);
  const selected = useGanttUi((s) => s.selectedTaskIds.includes(task.id));
  const solid = goalColor(color);
  const fill =
    task.status === 'done' ? `color-mix(in srgb, ${solid} 55%, var(--bg-panel))` : solid;
  const label = task.status === 'done' ? `${task.name} ✓` : task.name;
  const labelW = barLabelWidth(label);
  const inside = labelW + BAR_LABEL_PAD * 2 <= width;
  const fillW = (width * tg.effectiveProgress) / 100;
  const labelOnFill = inside && fillW >= labelW + BAR_LABEL_PAD * 2;
  const showHandles = width >= RESIZE_HANDLE_W * 3;

  return (
    <>
      <div
        data-task-bar={task.id}
        className={`absolute overflow-hidden${flashing ? ' bar-flash' : ''}`}
        style={{
          top: rowTop + BAR_TOP,
          left: x,
          width,
          height: BAR_H,
          borderRadius: 'var(--radius-md)',
          background: goalColorAlpha(color, BAR_REMAINDER_ALPHA),
          boxShadow: dragging
            ? 'inset 0 0 0 1px var(--bar-inner-stroke), var(--shadow-lg)'
            : selected
              ? 'inset 0 0 0 1px var(--bar-inner-stroke), 0 0 0 2px var(--accent), 0 0 0 4px var(--accent-soft)'
              : linked
                ? `inset 0 0 0 1px var(--bar-inner-stroke), 0 0 0 2px ${solid}`
                : 'inset 0 0 0 1px var(--bar-inner-stroke)',
          zIndex: dragging ? 10 : undefined,
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
        onPointerEnter={(e) => {
          if (useGanttUi.getState().dragTaskId) return;
          onHover(task.id, { clientX: e.clientX, clientY: e.clientY });
        }}
        onPointerLeave={() => onHover(null)}
        onPointerDown={(e) => {
          onHover(null);
          onDragStart(e, task.id, 'move');
        }}
        onDoubleClick={() => useGanttUi.getState().setDrawerTask(task.id)}
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
        {/* 左右缘 resize 热区（8px，col-resize；窄 bar 不渲染避免吃掉移动热区） */}
        {showHandles && (
          <>
            <div
              className="absolute bottom-0 left-0 top-0"
              style={{ width: RESIZE_HANDLE_W, cursor: 'col-resize' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHover(null);
                onDragStart(e, task.id, 'resize-l');
              }}
            />
            <div
              className="absolute bottom-0 right-0 top-0"
              style={{ width: RESIZE_HANDLE_W, cursor: 'col-resize' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHover(null);
                onDragStart(e, task.id, 'resize-r');
              }}
            />
          </>
        )}
      </div>
      {!inside && (
        <span
          className="absolute whitespace-nowrap"
          style={{
            top: rowTop + BAR_TOP,
            left: x + width + BAR_LABEL_PAD + (linked ? DEP_HANDLE_D + DEP_HANDLE_GAP : 0),
            lineHeight: `${BAR_H}px`,
            fontSize: 'var(--font-12)',
            color: 'var(--text-primary)',
          }}
        >
          {label}
        </span>
      )}
      {/* 依赖连接柄：hover 本行时出现在 bar 两端外侧，拖到另一根 bar 建立 FS 依赖 */}
      {(linked || depDragging) && !dragging && (
        <>
          {(['left', 'right'] as const).map((side) => (
            <div
              key={side}
              className="absolute"
              style={{
                top: rowTop + BAR_TOP + (BAR_H - DEP_HANDLE_D) / 2,
                left:
                  side === 'left'
                    ? x - DEP_HANDLE_D - DEP_HANDLE_GAP
                    : x + width + DEP_HANDLE_GAP,
                width: DEP_HANDLE_D,
                height: DEP_HANDLE_D,
                borderRadius: '50%',
                background: 'var(--bg-raised)',
                border: `1.5px solid ${solid}`,
                cursor: 'crosshair',
                pointerEvents: 'auto',
                touchAction: 'none',
                zIndex: 5,
              }}
              title={side === 'right' ? '拖到另一任务建立依赖（本任务为前置）' : '拖到另一任务建立依赖（本任务为后继）'}
              onPointerDown={(e) => {
                e.stopPropagation();
                onDepDragStart(e, task.id, side);
              }}
            />
          ))}
        </>
      )}
    </>
  );
});
