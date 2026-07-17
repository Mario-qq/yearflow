import { create } from 'zustand';

/** 顶栏状态点四态 + 未登录（SPEC 第十节：✓/⟳/离线/⚠） */
export type SyncStatus = 'signedOut' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  user: { id: string; email: string } | null;
  status: SyncStatus;
  lastSyncAt: string | null; // ISO，本会话内最近一次成功同步
  error: string | null;
}

/** 同步状态 store（瞬态，不持久化）；仅同步引擎写入，UI 只读 */
export const useSyncStore = create<SyncState>()(() => ({
  user: null,
  status: 'signedOut',
  lastSyncAt: null,
  error: null,
}));

// dev 观测：控制台/验证脚本读同步状态（生产构建剔除，与 __store 同约定）
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__syncStore = useSyncStore;
}
