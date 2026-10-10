/**
 * 封面年轮：区间里的每一天是一根放射状刻度，从 12 点方向顺时针走完一圈。
 * 长度 = 当天活动强度（打卡分 + 专注小时，按 p90 归一后开方，让小日子也看得见），
 * 颜色 = 当天的主角目标。没到的日子画成虚的短刻度 —— 一眼看出这一年走到了哪。
 */
import { memo, useMemo, type ReactNode } from 'react';
import type { AnnualIndex } from '../lib/derive/annual';
import { goalColor } from '../lib/colors';
import { RING, RING_STAGGER_MS } from './constants';
import { dayWithDow, humanDuration, monthNum, scoreLabel } from './format';
import type { GoalMap } from './parts';

interface Tick {
  angle: number;
  len: number;
  color: string;
  kind: 'on' | 'off' | 'future';
  tip: string;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

export const YearRing = memo(function YearRing({
  idx,
  goals,
  center,
}: {
  idx: AnnualIndex;
  goals: GoalMap;
  center: ReactNode;
}) {
  const { days } = idx;
  const n = days.length;

  const { ticks, months, todayAngle, tickW } = useMemo(() => {
    const weightOf = (i: number): number => days[i].score + days[i].focusMs / 3_600_000;
    const nonzero = days.map((_, i) => weightOf(i)).filter((w) => w > 0).sort((a, b) => a - b);
    const norm = quantile(nonzero, RING.normQuantile) || 1;
    const span = RING.maxLen - RING.minLen;

    const out: Tick[] = days.map((d, i) => {
      const angle = ((i + 0.5) / n) * 360;
      const w = weightOf(i);
      if (d.future) return { angle, len: RING.minLen, color: '', kind: 'future', tip: `${dayWithDow(d.date)}\n还没到` };
      if (w <= 0) return { angle, len: RING.minLen, color: '', kind: 'off', tip: `${dayWithDow(d.date)}\n没有记录` };
      const g = d.topGoalId ? goals.get(d.topGoalId) : undefined;
      const lines = [dayWithDow(d.date)];
      if (g) lines.push(`主要在「${g.name}」`);
      const facts: string[] = [];
      if (d.score > 0) facts.push(scoreLabel(d.score));
      if (d.focusMs > 0) facts.push(`专注 ${humanDuration(d.focusMs)}`);
      lines.push(facts.join(' · '));
      return {
        angle,
        len: RING.minLen + span * Math.sqrt(Math.min(1, w / norm)),
        color: g ? goalColor(g.color) : 'var(--text-tertiary)',
        kind: 'on',
        tip: lines.join('\n'),
      };
    });

    // 月界刻在内圈，月份数字放在该月弧段的正中
    const monthMarks: { angle: number; mid: number; label: string }[] = [];
    let last = '';
    days.forEach((d, i) => {
      const m = d.date.slice(0, 7);
      if (m === last) return;
      last = m;
      const len = days.filter((x) => x.date.startsWith(m)).length;
      monthMarks.push({
        angle: (i / n) * 360,
        mid: ((i + len / 2) / n) * 360,
        label: n > 184 ? String(monthNum(m)) : `${monthNum(m)}月`,
      });
    });

    const ti = idx.range.clipped ? days.findIndex((d) => d.date === idx.range.clippedEnd) : -1;
    const slice = (2 * Math.PI * RING.inner) / n;
    return {
      ticks: out,
      months: monthMarks,
      todayAngle: ti >= 0 ? ((ti + 0.5) / n) * 360 : null,
      tickW: Math.min(RING.maxTickW, slice * RING.tickFill),
    };
  }, [days, goals, n, idx.range]);

  const half = RING.size / 2;
  const stagger = (RING_STAGGER_MS * 365) / n;
  const polar = (deg: number, r: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [Math.sin(a) * r, -Math.cos(a) * r];
  };

  return (
    <div className="yr-ring">
      <svg viewBox={`${-half} ${-half} ${RING.size} ${RING.size}`} role="img" aria-label="逐日活动年轮">
        {months.map((m) => {
          const [x1, y1] = polar(m.angle, RING.inner - 10);
          const [x2, y2] = polar(m.angle, RING.inner - 4);
          const [lx, ly] = polar(m.mid, RING.labelR);
          return (
            <g key={m.label} className="yr-ring-month">
              <line x1={x1} y1={y1} x2={x2} y2={y2} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central">
                {m.label}
              </text>
            </g>
          );
        })}
        {ticks.map((t, i) => (
          <g key={i} transform={`rotate(${t.angle})`} data-tip={t.tip}>
            <rect
              className="yr-hit"
              x={-((2 * Math.PI * RING.inner) / n) / 2}
              y={-(RING.inner + RING.maxLen)}
              width={(2 * Math.PI * RING.inner) / n}
              height={RING.maxLen}
            />
            <rect
              className={`yr-tick yr-tick-${t.kind}`}
              x={-tickW / 2}
              y={-(RING.inner + t.len)}
              width={tickW}
              height={t.len}
              rx={tickW / 2}
              style={{ fill: t.kind === 'on' ? t.color : undefined, '--d': `${Math.round(i * stagger)}ms` } as React.CSSProperties}
            />
          </g>
        ))}
        {todayAngle !== null && (
          <g transform={`rotate(${todayAngle})`} className="yr-ring-today">
            <circle cx={0} cy={-(RING.inner - 16)} r={3.5} />
          </g>
        )}
      </svg>
      <div className="yr-ring-center">{center}</div>
    </div>
  );
});
