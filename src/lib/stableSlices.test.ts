import { describe, expect, it } from 'vitest';
import { stableGroupBy } from './stableSlices';

interface Item {
  id: string;
  goalId: string;
}

const byGoal = (i: Item) => i.goalId;

describe('stableGroupBy 稳定分组', () => {
  it('按 key 分组', () => {
    const a = { id: 'a', goalId: 'g1' };
    const b = { id: 'b', goalId: 'g2' };
    const c = { id: 'c', goalId: 'g1' };
    const map = stableGroupBy([a, b, c], byGoal);
    expect(map.get('g1')).toEqual([a, c]);
    expect(map.get('g2')).toEqual([b]);
  });

  it('内容未变的组沿用旧数组引用', () => {
    const a = { id: 'a', goalId: 'g1' };
    const b = { id: 'b', goalId: 'g2' };
    const prev = stableGroupBy([a, b], byGoal);
    const next = stableGroupBy([a, b], byGoal, prev);
    expect(next.get('g1')).toBe(prev.get('g1'));
    expect(next.get('g2')).toBe(prev.get('g2'));
  });

  it('只有变化的组换新引用', () => {
    const a = { id: 'a', goalId: 'g1' };
    const b = { id: 'b', goalId: 'g2' };
    const prev = stableGroupBy([a, b], byGoal);
    const a2 = { ...a }; // 同内容新引用（模拟该实体被更新）
    const next = stableGroupBy([a2, b], byGoal, prev);
    expect(next.get('g1')).not.toBe(prev.get('g1'));
    expect(next.get('g2')).toBe(prev.get('g2'));
  });

  it('组新增/元素增减都视为变化，消失的组不保留', () => {
    const a = { id: 'a', goalId: 'g1' };
    const b = { id: 'b', goalId: 'g2' };
    const prev = stableGroupBy([a, b], byGoal);
    const c = { id: 'c', goalId: 'g1' };
    const next = stableGroupBy([a, c], byGoal, prev);
    expect(next.get('g1')).toEqual([a, c]);
    expect(next.get('g1')).not.toBe(prev.get('g1'));
    expect(next.has('g2')).toBe(false);
    const g3 = stableGroupBy([{ id: 'd', goalId: 'g3' }], byGoal, prev);
    expect(g3.get('g3')).toEqual([{ id: 'd', goalId: 'g3' }]);
  });
});
