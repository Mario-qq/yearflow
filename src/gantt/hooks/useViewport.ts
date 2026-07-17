/**
 * 可视窗口（量化）+ 命令式滚动。
 *
 * 坐标推导（单 scroller，左栏/表头 sticky）：
 *   content x = LEFT_W + timelineX；可视 timeline x ∈ [scrollLeft, scrollLeft + vw - LEFT_W]
 *   content y = HEADER_H + bodyY；  可视 body y   ∈ [scrollTop, scrollTop + vh - HEADER_H]
 *
 * 滚动帧里绝不 setState 原始 scrollLeft：把可视范围量化到 400/300px 档，
 * 跨档才触发 React 重渲，量化间隙由 buffer（前后各一档）覆盖。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useStore } from '../../store/useStore';
import { dateToX, xToDate, type TimeScale } from '../timeScale';
import { tween } from '../lib/tween';
import {
  HEADER_H,
  SCROLL_TWEEN_MAX_MS,
  VIEWPORT_H_CHUNK,
  VIEWPORT_V_CHUNK,
} from '../constants';

export interface ViewportWindow {
  /** timeline px（含 buffer；xStart/yStart 已 clamp ≥0，上限由消费方按当前 scale clamp） */
  xStart: number;
  xEnd: number;
  yStart: number;
  yEnd: number;
  vw: number;
  vh: number;
}

interface Chunks {
  hc0: number;
  hc1: number;
  vc0: number;
  vc1: number;
  vw: number;
  vh: number;
}

const SCROLL_DATE_DEBOUNCE_MS = 500;

function toWindow(c: Chunks): ViewportWindow {
  return {
    xStart: Math.max(0, c.hc0 * VIEWPORT_H_CHUNK),
    xEnd: (c.hc1 + 1) * VIEWPORT_H_CHUNK,
    yStart: Math.max(0, c.vc0 * VIEWPORT_V_CHUNK),
    yEnd: (c.vc1 + 1) * VIEWPORT_V_CHUNK,
    vw: c.vw,
    vh: c.vh,
  };
}

export interface ScrollToDateOptions {
  smooth?: boolean;
  /** 目标日期停在时间轴视口的横向比例位置（0=左缘，1/3=SPEC 今日线要求）；缺省 0 */
  anchorRatio?: number;
}

export function useViewport(
  scrollerRef: RefObject<HTMLDivElement | null>,
  scale: TimeScale,
  leftW: number,
) {
  const [chunks, setChunks] = useState<Chunks>({ hc0: -1, hc1: 4, vc0: -1, vc1: 4, vw: 0, vh: 0 });
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const leftWRef = useRef(leftW);
  leftWRef.current = leftW;
  const cancelTweenRef = useRef<(() => void) | null>(null);
  const scrollDateTimer = useRef<number | undefined>(undefined);

  const compute = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const tlX = el.scrollLeft;
    const tlW = Math.max(0, vw - leftWRef.current);
    const bodyY = el.scrollTop;
    const bodyH = Math.max(0, vh - HEADER_H);
    const next: Chunks = {
      hc0: Math.floor(tlX / VIEWPORT_H_CHUNK) - 1,
      hc1: Math.floor((tlX + tlW) / VIEWPORT_H_CHUNK) + 1,
      vc0: Math.floor(bodyY / VIEWPORT_V_CHUNK) - 1,
      vc1: Math.floor((bodyY + bodyH) / VIEWPORT_V_CHUNK) + 1,
      vw,
      vh,
    };
    setChunks((prev) =>
      prev.hc0 === next.hc0 &&
      prev.hc1 === next.hc1 &&
      prev.vc0 === next.vc0 &&
      prev.vc1 === next.vc1 &&
      prev.vw === next.vw &&
      prev.vh === next.vh
        ? prev
        : next,
    );
    // 视口静止后记录左缘日期（持久化，下次打开恢复原样）
    clearTimeout(scrollDateTimer.current);
    scrollDateTimer.current = window.setTimeout(() => {
      const s = scaleRef.current;
      const scrollDate = xToDate(s, el.scrollLeft);
      const { settings, updateGanttView } = useStore.getState();
      if (settings.ganttView.scrollDate !== scrollDate) updateGanttView({ scrollDate });
    }, SCROLL_DATE_DEBOUNCE_MS);
  }, [scrollerRef]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', compute, { passive: true });
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => {
      el.removeEventListener('scroll', compute);
      ro.disconnect();
      clearTimeout(scrollDateTimer.current);
    };
  }, [scrollerRef, compute]);

  // 缩放换档/左栏宽变化：chunk 是 px 语义，dayWidth 或 leftW 一变映射即变；scroll 事件要
  // 下一帧才到（useZoomAnimation 的锚点校正也发生在 layout 阶段），这里同帧重算避免闪现错误刻度。
  useLayoutEffect(() => {
    compute();
  }, [scale.dayWidth, leftW, compute]);

  const scrollToX = useCallback(
    (targetTimelineX: number, smooth: boolean) => {
      const el = scrollerRef.current;
      if (!el) return;
      const s = scaleRef.current;
      const max = Math.max(0, leftWRef.current + s.totalWidth - el.clientWidth);
      const target = Math.max(0, Math.min(max, targetTimelineX));
      cancelTweenRef.current?.();
      if (!smooth) {
        el.scrollLeft = target;
        compute(); // 程序化跳转不等 scroll 事件（后台页不派发），立即同步可视窗口
        return;
      }
      const dist = Math.abs(target - el.scrollLeft);
      cancelTweenRef.current = tween({
        from: el.scrollLeft,
        to: target,
        duration: Math.min(SCROLL_TWEEN_MAX_MS, Math.max(200, dist / 4)),
        onUpdate: (v) => {
          el.scrollLeft = v;
        },
        onDone: () => {
          cancelTweenRef.current = null;
          compute();
        },
      });
    },
    [scrollerRef, compute],
  );

  const scrollToDate = useCallback(
    (date: string, { smooth = false, anchorRatio = 0 }: ScrollToDateOptions = {}) => {
      const el = scrollerRef.current;
      if (!el) return;
      const s = scaleRef.current;
      const tlViewW = Math.max(0, el.clientWidth - leftWRef.current);
      scrollToX(dateToX(s, date) - tlViewW * anchorRatio, smooth);
    },
    [scrollerRef, scrollToX],
  );

  return { win: toWindow(chunks), scrollToDate, scrollToX };
}
