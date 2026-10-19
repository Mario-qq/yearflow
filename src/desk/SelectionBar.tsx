/** 选中后底部浮出的一条：挪到…（D）· 明天 · 下周一（⇧M）· 下周同一天（⇧W）· 紧急度 · 重要（*）· 要事（F）· 完成（X）· 不做了 · ✕ */
import { dropItems } from '../store/deskActions';
import { completeSelected, moveSelected, openMoverFor, selectedItemIds, toggleFocus, toggleImportant } from './commands';
import { toastUndo } from './format';
import { useDeskUi } from './uiStore';

export function SelectionBar({ today }: { today: string }) {
  const n = useDeskUi((s) => s.sel.size);
  const hasItems = useDeskUi((s) => [...s.sel].some((k) => k.startsWith('i:')));
  if (n === 0) return null;
  return (
    <div className="dk-selbar" onClick={(e) => e.stopPropagation()}>
      <span className="n tnum">已选 {n} 件</span>
      <span className="sep" />
      <button type="button" className="go" data-mover-anchor onClick={(e) => openMoverFor([...useDeskUi.getState().sel], e.currentTarget)}>
        挪到… <kbd>D</kbd>
      </button>
      <button type="button" onClick={() => moveSelected('tomorrow', today)}>
        明天
      </button>
      <button type="button" onClick={() => moveSelected('nextMonday', today)}>
        下周一 <kbd>⇧M</kbd>
      </button>
      <button type="button" onClick={() => moveSelected('sameDayNextWeek', today)}>
        下周同一天 <kbd>⇧W</kbd>
      </button>
      {hasItems && (
        <>
          <span className="sep" />
          <button
            type="button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              useDeskUi.getState().set({ menu: { kind: 'urgency', x: r.left, y: r.top - 112 } });
            }}
          >
            紧急度
          </button>
          <button type="button" onClick={() => toggleImportant(selectedItemIds())}>
            重要 <kbd>*</kbd>
          </button>
          <button type="button" onClick={() => toggleFocus(selectedItemIds(), today)}>
            要事 <kbd>F</kbd>
          </button>
          <button type="button" onClick={completeSelected}>
            完成 <kbd>X</kbd>
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              const ids = selectedItemIds();
              dropItems(ids);
              useDeskUi.getState().set({ sel: new Set() });
              toastUndo(`不做了：${ids.length} 件`);
            }}
          >
            不做了
          </button>
        </>
      )}
      <button type="button" title="取消选择（Esc）" onClick={() => useDeskUi.getState().set({ sel: new Set() })}>
        ✕
      </button>
    </div>
  );
}
