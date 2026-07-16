/**
 * 甘特图工具组（渲染在全局 48px 顶栏中间，仅 /gantt 路由）：
 * 年份 ◀▶ / 四档缩放分段控件 / 「今天」。直接读写 Zustand，通过 bus 向 GanttView 发命令。
 */
import { useStore } from '../store/useStore';
import type { GanttZoom } from '../types/domain';
import { emitGantt } from './bus';

const ZOOM_OPTIONS: { key: GanttZoom; label: string }[] = [
  { key: 'year', label: '年' },
  { key: 'quarter', label: '季' },
  { key: 'month', label: '月' },
  { key: 'week', label: '周' },
];

const ghostBtn: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  color: 'var(--text-secondary)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 6px',
};

export function GanttToolbar() {
  const year = useStore((s) => s.settings.yearInView);
  const zoom = useStore((s) => s.settings.ganttView.zoom);
  const updateSettings = useStore((s) => s.updateSettings);
  const updateGanttView = useStore((s) => s.updateGanttView);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="cursor-pointer hover:bg-subtle"
          style={ghostBtn}
          aria-label="上一年"
          onClick={() => updateSettings({ yearInView: year - 1 })}
        >
          ◀
        </button>
        <span className="tnum font-semibold" style={{ fontSize: 'var(--font-13)' }}>
          {year}
        </span>
        <button
          type="button"
          className="cursor-pointer hover:bg-subtle"
          style={ghostBtn}
          aria-label="下一年"
          onClick={() => updateSettings({ yearInView: year + 1 })}
        >
          ▶
        </button>
      </div>

      <div
        className="flex items-center"
        style={{ background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', padding: 2, gap: 2 }}
        role="radiogroup"
        aria-label="缩放级别"
      >
        {ZOOM_OPTIONS.map((opt) => {
          const active = opt.key === zoom;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={active}
              className="cursor-pointer"
              style={{
                fontSize: 'var(--font-12)',
                padding: '2px 10px',
                borderRadius: 'var(--radius-sm)',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: active ? 'var(--bg-panel)' : 'transparent',
                boxShadow: active ? 'var(--shadow-sm)' : 'none',
              }}
              onClick={() => updateGanttView({ zoom: opt.key })}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="cursor-pointer hover:bg-subtle"
        style={{
          fontSize: 'var(--font-12)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          padding: '2px 10px',
          background: 'var(--bg-panel)',
        }}
        onClick={() => emitGantt('scroll-to-today')}
      >
        今天
      </button>
    </div>
  );
}
