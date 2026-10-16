/**
 * 本机自动备份 + 整库回滚（DESK_SPEC §七）。只在桌面版生效：网页版没有文件系统权限，
 * 而桌面版是主力机，备份放这一处足够。
 *
 * - 每天首次启动（及跨过午夜的常驻窗口，每小时检查一次）写一份 daily，保留 30 份；
 * - 载入示例 / 清空 / 导入 / 回滚之前写一份 pre，保留 10 份 —— 回滚本身也可再回滚；
 * - 回滚走 replaceAllData：repo 写入重盖 updatedAt、被替换的行打墓碑 ⇒ 下次同步以回滚版本为准，
 *   所有设备跟着回滚（store/replace.test.ts 锁住这个行为）。
 * 备份内容就是 JSON 导出格式（lib/backup.ts），新增的表自动包含，不需要在这里区分表。
 */
import { desktop, type BackupEntry } from './desktop';
import { buildBackupJSON, parseBackupJSON, type ParsedBackup } from './backup';
import { todayStr } from './date';
import { useStore } from '../store/useStore';
import { flushNow } from '../store/persist';
import type { DataBundle } from '../store/types';

const LAST_DAILY_KEY = 'yearflow:backup:lastDaily';
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function snapshot(kind: 'daily' | 'pre'): Promise<string | null> {
  const api = desktop();
  if (!api) return null;
  await flushNow(); // 防抖中的写入先落库，备份才和内存一致
  const { exportBundle, settings } = useStore.getState();
  return api.backupWrite(buildBackupJSON(exportBundle(), settings), kind);
}

function readLastDaily(): string | null {
  try {
    return localStorage.getItem(LAST_DAILY_KEY);
  } catch {
    return null;
  }
}

/** 今天还没备份过就备份一份；失败只打日志（下一次检查会再试），不打扰用户 */
export async function dailyBackupIfDue(): Promise<void> {
  if (!desktop()) return;
  const today = todayStr();
  if (readLastDaily() === today) return;
  try {
    await snapshot('daily');
    try {
      localStorage.setItem(LAST_DAILY_KEY, today);
    } catch {
      // 记不住只会导致今天多备份几份，无害
    }
  } catch (e) {
    console.warn('[autoBackup] 每日备份失败', e);
  }
}

let started = false;

/** App hydrate 之后调用一次（幂等） */
export function initAutoBackup(): void {
  if (started || !desktop()) return;
  started = true;
  void dailyBackupIfDue();
  setInterval(() => void dailyBackupIfDue(), CHECK_INTERVAL_MS);
}

/**
 * 整库替换的唯一入口（载入示例 / 清空 / 导入 / 回滚）：先写一份 pre 备份，写不进去就**不替换**
 * —— 宁可让这次操作失败，也不做一次没有退路的整库替换。网页版无备份能力，直接替换。
 */
export async function replaceAllWithBackup(bundle: DataBundle): Promise<void> {
  if (desktop()) await snapshot('pre');
  await useStore.getState().replaceAllData(bundle);
}

export async function listBackups(): Promise<BackupEntry[]> {
  return desktop()?.backupList() ?? [];
}

export async function readBackup(name: string): Promise<ParsedBackup> {
  const api = desktop();
  if (!api) throw new Error('只有桌面版能读取本机备份');
  return parseBackupJSON(await api.backupRead(name));
}

/** 回滚到某份备份：只换数据，不动设置（主题、甘特视图等本机偏好不跟着回滚） */
export async function rollbackTo(name: string): Promise<void> {
  const parsed = await readBackup(name);
  await replaceAllWithBackup(parsed.data);
}

export function openBackupDir(): void {
  void desktop()?.backupOpenDir();
}
