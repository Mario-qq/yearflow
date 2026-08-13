/**
 * bar tooltip（SPEC 4.5）：任务名、日期范围与天数、进度、应打卡/已打卡/缺卡、
 * 当前 streak、基线偏移。portal 到 body（fixed，不受 scroller 裁剪与 sticky 铁律影响）。
 */
import { memo } from 'react';
import { createPortal } from 'react-dom';
import type { Task } from '../types/domain';
import { baselineDrift, type StreakResult, type TaskGantt } from '../lib/derive';
import { diffDays, toDay } from '../lib/date';
import { humanMs } from '../pomodoro/format';
import type { TooltipAnchor } from './hooks/useBarTooltip';
import { TOOLTIP_OFFSET as TIP_OFFSET, TOOLTIP_W as TIP_W } from './constants';

const STATUS_LABEL: Record<Task['status'], string> = {
  planned: '计划中',
  active: '进行中',
  done: '已完成',
  paused: '已暂停',
};

function fmtCn(date: string): string {
  const d = toDay(date);
  return `${d.month() + 1}月${d.date()}日`;
}

interface Props {
  anchor: TooltipAnchor;
  task: Task;
  tg: TaskGantt;
  streak: StreakResult;
  /**
   * 该任务当年的番茄实测毫秒（0 则不显示这一行）。
   * ⚠️ 走独立 prop 而不是塞进 TaskGantt：TaskGantt 产自 useGanttDerive，扩它等于把
   * focusSessions 塞进那个 hook 的输入 —— 正是规格 §七「性能约定」明令禁止的。
   */
  focusMs?: number;
}

export const BarTooltip = memo(function BarTooltip({ anchor, task, tg, streak, focusMs = 0 }: Props) {
  const days = diffDays(task.endDate, task.startDate) + 1;
  const drift = baselineDrift(task);
  const left = Math.min(anchor.x + TIP_OFFSET, window.innerWidth - TIP_W - TIP_OFFSET);
  const top = Math.min(anchor.y + TIP_OFFSET, window.innerHeight - 160);

  const rows: [string, string][] = [
    ['日期', `${fmtCn(task.startDate)} – ${fmtCn(task.endDate)} · ${days}天`],
    ['进度', `${tg.effectiveProgress}%（${STATUS_LABEL[task.status]}）`],
    ['打卡', `应打卡 ${tg.counts.scheduled} · 已打卡 ${tg.counts.checked} · 缺卡 ${tg.counts.missed}`],
    ['连续', `${streak.current} 天（最长 ${streak.longest} 天）`],
  ];
  if (focusMs > 0) rows.push(['专注', humanMs(focusMs)]);
  if (drift) {
    const n = drift.endDriftDays;
    rows.push(['偏移', n === 0 ? '与基线一致' : `${n > 0 ? '+' : ''}${n} 天`]);
  }

  return createPortal(
    <div
      className="tnum pointer-events-none fixed z-50"
      style={{
        left,
        top,
        width: TIP_W,
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        padding: 'var(--space-3)',
        fontSize: 'var(--font-12)',
        color: 'var(--text-secondary)',
      }}
    >
      <div
        className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold"
        style={{ fontSize: 'var(--font-13)', color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}
      >
        {task.name}
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2" style={{ lineHeight: 1.7 }}>
          <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
});
