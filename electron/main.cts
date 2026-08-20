/**
 * Electron 主进程。
 *
 * 两条设计约束，改这里之前先读 plan（docs/PROGRESS.md 桌面化一节）：
 *
 * 1. **用 app:// 自定义协议，不用 file://**。注册成 standard + secure 的协议才有真实
 *    origin，于是 localStorage / IndexedDB 正常分区、navigator.locks 可用（要求 secure
 *    context）、History API 可用 —— App.tsx 的 BrowserRouter 和 index.html 里 /favicon.svg
 *    这类绝对路径全都不用改。file:// 三条全废。
 *
 * 2. **小窗是第二个同 origin 窗口，靠现成的多 tab 机制对齐**，不走 IPC 镜像状态。
 *    计时权威状态在 localStorage（pomodoro/running.ts），跨上下文通知靠 storage 事件
 *    （kernel.ts onStorage）+ navigator.locks 选 leader 保证只响一次铃。Phase 0 spike
 *    已验证这三样在两个 BrowserWindow 之间都成立（electron/spike/）。
 *    所以这里的 IPC 只做 localStorage 做不到的事：开关窗、置顶、原生通知、电源事件。
 */
import { app, protocol, net, BrowserWindow, ipcMain, powerMonitor, Notification, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** vite dev server 地址；打包后为空，走 app:// */
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '../dist');
const PRELOAD = path.join(__dirname, 'preload.cjs');

const APP_ORIGIN = 'app://local';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** 同一时刻只允许一个小窗 */
let pipWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
/**
 * 小窗不透明度（0–1）。渲染进程是权威（存在 settings 里），主进程只缓存最后一次收到的值，
 * 好让「关掉小窗 → 再开」不会闪一下 100% 再变暗。
 */
let pipOpacity = 1;

function broadcastPipState(open: boolean): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('pip:state', open);
  }
}

function pageURL(route: string): string {
  return DEV_URL ? new URL(route, DEV_URL).toString() : `${APP_ORIGIN}/${route}`;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#101014', // 与 index.html 的 theme-color 一致，避免开窗闪白
    title: 'YearFlow — 年度计划',
    webPreferences: {
      preload: PRELOAD,
      // 番茄钟到点必须准：主窗最小化时不许节流 timer。Phase 0 实测 20s 漂移 8ms。
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(pageURL('index.html'));
  return win;
}

/**
 * 小窗：无边框 + 置顶 + 可拉伸。
 * 无边框是为了保留 PipView 自绘的 28px 顶栏（原本因为 PiP 系统标题栏只显示 origin
 * 且改不了才自绘），这样 PipView 视觉零改动，顶栏靠 -webkit-app-region: drag 拖动。
 */
function createPipWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 260,
    height: 172,
    minWidth: 200,
    minHeight: 132,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#101014',
    webPreferences: { preload: PRELOAD, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setOpacity(pipOpacity);
  win.once('ready-to-show', () => {
    win.show();
    broadcastPipState(true);
  });
  // 用户点小窗自绘顶栏的 × 时主窗也得知道，否则面板上那个按钮会一直显示「关闭小窗」
  win.on('closed', () => {
    pipWindow = null;
    broadcastPipState(false);
  });
  void win.loadURL(pageURL('pip.html'));
  return win;
}

// ——— IPC：只有 localStorage 干不了的事才走这里 ———

ipcMain.handle('pip:open', () => {
  if (!pipWindow || pipWindow.isDestroyed()) pipWindow = createPipWindow();
  else pipWindow.show();
  return true;
});

ipcMain.handle('pip:close', () => {
  pipWindow?.close();
  pipWindow = null;
  return true;
});

/** 小窗自己请求关闭（点自绘顶栏的 ×），拿不到自己的窗口引用，所以走 sender */
ipcMain.handle('win:close-self', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});

/**
 * 小窗透明度。clamp 在主进程再做一遍 —— 渲染进程的 clamp 是 UI 层的事，
 * 而 setOpacity(0) 会让窗口彻底看不见、又还在置顶抢点击，属于不可恢复的状态。
 */
ipcMain.handle('pip:opacity', (_e, percent: number) => {
  const p = Math.min(100, Math.max(30, Math.round(Number(percent) || 100)));
  pipOpacity = p / 100;
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.setOpacity(pipOpacity);
  return p;
});

ipcMain.handle('notify', (_e, body: string) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: 'YearFlow', body, silent: true });
  n.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  n.show();
  return true;
});

/** 主窗被小窗/通知唤起 */
ipcMain.handle('win:focus-main', () => {
  mainWindow?.show();
  mainWindow?.focus();
});

// ——— 生命周期 ———

// 单实例：多开会出现两套 leader 选举与两份 Dexie 连接
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  void app.whenReady().then(() => {
    protocol.handle('app', (req) => {
      const { pathname } = new URL(req.url);
      // SPA 深链接：没有扩展名的路径一律回 index.html，交给 BrowserRouter
      const rel = pathname === '/' || !path.extname(pathname) ? '/index.html' : pathname;
      const file = path.join(DIST, path.normalize(rel));
      // 目录穿越防护：normalize 之后必须仍在 DIST 内
      if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });

    mainWindow = createMainWindow();

    // OS 睡眠/锁屏唤醒后广播，替代 web 端的 visibilitychange —— 番茄钟据此 catchUp() 补算
    const onResume = (): void => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('power:resume');
      }
    };
    powerMonitor.on('resume', onResume);
    powerMonitor.on('unlock-screen', onResume);
  });

  app.on('window-all-closed', () => app.quit());

  // 外链一律交给系统浏览器，不在应用内开窗
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}
