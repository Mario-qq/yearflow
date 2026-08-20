/**
 * 悬浮小窗的内容（portal 进 Document PiP 窗口的 body）。
 *
 * 与胶囊/面板同源的两条硬性约束：
 * · 倒计时走 ticker.ts 那一个 1s 单例 + ref 直写，绝不 setState —— 小窗常开，
 *   每秒重渲会把甘特图的 60fps 门槛拖下水（这是全站共用的一条铁律）。底部进度线
 *   同样只改 transform，和倒计时挤在同一个 paint 里。
 * · 所有「开始」入口走 api.ts，不直接调 kernel —— 那层负责在手势回调里 unlockAudio()。
 *   小窗里的点击是合法用户手势，AudioContext 能正常解锁。
 *
 * 到点提醒态是这个小窗存在的主要理由：页面被最小化时系统通知未必能送达
 * （权限、系统勿扰、页面被冻结都能吞掉它），而这个窗是真正的系统级窗口、浮在最上层，
 * 它自己变脸就是最可靠的那一层提醒。
 *
 * 版式：Chromium（Chrome/Edge 同内核）给 Document PiP 画的系统标题栏只显示站点来源、
 * 网页无权改写，所以阶段文案（专注 / 已暂停 / 第几段）由**窗内自绘的顶栏**承载；
 * 任务名与「丢弃」不在小窗露出（丢弃仍在主面板 PomodoroPanel）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import { todayStr } from '../lib/date';
import { isDesktop } from '../lib/desktop';
import { isCountedSession, todayFocusMs } from '../lib/derive';
import { startPomodoro } from './api';
import { burstConfetti } from './confetti';
import {
  ALERT_TTL_MS,
  PIP_BTN_GHOST,
  PIP_BTN_PRIMARY,
  PIP_ICON,
  PIP_PROGRESS_H,
  PIP_SEG_DOT,
  PIP_STAMP,
  PIP_TOPBAR_H,
} from './constants';
import { humanMs, mmss } from './format';
import { pauseFocus, remainingMs, resumeFocus, setAlert, startBreak, stopFocus } from './kernel';
import './pip.css';
import { readLastTask } from './running';
import { usePomodoroStore } from './store';
import { subscribeTick } from './ticker';

type IconKind = 'play' | 'pause' | 'stop' | 'skip' | 'cup' | 'close';

/** 手写内联 SVG（仓内无图标库，照进度环/甘特连线的既有做法）。一律 currentColor */
function Icon({ kind }: { kind: IconKind }): React.ReactElement {
  const box = { width: PIP_ICON, height: PIP_ICON, viewBox: '0 0 14 14' } as const;
  switch (kind) {
    case 'play':
      return (
        <svg {...box} fill="currentColor" aria-hidden>
          <path d="M4.2 2.4a.7.7 0 0 1 1.06-.6l6.1 4.6a.7.7 0 0 1 0 1.2l-6.1 4.6a.7.7 0 0 1-1.06-.6V2.4Z" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...box} fill="currentColor" aria-hidden>
          <rect x="3" y="2.5" width="3" height="9" rx="1.2" />
          <rect x="8" y="2.5" width="3" height="9" rx="1.2" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...box} fill="currentColor" aria-hidden>
          <rect x="2.6" y="2.6" width="8.8" height="8.8" rx="2" />
        </svg>
      );
    case 'skip':
      return (
        <svg {...box} fill="currentColor" aria-hidden>
          <path d="M3 2.9a.7.7 0 0 1 1.07-.6l5.1 3.5a.7.7 0 0 1 0 1.15l-5.1 3.5A.7.7 0 0 1 3 9.85V2.9Z" />
          <rect x="10" y="2.5" width="2.2" height="9" rx="1" />
        </svg>
      );
    case 'cup':
      return (
        <svg
          {...box}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2.4 5.4h7.2v3.4a2.8 2.8 0 0 1-2.8 2.8H5.2a2.8 2.8 0 0 1-2.8-2.8V5.4Z" />
          <path d="M9.6 6.2h1.2a1.5 1.5 0 0 1 0 3H9.6" />
          <path d="M4.6 3.4v-1M7 3.4v-1" />
        </svg>
      );
    case 'close':
      return (
        <svg {...box} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
          <path d="M3.6 3.6 10.4 10.4M10.4 3.6 3.6 10.4" />
        </svg>
      );
  }
}

/** 图标按钮：没有文字 ⇒ aria-label 与 title 是必需项，不是可选装饰 */
function IconButton({
  kind,
  variant,
  label,
  onClick,
}: {
  kind: IconKind;
  variant: 'primary' | 'ghost';
  label: string;
  onClick: () => void;
}): React.ReactElement {
  const size = variant === 'primary' ? PIP_BTN_PRIMARY : PIP_BTN_GHOST;
  return (
    <button
      type="button"
      className={`pip-btn pip-btn--${variant}`}
      style={{ width: size, height: size }}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon kind={kind} />
    </button>
  );
}

/** 顶栏右侧的段点：已完成实心 / 当前描边 / 未来空心 —— 把「第 3/4 段」变成一眼可读的形 */
function Segs({
  total,
  done,
  current,
}: {
  total: number;
  done: number;
  current: number;
}): React.ReactElement {
  return (
    <div className="pip-segs">
      {Array.from({ length: total }, (_, i) => (
        <i
          key={i}
          className={`pip-seg${i < done ? ' pip-seg--done' : ''}${i === current ? ' pip-seg--now' : ''}`}
          style={{ width: PIP_SEG_DOT, height: PIP_SEG_DOT }}
        />
      ))}
    </div>
  );
}

export function PipView() {
  const running = usePomodoroStore((s) => s.running);
  const alert = usePomodoroStore((s) => s.alert);
  const lastResult = usePomodoroStore((s) => s.lastResult);
  const cycleCompleted = usePomodoroStore((s) => s.cycleCompleted);
  const pipHost = usePomodoroStore((s) => s.pipHost);
  const pomodoro = useStore((s) => s.settings.pomodoro);
  const focusSessions = useStore((s) => s.focusSessions);
  const timeRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** 唯一的绘制函数：hero 文本 + 进度线 scaleX，全部 ref 直写，零重渲 */
  const paint = (msLeft: number): void => {
    const r = usePomodoroStore.getState().running;
    const total = r?.plannedMs ?? useStore.getState().settings.pomodoro.focusMin * 60_000;
    const left = r ? msLeft : total;
    if (timeRef.current) timeRef.current.textContent = mmss(left);
    if (fillRef.current) {
      const elapsed = total > 0 ? Math.min(1, Math.max(0, 1 - left / total)) : 0;
      fillRef.current.style.transform = `scaleX(${elapsed})`;
    }
  };
  useEffect(() => subscribeTick(paint), []);
  useLayoutEffect(() => paint(remainingMs()));

  // 提醒态自动消退：用户没在电脑前时它不该一直霸着小窗（与 title 闪烁同一口径）
  useEffect(() => {
    if (!alert) return;
    const t = setTimeout(() => setAlert(null), ALERT_TTL_MS);
    return () => clearTimeout(t);
  }, [alert]);

  // 每次到点撒一次纸屑；提醒被点掉 / 超时消退时连同 rAF 一起取消
  useEffect(() => {
    if (!alert || !canvasRef.current) return;
    return burstConfetti(canvasRef.current);
  }, [alert]);

  const today = todayStr();
  const { todayMs, todayCount } = useMemo(() => {
    const list = Object.values(focusSessions);
    return {
      todayMs: todayFocusMs(list, today),
      todayCount: list.filter((s) => isCountedSession(s) && s.date === today).length,
    };
  }, [focusSessions, today]);

  const segTotal = pomodoro.longBreakEvery;
  const segDone = Math.min(cycleCompleted, segTotal);
  const phaseText = running
    ? running.phase === 'focus'
      ? running.paused
        ? '已暂停'
        : '专注'
      : running.phase === 'shortBreak'
        ? '短休息'
        : '长休息'
    : '待开始';

  // 小窗标题：系统标题栏只显示站点来源、改不动，但任务栏/Alt-Tab 有机会取 title。
  // 成本一行；取不到也不影响窗内那条自绘顶栏，那才是阶段文案的可靠出口。
  useEffect(() => {
    // 桌面版没有 portal 宿主：这棵树本身就长在小窗的 document 里
    const doc = pipHost?.ownerDocument ?? (isDesktop() ? document : null);
    if (!doc) return;
    doc.title = alert
      ? alert.text
      : `${phaseText} · 第 ${Math.min(segDone + 1, segTotal)}/${segTotal} 段`;
  }, [pipHost, alert, phaseText, segDone, segTotal]);

  const dismiss = (): void => setAlert(null);

  if (alert) {
    const focusEnd = alert.kind === 'focusEnd';
    // 专注结束且已自动进了休息 ⇒ 只需确认；自动休息关着才给「开始休息」
    const breakRunning = running !== null && running.phase !== 'focus';
    const settled = lastResult?.outcome === 'completed' ? lastResult : null;
    const headline = focusEnd
      ? settled
        ? `专注 ${humanMs(settled.focusMs)}`
        : alert.text
      : `接第 ${Math.min(segDone + 1, segTotal)} 段`;
    const sub =
      focusEnd && breakRunning && running
        ? `休息 ${Math.round(running.plannedMs / 60_000)} 分钟已开始`
        : `今日 ${todayCount} 段 · ${todayMs > 0 ? humanMs(todayMs) : '0 分'}`;

    return (
      // ⚠️ key 必须与运行态那棵树不同：两棵树的根都是 div，不给 key 时 React 会**复用**同一批
      // DOM 节点，而 hero 的文本是 ticker 经 ref 直写的、React 不知情 ⇒ 复用后「25:00」会
      // 残留在印章位置上。给不同 key 强制卸载重挂，顺带让入场动效每次到点都重新播一遍。
      <div
        key="celebrate"
        className="pip-celebrate"
        data-kind={alert.kind}
        style={{ ['--pip-phase-color' as string]: focusEnd ? 'var(--accent)' : 'var(--success)' }}
      >
        <div className="pip-bar" style={{ height: PIP_TOPBAR_H }}>
          <span className="pip-phase">
            {focusEnd ? (segDone > 0 ? `第 ${segDone} 段完成` : '专注完成') : '休息结束'}
          </span>
          <Segs total={segTotal} done={segDone} current={-1} />
        </div>

        <div className="pip-body">
          <div className="pip-stamp" style={{ width: PIP_STAMP, height: PIP_STAMP }}>
            <i className="pip-halo" />
            <svg width={PIP_STAMP} height={PIP_STAMP} viewBox="0 0 40 40" aria-hidden>
              <circle className="pip-ring" cx="20" cy="20" r="18" />
              {/* 休息结束不是「完成」而是「接力」，所以是向前的箭头，不是打勾 */}
              <path
                className="pip-tick"
                d={focusEnd ? 'M13 20.5 18 25.5 27.5 15' : 'M15 13.5 22.5 20 15 26.5'}
              />
            </svg>
          </div>
          <div className="pip-headline">{headline}</div>
          <div className="pip-sub tnum">{sub}</div>
        </div>

        <div className="pip-controls">
          {focusEnd && !breakRunning && (
            <IconButton
              kind="cup"
              variant="primary"
              label="开始休息"
              onClick={() => {
                dismiss();
                startBreak(
                  cycleCompleted > 0 && cycleCompleted % pomodoro.longBreakEvery === 0
                    ? 'longBreak'
                    : 'shortBreak',
                );
              }}
            />
          )}
          {!focusEnd && (
            <IconButton
              kind="play"
              variant="primary"
              label="开始下一段专注"
              onClick={() => {
                dismiss();
                startPomodoro(readLastTask() ?? {});
              }}
            />
          )}
          <IconButton kind="close" variant="ghost" label="知道了" onClick={dismiss} />
        </div>

        <canvas ref={canvasRef} className="pip-confetti" />
      </div>
    );
  }

  const phaseColor = running
    ? running.paused
      ? 'var(--warning)'
      : running.phase === 'focus'
        ? 'var(--accent)'
        : 'var(--success)'
    : 'var(--text-tertiary)';

  return (
    <div
      key="running"
      className="relative flex h-full flex-col"
      style={{
        ['--pip-phase-color' as string]: phaseColor,
        ['--pip-action-color' as string]: running ? phaseColor : 'var(--accent)',
      }}
    >
      <div className="pip-bar" style={{ height: PIP_TOPBAR_H }}>
        <span className="pip-phase">
          <i className="pip-dot" />
          {phaseText}
        </span>
        <Segs
          total={segTotal}
          done={segDone}
          current={running?.phase === 'focus' ? Math.min(segDone, segTotal - 1) : -1}
        />
      </div>

      <div className="pip-hero">
        {/* 零 children 的空元素：文本只由 ticker 经 ref 写入，React 从不渲染它 */}
        <div ref={timeRef} className={`pip-time tnum${running && !running.paused ? '' : ' pip-time--muted'}`} />
      </div>

      <div className="pip-controls">
        {!running && (
          <IconButton
            kind="play"
            variant="primary"
            label="开始专注"
            onClick={() => startPomodoro(readLastTask() ?? {})}
          />
        )}
        {running?.phase === 'focus' && (
          <IconButton
            kind={running.paused ? 'play' : 'pause'}
            variant="primary"
            label={running.paused ? '继续' : '暂停'}
            onClick={running.paused ? resumeFocus : pauseFocus}
          />
        )}
        {running?.phase === 'focus' && (
          <IconButton kind="stop" variant="ghost" label="停止" onClick={stopFocus} />
        )}
        {/* 休息阶段只有一个动作：kernel.pauseFocus 对休息是空操作，别摆一颗点了没反应的按钮 */}
        {running && running.phase !== 'focus' && (
          <IconButton kind="skip" variant="primary" label="跳过休息" onClick={stopFocus} />
        )}
      </div>

      <div className="pip-track" style={{ height: PIP_PROGRESS_H }}>
        <div ref={fillRef} className="pip-fill" style={{ transform: 'scaleX(0)' }} />
      </div>
    </div>
  );
}
