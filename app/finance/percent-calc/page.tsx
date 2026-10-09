'use client';

import { useState } from 'react';
import { Percent, Copy } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ToolHeader } from '@/components/ToolHeader';
import {
  addVat, baseFromPercent, decreaseBy, fmt, increaseBy, margin, parseNum, percentChange, percentOf,
  priceForMargin, removeVat, stackedDiscount, whatPercent,
} from '@/lib/percent';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const TABS = [
  { id: 'basic', label: 'Phần trăm cơ bản' },
  { id: 'discount', label: 'Giảm giá' },
  { id: 'vat', label: 'VAT' },
  { id: 'margin', label: 'Lãi & biên lợi nhuận' },
] as const;
type Tab = (typeof TABS)[number]['id'];

function Num({ label, value, onChange, ph }: { label: string; value: string; onChange: (v: string) => void; ph?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-700">{label}</span>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} className={field} />
    </label>
  );
}

function Out({ label, v, big }: { label: string; v: number | string; big?: boolean }) {
  const { showToast } = useApp();
  const text = typeof v === 'number' ? fmt(v) : v;
  const copy = async () => { try { await navigator.clipboard.writeText(text); showToast('Đã sao chép'); } catch { showToast('Không sao chép được'); } };
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <button onClick={copy} data-tooltip="Bấm để sao chép" className={`flex items-center gap-1.5 font-mono text-right break-all ${big ? 'text-lg font-bold text-slate-900' : 'text-sm text-slate-800'}`}>
        {text}<Copy className="h-3 w-3 text-slate-400 shrink-0" />
      </button>
    </div>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-slate-500">{children}</p>;

function Basic() {
  const [a, setA] = useState('15');
  const [b, setB] = useState('2.000.000');
  const [c, setC] = useState('500.000');
  const [d, setD] = useState('650.000');
  const [e, setE] = useState('80');
  const [f, setF] = useState('25');
  const A = parseNum(a), B = parseNum(b), C = parseNum(c), D = parseNum(d), E = parseNum(e), F = parseNum(f);
  return (
    <div className="grid md:grid-cols-2 gap-3.5">
      <section className={`${card} space-y-2.5`}>
        <h2 className="text-sm font-bold text-slate-800">X% của một số</h2>
        <div className="grid grid-cols-2 gap-2"><Num label="X (%)" value={a} onChange={setA} /><Num label="Của số" value={b} onChange={setB} /></div>
        <Out big label={`${fmt(A)}% của ${fmt(B)}`} v={percentOf(A, B)} />
        <Out label={`${fmt(B)} tăng ${fmt(A)}%`} v={increaseBy(B, A)} />
        <Out label={`${fmt(B)} giảm ${fmt(A)}%`} v={decreaseBy(B, A)} />
      </section>
      <section className={`${card} space-y-2.5`}>
        <h2 className="text-sm font-bold text-slate-800">A là bao nhiêu % của B</h2>
        <div className="grid grid-cols-2 gap-2"><Num label="A" value={c} onChange={setC} /><Num label="B" value={b} onChange={setB} /></div>
        <Out big label="Tỷ lệ" v={Number.isFinite(whatPercent(C, B)) ? `${fmt(whatPercent(C, B))}%` : '—'} />
      </section>
      <section className={`${card} space-y-2.5`}>
        <h2 className="text-sm font-bold text-slate-800">Tăng / giảm bao nhiêu %</h2>
        <div className="grid grid-cols-2 gap-2"><Num label="Giá trị cũ" value={c} onChange={setC} /><Num label="Giá trị mới" value={d} onChange={setD} /></div>
        <Out big label={percentChange(C, D) >= 0 ? 'Tăng' : 'Giảm'} v={Number.isFinite(percentChange(C, D)) ? `${fmt(Math.abs(percentChange(C, D)))}%` : '—'} />
        <Out label="Chênh lệch" v={D - C} />
      </section>
      <section className={`${card} space-y-2.5`}>
        <h2 className="text-sm font-bold text-slate-800">Tìm số gốc</h2>
        <div className="grid grid-cols-2 gap-2"><Num label="Giá trị" value={e} onChange={setE} /><Num label="Chiếm (%)" value={f} onChange={setF} /></div>
        <Out big label={`${fmt(E)} là ${fmt(F)}% của`} v={baseFromPercent(E, F)} />
      </section>
    </div>
  );
}

function Discount() {
  const [price, setPrice] = useState('1.000.000');
  const [layers, setLayers] = useState('20, 10');
  const P = parseNum(price);
  const pcts = layers.split(/[;,\s]+/).filter(Boolean).map(parseNum);
  const bad = pcts.some((x) => !Number.isFinite(x) || x < 0 || x > 100);
  const r = Number.isFinite(P) && !bad ? stackedDiscount(P, pcts) : null;
  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <Num label="Giá gốc" value={price} onChange={setPrice} />
        <Num label="Các mức giảm (%), cách nhau bằng dấu phẩy" value={layers} onChange={setLayers} ph="vd. 20, 10" />
        <Hint>Giảm nhiều lớp được tính nối tiếp: 20% rồi thêm 10% = giảm 28%, không phải 30%.</Hint>
      </section>
      <section className={`${card}`}>
        {!r ? <p className="text-sm text-red-600">Nhập giá hợp lệ và mức giảm từ 0 đến 100.</p> : (
          <>
            <Out big label="Giá sau giảm" v={r.finalPrice} />
            <Out label="Tiết kiệm" v={r.totalSaved} />
            <Out label="Tương đương giảm" v={`${fmt(r.effectivePct)}%`} />
            {r.steps.length > 1 && (
              <ul className="mt-2 text-xs text-slate-500 space-y-0.5">
                {r.steps.map((s, i) => <li key={i}>Lớp {i + 1}: −{fmt(s.pct)}% · {fmt(s.before)} → {fmt(s.after)}</li>)}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Vat() {
  const [amount, setAmount] = useState('1.000.000');
  const [rate, setRate] = useState('8');
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const A = parseNum(amount), R = parseNum(rate);
  const ok = Number.isFinite(A) && Number.isFinite(R) && R >= 0;
  const r = ok ? (mode === 'add' ? addVat(A, R) : removeVat(A, R)) : null;
  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <div className="flex gap-1.5">
          {([['add', 'Chưa VAT → có VAT'], ['remove', 'Đã gồm VAT → tách VAT']] as const).map(([id, l]) => (
            <button key={id} onClick={() => setMode(id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${mode === id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
        <Num label={mode === 'add' ? 'Giá chưa VAT' : 'Giá đã gồm VAT'} value={amount} onChange={setAmount} />
        <Num label="Thuế suất VAT (%)" value={rate} onChange={setRate} />
        <div className="flex gap-1.5">
          {['0', '5', '8', '10'].map((x) => <button key={x} onClick={() => setRate(x)} className="px-2 py-0.5 rounded-full text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">{x}%</button>)}
        </div>
        <Hint>Mức VAT áp dụng có thể thay đổi theo từng nhóm hàng hóa và từng thời kỳ; hãy kiểm tra quy định hiện hành khi lập hóa đơn.</Hint>
      </section>
      <section className={card}>
        {!r ? <p className="text-sm text-red-600">Nhập số tiền và thuế suất hợp lệ.</p> : (
          <>
            <Out label="Giá chưa VAT" v={r.net} />
            <Out label={`Tiền VAT (${fmt(R)}%)`} v={r.vat} />
            <Out big label="Giá đã gồm VAT" v={r.gross} />
          </>
        )}
      </section>
    </div>
  );
}

function Margin() {
  const [cost, setCost] = useState('600.000');
  const [price, setPrice] = useState('1.000.000');
  const [target, setTarget] = useState('30');
  const C = parseNum(cost), P = parseNum(price), T = parseNum(target);
  const m = margin(C, P);
  return (
    <div className="grid md:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-2.5`}>
        <h2 className="text-sm font-bold text-slate-800">Từ giá vốn và giá bán</h2>
        <div className="grid grid-cols-2 gap-2"><Num label="Giá vốn" value={cost} onChange={setCost} /><Num label="Giá bán" value={price} onChange={setPrice} /></div>
        <Out label="Lợi nhuận" v={m.profit} />
        <Out big label="Biên lợi nhuận (trên giá bán)" v={Number.isFinite(m.marginPct) ? `${fmt(m.marginPct)}%` : '—'} />
        <Out label="Markup (trên giá vốn)" v={Number.isFinite(m.markupPct) ? `${fmt(m.markupPct)}%` : '—'} />
        <Hint>Biên lợi nhuận và markup khác nhau: lãi 40 trên giá vốn 100 là markup 40% nhưng biên chỉ ~28,6%.</Hint>
      </section>
      <section className={`${card} space-y-2.5`}>
        <h2 className="text-sm font-bold text-slate-800">Định giá theo biên mong muốn</h2>
        <div className="grid grid-cols-2 gap-2"><Num label="Giá vốn" value={cost} onChange={setCost} /><Num label="Biên mong muốn (%)" value={target} onChange={setTarget} /></div>
        <Out big label="Giá bán cần đặt" v={Number.isFinite(priceForMargin(C, T)) ? priceForMargin(C, T) : '—'} />
      </section>
    </div>
  );
}

export default function PercentCalcPage() {
  const [tab, setTab] = useState<Tab>('basic');
  return (
    <div className="space-y-3.5">
      <ToolHeader icon={Percent} title="Phần trăm, giảm giá & VAT" desc="Tính phần trăm, giảm giá nhiều lớp, thêm/tách VAT và biên lợi nhuận. Nhận cả 1.250.000 lẫn 1,5." />
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${tab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'basic' && <Basic />}
      {tab === 'discount' && <Discount />}
      {tab === 'vat' && <Vat />}
      {tab === 'margin' && <Margin />}
    </div>
  );
}
