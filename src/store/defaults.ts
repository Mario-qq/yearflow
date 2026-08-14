import type { AppSettings } from '../types/domain';

export const DEFAULT_GRID_COLUMNS = ['name', 'dates', 'progress', 'status'];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  weekStartsOn: 1,
  yearInView: new Date().getFullYear(),
  ganttView: {
    zoom: 'month',
    scrollDate: '', // 空 = 从未记录：首次进入甘特页平滑滚到今日线视口 1/3 处

    collapsedGoalIds: [],
    expandedTrackIds: [],
    gridColumns: DEFAULT_GRID_COLUMNS,
    gridWidth: 320,
    gridCollapsed: false,
    gridColWidths: {},
    showDependencies: true,
    showBaseline: false,
    filter: {},
  },
  pomodoro: {
    focusMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    longBreakEvery: 4,
    sound: true,
    notify: false,
    autoBreak: true,
    pipAuto: false,
  },
};
