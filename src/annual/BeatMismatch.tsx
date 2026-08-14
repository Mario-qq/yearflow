/**
 * beat 3 错配镜：计划把力气分给了谁，时间实际去了哪。全仓别处没有这个对比。
 *
 * ⚠️ 左列口径是「**计划任务·日**占比」，不是「应打卡天数占比」（规格 §3.3）：
 * 同一天两个并行任务算两份力气，按日并集会把它压成一份、系统性低估多任务目标，
 * 把结论说反。它与完成率的分母口径不同是故意的，靠这里的措辞区分 —— 界面文案
 * 若写成「应打卡天数」，和月度复盘的数字对不上就是我们自找的。
 *
 * `noPlan` 目标（全随缘 / 区间内无排期）单列一组：它们的 plannedShare 天然是 0，
 * 混进排序会被读成「严重错配」，而事实是它们按设计就不排期。
 */
import type { Goal } from '../types/domain';
import type { AnnualIndex, GoalShare } from '../lib/derive/annual';
import { goalColor, goalColorAlpha } from '../lib/colors';
import { useIsMobile } from '../lib/useIsMobile';
import { humanMs } from '../pomodoro/format';
import { Beat, ChartBox, HeroNumber } from './Beat';
import {
  CHART_W,
  MIRROR_BAR_H,
  MIRROR_COL_W,
  MIRROR_GAP,
  MIRROR_PAD_B,
  MIRROR_PAD_T,
  MIRROR_ROW_H,
  SVG_RADIUS_SM,
} from './constants';
import { clipText, pctOf } from './format';

interface Props {
  idx: AnnualIndex;
  goals: Goal[];
}

export function BeatMismatch({ idx, goals }: Props) {
  const isMobile = useIsMobile();
  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const known = idx.shares.filter((s) => goalMap.has(s.goalId));

  // 有计划权重的进对照与排序；无计划权重但有投入的进逃生阀那一组
  const ranked = known
    .filter((s) => !s.noPlan)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const noPlan = known.filter((s) => s.noPlan && s.investedMs > 0);

  if (ranked.length === 0 && noPlan.length === 0) return null;

  const worst = ranked[0];
  const maxShare = Math.max(
    0.01,
    ...ranked.map((s) => Math.max(s.plannedShare, s.investedShare)),
  );
  const h = MIRROR_PAD_T + ranked.length * MIRROR_ROW_H + MIRROR_PAD_B;
  const midL = (CHART_W - MIRROR_GAP) / 2;
  const midR = (CHART_W + MIRROR_GAP) / 2;

  const gapText = (s: GoalShare): string => {
    const pp = pctOf(s.gap);
    return pp === 0 ? '±0 pp' : `${pp > 0 ? '+' : ''}${pp} pp`;
  };
  const gapColor = (s: GoalShare): string => {
    const pp = pctOf(s.gap);
    if (Math.abs(pp) < 5) return 'var(--text-tertiary)';
    return pp > 0 ? 'var(--warning)' : 'var(--info)';
  };

  return (
    <Beat
      index={3}
      eyebrow="错配镜"
      title={
        worst ? (
          <>
            <span style={{ color: goalColor(goalMap.get(worst.goalId)!.color) }}>
              {goalMap.get(worst.goalId)!.name}
            </span>{' '}
            排到 <span className="tnum">{pctOf(worst.plannedShare)}%</span> 的计划权重，
            {worst.gap >= 0 ? '却吃掉' : '却只用掉'}{' '}
            <span className="tnum">{pctOf(worst.investedShare)}%</span> 的实际时间。
          </>
        ) : (
          <>这个区间的投入全部落在没有排期的目标上。</>
        )
      }
      footnote={
        <>
          {isMobile ? '上条' : '左列'} = 计划任务·日占比（同一天两个并行任务算两份力气，故按任务求和，
          <b>不是</b>应打卡天数），{isMobile ? '下条' : '右列'} = 实际投入占比。
          两者各自归一化到区间内的目标总量，条长按最大值等比缩放，百分比才是真值。
        </>
      }
    >
      {worst && (
        <HeroNumber
          value={Math.abs(pctOf(worst.gap))}
          unit="个百分点"
          format={(n) => String(Math.round(n))}
          sub={
            <>
              最大错配（{goalMap.get(worst.goalId)!.name}
              {worst.gap >= 0 ? ' 超投' : ' 欠投'}）
            </>
          }
        />
      )}

      {/*
        规格 §5.3：移动端双列镜像改上下堆叠。左右对照要靠中线两侧的对称才读得出来，
        375px 上左右各只剩 ~120px，两条都短到分不出长短 —— 所以窄屏改成
        「一个目标一块，计划条在上、实际条在下」，比较关系从「左右」换成「上下」。
      */}
      {ranked.length > 0 && isMobile && (
        <div className="flex flex-col gap-3">
          {ranked.map((s) => {
            const g = goalMap.get(s.goalId)!;
            const rows = [
              { label: '计划任务·日', share: s.plannedShare, fill: goalColorAlpha(g.color, 40) },
              { label: '实际投入', share: s.investedShare, fill: goalColor(g.color) },
            ];
            return (
              <div key={s.goalId} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2" style={{ fontSize: 'var(--font-12)' }}>
                  <span className="min-w-0 truncate">{g.name}</span>
                  <span className="tnum ml-auto shrink-0" style={{ color: gapColor(s) }}>
                    {gapText(s)}
                  </span>
                </div>
                {rows.map((r) => (
                  <div key={r.label} className="flex items-center gap-2">
                    <span
                      className="shrink-0"
                      style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', width: 72 }}
                    >
                      {r.label}
                    </span>
                    <span
                      className="min-w-0 flex-1"
                      style={{ height: MIRROR_BAR_H, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}
                    >
                      <span
                        className="block h-full"
                        style={{
                          width: `${Math.max(1, (r.share / maxShare) * 100)}%`,
                          background: r.fill,
                          borderRadius: 'var(--radius-sm)',
                        }}
                      />
                    </span>
                    <span
                      className="tnum shrink-0 text-right"
                      style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', width: 34 }}
                    >
                      {pctOf(r.share)}%
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {ranked.length > 0 && !isMobile && (
        <ChartBox width={CHART_W} height={h} label="计划权重与实际投入对照">
          <text
            x={midL}
            y={12}
            textAnchor="end"
            fill="var(--text-tertiary)"
            style={{ fontSize: 'var(--font-11)' }}
          >
            计划任务·日占比
          </text>
          <text
            x={midR}
            y={12}
            fill="var(--text-tertiary)"
            style={{ fontSize: 'var(--font-11)' }}
          >
            实际投入占比
          </text>

          {ranked.map((s, i) => {
            const g = goalMap.get(s.goalId)!;
            const y = MIRROR_PAD_T + i * MIRROR_ROW_H;
            const barY = y + (MIRROR_ROW_H - MIRROR_BAR_H) / 2 - 5;
            const lw = Math.max(1, (s.plannedShare / maxShare) * MIRROR_COL_W);
            const rw = Math.max(1, (s.investedShare / maxShare) * MIRROR_COL_W);
            return (
              <g key={s.goalId}>
                <rect
                  x={midL - lw}
                  y={barY}
                  width={lw}
                  height={MIRROR_BAR_H}
                  rx={SVG_RADIUS_SM}
                  fill={goalColorAlpha(g.color, 40)}
                />
                <text
                  className="tnum"
                  x={midL - lw - 6}
                  y={barY + MIRROR_BAR_H - 3}
                  textAnchor="end"
                  fill="var(--text-tertiary)"
                  style={{ fontSize: 'var(--font-11)' }}
                >
                  {pctOf(s.plannedShare)}%
                </text>

                <rect
                  x={midR}
                  y={barY}
                  width={rw}
                  height={MIRROR_BAR_H}
                  rx={SVG_RADIUS_SM}
                  fill={goalColor(g.color)}
                  stroke="var(--bar-inner-stroke)"
                />
                <text
                  className="tnum"
                  x={midR + rw + 6}
                  y={barY + MIRROR_BAR_H - 3}
                  fill="var(--text-tertiary)"
                  style={{ fontSize: 'var(--font-11)' }}
                >
                  {pctOf(s.investedShare)}%
                </text>

                <text
                  x={CHART_W / 2}
                  y={barY + MIRROR_BAR_H - 3}
                  textAnchor="middle"
                  fill="var(--text-primary)"
                  style={{ fontSize: 'var(--font-12)' }}
                >
                  {clipText(g.name, 11)}
                </text>
                <text
                  className="tnum"
                  x={CHART_W / 2}
                  y={barY + MIRROR_BAR_H + 11}
                  textAnchor="middle"
                  fill={gapColor(s)}
                  style={{ fontSize: 'var(--font-11)' }}
                >
                  {gapText(s)}
                </text>
              </g>
            );
          })}
        </ChartBox>
      )}

      {noPlan.length > 0 && (
        <div
          className="flex flex-col gap-1.5 border-t pt-3"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            下面这些目标不参与错配排序 —— 随缘任务不产生计划权重，它们按设计就不排期：
          </p>
          {noPlan.map((s) => {
            const g = goalMap.get(s.goalId)!;
            return (
              <div
                key={s.goalId}
                className="flex items-center gap-2"
                style={{ fontSize: 'var(--font-12)' }}
              >
                <span
                  className="inline-block size-2 shrink-0"
                  style={{ background: goalColor(g.color), borderRadius: '50%' }}
                />
                <span className="truncate">
                  {g.icon} {g.name}
                </span>
                <span className="ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                  {s.adhocOnly ? '全随缘' : '区间内无排期'}
                </span>
                <span className="tnum w-28 text-right" style={{ color: 'var(--text-secondary)' }}>
                  投入 {humanMs(s.investedMs)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Beat>
  );
}
