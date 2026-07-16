/** Goal.color 存色板键（goal-1..goal-5）或十六进制；统一解析为可用的 CSS 颜色 */
export function goalColor(color: string): string {
  return color.startsWith('#') ? color : `var(--${color})`;
}

export function goalColorAlpha(color: string, alpha: 40 | 15): string {
  if (color.startsWith('#')) return `color-mix(in srgb, ${color} ${alpha}%, transparent)`;
  return `var(--${color}-${alpha}, color-mix(in srgb, var(--${color}) ${alpha}%, transparent))`;
}
