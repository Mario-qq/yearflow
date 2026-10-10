/** §04 节律：逐月投入柱（按目标堆叠，下挂完成率与自评）+ 星期×小时的专注时段 */
import { useMemo } from 'react';
import type { AnnualIndex } from '../lib/derive/annual';
import { goalColor } from '../lib/colors';
import { MONTHS } from './constants';
import { dowLabel, dowShort, hoursOf, humanDuration, monthNum } from './format';
import { Em, Section, type GoalMap } from './parts';

function MonthBars({ idx, goals }: { idx: AnnualIndex; goals: GoalMap }) {
  const { range, invested, months, best } = idx;
  const cols = useMemo(() => {
    const list = range.monthPrefixes.map((month, i) => {
      const segs = invested.goals
        .map((g) => {
          const goal = goals.get(g.goalId);
          return { key: g.goalId, name: goal?.name ?? '已删除的目标', color: goal ? goalColor(goal.color) : 'var(--text-disabled)', ms: g.byMonth[i] };
        })
        .filter((s) => s.ms > 0);
      if (invested.unassignedByMonth[i] > 0)
        segs.push({ key: '__un', name: '未归类', color: 'var(--text-disabled)', ms: invested.unassignedByMonth[i] });
      const total = segs.reduce((a, s) => a + s.ms, 0);
      return { month, segs, total, profile: months[i], future: `${month}-01` > range.clippedEnd };
    });
    const max = Math.max(1, ...list.map((c) => c.total));
    return { list, max };
  }, [range, invested, months, goals]);

  return (
    <div className="yr-months">
      {cols.list.map((c, i) => {
        const isBest = best?.month === c.month;
        const p = c.profile;
        const tip = [
          `${monthNum(c.month)} 月${isBest ? ' · 最佳' : ''}`,
          c.total > 0 ? `投入 ${humanDuration(c.total)}` : '没有投入',
          ...(p.rate !== null ? [`完成率 ${p.rate}%${p.complete ? '' : '（进行中）'}`] : []),
          ...(p.rating ? [`自评 ${'★'.repeat(p.rating)}`] : []),
          ...[...c.segs].sort((a, b) => b.ms - a.ms).slice(0, 3).map((s) => `${s.name} ${humanDuration(s.ms)}`),
        ].join('\n');
        return (
          <div key={c.month} className={`yr-month${isBest ? ' is-best' : ''}${c.future ? ' is-future' : ''}`} data-tip={tip}>
            <div className="yr-month-plot" style={{ height: MONTHS.height }}>
              <div className="yr-month-stack" style={{ width: `${MONTHS.barFill * 100}%` }}>
                {isBest && <span className="yr-month-badge">最佳</span>}
                <div
                  className="yr-month-bar"
                  style={{
                    height: c.total > 0 ? Math.max(MONTHS.segGap * 2, (c.total / cols.max) * MONTHS.height) : 0,
                    rowGap: MONTHS.segGap,
                    borderRadius: `${MONTHS.radius}px ${MONTHS.radius}px 0 0`,
                    '--d': `${i * 50}ms`,
                  } as React.CSSProperties}
                >
                  {c.segs.map((s) => (
                    <span key={s.key} style={{ flexGrow: s.ms, background: s.color }} />
                  ))}
                </div>
              </div>
            </div>
            <p className="yr-month-label tnum">{monthNum(c.month)}月</p>
            <p className="yr-month-rate tnum">{p.rate !== null ? `${p.rate}%` : '—'}</p>
            {p.rating ? <p className="yr-month-star tnum">★{p.rating}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function Rhythm({ idx, weekStartsOn }: { idx: AnnualIndex; weekStartsOn: 0 | 1 }) {
  const { grid, max, peak } = useMemo(() => {
    const byKey = new Map(idx.rhythm.map((c) => [c.dow * 24 + c.hour, c]));
    let pk = idx.rhythm[0];
    for (const c of idx.rhythm) if (c.ms > pk.ms) pk = c;
    return {
      grid: byKey,
      max: Math.max(1, ...idx.rhythm.map((c) => c.ms)),
      peak: pk,
    };
  }, [idx.rhythm]);
  const rows = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);

  return (
    <div className="yr-rhythm">
      <span />
      {Array.from({ length: 24 }, (_, h) => (
        <span key={h} className="yr-axis yr-rhythm-hour tnum">
          {h % 6 === 0 ? h : ''}
        </span>
      ))}
      {rows.map((dow) => (
        <div key={dow} className="yr-rhythm-row">
          <span className="yr-axis yr-rhythm-dow">{dowShort(dow)}</span>
          {Array.from({ length: 24 }, (_, h) => {
            const c = grid.get(dow * 24 + h);
            const a = c ? 14 + 86 * (c.ms / max) : 0;
            return (
              <span
                key={h}
                className={`yr-rhythm-cell${c && c === peak ? ' is-peak' : ''}`}
                style={{
                  background: c ? `color-mix(in srgb, var(--accent) ${Math.round(a)}%, transparent)` : undefined,
                  '--d': `${h * 15}ms`,
                } as React.CSSProperties}
                data-tip={`${dowLabel(dow)} ${h}:00–${h + 1}:00\n${c ? `${c.count} 段 · ${humanDuration(c.ms)}` : '没有专注'}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function SectionRhythm({
  idx,
  goals,
  no,
  weekStartsOn,
}: {
  idx: AnnualIndex;
  goals: GoalMap;
  no: string;
  weekStartsOn: 0 | 1;
}) {
  const { best, rhythm, invested, range } = idx;
  const peak = rhythm.length ? rhythm.reduce((a, b) => (b.ms > a.ms ? b : a)) : null;

  let heaviest = 0;
  let heaviestMs = -1;
  range.monthPrefixes.forEach((_, i) => {
    const ms = invested.goals.reduce((a, g) => a + g.byMonth[i], 0) + invested.unassignedByMonth[i];
    if (ms > heaviestMs) {
      heaviestMs = ms;
      heaviest = i;
    }
  });

  const title = best ? (
    <>
      <Em>{monthNum(best.month)} 月</Em>是状态最好的月份，完成率 <Em>{best.rate}%</Em>
    </>
  ) : heaviestMs > 0 ? (
    <>
      <Em>{monthNum(range.monthPrefixes[heaviest])} 月</Em>投入最多，共 <Em>{hoursOf(heaviestMs)}</Em> 小时
    </>
  ) : (
    <>每个月都在这里</>
  );

  return (
    <Section
      no={no}
      eyebrow="节律"
      title={title}
      sub={
        peak ? (
          <>
            你最常在 <b>{dowLabel(peak.dow)} {peak.hour} 点</b> 进入专注，这个时段累计{' '}
            <b className="tnum">{peak.count}</b> 段、<b className="tnum">{humanDuration(peak.ms)}</b>。
          </>
        ) : undefined
      }
    >
      <MonthBars idx={idx} goals={goals} />
      <p className="yr-caption">柱高 = 当月投入时长；下方为打卡完成率{idx.months.some((m) => m.rating) ? '与月度自评' : ''}</p>

      <div className="yr-block">
        <p className="yr-block-title">专注时段</p>
        {rhythm.length > 0 ? (
          <Rhythm idx={idx} weekStartsOn={weekStartsOn} />
        ) : (
          <p className="yr-hint">用番茄钟专注几段，这里会长出你一周里的专注时段。</p>
        )}
      </div>
    </Section>
  );
}
