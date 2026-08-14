/**
 * UI 层统一入口：所有「开始专注」的手势都必须走这里。
 * 原因是 autoplay policy —— AudioContext 只能在用户手势的同步回调里创建并 resume()，
 * 漏一个入口（打卡页 ▶、快捷键 P、面板按钮）那条路起的番茄到点就是哑的。
 */
import { useStore } from '../store/useStore';
import { unlockAudio } from './chime';
import { startFocus, togglePomodoro, type StartOpts } from './kernel';
import { openPip } from './pip';
import { usePomodoroStore } from './store';

/**
 * 顺带弹小窗：requestWindow 需要 transient user activation，而「开始专注」正是手势 ——
 * 这是全流程里唯一能自动开窗的时机（自动进休息、恢复结算都不是手势，开不出来）。
 */
function autoOpenPip(): void {
  if (!useStore.getState().settings.pomodoro.pipAuto) return;
  if (usePomodoroStore.getState().pipHost) return;
  void openPip();
}

export function startPomodoro(opts: StartOpts = {}): void {
  unlockAudio();
  autoOpenPip();
  startFocus(opts);
}

/** 按 P：空闲则开始（带当前选中任务），运行则暂停，暂停则继续 */
export function togglePomodoroFromGesture(sel: { goalId?: string; taskId?: string } = {}): void {
  unlockAudio();
  if (!usePomodoroStore.getState().running) autoOpenPip();
  togglePomodoro(sel);
}
