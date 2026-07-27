/**
 * 左侧任务网格（SPEC 4.3 完全体）：
 * - 目标行：折叠箭头 + icon + 可编辑名称 + 本月完成率迷你环形 + streak🔥N + 任务数
 * - 任务行：多列（名称 / 起止 / 进度 / 状态点 + 可选打卡率 / 偏移列），全部行内编辑即存
 * - 左右联动：行 hover 写 uiStore；点击名称外空白 → 定位右侧 bar 并闪烁
 * - 每个分组末尾幽灵行「+ 添加任务」（hover 分组时浮现）；底部常驻「+ 新建目标」
 * - 右缘分隔条拖宽（双击复位），折叠为纯图模式时退化为窄轨
 * 行几何与时间轴共用 rowLayout，保证两侧严格对齐。
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { Goal, Task } from '../types/domain';
import type { GoalGantt, TaskGantt, Track, TrackIndex } from '../lib/derive';
import { baselineDrift, goalMonthlyRate } from '../lib/derive';
import type { GanttRow, RowLayout } from './rowLayout';
import { trackRowId } from './rowLayout';
import { useStore } from '../store/useStore';
import { createGoal, createTask, patchGoal, patchTask, reorderGoals, reorderTasks } from '../store/actions';
import { useGanttUi } from './uiStore';
import { goalColor } from '../lib/colors';
import { toDay, fmtDay } from '../lib/date';
import { startPointerDrag } from './lib/dragCore';
import { visibleColumns, columnWidth, type GridColumnDef } from './grid/columns';
import { InlineInput } from './grid/InlineInput';
import { ProgressMeter } from './grid/ProgressCell';
import { RowHoverOverlay } from './HoverLayers';
import { GRID_DEFAULT_W, GRID_FOOTER_H, GRID_MAX_W, GRID_MIN_W, GRID_DIVIDER_HIT, TRACK_INDENT } from './constants';

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
  const completed = Boolean(goal.completedAt);
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
        borderLeft: `3px solid ${completed ? 'var(--border-strong)' : solid}`,
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
      {completed && (
        <span
          aria-hidden
          className="flex shrink-0 items-center justify-center"
          title={`已完成 · ${toDay(goal.completedAt!).format('M月D日')}`}
          style={{
            width: 15,
            height: 15,
            borderRadius: '50%',
            background: 'var(--success)',
            color: 'var(--text-on-accent, #fff)',
            fontSize: 10,
            lineHeight: 1,
          }}
        >
          ✓
        </span>
      )}
      <span
        className="shrink-0 cursor-pointer rounded hover:bg-[var(--row-hover)]"
        title="点击更改图标 / 颜色"
        style={{ fontSize: 'var(--font-14)', lineHeight: 1, padding: '1px 2px', filter: completed ? 'grayscale(0.8)' : undefined, opacity: completed ? 0.7 : 1 }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          useGanttUi.getState().setIconPicker({ goalId: goal.id, x: r.left, y: r.bottom + 4 });
        }}
      >
        {goal.icon}
      </span>
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
          style={{ fontSize: 'var(--font-13)', color: completed ? 'var(--text-tertiary)' : undefined }}
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
  /** 正在被拖动重排 */
  dragging: boolean;
  /** >0 = 轨道成员行：额外缩进 + 左侧导引线，且不参与重排（轨道内按开始日排序） */
  depth?: number;
  onLocate: (taskId: string) => void;
  /** 任务重排拖拽回调（几何/落点由 LeftGrid 统一持有） */
  onDragStart: (taskId: string) => void;
  onDragMove: (clientY: number) => void;
  onDragEnd: (committed: boolean) => void;
}

const TaskRow = memo(function TaskRow({ task, top, height, cols, colWidths, tg, dim, dragging, depth = 0, onLocate, onDragStart, onDragMove, onDragEnd }: TaskRowProps) {
  const editing = useGanttUi((s) => (s.editing?.id === task.id ? s.editing.field : null));
  const setEditing = useGanttUi((s) => s.setEditing);
  const setHoverCell = useGanttUi((s) => s.setHoverCell);
  const progress = Math.round(tg?.effectiveProgress ?? task.progress);
  const solid = goalColor(useStore((s) => s.goals[task.goalId]?.color ?? 'goal-1'));
  /** 拖拽后浏览器仍会补发一次 click：置位则吞掉，避免误触发定位/行内编辑 */
  const suppressClick = useRef(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // 右键交给上层
    if (editing) return; // 行内编辑中不抢指针（保持输入框选区/光标）
    if (depth > 0) return; // 轨道成员：顺序由开始日决定，不给拖
    suppressClick.current = false;
    startPointerDrag(e, {
      onStart: () => {
        suppressClick.current = true;
        onDragStart(task.id);
      },
      onMove: (s) => onDragMove(s.clientY),
      onEnd: (s, committed) => {
        if (s.started) onDragEnd(committed);
      },
    });
  };

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
            <ProgressMeter value={progress} color={solid} />
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
      className="absolute left-0 right-0 flex items-center"
      style={{
        top,
        height,
        borderBottom: '1px solid var(--border-subtle)',
        opacity: dim ? 0.35 : dragging ? 0.5 : 1,
        background: dragging ? 'var(--bg-subtle)' : undefined,
        boxShadow: dragging ? 'var(--shadow-sm)' : undefined,
        cursor: depth > 0 ? 'default' : dragging ? 'grabbing' : 'grab',
        transition: dragging ? undefined : 'opacity var(--dur-zoom) var(--ease)',
        touchAction: 'none',
        zIndex: dragging ? 3 : undefined,
      }}
      title={depth > 0 ? '轨道内按开始日排序，拖动右侧 bar 改期即可调整顺序' : undefined}
      onPointerEnter={() => setHoverCell(task.id, null)}
      onPointerDown={handlePointerDown}
      onClickCapture={(e) => {
        // 拖拽后补发的 click：拦在子单元格处理器之前吞掉，避免误开行内编辑
        if (suppressClick.current) {
          suppressClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
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
              paddingLeft: i === 0 ? 32 + depth * TRACK_INDENT : 6,
              paddingRight: 6,
              justifyContent: c.key === 'status' ? 'center' : undefined,
            }}
          >
            {cell(c)}
          </span>
        );
      })}
      {depth > 0 && (
        // 轨道成员的左侧导引线，暗示「这几行同属上面那条轨道」
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{ left: 32, top: 0, bottom: 0, width: 1, background: 'var(--border-subtle)' }}
        />
      )}
    </div>
  );
});

interface TrackRowProps {
  track: Track;
  top: number;
  height: number;
  cols: GridColumnDef[];
  colWidths: Record<string, number>;
  color: string;
  /** 聚合进度 0-100（缺省 = 派生尚未就绪） */
  progress: number;
  expanded: boolean;
  dim: boolean;
  dragging: boolean;
  onToggle: (trackId: string) => void;
  onLocate: (taskId: string) => void;
  onDragStart: (rowId: string) => void;
  onDragMove: (clientY: number) => void;
  onDragEnd: (committed: boolean) => void;
}

/**
 * 执行轨道行：折叠时代表整条执行路径（长期迭代项目的多段执行）。
 * 名称派生自组内最早的任务，无独立存储；进度是成员按天数加权的聚合值，只读。
 */
const TrackRow = memo(function TrackRow({ track, top, height, cols, colWidths, color, progress, expanded, dim, dragging, onToggle, onLocate, onDragStart, onDragMove, onDragEnd }: TrackRowProps) {
  const setHoverCell = useGanttUi((s) => s.setHoverCell);
  const rowId = trackRowId(track.id);
  /**
   * 「N 步」徽标优先放在状态列 —— 轨道没有单一状态，那一格本来就空着；
   * 挤在名称列里会把轨道名压到只剩几个字（名称列是 flex 列，总共才 ~110px）。
   * 状态列被用户隐藏时才退回名称列。
   */
  const badgeCol = cols.some((c) => c.key === 'status') ? 'status' : 'name';
  const badge = (
    <span
      className="tnum shrink-0 whitespace-nowrap"
      title={`这条轨道由 ${track.memberIds.length} 段任务组成`}
      style={{
        padding: '0 5px',
        borderRadius: 999,
        background: 'var(--bg-subtle)',
        fontSize: 'var(--font-11)',
        color: 'var(--text-tertiary)',
      }}
    >
      {track.memberIds.length} 步
    </span>
  );
  /** 拖拽后浏览器仍会补发一次 click：置位则吞掉，避免误触发展开 */
  const suppressClick = useRef(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    suppressClick.current = false;
    startPointerDrag(e, {
      onStart: () => {
        suppressClick.current = true;
        onDragStart(rowId);
      },
      onMove: (s) => onDragMove(s.clientY),
      onEnd: (s, committed) => {
        if (s.started) onDragEnd(committed);
      },
    });
  };

  const cell = (c: GridColumnDef) => {
    switch (c.key) {
      case 'name':
        return (
          <>
            <span
              aria-hidden
              className="inline-block shrink-0 text-center"
              style={{
                width: 14,
                fontSize: 10,
                color: 'var(--text-tertiary)',
                transform: expanded ? 'rotate(90deg)' : 'none',
                transition: 'transform var(--dur-drop) var(--ease)',
              }}
            >
              ▶
            </span>
            <span
              className="overflow-hidden text-ellipsis whitespace-nowrap font-medium"
              style={{ fontSize: 'var(--font-13)', color: 'var(--text-secondary)' }}
              title="点击定位到首段任务"
              onClick={(e) => {
                e.stopPropagation();
                onLocate(track.headId);
              }}
            >
              {track.name}
            </span>
            {badgeCol === 'name' && <span style={{ marginLeft: 4 }}>{badge}</span>}
          </>
        );
      case 'dates':
        return (
          <span className="tnum whitespace-nowrap" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
            {fmtRange(track.startDate, track.endDate)}
          </span>
        );
      case 'progress':
        return (
          <span className="flex w-full items-center gap-1.5" title={`聚合进度 ${progress}%（按各段天数加权，不可直接编辑）`}>
            <ProgressMeter value={progress} color={color} />
          </span>
        );
      case 'status':
        return badgeCol === 'status' ? badge : null;
      default:
        // 打卡率 / 偏移在轨道层面无单一取值，留空避免误读
        return null;
    }
  };

  return (
    <div
      className="absolute left-0 right-0 flex items-center"
      style={{
        top,
        height,
        background: 'var(--bg-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
        opacity: dim ? 0.35 : dragging ? 0.5 : 1,
        boxShadow: dragging ? 'var(--shadow-sm)' : undefined,
        cursor: dragging ? 'grabbing' : 'grab',
        transition: dragging ? undefined : 'opacity var(--dur-zoom) var(--ease)',
        touchAction: 'none',
        zIndex: dragging ? 3 : undefined,
      }}
      title="拖动可整块调整顺序，单击展开/折叠这条执行路径"
      onPointerEnter={() => setHoverCell(rowId, null)}
      onPointerDown={handlePointerDown}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      onClick={() => onToggle(track.id)}
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
              paddingLeft: i === 0 ? 18 : 6,
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
  trackIndex: TrackIndex;
  /** 含筛选临时展开在内的最终展开集合 */
  expandedTrackIds: string[];
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
  trackIndex,
  expandedTrackIds,
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

  /** 轨道默认折叠，故持久化的是「已展开」集合 */
  const toggleTrack = useCallback((trackId: string) => {
    const { settings, updateGanttView } = useStore.getState();
    const ids = settings.ganttView.expandedTrackIds;
    updateGanttView({
      expandedTrackIds: ids.includes(trackId) ? ids.filter((id) => id !== trackId) : [...ids, trackId],
    });
  }, []);

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

  // ── 任务/轨道行纵向拖拽重排（约束在同目标内）──────────────────────────────
  // 排序单位是「排序单元」：一个非成员任务，或一整条轨道。轨道整块移动，
  // 其成员的 order 跟着一起平移，保证头任务的 order 仍代表整块的位置。
  /** 拖拽中：被拖单元的行 id + 所属目标 + 插入位下标（同目标单元列表内 0..n）+ 落点指示线 y */
  const [taskDrag, setTaskDrag] = useState<{ id: string; goalId: string; index: number; indicatorY: number } | null>(null);

  /** 单元行 → 它代表的任务 id 列表（轨道 = 全部成员，按轨道内顺序） */
  const unitTaskIds = useCallback(
    (row: GanttRow): string[] =>
      row.kind === 'track' ? (trackIndex?.byId[row.trackId!]?.memberIds ?? []) : [row.id],
    [trackIndex],
  );

  /** 光标 layout-y → 同目标单元列表内的插入下标 + 指示线 y（落在某单元块中线之上则插到其前） */
  const resolveTaskDrop = (goalId: string, layoutY: number): { index: number; indicatorY: number } => {
    const units = layout.unitRowsByGoal[goalId] ?? [];
    if (units.length === 0) return { index: 0, indicatorY: layout.rowById[goalId]?.top ?? 0 };
    for (let i = 0; i < units.length; i++) {
      // 展开的轨道块底 = 下一个单元的 top（含其成员行），不能只看单元行自身高度
      const blockTop = units[i].top;
      const blockBottom = i + 1 < units.length ? units[i + 1].top : blockTop + unitHeight(units[i]);
      if (layoutY < (blockTop + blockBottom) / 2) return { index: i, indicatorY: blockTop };
    }
    const last = units[units.length - 1];
    return { index: units.length, indicatorY: last.top + unitHeight(last) };
  };

  const unitHeight = (row: GanttRow): number =>
    row.height + (layout.memberRowsByTrack[row.trackId ?? '']?.reduce((n, r) => n + r.height, 0) ?? 0);

  const handleTaskDragStart = (rowId: string) => {
    const goalId = layout.rowById[rowId]?.goalId;
    if (!goalId) return;
    const units = layout.unitRowsByGoal[goalId] ?? [];
    const from = units.findIndex((r) => r.id === rowId);
    setTaskDrag({ id: rowId, goalId, index: from, indicatorY: units[from]?.top ?? 0 });
  };

  const handleTaskDragMove = (clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTaskDrag((prev) => {
      if (!prev) return prev;
      const { index, indicatorY } = resolveTaskDrop(prev.goalId, clientY - rect.top);
      return prev.index !== index || prev.indicatorY !== indicatorY ? { ...prev, index, indicatorY } : prev;
    });
  };

  const handleTaskDragEnd = (committed: boolean) => {
    setTaskDrag((prev) => {
      if (prev && committed) {
        const units = layout.unitRowsByGoal[prev.goalId] ?? [];
        const from = units.findIndex((r) => r.id === prev.id);
        const insertAt = prev.index > from ? prev.index - 1 : prev.index;
        if (from !== -1 && insertAt !== from) {
          const reordered = units.filter((r) => r.id !== prev.id);
          reordered.splice(insertAt, 0, units[from]);
          reorderTasks(reordered.flatMap(unitTaskIds));
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
            if (r.kind === 'track') {
              const track = trackIndex.byId[r.trackId!];
              if (!track) return null;
              const members = track.memberIds;
              return (
                <TrackRow
                  key={r.id}
                  track={track}
                  top={r.top}
                  height={r.height}
                  cols={cols}
                  colWidths={gridColWidths}
                  color={goalColor(goals[r.goalId]?.color ?? 'goal-1')}
                  progress={Math.round(derive.get(r.goalId)?.perTrack.get(track.id)?.progress ?? 0)}
                  expanded={expandedTrackIds.includes(track.id)}
                  // 整条轨道都被筛掉才淡出；部分命中时上层已把它临时展开
                  dim={dimGoalIds.has(r.goalId) || members.every((id) => dimTaskIds.has(id))}
                  dragging={taskDrag?.id === r.id}
                  onToggle={toggleTrack}
                  onLocate={onLocateTask}
                  onDragStart={handleTaskDragStart}
                  onDragMove={handleTaskDragMove}
                  onDragEnd={handleTaskDragEnd}
                />
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
                dragging={taskDrag?.id === r.id}
                depth={r.depth}
                onLocate={onLocateTask}
                onDragStart={handleTaskDragStart}
                onDragMove={handleTaskDragMove}
                onDragEnd={handleTaskDragEnd}
              />
            );
          })}

          <RowHoverOverlay layout={layout} />

          {/* 泳道 / 任务重排落点指示线 */}
          {(goalDrag || taskDrag) && (
            <div
              className="pointer-events-none absolute left-0 right-0"
              style={{
                top: (goalDrag ? goalDrag.indicatorY : taskDrag!.indicatorY) - 1,
                height: 2,
                background: 'var(--accent)',
                zIndex: 4,
              }}
            >
              <span
                className="absolute"
                style={{
                  left: taskDrag && !goalDrag ? 26 : 2,
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
