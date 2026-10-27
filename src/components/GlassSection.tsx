/**
 * 设置页「外观」里的「工作台透明」：开关、通透程度滑块、垫底图片。偏好存本机（lib/glass.ts）。
 * 桌面版（Win11）窗后是系统亚克力，图片只在窗口失焦时接住；网页版看不到桌面，必须选一张图才有效果。
 */
import { useEffect, useRef, useState } from 'react';
import { GLASS_DEFAULT, shrinkImage, useGlass } from '../lib/glass';
import { desktop } from '../lib/desktop';
import { showToast } from '../lib/toast';

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-13)', color: 'var(--text-secondary)' };
const tip: React.CSSProperties = { fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' };
const btn: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  padding: '2px 10px',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

export function GlassSection() {
  const { enabled, clarity, source, customImage, set, setCustomImage } = useGlass();
  const [acrylic, setAcrylic] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reduced = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
  const isDesk = desktop() !== null;

  useEffect(() => {
    void desktop()?.glassInfo().then((i) => setAcrylic(i.acrylic));
  }, []);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setCustomImage(await shrinkImage(file));
      set({ source: 'custom' });
    } catch {
      showToast('这张图读不出来，换一张试试');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label style={row}>
        <input type="checkbox" checked={enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        工作台透明
        <span style={tip}>
          {reduced
            ? '系统开了「减少透明度」，已自动关闭'
            : acrylic
              ? '窗口透出桌面（Windows 亚克力）'
              : '用一张图垫底，模拟透明'}
        </span>
      </label>

      <label style={{ ...row, opacity: enabled ? 1 : 0.5 }}>
        通透程度
        <span style={tip}>实</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={clarity}
          disabled={!enabled}
          onChange={(e) => set({ clarity: Number(e.target.value) })}
          style={{ width: 160 }}
        />
        <span style={tip}>透</span>
        {clarity !== GLASS_DEFAULT.clarity && (
          <button type="button" style={btn} onClick={() => set({ clarity: GLASS_DEFAULT.clarity })}>
            恢复默认
          </button>
        )}
      </label>

      <div style={{ ...row, opacity: enabled ? 1 : 0.5, flexWrap: 'wrap' }}>
        垫底图片
        {isDesk && (
          <label style={row}>
            <input type="radio" checked={source === 'desktop'} disabled={!enabled} onChange={() => set({ source: 'desktop' })} />
            跟随桌面壁纸
          </label>
        )}
        <label style={row}>
          <input
            type="radio"
            checked={source === 'custom' || !isDesk}
            disabled={!enabled || !customImage}
            onChange={() => set({ source: 'custom' })}
          />
          自选图片
        </label>
        <button type="button" style={btn} disabled={!enabled} onClick={() => fileRef.current?.click()}>
          {customImage ? '换一张' : '选择图片…'}
        </button>
        {customImage && (
          <button
            type="button"
            style={btn}
            disabled={!enabled}
            onClick={() => {
              setCustomImage(null);
              set({ source: 'desktop' });
            }}
          >
            移除
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      <span style={tip}>
        {isDesk
          ? '窗口失焦时 Windows 会把亚克力换成实色，用这张图接住，看起来不变'
          : '网页版看不到桌面：选一张图才会有透明效果'}
      </span>
    </div>
  );
}
