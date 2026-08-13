/**
 * beat 5 最长连续：不只是「最长 78 天」，而是**哪一段、从哪到哪、被哪天打断**。
 *
 * `streak.ts` 的 calcStreak 只给 {current, longest}，拿不到后者 —— 而叙事价值全在后者。
 * 派生层因此重走了同一个应打卡并集，并用单测锁死 `days === calcStreak().longest`
 * （规格 §3.5）。免打卡日不在并集里 ⇒ 天然不会被判为打断。
 */
import type { Goal } from '../types/domain';
import type { AnnualIndex } from '../lib/derive/annual';
import { diffDays } from '../lib/date';
import { goalColor } from '../lib/colors';
import { Beat, ChartBox, HeroNumber, LookButton } from './Beat';
import {
  CHART_W,
  RUN_BAR_H,
  RUN_BREAK_R,
  RUN_LABEL_W,
  RUN_MAX_ROWS,
  RUN_ROW_H,
  SVG_RADIUS_SM,
  TIMEBAR_LABEL_H,
  TIMEBAR_TICK_H,
} from './constants';
import { clipText, shortDay } from './format';
import { useLocate } from './useLocate';

interface Props {
  idx: AnnualIndex;
  goals: Goal[];
}

export function BeatStreak({ idx, goals }: Props) {
  const { scrollToDate } = useLocate();
  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const runs = idx.runs.filter((r) => goalMap.has(r.goalId));
  if (runs.length === 0) return null; // 规格 §4.2

  const shown = runs.slice(0, RUN_MAX_ROWS);
  const top = runs[0];
  const topGoal = goalMap.get(top.goalId)!;

  const { range } = idx;
  const totalDays = diffDays(range.end, range.start) + 1;
  const trackX = RUN_LABEL_W + 8;
  const trackW = CHART_W - trackX - 96;
  const px = (date: string): number =>
    trackX + (diffDays(date, range.start) / totalDays) * trackW;
  const dayW = trackW / totalDays;
  // 没有月刻度的时间条等于没有横坐标：「从 7-27 连到 8-12」落在哪一段读不出来
  const rowsH = shown.length * RUN_ROW_H;
  const h = rowsH + TIMEBAR_TICK_H + TIMEBAR_LABEL_H;

  return (
    <Beat
      index={5}
      eyebrow="最长连续"
      title={
        <>
          <span style={{ color: goalColor(topGoal.color) }}>{topGoal.name}</span> 从{' '}
          <span className="tnum">{shortDay(top.from)}</span> 连到{' '}
          <span className="tnum">{shortDay(top.to)}</span>，
          <span className="tnum">{top.days}</span> 天
          {top.breakDate ? (
            <>
              ，断在 <span className="tnum">{shortDay(top.breakDate)}</span>。
            </>
          ) : (
            <>，还没断。</>
          )}
        </>
      }
      action={
        <LookButton
          onClick={() => scrollToDate(top.breakDate ?? top.from)}
          title={top.breakDate ? '跳到打断的那一天' : '跳到这一段的起点'}
        />
      }
      footnote={
        <>
          口径与 streak 榜逐字一致：完成/做了一点延续，有意跳过不打断也不计数，
          免打卡区间不算应打卡日故不会被判为打断。红点 = 打断那天（应打卡却没有记录）。
          {runs.length > shown.length && (
            <> 另有 {runs.length - shown.length} 个目标的最长段未列出。</>
          )}
        </>
      }
    >
      <HeroNumber
        value={top.days}
        unit="天"
        format={(n) => String(Math.round(n))}
        sub={
          <>
            {topGoal.icon} {topGoal.name} 在这个区间的最长连续
          </>
        }
      />

      <ChartBox width={CHART_W} height={h} label="各目标最长连续段">
        {range.monthPrefixes.map((m) => (
          <g key={m}>
            <line
              x1={px(`${m}-01`)}
              x2={px(`${m}-01`)}
              y1={0}
              y2={rowsH + TIMEBAR_TICK_H}
              stroke="var(--border-default)"
              strokeWidth={1}
            />
            <text
              className="tnum"
              x={px(`${m}-01`) + 3}
              y={h - 5}
              fill="var(--text-tertiary)"
              style={{ fontSize: 'var(--font-11)' }}
            >
              {Number(m.slice(5, 7))}
            </text>
          </g>
        ))}
        {shown.map((r, i) => {
          const g = goalMap.get(r.goalId)!;
          const y = i * RUN_ROW_H;
          const barY = y + (RUN_ROW_H - RUN_BAR_H) / 2;
          const x = px(r.from);
          const w = Math.max(2, px(r.to) - x + dayW);
          return (
            <g key={r.goalId}>
              <text
                x={RUN_LABEL_W}
                y={barY + RUN_BAR_H - 2}
                textAnchor="end"
                fill="var(--text-secondary)"
                style={{ fontSize: 'var(--font-12)' }}
              >
                {clipText(`${g.icon ? `${g.icon} ` : ''}${g.name}`, 12)}
              </text>
              <rect
                x={trackX}
                y={barY + RUN_BAR_H / 2 - 1}
                width={trackW}
                height={2}
                fill="var(--border-subtle)"
              />
              <rect
                x={x}
                y={barY}
                width={w}
                height={RUN_BAR_H}
                rx={SVG_RADIUS_SM}
                fill={goalColor(g.color)}
                stroke="var(--bar-inner-stroke)"
              />
              {r.breakDate && (
                <circle
                  cx={px(r.breakDate) + dayW / 2}
                  cy={barY + RUN_BAR_H / 2}
                  r={RUN_BREAK_R}
                  fill="var(--danger)"
                />
              )}
              <text
                className="tnum"
                x={CHART_W}
                y={barY + RUN_BAR_H - 2}
                textAnchor="end"
                fill="var(--text-tertiary)"
                style={{ fontSize: 'var(--font-12)' }}
              >
                {r.days} 天
              </text>
            </g>
          );
        })}
      </ChartBox>
    </Beat>
  );
}
