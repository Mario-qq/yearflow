/**
 * UI 层统一入口：所有「开始专注」的手势都必须走这里。
 * 原因是 autoplay policy —— AudioContext 只能在用户手势的同步回调里创建并 resume()，
 * 漏一个入口（打卡页 ▶、快捷键 P、面板按钮）那条路起的番茄到点就是哑的。
 */
import { unlockAudio } from './chime';
import { startFocus, togglePomodoro, type StartOpts } from './kernel';

export function startPomodoro(opts: StartOpts = {}): void {
  unlockAudio();
  startFocus(opts);
}

/** 按 P：空闲则开始（带当前选中任务），运行则暂停，暂停则继续 */
export function togglePomodoroFromGesture(sel: { goalId?: string; taskId?: string } = {}): void {
  unlockAudio();
  togglePomodoro(sel);
}
