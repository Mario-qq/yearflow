/**
 * beat 9 节律画像：你到底在几点专注。全仓从未展示过这个切面。
 *
 * 两条口径写在脚注里，因为它们会影响读法（规格 §3.8）：
 * · **区间归属看会话的 date，钟点与星期取 startAt 的本地值**。date 允许被用户经结果卡
 *   「改归相邻日」显式覆盖、与 startAt 永久不一致；而节律问的是「你几点在专注」，
 *   答案只能来自 startAt。
 * · 一段跨小时的会话**整段记在开始小时**（v1 不做跨格分摊）。
 */
import type { AnnualIndex, RhythmCell } from '../lib/derive/annual';
import { humanMs } from '../pomodoro/format';
import { Beat, ChartBox, HeroNumber } from './Beat';
import {
  CHART_W,
  RHY_ALPHA_MAX,
  RHY_ALPHA_MIN,
  RHY_AXIS_H,
  RHY_CELL_GAP,
  RHY_CELL_H,
  RHY_LABEL_W,
  RHY_TOP_N,
  SVG_RADIUS_SM,
} from './constants';
import { hoursOf, pctOf } from './format';

/** 周一起头（与全仓周视图一致）；索引即 Date.getDay() 的值 */
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_NAME = ['日', '一', '二', '三', '四', '五', '六'];

const cellLabel = (c: RhythmCell): string => `周${DOW_NAME[c.dow]} ${c.hour} 点`;

export function BeatRhythm({ idx }: { idx: AnnualIndex }) {
  const cells = idx.rhythm;
  if (cells.length === 0) return null; // 规格 §4.2

  const byKey = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const maxMs = Math.max(...cells.map((c) => c.ms));
  const ranked = [...cells].sort((a, b) => b.ms - a.ms);
  const top = ranked[0];
  const tops = ranked.slice(0, RHY_TOP_N);

  // 只画有数据的小时跨度（至少 8 格）：整天 24 格里通常有一半是空的，
  // 铺满只会把有效格子压成细条，读不出「哪个时段最强」。
  const hours = cells.map((c) => c.hour);
  let h0 = Math.min(...hours);
  let h1 = Math.max(...hours);
  while (h1 - h0 + 1 < 8) {
    if (h0 > 0) h0 -= 1;
    else if (h1 < 23) h1 += 1;
    else break;
  }
  const cols = h1 - h0 + 1;
  const gridW = CHART_W - RHY_LABEL_W;
  const cellW = gridW / cols;
  const height = RHY_AXIS_H + DOW_ORDER.length * (RHY_CELL_H + RHY_CELL_GAP);

  const fillOf = (c: RhythmCell | undefined): string => {
    if (!c || c.ms === 0) return 'var(--bg-subtle)';
    const a = RHY_ALPHA_MIN + (RHY_ALPHA_MAX - RHY_ALPHA_MIN) * (c.ms / maxMs);
    return `color-mix(in srgb, var(--accent) ${Math.round(a)}%, transparent)`;
  };

  return (
    <Beat
      index={9}
      eyebrow="节律"
      title={
        <>
          你最能专注的时段是 <span className="tnum">{cellLabel(top)}</span> —— 这一格装下了{' '}
          <span className="tnum">{hoursOf(top.ms)}</span> 小时，共{' '}
          <span className="tnum">{top.count}</span> 段。
        </>
      }
      footnote={
        <>
          区间归属看会话所属日期，<b>钟点与星期取开始时间</b>（结果卡「改归相邻日」只改归属日，
          不改你实际几点开始）。一段跨小时的专注整段记在开始的那个小时，v1 不做跨格分摊。
          颜色深浅 = 该格累计时长，最深的一格是 {humanMs(maxMs)}。
        </>
      }
    >
      <HeroNumber
        value={hoursOf(top.ms)}
        unit="小时"
        format={(n) => n.toFixed(1)}
        sub={<>集中在 {cellLabel(top)} 这一格</>}
      />

      <ChartBox width={CHART_W} height={height} label="星期 × 小时的专注分布热力图">
        {Array.from({ length: cols }, (_, i) => h0 + i).map((hour, i) => (
          <text
            key={hour}
            className="tnum"
            x={RHY_LABEL_W + i * cellW + cellW / 2}
            y={RHY_AXIS_H - 4}
            textAnchor="middle"
            fill="var(--text-tertiary)"
            style={{ fontSize: 'var(--font-11)' }}
          >
            {hour}
          </text>
        ))}
        {DOW_ORDER.map((dow, r) => {
          const y = RHY_AXIS_H + r * (RHY_CELL_H + RHY_CELL_GAP);
          return (
            <g key={dow}>
              <text
                x={RHY_LABEL_W - 8}
                y={y + RHY_CELL_H - 4}
                textAnchor="end"
                fill="var(--text-secondary)"
                style={{ fontSize: 'var(--font-11)' }}
              >
                周{DOW_NAME[dow]}
              </text>
              {Array.from({ length: cols }, (_, i) => h0 + i).map((hour, i) => {
                const c = byKey.get(`${dow}:${hour}`);
                return (
                  <rect
                    key={hour}
                    x={RHY_LABEL_W + i * cellW}
                    y={y}
                    width={Math.max(1, cellW - RHY_CELL_GAP)}
                    height={RHY_CELL_H}
                    rx={SVG_RADIUS_SM}
                    fill={fillOf(c)}
                    stroke={c === top ? 'var(--accent)' : 'none'}
                    strokeWidth={c === top ? 1.5 : 0}
                  >
                    {c && (
                      <title>
                        周{DOW_NAME[dow]} {hour} 点 · {humanMs(c.ms)} · {c.count} 段
                      </title>
                    )}
                  </rect>
                );
              })}
            </g>
          );
        })}
      </ChartBox>

      {/* 文字版最强时段：热力图读的是趋势，具体数字仍要有一处能逐字读到 */}
      <div className="flex flex-col gap-1.5 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
          最强的 {tops.length} 个时段：
        </p>
        {tops.map((c) => (
          <div
            key={`${c.dow}:${c.hour}`}
            className="flex items-center gap-2"
            style={{ fontSize: 'var(--font-12)' }}
          >
            <span className="tnum w-20">{cellLabel(c)}</span>
            <span className="tnum" style={{ color: 'var(--text-secondary)' }}>
              {humanMs(c.ms)}
            </span>
            <span className="tnum ml-auto" style={{ color: 'var(--text-tertiary)' }}>
              {c.count} 段 · 被打断 {pctOf(c.interruptedRate)}%
            </span>
          </div>
        ))}
      </div>
    </Beat>
  );
}
