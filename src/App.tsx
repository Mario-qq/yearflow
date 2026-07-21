import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './store/useStore';
import { normalizeGoalColors } from './store/actions';
import { applyTheme, subscribeSystemTheme } from './lib/theme';
import { showToast } from './lib/toast';
import { Toasts } from './components/Toasts';
import { Celebration } from './components/Celebration';
import { SyncIndicator } from './components/SyncIndicator';
import { initSync } from './db/sync/syncApi';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutHelp } from './components/ShortcutHelp';
import { GanttToolbar } from './gantt/GanttToolbar';
import GanttPage from './pages/GanttPage';
import CheckInPage from './pages/CheckInPage';
import SettingsPage from './pages/SettingsPage';

// 复盘页含 recharts，路由级代码分割避免拖慢甘特首屏
const ReviewPage = lazy(() => import('./pages/ReviewPage'));

const NAV = [
  { to: '/gantt', label: '甘特图', icon: '📊' },
  { to: '/checkin', label: '打卡', icon: '✓' },
  { to: '/review', label: '复盘', icon: '📈' },
  { to: '/settings', label: '设置', icon: '⚙' },
];

/** 移动端底部 tab 导航（SPEC 第五节）：打卡 / 甘特图 / 复盘 / 设置，≥44px 触达 */
function MobileTabBar() {
  return (
    <nav
      className="flex shrink-0 border-t md:hidden"
      style={{
        borderColor: 'var(--border-default)',
        background: 'var(--bg-panel)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className="flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5"
          style={({ isActive }) => ({
            color: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
          })}
        >
          <span aria-hidden style={{ fontSize: 'var(--font-16)', lineHeight: 1 }}>
            {item.icon}
          </span>
          <span style={{ fontSize: 'var(--font-11)' }}>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

const THEME_LABEL = { light: '浅色', dark: '深色', system: '跟随系统' } as const;
const THEME_NEXT = { light: 'dark', dark: 'system', system: 'light' } as const;

/** 甘特图工具组只在 /gantt 路由出现在顶栏中间（SPEC 4.1 单条顶栏） */
function GanttToolbarSlot() {
  const { pathname } = useLocation();
  if (!pathname.startsWith('/gantt')) return null;
  return <GanttToolbar />;
}

/** 移动端（<768px）默认路由落打卡面板（SPEC 第五节） */
function HomeRedirect() {
  const isMobile = window.matchMedia('(max-width: 767px)').matches;
  return <Navigate to={isMobile ? '/checkin' : '/gantt'} replace />;
}

export default function App() {
  const hydrated = useStore((s) => s.hydrated);
  const theme = useStore((s) => s.settings.theme);
  const hydrate = useStore((s) => s.hydrate);
  const updateSettings = useStore((s) => s.updateSettings);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    void hydrate().then(() => {
      // 一次性迁移：旧数据（5 色轮转）会有目标撞色，载入后重新分配一次并记录标记
      const s = useStore.getState();
      if (s.settings.colorNormalized) return;
      const changed = normalizeGoalColors();
      s.updateSettings({ colorNormalized: true });
      if (changed > 0) showToast(`已为 ${changed} 个目标重新分配颜色以避免撞色`);
    });
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(theme);
    return subscribeSystemTheme(theme);
  }, [theme, hydrated]);

  // 云同步引擎：hydrate 完成后启动（幂等；未配置 Supabase 时内部直接返回）
  useEffect(() => {
    if (hydrated) void initSync();
  }, [hydrated]);

  // 全局撤销/重做（SPEC 4.7 / 第六节）：Ctrl+Z / Ctrl+Shift+Z（或 Ctrl+Y），toast 显示摘要
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const label = useStore.getState().undo();
        showToast(label ? `已撤销：${label}` : '没有可撤销的操作');
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        const label = useStore.getState().redo();
        showToast(label ? `已重做：${label}` : '没有可重做的操作');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 命令面板（/ 或 Ctrl+K）与快捷键速查表（?）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === '?') {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!hydrated) {
    return <div className="flex h-full items-center justify-center text-tertiary">载入中…</div>;
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <div className="flex h-full flex-col">
        <header
          className="flex h-12 shrink-0 items-center gap-4 border-b px-4"
          style={{ borderColor: 'var(--border-default)', background: 'var(--bg-panel)' }}
        >
          <span className="font-semibold" style={{ fontSize: 'var(--font-16)' }}>
            YearFlow
          </span>
          <nav className="flex items-center gap-1 max-md:hidden">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className="px-2.5 py-1 transition-colors"
                style={({ isActive }) => ({
                  fontSize: 'var(--font-13)',
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--accent-soft)' : 'transparent',
                  borderRadius: 'var(--radius-sm)',
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex flex-1 justify-center max-md:hidden">
            <GanttToolbarSlot />
          </div>
          <div className="flex items-center gap-2">
            <SyncIndicator />
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="cursor-pointer px-2 py-1 max-md:hidden"
              style={{
                fontSize: 'var(--font-12)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-panel)',
              }}
              title="快捷键速查表（?）"
            >
              ?
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ theme: THEME_NEXT[theme] })}
              className="cursor-pointer px-2.5 py-1"
              style={{
                fontSize: 'var(--font-12)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-panel)',
              }}
              title="切换主题"
            >
              主题：{THEME_LABEL[theme]}
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/gantt" element={<GanttPage />} />
            <Route path="/checkin" element={<CheckInPage />} />
            <Route
              path="/review"
              element={
                <Suspense fallback={<div className="p-6 text-tertiary">载入中…</div>}>
                  <ReviewPage />
                </Suspense>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <MobileTabBar />
        <Toasts />
        <Celebration />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </BrowserRouter>
  );
}
