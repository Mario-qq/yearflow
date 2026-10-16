/** 轻量 toast 总线：undo/redo 摘要、操作确认。Toasts 组件（App 挂载）消费。 */

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: number;
  text: string;
  /** 可选的一个就地操作（如「撤销」）；带操作的 toast 多停一会儿，给人点的时间 */
  action?: ToastAction;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

const MAX_VISIBLE = 3;
const TOAST_MS = 2600;
const TOAST_ACTION_MS = 4500;

function emit(): void {
  for (const l of listeners) l(items);
}

export function showToast(text: string, action?: ToastAction): void {
  const item: ToastItem = { id: nextId++, text, action };
  items = [...items.slice(-(MAX_VISIBLE - 1)), item];
  emit();
  setTimeout(() => {
    items = items.filter((i) => i.id !== item.id);
    emit();
  }, action ? TOAST_ACTION_MS : TOAST_MS);
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  l(items);
  return () => {
    listeners.delete(l);
  };
}
