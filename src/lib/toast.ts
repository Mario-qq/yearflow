/** 轻量 toast 总线：undo/redo 摘要、操作确认。Toasts 组件（App 挂载）消费。 */

export interface ToastItem {
  id: number;
  text: string;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

const MAX_VISIBLE = 3;
const TOAST_MS = 2600;

function emit(): void {
  for (const l of listeners) l(items);
}

export function showToast(text: string): void {
  const item = { id: nextId++, text };
  items = [...items.slice(-(MAX_VISIBLE - 1)), item];
  emit();
  setTimeout(() => {
    items = items.filter((i) => i.id !== item.id);
    emit();
  }, TOAST_MS);
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  l(items);
  return () => {
    listeners.delete(l);
  };
}
