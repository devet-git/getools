'use client';

import { useState } from 'react';
import { Shuffle, Copy } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ToolHeader } from '@/components/ToolHeader';
import { parseNum } from '@/lib/percent';
import { parseItems, pick, randomBetween, shuffle, splitGroups } from '@/lib/random-pick';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const TABS = [
  { id: 'pick', label: 'Bốc thăm' },
  { id: 'groups', label: 'Chia nhóm' },
  { id: 'order', label: 'Xáo thứ tự' },
  { id: 'number', label: 'Số ngẫu nhiên' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default function RandomPickerPage() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<Tab>('pick');
  const [text, setText] = useState('An\nBình\nChi\nDũng\nEm\nGiang');
  const [count, setCount] = useState('1');
  const [groups, setGroups] = useState('2');
  const [lo, setLo] = useState('1');
  const [hi, setHi] = useState('100');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const items = parseItems(text);

  const run = () => {
    setError('');
    try {
      if (tab === 'number') {
        const a = parseNum(lo), b = parseNum(hi);
        if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('Nhập hai số nguyên.');
        setResult(String(randomBetween(Math.min(a, b), Math.max(a, b))));
        return;
      }
      if (items.length === 0) throw new Error('Nhập ít nhất một mục (mỗi dòng một mục).');
      if (tab === 'pick') {
        const n = parseNum(count);
        if (!Number.isInteger(n) || n < 1) throw new Error('Số lượng cần bốc phải là số nguyên ≥ 1.');
        if (n > items.length) throw new Error(`Chỉ có ${items.length} mục, không bốc được ${n}.`);
        setResult(pick(items, n).join('\n'));
      } else if (tab === 'groups') {
        const g = parseNum(groups);
        if (!Number.isInteger(g) || g < 1) throw new Error('Số nhóm phải là số nguyên ≥ 1.');
        if (g > items.length) throw new Error(`Chỉ có ${items.length} mục, không chia được ${g} nhóm.`);
        setResult(splitGroups(items, g).map((m, i) => `Nhóm ${i + 1} (${m.length}): ${m.join(', ')}`).join('\n'));
      } else {
        setResult(shuffle(items).map((x, i) => `${i + 1}. ${x}`).join('\n'));
      }
    } catch (e) { setResult(''); setError(e instanceof Error ? e.message : 'Lỗi'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(result); showToast('Đã sao chép'); } catch { showToast('Không sao chép được'); } };
  const needsList = tab !== 'number';

  return (
    <div className="space-y-3.5">
      <ToolHeader icon={Shuffle} title="Bốc thăm & chia nhóm" desc="Bốc thăm ngẫu nhiên, chia nhóm, xáo thứ tự hoặc quay số. Công bằng, chạy hoàn toàn trên trình duyệt." />
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setResult(''); setError(''); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${tab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{t.label}</button>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-3.5 items-start">
        <section className={`${card} space-y-3`}>
          {needsList ? (
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">Danh sách (mỗi dòng một mục) · {items.length} mục
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className={`${field} font-normal normal-case tracking-normal`} />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1 block">Từ<input inputMode="numeric" value={lo} onChange={(e) => setLo(e.target.value)} className={field} /></label>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1 block">Đến (gồm cả hai đầu)<input inputMode="numeric" value={hi} onChange={(e) => setHi(e.target.value)} className={field} /></label>
            </div>
          )}
          {tab === 'pick' && <label className="flex items-center gap-2 text-sm text-slate-600">Bốc <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} className={`${field} w-20`} /> mục</label>}
          {tab === 'groups' && <label className="flex items-center gap-2 text-sm text-slate-600">Chia thành <input inputMode="numeric" value={groups} onChange={(e) => setGroups(e.target.value)} className={`${field} w-20`} /> nhóm</label>}
          <button onClick={run} className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">
            {tab === 'pick' ? 'Bốc thăm' : tab === 'groups' ? 'Chia nhóm' : tab === 'order' ? 'Xáo thứ tự' : 'Quay số'}
          </button>
        </section>
        <section className={`${card} space-y-2`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Kết quả</h2>
            <button onClick={copy} disabled={!result} className="px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"><Copy className="h-3.5 w-3.5" /> Sao chép</button>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p>
            : result ? <pre className={`whitespace-pre-wrap break-words font-sans text-slate-900 ${tab === 'number' ? 'text-5xl font-bold text-center py-6' : 'text-base font-medium'}`}>{result}</pre>
            : <p className="text-sm text-slate-500">Bấm nút để có kết quả. Mỗi lần bấm là một lần ngẫu nhiên mới.</p>}
        </section>
      </div>
    </div>
  );
}
