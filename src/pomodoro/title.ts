/**
 * 标签页标题：隐藏时显示倒计时，到点提醒发不出去时降级为标题闪烁（番茄钟规格 §5.7）。
 *
 * 两条硬性约定：
 * · **只在 document.hidden 时写标题**。可见时页面上已有大号倒计时，每秒改标题会让
 *   屏幕阅读器每秒朗读一次。
 * · `restoreTitle()` 是幂等函数，且必须在五处调用：visibilitychange→visible /
 *   离开 running 态 / 组件卸载 / pagehide / **任何新的 title 写入之前**。
 *   少任何一处，标题就可能永久停在倒计时或闪烁文本上。
 */
import { mmss } from './format';
import { usePomodoroStore } from './store';
import { subscribeTick } from './ticker';

/** index.html 里的原始标题（恢复目标） */
const BASE_TITLE = 'YearFlow — 年度计划';
const FLASH_PERIOD_MS = 900;
/** 闪烁必须有停止条件，否则用户回来看到的是一个永远在抖的标签 */
const FLASH_MAX_MS = 30_000;

let flashHandle: ReturnType<typeof setInterval> | null = null;
let flashStopHandle: ReturnType<typeof setTimeout> | null = null;

function write(text: string): void {
  if (document.title !== text) document.title = text;
}

/** 幂等：停掉闪烁并把标题恢复成原始值。也是「新写入之前」那一处调用点 */
export function restoreTitle(): void {
  if (flashHandle !== null) clearInterval(flashHandle);
  if (flashStopHandle !== null) clearTimeout(flashStopHandle);
  flashHandle = null;
  flashStopHandle = null;
  write(BASE_TITLE);
}

/**
 * 通知权限被拒（或未开通知）时的降级提醒。四条停止条件：
 * 回到页面 / 30 秒超时 / 用户开始了下一段 / leader 换人 —— 见 initTitle 的两个订阅。
 */
export function flashTitle(text: string): void {
  restoreTitle(); // 新写入之前先恢复（幂等，也顺手清掉上一轮闪烁）
  let on = true;
  flashHandle = setInterval(() => {
    write(on ? text : BASE_TITLE);
    on = !on;
  }, FLASH_PERIOD_MS);
  flashStopHandle = setTimeout(restoreTitle, FLASH_MAX_MS);
}

/**
 * 装监听，由桌面端番茄入口挂载时调用一次；返回的清理函数在卸载时调用
 * （那是 restoreTitle 的「组件卸载」那一处）。
 */
export function initTitle(): () => void {
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') restoreTitle();
  };
  const onPageHide = (): void => restoreTitle();

  const stopTick = subscribeTick((msLeft) => {
    if (flashHandle !== null) return; // 闪烁中：别用倒计时互相打断
    const r = usePomodoroStore.getState().running;
    if (!r || !document.hidden) {
      restoreTitle(); // 离开 running 态 / 回到前台
      return;
    }
    write(`${r.paused ? '⏸ ' : ''}${mmss(msLeft)} · YearFlow`);
  });

  // 停止条件之三/之四：用户开始了下一段（标题应立刻回到倒计时）、leader 换人
  let wasRunning = usePomodoroStore.getState().running !== null;
  let wasLeader = usePomodoroStore.getState().isLeader;
  const stopStore = usePomodoroStore.subscribe((s) => {
    const running = s.running !== null;
    if ((running && !wasRunning) || wasLeader !== s.isLeader) restoreTitle();
    wasRunning = running;
    wasLeader = s.isLeader;
  });

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pagehide', onPageHide);
    stopStore();
    stopTick();
    restoreTitle();
  };
}
