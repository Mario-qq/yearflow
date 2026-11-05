/**
 * 一句话新建（DESK_SPEC §3.4）：把「!! @李工 下发 索引脚本 下周二 #SAP」解析成一条事项或例行。
 * 纯函数，单测见 parseQuickAdd.test.ts。界面上不放写法示例，写法只在新建按钮的悬停提示里：
 *
 *   !! 紧急 · ! 尽快 · @人（后面加空格）· 今天/明天/后天/周三/下周一/10.20/10月20日 · 截止周五 / ddl 10.31
 *   * 重要（独立的一个星号，或 ★）· #目标名 · 每天/工作日/每周一三/每月5号/每月最后一天/每月第二个周三/每月最后一个周五 · ~生活 · 待处理
 *   例行可带时间：9:00 / 9点 / 9点半 / 14点30
 *   会议：标题里有「会议/开会/例会/周会/面试/评审…」又写了时间 ⇒ 建会议（默认提前 10 分钟提醒）；
 *   可加「上午/下午/晚上」，光写 1–6 点按下午算。其余待办标题里的「3点」原样保留
 *
 * 不写日子 = 今天；写「待处理」= 不排日子。日期词在句首/句尾可以不加空格，句中要用空格隔开
 * （否则「今天的报表」会被吃掉一个「今天」）。
 */
import type { RoutineRule, Urgency, WorkScope } from '../../types/domain';
import { fmtDay, toDay } from '../date';
import { DEFAULT_REMIND } from '../derive/meetings';

export interface QuickAddResult {
  kind: 'todo' | 'followup' | 'meeting' | 'routine';
  title: string;
  urgency: Urgency;
  scope: WorkScope;
  /** null = 待处理（例行恒为 null，例行用 rule） */
  date: string | null;
  dueDate?: string;
  person?: string;
  mode?: 'inform' | 'dispatch';
  goalId?: string;
  /** #后面写了但没匹配到任何目标的词（界面提示用） */
  unknownGoal?: string;
  rule?: RoutineRule;
  /** 例行规则的原话，如「每周一三」 */
  ruleLabel?: string;
  /** 例行的时间点 / 会议开始时间 HH:mm */
  time?: string;
  /** 会议提醒（提前几分钟） */
  remind?: number[];
  /** 重要（写了独立的 * 或 ★） */
  important?: boolean;
}

const WD: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const NTH: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };
const DATE_WORD = '(?:今天|明天|后天|大后天|下下周[一二三四五六日天]|下周[一二三四五六日天]|周[一二三四五六日天]|\\d{1,2}[./-]\\d{1,2}|\\d{1,2}月\\d{1,2}[日号])';

/** 日期词 → YYYY-MM-DD。周 X 已过 ⇒ 下周 X；M.D 早于 30 天前 ⇒ 明年 */
export function dateWord(word: string, today: string): string | null {
  const t = toDay(today);
  const rel: Record<string, number> = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 };
  if (word in rel) return fmtDay(t.add(rel[word], 'day'));
  let m = /^(下下周|下周|周)([一二三四五六日天])$/.exec(word);
  if (m) {
    const monday = t.startOf('isoWeek');
    const offset = (WD[m[2]] + 6) % 7; // 周一=0 … 周日=6
    const weeks = m[1] === '下下周' ? 2 : m[1] === '下周' ? 1 : 0;
    const d = monday.add(weeks * 7 + offset, 'day');
    return fmtDay(weeks === 0 && d.isBefore(t, 'day') ? d.add(7, 'day') : d);
  }
  m = /^(\d{1,2})[./-](\d{1,2})$/.exec(word) ?? /^(\d{1,2})月(\d{1,2})[日号]$/.exec(word);
  if (m) {
    const mon = Number(m[1]);
    const day = Number(m[2]);
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    let d = t.month(mon - 1).date(day);
    if (d.month() !== mon - 1) return null; // 2.30 之类
    if (d.isBefore(t.subtract(30, 'day'), 'day')) d = d.add(1, 'year');
    return fmtDay(d);
  }
  return null;
}

/**
 * 规则词必须独立成词（两侧是空白，text 已在首尾补了空格）：「统计工作日加班」不该变成例行。
 * 捕获组 1 = 整个规则词（即 label），其后的组是各规则自己的参数。
 */
const RULES: { re: RegExp; make: (m: RegExpExecArray) => RoutineRule | null }[] = [
  { re: /\s(每天|每日)(?=\s)/, make: () => ({ type: 'daily' }) },
  { re: /\s(每个工作日|工作日)(?=\s)/, make: () => ({ type: 'workday' }) },
  {
    re: /\s(每月(?:最后一个|第([一二三四五1-5])个)周([一二三四五六日天]))(?=\s)/,
    make: (m) => ({ type: 'monthlyNth', nth: m[2] ? NTH[m[2]] : -1, weekday: WD[m[3]] }),
  },
  { re: /\s(每月(?:最后一天|月末|底))(?=\s)/, make: () => ({ type: 'monthlyDay', monthDay: -1 }) },
  {
    re: /\s(每月(\d{1,2})[号日])(?=\s)/,
    make: (m) => {
      const n = Number(m[2]);
      return n >= 1 && n <= 31 ? { type: 'monthlyDay', monthDay: n } : null;
    },
  },
  {
    re: /\s(每周([一二三四五六日天]+))(?=\s)/,
    make: (m) => ({ type: 'weekly', daysOfWeek: [...new Set([...m[2]].map((c) => WD[c]))].sort((a, b) => a - b) }),
  },
];

function parseRule(text: string): { rule: RoutineRule; label: string } | null {
  for (const { re, make } of RULES) {
    const m = re.exec(text);
    const rule = m && make(m);
    if (m && rule) return { rule, label: m[1] };
  }
  return null;
}

/** 会议词：标题里出现它、又写了时间 ⇒ 会议 */
const MEETING_WORD = /会议|开会|例会|周会|月会|晨会|早会|碰头会|评审|面试|复盘会|沟通会|讨论会|meeting|call/i;

const DISPATCH_VERB = /^(下发|发给|分派|派给|转给|转发)\s*/;
const INFORM_VERB = /^(告知|通知|告诉|跟.{0,3}说)\s*/;

export function parseQuickAdd(input: string, ctx: { today: string; goals: { id: string; name: string }[] }): QuickAddResult {
  const { today } = ctx;
  let t = ` ${input.trim()} `;
  const cut = (s: string) => {
    t = t.replace(s, ' ');
  };

  const routine = parseRule(t);
  if (routine) cut(routine.label);

  let time: string | undefined;
  let timeRaw = '';
  const meeting = !routine && MEETING_WORD.test(t);
  if (routine || meeting) {
    const tm = /\s(上午|早上|中午|下午|晚上)?(\d{1,2})(?:[:：](\d{2})|点(半|(\d{1,2})分?)?)(?=\s)/.exec(t);
    if (tm) {
      let h = Number(tm[2]);
      const min = tm[3] !== undefined ? Number(tm[3]) : tm[4] === '半' ? 30 : tm[5] !== undefined ? Number(tm[5]) : 0;
      const pm = tm[1] === '下午' || tm[1] === '晚上' || (tm[1] === '中午' && h < 3) || (!tm[1] && meeting && h >= 1 && h <= 6);
      if (pm && h < 12) h += 12;
      if (h <= 23 && min <= 59) {
        time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        timeRaw = tm[0].trim();
        t = t.replace(tm[0], ' ');
      }
    }
  }

  let dueDate: string | undefined;
  let m = new RegExp(`(?:截止|ddl\\s*)(${DATE_WORD})`, 'i').exec(t);
  if (m) {
    dueDate = dateWord(m[1], today) ?? undefined;
    cut(m[0]);
  }

  let date: string | null | undefined;
  // 句中要求两侧是空白；句首/句尾的日期词可以紧贴正文
  m = new RegExp(`\\s(${DATE_WORD})\\s`).exec(t) ?? new RegExp(`^\\s(${DATE_WORD})`).exec(t) ?? new RegExp(`(${DATE_WORD})\\s$`).exec(t);
  if (m) {
    date = dateWord(m[1], today);
    // 按命中位置切：标题里可能更早出现同一个词（「周三的周报 周三」）
    const at = m.index + m[0].indexOf(m[1]);
    t = `${t.slice(0, at)} ${t.slice(at + m[1].length)}`;
  }
  if (/(^|\s)待处理(\s|$)/.test(t)) {
    date = null;
    t = t.replace('待处理', ' ');
  }

  let urgency: Urgency = 'normal';
  if ((m = /[!！]{2,}/.exec(t))) {
    urgency = 'urgent';
    cut(m[0]);
  } else if ((m = /[!！]/.exec(t))) {
    urgency = 'soon';
    cut(m[0]);
  }

  let important = false;
  if ((m = /(^|\s)[*＊★](?=\s)/.exec(t))) {
    important = true;
    t = t.replace(m[0], ' ');
  }

  let person: string | undefined;
  if ((m = /@([^\s@#~!！]+)/.exec(t))) {
    person = m[1];
    cut(m[0]);
  }

  let goalId: string | undefined;
  let unknownGoal: string | undefined;
  if ((m = /#([^\s@#~!！]+)/.exec(t))) {
    const q = m[1].toLowerCase();
    const live = ctx.goals;
    const hit =
      live.find((g) => g.name.toLowerCase() === q) ??
      live.find((g) => g.name.toLowerCase().startsWith(q)) ??
      live.find((g) => g.name.toLowerCase().includes(q));
    if (hit) goalId = hit.id;
    else unknownGoal = m[1];
    cut(m[0]);
  }

  let scope: WorkScope | undefined;
  if ((m = /[~～](生活|工作)/.exec(t))) {
    scope = m[1] === '生活' ? 'life' : 'work';
    cut(m[0]);
  }

  let title = t.replace(/\s+/g, ' ').trim();
  let mode: 'inform' | 'dispatch' | undefined;
  if (person) {
    if (DISPATCH_VERB.test(title)) {
      mode = 'dispatch';
      title = title.replace(DISPATCH_VERB, '');
    } else {
      mode = 'inform';
      title = title.replace(INFORM_VERB, '');
    }
  }

  if (routine) {
    return {
      kind: 'routine',
      title,
      urgency,
      scope: scope ?? 'work',
      date: null,
      rule: routine.rule,
      ruleLabel: routine.label,
      ...(time ? { time } : {}),
      ...(goalId ? { goalId } : {}),
      ...(unknownGoal ? { unknownGoal } : {}),
    };
  }

  const finalDate = date === undefined ? today : date;
  const weekend = finalDate !== null && [0, 6].includes(toDay(finalDate).day());
  if (meeting && time && finalDate !== null) {
    return {
      kind: 'meeting',
      title,
      urgency,
      scope: scope ?? (weekend ? 'life' : 'work'),
      date: finalDate,
      time,
      remind: [...DEFAULT_REMIND],
      ...(goalId ? { goalId } : {}),
      ...(unknownGoal ? { unknownGoal } : {}),
      ...(important ? { important } : {}),
    };
  }
  // 会议词 + 时间但放进了待处理：不算会议，时间原样还给标题
  if (meeting && time) title = `${timeRaw} ${title}`;
  return {
    kind: person ? 'followup' : 'todo',
    title,
    urgency,
    scope: scope ?? (weekend ? 'life' : 'work'),
    date: finalDate,
    ...(dueDate ? { dueDate } : {}),
    ...(person ? { person, mode } : {}),
    ...(goalId ? { goalId } : {}),
    ...(unknownGoal ? { unknownGoal } : {}),
    ...(important ? { important } : {}),
  };
}
