/**
 * 1 秒单例 ticker（番茄钟规格 §8.1）—— 全站唯一的倒计时刷新源。
 *
 * ⚠️ 为什么不能用 setState 驱动倒计时：番茄钟在任何页面都可能开着，每秒一次 setState
 * 会让整棵 App 树每秒重渲一次，甘特图「拖拽 60fps / 缩放切换 <150ms」的门槛当场失守。
 * 订阅者（胶囊文本、面板 hero 数字、进度环 stroke-dashoffset、标签页 title）一律拿到
 * 现算的剩余毫秒，自己经 ref 直写 DOM，**零 React 重渲**。
 *
 * 另外两条约束：
 * · 剩余时间永远现算（remainingMs()），ticker 自己不累加、不缓存 —— 后台节流下 interval
 *   会变慢表，但它只负责「什么时候重读一次时钟」，读到的值永远准。
 * · 只在有订阅者且确实在运行时才开 interval；状态迁移（开始/暂停/结束）由 store 订阅
 *   立刻 poke 一次，不等下一个整秒。
 */
import { remainingMs } from './kernel';
import { usePomodoroStore } from './store';

export type TickFn = (msLeft: number) => void;

const subscribers = new Set<TickFn>();
let handle: ReturnType<typeof setInterval> | null = null;

function poke(): void {
  const ms = remainingMs();
  for (const fn of subscribers) fn(ms);
}

function sync(): void {
  const shouldRun = subscribers.size > 0 && usePomodoroStore.getState().running !== null;
  if (shouldRun && handle === null) handle = setInterval(poke, 1000);
  if (!shouldRun && handle !== null) {
    clearInterval(handle);
    handle = null;
  }
}

/** 状态迁移时立刻刷新一次并开关 interval（不等下一个整秒，避免暂停后数字还在跳） */
usePomodoroStore.subscribe(() => {
  sync();
  poke();
});

/** 订阅 1s 刷新；订阅时立刻回调一次当前值。返回退订函数 */
export function subscribeTick(fn: TickFn): () => void {
  subscribers.add(fn);
  sync();
  fn(remainingMs());
  return () => {
    subscribers.delete(fn);
    sync();
  };
}
