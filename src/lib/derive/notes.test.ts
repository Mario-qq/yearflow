import { describe, expect, it } from 'vitest';
import type { Note } from '../../types/domain';
import {
  checklistProgress,
  clampBody,
  expiredTrash,
  matchesQuery,
  NOTE_MAX_CHARS,
  noteRest,
  noteSections,
  noteTags,
  noteTitle,
  parseChecklist,
  segmentLine,
  tagCounts,
  toggleChecklistLine,
} from './notes';

const T = (d: number) => new Date(Date.UTC(2026, 9, d)).toISOString();
const note = (id: string, body: string, p: Partial<Note> = {}): Note => ({
  id,
  body,
  editedAt: T(1),
  createdAt: T(1),
  updatedAt: T(1),
  ...p,
});

describe('noteTitle / noteRest', () => {
  it('第一个非空行；去掉清单前缀与行首 #', () => {
    expect(noteTitle('\n\n  周会要点 \n内容')).toBe('周会要点');
    expect(noteTitle('- [ ] 买牛奶\n- [x] 面包')).toBe('买牛奶');
    expect(noteTitle('# 标题')).toBe('标题');
    expect(noteTitle('#SAP 学习')).toBe('#SAP 学习'); // 行首标签不是 markdown 标题
    expect(noteTitle('   \n ')).toBe('');
  });
  it('超长截断', () => {
    expect(noteTitle('字'.repeat(100))).toBe(`${'字'.repeat(80)}…`);
  });
  it('其余正文', () => {
    expect(noteRest('\n标题\n第二行\n第三行\n')).toBe('第二行\n第三行');
    expect(noteRest('只有一行')).toBe('');
  });
});

describe('标签', () => {
  it('行首或空白后的 #词；去重不分大小写；网址里的 # 不算', () => {
    expect(noteTags('#SAP 学习 #sap 和 #会议\nhttps://a.com/#x b#c')).toEqual(['SAP', '会议']);
  });
  it('tagCounts 不算回收站与已删', () => {
    const list = [
      note('a', '#x #y'),
      note('b', '#x'),
      note('c', '#y', { trashedAt: T(2) }),
      note('d', '#z', { deletedAt: T(2) }),
    ];
    expect(tagCounts(list)).toEqual([
      { tag: 'x', count: 2 },
      { tag: 'y', count: 1 },
    ]);
  });
});

describe('清单', () => {
  const body = '采购\n- [ ] 物料主数据\n  - [x] 收货 101\n* [X] 发票\n- 普通列表';
  it('解析行号 / 状态 / 文字', () => {
    expect(parseChecklist(body)).toEqual([
      { line: 1, done: false, text: '物料主数据' },
      { line: 2, done: true, text: '收货 101' },
      { line: 3, done: true, text: '发票' },
    ]);
    expect(checklistProgress(body)).toEqual({ done: 2, total: 3 });
    expect(checklistProgress('没有清单')).toBeNull();
  });
  it('切换只改那一行；不是清单原样返回', () => {
    expect(toggleChecklistLine(body, 1).split('\n')[1]).toBe('- [x] 物料主数据');
    expect(toggleChecklistLine(body, 2).split('\n')[2]).toBe('  - [ ] 收货 101');
    expect(toggleChecklistLine(body, 0)).toBe(body);
    expect(toggleChecklistLine(body, 99)).toBe(body);
  });
});

describe('segmentLine', () => {
  it('文字 / 标签 / 网址；网址去掉句末标点', () => {
    expect(segmentLine('看 https://sap.com/a#b。 #SAP')).toEqual([
      { kind: 'text', text: '看 ' },
      { kind: 'url', text: 'https://sap.com/a#b' },
      { kind: 'text', text: '。 ' },
      { kind: 'tag', text: '#SAP', tag: 'SAP' },
    ]);
    expect(segmentLine('')).toEqual([]);
  });
});

describe('搜索', () => {
  const n = note('a', '供应商联系人 张工\n#会议 #SAP');
  it('多词全满足、不分大小写', () => {
    expect(matchesQuery(n, '张工 供应商')).toBe(true);
    expect(matchesQuery(n, '张工 李经理')).toBe(false);
    expect(matchesQuery(n, '  ')).toBe(true);
  });
  it('#词按标签精确匹配', () => {
    expect(matchesQuery(n, '#sap')).toBe(true);
    expect(matchesQuery(n, '#SA')).toBe(false);
    expect(matchesQuery(n, '#会议 张工')).toBe(true);
  });
});

describe('noteSections', () => {
  const list = [
    note('old', 'a', { editedAt: T(1) }),
    note('new', 'b', { editedAt: T(5) }),
    note('pin1', 'c', { pinnedAt: T(2) }),
    note('pin2', 'd', { pinnedAt: T(3) }),
    note('arc', 'e', { archivedAt: T(2), pinnedAt: T(4) }),
    note('tr1', 'f', { trashedAt: T(2) }),
    note('tr2', 'g', { trashedAt: T(6) }),
    note('gone', 'h', { deletedAt: T(2) }),
  ];
  it('active：置顶按置顶时刻倒序，其余按 editedAt 倒序', () => {
    const s = noteSections(list, 'active', '');
    expect(s.pinned.map((n) => n.id)).toEqual(['pin2', 'pin1']);
    expect(s.recent.map((n) => n.id)).toEqual(['new', 'old']);
    expect(s.counts).toEqual({ active: 4, archive: 1, trash: 2 });
  });
  it('归档视图里置顶不单列；回收站按进回收站时刻倒序', () => {
    expect(noteSections(list, 'archive', '').recent.map((n) => n.id)).toEqual(['arc']);
    expect(noteSections(list, 'trash', '').recent.map((n) => n.id)).toEqual(['tr2', 'tr1']);
  });
  it('搜索只影响列表、不影响计数', () => {
    const s = noteSections(list, 'active', 'b');
    expect(s.recent.map((n) => n.id)).toEqual(['new']);
    expect(s.counts.active).toBe(4);
  });
});

describe('回收站过期 / 截断', () => {
  it('满 30 天才过期', () => {
    const now = new Date(Date.UTC(2026, 10, 30));
    const list = [
      note('a', 'x', { trashedAt: new Date(Date.UTC(2026, 9, 30)).toISOString() }), // 31 天
      note('b', 'x', { trashedAt: new Date(Date.UTC(2026, 10, 2)).toISOString() }), // 28 天
      note('c', 'x'),
    ];
    expect(expiredTrash(list, now).map((n) => n.id)).toEqual(['a']);
  });
  it('超长截断', () => {
    expect(clampBody('a'.repeat(NOTE_MAX_CHARS + 5))).toEqual({ body: 'a'.repeat(NOTE_MAX_CHARS), clipped: true });
    expect(clampBody('ok')).toEqual({ body: 'ok', clipped: false });
  });
});
