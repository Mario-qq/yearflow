/**
 * 桌面壳（Electron）的唯一入口。web 构建下 `desktop()` 恒为 null，所有分支自然走回网页路径。
 *
 * 判定用「preload 是否注入了 window.yearflowDesktop」，而不是 UA 嗅探 —— 前者是我们自己
 * 的契约（electron/preload.cts），后者会被 Electron 的 UA 里那个 Chrome 版本号骗过去。
 *
 * ⚠️ 这里刻意只有 web 侧根本做不到的几件事。桌面版小窗与主窗之间的**状态同步不走这里**：
 * 计时权威状态在 localStorage（pomodoro/running.ts），跨窗口通知靠 storage 事件 +
 * navigator.locks 选主（pomodoro/kernel.ts），两个同 origin 窗口天然共享 —— Phase 0 spike
 * 已实测。窗口**几何**是唯一的例外：网页无权改自己的窗，那一整套只能由主进程持有。
 */

/** 吸附到屏幕哪一边 */
export type PipEdge = 'left' | 'right' | 'top' | 'bottom';
/**
 * 小窗形态。free = 自由浮动；docked = 收成窄药丸贴住 edge；
 * peek = 收起态下鼠标移上去、临时展开成完整尺寸（松开鼠标就回 docked）。
 */
export interface PipModeInfo {
  mode: 'free' | 'docked' | 'peek';
  edge: PipEdge | null;
}

export interface DesktopApi {
  openPip(): Promise<boolean>;
  closePip(): Promise<boolean>;
  closeSelf(): Promise<void>;
  setPipOpacity(percent: number): Promise<number>;
  /** 收起到最近的屏幕边缘（不要求先把窗拖过去） */
  dockPip(): Promise<void>;
  /** 脱离边缘，回到收起前的自由位置与尺寸 */
  undockPip(): Promise<void>;
  /** 收起态的鼠标进出：true 临时展开，false 收回 */
  peekPip(on: boolean): Promise<void>;
  focusMain(): Promise<void>;
  notify(body: string): Promise<boolean>;
  onPowerResume(cb: () => void): () => void;
  onPipState(cb: (open: boolean) => void): () => void;
  onPipMode(cb: (info: PipModeInfo) => void): () => void;
  /**
   * 光标是否落在小窗上。窗内**测不出来**：整块窗体是 `-webkit-app-region: drag`，
   * 原生 hit-test 把鼠标判给「移动窗口」，:hover / onPointerEnter 一概不触发。
   */
  onPipHover(cb: (on: boolean) => void): () => void;
}

export function desktop(): DesktopApi | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { yearflowDesktop?: DesktopApi }).yearflowDesktop ?? null;
}

export function isDesktop(): boolean {
  return desktop() !== null;
}
