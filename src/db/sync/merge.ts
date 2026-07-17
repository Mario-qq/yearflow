import type { SyncableEntity } from '../../types/domain';

/**
 * 云同步冲突归并 — 纯函数（vitest 单测覆盖）。
 * 策略：整行 last-write-wins，按实体内 updatedAt（ISO UTC 字符串，字典序即时间序）。
 */

/** 远端 updatedAt 严格大于本地才赢；本地缺失视为远端赢；相等（自己推送的回声）跳过 */
export function remoteWins(
  local: SyncableEntity | undefined,
  remote: SyncableEntity,
): boolean {
  if (!local) return true;
  return remote.updatedAt > local.updatedAt;
}

export interface PullApplyPlan<T extends SyncableEntity> {
  /** 原样写入 Dexie 的行（含墓碑，保留远端 updatedAt/deletedAt，不得经 repo 重新盖时间戳） */
  dbPuts: T[];
  /** 并入内存 map 的存活实体 */
  mapPuts: T[];
  /** 从内存 map 移除的 id（远端已删除） */
  mapDeletes: string[];
}

/**
 * 把一批拉取结果按 LWW 归并为应用计划。
 * localById 必须来自 Dexie 原始行（含本地墓碑）——只对照内存会把
 * 「本地已删、远端还是旧版」的行错误复活。
 */
export function planPullApply<T extends SyncableEntity>(
  localById: Record<string, T>,
  pulled: T[],
): PullApplyPlan<T> {
  // 同 id 多条（分页期间行又被改写）取 updatedAt 最大的一条
  const latest = new Map<string, T>();
  for (const e of pulled) {
    const prev = latest.get(e.id);
    if (!prev || e.updatedAt > prev.updatedAt) latest.set(e.id, e);
  }
  const dbPuts: T[] = [];
  const mapPuts: T[] = [];
  const mapDeletes: string[] = [];
  for (const remote of latest.values()) {
    if (!remoteWins(localById[remote.id], remote)) continue;
    dbPuts.push(remote);
    if (remote.deletedAt) mapDeletes.push(remote.id);
    else mapPuts.push(remote);
  }
  return { dbPuts, mapPuts, mapDeletes };
}
