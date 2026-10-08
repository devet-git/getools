'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt, Plus, Trash2, Copy, Download, Users, ArrowRight, RotateCcw, AlertTriangle } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { Select } from '@/components/ui/searchable-select';
import { readShareParams } from '@/lib/share-link';
import { Expense, Person, fmtMoney, parseMoney, shareOf, summarize, summaryText } from '@/lib/split-bill';

const KEY = 'getools_split_bill';
const uid = () => Math.random().toString(36).slice(2, 9);
const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs';
const input = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';

interface State { title: string; people: Person[]; expenses: Expense[] }

const sample = (): State => {
  const a = { id: uid(), name: 'An' }, b = { id: uid(), name: 'Bình' }, c = { id: uid(), name: 'Chi' };
  return {
    title: 'Chuyến đi Đà Lạt',
    people: [a, b, c],
    expenses: [
      { id: uid(), title: 'Khách sạn', amount: 1800000, payer: a.id, participants: [a.id, b.id, c.id], mode: 'equal', exact: {} },
      { id: uid(), title: 'Ăn tối', amount: 960000, payer: b.id, participants: [a.id, b.id, c.id], mode: 'equal', exact: {} },
      { id: uid(), title: 'Taxi', amount: 250000, payer: c.id, participants: [b.id, c.id], mode: 'equal', exact: {} },
    ],
  };
};

export default function SplitBillPage() {
  const { showToast } = useApp();
  const [state, setState] = useState<State>({ title: '', people: [], expenses: [] });
  const [ready, setReady] = useState(false);
  const [newName, setNewName] = useState('');
  const [draft, setDraft] = useState({ title: '', amount: '', payer: '' });
  const [draftParts, setDraftParts] = useState<string[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* khôi phục: link chia sẻ > dữ liệu đã lưu > mẫu */
  useEffect(() => {
    let next: State | null = null;
    try {
      const d = readShareParams().get('d');
      if (d) next = JSON.parse(d) as State;
      else { const raw = localStorage.getItem(KEY); if (raw) next = JSON.parse(raw) as State; }
    } catch { /* dữ liệu hỏng: dùng mẫu */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(next && Array.isArray(next.people) && Array.isArray(next.expenses) ? next : sample());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* đầy bộ nhớ */ }
  }, [state, ready]);

  const { people, expenses } = state;
  const summary = useMemo(() => summarize(people, expenses), [people, expenses]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '?';
  const parts = draftParts ?? people.map((p) => p.id);
  const payer = people.some((p) => p.id === draft.payer) ? draft.payer : people[0]?.id ?? '';

  const patch = (p: Partial<State>) => setState((s) => ({ ...s, ...p }));
  const addPerson = () => {
    const name = newName.trim();
    if (!name) return;
    if (people.some((p) => p.name.toLowerCase() === name.toLowerCase())) { showToast('Tên này đã có trong nhóm'); return; }
    patch({ people: [...people, { id: uid(), name }] });
    setNewName('');
    setDraftParts(null);
  };
  const removePerson = (id: string) => {
    if (expenses.some((e) => e.payer === id || e.participants.includes(id))) {
      if (!window.confirm('Người này có trong các khoản chi. Xóa người và gỡ khỏi các khoản đó?')) return;
    }
    patch({
      people: people.filter((p) => p.id !== id),
      expenses: expenses.filter((e) => e.payer !== id).map((e) => ({ ...e, participants: e.participants.filter((x) => x !== id) })),
    });
    setDraftParts(null);
  };
  const addExpense = () => {
    const amount = parseMoney(draft.amount);
    if (!(amount > 0)) { showToast('Nhập số tiền hợp lệ (vd. 250000, 250k, 1.5tr)'); return; }
    if (!payer || parts.length === 0) { showToast('Chọn người trả và ít nhất một người cùng chia'); return; }
    patch({ expenses: [...expenses, { id: uid(), title: draft.title.trim() || 'Khoản chi', amount, payer, participants: parts, mode: 'equal', exact: {} }] });
    setDraft({ title: '', amount: '', payer });
  };
  const updateExpense = (id: string, p: Partial<Expense>) => patch({ expenses: expenses.map((e) => (e.id === id ? { ...e, ...p } : e)) });

  const text = summaryText(people, summary, state.title);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); showToast('Đã sao chép kết quả'); } catch { showToast('Không sao chép được'); }
  };

  const downloadPng = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const lines = text.split('\n');
    const W = 760, lh = 30, pad = 28, H = pad * 2 + lines.length * lh + 10;
    cv.width = W * 2; cv.height = H * 2;
    const g = cv.getContext('2d')!;
    g.scale(2, 2);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#4f46e5'; g.fillRect(0, 0, 8, H);
    g.textBaseline = 'middle';
    lines.forEach((l, i) => {
      g.font = `${i === 0 ? '700 20px' : '16px'} system-ui, -apple-system, "Segoe UI", sans-serif`;
      g.fillStyle = i === 0 ? '#0f172a' : l.startsWith('➡') ? '#4338ca' : '#334155';
      g.fillText(l, pad, pad + i * lh + lh / 2, W - pad * 2);
    });
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = 'chia-tien.png';
    a.click();
  };

  const reset = () => {
    if (window.confirm('Xóa toàn bộ nhóm và các khoản chi?')) { setState({ title: '', people: [], expenses: [] }); setDraftParts(null); }
  };

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Receipt className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Chia tiền nhóm</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Ghi các khoản chi, tự tính ai nợ ai và chuyển khoản ít lần nhất. Dữ liệu chỉ lưu trên trình duyệt của bạn.
            </p>
          </div>
        </div>
        <ShareLinkButton params={{ d: JSON.stringify(state) }} />
      </div>

      <div className="grid lg:grid-cols-2 gap-3.5 items-start">
        <div className="space-y-3.5">
          <section className={`${card} p-3.5 space-y-3`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Nhóm</h2>
              <button onClick={reset} className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1"><RotateCcw className="h-3 w-3" /> Làm mới</button>
            </div>
            <input className={input} placeholder="Tên chuyến đi / bữa ăn (tùy chọn)" value={state.title} onChange={(e) => patch({ title: e.target.value })} />
            <div className="flex flex-wrap gap-1.5">
              {people.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-sm">
                  {p.name}
                  <button onClick={() => removePerson(p.id)} aria-label={`Xóa ${p.name}`} className="p-0.5 rounded-full hover:bg-indigo-100"><Trash2 className="h-3 w-3" /></button>
                </span>
              ))}
              {people.length === 0 && <span className="text-sm text-slate-500">Chưa có ai. Thêm tên bên dưới.</span>}
            </div>
            <div className="flex gap-2">
              <input className={input} placeholder="Thêm người (Enter)" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPerson()} />
              <button onClick={addPerson} className="shrink-0 px-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 flex items-center gap-1"><Plus className="h-4 w-4" /> Thêm</button>
            </div>
          </section>

          <section className={`${card} p-3.5 space-y-3`}>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Thêm khoản chi</h2>
            <div className="grid sm:grid-cols-2 gap-2">
              <input className={input} placeholder="Nội dung (vd. Ăn tối)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <input className={input} inputMode="decimal" placeholder="Số tiền (250000, 250k, 1.5tr)" value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addExpense()} />
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span className="shrink-0">Người trả</span>
              <Select value={payer} onChange={(e) => setDraft({ ...draft, payer: e.target.value })}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Chia cho ({parts.length}/{people.length})</span>
                <span className="space-x-2">
                  <button className="underline" onClick={() => setDraftParts(people.map((p) => p.id))}>Tất cả</button>
                  <button className="underline" onClick={() => setDraftParts([])}>Bỏ chọn</button>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {people.map((p) => {
                  const on = parts.includes(p.id);
                  return (
                    <button key={p.id} onClick={() => setDraftParts(on ? parts.filter((x) => x !== p.id) : [...parts, p.id])}
                      className={`px-2.5 py-1 rounded-full text-sm border transition ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <button onClick={addExpense} disabled={people.length === 0}
              className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              <Plus className="h-4 w-4" /> Thêm khoản chi
            </button>
          </section>

          <section className={`${card} p-3.5 space-y-2`}>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Các khoản chi ({expenses.length})</h2>
            {expenses.length === 0 && <p className="text-sm text-slate-500">Chưa có khoản chi nào.</p>}
            {expenses.map((e) => {
              const sh = shareOf(e);
              const sum = Object.values(sh).reduce((a, b) => a + b, 0);
              const bad = summary.mismatched.includes(e.id);
              return (
                <div key={e.id} className={`rounded-lg border p-2.5 space-y-2 ${bad ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{e.title}</div>
                      <div className="text-xs text-slate-500">{nameOf(e.payer)} trả · {e.participants.length} người chia</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm font-bold text-slate-800">{fmtMoney(e.amount)}</span>
                      <button onClick={() => patch({ expenses: expenses.filter((x) => x.id !== e.id) })} aria-label="Xóa khoản chi" className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={e.mode === 'exact'}
                      onChange={(ev) => updateExpense(e.id, ev.target.checked ? { mode: 'exact', exact: shareOf({ ...e, mode: 'equal' }) } : { mode: 'equal' })} />
                    Chia không đều (nhập số tiền riêng từng người)
                  </label>
                  {e.mode === 'exact' && (
                    <div className="grid sm:grid-cols-2 gap-1.5">
                      {e.participants.map((id) => (
                        <label key={id} className="flex items-center gap-2 text-xs text-slate-600">
                          <span className="w-16 truncate">{nameOf(id)}</span>
                          <input className={input} inputMode="decimal" value={e.exact[id] ?? ''}
                            onChange={(ev) => updateExpense(e.id, { exact: { ...e.exact, [id]: parseMoney(ev.target.value) } })} />
                        </label>
                      ))}
                      <div className={`text-xs sm:col-span-2 flex items-center gap-1 ${bad ? 'text-amber-700' : 'text-slate-500'}`}>
                        {bad && <AlertTriangle className="h-3 w-3" />} Tổng {fmtMoney(sum)} / {fmtMoney(e.amount)}
                        {bad && ` — lệch ${fmtMoney(Math.abs(e.amount - sum))}, khoản này chưa được tính`}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>

        <section className={`${card} p-3.5 space-y-3 lg:sticky lg:top-0`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Kết quả</h2>
            <div className="flex gap-1.5">
              <button onClick={copy} className="px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 flex items-center gap-1"><Copy className="h-3.5 w-3.5" /> Sao chép</button>
              <button onClick={downloadPng} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1"><Download className="h-3.5 w-3.5" /> Tải ảnh</button>
            </div>
          </div>
          <div className="text-sm text-slate-600">Tổng chi: <b className="text-slate-900">{fmtMoney(summary.total)}</b>
            {people.length > 0 && <> · bình quân <b className="text-slate-900">{fmtMoney(summary.total / people.length)}</b>/người</>}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-500 mb-1.5">Cần chuyển khoản ({summary.transfers.length})</h3>
            {summary.transfers.length === 0 ? (
              <p className="text-sm text-slate-500">Không ai cần chuyển khoản.</p>
            ) : (
              <ul className="space-y-1.5">
                {summary.transfers.map((t, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm">
                    <span className="font-semibold text-slate-800">{nameOf(t.from)}</span>
                    <ArrowRight className="h-4 w-4 text-indigo-500 shrink-0" />
                    <span className="font-semibold text-slate-800">{nameOf(t.to)}</span>
                    <span className="ml-auto font-bold text-indigo-700">{fmtMoney(t.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-500 mb-1.5">Chi tiết từng người</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-1 font-medium">Tên</th><th className="py-1 font-medium text-right">Đã trả</th>
                    <th className="py-1 font-medium text-right">Phần mình</th><th className="py-1 font-medium text-right">Còn lại</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => {
                    const b = summary.balance[p.id];
                    return (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="py-1.5 font-medium text-slate-800">{p.name}</td>
                        <td className="py-1.5 text-right text-slate-600">{fmtMoney(summary.paid[p.id])}</td>
                        <td className="py-1.5 text-right text-slate-600">{fmtMoney(summary.owed[p.id])}</td>
                        <td className={`py-1.5 text-right font-semibold ${b > 0 ? 'text-emerald-600' : b < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                          {b > 0 ? '+' : ''}{fmtMoney(b)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">Số dương: được nhận lại · số âm: còn nợ.</p>
          </div>
        </section>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
