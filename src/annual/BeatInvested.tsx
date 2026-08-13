/**
 * beat 1 投入：这一年真的花掉了多少时间，以及花在了谁身上。
 *
 * 口径全部来自 annualIndex（唯一权威 = focus.ts 的 effectiveMsByGoalPrefix，
 * 即 max(手填, 番茄) 在 (goal, task, date) 粒度取 max 再求和）。本组件不做任何累加。
 * 未归类会话必须显式披露 —— hero 静静吞掉它就是在撒谎（规格 §3.2）。
 */
import type { Goal } from '../types/domain';
// 直接指向 annual.ts 而非 barrel：见 YearReportPage 顶部的包体注释
import { equivalentWorkdays, type AnnualIndex } from '../lib/derive/annual';
import { goalColor } from '../lib/colors';
import { humanMs } from '../pomodoro/format';
import { Beat, ChartBox, HeroNumber } from './Beat';
import { BAR_GAP, BAR_H, BAR_LABEL_W, BAR_VALUE_W, CHART_W, SVG_RADIUS_SM } from './constants';
import { clipText, hoursOf } from './format';

interface Props {
  idx: AnnualIndex;
  goals: Goal[];
}

export function BeatInvested({ idx, goals }: Props) {
  const { byGoal, goalTotalMs, unassignedMs, unassignedCount } = idx.invested;

  const rows = goals
    .map((g) => ({ goal: g, ms: byGoal.get(g.id) ?? 0 }))
    .filter((r) => r.ms > 0)
    .sort((a, b) => b.ms - a.ms);

  if (goalTotalMs === 0 && unassignedMs === 0) return null;

  // hero、工作日折算、下面的条形三者必须同一个底（都是「归到目标的投入」）：
  // 相邻数字混用两个底，读者第一反应是「103.7 / 8 ≠ 13.7，谁错了」——
  // 未归类的披露放脚注，而不是偷偷混进折算里。
  const workdays = equivalentWorkdays(goalTotalMs);
  const maxMs = rows.length > 0 ? rows[0].ms : 1;
  const barX = BAR_LABEL_W + 8;
  const barW = CHART_W - barX - BAR_VALUE_W;
  const h = Math.max(BAR_H, rows.length * (BAR_H + BAR_GAP) - BAR_GAP);
  const top = rows[0];

  return (
    <Beat
      index={1}
      eyebrow="投入"
      title={
        top ? (
          <>
            投入的时间里，<span style={{ color: goalColor(top.goal.color) }}>{top.goal.name}</span>{' '}
            拿走最多 —— <span className="tnum">{hoursOf(top.ms)}</span> 小时，占{' '}
            <span className="tnum">{Math.round((top.ms / goalTotalMs) * 100)}%</span>。
          </>
        ) : (
          <>这个区间的投入还没有归到任何目标上。</>
        )
      }
      footnote={
        <>
          投入 = 每天每任务取「手填分钟」与「番茄净时长」的较大值再求和，与复盘页同一套口径。
          {unassignedCount > 0 && (
            <>
              {' '}
              另有 <span className="tnum">{unassignedCount}</span> 段未归类（
              <span className="tnum">{humanMs(unassignedMs)}</span>）未计入上面的目标分布，可在番茄钟面板归类。
            </>
          )}
        </>
      }
    >
      <HeroNumber
        value={hoursOf(goalTotalMs)}
        unit="小时"
        format={(n) => n.toFixed(1)}
        sub={
          <>
            相当于 <span className="tnum">{workdays.toFixed(1)}</span> 个 8 小时工作日 · 已归类到目标
          </>
        }
      />

      {rows.length > 0 && (
        <ChartBox width={CHART_W} height={h} label="各目标投入时长">
          {rows.map((r, i) => {
            const y = i * (BAR_H + BAR_GAP);
            const w = Math.max(2, (r.ms / maxMs) * barW);
            return (
              <g key={r.goal.id}>
                <text
                  x={BAR_LABEL_W}
                  y={y + BAR_H - 3}
                  textAnchor="end"
                  fill="var(--text-secondary)"
                  style={{ fontSize: 'var(--font-12)' }}
                >
                  {clipText(`${r.goal.icon ? `${r.goal.icon} ` : ''}${r.goal.name}`, 12)}
                </text>
                <rect
                  x={barX}
                  y={y}
                  width={barW}
                  height={BAR_H}
                  rx={SVG_RADIUS_SM}
                  fill="var(--bg-subtle)"
                />
                <rect
                  x={barX}
                  y={y}
                  width={w}
                  height={BAR_H}
                  rx={SVG_RADIUS_SM}
                  fill={goalColor(r.goal.color)}
                  stroke="var(--bar-inner-stroke)"
                />
                <text
                  className="tnum"
                  x={CHART_W}
                  y={y + BAR_H - 3}
                  textAnchor="end"
                  fill="var(--text-tertiary)"
                  style={{ fontSize: 'var(--font-12)' }}
                >
                  {humanMs(r.ms)}
                </text>
              </g>
            );
          })}
        </ChartBox>
      )}
    </Beat>
  );
}
