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
} from '../db/repos';
import { queuePersist, queuePersistSettings, repoByTable } from './persist';
import { emitLocalWrite } from '../db/sync/signal';
import { DEFAULT_SETTINGS } from './defaults';
import {
  invertChange,
  TABLE_NAMES,
  type Change,
  type Command,
  type DataBundle,
  type EntityMaps,
  type TableName,
} from './types';

/** 云同步拉取的应用载荷：每表一批 put（存活实体）+ delete（远端已删的 id） */
export type RemoteOps = Partial<
  Record<TableName, { puts: SyncableEntity[]; deletes: string[] }>
>;

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
  /** 云同步拉取结果并入内存：不进 undo 栈、不触发落库（Dexie 由同步引擎自行写入） */
  applyRemote: (ops: RemoteOps) => void;
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
    // 墓碑式清库：被替换掉的行打 deletedAt 保留而非物理清空，
    // 云同步才能把「清空/导入」造成的删除传播到其它设备（30 天后由同步引擎真删）
    const state = get();
    const deletedAt = new Date().toISOString();
    await Promise.all(
      TABLE_NAMES.map((t) => {
        const keep = new Set(bundle[t].map((e) => e.id));
        const tombstones = (Object.values(state[t]) as SyncableEntity[])
          .filter((e) => !keep.has(e.id))
          .map((e) => ({ ...e, deletedAt }));
        return repoByTable[t].bulkPut([...tombstones, ...(bundle[t] as SyncableEntity[])]);
      }),
    );
    emitLocalWrite();
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

  applyRemote: (ops) => {
    set((state) => {
      // 只拷贝受影响的表，未动实体保持引用（per-goal 派生缓存约定）
      const updated: Partial<Record<TableName, Record<string, SyncableEntity>>> = {};
      for (const t of TABLE_NAMES) {
        const op = ops[t];
        if (!op || (op.puts.length === 0 && op.deletes.length === 0)) continue;
        const map = { ...(state[t] as Record<string, SyncableEntity>) };
        for (const e of op.puts) map[e.id] = e;
        for (const id of op.deletes) delete map[id];
        updated[t] = map;
      }
      return updated as Partial<EntityMaps>;
    });
  },
}));

// dev 观测：控制台/验证脚本直接访问 store（生产构建剔除）
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useStore;
}
