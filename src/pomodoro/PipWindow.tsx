/**
 * 桌面版悬浮小窗的窗内根组件（入口是 src/pip-main.tsx / pip.html）。
 *
 * 这是**第二个独立窗口、第二个 React root**，和主窗不共享任何 JS 状态 —— 与 web 版
 * 的 Document PiP（同 realm + createPortal）完全不同。两窗之间怎么对齐：
 *
 * · 计时权威状态在 localStorage（pomodoro/running.ts），两个同 origin 窗口天然共享；
 * · 状态迁移靠 storage 事件互相通知（pomodoro/kernel.ts onStorage）；
 * · 只有一个窗口响铃/弹通知，由 navigator.locks 选主决定（kernel.ts 的 isLeader）。
 *
 * 也就是说：**这个窗口在番茄钟眼里就是「另一个 tab」**，一整套多 tab 机制原样复用，
 * 所以这里要做的就是把一个普通 tab 该做的事做完 —— hydrate + initPomodoro，然后渲染
 * PipView。Phase 0 spike（electron/spike/）已实测 storage 事件、Web Locks、IndexedDB
 * 在两个 BrowserWindow 之间都成立。
 */
import { useEffect, useState } from 'react';
import { desktop } from '../lib/desktop';
import { resolveTheme, type ThemePref } from '../lib/theme';
import { PipView } from './PipView';
import { initPomodoro } from './kernel';
import { PIP_TOPBAR_H } from './constants';
import { useStore } from '../store/useStore';

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
function useFollowTheme(): void {
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

export function PipWindow(): React.ReactElement | null {
  const hydrated = useStore((s) => s.hydrated);
  const hydrate = useStore((s) => s.hydrate);
  const [ready, setReady] = useState(false);
  useFollowTheme();

  useEffect(() => {
    void hydrate().then(() => setReady(true));
  }, [hydrate]);

  // 与 App.tsx 同一条铁律：结算要写库，必须等 hydrate 完成，否则记录进了库却不在内存
  useEffect(() => {
    if (hydrated) initPomodoro();
  }, [hydrated]);

  if (!ready) return null;

  return (
    <div className="pip-native" style={{ height: '100%' }}>
      {/* 无边框窗口的拖动条与关闭按钮：几何与 PipView 自绘顶栏严格对齐（pip.css .pip-native） */}
      <div className="pip-native-drag" style={{ height: PIP_TOPBAR_H }} />
      <button
        type="button"
        className="pip-native-close"
        style={{ height: PIP_TOPBAR_H, width: PIP_TOPBAR_H }}
        title="关闭小窗"
        aria-label="关闭小窗"
        onClick={() => void desktop()?.closeSelf()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
          <path d="M2 2 8 8M8 2 2 8" />
        </svg>
      </button>
      <PipView />
    </div>
  );
}
