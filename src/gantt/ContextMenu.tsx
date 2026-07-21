/**
 * 甘特右键菜单（SPEC 4.5）。
 * bar：编辑详情 / 标记完成 / 暂停⇄恢复 / 复制并顺延 / 从此日拆分 / 保存为基线 / 删除
 *（右键目标在多选集内时，改状态/删除作用于全部选中任务）
 * 时间轴空白：在此日新建任务 / 新建里程碑 / 添加免打卡区间
 * 目标行（左栏）：重命名 / 新建任务 / 删除目标（级联确认）
 * 里程碑：标记达成⇄取消 / 删除
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import {
  createExemption,
  createMilestone,
  createTask,
  deleteGoal,
  deleteMilestone,
  deleteTask,
  deleteTasks,
  duplicateTaskAfter,
  patchMilestone,
  patchTask,
  patchTasks,
  setGoalCompleted,
  splitTaskAt,
} from '../store/actions';
import { showToast } from '../lib/toast';
import { celebrate } from '../lib/celebrate';
import { fmtDay, toDay, todayStr } from '../lib/date';
import { useGanttUi, type ContextMenuState } from './uiStore';

interface Item {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

type Entry = Item | 'divider';

function buildItems(menu: ContextMenuState): Entry[] {
  const ui = useGanttUi.getState();
  const store = useStore.getState();

  if (menu.kind === 'bar' && menu.taskId) {
    const task = store.tasks[menu.taskId];
    if (!task) return [];
    // 右键在多选集内 → 批量语义
    const selected = ui.selectedTaskIds.includes(menu.taskId) ? ui.selectedTaskIds : [menu.taskId];
    const multi = selected.length > 1;
    const n = selected.length;
    return [
      {
        label: '编辑详情',
        onClick: () => ui.setDrawerTask(task.id),
      },
      'divider',
      {
        label: multi ? `标记完成（${n} 个）` : '标记完成',
        onClick: () =>
          patchTasks(
            selected.map((id) => ({ id, patch: { status: 'done' as const, progress: 100 } })),
            multi ? `标记完成 ${n} 个任务` : `标记完成「${task.name}」`,
          ),
      },
      {
        label: task.status === 'paused' ? '恢复任务' : '暂停任务',
        onClick: () =>
          patchTask(
            task.id,
            { status: task.status === 'paused' ? 'active' : 'paused' },
            task.status === 'paused' ? `恢复任务「${task.name}」` : `暂停任务「${task.name}」`,
          ),
      },
      {
        label: '复制并顺延',
        onClick: () => {
          const id = duplicateTaskAfter(task.id);
          if (id) ui.flashTask(id);
        },
      },
      {
        label: menu.date ? `从 ${toDay(menu.date).format('M月D日')} 拆分` : '从此日拆分',
        disabled: !menu.date || menu.date <= task.startDate || menu.date > task.endDate,
        onClick: () => {
          if (!menu.date) return;
          const id = splitTaskAt(task.id, menu.date);
          if (id) ui.flashTask(id);
        },
      },
      'divider',
      {
        label: '保存为基线',
        onClick: () => {
          patchTask(
            task.id,
            { baseline: { startDate: task.startDate, endDate: task.endDate } },
            `保存基线「${task.name}」`,
          );
          showToast(`已将「${task.name}」当前起止保存为基线`);
        },
      },
      'divider',
      {
        label: multi ? `删除（${n} 个）…` : '删除…',
        danger: true,
        onClick: () => {
          const msg = multi
            ? `删除选中的 ${n} 个任务？其打卡记录将一并删除。`
            : `删除任务「${task.name}」？其打卡记录将一并删除。`;
          if (!confirm(msg)) return;
          if (multi) deleteTasks(selected);
          else deleteTask(task.id);
          ui.clearSelection();
        },
      },
    ];
  }

  // 左栏目标行
  if (menu.kind === 'goal' && menu.goalId) {
    const goal = store.goals[menu.goalId];
    if (!goal) return [];
    const completed = Boolean(goal.completedAt);
    return [
      {
        label: '重命名',
        onClick: () => ui.setEditing({ id: goal.id, field: 'goalName' }),
      },
      {
        label: '更改图标',
        onClick: () => ui.setIconPicker({ goalId: goal.id, x: menu.x, y: menu.y }),
      },
      {
        label: '新建任务',
        onClick: () => {
          const start = todayStr();
          const id = createTask({
            goalId: goal.id,
            startDate: start,
            endDate: fmtDay(toDay(start).add(13, 'day')),
          });
          ui.flashTask(id);
          ui.setEditing({ id, field: 'name' });
        },
      },
      'divider',
      {
        label: completed ? '取消完成' : '标记完成 ✓',
        onClick: () => {
          setGoalCompleted(goal.id, !completed);
          if (!completed) {
            celebrate(menu.x, menu.y);
            showToast(`🎉 目标「${goal.name}」已完成，可 Ctrl+Z 撤销`);
          }
        },
      },
      'divider',
      {
        label: '删除目标…',
        danger: true,
        onClick: () => {
          const taskN = Object.values(store.tasks).filter((t) => !t.deletedAt && t.goalId === goal.id).length;
          const msN = Object.values(store.milestones).filter((m) => !m.deletedAt && m.goalId === goal.id).length;
          const ckN = Object.values(store.checkIns).filter((c) => !c.deletedAt && c.goalId === goal.id).length;
          const parts = [
            taskN > 0 && `${taskN} 个任务`,
            msN > 0 && `${msN} 个里程碑`,
            ckN > 0 && `${ckN} 条打卡记录`,
          ].filter(Boolean);
          const detail = parts.length > 0 ? `其 ${parts.join('、')} 将一并删除。` : '';
          if (!confirm(`删除目标「${goal.name}」？${detail}`)) return;
          deleteGoal(goal.id);
          ui.clearSelection();
          showToast(`已删除目标「${goal.name}」，可 Ctrl+Z 撤销`);
        },
      },
    ];
  }

  // 里程碑菱形
  if (menu.kind === 'milestone' && menu.milestoneId) {
    const ms = store.milestones[menu.milestoneId];
    if (!ms) return [];
    return [
      {
        label: ms.achieved ? '取消达成' : '标记达成',
        onClick: () =>
          patchMilestone(
            ms.id,
            { achieved: !ms.achieved },
            `里程碑「${ms.name}」${ms.achieved ? '取消达成' : '标记达成'}`,
          ),
      },
      'divider',
      {
        label: '删除里程碑',
        danger: true,
        onClick: () => {
          deleteMilestone(ms.id);
          showToast(`已删除里程碑「${ms.name}」，可 Ctrl+Z 撤销`);
        },
      },
    ];
  }

  // 时间轴空白
  const date = menu.date;
  const goal = menu.goalId ? store.goals[menu.goalId] : undefined;
  if (!date) return [];
  const zh = toDay(date).format('M月D日');
  return [
    {
      label: goal ? `在此日新建任务（${goal.name}）` : '在此日新建任务',
      disabled: !goal,
      onClick: () => {
        if (!goal) return;
        const id = createTask({
          goalId: goal.id,
          startDate: date,
          endDate: fmtDay(toDay(date).add(13, 'day')),
        });
        ui.flashTask(id);
        ui.setEditing({ id, field: 'name' });
      },
    },
    {
      label: goal ? `新建里程碑（${zh}）` : '新建里程碑',
      disabled: !goal,
      onClick: () => {
        if (!goal) return;
        createMilestone(goal.id, date);
        showToast(`已在 ${zh} 创建里程碑`);
      },
    },
    'divider',
    {
      label: `添加免打卡区间（${zh} 起 3 天）`,
      onClick: () => {
        createExemption(date, fmtDay(toDay(date).add(2, 'day')));
        showToast('已添加免打卡区间，可在设置页调整范围与原因');
      },
    },
  ];
}

export function GanttContextMenu() {
  const menu = useGanttUi((s) => s.contextMenu);
  const setContextMenu = useGanttUi((s) => s.setContextMenu);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [menu, setContextMenu]);

  if (!menu) return null;
  const items = buildItems(menu);
  if (items.length === 0) return null;
  // 贴边翻转
  const w = 208;
  const x = Math.min(menu.x, window.innerWidth - w - 8);
  const estH = items.length * 30;
  const y = Math.min(menu.y, window.innerHeight - estH - 8);

  return (
    <div
      ref={ref}
      className="fixed z-50 py-1"
      style={{
        left: x,
        top: y,
        width: w,
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {items.map((it, i) =>
        it === 'divider' ? (
          <div key={i} style={{ height: 1, margin: '4px 0', background: 'var(--border-subtle)' }} />
        ) : (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            className="block w-full cursor-pointer px-3 py-1.5 text-left hover:bg-subtle disabled:cursor-default"
            style={{
              fontSize: 'var(--font-12)',
              color: it.disabled
                ? 'var(--text-disabled)'
                : it.danger
                  ? 'var(--danger)'
                  : 'var(--text-primary)',
            }}
            onClick={() => {
              setContextMenu(null);
              it.onClick?.();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
