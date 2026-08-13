/** 番茄钟的任务归属选择与其展示文案（拆成独立文件：hook 与组件不混在同一个模块里） */
import { useStore } from '../store/useStore';

export interface FocusSel {
  goalId?: string;
  taskId?: string;
}

/**
 * 把一个选择渲染成 `🧩 SAP系统 · MM 模块`。
 * 目标/任务已被删除时退化为上一级（任务没了退到目标，目标没了退到「暂不归类」）——
 * 删除任务会级联软删其会话，但 localStorage 里的「上次使用的任务」不会跟着清，
 * 这里必须容得下一个指向已删任务的旧选择。
 */
export function useSelLabel(sel: FocusSel): { text: string; missing: boolean } {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const goal = sel.goalId ? goals[sel.goalId] : undefined;
  const task = sel.taskId ? tasks[sel.taskId] : undefined;
  if (!goal || goal.deletedAt) return { text: '暂不归类', missing: Boolean(sel.goalId) };
  const head = goal.icon ? `${goal.icon} ${goal.name}` : goal.name;
  if (!task || task.deletedAt) return { text: head, missing: Boolean(sel.taskId) };
  return { text: `${head} · ${task.name}`, missing: false };
}
