'use client';

import { useEffect, useRef, useState } from 'react';
import { ListChecks, Plus, Trash2, Copy, RotateCcw, ClipboardList } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ToolHeader } from '@/components/ToolHeader';
import { TEMPLATES, load, newItem, newList, parseBulk, progress, save, toText, type CheckList } from '@/lib/checklist';

const ACTIVE_KEY = 'getools_checklist_active';
const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';

export default function ChecklistPage() {
  const { showToast } = useApp();
  const [lists, setLists] = useState<CheckList[]>([]);
  const [activeId, setActiveId] = useState('');
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = load();
    const initial = saved && saved.length ? saved : [newList('Việc cần làm')];
    let last = '';
    try { last = localStorage.getItem(ACTIVE_KEY) ?? ''; } catch { /* bị chặn */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLists(initial); setActiveId(initial.some((l) => l.id === last) ? last : initial[0].id); setReady(true);
  }, []);
  useEffect(() => { if (ready) save(lists); }, [lists, ready]);
  useEffect(() => { if (ready && activeId) { try { localStorage.setItem(ACTIVE_KEY, activeId); } catch { /* bị chặn */ } } }, [activeId, ready]);

  const active = lists.find((l) => l.id === activeId) ?? lists[0];
  const patchList = (fn: (l: CheckList) => CheckList) => setLists((ls) => ls.map((l) => (l.id === active?.id ? fn(l) : l)));
  const add = () => {
    const items = parseBulk(text);
    if (!items.length || !active) return;
    patchList((l) => ({ ...l, items: [...l.items, ...items.map(newItem)] }));
    setText(''); inputRef.current?.focus();
  };
  const addList = (title: string, items: string[] = []) => { const l = newList(title, items); setLists((ls) => [...ls, l]); setActiveId(l.id); };
  const removeList = () => {
    if (!active || !window.confirm(`Xóa danh sách "${active.title}"?`)) return;
    const rest = lists.filter((l) => l.id !== active.id);
    const next = rest.length ? rest : [newList('Việc cần làm')];
    setLists(next); setActiveId(next[0].id);
  };
  const copy = async () => { if (!active) return; try { await navigator.clipboard.writeText(toText(active)); showToast('Đã sao chép danh sách'); } catch { showToast('Không sao chép được'); } };

  if (!ready || !active) return <div className="space-y-3.5"><ToolHeader icon={ListChecks} title="Checklist" desc="Danh sách việc cần làm lưu ngay trên trình duyệt, có mẫu dựng sẵn." /></div>;
  const p = progress(active);

  return (
    <div className="space-y-3.5">
      <ToolHeader icon={ListChecks} title="Checklist" desc="Danh sách việc cần làm lưu ngay trên trình duyệt, có mẫu dựng sẵn cho du lịch, chuyển nhà, họp, đi chợ Tết." />
      <div className="grid lg:grid-cols-[240px_1fr] gap-3.5 items-start">
        <aside className={`${card} space-y-2`}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Danh sách</h2>
          <ul className="space-y-1">
            {lists.map((l) => {
              const pr = progress(l);
              return (
                <li key={l.id}>
                  <button onClick={() => setActiveId(l.id)} aria-current={l.id === active.id} className={`w-full text-left rounded-lg px-2.5 py-1.5 text-sm ${l.id === active.id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50 text-slate-700'}`}>
                    <div className="truncate font-medium">{l.title || 'Không tên'}</div>
                    <div className={`text-[11px] ${l.id === active.id ? 'text-indigo-100' : 'text-slate-500'}`}>{pr.done}/{pr.total} xong</div>
                  </button>
                </li>
              );
            })}
          </ul>
          <button onClick={() => addList('Danh sách mới')} className="text-xs text-indigo-600 hover:underline flex items-center gap-1"><Plus className="h-3 w-3" /> Danh sách trống</button>
          <div className="border-t border-slate-100 pt-2 space-y-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1"><ClipboardList className="h-3 w-3" /> Từ mẫu</h3>
            {TEMPLATES.map((t) => <button key={t.name} onClick={() => addList(t.name, t.items)} className="block w-full text-left text-sm text-slate-600 hover:text-indigo-700 px-1 py-0.5">{t.name}</button>)}
          </div>
        </aside>
        <section className={`${card} space-y-3`}>
          <div className="flex items-center gap-2">
            <input value={active.title} onChange={(e) => patchList((l) => ({ ...l, title: e.target.value }))} aria-label="Tên danh sách" className={`${field} text-base font-semibold`} />
            <button onClick={copy} title="Sao chép dạng văn bản" aria-label="Sao chép" className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"><Copy className="h-4 w-4" /></button>
            <button onClick={() => patchList((l) => ({ ...l, items: l.items.map((i) => ({ ...i, done: false })) }))} title="Bỏ chọn tất cả" aria-label="Bỏ chọn tất cả" className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"><RotateCcw className="h-4 w-4" /></button>
            <button onClick={removeList} title="Xóa danh sách" aria-label="Xóa danh sách" className="p-2 rounded-lg border border-slate-200 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1"><span>{p.done}/{p.total} xong</span><span>{p.pct}%</span></div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${p.pct}%` }} /></div>
          </div>
          <div className="flex gap-2">
            <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t.includes('\n')) { e.preventDefault(); setText(t); } }} placeholder="Thêm việc (Enter). Dán nhiều dòng để thêm cả loạt" className={field} />
            <button onClick={add} disabled={!text.trim()} className="px-3 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">Thêm</button>
          </div>
          {text.includes('\n') && <p className="text-xs text-slate-500">Sẽ thêm {parseBulk(text).length} mục.</p>}
          {active.items.length === 0 ? <p className="text-sm text-slate-500">Chưa có việc nào.</p> : (
            <ul className="divide-y divide-slate-100">
              {active.items.map((i) => (
                <li key={i.id} className="flex items-center gap-2.5 py-1.5 group">
                  <input type="checkbox" checked={i.done} onChange={() => patchList((l) => ({ ...l, items: l.items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)) }))} className="h-4 w-4" aria-label={i.text} />
                  <span className={`flex-1 text-sm ${i.done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{i.text}</span>
                  <button onClick={() => patchList((l) => ({ ...l, items: l.items.filter((x) => x.id !== i.id) }))} aria-label={`Xóa ${i.text}`} className="p-1 text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          {p.done > 0 && <button onClick={() => patchList((l) => ({ ...l, items: l.items.filter((i) => !i.done) }))} className="text-xs text-slate-500 hover:text-red-600 hover:underline">Xóa các mục đã xong ({p.done})</button>}
          <p className="text-[11px] text-slate-500">Dữ liệu chỉ lưu trên trình duyệt này; xóa dữ liệu trình duyệt sẽ mất danh sách.</p>
        </section>
      </div>
    </div>
  );
}
