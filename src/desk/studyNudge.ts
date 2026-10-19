/**
 * 学习到点提醒（DESK_SPEC §五 第 2 层）：只在桌面版主窗口跑（收进托盘时渲染进程照常跑）。
 * 每 30 秒判一次 lib/derive/study.studyNudgeDue：到锚点时间还没开始 → 第一次提醒；到最晚时间还没学 →
 * 第二次「15 分钟也算」。每天每种最多一次，记在 localStorage（按日期分键，只留最近几天）。
 * 顺带把「今天学没学」写到托盘悬停提示里；下班收尾提醒（DESK 收尾面板）、日常习惯到点提醒也在这个轮询里。
 */
import { todayStr } from '../lib/date';
import { desktop } from '../lib/desktop';
import { studyNudgeDue, type StudyNudge } from '../lib/derive/study';
import { shutdownDue } from '../lib/derive/desk';
import { habitNudgesDue, habitViews } from '../lib/derive/habits';
import { useDeskUi } from './uiStore';
import { useStore } from '../store/useStore';
import { nowHm, studyNow, type StudyView } from './study';

const POLL_MS = 30_000;
const KEY_PREFIX = 'yearflow:desk:nudge:';

/** habits = 今天已提醒过的习惯 id */
type Sent = { anchor?: boolean; lastCall?: boolean; shutdown?: boolean; habits?: string[] };

function readSent(date: string): Sent {
  try {
    return JSON.parse(localStorage.getItem(KEY_PREFIX + date) ?? '{}') as Sent;
  } catch {
    return {};
  }
}

function writeSent(date: string, sent: Sent): void {
  try {
    localStorage.setItem(KEY_PREFIX + date, JSON.stringify(sent));
    // 只留今天这一键：旧日期的记录没用了
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(KEY_PREFIX) && k !== KEY_PREFIX + date) localStorage.removeItem(k);
    }
  } catch {
    // 记不住最多是同一天多提醒一次
  }
}

function pickLabel(v: StudyView): string {
  const p = v.pick;
  if (!p) return '学习';
  const g = useStore.getState().goals[p.goalId];
  return `${g?.name ?? ''} · ${p.taskName}`;
}

/** 通知文案（纯拼字，单独导出给自查脚本对照） */
export function nudgeText(kind: StudyNudge, v: StudyView): { title: string; body: string } {
  const what = pickLabel(v);
  if (kind === 'anchor') {
    const where = v.anchor.text ? `${v.anchor.text}，` : '';
    return {
      title: '到点学习了',
      body: `${where}学 ${v.prefs.studyMinutes} 分钟：${what}${v.broke ? '。昨天断了一天，今天别连断' : ''}`,
    };
  }
  return { title: '今天还没学', body: `${v.prefs.shortMinutes} 分钟也算：${what}。点这里开始` };
}

function trayText(v: StudyView): string {
  if (!v.configured) return '';
  if (v.running) return '正在学习';
  if (v.studied) return v.minutes > 0 ? `今天学过了 · ${v.minutes} 分钟` : '今天学过了';
  if (v.dueToday) return `今天还没学 · ${pickLabel(v)}`;
  return '';
}

let started = false;
let lastTray: string | null = null;

/** 一次判定（导出给自查脚本直接驱动）。返回这次发出的提醒种类 */
export function tickStudyNudge(now = new Date()): StudyNudge | null {
  const d = desktop();
  if (!d || !useStore.getState().hydrated) return null;
  const today = todayStr();
  const v = studyNow(today);

  const tray = trayText(v);
  if (tray !== lastTray) {
    lastTray = tray;
    void d.setTrayStatus(tray);
  }

  if (!v.configured) return null;
  const sent = readSent(today);
  const kind = studyNudgeDue({
    nowHm: nowHm(now),
    anchor: v.anchor,
    lastCall: v.prefs.lastCall,
    remind: v.prefs.remind,
    due: v.dueToday,
    studied: v.studied,
    running: Boolean(v.running),
    sent,
  });
  if (!kind) return null;
  // 发了最晚那次，锚点那次也算发过（不会回头再补）
  writeSent(today, kind === 'lastCall' ? { anchor: true, lastCall: true } : { ...sent, anchor: true });
  const { title, body } = nudgeText(kind, v);
  void d.notify(body, { title, route: '/desk', sound: true });
  return kind;
}

/** 下班收尾提醒：到点、今天是工作日、还没点「收工」⇒ 每天一次通知，点开直接打开收尾面板 */
export function tickShutdownNudge(now = new Date()): boolean {
  const d = desktop();
  const st = useStore.getState();
  if (!d || !st.hydrated) return false;
  const today = todayStr();
  const sent = readSent(today);
  if (sent.shutdown) return false;
  const due = shutdownDue({ nowHm: nowHm(now), at: st.settings.desk.shutdownAt, today, doneOn: useDeskUi.getState().shutdownDoneOn, marks: st.dayMarks });
  if (!due) return false;
  writeSent(today, { ...sent, shutdown: true });
  void d.notify('回顾今天、给没做完的找个去处、挑明天的要事，一分钟。', { title: '该收尾了', route: '/desk?shutdown=1', sound: false });
  return true;
}

/** 日常习惯到点提醒：每个习惯每天最多一次；同一轮到点的几个合成一条通知。返回这次提醒的习惯 id */
export function tickHabitNudge(now = new Date()): string[] {
  const d = desktop();
  const st = useStore.getState();
  if (!d || !st.hydrated) return [];
  const today = todayStr();
  const sent = readSent(today);
  const due = habitNudgesDue(habitViews(Object.values(st.habits), st.habitLogs, today), nowHm(now), sent.habits ?? []);
  if (!due.length) return [];
  const ids = due.map((v) => v.habit.id);
  writeSent(today, { ...sent, habits: [...(sent.habits ?? []), ...ids] });
  const line = (v: (typeof due)[number]) => {
    const h = v.habit;
    const what = `${h.icon ? h.icon + ' ' : ''}${h.title}`;
    if (h.kind === 'avoid') return `${what}：${h.cue ? h.cue + '，' : ''}忍住${v.streak ? `（已守住 ${v.streak} 天）` : ''}`;
    return `${what}${h.cue ? `：${h.cue}` : ''}${v.broke ? '。昨天断了，今天接上' : ''}`;
  };
  const title = due.length === 1 ? (due[0].habit.kind === 'avoid' ? '提醒自己' : '该做了') : '日常习惯';
  void d.notify(due.map(line).join('\n'), { title, route: '/desk', sound: false });
  return ids;
}

export function initStudyNudges(): void {
  const d = desktop();
  if (!d || started) return;
  started = true;
  // 刚启动别立刻弹（同步、hydrate 还在收尾），等一个轮询周期的零头
  const tick = () => {
    tickStudyNudge();
    tickShutdownNudge();
    tickHabitNudge();
  };
  setTimeout(tick, 5_000);
  setInterval(tick, POLL_MS);
  // 合盖/睡眠醒来：立刻补判一次，不等下一个 30 秒
  d.onPowerResume(tick);
}
