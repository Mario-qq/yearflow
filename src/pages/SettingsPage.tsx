import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { db } from '../db/schema';
import { flushNow } from '../store/persist';
import { ExemptionManager } from '../checkin/ExemptionManager';
import { SyncSection } from '../components/SyncSection';
import { BackupSection } from '../components/BackupSection';
import { replaceAllWithBackup } from '../lib/autoBackup';
import { isDesktop } from '../lib/desktop';
import { PomodoroSettings } from '../pomodoro/PomodoroSettings';
import { StudySetupForm } from '../desk/StudySetup';
import { DesktopShellSection } from '../components/DesktopShellSection';
import { GlassSection } from '../components/GlassSection';
import '../desk/desk.css';
import { buildBackupJSON, parseBackupJSON } from '../lib/backup';
import { buildSeedBundle } from '../seed/seedData';
import { todayStr } from '../lib/date';
import { emptyBundle, TABLE_NAMES, type TableName } from '../store/types';
import type { AppSettings, SyncableEntity } from '../types/domain';

/** Record<TableName, string>：加表时漏写这里 tsc 会报错 */
const TABLE_LABEL: Record<TableName, string> = {
  goals: '目标',
  tasks: '任务',
  milestones: '里程碑',
  checkIns: '打卡记录',
  exemptions: '免打卡区间',
  reviews: '月度复盘',
  focusSessions: '专注会话',
  screenTimeDays: '屏幕时间',
  workItems: '工作台事项',
  routines: '例行事项',
  routineLogs: '例行记录',
  dayMarks: '休/班标记',
  habits: '日常习惯',
  habitLogs: '习惯记录',
  people: '人物档案',
  interactions: '互动记录',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="border p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-panel)',
      }}
    >
      <h2 className="mb-3 font-medium" style={{ fontSize: 'var(--font-14)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const buttonStyle: React.CSSProperties = {
  fontSize: 'var(--font-13)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  padding: '4px 12px',
  cursor: 'pointer',
};

export default function SettingsPage() {
  const store = useStore();
  const { settings, updateSettings, exportBundle } = store;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  /**
   * 各表行数直接数 Dexie，不数内存 map。
   * 理由（容量红线可见性）：将来专注会话超过 8000 行要启用「只载入近 400 天」的窗口化 hydrate，
   * 那时内存计数会被窗口封顶在约 6400，永远到不了 8000 —— 触发条件的观测手段会被窗口化本身砍掉。
   * 先 flushNow() 再数，避免 500ms 防抖期内显示旧值；墓碑行不计入（与内存口径一致）。
   */
  const [counts, setCounts] = useState<{ table: TableName; count: number }[]>([]);
  const totalCount = counts.reduce((sum, c) => sum + c.count, 0);
  const dataVersion = TABLE_NAMES.map((t) => Object.keys(store[t]).length).join(',');

  useEffect(() => {
    let alive = true;
    void (async () => {
      await flushNow();
      const rows = await Promise.all(
        TABLE_NAMES.map(async (t) => ({
          table: t,
          count: await db
            .table(t)
            .filter((e: SyncableEntity) => !e.deletedAt)
            .count(),
        })),
      );
      if (alive) setCounts(rows);
    })();
    return () => {
      alive = false;
    };
  }, [dataVersion]);

  const say = (text: string, error = false) => setMessage({ text, error });

  /** 整库替换统一走 replaceAllWithBackup：桌面版先自动备份，备份写不进去就不替换 */
  const replaceAll = async (bundle: Parameters<typeof replaceAllWithBackup>[0], ok: string) => {
    try {
      await replaceAllWithBackup(bundle);
      say(ok);
      return true;
    } catch (e) {
      say(`操作已取消：${e instanceof Error ? e.message : '自动备份失败'}`, true);
      return false;
    }
  };
  const backupHint = isDesktop() ? '（操作前会自动备份，可在「备份与回滚」里恢复）' : '建议先导出 JSON 备份。';

  const loadSeed = async () => {
    if (totalCount > 0 && !confirm(`当前已有数据，载入示例将清空并替换全部数据${backupHint}继续？`)) return;
    await replaceAll(buildSeedBundle(todayStr()), '已载入 2026 年示例数据');
  };

  const clearAll = async () => {
    if (!confirm(`将删除全部目标、任务、打卡、专注、复盘与工作台数据，并同步到所有设备。${backupHint}确定清空？`))
      return;
    await replaceAll(emptyBundle(), '已清空全部数据');
  };

  const exportJSON = () => {
    const json = buildBackupJSON(exportBundle(), settings);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yearflow-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    say('已导出备份文件');
  };

  const importJSON = async (file: File) => {
    try {
      const parsed = parseBackupJSON(await file.text());
      const n = parsed.data.goals.length;
      if (!confirm(`将清空当前数据，恢复为该备份（${parsed.exportedAt.slice(0, 10)} 导出，${n} 个目标）${backupHint}继续？`))
        return;
      if (!(await replaceAll(parsed.data, '导入成功，数据已恢复'))) return;
      if (parsed.settings) updateSettings(parsed.settings);
    } catch (e) {
      say(e instanceof Error ? e.message : '导入失败', true);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="font-semibold" style={{ fontSize: 'var(--font-20)' }}>
        设置
      </h1>

      <Section title="外观">
        <div className="flex items-center gap-4">
          <label style={{ fontSize: 'var(--font-13)', color: 'var(--text-secondary)' }}>
            主题
            <select
              className="ml-2"
              style={buttonStyle}
              value={settings.theme}
              onChange={(e) => updateSettings({ theme: e.target.value as AppSettings['theme'] })}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label style={{ fontSize: 'var(--font-13)', color: 'var(--text-secondary)' }}>
            每周从
            <select
              className="ml-2"
              style={buttonStyle}
              value={settings.weekStartsOn}
              onChange={(e) => updateSettings({ weekStartsOn: Number(e.target.value) as 0 | 1 })}
            >
              <option value={1}>周一</option>
              <option value={0}>周日</option>
            </select>
            开始
          </label>
        </div>
        <div className="mt-3">
          <GlassSection />
        </div>
      </Section>

      {/* 番茄钟与外观同属设备本地偏好（settings 不同步），紧挨着放 */}
      <Section title="番茄钟">
        <PomodoroSettings />
      </Section>

      {/* 学习提醒（工作台学习卡右上角 ⚙ 是同一张表） */}
      <Section title="学习提醒">
        <StudySetupForm />
      </Section>

      {isDesktop() && (
        <Section title="桌面常驻">
          <DesktopShellSection />
        </Section>
      )}

      <Section title="数据">
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1">
          {counts.map(({ table, count }) => (
            <span
              key={table}
              className="tnum"
              style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
            >
              {TABLE_LABEL[table]} {count}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" style={buttonStyle} onClick={() => void loadSeed()}>
            载入示例数据
          </button>
          <button type="button" style={buttonStyle} onClick={exportJSON}>
            导出 JSON 备份
          </button>
          <button type="button" style={buttonStyle} onClick={() => fileInputRef.current?.click()}>
            导入 JSON 备份
          </button>
          <button
            type="button"
            style={{ ...buttonStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }}
            onClick={() => void clearAll()}
          >
            清空全部数据
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJSON(f);
              e.target.value = '';
            }}
          />
        </div>
        {message && (
          <p
            className="mt-3"
            style={{
              fontSize: 'var(--font-12)',
              color: message.error ? 'var(--danger)' : 'var(--success)',
            }}
          >
            {message.text}
          </p>
        )}
      </Section>

      {isDesktop() && (
        <Section title="备份与回滚">
          <BackupSection labels={TABLE_LABEL} refreshKey={dataVersion} />
        </Section>
      )}

      <Section title="免打卡区间">
        <ExemptionManager />
      </Section>

      <Section title="云同步">
        <SyncSection />
      </Section>
    </div>
  );
}
