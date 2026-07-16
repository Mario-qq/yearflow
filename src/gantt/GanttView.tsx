/**
 * 甘特图主视图 —— 单 scroller + CSS sticky（结构铁律见 constants.ts 顶部注释）。
 *
 * flex column
 * ├─ scroller: content(320+totalW × 56+rowsH)
 * │   ├─ 表头行 sticky top（左上角 sticky left）
 * │   └─ body：LeftGrid sticky left ｜ timeline-body（GridBackground → RowsLayer → BarsLayer → Overlay）
 * └─ MiniMap（28px，scroller 之外）
 */
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import { todayStr } from '../lib/date';
import {
  buildExemptionCols,
  buildTicks,
  createTimeScale,
  dateToX,
  visibleDayRange,
} from './timeScale';
import { buildRowLayout, visibleRowRange } from './rowLayout';
import { useViewport } from './hooks/useViewport';
import { useZoomAnimation } from './hooks/useZoomAnimation';
import { useGanttDerive } from './hooks/useGanttDerive';
import { useBarTooltip } from './hooks/useBarTooltip';
import { onGantt } from './bus';
import { GridBackground } from './GridBackground';
import { RowsLayer } from './RowsLayer';
import { BarsLayer } from './BarsLayer';
import { TodayLine } from './TodayLine';
import { TimelineHeader } from './TimelineHeader';
import { LeftGrid } from './LeftGrid';
import { BarTooltip } from './BarTooltip';
import { MiniMap } from './MiniMap';
import { HEADER_H, LEFT_W } from './constants';

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

  const scrollerRef = useRef<HTMLDivElement>(null);
  const dayWidth = useZoomAnimation(scrollerRef, zoom, year);
  const scale = useMemo(() => createTimeScale(year, dayWidth), [year, dayWidth]);
  const layout = useMemo(
    () => buildRowLayout(goals, tasks, collapsedGoalIds),
    [goals, tasks, collapsedGoalIds],
  );
  const { win, scrollToDate } = useViewport(scrollerRef, scale);

  const today = todayStr();
  const derive = useGanttDerive(goals, tasks, checkIns, exemptions, today, weekStartsOn);
  const { anchor, onBarHover } = useBarTooltip();
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

  // 顶栏「今天」命令（Phase 3 快捷键 T 复用）
  useEffect(
    () => onGantt('scroll-to-today', () => scrollToDate(todayStr(), { smooth: true, anchorRatio: 1 / 3 })),
    [scrollToDate],
  );

  // Shift+滚轮横移（非 passive，ref 挂载；Ctrl+滚轮缩放 Phase 3 在此扩展）
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

  const hoverTask = anchor ? tasks[anchor.taskId] : undefined;
  const hoverGg = hoverTask ? derive.get(hoverTask.goalId) : undefined;
  const hoverTg = hoverTask ? hoverGg?.perTask.get(hoverTask.id) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-auto"
        style={{ background: 'var(--bg-base)', overscrollBehavior: 'contain' }}
      >
        <div style={{ width: LEFT_W + scale.totalWidth }}>
          {/* 表头行 */}
          <div className="sticky top-0 z-30 flex" style={{ height: HEADER_H }}>
            <div
              className="sticky left-0 z-40"
              style={{
                width: LEFT_W,
                flexShrink: 0,
                background: 'var(--bg-panel)',
                borderRight: '1px solid var(--border-default)',
                borderBottom: '1px solid var(--border-default)',
              }}
            />
            <TimelineHeader
              width={scale.totalWidth}
              zoom={zoom}
              ticks={ticks}
              exemptionCols={exemptionCols}
              todayX={todayX}
            />
          </div>

          {/* body */}
          <div className="flex">
            <LeftGrid layout={layout} rowStart={rowStart} rowEnd={rowEnd} goals={goals} tasks={tasks} />
            <div
              className="relative"
              style={{
                width: scale.totalWidth,
                height: layout.totalHeight,
                flexShrink: 0,
                background: 'var(--bg-panel)',
              }}
            >
              <GridBackground
                width={scale.totalWidth}
                height={layout.totalHeight}
                ticks={ticks}
                exemptionCols={exemptionCols}
              />
              <RowsLayer layout={layout} rowStart={rowStart} rowEnd={rowEnd} />
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
                onBarHover={onBarHover}
              />
              {/* Overlay：今日线（Phase 3 的 hover 十字、拖拽虚影、依赖连线也落此层） */}
              <div className="pointer-events-none absolute inset-0">
                {todayX != null && <TodayLine x={todayX} />}
              </div>
            </div>
          </div>
        </div>
      </div>
      <MiniMap scrollerRef={scrollerRef} scale={scale} goals={goals} tasks={tasks} todayX={todayX} />
      {anchor && hoverTask && hoverTg && hoverGg && (
        <BarTooltip anchor={anchor} task={hoverTask} tg={hoverTg} streak={hoverGg.streak} />
      )}
    </div>
  );
}
