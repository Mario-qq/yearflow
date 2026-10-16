/**
 * 工作台键盘（DESK_SPEC §3.5）：N 新建 · I 待处理 · W/M 周/月 · ←/→ 翻页 · T 今天 · Esc 取消；
 * 选中后 D 挪到… · ⇧→ 往后一天 · ⇧W 下周同一天 · ⇧M 下周一 · X 完成 · 1/2/3 紧急度 · Del 删除。
 * Ctrl+Z / / / ? / P 是全局键（App / 番茄钟），这里不占。
 */
import { useEffect } from 'react';
import { deleteItems, setUrgency } from '../store/deskActions';
import { toastUndo } from './format';
import { completeSelected, moveSelected, openMoverForSelection, selectedItemIds } from './commands';
import { closeOverlays, useDeskUi } from './uiStore';

export function useDeskKeys(today: string, step: (n: number) => void, goToday: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
      const ui = useDeskUi.getState();
      if (ui.dragging) return;
      const k = e.key;
      const hasSel = ui.sel.size > 0;

      if (k === 'Escape') {
        if (ui.menu || ui.mover || ui.person || ui.quickAdd) closeOverlays();
        else if (hasSel) ui.set({ sel: new Set() });
        else if (ui.drawer) ui.set({ drawer: false });
        return;
      }
      if (e.shiftKey && hasSel) {
        if (k === 'ArrowRight') moveSelected('tomorrow', today);
        else if (k === 'W' || k === 'w') moveSelected('sameDayNextWeek', today);
        else if (k === 'M' || k === 'm') moveSelected('nextMonday', today);
        else return;
        e.preventDefault();
        return;
      }
      if (e.shiftKey) return;
      const lower = k.toLowerCase();
      if (hasSel) {
        if (lower === 'd') return void (e.preventDefault(), openMoverForSelection());
        if (lower === 'x') return void (e.preventDefault(), completeSelected());
        if (k === '1' || k === '2' || k === '3') {
          const ids = selectedItemIds();
          if (ids.length) setUrgency(ids, k === '1' ? 'urgent' : k === '2' ? 'soon' : 'normal');
          return;
        }
        if (k === 'Delete' || k === 'Backspace') {
          const ids = selectedItemIds();
          if (!ids.length) return;
          e.preventDefault();
          deleteItems(ids);
          ui.set({ sel: new Set() });
          toastUndo(`删除 ${ids.length} 件`);
          return;
        }
      }
      if (lower === 'n') {
        e.preventDefault();
        ui.set({ quickAdd: true, menu: null });
      } else if (lower === 'i') ui.set({ drawer: !ui.drawer });
      else if (lower === 'w') ui.setView('week');
      else if (lower === 'm') ui.setView('month');
      else if (lower === 't') goToday();
      else if (k === 'ArrowLeft') step(-1);
      else if (k === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [today, step, goToday]);
}
