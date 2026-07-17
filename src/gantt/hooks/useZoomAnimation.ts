/**
 * 缩放档位/Ctrl+滚轮 → 连续 dayWidth。
 * - 档位切换：Zustand 存目标档位，rAF 插值 150ms（reduced-motion 跳变）；
 *   锚点缺省 = 今日线在视口内→今日中心，否则视口中心。
 * - Ctrl+滚轮（SPEC 4.5）：以鼠标为锚在 [年档, 周档] 间连续插值（逐事件跳变，无 tween），
 *   静默 WHEEL_ZOOM_SNAP_MS 后吸附到 log 距离最近的档位（吸附 tween 沿用鼠标锚点）。
 * 锚点在整个动画期间保持视口内相对位置不变：每帧 useLayoutEffect 同步 scrollLeft，
 * 与宽度更新同一次 paint 落地，不闪帧。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { GanttZoom } from '../../types/domain';
import { useStore } from '../../store/useStore';
import { diffDays, todayStr } from '../../lib/date';
import { tween } from '../lib/tween';
import {
  DUR_ZOOM_MS,
  WHEEL_ZOOM_SENSITIVITY,
  WHEEL_ZOOM_SNAP_MS,
  ZOOM_DAY_WIDTH,
} from '../constants';

const MIN_W = ZOOM_DAY_WIDTH.year;
const MAX_W = ZOOM_DAY_WIDTH.week;

/** log 距离最近的缩放档位 */
function nearestZoom(w: number): GanttZoom {
  let best: GanttZoom = 'year';
  let bestDist = Infinity;
  for (const [zoom, zw] of Object.entries(ZOOM_DAY_WIDTH) as [GanttZoom, number][]) {
    const dist = Math.abs(Math.log(w) - Math.log(zw));
    if (dist < bestDist) {
      bestDist = dist;
      best = zoom;
    }
  }
  return best;
}

export function useZoomAnimation(
  scrollerRef: RefObject<HTMLDivElement | null>,
  zoom: GanttZoom,
  year: number,
  leftW: number,
): number {
  const [dayWidth, setDayWidth] = useState(() => ZOOM_DAY_WIDTH[zoom]);
  const dayWidthRef = useRef(dayWidth);
  dayWidthRef.current = dayWidth;
  const anchorRef = useRef<{ dayFloat: number; screenX: number } | null>(null);
  /** Ctrl+滚轮设置的锚点快照：档位切换 effect 优先用它（吸附时锚定鼠标而非今日/中心） */
  const wheelAnchorRef = useRef<{ dayFloat: number; screenX: number } | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const targetRef = useRef(ZOOM_DAY_WIDTH[zoom]);
  targetRef.current = ZOOM_DAY_WIDTH[zoom];
  const leftWRef = useRef(leftW);
  leftWRef.current = leftW;
  const daysInYear = diffDays(`${year}-12-31`, `${year}-01-01`) + 1;

  const runTween = useCallback((from: number, to: number) => {
    cancelRef.current?.();
    cancelRef.current = tween({
      from,
      to,
      duration: DUR_ZOOM_MS,
      onUpdate: setDayWidth,
      // 注意：不在 onDone 里清 anchorRef —— onDone 同步发生在 React 处理最后一帧
      // setState 之前，提前清空会让最终锚点校正被跳过（reduced-motion 跳变时则完全丢失）。
      // 清空在下方 useLayoutEffect 应用完目标宽度的校正后进行。
      onDone: () => {
        cancelRef.current = null;
      },
    });
  }, []);

  useEffect(() => {
    const target = ZOOM_DAY_WIDTH[zoom];
    const from = dayWidthRef.current;
    if (from === target) {
      wheelAnchorRef.current = null;
      return;
    }

    const el = scrollerRef.current;
    if (el) {
      if (wheelAnchorRef.current) {
        anchorRef.current = wheelAnchorRef.current;
        wheelAnchorRef.current = null;
      } else {
        const tlViewW = Math.max(0, el.clientWidth - leftWRef.current);
        const sl = el.scrollLeft;
        const todayIdx = diffDays(todayStr(), `${year}-01-01`);
        const todayCenter = (todayIdx + 0.5) * from;
        const todayVisible =
          todayIdx >= 0 && todayIdx < daysInYear && todayCenter >= sl && todayCenter <= sl + tlViewW;
        const anchorX = todayVisible ? todayCenter : sl + tlViewW / 2;
        anchorRef.current = { dayFloat: anchorX / from, screenX: anchorX - sl };
      }
    }

    runTween(from, target);
    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
      anchorRef.current = null;
    };
  }, [zoom, year, daysInYear, scrollerRef, runTween]);

  // Ctrl+滚轮连续缩放（非 passive；阻止浏览器页面缩放）
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let snapTimer: ReturnType<typeof setTimeout> | undefined;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      cancelRef.current?.();
      cancelRef.current = null;

      const from = dayWidthRef.current;
      const next = Math.max(MIN_W, Math.min(MAX_W, from * Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      if (next !== from) {
        const rect = el.getBoundingClientRect();
        const mouseTlX = Math.max(0, e.clientX - rect.left - leftWRef.current);
        const anchorX = el.scrollLeft + mouseTlX;
        const anchor = { dayFloat: anchorX / from, screenX: mouseTlX };
        anchorRef.current = anchor;
        wheelAnchorRef.current = anchor;
        setDayWidth(next);
        // 同步镜像：同一帧内的后续 wheel 事件在 React 重渲前到达，必须读到累积值才能叠加
        dayWidthRef.current = next;
      }

      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => {
        const w = dayWidthRef.current;
        const nearest = nearestZoom(w);
        const { settings, updateGanttView } = useStore.getState();
        if (settings.ganttView.zoom !== nearest) {
          updateGanttView({ zoom: nearest }); // 档位 effect 消费 wheelAnchorRef 完成吸附 tween
        } else if (w !== ZOOM_DAY_WIDTH[nearest]) {
          anchorRef.current = wheelAnchorRef.current;
          wheelAnchorRef.current = null;
          runTween(w, ZOOM_DAY_WIDTH[nearest]);
        }
      }, WHEEL_ZOOM_SNAP_MS);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(snapTimer);
    };
  }, [scrollerRef, runTween]);

  useLayoutEffect(() => {
    const a = anchorRef.current;
    const el = scrollerRef.current;
    if (!a || !el) return;
    const max = Math.max(0, leftWRef.current + daysInYear * dayWidth - el.clientWidth);
    el.scrollLeft = Math.max(0, Math.min(max, a.dayFloat * dayWidth - a.screenX));
    // 已到目标档且无进行中的动画/滚轮序列，锚点使命完成
    if (dayWidth === targetRef.current && !cancelRef.current && !wheelAnchorRef.current) {
      anchorRef.current = null;
    }
  }, [dayWidth, daysInYear, scrollerRef]);

  return dayWidth;
}
