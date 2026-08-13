/**
 * 番茄钟任务选择器（规格 §8.2 第 3 项）。
 *
 * 三条来自规格的硬性要求：
 * · 列表**必须包含 adhoc「随缘」任务** —— 只列 dayEntries 的话随缘任务永远统计不到时间
 *   （isScheduledDow 对 adhoc 恒为 false）；
 * · 允许「暂不归类」（先开始后归类，事后在面板里清理）；
 * · 选中日期范围外 / 已完成的任务：**提示但不阻止**（任务延期是真实情况），
 *   并顺手给一个「延长任务到今天」的快捷动作。
 */
import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { adhocEntries, dayEntries } from '../lib/derive';
import { patchTask } from '../store/actions';
import { todayStr } from '../lib/date';
import { useSelLabel, type FocusSel } from './useSelLabel';

interface Option {
  goalId: string;
  taskId: string;
  goalName: string;
  goalIcon: string;
  taskName: string;
}

const rowStyle: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  padding: '3px 8px',
  cursor: 'pointer',
};

export function TaskPicker({
  value,
  onPick,
  compact,
}: {
  value: FocusSel;
  onPick: (sel: FocusSel) => void;
  compact?: boolean;
}) {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const checkIns = useStore((s) => s.checkIns);
  const exemptions = useStore((s) => s.exemptions);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const today = todayStr();
  const label = useSelLabel(value);

  const { todayOptions, allOptions } = useMemo(() => {
    const goalList = Object.values(goals);
    const taskList = Object.values(tasks);
    const toOption = (goalId: string, taskId: string, taskName: string): Option | null => {
      const g = goals[goalId];
      if (!g) return null;
      // icon 是可选字段：缺省时留空而不是渲染出 'undefined'（既有写法见 CommandPalette）
      return { goalId, taskId, goalName: g.name, goalIcon: g.icon ?? '', taskName };
    };

    const due = dayEntries({
      date: today,
      goals: goalList,
      tasks: taskList,
      checkIns: Object.values(checkIns),
      exemptions: Object.values(exemptions),
    })
      .filter((e) => !e.exempt)
      .flatMap((e) => e.taskEntries.map((te) => toOption(e.goalId, te.taskId, te.name)));
    // 随缘任务不在 dayEntries 里，必须单独并进来
    const adhoc = adhocEntries({
      date: today,
      goals: goalList,
      tasks: taskList,
      checkIns: Object.values(checkIns),
    }).map((e) => toOption(e.goalId, e.taskId, e.name));

    const seen = new Set<string>();
    const todayOptions = [...due, ...adhoc].filter((o): o is Option => {
      if (!o || seen.has(o.taskId)) return false;
      seen.add(o.taskId);
      return true;
    });

    const allOptions = taskList
      .filter((t) => !t.deletedAt && !goals[t.goalId]?.deletedAt && !goals[t.goalId]?.archived)
      .sort((a, b) => a.order - b.order)
      .map((t) => toOption(t.goalId, t.id, t.name))
      .filter((o): o is Option => o !== null);

    return { todayOptions, allOptions };
  }, [goals, tasks, checkIns, exemptions, today]);

  const q = query.trim().toLowerCase();
  const list = q
    ? allOptions.filter(
        (o) => o.taskName.toLowerCase().includes(q) || o.goalName.toLowerCase().includes(q),
      )
    : todayOptions;

  const picked = value.taskId ? tasks[value.taskId] : undefined;
  const overdue = picked && !picked.deletedAt && picked.endDate < today;
  const notStarted = picked && !picked.deletedAt && picked.startDate > today;
  const isDone = picked?.status === 'done';

  const choose = (sel: FocusSel) => {
    onPick(sel);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-1 text-left"
        style={{ ...rowStyle, fontSize: compact ? 'var(--font-11)' : 'var(--font-12)' }}
        title="选择这段专注计入哪个任务"
      >
        <span className="min-w-0 flex-1 truncate" style={{ color: label.text === '暂不归类' ? 'var(--text-tertiary)' : undefined }}>
          {label.text}
        </span>
        <span aria-hidden style={{ color: 'var(--text-tertiary)' }}>
          ▾
        </span>
      </button>

      {/* 提示但不阻止：任务延期是真实情况，拦住用户反而逼他改数据来迁就工具 */}
      {!open && (overdue || notStarted || isDone) && (
        <p className="mt-1 flex items-center gap-1.5" style={{ fontSize: 'var(--font-11)', color: 'var(--warning)' }}>
          <span>{isDone ? '该任务已标记完成' : overdue ? '该任务已过截止日' : '该任务还没开始'}</span>
          {/* 已完成的任务不给「延长到今天」：那是延期任务的动作，混在一起会让提示自相矛盾 */}
          {overdue && !isDone && picked && (
            <button
              type="button"
              onClick={() => patchTask(picked.id, { endDate: today }, `延长「${picked.name}」到今天`)}
              className="cursor-pointer underline underline-offset-2"
              style={{ color: 'var(--accent)' }}
            >
              延长到今天
            </button>
          )}
        </p>
      )}

      {open && (
        <div
          className="absolute right-0 left-0 z-50 mt-1 flex flex-col border p-2"
          style={{
            top: '100%',
            borderColor: 'var(--border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-raised)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索全部任务…"
            className="mb-1.5 px-2 py-1 outline-none"
            style={{
              fontSize: 'var(--font-12)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--text-primary)',
            }}
          />
          <div className="flex max-h-56 flex-col overflow-y-auto">
            <span className="px-1 py-0.5" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
              {q ? `搜索结果 ${list.length}` : '今日在办'}
            </span>
            {list.length === 0 && (
              <span className="px-1 py-1" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
                {q ? '没有匹配的任务' : '今天没有在办任务，可搜索或暂不归类'}
              </span>
            )}
            {list.map((o) => (
              <button
                key={o.taskId}
                type="button"
                onClick={() => choose({ goalId: o.goalId, taskId: o.taskId })}
                className="cursor-pointer truncate px-1 py-1 text-left"
                style={{
                  fontSize: 'var(--font-12)',
                  color: o.taskId === value.taskId ? 'var(--accent)' : 'var(--text-primary)',
                }}
              >
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {o.goalIcon} {o.goalName} ·{' '}
                </span>
                {o.taskName}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => choose({})}
            className="mt-1.5 cursor-pointer border-t px-1 pt-1.5 text-left"
            style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)', borderColor: 'var(--border-subtle)' }}
          >
            暂不归类（先开始，事后再归）
          </button>
        </div>
      )}
    </div>
  );
}
