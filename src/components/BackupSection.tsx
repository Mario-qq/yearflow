/**
 * 设置页「备份与回滚」（只在桌面版渲染）：列出本机自动备份，选一份先看差异再回滚。
 * 回滚前会自动再备份一次当前状态，所以回滚本身也能回滚。口径见 lib/autoBackup.ts。
 */
import { useCallback, useEffect, useState } from 'react';
import { listBackups, openBackupDir, readBackup, rollbackTo } from '../lib/autoBackup';
import { diffBundles, type TableDiff } from '../lib/backupDiff';
import type { BackupEntry } from '../lib/desktop';
import { useStore } from '../store/useStore';
import type { TableName } from '../store/types';

const btn: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  padding: '3px 10px',
  cursor: 'pointer',
};

const KIND_LABEL = { daily: '每日', pre: '操作前' } as const;

function fmtAt(at: string): string {
  // at = 本地时间 YYYY-MM-DDTHH:mm:ss（取自文件名）
  return `${Number(at.slice(5, 7))}月${Number(at.slice(8, 10))}日 ${at.slice(11, 16)}`;
}

/** refreshKey 变了就重新列一遍（载入示例/清空/导入会新增一份「操作前」备份） */
export function BackupSection({ labels, refreshKey }: { labels: Record<TableName, string>; refreshKey: string }) {
  const exportBundle = useStore((s) => s.exportBundle);
  const [list, setList] = useState<BackupEntry[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [diff, setDiff] = useState<TableDiff[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const refresh = useCallback(() => {
    void listBackups().then(setList).catch(() => setList([]));
  }, []);
  useEffect(refresh, [refresh, refreshKey]);

  const pick = async (name: string) => {
    setPicked(name);
    setDiff(null);
    setMsg(null);
    try {
      const parsed = await readBackup(name);
      setDiff(diffBundles(parsed.data, exportBundle()));
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : '读取备份失败', error: true });
    }
  };

  const rollback = async () => {
    if (!picked || !diff) return;
    const n = diff.reduce((s, d) => s + d.changed, 0);
    const entry = list.find((x) => x.name === picked);
    if (!confirm(`回滚到 ${entry ? fmtAt(entry.at) : picked}？会改动 ${n} 条数据并同步到所有设备。回滚前会先备份当前状态。`))
      return;
    setBusy(true);
    try {
      await rollbackTo(picked);
      setMsg({ text: '已回滚。当前状态已另存为一份「操作前」备份，需要时可以再回滚回来。' });
      setPicked(null);
      setDiff(null);
      refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : '回滚失败', error: true });
    } finally {
      setBusy(false);
    }
  };

  const changedTables = diff?.filter((d) => d.changed > 0) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
        <span className="flex-1">每天首次打开自动备份（留 30 份）；载入示例、清空、导入、回滚之前也会自动备份（留 10 份）。</span>
        <button type="button" style={btn} onClick={openBackupDir}>
          打开备份文件夹
        </button>
      </div>
      {list.length === 0 ? (
        <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>还没有备份。</p>
      ) : (
        <ul className="flex max-h-60 flex-col overflow-y-auto" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
          {list.map((b) => (
            <li key={b.name}>
              <button
                type="button"
                onClick={() => void pick(b.name)}
                className="tnum flex w-full items-center gap-3 px-3 py-1.5 text-left"
                style={{
                  fontSize: 'var(--font-13)',
                  background: picked === b.name ? 'var(--accent-soft)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span className="flex-1">{fmtAt(b.at)}</span>
                <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>{KIND_LABEL[b.kind]}</span>
                <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', minWidth: 56, textAlign: 'right' }}>
                  {Math.max(1, Math.round(b.size / 1024))} KB
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && diff && (
        <div className="flex items-center gap-3" style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}>
          <span className="tnum flex-1">
            {changedTables.length === 0
              ? '这份备份与当前数据完全一致，不需要回滚。'
              : `回滚会改动：${changedTables.map((d) => `${labels[d.table]} ${d.changed}`).join('、')}`}
          </span>
          {changedTables.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void rollback()}
              style={{ ...btn, color: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              回滚到这一刻
            </button>
          )}
        </div>
      )}
      {msg && (
        <p style={{ fontSize: 'var(--font-12)', color: msg.error ? 'var(--danger)' : 'var(--success)' }}>{msg.text}</p>
      )}
    </div>
  );
}
