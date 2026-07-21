/** 目标预设色板键（对应 tokens.css --goal-1..--goal-10），新建/改色/去重都从这里取 */
export const GOAL_PALETTE = [
  'goal-1',
  'goal-2',
  'goal-3',
  'goal-4',
  'goal-5',
  'goal-6',
  'goal-7',
  'goal-8',
  'goal-9',
  'goal-10',
] as const;

/**
 * 从色板挑一个「最不常用」的颜色，尽量避开已用色：
 * 优先返回完全没被用过的；全用过了（目标数 > 色板）再返回用得最少的（并列取色板靠前的）。
 */
export function pickGoalColor(usedColors: Iterable<string>): string {
  const count = new Map<string, number>(GOAL_PALETTE.map((c) => [c, 0]));
  for (const c of usedColors) {
    if (count.has(c)) count.set(c, count.get(c)! + 1);
  }
  let best: string = GOAL_PALETTE[0];
  let bestN = Infinity;
  for (const c of GOAL_PALETTE) {
    const n = count.get(c)!;
    if (n < bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

/** Goal.color 存色板键（goal-1..goal-10）或十六进制；统一解析为可用的 CSS 颜色 */
export function goalColor(color: string): string {
  return color.startsWith('#') ? color : `var(--${color})`;
}

/** 预定义 -40/-15 直接走 tokens 变量，其余透明度（bar 剩余段 25、占位点 8、热度五档）走 color-mix */
export function goalColorAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) return `color-mix(in srgb, ${color} ${alpha}%, transparent)`;
  if (alpha === 40 || alpha === 15) {
    return `var(--${color}-${alpha}, color-mix(in srgb, var(--${color}) ${alpha}%, transparent))`;
  }
  return `color-mix(in srgb, var(--${color}) ${alpha}%, transparent)`;
}
