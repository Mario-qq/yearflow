/**
 * 轻量庆祝总线：目标完成时在指定屏幕坐标放一次彩带。
 * Celebration 组件（App 挂载）消费；respect prefers-reduced-motion 时降级为无动效。
 */
export interface CelebrateEvent {
  id: number;
  x: number;
  y: number;
}

type Listener = (e: CelebrateEvent) => void;

let nextId = 1;
const listeners = new Set<Listener>();

/** 在屏幕坐标 (x, y) 触发一次彩带（通常传右键菜单/目标行位置） */
export function celebrate(x: number, y: number): void {
  const e = { id: nextId++, x, y };
  for (const l of listeners) l(e);
}

export function subscribeCelebrate(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
