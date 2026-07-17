/**
 * 按住空格 + 拖拽 = 抓手平移（SPEC 4.5）。
 * 返回 held；GanttView 在 held 时铺一层抓手覆盖层拦截 pointer，拖动直写 scrollLeft/Top。
 * 输入框/文本域聚焦时不劫持空格；窗口失焦自动松开。
 */
import { useEffect, useState, type RefObject } from 'react';

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function useSpacePan(scrollerRef: RefObject<HTMLDivElement | null>): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault(); // 阻止页面空格滚动
      setHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setHeld(false);
    };
    const onBlur = () => setHeld(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // held 期间的拖拽逻辑挂在覆盖层上（GanttView 渲染），这里只负责状态
  useEffect(() => {
    if (!held) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.style.cursor = 'grab';
    return () => {
      scroller.style.cursor = '';
    };
  }, [held, scrollerRef]);

  return held;
}

/** 抓手覆盖层的 pointerdown 处理（拖动直写 scroller 滚动量） */
export function startGrabPan(e: React.PointerEvent, scroller: HTMLDivElement): void {
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // 指针已释放时无法捕获，放弃本次拖动
  }
  el.style.cursor = 'grabbing';
  const startX = e.clientX;
  const startY = e.clientY;
  const startLeft = scroller.scrollLeft;
  const startTop = scroller.scrollTop;
  const onMove = (ev: PointerEvent) => {
    scroller.scrollLeft = startLeft - (ev.clientX - startX);
    scroller.scrollTop = startTop - (ev.clientY - startY);
  };
  const onUp = () => {
    el.style.cursor = '';
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}
