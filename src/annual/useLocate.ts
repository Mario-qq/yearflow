/**
 * 回流甘特图（规格 §4.4）：复用既有事件通道 gantt/bus.ts，沿用 CommandPalette
 * 已验证的 gotoGantt 模式（navigate 后延时 emit），不另发明。
 *
 * 比命令面板多一步：年报可能在看**往年**，而甘特图的时间轴原点是 settings.yearInView
 * （timeScale.ts），跨年 emit 会滚到坐标系外。所以先对齐 yearInView 再 emit。
 */
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { emitGantt } from '../gantt/bus';
import { useStore } from '../store/useStore';
import { GOTO_GANTT_DELAY_MS } from './constants';

export interface LocateApi {
  /** 定位任务并闪烁；year = 该任务所属年份（用于对齐 yearInView） */
  locateTask: (taskId: string, year: number) => void;
  /** 滚动到某一天（YYYY-MM-DD） */
  scrollToDate: (date: string) => void;
}

export function useLocate(): LocateApi {
  const navigate = useNavigate();
  const onGanttPage = useLocation().pathname.startsWith('/gantt');

  const go = useCallback(
    (year: number, fn: () => void) => {
      const s = useStore.getState();
      const yearChanged = s.settings.yearInView !== year;
      if (yearChanged) s.updateSettings({ yearInView: year });
      if (!onGanttPage) navigate('/gantt');
      // 换年要等时间轴按新原点重排一帧；同页同年也走同一条延时路径，行为可预期
      if (onGanttPage && !yearChanged) fn();
      else setTimeout(fn, GOTO_GANTT_DELAY_MS);
    },
    [navigate, onGanttPage],
  );

  return {
    locateTask: useCallback(
      (taskId: string, year: number) => go(year, () => emitGantt('locate-task', { taskId })),
      [go],
    ),
    scrollToDate: useCallback(
      (date: string) =>
        go(Number(date.slice(0, 4)), () => emitGantt('scroll-to-date', { date })),
      [go],
    ),
  };
}
