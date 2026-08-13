/**
 * beat 4 最强月 vs 最弱月。
 *
 * 结论句刻意用 `focus.avgMs` 与 `focus.interruptedRate` 之差 —— 这个对比全仓从未展示过
 * （规格 §3.4），也正是「完成率为什么差这么多」唯一能给出的线索。
 *
 * 进行中的当月不参与评选（`eligible`）：一个刚过 3 天的月份拿 100% 夺冠是假结论。
 * 可评选月份不足 2 个时派生层返回 null —— 只有 1 个就退化成单月摘要，0 个就整块隐藏。
 */
import type { AnnualIndex, MonthProfile } from '../lib/derive/annual';
import { humanMs } from '../pomodoro/format';
import { Beat, ChartBox, HeroNumber, LookButton } from './Beat';
import {
  CHART_W,
  CMP_BAR_GAP,
  CMP_BAR_H,
  CMP_GROUP_H,
  CMP_LABEL_W,
  CMP_VALUE_W,
  SVG_RADIUS_SM,
} from './constants';
import { monthLabel, pctOf } from './format';
import { useLocate } from './useLocate';

interface Metric {
  label: string;
  best: number;
  worst: number;
  fmt: (n: number) => string;
}

function metricsOf(best: MonthProfile, worst: MonthProfile): Metric[] {
  return [
    {
      label: '合计完成率',
      best: best.rate ?? 0,
      worst: worst.rate ?? 0,
      fmt: (n) => `${Math.round(n)}%`,
    },
    {
      label: '专注平均段长',
      best: best.focus.avgMs,
      worst: worst.focus.avgMs,
      fmt: (n) => (n > 0 ? humanMs(n) : '—'),
    },
    {
      label: '专注被打断率',
      best: best.focus.interruptedRate * 100,
      worst: worst.focus.interruptedRate * 100,
      fmt: (n) => `${Math.round(n)}%`,
    },
  ];
}

export function BeatBestWorst({ idx }: { idx: AnnualIndex }) {
  const { scrollToDate } = useLocate();
  const pair = idx.bestWorst;

  if (!pair) {
    const only = idx.months.filter((m) => m.eligible && m.rate !== null);
    if (only.length !== 1) return null; // 规格 §4.2：无数据整块隐藏
    const m = only[0];
    return (
      <Beat
        index={4}
        eyebrow="最强月 vs 最弱月"
        title={
          <>
            目前只有 {monthLabel(m.month)}过完了整月，完成率{' '}
            <span className="tnum">{m.rate}%</span>。
          </>
        }
        action={<LookButton onClick={() => scrollToDate(`${m.month}-01`)} />}
        footnote="对比要等第二个整月过完 —— 一个刚过几天的月份拿 100% 夺冠是假结论，所以进行中的当月不参与评选。"
      >
        <HeroNumber
          value={m.rate ?? 0}
          unit="%"
          format={(n) => String(Math.round(n))}
          sub={
            <>
              应打卡 <span className="tnum">{m.scheduled}</span> 天 · 专注{' '}
              <span className="tnum">{m.focus.count}</span> 段
            </>
          }
        />
      </Beat>
    );
  }

  const { best, worst } = pair;
  const delta = (best.rate ?? 0) - (worst.rate ?? 0);
  const metrics = metricsOf(best, worst);
  const h = metrics.length * CMP_GROUP_H;
  const barX = CMP_LABEL_W + 8;
  const barW = CHART_W - barX - CMP_VALUE_W;

  const avgDelta = best.focus.avgMs - worst.focus.avgMs;
  const intDelta = pctOf(best.focus.interruptedRate - worst.focus.interruptedRate);

  return (
    <Beat
      index={4}
      eyebrow="最强月 vs 最弱月"
      title={
        <>
          {monthLabel(best.month)}做到 <span className="tnum">{best.rate}%</span>，
          {monthLabel(worst.month)}只有 <span className="tnum">{worst.rate}%</span>
          {best.focus.count > 0 && worst.focus.count > 0 && avgDelta !== 0 && (
            <>
              ；强的那个月每段专注多撑{' '}
              <span className="tnum">{humanMs(Math.abs(avgDelta))}</span>
              {intDelta !== 0 && (
                <>
                  ，被打断率{intDelta < 0 ? '低' : '高'}{' '}
                  <span className="tnum">{Math.abs(intDelta)}</span> 个百分点
                </>
              )}
            </>
          )}
          。
        </>
      }
      action={<LookButton onClick={() => scrollToDate(`${worst.month}-01`)} title="跳到最弱月" />}
      footnote="只在「已过完整月且有应打卡」的月份里评选。平均段长与被打断率来自专注会话，复盘页只按月给单月值，这里给的是两端之差。两种颜色只区分月份，不表示好坏 —— 被打断率是越低越好。"
    >
      <HeroNumber
        value={Math.abs(delta)}
        unit="个百分点"
        format={(n) => String(Math.round(n))}
        sub={
          <>
            {monthLabel(best.month)} 与 {monthLabel(worst.month)}的完成率之差
          </>
        }
      />

      <ChartBox width={CHART_W} height={h} label="最强月与最弱月指标对照">
        {metrics.map((m, i) => {
          const y = i * CMP_GROUP_H;
          const max = Math.max(m.best, m.worst, 1);
          // 颜色只区分「哪个月」，不表达好坏：被打断率越高越糟，若把强月一律涂绿
          // 就会在这一行说反话。语义色留给真正有方向的地方。
          const rows = [
            { v: m.best, month: best.month, color: 'var(--accent)' },
            { v: m.worst, month: worst.month, color: 'var(--warning)' },
          ];
          return (
            <g key={m.label}>
              <text
                x={CMP_LABEL_W}
                y={y + CMP_BAR_H}
                textAnchor="end"
                fill="var(--text-secondary)"
                style={{ fontSize: 'var(--font-12)' }}
              >
                {m.label}
              </text>
              {rows.map((r, j) => {
                const ry = y + j * (CMP_BAR_H + CMP_BAR_GAP);
                return (
                  <g key={r.month}>
                    <rect
                      x={barX}
                      y={ry}
                      width={barW}
                      height={CMP_BAR_H}
                      rx={SVG_RADIUS_SM}
                      fill="var(--bg-subtle)"
                    />
                    <rect
                      x={barX}
                      y={ry}
                      width={Math.max(2, (r.v / max) * barW)}
                      height={CMP_BAR_H}
                      rx={SVG_RADIUS_SM}
                      fill={r.color}
                      stroke="var(--bar-inner-stroke)"
                    />
                    <text
                      className="tnum"
                      x={CHART_W}
                      y={ry + CMP_BAR_H - 3}
                      textAnchor="end"
                      fill="var(--text-secondary)"
                      style={{ fontSize: 'var(--font-12)' }}
                    >
                      {monthLabel(r.month)} · {m.fmt(r.v)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </ChartBox>
    </Beat>
  );
}
