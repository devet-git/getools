// Bốc thăm, chia nhóm ngẫu nhiên. Dùng bộ ngẫu nhiên mật mã của trình duyệt, chọn đều không thiên lệch.
import { randomInt } from '@/lib/encoders';

export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Mỗi dòng một mục; bỏ dòng trống, cắt khoảng trắng. */
export const parseItems = (text: string): string[] => text.split('\n').map((s) => s.trim()).filter(Boolean);

export function pick<T>(items: readonly T[], n: number): T[] {
  return shuffle(items).slice(0, Math.max(0, Math.min(n, items.length)));
}

/** Chia đều vào `groups` nhóm (nhóm đầu nhận phần dư). */
export function splitGroups<T>(items: readonly T[], groups: number): T[][] {
  const g = Math.max(1, Math.min(Math.floor(groups) || 1, items.length || 1));
  const out: T[][] = Array.from({ length: g }, () => []);
  shuffle(items).forEach((it, i) => out[i % g].push(it));
  return out;
}

/** Số nguyên ngẫu nhiên trong [lo, hi] (gồm cả hai đầu). */
export function randomBetween(lo: number, hi: number): number {
  const span = hi - lo + 1;
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || span < 1 || span > 0x100000000) throw new Error('Khoảng không hợp lệ (tối đa ~4,29 tỷ số).');
  return lo + randomInt(span);
}
