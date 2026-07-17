/**
 * FLIP 位移动效：打卡后卡片从"待打卡"滑向"已完成"分组（SPEC 第五节）。
 * 容器内带 data-flip-id 的元素在 dep 变化时，从旧位置平滑归位到新位置。
 * 用 Web Animations API（全局 reduced-motion CSS 不覆盖它，需自行守卫）。
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';

export function useFlip(container: RefObject<HTMLElement | null>, dep: unknown): void {
  const rects = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, DOMRect>();
    for (const node of el.querySelectorAll<HTMLElement>('[data-flip-id]')) {
      const id = node.dataset.flipId;
      if (!id) continue;
      const rect = node.getBoundingClientRect();
      next.set(id, rect);
      const prev = rects.current.get(id);
      if (!prev || reduced) continue;
      const dx = prev.left - rect.left;
      const dy = prev.top - rect.top;
      if (dx === 0 && dy === 0) continue;
      node.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 260, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
      );
    }
    rects.current = next;
  }, [container, dep]);
}
