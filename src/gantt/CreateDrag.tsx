/**
 * 框选新建的渲染层：半透明预览条 + 松手后的迷你名称气泡（回车创建，Esc/失焦取消）。
 * 渲染在 timeline body 内，随滚动自然移动。拖拽逻辑见 hooks/useCreateDrag。
 */
import { memo } from 'react';
import { createTask } from '../store/actions';
import { useGanttUi } from './uiStore';
import { goalColorAlpha } from '../lib/colors';
import { useStore } from '../store/useStore';
import type { CreatePending, CreatePreview } from './hooks/useCreateDrag';
import { BAR_H, BAR_TOP, ROW_H_GHOST, ROW_H_TASK } from './constants';

export const CreateOverlay = memo(function CreateOverlay({
  preview,
  pending,
  dayWidth,
  onDone,
}: {
  preview: CreatePreview | null;
  pending: CreatePending | null;
  dayWidth: number;
  onDone: () => void;
}) {
  const goals = useStore((s) => s.goals);
  const flashTask = useGanttUi((s) => s.flashTask);
  const box = preview ?? pending;
  if (!box) return null;
  const color = goals[box.goalId]?.color ?? 'goal-1';
  // ghost 行较矮：预览条垂直居中
  const top = box.rowKind === 'ghost' ? box.rowTop + (ROW_H_GHOST - BAR_H) / 2 : box.rowTop + BAR_TOP;
  const left = box.startIdx * dayWidth;
  const width = (box.endIdx - box.startIdx + 1) * dayWidth;

  const commit = (value: string) => {
    if (!pending) return;
    const name = value.trim();
    onDone();
    if (!name) return;
    const id = createTask({ goalId: pending.goalId, name, startDate: pending.startDate, endDate: pending.endDate });
    flashTask(id);
  };

  return (
    <>
      <div
        className="pointer-events-none absolute"
        style={{
          top,
          left,
          width,
          height: BAR_H,
          borderRadius: 'var(--radius-md)',
          background: goalColorAlpha(color, 40),
          border: `1px dashed ${goalColorAlpha(color, 100)}`,
        }}
      />
      {pending && (
        <div
          data-create-bubble
          className="absolute flex items-center gap-2 px-2 py-1.5"
          style={{
            top: Math.max(0, top - ROW_H_TASK + 4),
            left,
            zIndex: 20,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <input
            autoFocus
            placeholder="任务名称…"
            style={{
              width: 168,
              fontSize: 'var(--font-12)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
              else if (e.key === 'Escape') onDone();
              e.stopPropagation();
            }}
            onBlur={() => onDone()}
            onPointerDown={(e) => e.stopPropagation()}
          />
          <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
            回车创建
          </span>
        </div>
      )}
    </>
  );
});
