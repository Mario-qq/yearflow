/**
 * 农历（查表法，不联网、不引运行时依赖）。
 * 不用浏览器内置的 Intl 中国历法：它按天文算法实时推，朔日贴近午夜的月份会差一天（实测 2027、2030 春节都差一天）。
 *
 * LUNAR_INFO 是 1900–2100 每个农历年一个数（香港天文台数据，取自 solarlunar 3.1.0，ISC 许可，© 2015 yize / jjonline）：
 *   低 4 位 = 闰几月（0 = 无闰）；第 4–15 位 = 1–12 月大小（bit (0x10000 >> m) 为 1 = 30 天，否则 29 天）；
 *   第 16 位 = 闰月大小（1 = 30 天）。起点：公历 1900-01-31 = 农历 1900 年正月初一。
 * 正确性由单测逐日对照 lunar-javascript（6tail，开发依赖）覆盖 1901–2099 全部日期。
 * 原表有两年与之不符，已按 lunar-javascript 改正：1933（0x06e95 → 0x16a95，闰五月大、六月小）、2097（0x0a4d0 → 0x0a2d0）。
 *
 * 过农历生日的惯例：闰月按平月过；那年这个月没有三十 ⇒ 按廿九（月末）过。
 */

// prettier-ignore
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
  0x0d520, // 2100
];

const FIRST_YEAR = 1900;
const LAST_YEAR = FIRST_YEAR + LUNAR_INFO.length - 1;
/** 1900-01-31（农历 1900 正月初一）的 UTC 日序号 */
const EPOCH = Date.UTC(1900, 0, 31) / 86_400_000;

export interface LunarMD {
  month: number; // 1–12
  day: number; // 1–30
  leap: boolean;
}

const leapMonthOf = (y: number) => LUNAR_INFO[y - FIRST_YEAR] & 0xf;
const monthLen = (y: number, m: number) => (LUNAR_INFO[y - FIRST_YEAR] & (0x10000 >> m) ? 30 : 29);
const leapLen = (y: number) => (leapMonthOf(y) ? (LUNAR_INFO[y - FIRST_YEAR] & 0x10000 ? 30 : 29) : 0);

/** 某农历年的月份序列（含闰月，按顺序） */
function monthsOf(y: number): { month: number; leap: boolean; len: number }[] {
  const leap = leapMonthOf(y);
  const out: { month: number; leap: boolean; len: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({ month: m, leap: false, len: monthLen(y, m) });
    if (m === leap) out.push({ month: m, leap: true, len: leapLen(y) });
  }
  return out;
}

/** 每个农历年正月初一的日序号（相对 EPOCH），懒算一次 */
let yearStart: number[] | null = null;
function starts(): number[] {
  if (!yearStart) {
    yearStart = [];
    let acc = 0;
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
      yearStart.push(acc);
      acc += monthsOf(y).reduce((s, m) => s + m.len, 0);
    }
  }
  return yearStart;
}

const dayNo = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000 - EPOCH;
function fromDayNo(n: number): string {
  const d = new Date((n + EPOCH) * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 当前环境能不能算农历（查表法恒为 true；保留给 UI 判断，以后换实现时不用改调用方） */
export const lunarSupported = (): boolean => true;

/** 公历 YYYY-MM-DD → 农历月日；超出 1900-01-31 ~ 2100 年末的范围返回 null */
export function toLunar(date: string): LunarMD | null {
  const n = dayNo(date);
  const s = starts();
  if (n < 0) return null;
  let i = s.length - 1;
  while (i >= 0 && s[i] > n) i--;
  let off = n - s[i];
  for (const m of monthsOf(FIRST_YEAR + i)) {
    if (off < m.len) return { month: m.month, day: off + 1, leap: m.leap };
    off -= m.len;
  }
  return null; // 超过 2100 年末
}

/** 农历 y 年（平）month 月 day 日的公历日期；没有三十按廿九；年份超范围返回 null */
function solarOf(y: number, month: number, day: number): string | null {
  if (y < FIRST_YEAR || y > LAST_YEAR) return null;
  let n = starts()[y - FIRST_YEAR];
  for (const m of monthsOf(y)) {
    if (m.month === month && !m.leap) return fromDayNo(n + Math.min(day, m.len) - 1);
    n += m.len;
  }
  return null;
}

/** 农历 month/day 从 from（含）起的下一次，返回公历日期（闰月按平月过） */
export function nextLunarDate(month: number, day: number, from: string): string | null {
  const y = Number(from.slice(0, 4));
  // 农历年比公历年晚 1–2 个月开始：从上一个农历年找起
  for (let ly = y - 1; ly <= y + 1; ly++) {
    const d = solarOf(ly, month, day);
    if (d && d >= from) return d;
  }
  return null;
}

const DAY_NAMES = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十'];
const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const DIGITS = '一二三四五六七八九';

/** 「八月十五」「正月初一」「腊月廿九」 */
export function lunarLabel(month: number, day: number): string {
  const dn = day <= 10 ? DAY_NAMES[day - 1] : day < 20 ? `十${DIGITS[day - 11]}` : day === 20 ? '二十' : day < 30 ? `廿${DIGITS[day - 21]}` : '三十';
  return `${MONTH_NAMES[month - 1]}月${dn}`;
}
