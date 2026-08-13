/**
 * beat 0 封面：这一年（或这个区间）走到了哪里。
 * 唯一「不叙事」的一 beat —— 它的任务是先把坐标交代清楚，后面十个 beat 才有参照。
 */
import type { AnnualIndex } from '../lib/derive/annual';
import { Beat, ChartBox, HeroNumber } from './Beat';
import { CHART_W, TIMEBAR_H, TIMEBAR_LABEL_H, TIMEBAR_TICK_H } from './constants';
import { longDay, RANGE_LABEL } from './format';

interface Props {
  idx: AnnualIndex;
  /** 区间内有排期或有记录的目标数 / 在期任务数 */
  goalCount: number;
  taskCount: number;
}

export function BeatCover({ idx, goalCount, taskCount }: Props) {
  const { range, elapsedDays, totalDays, checkInCount } = idx;
  const label = RANGE_LABEL[range.kind];
  const done = totalDays > 0 ? Math.min(1, elapsedDays / totalDays) : 0;

  const h = TIMEBAR_H + TIMEBAR_TICK_H + TIMEBAR_LABEL_H;
  const barY = 0;
  // 月刻度：整月对齐是硬约定（规格 §1.1），所以每个刻度就是一个月的左边界
  const months = range.monthPrefixes;
  const step = CHART_W / months.length;

  return (
    <Beat
      index={0}
      eyebrow={`${range.year} · ${label}`}
      title={
        range.clipped ? (
          <>
            {range.year} 年{label}已过 <span className="tnum">{elapsedDays}</span> 天，还剩{' '}
            <span className="tnum">{totalDays - elapsedDays}</span> 天。
          </>
        ) : (
          <>
            {range.year} 年{label}走完了 <span className="tnum">{totalDays}</span> 天。
          </>
        )
      }
      footnote={`区间 ${longDay(range.start)} — ${longDay(range.end)}${
        range.clipped ? `，统计右端裁到 ${longDay(range.clippedEnd)}` : ''
      }。`}
    >
      <HeroNumber
        value={elapsedDays}
        unit={`天 / ${totalDays}`}
        format={(n) => String(Math.round(n))}
        sub={
          <>
            打卡 <span className="tnum">{checkInCount}</span> 条 · 目标{' '}
            <span className="tnum">{goalCount}</span> 个 · 在期任务{' '}
            <span className="tnum">{taskCount}</span> 个
          </>
        }
      />

      <ChartBox width={CHART_W} height={h} label={`${label}进度条`}>
        <rect
          x={0}
          y={barY}
          width={CHART_W}
          height={TIMEBAR_H}
          rx={TIMEBAR_H / 2}
          fill="var(--bg-subtle)"
        />
        <rect
          x={0}
          y={barY}
          width={Math.max(done > 0 ? 2 : 0, CHART_W * done)}
          height={TIMEBAR_H}
          rx={TIMEBAR_H / 2}
          fill="var(--accent)"
        />
        {range.clipped && done > 0 && (
          <line
            x1={CHART_W * done}
            x2={CHART_W * done}
            y1={barY - 2}
            y2={barY + TIMEBAR_H + 2}
            stroke="var(--danger)"
            strokeWidth={2}
          />
        )}
        {months.map((m, i) => (
          <g key={m}>
            <line
              x1={i * step}
              x2={i * step}
              y1={barY + TIMEBAR_H}
              y2={barY + TIMEBAR_H + TIMEBAR_TICK_H}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            <text
              x={i * step + 3}
              y={barY + TIMEBAR_H + TIMEBAR_TICK_H + 11}
              fill="var(--text-tertiary)"
              style={{ fontSize: 'var(--font-11)' }}
            >
              {Number(m.slice(5, 7))}
            </text>
          </g>
        ))}
      </ChartBox>
    </Beat>
  );
}
