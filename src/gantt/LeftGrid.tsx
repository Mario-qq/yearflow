/**
 * 左侧任务网格（SPEC 4.3 完全体）：
 * - 目标行：折叠箭头 + icon + 可编辑名称 + 本月完成率迷你环形 + streak🔥N + 任务数
 * - 任务行：多列（名称 / 起止 / 进度 / 状态点 + 可选打卡率 / 偏移列），全部行内编辑即存
 * - 左右联动：行 hover 写 uiStore；点击名称外空白 → 定位右侧 bar 并闪烁
 * - 每个分组末尾幽灵行「+ 添加任务」（hover 分组时浮现）；底部常驻「+ 新建目标」
 * - 右缘分隔条拖宽（双击复位），折叠为纯图模式时退化为窄轨
 * 行几何与时间轴共用 rowLayout，保证两侧严格对齐。
 */
import { memo, useMemo, useRef, useState } from 'react';
import type { Goal, Task } from '../types/domain';
import type { GoalGantt, TaskGantt } from '../lib/derive';
import { baselineDrift, goalMonthlyRate } from '../lib/derive';
import type { RowLayout } from './rowLayout';
import { useStore } from '../store/useStore';
import { createGoal, createTask, patchGoal, patchTask, reorderGoals } from '../store/actions';
import { useGanttUi } from './uiStore';
import { goalColor } from '../lib/colors';
import { toDay, fmtDay } from '../lib/date';
import { startPointerDrag } from './lib/dragCore';
import { visibleColumns, columnWidth, type GridColumnDef } from './grid/columns';
import { InlineInput } from './grid/InlineInput';
import { RowHoverOverlay } from './HoverLayers';
import { GRID_DEFAULT_W, GRID_FOOTER_H, GRID_MAX_W, GRID_MIN_W, GRID_DIVIDER_HIT } from './constants';

import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from './taskStatus';

/** 「3.01–5.31」紧凑起止格式 */
function fmtRange(start: string, end: string): string {
  const f = (s: string) => {
    const d = toDay(s);
    return `${d.month() + 1}.${String(d.date()).padStart(2, '0')}`;
  };
  return `${f(start)}–${f(end)}`;
}

/** 本月完成率迷你环形（目标行） */
function MonthRing({ rate, color }: { rate: number; color: string }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" aria-hidden style={{ flexShrink: 0 }}>
      <circle cx={7.5} cy={7.5} r={r} fill="none" stroke="var(--border-default)" strokeWidth={2.5} />
      <circle
        cx={7.5}
        cy={7.5}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray={`${(c * rate) / 100} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 7.5 7.5)"
      />
    </svg>
  );
}

interface GoalRowProps {
  goal: Goal;
  top: number;
  height: number;
  collapsed: boolean;
  taskCount: number;
  gg?: GoalGantt;
  today: string;
  /** 筛选淡出 */
  dim: boolean;
  /** 正在被拖动重排 */
  dragging: boolean;
  /** 双击 → 聚焦模式 */
  onFocus: (goalId: string) => void;
  /** 泳道重排拖拽回调（几何/落点由 LeftGrid 统一持有） */
  onDragStart: (goalId: string) => void;
  onDragMove: (clientY: number) => void;
  onDragEnd: (committed: boolean) => void;
}

const GoalRow = memo(function GoalRow({ goal, top, height, collapsed, taskCount, gg, today, dim, dragging, onFocus, onDragStart, onDragMove, onDragEnd }: GoalRowProps) {
  const editing = useGanttUi((s) => s.editing?.id === goal.id && s.editing.field === 'goalName');
  const setEditing = useGanttUi((s) => s.setEditing);
  const setHoverCell = useGanttUi((s) => s.setHoverCell);
  const solid = goalColor(goal.color);
  const monthRate = gg ? goalMonthlyRate(gg, today.slice(0, 7), today) : null;
  const streak = gg?.streak.current ?? 0;
  /** 拖拽后浏览器仍会补发一次 click：置位则吞掉，避免误触发折叠 */
  const suppressClick = useRef(false);

  const toggleCollapse = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const { settings, updateGanttView } = useStore.getState();
    const ids = settings.ganttView.collapsedGoalIds;
    updateGanttView({
      collapsedGoalIds: collapsed ? ids.filter((id) => id !== goal.id) : [...ids, goal.id],
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // 右键交给 onContextMenu
    suppressClick.current = false;
    startPointerDrag(e, {
      onStart: () => {
        suppressClick.current = true;
        onDragStart(goal.id);
      },
      onMove: (s) => onDragMove(s.clientY),
      onEnd: (s, committed) => {
        if (s.started) onDragEnd(committed);
      },
    });
  };

  return (
    <div
      className="absolute left-0 right-0 flex items-center gap-2"
      style={{
        top,
        height,
        padding: '0 12px 0 8px',
        background: 'var(--bg-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${solid}`,
        opacity: dim ? 0.35 : dragging ? 0.5 : 1,
        boxShadow: dragging ? 'var(--shadow-sm)' : undefined,
        cursor: dragging ? 'grabbing' : 'grab',
        transition: dragging ? undefined : 'opacity var(--dur-zoom) var(--ease)',
        touchAction: 'none',
        zIndex: dragging ? 3 : undefined,
      }}
      onPointerEnter={() => setHoverCell(goal.id, null)}
      onPointerDown={handlePointerDown}
      onClick={toggleCollapse}
      onDoubleClick={() => onFocus(goal.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        useGanttUi.getState().setContextMenu({ x: e.clientX, y: e.clientY, kind: 'goal', goalId: goal.id });
      }}
      title="拖动可调整顺序，单击折叠/展开，双击聚焦，右键更多操作"
    >
      <span
        aria-hidden
        className="inline-block text-center"
        style={{
          width: 14,
          fontSize: 10,
          color: 'var(--text-tertiary)',
          transform: collapsed ? 'none' : 'rotate(90deg)',
          transition: 'transform var(--dur-drop) var(--ease)',
        }}
      >
        ▶
      </span>
      <span style={{ fontSize: 'var(--font-14)' }}>{goal.icon}</span>
      {editing ? (
        <InlineInput
          defaultValue={goal.name}
          width={140}
          onCommit={(v) => {
            setEditing(null);
            const name = v.trim();
            if (name && name !== goal.name) patchGoal(goal.id, { name }, `重命名目标「${name}」`);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold"
          style={{ fontSize: 'var(--font-13)' }}
          title="点击重命名"
          onClick={(e) => {
            e.stopPropagation();
            setEditing({ id: goal.id, field: 'goalName' });
          }}
        >
          {goal.name}
        </span>
      )}
      {monthRate != null && (
        <span title={`本月完成率 ${monthRate}%`} className="flex items-center">
          <MonthRing rate={monthRate} color={solid} />
        </span>
      )}
      {streak > 0 && (
        <span className="tnum whitespace-nowrap" style={{ fontSize: 'var(--font-11)', color: 'var(--text-secondary)' }}>
          🔥{streak}
        </span>
      )}
      {taskCount > 0 && (
        <span className="tnum ml-auto" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
          {taskCount} 任务
        </span>
      )}
    </div>
  );
});

interface TaskRowProps {
  task: Task;
  top: number;
  height: number;
  cols: GridColumnDef[];
  colWidths: Record<string, number>;
  tg?: TaskGantt;
  dim: boolean;
  onLocate: (taskId: string) => void;
}

const TaskRow = memo(function TaskRow({ task, top, height, cols, colWidths, tg, dim, onLocate }: TaskRowProps) {
  const editing = useGanttUi((s) => (s.editing?.id === task.id ? s.editing.field : null));
  const setEditing = useGanttUi((s) => s.setEditing);
  const setHoverCell = useGanttUi((s) => s.setHoverCell);
  const progress = Math.round(tg?.effectiveProgress ?? task.progress);
  const solid = goalColor(useStore((s) => s.goals[task.goalId]?.color ?? 'goal-1'));

  const cycleStatus = () => {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(task.status) + 1) % STATUS_ORDER.length];
    patchTask(task.id, { status: next }, `任务「${task.name}」→ ${STATUS_LABEL[next]}`);
  };

  const cell = (c: GridColumnDef) => {
    switch (c.key) {
      case 'name':
        return editing === 'name' ? (
          <InlineInput
            defaultValue={task.name}
            onCommit={(v) => {
              setEditing(null);
              const name = v.trim();
              if (name && name !== task.name) patchTask(task.id, { name }, `重命名任务「${name}」`);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <span
            className="overflow-hidden text-ellipsis whitespace-nowrap"
            style={{ fontSize: 'var(--font-13)', color: 'var(--text-secondary)' }}
            title="点击重命名"
            onClick={(e) => {
              e.stopPropagation();
              setEditing({ id: task.id, field: 'name' });
            }}
          >
            {task.name}
          </span>
        );
      case 'dates':
        return (
          <span className="tnum whitespace-nowrap" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
            {fmtRange(task.startDate, task.endDate)}
          </span>
        );
      case 'progress':
        return editing === 'progress' ? (
          <InlineInput
            defaultValue={String(progress)}
            numeric
            onCommit={(v) => {
              setEditing(null);
              const n = Math.max(0, Math.min(100, Math.round(Number(v))));
              if (!Number.isFinite(n) || n === progress) return;
              patchTask(task.id, { progress: n, progressMode: 'manual' }, `设置进度 ${n}%`);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <span
            className="flex w-full items-center gap-1.5"
            title={task.progressMode === 'auto' ? `自动进度 ${progress}%（点击改为手动）` : '点击输入进度'}
            onClick={(e) => {
              e.stopPropagation();
              setEditing({ id: task.id, field: 'progress' });
            }}
          >
            <span
              className="relative min-w-0 flex-1 overflow-hidden"
              style={{ height: 4, borderRadius: 2, background: 'var(--bg-subtle)' }}
            >
              <span
                className="absolute bottom-0 left-0 top-0"
                style={{ width: `${progress}%`, borderRadius: 2, background: solid }}
              />
            </span>
            <span className="tnum" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', width: 30, textAlign: 'right' }}>
              {progress}%
            </span>
          </span>
        );
      case 'status':
        return (
          <button
            type="button"
            className="cursor-pointer"
            title={`${STATUS_LABEL[task.status]}（点击切换）`}
            style={{ padding: 4, lineHeight: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              cycleStatus();
            }}
          >
            <span
              className="inline-block"
              style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[task.status] }}
            />
          </button>
        );
      case 'checkRate': {
        const c2 = tg?.counts;
        const rate = c2 && c2.scheduled > 0 ? Math.round((c2.checked / c2.scheduled) * 100) : null;
        return (
          <span className="tnum" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
            {rate == null ? '—' : `${rate}%`}
          </span>
        );
      }
      case 'offset': {
        const drift = baselineDrift(task);
        const label = drift == null ? '—' : drift.endDriftDays === 0 ? '0' : `${drift.endDriftDays > 0 ? '+' : ''}${drift.endDriftDays}天`;
        return (
          <span
            className="tnum"
            style={{
              fontSize: 'var(--font-11)',
              color: drift && drift.endDriftDays > 0 ? 'var(--warning)' : 'var(--text-tertiary)',
            }}
          >
            {label}
          </span>
        );
      }
    }
  };

  return (
    <div
      className="absolute left-0 right-0 flex cursor-pointer items-center"
      style={{
        top,
        height,
        borderBottom: '1px solid var(--border-subtle)',
        opacity: dim ? 0.35 : 1,
        transition: 'opacity var(--dur-zoom) var(--ease)',
      }}
      onPointerEnter={() => setHoverCell(task.id, null)}
      onClick={() => onLocate(task.id)}
    >
      {cols.map((c, i) => {
        const isFlex = c.width === 0;
        return (
          <span
            key={c.key}
            className="flex min-w-0 items-center"
            style={{
              width: isFlex ? undefined : columnWidth(c, colWidths),
              flex: isFlex ? 1 : undefined,
              minWidth: c.minWidth,
              flexShrink: 0,
              paddingLeft: i === 0 ? 32 : 6,
              paddingRight: 6,
              justifyContent: c.key === 'status' ? 'center' : undefined,
            }}
          >
            {cell(c)}
          </span>
        );
      })}
    </div>
  );
});

/** 幽灵行「+ 添加任务」：hover 到本分组任意行时浮现 */
const GhostRow = memo(function GhostRow({
  goalId,
  top,
  height,
  layout,
  today,
}: {
  goalId: string;
  top: number;
  height: number;
  layout: RowLayout;
  today: string;
}) {
  const visible = useGanttUi((s) => {
    const h = s.hoverRowId;
    return h != null && (h === goalId || layout.rowById[h]?.goalId === goalId);
  });
  const setEditing = useGanttUi((s) => s.setEditing);
  const setHoverCell = useGanttUi((s) => s.setHoverCell);

  return (
    <button
      type="button"
      className="absolute left-0 right-0 cursor-pointer text-left"
      style={{
        top,
        height,
        paddingLeft: 32,
        fontSize: 'var(--font-12)',
        color: 'var(--text-tertiary)',
        borderBottom: '1px solid var(--border-subtle)',
        opacity: visible ? 1 : 0,
        transition: 'opacity var(--dur-drop) var(--ease)',
      }}
      onPointerEnter={() => setHoverCell(`ghost-${goalId}`, null)}
      onClick={() => {
        const id = createTask({
          goalId,
          startDate: today,
          endDate: fmtDay(toDay(today).add(13, 'day')),
        });
        setEditing({ id, field: 'name' });
      }}
    >
      ＋ 添加任务
    </button>
  );
});

interface Props {
  layout: RowLayout;
  rowStart: number;
  rowEnd: number;
  goals: Record<string, Goal>;
  tasks: Record<string, Task>;
  derive: Map<string, GoalGantt>;
  today: string;
  leftW: number;
  collapsed: boolean;
  /** 筛选淡出集合（hideOthers 时为空集） */
  dimTaskIds: Set<string>;
  dimGoalIds: Set<string>;
  onLocateTask: (taskId: string) => void;
  onFocusGoal: (goalId: string) => void;
}

export const LeftGrid = memo(function LeftGrid({
  layout,
  rowStart,
  rowEnd,
  goals,
  tasks,
  derive,
  today,
  leftW,
  collapsed,
  dimTaskIds,
  dimGoalIds,
  onLocateTask,
  onFocusGoal,
}: Props) {
  const gridColumns = useStore((s) => s.settings.ganttView.gridColumns);
  const gridColWidths = useStore((s) => s.settings.ganttView.gridColWidths);
  const collapsedGoalIds = useStore((s) => s.settings.ganttView.collapsedGoalIds);
  const setEditing = useGanttUi((s) => s.setEditing);
  const setHoverCell = useGanttUi((s) => s.setHoverCell);
  const cols = visibleColumns(gridColumns);

  // ── 目标泳道纵向拖拽重排 ────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  /** 拖拽中：被拖目标 id + 插入位下标（原顺序空位，0..n） + 落点指示线 y */
  const [goalDrag, setGoalDrag] = useState<{ id: string; index: number; indicatorY: number } | null>(null);
  /** 按 top 升序的目标行（rowLayout 已按 order 排好） */
  const goalRows = useMemo(() => layout.rows.filter((r) => r.kind === 'goal'), [layout.rows]);

  /** 光标 layout-y → 插入下标 + 指示线 y（落在目标块中线之上则插到该块前） */
  const resolveDrop = (layoutY: number): { index: number; indicatorY: number } => {
    for (let i = 0; i < goalRows.length; i++) {
      const blockTop = goalRows[i].top;
      const blockBottom = i + 1 < goalRows.length ? goalRows[i + 1].top : layout.totalHeight;
      if (layoutY < (blockTop + blockBottom) / 2) return { index: i, indicatorY: blockTop };
    }
    return { index: goalRows.length, indicatorY: layout.totalHeight };
  };

  const handleGoalDragStart = (goalId: string) => {
    const from = goalRows.findIndex((r) => r.id === goalId);
    setGoalDrag({ id: goalId, index: from, indicatorY: goalRows[from]?.top ?? 0 });
  };

  const handleGoalDragMove = (clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { index, indicatorY } = resolveDrop(clientY - rect.top);
    setGoalDrag((prev) => (prev && (prev.index !== index || prev.indicatorY !== indicatorY) ? { ...prev, index, indicatorY } : prev));
  };

  const handleGoalDragEnd = (committed: boolean) => {
    setGoalDrag((prev) => {
      if (prev && committed) {
        const ids = goalRows.map((r) => r.id);
        const from = ids.indexOf(prev.id);
        const insertAt = prev.index > from ? prev.index - 1 : prev.index;
        if (from !== -1 && insertAt !== from) {
          const without = ids.filter((id) => id !== prev.id);
          without.splice(insertAt, 0, prev.id);
          reorderGoals(without);
        }
      }
      return null;
    });
  };

  /** 分隔条拖宽（rAF 直写 settings，persist 防抖）；双击复位默认宽 */
  const startDividerDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 指针已释放时无法捕获，放弃本次拖动
    }
    const startX = e.clientX;
    const startW = useStore.getState().settings.ganttView.gridWidth;
    let raf = 0;
    const onMove = (ev: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const w = Math.max(GRID_MIN_W, Math.min(GRID_MAX_W, startW + (ev.clientX - startX)));
        useStore.getState().updateGanttView({ gridWidth: w });
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
    <div
      ref={rootRef}
      className="sticky left-0 z-20"
      style={{
        width: leftW,
        flexShrink: 0,
        height: layout.totalHeight + GRID_FOOTER_H,
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border-default)',
      }}
      onPointerLeave={() => setHoverCell(null, null)}
    >
      {!collapsed && (
        <>
          {layout.rows.slice(rowStart, rowEnd + 1).map((r) => {
            if (r.kind === 'goal') {
              const goal = goals[r.id];
              if (!goal) return null;
              return (
                <GoalRow
                  key={r.id}
                  goal={goal}
                  top={r.top}
                  height={r.height}
                  collapsed={collapsedGoalIds.includes(r.id)}
                  taskCount={layout.taskRowsByGoal[r.id]?.length ?? 0}
                  gg={derive.get(r.id)}
                  today={today}
                  dim={dimGoalIds.has(r.id)}
                  dragging={goalDrag?.id === r.id}
                  onFocus={onFocusGoal}
                  onDragStart={handleGoalDragStart}
                  onDragMove={handleGoalDragMove}
                  onDragEnd={handleGoalDragEnd}
                />
              );
            }
            if (r.kind === 'ghost') {
              return (
                <GhostRow key={r.id} goalId={r.goalId} top={r.top} height={r.height} layout={layout} today={today} />
              );
            }
            const task = tasks[r.id];
            if (!task) return null;
            return (
              <TaskRow
                key={r.id}
                task={task}
                top={r.top}
                height={r.height}
                cols={cols}
                colWidths={gridColWidths}
                tg={derive.get(r.goalId)?.perTask.get(r.id)}
                dim={dimTaskIds.has(r.id) || dimGoalIds.has(r.goalId)}
                onLocate={onLocateTask}
              />
            );
          })}

          <RowHoverOverlay layout={layout} />

          {/* 泳道重排落点指示线 */}
          {goalDrag && (
            <div
              className="pointer-events-none absolute left-0 right-0"
              style={{
                top: goalDrag.indicatorY - 1,
                height: 2,
                background: 'var(--accent)',
                zIndex: 4,
              }}
            >
              <span
                className="absolute"
                style={{
                  left: 2,
                  top: -3,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                }}
              />
            </div>
          )}

          {/* 底部常驻「+ 新建目标」 */}
          <button
            type="button"
            className="absolute left-0 right-0 cursor-pointer text-left hover:bg-subtle"
            style={{
              top: layout.totalHeight,
              height: GRID_FOOTER_H,
              paddingLeft: 12,
              fontSize: 'var(--font-12)',
              color: 'var(--text-tertiary)',
            }}
            onClick={() => {
              const id = createGoal();
              setEditing({ id, field: 'goalName' });
            }}
          >
            ＋ 新建目标
          </button>

          {/* 右缘分隔条 */}
          <div
            className="absolute bottom-0 top-0 cursor-col-resize"
            style={{ right: -GRID_DIVIDER_HIT / 2, width: GRID_DIVIDER_HIT, zIndex: 5, touchAction: 'none' }}
            title="拖动调整宽度，双击复位"
            onPointerDown={startDividerDrag}
            onDoubleClick={() => useStore.getState().updateGanttView({ gridWidth: GRID_DEFAULT_W })}
          />
        </>
      )}
    </div>
  );
});
