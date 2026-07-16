/**
 * 按 key 分组，并逐组与上一轮结果比对：组内元素引用完全一致（长度 + 逐项 ===）
 * 时沿用旧数组引用。配合 store「写入只替换整表 map、未动实体保持引用」的特性，
 * 让下游 per-key 缓存只在真正变化的组上失效（SPEC §9：打卡写入只使相关目标缓存失效）。
 */
export function stableGroupBy<T>(
  items: Iterable<T>,
  keyOf: (item: T) => string,
  prev?: Map<string, T[]>,
): Map<string, T[]> {
  const next = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = next.get(key);
    if (group) group.push(item);
    else next.set(key, [item]);
  }
  if (prev) {
    for (const [key, group] of next) {
      const old = prev.get(key);
      if (old && old.length === group.length && old.every((v, i) => v === group[i])) {
        next.set(key, old);
      }
    }
  }
  return next;
}
