import { create } from 'zustand';
import type { AppSettings, GanttViewState, SyncableEntity } from '../types/domain';
import {
  checkInRepo,
  exemptionRepo,
  goalRepo,
  milestoneRepo,
  reviewRepo,
  settingsRepo,
  taskRepo,
  clearAllData,
} from '../db/repos';
import { queuePersist, queuePersistSettings } from './persist';
import { DEFAULT_SETTINGS } from './defaults';
import {
  invertChange,
  TABLE_NAMES,
  type Change,
  type Command,
  type DataBundle,
  type EntityMaps,
} from './types';

const HISTORY_LIMIT = 100; // SPEC 要求 ≥50 步

function emptyMaps(): EntityMaps {
  return { goals: {}, tasks: {}, milestones: {}, checkIns: {}, exemptions: {}, reviews: {} };
}

function toMap<T extends SyncableEntity>(list: T[]): Record<string, T> {
  const map: Record<string, T> = {};
  for (const e of list) map[e.id] = e;
  return map;
}

/** 把一批变更应用到实体 Map，只拷贝受影响的表 */
function applyChanges(state: EntityMaps, changes: Change[]): Partial<EntityMaps> {
  const updated: Partial<Record<string, Record<string, SyncableEntity>>> = {};
  for (const c of changes) {
    const map = (updated[c.table] ??= { ...(state[c.table] as Record<string, SyncableEntity>) });
    if (c.type === 'put') map[c.after.id] = c.after;
    else delete map[c.before.id];
  }
  return updated as Partial<EntityMaps>;
}

export interface StoreState extends EntityMaps {
  settings: AppSettings;
  hydrated: boolean;
  undoStack: Command[];
  redoStack: Command[];

  /** 启动时从 Dexie 全量载入 */
  hydrate: () => Promise<void>;
  /** 一切实体 mutation 的唯一入口：应用变更 + 进 undo 栈 + 防抖落库 */
  execute: (label: string, changes: Change[]) => void;
  /** 返回被撤销命令的 label（toast 用），无可撤销返回 null */
  undo: () => string | null;
  redo: () => string | null;
  /** settings 不进 undo 栈，防抖落库 */
  updateSettings: (patch: Partial<AppSettings>) => void;
  updateGanttView: (patch: Partial<GanttViewState>) => void;
  /** 清库重建（种子载入 / JSON 导入），重置历史栈，直接写盘 */
  replaceAllData: (bundle: DataBundle) => Promise<void>;
  /** 内存全量数据打包（JSON 导出用） */
  exportBundle: () => DataBundle;
}

export const useStore = create<StoreState>()((set, get) => ({
  ...emptyMaps(),
  settings: DEFAULT_SETTINGS,
  hydrated: false,
  undoStack: [],
  redoStack: [],

  hydrate: async () => {
    const [goals, tasks, milestones, checkIns, exemptions, reviews, settings] = await Promise.all([
      goalRepo.getAllActive(),
      taskRepo.getAllActive(),
      milestoneRepo.getAllActive(),
      checkInRepo.getAllActive(),
      exemptionRepo.getAllActive(),
      reviewRepo.getAllActive(),
      settingsRepo.get(),
    ]);
    set({
      goals: toMap(goals),
      tasks: toMap(tasks),
      milestones: toMap(milestones),
      checkIns: toMap(checkIns),
      exemptions: toMap(exemptions),
      reviews: toMap(reviews),
      settings,
      hydrated: true,
    });
  },

  execute: (label, changes) => {
    if (changes.length === 0) return;
    set((state) => ({
      ...applyChanges(state, changes),
      undoStack: [...state.undoStack, { label, changes }].slice(-HISTORY_LIMIT),
      redoStack: [],
    }));
    queuePersist(changes);
  },

  undo: () => {
    const { undoStack } = get();
    const cmd = undoStack[undoStack.length - 1];
    if (!cmd) return null;
    const inverted = cmd.changes.map(invertChange).reverse();
    set((state) => ({
      ...applyChanges(state, inverted),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, cmd],
    }));
    queuePersist(inverted);
    return cmd.label;
  },

  redo: () => {
    const { redoStack } = get();
    const cmd = redoStack[redoStack.length - 1];
    if (!cmd) return null;
    set((state) => ({
      ...applyChanges(state, cmd.changes),
      undoStack: [...state.undoStack, cmd].slice(-HISTORY_LIMIT),
      redoStack: state.redoStack.slice(0, -1),
    }));
    queuePersist(cmd.changes);
    return cmd.label;
  },

  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    queuePersistSettings(next);
  },

  updateGanttView: (patch) => {
    const { settings, updateSettings } = get();
    updateSettings({ ganttView: { ...settings.ganttView, ...patch } });
  },

  replaceAllData: async (bundle) => {
    await clearAllData();
    await Promise.all([
      goalRepo.bulkPut(bundle.goals),
      taskRepo.bulkPut(bundle.tasks),
      milestoneRepo.bulkPut(bundle.milestones),
      checkInRepo.bulkPut(bundle.checkIns),
      exemptionRepo.bulkPut(bundle.exemptions),
      reviewRepo.bulkPut(bundle.reviews),
    ]);
    set({
      goals: toMap(bundle.goals),
      tasks: toMap(bundle.tasks),
      milestones: toMap(bundle.milestones),
      checkIns: toMap(bundle.checkIns),
      exemptions: toMap(bundle.exemptions),
      reviews: toMap(bundle.reviews),
      undoStack: [],
      redoStack: [],
    });
  },

  exportBundle: () => {
    const state = get();
    const bundle = {} as Record<string, SyncableEntity[]>;
    for (const table of TABLE_NAMES) {
      bundle[table] = Object.values(state[table]);
    }
    return bundle as unknown as DataBundle;
  },
}));

// dev 观测：控制台/验证脚本直接访问 store（生产构建剔除）
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useStore;
}
