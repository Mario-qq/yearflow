/**
 * 复盘笔记（markdown 纯文本）+ 1-5 星自评，防抖 800ms 自动保存（SPEC 第七节）。
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { saveReview } from '../store/actions';

interface Props {
  month: string; // YYYY-MM
}

export function NotesEditor({ month }: Props) {
  const reviews = useStore((s) => s.reviews);
  const review = Object.values(reviews).find((r) => !r.deletedAt && r.month === month);
  const [content, setContent] = useState(review?.content ?? '');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const monthRef = useRef(month);

  // 切月：先冲掉上月未保存内容，再载入本月
  useEffect(() => {
    setContent(review?.content ?? '');
    setSavedAt(null);
    monthRef.current = month;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const scheduleSave = (next: string) => {
    setContent(next);
    clearTimeout(timer.current);
    const forMonth = monthRef.current;
    timer.current = setTimeout(() => {
      saveReview(forMonth, { content: next });
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    }, 800);
  };

  const setRating = (rating: number) => {
    saveReview(month, {
      content: review?.content ?? content,
      rating: review?.rating === rating ? undefined : rating,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>本月自评</span>
        <div className="flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              className="cursor-pointer px-0.5"
              style={{
                fontSize: 'var(--font-16)',
                color: (review?.rating ?? 0) >= n ? 'var(--warning)' : 'var(--border-strong)',
                lineHeight: 1,
              }}
              title={`评 ${n} 星`}
            >
              ★
            </button>
          ))}
        </div>
        {savedAt && (
          <span className="tnum ml-auto" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
            已保存 {savedAt}
          </span>
        )}
      </div>
      <textarea
        value={content}
        onChange={(e) => scheduleSave(e.target.value)}
        placeholder="写下本月复盘…（支持 markdown 文本）"
        rows={6}
        className="w-full resize-y p-3 outline-none"
        style={{
          fontSize: 'var(--font-13)',
          lineHeight: 1.6,
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          background: 'transparent',
          color: 'var(--text-primary)',
          fontFamily: 'inherit',
        }}
      />
    </div>
  );
}
