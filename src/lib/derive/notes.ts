/**
 * 便签派生（NOTES_SPEC §三）：标题、标签、清单、搜索、分区排序、回收站过期 —— 纯函数，不入库。
 */
import type { Note } from '../../types/domain';

/** 正文上限（字）。超出在写入时截断 */
export const NOTE_MAX_CHARS = 20000;
/** 标题最长（字） */
export const NOTE_TITLE_MAX = 80;
/** 回收站保留天数，过了就永久删除 */
export const NOTE_TRASH_DAYS = 30;

const CHECK_RE = /^(\s*)[-*] \[( |x|X)\] ?(.*)$/;
/** 行首或空白后的 #词；网址里的 #（前面不是空白）不算 */
const TAG_RE = /(^|\s)#([^\s#]+)/g;
/** 网址：http(s) 开头到空白为止；去掉句末常见标点 */
const URL_RE = /https?:\/\/[^\s]+/g;
const TRAIL_PUNCT = /[)\]}>,.;:!?，。；：！？、）】》」』]+$/;

/** 标题 = 第一个非空行，去掉清单前缀与行首 #，截 NOTE_TITLE_MAX 字 */
export function noteTitle(body: string): string {
  for (const raw of body.split('\n')) {
    const m = CHECK_RE.exec(raw);
    const line = (m ? m[3] : raw).replace(/^#+\s+/, '').trim();
    if (line) return line.length > NOTE_TITLE_MAX ? `${line.slice(0, NOTE_TITLE_MAX)}…` : line;
  }
  return '';
}

/** 标题行之后的正文（转待办时作备注） */
export function noteRest(body: string): string {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l.trim() !== '');
  return i < 0 ? '' : lines.slice(i + 1).join('\n').trim();
}

/** 正文里出现的标签（去重，保持首次出现的顺序与大小写） */
export function noteTags(body: string): string[] {
  const seen = new Map<string, string>();
  for (const m of body.matchAll(TAG_RE)) {
    const tag = m[2];
    const key = tag.toLowerCase();
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
}

export interface CheckLine {
  line: number; // 在 body.split('\n') 里的下标
  done: boolean;
  text: string;
}

export function parseChecklist(body: string): CheckLine[] {
  const out: CheckLine[] = [];
  body.split('\n').forEach((raw, line) => {
    const m = CHECK_RE.exec(raw);
    if (m) out.push({ line, done: m[2] !== ' ', text: m[3] });
  });
  return out;
}

/** 清单进度；没有清单返回 null */
export function checklistProgress(body: string): { done: number; total: number } | null {
  const list = parseChecklist(body);
  if (list.length === 0) return null;
  return { done: list.filter((c) => c.done).length, total: list.length };
}

/** 勾 / 取消勾第 line 行；那一行不是清单就原样返回 */
export function toggleChecklistLine(body: string, line: number): string {
  const lines = body.split('\n');
  const m = CHECK_RE.exec(lines[line] ?? '');
  if (!m) return body;
  const mark = m[2] === ' ' ? 'x' : ' ';
  lines[line] = lines[line].replace(/\[( |x|X)\]/, `[${mark}]`);
  return lines.join('\n');
}

export type NoteSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; text: string; tag: string }
  | { kind: 'url'; text: string };

/** 一行切成 文字 / 标签 / 网址 三种片段（预览渲染用） */
export function segmentLine(line: string): NoteSegment[] {
  type Hit = { start: number; end: number; seg: NoteSegment };
  const hits: Hit[] = [];
  for (const m of line.matchAll(URL_RE)) {
    const url = m[0].replace(TRAIL_PUNCT, '');
    hits.push({ start: m.index, end: m.index + url.length, seg: { kind: 'url', text: url } });
  }
  for (const m of line.matchAll(TAG_RE)) {
    const start = m.index + m[1].length;
    const end = start + 1 + m[2].length;
    if (hits.some((h) => start < h.end && end > h.start)) continue; // 网址里的 # 不算
    hits.push({ start, end, seg: { kind: 'tag', text: `#${m[2]}`, tag: m[2] } });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: NoteSegment[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) out.push({ kind: 'text', text: line.slice(at, h.start) });
    out.push(h.seg);
    at = h.end;
  }
  if (at < line.length) out.push({ kind: 'text', text: line.slice(at) });
  return out;
}

/**
 * 搜索：空白分词、全部满足才算命中；`#词` 按标签精确匹配（不分大小写），其余按正文子串（不分大小写）。
 */
export function matchesQuery(note: Note, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const body = note.body.toLowerCase();
  let tags: string[] | null = null;
  return terms.every((t) => {
    if (t.startsWith('#') && t.length > 1) {
      tags ??= noteTags(note.body).map((x) => x.toLowerCase());
      return tags.includes(t.slice(1));
    }
    return body.includes(t);
  });
}

export type NoteView = 'active' | 'archive' | 'trash';

export function viewOf(n: Note): NoteView {
  if (n.trashedAt) return 'trash';
  if (n.archivedAt) return 'archive';
  return 'active';
}

export interface NoteSections {
  pinned: Note[];
  recent: Note[];
  counts: Record<NoteView, number>;
}

/**
 * 面板分区：pinned（置顶时刻倒序，只在 active 视图）+ recent（editedAt 倒序；回收站按进回收站时刻倒序）。
 * counts 不受搜索影响（底部入口显示的是总数）。
 */
export function noteSections(notes: Note[], view: NoteView, query: string): NoteSections {
  const counts: Record<NoteView, number> = { active: 0, archive: 0, trash: 0 };
  const pinned: Note[] = [];
  const recent: Note[] = [];
  for (const n of notes) {
    if (n.deletedAt) continue;
    const v = viewOf(n);
    counts[v]++;
    if (v !== view || !matchesQuery(n, query)) continue;
    if (v === 'active' && n.pinnedAt) pinned.push(n);
    else recent.push(n);
  }
  pinned.sort((a, b) => (b.pinnedAt! > a.pinnedAt! ? 1 : b.pinnedAt! < a.pinnedAt! ? -1 : 0));
  const key = view === 'trash' ? (n: Note) => n.trashedAt! : (n: Note) => n.editedAt;
  recent.sort((a, b) => (key(b) > key(a) ? 1 : key(b) < key(a) ? -1 : 0));
  return { pinned, recent, counts };
}

/** 未进回收站的便签里各标签用了几次（次数倒序，同次数按名字） */
export function tagCounts(notes: Note[]): { tag: string; count: number }[] {
  const map = new Map<string, { tag: string; count: number }>();
  for (const n of notes) {
    if (n.deletedAt || n.trashedAt) continue;
    for (const t of noteTags(n.body)) {
      const k = t.toLowerCase();
      const hit = map.get(k);
      if (hit) hit.count++;
      else map.set(k, { tag: t, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));
}

/** 进回收站满 NOTE_TRASH_DAYS 天的（该永久删除了） */
export function expiredTrash(notes: Note[], now: Date): Note[] {
  const cutoff = new Date(now.getTime() - NOTE_TRASH_DAYS * 24 * 3600 * 1000).toISOString();
  return notes.filter((n) => !n.deletedAt && n.trashedAt && n.trashedAt < cutoff);
}

/** 截到上限；返回是否截过 */
export function clampBody(body: string): { body: string; clipped: boolean } {
  return body.length > NOTE_MAX_CHARS
    ? { body: body.slice(0, NOTE_MAX_CHARS), clipped: true }
    : { body, clipped: false };
}
