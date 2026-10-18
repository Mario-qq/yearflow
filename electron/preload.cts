/**
 * 渲染进程能看到的全部原生能力。刻意窄：跨窗口的状态同步走 localStorage + storage
 * 事件（见 main.cts 顶部注释），这里只暴露 web 侧根本做不到的事（开关窗、通知、托盘、备份文件）。
 *
 * `window.yearflowDesktop` 存在即代表跑在桌面壳里 —— src/lib/desktop.ts 据此分叉。
 */
import { contextBridge, ipcRenderer } from 'electron';

interface ShellPrefsView {
  closeToTray: boolean;
  openAtLogin: boolean;
  canAutoStart: boolean;
}

const api = {
  openPip: (): Promise<boolean> => ipcRenderer.invoke('pip:open'),
  closePip: (): Promise<boolean> => ipcRenderer.invoke('pip:close'),
  closeSelf: (): Promise<void> => ipcRenderer.invoke('win:close-self'),
  /** 设置小窗不透明度（百分比 30–100）。返回主进程 clamp 后的实际值。 */
  setPipOpacity: (percent: number): Promise<number> => ipcRenderer.invoke('pip:opacity', percent),
  /** 贴边收起 / 脱离边缘 / 收起态临时展开。几何真相只在主进程，网页动不了自己的窗。 */
  dockPip: (): Promise<void> => ipcRenderer.invoke('pip:dock'),
  undockPip: (): Promise<void> => ipcRenderer.invoke('pip:undock'),
  peekPip: (on: boolean): Promise<void> => ipcRenderer.invoke('pip:peek', on),
  focusMain: (): Promise<void> => ipcRenderer.invoke('win:focus-main'),
  /** 系统通知。route = 点通知后主窗跳到哪一页 */
  notify: (body: string, opts?: { title?: string; route?: string; sound?: boolean }): Promise<boolean> =>
    ipcRenderer.invoke('notify', body, opts),
  /** 托盘常驻偏好（主进程持有，存本机 shell-prefs.json） */
  getShellPrefs: (): Promise<ShellPrefsView> => ipcRenderer.invoke('shell:prefs'),
  setShellPref: (key: 'closeToTray' | 'openAtLogin', value: boolean): Promise<ShellPrefsView> =>
    ipcRenderer.invoke('shell:set-pref', key, value),
  onShellPrefs: (cb: (v: ShellPrefsView) => void): (() => void) => {
    const handler = (_e: unknown, v: ShellPrefsView): void => cb(v);
    ipcRenderer.on('shell:prefs', handler);
    return () => ipcRenderer.off('shell:prefs', handler);
  },
  /** 托盘悬停提示 */
  setTrayStatus: (text: string): Promise<void> => ipcRenderer.invoke('tray:status', text),
  /** 点通知 / 托盘「开始学习」：主窗跳到某一页 */
  onNavigate: (cb: (route: string) => void): (() => void) => {
    const handler = (_e: unknown, route: string): void => cb(route);
    ipcRenderer.on('app:navigate', handler);
    return () => ipcRenderer.off('app:navigate', handler);
  },
  /** 托盘菜单「开始学习」 */
  onTrayStudy: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on('tray:study', handler);
    return () => ipcRenderer.off('tray:study', handler);
  },
  /** 本机自动备份：写入（返回文件名）/ 列出 / 读回 / 打开目录。文件在 userData/backups */
  backupWrite: (json: string, kind: 'daily' | 'pre'): Promise<string> =>
    ipcRenderer.invoke('backup:write', json, kind),
  backupList: (): Promise<{ name: string; kind: 'daily' | 'pre'; at: string; size: number }[]> =>
    ipcRenderer.invoke('backup:list'),
  backupRead: (name: string): Promise<string> => ipcRenderer.invoke('backup:read', name),
  backupOpenDir: (): Promise<string> => ipcRenderer.invoke('backup:open-dir'),
  /** 每日备份另存一份：查看 / 选目录（系统对话框）/ 不再另存 / 打开那个目录 */
  backupMirror: (): Promise<{ dir: string | null; at: string | null; error: string | null }> =>
    ipcRenderer.invoke('backup:mirror'),
  backupMirrorChoose: (): Promise<{ dir: string | null; at: string | null; error: string | null }> =>
    ipcRenderer.invoke('backup:mirror-choose'),
  backupMirrorClear: (): Promise<{ dir: string | null; at: string | null; error: string | null }> =>
    ipcRenderer.invoke('backup:mirror-clear'),
  backupMirrorOpen: (): Promise<string> => ipcRenderer.invoke('backup:mirror-open'),
  /** OS 睡眠/锁屏唤醒。返回取消订阅函数。 */
  onPowerResume: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on('power:resume', handler);
    return () => ipcRenderer.off('power:resume', handler);
  },
  /** 小窗开/关。用户从小窗自己的 × 关闭时，主窗只能靠这个知道。 */
  onPipState: (cb: (open: boolean) => void): (() => void) => {
    const handler = (_e: unknown, open: boolean): void => cb(open);
    ipcRenderer.on('pip:state', handler);
    return () => ipcRenderer.off('pip:state', handler);
  },
  /**
   * 光标是否落在小窗上。**必须由主进程判定**：小窗整块是 `-webkit-app-region: drag`，
   * 那是原生 hit-test，落在上面的鼠标事件直接被判给「移动窗口」，窗内的 :hover 与
   * onPointerEnter 一概不触发（见 main.cts 的 tickHover）。
   */
  onPipHover: (cb: (on: boolean) => void): (() => void) => {
    const handler = (_e: unknown, on: boolean): void => cb(on === true);
    ipcRenderer.on('pip:hover', handler);
    return () => ipcRenderer.off('pip:hover', handler);
  },
  /** 小窗形态（自由 / 贴边收起 / 临时展开）。只有主进程知道，窗内据此换渲染的那棵树。 */
  onPipMode: (cb: (info: { mode: 'free' | 'docked' | 'peek'; edge: 'left' | 'right' | 'top' | 'bottom' | null }) => void): (() => void) => {
    const handler = (_e: unknown, info: Parameters<typeof cb>[0]): void => cb(info);
    ipcRenderer.on('pip:mode', handler);
    return () => ipcRenderer.off('pip:mode', handler);
  },
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld('yearflowDesktop', api);
