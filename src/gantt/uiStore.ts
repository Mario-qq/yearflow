/**
 * 甘特图瞬态 UI 状态（hover 联动、十字定位、行内编辑、定位闪烁）。
 * 与数据 store 分离：不持久化、不进 undo 栈；高频字段（hover）由各叶子组件
 * 用细粒度 selector 订阅，避免 GanttView 整树重渲。
 */
import { create } from 'zustand';
import { FLASH_MS } from './constants';

export type EditingField = 'name' | 'progress' | 'goalName';

interface GanttUiState {
  /** hover 所在行（任务/目标/幽灵行 id）——左右联动与整行淡背景 */
  hoverRowId: string | null;
  /** hover 所在日列序号——十字定位（表头单元格 + 整列淡背景） */
  hoverDayIdx: number | null;
  /** 行内编辑中的单元格 */
  editing: { id: string; field: EditingField } | null;
  /** 定位闪烁的任务（点击左行 / 命令面板跳转），FLASH_MS 后自动清除 */
  flashTaskId: string | null;

  setHoverRow: (id: string | null) => void;
  setHoverCell: (rowId: string | null, dayIdx: number | null) => void;
  setEditing: (e: GanttUiState['editing']) => void;
  flashTask: (id: string) => void;
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;

export const useGanttUi = create<GanttUiState>()((set, get) => ({
  hoverRowId: null,
  hoverDayIdx: null,
  editing: null,
  flashTaskId: null,

  setHoverRow: (id) => {
    if (get().hoverRowId !== id) set({ hoverRowId: id });
  },
  setHoverCell: (rowId, dayIdx) => {
    const s = get();
    if (s.hoverRowId !== rowId || s.hoverDayIdx !== dayIdx) {
      set({ hoverRowId: rowId, hoverDayIdx: dayIdx });
    }
  },
  setEditing: (editing) => set({ editing }),
  flashTask: (id) => {
    clearTimeout(flashTimer);
    set({ flashTaskId: id });
    flashTimer = setTimeout(() => set({ flashTaskId: null }), FLASH_MS);
  },
}));
