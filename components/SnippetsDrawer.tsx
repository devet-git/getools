'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { X, Search, Pin, PinOff, Pencil, Trash2, Copy, ExternalLink, Bookmark, History, Check, ArrowUpFromLine } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { getTool } from '@/lib/tools';
import { setHandoff, MAX_HANDOFF_CHARS } from '@/lib/handoff';
import { formatTimeAgo } from '@/lib/storage';
import {
  getSnippetsSnapshot, getServerSnippetsSnapshot, subscribeSnippets, parseSnippets,
  renameSnippet, togglePin, removeSnippet, clearHistory, promoteHistory, type Snippet,
} from '@/lib/snippets';

export const OPEN_SNIPPETS_EVENT = 'getools:open-snippets';

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

export function SnippetsDrawer() {
  const router = useRouter();
  const { showToast } = useApp();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'saved' | 'history'>('saved');
  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  const raw = useSyncExternalStore(subscribeSnippets, getSnippetsSnapshot, getServerSnippetsSnapshot);
  const all = useMemo(() => parseSnippets(raw), [raw]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const t = (e as CustomEvent<{ tab?: 'saved' | 'history' }>).detail?.tab;
      prevFocus.current = document.activeElement as HTMLElement | null;
      if (t === 'saved' || t === 'history') setTab(t);
      setOpen(true);
    };
    window.addEventListener(OPEN_SNIPPETS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SNIPPETS_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setEditId(null);
    prevFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const t = setTimeout(() => panelRef.current?.querySelector<HTMLElement>('input')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey, true); clearTimeout(t); };
  }, [open, close]);

  const items = useMemo(() => {
    const q = fold(query.trim());
    return all
      .filter((i) => i.kind === tab)
      .filter((i) => !q || fold(i.title).includes(q) || fold(i.text.slice(0, 20000)).includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [all, tab, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Snippet[]>();
    for (const i of items) {
      const arr = map.get(i.toolId) || [];
      arr.push(i);
      map.set(i.toolId, arr);
    }
    return [...map.entries()];
  }, [items]);

  const counts = useMemo(() => ({
    saved: all.filter((i) => i.kind === 'saved').length,
    history: all.filter((i) => i.kind === 'history').length,
  }), [all]);

  const report = (r: { ok: boolean; error?: string }) => { if (!r.ok && r.error) showToast(r.error); };

  const copy = async (s: Snippet) => {
    try { await navigator.clipboard.writeText(s.text); showToast('Đã sao chép!'); }
    catch { showToast('Lỗi khi sao chép vào bộ nhớ tạm.'); }
  };

  const openInTool = (s: Snippet) => {
    const tool = getTool(s.toolId);
    if (!tool) { showToast('Công cụ này không còn tồn tại.'); return; }
    if (s.text.length > MAX_HANDOFF_CHARS || !setHandoff({ toolId: tool.id, text: s.text, source: 'Snippet' })) {
      showToast('Nội dung quá lớn để mở trong công cụ.');
      return;
    }
    setOpen(false);
    router.push(tool.href);
  };

  const commitRename = () => {
    if (editId) report(renameSnippet(editId, editTitle));
    setEditId(null);
  };

  if (!open) return null;

  const btn = 'p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition';

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-slate-900/40" onClick={close} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Snippet và lịch sử"
        className="absolute right-0 top-0 h-full w-full max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
          <div className="flex items-center gap-2 font-bold text-sm"><Bookmark className="h-4 w-4" /> Snippet &amp; Lịch sử</div>
          <button type="button" onClick={close} aria-label="Đóng" className="p-1 rounded-lg hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-4 pt-3 space-y-2.5">
          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg" role="tablist">
            {([['saved', 'Đã lưu', Bookmark], ['history', 'Lịch sử', History]] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition ${tab === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <Icon className="h-3.5 w-3.5" /> {label} ({counts[k]})
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tiêu đề hoặc nội dung…"
              aria-label="Tìm snippet"
              className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {tab === 'history' && counts.history > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { if (window.confirm('Xóa toàn bộ lịch sử? Snippet đã lưu sẽ được giữ nguyên.')) report(clearHistory()); }}
                className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" /> Xóa lịch sử
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {groups.length === 0 && (
            <div className="text-center text-xs text-slate-500 py-12 px-4">
              {query.trim()
                ? 'Không tìm thấy mục nào khớp với từ khóa.'
                : tab === 'saved'
                  ? 'Chưa có snippet nào. Dùng nút “Gửi tới… → Lưu vào Snippet” ở các công cụ để lưu kết quả.'
                  : 'Lịch sử trống. Kết quả bạn gửi sang công cụ khác sẽ được ghi lại ở đây.'}
            </div>
          )}
          {groups.map(([toolId, list]) => {
            const tool = getTool(toolId);
            const Icon = tool?.icon;
            return (
              <section key={toolId} aria-label={tool?.name || toolId}>
                <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
                  {Icon && <Icon className="h-3.5 w-3.5" />} {tool?.name || toolId}
                </h3>
                <ul className="space-y-2">
                  {list.map((s) => (
                    <li key={s.id} className="border border-slate-200 rounded-xl p-2.5 bg-white">
                      <div className="flex items-start gap-1.5">
                        {editId === s.id ? (
                          <input
                            autoFocus
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') { e.stopPropagation(); setEditId(null); }
                            }}
                            maxLength={120}
                            aria-label="Tiêu đề mới"
                            className="flex-1 min-w-0 px-1.5 py-0.5 text-xs font-semibold border border-indigo-300 rounded-md bg-white text-slate-800 focus:outline-hidden"
                          />
                        ) : (
                          <div className="flex-1 min-w-0 text-xs font-semibold text-slate-800 truncate" title={s.title}>
                            {s.pinned && <Pin className="inline h-3 w-3 text-amber-500 mr-1 -mt-0.5" />}{s.title}
                          </div>
                        )}
                        <span className="text-[10px] text-slate-400 shrink-0 pt-0.5">{formatTimeAgo(s.updatedAt)}</span>
                      </div>
                      <pre className="mt-1.5 text-[11px] leading-snug font-mono text-slate-600 bg-slate-50 rounded-md px-2 py-1 line-clamp-2 whitespace-pre-wrap break-all">
                        {s.text.slice(0, 300)}
                      </pre>
                      <div className="mt-1.5 flex items-center gap-0.5 flex-wrap">
                        {s.kind === 'history' ? (
                          <button type="button" className={btn} title="Lưu thành snippet" aria-label="Lưu thành snippet" onClick={() => report(promoteHistory(s.id))}>
                            <ArrowUpFromLine className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <>
                            <button type="button" className={btn} title={s.pinned ? 'Bỏ ghim' : 'Ghim'} aria-label={s.pinned ? 'Bỏ ghim' : 'Ghim'} aria-pressed={s.pinned} onClick={() => report(togglePin(s.id))}>
                              {s.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                            </button>
                            <button type="button" className={btn} title="Đổi tên" aria-label="Đổi tên" onClick={() => { setEditId(s.id); setEditTitle(s.title); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        <button type="button" className={btn} title="Sao chép" aria-label="Sao chép" onClick={() => copy(s)}>
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className={`${btn} hover:text-red-600`} title="Xóa" aria-label="Xóa" onClick={() => report(removeSnippet(s.id))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openInTool(s)}
                          className="ml-auto px-2 py-1 rounded-lg text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" /> Mở trong công cụ
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <div className="px-4 py-2 border-t border-slate-100 text-[10px] text-slate-400 flex items-center gap-1">
          <Check className="h-3 w-3" /> Dữ liệu chỉ lưu trong trình duyệt này.
        </div>
      </div>
    </div>
  );
}
