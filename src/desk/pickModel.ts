/** 挑要事 / 年度计划显示偏好的数据侧（组件文件只导出组件：React Fast Refresh 的要求） */
import { useMemo } from 'react';
import type { WorkItem } from '../types/domain';
import { compareItems, isFocusOn } from '../lib/derive/desk';
import { useStore } from '../store/useStore';
import type { PlanRowData } from './usePlanRows';

/** 那天可挑的事项：排在那天（今天含顺延来的）、没做完的；已经是要事的在前 */
export function focusCandidates(items: WorkItem[], date: string, today: string): WorkItem[] {
  return items
    .filter((i) => !i.deletedAt && i.status === 'open' && i.date && (i.date === date || (date === today && i.date < today)))
    .sort((a, b) => Number(isFocusOn(b, date)) - Number(isFocusOn(a, date)) || compareItems(a, b, today));
}

/** 本机设置里的隐藏名单（目标 / 任务）→ 过滤今天的年度计划行 */
export function usePlanVisibility(rows: PlanRowData[]): { visible: PlanRowData[]; hidden: number } {
  const hiddenGoals = useStore((s) => s.settings.desk.planHiddenGoals);
  const hiddenTasks = useStore((s) => s.settings.desk.planHiddenTasks);
  return useMemo(() => {
    const g = new Set(hiddenGoals ?? []);
    const t = new Set(hiddenTasks ?? []);
    const visible = rows.filter((r) => !g.has(r.goalId) && !t.has(r.taskId));
    return { visible, hidden: rows.length - visible.length };
  }, [rows, hiddenGoals, hiddenTasks]);
}

export function setPlanHidden(patch: { goals?: string[]; tasks?: string[] }): void {
  const s = useStore.getState();
  const desk = s.settings.desk;
  s.updateSettings({
    desk: {
      ...desk,
      ...(patch.goals ? { planHiddenGoals: patch.goals } : {}),
      ...(patch.tasks ? { planHiddenTasks: patch.tasks } : {}),
    },
  });
}

/** 名单里有就去掉、没有就加上（inList = 现在已在隐藏名单里） */
export const toggleIn = (list: string[], id: string, inList: boolean) => (inList ? list.filter((x) => x !== id) : [...new Set([...list, id])]);

