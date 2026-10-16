/** 工作台的日期说法与操作反馈（文案集中在这里，界面语言简体中文） */
import { diffDays, toDay } from '../lib/date';
import { addDays, weekMonday, type MoveHow } from '../lib/derive/desk';
import { showToast } from '../lib/toast';
import { useStore } from '../store/useStore';

export const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

export const md = (date: string): string => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
export const weekdayCn = (date: string): string => `周${WEEKDAY_CN[toDay(date).day()]}`;
export const isWeekendDate = (date: string): boolean => [0, 6].includes(toDay(date).day());

/** 「今天 / 明天 / 昨天 / 周三 / 下周三 / 上周三 / 10/30」 */
export function relDay(date: string, today: string): string {
  const n = diffDays(date, today);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === -1) return '昨天';
  const w = diffDays(weekMonday(date), weekMonday(today)) / 7;
  if (w === 0) return weekdayCn(date);
  if (w === 1) return `下${weekdayCn(date)}`;
  if (w === -1) return `上${weekdayCn(date)}`;
  return md(date);
}

const HOW_TEXT: Record<MoveHow, string> = { tomorrow: '明天', nextMonday: '下周一', sameDayNextWeek: '下周同一天' };

/** 挪动结果的 toast：「挪到下周三 10/21：2 件」，带撤销；挪到截止日之后再补一句 */
export function toastMove(to: MoveHow | string | null, today: string, r: { moved: number; pastDue: number }): void {
  if (r.moved === 0) {
    showToast('没有需要挪的（已经在那天，或这一次已经做完）');
    return;
  }
  const where =
    to === null ? '待处理' : to in HOW_TEXT ? HOW_TEXT[to as MoveHow] : `${relDay(to, today)} ${md(to)}`;
  toastUndo(`${to === null ? '放进' : '挪到'}${where}：${r.moved} 件`);
  if (r.pastDue > 0) setTimeout(() => showToast(`有 ${r.pastDue} 件挪到了截止日之后`), 400);
}

/** 带「撤销」按钮的 toast（撤销走全局 undo 栈，等同 Ctrl+Z） */
export function toastUndo(text: string): void {
  showToast(text, {
    label: '撤销',
    run: () => {
      const label = useStore.getState().undo();
      showToast(label ? `已撤销：${label}` : '没有可撤销的操作');
    },
  });
}

export { addDays, weekMonday };
