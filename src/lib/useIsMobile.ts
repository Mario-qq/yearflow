import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 767px)';

const subscribe = (cb: () => void) => {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
};

/** 移动端断点（SPEC 第五节 <768px）：底部 tab 导航 + 甘特只读月视图 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches);
}
