/**
 * beat 6 计划漂移：这一年的计划总共往后挪了多少天。
 *
 * 复盘页的「基线偏移排行」已经列过任务与天数，年报不重复列表本身，而是给它给不了的两件事：
 * 1. **总推迟天数**（只累加正值，不与提前抵消 —— 「总共推迟了多少」问的就是延后量）；
 * 2. **没有基线的任务数**。缺了这行，「全年只推迟 3 天」会被读成计划很准，
 *    而真相可能是九成任务根本没存基线（规格 §3.7）。
 *
 * 区间过滤用自然 end 而非 clippedEnd：计划漂移是计划属性，与「今天」无关。
 */
import type { Goal } from '../types/domain';
import type { AnnualIndex } from '../lib/derive/annual';
import { goalColor } from '../lib/colors';
import { Beat, ChartBox, HeroNumber, LookButton } from './Beat';
import {
  CHART_W,
  DRIFT_BAR_H,
  DRIFT_LABEL_W,
  DRIFT_MAX_ROWS,
  DRIFT_ROW_H,
  DRIFT_VALUE_W,
  SVG_RADIUS_SM,
} from './constants';
import { clipText } from './format';
import { useLocate } from './useLocate';

interface Props {
  idx: AnnualIndex;
  goals: Goal[];
}

export function BeatDrift({ idx, goals }: Props) {
  const { locateTask } = useLocate();
  const { rows, totalDelayDays, noBaselineCount } = idx.drift;

  // 规格 §4.2：一个延后任务都没有 ⇒ 整块隐藏，不留「推迟 0 天」的空壳
  if (rows.length === 0) return null;

  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const shown = rows.slice(0, DRIFT_MAX_ROWS);
  const top = rows[0];
  const maxDays = shown[0].driftDays;

  const barX = DRIFT_LABEL_W + 8;
  const barW = CHART_W - barX - DRIFT_VALUE_W;
  const h = shown.length * DRIFT_ROW_H;

  return (
    <Beat
      index={6}
      eyebrow="计划漂移"
      title={
        <>
          <span className="tnum">{rows.length}</span> 个任务比原计划晚了，加起来推迟{' '}
          <span className="tnum">{totalDelayDays}</span> 天；拖得最狠的是「{top.name}」，晚了{' '}
          <span className="tnum">{top.driftDays}</span> 天。
        </>
      }
      action={<LookButton onClick={() => locateTask(top.taskId, idx.range.year)} />}
      footnote={
        <>
          只统计相对基线的<b>延后</b>，不与提前抵消 —— 「总共推迟了多少」问的是延后量。
          {noBaselineCount > 0 && (
            <>
              {' '}
              另有 <span className="tnum">{noBaselineCount}</span>{' '}
              个任务没有基线，未参与统计；顶栏「保存基线」后，它们的偏移才会出现在这里。
            </>
          )}
          {rows.length > shown.length && (
            <> 只列出最狠的 {shown.length} 个，其余 {rows.length - shown.length} 个更短。</>
          )}
        </>
      }
    >
      <HeroNumber
        value={totalDelayDays}
        unit="天"
        format={(n) => String(Math.round(n))}
        sub={<>这个区间累计推迟的天数（仅延后）</>}
      />

      <ChartBox width={CHART_W} height={h} label="任务相对基线的延后天数排行">
        {shown.map((r, i) => {
          const g = goalMap.get(r.goalId);
          const y = i * DRIFT_ROW_H;
          const barY = y + (DRIFT_ROW_H - DRIFT_BAR_H) / 2;
          const w = Math.max(2, (r.driftDays / maxDays) * barW);
          return (
            <g key={r.taskId}>
              <text
                x={DRIFT_LABEL_W}
                y={barY + DRIFT_BAR_H - 2}
                textAnchor="end"
                fill="var(--text-secondary)"
                style={{ fontSize: 'var(--font-12)' }}
              >
                {clipText(r.name, 16)}
              </text>
              <rect
                x={barX}
                y={barY}
                width={barW}
                height={DRIFT_BAR_H}
                rx={SVG_RADIUS_SM}
                fill="var(--bg-subtle)"
              />
              <rect
                x={barX}
                y={barY}
                width={w}
                height={DRIFT_BAR_H}
                rx={SVG_RADIUS_SM}
                fill={g ? goalColor(g.color) : 'var(--text-tertiary)'}
                stroke="var(--bar-inner-stroke)"
              />
              <text
                className="tnum"
                x={CHART_W}
                y={barY + DRIFT_BAR_H - 2}
                textAnchor="end"
                fill="var(--danger)"
                style={{ fontSize: 'var(--font-12)' }}
              >
                +{r.driftDays} 天
              </text>
            </g>
          );
        })}
      </ChartBox>
    </Beat>
  );
}
