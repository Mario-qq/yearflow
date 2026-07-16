/** Goal.color 存色板键（goal-1..goal-5）或十六进制；统一解析为可用的 CSS 颜色 */
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
