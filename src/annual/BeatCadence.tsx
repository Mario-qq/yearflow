/**
 * beat 2 节奏：完成率逐月的走势。
 *
 * 与复盘页的分工（规格 §一）：`AnnualOverview` 的堆叠面积图画的是**打卡量**，
 * 这里画的是**合计完成率**（Σscore / Σscheduled）—— 量大不等于做到，两者会分叉，
 * 而分叉本身就是年报要说的话。淡柱是同月的应打卡量，用来解释「率高是不是因为排得少」。
 */
import type { AnnualIndex } from '../lib/derive/annual';
import { Beat, ChartBox, HeroNumber } from './Beat';
import {
  CHART_W,
  LINE_COL_MAX_H,
  LINE_COL_RATIO,
  LINE_DOT_R,
  LINE_H,
  LINE_PAD_B,
  LINE_PAD_L,
  LINE_PAD_R,
  LINE_PAD_T,
  RATE_GOOD,
  SVG_RADIUS_SM,
} from './constants';
import { monthLabel } from './format';

const GRID = [0, 50, 100];

export function BeatCadence({ idx }: { idx: AnnualIndex }) {
  const months = idx.months;
  const valid = months.filter((m) => m.rate !== null);
  if (valid.length === 0) return null; // 规格 §4.2：单个 beat 无数据整块隐藏

  let scheduled = 0;
  let score = 0;
  for (const m of months) {
    scheduled += m.scheduled;
    score += m.score;
  }
  const overall = scheduled > 0 ? Math.round((score / scheduled) * 100) : 0;
  const goodCount = valid.filter((m) => (m.rate as number) >= RATE_GOOD).length;
  const last = valid[valid.length - 1];
  // 一个月都没过线时，结论句改说「最高的那个月」——「0 个月做到了 80%」是句废话
  const bestValid = valid.reduce((a, b) => ((b.rate as number) > (a.rate as number) ? b : a));

  const x0 = LINE_PAD_L;
  const x1 = CHART_W - LINE_PAD_R;
  const y0 = LINE_PAD_T;
  const y1 = LINE_H - LINE_PAD_B;
  const step = (x1 - x0) / months.length;
  const maxScheduled = Math.max(1, ...months.map((m) => m.scheduled));
  const cx = (i: number): number => x0 + (i + 0.5) * step;
  const cy = (rate: number): number => y1 - (rate / 100) * (y1 - y0);

  // 折线按「有应打卡的连续月份」分段：无应打卡的月不该被一条直线连过去
  const segments: { i: number; rate: number }[][] = [];
  let cur: { i: number; rate: number }[] = [];
  months.forEach((m, i) => {
    if (m.rate === null) {
      if (cur.length > 0) segments.push(cur);
      cur = [];
    } else {
      cur.push({ i, rate: m.rate });
    }
  });
  if (cur.length > 0) segments.push(cur);

  return (
    <Beat
      index={2}
      eyebrow="节奏"
      title={
        goodCount > 0 ? (
          <>
            {valid.length} 个有排期的月份里，<span className="tnum">{goodCount}</span> 个月做到了{' '}
            {RATE_GOOD}% 以上
            {last && (
              <>
                ，最近一个月是 {monthLabel(last.month)}的{' '}
                <span className="tnum">{last.rate}%</span>
              </>
            )}
            。
          </>
        ) : (
          <>
            {valid.length} 个有排期的月份，还没有一个月过 {RATE_GOOD}%
            {last && (
              <>
                ；最高是 {monthLabel(bestValid.month)}的{' '}
                <span className="tnum">{bestValid.rate}%</span>
              </>
            )}
            。
          </>
        )
      }
      footnote={
        <>
          折线 = 该月全目标合计完成率（Σ 已完成 / Σ 应打卡），不是「各目标完成率的平均」——
          后者会让只有 1 天应打卡的目标与全月目标等权。淡柱 = 同月应打卡量，空心点 = 该月尚未过完。
        </>
      }
    >
      <HeroNumber
        value={overall}
        unit="%"
        format={(n) => String(Math.round(n))}
        sub={
          <>
            区间合计完成率 · 应打卡 <span className="tnum">{scheduled}</span> 天
          </>
        }
      />

      <ChartBox width={CHART_W} height={LINE_H} label="逐月完成率">
        {GRID.map((g) => (
          <g key={g}>
            <line
              x1={x0}
              x2={x1}
              y1={cy(g)}
              y2={cy(g)}
              stroke="var(--border-subtle)"
              strokeWidth={1}
            />
            <text
              className="tnum"
              x={x0 - 6}
              y={cy(g) + 3.5}
              textAnchor="end"
              fill="var(--text-tertiary)"
              style={{ fontSize: 'var(--font-11)' }}
            >
              {g}
            </text>
          </g>
        ))}

        {months.map((m, i) => {
          const h = (m.scheduled / maxScheduled) * LINE_COL_MAX_H;
          const w = step * LINE_COL_RATIO;
          return (
            <g key={m.month}>
              {m.scheduled > 0 && (
                <rect
                  x={cx(i) - w / 2}
                  y={y1 - h}
                  width={w}
                  height={h}
                  rx={SVG_RADIUS_SM / 2}
                  fill="var(--bg-subtle)"
                />
              )}
              <text
                className="tnum"
                x={cx(i)}
                y={y1 + 15}
                textAnchor="middle"
                fill="var(--text-tertiary)"
                style={{ fontSize: 'var(--font-11)' }}
              >
                {Number(m.month.slice(5, 7))}
              </text>
            </g>
          );
        })}

        {segments.map((seg) => (
          <polyline
            key={seg[0].i}
            points={seg.map((p) => `${cx(p.i)},${cy(p.rate)}`).join(' ')}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {months.map((m, i) =>
          m.rate === null ? null : (
            <circle
              key={m.month}
              cx={cx(i)}
              cy={cy(m.rate)}
              r={LINE_DOT_R}
              fill={m.eligible ? 'var(--accent)' : 'var(--bg-raised)'}
              stroke="var(--accent)"
              strokeWidth={1.5}
            />
          ),
        )}
      </ChartBox>
    </Beat>
  );
}
