/** 习惯胶囊的两个动作（胶囊、右键菜单共用；单独成文件让 Habits.tsx 只导出组件） */
import type { Habit } from '../types/domain';
import { toggleHabitLog } from '../store/habitActions';
import { toastUndo } from './format';
import { useDeskUi } from './uiStore';

export function openHabitEditor(id: string | null, left: number, top: number) {
  useDeskUi.getState().set({ editor: { kind: 'habit', id, left, top }, menu: null });
}

export function tapHabit(h: Habit, date: string) {
  const on = toggleHabitLog(h.id, date, h.kind === 'do' ? 'done' : 'slip');
  if (h.kind === 'do') toastUndo(on ? `「${h.title}」做了` : `已撤销「${h.title}」`);
  else toastUndo(on ? `记了一次：「${h.title}」破了。明天接着守` : `已撤销「${h.title}」破戒`);
}
