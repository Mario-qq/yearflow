/**
 * 工作台透明的总开关与「垫底层」（偏好见 lib/glass.ts，样式见 styles/glass.css）。
 *
 * 决定 <html data-glass>：
 *   acrylic —— 桌面版且系统有亚克力：页面底透明，直接透出系统亚克力（真透明）。
 *              窗口失焦时 Windows 把亚克力换成实色 ⇒ 用壁纸画一层同样模糊、按屏幕位置对齐的底接住。
 *   image   —— 没有系统亚克力（网页版 / Win10）但有图：一直用图垫底模拟。
 *   不设    —— 关闭、不在工作台、系统「减少透明度」、或者没图可垫：保持原来的实色界面。
 *
 * 只在工作台生效（负责人：先做好工作台）；其余页面照旧铺实色，把常驻的亚克力盖住。
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { clarityToAlpha, useGlass } from '../lib/glass';
import { desktop, type GlassGeom } from '../lib/desktop';

const REDUCED = '(prefers-reduced-transparency: reduce)';

function useReducedTransparency(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED).matches);
  useEffect(() => {
    const mq = window.matchMedia(REDUCED);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function GlassLayer() {
  const { pathname } = useLocation();
  const { enabled, clarity, source, customImage } = useGlass();
  const reduced = useReducedTransparency();
  const [acrylic, setAcrylic] = useState(false);
  const [geom, setGeom] = useState<GlassGeom | null>(null);
  const [wallpaper, setWallpaper] = useState<string | null>(null);

  useEffect(() => {
    const d = desktop();
    if (!d) return;
    const loadWallpaper = () => void d.glassWallpaper().then(setWallpaper);
    void d.glassInfo().then((info) => {
      setAcrylic(info.acrylic);
      setGeom(info.geom);
    });
    loadWallpaper();
    const offGeom = d.onGlassGeom(setGeom);
    const offWp = d.onGlassWallpaperChanged(loadWallpaper);
    return () => {
      offGeom();
      offWp();
    };
  }, []);

  const image = source === 'custom' && customImage ? customImage : (wallpaper ?? customImage);
  const on = enabled && !reduced && pathname.startsWith('/desk');
  const mode = !on ? null : acrylic ? 'acrylic' : image ? 'image' : null;
  // 亚克力有焦点时系统在画，垫底层藏起来；失焦（或纯图片模式）才露出来
  const showWall = mode === 'image' || (mode === 'acrylic' && geom?.active === false);

  useEffect(() => {
    const root = document.documentElement;
    if (mode) root.dataset.glass = mode;
    else delete root.dataset.glass;
    root.style.setProperty('--gl-a', String(clarityToAlpha(clarity)));
    return () => {
      delete root.dataset.glass;
    };
  }, [mode, clarity]);

  if (!mode || !image) return null;
  // 桌面版按窗口在屏幕上的位置对齐壁纸（拖窗时背景跟着变，像真透过去）；网页版铺满视口
  const aligned: React.CSSProperties | undefined = geom
    ? {
        left: geom.display.x - geom.content.x,
        top: geom.display.y - geom.content.y,
        width: geom.display.width,
        height: geom.display.height,
      }
    : undefined;
  return (
    <div className={`gl-wall${showWall ? ' on' : ''}${aligned ? '' : ' fill'}`} aria-hidden>
      <div className="gl-wall-img" style={{ ...aligned, backgroundImage: `url(${image})` }} />
    </div>
  );
}
