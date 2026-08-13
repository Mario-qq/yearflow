/**
 * 年度总览（SPEC 第七节）：投入时长按目标堆叠面积图（recharts）、各目标任务完成数、
 * 里程碑达成时间线、基线偏移排行榜。
 */
import { memo, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CheckIn, FocusSession, Goal, Milestone, Task } from '../types/domain';
import { baselineDrift, effectiveMsByGoalByYear } from '../lib/derive';
import { goalColor, goalColorAlpha } from '../lib/colors';
import { toDay } from '../lib/date';

interface Props {
  year: number;
  goals: Goal[];
  tasks: Task[];
  milestones: Milestone[];
  checkIns: CheckIn[];
  /** 专注会话；缺省为空则投入时长退化为纯手填口径 */
  sessions?: FocusSession[];
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="border p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-panel)',
      }}
    >
      <h2 className="mb-3 font-medium" style={{ fontSize: 'var(--font-14)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** recharts 自定义 tooltip：跟随主题令牌 */
function HoursTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="border px-3 py-2"
      style={{
        borderColor: 'var(--border-default)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-raised)',
        boxShadow: 'var(--shadow-lg)',
        fontSize: 'var(--font-12)',
      }}
    >
      <div className="mb-1" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </div>
      {payload
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2"
              style={{ background: p.color, borderRadius: 999 }}
              aria-hidden
            />
            <span style={{ color: 'var(--text-primary)' }}>{p.name}</span>
            <span className="tnum ml-auto pl-3" style={{ color: 'var(--text-secondary)' }}>
              {p.value} 小时
            </span>
          </div>
        ))}
    </div>
  );
}

export const AnnualOverview = memo(function AnnualOverview({
  year,
  goals,
  tasks,
  milestones,
  checkIns,
  sessions = [],
}: Props) {
  // 投入毫秒：月 × 目标，堆叠面积图与「投入总时长」卡共用这一份（全程 ms，只在渲染处取整）
  const msByMonth = useMemo(
    () => effectiveMsByGoalByYear(checkIns, sessions, year),
    [checkIns, sessions, year],
  );

  // 堆叠面积图数据：月 × 目标小时数（保留 1 位小数）
  const hoursData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const row: Record<string, number | string> = { month: `${m}月` };
      const byGoal = msByMonth.get(m);
      for (const g of goals) {
        row[g.id] = byGoal ? Math.round(((byGoal.get(g.id) ?? 0) / 3600000) * 10) / 10 : 0;
      }
      return row;
    });
  }, [msByMonth, goals]);
  const hasHours = useMemo(
    () => hoursData.some((row) => goals.some((g) => (row[g.id] as number) > 0)),
    [hoursData, goals],
  );

  // 全年投入总时长：按目标汇总毫秒后才取整，绝不累加已四舍五入的月值
  const totals = useMemo(() => {
    const byGoal = new Map<string, number>();
    for (const byGoalOfMonth of msByMonth.values()) {
      for (const [goalId, ms] of byGoalOfMonth) {
        byGoal.set(goalId, (byGoal.get(goalId) ?? 0) + ms);
      }
    }
    const rows = goals
      .map((g) => ({ goal: g, hours: Math.round(((byGoal.get(g.id) ?? 0) / 3600000) * 10) / 10 }))
      .filter((r) => r.hours > 0)
      .sort((a, b) => b.hours - a.hours);
    const grand = Math.round((rows.reduce((s, r) => s + r.hours, 0)) * 10) / 10;
    const max = Math.max(1, ...rows.map((r) => r.hours));
    return { rows, grand, max };
  }, [msByMonth, goals]);

  // 各目标任务完成数
  const doneCounts = useMemo(
    () =>
      goals.map((g) => {
        const list = tasks.filter((t) => !t.deletedAt && t.goalId === g.id);
        return { goal: g, done: list.filter((t) => t.status === 'done').length, total: list.length };
      }),
    [goals, tasks],
  );
  const maxTotal = Math.max(1, ...doneCounts.map((d) => d.total));

  // 里程碑时间线（按日期排序，标签上下交错防碰撞）
  const msList = useMemo(
    () =>
      milestones
        .filter((m) => !m.deletedAt && m.date.startsWith(`${year}-`))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    [milestones, year],
  );
  const yearStart = toDay(`${year}-01-01`);
  const daysInYear = toDay(`${year}-12-31`).diff(yearStart, 'day') + 1;

  // 基线偏移排行（结束日偏移绝对值降序，取前 8）
  const drifts = useMemo(
    () =>
      tasks
        .filter((t) => !t.deletedAt && t.baseline)
        .map((t) => ({ task: t, drift: baselineDrift(t)! }))
        .filter((d) => d.drift.endDriftDays !== 0)
        .sort((a, b) => Math.abs(b.drift.endDriftDays) - Math.abs(a.drift.endDriftDays))
        .slice(0, 8),
    [tasks],
  );
  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  return (
    <div className="flex flex-col gap-4">
      <Card title="投入时长（小时 / 月，按目标堆叠）">
        {hasHours ? (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={hoursData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border-default)' }}
                  tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                  width={40}
                />
                <Tooltip content={<HoursTooltip />} />
                {goals.map((g) => (
                  <Area
                    key={g.id}
                    dataKey={g.id}
                    name={g.name}
                    stackId="hours"
                    stroke={goalColor(g.color)}
                    strokeWidth={1.5}
                    fill={goalColorAlpha(g.color, 40)}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {goals.map((g) => (
                <span key={g.id} className="flex items-center gap-1.5" style={{ fontSize: 'var(--font-12)' }}>
                  <span
                    className="inline-block h-2 w-2"
                    style={{ background: goalColor(g.color), borderRadius: 999 }}
                    aria-hidden
                  />
                  <span style={{ color: 'var(--text-secondary)' }}>{g.name}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            还没有记录时长。打卡时展开条目选择分钟数，这里会按月累计。
          </p>
        )}
      </Card>

      <Card title="投入总时长（小时 / 年，按目标）">
        {totals.rows.length === 0 ? (
          <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            还没有记录时长。打卡时展开条目选择分钟数，这里会全年累计。
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-baseline gap-2">
              <span className="tnum font-medium" style={{ fontSize: 'var(--font-20)' }}>
                {totals.grand}
              </span>
              <span style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
                小时 · 全年合计
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {totals.rows.map(({ goal, hours }) => (
                <div key={goal.id} className="flex items-center gap-2">
                  <span className="w-28 truncate" style={{ fontSize: 'var(--font-12)' }}>
                    {goal.icon} {goal.name}
                  </span>
                  <div
                    className="relative h-3 flex-1 overflow-hidden"
                    style={{ background: 'var(--bg-subtle)', borderRadius: 999 }}
                  >
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{
                        width: `${(hours / totals.max) * 100}%`,
                        background: goalColor(goal.color),
                        borderRadius: 999,
                      }}
                    />
                  </div>
                  <span
                    className="tnum w-16 text-right"
                    style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}
                  >
                    {hours} 小时
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card title="任务完成数">
        <div className="flex flex-col gap-2">
          {doneCounts.map(({ goal, done, total }) => (
            <div key={goal.id} className="flex items-center gap-2">
              <span className="w-28 truncate" style={{ fontSize: 'var(--font-12)' }}>
                {goal.icon} {goal.name}
              </span>
              <div className="relative h-3 flex-1 overflow-hidden" style={{ background: 'var(--bg-subtle)', borderRadius: 999 }}>
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${(total / maxTotal) * 100}%`,
                    background: goalColorAlpha(goal.color, 15),
                    borderRadius: 999,
                  }}
                />
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${(done / maxTotal) * 100}%`,
                    background: goalColor(goal.color),
                    borderRadius: 999,
                  }}
                />
              </div>
              <span className="tnum w-14 text-right" style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}>
                {done} / {total}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="里程碑时间线">
        {msList.length === 0 ? (
          <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>本年没有里程碑。</p>
        ) : (
          <div className="overflow-x-auto">
            <svg width="100%" height={92} viewBox="0 0 720 92" preserveAspectRatio="none" aria-hidden className="block min-w-120">
              <line x1={8} y1={46} x2={712} y2={46} stroke="var(--border-default)" strokeWidth={1} />
              {Array.from({ length: 12 }, (_, i) => {
                const x = 8 + (toDay(`${year}-${String(i + 1).padStart(2, '0')}-01`).diff(yearStart, 'day') / daysInYear) * 704;
                return (
                  <g key={i}>
                    <line x1={x} y1={42} x2={x} y2={50} stroke="var(--border-default)" strokeWidth={1} />
                    <text x={x + 2} y={58} style={{ fontSize: 9, fill: 'var(--text-tertiary)' }}>
                      {i + 1}月
                    </text>
                  </g>
                );
              })}
              {msList.map((m, i) => {
                const x = 8 + (toDay(m.date).diff(yearStart, 'day') / daysInYear) * 704;
                const color = goalColor(goalById.get(m.goalId)?.color ?? 'goal-1');
                const up = i % 2 === 0;
                return (
                  <g key={m.id}>
                    <path
                      d={`M ${x} 40 L ${x + 6} 46 L ${x} 52 L ${x - 6} 46 Z`}
                      fill={m.achieved ? color : 'var(--bg-panel)'}
                      stroke={color}
                      strokeWidth={1.5}
                    />
                    {m.achieved && (
                      <text x={x} y={49.5} textAnchor="middle" style={{ fontSize: 7, fill: 'var(--text-on-accent)' }}>
                        ✓
                      </text>
                    )}
                    <text
                      x={x}
                      y={up ? 30 : 74}
                      textAnchor="middle"
                      style={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                    >
                      {m.name}
                    </text>
                    <text
                      x={x}
                      y={up ? 18 : 86}
                      textAnchor="middle"
                      className="tnum"
                      style={{ fontSize: 9, fill: 'var(--text-tertiary)' }}
                    >
                      {toDay(m.date).format('M.DD')}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </Card>

      <Card title="基线偏移排行（哪些计划拖得最狠）">
        {drifts.length === 0 ? (
          <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            没有偏移基线的任务。顶栏「保存基线」后，拖动任务即可在这里看到偏移。
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {drifts.map(({ task, drift }, i) => {
              const g = goalById.get(task.goalId);
              const late = drift.endDriftDays > 0;
              return (
                <div key={task.id} className="flex items-center gap-2" style={{ fontSize: 'var(--font-12)' }}>
                  <span className="tnum w-5 text-right" style={{ color: 'var(--text-tertiary)' }}>
                    {i + 1}
                  </span>
                  <span
                    className="inline-block h-2 w-2 shrink-0"
                    style={{ background: goalColor(g?.color ?? 'goal-1'), borderRadius: 999 }}
                    aria-hidden
                  />
                  <span className="truncate">{task.name}</span>
                  <span className="tnum ml-auto shrink-0" style={{ color: late ? 'var(--danger)' : 'var(--success)' }}>
                    {late ? '+' : ''}
                    {drift.endDriftDays} 天
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
});
