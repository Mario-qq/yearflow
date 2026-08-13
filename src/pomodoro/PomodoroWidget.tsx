/**
 * 顶栏番茄胶囊 —— 主形态、常驻（规格 §8.1）。插在 SyncIndicator 之前，
 * 那是全站唯一未被占用的常驻位（左下 Toasts / 底部 BulkBar+MiniMap / 右侧 TaskDrawer /
 * 顶栏中间 GanttToolbar 都已占满）。
 *
 * ⚠️ 倒计时必须**直写 DOM**，零 React 重渲：若每秒 setState，甘特页每秒重渲一次会直接
 * 违反「拖拽 60fps / 缩放 <150ms」门槛。承载元素是**零 children 的空 span**，文本只由
 * ticker 经 ref 写入；App 每次重渲（主题切换、命令面板、hydrate）后由 layout effect 补写一次。
 *
 * 移动端（<768px）不渲染任何番茄入口，但**计时照常跑** —— 内核是模块单例，与本组件的
 * 挂载/卸载无关（窗口被拖窄再拉宽能无缝接上，不会弹莫名的结算对话）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsMobile } from '../lib/useIsMobile';
import { showToast } from '../lib/toast';
import { handleChime } from './chime';
import { humanMs, mmss } from './format';
import {
  remainingMs,
  resolveAsk,
  setChimeHandler,
  stopFocus,
} from './kernel';
import { togglePomodoroFromGesture } from './api';
import { PomodoroPanel } from './PomodoroPanel';
import { readLastTask } from './running';
import { usePomodoroStore, type AskState } from './store';
import { subscribeTick } from './ticker';
import { initTitle } from './title';
import { useSelLabel, type FocusSel } from './useSelLabel';

export function PomodoroWidget() {
  const isMobile = useIsMobile();
  if (isMobile) return null;
  return <PomodoroCapsule />;
}

/** 结算对话（§5.5 第 4 行）：失联超过 90 秒且未到点时唯一会打扰用户的地方 */
function AskDialog({ ask }: { ask: AskState }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div
        className="flex w-80 flex-col gap-2 border p-4"
        style={{
          borderColor: 'var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-raised)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <h2 className="font-medium" style={{ fontSize: 'var(--font-14)' }}>
          刚才这段专注要算吗？
        </h2>
        <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}>
          页面失联了一段时间（休眠 / 关标签 / 崩溃）。到最后一次记录为止，这段净专注{' '}
          <span className="tnum">{humanMs(ask.focusMs)}</span>。
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => resolveAsk('keep')}
            className="cursor-pointer px-3 py-1"
            style={{
              fontSize: 'var(--font-13)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent)',
              color: 'var(--text-on-accent)',
            }}
          >
            算到刚才 <span className="tnum">{humanMs(ask.focusMs)}</span>
          </button>
          <button
            type="button"
            onClick={() => resolveAsk('continue')}
            className="cursor-pointer px-3 py-1"
            style={{
              fontSize: 'var(--font-13)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-panel)',
            }}
          >
            继续跑
          </button>
          <button
            type="button"
            onClick={() => resolveAsk('discard')}
            className="ml-auto cursor-pointer"
            style={{ fontSize: 'var(--font-12)', color: 'var(--danger)' }}
          >
            丢弃
          </button>
        </div>
      </div>
    </div>
  );
}

const CAPSULE: Record<'idle' | 'focus' | 'paused' | 'break', { icon: string; color: string; bg: string }> = {
  idle: { icon: '🍅', color: 'var(--text-secondary)', bg: 'var(--bg-panel)' },
  focus: { icon: '🍅', color: 'var(--accent)', bg: 'var(--accent-soft)' },
  paused: { icon: '⏸', color: 'var(--warning)', bg: 'var(--bg-panel)' },
  break: { icon: '☕', color: 'var(--text-secondary)', bg: 'var(--bg-panel)' },
};

function PomodoroCapsule() {
  const running = usePomodoroStore((s) => s.running);
  const notice = usePomodoroStore((s) => s.notice);
  const ask = usePomodoroStore((s) => s.ask);
  const lastResult = usePomodoroStore((s) => s.lastResult);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<FocusSel>(() => readLastTask() ?? {});
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tickRef = useRef<HTMLSpanElement>(null);
  const ownerLabel = useSelLabel(running ? { goalId: running.goalId, taskId: running.taskId } : sel);

  // 响铃/通知由内核在**落库之后**回调（音频异常绝不允许阻断数据写入）
  useEffect(() => {
    setChimeHandler(handleChime);
    return () => setChimeHandler(null);
  }, []);

  // 标签页标题倒计时/闪烁；返回的清理函数会 restoreTitle（卸载那一处调用点）
  useEffect(() => initTitle(), []);

  /**
   * 任何来源起的一段专注都要把选择同步回面板（打卡页 ▶、快捷键、另一个标签）。
   * 少了这条：从打卡页 ▶ 起跑，这段结束后面板又显示「暂不归类」，再按 P 就起了一段没归属的。
   */
  useEffect(() => {
    if (running?.goalId) setSel({ goalId: running.goalId, taskId: running.taskId });
  }, [running?.sessionId, running?.goalId, running?.taskId]);

  // 内核的一句轻提示（如「这段不足 1 分钟，未记录」）转成 toast，消费后清空
  useEffect(() => {
    if (!notice) return;
    showToast(notice);
    usePomodoroStore.setState({ notice: null });
  }, [notice]);

  // 倒计时直写：ticker 每秒一次，layout effect 在每次重渲后补一次
  useEffect(
    () =>
      subscribeTick((ms) => {
        if (tickRef.current) tickRef.current.textContent = mmss(ms);
      }),
    [],
  );
  useLayoutEffect(() => {
    if (tickRef.current) tickRef.current.textContent = mmss(remainingMs());
  });

  // 面板关着时结算：胶囊脉冲一次即可，不强行弹窗（规格 §8.3）
  useEffect(() => {
    if (!lastResult || open || !btnRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    btnRef.current.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.08)', offset: 0.4 },
        { transform: 'scale(1)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
    );
  }, [lastResult, open]);

  // 点外部关闭（Esc 不参与：全仓 9 个消费者互相竞争 capture 顺序，见 §8.5）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  /**
   * P = 开始/暂停，Shift+P = 停止。
   * typing 守卫照 App.tsx 的写法，并**补上 SELECT** —— 现有守卫不挡 <select>，
   * 在设置页的下拉里按 P 做 type-ahead 会顺手起一个番茄。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key !== 'p') return;
      e.preventDefault();
      if (e.shiftKey) stopFocus();
      else togglePomodoroFromGesture(sel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const kind = !running ? 'idle' : running.phase !== 'focus' ? 'break' : running.paused ? 'paused' : 'focus';
  const look = CAPSULE[kind];

  return (
    <div ref={rootRef} className="relative max-md:hidden">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 cursor-pointer items-center gap-1 px-2"
        style={{
          fontSize: 'var(--font-13)',
          color: look.color,
          border: `1px solid ${running ? look.color : 'var(--border-default)'}`,
          borderRadius: 'var(--radius-sm)',
          background: look.bg,
        }}
        title={running ? `番茄钟：${ownerLabel.text}（P 暂停 / Shift+P 停止）` : '番茄钟（P 开始专注）'}
        aria-label="番茄钟"
      >
        <span aria-hidden>{look.icon}</span>
        {/* 空元素：文本只由 ticker 经 ref 写入，React 从不渲染它的 children */}
        {running && <span ref={tickRef} className="tnum" />}
      </button>
      {open && <PomodoroPanel sel={sel} onSel={setSel} />}
      {ask && <AskDialog ask={ask} />}
    </div>
  );
}
