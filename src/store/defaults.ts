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
    gridColumns: DEFAULT_GRID_COLUMNS,
    gridWidth: 320,
    showDependencies: true,
    showBaseline: false,
    filter: {},
  },
};
