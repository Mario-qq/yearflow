/**
 * 悬浮小窗（Document Picture-in-Picture，Chrome/Edge 116+ 桌面）。
 *
 * 为什么是这个 API 而不是自绘浮层：它是**真正的系统级窗口**，浮在所有窗口之上、
 * 最小化浏览器后依然可见 —— 这正是「到点了我在别的软件里，什么都看不到」的解药。
 *
 * 三条关键性质：
 * · 小窗与主页面是**同一个 JS realm**（不是 iframe、不是新 renderer），
 *   所以 kernel / ticker / store 全部直接可用，零跨窗通信、零状态同步。
 * · 样式**不会自动继承**，必须把主文档的样式表复制过去（Tailwind + tokens.css 都是同源）。
 * · `requestWindow()` 需要 transient user activation ⇒ 只能在用户手势回调里调用。
 *   「开始专注」是手势，链路成立；自动进休息、恢复结算不是手势，那些路径只更新已开的小窗。
 *
 * 失败一律安静降级（不支持 / 用户取消 / 没有手势）：不 toast、不报错，按钮本来就只在
 * isPipSupported() 为真时才渲染。
 */
import { PIP_H, PIP_W } from './constants';
import { usePomodoroStore } from './store';

interface RequestOpts {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
}
interface DocumentPiP {
  requestWindow(options?: RequestOpts): Promise<Window>;
  window: Window | null;
}

function api(): DocumentPiP | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture ?? null;
}

export function isPipSupported(): boolean {
  return api() !== null;
}

let pipWindow: Window | null = null;
let themeObserver: MutationObserver | null = null;

/** 主文档的样式表在小窗里不存在，必须整份搬过去，否则拿到的是一个无样式的白窗 */
function copyStyles(w: Window): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join('\n');
      const el = w.document.createElement('style');
      el.textContent = css;
      w.document.head.appendChild(el);
    } catch {
      // 跨域样式表读不到 cssRules（SecurityError），退回复制 <link>
      const href = (sheet as CSSStyleSheet).href;
      if (!href) continue;
      const link = w.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      w.document.head.appendChild(link);
    }
  }
  // 小窗自己的地基：主文档 body 的样式来自 index.html/index.css 的选择器，这里得补一份
  const base = w.document.createElement('style');
  base.textContent = `
    html, body { margin: 0; height: 100%; }
    body {
      background: var(--bg-base);
      color: var(--text-primary);
      font-family: inherit;
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
    }
  `;
  w.document.head.appendChild(base);
}

/** 主题写在 <html data-theme>（lib/theme.ts 是唯一写入点），小窗得跟着变 */
function syncTheme(w: Window): void {
  w.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? '';
}

function teardown(): void {
  themeObserver?.disconnect();
  themeObserver = null;
  pipWindow = null;
  usePomodoroStore.setState({ pipHost: null });
}

/** 必须在用户手势回调里调用 */
export async function openPip(): Promise<void> {
  const pip = api();
  if (!pip || pipWindow) return;
  try {
    const w = await pip.requestWindow({
      width: PIP_W,
      height: PIP_H,
      disallowReturnToOpener: true,
    });
    pipWindow = w;
    copyStyles(w);
    syncTheme(w);
    themeObserver = new MutationObserver(() => syncTheme(w));
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const host = w.document.createElement('div');
    host.style.height = '100%';
    w.document.body.appendChild(host);
    // 用户点小窗右上角关闭 / 系统回收：pagehide 是唯一可靠的收尾信号
    w.addEventListener('pagehide', teardown, { once: true });
    usePomodoroStore.setState({ pipHost: host });
  } catch (e) {
    // 用户取消 / 无手势 / 环境不允许：安静降级。DEV 下留个把手，否则完全无从诊断
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__pipError = e;
    teardown();
  }
}

export function closePip(): void {
  const w = pipWindow;
  teardown();
  w?.close();
}

export function togglePip(): void {
  if (pipWindow) closePip();
  else void openPip();
}

/** 主页面关掉时别留一个孤儿小窗在桌面上飘着 */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    pipWindow?.close();
  });
}
