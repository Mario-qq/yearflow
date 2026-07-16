/**
 * bar 层：任务 bar + 打卡点阵/热度条 + 目标行汇总条/里程碑（行虚拟化）。
 * 点阵/热度模式由连续 dayWidth 判定（缩放动画中自然切换）。
 * 容器 pointer-events-none，仅 bar 自身可交互（tooltip / Phase 3 拖拽）。
 */
import { Fragment, memo, useMemo, useRef } from 'react';
import type { Goal, Milestone, Task } from '../types/domain';
import type { GoalGantt } from '../lib/derive';
import type { RowLayout } from './rowLayout';
import { dateToX, type TimeScale } from './timeScale';
import { diffDays, fmtDay, toDay } from '../lib/date';
import { stableGroupBy } from '../lib/stableSlices';
import { TaskBar } from './TaskBar';
import { CheckinDots } from './CheckinDots';
import { HeatStrip } from './HeatStrip';
import { GoalSummary } from './GoalSummary';
import { BAR_H, BAR_TOP, HEAT_MODE_THRESHOLD } from './constants';

interface Props {
  layout: RowLayout;
  rowStart: number;
  rowEnd: number;
  goals: Record<string, Goal>;
  tasks: Record<string, Task>;
  milestones: Record<string, Milestone>;
  derive: Map<string, GoalGantt>;
  scale: TimeScale;
  /** 可视日索引范围（点阵列虚拟化） */
  visStart: number;
  visEnd: number;
  today: string;
  collapsedGoalIds: string[];
  onBarHover: (taskId: string | null, e?: { clientX: number; clientY: number }) => void;
}

export const BarsLayer = memo(function BarsLayer({
  layout,
  rowStart,
  rowEnd,
  goals,
  tasks,
  milestones,
  derive,
  scale,
  visStart,
  visEnd,
  today,
  collapsedGoalIds,
  onBarHover,
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
        if (r.kind === 'goal') {
          const goal = goals[r.id];
          const gg = derive.get(r.id);
          if (!goal || !gg) return null;
          return (
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
        }
        const task = tasks[r.id];
        const goal = goals[r.goalId];
        const tg = derive.get(r.goalId)?.perTask.get(r.id);
        if (!task || !goal || !tg) return null;
        const x = dateToX(scale, task.startDate);
        const width = (diffDays(task.endDate, task.startDate) + 1) * scale.dayWidth;
        return (
          <Fragment key={r.id}>
            <TaskBar
              task={task}
              rowTop={r.top}
              x={x}
              width={width}
              color={goal.color}
              tg={tg}
              onHover={onBarHover}
            />
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
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
});
