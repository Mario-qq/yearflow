/**
 * 学习防忘（DESK_SPEC §五）的界面入口：学习卡、头部学习格、今日脉搏、S 键、托盘「开始学习」共用。
 * 派生全在 lib/derive/study.ts（纯函数 + 单测），这里只负责订阅 store、拼成一份视图、发起命令。
 */
import { useMemo } from 'react';
import type { DeskSettings, FocusSession, StudyAnchor } from '../types/domain';
import { DEFAULT_SETTINGS } from '../store/defaults';
import { useStore } from '../store/useStore';
import { setCheckIn } from '../store/actions';
import { isDesktop } from '../lib/desktop';
import { showToast } from '../lib/toast';
import {
  anchorFor,
  brokeYesterday,
  buildStudyLedger,
  studiedOn,
  studyAutoCheckIn,
  studyDueOn,
  studyGoalSet,
  studyMinutesOn,
  studyPicks,
  studyStreak,
  weekStudyDays,
  type StudyData,
  type StudyPick,
} from '../lib/derive/study';
import { weekMonday } from '../lib/derive/desk';
import { startPomodoro } from '../pomodoro/api';
import { discardFocus, setCommitHandler, stopFocus } from '../pomodoro/kernel';
import { usePomodoroStore, type RunningView } from '../pomodoro/store';
import { useDeskUi } from './uiStore';

/** 设置里的工作台偏好（老设置缺字段时补默认值） */
export function deskPrefs(settings = useStore.getState().settings): DeskSettings {
  return { ...DEFAULT_SETTINGS.desk, ...settings.desk };
}

export function useDeskPrefs(): DeskSettings {
  const desk = useStore((s) => s.settings.desk);
  return useMemo(() => ({ ...DEFAULT_SETTINGS.desk, ...desk }), [desk]);
}

export function patchDeskPrefs(patch: Partial<DeskSettings>): void {
  const s = useStore.getState();
  s.updateSettings({ desk: { ...deskPrefs(s.settings), ...patch } });
}

export interface StudyView {
  prefs: DeskSettings;
  /** 设置过学习目标（且目标还在） */
  configured: boolean;
  study: Set<string>;
  picks: StudyPick[];
  /** 当前推荐（「换一个」轮换） */
  pick: StudyPick | null;
  /** 今天排了学习 */
  dueToday: boolean;
  studied: boolean;
  /** 今天学习专注分钟数 */
  minutes: number;
  /** 本周一~周日学没学 */
  week: boolean[];
  weekDays: number;
  broke: boolean;
  streak: number;
  anchor: StudyAnchor;
  /** 正在专注的学习任务（番茄钟专注段且挂在学习目标上） */
  running: RunningView | null;
}

function studyData(): StudyData {
  const s = useStore.getState();
  return {
    goals: Object.values(s.goals),
    tasks: Object.values(s.tasks),
    checkIns: Object.values(s.checkIns),
    exemptions: Object.values(s.exemptions),
    sessions: Object.values(s.focusSessions),
  };
}

/** 计算一份学习视图（hook 与非 React 场景——提醒、托盘、S 键——共用） */
export function computeStudy(today: string, data: StudyData, prefs: DeskSettings, pickIndex: number, run: RunningView | null): StudyView {
  const study = studyGoalSet(data.goals, prefs.studyGoalIds);
  const picks = studyPicks(today, data, study);
  const ledger = buildStudyLedger(study, data.checkIns, data.sessions);
  const dueCache = new Map<string, boolean>();
  const dueOn = (d: string) => {
    let v = dueCache.get(d);
    if (v === undefined) dueCache.set(d, (v = studyDueOn(d, data, study)));
    return v;
  };
  const week = weekStudyDays(weekMonday(today), ledger, prefs.shortMinutes);
  const running = run && run.phase === 'focus' && run.goalId && study.has(run.goalId) ? run : null;
  return {
    prefs,
    configured: study.size > 0,
    study,
    picks,
    pick: picks.length ? picks[pickIndex % picks.length] : null,
    dueToday: picks.some((p) => p.due),
    studied: studiedOn(ledger, today, prefs.shortMinutes),
    minutes: studyMinutesOn(ledger, today),
    week,
    weekDays: week.filter(Boolean).length,
    broke: brokeYesterday(today, ledger, prefs.shortMinutes, dueOn),
    streak: studyStreak(today, ledger, prefs.shortMinutes, dueOn),
    anchor: anchorFor(prefs, today),
    running,
  };
}

export function useStudy(today: string): StudyView {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const checkIns = useStore((s) => s.checkIns);
  const exemptions = useStore((s) => s.exemptions);
  const sessions = useStore((s) => s.focusSessions);
  const prefs = useDeskPrefs();
  const pickIndex = useDeskUi((s) => s.studyPick);
  const run = usePomodoroStore((s) => s.running);
  return useMemo(
    () =>
      computeStudy(
        today,
        {
          goals: Object.values(goals),
          tasks: Object.values(tasks),
          checkIns: Object.values(checkIns),
          exemptions: Object.values(exemptions),
          sessions: Object.values(sessions),
        },
        prefs,
        pickIndex,
        run,
      ),
    [today, goals, tasks, checkIns, exemptions, sessions, prefs, pickIndex, run],
  );
}

/** 不在 React 里（提醒、托盘、S 键）时现算一份 */
export function studyNow(today: string): StudyView {
  return computeStudy(today, studyData(), deskPrefs(), useDeskUi.getState().studyPick, usePomodoroStore.getState().running);
}

// ── 命令 ─────────────────────────────────────────────────────────────────

/** 开始学：起番茄钟并绑定学习任务（full = 每次学习分钟数，short = 短版）。返回是否开了 */
export function startStudy(today: string, kind: 'full' | 'short' = 'full', pick?: StudyPick | null): boolean {
  const v = studyNow(today);
  const p = pick ?? v.pick;
  if (!p) {
    showToast(v.configured ? '今天没有在办的学习任务' : '先在学习卡上选哪些目标算学习');
    return false;
  }
  const min = kind === 'short' ? v.prefs.shortMinutes : v.prefs.studyMinutes;
  startPomodoro({ goalId: p.goalId, taskId: p.taskId, plannedMs: min * 60_000 });
  return true;
}

/** 结束并打卡：按实际时长记一段专注，再给这个学习任务打「完成」 */
export function finishStudy(run: RunningView, today: string): void {
  stopFocus();
  if (run.goalId && run.taskId) setCheckIn({ goalId: run.goalId, taskId: run.taskId, date: today, status: 'done' });
}

export function abandonStudy(): void {
  discardFocus();
  showToast('这一段放弃了，不记录');
}

/** 不开计时、直接记「学过了」（在别处学的） */
export function markStudied(p: StudyPick, today: string): void {
  setCheckIn({ goalId: p.goalId, taskId: p.taskId, date: today, status: 'done' });
}

export function swapStudyPick(): void {
  const ui = useDeskUi.getState();
  ui.set({ studyPick: ui.studyPick + 1 });
}

// ── 专注结束自动打卡 ─────────────────────────────────────────────────────

let autoInit = false;

/**
 * 学习任务的专注跑到计划终点 ⇒ 自动打卡（够分钟数记「完成」，不够记「做了一点」）。
 * 只在主窗口注册：桌面版小窗里结束的那段经 storage 广播过来（remote），由主窗口代打卡 ——
 * 小窗的内存 store 不会把打卡同步回主窗口。网页版的 remote 来自别的标签页，那边自己会打，这里跳过。
 */
export function initStudyAutoCheckIn(): void {
  if (autoInit) return;
  autoInit = true;
  setCommitHandler((session: FocusSession, remote: boolean) => {
    if (remote && !isDesktop()) return;
    const s = useStore.getState();
    const prefs = deskPrefs(s.settings);
    const plan = studyAutoCheckIn(session, {
      study: studyGoalSet(Object.values(s.goals), prefs.studyGoalIds),
      studyMinutes: prefs.studyMinutes,
      sessions: Object.values(s.focusSessions),
      checkIns: Object.values(s.checkIns),
    });
    if (!plan) return;
    setCheckIn(plan);
    const name = s.tasks[plan.taskId]?.name ?? '';
    showToast(plan.status === 'done' ? `学够了，已打卡「${name}」完成` : `已记「${name}」做了一点（今天还没学够 ${prefs.studyMinutes} 分钟）`);
  });
}

/** 本地 HH:mm（提醒比较用） */
export const nowHm = (d = new Date()): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

