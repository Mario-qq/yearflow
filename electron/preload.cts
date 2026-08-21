/**
 * 渲染进程能看到的全部原生能力。刻意窄：跨窗口的状态同步走 localStorage + storage
 * 事件（见 main.cts 顶部注释），这里只暴露 web 侧根本做不到的四件事。
 *
 * `window.yearflowDesktop` 存在即代表跑在桌面壳里 —— src/lib/desktop.ts 据此分叉。
 */
import { contextBridge, ipcRenderer } from 'electron';

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
  notify: (body: string): Promise<boolean> => ipcRenderer.invoke('notify', body),
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
