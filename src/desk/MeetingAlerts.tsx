/** 会议提醒横幅：顶部居中，点「知道了」才收起（桌面版同时发系统通知，网页版同时发浏览器通知） */
import { useEffect, useState } from 'react';
import './meetingAlerts.css';
import { dismissMeetingAlert, subscribeMeetingAlerts, type MeetingAlert } from './meetingNudge';

export function MeetingAlerts() {
  const [items, setItems] = useState<MeetingAlert[]>([]);
  useEffect(() => subscribeMeetingAlerts(setItems), []);
  if (!items.length) return null;
  return (
    <div className="mt-alerts" role="alert" aria-live="assertive">
      {items.map((a) => (
        <div key={a.key} className="mt-alert glass-float float-in">
          <svg className="mt-alert-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8Z" />
            <path d="M6.5 14a1.6 1.6 0 0 0 3 0" />
          </svg>
          <div className="mt-alert-b">
            <div className="mt-alert-t">{a.title}</div>
            <div className="mt-alert-d tnum">{a.body}</div>
          </div>
          <button type="button" className="mt-alert-x" onClick={() => dismissMeetingAlert(a.key)}>
            知道了
          </button>
        </div>
      ))}
    </div>
  );
}
