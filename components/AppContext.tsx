'use client';

import { createContext, useContext, useState, useMemo, useSyncExternalStore } from 'react';
import { ApiKeys } from '@/lib/downloader';
import { subscribeStorageSync, notifyStorageSync } from '@/lib/storage';

interface AppContextType {
  keys: ApiKeys;
  updateKey: (provider: keyof ApiKeys, value: string) => void;
  bookmarksCount: number;
  historyCount: number;
  refreshStats: () => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isHistoryModalOpen: boolean;
  setIsHistoryModalOpen: (open: boolean) => void;
  historyModalTab: 'bookmarks' | 'history';
  setHistoryModalTab: (tab: 'bookmarks' | 'history') => void;
  copiedNotice: string | null;
  showToast: (msg: string) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapse: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

const emptyKeys: ApiKeys = {};
const emptyString = () => '';
const emptyArrayString = () => '[]';
const falseString = () => 'false';

function getKeysSnapshot(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem('git_downloader_keys') || '';
  } catch {
    return '';
  }
}

function getBookmarksSnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  try {
    return localStorage.getItem('git_downloader_bookmarks') || '[]';
  } catch {
    return '[]';
  }
}

function getHistorySnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  try {
    return localStorage.getItem('git_downloader_history') || '[]';
  } catch {
    return '[]';
  }
}

function getSidebarCollapseSnapshot(): string {
  if (typeof window === 'undefined') return 'false';
  try {
    return localStorage.getItem('git_downloader_sidebar_collapsed') || 'false';
  } catch {
    return 'false';
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const rawKeys = useSyncExternalStore(subscribeStorageSync, getKeysSnapshot, emptyString);
  const keys: ApiKeys = useMemo(() => {
    if (!rawKeys) return emptyKeys;
    try {
      return JSON.parse(rawKeys);
    } catch {
      return emptyKeys;
    }
  }, [rawKeys]);

  const rawBookmarks = useSyncExternalStore(subscribeStorageSync, getBookmarksSnapshot, emptyArrayString);
  const bookmarksCount = useMemo(() => {
    try {
      const parsed = JSON.parse(rawBookmarks);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }, [rawBookmarks]);

  const rawHistory = useSyncExternalStore(subscribeStorageSync, getHistorySnapshot, emptyArrayString);
  const historyCount = useMemo(() => {
    try {
      const parsed = JSON.parse(rawHistory);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }, [rawHistory]);

  const rawCollapsed = useSyncExternalStore(subscribeStorageSync, getSidebarCollapseSnapshot, falseString);
  const isSidebarCollapsed = rawCollapsed === 'true';

  const setIsSidebarCollapsed = (collapsed: boolean) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('git_downloader_sidebar_collapsed', String(collapsed));
      notifyStorageSync();
    }
  };

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [historyModalTab, setHistoryModalTab] = useState<'bookmarks' | 'history'>('bookmarks');
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);

  const refreshStats = () => {
    notifyStorageSync();
  };

  const updateKey = (provider: keyof ApiKeys, value: string) => {
    const updated = { ...keys, [provider]: value };
    if (typeof window !== 'undefined') {
      localStorage.setItem('git_downloader_keys', JSON.stringify(updated));
      notifyStorageSync();
    }
  };

  const showToast = (msg: string) => {
    setCopiedNotice(msg);
    setTimeout(() => {
      setCopiedNotice(null);
    }, 3000);
  };

  return (
    <AppContext.Provider
      value={{
        keys,
        updateKey,
        bookmarksCount,
        historyCount,
        refreshStats,
        isSettingsOpen,
        setIsSettingsOpen,
        isHistoryModalOpen,
        setIsHistoryModalOpen,
        historyModalTab,
        setHistoryModalTab,
        copiedNotice,
        showToast,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        toggleSidebarCollapse,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}
