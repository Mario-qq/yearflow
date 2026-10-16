/** 待处理抽屉：还没排日子的事。平时收起（工具条上一个带件数的按钮），I 或点按钮滑出；拖到某天即排期 */
import { pendingItems } from '../lib/derive/desk';
import { ItemRow } from './Rows';
import { useDeskUi } from './uiStore';
import type { WorkItem } from '../types/domain';

export function PendingDrawer({ items, today }: { items: WorkItem[]; today: string }) {
  const open = useDeskUi((s) => s.drawer);
  if (!open) return null;
  const list = pendingItems(items, today);
  return (
    <aside className="dk-drawer" onClick={(e) => e.stopPropagation()}>
      <div className="dk-dr-h">
        <b>待处理</b>
        <small className="tnum">{list.length} 件</small>
        <span className="dk-grow" />
        <button type="button" className="dk-btn ghost" title="收起（I / Esc）" onClick={() => useDeskUi.getState().set({ drawer: false })}>
          收起
        </button>
      </div>
      <div className="dk-dr-tip">还没排日子的事。拖到某一天就排上了；拖动时会浮出小月历。</div>
      <div className="dk-dr-b">
        {list.length ? list.map((i) => <ItemRow key={i.id} item={i} today={today} />) : <div className="dk-empty">没有待处理的事</div>}
      </div>
    </aside>
  );
}
