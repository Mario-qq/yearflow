/**
 * 单目标打卡卡片（SPEC 第五节）：目标色条 + 图标名称 + 三个大按钮，点击即存（spring 微缩放）。
 * 任务级打卡：单任务目标沿用「状态按钮在卡头 + 展开分钟/备注」的原布局；多任务目标改为
 * 目标卡头 + 每个在办任务一行（各自状态/分钟/备注），互不覆盖。免打卡区间显示"休息中"。
 */
import { useEffect, useRef, useState } from 'react';
import type { CheckInStatus, Goal } from '../types/domain';
import type { DayGoalEntry, DayTaskEntry } from '../lib/derive';
import { goalColor } from '../lib/colors';
import { patchCheckIn, removeCheckIn, setCheckIn } from '../store/actions';

const MINUTE_CHIPS = [15, 30, 60, 90];

const STATUS_BUTTONS: { status: CheckInStatus; icon: string; label: string; color: string }[] = [
  { status: 'done', icon: '✓', label: '完成', color: 'var(--success)' },
  { status: 'partial', icon: '◐', label: '做了一点', color: 'var(--warning)' },
  { status: 'skipped', icon: '—', label: '跳过', color: 'var(--text-tertiary)' },
];

/** 按钮按下 spring 微缩放（Web Animations，自行守卫 reduced-motion） */
function springPress(el: HTMLElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.92)', offset: 0.35 },
      { transform: 'scale(1.04)', offset: 0.7 },
      { transform: 'scale(1)' },
    ],
    { duration: 280, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
  );
}

/**
 * 某任务的状态键（点击即存，再点同状态 = 取消该记录）。compact 用于多任务行内。
 * statuses 限定显示哪些键（随缘任务不显示"跳过"——无排期可跳）。
 */
export function StatusButtons({
  goalId,
  date,
  te,
  compact,
  statuses,
}: {
  goalId: string;
  date: string;
  te: DayTaskEntry;
  compact?: boolean;
  statuses?: CheckInStatus[];
}) {
  const pick = (status: CheckInStatus, el: HTMLElement) => {
    springPress(el);
    if (te.record && te.record.status === status) {
      removeCheckIn(te.record.id); // 再点一次同状态 = 取消该记录
    } else {
      setCheckIn({ goalId, date, status, taskId: te.taskId });
    }
  };
  const buttons = statuses
    ? STATUS_BUTTONS.filter((b) => statuses.includes(b.status))
    : STATUS_BUTTONS;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {buttons.map(({ status, icon, label, color }) => {
        const active = te.record?.status === status;
        return (
          <button
            key={status}
            type="button"
            onClick={(e) => pick(status, e.currentTarget)}
            className={`min-h-9 cursor-pointer px-3 transition-colors max-md:min-h-11 max-md:px-2.5${compact ? ' px-2.5' : ''}`}
            style={{
              fontSize: 'var(--font-13)',
              border: `1px solid ${active ? color : 'var(--border-default)'}`,
              borderRadius: 'var(--radius-md)',
              background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : 'var(--bg-panel)',
              color: active ? color : 'var(--text-secondary)',
              fontWeight: active ? 500 : 400,
            }}
            title={label}
          >
            <span aria-hidden>{icon}</span>
            <span className={compact ? 'ml-1 max-lg:hidden' : 'ml-1 max-md:hidden'}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 某任务的分钟 chips + 一句话备注编辑区（展开态显示）。 */
export function TaskEditor({ goalId, date, te }: { goalId: string; date: string; te: DayTaskEntry }) {
  const [customMin, setCustomMin] = useState('');
  const noteRef = useRef<HTMLInputElement>(null);
  const record = te.record;

  useEffect(() => {
    if (noteRef.current) noteRef.current.value = record?.note ?? '';
    setCustomMin('');
  }, [record?.id, record?.note, date]);

  const saveMinutes = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    if (record) {
      if (record.minutes === minutes) {
        patchCheckIn(record.id, { minutes: undefined }, `清除「${te.name}」时长`);
      } else {
        patchCheckIn(record.id, { minutes }, `记录「${te.name}」${minutes} 分钟`);
      }
    } else {
      setCheckIn({ goalId, date, status: 'done', taskId: te.taskId, minutes });
    }
  };

  const saveNote = () => {
    const note = noteRef.current?.value.trim() ?? '';
    if (record) {
      if ((record.note ?? '') === note) return;
      patchCheckIn(record.id, { note: note || undefined }, `更新「${te.name}」打卡备注`);
    } else if (note) {
      setCheckIn({ goalId, date, status: 'done', taskId: te.taskId, note });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>时长</span>
      {MINUTE_CHIPS.map((m) => {
        const active = record?.minutes === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => saveMinutes(m)}
            className="tnum cursor-pointer px-2 py-0.5 transition-colors"
            style={{
              fontSize: 'var(--font-12)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border-default)'}`,
              borderRadius: 999,
              background: active ? 'var(--accent-soft)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {m}分
          </button>
        );
      })}
      <input
        value={customMin}
        onChange={(e) => setCustomMin(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            saveMinutes(Number(customMin));
            setCustomMin('');
          }
        }}
        onBlur={() => {
          if (customMin) {
            saveMinutes(Number(customMin));
            setCustomMin('');
          }
        }}
        placeholder={record?.minutes && !MINUTE_CHIPS.includes(record.minutes) ? `${record.minutes}分` : '自定义'}
        className="tnum w-16 px-2 py-0.5 outline-none"
        style={{
          fontSize: 'var(--font-12)',
          border: '1px solid var(--border-default)',
          borderRadius: 999,
          background: 'transparent',
          color: 'var(--text-primary)',
        }}
      />
      <input
        ref={noteRef}
        defaultValue={record?.note ?? ''}
        onBlur={saveNote}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        }}
        placeholder="记一句话备注…"
        className="min-w-40 flex-1 px-2 py-1 outline-none"
        style={{
          fontSize: 'var(--font-12)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          color: 'var(--text-primary)',
        }}
      />
    </div>
  );
}

export function ExpandChevron({ open, onClick, title }: { open: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-9 cursor-pointer px-1.5 transition-transform max-md:min-h-11"
      style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-12)', transform: open ? 'rotate(180deg)' : 'none' }}
      title={title}
    >
      ▾
    </button>
  );
}

/** 多任务目标：单个任务一行（名称 + 状态键 + 展开分钟/备注）。 */
function TaskRow({ goalId, date, te }: { goalId: string; date: string; te: DayTaskEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="min-w-0 flex-1 truncate" style={{ fontSize: 'var(--font-13)' }}>
          {te.name}
        </span>
        {te.record?.minutes ? (
          <span className="tnum shrink-0" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            {te.record.minutes}分
          </span>
        ) : null}
        <StatusButtons goalId={goalId} date={date} te={te} compact />
        <ExpandChevron open={open} onClick={() => setOpen((v) => !v)} title={open ? '收起' : '展开分钟与备注'} />
      </div>
      {open && (
        <div className="px-3 pb-2.5">
          <TaskEditor goalId={goalId} date={date} te={te} />
        </div>
      )}
    </div>
  );
}

interface Props {
  goal: Goal;
  entry: DayGoalEntry;
  /** 当前 streak（仅今天显示 🔥） */
  streak?: number;
  date: string;
  /** 单任务目标：展开分钟/备注（多任务目标各行自管展开，忽略此项） */
  expanded: boolean;
  onToggleExpand: () => void;
}

export function GoalCheckCard({ goal, entry, streak, date, expanded, onToggleExpand }: Props) {
  const single = entry.taskEntries.length === 1 ? entry.taskEntries[0] : undefined;
  const multi = entry.taskEntries.length > 1;

  const clearLegacy = () => {
    if (entry.legacyRecord) removeCheckIn(entry.legacyRecord.id);
  };

  return (
    <div
      data-flip-id={goal.id}
      className="border"
      style={{
        borderColor: 'var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-panel)',
        borderLeft: `3px solid ${goalColor(goal.color)}`,
      }}
    >
      <div className="flex items-center gap-3 p-3">
        <span aria-hidden style={{ fontSize: 'var(--font-16)' }}>
          {goal.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{goal.name}</span>
            {streak !== undefined && streak > 0 && (
              <span className="tnum shrink-0" style={{ fontSize: 'var(--font-12)' }}>
                🔥 {streak}
              </span>
            )}
          </div>
          <div className="truncate" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            {entry.exempt
              ? `休息中${entry.exemptReason ? ` · ${entry.exemptReason}` : ''}`
              : multi
                ? `${entry.taskEntries.length} 个任务`
                : (single?.name ?? '')}
          </div>
        </div>

        {entry.exempt ? (
          <span
            className="shrink-0 px-2.5 py-1"
            style={{
              fontSize: 'var(--font-12)',
              color: 'var(--text-tertiary)',
              background: 'var(--bg-subtle)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            休息中
          </span>
        ) : (
          // 单任务：状态键在卡头 + 展开分钟/备注；多任务：卡头不放键，逐任务成行
          single && (
            <div className="flex shrink-0 items-center gap-1.5">
              <StatusButtons goalId={goal.id} date={date} te={single} />
              <ExpandChevron open={expanded} onClick={onToggleExpand} title={expanded ? '收起' : '展开分钟与备注'} />
            </div>
          )
        )}
      </div>

      {single && expanded && !entry.exempt && (
        <div className="border-t px-3 py-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
          <TaskEditor goalId={goal.id} date={date} te={single} />
        </div>
      )}

      {multi &&
        !entry.exempt &&
        entry.taskEntries.map((te) => <TaskRow key={te.taskId} goalId={goal.id} date={date} te={te} />)}

      {entry.legacyRecord && !entry.exempt && (
        <div
          className="flex items-center gap-2 border-t px-3 py-1.5"
          style={{ borderColor: 'var(--border-subtle)', fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
        >
          <span>
            旧记录（未分任务）
            {entry.legacyRecord.minutes ? ` · ${entry.legacyRecord.minutes}分` : ''}
          </span>
          <button
            type="button"
            onClick={clearLegacy}
            className="cursor-pointer underline underline-offset-2"
            style={{ color: 'var(--danger)' }}
            title="清除该旧记录（避免与任务级记录重复计时）"
          >
            清除
          </button>
        </div>
      )}
    </div>
  );
}
