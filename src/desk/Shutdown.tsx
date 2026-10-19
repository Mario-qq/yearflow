/**
 * 下班收尾（Cal Newport 的 shutdown ritual + Ivy Lee）：三步，几十秒做完，然后心安理得下班。
 * ① 今天做完了什么（看一眼，给自己一点进展感）
 * ② 没做完的逐条给个去处：下个工作日 / 挑日子 / 待处理 / 不做了 / 其实做完了 —— 不再默默顺延成「拖了 N 天」
 * ③ 挑下个工作日的要事（最多 3 件）
 * 「收工」记在本机（每天一次）；头部到点提醒，桌面版到点发一次通知。每个操作照常进撤销栈。
 */
import { useMemo } from 'react';
import { MAX_FOCUS, isFocusOn, nextWorkday, rolledDays } from '../lib/derive/desk';
import { showToast } from '../lib/toast';
import { dropItems, moveKeys, toggleItem } from '../store/deskActions';
import { useStore } from '../store/useStore';
import { FocusList } from './Pickers';
import { md, relDay, toastMove, toastUndo, weekdayCn } from './format';
import type { DayData } from './useDeskData';
import { useDeskUi } from './uiStore';
import type { PlanRowData } from './usePlanRows';

const close = () => useDeskUi.getState().set({ shutdown: false });

export function ShutdownSheet({ today, dayOf, plan }: { today: string; dayOf: (d: string) => DayData; plan: PlanRowData[] }) {
  const open = useDeskUi((s) => s.shutdown);
  const marks = useStore((s) => s.dayMarks);
  const workItems = useStore((s) => s.workItems);
  const shutdownAt = useStore((s) => s.settings.desk.shutdownAt);
  const items = useMemo(() => Object.values(workItems), [workItems]);
  if (!open) return null;

  const t = dayOf(today);
  const left = [...t.day.rolled, ...t.day.open];
  const doneTitles = [
    ...t.day.done.map((i) => i.title),
    ...t.occ.filter((o) => o.status === 'done').map((o) => o.routine.title),
    ...plan.filter((p) => p.status === 'done' || p.status === 'partial').map((p) => p.taskName),
  ];
  const next = nextWorkday(today, marks);
  const rd = relDay(next, today);
  const nextLabel = rd === '明天' ? `明天（${weekdayCn(next)}）` : rd;
  const nextFocus = items.filter((i) => isFocusOn(i, next)).length;

  const move = (id: string, to: string | null) => {
    const r = moveKeys([{ type: 'item', id }], to);
    toastMove(to, today, r);
  };

  return (
    <div className="dk-modal" onClick={close}>
      <div className="dk-sd" role="dialog" aria-label="收尾今天" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close())}>
        <div className="dk-sd-h">
          <div>
            <b>收尾今天</b>
            <small className="tnum">
              {Number(today.slice(5, 7))}月{Number(today.slice(8, 10))}日 {weekdayCn(today)} · 给每件没做完的一个去处，然后放心下班
            </small>
          </div>
          <span className="dk-grow" />
          <button type="button" className="dk-btn ghost" onClick={close} aria-label="关闭">
            ✕
          </button>
        </div>

        <section className="dk-sd-s">
          <div className="dk-sd-k">
            <span className="no">1</span>今天做完了 <b className="tnum">{doneTitles.length}</b> 件
          </div>
          {doneTitles.length > 0 ? (
            <div className="dk-sd-done">
              {doneTitles.map((x, n) => (
                <span key={n}>{x}</span>
              ))}
            </div>
          ) : (
            <div className="dk-empty">今天还没勾掉什么——也没关系，把下面安排好</div>
          )}
        </section>

        <section className="dk-sd-s">
          <div className="dk-sd-k">
            <span className="no">2</span>没做完的 <b className="tnum">{left.length}</b> 件
            <span className="dk-grow" />
            {left.length > 1 && (
              <button
                type="button"
                className="dk-btn"
                onClick={() => {
                  const r = moveKeys(
                    left.map((i) => ({ type: 'item', id: i.id })),
                    next,
                  );
                  toastMove(next, today, r);
                }}
              >
                全部挪到{nextLabel}
              </button>
            )}
          </div>
          {left.length === 0 && <div className="dk-empty ok">都安排好了</div>}
          {left.map((i) => (
            <div key={i.id} className={`dk-sd-row${i.important ? ' imp' : ''}`}>
              <span className="t" title={i.title}>
                {i.important && <i className="dk-imp" aria-label="重要" />}
                {i.title}
                {rolledDays(i, today) > 0 && <small className="tnum"> · 拖了 {rolledDays(i, today)} 天</small>}
              </span>
              <span className="acts">
                <button type="button" onClick={() => move(i.id, next)}>
                  {nextLabel}
                </button>
                <label className="pick">
                  挑日子
                  <input type="date" min={today} aria-label="挑日子" onChange={(e) => e.target.value && move(i.id, e.target.value)} />
                </label>
                <button type="button" onClick={() => move(i.id, null)}>
                  待处理
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dropItems([i.id]);
                    toastUndo(`不做了：${i.title}`);
                  }}
                >
                  不做了
                </button>
                <button type="button" className="ok" title="其实做完了" aria-label="其实做完了" onClick={() => toggleItem(i.id)}>
                  ✓
                </button>
              </span>
            </div>
          ))}
        </section>

        <section className="dk-sd-s">
          <div className="dk-sd-k">
            <span className="no">3</span>
            {nextLabel} {md(next)} 最要紧的事
            <span className="dk-grow" />
            <span className="dk-fp-n tnum">
              {nextFocus}/{MAX_FOCUS}
            </span>
          </div>
          <FocusList date={next} today={today} items={items} />
        </section>

        <div className="dk-sd-foot">
          <label className="dk-ed-tip">
            每天
            <input
              type="time"
              className="dk-in tnum"
              value={shutdownAt ?? ''}
              aria-label="收尾提醒时间"
              onChange={(e) => {
                const s = useStore.getState();
                s.updateSettings({ desk: { ...s.settings.desk, shutdownAt: e.target.value } });
              }}
            />
            {shutdownAt ? '提醒收尾' : '不提醒'}
          </label>
          <span className="dk-grow" />
          <button type="button" className="dk-btn ghost" onClick={close}>
            稍后
          </button>
          <button
            type="button"
            className="dk-btn primary"
            onClick={() => {
              useDeskUi.getState().markShutdownDone(today);
              close();
              showToast(left.length ? `收工了（还有 ${left.length} 件会顺延到明天）` : '收工了，明天见');
            }}
          >
            收工
          </button>
        </div>
      </div>
    </div>
  );
}
