'use client';

import { useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import {
  type YMD, WEEKDAYS, addWorkdays, canChiYear, computeAge, countWorkdays, formatVN, fromDays, isValidYMD,
  lunarToSolar, parseISODate, solarToLunar, toDays, toISODate, todayYMD, vietnamHolidays, weekdayOf,
} from '@/lib/date-calc';
import { Select } from '@/components/ui/searchable-select';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const TABS = [
  { id: 'age', label: 'Tuổi & sinh nhật' },
  { id: 'countdown', label: 'Đếm ngược' },
  { id: 'work', label: 'Ngày làm việc' },
  { id: 'lunar', label: 'Âm ↔ Dương lịch' },
  { id: 'holiday', label: 'Ngày lễ' },
] as const;
type Tab = (typeof TABS)[number]['id'];

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2.5 min-w-0">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-base font-bold text-slate-900 break-words">{v}</div>
    </div>
  );
}

const Err = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-red-600">{children}</p>;

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm text-slate-600 space-y-1">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-700">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={field} />
    </label>
  );
}

const describe = (v: YMD) => `${WEEKDAYS[weekdayOf(v)]}, ${formatVN(v)}`;

function Age({ today }: { today: YMD }) {
  const [birth, setBirth] = useState('1995-08-20');
  const [on, setOn] = useState(toISODate(today));
  const b = parseISODate(birth), o = parseISODate(on);
  const r = b && o ? computeAge(b, o) : null;
  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <DateField label="Ngày sinh" value={birth} onChange={setBirth} />
        <DateField label="Tính đến ngày" value={on} onChange={setOn} />
        <p className="text-xs text-slate-500">Người sinh 29/2 được tính sinh nhật vào 28/2 ở năm không nhuận.</p>
      </section>
      <section className={`${card} space-y-3`}>
        {!b || !o ? <Err>Nhập ngày hợp lệ.</Err> : !r ? <Err>Ngày sinh phải trước ngày cần tính.</Err> : (
          <>
            <p className="text-lg font-bold text-slate-900">{r.years} tuổi {r.months} tháng {r.days} ngày</p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Tổng số ngày đã sống" v={r.totalDays.toLocaleString('vi-VN')} />
              <Stat label="Tổng số tuần" v={r.totalWeeks.toLocaleString('vi-VN')} />
              <Stat label="Tổng số tháng" v={r.totalMonths.toLocaleString('vi-VN')} />
              <Stat label="Sinh vào" v={WEEKDAYS[r.birthWeekday]} />
              <Stat label={`Sinh nhật lần thứ ${r.nextAge}`} v={r.daysToNextBirthday === 0 ? 'Hôm nay! 🎂' : `còn ${r.daysToNextBirthday} ngày`} />
              <Stat label="Rơi vào" v={describe(r.nextBirthday)} />
            </div>
            {solarToLunar(b) && (
              <p className="text-xs text-slate-500">Âm lịch ngày sinh: {solarToLunar(b)!.day}/{solarToLunar(b)!.month}{solarToLunar(b)!.leap ? ' (nhuận)' : ''} năm {canChiYear(solarToLunar(b)!.year)}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Countdown({ today }: { today: YMD }) {
  const [target, setTarget] = useState(toISODate({ y: today.y + 1, m: 1, d: 1 }));
  const [label, setLabel] = useState('Tết Dương lịch');
  const t = parseISODate(target);
  const diff = t ? toDays(t) - toDays(today) : null;
  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <label className="block text-sm space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Sự kiện</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={field} placeholder="vd. Thi cuối kỳ" />
        </label>
        <DateField label="Ngày diễn ra" value={target} onChange={setTarget} />
        <div className="flex flex-wrap gap-1.5">
          {[['Tết Dương lịch', { y: today.y + 1, m: 1, d: 1 }], ['Quốc khánh', { y: today.m > 9 ? today.y + 1 : today.y, m: 9, d: 2 }], ['Giáng sinh', { y: today.m === 12 && today.d > 25 ? today.y + 1 : today.y, m: 12, d: 25 }]].map(([n, v]) => (
            <button key={n as string} onClick={() => { setLabel(n as string); setTarget(toISODate(v as YMD)); }} className="px-2 py-0.5 rounded-full text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">{n as string}</button>
          ))}
        </div>
      </section>
      <section className={`${card} space-y-3`}>
        {!t || diff === null ? <Err>Nhập ngày hợp lệ.</Err> : (
          <>
            <p className="text-lg font-bold text-slate-900">
              {diff === 0 ? `${label || 'Sự kiện'} diễn ra hôm nay` : diff > 0 ? `Còn ${diff.toLocaleString('vi-VN')} ngày đến ${label || 'sự kiện'}` : `${label || 'Sự kiện'} đã qua ${(-diff).toLocaleString('vi-VN')} ngày`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Số tuần" v={`${Math.floor(Math.abs(diff) / 7)} tuần ${Math.abs(diff) % 7} ngày`} />
              <Stat label="Rơi vào" v={describe(t)} />
              <Stat label="Ngày làm việc (T2–T6, trừ lễ)" v={diff >= 0 ? String(countWorkdays(today, t, { saturdayWork: false, useHolidays: true, extraHolidays: [] })) : '—'} />
              <Stat label="Hôm nay" v={describe(today)} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function parseExtra(text: string): YMD[] {
  return text.split(/[\s,;]+/).map((s) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    return m ? { y: +m[3], m: +m[2], d: +m[1] } : null;
  }).filter((v): v is YMD => !!v && isValidYMD(v));
}

function Work({ today }: { today: YMD }) {
  const [from, setFrom] = useState(toISODate(today));
  const [to, setTo] = useState(toISODate(fromDays(toDays(today) + 30)));
  const [n, setN] = useState('10');
  const [sat, setSat] = useState(false);
  const [hol, setHol] = useState(true);
  const [extra, setExtra] = useState('');
  const f = parseISODate(from), t = parseISODate(to);
  const opts = useMemo(() => ({ saturdayWork: sat, useHolidays: hol, extraHolidays: parseExtra(extra) }), [sat, hol, extra]);
  const count = f && t ? countWorkdays(f, t, opts) : null;
  const nn = Number(n);
  const added = f && Number.isInteger(nn) && Math.abs(nn) <= 5000 ? addWorkdays(f, nn, opts) : null;
  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <DateField label="Từ ngày" value={from} onChange={setFrom} />
        <DateField label="Đến ngày (gồm cả hai đầu)" value={to} onChange={setTo} />
        <label className="block text-sm space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Cộng/trừ số ngày làm việc từ &quot;Từ ngày&quot;</span>
          <input value={n} onChange={(e) => setN(e.target.value)} inputMode="numeric" className={field} placeholder="vd. 10 hoặc -5" />
        </label>
        <div className="space-y-1.5 text-sm text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={hol} onChange={(e) => setHol(e.target.checked)} /> Trừ ngày lễ Việt Nam theo luật</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={sat} onChange={(e) => setSat(e.target.checked)} /> Thứ Bảy là ngày làm việc</label>
        </div>
        <label className="block text-sm space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Ngày nghỉ thêm (dd/mm/yyyy, cách nhau bằng dấu cách)</span>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} className={field} placeholder="vd. 26/1/2026 27/1/2026" />
        </label>
        <p className="text-xs text-slate-500">Chỉ tính các ngày lễ theo luật; ngày nghỉ bù do Chính phủ công bố từng năm cần nhập ở ô trên.</p>
      </section>
      <section className={`${card} space-y-3`}>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Số ngày làm việc trong khoảng" v={count === null ? '—' : count.toLocaleString('vi-VN')} />
          <Stat label="Tổng số ngày lịch" v={f && t ? String(Math.max(0, toDays(t) - toDays(f) + 1)) : '—'} />
        </div>
        {added ? <p className="text-sm text-slate-700">Sau <b>{nn}</b> ngày làm việc: <b className="text-base text-slate-900">{describe(added)}</b></p>
          : <Err>Số ngày làm việc phải là số nguyên (tối đa ±5000).</Err>}
      </section>
    </div>
  );
}

function Lunar({ today }: { today: YMD }) {
  const [mode, setMode] = useState<'s2l' | 'l2s'>('s2l');
  const [solar, setSolar] = useState(toISODate(today));
  const [ly, setLy] = useState(String(today.y));
  const [lm, setLm] = useState('1');
  const [ld, setLd] = useState('1');
  const [leap, setLeap] = useState(false);
  const s = parseISODate(solar);
  const l = s ? solarToLunar(s) : null;
  const back = mode === 'l2s' && Number(ly) >= 1900 ? lunarToSolar({ year: Number(ly), month: Number(lm), day: Number(ld), leap }) : null;
  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <Select value={mode} onChange={(e) => setMode(e.target.value as 's2l' | 'l2s')}>
          <option value="s2l">Dương lịch → Âm lịch</option><option value="l2s">Âm lịch → Dương lịch</option>
        </Select>
        {mode === 's2l' ? <DateField label="Ngày dương lịch" value={solar} onChange={setSolar} /> : (
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs font-bold text-slate-700">Ngày<input value={ld} onChange={(e) => setLd(e.target.value)} inputMode="numeric" className={field} /></label>
            <label className="text-xs font-bold text-slate-700">Tháng<input value={lm} onChange={(e) => setLm(e.target.value)} inputMode="numeric" className={field} /></label>
            <label className="text-xs font-bold text-slate-700">Năm<input value={ly} onChange={(e) => setLy(e.target.value)} inputMode="numeric" className={field} /></label>
            <label className="col-span-3 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={leap} onChange={(e) => setLeap(e.target.checked)} /> Tháng nhuận</label>
          </div>
        )}
        <p className="text-xs text-slate-500">Dựa trên lịch âm của trình duyệt (múi giờ UTC+8). Rất hiếm khi lệch 1 ngày so với lịch Việt Nam (UTC+7); với việc quan trọng như giỗ, cưới hỏi hãy đối chiếu thêm.</p>
      </section>
      <section className={`${card} space-y-2`}>
        {mode === 's2l' ? (!s ? <Err>Nhập ngày hợp lệ.</Err> : !l ? <Err>Trình duyệt này không hỗ trợ lịch âm.</Err> : (
          <>
            <p className="text-lg font-bold text-slate-900">Ngày {l.day} tháng {l.month}{l.leap ? ' (nhuận)' : ''} năm {canChiYear(l.year)}</p>
            <p className="text-sm text-slate-600">{describe(s)}</p>
          </>
        )) : back ? (
          <>
            <p className="text-lg font-bold text-slate-900">{describe(back)}</p>
            <p className="text-sm text-slate-600">Năm âm lịch {canChiYear(Number(ly))}</p>
          </>
        ) : <Err>Không có ngày âm lịch này (kiểm tra ngày 1–30, tháng 1–12, tháng nhuận có tồn tại không).</Err>}
      </section>
    </div>
  );
}

function Holidays({ today }: { today: YMD }) {
  const [year, setYear] = useState(String(today.y));
  const y = Number(year);
  const list = Number.isInteger(y) && y >= 1900 && y <= 2100 ? vietnamHolidays(y) : null;
  return (
    <section className={`${card} space-y-3 max-w-2xl`}>
      <label className="flex items-center gap-2 text-sm text-slate-600">Năm
        <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" className={`${field} w-28`} />
      </label>
      {list ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {list.map((h) => (
            <li key={h.name + toDays(h.date)} className="flex justify-between gap-3 py-1.5">
              <span className="text-slate-700">{h.name}</span><span className="font-mono text-slate-900">{describe(h.date)}</span>
            </li>
          ))}
        </ul>
      ) : <Err>Nhập năm từ 1900 đến 2100.</Err>}
      <p className="text-xs text-slate-500">Chỉ gồm ngày nghỉ theo luật. Ngày nghỉ bù (vd. dời sang thứ Hai) do Chính phủ công bố từng năm nên không có ở đây.</p>
    </section>
  );
}

export default function DateCalcPage() {
  const [tab, setTab] = useState<Tab>('age');
  const [today] = useState(() => todayYMD());
  return (
    <div className="space-y-3.5">
      <ToolHeader icon={CalendarDays} title="Tuổi, đếm ngược & ngày làm việc" desc="Tính tuổi, đếm ngược sự kiện, ngày làm việc trừ lễ Việt Nam và đổi âm ↔ dương lịch." />
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${tab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'age' && <Age today={today} />}
      {tab === 'countdown' && <Countdown today={today} />}
      {tab === 'work' && <Work today={today} />}
      {tab === 'lunar' && <Lunar today={today} />}
      {tab === 'holiday' && <Holidays today={today} />}
    </div>
  );
}
