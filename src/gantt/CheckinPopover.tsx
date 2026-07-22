/**
 * 打卡点就地 popover（SPEC 4.4）：状态按钮 + 分钟 chips + 一行备注 + 删除记录。
 * 点外部即关、Esc 即关（capture 拦截，不触发甘特的清除多选），操作即存。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CheckIn, CheckInStatus } from '../types/domain';
import { useStore } from '../store/useStore';
import { goalColor } from '../lib/colors';
import { toDay } from '../lib/date';
import { patchCheckIn, removeCheckIn, setCheckIn } from '../store/actions';
import { useGanttUi } from './uiStore';

const MINUTE_CHIPS = [10, 15, 30, 60];
const STATUS_RANK: Record<CheckInStatus, number> = { done: 3, partial: 2, skipped: 1 };

const STATUS_BUTTONS: { status: CheckInStatus; icon: string; label: string; color: string }[] = [
  { status: 'done', icon: '✓', label: '完成', color: 'var(--success)' },
  { status: 'partial', icon: '◐', label: '一点', color: 'var(--warning)' },
  { status: 'skipped', icon: '—', label: '跳过', color: 'var(--text-tertiary)' },
];

export function CheckinPopover() {
  const anchor = useGanttUi((s) => s.checkinPopover);
  const checkIns = useStore((s) => s.checkIns);
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const ref = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [customMin, setCustomMin] = useState('');

  // 当前记录：同目标同任务同日取最强（任务级口径；未分任务的旧记录仅当锚点也未指定任务时匹配）
  let record: CheckIn | undefined;
  if (anchor) {
    for (const c of Object.values(checkIns)) {
      if (c.deletedAt || c.goalId !== anchor.goalId || c.date !== anchor.date) continue;
      if ((c.taskId ?? undefined) !== (anchor.taskId ?? undefined)) continue;
      if (!record || STATUS_RANK[c.status] > STATUS_RANK[record.status]) record = c;
    }
  }
  const recordId = record?.id;
  const recordNote = record?.note;

  // 打开/换锚点时定位（clamp 到视口内）并同步备注
  useLayoutEffect(() => {
    if (!anchor || !ref.current) {
      setPos(null);
      return;
    }
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    let left = anchor.x - w / 2;
    let top = anchor.y + 12;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    if (top + h > window.innerHeight - 8) top = anchor.y - h - 12;
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    if (noteRef.current) noteRef.current.value = recordNote ?? '';
    setCustomMin('');
  }, [recordId, recordNote, anchor?.date, anchor?.goalId]);

  // 点外部即关 + Esc 即关（capture，早于甘特的 Esc 清多选）
  useEffect(() => {
    if (!anchor) return;
    const close = () => useGanttUi.getState().setCheckinPopover(null);
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor]);

  if (!anchor) return null;
  const goal = goals[anchor.goalId];
  if (!goal) return null;
  const task = anchor.taskId ? tasks[anchor.taskId] : undefined;
  const d = toDay(anchor.date);

  const pick = (status: CheckInStatus) => {
    if (record && record.status === status) removeCheckIn(record.id);
    else setCheckIn({ goalId: anchor.goalId, date: anchor.date, status, taskId: anchor.taskId });
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
      setCheckIn({ goalId: anchor.goalId, date: anchor.date, status: 'done', taskId: anchor.taskId, minutes });
    }
  };

  const saveNote = () => {
    const note = noteRef.current?.value.trim() ?? '';
    if (record) {
      if ((record.note ?? '') === note) return;
      patchCheckIn(record.id, { note: note || undefined }, `更新「${goal.name}」打卡备注`);
    } else if (note) {
      setCheckIn({ goalId: anchor.goalId, date: anchor.date, status: 'done', taskId: anchor.taskId, note });
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 flex w-64 flex-col gap-2 border p-3"
      style={{
        left: pos?.left ?? anchor.x,
        top: pos?.top ?? anchor.y,
        visibility: pos ? 'visible' : 'hidden',
        borderColor: 'var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-raised)',
        boxShadow: 'var(--shadow-lg)',
      }}
      role="dialog"
      aria-label="打卡"
    >
      <div className="flex items-center gap-1.5" style={{ fontSize: 'var(--font-12)' }}>
        <span
          className="inline-block h-2 w-2 shrink-0"
          style={{ background: goalColor(goal.color), borderRadius: 999 }}
          aria-hidden
        />
        <span className="tnum" style={{ color: 'var(--text-secondary)' }}>
          {d.month() + 1}月{d.date()}日
        </span>
        <span className="truncate" style={{ color: 'var(--text-tertiary)' }}>
          {goal.name}
          {task ? ` · ${task.name}` : ''}
        </span>
      </div>

      <div className="flex gap-1.5">
        {STATUS_BUTTONS.map(({ status, icon, label, color }) => {
          const active = record?.status === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => pick(status)}
              className="flex-1 cursor-pointer py-1.5 transition-colors"
              style={{
                fontSize: 'var(--font-12)',
                border: `1px solid ${active ? color : 'var(--border-default)'}`,
                borderRadius: 'var(--radius-md)',
                background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
                color: active ? color : 'var(--text-secondary)',
                fontWeight: active ? 500 : 400,
              }}
            >
              <span aria-hidden>{icon}</span> {label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {MINUTE_CHIPS.map((m) => {
          const active = record?.minutes === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => saveMinutes(m)}
              className="tnum cursor-pointer px-2 py-0.5 transition-colors"
              style={{
                fontSize: 'var(--font-11)',
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
          placeholder={
            record?.minutes && !MINUTE_CHIPS.includes(record.minutes) ? `${record.minutes}分` : '自定义'
          }
          className="tnum w-14 px-1.5 py-0.5 outline-none"
          style={{
            fontSize: 'var(--font-11)',
            border: '1px solid var(--border-default)',
            borderRadius: 999,
            background: 'transparent',
            color: 'var(--text-primary)',
          }}
        />
      </div>

      <input
        ref={noteRef}
        defaultValue={recordNote ?? ''}
        onBlur={saveNote}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        }}
        placeholder="记一句话备注…"
        className="w-full px-2 py-1 outline-none"
        style={{
          fontSize: 'var(--font-12)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          color: 'var(--text-primary)',
        }}
      />

      {record && (
        <button
          type="button"
          onClick={() => removeCheckIn(record.id)}
          className="self-start cursor-pointer"
          style={{ fontSize: 'var(--font-12)', color: 'var(--danger)' }}
        >
          删除记录
        </button>
      )}
    </div>,
    document.body,
  );
}
