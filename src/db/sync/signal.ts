/**
 * 本地写入信号 — 无依赖的极简事件通道。
 * persist 落库完成后 emit，同步引擎订阅（防抖 3 秒触发推送）。
 * 独立成模块以斩断 persist ↔ engine 的循环导入。
 */

type Listener = () => void;
const listeners = new Set<Listener>();

export function onLocalWrite(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitLocalWrite(): void {
  for (const fn of listeners) fn();
}
