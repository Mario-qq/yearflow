/**
 * 贴边收起态：88×26 的窄药丸，紧贴屏幕某一边挂着，只有 mm:ss + 一条进度线。
 *
 * 为什么不复用 PipView 而是单独一棵树：两者布局毫无共用（那边是「hero + 悬停浮层」，
 * 这边是一行字），共用只会让两边都长出一堆条件分支。共用的是绘制通道 usePipPaint —— 那
 * 才是容易走样的部分（每秒 ref 直写、零重渲）。
 *
 * ⚠️ 这棵树里**一个可点元素都不许有**：整块药丸是 `-webkit-app-region: drag`，而 drag 区
 * 会吃掉其上的一切点击，任何 no-drag 元素反过来会把「拖着它走」这唯一的操作废掉。所以
 * · 想看全部控件 → 鼠标移上去，PipWindow 发 peek，主进程临时展开；
 * · 想脱离边缘 → 直接把它拖走，主进程的 moved 判定发现已离开边缘就自动解除吸附。
 *
 * 几何真相全在主进程（electron/main.cts 的 dock 状态机），这里只管画。
 */
import { useRef } from 'react';
import { type PipEdge } from '../lib/desktop';
import { PIP_PROGRESS_H } from './constants';
import './pip.css';
import { usePipPaint } from './usePipPaint';
import { usePomodoroStore } from './store';

export function PipDock({ edge }: { edge: PipEdge }): React.ReactElement {
  const running = usePomodoroStore((s) => s.running);
  const alert = usePomodoroStore((s) => s.alert);
  const timeRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  usePipPaint(timeRef, fillRef);

  const phaseColor = alert
    ? 'var(--accent)'
    : running
      ? running.paused
        ? 'var(--warning)'
        : running.phase === 'focus'
          ? 'var(--accent)'
          : 'var(--success)'
      : 'var(--text-tertiary)';

  return (
    <div
      className={`pip-dock${alert ? ' is-alert' : ''}`}
      data-edge={edge}
      style={{ ['--pip-phase-color' as string]: phaseColor }}
      title="移上展开 · 拖走脱离边缘"
    >
      <div
        ref={timeRef}
        className={`pip-dock-time tnum${running && !running.paused && !alert ? '' : ' pip-time--muted'}`}
      />
      <div className="pip-track" style={{ height: PIP_PROGRESS_H }}>
        <div ref={fillRef} className="pip-fill" style={{ transform: 'scaleX(0)' }} />
      </div>
    </div>
  );
}
