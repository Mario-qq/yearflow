import type { AnnualIndex } from '../lib/derive/annual';
import { goalColor } from '../lib/colors';
import type { GoalMap } from './parts';

/** 三个主色：投入最多的目标优先，不足三个时用逐日主角目标补。封面光晕与结尾进度条共用 */
export function paletteOf(idx: AnnualIndex, goals: GoalMap): string[] {
  const palette: string[] = [];
  for (const g of idx.invested.goals) {
    const goal = goals.get(g.goalId);
    if (goal) palette.push(goalColor(goal.color));
    if (palette.length === 3) break;
  }
  for (const d of idx.days) {
    if (palette.length >= 3) break;
    const goal = d.topGoalId ? goals.get(d.topGoalId) : undefined;
    const c = goal && goalColor(goal.color);
    if (c && !palette.includes(c)) palette.push(c);
  }
  while (palette.length < 3) palette.push(palette[palette.length - 1] ?? 'var(--accent)');
  return palette;
}
