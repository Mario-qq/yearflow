/**
 * 甘特图工具组（渲染在全局 48px 顶栏中间，仅 /gantt 路由）：
 * 年份 ◀▶ / 四档缩放分段控件 / 「今天」/ 依赖连线与基线开关 / 保存基线。
 * 直接读写 Zustand，通过 bus 向 GanttView 发命令。
 */
import { useStore } from '../store/useStore';
import type { GanttZoom } from '../types/domain';
import { saveBaselineAll } from '../store/actions';
import { showToast } from '../lib/toast';
import { emitGantt } from './bus';
import { FilterMenu } from './FilterMenu';

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

/** 视图开关小按钮（依赖连线 / 基线） */
function ToggleBtn({ on, label, title, onClick }: { on: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="cursor-pointer"
      role="switch"
      aria-checked={on}
      title={title}
      style={{
        fontSize: 'var(--font-12)',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--border-default)'}`,
        color: on ? 'var(--accent)' : 'var(--text-secondary)',
        background: on ? 'var(--accent-soft)' : 'var(--bg-panel)',
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function GanttToolbar() {
  const year = useStore((s) => s.settings.yearInView);
  const zoom = useStore((s) => s.settings.ganttView.zoom);
  const showDependencies = useStore((s) => s.settings.ganttView.showDependencies);
  const showBaseline = useStore((s) => s.settings.ganttView.showBaseline);
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

      <FilterMenu />

      <div className="flex items-center gap-1">
        <ToggleBtn
          on={showDependencies}
          label="连线"
          title="显示/隐藏依赖连线"
          onClick={() => updateGanttView({ showDependencies: !showDependencies })}
        />
        <ToggleBtn
          on={showBaseline}
          label="基线"
          title="显示/隐藏基线对比（快捷键 B）"
          onClick={() => updateGanttView({ showBaseline: !showBaseline })}
        />
        <button
          type="button"
          className="cursor-pointer hover:bg-subtle"
          style={ghostBtn}
          title="把当前所有任务起止保存为基线"
          onClick={() => {
            if (!confirm('把当前所有任务的起止日期保存为基线？将覆盖已有基线。')) return;
            const n = saveBaselineAll();
            updateGanttView({ showBaseline: true });
            showToast(`已保存基线（${n} 个任务）`);
          }}
        >
          保存基线
        </button>
        <button
          type="button"
          className="cursor-pointer hover:bg-subtle"
          style={ghostBtn}
          title="导出当前视图 PNG（含左侧网格）"
          onClick={() => emitGantt('export-png')}
        >
          导出
        </button>
      </div>
    </div>
  );
}
