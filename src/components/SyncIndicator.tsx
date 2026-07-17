import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { isSyncConfigured, syncNow } from '../db/sync/syncApi';
import { useSyncStore, type SyncStatus } from '../db/sync/useSyncStore';

/** 顶栏同步状态点（SPEC 第十节：✓/⟳/离线/⚠），点击弹出详情与手动同步 */

const GLYPH: Record<SyncStatus, { char: string; color: string; label: string }> = {
  idle: { char: '✓', color: 'var(--success)', label: '已同步' },
  syncing: { char: '⟳', color: 'var(--accent)', label: '同步中…' },
  offline: { char: '○', color: 'var(--text-tertiary)', label: '离线（联网后自动补同步）' },
  error: { char: '⚠', color: 'var(--danger)', label: '同步出错' },
  signedOut: { char: '○', color: 'var(--text-tertiary)', label: '未登录（纯本地模式）' },
};

export function SyncIndicator() {
  const { user, status, lastSyncAt, error } = useSyncStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: PointerEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  if (!isSyncConfigured) return null;

  const g = GLYPH[status];
  const row: React.CSSProperties = {
    fontSize: 'var(--font-12)',
    color: 'var(--text-secondary)',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 cursor-pointer items-center justify-center"
        style={{
          fontSize: 'var(--font-13)',
          color: g.color,
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-panel)',
        }}
        title={`云同步：${g.label}`}
        aria-label={`云同步：${g.label}`}
      >
        {g.char}
      </button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-1 flex w-60 flex-col gap-2 border p-3"
          style={{
            top: '100%',
            borderColor: 'var(--border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-panel)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div style={row}>
            <span style={{ color: 'var(--text-tertiary)' }}>状态</span>
            <span style={{ color: g.color }}>{g.label}</span>
          </div>
          {user && (
            <div style={row}>
              <span style={{ color: 'var(--text-tertiary)' }}>帐号</span>
              <span className="truncate">{user.email}</span>
            </div>
          )}
          {lastSyncAt && (
            <div style={row}>
              <span style={{ color: 'var(--text-tertiary)' }}>上次同步</span>
              <span className="tnum">{dayjs(lastSyncAt).format('HH:mm:ss')}</span>
            </div>
          )}
          {error && (
            <p style={{ fontSize: 'var(--font-12)', color: 'var(--danger)', wordBreak: 'break-all' }}>
              {error}
            </p>
          )}
          {user ? (
            <button
              type="button"
              disabled={status === 'syncing'}
              onClick={() => void syncNow()}
              className="cursor-pointer px-2 py-1 disabled:cursor-default disabled:opacity-50"
              style={{
                fontSize: 'var(--font-12)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-panel)',
              }}
            >
              立即同步
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/settings');
              }}
              className="cursor-pointer px-2 py-1"
              style={{
                fontSize: 'var(--font-12)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-panel)',
              }}
            >
              前往设置登录
            </button>
          )}
        </div>
      )}
    </div>
  );
}
