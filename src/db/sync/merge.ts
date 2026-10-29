import type { Note, SyncableEntity } from '../../types/domain';

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

/**
 * 便签冲突副本（NOTES_SPEC §三）：拉到的远端行要赢了，而本机这条的正文在上次推送之后改过、
 * 且和远端不同（或远端已删）⇒ 本机那版另存成一条新便签（conflictOf 指回原 id、置顶），两边都不丢。
 * 只看 editedAt（正文修改时刻）：本机只改了颜色 / 置顶不算冲突 —— 那种情况远端整行赢就对了。
 * pushedAt = 便签表的推送游标；null = 从没推过 ⇒ 本机的修改都算没推。
 */
export function noteConflictCopies(
  localById: Record<string, Note>,
  winners: Note[],
  pushedAt: string | null,
  now: string,
  makeId: () => string,
): Note[] {
  const copies: Note[] = [];
  for (const remote of winners) {
    const local = localById[remote.id];
    if (!local || local.deletedAt || local.trashedAt) continue;
    if (pushedAt && local.editedAt <= pushedAt) continue;
    if (!local.body.trim()) continue;
    if (!remote.deletedAt && !remote.trashedAt && remote.body === local.body) continue;
    const { convertedTo: _c, archivedAt: _a, deletedAt: _d, ...rest } = local;
    copies.push({
      ...rest,
      id: makeId(),
      conflictOf: remote.id,
      pinnedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  return copies;
}

/**
 * 推送前脱敏：「仅本机」的便签只推一个不含正文的墓碑 ⇒ 云端看不到内容，其他设备上这条消失。
 * 关掉仅本机后整行（updatedAt 更新）再推上去，其他设备按 LWW 恢复。
 */
export function redactForPush<T extends SyncableEntity>(table: string, e: T): SyncableEntity {
  if (table !== 'notes') return e;
  const n = e as unknown as Note;
  if (!n.localOnly) return e;
  const stub: Note = {
    id: n.id,
    body: '',
    editedAt: n.createdAt,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    deletedAt: n.deletedAt ?? n.updatedAt,
  };
  return stub;
}
