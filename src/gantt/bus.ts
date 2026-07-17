/**
 * 甘特图内部轻量事件总线：顶栏工具/命令面板/快捷键（在 App 树里）与 GanttView 之间的命令通道。
 */
interface GanttEvents {
  'scroll-to-today': undefined;
  /** 命令面板/左栏定位：滚动到任务并闪烁（目标折叠时先展开） */
  'locate-task': { taskId: string };
  /** 命令面板「切到 N 月」 */
  'scroll-to-date': { date: string };
  /** 导出当前视图 PNG */
  'export-png': undefined;
}

type GanttEventName = keyof GanttEvents;

const target = new EventTarget();

export function emitGantt<K extends GanttEventName>(
  name: K,
  ...detail: GanttEvents[K] extends undefined ? [] : [GanttEvents[K]]
): void {
  target.dispatchEvent(new CustomEvent(name, { detail: detail[0] }));
}

export function onGantt<K extends GanttEventName>(
  name: K,
  handler: (detail: GanttEvents[K]) => void,
): () => void {
  const fn = (e: Event) => handler((e as CustomEvent).detail as GanttEvents[K]);
  target.addEventListener(name, fn);
  return () => target.removeEventListener(name, fn);
}
