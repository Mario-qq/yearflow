/** §01 时间去哪了：一条按目标分段的总条 + 每个目标一张卡（小时数 + 逐月迷你柱） */
import type { AnnualIndex, GoalInvest } from '../lib/derive/annual';
import type { Goal } from '../types/domain';
import { goalColor } from '../lib/colors';
import { SPARK } from './constants';
import { hoursOf, humanDuration, monthNum, pctOf } from './format';
import { Em, GoalDot, GoalName, Section, type GoalMap } from './parts';

interface Row {
  key: string;
  goal?: Goal;
  name: string;
  color: string;
  ms: number;
  share: number;
  byMonth: number[];
}

function Spark({ row, months }: { row: Row; months: string[] }) {
  const max = Math.max(...row.byMonth, 1);
  const n = row.byMonth.length;
  const w = (SPARK.width - SPARK.gap * (n - 1)) / n;
  return (
    <svg className="yr-spark" viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} preserveAspectRatio="none" aria-hidden>
      {row.byMonth.map((ms, i) => {
        const h = ms > 0 ? Math.max(2, (ms / max) * SPARK.height) : 1;
        return (
          <rect
            key={months[i]}
            x={i * (w + SPARK.gap)}
            y={SPARK.height - h}
            width={w}
            height={h}
            rx={Math.min(1.5, w / 2)}
            style={{ fill: ms > 0 ? row.color : 'var(--border-default)' }}
            data-tip={`${monthNum(months[i])} 月 · ${row.name}\n${ms > 0 ? humanDuration(ms) : '没有投入'}`}
          />
        );
      })}
    </svg>
  );
}

export function SectionTime({ idx, goals, no }: { idx: AnnualIndex; goals: GoalMap; no: string }) {
  const { invested, range } = idx;
  const rows: Row[] = invested.goals.map((g: GoalInvest) => {
    const goal = goals.get(g.goalId);
    return {
      key: g.goalId,
      goal,
      name: goal?.name ?? '已删除的目标',
      color: goal ? goalColor(goal.color) : 'var(--text-disabled)',
      ms: g.ms,
      share: g.share,
      byMonth: g.byMonth,
    };
  });
  if (invested.unassignedMs > 0) {
    rows.push({
      key: '__unassigned',
      name: '未归类专注',
      color: 'var(--text-disabled)',
      ms: invested.unassignedMs,
      share: invested.unassignedMs / invested.totalMs,
      byMonth: invested.unassignedByMonth,
    });
  }

  const top = invested.goals[0];
  const topGoal = top ? goals.get(top.goalId) : undefined;
  const perDay = idx.elapsedDays > 0 ? invested.totalMs / idx.elapsedDays : 0;
  const peakMonth = (r: Row): string => {
    let best = 0;
    r.byMonth.forEach((ms, i) => {
      if (ms > r.byMonth[best]) best = i;
    });
    return `${monthNum(range.monthPrefixes[best])} 月`;
  };

  return (
    <Section
      no={no}
      eyebrow="时间去哪了"
      title={
        top ? (
          <>
            <GoalName goal={topGoal} /> 拿走了最多的时间：<Em>{hoursOf(top.ms)}</Em> 小时，占 <Em>{pctOf(top.share)}%</Em>
          </>
        ) : (
          <>
            专注了 <Em>{hoursOf(invested.unassignedMs)}</Em> 小时，还没有归到任何目标上
          </>
        )
      }
      sub={
        <>
          共投入 <b className="tnum">{hoursOf(invested.totalMs)}</b> 小时，平均每天{' '}
          <b className="tnum">{humanDuration(perDay)}</b>。
        </>
      }
    >
      <div className="yr-stack" role="img" aria-label="各目标投入占比">
        {rows.map((r) => (
          <div
            key={r.key}
            className="yr-stack-seg"
            style={{ flexGrow: r.ms, background: r.color }}
            data-tip={`${r.name}\n${humanDuration(r.ms)} · ${pctOf(r.share)}%`}
          />
        ))}
      </div>

      <div className="yr-tiles">
        {rows.map((r) => (
          <div key={r.key} className="yr-tile" style={{ '--tile-c': r.color } as React.CSSProperties}>
            <p className="yr-tile-name">
              <GoalDot goal={r.goal} />
              <span>
                {r.goal?.icon ? `${r.goal.icon} ` : ''}
                {r.name}
              </span>
            </p>
            <p className="yr-tile-value tnum">
              {hoursOf(r.ms)}
              <span className="yr-tile-unit">小时</span>
            </p>
            <p className="yr-tile-meta tnum">
              占 {pctOf(r.share)}%{range.monthPrefixes.length > 1 && ` · ${peakMonth(r)}最多`}
            </p>
            {range.monthPrefixes.length > 1 && <Spark row={r} months={range.monthPrefixes} />}
          </div>
        ))}
      </div>
    </Section>
  );
}
