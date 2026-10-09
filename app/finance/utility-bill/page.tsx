'use client';

import { useState } from 'react';
import { Zap, Droplets, Plus, Trash2, RotateCcw } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import { parseNum, fmt } from '@/lib/percent';
import { EVN_TIERS, WATER_EXAMPLE_TIERS, computeBill, quantityFromTotal, validateTiers, type Tier } from '@/lib/utility-bill';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
type Kind = 'power' | 'water';
const CFG = {
  power: { unit: 'kWh', label: 'Số điện đã dùng', vat: '8', fee: '0', tiers: EVN_TIERS, note: 'Biểu giá điện sinh hoạt EVN (QĐ 1279/QĐ-BCT, từ 10/05/2025). Biểu giá và thuế suất VAT có thể thay đổi, hãy đối chiếu hóa đơn gần nhất và chỉnh lại bảng bên dưới nếu cần.' },
  water: { unit: 'm³', label: 'Số nước đã dùng', vat: '5', fee: '10', tiers: WATER_EXAMPLE_TIERS, note: 'Biểu giá nước dưới đây chỉ là ví dụ minh họa. Mỗi tỉnh/thành và công ty cấp nước có biểu giá riêng, hãy nhập biểu giá theo hóa đơn của bạn.' },
} as const;

const toRows = (t: readonly Tier[]) => t.map((x) => ({ upTo: x.upTo === null ? '' : String(x.upTo), price: String(x.price) }));

function Calc({ kind }: { kind: Kind }) {
  const c = CFG[kind];
  const [qty, setQty] = useState(kind === 'power' ? '250' : '18');
  const [rows, setRows] = useState(() => toRows(c.tiers));
  const [vat, setVat] = useState<string>(c.vat);
  const [fee, setFee] = useState<string>(c.fee);
  const [target, setTarget] = useState('');

  const tiers: Tier[] = rows.map((r, i) => ({ upTo: i === rows.length - 1 ? null : parseNum(r.upTo), price: parseNum(r.price) }));
  const err = validateTiers(tiers);
  const Q = parseNum(qty), V = parseNum(vat), F = parseNum(fee);
  const okInputs = !err && Number.isFinite(Q) && Q >= 0 && Number.isFinite(V) && V >= 0 && Number.isFinite(F) && F >= 0;
  const bill = okInputs ? computeBill(Q, tiers, V, F) : null;
  const T = parseNum(target);
  const reverse = okInputs && Number.isFinite(T) && T > 0 ? quantityFromTotal(T, tiers, V, F) : null;

  const setRow = (i: number, k: 'upTo' | 'price', v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const addTier = () => setRows([...rows.slice(0, -1), { upTo: String((parseNum(rows[rows.length - 2]?.upTo ?? '0') || 0) + 100), price: rows[rows.length - 1].price }, rows[rows.length - 1]]);
  const reset = () => { setRows(toRows(c.tiers)); setVat(c.vat); setFee(c.fee); };

  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">{c.label} ({c.unit})
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1 block">VAT (%)<input inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} className={field} /></label>
          {kind === 'water' && <label className="text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1 block">Phí BVMT (%)<input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={field} /></label>}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Biểu giá theo bậc (đồng/{c.unit}, chưa VAT)</h2>
            <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"><RotateCcw className="h-3 w-3" /> Mặc định</button>
          </div>
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                <span className="w-10 shrink-0">Bậc {i + 1}</span>
                {i === rows.length - 1 ? <span className="flex-1 text-slate-500">từ {rows[i - 1]?.upTo || 0} trở lên</span>
                  : <label className="flex-1 flex items-center gap-1">đến <input inputMode="decimal" value={r.upTo} onChange={(e) => setRow(i, 'upTo', e.target.value)} className={field} /></label>}
                <label className="flex-1 flex items-center gap-1"><input inputMode="decimal" value={r.price} onChange={(e) => setRow(i, 'price', e.target.value)} className={field} />đ</label>
                <button onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length < 2 || i === rows.length - 1} aria-label={`Xóa bậc ${i + 1}`} className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
          <button onClick={addTier} className="mt-2 text-xs text-indigo-600 hover:underline flex items-center gap-1"><Plus className="h-3 w-3" /> Thêm bậc</button>
        </div>
        <p className="text-xs text-slate-500">{c.note}</p>
      </section>
      <section className={`${card} space-y-3`}>
        {err ? <p className="text-sm text-red-600">{err}</p> : !bill ? <p className="text-sm text-red-600">Nhập số lượng, VAT và phí hợp lệ.</p> : (
          <>
            <p className="text-2xl font-bold text-slate-900">{fmt(bill.total, 0)} đ</p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] text-slate-500"><th className="font-medium">Bậc</th><th className="font-medium text-right">Dùng</th><th className="font-medium text-right">Đơn giá</th><th className="font-medium text-right">Thành tiền</th></tr></thead>
              <tbody className="font-mono">
                {bill.lines.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100"><td className="py-1">{i + 1} <span className="text-slate-400 text-xs">({fmt(l.from, 0)}–{fmt(l.to, 0)})</span></td><td className="text-right">{fmt(l.qty)}</td><td className="text-right">{fmt(l.price, 0)}</td><td className="text-right">{fmt(l.amount, 0)}</td></tr>
                ))}
              </tbody>
            </table>
            <dl className="text-sm space-y-1 border-t border-slate-200 pt-2">
              <div className="flex justify-between"><dt className="text-slate-600">Tiền {kind === 'power' ? 'điện' : 'nước'}</dt><dd className="font-mono">{fmt(bill.subtotal, 0)}</dd></div>
              {kind === 'water' && <div className="flex justify-between"><dt className="text-slate-600">Phí bảo vệ môi trường</dt><dd className="font-mono">{fmt(bill.fee, 0)}</dd></div>}
              <div className="flex justify-between"><dt className="text-slate-600">VAT</dt><dd className="font-mono">{fmt(bill.vat, 0)}</dd></div>
              <div className="flex justify-between text-slate-500"><dt>Trung bình</dt><dd className="font-mono">{Q > 0 ? `${fmt(bill.total / Q, 0)} đ/${c.unit}` : '—'}</dd></div>
            </dl>
          </>
        )}
        <div className="border-t border-slate-200 pt-3 space-y-1.5">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">Tính ngược: tổng tiền đã trả (đồng) → số {c.unit}
            <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="vd. 650.000" className={field} />
          </label>
          {reverse !== null && <p className="text-sm text-slate-700">{Number.isFinite(reverse) ? <>Khoảng <b>{fmt(reverse, 1)} {c.unit}</b></> : 'Không tính được với biểu giá này.'}</p>}
        </div>
      </section>
    </div>
  );
}

export default function UtilityBillPage() {
  const [kind, setKind] = useState<Kind>('power');
  return (
    <div className="space-y-3.5">
      <ToolHeader icon={Zap} title="Tính tiền điện & nước" desc="Tính hóa đơn điện, nước theo bậc thang, hoặc suy ngược số đã dùng từ số tiền đã trả." />
      <div className="flex gap-1.5">
        {([['power', 'Điện', Zap], ['water', 'Nước', Droplets]] as const).map(([id, l, Ic]) => (
          <button key={id} onClick={() => setKind(id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border flex items-center gap-1.5 ${kind === id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}><Ic className="h-3.5 w-3.5" />{l}</button>
        ))}
      </div>
      <Calc key={kind} kind={kind} />
    </div>
  );
}
