'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Star, KeyRound, Sparkles } from 'lucide-react';
import { useAiSettings } from '@/lib/use-ai-config';
import { cn } from '@/lib/utils';
import type { ToolDef } from '@/lib/tools';
import { subscribeToolPrefs, getFavoriteSnapshot, getServerToolPrefsSnapshot, parseIds, toggleFavoriteTool } from '@/lib/recent-tools';

/** Danh sách id tool yêu thích (theo thứ tự ghim), tự cập nhật khi localStorage đổi. */
export function useFavoriteToolIds(): string[] {
  const raw = useSyncExternalStore(subscribeToolPrefs, getFavoriteSnapshot, getServerToolPrefsSnapshot);
  return useMemo(() => parseIds(raw), [raw]);
}

function ToolCard({ tool, favorite }: { tool: ToolDef; favorite: boolean }) {
  const Icon = tool.icon;
  const { isToolLocked } = useAiSettings();
  const locked = isToolLocked(tool);
  return (
    <div className={cn('group relative rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-300 hover:shadow-md focus-within:ring-2 focus-within:ring-indigo-500', locked && 'opacity-60')}>
      <Link
        href={tool.href}
        className="flex h-full items-start gap-3 rounded-xl p-4 pr-11 outline-none"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-800">{tool.name}</span>
            {locked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                <KeyRound className="h-2.5 w-2.5" /> Cần khóa AI
              </span>
            )}
            {tool.aiEnhanced && (
              <span
                title="Dùng được miễn phí; thêm khóa AI để mở thêm tính năng nâng cao"
                className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700"
              >
                <Sparkles className="h-2.5 w-2.5" /> +AI
              </span>
            )}
            {!locked && tool.badge && (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                {tool.badge}
              </span>
            )}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-slate-500">{tool.description}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => toggleFavoriteTool(tool.id)}
        aria-pressed={favorite}
        aria-label={favorite ? `Bỏ yêu thích ${tool.name}` : `Thêm ${tool.name} vào yêu thích`}
        title={favorite ? 'Bỏ yêu thích' : 'Thêm vào yêu thích'}
        className="absolute right-2 top-2 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Star className={cn('h-4 w-4', favorite && 'fill-amber-400 text-amber-500')} />
      </button>
    </div>
  );
}

/** Lưới thẻ tool có nút ghim yêu thích — dùng ở trang chủ và trang tổng quan nhóm. */
export function ToolGrid({ tools }: { tools: ToolDef[] }) {
  const favoriteIds = useFavoriteToolIds();
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} favorite={favorites.has(t.id)} />
      ))}
    </div>
  );
}
