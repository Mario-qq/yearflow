/**
 * 左侧网格表头（渲染在 scroller 左上角 sticky 单元内）：
 * 上层 = 「目标 / 任务」标题 + 列设置 ⚙ + 折叠 «；下层 = 列头（列宽可拖，右键/⚙ 显隐列）。
 * 折叠（纯图模式）时退化为窄轨，仅一个 » 展开按钮。
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { GRID_COLUMN_DEFS, columnWidth, visibleColumns } from './columns';
import { HEADER_LAYER_H } from '../constants';

const iconBtn: React.CSSProperties = {
  width: 20,
  height: 20,
  lineHeight: '20px',
  textAlign: 'center',
  fontSize: 'var(--font-12)',
  color: 'var(--text-tertiary)',
  borderRadius: 'var(--radius-sm)',
};

/** 列显隐菜单（⚙ 点击 / 列头右键弹出） */
function ColumnMenu({ anchor, onClose }: { anchor: { x: number; y: number }; onClose: () => void }) {
  const gridColumns = useStore((s) => s.settings.ganttView.gridColumns);
  const updateGanttView = useStore((s) => s.updateGanttView);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 py-1"
      style={{
        left: anchor.x,
        top: anchor.y,
        minWidth: 132,
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div className="px-3 py-1" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
        显示列
      </div>
      {GRID_COLUMN_DEFS.filter((d) => d.key !== 'name').map((d) => {
        const on = gridColumns.includes(d.key);
        return (
          <button
            key={d.key}
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left hover:bg-subtle"
            style={{ fontSize: 'var(--font-12)', color: 'var(--text-primary)' }}
            onClick={() =>
              updateGanttView({
                gridColumns: on ? gridColumns.filter((k) => k !== d.key) : [...gridColumns, d.key],
              })
            }
          >
            <span
              className="inline-block text-center"
              style={{ width: 14, color: on ? 'var(--accent)' : 'transparent' }}
            >
              ✓
            </span>
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

export function GridHeader({ collapsed }: { collapsed: boolean }) {
  const gridColumns = useStore((s) => s.settings.ganttView.gridColumns);
  const gridColWidths = useStore((s) => s.settings.ganttView.gridColWidths);
  const updateGanttView = useStore((s) => s.updateGanttView);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  if (collapsed) {
    return (
      <button
        type="button"
        className="flex h-full w-full cursor-pointer items-start justify-center pt-1 hover:bg-subtle"
        title="展开任务网格"
        style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-12)' }}
        onClick={() => updateGanttView({ gridCollapsed: false })}
      >
        »
      </button>
    );
  }

  const cols = visibleColumns(gridColumns);

  /** 拖列宽：pointer capture，rAF 直写 settings（persist 自带防抖） */
  const startResize = (e: React.PointerEvent, key: string, startW: number) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 指针已释放时无法捕获，放弃本次拖动
    }
    const startX = e.clientX;
    const def = GRID_COLUMN_DEFS.find((d) => d.key === key);
    let raf = 0;
    const onMove = (ev: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const w = Math.max(def?.minWidth ?? 32, startW + (ev.clientX - startX));
        const { settings, updateGanttView: update } = useStore.getState();
        update({ gridColWidths: { ...settings.ganttView.gridColWidths, [key]: w } });
      });
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (raf) cancelAnimationFrame(raf);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 上层：标题 + 控制 */}
      <div
        className="flex items-center gap-1 px-3"
        style={{ height: HEADER_LAYER_H, borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>目标 / 任务</span>
        <span className="flex-1" />
        <button
          type="button"
          className="cursor-pointer hover:bg-subtle"
          style={iconBtn}
          title="列设置"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenuAt({ x: r.left, y: r.bottom + 4 });
          }}
        >
          ⚙
        </button>
        <button
          type="button"
          className="cursor-pointer hover:bg-subtle"
          style={iconBtn}
          title="折叠网格（纯图模式）"
          onClick={() => updateGanttView({ gridCollapsed: true })}
        >
          «
        </button>
      </div>

      {/* 下层：列头 */}
      <div
        className="flex flex-1 items-center"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuAt({ x: e.clientX, y: e.clientY });
        }}
      >
        {cols.map((c, i) => {
          const w = columnWidth(c, gridColWidths);
          const isFlex = c.width === 0;
          return (
            <div
              key={c.key}
              className="relative flex h-full items-center"
              style={{
                width: isFlex ? undefined : w,
                flex: isFlex ? 1 : undefined,
                minWidth: c.minWidth,
                flexShrink: 0,
                paddingLeft: i === 0 ? 12 : 6,
                borderLeft: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                fontSize: 'var(--font-11)',
                color: 'var(--text-tertiary)',
              }}
            >
              {c.label}
              {!isFlex && (
                <div
                  className="absolute bottom-0 top-0 cursor-col-resize"
                  style={{ right: -3, width: 6, touchAction: 'none' }}
                  onPointerDown={(e) => startResize(e, c.key, w)}
                />
              )}
            </div>
          );
        })}
      </div>

      {menuAt && <ColumnMenu anchor={menuAt} onClose={() => setMenuAt(null)} />}
    </div>
  );
}
