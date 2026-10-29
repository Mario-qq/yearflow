import dayjs from 'dayjs';

/** 卡片角落的相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / M月D日 / YYYY年M月D日 */
export function relTime(iso: string, now = new Date()): string {
  const t = dayjs(iso);
  const n = dayjs(now);
  const min = n.diff(t, 'minute');
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  if (n.isSame(t, 'day')) return `${n.diff(t, 'hour')} 小时前`;
  if (n.subtract(1, 'day').isSame(t, 'day')) return '昨天';
  if (n.isSame(t, 'year')) return t.format('M月D日');
  return t.format('YYYY年M月D日');
}
