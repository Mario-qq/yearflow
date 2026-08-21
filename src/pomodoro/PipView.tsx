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
 * 版式（116×76，约原 260×172 的 20%）：常态只有 mm:ss + 底部进度线，**别的一律不显示**——
 * 这个窗常年浮在别的软件上面，占屏就是它唯一的成本。顶行（阶段点 / 事项名 / 收起）与控制行
 * 收进一层 `.pip-overlay`，鼠标移入才浮出，窗口尺寸全程不变。
 *
 * ⚠️ 浮层是**条件挂载**而不是 CSS :hover 切透明度：`-webkit-app-region` 是原生 hit-test，
 * 与 opacity / pointer-events 无关 —— 常挂一层带 no-drag 按钮的浮层，会在收起状态下留下
 * 一片「既拖不动窗、也点不到东西」的死区（自动化点击测不出来，它绕过原生 hit-test）。
 * 所以整个小窗默认 drag，可交互元素只在浮出期间存在。
 *
 * Chromium 给 Document PiP 画的系统标题栏只显示站点来源、网页无权改写，所以阶段信息只能
 * 自己画；任务名与「丢弃」的完整入口仍在主面板 PomodoroPanel。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { todayStr } from '../lib/date';
import { desktop, isDesktop } from '../lib/desktop';
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
import { humanMs } from './format';
import { pauseFocus, resumeFocus, setAlert, startBreak, stopFocus } from './kernel';
import './pip.css';
import { readLastTask, writeLastTask } from './running';
import { PipTaskPicker } from './PipTaskPicker';
import { useSelLabel, type FocusSel } from './useSelLabel';
import { usePomodoroStore } from './store';
import { usePipPaint } from './usePipPaint';

type IconKind = 'play' | 'pause' | 'stop' | 'skip' | 'cup' | 'close' | 'dock';

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
    case 'dock':
      // 箭头撞向一条边 —— 「收到屏幕边上去」的字面画法
      return (
        <svg {...box} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 2.4v6.2M4.4 6.2 7 8.8l2.6-2.6" />
          <path d="M2.6 11.4h8.8" />
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

/**
 * @param docked 已吸附在屏幕边缘（此刻是 hover 临时展开的 peek 态）。
 *   此时那颗按钮的语义反转成「脱离边缘」，否则用户在展开态里没有任何退路 ——
 *   药丸本身是纯拖动区，点不出菜单来。
 */
export function PipView({ docked = false }: { docked?: boolean } = {}) {
  const running = usePomodoroStore((s) => s.running);
  const alert = usePomodoroStore((s) => s.alert);
  const lastResult = usePomodoroStore((s) => s.lastResult);
  const cycleCompleted = usePomodoroStore((s) => s.cycleCompleted);
  const pipHost = usePomodoroStore((s) => s.pipHost);
  const pomodoro = useStore((s) => s.settings.pomodoro);
  const focusSessions = useStore((s) => s.focusSessions);
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * 浮层是否显示。用 state 而不是 CSS :hover —— 浮层里的 no-drag 按钮必须只在浮出期间
   * 存在于 DOM 里（见文件头注释里的原生 hit-test 死区）。每次进出各一次重渲，与每秒重渲
   * 是两码事，不违反「倒计时零重渲」那条铁律。
   */
  const [hovered, setHovered] = useState(false);
  /**
   * 待选事项。运行中显示的是那一段自己的归属（不可改 —— 中途改归属等于篡改已发生的记录），
   * 空闲/休息时显示的是「下一段用哪个」，来源与主面板同一个 localStorage 键。
   */
  const [nextSel, setNextSel] = useState<FocusSel>(() => readLastTask() ?? {});
  const timeRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // hero 文本 + 进度线：ref 直写、零重渲（与贴边态 PipDock 共用同一条通道）
  usePipPaint(timeRef, fillRef);

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

  // 专注中锁住归属；空闲与休息中可改（改的是「下一段用哪个」）
  const focusRunning = running?.phase === 'focus';
  const shownSel: FocusSel = focusRunning
    ? { goalId: running.goalId, taskId: running.taskId }
    : nextSel;
  const selLabel = useSelLabel(shownSel);
  const pickSel = (sel: FocusSel): void => {
    setNextSel(sel);
    writeLastTask(sel); // 落 localStorage ⇒ 主窗与打卡页的选择器立刻同源
  };
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
    // 116×76 里放不下第二行文字（stamp + 两行 + 控制行 = 82px），于是这句退到 title 上：
    // 悬停能看，不悬停也不会挤掉主句。今日战果的常驻出口在主面板，不在这个窗。
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
          <div className="pip-headline" title={sub}>
            {headline}
          </div>
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

  // 浮层要在 picker 打开期间强制留着：picker 盖满整窗，鼠标必然离开浮层本身
  const showOverlay = hovered || pickerOpen;

  return (
    <div
      key="running"
      className={`pip-shell${showOverlay ? ' is-open' : ''}`}
      style={{
        ['--pip-phase-color' as string]: phaseColor,
        ['--pip-action-color' as string]: running ? phaseColor : 'var(--accent)',
        // 顶行高度既是浮层顶栏的几何，也是 hero 浮出时上方要让开的距离，只能有一个来源
        ['--pip-topbar' as string]: `${PIP_TOPBAR_H}px`,
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {/* 零 children 的空元素：文本只由 ticker 经 ref 写入，React 从不渲染它 */}
      <div className="pip-hero">
        <div ref={timeRef} className={`pip-time tnum${running && !running.paused ? '' : ' pip-time--muted'}`} />
      </div>

      {showOverlay && (
        <div className="pip-overlay">
          <div className="pip-bar">
            {/* 阶段文案让给了事项名：这个宽度里两者只能留一个，阶段由圆点的颜色 + title 承载 */}
            <span className="pip-phase pip-phase--withsel">
              <i className="pip-dot" title={phaseText} />
              {focusRunning ? (
                <span className="pip-sel pip-sel--static" title={`${phaseText} · ${selLabel.text}`}>
                  {selLabel.text}
                </span>
              ) : (
                <button
                  type="button"
                  className="pip-sel pip-sel--btn"
                  onClick={() => setPickerOpen(true)}
                  title={`${selLabel.text}（点击更换）`}
                  aria-label={`专注事项：${selLabel.text}，点击更换`}
                >
                  {selLabel.text}
                </button>
              )}
            </span>
            {/* 贴边收起是原生窗口能力，web 的 Document PiP 动不了自己的几何 */}
            {isDesktop() && (
              <button
                type="button"
                className={`pip-dockbtn${docked ? ' is-docked' : ''}`}
                style={{ width: PIP_TOPBAR_H, height: PIP_TOPBAR_H }}
                onClick={() => void (docked ? desktop()?.undockPip() : desktop()?.dockPip())}
                title={docked ? '脱离屏幕边缘' : '收起到屏幕边缘'}
                aria-label={docked ? '脱离屏幕边缘' : '收起到屏幕边缘'}
              >
                <Icon kind="dock" />
              </button>
            )}
          </div>

          <div className="pip-controls">
            {!running && (
              <IconButton
                kind="play"
                variant="primary"
                label="开始专注"
                onClick={() => startPomodoro(nextSel)}
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
            {/* 段点挪到控制行右端：顶行的 116px 已经被事项名与收起键占满 */}
            <Segs
              total={segTotal}
              done={segDone}
              current={running?.phase === 'focus' ? Math.min(segDone, segTotal - 1) : -1}
            />
          </div>
        </div>
      )}

      <div className="pip-track" style={{ height: PIP_PROGRESS_H }}>
        <div ref={fillRef} className="pip-fill" style={{ transform: 'scaleX(0)' }} />
      </div>

      {pickerOpen && (
        <PipTaskPicker value={shownSel} onPick={pickSel} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  );
}
