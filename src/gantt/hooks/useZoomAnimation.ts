/**
 * 缩放档位 → 连续 dayWidth。
 * Zustand 只存目标档位；动画值是本地 state，rAF 插值 150ms（reduced-motion 跳变）。
 * 锚点（今日线在视口内→今日中心，否则视口中心）在整个动画期间保持视口内相对位置不变：
 * 每帧 useLayoutEffect 同步 scrollLeft，与宽度更新同一次 paint 落地，不闪帧。
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { GanttZoom } from '../../types/domain';
import { diffDays, todayStr } from '../../lib/date';
import { tween } from '../lib/tween';
import { DUR_ZOOM_MS, LEFT_W, ZOOM_DAY_WIDTH } from '../constants';

export function useZoomAnimation(
  scrollerRef: RefObject<HTMLDivElement | null>,
  zoom: GanttZoom,
  year: number,
): number {
  const [dayWidth, setDayWidth] = useState(() => ZOOM_DAY_WIDTH[zoom]);
  const dayWidthRef = useRef(dayWidth);
  dayWidthRef.current = dayWidth;
  const anchorRef = useRef<{ dayFloat: number; screenX: number } | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const targetRef = useRef(ZOOM_DAY_WIDTH[zoom]);
  targetRef.current = ZOOM_DAY_WIDTH[zoom];
  const daysInYear = diffDays(`${year}-12-31`, `${year}-01-01`) + 1;

  useEffect(() => {
    const target = ZOOM_DAY_WIDTH[zoom];
    const from = dayWidthRef.current;
    if (from === target) return;

    const el = scrollerRef.current;
    if (el) {
      const tlViewW = Math.max(0, el.clientWidth - LEFT_W);
      const sl = el.scrollLeft;
      const todayIdx = diffDays(todayStr(), `${year}-01-01`);
      const todayCenter = (todayIdx + 0.5) * from;
      const todayVisible =
        todayIdx >= 0 && todayIdx < daysInYear && todayCenter >= sl && todayCenter <= sl + tlViewW;
      const anchorX = todayVisible ? todayCenter : sl + tlViewW / 2;
      anchorRef.current = { dayFloat: anchorX / from, screenX: anchorX - sl };
    }

    cancelRef.current?.();
    cancelRef.current = tween({
      from,
      to: target,
      duration: DUR_ZOOM_MS,
      onUpdate: setDayWidth,
      // 注意：不在 onDone 里清 anchorRef —— onDone 同步发生在 React 处理最后一帧
      // setState 之前，提前清空会让最终锚点校正被跳过（reduced-motion 跳变时则完全丢失）。
      // 清空在下方 useLayoutEffect 应用完目标宽度的校正后进行。
      onDone: () => {
        cancelRef.current = null;
      },
    });
    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
      anchorRef.current = null;
    };
  }, [zoom, year, daysInYear, scrollerRef]);

  useLayoutEffect(() => {
    const a = anchorRef.current;
    const el = scrollerRef.current;
    if (!a || !el) return;
    const max = Math.max(0, LEFT_W + daysInYear * dayWidth - el.clientWidth);
    el.scrollLeft = Math.max(0, Math.min(max, a.dayFloat * dayWidth - a.screenX));
    if (dayWidth === targetRef.current) anchorRef.current = null; // 已到目标档，锚点使命完成
  }, [dayWidth, daysInYear, scrollerRef]);

  return dayWidth;
}
