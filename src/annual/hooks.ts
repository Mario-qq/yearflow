/** 年报的三个小钩子：滚动入场、数字滚动、减弱动效偏好 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { COUNT_UP_MS } from './constants';

const RM_QUERY = '(prefers-reduced-motion: reduce)';

const subscribeRM = (cb: () => void) => {
  const mql = window.matchMedia(RM_QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
};

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeRM, () => window.matchMedia(RM_QUERY).matches);
}

/**
 * 元素第一次进入视口后置 true 并保持（只入场一次，回滚不重播）。
 * 没有 IntersectionObserver 的环境直接视为可见 —— 宁可没动画也不能留白。
 */
export function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  return [ref, inView];
}

const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

/**
 * 数字从上一个值滚到 target。active=false 时停在 0 等入场；减弱动效或页面隐藏时直接给终值
 * （隐藏标签页里 rAF 不跑，不能让数字卡在半路）。
 */
export function useCountUp(target: number, active: boolean): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    if (reduced || document.hidden) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const p = easeOutExpo((now - t0) / COUNT_UP_MS);
      const v = from + (target - from) * p;
      fromRef.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, reduced]);

  return active ? value : 0;
}
