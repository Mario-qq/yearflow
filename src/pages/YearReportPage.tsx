/**
 * 年报 `/year`（docs/ANNUAL_SPEC.md）：一页海报长卷 —— 封面年轮 + 四节 + 结尾。
 *
 * 与复盘页的分工（SPEC §7.1）：复盘页是仪表盘，回答「数字是多少」；年报是叙事，
 * 回答「这一年过成了什么样」。每节只有一句话、一张图，不写口径注释。
 *
 * 两条结构性约束：
 * 1. **只调 annualIndex 一次**（一个 useMemo）。各节组件只读 props，不自己扫全表。
 * 2. 本页走 lazy() 路由 ⇒ 主包零增量；不引 recharts，图全部自绘。
 */
import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { todayStr } from '../lib/date';
// ⚠️ 直连 derive/annual，**不走 lib/derive 的 barrel**（见 annual.ts 文件头）
import { annualIndex, type RangeKind } from '../lib/derive/annual';
import { Controls } from '../annual/Controls';
import { Cover } from '../annual/Cover';
import { paletteOf } from '../annual/palette';
import { SectionTime } from '../annual/SectionTime';
import { SectionStreak } from '../annual/SectionStreak';
import { SectionHarvest } from '../annual/SectionHarvest';
import { SectionRhythm } from '../annual/SectionRhythm';
import { Closing } from '../annual/Closing';
import { Tip } from '../annual/Tip';
import { RANGE_LABEL } from '../annual/format';
import { PAGE_MAX_W } from '../annual/constants';
import '../annual/annual.css';

export default function YearReportPage() {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const milestones = useStore((s) => s.milestones);
  const checkIns = useStore((s) => s.checkIns);
  const exemptions = useStore((s) => s.exemptions);
  const focusSessions = useStore((s) => s.focusSessions);
  const reviews = useStore((s) => s.reviews);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);

  const today = todayStr();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [kind, setKind] = useState<RangeKind>('full');
  const rootRef = useRef<HTMLDivElement>(null);

  const goalList = useMemo(
    () =>
      Object.values(goals)
        .filter((g) => !g.deletedAt)
        .sort((a, b) => a.order - b.order),
    [goals],
  );
  const goalMap = useMemo(() => new Map(goalList.map((g) => [g.id, g])), [goalList]);
  const taskList = useMemo(() => Object.values(tasks), [tasks]);
  const checkInList = useMemo(() => Object.values(checkIns), [checkIns]);
  const exemptionList = useMemo(() => Object.values(exemptions), [exemptions]);
  const milestoneList = useMemo(() => Object.values(milestones), [milestones]);
  const sessionList = useMemo(() => Object.values(focusSessions), [focusSessions]);
  const reviewList = useMemo(() => Object.values(reviews), [reviews]);

  /** 可选年份 = 有数据的年份 ∪ 当年，降序 */
  const years = useMemo(() => {
    const set = new Set<number>([Number(today.slice(0, 4)), year]);
    for (const c of checkInList) if (!c.deletedAt) set.add(Number(c.date.slice(0, 4)));
    for (const s of sessionList) if (!s.deletedAt) set.add(Number(s.date.slice(0, 4)));
    for (const t of taskList) {
      if (t.deletedAt) continue;
      for (let y = Number(t.startDate.slice(0, 4)); y <= Number(t.endDate.slice(0, 4)); y += 1) set.add(y);
    }
    return [...set].sort((a, b) => b - a);
  }, [checkInList, sessionList, taskList, today, year]);

  const idx = useMemo(
    () =>
      annualIndex({
        goals: goalList,
        tasks: taskList,
        milestones: milestoneList,
        checkIns: checkInList,
        exemptions: exemptionList,
        sessions: sessionList,
        reviews: reviewList,
        year,
        kind,
        today,
      }),
    [goalList, taskList, milestoneList, checkInList, exemptionList, sessionList, reviewList, year, kind, today],
  );
  const palette = useMemo(() => paletteOf(idx, goalMap), [idx, goalMap]);

  // 没有内容的节整节不出现（不显示一堆 0），编号按实际出现的顺序排
  const sections: { key: string; render: (no: string) => React.ReactNode }[] = [];
  if (idx.invested.totalMs > 0)
    sections.push({ key: 'time', render: (no) => <SectionTime idx={idx} goals={goalMap} no={no} /> });
  if (idx.activeDays > 0 || idx.runs.length > 0)
    sections.push({
      key: 'streak',
      render: (no) => <SectionStreak idx={idx} goals={goalMap} no={no} weekStartsOn={weekStartsOn} />,
    });
  if (idx.milestones.rows.length > 0 || idx.outcomes.length > 0)
    sections.push({ key: 'harvest', render: (no) => <SectionHarvest idx={idx} goals={goalMap} no={no} /> });
  if (idx.invested.totalMs > 0 || idx.months.some((m) => m.rate !== null))
    sections.push({
      key: 'rhythm',
      render: (no) => <SectionRhythm idx={idx} goals={goalMap} no={no} weekStartsOn={weekStartsOn} />,
    });

  const otherYears = years.filter((y) => y !== year);

  return (
    <div ref={rootRef} className="yr">
      <div className="yr-col" style={{ maxWidth: PAGE_MAX_W }}>
        <Controls year={year} years={years} kind={kind} onYear={setYear} onKind={setKind} />

        {idx.empty ? (
          <div className="yr-panel yr-empty">
            <div className="yr-empty-ring" aria-hidden />
            <p className="yr-empty-title tnum">
              {year} {RANGE_LABEL[kind]}，还是一页白纸
            </p>
            <p className="yr-empty-sub">
              {idx.range.clippedEnd < idx.range.start
                ? '这段日子还没开始，到时候再回来看。'
                : '这段时间里没有任务、打卡或专注记录。'}
            </p>
            {otherYears.length > 0 && (
              <div className="yr-empty-years">
                {otherYears.map((y) => (
                  <button key={y} type="button" className="tnum" onClick={() => setYear(y)}>
                    看 {y}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          // key 随区间变：切换区间时各节重新入场，数字从 0 滚起
          <div key={`${year}-${kind}`} className="yr-flow">
            <Cover idx={idx} goals={goalMap} palette={palette} />
            {sections.map((s, i) => (
              <div key={s.key}>{s.render(String(i + 1).padStart(2, '0'))}</div>
            ))}
            <Closing idx={idx} palette={palette} />
          </div>
        )}
      </div>
      <Tip root={rootRef} />
    </div>
  );
}
