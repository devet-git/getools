'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Search, Star, Keyboard, Clock, KeyRound, Sparkles, ClipboardPaste } from 'lucide-react';
import { useAiSettings } from '@/lib/use-ai-config';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { ALL_TOOLS, TOOL_CATEGORIES, type ToolDef } from '@/lib/tools';
import {
  subscribeToolPrefs, getRecentSnapshot, getFavoriteSnapshot, getServerToolPrefsSnapshot,
  parseIds, toggleFavoriteTool,
} from '@/lib/recent-tools';

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function matches(tool: ToolDef, q: string): boolean {
  if (!q) return true;
  const hay = normalize([tool.name, tool.description, ...(tool.keywords ?? [])].join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
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

function Grid({ tools, favorites }: { tools: ToolDef[]; favorites: Set<string> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} favorite={favorites.has(t.id)} />
      ))}
    </div>
  );
}

export default function HomePage() {
  const [query, setQuery] = useState('');
  const recentRaw = useSyncExternalStore(subscribeToolPrefs, getRecentSnapshot, getServerToolPrefsSnapshot);
  const favoriteRaw = useSyncExternalStore(subscribeToolPrefs, getFavoriteSnapshot, getServerToolPrefsSnapshot);

  const favoriteIds = useMemo(() => parseIds(favoriteRaw), [favoriteRaw]);
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const byId = useMemo(() => new Map(ALL_TOOLS.map((t) => [t.id, t])), []);
  const favoriteTools = useMemo(
    () => favoriteIds.map((id) => byId.get(id)).filter((t): t is ToolDef => !!t),
    [favoriteIds, byId],
  );
  const recentTools = useMemo(
    () => parseIds(recentRaw).map((id) => byId.get(id)).filter((t): t is ToolDef => !!t),
    [recentRaw, byId],
  );

  const q = normalize(query.trim());
  const searching = q.length > 0;
  const filteredCategories = useMemo(
    () => TOOL_CATEGORIES.map((c) => ({ ...c, items: c.items.filter((t) => matches(t, q)) })).filter((c) => c.items.length > 0),
    [q],
  );

  const openPalette = () => window.dispatchEvent(new CustomEvent('getools:open-palette'));

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <section className="flex flex-col items-center gap-3 rounded-2xl bg-slate-900 px-4 py-8 text-center text-white sm:py-10">
        <Logo className="h-16 w-16" />
        <h1 className="text-3xl font-bold tracking-tight">GeTools</h1>
        <p className="max-w-xl text-sm text-slate-300">
          Bộ công cụ chạy ngay trên trình duyệt: tải mã nguồn Git, xử lý văn bản và dữ liệu, ảnh, PDF, AI và nhiều tiện ích khác.
        </p>
        <div className="mt-2 w-full max-w-lg">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm công cụ theo tên, mô tả hoặc từ khóa..."
              aria-label="Tìm công cụ"
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('getools:open-smart-paste'))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              Dán thông minh — tự nhận diện &amp; mở đúng công cụ
            </button>
            <button
              type="button"
              onClick={openPalette}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <Keyboard className="h-3.5 w-3.5" />
              Nhấn Ctrl+K để tìm nhanh
            </button>
          </div>
        </div>
      </section>

      {!searching && (
        <>
          <section aria-labelledby="fav-title">
            <h2 id="fav-title" className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
              <Star className="h-4 w-4 text-amber-500" /> Yêu thích
            </h2>
            {favoriteTools.length > 0 ? (
              <Grid tools={favoriteTools} favorites={favorites} />
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                Chưa có công cụ yêu thích. Bấm biểu tượng ngôi sao trên một công cụ để ghim lên đây.
              </p>
            )}
          </section>

          <section aria-labelledby="recent-title">
            <h2 id="recent-title" className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
              <Clock className="h-4 w-4 text-indigo-500" /> Dùng gần đây
            </h2>
            {recentTools.length > 0 ? (
              <Grid tools={recentTools} favorites={favorites} />
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                Bạn chưa mở công cụ nào. Các công cụ vừa dùng sẽ xuất hiện ở đây.
              </p>
            )}
          </section>
        </>
      )}

      {filteredCategories.length > 0 ? (
        filteredCategories.map((cat) => (
          <section key={cat.title} aria-label={cat.title}>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">{cat.title}</h2>
            <Grid tools={cat.items} favorites={favorites} />
          </section>
        ))
      ) : (
        <p role="status" className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Không tìm thấy công cụ nào khớp với &ldquo;{query.trim()}&rdquo;. Hãy thử từ khóa khác.
        </p>
      )}
    </div>
  );
}
