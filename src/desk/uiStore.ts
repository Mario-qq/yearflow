/**
 * 工作台界面态（不入库、不进 undo）：视图、选择、浮层。
 * 视图（周/月）记在 localStorage —— 每台机器自己的习惯，不随数据同步。
 */
import { create } from 'zustand';
import { todayStr } from '../lib/date';

export type DeskView = 'week' | 'month';

export type DeskMenu =
  | { kind: 'day'; date: string; x: number; y: number }
  | { kind: 'row'; key: string; day?: string; x: number; y: number }
  | { kind: 'urgency'; x: number; y: number };

export interface MoverState {
  mode: 'drag' | 'click';
  keys: string[];
  /** click 模式的锚点矩形（挂在谁旁边）；drag 模式固定在右下角 */
  anchor?: { left: number; top: number; bottom: number };
}

interface DeskUi {
  view: DeskView;
  /** 周视图 = 那周周一；月视图 = 那个月里任意一天 */
  anchor: string | null;
  sel: Set<string>;
  lastKey: string | null;
  openFolds: Set<string>;
  /** 人物卡打开时高亮这个人的事项、其余淡化 */
  personLit: string | null;
  person: { name: string; left: number; top: number } | null;
  drawer: boolean;
  quickAdd: boolean;
  menu: DeskMenu | null;
  mover: MoverState | null;
  dragging: boolean;
  /** 正在行内改名的 key */
  editing: string | null;

  setView: (v: DeskView) => void;
  set: (patch: Partial<Omit<DeskUi, 'set' | 'setView'>>) => void;
}

const VIEW_KEY = 'yearflow:desk:view';
function readView(): DeskView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'month' ? 'month' : 'week';
  } catch {
    return 'week';
  }
}

export const useDeskUi = create<DeskUi>()((set) => ({
  view: readView(),
  anchor: null,
  sel: new Set(),
  lastKey: null,
  openFolds: new Set(),
  personLit: null,
  person: null,
  drawer: false,
  quickAdd: false,
  menu: null,
  mover: null,
  dragging: false,
  editing: null,
  setView: (view) => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // 记不住只影响下次打开的默认视图
    }
    // 月历切回周历：还在本月就回到本周（而不是本月 1 号那一周）
    set((s) => ({ view, anchor: view === 'week' && s.anchor?.slice(0, 7) === todayStr().slice(0, 7) ? null : s.anchor }));
  },
  set: (patch) => set(patch),
}));

/** 关掉所有浮层（Esc / 点空白） */
export function closeOverlays(): void {
  useDeskUi.getState().set({ menu: null, mover: null, person: null, personLit: null, quickAdd: false });
}
