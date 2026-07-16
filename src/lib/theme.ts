export type ThemePref = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'yearflow-theme'; // index.html 首帧脚本读取同一 key，避免闪屏

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* 隐私模式等场景忽略 */
  }
  document.documentElement.dataset.theme = resolveTheme(pref);
}

/** system 模式下跟随操作系统切换；返回取消订阅函数 */
export function subscribeSystemTheme(pref: ThemePref): () => void {
  if (pref !== 'system') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyTheme('system');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
