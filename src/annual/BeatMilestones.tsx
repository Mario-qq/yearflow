/**
 * beat 7 里程碑：承诺与兑现。
 *
 * 复盘页已有「里程碑时间线」（全部里程碑 + 达成填色），年报不重画那张图的用途，
 * 而是给它给不了的那条分界：**已过期却没达成** vs **还没到期**。
 * 复盘页把两者画成同一种「未达成」，于是「10 个里程碑达成 3 个」看起来像一场失败，
 * 而真相可能是另外 6 个要到 11 月才到期。兑现率因此只用**已到期**的作分母。
 */
import type { Goal } from '../types/domain';
import type { AnnualIndex } from '../lib/derive/annual';
import { diffDays } from '../lib/date';
import { goalColor } from '../lib/colors';
import { Beat, ChartBox, HeroNumber, LookButton } from './Beat';
import { CHART_W, MS_AXIS_Y, MS_DOT_R, MS_H, MS_LABEL_DY } from './constants';
import { clipText, shortDay } from './format';
import { useLocate } from './useLocate';

interface Props {
  idx: AnnualIndex;
  goals: Goal[];
}

/** 已达成 / 已过期未达成 / 还没到期 —— 第二类是本 beat 唯一想说的话 */
type MsState = 'achieved' | 'overdue' | 'pending';

const STATE_COLOR: Record<MsState, string> = {
  achieved: 'var(--success)',
  overdue: 'var(--danger)',
  pending: 'var(--text-tertiary)',
};

export function BeatMilestones({ idx, goals }: Props) {
  const { scrollToDate } = useLocate();
  const { range } = idx;
  const { rows, total, achieved } = idx.milestones;
  if (total === 0) return null; // 规格 §4.2

  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const stateOf = (r: { date: string; achieved: boolean }): MsState =>
    r.achieved ? 'achieved' : r.date <= range.clippedEnd ? 'overdue' : 'pending';

  const overdue = rows.filter((r) => stateOf(r) === 'overdue');
  const pending = rows.filter((r) => stateOf(r) === 'pending');
  const due = achieved + overdue.length;
  const ratePct = due > 0 ? Math.round((achieved / due) * 100) : 0;

  const totalDays = diffDays(range.end, range.start) + 1;
  const padX = 10;
  const trackW = CHART_W - padX * 2;
  const px = (date: string): number =>
    padX + (diffDays(date, range.start) / Math.max(1, totalDays - 1)) * trackW;

  return (
    <Beat
      index={7}
      eyebrow="里程碑"
      title={
        due === 0 ? (
          <>
            <span className="tnum">{total}</span> 个里程碑都还没到期 —— 这一段还没到验收的时候。
          </>
        ) : overdue.length > 0 ? (
          <>
            已到期的 <span className="tnum">{due}</span> 个里程碑里兑现了{' '}
            <span className="tnum">{achieved}</span> 个，
            <span style={{ color: 'var(--danger)' }}>
              还有 <span className="tnum">{overdue.length}</span> 个过了日子仍未达成
            </span>
            。
          </>
        ) : (
          <>
            已到期的 <span className="tnum">{due}</span> 个里程碑<b>全部</b>兑现了。
          </>
        )
      }
      action={
        overdue.length > 0 ? (
          <LookButton onClick={() => scrollToDate(overdue[0].date)} title="跳到最早那个过期里程碑" />
        ) : undefined
      }
      footnote={
        <>
          兑现率的分母只算<b>已到期</b>的里程碑（日期 ≤ 统计右端）—— 把还没到日子的也算进未达成，
          等于用没发生的事给自己判分。
          {pending.length > 0 && (
            <>
              {' '}
              另有 <span className="tnum">{pending.length}</span> 个尚未到期（灰点）。
            </>
          )}
        </>
      }
    >
      <HeroNumber
        value={ratePct}
        unit="%"
        format={(n) => String(Math.round(n))}
        sub={
          due > 0 ? (
            <>
              已到期里程碑的兑现率 · <span className="tnum">{achieved}</span> /{' '}
              <span className="tnum">{due}</span>
            </>
          ) : (
            <>
              本区间共 <span className="tnum">{total}</span> 个里程碑，尚无一个到期
            </>
          )
        }
      />

      <ChartBox width={CHART_W} height={MS_H} label="里程碑时间线（达成 / 过期未达成 / 未到期）">
        <line
          x1={padX}
          x2={CHART_W - padX}
          y1={MS_AXIS_Y}
          y2={MS_AXIS_Y}
          stroke="var(--border-default)"
          strokeWidth={1}
        />
        {range.monthPrefixes.map((m) => (
          <g key={m}>
            <line
              x1={px(`${m}-01`)}
              x2={px(`${m}-01`)}
              y1={MS_AXIS_Y - 4}
              y2={MS_AXIS_Y + 4}
              stroke="var(--border-default)"
              strokeWidth={1}
            />
            <text
              className="tnum"
              x={px(`${m}-01`) + 3}
              y={MS_AXIS_Y + 14}
              fill="var(--text-tertiary)"
              style={{ fontSize: 'var(--font-11)' }}
            >
              {Number(m.slice(5, 7))}
            </text>
          </g>
        ))}
        {range.clipped && range.clippedEnd >= range.start && (
          <line
            x1={px(range.clippedEnd)}
            x2={px(range.clippedEnd)}
            y1={MS_AXIS_Y - 30}
            y2={MS_AXIS_Y + 30}
            stroke="var(--danger)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {rows.map((r, i) => {
          const st = stateOf(r);
          const x = px(r.date);
          const up = i % 2 === 0;
          const g = goalMap.get(r.goalId);
          return (
            <g key={r.id}>
              <line
                x1={x}
                x2={x}
                y1={MS_AXIS_Y}
                y2={up ? MS_AXIS_Y - MS_LABEL_DY + 6 : MS_AXIS_Y + MS_LABEL_DY - 6}
                stroke={g ? goalColor(g.color) : 'var(--border-strong)'}
                strokeWidth={1}
              />
              <circle
                cx={x}
                cy={MS_AXIS_Y}
                r={MS_DOT_R}
                fill={st === 'achieved' ? STATE_COLOR.achieved : 'var(--bg-raised)'}
                stroke={STATE_COLOR[st]}
                strokeWidth={1.5}
              />
              <text
                x={x}
                y={up ? MS_AXIS_Y - MS_LABEL_DY : MS_AXIS_Y + MS_LABEL_DY + 8}
                textAnchor="middle"
                fill={st === 'overdue' ? 'var(--danger)' : 'var(--text-secondary)'}
                style={{ fontSize: 'var(--font-11)' }}
              >
                {clipText(r.name, 10)}
              </text>
              <text
                className="tnum"
                x={x}
                y={up ? MS_AXIS_Y - MS_LABEL_DY - 11 : MS_AXIS_Y + MS_LABEL_DY + 19}
                textAnchor="middle"
                fill="var(--text-tertiary)"
                style={{ fontSize: 'var(--font-11)' }}
              >
                {shortDay(r.date)}
              </text>
            </g>
          );
        })}
      </ChartBox>

      {overdue.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            过了日子仍未达成的：
          </p>
          {overdue.map((r) => {
            const g = goalMap.get(r.goalId);
            return (
              <div key={r.id} className="flex items-center gap-2" style={{ fontSize: 'var(--font-12)' }}>
                <span
                  className="inline-block size-2 shrink-0"
                  style={{ background: g ? goalColor(g.color) : 'var(--text-tertiary)', borderRadius: '50%' }}
                />
                <span className="truncate">{r.name}</span>
                <span className="tnum ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                  原定 {shortDay(r.date)}
                </span>
                <span className="tnum w-20 text-right" style={{ color: 'var(--danger)' }}>
                  过期 {diffDays(range.clippedEnd, r.date)} 天
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Beat>
  );
}
