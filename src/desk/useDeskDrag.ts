/**
 * 工作台拖拽：任意一行按住拖 3px 起拖 → 右下角浮出「挪到…」小月历；
 * 落点 = 日卡 / 月历格（今天及以后）/ 小月历某天 / 「放进待处理」。多选时拖任意一行带走全部选中。
 *
 * 性能约定（CLAUDE.md：拖拽中只改 transform）：拖动中**不触发 React 重绘** ——
 * 影子跟手只改 transform，落点高亮与小月历顶部提示直接改 class/textContent；
 * React 状态只在起拖（dragging + mover）与落下（挪动 + 关浮层）两个时刻各变一次。
 */
import { useEffect, type RefObject } from 'react';
import { moveKeys } from '../store/deskActions';
import { DRAG_THRESHOLD } from './constants';
import { md, relDay, toastMove } from './format';
import { parseKeys } from './keys';
import { useDeskUi } from './uiStore';

interface DragState {
  key: string;
  x: number;
  y: number;
  on: boolean;
  keys: string[];
  ghost?: HTMLDivElement;
  /** undefined = 没落在可放的地方；null = 待处理；字符串 = 日期 */
  target?: string | null;
  lastHot?: Element | null;
}

const HOT = ['drop', 'hov'];

export function useDeskDrag(rootRef: RefObject<HTMLDivElement | null>, today: string): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let drag: DragState | null = null;
    let swallowClick = false;

    const clearHot = () => {
      if (drag?.lastHot) drag.lastHot.classList.remove(...HOT);
      if (drag) drag.lastHot = null;
    };

    const finish = (apply: boolean) => {
      const d = drag;
      drag = null;
      if (!d || !d.on) return;
      d.ghost?.remove();
      if (d.lastHot) d.lastHot.classList.remove(...HOT);
      root.classList.remove('dragging');
      root.querySelectorAll('.dk-row.ghosted').forEach((el) => el.classList.remove('ghosted'));
      swallowClick = true; // 松手那一下的 click 不要再当成「选中/打开」
      setTimeout(() => (swallowClick = false), 0);
      useDeskUi.getState().set({ dragging: false, mover: null });
      if (!apply || d.target === undefined) return;
      const r = moveKeys(parseKeys(d.keys), d.target);
      useDeskUi.getState().set({ sel: new Set() });
      toastMove(d.target, today, r);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as Element;
      if (t.closest('button, input, .dk-pop, .dk-menu')) return;
      const row = t.closest<HTMLElement>('.dk-row[data-key]');
      if (!row || !root.contains(row)) return;
      drag = { key: row.dataset.key!, x: e.clientX, y: e.clientY, on: false, keys: [] };
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      if (!drag.on) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD) return;
        const ui = useDeskUi.getState();
        drag.on = true;
        drag.keys = ui.sel.has(drag.key) ? [...ui.sel] : [drag.key];
        root.classList.add('dragging');
        const keys = new Set(drag.keys);
        root.querySelectorAll<HTMLElement>('.dk-row[data-key]').forEach((el) => keys.has(el.dataset.key!) && el.classList.add('ghosted'));
        const g = document.createElement('div');
        g.className = 'dk-ghost';
        const title = root.querySelector(`.dk-row[data-key="${CSS.escape(drag.key)}"] .dk-t`)?.textContent ?? '';
        g.textContent = drag.keys.length > 1 ? `${drag.keys.length} 件` : title;
        root.appendChild(g);
        drag.ghost = g;
        ui.set({ dragging: true, mover: { mode: 'drag', keys: drag.keys }, menu: null, quickAdd: false });
      }
      const g = drag.ghost!;
      // 靠右时影子放到光标左边，别盖住右下角的小月历
      const left = e.clientX > window.innerWidth * 0.6 ? e.clientX - g.offsetWidth - 14 : e.clientX + 14;
      g.style.transform = `translate(${left}px, ${e.clientY + 12}px)`;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const hit =
        el?.closest('[data-mv]') ?? el?.closest('[data-mv-pending]') ?? el?.closest('.dk-day[data-day], .dk-mc[data-day]') ?? null;
      let target: string | null | undefined;
      if (hit?.hasAttribute('data-mv')) target = hit.getAttribute('data-mv');
      else if (hit?.hasAttribute('data-mv-pending')) target = null;
      else if (hit) {
        const day = hit.getAttribute('data-day')!;
        target = day >= today ? day : undefined; // 过去的日子不能落
      }
      const hot = target === undefined ? null : hit;
      if (hot !== drag.lastHot) {
        clearHot();
        hot?.classList.add(hit?.hasAttribute('data-day') ? 'drop' : 'hov');
        drag.lastHot = hot;
      }
      drag.target = target;
      const tip = document.querySelector('[data-mv-tip]');
      if (tip) tip.textContent = target === undefined ? ' ' : target === null ? '→ 放进待处理' : `→ ${relDay(target, today)} · ${md(target)}`;
    };

    const onUp = () => {
      if (drag && !drag.on) {
        drag = null;
        return;
      }
      finish(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag?.on) {
        e.stopPropagation();
        finish(false);
      }
    };
    const onClickCapture = (e: MouseEvent) => {
      if (swallowClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    root.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('click', onClickCapture, true);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('click', onClickCapture, true);
      drag?.ghost?.remove();
    };
  }, [rootRef, today]);
}
