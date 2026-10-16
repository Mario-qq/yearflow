/**
 * 工作台的界面命令（选中条、菜单、键盘共用）。不放组件文件里：React Fast Refresh 要求组件文件只导出组件。
 */
import type { MoveHow } from '../lib/derive/desk';
import { completeItems, moveKeys } from '../store/deskActions';
import type { WorkItem } from '../types/domain';
import { toastMove, toastUndo } from './format';
import { itemKey, occKey, parseKeys } from './keys';
import type { DayData } from './useDeskData';
import { useDeskUi } from './uiStore';

export function openMoverFor(keys: string[], anchorEl: Element | null): void {
  const r = anchorEl?.getBoundingClientRect();
  useDeskUi.getState().set({ mover: { mode: 'click', keys, anchor: r ? { left: r.left, top: r.top, bottom: r.bottom } : undefined }, menu: null });
}

export function moveSelected(how: MoveHow, today: string): void {
  const ui = useDeskUi.getState();
  const r = moveKeys(parseKeys(ui.sel), how);
  ui.set({ sel: new Set() });
  toastMove(how, today, r);
}

/** 选中里的事项 id（例行的一次不参与完成/不做了/紧急度） */
export const selectedItemIds = (): string[] =>
  parseKeys(useDeskUi.getState().sel).flatMap((k) => (k.type === 'item' ? [k.id] : []));

export function completeSelected(): void {
  const ids = selectedItemIds();
  if (!ids.length) return;
  completeItems(ids);
  useDeskUi.getState().set({ sel: new Set() });
  toastUndo(`完成 ${ids.length} 件`);
}

/** 这天没做完的：事项 + 没做的例行（补做的不算，它们属于别的日子） */
export function undoneKeysOf(d: DayData, today: string): string[] {
  return [
    ...(d.date === today ? d.day.rolled : []).map((i) => itemKey(i.id)),
    ...d.day.open.map((i) => itemKey(i.id)),
    ...d.occ.filter((o) => o.status === 'open' && !o.makeup).map((o) => occKey(o.routine.id, o.origDate)),
  ];
}

/** 键盘 D：选中了就弹挪到…（挂在选中条的按钮上） */
export function openMoverForSelection(): void {
  const sel = useDeskUi.getState().sel;
  if (sel.size === 0) return;
  openMoverFor([...sel], document.querySelector('.dk-selbar [data-mover-anchor]'));
}

export function copyTextFor(person: string, items: WorkItem[]): string {
  return `${person}，同步几件事：\n${items.map((i, n) => `${n + 1}. ${i.mode === 'dispatch' ? '【下发】' : ''}${i.title}`).join('\n')}`;
}

