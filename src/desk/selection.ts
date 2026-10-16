/** 选择：单击单选（再点取消）、Ctrl 加减、Shift 连选（按屏幕上的先后顺序） */
import type React from 'react';
import { useDeskUi } from './uiStore';

/** 当前屏幕上可选的行，按文档顺序（周历从周一到周日、每列从上到下） */
export function visibleKeys(): string[] {
  return [...document.querySelectorAll('.dk-board [data-key], .dk-month [data-key], .dk-drawer [data-key]')]
    .map((el) => el.getAttribute('data-key'))
    .filter((k): k is string => k !== null);
}

export function clickSelect(e: React.MouseEvent | MouseEvent, key: string): void {
  const ui = useDeskUi.getState();
  let sel = new Set(ui.sel);
  if (e.shiftKey && ui.lastKey) {
    const vk = visibleKeys();
    const a = vk.indexOf(ui.lastKey);
    const b = vk.indexOf(key);
    if (a >= 0 && b >= 0) for (const k of vk.slice(Math.min(a, b), Math.max(a, b) + 1)) sel.add(k);
    else sel.add(key);
  } else if (e.ctrlKey || e.metaKey) {
    if (sel.has(key)) sel.delete(key);
    else sel.add(key);
  } else {
    sel = sel.size === 1 && sel.has(key) ? new Set() : new Set([key]);
  }
  ui.set({ sel, lastKey: e.shiftKey ? ui.lastKey : key });
}

export function selectOnly(keys: string[]): void {
  useDeskUi.getState().set({ sel: new Set(keys), lastKey: keys[keys.length - 1] ?? null });
}

export function clearSelection(): void {
  const ui = useDeskUi.getState();
  if (ui.sel.size > 0) ui.set({ sel: new Set() });
}
