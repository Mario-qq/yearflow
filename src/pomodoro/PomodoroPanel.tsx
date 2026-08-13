/**
 * 番茄钟面板（规格 §8.2）：320px，顶栏下拉（照 SyncIndicator 的 relative 父 + absolute 子）。
 *
 * ⚠️ hero 倒计时与进度环**都走 ref 直写**，与胶囊共用 ticker.ts 那一个 1s 单例。
 * 若按常规 setState 写，面板打开时就是每秒一次重渲；这个 state 若还放进 usePomodoroStore
 * （App 层也订阅它）会变成整棵 App 树每秒重渲，甘特图 60fps 门槛直接失守。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { todayStr } from '../lib/date';
import { isCountedSession, todayFocusMs, unassignedSessions } from '../lib/derive';
import { reassignFocusSession } from '../store/actions';
import { RING_CIRCUM, RING_R, RING_SIZE, RING_STROKE } from './constants';
import { humanMs, mmss } from './format';
import { discardFocus, pauseFocus, remainingMs, resumeFocus, stopFocus } from './kernel';
import { startPomodoro } from './api';
import { ResultCard } from './ResultCard';
import { usePomodoroStore } from './store';
import { subscribeTick } from './ticker';
import { TaskPicker } from './TaskPicker';
import type { FocusSel } from './useSelLabel';

const PANEL_W = 320;

const btn: React.CSSProperties = {
  fontSize: 'var(--font-13)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  padding: '5px 12px',
  cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  ...btn,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
};

export function PomodoroPanel({
  sel,
  onSel,
  onOpenHistory,
}: {
  sel: FocusSel;
  onSel: (next: FocusSel) => void;
  /** 打开「专注记录」对话框。状态放在胶囊里：对话框必须与面板同属 rootRef，否则点它就关面板 */
  onOpenHistory: () => void;
}) {
  const running = usePomodoroStore((s) => s.running);
  const cycleCompleted = usePomodoroStore((s) => s.cycleCompleted);
  const lastResult = usePomodoroStore((s) => s.lastResult);
  const pomodoro = useStore((s) => s.settings.pomodoro);
  const focusSessions = useStore((s) => s.focusSessions);
  const heroRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const [showUnassigned, setShowUnassigned] = useState(false);

  const today = todayStr();
  const { todayMs, todayCount, unassigned } = useMemo(() => {
    const list = Object.values(focusSessions);
    return {
      todayMs: todayFocusMs(list, today),
      todayCount: list.filter((s) => isCountedSession(s) && s.date === today).length,
      unassigned: unassignedSessions(list).sort((a, b) => (a.startAt < b.startAt ? 1 : -1)),
    };
  }, [focusSessions, today]);

  /** 唯一的绘制函数：hero 文本 + 进度环 dashoffset，全部 ref 直写，零重渲 */
  const paint = (msLeft: number): void => {
    const r = usePomodoroStore.getState().running;
    const total = r?.plannedMs ?? useStore.getState().settings.pomodoro.focusMin * 60_000;
    const left = r ? msLeft : total;
    if (heroRef.current) heroRef.current.textContent = mmss(left);
    if (ringRef.current) {
      const ratio = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0;
      ringRef.current.style.strokeDashoffset = String(RING_CIRCUM * ratio);
    }
  };

  // paint 只读 ref 与 getState，闭包稳定 ⇒ 订阅一次即可
  useEffect(() => subscribeTick(paint), []);
  // 每次重渲后补写一次：状态迁移（开始/暂停/结束）与设置改动都要立刻反映，不等下一个整秒
  useLayoutEffect(() => paint(remainingMs()));

  const phaseText = running
    ? running.phase === 'focus'
      ? `专注 · 第 ${Math.min(cycleCompleted + 1, pomodoro.longBreakEvery)}/${pomodoro.longBreakEvery} 段${running.paused ? ' · 已暂停' : ''}`
      : running.phase === 'shortBreak'
        ? '短休息'
        : '长休息'
    : `待开始 · 每 ${pomodoro.longBreakEvery} 段后长休息`;

  return (
    <div
      className="absolute right-0 z-50 mt-1 flex flex-col gap-3 border p-3"
      style={{
        top: '100%',
        width: PANEL_W,
        borderColor: 'var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-raised)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div className="flex items-center gap-3">
        <svg width={RING_SIZE} height={RING_SIZE} aria-hidden className="shrink-0">
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_R}
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth={RING_STROKE}
          />
          <circle
            ref={ringRef}
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_R}
            fill="none"
            stroke={running?.paused ? 'var(--warning)' : 'var(--accent)'}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUM}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        </svg>
        <div className="min-w-0 flex-1">
          {/* 零 children 的空元素：文本只由 ticker 经 ref 写入 */}
          <span
            ref={heroRef}
            className="tnum block leading-none"
            style={{
              fontSize: 'var(--font-32)',
              color: running ? (running.paused ? 'var(--warning)' : 'var(--accent)') : 'var(--text-primary)',
            }}
          />
          <span className="mt-1 block" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            {phaseText}
          </span>
        </div>
      </div>

      <TaskPicker
        value={running ? { goalId: running.goalId, taskId: running.taskId } : sel}
        onPick={(next) => {
          onSel(next);
          // 运行中换任务 = 结算旧段 + 立刻以新任务起一段（不做时间分摊）
          if (running?.phase === 'focus') startPomodoro(next);
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        {!running && (
          <button type="button" style={primaryBtn} onClick={() => startPomodoro(sel)}>
            开始专注
          </button>
        )}
        {running?.phase === 'focus' && !running.paused && (
          <button type="button" style={btn} onClick={pauseFocus}>
            暂停
          </button>
        )}
        {running?.phase === 'focus' && running.paused && (
          <button type="button" style={primaryBtn} onClick={resumeFocus}>
            继续
          </button>
        )}
        {running?.phase === 'focus' && (
          <button type="button" style={btn} onClick={stopFocus}>
            停止
          </button>
        )}
        {running && running.phase !== 'focus' && (
          <button type="button" style={btn} onClick={stopFocus}>
            跳过休息
          </button>
        )}
        {running?.phase === 'focus' && (
          <button
            type="button"
            onClick={discardFocus}
            className="ml-auto cursor-pointer"
            style={{ fontSize: 'var(--font-12)', color: 'var(--danger)' }}
            title="不记录这段（不足 1 分钟则直接不落库）"
          >
            丢弃
          </button>
        )}
      </div>

      {lastResult && !running && <ResultCard sessionId={lastResult.id} />}

      <div className="flex items-center gap-2" style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}>
        <span>
          今日 <span className="tnum">{todayMs > 0 ? humanMs(todayMs) : '0 分'}</span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            {' '}
            · <span className="tnum">{todayCount}</span> 段
          </span>
        </span>
        <button
          type="button"
          onClick={onOpenHistory}
          className="ml-auto cursor-pointer"
          style={{ fontSize: 'var(--font-12)', color: 'var(--accent)' }}
          title="回看 / 编辑 / 补录专注记录"
        >
          专注记录
        </button>
      </div>

      {unassigned.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setShowUnassigned((v) => !v)}
            className="cursor-pointer text-left"
            style={{ fontSize: 'var(--font-12)', color: 'var(--warning)' }}
          >
            <span className="tnum">{unassigned.length}</span> 段未归类 ·{' '}
            {showUnassigned ? '收起' : '去归类'}
          </button>
          {showUnassigned &&
            unassigned.slice(0, 8).map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <span
                  className="tnum shrink-0"
                  style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', width: 76 }}
                >
                  {s.date.slice(5)} · {humanMs(s.focusMs)}
                </span>
                <div className="min-w-0 flex-1">
                  <TaskPicker
                    compact
                    value={{ goalId: s.goalId, taskId: s.taskId }}
                    onPick={(next) => reassignFocusSession(s.id, next)}
                  />
                </div>
              </div>
            ))}
          {showUnassigned && unassigned.length > 8 && (
            <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
              另有 <span className="tnum">{unassigned.length - 8}</span> 段，归类完会继续列出
            </span>
          )}
        </div>
      )}
    </div>
  );
}
