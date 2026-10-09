'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Search, Star, Keyboard, Clock, ClipboardPaste, ChevronRight } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { ToolGrid, useFavoriteToolIds } from '@/components/ToolGrid';
import { cn, foldVietnamese } from '@/lib/utils';
import { getTool, TOOL_CATEGORIES, type ToolDef } from '@/lib/tools';
import {
  subscribeToolPrefs, getRecentSnapshot, getServerToolPrefsSnapshot,
  parseIds, getGeneralModeSnapshot, getServerGeneralModeSnapshot, setGeneralMode,
} from '@/lib/recent-tools';

/** id → tool, bỏ qua id không còn tồn tại (tool đã bị xóa) */
function toTools(ids: string[]): ToolDef[] {
  return ids.map(getTool).filter((t): t is ToolDef => !!t);
}

function matches(tool: ToolDef, q: string): boolean {
  if (!q) return true;
  const hay = foldVietnamese([tool.name, tool.description, ...(tool.keywords ?? [])].join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export default function HomePage() {
  const [query, setQuery] = useState('');
  const recentRaw = useSyncExternalStore(subscribeToolPrefs, getRecentSnapshot, getServerToolPrefsSnapshot);

  const generalMode = useSyncExternalStore(subscribeToolPrefs, getGeneralModeSnapshot, getServerGeneralModeSnapshot) === '1';

  const favoriteIds = useFavoriteToolIds();
  const favoriteTools = useMemo(() => toTools(favoriteIds), [favoriteIds]);
  const recentTools = useMemo(() => toTools(parseIds(recentRaw)), [recentRaw]);

  const q = foldVietnamese(query.trim());
  const searching = q.length > 0;
  const filteredCategories = useMemo(
    () => TOOL_CATEGORIES
      .filter((c) => !generalMode || c.general)
      .map((c) => ({ ...c, items: c.items.filter((t) => matches(t, q)) }))
      .filter((c) => c.items.length > 0),
    [q, generalMode],
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
              <ToolGrid tools={favoriteTools} />
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
              <ToolGrid tools={recentTools} />
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                Bạn chưa mở công cụ nào. Các công cụ vừa dùng sẽ xuất hiện ở đây.
              </p>
            )}
          </section>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
        <p className="text-xs text-slate-500">
          {generalMode ? 'Đang hiện các công cụ phổ thông (đời sống, văn phòng, file, ảnh, AI).' : 'Đang hiện tất cả công cụ, gồm cả nhóm dành cho lập trình viên.'}
        </p>
        <div role="group" aria-label="Chế độ hiển thị" className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs font-semibold">
          {([[false, 'Tất cả'], [true, 'Phổ thông']] as const).map(([v, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={generalMode === v}
              onClick={() => setGeneralMode(v)}
              className={cn('rounded-md px-3 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500', generalMode === v ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filteredCategories.length > 0 ? (
        filteredCategories.map((cat) => (
          <section key={cat.id} aria-label={cat.title}>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">
              <Link href={cat.href} className="inline-flex items-center gap-1 hover:text-indigo-600">
                {cat.title} <ChevronRight className="h-4 w-4" />
              </Link>
            </h2>
            <ToolGrid tools={cat.items} />
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
