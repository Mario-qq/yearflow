/**
 * 独立窗口（番茄钟小窗、便签贴纸 / 速记框）的主题跟随主窗。
 */
import { useEffect } from 'react';
import { resolveTheme, type ThemePref } from './theme';

const THEME_KEY = 'yearflow-theme'; // lib/theme.ts 的同一个 key

function readThemePref(): ThemePref {
  try {
    return (localStorage.getItem(THEME_KEY) as ThemePref | null) ?? 'system';
  } catch {
    return 'system';
  }
}

/**
 * 主题跟随主窗：主窗切主题时会写 localStorage，我们靠 storage 事件收到。
 * 不能调 applyTheme() —— 那个函数会**回写** localStorage，两窗互相触发就成环了。
 */
export function useFollowTheme(): void {
  useEffect(() => {
    const apply = (): void => {
      document.documentElement.dataset.theme = resolveTheme(readThemePref());
    };
    apply();
    const onStorage = (e: StorageEvent): void => {
      if (e.key === null || e.key === THEME_KEY) apply();
    };
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = (): void => {
      if (readThemePref() === 'system') apply();
    };
    window.addEventListener('storage', onStorage);
    mq.addEventListener('change', onScheme);
    return () => {
      window.removeEventListener('storage', onStorage);
      mq.removeEventListener('change', onScheme);
    };
  }, []);
}
