/** §02 坚持：区间打卡热力（标出最长连续的那一串）+ 各目标最长连续落在哪一段 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { AnnualIndex } from '../lib/derive/annual';
import { diffDays, toDay, weekStartOf } from '../lib/date';
import { goalColor } from '../lib/colors';
import { HEAT, LEVEL_ALPHA, MAX_RUN_ROWS } from './constants';
import { dayWithDow, dowShort, humanDuration, longDay, monthNum, pctOf, scoreLabel, shortDay } from './format';
import { Em, GoalDot, Section, type GoalMap } from './parts';

function Heatmap({ idx, weekStartsOn }: { idx: AnnualIndex; weekStartsOn: 0 | 1 }) {
  const { days, activeSpan, range } = idx;
  const model = useMemo(() => {
    const first = weekStartOf(range.start, weekStartsOn);
    const max = Math.max(1, ...days.map((d) => d.score));
    const months: { col: number; label: string }[] = [];
    let lastMonth = '';
    let cols = 0;
    const cells = days.map((d) => {
      const col = toDay(d.date).diff(toDay(first), 'week');
      const row = (toDay(d.date).day() - weekStartsOn + 7) % 7;
      cols = Math.max(cols, col + 1);
      const m = d.date.slice(0, 7);
      if (m !== lastMonth) {
        lastMonth = m;
        // 月初落在周中时标签放到下一列，避免与上个月的标签挤在一起
        const labelCol = row === 0 ? col : col + 1;
        if (!months.length || labelCol - months[months.length - 1].col >= 3)
          months.push({ col: labelCol, label: `${monthNum(m)}月` });
      }
      const level = d.score > 0 ? Math.min(3, Math.ceil((d.score / max) * 4) - 1) : -1;
      const facts = [d.score > 0 ? scoreLabel(d.score) : '没有打卡'];
      if (d.focusMs > 0) facts.push(`专注 ${humanDuration(d.focusMs)}`);
      return {
        date: d.date,
        col,
        row,
        level,
        future: d.future,
        tip: d.future ? `${dayWithDow(d.date)}\n还没到` : `${dayWithDow(d.date)}\n${facts.join(' · ')}`,
      };
    });
    // 最长连续段在热力图下方画一道括号（它跨周，逐格描边会把图描花）
    let span: { from: number; to: number } | null = null;
    if (activeSpan && activeSpan.days > 1) {
      const inSpan = cells.filter((c) => c.date >= activeSpan.from && c.date <= activeSpan.to);
      span = { from: inSpan[0].col, to: inSpan[inSpan.length - 1].col };
    }
    return { cells, months, cols, span };
  }, [days, activeSpan, range.start, weekStartsOn]);

  const step = HEAT.cell + HEAT.gap;
  const w = HEAT.labelW + model.cols * step;
  const gridBottom = HEAT.labelH + 7 * step;
  const h = gridBottom + (model.span ? HEAT.bracketH : 0);
  const bx1 = model.span ? HEAT.labelW + model.span.from * step : 0;
  const bx2 = model.span ? HEAT.labelW + model.span.to * step + HEAT.cell : 0;
  const by = gridBottom + 3;
  const labelX = Math.min(Math.max((bx1 + bx2) / 2, HEAT.labelW + 48), w - 48);
  return (
    <svg className="yr-heat" viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: w }} role="img" aria-label="打卡热力图">
      {model.months.map((m) => (
        <text key={m.label} className="yr-axis" x={HEAT.labelW + m.col * step} y={11}>
          {m.label}
        </text>
      ))}
      {(weekStartsOn === 1 ? [0, 2, 4] : [1, 3, 5]).map((row) => (
        <text key={row} className="yr-axis" x={0} y={HEAT.labelH + row * step + HEAT.cell - 2}>
          {dowShort((row + weekStartsOn) % 7)}
        </text>
      ))}
      {model.cells.map((c) => (
        <rect
          key={c.date}
          className={`yr-heat-cell${c.future ? ' is-future' : ''}`}
          x={HEAT.labelW + c.col * step}
          y={HEAT.labelH + c.row * step}
          width={HEAT.cell}
          height={HEAT.cell}
          rx={HEAT.radius}
          style={{
            fill: c.level >= 0 ? `color-mix(in srgb, var(--accent) ${LEVEL_ALPHA[c.level]}%, transparent)` : undefined,
            '--d': `${c.col * 10}ms`,
          } as React.CSSProperties}
          data-tip={c.tip}
        />
      ))}
      {model.span && activeSpan && (
        <g>
          <path className="yr-span-bracket" d={`M${bx1} ${by} V${by + 5} H${bx2} V${by}`} />
          <text className="yr-span-label tnum" x={labelX} y={by + 18} textAnchor="middle">
            最长连续 {activeSpan.days} 天
          </text>
        </g>
      )}
    </svg>
  );
}

export function SectionStreak({
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
  const { activeDays, activeSpan, runs, range, elapsedDays } = idx;
  const total = idx.totalDays;
  const shown = runs.slice(0, MAX_RUN_ROWS);

  // 窄屏下热力图要横滑：一打开就停在「最近」那几周，而不是一月
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const upto = Math.max(0, idx.days.findIndex((d) => d.future));
    const ratio = upto === 0 ? 1 : upto / idx.days.length;
    el.scrollLeft = Math.max(0, ratio * el.scrollWidth - el.clientWidth * 0.85);
  }, [idx.days]);

  return (
    <Section
      no={no}
      eyebrow="坚持"
      title={
        <>
          <Em>{activeDays}</Em> 天留下了打卡
          {activeSpan && activeSpan.days > 1 && (
            <>
              ，最长一口气连续 <Em>{activeSpan.days}</Em> 天
            </>
          )}
        </>
      }
      sub={
        activeSpan && activeSpan.days > 1 ? (
          <>
            从 <b className="tnum">{longDay(activeSpan.from)}</b> 到 <b className="tnum">{longDay(activeSpan.to)}</b>
            ，一天没断。已走过的日子里，<b className="tnum">{pctOf(activeDays / Math.max(1, elapsedDays))}%</b> 有你的痕迹。
          </>
        ) : undefined
      }
    >
      <div ref={scrollRef} className="yr-chart-scroll">
        <Heatmap idx={idx} weekStartsOn={weekStartsOn} />
      </div>
      <div className="yr-legend">
        <span>少</span>
        {LEVEL_ALPHA.map((a) => (
          <i key={a} className="yr-legend-cell" style={{ background: `color-mix(in srgb, var(--accent) ${a}%, transparent)` }} />
        ))}
        <span>多</span>
      </div>

      {shown.length > 0 && (
        <div className="yr-block">
          <p className="yr-block-title">各目标最长连续</p>
          <ul className="yr-runs">
            {shown.map((r) => {
              const goal = goals.get(r.goalId);
              const left = (diffDays(r.from, range.start) / total) * 100;
              const width = ((diffDays(r.to, r.from) + 1) / total) * 100;
              return (
                <li key={r.goalId} className="yr-run">
                  <span className="yr-run-name">
                    <GoalDot goal={goal} />
                    <span>{goal?.name ?? '已删除的目标'}</span>
                  </span>
                  <span className="yr-run-track">
                    <span
                      className="yr-run-seg"
                      style={{ left: `${left}%`, width: `${width}%`, background: goal ? goalColor(goal.color) : undefined }}
                      data-tip={`${goal?.name ?? ''}\n${shortDay(r.from)} – ${shortDay(r.to)} · 连续 ${r.days} 个应打卡日${
                        r.breakDate ? `\n断在 ${longDay(r.breakDate)}` : ''
                      }`}
                    />
                  </span>
                  <span className="yr-run-days tnum">
                    {r.days}
                    <span className="yr-unit">天</span>
                  </span>
                  <span className="yr-run-dates tnum">
                    {shortDay(r.from)} – {shortDay(r.to)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Section>
  );
}
