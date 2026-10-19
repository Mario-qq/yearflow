/**
 * 工作台的界面命令（选中条、菜单、键盘共用）。不放组件文件里：React Fast Refresh 要求组件文件只导出组件。
 */
import { isFocusOn, MAX_FOCUS, type MoveHow } from '../lib/derive/desk';
import { completeItems, moveKeys, setFocus, setImportant } from '../store/deskActions';
import { useStore } from '../store/useStore';
import { showToast } from '../lib/toast';
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


/** 事项在哪天当要事：排在以后的 = 那天；今天、顺延来的、待处理的 = 今天 */
const focusDateOf = (w: WorkItem, today: string): string => (w.date && w.date > today ? w.date : today);

/** 设为 / 移出要事（全都已是要事 ⇒ 移出，否则设上）。按各自的日子分组，超出每天上限的提示 */
export function toggleFocus(ids: string[], today: string): void {
  const items = ids.map((id) => useStore.getState().workItems[id]).filter((w): w is WorkItem => Boolean(w) && w.status !== 'dropped');
  if (!items.length) return;
  if (items.every((w) => isFocusOn(w, focusDateOf(w, today)))) {
    setFocus(
      items.map((w) => w.id),
      null,
    );
    toastUndo(`移出要事：${items.length} 件`);
    return;
  }
  const byDate = new Map<string, string[]>();
  for (const w of items) byDate.set(focusDateOf(w, today), [...(byDate.get(focusDateOf(w, today)) ?? []), w.id]);
  let over = 0;
  for (const [d, list] of byDate) over += setFocus(list, d);
  if (over) showToast(`每天最多 ${MAX_FOCUS} 件要事，有 ${over} 件没设上——先移出一件`);
  else toastUndo(`设为要事：${items.length} 件`);
}

/** 标为重要 / 取消重要（全都重要 ⇒ 取消） */
export function toggleImportant(ids: string[]): void {
  const items = ids.map((id) => useStore.getState().workItems[id]).filter(Boolean);
  if (!items.length) return;
  const on = !items.every((w) => w.important);
  setImportant(ids, on);
  toastUndo(`${on ? '标为重要' : '取消重要'}：${ids.length} 件`);
}
