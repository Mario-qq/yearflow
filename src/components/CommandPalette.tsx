/**
 * 命令面板（SPEC 第六节：/ 或 Ctrl+K）：模糊搜索任务/目标/操作，回车执行并跳转高亮定位。
 * 打开逻辑在 App（全局快捷键），本组件受控渲染。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { createGoal, saveBaselineAll } from '../store/actions';
import { downloadBackupJSON } from '../lib/download';
import { showToast } from '../lib/toast';
import { emitGantt } from '../gantt/bus';
import { useGanttUi } from '../gantt/uiStore';
import { goalColor } from '../lib/colors';
import type { GanttZoom } from '../types/domain';

interface Command {
  id: string;
  /** 分组徽标：命令 / 任务 / 目标 */
  kind: '命令' | '任务' | '目标';
  label: string;
  hint?: string;
  color?: string;
  run: () => void;
}

/** 简易模糊评分：前缀 3 / 包含 2 / 字符子序列 1 / 不匹配 0 */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return 1;
  }
  return 0;
}

const ZOOM_LABEL: Record<GanttZoom, string> = { year: '年', quarter: '季', month: '月', week: '周' };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  /** 去甘特页后再发定位命令（路由切换需等 GanttView 挂载） */
  const onGanttPage = pathname.startsWith('/gantt');
  const gotoGantt = (fn: () => void) => {
    if (onGanttPage) {
      fn();
    } else {
      navigate('/gantt');
      setTimeout(fn, 150);
    }
  };

  const commands = useMemo<Command[]>(() => {
    if (!open) return [];
    const s = useStore.getState();
    const year = s.settings.yearInView;
    const cmds: Command[] = [
      { id: 'today', kind: '命令', label: '回到今天', hint: 'T', run: () => gotoGantt(() => emitGantt('scroll-to-today')) },
      ...(['year', 'quarter', 'month', 'week'] as GanttZoom[]).map((z) => ({
        id: `zoom-${z}`,
        kind: '命令' as const,
        label: `缩放：${ZOOM_LABEL[z]}视图`,
        run: () => gotoGantt(() => useStore.getState().updateGanttView({ zoom: z })),
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `month-${i + 1}`,
        kind: '命令' as const,
        label: `切到 ${i + 1} 月`,
        run: () =>
          gotoGantt(() => emitGantt('scroll-to-date', { date: `${year}-${String(i + 1).padStart(2, '0')}-01` })),
      })),
      { id: 'new-goal', kind: '命令', label: '新建目标', run: () => gotoGantt(() => {
        const id = createGoal();
        useGanttUi.getState().setEditing({ id, field: 'goalName' });
      }) },
      { id: 'export-json', kind: '命令', label: '导出 JSON 备份', run: () => {
        downloadBackupJSON();
        showToast('已导出备份文件');
      } },
      { id: 'export-png', kind: '命令', label: '导出当前视图 PNG', run: () => gotoGantt(() => emitGantt('export-png')) },
      { id: 'save-baseline', kind: '命令', label: '保存基线（全部任务）', run: () => {
        const n = saveBaselineAll();
        useStore.getState().updateGanttView({ showBaseline: true });
        showToast(`已保存基线（${n} 个任务）`);
      } },
      { id: 'toggle-baseline', kind: '命令', label: '切换基线显示', hint: 'B', run: () => {
        const gv = useStore.getState().settings.ganttView;
        useStore.getState().updateGanttView({ showBaseline: !gv.showBaseline });
      } },
      { id: 'toggle-deps', kind: '命令', label: '切换依赖连线显示', run: () => {
        const gv = useStore.getState().settings.ganttView;
        useStore.getState().updateGanttView({ showDependencies: !gv.showDependencies });
      } },
      { id: 'go-checkin', kind: '命令', label: '打开今日打卡', hint: 'D', run: () => navigate('/checkin') },
      { id: 'go-review', kind: '命令', label: '打开月度复盘', run: () => navigate('/review') },
      { id: 'go-settings', kind: '命令', label: '打开设置', run: () => navigate('/settings') },
    ];
    for (const g of Object.values(s.goals)) {
      if (g.deletedAt || g.archived) continue;
      cmds.push({
        id: `goal-${g.id}`,
        kind: '目标',
        label: `${g.icon ?? ''} ${g.name}`,
        color: goalColor(g.color),
        run: () =>
          gotoGantt(() => {
            const first = Object.values(useStore.getState().tasks)
              .filter((t) => !t.deletedAt && t.goalId === g.id)
              .sort((a, b) => a.order - b.order)[0];
            if (first) emitGantt('locate-task', { taskId: first.id });
          }),
      });
    }
    for (const t of Object.values(s.tasks)) {
      if (t.deletedAt) continue;
      const goal = s.goals[t.goalId];
      cmds.push({
        id: `task-${t.id}`,
        kind: '任务',
        label: t.name,
        hint: goal?.name,
        color: goalColor(goal?.color ?? 'goal-1'),
        run: () => gotoGantt(() => emitGantt('locate-task', { taskId: t.id })),
      });
    }
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pathname]);

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, score: fuzzyScore(query, `${c.label} ${c.hint ?? ''}`) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 12).map((r) => r.c);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const exec = (c: Command) => {
    onClose();
    c.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center"
      style={{ background: 'rgba(0,0,0,0.25)', paddingTop: '15vh' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-fit w-full flex-col overflow-hidden"
        style={{
          maxWidth: 520,
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="搜索任务、目标或命令…"
          style={{
            padding: '12px 16px',
            fontSize: 'var(--font-14)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              const c = results[active];
              if (c) exec(c);
            } else if (e.key === 'Escape') {
              onClose();
            }
            e.stopPropagation();
          }}
        />
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-3" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
              没有匹配项
            </div>
          )}
          {results.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-4 py-1.5 text-left"
              style={{
                fontSize: 'var(--font-13)',
                background: i === active ? 'var(--accent-soft)' : 'transparent',
                color: 'var(--text-primary)',
              }}
              onPointerEnter={() => setActive(i)}
              onClick={() => exec(c)}
            >
              <span
                className="tnum shrink-0"
                style={{
                  fontSize: 'var(--font-11)',
                  color: 'var(--text-tertiary)',
                  width: 30,
                }}
              >
                {c.kind}
              </span>
              {c.color && (
                <span className="inline-block shrink-0" style={{ width: 8, height: 8, borderRadius: '50%', background: c.color }} />
              )}
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{c.label}</span>
              {c.hint && (
                <span className="shrink-0" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
                  {c.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
