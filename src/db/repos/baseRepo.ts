import type { Table } from 'dexie';
import type { SyncableEntity } from '../../types/domain';

const nowISO = () => new Date().toISOString();

/**
 * 通用 repo：UI/store 与 Dexie 之间的唯一通道。
 * 所有写入自动刷新 updatedAt；删除一律软删除（deletedAt），为 Phase 5 同步预留。
 */
export class BaseRepo<T extends SyncableEntity> {
  protected table: Table<T, string>;

  constructor(table: Table<T, string>) {
    this.table = table;
  }

  /** 读取全部未软删除记录（启动 hydrate 用） */
  async getAllActive(): Promise<T[]> {
    const all = await this.table.toArray();
    return all.filter((e) => !e.deletedAt);
  }

  async get(id: string): Promise<T | undefined> {
    const e = await this.table.get(id);
    return e && !e.deletedAt ? e : undefined;
  }

  /** 新增或整行覆盖，写入即刷新 updatedAt */
  async put(entity: T): Promise<void> {
    await this.table.put({ ...entity, updatedAt: nowISO() });
  }

  async bulkPut(entities: T[]): Promise<void> {
    const stamped = entities.map((e) => ({ ...e, updatedAt: nowISO() }));
    await this.table.bulkPut(stamped);
  }

  /** 软删除：打 deletedAt 标记，同步后 30 天真删（Phase 5 处理） */
  async softDelete(id: string): Promise<void> {
    const e = await this.table.get(id);
    if (!e) return;
    await this.table.put({ ...e, deletedAt: nowISO(), updatedAt: nowISO() });
  }

  async bulkSoftDelete(ids: string[]): Promise<void> {
    const ts = nowISO();
    await this.table
      .where('id')
      .anyOf(ids)
      .modify((e) => {
        e.deletedAt = ts;
        e.updatedAt = ts;
      });
  }

  /** 撤销软删除（undo 删除操作用） */
  async restore(id: string): Promise<void> {
    const e = await this.table.get(id);
    if (!e) return;
    const { deletedAt: _omit, ...rest } = e;
    await this.table.put({ ...rest, updatedAt: nowISO() } as T);
  }

  /** 清空整表（JSON 导入前重建 / 清空示例数据用），物理删除 */
  async clear(): Promise<void> {
    await this.table.clear();
  }
}
