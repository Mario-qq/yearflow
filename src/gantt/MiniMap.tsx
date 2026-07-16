/**
 * 底部 mini-map（SPEC 4.6）：28px 全年缩略。每目标一条 2px 色线段表示任务分布，
 * 今日红线；取景框可拖动/点击跳转。位于 scroller 之外（不受 sticky 铁律约束）。
 * 取景框与滚动的同步不走 React state：scroll 事件 + rAF 直接写 style。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Goal, Task } from '../types/domain';
import type { TimeScale } from './timeScale';
import { diffDays } from '../lib/date';
import { goalColor } from '../lib/colors';
import { prefersReducedMotion } from './lib/tween';
import { LEFT_W, MINIMAP_H, MINIMAP_LINE_H, MINIMAP_PAD_Y } from './constants';

interface Props {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  scale: TimeScale;
  goals: Record<string, Goal>;
  tasks: Record<string, Task>;
  /** 今日在时间轴内的 x（timeline px），年外为 null */
  todayX: number | null;
}

export const MiniMap = memo(function MiniMap({ scrollerRef, scale, goals, tasks, todayX }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [mmW, setMmW] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setMmW(el.clientWidth));
    ro.observe(el);
    setMmW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const lanes = useMemo(() => {
    const active = Object.values(goals)
      .filter((g) => !g.deletedAt && !g.archived)
      .sort((a, b) => a.order - b.order);
    const taskList = Object.values(tasks).filter((t) => !t.deletedAt);
    const innerH = MINIMAP_H - MINIMAP_PAD_Y * 2;
    return active.map((g, i) => ({
      goal: g,
      y: MINIMAP_PAD_Y + ((i + 0.5) * innerH) / Math.max(1, active.length) - MINIMAP_LINE_H / 2,
      segments: taskList
        .filter((t) => t.goalId === g.id)
        .map((t) => {
          const startIdx = Math.max(0, diffDays(t.startDate, scale.yearStart));
          const endIdx = Math.min(scale.daysInYear, diffDays(t.endDate, scale.yearStart) + 1);
          return { id: t.id, x0: startIdx / scale.daysInYear, x1: endIdx / scale.daysInYear };
        })
        .filter((s) => s.x1 > s.x0),
    }));
  }, [goals, tasks, scale.yearStart, scale.daysInYear]);

  // 取景框同步：直接写 DOM，不触发 React 重渲
  useEffect(() => {
    const scroller = scrollerRef.current;
    const frame = frameRef.current;
    if (!scroller || !frame || mmW === 0) return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      const viewW = Math.max(0, scroller.clientWidth - LEFT_W);
      const left = (scroller.scrollLeft / scale.totalWidth) * mmW;
      const width = Math.min(mmW, (viewW / scale.totalWidth) * mmW);
      frame.style.left = `${Math.min(left, mmW - width)}px`;
      frame.style.width = `${width}px`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };
    sync();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollerRef, scale.totalWidth, mmW]);

  // 点击跳转 + 拖动：按住取景框保持抓取偏移，其余位置以指针为中心
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    const container = containerRef.current;
    const frame = frameRef.current;
    if (!scroller || !container || !frame || mmW === 0) return;
    e.preventDefault();
    try {
      container.setPointerCapture(e.pointerId);
    } catch {
      // 指针已释放（或合成事件）时无法捕获：点击跳转仍生效，仅放弃拖动跟踪
    }

    const rect = container.getBoundingClientRect();
    const frameLeft = frame.offsetLeft;
    const frameW = frame.offsetWidth;
    const downX = e.clientX - rect.left;
    const inFrame = downX >= frameLeft && downX <= frameLeft + frameW;
    // 抓取偏移：点在框内保持相对位置，框外按中心对齐
    const grabOffset = inFrame ? downX - frameLeft : frameW / 2;

    const apply = (clientX: number, smooth: boolean) => {
      const px = clientX - rect.left - grabOffset;
      const target = (px / mmW) * scale.totalWidth;
      const max = scale.totalWidth + LEFT_W - scroller.clientWidth;
      const left = Math.max(0, Math.min(max, target));
      if (smooth && !prefersReducedMotion()) scroller.scrollTo({ left, behavior: 'smooth' });
      else scroller.scrollLeft = left;
    };
    apply(e.clientX, !inFrame);

    const onMove = (ev: PointerEvent) => apply(ev.clientX, false);
    const onUp = () => {
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
    };
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      ref={containerRef}
      data-minimap
      className="relative shrink-0 cursor-pointer select-none"
      style={{
        height: MINIMAP_H,
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border-default)',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
    >
      {mmW > 0 && (
        <svg className="absolute inset-0" width={mmW} height={MINIMAP_H} aria-hidden>
          {lanes.map(({ goal, y, segments }) =>
            segments.map((s) => (
              <rect
                key={s.id}
                x={s.x0 * mmW}
                y={y}
                width={Math.max(1, (s.x1 - s.x0) * mmW)}
                height={MINIMAP_LINE_H}
                rx={MINIMAP_LINE_H / 2}
                fill={goalColor(goal.color)}
              />
            )),
          )}
          {todayX != null && (
            <line
              x1={(todayX / scale.totalWidth) * mmW}
              y1={0}
              x2={(todayX / scale.totalWidth) * mmW}
              y2={MINIMAP_H}
              stroke="var(--danger)"
              strokeWidth={1}
            />
          )}
        </svg>
      )}
      <div
        ref={frameRef}
        data-minimap-frame
        className="absolute bottom-0 top-0"
        style={{
          background: 'var(--accent-soft)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-sm)',
        }}
      />
    </div>
  );
});
