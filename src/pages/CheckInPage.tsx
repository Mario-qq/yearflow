/**
 * 今日打卡面板（SPEC 第五节）：每日高频入口、移动端首屏。
 * 顶部日期 + 年度进度；最近 7 天小环日历（点击切日补卡）；按目标三大按钮打卡，
 * 打卡后卡片 FLIP 滑向"已完成"分组；昨日缺卡入口；全部完成显示 streak + 鼓励语。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { CheckIn, CheckInStatus } from '../types/domain';
import { useStore } from '../store/useStore';
import { fmtDay, toDay, todayStr } from '../lib/date';
import { calcStreak, dayCompletionRate, dayEntries } from '../lib/derive';
import { DayStrip, type StripDay } from '../checkin/DayStrip';
import { GoalCheckCard } from '../checkin/GoalCheckCard';
import { useFlip } from '../checkin/useFlip';

const ENCOURAGEMENTS = [
  '把今天过成复利。',
  '稳住节奏，剩下的交给时间。',
  '连续本身就是最好的动力。',
  '小步不停，终点自己会来。',
  '比昨天多走了一步，就够了。',
  '安静地做，让结果说话。',
  '年度计划就是这样一天天长出来的。',
];

const STATUS_RANK: Record<CheckInStatus, number> = { done: 3, partial: 2, skipped: 1 };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mt-1 mb-0.5"
      style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
    >
      {children}
    </div>
  );
}

export default function CheckInPage() {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const checkIns = useStore((s) => s.checkIns);
  const exemptions = useStore((s) => s.exemptions);

  const today = todayStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);

  const goalList = useMemo(() => Object.values(goals), [goals]);
  const taskList = useMemo(() => Object.values(tasks), [tasks]);
  const checkInList = useMemo(() => Object.values(checkIns), [checkIns]);
  const exemptionList = useMemo(() => Object.values(exemptions), [exemptions]);

  const entriesOf = useCallback(
    (date: string) =>
      dayEntries({ date, goals: goalList, tasks: taskList, checkIns: checkInList, exemptions: exemptionList }),
    [goalList, taskList, checkInList, exemptionList],
  );

  const entries = useMemo(() => entriesOf(selectedDate), [entriesOf, selectedDate]);

  // 最近 7 天完成率小环
  const stripDays: StripDay[] = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = fmtDay(toDay(today).subtract(6 - i, 'day'));
        return { date, rate: dayCompletionRate(entriesOf(date)) };
      }),
    [entriesOf, today],
  );

  // 当日各目标的完整记录（同日多条取最强，与派生口径一致）
  const recordByGoal = useMemo(() => {
    const map = new Map<string, CheckIn>();
    for (const c of checkInList) {
      if (c.deletedAt || c.date !== selectedDate) continue;
      const prev = map.get(c.goalId);
      if (!prev || STATUS_RANK[c.status] > STATUS_RANK[prev.status]) map.set(c.goalId, c);
    }
    return map;
  }, [checkInList, selectedDate]);

  const streakByGoal = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      map.set(
        e.goalId,
        calcStreak({
          goalId: e.goalId,
          tasks: taskList.filter((t) => t.goalId === e.goalId),
          checkIns: checkInList,
          exemptions: exemptionList,
          today,
        }).current,
      );
    }
    return map;
  }, [entries, taskList, checkInList, exemptionList, today]);

  const yesterday = fmtDay(toDay(today).subtract(1, 'day'));
  const yesterdayMissed = useMemo(
    () => entriesOf(yesterday).filter((e) => !e.exempt && !e.status).length,
    [entriesOf, yesterday],
  );

  const pending = entries.filter((e) => !e.exempt && !e.status);
  const finished = entries.filter((e) => !e.exempt && e.status);
  const resting = entries.filter((e) => e.exempt);
  const allDone = entries.length > 0 && pending.length === 0 && finished.length > 0;

  // FLIP：分组归属变化时卡片平滑滑动
  const listRef = useRef<HTMLDivElement>(null);
  useFlip(listRef, entries.map((e) => `${e.goalId}:${e.status ?? ''}`).join('|') + selectedDate);

  const isToday = selectedDate === today;
  const d = toDay(selectedDate);
  const yearStart = toDay(`${d.year()}-01-01`);
  const dayOfYear = d.diff(yearStart, 'day') + 1;
  const daysInYear = toDay(`${d.year()}-12-31`).diff(yearStart, 'day') + 1;
  const yearPct = (dayOfYear / daysInYear) * 100;

  const maxStreak = Math.max(0, ...[...streakByGoal.values()]);
  const encouragement = ENCOURAGEMENTS[dayOfYear % ENCOURAGEMENTS.length];

  const renderCard = (e: (typeof entries)[number]) => {
    const goal = goals[e.goalId];
    if (!goal) return null;
    return (
      <GoalCheckCard
        key={e.goalId}
        goal={goal}
        entry={e}
        dueTasks={e.dueTaskIds.map((id) => tasks[id]).filter(Boolean)}
        record={recordByGoal.get(e.goalId)}
        streak={isToday ? streakByGoal.get(e.goalId) : undefined}
        date={selectedDate}
        expanded={expandedGoalId === e.goalId}
        onToggleExpand={() => setExpandedGoalId((v) => (v === e.goalId ? null : e.goalId))}
      />
    );
  };

  return (
    <div className="mx-auto max-w-2xl p-6 max-md:p-4">
      <div className="flex items-baseline gap-3">
        <h1 className="mb-1 font-semibold" style={{ fontSize: 'var(--font-20)' }}>
          {isToday ? '今日打卡' : `补卡 · ${d.month() + 1}月${d.date()}日`}
        </h1>
        {!isToday && (
          <button
            type="button"
            onClick={() => setSelectedDate(today)}
            className="cursor-pointer"
            style={{ fontSize: 'var(--font-12)', color: 'var(--accent)' }}
          >
            回到今天
          </button>
        )}
      </div>
      <p className="tnum mb-2" style={{ fontSize: 'var(--font-13)', color: 'var(--text-tertiary)' }}>
        {selectedDate} · {d.year()} 第 {dayOfYear} 天 · 年度进度 {yearPct.toFixed(1)}%
      </p>
      <div
        className="mb-4 h-[3px] w-full overflow-hidden"
        style={{ background: 'var(--bg-subtle)', borderRadius: 999 }}
        aria-hidden
      >
        <div
          className="h-full"
          style={{ width: `${yearPct}%`, background: 'var(--accent)', borderRadius: 999 }}
        />
      </div>

      <DayStrip days={stripDays} selected={selectedDate} today={today} onSelect={setSelectedDate} />

      {entries.length === 0 ? (
        <p className="mt-4" style={{ fontSize: 'var(--font-13)', color: 'var(--text-tertiary)' }}>
          {isToday ? '今天没有应打卡项。到「设置」页载入示例数据试试。' : '这一天没有应打卡项。'}
        </p>
      ) : (
        <div ref={listRef} className="mt-3 flex flex-col gap-2">
          {allDone && (
            <div
              className="flex items-center gap-3 border p-4"
              style={{
                borderColor: 'color-mix(in srgb, var(--success) 35%, transparent)',
                borderRadius: 'var(--radius-lg)',
                background: 'color-mix(in srgb, var(--success) 8%, transparent)',
              }}
            >
              <span style={{ fontSize: 'var(--font-20)' }} aria-hidden>
                🎉
              </span>
              <div>
                <div className="font-medium" style={{ color: 'var(--success)' }}>
                  {isToday ? '完成今天全部打卡' : '补齐这一天的打卡'}
                  {maxStreak > 1 && ` · 🔥 最长连续 ${maxStreak} 天`}
                </div>
                <div style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
                  {encouragement}
                </div>
              </div>
            </div>
          )}

          {pending.length > 0 && <SectionLabel>待打卡 · {pending.length}</SectionLabel>}
          {pending.map(renderCard)}

          {finished.length > 0 && <SectionLabel>已完成 · {finished.length}</SectionLabel>}
          {finished.map(renderCard)}

          {resting.length > 0 && <SectionLabel>休息中 · {resting.length}</SectionLabel>}
          {resting.map(renderCard)}
        </div>
      )}

      {isToday && yesterdayMissed > 0 && (
        <button
          type="button"
          onClick={() => setSelectedDate(yesterday)}
          className="mt-4 flex w-full cursor-pointer items-center justify-between border px-4 py-3 transition-colors"
          style={{
            fontSize: 'var(--font-13)',
            borderColor: 'var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-panel)',
            color: 'var(--text-secondary)',
          }}
        >
          <span>
            补昨天的卡 · 有{' '}
            <span className="tnum" style={{ color: 'var(--danger)' }}>
              {yesterdayMissed}
            </span>{' '}
            项缺卡
          </span>
          <span aria-hidden>→</span>
        </button>
      )}
    </div>
  );
}
