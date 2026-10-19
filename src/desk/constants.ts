/** 工作台常量。CSS 侧镜像在 desk.css 的 .dk --dk-* 变量（改一边改另一边） */

/** 「挪到…」小月历宽（--dk-mover-w） */
export const MOVER_W = 300;
/** 小月历覆盖的周数：本周起 5 周 */
export const MOVER_WEEKS = 5;
/** 拖拽起拖阈值（px），与甘特 bar 拖拽一致 */
export const DRAG_THRESHOLD = 3;
/** 勾选完成时先播完「打勾」再落库，行才滑进已完成折叠 */
export const CHECK_ANIM_MS = 160;
/** 过去的日卡默认露出几条已完成 */
export const PAST_DONE_PREVIEW = 4;
/** 月历每格最多列几件 */
export const MONTH_CELL_ITEMS = 3;
/** 日卡列宽权重：今天 / 普通 / 有事的周末 / 空周末 */
export const COL_FR = { today: 1.7, normal: 1, weekendBusy: 1, weekendEmpty: 0.7 } as const;
/** 收起的周末窄条宽（px，--dk-rail-w） */
export const RAIL_W = 40;
/** 跟进对象头像色轮（按名字哈希取色，同一个人永远同色） */
export const PERSON_COLORS = ['var(--goal-1)', 'var(--goal-6)', 'var(--goal-3)', 'var(--goal-9)', 'var(--goal-7)', 'var(--goal-2)'];

export function personColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h + c.charCodeAt(0)) % 9973;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}
