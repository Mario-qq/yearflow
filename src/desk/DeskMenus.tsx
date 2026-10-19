/**
 * 工作台的菜单：日卡「⋯」（这天没做完的批量挪 / 全选 / 休班标记）、行右键（事项或例行的一次）、紧急度、年度计划行、习惯胶囊。
 * 菜单定位在屏内夹紧；点外面、Esc 关闭（由 DeskPage 统一处理）。
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { Urgency } from '../types/domain';
import type { MoveHow } from '../lib/derive/desk';
import {
  deleteItems,
  deleteRoutine,
  dropItems,
  moveKeys,
  patchItem,
  patchRoutine,
  setDayMark,
  setUrgency,
  skipOccurrence,
} from '../store/deskActions';
import { useStore } from '../store/useStore';
import { removeCheckIn, setCheckIn } from '../store/actions';
import { startPomodoro } from '../pomodoro/api';
import { useLocate } from '../annual/useLocate';
import { md, toastMove, toastUndo, weekdayCn } from './format';
import { parseKey, parseKeys } from './keys';
import { openMoverFor, selectedItemIds, toggleFocus, toggleImportant, undoneKeysOf } from './commands';
import { setPlanHidden } from './pickModel';
import { showToast } from '../lib/toast';
import { selectOnly } from './selection';
import type { DayData } from './useDeskData';
import { useDeskUi } from './uiStore';
import { openHabitEditor, tapHabit } from './habitCommands';
import { deleteHabit, setHabitPaused, toggleHabitLog } from '../store/habitActions';
import { habitLogId } from '../lib/derive/habits';
import { addDays } from '../lib/derive/desk';

const URGENCY: { u: Urgency; label: string; key: string }[] = [
  { u: 'urgent', label: '紧急', key: '1' },
  { u: 'soon', label: '尽快', key: '2' },
  { u: 'normal', label: '普通', key: '3' },
];

const close = () => useDeskUi.getState().set({ menu: null });

/** 用隐藏的原生日期框选日子（截止日） */
function pickDate(initial: string, onPick: (d: string) => void) {
  const input = document.createElement('input');
  input.type = 'date';
  input.value = initial;
  input.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    if (input.value) onPick(input.value);
    input.remove();
  });
  input.addEventListener('blur', () => setTimeout(() => input.remove(), 0));
  try {
    input.showPicker();
  } catch {
    input.click();
  }
}

export function DeskMenus({ today, dayOf }: { today: string; dayOf: (d: string) => DayData }) {
  const menu = useDeskUi((s) => s.menu);
  const workItems = useStore((s) => s.workItems);
  const routines = useStore((s) => s.routines);
  const habits = useStore((s) => s.habits);
  const habitLogs = useStore((s) => s.habitLogs);
  const marks = useStore((s) => s.dayMarks);
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const { locateTask } = useLocate();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return setPos(null);
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - el.offsetHeight - 8)),
    });
  }, [menu]);

  if (!menu) return null;
  let content: React.ReactNode = null;

  if (menu.kind === 'urgency') {
    content = URGENCY.map(({ u, label, key }) => (
      <button
        key={u}
        type="button"
        onClick={() => {
          const ids = selectedItemIds();
          setUrgency(ids, u);
          close();
          toastUndo(`紧急度改为${label}：${ids.length} 件`);
        }}
      >
        {label}
        <span>{key}</span>
      </button>
    ));
  }

  if (menu.kind === 'plan') {
    const { goalId, taskId, status, recordId } = menu;
    const taskName = tasks[taskId]?.name ?? '';
    const mark = (s: 'done' | 'partial' | 'skipped', text: string) => {
      setCheckIn({ goalId, taskId, date: today, status: s });
      close();
      toastUndo(`${taskName}：${text}`);
    };
    const tick = (s: typeof status) => (status === s ? <span>✓</span> : null);
    content = (
      <>
        <div className="lbl">
          年度计划 · {goals[goalId]?.name ?? ''} · {taskName}
        </div>
        <button type="button" onClick={() => mark('done', '完成')}>
          完成{tick('done')}
        </button>
        <button type="button" onClick={() => mark('partial', '做了一点')}>
          做了一点{tick('partial')}
        </button>
        <button type="button" onClick={() => mark('skipped', '今天跳过')}>
          今天跳过{tick('skipped')}
        </button>
        {recordId && (
          <button
            type="button"
            onClick={() => {
              removeCheckIn(recordId);
              close();
              toastUndo(`${taskName}：已撤销打卡`);
            }}
          >
            撤销打卡
          </button>
        )}
        <hr />
        {status !== 'done' && status !== 'skipped' && (
          <button type="button" onClick={() => (startPomodoro({ goalId, taskId }), close())}>
            开始专注<span>结束自动打卡</span>
          </button>
        )}
        <button type="button" onClick={() => (close(), locateTask(taskId, Number(today.slice(0, 4))))}>
          在甘特图中打开
        </button>
        <hr />
        <button
          type="button"
          onClick={() => {
            const prev = useStore.getState().settings.desk.planHiddenTasks ?? [];
            setPlanHidden({ tasks: [...new Set([...prev, taskId])] });
            close();
            // 显示偏好不进撤销栈（本机设置），撤销按钮直接还原名单
            showToast(`工作台不再显示「${taskName}」`, { label: '撤销', run: () => setPlanHidden({ tasks: prev }) });
          }}
        >
          不在工作台显示<span>这个任务</span>
        </button>
        <button
          type="button"
          onClick={() => {
            const prev = useStore.getState().settings.desk.planHiddenGoals ?? [];
            setPlanHidden({ goals: [...new Set([...prev, goalId])] });
            close();
            showToast(`工作台不再显示「${goals[goalId]?.name ?? ''}」的任务`, { label: '撤销', run: () => setPlanHidden({ goals: prev }) });
          }}
        >
          不显示整个目标<span>{goals[goalId]?.name ?? ''}</span>
        </button>
      </>
    );
  }

  if (menu.kind === 'day') {
    const d = dayOf(menu.date);
    const keys = undoneKeysOf(d, today);
    const mv = (how: MoveHow) => {
      const r = moveKeys(parseKeys(keys), how);
      close();
      toastMove(how, today, r);
    };
    const mark = marks[menu.date];
    content = (
      <>
        <div className="lbl tnum">
          {weekdayCn(menu.date)} {md(menu.date)} · 没做完 {keys.length} 件
        </div>
        {keys.length > 0 && (
          <>
            <button type="button" onClick={() => mv('tomorrow')}>
              全部挪到明天
            </button>
            <button type="button" onClick={() => mv('nextMonday')}>
              全部挪到下周一
            </button>
            <button type="button" onClick={() => mv('sameDayNextWeek')}>
              全部挪到下周同一天
            </button>
            <button
              type="button"
              onClick={() => {
                selectOnly(keys);
                close();
              }}
            >
              全选，再自己挑去处
            </button>
            <hr />
          </>
        )}
        {mark?.type !== 'off' && (
          <button type="button" onClick={() => (setDayMark(menu.date, 'off'), close())}>
            标为休息日<span>工作例行不出现</span>
          </button>
        )}
        {mark?.type !== 'work' && (
          <button type="button" onClick={() => (setDayMark(menu.date, 'work'), close())}>
            标为补班日<span>工作例行照常</span>
          </button>
        )}
        {mark && (
          <button type="button" onClick={() => (setDayMark(menu.date, null), close())}>
            清除休/班标记
          </button>
        )}
      </>
    );
  }

  if (menu.kind === 'row') {
    const k = parseKey(menu.key);
    const sel = useDeskUi.getState().sel;
    const multi = sel.size > 1;
    const moveBtn = (
      <button
        type="button"
        onClick={() => {
          openMoverFor(multi ? [...sel] : [menu.key], document.querySelector(`[data-key="${CSS.escape(menu.key)}"]`));
        }}
      >
        挪到…<span>D</span>
      </button>
    );
    if (k?.type === 'item') {
      const item = workItems[k.id];
      if (item) {
        const ids = multi ? selectedItemIds() : [item.id];
        content = (
          <>
            {!multi && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const el = document.querySelector(`[data-key="${CSS.escape(menu.key)}"]`);
                    const r = el?.getBoundingClientRect();
                    useDeskUi.getState().set({ menu: null, sel: new Set(), editor: { kind: 'item', id: item.id, left: r?.left ?? menu.x, top: r?.bottom ?? menu.y } });
                  }}
                >
                  编辑…<span>↵</span>
                </button>
                <hr />
              </>
            )}
            {URGENCY.map(({ u, label, key }) => (
              <button
                key={u}
                type="button"
                onClick={() => {
                  setUrgency(ids, u);
                  close();
                }}
              >
                {label}
                {item.urgency === u && !multi ? <span>✓</span> : <span>{key}</span>}
              </button>
            ))}
            <button type="button" onClick={() => (toggleImportant(ids), close())}>
              {!multi && item.important ? '取消重要' : '标为重要'}
              <span>*</span>
            </button>
            <hr />
            {item.status !== 'dropped' && (
              <button type="button" onClick={() => (toggleFocus(ids, today), close())}>
                {!multi && item.focusOn && item.focusOn >= today ? '移出要事' : '设为要事'}
                <span>F</span>
              </button>
            )}
            {moveBtn}
            {!multi && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    pickDate(item.dueDate ?? item.date ?? today, (d) => patchItem(item.id, { dueDate: d }, `截止日设为 ${md(d)}`));
                  }}
                >
                  {item.dueDate ? `改截止日（${md(item.dueDate)}）` : '设截止日…'}
                </button>
                {item.dueDate && (
                  <button type="button" onClick={() => (patchItem(item.id, { dueDate: undefined }, '清除截止日'), close())}>
                    清除截止日
                  </button>
                )}
                <button type="button" onClick={() => useDeskUi.getState().set({ editing: menu.key, menu: null })}>
                  改名<span>双击</span>
                </button>
              </>
            )}
            <hr />
            <button
              type="button"
              onClick={() => {
                dropItems(ids);
                useDeskUi.getState().set({ sel: new Set(), menu: null });
                toastUndo(`不做了：${ids.length} 件`);
              }}
            >
              不做了
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                deleteItems(ids);
                useDeskUi.getState().set({ sel: new Set(), menu: null });
                toastUndo(ids.length > 1 ? `删除 ${ids.length} 件` : `删除「${item.title}」`);
              }}
            >
              删除<span>Del</span>
            </button>
          </>
        );
      }
    }
    if (k?.type === 'routine') {
      const r = routines[k.routineId];
      if (r) {
        content = (
          <>
            <div className="lbl">例行 · {r.title}</div>
            <button
              type="button"
              onClick={() => useDeskUi.getState().set({ menu: null, editor: { kind: 'routine', id: r.id, left: menu.x, top: menu.y } })}
            >
              编辑这个例行…<span>规则、时间</span>
            </button>
            {moveBtn}
            <button type="button" onClick={() => (skipOccurrence(r.id, k.origDate), close())}>
              跳过这一次 / 取消跳过
            </button>
            <hr />
            <button
              type="button"
              onClick={() => {
                patchRoutine(r.id, { paused: true }, `暂停例行「${r.title}」`);
                close();
                toastUndo(`已暂停「${r.title}」，在「待处理 → 例行」里恢复`);
              }}
            >
              暂停这个例行
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                deleteRoutine(r.id);
                useDeskUi.getState().set({ sel: new Set(), menu: null });
                toastUndo(`删除例行「${r.title}」`);
              }}
            >
              删除这个例行<span>记录保留</span>
            </button>
            <hr />
            <button type="button" onClick={() => useDeskUi.getState().set({ menu: null, drawer: true, drawerTab: 'routines' })}>
              管理全部例行…
            </button>
          </>
        );
      }
    }
  }

  if (menu.kind === 'habit') {
    const h = habits[menu.id];
    if (h) {
      const yesterday = addDays(today, -1);
      const logT = habitLogs[habitLogId(h.id, today)];
      const logY = habitLogs[habitLogId(h.id, yesterday)];
      const anchor = (): [number, number] => [menu.x, menu.y];
      content = (
        <>
          <div className="lbl">
            {h.icon ? `${h.icon} ` : ''}
            {h.title}
          </div>
          {h.kind === 'do' ? (
            <>
              <button type="button" onClick={() => (close(), tapHabit(h, today))}>
                {logT ? '撤销今天' : '今天做了'}
              </button>
              {yesterday >= h.startDate && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    const on = toggleHabitLog(h.id, yesterday, 'done');
                    toastUndo(on ? `补记：昨天「${h.title}」做了` : `已撤销昨天的「${h.title}」`);
                  }}
                >
                  {logY ? '撤销昨天的记录' : '昨天其实做了（补记）'}
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" onClick={() => (close(), tapHabit(h, today))}>
                {logT ? '撤销：今天没破' : '今天破了一次'}
              </button>
              {yesterday >= h.startDate && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    const on = toggleHabitLog(h.id, yesterday, 'slip');
                    toastUndo(on ? `补记：昨天「${h.title}」破了` : `已撤销昨天的破戒`);
                  }}
                >
                  {logY ? '撤销昨天的破戒' : '昨天破了（补记）'}
                </button>
              )}
            </>
          )}
          <hr />
          <button
            type="button"
            onClick={() => {
              const [x, y] = anchor();
              openHabitEditor(h.id, x, y);
            }}
          >
            编辑…
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              setHabitPaused(h.id, true);
              toastUndo(`已暂停「${h.title}」，在「待处理 → 习惯」里恢复`);
            }}
          >
            暂停<span>不删记录</span>
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              close();
              deleteHabit(h.id);
              toastUndo(`删除习惯「${h.title}」`);
            }}
          >
            删除这个习惯
          </button>
          <hr />
          <button type="button" onClick={() => useDeskUi.getState().set({ menu: null, drawer: true, drawerTab: 'habits' })}>
            管理全部习惯…
          </button>
        </>
      );
    }
  }

  if (!content) return null;
  return (
    <div
      ref={ref}
      className="dk-menu"
      role="menu"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </div>
  );
}

