/**
 * 年报的轻量命令通道：命令面板（在 App 树里，主包）与 YearReportPage（lazy chunk）之间。
 * 与 gantt/bus.ts 同构 —— 不另发明一套，也不为此把 store 撑大。
 *
 * ⚠️ 本文件**必须零 import**：它被命令面板引用 ⇒ 会落进主包。一旦从这里 import 了
 * annual/constants 或 derive/annual，整个年报域就会被拖进主包，规格 §六「主包 gzip
 * 增量 0」当场作废（Y2 已经在 barrel 上踩过一次同型的坑）。
 */
interface AnnualEvents {
  /** 命令面板「导出年报长图」：跳到 /year 后由页面接住，复用页面里那条导出路径 */
  'export-png': undefined;
}

type AnnualEventName = keyof AnnualEvents;

const target = new EventTarget();

export function emitAnnual<K extends AnnualEventName>(
  name: K,
  ...detail: AnnualEvents[K] extends undefined ? [] : [AnnualEvents[K]]
): void {
  target.dispatchEvent(new CustomEvent(name, { detail: detail[0] }));
}

export function onAnnual<K extends AnnualEventName>(
  name: K,
  handler: (detail: AnnualEvents[K]) => void,
): () => void {
  const fn = (e: Event) => handler((e as CustomEvent).detail as AnnualEvents[K]);
  target.addEventListener(name, fn);
  return () => target.removeEventListener(name, fn);
}

/*
 * 从别的页面「导出年报长图」时，页面还没挂载，emit 出去没人接。
 * 甘特那条路靠 setTimeout(150ms) 赌 GanttView 已挂载 —— 年报走 lazy()，chunk 什么时候
 * 落地取决于网络与磁盘，赌不得。所以改成**闩锁**：命令面板置位，页面挂载时取走。
 * 谁先谁后都成立，也就没有需要调的魔数延时。
 */
let pendingExport = false;

/** 命令面板用：请求一次导出（页面已在场就立刻触发，否则留给它挂载时取） */
export function requestAnnualExport(onPage: boolean): void {
  if (onPage) emitAnnual('export-png');
  else pendingExport = true;
}

/** 页面挂载时用：取走并清掉挂起的导出请求（只兑现一次） */
export function takePendingExport(): boolean {
  const p = pendingExport;
  pendingExport = false;
  return p;
}
