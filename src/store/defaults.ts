import type { AppSettings } from '../types/domain';

export const DEFAULT_GRID_COLUMNS = ['name', 'dates', 'progress', 'status'];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  weekStartsOn: 1,
  yearInView: new Date().getFullYear(),
  ganttView: {
    zoom: 'month',
    scrollDate: new Date().toISOString().slice(0, 10),
    collapsedGoalIds: [],
    gridColumns: DEFAULT_GRID_COLUMNS,
    gridWidth: 320,
    showDependencies: true,
    showBaseline: false,
    filter: {},
  },
};
