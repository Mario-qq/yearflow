/**
 * 工作台界面态（不入库、不进 undo）：视图、选择、浮层。
 * 视图（周/月）记在 localStorage —— 每台机器自己的习惯，不随数据同步。
 */
import { create } from 'zustand';
import { todayStr } from '../lib/date';
import type { WorkScope } from '../types/domain';

export type DeskView = 'week' | 'month';

export type DeskMenu =
  | { kind: 'day'; date: string; x: number; y: number }
  | { kind: 'row'; key: string; day?: string; x: number; y: number }
  | { kind: 'urgency'; x: number; y: number }
  /** 今天「年度计划」的一行（甘特图任务）：status/recordId = 打开菜单那一刻的打卡状态 */
  | { kind: 'plan'; goalId: string; taskId: string; status?: 'done' | 'partial' | 'skipped'; recordId?: string; x: number; y: number }
  /** 今天顶上的一个习惯胶囊 */
  | { kind: 'habit'; id: string; x: number; y: number };

/** 编辑卡：事项 / 例行 / 习惯（id = null 表示新建）；left/top = 锚点（打开它的那一行或按钮） */
export type DeskEditor =
  | { kind: 'item'; id: string; left: number; top: number }
  | { kind: 'routine'; id: string | null; left: number; top: number }
  | { kind: 'habit'; id: string | null; left: number; top: number };

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
  /** 抽屉里看哪一页：待处理 / 例行 / 习惯（管理全部，含暂停的） */
  drawerTab: 'pending' | 'routines' | 'habits';
  editor: DeskEditor | null;
  quickAdd: boolean;
  /** 从日卡「＋」打开新建时预填的日子与范围（一句话里写了的优先） */
  qaPreset: { date: string; scope?: WorkScope } | null;
  /** 下班收尾面板 */
  shutdown: boolean;
  /** 「挑要事」浮层：给哪天挑、锚在哪儿 */
  focusPicker: { date: string; left: number; top: number } | null;
  /** 「年度计划显示哪些」浮层（锚在哪儿） */
  planPicker: { left: number; top: number } | null;
  /** 哪天点过「收工」（记在本机；头部据此不再提醒） */
  shutdownDoneOn: string | null;
  markShutdownDone: (date: string) => void;
  /** 周历收起周六日（收成窄条，仍可拖进去；今天是周末时那天照常展开）；记在本机 */
  hideWeekend: boolean;
  menu: DeskMenu | null;
  mover: MoverState | null;
  dragging: boolean;
  /** 正在行内改名的 key */
  editing: string | null;
  /** 学习卡「换一个」轮到第几个候选 */
  studyPick: number;
  /** 学习设置浮层（锚在哪儿） */
  studySetup: { left: number; top: number } | null;
  /** 今天「年度计划」分区收起（记在本机 localStorage） */
  planFolded: boolean;

  setView: (v: DeskView) => void;
  togglePlanFold: () => void;
  toggleWeekend: () => void;
  set: (patch: Partial<Omit<DeskUi, 'set' | 'setView'>>) => void;
}

const VIEW_KEY = 'yearflow:desk:view';
const PLAN_FOLD_KEY = 'yearflow:desk:planFolded';
const WEEKEND_KEY = 'yearflow:desk:hideWeekend';
const SHUTDOWN_KEY = 'yearflow:desk:shutdownDone';
function readShutdown(): string | null {
  try {
    return localStorage.getItem(SHUTDOWN_KEY);
  } catch {
    return null;
  }
}
/** 默认收起周末（负责人：周六日平时很少用） */
function readHideWeekend(): boolean {
  try {
    return localStorage.getItem(WEEKEND_KEY) !== '0';
  } catch {
    return true;
  }
}
function readPlanFolded(): boolean {
  try {
    return localStorage.getItem(PLAN_FOLD_KEY) === '1';
  } catch {
    return false;
  }
}
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
  drawerTab: 'pending',
  editor: null,
  quickAdd: false,
  qaPreset: null,
  shutdown: false,
  planPicker: null,
  focusPicker: null,
  shutdownDoneOn: readShutdown(),
  markShutdownDone: (date) => {
    try {
      localStorage.setItem(SHUTDOWN_KEY, date);
    } catch {
      // 记不住最多是头部再提醒一次
    }
    set({ shutdownDoneOn: date });
  },
  hideWeekend: readHideWeekend(),
  menu: null,
  mover: null,
  dragging: false,
  editing: null,
  studyPick: 0,
  studySetup: null,
  planFolded: readPlanFolded(),
  togglePlanFold: () =>
    set((s) => {
      try {
        localStorage.setItem(PLAN_FOLD_KEY, s.planFolded ? '0' : '1');
      } catch {
        // 记不住只影响下次打开
      }
      return { planFolded: !s.planFolded };
    }),
  toggleWeekend: () =>
    set((s) => {
      try {
        localStorage.setItem(WEEKEND_KEY, s.hideWeekend ? '0' : '1');
      } catch {
        // 记不住只影响下次打开
      }
      return { hideWeekend: !s.hideWeekend };
    }),
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

/** 有没有浮层开着（点空白先收浮层、Esc 先收浮层用；收尾面板是模态，单独处理） */
export function hasOverlay(ui: Pick<DeskUi, (typeof OVERLAY_KEYS)[number] | 'editor'>): boolean {
  return Boolean(ui.editor || OVERLAY_KEYS.some((k) => ui[k]));
}

/** 点空白可收起的浮层（编辑卡不在内：里面可能有没保存的字，只认 Esc / 取消 / 保存） */
export const OVERLAY_KEYS = ['menu', 'mover', 'person', 'quickAdd', 'studySetup', 'planPicker', 'focusPicker'] as const;

/** 关掉所有浮层（Esc / 点空白） */
export function closeOverlays(): void {
  useDeskUi.getState().set({ menu: null, mover: null, person: null, personLit: null, quickAdd: false, qaPreset: null, studySetup: null, editor: null, planPicker: null, focusPicker: null });
}
