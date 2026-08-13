/**
 * 统计与月度复盘页（SPEC 第七节）。
 * 月度复盘（每月一屏）：各目标完成率横条/投入时长/缺卡天数、本月甘特缩略、
 * 年度热力图、streak 榜、复盘笔记 + 星评；上/下月切换回看历史。
 * 年度总览：堆叠面积图、任务完成数、里程碑时间线、基线偏移排行。
 */
import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { fmtDay, toDay, todayStr } from '../lib/date';
import { calcStreak, monthlyGoalStats } from '../lib/derive';
import { goalColor } from '../lib/colors';
import { AnnualOverview } from '../review/AnnualOverview';
import { MiniMonthGantt } from '../review/MiniMonthGantt';
import { NotesEditor } from '../review/NotesEditor';
import { YearHeatmap } from '../review/YearHeatmap';

type View = 'month' | 'year';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="border p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-panel)',
      }}
    >
      <h2 className="mb-3 font-medium" style={{ fontSize: 'var(--font-14)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const navBtnStyle: React.CSSProperties = {
  fontSize: 'var(--font-13)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  padding: '2px 10px',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
};

export default function ReviewPage() {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const milestones = useStore((s) => s.milestones);
  const checkIns = useStore((s) => s.checkIns);
  const exemptions = useStore((s) => s.exemptions);
  const focusSessions = useStore((s) => s.focusSessions);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);

  const today = todayStr();
  const [view, setView] = useState<View>('month');
  const [month, setMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const year = Number(month.slice(0, 4));

  const goalList = useMemo(
    () =>
      Object.values(goals)
        .filter((g) => !g.deletedAt && !g.archived)
        .sort((a, b) => a.order - b.order),
    [goals],
  );
  const taskList = useMemo(() => Object.values(tasks), [tasks]);
  const checkInList = useMemo(() => Object.values(checkIns), [checkIns]);
  const exemptionList = useMemo(() => Object.values(exemptions), [exemptions]);
  const milestoneList = useMemo(() => Object.values(milestones), [milestones]);
  const sessionList = useMemo(() => Object.values(focusSessions), [focusSessions]);

  // 各目标本月统计
  const stats = useMemo(
    () =>
      goalList.map((goal) => ({
        goal,
        stats: monthlyGoalStats({
          goalId: goal.id,
          tasks: taskList,
          checkIns: checkInList,
          exemptions: exemptionList,
          month,
          today,
          sessions: sessionList,
        }),
      })),
    [goalList, taskList, checkInList, exemptionList, sessionList, month, today],
  );
  const totalMinutes = stats.reduce((sum, s) => sum + s.stats.minutes, 0);
  const totalMissed = stats.reduce((sum, s) => sum + s.stats.missedDays, 0);

  // streak 榜（当前 streak 降序）
  const streaks = useMemo(
    () =>
      goalList
        .map((goal) => ({
          goal,
          streak: calcStreak({
            goalId: goal.id,
            tasks: taskList.filter((t) => t.goalId === goal.id),
            checkIns: checkInList,
            exemptions: exemptionList,
            today,
          }),
        }))
        .sort((a, b) => b.streak.current - a.streak.current),
    [goalList, taskList, checkInList, exemptionList, today],
  );

  const shiftMonth = (delta: number) => {
    setMonth(fmtDay(toDay(`${month}-01`).add(delta, 'month')).slice(0, 7));
  };

  const fmtHours = (min: number) =>
    min >= 60 ? `${Math.round((min / 60) * 10) / 10} 小时` : `${min} 分钟`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6 max-md:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-semibold" style={{ fontSize: 'var(--font-20)' }}>
          复盘
        </h1>
        <div
          className="flex overflow-hidden border"
          style={{ borderColor: 'var(--border-default)', borderRadius: 'var(--radius-md)' }}
        >
          {(['month', 'year'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="cursor-pointer px-3 py-1"
              style={{
                fontSize: 'var(--font-13)',
                background: view === v ? 'var(--accent-soft)' : 'transparent',
                color: view === v ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {v === 'month' ? '月度复盘' : '年度总览'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {view === 'month' && (
            <button type="button" style={navBtnStyle} onClick={() => shiftMonth(-1)} title="上一月">
              ◀
            </button>
          )}
          <span className="tnum font-medium" style={{ fontSize: 'var(--font-14)' }}>
            {view === 'month' ? `${year}年${Number(month.slice(5, 7))}月` : `${year}年`}
          </span>
          {view === 'month' && (
            <button type="button" style={navBtnStyle} onClick={() => shiftMonth(1)} title="下一月">
              ▶
            </button>
          )}
          {view === 'month' && month !== today.slice(0, 7) && (
            <button
              type="button"
              onClick={() => setMonth(today.slice(0, 7))}
              className="cursor-pointer"
              style={{ fontSize: 'var(--font-12)', color: 'var(--accent)' }}
            >
              回到本月
            </button>
          )}
        </div>
      </div>

      {view === 'year' ? (
        <AnnualOverview
          year={year}
          goals={goalList}
          tasks={taskList}
          milestones={milestoneList}
          checkIns={checkInList}
          sessions={sessionList}
        />
      ) : (
        <>
          <Card title={`各目标完成率 · 投入 ${fmtHours(totalMinutes)} · 缺卡 ${totalMissed} 天`}>
            {stats.every((s) => s.stats.rate === null) ? (
              <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
                本月没有应打卡记录。
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {stats.map(({ goal, stats: s }) => {
                  if (s.rate === null) return null;
                  return (
                    <div key={goal.id} className="flex items-center gap-2">
                      <span className="w-28 truncate" style={{ fontSize: 'var(--font-12)' }}>
                        {goal.icon} {goal.name}
                      </span>
                      <div
                        className="relative h-4 flex-1 overflow-hidden"
                        style={{ background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}
                      >
                        <div
                          className="absolute inset-y-0 left-0"
                          style={{
                            width: `${s.rate}%`,
                            background: goalColor(goal.color),
                            borderRadius: 'var(--radius-sm)',
                            transition: 'width var(--dur-zoom) var(--ease)',
                          }}
                        />
                      </div>
                      <span className="tnum w-10 text-right" style={{ fontSize: 'var(--font-12)' }}>
                        {s.rate}%
                      </span>
                      <span
                        className="tnum w-20 text-right"
                        style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
                      >
                        {s.minutes > 0 ? fmtHours(s.minutes) : '—'}
                      </span>
                      <span
                        className="tnum w-14 text-right"
                        style={{
                          fontSize: 'var(--font-11)',
                          color: s.missedDays > 0 ? 'var(--danger)' : 'var(--text-tertiary)',
                        }}
                      >
                        缺 {s.missedDays}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="本月甘特缩略">
            <MiniMonthGantt
              month={month}
              goals={goalList}
              tasks={taskList}
              checkIns={checkInList}
              exemptions={exemptionList}
              today={today}
            />
          </Card>

          <Card title={`${year} 年度热力图`}>
            <YearHeatmap year={year} checkIns={checkInList} goals={goalList} weekStartsOn={weekStartsOn} />
          </Card>

          <Card title="Streak 榜">
            <div className="flex flex-col gap-1.5">
              {streaks.map(({ goal, streak }, i) => (
                <div key={goal.id} className="flex items-center gap-2" style={{ fontSize: 'var(--font-12)' }}>
                  <span className="tnum w-5 text-right" style={{ color: 'var(--text-tertiary)' }}>
                    {i + 1}
                  </span>
                  <span className="truncate">
                    {goal.icon} {goal.name}
                  </span>
                  <span className="tnum ml-auto" style={{ color: 'var(--text-secondary)' }}>
                    {streak.current > 0 ? `🔥 ${streak.current} 天` : '—'}
                  </span>
                  <span className="tnum w-20 text-right" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
                    最长 {streak.longest} 天
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="复盘笔记">
            <NotesEditor month={month} />
          </Card>
        </>
      )}
    </div>
  );
}
