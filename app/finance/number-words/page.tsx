'use client';

import { useMemo, useState } from 'react';
import { Speech, Copy } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ToolHeader } from '@/components/ToolHeader';
import { Select } from '@/components/ui/searchable-select';
import { numberToWords, parseNumberInput } from '@/lib/vn-number';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const EXAMPLES = ['1.250.000', '2tr5', '15.000.000.000', '1005', '3,5'];

export default function NumberWordsPage() {
  const { showToast } = useApp();
  const [input, setInput] = useState('1.250.000');
  const [lang, setLang] = useState<'vi' | 'en'>('vi');
  const [unit, setUnit] = useState('đồng');
  const [capitalize, setCapitalize] = useState(true);
  const [chan, setChan] = useState(true);

  const parsed = useMemo(() => parseNumberInput(input), [input]);
  const words = useMemo(
    () => (parsed ? numberToWords(parsed, { lang, unit, capitalize, suffixChan: chan && lang === 'vi' && !!unit.trim() }) : ''),
    [parsed, lang, unit, capitalize, chan],
  );
  const tooBig = parsed && parsed.int > BigInt('999999999999999999999999');

  const copy = async () => {
    try { await navigator.clipboard.writeText(words); showToast('Đã sao chép'); } catch { showToast('Không sao chép được'); }
  };

  return (
    <div className="space-y-3.5">
      <ToolHeader icon={Speech} title="Đọc số thành chữ" desc="Viết số tiền bằng chữ cho hợp đồng, phiếu chi, hóa đơn. Hỗ trợ tiếng Việt và tiếng Anh." />
      <div className="grid lg:grid-cols-2 gap-3.5 items-start">
        <section className={`${card} space-y-3`}>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">Số cần đọc</label>
          <input autoFocus inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} placeholder="vd. 1.250.000 hoặc 2tr5"
            className="w-full px-3 py-2.5 text-lg font-mono rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500" />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((x) => (
              <button key={x} onClick={() => setInput(x)} className="px-2 py-0.5 rounded-full text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 font-mono">{x}</button>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5 text-sm text-slate-600">
            <label className="flex items-center gap-2">Ngôn ngữ
              <Select value={lang} onChange={(e) => { const v = e.target.value as 'vi' | 'en'; setLang(v); setUnit(v === 'vi' ? 'đồng' : 'dollars'); }}>
                <option value="vi">Tiếng Việt</option><option value="en">English</option>
              </Select>
            </label>
            <label className="flex items-center gap-2">Đơn vị
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="đồng, USD, kg..." className="flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500" />
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={capitalize} onChange={(e) => setCapitalize(e.target.checked)} /> Viết hoa chữ đầu</label>
            {lang === 'vi' && <label className="flex items-center gap-2"><input type="checkbox" checked={chan} onChange={(e) => setChan(e.target.checked)} /> Thêm &quot;chẵn&quot; sau số tiền</label>}
          </div>
          <p className="text-xs text-slate-500">Nhận 1.234.567,89 · 1,234,567.89 · 2tr · 1.5tr · 500k · 3 tỷ. Số âm và phần thập phân được đọc theo từng chữ số.</p>
        </section>

        <section className={`${card} space-y-3`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Kết quả</h2>
            <button onClick={copy} disabled={!words} className="px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"><Copy className="h-3.5 w-3.5" /> Sao chép</button>
          </div>
          {!input.trim() ? <p className="text-sm text-slate-500">Nhập một số để bắt đầu.</p>
            : !parsed ? <p className="text-sm text-red-600">Không hiểu số này. Chỉ nhập chữ số, dấu chấm/phẩy và hậu tố k, tr, tỷ.</p>
            : tooBig ? <p className="text-sm text-red-600">Số quá lớn (tối đa 24 chữ số).</p>
            : <p className="text-lg leading-relaxed text-slate-900 font-medium break-words">{words}</p>}
          {parsed && !tooBig && (
            <p className="text-xs text-slate-500 font-mono break-all">
              = {parsed.neg ? '-' : ''}{parsed.int.toLocaleString('vi-VN')}{parsed.frac ? ',' + parsed.frac : ''}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
