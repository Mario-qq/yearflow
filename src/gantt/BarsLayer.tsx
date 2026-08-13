/**
 * bar 层：任务 bar + 打卡点阵/热度条 + 目标行汇总条/里程碑（行虚拟化）。
 * 点阵/热度模式由连续 dayWidth 判定（缩放动画中自然切换）。
 * 容器 pointer-events-none，仅 bar 自身可交互（tooltip / Phase 3 拖拽）。
 */
import { memo, useMemo, useRef } from 'react';
import type { Goal, Milestone, Task } from '../types/domain';
import type { GanttFocusIndex, GoalGantt, TrackIndex } from '../lib/derive';
import type { RowLayout } from './rowLayout';
import { dateToX, type TimeScale } from './timeScale';
import { diffDays, fmtDay, toDay } from '../lib/date';
import { stableGroupBy } from '../lib/stableSlices';
import type { BarDragMode } from './hooks/useBarDrag';
import type { DepHandleSide } from './hooks/useDepDrag';
import { TaskBar } from './TaskBar';
import { CheckinDots } from './CheckinDots';
import { HeatStrip } from './HeatStrip';
import { GoalSummary } from './GoalSummary';
import { TrackSummary } from './TrackSummary';
import { BAR_H, BAR_TOP, BASELINE_H, HEAT_MODE_THRESHOLD } from './constants';

interface Props {
  layout: RowLayout;
  rowStart: number;
  rowEnd: number;
  goals: Record<string, Goal>;
  tasks: Record<string, Task>;
  milestones: Record<string, Milestone>;
  derive: Map<string, GoalGantt>;
  trackIndex: TrackIndex;
  /** 含筛选临时展开在内的最终展开集合 */
  expandedTrackIds: string[];
  scale: TimeScale;
  /** 可视日索引范围（点阵列虚拟化） */
  visStart: number;
  visEnd: number;
  today: string;
  collapsedGoalIds: string[];
  /** 显示基线对比（bar 下 4px 灰色原计划条） */
  showBaseline: boolean;
  /**
   * 番茄索引（点阵中间态）。⚠️ 绝不塞进 useGanttDerive 的输入：那个 hook 的第 1 层是
   * 「6 个输入引用全等则直接返回上一轮」，多一个会变的 map 就是顶层短路每次失效。
   */
  focusIndex: GanttFocusIndex;
  /** 筛选淡出集合（hideOthers 时为空集） */
  dimTaskIds: Set<string>;
  dimGoalIds: Set<string>;
  onBarHover: (taskId: string | null, e?: { clientX: number; clientY: number }) => void;
  onBarDragStart: (e: React.PointerEvent, taskId: string, mode: BarDragMode) => void;
  onDepDragStart: (e: React.PointerEvent, taskId: string, side: DepHandleSide) => void;
  onDotClick: (taskId: string, date: string, e: React.MouseEvent) => void;
  /** 折叠轨道条上点某一段 → 展开并定位到那一段任务 */
  onTrackSegmentClick: (trackId: string, segmentIndex: number) => void;
}

export const BarsLayer = memo(function BarsLayer({
  layout,
  rowStart,
  rowEnd,
  goals,
  tasks,
  milestones,
  derive,
  trackIndex,
  expandedTrackIds,
  scale,
  visStart,
  visEnd,
  today,
  collapsedGoalIds,
  showBaseline,
  focusIndex,
  dimTaskIds,
  dimGoalIds,
  onBarHover,
  onBarDragStart,
  onDepDragStart,
  onDotClick,
  onTrackSegmentClick,
}: Props) {
  const prevMsRef = useRef<Map<string, Milestone[]>>(new Map());
  const milestonesByGoal = useMemo(() => {
    const next = stableGroupBy(
      Object.values(milestones).filter((m) => !m.deletedAt),
      (m) => m.goalId,
      prevMsRef.current,
    );
    prevMsRef.current = next;
    return next;
  }, [milestones]);

  // 可视日索引 → 日期字符串（点阵按字符串区间过滤，避免逐点 dayjs 比较）
  const [visStartDate, visEndDate] = useMemo(() => {
    const start = toDay(scale.yearStart);
    return [fmtDay(start.add(visStart, 'day')), fmtDay(start.add(visEnd, 'day'))];
  }, [scale.yearStart, visStart, visEnd]);

  const heatMode = scale.dayWidth < HEAT_MODE_THRESHOLD;

  return (
    <div className="pointer-events-none absolute inset-0">
      {layout.rows.slice(rowStart, rowEnd + 1).map((r) => {
        if (r.kind === 'ghost') return null;
        if (r.kind === 'goal') {
          const goal = goals[r.id];
          const gg = derive.get(r.id);
          if (!goal || !gg) return null;
          const summary = (
            <GoalSummary
              key={r.id}
              goal={goal}
              rowTop={r.top}
              collapsed={collapsedGoalIds.includes(r.id)}
              gg={gg}
              milestones={milestonesByGoal.get(r.id) ?? []}
              scale={scale}
            />
          );
          return dimGoalIds.has(r.id) ? (
            <div key={r.id} style={{ opacity: 0.3 }}>
              {summary}
            </div>
          ) : (
            summary
          );
        }
        if (r.kind === 'track') {
          const track = trackIndex.byId[r.trackId!];
          const tk = derive.get(r.goalId)?.perTrack.get(r.trackId!);
          const goal = goals[r.goalId];
          if (!track || !tk || !goal) return null;
          const summary = (
            <TrackSummary
              key={r.id}
              track={track}
              tk={tk}
              rowTop={r.top}
              expanded={expandedTrackIds.includes(track.id)}
              color={goal.color}
              scale={scale}
              onSegmentClick={onTrackSegmentClick}
            />
          );
          // 整条轨道都被筛掉才淡出（部分命中时上层已把它临时展开）
          const dim =
            dimGoalIds.has(r.goalId) || track.memberIds.every((id) => dimTaskIds.has(id));
          return dim ? (
            <div key={r.id} style={{ opacity: 0.3 }}>
              {summary}
            </div>
          ) : (
            summary
          );
        }
        const task = tasks[r.id];
        const goal = goals[r.goalId];
        const tg = derive.get(r.goalId)?.perTask.get(r.id);
        if (!task || !goal || !tg) return null;
        const x = dateToX(scale, task.startDate);
        const width = (diffDays(task.endDate, task.startDate) + 1) * scale.dayWidth;
        const dim = dimTaskIds.has(r.id) || dimGoalIds.has(r.goalId);
        return (
          <div key={r.id} style={{ opacity: dim ? 0.3 : 1, transition: 'opacity var(--dur-zoom) var(--ease)' }}>
            <TaskBar
              task={task}
              rowTop={r.top}
              x={x}
              width={width}
              color={goal.color}
              tg={tg}
              onHover={onBarHover}
              onDragStart={onBarDragStart}
              onDepDragStart={onDepDragStart}
            />
            {showBaseline && task.baseline && (
              <div
                className="absolute"
                title={`原计划 ${task.baseline.startDate} ~ ${task.baseline.endDate}`}
                style={{
                  top: r.top + BAR_TOP + BAR_H,
                  left: dateToX(scale, task.baseline.startDate),
                  width: (diffDays(task.baseline.endDate, task.baseline.startDate) + 1) * scale.dayWidth,
                  height: BASELINE_H,
                  borderRadius: BASELINE_H / 2,
                  background: 'var(--border-strong)',
                  opacity: 0.8,
                }}
              />
            )}
            {heatMode ? (
              <HeatStrip
                top={r.top + BAR_TOP + BAR_H}
                x={x}
                width={width}
                scale={scale}
                weekHeat={tg.weekHeat}
                color={goal.color}
              />
            ) : (
              <CheckinDots
                rowTop={r.top}
                x={x}
                width={width}
                scale={scale}
                tg={tg}
                color={goal.color}
                today={today}
                visStartDate={visStartDate}
                visEndDate={visEndDate}
                taskId={r.id}
                focusDays={focusIndex.focusDaysByTask.get(r.id)}
                onDotClick={onDotClick}
              />
            )}
          </div>
        );
      })}
    </div>
  );
});
