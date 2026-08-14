/**
 * 设置页「番茄钟」区（规格 §8.7）：6 项，行内即存（照 ExemptionManager 模式 ——
 * 数字 input 的 onBlur 比对后才写、Enter → blur；开关即点即存）。
 *
 * ⚠️ 数字 input 的 onBlur 必须 **clamp 到取值范围**后写回并回显，不是「非法就不写」。
 * 漏了会怎样：focusMin = 0 ⇒ plannedMs = 0 ⇒ 每段都被 clamp 成 0 且不足 1 分钟不落库，
 * 计时器变成「永远记不上账」；longBreakEvery = 0 ⇒ completed % 0 = NaN，长休息永不触发。
 * 两者都不报错。第二道防线在 backup.ts 的 zod schema（导入畸形备份即中毒）。
 */
import { useState } from 'react';
import { useStore } from '../store/useStore';
import type { PomodoroSettings as Prefs } from '../types/domain';
import { notifyPermission, requestNotifyPermission, sendTestNotification } from './chime';
import { isPipSupported } from './pip';

const PERMISSION_TEXT: Record<NotificationPermission | 'unsupported', string> = {
  granted: '已授权',
  denied: '已拒绝（需在地址栏左侧站点设置里恢复）',
  default: '未授权（打开「到点通知」时会请求）',
  unsupported: '浏览器不支持',
};

interface NumField {
  key: 'focusMin' | 'shortBreakMin' | 'longBreakMin' | 'longBreakEvery';
  label: string;
  unit: string;
  min: number;
  max: number;
}

const NUM_FIELDS: NumField[] = [
  { key: 'focusMin', label: '专注时长', unit: '分', min: 1, max: 180 },
  { key: 'shortBreakMin', label: '短休息', unit: '分', min: 1, max: 60 },
  { key: 'longBreakMin', label: '长休息', unit: '分', min: 1, max: 120 },
  { key: 'longBreakEvery', label: '每', unit: '段后长休息', min: 1, max: 12 },
];

const inputStyle: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-primary)',
  padding: '3px 6px',
  width: 52,
};

function NumberRow({ field, value, onWrite }: { field: NumField; value: number; onWrite: (v: number) => void }) {
  const [text, setText] = useState(String(value));

  const commit = () => {
    const raw = Number(text);
    // 非法（空/NaN）回落到当前值；越界夹到边界。两种情况都要回显，别让输入框留着脏值
    const next = Number.isFinite(raw) ? Math.min(field.max, Math.max(field.min, Math.round(raw))) : value;
    setText(String(next));
    if (next !== value) onWrite(next);
  };

  return (
    <label className="flex items-center gap-1.5" style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}>
      {field.label}
      <input
        className="tnum"
        style={inputStyle}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        }}
        title={`${field.min} ~ ${field.max}`}
      />
      {field.unit}
    </label>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5"
      style={{
        fontSize: 'var(--font-12)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-panel)',
        padding: '3px 8px',
      }}
    >
      {label}
      <span style={{ color: on ? 'var(--success)' : 'var(--text-tertiary)' }}>{on ? '开' : '关'}</span>
    </button>
  );
}

export function PomodoroSettings() {
  const pomodoro = useStore((s) => s.settings.pomodoro);
  const updateSettings = useStore((s) => s.updateSettings);
  const [hint, setHint] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  // 权限可能被用户在浏览器设置里改掉，读一次不够；开关与测试按钮的每次操作都刷新
  const [perm, setPerm] = useState(notifyPermission);
  const pipSupported = isPipSupported();

  const write = (patch: Partial<Prefs>) => updateSettings({ pomodoro: { ...pomodoro, ...patch } });

  /** 通知权限只在用户主动打开开关时请求；被拒则开关回弹并说明恢复路径 */
  const toggleNotify = async () => {
    setPerm(notifyPermission());
    if (pomodoro.notify) {
      write({ notify: false });
      setHint(null);
      return;
    }
    if (notifyPermission() === 'unsupported') {
      setHint('这个浏览器不支持系统通知，到点会用声音与标签页标题提醒');
      return;
    }
    const ok = await requestNotifyPermission();
    setPerm(notifyPermission());
    if (ok) {
      write({ notify: true });
      setHint(null);
    } else {
      setHint('浏览器已拒绝通知权限，可在地址栏左侧站点设置里恢复');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {NUM_FIELDS.map((f) => (
          // key 带上取值：导入备份等外部改动会重挂一次，输入框跟着回显（onBlur 已提交，不影响输入）
          <NumberRow
            key={`${f.key}:${pomodoro[f.key]}`}
            field={f}
            value={pomodoro[f.key]}
            onWrite={(v) => write({ [f.key]: v })}
          />
        ))}
        <Toggle on={pomodoro.sound} label="到点响铃" onClick={() => write({ sound: !pomodoro.sound })} />
        <Toggle on={pomodoro.notify} label="到点通知" onClick={() => void toggleNotify()} />
        <Toggle
          on={pomodoro.autoBreak}
          label="自动开始休息"
          onClick={() => write({ autoBreak: !pomodoro.autoBreak })}
        />
        {pipSupported && (
          <Toggle
            on={pomodoro.pipAuto}
            label="开始专注时弹出悬浮小窗"
            onClick={() => write({ pipAuto: !pomodoro.pipAuto })}
          />
        )}
      </div>

      {/* 诊断：通知发不出来时，问题可能在三层里的任何一层，光看开关是「开」没有任何信息量 */}
      <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 'var(--font-12)' }}>
        <span style={{ color: 'var(--text-tertiary)' }}>通知权限：{PERMISSION_TEXT[perm]}</span>
        <button
          type="button"
          onClick={() =>
            void sendTestNotification().then((r) => {
              setTestResult(r);
              setPerm(notifyPermission());
            })
          }
          className="cursor-pointer"
          style={{
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-panel)',
            padding: '3px 8px',
          }}
        >
          发送测试通知
        </button>
        {testResult && <span style={{ color: 'var(--text-tertiary)' }}>{testResult}</span>}
      </div>

      {hint && <p style={{ fontSize: 'var(--font-12)', color: 'var(--warning)' }}>{hint}</p>}
      <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
        番茄钟仅在电脑端可用。系统通知只在页面被最小化或切到后台时发送，页面在前台时用页内提醒与声音；开着悬浮小窗时，提醒会直接显示在小窗里。切到后台或最小化时到点提醒可能延迟（浏览器会冻结后台页面的定时器）；计时依赖页面存活，合盖休眠或关闭标签页后重新打开时会让你确认这段时间是否计入。
      </p>
    </div>
  );
}
