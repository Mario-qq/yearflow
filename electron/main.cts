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
import {
  app,
  protocol,
  net,
  screen,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  Notification,
  shell,
  type Rectangle,
} from 'electron';
import fs from 'node:fs';
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

/**
 * 小窗几何。数值是 src/pomodoro/constants.ts 那份的镜像 —— 主进程与渲染进程走两套
 * 编译产物，共享模块反而要把 src 拖进 electron 的 tsconfig，代价大于抄四个数。
 * 改一边必须改另一边（PIP_W/PIP_H/PIP_DOCK_W/PIP_DOCK_H）。
 */
const PIP_W = 116;
const PIP_H = 76;
const PIP_MIN_W = 100;
const PIP_MIN_H = 64;
const PIP_DOCK_W = 88;
/** 30 而不是更矮：Windows 给窗口留着一圈不可见边框，再矮 setBounds 也会被夹回 ~30 */
const PIP_DOCK_H = 30;
/** 拖动松手时，窗边到工作区边缘多少像素内算吸附 */
const PIP_SNAP_PX = 20;

type PipEdge = 'left' | 'right' | 'top' | 'bottom';
interface PipGeom {
  free: Rectangle | null;
  edge: PipEdge | null;
  docked: boolean;
}

/** 同一时刻只允许一个小窗 */
let pipWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
/**
 * 小窗不透明度（0–1）。渲染进程是权威（存在 settings 里），主进程只缓存最后一次收到的值，
 * 好让「关掉小窗 → 再开」不会闪一下 100% 再变暗。
 */
let pipOpacity = 1;

// ——— 小窗贴边收起：几何真相全在这里 ———
//
// 渲染进程只做两件事：报鼠标进出（peek）、请求收起/脱离（dock/undock）。往屏内哪个方向
// 展开、怎么 clamp 进工作区，只有这里知道 —— 展开后光标必须仍落在窗内，否则渲染进程立刻
// 收到 leave、两边来回抖。
let pipMode: 'free' | 'docked' | 'peek' = 'free';
let pipEdge: PipEdge | null = null;
/** 收起前的自由位置与尺寸，脱离边缘时原样还回去 */
let pipFree: Rectangle | null = null;
/**
 * 我们自己 setBounds 也会触发 move。识别「这是我们摆的」用**目标矩形**而不是时间窗：
 * 时间窗（哪怕只有 400ms）会把紧跟其后的一次真实移动整个吞掉 —— 之后没有更多事件补发，
 * 那次移动就永远不会被判定，窗停在边上却不吸附。矩形比对没有这个盲区。
 */
let lastSetBounds: Rectangle | null = null;
let movedTimer: NodeJS.Timeout | null = null;
let persistTimer: NodeJS.Timeout | null = null;

function geomFile(): string {
  return path.join(app.getPath('userData'), 'pip-window.json');
}

/**
 * 刻意不进 Dexie、不进 lib/backup.ts：这是本机窗口偏好，不是用户数据 ——
 * 既不该出现在备份里，也不该跟着云同步跑到别的机器上去。
 */
function readGeom(): PipGeom {
  try {
    const raw = JSON.parse(fs.readFileSync(geomFile(), 'utf8')) as Partial<PipGeom>;
    return {
      free: raw.free ?? null,
      edge: raw.edge ?? null,
      docked: raw.docked === true,
    };
  } catch {
    return { free: null, edge: null, docked: false };
  }
}

function writeGeom(): void {
  const data: PipGeom = { free: pipFree, edge: pipEdge, docked: pipMode !== 'free' };
  try {
    fs.writeFileSync(geomFile(), JSON.stringify(data));
  } catch {
    // 写不进去（磁盘满 / 权限）就算了：位置记忆是锦上添花，不该因此弹错误
  }
}

/** 防抖 500ms 落盘，口径同 db 的自动保存 */
function persistGeom(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeGeom();
  }, 500);
}

/** 关窗时立刻落盘：防抖里那一笔要是还没到点，最后一次移动就丢了 */
function flushGeom(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  writeGeom();
}

function workAreaOf(win: BrowserWindow): Rectangle {
  return screen.getDisplayMatching(win.getContentBounds()).workArea;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * 一律走 content bounds，不用 getBounds/setBounds。
 * 无边框窗在 Windows 上带一圈不可见边框，getBounds 比请求值大 1–3 像素 —— 而这套逻辑要
 * 反复「读当前位置 → 算新位置 → 写回」，用外框尺寸每来回一次就胖 2px（实测 116→119→121…）。
 * content bounds 读写同一口径，不累积。
 */
function geomOf(win: BrowserWindow): Rectangle {
  return win.getContentBounds();
}

/** 我们主动改几何：记下目标矩形供 move 判定跳过，并把最小尺寸放到目标之下，否则会被夹住 */
function setGeom(win: BrowserWindow, b: Rectangle): void {
  lastSetBounds = b;
  win.setMinimumSize(Math.min(PIP_MIN_W, b.width), Math.min(PIP_MIN_H, b.height));
  win.setContentBounds(b);
}

/** 当前位置就是我们刚摆的那个吗 */
function isOwnMove(win: BrowserWindow): boolean {
  const t = lastSetBounds;
  if (!t) return false;
  const b = geomOf(win);
  return Math.abs(b.x - t.x) <= 2 && Math.abs(b.y - t.y) <= 2;
}

function sendMode(win: BrowserWindow): void {
  if (!win.isDestroyed()) win.webContents.send('pip:mode', { mode: pipMode, edge: pipEdge });
}

/** 离哪条边最近，以及差多少像素 */
function nearestEdge(b: Rectangle, wa: Rectangle): { edge: PipEdge; dist: number } {
  const cand: { edge: PipEdge; dist: number }[] = [
    { edge: 'left', dist: b.x - wa.x },
    { edge: 'right', dist: wa.x + wa.width - (b.x + b.width) },
    { edge: 'top', dist: b.y - wa.y },
    { edge: 'bottom', dist: wa.y + wa.height - (b.y + b.height) },
  ];
  return cand.reduce((a, c) => (c.dist < a.dist ? c : a));
}

/** 紧贴 edge、跨轴保持 b 的中心；w×h 是目标尺寸（药丸或完整态） */
function flushTo(edge: PipEdge, b: Rectangle, wa: Rectangle, w: number, h: number): Rectangle {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const x = clamp(Math.round(cx - w / 2), wa.x, wa.x + wa.width - w);
  const y = clamp(Math.round(cy - h / 2), wa.y, wa.y + wa.height - h);
  switch (edge) {
    case 'left':
      return { x: wa.x, y, width: w, height: h };
    case 'right':
      return { x: wa.x + wa.width - w, y, width: w, height: h };
    case 'top':
      return { x, y: wa.y, width: w, height: h };
    case 'bottom':
      return { x, y: wa.y + wa.height - h, width: w, height: h };
  }
}

function dockPip(win: BrowserWindow, edge: PipEdge): void {
  const wa = workAreaOf(win);
  if (pipMode === 'free') pipFree = geomOf(win);
  pipMode = 'docked';
  pipEdge = edge;
  // 先禁掉拉伸再改尺寸：Windows 给**可拉伸**窗口留着一圈不可见边框，26px 高会被夹到 30
  win.setResizable(false);
  setGeom(win, flushTo(edge, geomOf(win), wa, PIP_DOCK_W, PIP_DOCK_H));
  sendMode(win);
  persistGeom();
}

/**
 * 把矩形推离所有边缘至少 SNAP+2 —— 脱离边缘的必要收尾。
 * 不推的话：undock 把窗摆回原处（仍贴着边）→ 这次 setBounds 补发的 move 撞上吸附判定
 * → 立刻又收起来，「脱离边缘」这个动作从外面看根本没发生过。
 */
function nudgeInside(b: Rectangle, wa: Rectangle): Rectangle {
  const gap = PIP_SNAP_PX + 2;
  let { x, y } = b;
  if (x - wa.x < gap) x = wa.x + gap;
  if (wa.x + wa.width - (x + b.width) < gap) x = wa.x + wa.width - b.width - gap;
  if (y - wa.y < gap) y = wa.y + gap;
  if (wa.y + wa.height - (y + b.height) < gap) y = wa.y + wa.height - b.height - gap;
  return { ...b, x: Math.round(x), y: Math.round(y) };
}

function undockPip(win: BrowserWindow): void {
  pipMode = 'free';
  pipEdge = null;
  const b = geomOf(win);
  win.setResizable(true);
  // 没有记录过自由位置（首次就是从边上起步）就在当前位置铺开，别把窗甩回屏幕中央
  const target = pipFree ?? { x: b.x, y: b.y, width: PIP_W, height: PIP_H };
  pipFree = nudgeInside(target, workAreaOf(win));
  setGeom(win, pipFree);
  sendMode(win);
  persistGeom();
}

function peekPip(win: BrowserWindow, on: boolean): void {
  if (on) {
    if (pipMode !== 'docked' || !pipEdge) return;
    pipMode = 'peek';
    setGeom(win, flushTo(pipEdge, geomOf(win), workAreaOf(win), PIP_W, PIP_H));
  } else {
    if (pipMode !== 'peek' || !pipEdge) return;
    pipMode = 'docked';
    setGeom(win, flushTo(pipEdge, geomOf(win), workAreaOf(win), PIP_DOCK_W, PIP_DOCK_H));
  }
  sendMode(win);
}

/** 用户拖完窗松手（已防抖）：贴边就吸附，离开边缘就恢复自由 */
function onPipMoved(win: BrowserWindow): void {
  const b = geomOf(win);
  const { edge, dist } = nearestEdge(b, workAreaOf(win));
  if (dist <= PIP_SNAP_PX) {
    /**
     * 已经吸在这条边上就什么都别做。**peek 也算**：临时展开本身就是一次 setBounds，
     * 它补发的 move 会在这里被当成「用户又把窗拖到边上了」→ 立刻 dock 回去，于是
     * 展开在 120ms 后自己塌掉（表现为 hover 时窗内那棵树根本换不过来）。
     */
    if (pipMode !== 'free' && pipEdge === edge) return;
    dockPip(win, edge);
    return;
  }
  if (pipMode !== 'free') {
    // 从边上拖走：以「现在这个位置」铺开，而不是弹回收起前的旧位置
    pipFree = { x: b.x, y: b.y, width: PIP_W, height: PIP_H };
    undockPip(win);
    return;
  }
  pipFree = b;
  persistGeom();
}

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
 * 小窗：无边框 + 置顶 + 可拉伸，116×76，常态只显示倒计时。
 * 无边框是因为窗内自绘了全部窗控（PipView 的悬停浮层 + PipWindow 的 ×），整块窗体靠
 * -webkit-app-region: drag 拖动；系统标题栏在这个尺寸下就是纯浪费。
 * 位置、吸附态从 pip-window.json 恢复（见 readGeom）。
 */
function createPipWindow(): BrowserWindow {
  const saved = readGeom();
  const win = new BrowserWindow({
    width: PIP_W,
    height: PIP_H,
    minWidth: PIP_MIN_W,
    minHeight: PIP_MIN_H,
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

  pipMode = 'free';
  pipEdge = null;
  pipFree = saved.free;
  if (saved.free) setGeom(win, saved.free);

  win.once('ready-to-show', () => {
    // 先按自由位置显示、再吸附：反过来会先在屏幕中央闪一帧完整尺寸
    if (saved.docked && saved.edge) dockPip(win, saved.edge);
    else sendMode(win);
    win.show();
    broadcastPipState(true);
  });

  // Windows 上拖动过程中 moved 是连发的，判定只在松手后做一次
  const scheduleSnap = (): void => {
    if (isOwnMove(win)) return;
    if (movedTimer) clearTimeout(movedTimer);
    movedTimer = setTimeout(() => {
      movedTimer = null;
      if (!win.isDestroyed()) onPipMoved(win);
    }, 120);
  };
  // move 与 moved 都听：Windows 上拖动中连发 move、松手补一个 moved，而**程序化
  // setBounds 只发 move**（自查就是这么摆窗的，只听 moved 会一条都收不到）。
  // 防抖后两条路收敛到同一次判定，所以重复监听不会重复吸附。
  win.on('move', scheduleSnap);
  win.on('moved', scheduleSnap);
  win.on('resized', () => {
    // 我们自己改的尺寸不算用户调整：会把恢复位置时的 ±1px 边框差回写成新的「自由位置」
    if (isOwnMove(win)) return;
    if (pipMode === 'free') {
      pipFree = geomOf(win);
      persistGeom();
    }
  });

  // 用户点小窗自绘的 × 时主窗也得知道，否则面板上那个按钮会一直显示「关闭小窗」
  win.on('closed', () => {
    if (movedTimer) clearTimeout(movedTimer);
    movedTimer = null;
    flushGeom();
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

/** 贴边收起：不要求用户先把窗拖到边上，按当前位置选最近一条边 */
ipcMain.handle('pip:dock', () => {
  if (!pipWindow || pipWindow.isDestroyed()) return;
  const { edge } = nearestEdge(geomOf(pipWindow), workAreaOf(pipWindow));
  dockPip(pipWindow, edge);
});

ipcMain.handle('pip:undock', () => {
  if (pipWindow && !pipWindow.isDestroyed() && pipMode !== 'free') undockPip(pipWindow);
});

/** 收起态的鼠标进出。渲染进程只报事实，展开方向与 clamp 由这边算 */
ipcMain.handle('pip:peek', (_e, on: boolean) => {
  if (pipWindow && !pipWindow.isDestroyed()) peekPip(pipWindow, on === true);
});

/** 小窗自己请求关闭（点自绘的 ×），拿不到自己的窗口引用，所以走 sender */
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
