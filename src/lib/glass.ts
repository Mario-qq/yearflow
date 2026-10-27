/**
 * 工作台透明（负责人 2026-10-27 拍板：系统真亚克力）的本机偏好。
 *
 * 只存本机 localStorage：这是「这台机器、这块屏幕」的观感，不进备份、不跟云同步
 * （和 yearflow-theme 同理）。自选背景图单独一个 key，缩到 GLASS_IMAGE_W 宽的 JPEG，
 * 几百 KB，不会撑爆 localStorage。
 *
 * 渲染逻辑在 components/GlassLayer.tsx，样式在 styles/glass.css，令牌在 tokens.css「工作台透明」。
 */
import { create } from 'zustand';

export type GlassSource = 'desktop' | 'custom';

export interface GlassPrefs {
  enabled: boolean;
  /** 通透程度 0–100：0 接近实色，100 最透 */
  clarity: number;
  /** 失焦 / 网页版用哪张图垫底：桌面壁纸（仅桌面版）或自选图片 */
  source: GlassSource;
}

const PREFS_KEY = 'yearflow-glass';
const IMAGE_KEY = 'yearflow-glass-image';

export const GLASS_DEFAULT: GlassPrefs = { enabled: true, clarity: 65, source: 'desktop' };
/** 通透程度 → 卡片底色不透明度：0 → 0.9（几乎实色），100 → 0.3 */
const ALPHA_AT_0 = 0.9;
const ALPHA_SPAN = 0.6;
/** 自选图缩到这个宽度：反正要模糊，原图只会白占 localStorage */
const GLASS_IMAGE_W = 1600;
const GLASS_IMAGE_Q = 0.82;

export function clarityToAlpha(clarity: number): number {
  const c = Math.min(100, Math.max(0, clarity));
  return Math.round((ALPHA_AT_0 - (ALPHA_SPAN * c) / 100) * 1000) / 1000;
}

function readPrefs(): GlassPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...GLASS_DEFAULT, ...(JSON.parse(raw) as Partial<GlassPrefs>) } : { ...GLASS_DEFAULT };
  } catch {
    return { ...GLASS_DEFAULT };
  }
}

function readImage(): string | null {
  try {
    return localStorage.getItem(IMAGE_KEY);
  } catch {
    return null;
  }
}

interface GlassStore extends GlassPrefs {
  /** 自选背景图（data URL） */
  customImage: string | null;
  set(patch: Partial<GlassPrefs>): void;
  setCustomImage(url: string | null): void;
}

export const useGlass = create<GlassStore>((set, get) => ({
  ...readPrefs(),
  customImage: readImage(),
  set(patch) {
    set(patch);
    const { enabled, clarity, source } = get();
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ enabled, clarity, source }));
    } catch {
      /* 隐私模式等：本次会话内仍生效 */
    }
  },
  setCustomImage(url) {
    try {
      if (url) localStorage.setItem(IMAGE_KEY, url);
      else localStorage.removeItem(IMAGE_KEY);
    } catch {
      /* 存不下就只在本次会话生效 */
    }
    set({ customImage: url });
  },
}));

/** 用户选的图片 → 缩小后的 JPEG data URL */
export async function shrinkImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, GLASS_IMAGE_W / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL('image/jpeg', GLASS_IMAGE_Q);
}
