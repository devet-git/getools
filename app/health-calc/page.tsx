'use client';

import { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import { Select } from '@/components/ui/searchable-select';
import { parseNum } from '@/lib/percent';
import { ACTIVITY, bmi, bmiCategoryAsia, bmiCategoryWho, bmr, tdee, weightRange, type Sex } from '@/lib/health';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const TONE = { ok: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-red-600' };

function Stat({ label, v, sub }: { label: string; v: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2.5 min-w-0">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-base font-bold text-slate-900 break-words">{v}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export default function HealthCalcPage() {
  const [sex, setSex] = useState<Sex>('male');
  const [age, setAge] = useState('30');
  const [cm, setCm] = useState('170');
  const [kg, setKg] = useState('65');
  const [act, setAct] = useState('light');
  const A = parseNum(age), H = parseNum(cm), W = parseNum(kg);
  const ok = A >= 15 && A <= 100 && H >= 100 && H <= 250 && W >= 20 && W <= 300;
  const b = ok ? bmi(W, H) : NaN;
  const cat = ok ? bmiCategoryAsia(b) : null;
  const base = ok ? bmr(sex, W, H, A) : NaN;
  const factor = ACTIVITY.find((x) => x.id === act)!.factor;
  const total = tdee(base, factor);
  const [lo, hi] = ok ? weightRange(H, 18.5, 22.9) : [NaN, NaN];
  const kcal = (n: number) => Math.round(n).toLocaleString('vi-VN');
  return (
    <div className="space-y-3.5">
      <ToolHeader icon={HeartPulse} title="BMI & nhu cầu calo" desc="Tính BMI theo chuẩn người châu Á, BMR và lượng calo mỗi ngày (TDEE). Chỉ mang tính tham khảo." />
      <div className="grid lg:grid-cols-2 gap-3.5 items-start">
        <section className={`${card} space-y-3`}>
          <div className="flex gap-1.5">
            {([['male', 'Nam'], ['female', 'Nữ']] as const).map(([id, l]) => (
              <button key={id} onClick={() => setSex(id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${sex === id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1 block">Tuổi<input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} className={field} /></label>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1 block">Cao (cm)<input inputMode="decimal" value={cm} onChange={(e) => setCm(e.target.value)} className={field} /></label>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1 block">Nặng (kg)<input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} className={field} /></label>
          </div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">Mức vận động
            <Select value={act} onChange={(e) => setAct(e.target.value)}>
              {ACTIVITY.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </Select>
          </label>
          <p className="text-xs text-slate-500">Dùng cho người từ 15 tuổi. Không áp dụng cho phụ nữ mang thai, vận động viên thể hình hoặc người có bệnh lý; BMI không phân biệt cơ và mỡ. Cần tư vấn hãy hỏi bác sĩ hoặc chuyên gia dinh dưỡng.</p>
        </section>
        <section className={`${card} space-y-3`}>
          {!ok || !cat ? <p className="text-sm text-red-600">Nhập tuổi 15–100, chiều cao 100–250 cm, cân nặng 20–300 kg.</p> : (
            <>
              <p className="text-lg font-bold text-slate-900">BMI {b.toFixed(1)} · <span className={TONE[cat.tone]}>{cat.label}</span></p>
              <p className="text-xs text-slate-500">Theo chuẩn WHO quốc tế: {bmiCategoryWho(b)}. Cân nặng phù hợp với bạn (BMI 18,5–22,9): {lo.toFixed(1)}–{hi.toFixed(1)} kg.</p>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="BMR (đốt khi nghỉ)" v={`${kcal(base)} kcal`} sub="Mifflin–St Jeor" />
                <Stat label="TDEE (mỗi ngày)" v={`${kcal(total)} kcal`} sub={`× ${factor}`} />
                <Stat label="Giảm cân nhẹ (−500)" v={`${kcal(Math.max(total - 500, base))} kcal`} sub="≈ −0,5 kg/tuần" />
                <Stat label="Tăng cân nhẹ (+300)" v={`${kcal(total + 300)} kcal`} />
              </div>
              <p className="text-xs text-slate-500">Mức giảm cân không nên thấp hơn BMR của bạn.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
