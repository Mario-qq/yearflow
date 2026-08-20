/**
 * Phase 0 Spike —— 验证「用现成的多 tab 机制当小窗的桥」这个前提成立。
 *
 * 四项断言（任一失败，Phase 2 就得改用显式 IPC 镜像状态）：
 *   1. 同 origin 两窗口之间 storage 事件互通
 *   2. navigator.locks 独占锁跨窗口真互斥（leader 选举的地基）
 *   3. 两窗口共享同一个 IndexedDB
 *   4. 长 setTimeout 在窗口最小化后不被节流（backgroundThrottling: false）
 *
 * 顺带验证 app:// 自定义协议 + BrowserRouter 式绝对路径能正常加载。
 */
const { app, protocol, net, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = __dirname;

// 必须在 ready 之前注册：standard 才有真实 origin（localStorage/IDB 按 origin 分区），
// secure 才不被当成不安全上下文（navigator.locks 要求 secure context）。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** role -> webContents */
const wins = new Map();
const results = {};

function reply(role, channel, payload) {
  wins.get(role)?.webContents.send(channel, payload);
}

/** 等某个 role 报上来一条结果 */
function await1(key) {
  return new Promise((resolve) => {
    ipcMain.once(key, (_e, value) => {
      results[key] = value;
      resolve(value);
    });
  });
}

async function run() {
  // 1. storage 事件：B 监听，A 写
  reply('b', 'listen-storage');
  await await1('storage-armed');
  reply('a', 'write-storage', { key: 'yearflow:spike', value: String(Date.now()) });
  await await1('storage-event');

  // 2. Web Locks 互斥：B 持锁，A 用 ifAvailable 探测应拿不到
  reply('b', 'hold-lock');
  await await1('lock-held');
  reply('a', 'probe-lock');
  await await1('lock-probe');
  reply('b', 'release-lock');

  // 3. IndexedDB 共享：A 写，B 读
  reply('a', 'idb-write');
  await await1('idb-written');
  reply('b', 'idb-read');
  await await1('idb-read');

  // 4. 最小化后的 setTimeout 漂移（20s 抽样，25min 留人工复测）
  wins.get('a').minimize();
  reply('a', 'timer-drift', { ms: 20000 });
  await await1('timer-drift');
  wins.get('a').restore();

  console.log('\n=== SPIKE RESULTS ===');
  console.log(JSON.stringify(results, null, 2));

  const pass =
    results['storage-event']?.received === true &&
    results['lock-probe']?.blocked === true &&
    results['idb-read']?.value != null &&
    Math.abs(results['timer-drift']?.driftMs ?? 1e9) < 1000;
  console.log(pass ? '\nVERDICT: PASS' : '\nVERDICT: FAIL');
  app.exit(pass ? 0 : 1);
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = pathname === '/' ? '/spike.html' : pathname;
    return net.fetch(pathToFileURL(path.join(ROOT, file)).toString());
  });

  for (const role of ['a', 'b']) {
    const win = new BrowserWindow({
      width: 420,
      height: 300,
      x: role === 'a' ? 40 : 500,
      y: 80,
      title: `spike-${role}`,
      webPreferences: {
        preload: path.join(ROOT, 'preload.cjs'),
        backgroundThrottling: false, // 第 4 项断言的被测开关
      },
    });
    wins.set(role, win);
    // 绝对路径 + 查询串，模拟 BrowserRouter 下的真实加载形态
    win.loadURL(`app://local/spike.html?role=${role}`);
  }

  let ready = 0;
  ipcMain.on('ready', () => {
    if (++ready === 2) run();
  });
});
