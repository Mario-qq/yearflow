import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { todayStr, toDay } from '../lib/date';
import { calcStreak, expandScheduledDays, bestStatusByDate } from '../lib/derive';
import { goalColor } from '../lib/colors';
import type { CheckInStatus } from '../types/domain';

const STATUS_LABEL: Record<CheckInStatus, string> = {
  done: '✓ 已完成',
  partial: '◐ 做了一点',
  skipped: '— 已跳过',
};

/** Phase 4 补全交互（打卡按钮/分钟/补卡）；当前展示今日应打卡项与 streak */
export default function CheckInPage() {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const checkIns = useStore((s) => s.checkIns);
  const exemptions = useStore((s) => s.exemptions);

  const today = todayStr();
  const rows = useMemo(() => {
    const exemptionList = Object.values(exemptions);
    const checkInList = Object.values(checkIns);
    const taskList = Object.values(tasks);
    return Object.values(goals)
      .filter((g) => !g.archived)
      .sort((a, b) => a.order - b.order)
      .map((goal) => {
        const goalTasks = taskList.filter((t) => t.goalId === goal.id && t.status !== 'done');
        const dueTasks = goalTasks.filter((t) =>
          expandScheduledDays(t, exemptionList, today).includes(today),
        );
        const status = bestStatusByDate(checkInList, goal.id).get(today);
        const streak = calcStreak({
          goalId: goal.id,
          tasks: taskList.filter((t) => t.goalId === goal.id),
          checkIns: checkInList,
          exemptions: exemptionList,
          today,
        });
        return { goal, dueTasks, status, streak };
      })
      .filter((r) => r.dueTasks.length > 0);
  }, [goals, tasks, checkIns, exemptions, today]);

  const dayOfYear = toDay(today).diff(toDay(`${toDay(today).year()}-01-01`), 'day') + 1;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 font-semibold" style={{ fontSize: 'var(--font-20)' }}>
        今日打卡
      </h1>
      <p className="tnum mb-5" style={{ fontSize: 'var(--font-13)', color: 'var(--text-tertiary)' }}>
        {today} · {toDay(today).year()} 第 {dayOfYear} 天
      </p>
      {rows.length === 0 ? (
        <p style={{ fontSize: 'var(--font-13)', color: 'var(--text-tertiary)' }}>
          今天没有应打卡项。到「设置」页载入示例数据试试。
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(({ goal, dueTasks, status, streak }) => (
            <div
              key={goal.id}
              className="flex items-center gap-3 border p-3"
              style={{
                borderColor: 'var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-panel)',
                borderLeft: `3px solid ${goalColor(goal.color)}`,
              }}
            >
              <span style={{ fontSize: 'var(--font-16)' }}>{goal.icon}</span>
              <div className="min-w-0">
                <div className="font-medium">{goal.name}</div>
                <div
                  className="truncate"
                  style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
                >
                  {dueTasks.map((t) => t.name).join(' · ')}
                </div>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-3">
                {streak.current > 0 && (
                  <span className="tnum" style={{ fontSize: 'var(--font-12)' }}>
                    🔥 {streak.current}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 'var(--font-12)',
                    color: status ? 'var(--success)' : 'var(--text-tertiary)',
                  }}
                >
                  {status ? STATUS_LABEL[status] : '未打卡（Phase 4 开放操作）'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
