/**
 * 共享 rAF 缓动：缩放动画与平滑滚动共用同一实现，保证缓动一致并 respect
 * prefers-reduced-motion（直接跳到终值）。缓动曲线 = tokens.css 的
 * --ease: cubic-bezier(0.25, 1, 0.5, 1)。
 */

/** cubic-bezier(0.25, 1, 0.5, 1) 的 JS 求值（牛顿迭代解 x→t，再算 y） */
export function ease(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const x1 = 0.25;
  const x2 = 0.5;
  const bezierX = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
  const bezierDX = (t: number) =>
    3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
  let t = progress;
  for (let i = 0; i < 6; i++) {
    const dx = bezierDX(t);
    if (dx === 0) break;
    t -= (bezierX(t) - progress) / dx;
  }
  t = Math.max(0, Math.min(1, t));
  // y1 = y2 = 1
  return 3 * (1 - t) * (1 - t) * t + 3 * (1 - t) * t * t + t ** 3;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface TweenOptions {
  from: number;
  to: number;
  duration: number; // ms
  onUpdate: (value: number) => void;
  onDone?: () => void;
}

/**
 * 启动一段补间，返回取消函数。
 * reduced-motion 或页面处于后台（rAF 被挂起，动画无人可看）时立即落到终值。
 */
export function tween({ from, to, duration, onUpdate, onDone }: TweenOptions): () => void {
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (hidden || prefersReducedMotion() || duration <= 0 || from === to) {
    onUpdate(to);
    onDone?.();
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / duration);
    onUpdate(from + (to - from) * ease(p));
    if (p < 1) {
      raf = requestAnimationFrame(step);
    } else {
      onDone?.();
    }
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
