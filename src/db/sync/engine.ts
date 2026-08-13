import type { Table } from 'dexie';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './client';
import { db } from '../schema';
import { planPullApply } from './merge';
import { onLocalWrite } from './signal';
import { useSyncStore } from './useSyncStore';
import { useStore } from '../../store/useStore';
import { flushNow } from '../../store/persist';
import { TABLE_NAMES, type TableName } from '../../store/types';
import type { SyncableEntity } from '../../types/domain';

/**
 * 云同步引擎（SPEC 第十节）— 本地优先。
 * UI 永远只读写 IndexedDB；本引擎后台做本地 ↔ Supabase 双向增量同步：
 *   拉取游标 = 服务端 server_updated_at（触发器盖章，不信任客户端时钟）
 *   推送游标 = 本地 updatedAt（本地写入全用本机时钟，自洽）
 *   冲突 = 整行 LWW：拉取侧在 merge.ts 客户端裁决；推送侧由 upsert_rows RPC
 *   的 on conflict ... where excluded.updated_at > 现值 兜底（旧行推不倒新行）。
 * 顺序固定「先拉后推」：本地旧改动先被远端新版覆盖，再推送时自然只剩赢家。
 */

/** 本地表名 → Supabase 表名（snake_case） */
const REMOTE_TABLE: Record<TableName, string> = {
  goals: 'goals',
  tasks: 'tasks',
  milestones: 'milestones',
  checkIns: 'check_ins',
  exemptions: 'exemptions',
  reviews: 'reviews',
  focusSessions: 'focus_sessions', // 需先在 Supabase 执行 0002_focus_sessions.sql
};

/** 同步引擎直接读写 Dexie 原始表（属数据层；不得经 repo，repo 会重盖 updatedAt） */
const rawTable = (t: TableName): Table<SyncableEntity, string> =>
  db[t] as unknown as Table<SyncableEntity, string>;

const PULL_PAGE_SIZE = 1000; // Supabase 单请求默认行数上限
const PUSH_CHUNK_SIZE = 500;
const WRITE_DEBOUNCE_MS = 3000; // SPEC：本地写入后防抖 3 秒
const PERIODIC_MS = 5 * 60 * 1000; // SPEC：每 5 分钟
const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000; // SPEC：同步后 30 天真删
const EPOCH = '1970-01-01T00:00:00Z';

export const isSyncConfigured = supabase !== null;

/** 增量游标，按用户隔离存 localStorage；丢失只导致一次全量重同步（幂等） */
interface Cursors {
  push: string | null;
  pull: Partial<Record<TableName, string>>;
}

const cursorKey = (userId: string) => `yearflow:sync:${userId}`;

function loadCursors(userId: string): Cursors {
  try {
    const raw = localStorage.getItem(cursorKey(userId));
    if (raw) return JSON.parse(raw) as Cursors;
  } catch {
    // 损坏视为无游标，全量重同步
  }
  return { push: null, pull: {} };
}

function saveCursors(userId: string, c: Cursors): void {
  localStorage.setItem(cursorKey(userId), JSON.stringify(c));
}

interface RemotePullRow {
  data: SyncableEntity;
  server_updated_at: string;
}

let syncing = false;
let rerunAfter = false;
let cleanedThisSession = false;

/** 手动/自动同步入口：单飞防重入，同步中再触发则结束后补跑一轮 */
export async function syncNow(): Promise<void> {
  if (!supabase) return;
  const { user } = useSyncStore.getState();
  if (!user) return;
  if (!navigator.onLine) {
    useSyncStore.setState({ status: 'offline' });
    return;
  }
  if (syncing) {
    rerunAfter = true;
    return;
  }
  syncing = true;
  useSyncStore.setState({ status: 'syncing', error: null });
  try {
    await flushNow(); // 先把防抖中的本地写入落库，再基于 Dexie 做推拉
    const cursors = loadCursors(user.id);
    await pullAll(supabase, user.id, cursors);
    await pushAll(supabase, user.id, cursors);
    if (!cleanedThisSession) {
      cleanedThisSession = true;
      await cleanupTombstones(supabase, cursors);
    }
    useSyncStore.setState({ status: 'idle', lastSyncAt: new Date().toISOString() });
  } catch (e) {
    useSyncStore.setState({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    syncing = false;
    if (rerunAfter) {
      rerunAfter = false;
      void syncNow();
    }
  }
}

/** 增量拉取：server_updated_at 升序分页，LWW 对照 Dexie 原始行后应用到库与内存 */
async function pullAll(sb: SupabaseClient, userId: string, cursors: Cursors): Promise<void> {
  const ops: Partial<Record<TableName, { puts: SyncableEntity[]; deletes: string[] }>> = {};
  for (const t of TABLE_NAMES) {
    let cursor = cursors.pull[t] ?? EPOCH;
    const pulled: SyncableEntity[] = [];
    for (;;) {
      const { data, error } = await sb
        .from(REMOTE_TABLE[t])
        .select('data,server_updated_at')
        .gt('server_updated_at', cursor)
        .order('server_updated_at', { ascending: true })
        .limit(PULL_PAGE_SIZE);
      if (error) throw new Error(`拉取 ${REMOTE_TABLE[t]} 失败：${error.message}`);
      const rows = (data ?? []) as RemotePullRow[];
      if (rows.length === 0) break;
      pulled.push(...rows.map((r) => r.data));
      cursor = rows[rows.length - 1].server_updated_at;
      if (rows.length < PULL_PAGE_SIZE) break;
    }
    if (pulled.length > 0) {
      const ids = [...new Set(pulled.map((e) => e.id))];
      const localRows = await rawTable(t).bulkGet(ids);
      const localById: Record<string, SyncableEntity> = {};
      for (const row of localRows) if (row) localById[row.id] = row;
      const plan = planPullApply(localById, pulled);
      if (plan.dbPuts.length > 0) await rawTable(t).bulkPut(plan.dbPuts);
      if (plan.mapPuts.length > 0 || plan.mapDeletes.length > 0) {
        ops[t] = { puts: plan.mapPuts, deletes: plan.mapDeletes };
      }
    }
    cursors.pull[t] = cursor;
    saveCursors(userId, cursors);
  }
  if (Object.keys(ops).length > 0) useStore.getState().applyRemote(ops);
}

/** 增量推送：updatedAt > 游标的行（含墓碑）分块经 upsert_rows RPC 上行；无游标 = 首次登录全量上传合并 */
async function pushAll(sb: SupabaseClient, userId: string, cursors: Cursors): Promise<void> {
  const t0 = new Date().toISOString(); // 推送期间的新写入 updatedAt ≥ t0，留给下一轮
  for (const t of TABLE_NAMES) {
    const table = rawTable(t);
    const dirty = cursors.push
      ? await table.where('updatedAt').above(cursors.push).toArray()
      : await table.toArray();
    for (let i = 0; i < dirty.length; i += PUSH_CHUNK_SIZE) {
      const chunk = dirty.slice(i, i + PUSH_CHUNK_SIZE).map((e) => ({
        id: e.id,
        data: e,
        updated_at: e.updatedAt,
        deleted_at: e.deletedAt ?? null,
      }));
      const { error } = await sb.rpc('upsert_rows', {
        p_table: REMOTE_TABLE[t],
        p_rows: chunk,
      });
      if (error) throw new Error(`推送 ${REMOTE_TABLE[t]} 失败：${error.message}`);
    }
  }
  cursors.push = t0;
  saveCursors(userId, cursors);
}

/** 墓碑清理（每会话跑一次）：本地已推送且删除超 30 天的物理删除；云端同规则（RLS 限定本人行） */
async function cleanupTombstones(sb: SupabaseClient, cursors: Cursors): Promise<void> {
  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString();
  for (const t of TABLE_NAMES) {
    const stale = (await rawTable(t).toArray()).filter(
      (e) => e.deletedAt && e.deletedAt < cutoff && cursors.push && e.updatedAt <= cursors.push,
    );
    if (stale.length > 0) await rawTable(t).bulkDelete(stale.map((e) => e.id));
    const { error } = await sb.from(REMOTE_TABLE[t]).delete().lt('deleted_at', cutoff);
    if (error) throw new Error(`清理 ${REMOTE_TABLE[t]} 失败：${error.message}`);
  }
}

let started = false;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 启动同步引擎（App hydrate 后调用一次）。
 * 触发时机（SPEC 第十节）：登录/启动恢复会话、窗口重获焦点、联网恢复、
 * 本地写入防抖 3 秒、每 5 分钟；手动同步走 syncNow()。
 */
export function initSync(): void {
  if (!supabase || started) return;
  started = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    const u = session?.user;
    const prev = useSyncStore.getState().user;
    useSyncStore.setState(
      u
        ? { user: { id: u.id, email: u.email ?? '' }, status: 'idle', error: null }
        : { user: null, status: 'signedOut', error: null },
    );
    // supabase-js 告诫：勿在回调内同步调用其它 supabase API；且 token 刷新事件（同一用户）不必重同步
    if (u && u.id !== prev?.id) setTimeout(() => void syncNow(), 0);
  });

  window.addEventListener('focus', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', () => {
    if (useSyncStore.getState().user) useSyncStore.setState({ status: 'offline' });
  });
  onLocalWrite(() => {
    if (!useSyncStore.getState().user) return;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = undefined;
      void syncNow();
    }, WRITE_DEBOUNCE_MS);
  });
  setInterval(() => void syncNow(), PERIODIC_MS);
}

/** 登录；返回错误消息，成功返回 null（后续由 onAuthStateChange 接管触发同步） */
export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return '未配置 Supabase 凭据';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

/** 注册；Supabase 默认开启邮箱确认时 needsEmailConfirm=true（需查收邮件后再登录） */
export async function signUp(
  email: string,
  password: string,
): Promise<{ error: string | null; needsEmailConfirm: boolean }> {
  if (!supabase) return { error: '未配置 Supabase 凭据', needsEmailConfirm: false };
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message, needsEmailConfirm: false };
  return { error: null, needsEmailConfirm: !data.session };
}

/** 退出登录：本地数据原样保留，游标保留（同一账号再登录走增量） */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}
