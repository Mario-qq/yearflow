import { useState } from 'react';
import dayjs from 'dayjs';
import { isSyncConfigured, signIn, signOut, signUp, syncNow } from '../db/sync/syncApi';
import { useSyncStore } from '../db/sync/useSyncStore';

/** 设置页「云同步」区块：邮箱登录/注册、账号状态、手动同步、退出（SPEC 第十节） */

const STATUS_LABEL = {
  idle: '已同步',
  syncing: '同步中…',
  offline: '离线（联网后自动补同步）',
  error: '同步出错',
  signedOut: '未登录',
} as const;

const inputStyle: React.CSSProperties = {
  fontSize: 'var(--font-13)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-base)',
  padding: '5px 8px',
  width: '100%',
  maxWidth: 280,
};

const buttonStyle: React.CSSProperties = {
  fontSize: 'var(--font-13)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  padding: '4px 12px',
  cursor: 'pointer',
};

const hintStyle: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  color: 'var(--text-tertiary)',
};

export function SyncSection() {
  const { user, status, lastSyncAt, error } = useSyncStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  if (!isSyncConfigured) {
    return (
      <p style={{ fontSize: 'var(--font-13)', color: 'var(--text-tertiary)' }}>
        未配置 Supabase 凭据，当前为纯本地模式。复制 .env.example 为 .env.local
        并填入项目 URL 与 anon key 后重启即可启用云同步（详见 README）。
      </p>
    );
  }

  const say = (text: string, isErr = false) => setMessage({ text, error: isErr });

  const doSignIn = async () => {
    if (!email || !password) return say('请填写邮箱和密码', true);
    setBusy(true);
    const err = await signIn(email.trim(), password);
    setBusy(false);
    if (err) say(`登录失败：${err}`, true);
    else {
      setMessage(null);
      setPassword('');
    }
  };

  const doSignUp = async () => {
    if (!email || !password) return say('请填写邮箱和密码', true);
    if (password.length < 6) return say('密码至少 6 位', true);
    setBusy(true);
    const res = await signUp(email.trim(), password);
    setBusy(false);
    if (res.error) say(`注册失败：${res.error}`, true);
    else if (res.needsEmailConfirm) say('注册成功，确认邮件已发送，请查收后回来登录');
    else setMessage(null);
  };

  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <p style={hintStyle}>
          登录后本地数据自动上传合并，多设备双向同步；不登录可继续纯本地使用。
        </p>
        <input
          type="email"
          placeholder="邮箱"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="密码（至少 6 位）"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doSignIn();
          }}
          style={inputStyle}
        />
        <div className="flex gap-2">
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => void doSignIn()}>
            登录
          </button>
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => void doSignUp()}>
            注册
          </button>
        </div>
        {message && (
          <p
            style={{
              fontSize: 'var(--font-12)',
              color: message.error ? 'var(--danger)' : 'var(--success)',
            }}
          >
            {message.text}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 'var(--font-13)' }}>
        <span>
          <span style={hintStyle}>帐号 </span>
          {user.email}
        </span>
        <span>
          <span style={hintStyle}>状态 </span>
          <span style={{ color: status === 'error' ? 'var(--danger)' : undefined }}>
            {STATUS_LABEL[status]}
          </span>
        </span>
        {lastSyncAt && (
          <span>
            <span style={hintStyle}>上次同步 </span>
            <span className="tnum">{dayjs(lastSyncAt).format('HH:mm:ss')}</span>
          </span>
        )}
      </div>
      {error && (
        <p style={{ fontSize: 'var(--font-12)', color: 'var(--danger)', wordBreak: 'break-all' }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          style={buttonStyle}
          disabled={status === 'syncing'}
          onClick={() => void syncNow()}
        >
          立即同步
        </button>
        <button type="button" style={buttonStyle} onClick={() => void signOut()}>
          退出登录
        </button>
      </div>
      <p style={hintStyle}>退出登录不会清除本设备数据；再次登录同一账号将继续增量同步。</p>
    </div>
  );
}
