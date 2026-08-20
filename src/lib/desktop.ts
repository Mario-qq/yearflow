/**
 * 桌面壳（Electron）的唯一入口。web 构建下 `desktop()` 恒为 null，所有分支自然走回网页路径。
 *
 * 判定用「preload 是否注入了 window.yearflowDesktop」，而不是 UA 嗅探 —— 前者是我们自己
 * 的契约（electron/preload.cts），后者会被 Electron 的 UA 里那个 Chrome 版本号骗过去。
 *
 * ⚠️ 这里刻意只有四个能力。桌面版小窗与主窗之间的**状态同步不走这里**：计时权威状态在
 * localStorage（pomodoro/running.ts），跨窗口通知靠 storage 事件 + navigator.locks 选主
 * （pomodoro/kernel.ts），两个同 origin 窗口天然共享 —— Phase 0 spike 已实测。
 */
export interface DesktopApi {
  openPip(): Promise<boolean>;
  closePip(): Promise<boolean>;
  closeSelf(): Promise<void>;
  focusMain(): Promise<void>;
  notify(body: string): Promise<boolean>;
  onPowerResume(cb: () => void): () => void;
  onPipState(cb: (open: boolean) => void): () => void;
}

export function desktop(): DesktopApi | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { yearflowDesktop?: DesktopApi }).yearflowDesktop ?? null;
}

export function isDesktop(): boolean {
  return desktop() !== null;
}
