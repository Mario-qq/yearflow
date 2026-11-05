/**
 * 会议提醒：每 20 秒判一次 lib/derive/meetings.meetingRemindersDue，到点就发通知。
 * - 桌面版：系统通知（带提示音），关窗收进托盘后照常；点通知回到工作台；
 * - 网页版：页面开着时发浏览器通知（用户允许过的话）；
 * - 两边页面里都挂一条会议提醒横幅（MeetingAlerts），点「知道了」才收起——toast 两秒半就没了，会议提醒不能错过。
 * 「已发」记在本机 localStorage（只留近两天的键）；两台设备各提醒各的。
 */
import { addDays } from '../lib/derive/desk';
import { meetingRemindersDue, pruneSent, untilText, type MeetingDue } from '../lib/derive/meetings';
import { todayStr } from '../lib/date';
import { desktop } from '../lib/desktop';
import { useStore } from '../store/useStore';

const POLL_MS = 20_000;
const SENT_KEY = 'yearflow:meeting:sent';

function readSent(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SENT_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function writeSent(sent: Set<string>): void {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(pruneSent(sent, addDays(todayStr(), -1))));
  } catch {
    // 记不住最多是多提醒一次
  }
}

/** 通知文案（导出给自查脚本对照） */
export function meetingText(due: MeetingDue, now: number): { title: string; body: string } {
  const { item } = due;
  const when = untilText(due.start, now);
  return {
    title: `会议 · ${item.time} ${item.title}`,
    body: `${when}${item.note ? `\n${item.note.split('\n')[0]}` : ''}`,
  };
}

/** 网页版：没问过就问一次浏览器通知权限（必须在用户点击里调用） */
export function askWebNotifyPermission(): void {
  if (desktop() || typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') void Notification.requestPermission();
}

/** 一次判定（导出给自查脚本直接驱动）。返回这次提醒的会议 id */
export function tickMeetingNudge(now = Date.now()): string[] {
  const st = useStore.getState();
  if (!st.hydrated) return [];
  const sent = readSent();
  const due = meetingRemindersDue(Object.values(st.workItems), now, sent);
  if (!due.length) return [];
  for (const d of due) for (const k of d.keys) sent.add(k);
  writeSent(sent);

  const dk = desktop();
  for (const d of due) {
    const { title, body } = meetingText(d, now);
    // 同一会议的旧横幅换成新的（「提前 10 分钟」那条还没点掉，「准时」又来了）
    setAlerts([...alerts.filter((a) => a.itemId !== d.item.id), { key: d.keys[0], itemId: d.item.id, title, body }]);
    if (dk) {
      void dk.notify(body, { title, route: '/desk', sound: true });
      continue;
    }
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const n = new Notification(title, { body, tag: d.keys[0], requireInteraction: true });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      }
    } catch {
      // 有的浏览器（手机）不许页面直接 new Notification：页面里的横幅已经挂上了
    }
  }
  return due.map((d) => d.item.id);
}

// ── 页面内横幅（点「知道了」才收起）──
export interface MeetingAlert {
  key: string;
  itemId: string;
  title: string;
  body: string;
}
let alerts: MeetingAlert[] = [];
const alertListeners = new Set<(a: MeetingAlert[]) => void>();
function setAlerts(next: MeetingAlert[]): void {
  alerts = next;
  for (const l of alertListeners) l(alerts);
}
export function subscribeMeetingAlerts(l: (a: MeetingAlert[]) => void): () => void {
  alertListeners.add(l);
  l(alerts);
  return () => {
    alertListeners.delete(l);
  };
}
export function dismissMeetingAlert(key: string): void {
  setAlerts(alerts.filter((a) => a.key !== key));
}

let started = false;

export function initMeetingNudges(): void {
  if (started) return;
  started = true;
  setTimeout(() => tickMeetingNudge(), 3_000);
  setInterval(() => tickMeetingNudge(), POLL_MS);
  // 睡眠醒来 / 切回标签页：立刻补判一次
  desktop()?.onPowerResume(() => tickMeetingNudge());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tickMeetingNudge();
  });
}
