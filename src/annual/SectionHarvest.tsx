/** §03 收获：里程碑落在时间轴上 + 清单（点一下回甘特图）；每个目标的结局卡 */
import { useState } from 'react';
import type { AnnualIndex, GoalOutcome, GoalStatusCard } from '../lib/derive/annual';
import { diffDays } from '../lib/date';
import { goalColor } from '../lib/colors';
import { PROGRESS_RING } from './constants';
import { longDay, monthNum, shortDay } from './format';
import { Em, GoalDot, Section, type GoalMap } from './parts';
import { useLocate } from './useLocate';

const MAX_LIST = 10;

const OUTCOME_ORDER: Record<GoalOutcome, number> = { completed: 0, active: 1, stalled: 2, adhocOnly: 3 };

function outcomeLabel(c: GoalStatusCard): { text: string; tone: string } {
  switch (c.outcome) {
    case 'completed':
      return { text: '✓ 已完成', tone: 'success' };
    case 'active':
      return { text: '● 进行中', tone: 'accent' };
    case 'stalled':
      return { text: `⏸ 已停 ${c.idleDays} 天`, tone: 'warning' };
    default:
      return { text: '◌ 随缘', tone: 'muted' };
  }
}

function ProgressRing({ pct, color, done }: { pct: number; color: string; done: boolean }) {
  const { size, stroke } = PROGRESS_RING;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="yr-pring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="yr-pring-bg" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="yr-pring-fg"
        strokeWidth={stroke}
        style={{ stroke: color, strokeDasharray: c, '--len': c, '--off': c * (1 - Math.min(100, pct) / 100) } as React.CSSProperties}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="yr-pring-text tnum">
        {done ? '✓' : Math.round(pct)}
      </text>
    </svg>
  );
}

export function SectionHarvest({ idx, goals, no }: { idx: AnnualIndex; goals: GoalMap; no: string }) {
  const { milestones, outcomes, range } = idx;
  const { scrollToDate } = useLocate();
  const [expanded, setExpanded] = useState(false);

  const total = idx.totalDays;
  const completed = outcomes.filter((o) => o.outcome === 'completed').length;
  const upcoming = milestones.rows.filter((m) => !m.achieved && !m.overdue).length;
  const cards = [...outcomes].sort(
    (a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || b.progressPct - a.progressPct,
  );
  const list = expanded ? milestones.rows : milestones.rows.slice(0, MAX_LIST);
  const posOf = (date: string): number => ((diffDays(date, range.start) + 0.5) / total) * 100;
  const todayPos = range.clipped && range.clippedEnd >= range.start ? posOf(range.clippedEnd) : null;

  const title =
    milestones.rows.length > 0 ? (
      <>
        抵达了 <Em>{milestones.achieved}</Em> 个里程碑
        {completed > 0 && (
          <>
            ，完成 <Em>{completed}</Em> 个目标
          </>
        )}
      </>
    ) : completed > 0 ? (
      <>
        完成了 <Em>{completed}</Em> 个目标
      </>
    ) : (
      <>
        <Em>{outcomes.filter((o) => o.outcome !== 'adhocOnly').length}</Em> 个目标仍在路上
      </>
    );

  const sub =
    milestones.due > 0 ? (
      <>
        到期的 <b className="tnum">{milestones.due}</b> 个里兑现了{' '}
        <b className="tnum">{Math.round((milestones.achieved / milestones.due) * 100)}%</b>
        {upcoming > 0 && (
          <>
            ，还有 <b className="tnum">{upcoming}</b> 个在前方
          </>
        )}
        。
      </>
    ) : upcoming > 0 ? (
      <>
        还有 <b className="tnum">{upcoming}</b> 个里程碑在前方。
      </>
    ) : undefined;

  return (
    <Section no={no} eyebrow="收获" title={title} sub={sub}>
      {milestones.rows.length > 0 && (
        <>
          <div className="yr-tl" role="img" aria-label="里程碑时间轴">
            <div className="yr-tl-axis" />
            {range.monthPrefixes.map((m, i) => (
              <span
                key={m}
                className={`yr-tl-month tnum${i % 2 ? ' is-minor' : ''}`}
                style={{ left: `${posOf(`${m}-01`)}%` }}
              >
                {monthNum(m)}月
              </span>
            ))}
            {todayPos !== null && <span className="yr-tl-today" style={{ left: `${todayPos}%` }} />}
            {milestones.rows.map((m, i) => {
              const goal = goals.get(m.goalId);
              const state = m.achieved ? 'done' : m.overdue ? 'overdue' : 'ahead';
              return (
                <span
                  key={m.id}
                  className={`yr-tl-mark is-${state}`}
                  style={
                    {
                      left: `${posOf(m.date)}%`,
                      '--mc': goal ? goalColor(goal.color) : 'var(--text-tertiary)',
                      '--d': `${200 + i * 40}ms`,
                    } as React.CSSProperties
                  }
                  data-tip={`${longDay(m.date)} · ${goal?.name ?? ''}\n${m.name}\n${
                    m.achieved ? '已达成' : m.overdue ? '过了日子仍未达成' : '还没到日子'
                  }`}
                />
              );
            })}
          </div>

          <ul className="yr-ms-list">
            {list.map((m) => {
              const goal = goals.get(m.goalId);
              const state = m.achieved ? 'done' : m.overdue ? 'overdue' : 'ahead';
              const gap = Math.abs(diffDays(m.date, range.clippedEnd));
              return (
                <li key={m.id}>
                  <button type="button" className="yr-ms" onClick={() => scrollToDate(m.date)} title="在甘特图中定位">
                    <span className="yr-ms-date tnum">{shortDay(m.date)}</span>
                    <span className={`yr-ms-icon is-${state}`} style={{ '--mc': goal ? goalColor(goal.color) : undefined } as React.CSSProperties} />
                    <span className="yr-ms-name">{m.name}</span>
                    <span className="yr-ms-goal">
                      <GoalDot goal={goal} size={6} />
                      {goal?.name ?? ''}
                    </span>
                    <span className={`yr-ms-state is-${state} tnum`}>
                      {state === 'done' ? '✓ 达成' : state === 'overdue' ? `已过 ${gap} 天` : `还有 ${gap} 天`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {milestones.rows.length > MAX_LIST && (
            <button type="button" className="yr-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '收起' : `展开全部 ${milestones.rows.length} 个`}
            </button>
          )}
        </>
      )}

      {cards.length > 0 && (
        <div className="yr-block">
          <p className="yr-block-title">每个目标走到了哪</p>
          <div className="yr-outcomes">
            {cards.map((c) => {
              const goal = goals.get(c.goalId);
              const label = outcomeLabel(c);
              return (
                <div key={c.goalId} className="yr-outcome">
                  <ProgressRing
                    pct={c.outcome === 'completed' ? 100 : c.progressPct}
                    done={c.outcome === 'completed'}
                    color={goal ? goalColor(goal.color) : 'var(--text-tertiary)'}
                  />
                  <div className="yr-outcome-text">
                    <p className="yr-outcome-name">
                      {goal?.icon ? `${goal.icon} ` : ''}
                      {goal?.name ?? '已删除的目标'}
                    </p>
                    <p className={`yr-outcome-state is-${label.tone}`}>{label.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}
