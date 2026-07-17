/**
 * 单目标打卡卡片（SPEC 第五节）：目标色条 + 图标名称 + 关联任务名 + 三个大按钮，
 * 点击即存（spring 微缩放）；可展开分钟 chips + 一句话备注；免打卡区间显示"休息中"。
 */
import { useEffect, useRef, useState } from 'react';
import type { CheckIn, CheckInStatus, Goal, Task } from '../types/domain';
import type { DayGoalEntry } from '../lib/derive';
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

interface Props {
  goal: Goal;
  entry: DayGoalEntry;
  dueTasks: Task[];
  record?: CheckIn;
  /** 当前 streak（仅今天显示 🔥） */
  streak?: number;
  date: string;
  expanded: boolean;
  onToggleExpand: () => void;
}

export function GoalCheckCard({
  goal,
  entry,
  dueTasks,
  record,
  streak,
  date,
  expanded,
  onToggleExpand,
}: Props) {
  const [customMin, setCustomMin] = useState('');
  const noteRef = useRef<HTMLInputElement>(null);

  // 切换日期/记录变化时同步备注输入（uncontrolled，保输入焦点）
  useEffect(() => {
    if (noteRef.current) noteRef.current.value = record?.note ?? '';
    setCustomMin('');
  }, [record?.id, record?.note, date]);

  const taskId = entry.dueTaskIds.length === 1 ? entry.dueTaskIds[0] : undefined;

  const pick = (status: CheckInStatus, el: HTMLElement) => {
    springPress(el);
    if (record && record.status === status) {
      removeCheckIn(record.id); // 再点一次同状态 = 取消该记录
    } else {
      setCheckIn({ goalId: goal.id, date, status, taskId });
    }
  };

  const saveMinutes = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    if (record) {
      if (record.minutes === minutes) {
        patchCheckIn(record.id, { minutes: undefined }, `清除「${goal.name}」时长`);
      } else {
        patchCheckIn(record.id, { minutes }, `记录「${goal.name}」${minutes} 分钟`);
      }
    } else {
      setCheckIn({ goalId: goal.id, date, status: 'done', taskId, minutes });
    }
  };

  const saveNote = () => {
    const note = noteRef.current?.value.trim() ?? '';
    if (record) {
      if ((record.note ?? '') === note) return;
      patchCheckIn(record.id, { note: note || undefined }, `更新「${goal.name}」打卡备注`);
    } else if (note) {
      setCheckIn({ goalId: goal.id, date, status: 'done', taskId, note });
    }
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
          <div
            className="truncate"
            style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
          >
            {entry.exempt
              ? `休息中${entry.exemptReason ? ` · ${entry.exemptReason}` : ''}`
              : dueTasks.map((t) => t.name).join(' · ')}
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
          <div className="flex shrink-0 items-center gap-1.5">
            {STATUS_BUTTONS.map(({ status, icon, label, color }) => {
              const active = record?.status === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={(e) => pick(status, e.currentTarget)}
                  className="min-h-9 cursor-pointer px-3 transition-colors max-md:min-h-11 max-md:px-2.5"
                  style={{
                    fontSize: 'var(--font-13)',
                    border: `1px solid ${active ? color : 'var(--border-default)'}`,
                    borderRadius: 'var(--radius-md)',
                    background: active
                      ? `color-mix(in srgb, ${color} 14%, transparent)`
                      : 'var(--bg-panel)',
                    color: active ? color : 'var(--text-secondary)',
                    fontWeight: active ? 500 : 400,
                  }}
                  title={label}
                >
                  <span aria-hidden>{icon}</span>
                  <span className="ml-1 max-md:hidden">{label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={onToggleExpand}
              className="min-h-9 cursor-pointer px-1.5 transition-transform max-md:min-h-11"
              style={{
                color: 'var(--text-tertiary)',
                fontSize: 'var(--font-12)',
                transform: expanded ? 'rotate(180deg)' : 'none',
              }}
              title={expanded ? '收起' : '展开分钟与备注'}
            >
              ▾
            </button>
          </div>
        )}
      </div>

      {expanded && !entry.exempt && (
        <div
          className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
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
            placeholder={
              record?.minutes && !MINUTE_CHIPS.includes(record.minutes)
                ? `${record.minutes}分`
                : '自定义'
            }
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
      )}
    </div>
  );
}
