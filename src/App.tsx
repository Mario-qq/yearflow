import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './store/useStore';
import { applyTheme, subscribeSystemTheme } from './lib/theme';
import { showToast } from './lib/toast';
import { Toasts } from './components/Toasts';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutHelp } from './components/ShortcutHelp';
import { GanttToolbar } from './gantt/GanttToolbar';
import GanttPage from './pages/GanttPage';
import CheckInPage from './pages/CheckInPage';
import ReviewPage from './pages/ReviewPage';
import SettingsPage from './pages/SettingsPage';

const NAV = [
  { to: '/gantt', label: '甘特图' },
  { to: '/checkin', label: '打卡' },
  { to: '/review', label: '复盘' },
  { to: '/settings', label: '设置' },
];

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
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(theme);
    return subscribeSystemTheme(theme);
  }, [theme, hydrated]);

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
    <BrowserRouter>
      <div className="flex h-full flex-col">
        <header
          className="flex h-12 shrink-0 items-center gap-4 border-b px-4"
          style={{ borderColor: 'var(--border-default)', background: 'var(--bg-panel)' }}
        >
          <span className="font-semibold" style={{ fontSize: 'var(--font-16)' }}>
            YearFlow
          </span>
          <nav className="flex items-center gap-1">
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
          <div className="flex flex-1 justify-center">
            <GanttToolbarSlot />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="cursor-pointer px-2 py-1"
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
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <Toasts />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </BrowserRouter>
  );
}
