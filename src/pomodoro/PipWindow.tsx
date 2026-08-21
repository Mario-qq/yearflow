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
import { PIP_COMPACT_MAX_H, PIP_PEEK_LEAVE_MS, PIP_TOPBAR_H } from './constants';
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
 * 「窗已经缩到收起档了吗」—— 形态的权威事实。
 *
 * 为什么不直接信主进程的 pip:mode：那是一次性消息，丢一次或与 setBounds 抢跑一次，窗内
 * 就会停在完整态那棵树上，且没有任何自愈机会（用户看到的就是药丸里露出段点和 ×、一个
 * 数字都没有）。窗高每次 resize 都能重新测，所以它才是权威；消息只用来补 edge 朝向。
 *
 * 用 matchMedia 而不是 ResizeObserver：只在跨过阈值时回调一次，中间的每一像素都不惊动 React。
 */
function useIsCompact(): boolean {
  const [compact, setCompact] = useState(
    () => window.matchMedia(`(max-height: ${PIP_COMPACT_MAX_H}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-height: ${PIP_COMPACT_MAX_H}px)`);
    const on = (e: MediaQueryListEvent): void => setCompact(e.matches);
    setCompact(mq.matches); // 订阅前跨过阈值的那次变化补上
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

/**
 * 光标是否落在小窗上 —— **只有主进程知道**。
 *
 * 小窗整块是 `-webkit-app-region: drag`（无边框窗要哪都能拖）。那是原生 hit-test：
 * 落在拖动区上的鼠标被 Windows 判给「移动窗口」，渲染进程连 mousemove 都收不到 ⇒
 * CSS :hover 与 onPointerEnter 一概不成立。表现就是常态那一屏只有倒计时、鼠标移上去
 * 控件不浮出、× 也点不到 —— 而 Playwright 的合成事件绕过 hit-test，自查全绿。
 * 所以悬停由主进程轮询光标位置判定（main.cts tickHover），窗内只订阅结果。
 *
 * 仍保留窗内的 onPointerEnter/Leave 作为兜底：合成事件与 web 版的 Document PiP 都靠它。
 */
function useNativeHover(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const d = desktop();
    // 旧 preload 没有这个订阅口，缺了只是回到「兜底」路径，不该整窗白屏
    if (!d?.onPipHover) return;
    return d.onPipHover(setOn);
  }, []);
  return on;
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
  const compact = useIsCompact();

  useEffect(() => desktop()?.onPipMode(setInfo) ?? undefined, []);

  const clearLeave = (): void => {
    if (leaveTimer.current !== null) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };
  useEffect(() => clearLeave, []);

  return {
    // 尺寸压过消息：窗只要是收起档，画的就是药丸；mode 只贡献 edge 朝向。
    info: compact ? { mode: 'docked', edge: info.edge } : info,
    // 判「该不该展开」只看窗是不是已经缩到收起档，不看 info.mode：mode 与真实几何一旦
    // 漂移（收起态却仍报 free），这道前置判断就是把展开永久卡死的那道闸。
    onEnter: () => {
      clearLeave();
      if (compact) void desktop()?.peekPip(true);
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
  const nativeHover = useNativeHover();
  useFollowTheme();

  useEffect(() => {
    void hydrate().then(() => setReady(true));
  }, [hydrate]);

  // 与 App.tsx 同一条铁律：结算要写库，必须等 hydrate 完成，否则记录进了库却不在内存
  useEffect(() => {
    if (hydrated) initPomodoro();
  }, [hydrated]);

  if (!ready) return null;

  // 贴边收起态：只有一条药丸，连 × 都不渲染 —— 30px 高放不下两颗按钮，
  // 关窗从展开态走（移上去 peek 即可）。
  // edge 兜底成 left：它只决定圆角朝哪两个角，缺了也不该让倒计时不显示。
  if (info.mode === 'docked') {
    return (
      <div
        className={`pip-native is-docked${nativeHover ? ' is-hover' : ''}`}
        style={{ height: '100%' }}
        onPointerEnter={onEnter}
      >
        <PipDock edge={info.edge ?? 'left'} />
      </div>
    );
  }

  return (
    <div
      className={`pip-native${nativeHover ? ' is-hover' : ''}`}
      style={{ height: '100%' }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <PipView docked={info.mode === 'peek'} hover={nativeHover} />
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
