'use client';

import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

export type ThemeMode = 'light' | 'dark' | 'system';
const KEY = 'getools_theme';
const ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const LABEL: Record<ThemeMode, string> = { light: 'Sáng', dark: 'Tối', system: 'Theo hệ thống' };

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* ignore */ }
  return 'system';
}

function applyMode(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const [mode, setMode] = useState<ThemeMode>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Đọc localStorage sau khi mount để tránh lệch hydration
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(readMode());
    setMounted(true);
  }, []);

  // Theo dõi thay đổi theme hệ thống khi đang ở chế độ "system"
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyMode('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const cycle = useCallback(() => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setMode(next);
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
    applyMode(next);
  }, [mode]);

  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;
  const title = `Giao diện: ${LABEL[mode]} (nhấn để đổi)`;

  return (
    <button
      type="button"
      onClick={cycle}
      title={title}
      aria-label={title}
      suppressHydrationWarning
      className={
        compact
          ? `flex items-center justify-center h-9 w-9 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors ${className}`
          : `flex items-center gap-2 h-9 px-3 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-colors ${className}`
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!compact && <span>{mounted ? LABEL[mode] : 'Giao diện'}</span>}
    </button>
  );
}
