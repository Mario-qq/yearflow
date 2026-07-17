/**
 * 甘特图主视图 —— 单 scroller + CSS sticky（结构铁律见 constants.ts 顶部注释）。
 *
 * flex column
 * ├─ scroller: content(leftW+totalW × 56+rowsH)
 * │   ├─ 表头行 sticky top（左上角 sticky left = GridHeader）
 * │   └─ body：LeftGrid sticky left ｜ timeline-body（GridBackground → RowsLayer → BarsLayer → Overlay）
 * ├─ 空格抓手覆盖层（held 时）
 * └─ MiniMap（28px，scroller 之外）
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { Goal, Task } from '../types/domain';
import { createMilestone, createTask, deleteTasks } from '../store/actions';
import { showToast } from '../lib/toast';
import { fmtDay, toDay, todayStr } from '../lib/date';
import {
  buildExemptionCols,
  buildTicks,
  createTimeScale,
  clampDayIndex,
  dateToX,
  xToDate,
  visibleDayRange,
} from './timeScale';
import { exportGanttPng } from './lib/exportPng';
import { ZOOM_DAY_WIDTH } from './constants';
import type { GanttZoom } from '../types/domain';
import { buildRowLayout, rowAtY, visibleRowRange, type RowLayout } from './rowLayout';
import { useViewport } from './hooks/useViewport';
import { useZoomAnimation } from './hooks/useZoomAnimation';
import { useGanttDerive } from './hooks/useGanttDerive';
import { useBarTooltip } from './hooks/useBarTooltip';
import { useSpacePan, startGrabPan } from './hooks/useSpacePan';
import { useBarDrag } from './hooks/useBarDrag';
import { useCreateDrag, idxToDate } from './hooks/useCreateDrag';
import { useMarqueeSelect } from './hooks/useMarqueeSelect';
import { useDepDrag } from './hooks/useDepDrag';
import { CreateOverlay } from './CreateDrag';
import { CheckinPopover } from './CheckinPopover';
import { GanttContextMenu } from './ContextMenu';
import { BulkBar } from './BulkBar';
import { DependencyLayer } from './DependencyLayer';
import { TaskDrawer } from './TaskDrawer';
import { goalColorAlpha } from '../lib/colors';
import { useGanttUi } from './uiStore';
import { onGantt } from './bus';
import { GridBackground } from './GridBackground';
import { RowsLayer } from './RowsLayer';
import { BarsLayer } from './BarsLayer';
import { TodayLine } from './TodayLine';
import { TimelineHeader } from './TimelineHeader';
import { LeftGrid } from './LeftGrid';
import { GridHeader } from './grid/GridHeader';
import { BarTooltip } from './BarTooltip';
import { MiniMap } from './MiniMap';
import { RowHoverOverlay, ColumnHoverOverlay } from './HoverLayers';
import { BAR_H, BAR_TOP, GHOST_OPACITY, GRID_RAIL_W, HEADER_H } from './constants';

export default function GanttView() {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const milestones = useStore((s) => s.milestones);
  const checkIns = useStore((s) => s.checkIns);
  const exemptions = useStore((s) => s.exemptions);
  const year = useStore((s) => s.settings.yearInView);
  const zoom = useStore((s) => s.settings.ganttView.zoom);
  const collapsedGoalIds = useStore((s) => s.settings.ganttView.collapsedGoalIds);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const gridWidth = useStore((s) => s.settings.ganttView.gridWidth);
  const gridCollapsed = useStore((s) => s.settings.ganttView.gridCollapsed);
  const showDependencies = useStore((s) => s.settings.ganttView.showDependencies);
  const showBaseline = useStore((s) => s.settings.ganttView.showBaseline);
  const filter = useStore((s) => s.settings.ganttView.filter);
  const leftW = gridCollapsed ? GRID_RAIL_W : gridWidth;
  const navigate = useNavigate();

  // 筛选（SPEC 4.6）：缺省淡出不匹配行；hideOthers 才真正从布局收起
  const filterActive = (filter.status?.length ?? 0) > 0 || (filter.goalIds?.length ?? 0) > 0;
  const taskMatches = useCallback(
    (t: Task) =>
      (!filter.status?.length || filter.status.includes(t.status)) &&
      (!filter.goalIds?.length || filter.goalIds.includes(t.goalId)),
    [filter],
  );
  const layoutTasks = useMemo(() => {
    if (!filterActive || !filter.hideOthers) return tasks;
    const out: Record<string, Task> = {};
    for (const t of Object.values(tasks)) if (taskMatches(t)) out[t.id] = t;
    return out;
  }, [tasks, filterActive, filter.hideOthers, taskMatches]);
  const layoutGoals = useMemo(() => {
    if (!filterActive || !filter.hideOthers || !filter.goalIds?.length) return goals;
    const out: Record<string, Goal> = {};
    for (const g of Object.values(goals)) if (filter.goalIds.includes(g.id)) out[g.id] = g;
    return out;
  }, [goals, filterActive, filter.hideOthers, filter.goalIds]);
  const dimTaskIds = useMemo(() => {
    const s = new Set<string>();
    if (!filterActive || filter.hideOthers) return s;
    for (const t of Object.values(tasks)) if (!t.deletedAt && !taskMatches(t)) s.add(t.id);
    return s;
  }, [tasks, filterActive, filter.hideOthers, taskMatches]);
  const dimGoalIds = useMemo(() => {
    const s = new Set<string>();
    if (!filterActive || filter.hideOthers || !filter.goalIds?.length) return s;
    for (const g of Object.values(goals)) {
      if (!g.deletedAt && !g.archived && !filter.goalIds.includes(g.id)) s.add(g.id);
    }
    return s;
  }, [goals, filterActive, filter.hideOthers, filter.goalIds]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dayWidth = useZoomAnimation(scrollerRef, zoom, year, leftW);
  const scale = useMemo(() => createTimeScale(year, dayWidth), [year, dayWidth]);
  const layout = useMemo(
    () => buildRowLayout(layoutGoals, layoutTasks, collapsedGoalIds),
    [layoutGoals, layoutTasks, collapsedGoalIds],
  );
  const { win, scrollToDate } = useViewport(scrollerRef, scale, leftW);
  const spaceHeld = useSpacePan(scrollerRef);

  // 十字定位/定位跳转的事件回调经 ref 读最新 scale/layout（不随高频 hover 重建）
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const layoutRef = useRef<RowLayout>(layout);
  layoutRef.current = layout;

  const today = todayStr();
  const derive = useGanttDerive(goals, tasks, checkIns, exemptions, today, weekStartsOn);
  const { anchor, onBarHover } = useBarTooltip();
  const { onBarDragStart, ghost } = useBarDrag({ scrollerRef, bodyRef, scaleRef, layoutRef, leftW });
  const { onBodyPointerDown: onCreateDown, preview, pending, clearPending } = useCreateDrag({ bodyRef, scaleRef, layoutRef });
  const { onMarqueeDown, marqueeRect } = useMarqueeSelect({ bodyRef, scaleRef, layoutRef });
  const { onDepDragStart, depLine } = useDepDrag({ bodyRef, scaleRef, layoutRef });

  // body pointerdown 分流：任务/幽灵行空白 = 框选新建；目标行/行外空白 = 框选多选
  const onBodyPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-task-bar],[data-milestone],[data-create-bubble],[data-checkin-dot]')) return;
      const body = bodyRef.current;
      if (!body) return;
      const row = rowAtY(layoutRef.current, e.clientY - body.getBoundingClientRect().top);
      if (row && (row.kind === 'task' || row.kind === 'ghost')) onCreateDown(e);
      else onMarqueeDown(e);
    },
    [onCreateDown, onMarqueeDown],
  );

  // 右键菜单：bar → 任务菜单（记录右键日期供「从此日拆分」）；空白 → 时间轴菜单
  const onBodyContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const body = bodyRef.current;
    if (!body) return;
    const s = scaleRef.current;
    const rect = body.getBoundingClientRect();
    const idx = clampDayIndex(s, Math.floor((e.clientX - rect.left) / s.dayWidth));
    const date = idxToDate(s, idx);
    const barEl = (e.target as HTMLElement).closest('[data-task-bar]');
    if (barEl) {
      useGanttUi.getState().setContextMenu({
        x: e.clientX,
        y: e.clientY,
        kind: 'bar',
        taskId: barEl.getAttribute('data-task-bar') ?? undefined,
        date,
      });
    } else {
      const row = rowAtY(layoutRef.current, e.clientY - rect.top);
      useGanttUi.getState().setContextMenu({
        x: e.clientX,
        y: e.clientY,
        kind: 'canvas',
        goalId: row?.goalId,
        date,
      });
    }
  }, []);

  // Esc 清除多选（右键菜单/输入框各自处理自己的 Esc）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      useGanttUi.getState().clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [visStart, visEnd] = visibleDayRange(scale, win.xStart, win.xEnd);
  const [rowStart, rowEnd] = visibleRowRange(layout, win.yStart, win.yEnd);
  const ticks = useMemo(
    () => buildTicks(scale, zoom, visStart, visEnd, weekStartsOn, today),
    [scale, zoom, visStart, visEnd, weekStartsOn, today],
  );
  const exemptionCols = useMemo(
    () => buildExemptionCols(scale, Object.values(exemptions), visStart, visEnd),
    [scale, exemptions, visStart, visEnd],
  );
  const todayX =
    today >= scale.yearStart && today <= scale.yearEnd
      ? dateToX(scale, today) + scale.dayWidth / 2
      : null;

  // 开屏定位：有持久化 scrollDate 则瞬时恢复原位；首次使用平滑滚到今日线 1/3 处
  useEffect(() => {
    const { scrollDate } = useStore.getState().settings.ganttView;
    const s = createTimeScale(year, dayWidth);
    if (scrollDate && scrollDate >= s.yearStart && scrollDate <= s.yearEnd) {
      scrollToDate(scrollDate);
    } else if (today >= s.yearStart && today <= s.yearEnd) {
      scrollToDate(today, { smooth: true, anchorRatio: 1 / 3 });
    }
    // 仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 顶栏「今天」命令（快捷键 T 复用）
  useEffect(
    () => onGantt('scroll-to-today', () => scrollToDate(todayStr(), { smooth: true, anchorRatio: 1 / 3 })),
    [scrollToDate],
  );

  // Shift+滚轮横移（非 passive，ref 挂载；Ctrl+滚轮缩放在 useZoomAnimation 内处理）
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      if (e.shiftKey && e.deltaY !== 0 && e.deltaX === 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 左栏点击/命令面板定位：bar 不在视口内则平滑滚入（左缘 1/5 处 + 垂直带入），并闪烁一次
  const locateTask = useCallback(
    (taskId: string) => {
      const task = useStore.getState().tasks[taskId];
      const el = scrollerRef.current;
      if (!task || !el) return;
      const s = scaleRef.current;
      const x0 = dateToX(s, task.startDate);
      const x1 = dateToX(s, task.endDate) + s.dayWidth;
      const viewL = el.scrollLeft;
      const viewR = viewL + Math.max(0, el.clientWidth - leftW);
      if (x0 < viewL || x1 > viewR) {
        scrollToDate(task.startDate, { smooth: true, anchorRatio: 1 / 5 });
      }
      const row = layoutRef.current.rowById[taskId];
      if (row) {
        const bodyViewH = el.clientHeight - HEADER_H;
        if (row.top < el.scrollTop || row.top + row.height > el.scrollTop + bodyViewH) {
          el.scrollTo({ top: Math.max(0, row.top - bodyViewH / 3), behavior: 'smooth' });
        }
      }
      useGanttUi.getState().flashTask(taskId);
    },
    [scrollToDate, leftW],
  );

  // bus 命令：定位任务（先展开折叠的目标）/ 切到某月 / 导出 PNG
  useEffect(
    () =>
      onGantt('locate-task', ({ taskId }) => {
        const { tasks: all, settings, updateGanttView } = useStore.getState();
        const task = all[taskId];
        if (!task) return;
        if (settings.ganttView.collapsedGoalIds.includes(task.goalId)) {
          updateGanttView({
            collapsedGoalIds: settings.ganttView.collapsedGoalIds.filter((id) => id !== task.goalId),
          });
          setTimeout(() => locateTask(taskId), 80); // 等布局重算
        } else {
          locateTask(taskId);
        }
      }),
    [locateTask],
  );
  useEffect(
    () => onGantt('scroll-to-date', ({ date }) => scrollToDate(date, { smooth: true, anchorRatio: 1 / 5 })),
    [scrollToDate],
  );
  useEffect(
    () =>
      onGantt('export-png', () => {
        const el = scrollerRef.current;
        if (!el) return;
        showToast('正在生成 PNG…');
        void exportGanttPng(el)
          .then(() => showToast('已导出当前视图 PNG'))
          .catch(() => showToast('导出失败，请重试'));
      }),
    [],
  );

  // 聚焦模式（SPEC 4.6）：双击目标行 → 只展开该目标并放大到其时间范围；再双击退出
  const focusRef = useRef<{ goalId: string; prevCollapsed: string[]; prevZoom: GanttZoom } | null>(null);
  const onFocusGoal = useCallback(
    (goalId: string) => {
      const { settings, updateGanttView, goals: allGoals, tasks: allTasks } = useStore.getState();
      const cur = focusRef.current;
      if (cur?.goalId === goalId) {
        // 退出聚焦：恢复进入前的折叠与缩放
        updateGanttView({ collapsedGoalIds: cur.prevCollapsed, zoom: cur.prevZoom });
        focusRef.current = null;
        return;
      }
      focusRef.current = {
        goalId,
        prevCollapsed: cur?.prevCollapsed ?? settings.ganttView.collapsedGoalIds,
        prevZoom: cur?.prevZoom ?? settings.ganttView.zoom,
      };
      const others = Object.values(allGoals)
        .filter((g) => !g.deletedAt && !g.archived && g.id !== goalId)
        .map((g) => g.id);
      updateGanttView({ collapsedGoalIds: others });
      // 放大到该目标时间范围：选使 span 占视口 ~85% 的最近档位，再滚到范围起点
      const goalTasks = Object.values(allTasks).filter((t) => !t.deletedAt && t.goalId === goalId);
      if (goalTasks.length === 0) return;
      const minStart = goalTasks.reduce((m, t) => (t.startDate < m ? t.startDate : m), goalTasks[0].startDate);
      const maxEnd = goalTasks.reduce((m, t) => (t.endDate > m ? t.endDate : m), goalTasks[0].endDate);
      const spanDays = Math.max(1, toDay(maxEnd).diff(toDay(minStart), 'day') + 1);
      const el = scrollerRef.current;
      const tlW = el ? Math.max(200, el.clientWidth - leftW) : 800;
      const idealW = (tlW * 0.85) / spanDays;
      let best: GanttZoom = 'year';
      let bestDist = Infinity;
      for (const [z, w] of Object.entries(ZOOM_DAY_WIDTH) as [GanttZoom, number][]) {
        const d = Math.abs(Math.log(w) - Math.log(idealW));
        if (d < bestDist) {
          bestDist = d;
          best = z;
        }
      }
      if (best !== settings.ganttView.zoom) updateGanttView({ zoom: best });
      setTimeout(() => scrollToDate(minStart, { smooth: true, anchorRatio: 0.06 }), 220);
    },
    [scrollToDate, leftW],
  );

  // 甘特页快捷键（SPEC 4.7；全局 Ctrl+Z 与命令面板在 App 层）
  useEffect(() => {
    const ZOOM_STEPS: GanttZoom[] = ['year', 'quarter', 'month', 'week'];
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const el = scrollerRef.current;
      const { settings, updateGanttView } = useStore.getState();
      switch (e.key) {
        case 't':
        case 'T':
          scrollToDate(todayStr(), { smooth: true, anchorRatio: 1 / 3 });
          break;
        case '+':
        case '=': {
          const i = ZOOM_STEPS.indexOf(settings.ganttView.zoom);
          if (i < ZOOM_STEPS.length - 1) updateGanttView({ zoom: ZOOM_STEPS[i + 1] });
          break;
        }
        case '-': {
          const i = ZOOM_STEPS.indexOf(settings.ganttView.zoom);
          if (i > 0) updateGanttView({ zoom: ZOOM_STEPS[i - 1] });
          break;
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const days = e.shiftKey ? 30 : 7;
          el?.scrollBy({
            left: (e.key === 'ArrowRight' ? 1 : -1) * days * scaleRef.current.dayWidth,
            behavior: 'smooth',
          });
          break;
        }
        case 'b':
        case 'B':
          updateGanttView({ showBaseline: !settings.ganttView.showBaseline });
          break;
        case 'd':
        case 'D':
          navigate('/checkin');
          break;
        case 'n':
        case 'N':
        case 'm':
        case 'M': {
          // 在视口中心日期创建（目标 = hover 行所在目标，否则第一个目标）
          if (!el) break;
          const s = scaleRef.current;
          const centerX = el.scrollLeft + Math.max(0, el.clientWidth - leftW) / 2;
          const date = xToDate(s, centerX);
          const ui = useGanttUi.getState();
          const hoverGoalId = ui.hoverRowId ? layoutRef.current.rowById[ui.hoverRowId]?.goalId : undefined;
          const goalList = Object.values(useStore.getState().goals)
            .filter((g) => !g.deletedAt && !g.archived)
            .sort((a, b) => a.order - b.order);
          const goalId = hoverGoalId ?? goalList[0]?.id;
          if (!goalId) break;
          if (e.key === 'n' || e.key === 'N') {
            const id = createTask({ goalId, startDate: date, endDate: fmtDay(toDay(date).add(13, 'day')) });
            ui.flashTask(id);
            ui.setEditing({ id, field: 'name' });
          } else {
            createMilestone(goalId, date);
            showToast(`已在 ${toDay(date).format('M月D日')} 创建里程碑`);
          }
          break;
        }
        case 'Delete': {
          const ids = useGanttUi.getState().selectedTaskIds;
          if (ids.length === 0) break;
          if (!confirm(`删除选中的 ${ids.length} 个任务？其打卡记录将一并删除。`)) break;
          deleteTasks(ids);
          useGanttUi.getState().clearSelection();
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scrollToDate, navigate, leftW]);

  // hover 十字定位：body pointermove → 行 + 日列（setHoverCell 内部去重，无变化不 setState）
  const onBodyPointerMove = useCallback((e: React.PointerEvent) => {
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = scaleRef.current;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const idx = x >= 0 && x < s.totalWidth ? clampDayIndex(s, Math.floor(x / s.dayWidth)) : null;
    useGanttUi.getState().setHoverCell(rowAtY(layoutRef.current, y)?.id ?? null, idx);
  }, []);
  const onBodyPointerLeave = useCallback(() => {
    useGanttUi.getState().setHoverCell(null, null);
  }, []);

  // 点击打卡点 → 就地 popover（SPEC 4.4）
  const onDotClick = useCallback((taskId: string, date: string, e: React.MouseEvent) => {
    const task = useStore.getState().tasks[taskId];
    if (!task) return;
    e.stopPropagation();
    useGanttUi.getState().setCheckinPopover({
      goalId: task.goalId,
      taskId,
      date,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const hoverTask = anchor ? tasks[anchor.taskId] : undefined;
  const hoverGg = hoverTask ? derive.get(hoverTask.goalId) : undefined;
  const hoverTg = hoverTask ? hoverGg?.perTask.get(hoverTask.id) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollerRef}
          className="h-full overflow-auto"
          style={{ background: 'var(--bg-base)', overscrollBehavior: 'contain' }}
        >
          <div style={{ width: leftW + scale.totalWidth }}>
            {/* 表头行 */}
            <div className="sticky top-0 z-30 flex" style={{ height: HEADER_H }}>
              <div
                className="sticky left-0 z-40"
                style={{
                  width: leftW,
                  flexShrink: 0,
                  background: 'var(--bg-panel)',
                  borderRight: '1px solid var(--border-default)',
                  borderBottom: '1px solid var(--border-default)',
                }}
              >
                <GridHeader collapsed={gridCollapsed} />
              </div>
              <TimelineHeader
                width={scale.totalWidth}
                zoom={zoom}
                ticks={ticks}
                exemptionCols={exemptionCols}
                todayX={todayX}
                leftW={leftW}
                dayWidth={scale.dayWidth}
              />
            </div>

            {/* body */}
            <div className="flex">
              <LeftGrid
                layout={layout}
                rowStart={rowStart}
                rowEnd={rowEnd}
                goals={goals}
                tasks={tasks}
                derive={derive}
                today={today}
                leftW={leftW}
                collapsed={gridCollapsed}
                dimTaskIds={dimTaskIds}
                dimGoalIds={dimGoalIds}
                onLocateTask={locateTask}
                onFocusGoal={onFocusGoal}
              />
              <div
                ref={bodyRef}
                className="relative"
                style={{
                  width: scale.totalWidth,
                  height: layout.totalHeight,
                  flexShrink: 0,
                  background: 'var(--bg-panel)',
                }}
                onPointerMove={onBodyPointerMove}
                onPointerLeave={onBodyPointerLeave}
                onPointerDown={onBodyPointerDown}
                onContextMenu={onBodyContextMenu}
              >
                <GridBackground
                  width={scale.totalWidth}
                  height={layout.totalHeight}
                  ticks={ticks}
                  exemptionCols={exemptionCols}
                />
                <RowsLayer layout={layout} rowStart={rowStart} rowEnd={rowEnd} />
                {/* 十字定位（行/列淡背景，RowsLayer 之上、bar 之下） */}
                <ColumnHoverOverlay dayWidth={scale.dayWidth} height={layout.totalHeight} />
                <RowHoverOverlay layout={layout} />
                <BarsLayer
                  layout={layout}
                  rowStart={rowStart}
                  rowEnd={rowEnd}
                  goals={goals}
                  tasks={tasks}
                  milestones={milestones}
                  derive={derive}
                  scale={scale}
                  visStart={visStart}
                  visEnd={visEnd}
                  today={today}
                  collapsedGoalIds={collapsedGoalIds}
                  showBaseline={showBaseline}
                  dimTaskIds={dimTaskIds}
                  dimGoalIds={dimGoalIds}
                  onBarHover={onBarHover}
                  onBarDragStart={onBarDragStart}
                  onDepDragStart={onDepDragStart}
                  onDotClick={onDotClick}
                />
                {/* 依赖连线（全局开关，SVG 命中区可点删）+ 拖出中的临时虚线 */}
                {showDependencies && (
                  <DependencyLayer
                    layout={layout}
                    scale={scale}
                    tasks={layoutTasks}
                    goals={goals}
                    width={scale.totalWidth}
                    height={layout.totalHeight}
                  />
                )}
                {depLine && (
                  <svg
                    className="pointer-events-none absolute inset-0"
                    width={scale.totalWidth}
                    height={layout.totalHeight}
                    aria-hidden
                    style={{ overflow: 'visible' }}
                  >
                    <line
                      x1={depLine.x1}
                      y1={depLine.y1}
                      x2={depLine.x2}
                      y2={depLine.y2}
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      strokeDasharray={depLine.snapped ? undefined : '4 4'}
                    />
                    <circle cx={depLine.x2} cy={depLine.y2} r={3.5} fill="var(--accent)" />
                  </svg>
                )}
                {/* Overlay：今日线 + 拖拽原位虚影（依赖连线也落此层） */}
                <div className="pointer-events-none absolute inset-0">
                  {todayX != null && <TodayLine x={todayX} />}
                  {ghost && (
                    <div
                      className="absolute"
                      style={{
                        top: ghost.rowTop + BAR_TOP,
                        left: ghost.x,
                        width: ghost.width,
                        height: BAR_H,
                        borderRadius: 'var(--radius-md)',
                        background: goalColorAlpha(ghost.color, 100),
                        opacity: GHOST_OPACITY,
                      }}
                    />
                  )}
                </div>
                {/* 框选新建：预览条 + 名称气泡 */}
                <CreateOverlay preview={preview} pending={pending} dayWidth={scale.dayWidth} onDone={clearPending} />
                {/* 框选多选矩形 */}
                {marqueeRect && (
                  <div
                    className="pointer-events-none absolute"
                    style={{
                      left: marqueeRect.x,
                      top: marqueeRect.y,
                      width: marqueeRect.w,
                      height: marqueeRect.h,
                      background: 'var(--accent-soft)',
                      border: '1px solid var(--accent)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 空格抓手：覆盖 scroller 视口，拦截 pointer 平移 */}
        {spaceHeld && (
          <div
            className="absolute inset-0 z-40"
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={(e) => scrollerRef.current && startGrabPan(e, scrollerRef.current)}
          />
        )}
      </div>
      <MiniMap
        scrollerRef={scrollerRef}
        scale={scale}
        goals={layoutGoals}
        tasks={layoutTasks}
        todayX={todayX}
        leftW={leftW}
      />
      {anchor && hoverTask && hoverTg && hoverGg && (
        <BarTooltip anchor={anchor} task={hoverTask} tg={hoverTg} streak={hoverGg.streak} />
      )}
      <GanttContextMenu />
      <BulkBar />
      <TaskDrawer />
      <CheckinPopover />
    </div>
  );
}
