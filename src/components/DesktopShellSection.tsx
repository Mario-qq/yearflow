/**
 * 设置页「桌面常驻」（只在桌面版出现）：关窗收进托盘 / 开机自启 / 全局速记热键状态。偏好由主进程持有（本机 shell-prefs.json），
 * 托盘右键菜单也能改，两边经 shell:prefs 广播保持一致。
 */
import { useEffect, useState } from 'react';
import { desktop, type ShellPrefsView } from '../lib/desktop';

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-13)', color: 'var(--text-secondary)' };
const tip: React.CSSProperties = { fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' };

export function DesktopShellSection() {
  const [prefs, setPrefs] = useState<ShellPrefsView | null>(null);
  const [quick, setQuick] = useState<{ ok: boolean; accelerator: string } | null>(null);
  useEffect(() => {
    const d = desktop();
    if (!d) return;
    void d.getShellPrefs().then(setPrefs);
    void d.quickNoteStatus().then(setQuick);
    return d.onShellPrefs(setPrefs);
  }, []);
  const d = desktop();
  if (!d || !prefs) return null;
  const set = (key: 'closeToTray' | 'openAtLogin', value: boolean) => void d.setShellPref(key, value).then(setPrefs);

  return (
    <div className="flex flex-col gap-2">
      <label style={row}>
        <input type="checkbox" checked={prefs.closeToTray} onChange={(e) => set('closeToTray', e.target.checked)} />
        关窗时收进托盘
        <span style={tip}>学习提醒与番茄钟照常运行；右键托盘图标「退出」才真正退出</span>
      </label>
      <label style={{ ...row, opacity: prefs.canAutoStart ? 1 : 0.5 }}>
        <input type="checkbox" checked={prefs.openAtLogin} disabled={!prefs.canAutoStart} onChange={(e) => set('openAtLogin', e.target.checked)} />
        开机自启
        <span style={tip}>{prefs.canAutoStart ? '登录后静默在托盘，不弹窗' : '开发模式下不可用'}</span>
      </label>
      {quick && (
        <div style={row}>
          全局速记 {quick.accelerator}
          <span style={{ ...tip, color: quick.ok ? 'var(--text-tertiary)' : 'var(--warning)' }}>
            {quick.ok ? '在任何软件里按下，弹出速记框记一条便签' : '这个快捷键被别的软件占用了，速记框用不了；关掉占用它的软件后重开 YearFlow'}
          </span>
        </div>
      )}
    </div>
  );
}
