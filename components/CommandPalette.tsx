'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft } from 'lucide-react';
import { TOOL_CATEGORIES, type ToolDef } from '@/lib/tools';
import { useAiSettings } from '@/lib/use-ai-config';

interface Entry { tool: ToolDef; category: string; haystackName: string; haystackDesc: string; haystackKw: string }

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

const ENTRIES: Entry[] = TOOL_CATEGORIES.flatMap((c) =>
  c.items.map((tool) => ({
    tool,
    category: c.title,
    haystackName: norm(tool.name),
    haystackDesc: norm(tool.description),
    haystackKw: norm((tool.keywords ?? []).join(' ')),
  })),
);

function score(e: Entry, terms: string[]): number {
  let total = 0;
  for (const t of terms) {
    let s = 0;
    if (e.haystackName.startsWith(t)) s = 100;
    else if (e.haystackName.split(/[\s/&()-]+/).some((w) => w.startsWith(t))) s = 80;
    else if (e.haystackName.includes(t)) s = 60;
    else if (e.haystackKw.split(' ').some((w) => w.startsWith(t))) s = 50;
    else if (e.haystackKw.includes(t)) s = 35;
    else if (e.haystackDesc.includes(t)) s = 20;
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

export function CommandPalette() {
  const { isToolLocked } = useAiSettings();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const terms = norm(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return ENTRIES;
    return ENTRIES.map((e) => ({ e, s: score(e, terms) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.e);
  }, [query]);

  const openPalette = () => { setQuery(''); setActive(0); setOpen(true); };
  const close = () => setOpen(false);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        setOpen((o) => { if (!o) { setQuery(''); setActive(0); } return !o; });
        return;
      }
      if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const el = ev.target as HTMLElement | null;
        const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
        if (!typing) { ev.preventDefault(); openPalette(); }
      }
    };
    const onOpen = () => openPalette();
    window.addEventListener('keydown', onKey);
    window.addEventListener('getools:open-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('getools:open-palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const go = (t: ToolDef) => {
    close();
    router.push(t.href);
  };

  const onInputKey = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive((a) => (results.length ? (a + 1) % results.length : 0)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0)); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      const r = results[active];
      if (r) go(r.tool);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 backdrop-blur-sm px-3 pt-[12vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Tìm công cụ"
    >
      <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[70vh]">
        <div className="flex items-center gap-2 px-3 border-b border-slate-200">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Tìm công cụ... (tên, mô tả, từ khóa)"
            className="flex-1 h-12 bg-transparent outline-none text-sm text-slate-800 placeholder:text-slate-400"
            aria-label="Tìm công cụ"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:block text-[10px] text-slate-500 border border-slate-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {results.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            Không tìm thấy công cụ nào khớp với &ldquo;{query}&rdquo;.
          </div>
        ) : (
          <ul ref={listRef} className="overflow-y-auto p-1.5" role="listbox">
            {results.map((e, i) => {
              const Icon = e.tool.icon;
              const isActive = i === active;
              return (
                <li key={e.tool.id} role="option" aria-selected={isActive} data-active={isActive}>
                  <button
                    type="button"
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(e.tool)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${isToolLocked(e.tool) ? 'opacity-70' : ''} ${
                      isActive ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">
                        {e.tool.name}
                        {isToolLocked(e.tool) && (
                          <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Cần khóa AI</span>
                        )}
                      </span>
                      <span className="block text-xs text-slate-500 truncate">{e.tool.description}</span>
                    </span>
                    <span className="hidden sm:block shrink-0 text-[10px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 max-w-[9rem] truncate">{e.category}</span>
                    {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-3 px-3 py-2 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500">
          <span>↑↓ để chọn</span>
          <span>Enter để mở</span>
          <span>Esc để đóng</span>
        </div>
      </div>
    </div>
  );
}
