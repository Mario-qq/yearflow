/**
 * 多选批量操作条（SPEC 第六节）：选中 ≥1 时底部浮出。
 * 整体平移 N 天（输入框 ±）/ 改状态 / 改所属目标 / 删除；实时显示已选数量。
 */
import { useState } from 'react';
import { useStore } from '../store/useStore';
import { deleteTasks, patchTasks, shiftTasks } from '../store/actions';
import type { TaskStatus } from '../types/domain';
import { STATUS_LABEL, STATUS_ORDER } from './taskStatus';
import { useGanttUi } from './uiStore';
import { MINIMAP_H } from './constants';

const selectStyle: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  color: 'var(--text-primary)',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 6px',
};

export function BulkBar() {
  const selected = useGanttUi((s) => s.selectedTaskIds);
  const clearSelection = useGanttUi((s) => s.clearSelection);
  const goals = useStore((s) => s.goals);
  const [days, setDays] = useState('7');

  if (selected.length === 0) return null;
  const n = selected.length;
  const parsedDays = Math.round(Number(days));
  const canShift = Number.isFinite(parsedDays) && parsedDays !== 0;

  const shift = (sign: 1 | -1) => {
    if (!canShift) return;
    shiftTasks(selected, sign * Math.abs(parsedDays));
  };

  return (
    <div
      className="fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 px-4 py-2"
      style={{
        bottom: MINIMAP_H + 12,
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <span className="tnum font-semibold" style={{ fontSize: 'var(--font-12)' }}>
        已选 {n} 个任务
      </span>

      <span className="flex items-center gap-1" style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}>
        平移
        <button
          type="button"
          className="cursor-pointer hover:bg-subtle"
          style={{ ...selectStyle, padding: '2px 8px' }}
          disabled={!canShift}
          onClick={() => shift(-1)}
          title="整体前移"
        >
          −
        </button>
        <input
          className="tnum text-center"
          style={{ ...selectStyle, width: 44, outline: 'none' }}
          value={days}
          inputMode="numeric"
          onChange={(e) => setDays(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          className="cursor-pointer hover:bg-subtle"
          style={{ ...selectStyle, padding: '2px 8px' }}
          disabled={!canShift}
          onClick={() => shift(1)}
          title="整体后移"
        >
          ＋
        </button>
        天
      </span>

      <select
        style={selectStyle}
        value=""
        onChange={(e) => {
          const status = e.target.value as TaskStatus;
          if (!status) return;
          patchTasks(
            selected.map((id) => ({ id, patch: { status } })),
            `改 ${n} 个任务状态 → ${STATUS_LABEL[status]}`,
          );
        }}
      >
        <option value="" disabled>
          改状态…
        </option>
        {STATUS_ORDER.map((st) => (
          <option key={st} value={st}>
            {STATUS_LABEL[st]}
          </option>
        ))}
      </select>

      <select
        style={selectStyle}
        value=""
        onChange={(e) => {
          const goalId = e.target.value;
          if (!goalId) return;
          patchTasks(
            selected.map((id) => ({ id, patch: { goalId } })),
            `移动 ${n} 个任务 →「${goals[goalId]?.name ?? ''}」`,
          );
        }}
      >
        <option value="" disabled>
          改目标…
        </option>
        {Object.values(goals)
          .filter((g) => !g.deletedAt && !g.archived)
          .sort((a, b) => a.order - b.order)
          .map((g) => (
            <option key={g.id} value={g.id}>
              {g.icon} {g.name}
            </option>
          ))}
      </select>

      <button
        type="button"
        className="cursor-pointer hover:bg-subtle"
        style={{ ...selectStyle, color: 'var(--danger)' }}
        onClick={() => {
          if (!confirm(`删除选中的 ${n} 个任务？其打卡记录将一并删除。`)) return;
          deleteTasks(selected);
          clearSelection();
        }}
      >
        删除
      </button>

      <button
        type="button"
        className="cursor-pointer hover:bg-subtle"
        style={{ ...selectStyle, color: 'var(--text-tertiary)' }}
        onClick={clearSelection}
        title="清除选择（Esc）"
      >
        ✕
      </button>
    </div>
  );
}
