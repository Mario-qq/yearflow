/**
 * 悬浮小窗的内容（portal 进 Document PiP 窗口的 body）。
 *
 * 与胶囊/面板同源的两条硬性约束：
 * · 倒计时走 ticker.ts 那一个 1s 单例 + ref 直写，绝不 setState —— 小窗常开，
 *   每秒重渲会把甘特图的 60fps 门槛拖下水（这是全站共用的一条铁律）。
 * · 所有「开始」入口走 api.ts，不直接调 kernel —— 那层负责在手势回调里 unlockAudio()。
 *   小窗里的点击是合法用户手势，AudioContext 能正常解锁。
 *
 * 到点提醒态是这个小窗存在的主要理由：页面被最小化时系统通知未必能送达
 * （权限、系统勿扰、页面被冻结都能吞掉它），而这个窗是真正的系统级窗口、浮在最上层，
 * 它自己变色就是最可靠的那一层提醒。
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { ALERT_TTL_MS } from './constants';
import { mmss } from './format';
import { discardFocus, pauseFocus, remainingMs, resumeFocus, startBreak, stopFocus } from './kernel';
import { startPomodoro } from './api';
import { readLastTask } from './running';
import { usePomodoroStore } from './store';
import { subscribeTick } from './ticker';
import { useSelLabel } from './useSelLabel';

const btn: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  color: 'var(--text-secondary)',
  padding: '4px 10px',
  cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  ...btn,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
};

export function PipView() {
  const running = usePomodoroStore((s) => s.running);
  const alert = usePomodoroStore((s) => s.alert);
  const cycleCompleted = usePomodoroStore((s) => s.cycleCompleted);
  const pomodoro = useStore((s) => s.settings.pomodoro);
  const timeRef = useRef<HTMLDivElement>(null);
  const owner = useSelLabel(running ?? readLastTask() ?? {});

  const paint = (msLeft: number): void => {
    if (!timeRef.current) return;
    const r = usePomodoroStore.getState().running;
    const total = useStore.getState().settings.pomodoro.focusMin * 60_000;
    timeRef.current.textContent = mmss(r ? msLeft : total);
  };
  useEffect(() => subscribeTick(paint), []);
  useLayoutEffect(() => paint(remainingMs()));

  // 提醒态自动消退：用户没在电脑前时它不该一直霸着小窗（与 title 闪烁同一口径）
  useEffect(() => {
    if (!alert) return;
    const t = setTimeout(() => usePomodoroStore.setState({ alert: null }), ALERT_TTL_MS);
    return () => clearTimeout(t);
  }, [alert]);

  const dismiss = (): void => usePomodoroStore.setState({ alert: null });

  if (alert) {
    const focusEnd = alert.kind === 'focusEnd';
    // 专注结束且已自动进了休息 ⇒ 只需确认；自动休息关着才给「开始休息」
    const breakRunning = running !== null && running.phase !== 'focus';
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center"
        style={{ background: focusEnd ? 'var(--accent)' : 'var(--success)', color: 'var(--text-on-accent)' }}
      >
        <div style={{ fontSize: 'var(--font-16)', lineHeight: 1.4 }}>{alert.text}</div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {focusEnd && !breakRunning && (
            <button
              type="button"
              style={{ ...btn, background: 'var(--bg-raised)', border: 'none' }}
              onClick={() => {
                dismiss();
                startBreak(
                  cycleCompleted > 0 && cycleCompleted % pomodoro.longBreakEvery === 0
                    ? 'longBreak'
                    : 'shortBreak',
                );
              }}
            >
              开始休息
            </button>
          )}
          {!focusEnd && (
            <button
              type="button"
              style={{ ...btn, background: 'var(--bg-raised)', border: 'none' }}
              onClick={() => {
                dismiss();
                startPomodoro(readLastTask() ?? {});
              }}
            >
              开始下一段专注
            </button>
          )}
          <button
            type="button"
            style={{ ...btn, background: 'transparent', border: '1px solid currentColor', color: 'inherit' }}
            onClick={dismiss}
          >
            知道了
          </button>
        </div>
      </div>
    );
  }

  const phaseText = running
    ? running.phase === 'focus'
      ? `专注 · 第 ${Math.min(cycleCompleted + 1, pomodoro.longBreakEvery)}/${pomodoro.longBreakEvery} 段${running.paused ? ' · 已暂停' : ''}`
      : running.phase === 'shortBreak'
        ? '短休息'
        : '长休息'
    : '待开始';

  const accent = running
    ? running.paused
      ? 'var(--warning)'
      : running.phase === 'focus'
        ? 'var(--accent)'
        : 'var(--text-secondary)'
    : 'var(--text-primary)';

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
      {/* 零 children 的空元素：文本只由 ticker 经 ref 写入，React 从不渲染它 */}
      <div ref={timeRef} className="tnum leading-none" style={{ fontSize: 'var(--font-32)', color: accent }} />
      <div style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>{phaseText}</div>
      <div
        className="max-w-full truncate"
        style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}
        title={owner.text}
      >
        {owner.text}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
        {!running && (
          <button type="button" style={primaryBtn} onClick={() => startPomodoro(readLastTask() ?? {})}>
            开始
          </button>
        )}
        {running?.phase === 'focus' && (
          <button
            type="button"
            style={running.paused ? primaryBtn : btn}
            onClick={running.paused ? resumeFocus : pauseFocus}
          >
            {running.paused ? '继续' : '暂停'}
          </button>
        )}
        {running && (
          <button type="button" style={btn} onClick={stopFocus}>
            {running.phase === 'focus' ? '停止' : '跳过休息'}
          </button>
        )}
        {running?.phase === 'focus' && (
          <button
            type="button"
            onClick={discardFocus}
            className="cursor-pointer"
            style={{ fontSize: 'var(--font-11)', color: 'var(--danger)' }}
            title="不记录这段"
          >
            丢弃
          </button>
        )}
      </div>
    </div>
  );
}
