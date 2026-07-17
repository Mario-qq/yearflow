/**
 * 顶栏筛选（SPEC 4.6）：按状态、按目标多选过滤。
 * 缺省淡出不匹配行（保持空间感）；「仅显示匹配项」才真正收起其余行。
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { STATUS_LABEL, STATUS_ORDER } from './taskStatus';
import { goalColor } from '../lib/colors';

export function FilterMenu() {
  const filter = useStore((s) => s.settings.ganttView.filter);
  const goals = useStore((s) => s.goals);
  const updateGanttView = useStore((s) => s.updateGanttView);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = (filter.status?.length ?? 0) > 0 || (filter.goalIds?.length ?? 0) > 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleStatus = (st: (typeof STATUS_ORDER)[number]) => {
    const cur = filter.status ?? [];
    const next = cur.includes(st) ? cur.filter((s) => s !== st) : [...cur, st];
    updateGanttView({ filter: { ...filter, status: next.length ? next : undefined } });
  };
  const toggleGoal = (id: string) => {
    const cur = filter.goalIds ?? [];
    const next = cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id];
    updateGanttView({ filter: { ...filter, goalIds: next.length ? next : undefined } });
  };

  const check = (on: boolean): React.CSSProperties => ({
    width: 14,
    textAlign: 'center',
    color: on ? 'var(--accent)' : 'transparent',
  });
  const item: React.CSSProperties = { fontSize: 'var(--font-12)', color: 'var(--text-primary)' };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="cursor-pointer hover:bg-subtle"
        style={{
          fontSize: 'var(--font-12)',
          padding: '2px 8px',
          borderRadius: 'var(--radius-sm)',
          border: `1px solid ${active ? 'var(--accent)' : 'var(--border-default)'}`,
          color: active ? 'var(--accent)' : 'var(--text-secondary)',
          background: active ? 'var(--accent-soft)' : 'var(--bg-panel)',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        筛选{active ? ` ·${(filter.status?.length ?? 0) + (filter.goalIds?.length ?? 0)}` : ''}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 py-1"
          style={{
            width: 188,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div className="px-3 py-1" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
            按状态
          </div>
          {STATUS_ORDER.map((st) => (
            <button
              key={st}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left hover:bg-subtle"
              style={item}
              onClick={() => toggleStatus(st)}
            >
              <span style={check(filter.status?.includes(st) ?? false)}>✓</span>
              {STATUS_LABEL[st]}
            </button>
          ))}
          <div className="px-3 py-1" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
            按目标
          </div>
          {Object.values(goals)
            .filter((g) => !g.deletedAt && !g.archived)
            .sort((a, b) => a.order - b.order)
            .map((g) => (
              <button
                key={g.id}
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left hover:bg-subtle"
                style={item}
                onClick={() => toggleGoal(g.id)}
              >
                <span style={check(filter.goalIds?.includes(g.id) ?? false)}>✓</span>
                <span
                  className="inline-block"
                  style={{ width: 8, height: 8, borderRadius: '50%', background: goalColor(g.color) }}
                />
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{g.name}</span>
              </button>
            ))}
          <div style={{ height: 1, margin: '4px 0', background: 'var(--border-subtle)' }} />
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left hover:bg-subtle"
            style={{ ...item, color: active ? 'var(--text-primary)' : 'var(--text-disabled)' }}
            disabled={!active}
            onClick={() => updateGanttView({ filter: { ...filter, hideOthers: !filter.hideOthers } })}
          >
            <span style={check(filter.hideOthers ?? false)}>✓</span>
            仅显示匹配项（收起其余）
          </button>
          <button
            type="button"
            className="block w-full cursor-pointer px-3 py-1 text-left hover:bg-subtle"
            style={{ ...item, color: active ? 'var(--danger)' : 'var(--text-disabled)' }}
            disabled={!active}
            onClick={() => updateGanttView({ filter: {} })}
          >
            清除筛选
          </button>
        </div>
      )}
    </div>
  );
}
