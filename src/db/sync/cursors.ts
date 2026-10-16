/**
 * 同步游标与逐表失败的纯逻辑（从 engine.ts 拆出，便于单测）。
 *
 * 为什么推送游标要按表分：以前只有一个全局 push 游标，一轮推完所有表才前移。
 * 要做「某张表失败只跳过它」就必须分表——否则失败那张表的脏行会被前移的全局游标跨过去，永远推不上去。
 * 老游标兼容：pushBy 缺这张表时回落到旧的全局 push（它对所有表都成立：那一刻之前的写入全部推过了）。
 */
import type { TableName } from '../../store/types';

export interface Cursors {
  /** 旧版全局推送游标（只读兼容）；null = 从未推送过 ⇒ 首次全量 */
  push: string | null;
  /** 分表推送游标：只在该表本轮推送成功后前移 */
  pushBy?: Partial<Record<TableName, string>>;
  pull: Partial<Record<TableName, string>>;
}

export function pushCursorOf(c: Cursors, t: TableName): string | null {
  return c.pushBy?.[t] ?? c.push;
}

export function advancePush(c: Cursors, t: TableName, at: string): void {
  c.pushBy = { ...c.pushBy, [t]: at };
}

/** 一张表这一轮失败的原因 */
export interface TableFailure {
  table: string; // 云端表名
  message: string;
  code?: string;
}

/**
 * 「云端没有这张表」：PostgREST 找不到表（PGRST205 / Postgres 42P01），
 * 或 upsert_rows 的白名单还没加上它（迁移没执行时 RPC 抛的「非法表名」）。
 */
export function isMissingTable(f: TableFailure): boolean {
  return (
    f.code === 'PGRST205' ||
    f.code === '42P01' ||
    /could not find the table|does not exist|非法表名/i.test(f.message)
  );
}

/** 给状态点看的一句话：缺表时直接告诉要执行哪个迁移，其余表照常同步 */
export function describeFailures(failures: TableFailure[]): string {
  // 断网/鉴权失效时每张表报同一句话，没必要逐表列一遍
  const msgs = new Set(failures.map((f) => f.message));
  if (msgs.size === 1 && !failures.some(isMissingTable)) return `同步失败：${failures[0].message}`;
  const missing = [...new Set(failures.filter(isMissingTable).map((f) => f.table))];
  const other = failures.filter((f) => !isMissingTable(f));
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`云端缺少表 ${missing.join('、')}，请在 Supabase 执行最新迁移（supabase/migrations）`);
  }
  if (other.length > 0) parts.push(other.map((f) => `${f.table}：${f.message}`).join('；'));
  return `${parts.join('；')}（其余数据已正常同步）`;
}
