/**
 * 到点提醒：合成提示音 + 系统通知 + 标题闪烁降级（番茄钟规格 §5.7）。
 *
 * 三条硬性约定：
 * · AudioContext **必须在「开始专注」的手势回调里创建并 resume()** —— autoplay policy 下
 *   手势之前创建出来的上下文是 suspended，25 分钟后想响也响不了。
 * · **播放前必须重新检查 ctx.state**：创建到响铃隔着 25 分钟，页面进过 bfcache/frozen
 *   会让上下文被 suspend；resume() 失败一律**静默降级**（通知/标题闪烁），绝不 toast 报错。
 * · 通知只在**页面隐藏**时发，且必须带 tag —— 零成本的双弹去重兜底，Web Locks 选主失效时
 *   唯一的防线。权限只在用户主动打开开关时请求（页面加载即请求会招来更安静的权限 UI 惩罚）。
 */
import { useStore } from '../store/useStore';
import { desktop, isDesktop } from '../lib/desktop';
import { CHIME_FREQS, CHIME_GAIN, CHIME_NOTE_MS } from './constants';
import { setAlert, type ChimeKind } from './kernel';
import { flashTitle } from './title';

const NOTIFY_TAG = 'yearflow-pomodoro';

let ctx: AudioContext | null = null;

type Ctor = typeof AudioContext;
function audioCtor(): Ctor | null {
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 在「开始专注」的手势回调里调用（同步创建 + resume，之后全程复用同一实例） */
export function unlockAudio(): void {
  try {
    const Ctor = audioCtor();
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state !== 'running') void ctx.resume();
  } catch {
    ctx = null; // 拿不到音频上下文就静默走通知/标题降级
  }
}

/** 两声短促柔和音（880Hz → 1174Hz，各 90ms，指数衰减）。不引入音频文件 */
async function playChime(): Promise<boolean> {
  try {
    const Ctor = audioCtor();
    if (!Ctor) return false;
    ctx ??= new Ctor();
    if (ctx.state !== 'running') await ctx.resume();
    if (ctx.state !== 'running') return false;
    const note = CHIME_NOTE_MS / 1000;
    CHIME_FREQS.forEach((freq, i) => {
      const at = ctx!.currentTime + i * note;
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(CHIME_GAIN, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(at);
      osc.stop(at + note);
    });
    return true;
  } catch {
    return false;
  }
}

export function notifySupported(): boolean {
  return isDesktop() || typeof Notification !== 'undefined';
}

/** 桌面壳走主进程的原生通知，没有「网页权限」这一层，恒为 granted */
export function notifyPermission(): NotificationPermission | 'unsupported' {
  if (isDesktop()) return 'granted';
  return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
}

/** 只在用户主动打开「到点通知」开关时调用 */
export async function requestNotifyPermission(): Promise<boolean> {
  if (isDesktop()) return true; // 原生通知不需要申请
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

function showNotification(body: string): boolean {
  const d = desktop();
  if (d) {
    // 主进程侧是同步 new Notification().show()，只有 IPC 往返是异步的 ⇒ 这里乐观返回 true。
    // 返回 false 会让 handleChime 退回闪标题，而桌面版根本没有 tab 标题可闪。
    void d.notify(body);
    return true;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification('YearFlow 番茄钟', { body, tag: NOTIFY_TAG });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** 发一条测试通知：把「网页/应用权限 / 系统通知设置 / 专注助手」几层问题一次性分离出来 */
export async function sendTestNotification(): Promise<string> {
  if (isDesktop()) {
    return showNotification('这是一条测试通知。看不到它就说明系统层面拦住了：查 Windows 通知设置与专注助手')
      ? '已发出。若屏幕上没看到，问题在 Windows 通知设置或专注助手（设置 → 系统 → 通知里找 YearFlow）'
      : '发送失败，系统拒绝了这次通知';
  }
  if (!notifySupported()) return '这个浏览器不支持系统通知';
  if (Notification.permission === 'denied') return '浏览器已拒绝通知权限，可在地址栏左侧站点设置里恢复';
  if (Notification.permission !== 'granted' && !(await requestNotifyPermission()))
    return '未获得通知权限';
  return showNotification('这是一条测试通知。看不到它就说明系统层面拦住了：查 Windows 通知设置与专注助手')
    ? '已发出。若屏幕上没看到，问题在系统通知设置或专注助手，不在本站'
    : '发送失败，浏览器拒绝了这次通知';
}

const TEXT: Record<ChimeKind, string> = {
  focusEnd: '这段专注到点了，休息一下',
  breakEnd: '休息结束，可以再来一段',
};

/**
 * 内核在**落库之后**调用（音频异常绝不允许阻断数据写入）。
 *
 * ⚠️ `alert` 必须在 `document.hidden` 判断**之前**置位。原先这里前台直接 return，
 * 于是「页面被冻结 → 到点时闹钟没跑 → 切回来 catchUp 补算结算」这条路径上
 * 页面已经 visible，用户只听到一声铃，面板不点开就什么都看不见 —— 这正是
 * 「明明开了通知却毫无提醒」的真实成因。alert 是那条路径唯一的可见出口。
 */
export function handleChime(kind: ChimeKind): void {
  const { sound, notify } = useStore.getState().settings.pomodoro;
  setAlert({ kind, text: TEXT[kind], at: Date.now() });
  if (sound) void playChime();
  // 桌面版：小窗是独立窗口，它自己 alert 变脸已经是最可靠那层提醒；主窗可见就不再叠系统通知
  if (!document.hidden) return;
  if (!notify) return; // 用户显式关掉了到点通知，不该改用闪标题绕过这个选择
  if (!showNotification(TEXT[kind])) flashTitle(`⏰ ${TEXT[kind]}`);
}
