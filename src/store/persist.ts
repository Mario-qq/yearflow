import type { AppSettings } from '../types/domain';
import {
  checkInRepo,
  exemptionRepo,
  focusRepo,
  goalRepo,
  milestoneRepo,
  reviewRepo,
  settingsRepo,
  taskRepo,
} from '../db/repos';
import type { BaseRepo } from '../db/repos/baseRepo';
import type { Change, TableName } from './types';
import type { SyncableEntity } from '../types/domain';
import { emitLocalWrite } from '../db/sync/signal';

export const repoByTable: Record<TableName, BaseRepo<SyncableEntity>> = {
  goals: goalRepo as BaseRepo<SyncableEntity>,
  tasks: taskRepo as BaseRepo<SyncableEntity>,
  milestones: milestoneRepo as BaseRepo<SyncableEntity>,
  checkIns: checkInRepo as BaseRepo<SyncableEntity>,
  exemptions: exemptionRepo as BaseRepo<SyncableEntity>,
  reviews: reviewRepo as BaseRepo<SyncableEntity>,
  focusSessions: focusRepo as BaseRepo<SyncableEntity>,
};

const PERSIST_DEBOUNCE_MS = 500; // SPEC：所有变更自动保存（防抖 500ms）

type PendingOp =
  | { table: TableName; op: 'put'; entity: SyncableEntity }
  | { table: TableName; op: 'delete'; id: string };

/** 同一实体只保留最后一次操作，key = table:id */
let pending = new Map<string, PendingOp>();
let timer: ReturnType<typeof setTimeout> | undefined;

async function flush(): Promise<void> {
  const batch = pending;
  pending = new Map();
  const puts = new Map<TableName, SyncableEntity[]>();
  const deletes: { table: TableName; id: string }[] = [];
  for (const op of batch.values()) {
    if (op.op === 'put') {
      const list = puts.get(op.table) ?? [];
      list.push(op.entity);
      puts.set(op.table, list);
    } else {
      deletes.push(op);
    }
  }
  await Promise.all([
    ...[...puts.entries()].map(([table, entities]) => repoByTable[table].bulkPut(entities)),
    ...deletes.map(({ table, id }) => repoByTable[table].softDelete(id)),
  ]);
  if (batch.size > 0) emitLocalWrite(); // 云同步引擎订阅：落库完成后防抖 3 秒触发推送
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, PERSIST_DEBOUNCE_MS);
}

/** 把一批已应用到内存的变更排队落库（Change 自带完整实体，无需回读 store） */
export function queuePersist(changes: Change[]): void {
  for (const c of changes) {
    if (c.type === 'put') {
      pending.set(`${c.table}:${c.after.id}`, { table: c.table, op: 'put', entity: c.after });
    } else {
      pending.set(`${c.table}:${c.before.id}`, { table: c.table, op: 'delete', id: c.before.id });
    }
  }
  schedule();
}

/** 立即写盘（导入/清库等大操作后调用，避免等防抖） */
export async function flushNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  await flush();
}

let settingsTimer: ReturnType<typeof setTimeout> | undefined;

export function queuePersistSettings(settings: AppSettings): void {
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    settingsTimer = undefined;
    void settingsRepo.put(settings);
  }, PERSIST_DEBOUNCE_MS);
}
