/**
 * 小窗的唯一绘制通道：mm:ss 文本 + 进度线 scaleX，全部 ref 直写、零重渲。
 *
 * 抽出来是因为展开态（PipView）与贴边收起态（PipDock）是两棵完全不同的树，却必须共用
 * 同一套「每秒只改文本与 transform、绝不 setState」的写法 —— 小窗常开，每秒重渲会把
 * 甘特图的 60fps 门槛拖下水（全站共用的一条铁律）。
 */
import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { useStore } from '../store/useStore';
import { mmss } from './format';
import { remainingMs } from './kernel';
import { usePomodoroStore } from './store';
import { subscribeTick } from './ticker';

export function usePipPaint(
  timeRef: RefObject<HTMLElement | null>,
  fillRef: RefObject<HTMLElement | null>,
): void {
  const paint = (msLeft: number): void => {
    const r = usePomodoroStore.getState().running;
    const total = r?.plannedMs ?? useStore.getState().settings.pomodoro.focusMin * 60_000;
    const left = r ? msLeft : total;
    if (timeRef.current) timeRef.current.textContent = mmss(left);
    if (fillRef.current) {
      const elapsed = total > 0 ? Math.min(1, Math.max(0, 1 - left / total)) : 0;
      fillRef.current.style.transform = `scaleX(${elapsed})`;
    }
  };
  // paint 每次渲染都是新函数，但它只读 store 的最新快照 —— 订阅一次即终身有效，
  // 放进依赖只会让每秒都退订重订
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => subscribeTick(paint), []);
  // 挂载/切换形态的那一帧就得是对的，不能等下一次 tick 才填上文本
  useLayoutEffect(() => paint(remainingMs()));
}
