/**
 * 打卡页底部「不定期」区（随缘任务）：默认折叠，点开才列出随缘任务供随手补记。
 * 平时不占「待打卡」计数、不催打卡；每行 = 目标色点 + 目标·任务名 + 状态键（完成/做了一点）
 * + 展开分钟与备注。数据源 derive/dayPanel adhocEntries。
 */
import { useState } from 'react';
import type { AdhocEntry, DayTaskEntry } from '../lib/derive';
import type { Goal } from '../types/domain';
import { goalColor } from '../lib/colors';
import { ExpandChevron, FocusAutoBadge, StatusButtons, TaskEditor } from './GoalCheckCard';
import { StartFocusButton } from '../pomodoro/StartFocusButton';

function AdhocRow({
  goal,
  entry,
  date,
  autoMs = 0,
  isToday,
}: {
  goal: Goal;
  entry: AdhocEntry;
  date: string;
  autoMs?: number;
  isToday?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // AdhocEntry 与 DayTaskEntry 同形，直接复用打卡键/编辑器
  const te: DayTaskEntry = { taskId: entry.taskId, name: entry.name, status: entry.status, record: entry.record };
  return (
    <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span
          aria-hidden
          className="shrink-0"
          style={{ width: 8, height: 8, borderRadius: 999, background: goalColor(goal.color) }}
        />
        <span className="min-w-0 flex-1 truncate" style={{ fontSize: 'var(--font-13)' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>{goal.name} · </span>
          {entry.name}
        </span>
        {entry.record?.minutes ? (
          <span className="tnum shrink-0" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            {entry.record.minutes}分
          </span>
        ) : null}
        <FocusAutoBadge goalId={entry.goalId} date={date} te={te} autoMs={autoMs} />
        {isToday && <StartFocusButton goalId={entry.goalId} taskId={entry.taskId} />}
        <StatusButtons goalId={entry.goalId} date={date} te={te} compact statuses={['done', 'partial']} />
        <ExpandChevron open={open} onClick={() => setOpen((v) => !v)} title={open ? '收起' : '展开分钟与备注'} />
      </div>
      {open && (
        <div className="px-3 pb-2.5">
          <TaskEditor goalId={entry.goalId} date={date} te={te} autoMs={autoMs} />
        </div>
      )}
    </div>
  );
}

export function AdhocSection({
  entries,
  goals,
  date,
  focusMsByTask,
  isToday,
}: {
  entries: AdhocEntry[];
  goals: Record<string, Goal>;
  date: string;
  /** 当日各任务的番茄自动时长（taskId → ms） */
  focusMsByTask?: Map<string, number>;
  isToday?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  const recorded = entries.filter((e) => e.record).length;

  return (
    <div
      className="mt-4 border"
      style={{ borderColor: 'var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5"
        style={{ fontSize: 'var(--font-13)', color: 'var(--text-secondary)' }}
      >
        <span
          aria-hidden
          className="transition-transform"
          style={{ color: 'var(--text-tertiary)', transform: open ? 'rotate(90deg)' : 'none' }}
        >
          ▸
        </span>
        <span>不定期</span>
        <span className="tnum" style={{ color: 'var(--text-tertiary)' }}>· {entries.length}</span>
        {recorded > 0 && (
          <span className="tnum ml-auto" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            已记 {recorded}
          </span>
        )}
      </button>
      {open &&
        entries.map((e) => {
          const goal = goals[e.goalId];
          return goal ? (
            <AdhocRow
              key={e.taskId}
              goal={goal}
              entry={e}
              date={date}
              autoMs={focusMsByTask?.get(e.taskId) ?? 0}
              isToday={isToday}
            />
          ) : null;
        })}
    </div>
  );
}
