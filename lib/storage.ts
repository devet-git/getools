export interface HistoryItem {
  id: string;
  url: string;
  name: string;
  provider: 'github' | 'gitlab' | 'bitbucket';
  type: 'folder' | 'file' | 'repo' | 'release';
  timestamp: number;
  isBookmarked?: boolean;
  label?: string;
  repoName?: string;
  branch?: string;
  size?: string;
}

const HISTORY_STORAGE_KEY = 'git_downloader_history';
const BOOKMARKS_STORAGE_KEY = 'git_downloader_bookmarks';
export const STORAGE_SYNC_EVENT = 'git_downloader_storage_sync';

export function notifyStorageSync() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(STORAGE_SYNC_EVENT));
  }
}

export function subscribeStorageSync(callback: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener(STORAGE_SYNC_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(STORAGE_SYNC_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function getHistory(): HistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load history', e);
    return [];
  }
}

export function saveHistory(items: HistoryItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items.slice(0, 50))); // Keep up to 50 items
    notifyStorageSync();
  } catch (e) {
    console.error('Failed to save history', e);
  }
}

export function addHistoryItem(item: Omit<HistoryItem, 'id' | 'timestamp'>): HistoryItem {
  const history = getHistory();
  const existingIdx = history.findIndex(h => h.url === item.url);
  
  let isBookmarked = false;
  if (existingIdx !== -1) {
    isBookmarked = !!history[existingIdx].isBookmarked;
    history.splice(existingIdx, 1);
  } else {
    // Check if in bookmarks
    const bookmarks = getBookmarks();
    isBookmarked = bookmarks.some(b => b.url === item.url);
  }

  const newItem: HistoryItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
    isBookmarked,
  };

  history.unshift(newItem);
  saveHistory(history);
  return newItem;
}

export function removeHistoryItem(id: string): HistoryItem[] {
  const history = getHistory().filter(h => h.id !== id);
  saveHistory(history);
  return history;
}

export function clearHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
    notifyStorageSync();
  } catch (e) {
    console.error('Failed to clear history', e);
  }
}

export function getBookmarks(): HistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load bookmarks', e);
    return [];
  }
}

export function saveBookmarks(items: HistoryItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(items));
    notifyStorageSync();
  } catch (e) {
    console.error('Failed to save bookmarks', e);
  }
}

export function toggleBookmarkItem(item: HistoryItem): { isBookmarked: boolean; bookmarks: HistoryItem[] } {
  let bookmarks = getBookmarks();
  const history = getHistory();

  const existingIndex = bookmarks.findIndex(b => b.url === item.url);
  let isBookmarked = false;

  if (existingIndex !== -1) {
    // Remove from bookmarks
    bookmarks.splice(existingIndex, 1);
    isBookmarked = false;
  } else {
    // Add to bookmarks
    bookmarks.unshift({
      ...item,
      isBookmarked: true,
      timestamp: Date.now()
    });
    isBookmarked = true;
  }

  saveBookmarks(bookmarks);

  // Sync isBookmarked flag in history
  const updatedHistory = history.map(h => {
    if (h.url === item.url) {
      return { ...h, isBookmarked };
    }
    return h;
  });
  saveHistory(updatedHistory);

  return { isBookmarked, bookmarks };
}

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Vừa xong';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return new Date(timestamp).toLocaleDateString('vi-VN');
}
