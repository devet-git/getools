'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ToolHeader } from '@/components/ToolHeader';
import { Select } from '@/components/ui/searchable-select';
import { CURRENCY_NAMES, DEFAULT_RATES, TempUnit, UNIT_GROUPS, convertCurrency, convertTemp, convertUnit } from '@/lib/convert';
import { parseNumberInput } from '@/lib/vn-number';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const RATES_KEY = 'getools_fx_rates';

function num(s: string): number {
  const p = parseNumberInput(s);
  if (!p) return NaN;
  return (p.neg ? -1 : 1) * Number(`${p.int}${p.frac ? '.' + p.frac : ''}`);
}
const fmt = (v: number) => (Number.isFinite(v) ? v.toLocaleString('vi-VN', { maximumFractionDigits: Math.abs(v) < 1 ? 8 : 4 }) : '—');

function Units() {
  const groups = [...UNIT_GROUPS.map((g) => ({ id: g.id, label: g.label })), { id: 'temp', label: 'Nhiệt độ' }];
  const [gid, setGid] = useState('length');
  const [val, setVal] = useState('1');
  const [fromId, setFromId] = useState('m');
  const [toId, setToId] = useState('ft');
  const group = UNIT_GROUPS.find((g) => g.id === gid);
  const TEMPS: { id: TempUnit; label: string }[] = [{ id: 'C', label: 'Độ C (°C)' }, { id: 'F', label: 'Độ F (°F)' }, { id: 'K', label: 'Kelvin (K)' }];
  const v = num(val);

  const pick = (id: string) => {
    setGid(id);
    const g = UNIT_GROUPS.find((x) => x.id === id);
    setFromId(g ? g.units[Math.min(2, g.units.length - 1)].id : 'C');
    setToId(g ? g.units[Math.min(3, g.units.length - 1)].id : 'F');
  };

  const out = (() => {
    if (!group) return convertTemp(v, fromId as TempUnit, toId as TempUnit);
    const a = group.units.find((u) => u.id === fromId), b = group.units.find((u) => u.id === toId);
    return a && b ? convertUnit(v, a, b) : NaN;
  })();
  const all = group && Number.isFinite(v) ? group.units.map((u) => ({ u, r: convertUnit(v, group.units.find((x) => x.id === fromId) ?? group.units[0], u) })) : [];
  const opts = group ? group.units.map((u) => ({ id: u.id, label: u.label })) : TEMPS;

  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => (
            <button key={g.id} onClick={() => pick(g.id)} className={`px-2.5 py-1 rounded-full text-sm border ${gid === g.id ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{g.label}</button>
          ))}
        </div>
        <input className={`${field} text-lg font-mono`} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} />
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
          <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          <button onClick={() => { setFromId(toId); setToId(fromId); }} aria-label="Đổi chiều" className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ArrowLeftRight className="h-4 w-4" /></button>
          <Select value={toId} onChange={(e) => setToId(e.target.value)}>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
        </div>
        <div className="rounded-lg bg-indigo-50 p-3">
          <div className="text-xs text-indigo-700">Kết quả</div>
          <div className="text-xl font-bold text-indigo-900 break-words">{fmt(out)}</div>
        </div>
      </section>
      <section className={card}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">{group ? 'Quy đổi sang tất cả đơn vị' : 'Công thức'}</h3>
        {group ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {all.map(({ u, r }) => <li key={u.id} className="flex justify-between gap-3 py-1.5"><span className="text-slate-600">{u.label}</span><span className="font-mono text-slate-900 text-right break-all">{fmt(r)}</span></li>)}
          </ul>
        ) : <p className="text-sm text-slate-600">°F = °C × 9/5 + 32 · K = °C + 273,15</p>}
        {gid === 'mass' && <p className="text-xs text-slate-500 mt-2">1 lượng (cây) vàng = 10 chỉ = 37,5 g. Vàng thế giới tính theo troy ounce (31,1035 g).</p>}
        {gid === 'area' && <p className="text-xs text-slate-500 mt-2">Sào, mẫu, công khác nhau theo vùng; đây là giá trị phổ biến, hãy đối chiếu với địa phương khi làm giấy tờ.</p>}
      </section>
    </div>
  );
}

function Currency() {
  const { showToast } = useApp();
  const [rates, setRates] = useState<Record<string, number>>(DEFAULT_RATES);
  const [updated, setUpdated] = useState<string>('');
  const [val, setVal] = useState('100');
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('VND');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RATES_KEY);
      if (raw) {
        const o = JSON.parse(raw) as { rates: Record<string, number>; at: string };
         
        if (o.rates) setRates({ ...DEFAULT_RATES, ...o.rates });
        if (o.at) setUpdated(o.at);
         
      }
    } catch { /* bỏ qua */ }
  }, []);

  const save = (r: Record<string, number>, at: string) => {
    setRates(r); setUpdated(at);
    try { localStorage.setItem(RATES_KEY, JSON.stringify({ rates: r, at })); } catch { /* đầy bộ nhớ */ }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/VND');
      const j = (await res.json()) as { result?: string; rates?: Record<string, number> };
      if (j.result !== 'success' || !j.rates) throw new Error('bad');
      const next: Record<string, number> = { ...rates, VND: 1 };
      for (const c of Object.keys(DEFAULT_RATES)) if (c !== 'VND' && j.rates[c]) next[c] = 1 / j.rates[c];
      save(next, new Date().toLocaleString('vi-VN'));
      showToast('Đã cập nhật tỷ giá');
    } catch {
      showToast('Không lấy được tỷ giá. Bạn có thể nhập tay bên dưới.');
    } finally { setBusy(false); }
  };

  const codes = Object.keys(DEFAULT_RATES);
  const v = num(val);
  const out = useMemo(() => convertCurrency(v, from, to, rates), [v, from, to, rates]);
  const opt = (c: string) => <option key={c} value={c}>{c} — {CURRENCY_NAMES[c]}</option>;

  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <input className={`${field} text-lg font-mono`} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} />
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>{codes.map(opt)}</Select>
          <button onClick={() => { setFrom(to); setTo(from); }} aria-label="Đổi chiều" className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ArrowLeftRight className="h-4 w-4" /></button>
          <Select value={to} onChange={(e) => setTo(e.target.value)}>{codes.map(opt)}</Select>
        </div>
        <div className="rounded-lg bg-indigo-50 p-3">
          <div className="text-xs text-indigo-700">Kết quả</div>
          <div className="text-xl font-bold text-indigo-900 break-words">{fmt(out)} {to}</div>
          <div className="text-xs text-indigo-700/80 mt-0.5">1 {from} = {fmt(convertCurrency(1, from, to, rates))} {to}</div>
        </div>
        <p className="text-xs text-slate-500">Tỷ giá chỉ mang tính tham khảo (không phải tỷ giá ngân hàng). {updated ? `Cập nhật: ${updated}.` : 'Đang dùng tỷ giá mặc định ước chừng — hãy cập nhật hoặc nhập tay.'}</p>
      </section>
      <section className={`${card} space-y-2`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Tỷ giá (VND cho 1 đơn vị)</h3>
          <button onClick={refresh} disabled={busy} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Lấy tỷ giá mới</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {codes.filter((c) => c !== 'VND').map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm text-slate-600"><span className="w-10 shrink-0 font-medium">{c}</span>
              <input className={field} inputMode="decimal" value={String(rates[c])} onChange={(e) => { const n = num(e.target.value); if (n > 0) save({ ...rates, [c]: n }, new Date().toLocaleString('vi-VN') + ' (nhập tay)'); }} />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function UnitCurrencyPage() {
  const [tab, setTab] = useState<'unit' | 'fx'>('unit');
  return (
    <div className="space-y-3.5">
      <ToolHeader icon={ArrowLeftRight} title="Đổi đơn vị & tiền tệ" desc="Chiều dài, cân nặng, diện tích, nhiệt độ, dung lượng... gồm cả lượng/chỉ vàng, sào, mẫu và đổi ngoại tệ." />
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
        {([['unit', 'Đơn vị'], ['fx', 'Tiền tệ']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3 py-1 rounded-md ${tab === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>
        ))}
      </div>
      {tab === 'unit' ? <Units /> : <Currency />}
    </div>
  );
}
