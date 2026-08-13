/** 番茄钟的时间文案（数字一律配 .tnum；全程 ms，只在这一层取整） */

/** 倒计时 `12:34`；超过 1 小时给 `1:05:00` */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** 累计时长中文：`1 小时 25 分` / `25 分` / `不足 1 分` */
export function humanMs(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min <= 0) return '不足 1 分';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} 分`;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

/** 纯分钟数（分钟输入框的自动值展示） */
export function toMinutes(ms: number): number {
  return Math.round(ms / 60_000);
}
