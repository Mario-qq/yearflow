import { describe, expect, it } from 'vitest';
// @ts-expect-error lunar-javascript 没有类型声明（开发依赖，只当校验基准）
import { Solar } from 'lunar-javascript';
import { lunarLabel, lunarSupported, nextLunarDate, toLunar } from './lunar';

describe('toLunar（查表法）', () => {
  it('环境支持', () => expect(lunarSupported()).toBe(true));
  it('春节、中秋、闰月', () => {
    expect(toLunar('2026-02-17')).toEqual({ month: 1, day: 1, leap: false });
    expect(toLunar('2026-09-25')).toEqual({ month: 8, day: 15, leap: false });
    expect(toLunar('2025-07-25')).toEqual({ month: 6, day: 1, leap: true }); // 2025 闰六月
    expect(toLunar('2033-12-22')).toEqual({ month: 11, day: 1, leap: true }); // 2033 闰十一月
    expect(toLunar('2026-10-19')).toEqual({ month: 9, day: 10, leap: false });
  });
});

describe('nextLunarDate', () => {
  it('今年还没到 ⇒ 今年；过了 ⇒ 明年', () => {
    expect(nextLunarDate(8, 15, '2026-09-01')).toBe('2026-09-25'); // 2026 中秋
    expect(nextLunarDate(8, 15, '2026-09-25')).toBe('2026-09-25'); // 当天算
    expect(nextLunarDate(8, 15, '2026-09-26')).toBe('2027-09-15'); // 2027 中秋
    expect(nextLunarDate(1, 1, '2026-10-19')).toBe('2027-02-06'); // 2027 春节（Intl 中国历法这里会算成 02-07）
    expect(nextLunarDate(1, 1, '2029-03-01')).toBe('2030-02-03'); // 2030 春节（Intl 会算成 02-02）
  });
  it('闰月按平月过：2025 闰六月初一不算，取平六月初一', () => {
    expect(nextLunarDate(6, 1, '2025-06-01')).toBe('2025-06-25');
    expect(nextLunarDate(6, 1, '2025-06-26')).toBe('2026-07-14'); // 跳过 2025-07-25 闰六月初一
  });
  it('腊月过年前后跨公历年', () => {
    expect(nextLunarDate(12, 8, '2026-10-19')).toBe('2027-01-15'); // 2026 腊八
  });
  it('这个月没有三十 ⇒ 落在廿九', () => {
    const d = nextLunarDate(9, 30, '2026-10-19');
    const l = toLunar(d!);
    expect(l?.month).toBe(9);
    expect([29, 30]).toContain(l?.day);
    // 下一天必须已经是十月
    const next = new Date(`${d}T12:00:00`);
    next.setDate(next.getDate() + 1);
    const ymd = next.toLocaleDateString('sv-SE');
    expect(toLunar(ymd)?.month).toBe(10);
  });
});

describe('与 lunar-javascript 逐日对照', () => {
  it('1901-01-01 ~ 2099-12-31 每一天的农历月、日、闰月都一致', () => {
    const bad: string[] = [];
    const d = new Date(Date.UTC(1901, 0, 1));
    const end = Date.UTC(2099, 11, 31);
    for (; d.getTime() <= end && bad.length < 5; d.setUTCDate(d.getUTCDate() + 1)) {
      const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
      const ymd = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const ref = Solar.fromYmd(y, m, day).getLunar();
      const mine = toLunar(ymd);
      const refMonth = ref.getMonth() as number;
      if (!mine || mine.month !== Math.abs(refMonth) || mine.leap !== refMonth < 0 || mine.day !== ref.getDay()) bad.push(`${ymd}: ${JSON.stringify(mine)} vs ${refMonth}/${ref.getDay()}`);
    }
    expect(bad).toEqual([]);
  }, 60_000);
});

describe('lunarLabel', () => {
  it('初一 / 十五 / 二十 / 廿九 / 三十 / 冬腊', () => {
    expect(lunarLabel(1, 1)).toBe('正月初一');
    expect(lunarLabel(8, 15)).toBe('八月十五');
    expect(lunarLabel(5, 20)).toBe('五月二十');
    expect(lunarLabel(12, 29)).toBe('腊月廿九');
    expect(lunarLabel(11, 30)).toBe('冬月三十');
    expect(lunarLabel(3, 10)).toBe('三月初十');
  });
});
