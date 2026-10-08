import { subscribeStorageSync, notifyStorageSync } from '@/lib/storage';

const RECENT_KEY = 'getools_recent_tools';
const FAVORITE_KEY = 'getools_favorite_tools';
const MAX_RECENT = 8;

export const subscribeToolPrefs = subscribeStorageSync;

function readRaw(key: string): string {
  if (typeof window === 'undefined') return '[]';
  try {
    return localStorage.getItem(key) || '[]';
  } catch {
    return '[]';
  }
}

/** Chuỗi JSON thô (ổn định giữa các lần gọi nếu không đổi) — dùng làm snapshot cho useSyncExternalStore. */
export const getRecentSnapshot = () => readRaw(RECENT_KEY);
export const getFavoriteSnapshot = () => readRaw(FAVORITE_KEY);
export const getServerToolPrefsSnapshot = () => '[]';

export function parseIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(key: string, ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* bỏ qua: bị chặn hoặc đầy bộ nhớ */
  }
  notifyStorageSync();
}

export function getRecentTools(): string[] {
  return parseIds(readRaw(RECENT_KEY));
}

export function getFavoriteTools(): string[] {
  return parseIds(readRaw(FAVORITE_KEY));
}

export function recordToolVisit(id: string) {
  const current = getRecentTools();
  if (current[0] === id) return;
  write(RECENT_KEY, [id, ...current.filter((x) => x !== id)].slice(0, MAX_RECENT));
}

export function isFavoriteTool(id: string): boolean {
  return getFavoriteTools().includes(id);
}

export function toggleFavoriteTool(id: string): boolean {
  const current = getFavoriteTools();
  const has = current.includes(id);
  write(FAVORITE_KEY, has ? current.filter((x) => x !== id) : [id, ...current]);
  return !has;
}
