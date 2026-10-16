/**
 * 桌面壳发来的导航类事件（只在桌面版有效，网页版 desktop() 为 null 什么也不做）：
 * 点系统通知 → 跳到对应页面；托盘菜单「开始学习」→ 起学习番茄钟。要放在 BrowserRouter 里面才拿得到 navigate。
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { desktop } from '../lib/desktop';
import { todayStr } from '../lib/date';
import { startStudy, studyNow } from '../desk/study';
import { showToast } from '../lib/toast';

export function DesktopBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const d = desktop();
    if (!d) return;
    const offNav = d.onNavigate((route) => navigate(route));
    const offStudy = d.onTrayStudy(() => {
      const today = todayStr();
      if (studyNow(today).running) showToast('正在学，结束后再开下一段');
      else startStudy(today);
    });
    return () => {
      offNav();
      offStudy();
    };
  }, [navigate]);
  return null;
}
