/**
 * 封面：年份巨字 + 一句话 + 三个数 + 年轮。
 * 背景是本区间投入最多的三个目标色晕开的光 —— 每个人的年报颜色都不一样。
 */
import type { CSSProperties } from 'react';
import type { AnnualIndex } from '../lib/derive/annual';
import { hoursOf, longDay, pctOf, RANGE_LABEL, rangeNoun } from './format';
import { useCountUp, useInView } from './hooks';
import type { GoalMap } from './parts';
import { YearRing } from './YearRing';

function Stat({ value, decimals = 0, unit, label, active }: {
  value: number;
  decimals?: number;
  unit?: string;
  label: string;
  active: boolean;
}) {
  const v = useCountUp(value, active);
  return (
    <div className="yr-stat">
      <p className="yr-stat-value tnum">
        {v.toFixed(decimals)}
        {unit && <span className="yr-stat-unit">{unit}</span>}
      </p>
      <p className="yr-stat-label">{label}</p>
    </div>
  );
}

export function Cover({ idx, goals, palette }: { idx: AnnualIndex; goals: GoalMap; palette: string[] }) {
  const [ref, inView] = useInView<HTMLElement>();
  const { range, invested, milestones } = idx;
  const noun = rangeNoun(range.kind);

  const glow = {
    '--c1': palette[0],
    '--c2': palette[1],
    '--c3': palette[2],
  } as CSSProperties;

  const hours = hoursOf(invested.totalMs);
  const inProgress = range.clipped && range.clippedEnd >= range.start;
  const notStarted = range.clippedEnd < range.start;
  const elapsedPct = pctOf(idx.elapsedDays / idx.totalDays);

  const sentence =
    invested.totalMs > 0 ? (
      <>
        {noun}，你把 <b className="tnum">{hours}</b> 小时交给了 <b className="tnum">{idx.goalCount}</b> 个目标。
      </>
    ) : idx.activeDays > 0 ? (
      <>
        {noun}，你在 <b className="tnum">{idx.activeDays}</b> 天里留下了打卡。
      </>
    ) : (
      <>{noun}的故事，才刚开了个头。</>
    );

  return (
    <header ref={ref} className={`yr-panel yr-cover${inView ? ' is-in' : ''}`} style={glow}>
      <div className="yr-cover-glow" aria-hidden />
      <div className="yr-cover-text">
        <p className="yr-cover-kicker">
          YearFlow · {range.kind === 'full' ? '年度报告' : `${RANGE_LABEL[range.kind]}报告`}
          {inProgress && <span className="tnum"> · 截至 {longDay(range.clippedEnd)}</span>}
        </p>
        <h1 className="yr-cover-year tnum">
          {range.year}
          {range.kind !== 'full' && <span className="yr-cover-range">{RANGE_LABEL[range.kind]}</span>}
        </h1>
        <p className="yr-cover-sentence">{sentence}</p>
        <div className="yr-stats">
          <Stat value={idx.activeDays} unit="天" label="打卡" active={inView} />
          <Stat value={hours} decimals={hours >= 100 || Number.isInteger(hours) ? 0 : 1} unit="小时" label="投入" active={inView} />
          <Stat
            value={milestones.achieved}
            unit={milestones.rows.length > 0 ? `/ ${milestones.rows.length}` : '个'}
            label="里程碑达成"
            active={inView}
          />
        </div>
      </div>
      <YearRing
        idx={idx}
        goals={goals}
        center={
          notStarted ? (
            <>
              <p className="yr-ring-big">—</p>
              <p className="yr-ring-cap">还没开始</p>
            </>
          ) : inProgress ? (
            <>
              <p className="yr-ring-big tnum">
                {elapsedPct}
                <span className="yr-ring-pct">%</span>
              </p>
              <p className="yr-ring-cap">{noun}已走过</p>
            </>
          ) : (
            <>
              <p className="yr-ring-big tnum">{idx.totalDays}</p>
              <p className="yr-ring-cap">天，全部走完</p>
            </>
          )
        }
      />
    </header>
  );
}
