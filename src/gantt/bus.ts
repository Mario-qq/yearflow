/**
 * 甘特图内部轻量事件总线：顶栏工具（在 App header 树里）与 GanttView 之间的命令通道。
 * Phase 3 的快捷键（T 回今天等）复用同一通道。
 */
type GanttEventName = 'scroll-to-today';

const target = new EventTarget();

export function emitGantt(name: GanttEventName): void {
  target.dispatchEvent(new Event(name));
}

export function onGantt(name: GanttEventName, handler: () => void): () => void {
  target.addEventListener(name, handler);
  return () => target.removeEventListener(name, handler);
}
