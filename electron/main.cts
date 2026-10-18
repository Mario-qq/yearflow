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
  Menu,
  Tray,
  nativeImage,
  shell,
  dialog,
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
/** 收起态移开鼠标后延迟多久收回（镜像 constants.ts 的 PIP_PEEK_LEAVE_MS） */
const PIP_PEEK_LEAVE_MS = 400;
/** 光标位置轮询间隔。120ms 足够跟手，又不至于让一个常开的小窗持续占 CPU */
const PIP_HOVER_POLL_MS = 120;

type PipEdge = 'left' | 'right' | 'top' | 'bottom';
interface PipGeom {
  free: Rectangle | null;
  edge: PipEdge | null;
  docked: boolean;
}

/** 同一时刻只允许一个小窗 */
let pipWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;

// ——— 托盘常驻（DESK_SPEC §五 第 2 层：学习到点提醒要靠后台常驻）———
//
// 关主窗 = 收进托盘（渲染进程照常跑：backgroundThrottling 已关，提醒与番茄钟计时不停）；
// 托盘菜单「退出」才真正退出。负责人 2026-10-16 拍板：关窗收托盘、默认不开机自启（托盘/设置里可开）。
// 偏好存本机 userData/shell-prefs.json：主进程在渲染进程起来之前就要知道「关窗怎么办」，
// 而且这是这台机器的窗口行为，不该进备份、不该跟着云同步走。

interface ShellPrefs {
  closeToTray: boolean;
  /** 第一次收进托盘时弹过一次说明 */
  trayHintShown: boolean;
  /** 每日备份另存一份的目录（null = 不另存）。见下「本机自动备份」 */
  backupMirrorDir: string | null;
  /** 上次另存成功的时间（ISO）/ 上次另存失败的原因（成功后清空） */
  backupMirrorAt: string | null;
  backupMirrorError: string | null;
}
const SHELL_PREFS_DEFAULT: ShellPrefs = {
  closeToTray: true,
  trayHintShown: false,
  backupMirrorDir: null,
  backupMirrorAt: null,
  backupMirrorError: null,
};
let shellPrefs: ShellPrefs = { ...SHELL_PREFS_DEFAULT };
let tray: Tray | null = null;
/** 托盘「退出」/ 系统关机：放行 close，不再收进托盘 */
let quitting = false;
let trayStatus = '';
/** 开机自启时带这个参数：只进托盘、不弹主窗 */
const START_HIDDEN = process.argv.includes('--hidden');

function shellPrefsFile(): string {
  return path.join(app.getPath('userData'), 'shell-prefs.json');
}

function readShellPrefs(): ShellPrefs {
  try {
    return { ...SHELL_PREFS_DEFAULT, ...(JSON.parse(fs.readFileSync(shellPrefsFile(), 'utf8')) as Partial<ShellPrefs>) };
  } catch {
    return { ...SHELL_PREFS_DEFAULT };
  }
}

function writeShellPrefs(patch: Partial<ShellPrefs>): void {
  shellPrefs = { ...shellPrefs, ...patch };
  try {
    fs.writeFileSync(shellPrefsFile(), JSON.stringify(shellPrefs), 'utf8');
  } catch {
    // 写不进去只影响下次启动的默认行为
  }
}

/**
 * 开机自启。没有安装包：快捷方式启动的是 node_modules 里的 electron.exe + 项目目录，
 * 所以登录项也得原样带上「app 目录」这个参数（再加 --hidden 只进托盘）。开发模式（vite dev）不提供。
 */
const canAutoStart = (): boolean => !DEV_URL && process.platform === 'win32';
const loginArgs = (): string[] => [app.getAppPath(), '--hidden'];
function getOpenAtLogin(): boolean {
  if (!canAutoStart()) return false;
  return app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin;
}
function setOpenAtLogin(on: boolean): void {
  if (!canAutoStart()) return;
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: loginArgs() });
}

function showMain(route?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (route) mainWindow.webContents.send('app:navigate', route);
}

function trayIcon(): Electron.NativeImage {
  const img = nativeImage.createFromPath(path.join(__dirname, '../build/icon.ico'));
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16 });
}

function shellPrefsView(): { closeToTray: boolean; openAtLogin: boolean; canAutoStart: boolean } {
  return { closeToTray: shellPrefs.closeToTray, openAtLogin: getOpenAtLogin(), canAutoStart: canAutoStart() };
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '打开 YearFlow', click: () => showMain() },
    {
      label: '开始学习',
      click: () => {
        showMain('/desk');
        mainWindow?.webContents.send('tray:study');
      },
    },
    { type: 'separator' },
    {
      label: '关窗时收进托盘',
      type: 'checkbox',
      checked: shellPrefs.closeToTray,
      click: (item) => {
        writeShellPrefs({ closeToTray: item.checked });
        broadcastShellPrefs();
      },
    },
    {
      label: canAutoStart() ? '开机自启（静默在托盘）' : '开机自启（开发模式不可用）',
      type: 'checkbox',
      enabled: canAutoStart(),
      checked: getOpenAtLogin(),
      click: (item) => {
        setOpenAtLogin(item.checked);
        broadcastShellPrefs();
      },
    },
    { type: 'separator' },
    {
      label: '退出 YearFlow',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray(): void {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip(trayStatus ? `YearFlow · ${trayStatus}` : 'YearFlow');
  tray.on('click', () => showMain());
  rebuildTrayMenu();
}

/** 托盘菜单里改了偏好，设置页要同步打勾（反之亦然） */
function broadcastShellPrefs(): void {
  rebuildTrayMenu();
  const view = shellPrefsView();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('shell:prefs', view);
  }
}
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
/** 光标是否落在小窗上 —— 由主进程轮询判定，见 startHoverWatch */
let pipHover = false;
let hoverTimer: NodeJS.Timeout | null = null;
let peekLeaveTimer: NodeJS.Timeout | null = null;

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
  // 最小尺寸约束对 setBounds 依然生效：不放开就可能把 88×30 夹回 100×64，
  // 窗看着还挺高、里面却是一条药丸的布局。别指望 setResizable(false) 顺手抹掉它。
  win.setMinimumSize(PIP_DOCK_W, PIP_DOCK_H);
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
  win.setMinimumSize(PIP_MIN_W, PIP_MIN_H);
  // 没有记录过自由位置（首次就是从边上起步）就在当前位置铺开，别把窗甩回屏幕中央
  const target = pipFree ?? { x: b.x, y: b.y, width: PIP_W, height: PIP_H };
  pipFree = nudgeInside(target, workAreaOf(win));
  setGeom(win, pipFree);
  sendMode(win);
  persistGeom();
}

/**
 * 窗现在是不是药丸档 —— 判 peek 该往哪走只信这个，不信 pipMode。
 * pipMode 是内存里的一个变量，和真实几何漂移过一次就再也对不回来（渲染进程那边同理，
 * 见 PipWindow 的 useIsCompact）；矩形是随时能重新量的。
 */
function isDockSized(win: BrowserWindow): boolean {
  const b = geomOf(win);
  return b.height <= PIP_DOCK_H + 8 || b.width <= PIP_DOCK_W + 8;
}

function peekPip(win: BrowserWindow, on: boolean): void {
  const wa = workAreaOf(win);
  // edge 也现场兜底：吸附是靠「离哪条边最近」判的，收起态的窗必然紧贴着那条边
  const edge = pipEdge ?? nearestEdge(geomOf(win), wa).edge;
  if (on) {
    if (!isDockSized(win)) return;
    pipMode = 'peek';
    pipEdge = edge;
    win.setMinimumSize(PIP_MIN_W, PIP_MIN_H); // 展开要够高，否则被夹在药丸档下不来
    setGeom(win, flushTo(edge, geomOf(win), wa, PIP_W, PIP_H));
  } else {
    if (isDockSized(win)) return;
    pipMode = 'docked';
    pipEdge = edge;
    win.setMinimumSize(PIP_DOCK_W, PIP_DOCK_H);
    setGeom(win, flushTo(edge, geomOf(win), wa, PIP_DOCK_W, PIP_DOCK_H));
  }
  sendMode(win);
}

/**
 * ⚠️ 悬停必须由**主进程**判定，不能靠窗内的 :hover / onPointerEnter。
 *
 * 小窗整块都是 `-webkit-app-region: drag`（无边框窗要能哪都能拖）。这是**原生 hit-test**：
 * Windows 把落在拖动区上的鼠标判给「移动窗口」，渲染进程连 mousemove 都收不到 ⇒ CSS
 * :hover 永不成立、onPointerEnter 永不触发。表现就是：常态那一屏只剩倒计时，鼠标移上去
 * 控件不浮出、× 也点不到（它靠 `:not(:hover)` 交还 drag，于是永远是 drag）。
 * 自动化测不出来 —— Playwright 的合成事件绕过 hit-test，照样能 hover。
 *
 * 所以改成主进程轮询光标位置：`screen.getCursorScreenPoint()` 与窗矩形比对，跨越边界时
 * 才发一次 `pip:hover`。顺带把 peek（收起态移上去临时展开）也收回这里 —— 判据同源，
 * 不再需要渲染进程上报。
 */
function sendHover(win: BrowserWindow, on: boolean): void {
  if (!win.isDestroyed()) win.webContents.send('pip:hover', on);
}

function clearPeekLeave(): void {
  if (peekLeaveTimer) clearTimeout(peekLeaveTimer);
  peekLeaveTimer = null;
}

function tickHover(): void {
  const win = pipWindow;
  if (!win || win.isDestroyed()) {
    stopHoverWatch();
    return;
  }
  const p = screen.getCursorScreenPoint();
  const b = geomOf(win);
  const inside =
    p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  if (inside === pipHover) return;
  pipHover = inside;
  sendHover(win, inside);
  if (inside) {
    clearPeekLeave();
    // 收起档才展开：完整态没什么可展的，而 peekPip 自己也会再判一次几何
    if (isDockSized(win)) peekPip(win, true);
    return;
  }
  // 擦边而过不该让它闪一下：留一段回收延迟，期间再次移入直接取消
  if (pipMode === 'peek') {
    clearPeekLeave();
    peekLeaveTimer = setTimeout(() => {
      peekLeaveTimer = null;
      if (pipWindow && !pipWindow.isDestroyed() && !pipHover) peekPip(pipWindow, false);
    }, PIP_PEEK_LEAVE_MS);
  }
}

function startHoverWatch(): void {
  if (hoverTimer) return;
  pipHover = false;
  hoverTimer = setInterval(tickHover, PIP_HOVER_POLL_MS);
}

function stopHoverWatch(): void {
  if (hoverTimer) clearInterval(hoverTimer);
  hoverTimer = null;
  clearPeekLeave();
  pipHover = false;
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

function createMainWindow(hidden = false): BrowserWindow {
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
      // 收进托盘（隐藏）时同理：学习提醒的轮询与计时照常跑。
      backgroundThrottling: false,
      // 托盘「开始学习」不是页面里的手势，到点照样要能响铃
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.once('ready-to-show', () => {
    if (!hidden) win.show();
  });
  // Windows 注销/关机：放行关闭，否则「收进托盘」会把关机挡住
  win.on('query-session-end', () => {
    quitting = true;
  });
  win.on('session-end', () => {
    quitting = true;
  });
  // 关窗 = 收进托盘（托盘菜单「退出」才真退出）
  win.on('close', (e) => {
    if (quitting || !shellPrefs.closeToTray || !tray) return;
    e.preventDefault();
    win.hide();
    if (!shellPrefs.trayHintShown && Notification.isSupported()) {
      writeShellPrefs({ trayHintShown: true });
      new Notification({
        title: 'YearFlow 收进了托盘',
        body: '学习提醒和番茄钟照常运行。右键托盘图标可以退出；设置里可以改成关窗即退出。',
        silent: true,
      }).show();
    }
  });
  win.on('closed', () => {
    mainWindow = null;
  });
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
    /**
     * ⚠️ 必须关掉系统投影，否则「不透明度 < 100%」+「主窗全屏」会互相作用出一圈闪烁的浅色光晕。
     * 链条：无边框窗的投影是 Windows 靠 DwmExtendFrameIntoClientArea 画在窗外的；而
     * setOpacity(<1) 会把窗变成 layered window（WS_EX_LAYERED + LWA_ALPHA）。主窗全屏后
     * DWM 换一条合成路径，下方内容每重绘一次（鼠标移动、滚动），那圈投影就被重新混合一次
     * ⇒ 小窗四周一闪一闪。不透明度 100% 时窗口不是 layered，所以看不见。
     * 小窗的窗控全是自绘的，系统投影本就没参与任何功能；分离感改由 .pip-shell 的 1px 内描边给。
     */
    hasShadow: false,
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
    startHoverWatch();
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
    stopHoverWatch();
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

/**
 * 收起态临时展开。真实鼠标走主进程的 tickHover（拖动区吃掉了窗内的指针事件），
 * 这条 IPC 只剩两个用处：自查脚本直接驱动展开，以及 web 侧接口保持同形。
 */
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

/** 通知被点：拉起主窗；带 route 就跳到那一页（学习提醒 → 工作台） */
const liveNotices = new Set<Notification>();
ipcMain.handle('notify', (_e, body: string, opts?: { title?: string; route?: string; sound?: boolean }) => {
  if (!Notification.isSupported()) return false;
  const route = typeof opts?.route === 'string' && opts.route.startsWith('/') ? opts.route : undefined;
  const title = typeof opts?.title === 'string' && opts.title ? opts.title : 'YearFlow';
  const n = new Notification({ title, body, silent: opts?.sound !== true });
  // 持有引用直到被点/关掉：通知对象被回收后 click 事件就收不到了
  liveNotices.add(n);
  n.on('click', () => {
    liveNotices.delete(n);
    showMain(route);
  });
  n.on('close', () => liveNotices.delete(n));
  n.show();
  return true;
});

ipcMain.handle('shell:prefs', () => shellPrefsView());
ipcMain.handle('shell:set-pref', (_e, key: string, value: boolean) => {
  if (key === 'closeToTray') writeShellPrefs({ closeToTray: value === true });
  else if (key === 'openAtLogin') setOpenAtLogin(value === true);
  else throw new Error(`未知偏好：${String(key)}`);
  broadcastShellPrefs();
  return shellPrefsView();
});

/** 托盘悬停提示（「今天还没学 · 英语」之类）；渲染进程状态变了才发 */
ipcMain.handle('tray:status', (_e, text: string) => {
  trayStatus = typeof text === 'string' ? text.slice(0, 100) : '';
  tray?.setToolTip(trayStatus ? `YearFlow · ${trayStatus}` : 'YearFlow');
});

/** 主窗被小窗/通知唤起 */
ipcMain.handle('win:focus-main', () => showMain());

// ——— 本机自动备份（DESK_SPEC §七）———
//
// 渲染进程负责「什么时候备份、备份什么」（全库 JSON = lib/backup.ts 的导出格式），
// 这里只管文件：落盘、按种类保留最近 N 份、列出、读回、打开目录。
// 文件名即元数据：yearflow-YYYYMMDD-HHmmssSSS-<daily|pre>.json，读写都只认这个形状（防目录穿越）。
// 带毫秒且撞名就顺延 1ms：同一秒内两次备份（操作前备份紧跟回滚）不能互相覆盖。
// 老的 HHmmss 形状（无毫秒）照样认。

const BACKUP_KEEP = { daily: 30, pre: 10 } as const;
type BackupKind = keyof typeof BACKUP_KEEP;
const BACKUP_NAME = /^yearflow-(\d{8})-(\d{6})(?:\d{3})?-(daily|pre)\.json$/;

function backupDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pruneBackups(kind: BackupKind): void {
  const dir = backupDir();
  const mine = fs
    .readdirSync(dir)
    .filter((f) => BACKUP_NAME.exec(f)?.[3] === kind)
    .sort()
    .reverse(); // 文件名里的时间是定宽的，字典序 = 时间序
  for (const f of mine.slice(BACKUP_KEEP[kind])) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      // 删不掉（被占用）就留到下次
    }
  }
}

ipcMain.handle('backup:write', (_e, json: string, kind: BackupKind) => {
  if (kind !== 'daily' && kind !== 'pre') throw new Error(`未知备份种类：${String(kind)}`);
  if (typeof json !== 'string' || json.length === 0) throw new Error('备份内容为空');
  const dir = backupDir();
  let t = Date.now();
  let name: string;
  for (;;) {
    const d = new Date(t);
    const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}`;
    name = `yearflow-${stamp}-${kind}.json`;
    if (!fs.existsSync(path.join(dir, name))) break;
    t += 1;
  }
  const tmp = path.join(dir, `${name}.tmp`);
  // 先写临时文件再改名：写到一半断电不会留下一份「看起来完整」的坏备份
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, path.join(dir, name));
  pruneBackups(kind);
  if (kind === 'daily') mirrorCopy(name);
  return name;
});

// ——— 另存一份（异地兜底）———
//
// userData 在 C 盘、和 IndexedDB 挨着：重装系统 / 删用户目录 / 换电脑时备份和数据一起没。
// 所以每日备份可以再复制一份到负责人自选的目录（D 盘、网盘同步目录、U 盘……），那边同样留 30 份。
// 只复制 daily：pre 是「刚才那次操作的退路」，留在本机即可。
// 另存失败（目录被拔掉 / 无权限）不影响本机备份本身，只把原因记下来给设置页显示。
// 清理只动符合备份文件名的 daily 文件，目录里负责人自己的其它文件一概不碰。

function mirrorView(): { dir: string | null; at: string | null; error: string | null } {
  return { dir: shellPrefs.backupMirrorDir, at: shellPrefs.backupMirrorAt, error: shellPrefs.backupMirrorError };
}

function mirrorCopy(name: string): void {
  const dir = shellPrefs.backupMirrorDir;
  if (!dir) return;
  try {
    if (!fs.existsSync(dir)) throw new Error('目录不存在（盘被拔掉或改了名？）');
    const tmp = path.join(dir, `${name}.tmp`);
    fs.copyFileSync(path.join(backupDir(), name), tmp);
    fs.renameSync(tmp, path.join(dir, name));
    const mine = fs
      .readdirSync(dir)
      .filter((f) => BACKUP_NAME.exec(f)?.[3] === 'daily')
      .sort()
      .reverse();
    for (const f of mine.slice(BACKUP_KEEP.daily)) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
        // 删不掉就留到下次
      }
    }
    writeShellPrefs({ backupMirrorAt: new Date().toISOString(), backupMirrorError: null });
  } catch (e) {
    writeShellPrefs({ backupMirrorError: e instanceof Error ? e.message : String(e) });
  }
}

/** 本机最新的一份 daily（选好目录后立刻另存它，不用等明天） */
function latestDaily(): string | null {
  return (
    fs
      .readdirSync(backupDir())
      .filter((f) => BACKUP_NAME.exec(f)?.[3] === 'daily')
      .sort()
      .pop() ?? null
  );
}

ipcMain.handle('backup:mirror', () => mirrorView());

ipcMain.handle('backup:mirror-choose', async () => {
  const opts: Electron.OpenDialogOptions = {
    title: '选择另存备份的文件夹',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: shellPrefs.backupMirrorDir ?? app.getPath('documents'),
  };
  const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts);
  const dir = r.filePaths[0];
  if (r.canceled || !dir) return mirrorView();
  if (path.resolve(dir).toLowerCase() === path.resolve(backupDir()).toLowerCase()) {
    writeShellPrefs({ backupMirrorError: '不能选本机备份文件夹本身，请选另一个位置（最好是另一块盘或网盘目录）' });
    return mirrorView();
  }
  writeShellPrefs({ backupMirrorDir: dir, backupMirrorAt: null, backupMirrorError: null });
  const last = latestDaily();
  if (last) mirrorCopy(last);
  return mirrorView();
});

ipcMain.handle('backup:mirror-clear', () => {
  writeShellPrefs({ backupMirrorDir: null, backupMirrorAt: null, backupMirrorError: null });
  return mirrorView();
});

ipcMain.handle('backup:mirror-open', () => (shellPrefs.backupMirrorDir ? shell.openPath(shellPrefs.backupMirrorDir) : ''));

ipcMain.handle('backup:list', () => {
  const dir = backupDir();
  return fs
    .readdirSync(dir)
    .map((name) => {
      const m = BACKUP_NAME.exec(name);
      if (!m) return null;
      const [, ymd, hms] = m;
      const at = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
      return { name, kind: m[3] as BackupKind, at, size: fs.statSync(path.join(dir, name)).size };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.name.localeCompare(a.name));
});

ipcMain.handle('backup:read', (_e, name: string) => {
  if (typeof name !== 'string' || !BACKUP_NAME.test(name)) throw new Error('非法备份文件名');
  return fs.readFileSync(path.join(backupDir(), name), 'utf8');
});

ipcMain.handle('backup:open-dir', () => shell.openPath(backupDir()));

// ——— 生命周期 ———

// 单实例：多开会出现两套 leader 选举与两份 Dexie 连接
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 再点一次快捷方式（主窗收在托盘里，或关了主窗只留小窗时 mainWindow 是 null）：拉起主窗
  app.on('second-instance', () => showMain());

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

    shellPrefs = readShellPrefs();
    mainWindow = createMainWindow(START_HIDDEN);
    createTray();

    // OS 睡眠/锁屏唤醒后广播，替代 web 端的 visibilitychange —— 番茄钟据此 catchUp() 补算
    const onResume = (): void => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('power:resume');
      }
    };
    powerMonitor.on('resume', onResume);
    powerMonitor.on('unlock-screen', onResume);
  });

  app.on('before-quit', () => {
    quitting = true;
  });
  // 收进托盘时主窗只是隐藏、不算关闭；走到这里说明真没窗了（关窗即退出模式，或托盘没建成）
  app.on('window-all-closed', () => {
    if (!tray || !shellPrefs.closeToTray || quitting) app.quit();
  });

  // 外链一律交给系统浏览器，不在应用内开窗
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}
