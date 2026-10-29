import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../types/domain';

// 只测内存与撤销栈：落库是 persist 的事，这里换成空实现（node 环境没有 IndexedDB）
vi.mock('./persist', () => ({
  queuePersist: vi.fn(),
  queuePersistSettings: vi.fn(),
  flushNow: vi.fn(),
  repoByTable: {},
}));

// useStore 在 dev 下把自己挂到 window 上（验证脚本用）
vi.stubGlobal('window', {});

const { useStore } = await import('./useStore');
const A = await import('./noteActions');

const notes = () => Object.values(useStore.getState().notes);
const reset = () => useStore.setState({ notes: {}, workItems: {}, undoStack: [], redoStack: [] } as never);

describe('noteActions', () => {
  beforeEach(reset);

  it('一次编辑会话（同 mergeKey）里新建 + 多次保存 = 一条撤销；撤销后便签消失', () => {
    const id = A.createNote('', { mergeKey: 's1' })!;
    A.saveNoteBody(id, '周', '', 's1');
    A.saveNoteBody(id, '周会要点', '周', 's1');
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().notes[id].body).toBe('周会要点');
    useStore.getState().undo();
    expect(notes()).toHaveLength(0);
  });

  it('不同会话各一条撤销；中间夹了别的操作就不再合并', () => {
    const id = A.createNote('a')!;
    A.saveNoteBody(id, 'ab', 'a', 'k');
    A.setNoteColor(id, 'blue');
    A.saveNoteBody(id, 'abc', 'ab', 'k');
    expect(useStore.getState().undoStack).toHaveLength(4);
  });

  it('新建后又清空收起 ⇒ 和新建抵消，不留撤销', () => {
    const id = A.createNote('', { mergeKey: 's2' })!;
    expect(A.discardIfEmpty(id, 's2')).toBe(true);
    expect(notes()).toHaveLength(0);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('编辑期间库里那条被改了 ⇒ 你这版存进原便签，库里那版另存冲突副本', () => {
    const id = A.createNote('原文')!;
    const n = useStore.getState().notes[id];
    useStore.getState().applyRemote({ notes: { puts: [{ ...n, body: '别处改的' } as Note], deletes: [] } });
    const r = A.saveNoteBody(id, '我改的', '原文', 's3');
    expect(r.conflict).toBe(true);
    expect(useStore.getState().notes[id].body).toBe('我改的');
    const copy = notes().find((x) => x.conflictOf === id)!;
    expect(copy.body).toBe('别处改的');
    expect(copy.pinnedAt).toBeTruthy();
  });

  it('删除进回收站 → 恢复；永久删除只对回收站里的', () => {
    const id = A.createNote('x')!;
    expect(A.purgeNotes([id])).toBe(0);
    A.trashNote(id);
    expect(useStore.getState().notes[id].trashedAt).toBeTruthy();
    A.restoreNote(id);
    expect(useStore.getState().notes[id].trashedAt).toBeUndefined();
    A.trashNote(id);
    expect(A.emptyTrash()).toBe(1);
    expect(useStore.getState().notes[id]).toBeUndefined();
  });

  it('改颜色 / 置顶不动 editedAt', () => {
    const id = A.createNote('x')!;
    const edited = useStore.getState().notes[id].editedAt;
    A.setNoteColor(id, 'yellow');
    A.toggleNotePin(id);
    const n = useStore.getState().notes[id];
    expect(n).toMatchObject({ color: 'yellow', editedAt: edited });
    expect(n.pinnedAt).toBeTruthy();
    A.setNoteColor(id, null);
    expect(useStore.getState().notes[id].color).toBeUndefined();
  });

  it('归档顺手取消置顶', () => {
    const id = A.createNote('x')!;
    A.toggleNotePin(id);
    A.setNoteArchived(id, true);
    expect(useStore.getState().notes[id].archivedAt).toBeTruthy();
    expect(useStore.getState().notes[id].pinnedAt).toBeUndefined();
  });

  it('转待办：整条（标题 + 备注）/ 某一行清单；一条撤销撤回两边', () => {
    const id = A.createNote('采购跟进\n- [ ] 催张工报价\n背景说明')!;
    const w1 = A.convertNoteToTodo(id)!;
    expect(useStore.getState().workItems[w1]).toMatchObject({ title: '采购跟进', note: '- [ ] 催张工报价\n背景说明', status: 'open' });
    expect(useStore.getState().workItems[w1].date).toBeUndefined();
    const w2 = A.convertNoteToTodo(id, 1)!;
    expect(useStore.getState().workItems[w2].title).toBe('催张工报价');
    expect(useStore.getState().notes[id].convertedTo).toEqual([w1, w2]);
    useStore.getState().undo();
    expect(useStore.getState().workItems[w2]).toBeUndefined();
    expect(useStore.getState().notes[id].convertedTo).toEqual([w1]);
    expect(A.convertNoteToTodo(id, 0)).toBeNull(); // 第 0 行不是清单
  });

  it('勾选清单、仅本机切换', () => {
    const id = A.createNote('- [ ] a')!;
    A.toggleNoteCheck(id, 0);
    expect(useStore.getState().notes[id].body).toBe('- [x] a');
    A.setNoteLocalOnly(id, true);
    expect(useStore.getState().notes[id].localOnly).toBe(true);
    A.setNoteLocalOnly(id, false);
    expect(useStore.getState().notes[id].localOnly).toBeUndefined();
  });

  it('空正文不建', () => {
    expect(A.createNote('   ')).toBeNull();
  });
});
