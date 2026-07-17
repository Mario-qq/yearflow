/**
 * 本月甘特只读缩略快照（SPEC 第七节）：每目标一行——任务 span 细条 + 逐日打卡热度格。
 * done=实色 / partial=45% / skipped=灰圈 / missed=淡红 / 未来应打卡=10% 占位；周末列淡纹。
 */
import { memo, useMemo } from 'react';
import type { CheckIn, ExemptionPeriod, Goal, Task } from '../types/domain';
import { bestStatusByDate, expandScheduledDays } from '../lib/derive';
import { goalColor, goalColorAlpha } from '../lib/colors';
import { toDay } from '../lib/date';

const CELL = 16;
const GAP = 2;
const NAME_W = 112;
const BAR_H = 5;
const ROW_H = 30;

interface Props {
  month: string; // YYYY-MM
  goals: Goal[];
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  today: string;
}

export const MiniMonthGantt = memo(function MiniMonthGantt({
  month,
  goals,
  tasks,
  checkIns,
  exemptions,
  today,
}: Props) {
  const first = toDay(`${month}-01`);
  const daysInMonth = first.daysInMonth();
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  const rows = useMemo(
    () =>
      goals.map((goal) => {
        const goalTasks = tasks.filter(
          (t) => !t.deletedAt && t.goalId === goal.id && t.startDate <= monthEnd && t.endDate >= monthStart,
        );
        const scheduled = new Set<string>();
        for (const t of goalTasks) {
          for (const d of expandScheduledDays(t, exemptions)) {
            if (d >= monthStart && d <= monthEnd) scheduled.add(d);
          }
        }
        return { goal, goalTasks, scheduled, statusByDate: bestStatusByDate(checkIns, goal.id) };
      }).filter((r) => r.goalTasks.length > 0),
    [goals, tasks, checkIns, exemptions, monthStart, monthEnd],
  );

  if (rows.length === 0) {
    return (
      <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>本月没有排期任务。</p>
    );
  }

  const gridW = daysInMonth * (CELL + GAP);
  const dayX = (day: number) => NAME_W + (day - 1) * (CELL + GAP);
  const todayDay = today.startsWith(month) ? Number(today.slice(8, 10)) : null;

  return (
    <div className="overflow-x-auto">
      <svg width={NAME_W + gridW} height={20 + rows.length * ROW_H} aria-hidden className="block">
        {/* 周末底纹 + 日号表头 */}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dow = first.add(i, 'day').day();
          const weekend = dow === 0 || dow === 6;
          return (
            <g key={day}>
              {weekend && (
                <rect
                  x={dayX(day) - GAP / 2}
                  y={14}
                  width={CELL + GAP}
                  height={rows.length * ROW_H + 4}
                  fill="var(--weekend-tint)"
                />
              )}
              <text
                x={dayX(day) + CELL / 2}
                y={10}
                textAnchor="middle"
                className="tnum"
                style={{
                  fontSize: 9,
                  fill: day === todayDay ? 'var(--accent)' : 'var(--text-tertiary)',
                  fontWeight: day === todayDay ? 600 : 400,
                }}
              >
                {day}
              </text>
            </g>
          );
        })}
        {todayDay !== null && (
          <line
            x1={dayX(todayDay) + CELL / 2}
            y1={14}
            x2={dayX(todayDay) + CELL / 2}
            y2={18 + rows.length * ROW_H}
            stroke="var(--danger)"
            strokeWidth={1}
            opacity={0.5}
          />
        )}
        {rows.map(({ goal, goalTasks, scheduled, statusByDate }, ri) => {
          const y = 20 + ri * ROW_H;
          const solid = goalColor(goal.color);
          return (
            <g key={goal.id}>
              <text
                x={0}
                y={y + ROW_H / 2 + 4}
                style={{ fontSize: 'var(--font-11)', fill: 'var(--text-secondary)' }}
              >
                {goal.icon} {goal.name.length > 6 ? `${goal.name.slice(0, 6)}…` : goal.name}
              </text>
              {/* 任务 span 细条（裁剪到本月） */}
              {goalTasks.map((t) => {
                const s = t.startDate > monthStart ? Number(t.startDate.slice(8, 10)) : 1;
                const e = t.endDate < monthEnd ? Number(t.endDate.slice(8, 10)) : daysInMonth;
                return (
                  <rect
                    key={t.id}
                    x={dayX(s)}
                    y={y + 4}
                    width={(e - s) * (CELL + GAP) + CELL}
                    height={BAR_H}
                    rx={BAR_H / 2}
                    fill={goalColorAlpha(goal.color, 40)}
                  />
                );
              })}
              {/* 逐日热度格 */}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const date = `${month}-${String(day).padStart(2, '0')}`;
                if (!scheduled.has(date)) return null;
                const status = statusByDate.get(date);
                const cx = dayX(day);
                const cy = y + 4 + BAR_H + 3;
                if (status === 'skipped') {
                  return (
                    <rect key={day} x={cx} y={cy} width={CELL} height={10} rx={2} fill="none" stroke="var(--border-strong)" strokeWidth={1} />
                  );
                }
                let fill: string;
                if (status === 'done') fill = solid;
                else if (status === 'partial') fill = goalColorAlpha(goal.color, 45);
                else if (date < today) fill = 'var(--missed-dot)';
                else fill = goalColorAlpha(goal.color, 10);
                return <rect key={day} x={cx} y={cy} width={CELL} height={10} rx={2} fill={fill} />;
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
});
