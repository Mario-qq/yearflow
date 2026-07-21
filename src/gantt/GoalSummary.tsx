/**
 * 目标行时间轴侧（SPEC 4.3 / 4.4）：
 * - 汇总条：6px 细条覆盖子任务总时间范围，目标色 40% 透明度
 * - 折叠时：汇总条下方渲染聚合热度条（信息不丢失）
 * - 里程碑：14px 菱形 + 右侧 11px 名称；achieved 实心 + 勾；
 *   水平拖动改日期（吸附天 + 浮动日期提示），单击切换 achieved，右键「重命名」行内改名
 */
import { memo } from 'react';
import type { Goal, Milestone } from '../types/domain';
import type { GoalGantt } from '../lib/derive';
import { goalColor, goalColorAlpha } from '../lib/colors';
import { dateToX, dayIndexOf, type TimeScale } from './timeScale';
import { diffDays, fmtDay, toDay } from '../lib/date';
import { patchMilestone } from '../store/actions';
import { startPointerDrag } from './lib/dragCore';
import { showDragHint, hideDragHint, fmtDayHint } from './lib/dragHint';
import { HeatStrip } from './HeatStrip';
import { InlineInput } from './grid/InlineInput';
import { useGanttUi } from './uiStore';
import {
  DUR_DROP_MS,
  MILESTONE_D,
  MILESTONE_LABEL_GAP,
  ROW_H_GOAL,
  SUMMARY_BAR_H,
  SUMMARY_HEAT_GAP,
} from './constants';

interface Props {
  goal: Goal;
  rowTop: number;
  collapsed: boolean;
  gg: GoalGantt;
  milestones: Milestone[];
  scale: TimeScale;
}

export const GoalSummary = memo(function GoalSummary({
  goal,
  rowTop,
  collapsed,
  gg,
  milestones,
  scale,
}: Props) {
  const editing = useGanttUi((s) => s.editing);
  const setEditing = useGanttUi((s) => s.setEditing);
  const solid = goalColor(goal.color);
  const barTop = rowTop + (ROW_H_GOAL - SUMMARY_BAR_H) / 2;
  const span = gg.summarySpan;
  const spanX = span ? dateToX(scale, span.startDate) : 0;
  const spanW = span ? (diffDays(span.endDate, span.startDate) + 1) * scale.dayWidth : 0;

  return (
    <>
      {span && (
        <div
          className="absolute"
          style={{
            top: barTop,
            left: spanX,
            width: spanW,
            height: SUMMARY_BAR_H,
            borderRadius: 'var(--radius-sm)',
            background: goal.completedAt ? 'var(--border-strong)' : goalColorAlpha(goal.color, 40),
          }}
        />
      )}
      {collapsed && span && (
        <HeatStrip
          top={barTop + SUMMARY_BAR_H + SUMMARY_HEAT_GAP}
          x={spanX}
          width={spanW}
          scale={scale}
          weekHeat={gg.aggregatedHeat}
          color={goal.color}
        />
      )}
      {milestones.map((m) => {
        const idx = dayIndexOf(scale, m.date);
        if (idx < 0 || idx >= scale.daysInYear) return null;
        const cx = (idx + 0.5) * scale.dayWidth;
        const cy = rowTop + ROW_H_GOAL / 2;
        const d = MILESTONE_D;
        const isEditing = editing?.id === m.id && editing.field === 'milestoneName';

        /** 拖动改日期（吸附天）；未越阈值的单击切换 achieved */
        const onPointerDown = (e: React.PointerEvent) => {
          if (e.button !== 0) return;
          const el = e.currentTarget as HTMLElement;
          let deltaDays = 0;
          startPointerDrag(e, {
            onMove: (s) => {
              const dx = s.clientX - s.startClientX;
              deltaDays = Math.round(dx / scale.dayWidth);
              el.style.transform = `translateX(${dx}px)`;
              showDragHint(s.clientX, s.clientY, fmtDayHint(fmtDay(toDay(m.date).add(deltaDays, 'day'))));
            },
            onEnd: (s, committed) => {
              hideDragHint();
              if (!s.started) {
                // 单击：切换达成状态
                patchMilestone(
                  m.id,
                  { achieved: !m.achieved },
                  `里程碑「${m.name}」${m.achieved ? '取消达成' : '标记达成'}`,
                );
                return;
              }
              if (!committed || deltaDays === 0) {
                el.style.transition = `transform ${DUR_DROP_MS}ms var(--ease)`;
                el.style.transform = 'translateX(0px)';
                setTimeout(() => {
                  el.style.transition = '';
                }, DUR_DROP_MS);
                return;
              }
              // 吸附落位动画 → 提交
              el.style.transition = `transform ${DUR_DROP_MS}ms var(--ease)`;
              el.style.transform = `translateX(${deltaDays * scale.dayWidth}px)`;
              setTimeout(() => {
                el.style.transition = '';
                el.style.transform = '';
                patchMilestone(
                  m.id,
                  { date: fmtDay(toDay(m.date).add(deltaDays, 'day')) },
                  `移动里程碑「${m.name}」`,
                );
              }, DUR_DROP_MS);
            },
          });
        };

        return (
          <div
            key={m.id}
            data-milestone={m.id}
            className={isEditing ? 'absolute' : 'absolute cursor-pointer'}
            style={{ top: cy - d / 2, left: cx - d / 2, pointerEvents: 'auto', touchAction: 'none' }}
            title={isEditing ? undefined : `${m.name} · ${m.date}${m.achieved ? ' ✓' : ''}（拖动改期，单击切换达成，右键重命名）`}
            onPointerDown={isEditing ? undefined : onPointerDown}
          >
            <svg width={d} height={d} aria-hidden>
              <polygon
                points={`${d / 2},0.75 ${d - 0.75},${d / 2} ${d / 2},${d - 0.75} 0.75,${d / 2}`}
                fill={m.achieved ? solid : 'var(--bg-panel)'}
                stroke={solid}
                strokeWidth={1.5}
              />
              {m.achieved && (
                <path
                  d={`M ${d * 0.3} ${d * 0.52} L ${d * 0.45} ${d * 0.67} L ${d * 0.72} ${d * 0.35}`}
                  fill="none"
                  stroke="var(--text-on-accent)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
            {isEditing ? (
              <div
                className="absolute"
                style={{ left: d + MILESTONE_LABEL_GAP, top: (d - 20) / 2, width: 120 }}
              >
                <InlineInput
                  defaultValue={m.name}
                  onCommit={(value) => {
                    const name = value.trim();
                    if (name && name !== m.name) {
                      patchMilestone(m.id, { name }, `重命名里程碑「${m.name}」→「${name}」`);
                    }
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : (
              <span
                className="absolute whitespace-nowrap"
                style={{
                  left: d + MILESTONE_LABEL_GAP,
                  top: 0,
                  lineHeight: `${d}px`,
                  fontSize: 'var(--font-11)',
                  color: 'var(--text-secondary)',
                }}
              >
                {m.name}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
});
