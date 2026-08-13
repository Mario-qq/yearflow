/**
 * 番茄钟瞬态 store：只存「状态迁移时才变」的字段。
 *
 * ⚠️ 铁律：这里不得存放任何每秒（甚至每 5 秒）变化的字段 —— 剩余时间永远现算。
 * 倒计时若走 setState，番茄钟在任何页面开着都会让整棵 App 树每秒重渲一次，
 * 甘特图「拖拽 60fps / 缩放 <150ms」的门槛当场失守。倒计时一律由 1s 单例 ticker
 * 经 ref 直写 DOM（S4），React 只在开始/暂停/结束/切阶段时重渲。
 */
import { create } from 'zustand';
import type { FocusSession, PomodoroPhase } from '../types/domain';

/** 状态迁移时才更新的运行视图。剩余时间 = remainingMs()，不在这里 */
export interface RunningView {
  sessionId: string;
  phase: PomodoroPhase;
  goalId?: string;
  taskId?: string;
  startAt: number;
  plannedMs: number;
  paused: boolean;
  /** 计划终点（含已发生的暂停）；暂停中该值会随时间漂移，此时用 pausedRemainingMs */
  plannedEnd: number;
  /** 暂停中的剩余毫秒（恒定）；非暂停时为 null */
  pausedRemainingMs: number | null;
}

/** 失联后的结算对话（§5.5 第 4 行） */
export interface AskState {
  sessionId: string;
  /** 「算到刚才 X 分钟」的 X（已扣暂停，不是裸截断） */
  focusMs: number;
  /** 最后一次心跳时刻，即结算截止点 */
  endAt: number;
  needsReview: boolean;
}

export interface PomodoroState {
  running: RunningView | null;
  /** 今日已完成的专注段数（节律计数，读独立 localStorage 键） */
  cycleCompleted: number;
  /** Web Locks 选主结果：只有 leader 响铃/弹通知 */
  isLeader: boolean;
  /** 最近一次结算结果，供面板结果卡；下次开始时清空 */
  lastResult: FocusSession | null;
  ask: AskState | null;
  /** 一句轻提示（如「这段不足 1 分钟，未记录」），UI 消费后清空 */
  notice: string | null;
}

export const usePomodoroStore = create<PomodoroState>()(() => ({
  running: null,
  cycleCompleted: 0,
  isLeader: false,
  lastResult: null,
  ask: null,
  notice: null,
}));
