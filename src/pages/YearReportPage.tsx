/**
 * 年报 `/year`（docs/ANNUAL_SPEC.md）：一页读完一年的叙事长图。
 *
 * 与复盘页的分工是硬约束（规格 §一）：复盘页回答「数字是多少」，年报回答
 * 「这一年到底发生了什么、我不知道的是什么」。凡是 AnnualOverview 已说清的，
 * 这里要么不重复，要么换成它给不了的对比。
 *
 * 两条结构性约束：
 * 1. **只调 annualIndex 一次**（一个 useMemo）。禁止每个 beat 各自调派生扫全表（规格 §六）。
 * 2. 本页走 lazy() 路由 ⇒ 主包 gzip 增量目标 0；且**一个 recharts 都不引**，
 *    全仓唯一 recharts import 点必须仍只有 review/AnnualOverview.tsx（规格 §二）。
 */
import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { todayStr } from '../lib/date';
// ⚠️ 从 derive/annual 直接导入，**不走 lib/derive 的 barrel**：barrel 被主包（甘特/复盘）
// 引用着，经它导入会让 annual.ts 落进共享的 index chunk（实测主包 gzip +2.2kB），
// 违反规格 §六「主包 gzip 增量 0」。annual.ts 只被本页这条 lazy 链引用时才会留在 lazy chunk 里。
import { annualIndex, type RangeKind } from '../lib/derive/annual';
import { AnnualTopBar } from '../annual/AnnualTopBar';
import { BeatCover } from '../annual/BeatCover';
import { BeatInvested } from '../annual/BeatInvested';
import { BeatCadence } from '../annual/BeatCadence';
import { BeatMismatch } from '../annual/BeatMismatch';
import { BeatBestWorst } from '../annual/BeatBestWorst';
import { BeatStreak } from '../annual/BeatStreak';
import { PAGE_W } from '../annual/constants';
import { RANGE_LABEL } from '../annual/format';
import '../annual/annual.css';

export default function YearReportPage() {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const milestones = useStore((s) => s.milestones);
  const checkIns = useStore((s) => s.checkIns);
  const exemptions = useStore((s) => s.exemptions);
  const focusSessions = useStore((s) => s.focusSessions);

  const today = todayStr();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [kind, setKind] = useState<RangeKind>('full');

  // 归档目标照常进年报：年报是**历史**，把归档目标从这一年里抹掉才是失真
  // （annualIndex 的分母也含它们，抹掉会让百分比加不到 100）。软删的才真正不算。
  const goalList = useMemo(
    () =>
      Object.values(goals)
        .filter((g) => !g.deletedAt)
        .sort((a, b) => a.order - b.order),
    [goals],
  );
  const taskList = useMemo(() => Object.values(tasks).filter((t) => !t.deletedAt), [tasks]);
  const checkInList = useMemo(() => Object.values(checkIns), [checkIns]);
  const exemptionList = useMemo(() => Object.values(exemptions), [exemptions]);
  const milestoneList = useMemo(() => Object.values(milestones), [milestones]);
  const sessionList = useMemo(() => Object.values(focusSessions), [focusSessions]);

  /** 年份下拉 = 有数据的年份 ∪ 当年，降序（规格 §4.1） */
  const years = useMemo(() => {
    const set = new Set<number>([Number(today.slice(0, 4)), year]);
    for (const c of checkInList) if (!c.deletedAt) set.add(Number(c.date.slice(0, 4)));
    for (const s of sessionList) if (!s.deletedAt) set.add(Number(s.date.slice(0, 4)));
    for (const t of taskList) {
      const a = Number(t.startDate.slice(0, 4));
      const b = Number(t.endDate.slice(0, 4));
      for (let y = a; y <= b; y += 1) set.add(y);
    }
    return [...set].sort((a, b) => b - a);
  }, [checkInList, sessionList, taskList, today, year]);

  // 唯一的派生入口：一次算完 11 个 beat 需要的全部数据
  const idx = useMemo(
    () =>
      annualIndex({
        goals: goalList,
        tasks: taskList,
        milestones: milestoneList,
        checkIns: checkInList,
        exemptions: exemptionList,
        sessions: sessionList,
        year,
        kind,
        today,
      }),
    [goalList, taskList, milestoneList, checkInList, exemptionList, sessionList, year, kind, today],
  );

  // 封面用的两个计数：区间内有排期或有记录的目标 / 与区间有交集的任务
  const cover = useMemo(() => {
    const { start, end } = idx.range;
    const inRange = taskList.filter((t) => t.startDate <= end && t.endDate >= start);
    const active = new Set(inRange.map((t) => t.goalId));
    for (const [goalId, ms] of idx.invested.byGoal) if (ms > 0) active.add(goalId);
    return { goalCount: active.size, taskCount: inRange.length };
  }, [idx, taskList]);

  const otherYears = years.filter((y) => y !== year);

  return (
    <div
      className="mx-auto flex flex-col gap-6 px-6 pb-16 max-md:px-4"
      style={{ maxWidth: PAGE_W }}
    >
      <AnnualTopBar
        year={year}
        kind={kind}
        years={years}
        clippedEnd={
          idx.range.clipped && idx.range.clippedEnd >= idx.range.start
            ? idx.range.clippedEnd
            : undefined
        }
        onYear={setYear}
        onKind={setKind}
      />

      {idx.empty ? (
        /* 规格 §4.2：不许白屏、不许显示一堆 0 */
        <div
          className="flex flex-col items-center gap-3 border py-16 text-center"
          style={{
            borderColor: 'var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-raised)',
          }}
        >
          <p className="tnum" style={{ fontSize: 'var(--font-20)', fontWeight: 500 }}>
            {year} 年{RANGE_LABEL[kind]}没有记录
          </p>
          <p style={{ fontSize: 'var(--font-13)', color: 'var(--text-tertiary)' }}>
            {idx.range.clippedEnd < idx.range.start
              ? '这个区间还没开始 —— 到时候再回来看。'
              : '这个区间里没有任务、没有打卡、也没有专注记录。'}
          </p>
          {otherYears.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
                换一年看看：
              </span>
              {otherYears.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYear(y)}
                  className="tnum cursor-pointer px-2.5 py-1"
                  style={{
                    fontSize: 'var(--font-13)',
                    color: 'var(--accent)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-panel)',
                  }}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <BeatCover idx={idx} goalCount={cover.goalCount} taskCount={cover.taskCount} />
          <BeatInvested idx={idx} goals={goalList} />
          <BeatCadence idx={idx} />
          <BeatMismatch idx={idx} goals={goalList} />
          <BeatBestWorst idx={idx} />
          <BeatStreak idx={idx} goals={goalList} />
          {/* beat 6–10（漂移排行 / 里程碑 / 停滞与放弃 / 节律画像 / 收尾）见 Y3 */}
          <p
            className="pt-2 text-center"
            style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
          >
            后半段（计划漂移、里程碑、停滞与放弃、节律画像）还在路上。
          </p>
        </>
      )}
    </div>
  );
}
