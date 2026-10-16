/**
 * 整库替换（载入示例 / 清空 / 导入 / 回滚）要写进 Dexie 的行。纯函数，单测见 replace.test.ts。
 *
 * 墓碑式：被替换掉的行打 deletedAt 保留而非物理清空 —— 云同步才能把「清空/导入/回滚」造成的删除
 * 传播到其它设备（30 天后由同步引擎真删）。bundle 里的行原样写入，updatedAt 由 repo.bulkPut 重盖成
 * 当前时间（baseRepo.ts）⇒ 回滚版本在整行 LWW 下必然胜出，下次同步各设备都以它为准。
 */
import type { SyncableEntity } from '../types/domain';
import { TABLE_NAMES, type DataBundle, type EntityMaps, type TableName } from './types';

export function planReplaceAll(
  current: EntityMaps,
  bundle: DataBundle,
  deletedAt: string,
): Record<TableName, SyncableEntity[]> {
  const out = {} as Record<TableName, SyncableEntity[]>;
  for (const t of TABLE_NAMES) {
    const incoming = bundle[t] as SyncableEntity[];
    const keep = new Set(incoming.map((e) => e.id));
    const tombstones = (Object.values(current[t]) as SyncableEntity[])
      .filter((e) => !keep.has(e.id))
      .map((e) => ({ ...e, deletedAt }));
    out[t] = [...tombstones, ...incoming];
  }
  return out;
}
