/**
 * 右侧抽屉，平时收起（工具条上一个带件数的按钮），I 或点按钮滑出。两页：
 * - 待处理：还没排日子的事，拖到某天即排期；
 * - 例行：全部例行（含暂停的），在这里新建、编辑、暂停 / 恢复、删除 —— 暂停的例行周历上不出现，只能在这里找回。
 * - 习惯：同上，管理日常习惯（暂停的不在今天顶上出现）。
 */
import { useMemo } from 'react';
import { pendingItems, ruleLabel } from '../lib/derive/desk';
import { deleteRoutine, patchRoutine } from '../store/deskActions';
import { useStore } from '../store/useStore';
import { toastUndo } from './format';
import { ItemRow } from './Rows';
import { useDeskUi } from './uiStore';
import { HabitList } from './Habits';
import type { Routine, WorkItem } from '../types/domain';

function openRoutineEditor(e: React.MouseEvent, id: string | null) {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  // 抽屉在右边：编辑卡开在抽屉左侧
  useDeskUi.getState().set({ editor: { kind: 'routine', id, left: r.left - 400, top: r.top } });
}

function RoutineList() {
  const routines = useStore((s) => s.routines);
  const list = useMemo(
    () =>
      Object.values(routines)
        .filter((r) => !r.deletedAt)
        .sort((a, b) => Number(Boolean(a.paused)) - Number(Boolean(b.paused)) || (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.order - b.order),
    [routines],
  );
  const row = (r: Routine) => (
    <div key={r.id} className={`dk-rl${r.paused ? ' paused' : ''}`} onClick={(e) => openRoutineEditor(e, r.id)} title={r.note ? `${r.title}\n${r.note}` : r.title}>
      <div className="dk-rl-main">
        <span className="dk-rl-t">{r.title}</span>
        <span className="dk-rl-m tnum">
          {ruleLabel(r.rule)}
          {r.time ? ` ${r.time}` : ''} · {r.scope === 'work' ? '工作' : '生活'}
          {r.paused ? ' · 已暂停' : ''}
        </span>
      </div>
      <button
        type="button"
        className="dk-rl-b"
        onClick={(e) => {
          e.stopPropagation();
          patchRoutine(r.id, { paused: r.paused ? undefined : true }, `${r.paused ? '恢复' : '暂停'}例行「${r.title}」`);
          toastUndo(r.paused ? `已恢复「${r.title}」` : `已暂停「${r.title}」`);
        }}
      >
        {r.paused ? '恢复' : '暂停'}
      </button>
      <button
        type="button"
        className="dk-rl-b danger"
        title="删除这个例行（做过的记录保留）"
        onClick={(e) => {
          e.stopPropagation();
          deleteRoutine(r.id);
          toastUndo(`删除例行「${r.title}」`);
        }}
      >
        删除
      </button>
    </div>
  );
  return (
    <>
      <div className="dk-dr-tip">规则自动铺到周历上；工作类只在工作日出现。点一行编辑。</div>
      <div className="dk-dr-act">
        <button type="button" className="dk-btn" onClick={(e) => openRoutineEditor(e, null)}>
          ＋ 新例行
        </button>
      </div>
      <div className="dk-dr-b">{list.length ? list.map(row) : <div className="dk-empty">还没有例行。也可以在新建里写「每周一 9:00 提交周报」</div>}</div>
    </>
  );
}

export function PendingDrawer({ items, today }: { items: WorkItem[]; today: string }) {
  const open = useDeskUi((s) => s.drawer);
  const tab = useDeskUi((s) => s.drawerTab);
  const routineN = useStore((s) => Object.values(s.routines).filter((r) => !r.deletedAt && !r.paused).length);
  const habitN = useStore((s) => Object.values(s.habits).filter((h) => !h.deletedAt && !h.paused).length);
  if (!open) return null;
  const list = pendingItems(items, today);
  return (
    <aside className="dk-drawer" onClick={(e) => e.stopPropagation()}>
      <div className="dk-dr-h">
        <div className="dk-seg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'on' : ''} onClick={() => useDeskUi.getState().set({ drawerTab: 'pending' })}>
            待处理 <span className="tnum">{list.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'routines'} className={tab === 'routines' ? 'on' : ''} onClick={() => useDeskUi.getState().set({ drawerTab: 'routines' })}>
            例行 <span className="tnum">{routineN}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'habits'} className={tab === 'habits' ? 'on' : ''} onClick={() => useDeskUi.getState().set({ drawerTab: 'habits' })}>
            习惯 <span className="tnum">{habitN}</span>
          </button>
        </div>
        <span className="dk-grow" />
        <button type="button" className="dk-btn ghost" title="收起（I / Esc）" onClick={() => useDeskUi.getState().set({ drawer: false })}>
          收起
        </button>
      </div>
      {tab === 'pending' ? (
        <>
          <div className="dk-dr-tip">还没排日子的事。拖到某一天就排上了；拖动时会浮出小月历。</div>
          <div className="dk-dr-b">{list.length ? list.map((i) => <ItemRow key={i.id} item={i} today={today} />) : <div className="dk-empty">没有待处理的事</div>}</div>
        </>
      ) : tab === 'routines' ? (
        <RoutineList />
      ) : (
        <HabitList />
      )}
    </aside>
  );
}
