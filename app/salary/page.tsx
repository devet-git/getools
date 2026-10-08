'use client';

import { useEffect, useMemo, useState } from 'react';
import { Wallet, Info } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import { MoneyInput } from '@/components/MoneyInput';
import { Select } from '@/components/ui/searchable-select';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import { fmtMoney } from '@/lib/split-bill';
import { REGIONS, RULES, grossToNet, netToGross } from '@/lib/vn-salary';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const pct = (x: number) => (x * 100).toFixed(1).replace('.', ',') + '%';

function fromUrl() {
  const q = readShareParams();
  if (![...q.keys()].length) return null;
  return {
    dir: q.get('dir') === 'net' ? ('net' as const) : ('gross' as const),
    amount: Number(q.get('a')) || 25_000_000,
    dep: Math.min(10, Number(q.get('dep')) || 0),
    rule: q.get('rule') === '2024' ? '2024' : '2026',
    region: REGIONS[q.get('reg') ?? ''] ? (q.get('reg') as string) : '1',
    insured: q.get('ins') !== '0',
  };
}

export default function SalaryPage() {
  const [dir, setDir] = useState<'gross' | 'net'>('gross');
  const [amount, setAmount] = useState(25_000_000);
  const [dep, setDep] = useState(0);
  const [ruleId, setRuleId] = useState('2026');
  const [region, setRegion] = useState('1');
  const [insured, setInsured] = useState(true);
  const [base, setBase] = useState(0);
  const [amountKey, setAmountKey] = useState(0);

  useEffect(() => {
    const u = fromUrl();
    if (!u) return;
     
    setDir(u.dir); setAmount(u.amount); setDep(u.dep); setRuleId(u.rule); setRegion(u.region); setInsured(u.insured);
    setAmountKey((k) => k + 1);
     
  }, []);

  const rules = RULES.find((r) => r.id === ruleId) ?? RULES[0];
  const regionMin = ruleId === '2024' ? REGIONS[region].min2024 : REGIONS[region].min2026;
  const common = { dependents: dep, insured, insuranceBase: base, regionMin };
  const res = useMemo(
    () => (dir === 'gross' ? grossToNet({ ...common, gross: amount }, rules) : netToGross(amount, common, rules)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dir, amount, dep, ruleId, region, insured, base],
  );

  const Row = ({ label, v, tone, bold }: { label: string; v: number; tone?: string; bold?: boolean }) => (
    <tr className="border-t border-slate-100">
      <td className={`py-1.5 ${bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{label}</td>
      <td className={`py-1.5 text-right ${bold ? 'font-bold' : ''} ${tone ?? 'text-slate-800'}`}>{fmtMoney(v)}</td>
    </tr>
  );

  return (
    <div className="space-y-3.5">
      <ToolHeader icon={Wallet} title="Lương Gross ⇄ Net" desc="Tính lương thực nhận sau bảo hiểm và thuế TNCN, hoặc tính ngược từ số tiền muốn nhận về.">
        <ShareLinkButton params={{ dir, a: String(amount), dep: String(dep), rule: ruleId, reg: region, ins: insured ? '1' : '0' }} />
      </ToolHeader>

      <div className="grid lg:grid-cols-2 gap-3.5 items-start">
        <section className={`${card} space-y-3`}>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
            {(['gross', 'net'] as const).map((d) => (
              <button key={d} onClick={() => setDir(d)} className={`px-3 py-1 rounded-md ${dir === d ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {d === 'gross' ? 'Gross → Net' : 'Net → Gross'}
              </button>
            ))}
          </div>
          <label className="block text-sm text-slate-600">
            {dir === 'gross' ? 'Lương Gross (trước thuế & bảo hiểm) mỗi tháng' : 'Lương Net muốn nhận mỗi tháng'}
            <div className="mt-1"><MoneyInput key={amountKey} value={amount} onChange={setAmount} placeholder="vd. 25tr" /></div>
          </label>
          <div className="grid sm:grid-cols-2 gap-2.5 text-sm text-slate-600">
            <label className="flex items-center gap-2">Người phụ thuộc
              <Select value={String(dep)} onChange={(e) => setDep(Number(e.target.value))}>
                {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
              </Select>
            </label>
            <label className="flex items-center gap-2">Vùng
              <Select value={region} onChange={(e) => setRegion(e.target.value)}>
                {Object.entries(REGIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
            </label>
          </div>
          <label className="block text-sm text-slate-600">Quy định áp dụng
            <div className="mt-1">
              <Select value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
                {RULES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </div>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={insured} onChange={(e) => setInsured(e.target.checked)} /> Đóng bảo hiểm bắt buộc (BHXH, BHYT, BHTN)
          </label>
          {insured && (
            <label className="block text-sm text-slate-600">Lương đóng bảo hiểm (để trống = bằng Gross)
              <div className="mt-1"><MoneyInput value={base} onChange={setBase} placeholder="tùy chọn" /></div>
            </label>
          )}
          <div className="flex gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>Chỉ để tham khảo cho lương theo hợp đồng lao động. Mức giảm trừ, bậc thuế và lương tối thiểu vùng thay đổi theo từng thời kỳ — hãy đối chiếu với văn bản hiện hành hoặc phòng nhân sự trước khi dùng cho việc quan trọng.</p>
          </div>
        </section>

        <section className={`${card} space-y-3`}>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg bg-indigo-50 p-3">
              <div className="text-xs text-indigo-700">Lương Net (thực nhận)</div>
              <div className="text-xl font-bold text-indigo-900 break-words">{fmtMoney(res.net)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-600">Lương Gross</div>
              <div className="text-xl font-bold text-slate-900 break-words">{fmtMoney(res.gross)}</div>
            </div>
          </div>
          <table className="w-full text-sm">
            <tbody>
              <Row label="Lương Gross" v={res.gross} bold />
              <Row label="BHXH (8%)" v={-res.bhxh} tone="text-red-600" />
              <Row label="BHYT (1,5%)" v={-res.bhyt} tone="text-red-600" />
              <Row label="BHTN (1%)" v={-res.bhtn} tone="text-red-600" />
              <Row label="Thu nhập chịu thuế" v={res.income} />
              <Row label={`Giảm trừ (bản thân${dep ? ` + ${dep} phụ thuộc` : ''})`} v={-res.deductions} tone="text-slate-500" />
              <Row label="Thu nhập tính thuế" v={res.taxable} />
              <Row label="Thuế TNCN" v={-res.tax} tone="text-red-600" />
              <Row label="Lương Net" v={res.net} tone="text-indigo-700" bold />
            </tbody>
          </table>
          <p className="text-xs text-slate-500">Tổng khấu trừ {pct(res.effectiveRate)} lương Gross.</p>

          {res.lines.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 mb-1">Thuế theo bậc</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Bậc</th><th className="py-1 font-medium text-right">Thuế suất</th><th className="py-1 font-medium text-right">Phần thu nhập</th><th className="py-1 font-medium text-right">Thuế</th></tr></thead>
                  <tbody>
                    {res.lines.map((l, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="py-1 text-slate-600">{i + 1}. đến {Number.isFinite(l.to) ? fmtMoney(l.to) : '∞'}</td>
                        <td className="py-1 text-right">{pct(l.rate)}</td><td className="py-1 text-right">{fmtMoney(l.taxable)}</td><td className="py-1 text-right font-medium">{fmtMoney(l.tax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {insured && (
            <div className="rounded-lg border border-slate-200 p-2.5 text-xs text-slate-600 space-y-0.5">
              <div className="font-semibold text-slate-700">Chi phí công ty chịu thêm (tham khảo)</div>
              <div>BHXH 17,5% + BHYT 3% + BHTN 1% = <b>{fmtMoney(res.employer.total)}</b></div>
              <div>Tổng chi phí công ty trả cho bạn: <b>{fmtMoney(res.employer.cost)}</b></div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
