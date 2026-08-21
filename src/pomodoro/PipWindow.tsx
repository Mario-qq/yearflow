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
import { useEffect, useRef, useState } from 'react';
import { desktop, type PipModeInfo } from '../lib/desktop';
import { resolveTheme, type ThemePref } from '../lib/theme';
import { PipView } from './PipView';
import { PipDock } from './PipDock';
import { initPomodoro } from './kernel';
import { PIP_PEEK_LEAVE_MS, PIP_TOPBAR_H } from './constants';
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

/**
 * 贴边形态：真相在主进程（它拥有窗口几何），这里只订阅 + 上报鼠标进出。
 *
 * peek（收起态鼠标移上去临时展开）故意做成「渲染进程报 hover、主进程改几何」：
 * 只有主进程知道该往屏内哪个方向展开、以及怎么 clamp 进工作区 —— 展开后光标必须仍落在
 * 窗内，否则立刻触发 leave，两边来回抖。
 */
function usePipMode(): { info: PipModeInfo; onEnter: () => void; onLeave: () => void } {
  const [info, setInfo] = useState<PipModeInfo>({ mode: 'free', edge: null });
  const leaveTimer = useRef<number | null>(null);

  useEffect(() => desktop()?.onPipMode(setInfo) ?? undefined, []);

  const clearLeave = (): void => {
    if (leaveTimer.current !== null) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };
  useEffect(() => clearLeave, []);

  return {
    info,
    onEnter: () => {
      clearLeave();
      if (info.mode === 'docked') void desktop()?.peekPip(true);
    },
    // 擦边而过不该让它闪一下：留一段回收延迟，期间再次移入直接取消
    onLeave: () => {
      if (info.mode !== 'peek') return;
      clearLeave();
      leaveTimer.current = window.setTimeout(() => {
        leaveTimer.current = null;
        void desktop()?.peekPip(false);
      }, PIP_PEEK_LEAVE_MS);
    },
  };
}

export function PipWindow(): React.ReactElement | null {
  const hydrated = useStore((s) => s.hydrated);
  const hydrate = useStore((s) => s.hydrate);
  const [ready, setReady] = useState(false);
  const { info, onEnter, onLeave } = usePipMode();
  useFollowTheme();

  useEffect(() => {
    void hydrate().then(() => setReady(true));
  }, [hydrate]);

  // 与 App.tsx 同一条铁律：结算要写库，必须等 hydrate 完成，否则记录进了库却不在内存
  useEffect(() => {
    if (hydrated) initPomodoro();
  }, [hydrated]);

  if (!ready) return null;

  // 贴边收起态：只有一条药丸，连 × 都不渲染 —— 26px 高放不下两颗按钮，
  // 关窗从展开态走（移上去 peek 即可）。
  if (info.mode === 'docked' && info.edge) {
    return (
      <div className="pip-native is-docked" style={{ height: '100%' }} onPointerEnter={onEnter}>
        <PipDock edge={info.edge} />
      </div>
    );
  }

  return (
    <div className="pip-native" style={{ height: '100%' }} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <PipView docked={info.mode === 'peek'} />
      {/* 无边框窗口缺的关闭按钮。拖动交给顶栏自己（pip.css `.pip-native .pip-bar`），
          不再盖透明层 —— 那会吞掉顶栏里事项选择按钮的点击。
          ⚠️ 必须排在 PipView（顶栏 drag 区）之后：Chromium 按文档顺序依次对可拖拽区域
          做并集/差集，no-drag 若先于 drag 处理，会被后处理的 drag 重新并回去 —— 于是
          这颗按钮所在的角落被判成「拖窗口」，点击真实鼠标完全没反应（自动化点击测不出来，
          它绕过了原生 hit-test，直接把事件灌进渲染进程）。 */}
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
    </div>
  );
}
