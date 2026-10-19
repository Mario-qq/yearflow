/**
 * 工作台键盘（DESK_SPEC §3.5）：N 新建 · I 待处理 · W/M 周/月 · ←/→ 翻页 · T 今天 · S 开始学习 · Esc 取消；
 * 选中后 Enter 编辑 · D 挪到… · ⇧→ 往后一天 · ⇧W 下周同一天 · ⇧M 下周一 · X 完成 · 1/2/3 紧急度 · * 重要 · F 要事 · Del 删除。
 * Ctrl+Z / / / ? / P 是全局键（App / 番茄钟），这里不占。
 */
import { useEffect } from 'react';
import { deleteItems, setUrgency } from '../store/deskActions';
import { toastUndo } from './format';
import { completeSelected, moveSelected, openMoverForSelection, selectedItemIds, toggleFocus, toggleImportant } from './commands';
import { closeOverlays, hasOverlay, useDeskUi } from './uiStore';
import { startStudy, studyNow } from './study';
import { showToast } from '../lib/toast';

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
        if (hasOverlay(ui)) closeOverlays();
        else if (ui.shutdown) ui.set({ shutdown: false });
        else if (ui.people) ui.set({ people: null });
        else if (hasSel) ui.set({ sel: new Set() });
        else if (ui.drawer) ui.set({ drawer: false });
        return;
      }
      // 收尾面板、人际弹窗是模态：开着时只认 Esc
      if (ui.shutdown || ui.people) return;
      // * 要按 Shift，放在 Shift 分支之前
      if (k === '*' && hasSel && !ui.editor) {
        const ids = selectedItemIds();
        if (ids.length) toggleImportant(ids);
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
      // 编辑卡开着：除 Esc 外不响应工作台快捷键
      if (ui.editor) return;
      if (hasSel) {
        if (k === 'Enter' && ui.sel.size === 1) {
          const id = selectedItemIds()[0];
          const el = id ? document.querySelector(`[data-key="${CSS.escape(`i:${id}`)}"]`) : null;
          if (!id || !el) return;
          e.preventDefault();
          const r = el.getBoundingClientRect();
          ui.set({ editor: { kind: 'item', id, left: r.left, top: r.bottom }, menu: null, sel: new Set() });
          return;
        }
        if (lower === 'd') return void (e.preventDefault(), openMoverForSelection());
        if (lower === 'x') return void (e.preventDefault(), completeSelected());
        if (lower === 'f') {
          const ids = selectedItemIds();
          if (ids.length) toggleFocus(ids, today);
          return;
        }
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
      } else if (lower === 'i') ui.set({ drawer: !ui.drawer, drawerTab: 'pending' });
      else if (lower === 'w') ui.setView('week');
      else if (lower === 'm') ui.setView('month');
      else if (lower === 't') goToday();
      else if (lower === 's') {
        if (studyNow(today).running) showToast('正在学，结束后再开下一段');
        else startStudy(today);
      }
      else if (k === 'ArrowLeft') step(-1);
      else if (k === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [today, step, goToday]);
}
