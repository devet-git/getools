'use client';

import { useMemo, useState } from 'react';
import { Landmark, Download } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import { MoneyInput } from '@/components/MoneyInput';
import { Select } from '@/components/ui/searchable-select';
import { LoanMethod, loanSchedule, monthlyForGoal, monthsToGoal, savingsGrowth } from '@/lib/loan';
import { fmtMoney } from '@/lib/split-bill';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const METHODS: { id: LoanMethod; label: string; hint: string }[] = [
  { id: 'reducing-equal-principal', label: 'Gốc đều, lãi theo dư nợ giảm dần', hint: 'Tháng đầu trả nhiều nhất, giảm dần. Tổng lãi thấp hơn niên kim.' },
  { id: 'annuity', label: 'Niên kim (trả đều mỗi tháng)', hint: 'Mỗi tháng trả cùng một số tiền; lãi nhiều ở đầu kỳ, gốc nhiều ở cuối kỳ.' },
  { id: 'flat', label: 'Lãi tính trên gốc ban đầu (flat)', hint: 'Hay gặp ở vay tiêu dùng / mua trả góp. Lãi suất thực tế cao hơn con số quảng cáo gần gấp đôi.' },
];

function Stat({ label, v, tone }: { label: string; v: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2.5 min-w-0">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-base font-bold break-words ${tone ?? 'text-slate-900'}`}>{v}</div>
    </div>
  );
}

function Loan() {
  const [amount, setAmount] = useState(500_000_000);
  const [rate, setRate] = useState('9.5');
  const [months, setMonths] = useState('120');
  const [grace, setGrace] = useState('0');
  const [method, setMethod] = useState<LoanMethod>('annuity');
  const [showAll, setShowAll] = useState(false);

  const ok = amount > 0 && Number(months) >= 1 && Number(rate) >= 0;
  const res = useMemo(() => (ok ? loanSchedule(amount, Number(rate), Number(months), method, Number(grace)) : null), [ok, amount, rate, months, method, grace]);
  const compare = useMemo(() => (ok ? METHODS.map((m) => ({ ...m, r: loanSchedule(amount, Number(rate), Number(months), m.id, Number(grace)) })) : []), [ok, amount, rate, months, grace]);
  const hint = METHODS.find((m) => m.id === method)?.hint;

  const exportCsv = () => {
    if (!res) return;
    const csv = ['Kỳ,Phải trả,Gốc,Lãi,Dư nợ', ...res.rows.map((r) => [r.n, r.payment, r.principal, r.interest, r.balance].map((x) => Math.round(Number(x))).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'lich-tra-no.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <label className="block text-sm text-slate-600">Số tiền vay<div className="mt-1"><MoneyInput value={amount} onChange={setAmount} placeholder="vd. 500tr" /></div></label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block text-sm text-slate-600">Lãi suất / năm (%)<input className={`${field} mt-1`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(',', '.'))} /></label>
          <label className="block text-sm text-slate-600">Thời hạn (tháng)<input className={`${field} mt-1`} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))} /></label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[12, 24, 60, 120, 240, 300].map((m) => (
            <button key={m} onClick={() => setMonths(String(m))} className="px-2 py-0.5 rounded-full text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">{m >= 12 ? `${m / 12} năm` : `${m} tháng`}</button>
          ))}
        </div>
        <label className="block text-sm text-slate-600">Ân hạn gốc (tháng, chỉ trả lãi)<input className={`${field} mt-1`} inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value.replace(/\D/g, ''))} /></label>
        <label className="block text-sm text-slate-600">Cách tính
          <div className="mt-1"><Select value={method} onChange={(e) => setMethod(e.target.value as LoanMethod)}>{METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></div>
        </label>
        <p className="text-xs text-slate-500">{hint}</p>
        <p className="text-xs text-slate-500">Chưa gồm phí bảo hiểm, phí trả nợ trước hạn hoặc lãi suất thả nổi sau ưu đãi.</p>
      </section>

      <div className="space-y-3.5 min-w-0">
        {res && (
          <section className={`${card} space-y-3`}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label={method === 'reducing-equal-principal' ? 'Kỳ đầu phải trả' : 'Mỗi tháng trả'} v={fmtMoney(res.firstPayment)} tone="text-indigo-700" />
              <Stat label="Tổng lãi" v={fmtMoney(res.totalInterest)} tone="text-red-600" />
              <Stat label="Tổng phải trả" v={fmtMoney(res.totalPaid)} />
              <Stat label="Lãi / gốc" v={((res.totalInterest / amount) * 100).toFixed(1).replace('.', ',') + '%'} />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500 mb-1.5">So sánh các cách tính</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Cách tính</th><th className="py-1 font-medium text-right">Kỳ đầu</th><th className="py-1 font-medium text-right">Kỳ cuối</th><th className="py-1 font-medium text-right">Tổng lãi</th></tr></thead>
                  <tbody>
                    {compare.map((c) => (
                      <tr key={c.id} className={`border-t border-slate-100 ${c.id === method ? 'bg-indigo-50' : ''}`}>
                        <td className="py-1.5 pr-2 text-slate-700">{c.label}</td><td className="py-1.5 text-right">{fmtMoney(c.r.firstPayment)}</td>
                        <td className="py-1.5 text-right">{fmtMoney(c.r.lastPayment)}</td><td className="py-1.5 text-right font-medium">{fmtMoney(c.r.totalInterest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
        {res && (
          <section className={`${card} space-y-2`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Lịch trả nợ ({res.rows.length} kỳ)</h3>
              <button onClick={exportCsv} className="px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 flex items-center gap-1"><Download className="h-3.5 w-3.5" /> CSV</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[460px]">
                <thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Kỳ</th><th className="py-1 font-medium text-right">Phải trả</th><th className="py-1 font-medium text-right">Gốc</th><th className="py-1 font-medium text-right">Lãi</th><th className="py-1 font-medium text-right">Dư nợ</th></tr></thead>
                <tbody>
                  {(showAll ? res.rows : res.rows.slice(0, 12)).map((r) => (
                    <tr key={r.n} className="border-t border-slate-100"><td className="py-1">{r.n}</td><td className="py-1 text-right">{fmtMoney(r.payment)}</td><td className="py-1 text-right">{fmtMoney(r.principal)}</td><td className="py-1 text-right text-red-600">{fmtMoney(r.interest)}</td><td className="py-1 text-right text-slate-500">{fmtMoney(r.balance)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {res.rows.length > 12 && <button onClick={() => setShowAll(!showAll)} className="text-xs text-indigo-600 underline">{showAll ? 'Thu gọn' : `Xem đủ ${res.rows.length} kỳ`}</button>}
          </section>
        )}
        {!res && <section className={card}><p className="text-sm text-slate-500">Nhập số tiền, lãi suất và thời hạn hợp lệ.</p></section>}
      </div>
    </div>
  );
}

function Chart({ pts }: { pts: { month: number; deposited: number; value: number }[] }) {
  const W = 640, H = 220, P = 8;
  const max = Math.max(...pts.map((p) => p.value), 1);
  const x = (m: number) => P + (m / Math.max(1, pts[pts.length - 1].month)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = (k: 'value' | 'deposited') => pts.filter((_, i) => i % Math.ceil(pts.length / 240) === 0 || i === pts.length - 1).map((p, i) => `${i ? 'L' : 'M'}${x(p.month).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  const area = `${line('value')} L${x(pts[pts.length - 1].month)},${H - P} L${x(0)},${H - P} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Biểu đồ tăng trưởng tiền tiết kiệm">
      <path d={area} fill="#6366f1" opacity="0.12" />
      <path d={line('value')} fill="none" stroke="#6366f1" strokeWidth="2.5" />
      <path d={line('deposited')} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" />
    </svg>
  );
}

function Savings() {
  const [initial, setInitial] = useState(50_000_000);
  const [monthly, setMonthly] = useState(5_000_000);
  const [rate, setRate] = useState('6');
  const [years, setYears] = useState('10');
  const [goal, setGoal] = useState(1_000_000_000);

  const months = Math.round(Number(years) * 12);
  const ok = months >= 1 && months <= 1200 && Number(rate) >= 0;
  const pts = useMemo(() => (ok ? savingsGrowth(initial, monthly, Number(rate), months) : null), [ok, initial, monthly, rate, months]);
  const last = pts?.[pts.length - 1];
  const need = goal > 0 && ok ? monthlyForGoal(initial, Number(rate), months, goal) : 0;
  const reach = goal > 0 ? monthsToGoal(initial, monthly, Number(rate), goal) : null;

  return (
    <div className="grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <label className="block text-sm text-slate-600">Số tiền ban đầu<div className="mt-1"><MoneyInput value={initial} onChange={setInitial} placeholder="vd. 50tr" /></div></label>
        <label className="block text-sm text-slate-600">Gửi thêm mỗi tháng<div className="mt-1"><MoneyInput value={monthly} onChange={setMonthly} placeholder="vd. 5tr" /></div></label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block text-sm text-slate-600">Lãi suất / năm (%)<input className={`${field} mt-1`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(',', '.'))} /></label>
          <label className="block text-sm text-slate-600">Số năm<input className={`${field} mt-1`} inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value.replace(',', '.'))} /></label>
        </div>
        <label className="block text-sm text-slate-600">Mục tiêu (tùy chọn)<div className="mt-1"><MoneyInput value={goal} onChange={setGoal} placeholder="vd. 1 tỷ" /></div></label>
        <p className="text-xs text-slate-500">Lãi ghép theo tháng, gửi thêm vào cuối mỗi tháng; chưa tính lạm phát hay thuế. Lãi suất thực tế có thể đổi theo kỳ hạn.</p>
      </section>
      <div className="space-y-3.5 min-w-0">
        {pts && last ? (
          <section className={`${card} space-y-3`}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Stat label={`Sau ${years} năm có`} v={fmtMoney(last.value)} tone="text-indigo-700" />
              <Stat label="Tiền bạn bỏ vào" v={fmtMoney(last.deposited)} />
              <Stat label="Tiền lãi sinh ra" v={fmtMoney(last.value - last.deposited)} tone="text-emerald-600" />
            </div>
            <Chart pts={pts} />
            <div className="flex gap-4 text-xs text-slate-500"><span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-5 bg-indigo-500" /> Tổng tài sản</span><span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-5 bg-slate-400" /> Tiền gốc đã gửi</span></div>
            {goal > 0 && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 space-y-1">
                <div>Để đạt <b>{fmtMoney(goal)}</b> sau {years} năm, cần gửi mỗi tháng: <b className="text-indigo-700">{fmtMoney(need)}</b></div>
                <div>{reach === null ? 'Với mức gửi hiện tại, không đạt mục tiêu trong 100 năm.' : reach === 0 ? 'Bạn đã đạt mục tiêu ngay từ đầu.' : <>Với mức gửi hiện tại ({fmtMoney(monthly)}/tháng), đạt mục tiêu sau <b>{Math.floor(reach / 12)} năm {reach % 12} tháng</b>.</>}</div>
              </div>
            )}
          </section>
        ) : <section className={card}><p className="text-sm text-slate-500">Nhập số năm từ 1/12 đến 100 và lãi suất hợp lệ.</p></section>}
      </div>
    </div>
  );
}

export default function LoanSavingsPage() {
  const [tab, setTab] = useState<'loan' | 'save'>('loan');
  return (
    <div className="space-y-3.5">
      <ToolHeader icon={Landmark} title="Vay & Tiết kiệm" desc="Lịch trả nợ khi vay ngân hàng / mua trả góp, và tính lãi kép khi gửi tiết kiệm hoặc đầu tư đều đặn." />
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
        {([['loan', 'Khoản vay / trả góp'], ['save', 'Tiết kiệm & lãi kép']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3 py-1 rounded-md ${tab === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>
        ))}
      </div>
      {tab === 'loan' ? <Loan /> : <Savings />}
    </div>
  );
}
