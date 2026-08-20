/**
 * 番茄钟「可计时事项」候选集的唯一来源。
 *
 * 抽出来是因为有两个消费者：主面板的 TaskPicker（下拉）与小窗里的 PipTaskPicker（覆盖层）。
 * 这套分组规则并不显而易见 —— 随缘任务不在 dayEntries 里、「最近」刻意不受 noFocus 与
 * 「今日在办」约束、脏 id（任务已删/目标已归档）要滤掉 —— 复制一份必然很快走样。
 */
import { useCallback, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { adhocEntries, dayEntries } from '../lib/derive';
import { todayStr } from '../lib/date';
import { PICKER_RECENT_SHOWN } from './constants';
import { readRecentTasks } from './running';

export interface Option {
  goalId: string;
  taskId: string;
  goalName: string;
  goalIcon: string;
  taskName: string;
}

export function useFocusOptions() {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const checkIns = useStore((s) => s.checkIns);
  const exemptions = useStore((s) => s.exemptions);
  /** 「最近」存在 localStorage（另一个标签、打卡页 ▶、小窗都会写它）⇒ 每次打开选择器重读 */
  const [recentRaw, setRecentRaw] = useState(readRecentTasks);
  const today = todayStr();

  const grouped = useMemo(() => {
    const goalList = Object.values(goals);
    const taskList = Object.values(tasks);
    const toOption = (goalId: string, taskId: string, taskName: string): Option | null => {
      const g = goals[goalId];
      if (!g) return null;
      // icon 是可选字段：缺省时留空而不是渲染出 'undefined'（既有写法见 CommandPalette）
      return { goalId, taskId, goalName: g.name, goalIcon: g.icon ?? '', taskName };
    };

    const due = dayEntries({
      date: today,
      goals: goalList,
      tasks: taskList,
      checkIns: Object.values(checkIns),
      exemptions: Object.values(exemptions),
    })
      .filter((e) => !e.exempt)
      .flatMap((e) => e.taskEntries.map((te) => toOption(e.goalId, te.taskId, te.name)));
    // 随缘任务不在 dayEntries 里，必须单独并进来
    const adhoc = adhocEntries({
      date: today,
      goals: goalList,
      tasks: taskList,
      checkIns: Object.values(checkIns),
    }).map((e) => toOption(e.goalId, e.taskId, e.name));

    const seen = new Set<string>();
    const todayAll = [...due, ...adhoc].filter((o): o is Option => {
      if (!o || seen.has(o.taskId)) return false;
      seen.add(o.taskId);
      return true;
    });

    const allOptions = taskList
      .filter((t) => !t.deletedAt && !goals[t.goalId]?.deletedAt && !goals[t.goalId]?.archived)
      .sort((a, b) => a.order - b.order)
      .map((t) => toOption(t.goalId, t.id, t.name))
      .filter((o): o is Option => o !== null);

    // 「最近」不受 noFocus 与「今日在办」约束：手动选过一次就说明确实想给它计时。
    // 脏 id（任务已删 / 目标已归档）在这里滤掉，别让它漏进 UI。
    const recentOptions = recentRaw
      .map((r) => {
        const t = tasks[r.taskId];
        if (!t || t.deletedAt) return null;
        const g = goals[t.goalId];
        if (!g || g.deletedAt || g.archived) return null;
        return toOption(t.goalId, t.id, t.name);
      })
      .filter((o): o is Option => o !== null)
      .slice(0, PICKER_RECENT_SHOWN);

    const inRecent = new Set(recentOptions.map((o) => o.taskId));
    const rest = todayAll.filter((o) => !inRecent.has(o.taskId));
    return {
      recentOptions,
      todayOptions: rest.filter((o) => !tasks[o.taskId]?.noFocus),
      hiddenOptions: rest.filter((o) => tasks[o.taskId]?.noFocus),
      allOptions,
    };
  }, [goals, tasks, checkIns, exemptions, today, recentRaw]);

  // 必须稳定：消费者会把它放进 useEffect 的依赖数组，每次渲染新建函数会造成无限循环
  const refreshRecent = useCallback(() => setRecentRaw(readRecentTasks()), []);

  return { ...grouped, refreshRecent };
}
