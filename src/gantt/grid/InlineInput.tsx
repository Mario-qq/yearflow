/** 行内编辑输入框：挂载即聚焦全选，Enter/blur 提交，Esc 取消（SPEC 4.3 行内编辑） */
import { useEffect, useRef } from 'react';

interface Props {
  defaultValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  /** 数字模式（进度列）：右对齐 + inputMode numeric */
  numeric?: boolean;
  width?: number | string;
}

export function InlineInput({ defaultValue, onCommit, onCancel, numeric, width }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false); // Enter 提交后 blur 不重复提交

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(ref.current?.value ?? '');
  };
  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      defaultValue={defaultValue}
      inputMode={numeric ? 'numeric' : undefined}
      className="tnum min-w-0"
      style={{
        width: width ?? '100%',
        fontSize: 'var(--font-12)',
        color: 'var(--text-primary)',
        background: 'var(--bg-raised)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-sm)',
        padding: '1px 5px',
        outline: 'none',
        textAlign: numeric ? 'right' : 'left',
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') cancel();
        e.stopPropagation(); // 编辑期间不触发甘特快捷键
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
