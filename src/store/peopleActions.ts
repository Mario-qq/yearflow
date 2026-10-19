/**
 * 人际写操作入口（UI 只调这里）：每个函数算 Change[] → execute 进 undo 栈。
 */
import { nanoid } from 'nanoid';
import type { GiftIdea, Interaction, InteractionKind, Person, Relation } from '../types/domain';
import { dateTitle, prepDue, prepItems, prepKey } from '../lib/derive/people';
import type { Change } from './types';
import { useStore } from './useStore';

const nowIso = () => new Date().toISOString();

export function personByName(name: string): Person | undefined {
  const n = name.trim();
  return Object.values(useStore.getState().people).find((p) => p.name === n);
}

/** 建档；同名已有就直接返回那一份 */
export function createPerson(name: string, relation: Relation = 'friend'): string {
  const n = name.trim();
  const hit = personByName(n);
  if (hit) return hit.id;
  const stamp = nowIso();
  const p: Person = { id: nanoid(), name: n, relation, order: Date.now(), createdAt: stamp, updatedAt: stamp };
  useStore.getState().execute(`建档「${n}」`, [{ table: 'people', type: 'put', after: p }]);
  return p.id;
}

/**
 * 改档案。改名时把 TA 名下没做完的 @人 跟进一起改名（同一条撤销）—— 跟进按名字挂到档案上。
 * 空串字段落库时删掉。返回 false = 名字和别人重了，没保存。
 */
export function patchPerson(id: string, patch: Partial<Omit<Person, 'id' | 'createdAt'>>, label?: string): boolean {
  const st = useStore.getState();
  const before = st.people[id];
  if (!before) return false;
  const next: Person = { ...before, ...patch, updatedAt: nowIso() };
  next.name = next.name.trim();
  if (!next.name) return false;
  if (next.name !== before.name && Object.values(st.people).some((p) => p.id !== id && p.name === next.name)) return false;
  for (const k of ['likes', 'dislikes', 'notes'] as const) if (!next[k]?.trim()) delete next[k];
  if (!next.cadenceDays) delete next.cadenceDays;
  if (!next.loveLanguages?.length) delete next.loveLanguages;
  if (!next.dates?.length) delete next.dates;
  if (!next.ideas?.length) delete next.ideas;
  const changes: Change[] = [{ table: 'people', type: 'put', before, after: next }];
  if (next.name !== before.name) {
    for (const w of Object.values(st.workItems)) {
      if (w.person === before.name && w.status === 'open') changes.push({ table: 'workItems', type: 'put', before: w, after: { ...w, person: next.name, updatedAt: nowIso() } });
    }
  }
  st.execute(label ?? `修改「${next.name}」的档案`, changes);
  return true;
}

/** 删档案（连同互动记录；@人 跟进不动） */
export function deletePerson(id: string): void {
  const st = useStore.getState();
  const before = st.people[id];
  if (!before) return;
  const changes: Change[] = [{ table: 'people', type: 'delete', before }];
  for (const i of Object.values(st.interactions)) if (i.personId === id) changes.push({ table: 'interactions', type: 'delete', before: i });
  st.execute(`删除「${before.name}」的档案`, changes);
}

export interface InteractionInput {
  personId: string;
  date: string;
  kind: InteractionKind;
  note?: string;
  learned?: string;
}

export function logInteraction(input: InteractionInput): string {
  const st = useStore.getState();
  const p = st.people[input.personId];
  const stamp = nowIso();
  const it: Interaction = {
    id: nanoid(),
    personId: input.personId,
    date: input.date,
    kind: input.kind,
    createdAt: stamp,
    updatedAt: stamp,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.learned?.trim() ? { learned: input.learned.trim() } : {}),
  };
  st.execute(`记一笔：和「${p?.name ?? ''}」`, [{ table: 'interactions', type: 'put', after: it }]);
  return it.id;
}

export function deleteInteraction(id: string): void {
  const before = useStore.getState().interactions[id];
  if (before) useStore.getState().execute('删除一条互动记录', [{ table: 'interactions', type: 'delete', before }]);
}

export function addIdea(personId: string, text: string, today: string): void {
  const p = useStore.getState().people[personId];
  if (!p || !text.trim()) return;
  const idea: GiftIdea = { id: nanoid(8), text: text.trim(), at: today };
  patchPerson(personId, { ideas: [...(p.ideas ?? []), idea] }, `记下给「${p.name}」的点子`);
}

export function toggleIdeaUsed(personId: string, ideaId: string, today: string): void {
  const p = useStore.getState().people[personId];
  if (!p) return;
  const ideas = (p.ideas ?? []).map((i) => {
    if (i.id !== ideaId) return i;
    if (i.used) {
      const { used: _u, ...rest } = i;
      return rest;
    }
    return { ...i, used: today };
  });
  patchPerson(personId, { ideas }, '标记点子');
}

export function removeIdea(personId: string, ideaId: string): void {
  const p = useStore.getState().people[personId];
  if (p) patchPerson(personId, { ideas: (p.ideas ?? []).filter((i) => i.id !== ideaId) }, '删掉一个点子');
}

/**
 * 本次打开已经生成过的那几次（prepKey）。档案上的 prepared 是跨设备的记录，这里再兜一层：
 * 内存被旧数据盖回去时（开发模式 StrictMode 下 hydrate 跑两次；同步拉回一份还没带 prepared 的旧档案）
 * 不会再生成一遍 —— 否则用户刚删掉的准备待办会按同一个 id 复活。
 */
const generatedThisSession = new Set<string>();

/**
 * 进了 14 天窗口的重要日子：倒推生成准备待办，并在档案上记下「这次已生成」（删掉待办也不会再生成）。
 * 工作台 / 人际页打开时、跨午夜时调用。返回生成了几件（UI 出提示）。
 */
export function generatePreps(today: string): { count: number; titles: string[] } {
  const st = useStore.getState();
  const due = prepDue(Object.values(st.people), today).filter((u) => !generatedThisSession.has(`${u.person.id}:${prepKey(u)}`));
  if (!due.length) return { count: 0, titles: [] };
  const stamp = nowIso();
  const changes: Change[] = [];
  const titles: string[] = [];
  const touched = new Map<string, Person>();
  for (const u of due) {
    for (const item of prepItems(u, today, stamp)) {
      // 确定的 id：另一台设备已经生成过就不重复写
      if (!st.workItems[item.id]) changes.push({ table: 'workItems', type: 'put', after: item });
    }
    const p = touched.get(u.person.id) ?? u.person;
    touched.set(u.person.id, { ...p, prepared: [...(p.prepared ?? []), prepKey(u)].slice(-20), updatedAt: stamp });
    titles.push(dateTitle(u));
    generatedThisSession.add(`${u.person.id}:${prepKey(u)}`);
  }
  for (const [id, after] of touched) changes.push({ table: 'people', type: 'put', before: st.people[id], after });
  const count = changes.filter((c) => c.table === 'workItems').length;
  st.execute(`为${titles.join('、')}排了准备`, changes);
  return { count, titles };
}
