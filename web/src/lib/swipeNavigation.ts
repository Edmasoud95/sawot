export function itemAfterSwipe<T extends string>(items: readonly T[], current: T, dx: number, dy: number, duration: number): T {
  if (duration > 700 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.5) return current;
  const index = items.indexOf(current);
  if (index < 0) return current;
  return items[Math.max(0, Math.min(items.length - 1, index + (dx < 0 ? 1 : -1)))];
}
