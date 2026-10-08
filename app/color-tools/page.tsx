'use client';

import { useEffect, useMemo, useState } from 'react';
import { Palette, Copy, Pipette, Plus, Trash2, Shuffle, Wand2, Check, X } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  parseColor, toHex, toRgbString, toHslString, toHsvString, toCmykString, exactColorName, buildPalettes, wcag,
  suggestForeground, gradientCss, gradientTailwind, randomGradient, randomHex, GRADIENT_PRESETS,
  RGBA, GradientSpec, GradientType,
} from '@/lib/color-tools';

const inputCls = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-hidden focus:border-indigo-400';
const btnCls = 'px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1.5 disabled:opacity-50';
const panel = 'bg-white rounded-xl border border-slate-200 p-4 space-y-4';

type Tab = 'pick' | 'contrast' | 'gradient';

declare global {
  interface Window { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }
}

export default function ColorToolsPage() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<Tab>('pick');
  const copy = async (s: string) => {
    try { await navigator.clipboard.writeText(s); showToast('Đã sao chép!'); } catch { showToast('Lỗi khi sao chép vào bộ nhớ tạm.'); }
  };
  const tabs: [Tab, string][] = [['pick', 'Chọn & đổi màu'], ['contrast', 'Tương phản (WCAG)'], ['gradient', 'Gradient CSS']];
  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Palette className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Màu sắc &amp; Gradient</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">Chọn màu, đổi HEX/RGB/HSL, kiểm tra tương phản WCAG và tạo gradient CSS.</p>
          </div>
        </div>
        <div className="flex gap-1 bg-slate-800 rounded-lg p-0.5">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${tab === id ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'}`}>{label}</button>
          ))}
        </div>
      </div>
      {tab === 'pick' && <Picker copy={copy} showToast={showToast} />}
      {tab === 'contrast' && <Contrast />}
      {tab === 'gradient' && <Gradient copy={copy} />}
    </div>
  );
}

function ColorInput({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const parsed = parseColor(value);
  return (
    <div>
      <span className="block text-[11px] font-medium text-slate-500 mb-1">{label}</span>
      <div className="flex gap-2">
        <input type="color" aria-label={label} value={parsed ? toHex(parsed) : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 rounded border border-slate-200 shrink-0" />
        <input className={`${inputCls} ${parsed ? '' : 'border-red-300'}`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      </div>
      {!parsed && <p className="text-[11px] text-red-600 mt-1">Màu không hợp lệ.</p>}
    </div>
  );
}

// ---------------- Chọn & đổi màu ----------------
function Swatches({ title, list, apply }: { title: string; list: string[]; apply: (s: string) => void }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-slate-500 mb-1">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {list.map((h, i) => (
          <button key={i} onClick={() => apply(h)} title={`${h} - bấm để chọn`} className="h-10 w-14 rounded-lg border border-slate-200 text-[9px] font-mono flex items-end justify-center pb-0.5 hover:scale-105 transition" style={{ background: h, color: wcag({ r: 0, g: 0, b: 0, a: 1 }, parseColor(h)!).ratio > 7 ? '#000' : '#fff' }}>{h}</button>
        ))}
      </div>
    </div>
  );
}

function Picker({ copy, showToast }: { copy: (s: string) => void; showToast: (m: string) => void }) {
  const [text, setText] = useState('#4f46e5');
  const [last, setLast] = useState<RGBA>({ r: 79, g: 70, b: 229, a: 1 });
  useEffect(() => {
    const c = readShareParams().get('color');
    const p = c ? parseColor(c) : null;
    if (c && p) setTimeout(() => { setText(c); setLast(p); }, 0);
  }, []);
  const parsed = parseColor(text);
  const color = parsed ?? last;
  const apply = (s: string) => { setText(s); const p = parseColor(s); if (p) setLast(p); };
  const palettes = useMemo(() => buildPalettes(color), [color]);
  const name = exactColorName(color);

  const eyedrop = async () => {
    if (!window.EyeDropper) { showToast('Trình duyệt không hỗ trợ công cụ lấy màu (EyeDropper).'); return; }
    try { const r = await new window.EyeDropper().open(); apply(r.sRGBHex); } catch { /* người dùng huỷ */ }
  };

  const formats: [string, string][] = [
    ['HEX', toHex(color, true)], ['RGB', toRgbString(color)], ['HSL', toHslString(color)], ['HSV', toHsvString(color)], ['CMYK', toCmykString(color)],
  ];
  return (
    <div className="grid lg:grid-cols-2 gap-3.5">
      <div className={panel}>
        <div className="flex gap-2 items-end">
          <div className="flex-1"><ColorInput label="Màu (HEX, rgb(), hsl(), hwb(), tên CSS)" value={text} onChange={apply} /></div>
          <button className={btnCls} onClick={eyedrop} title="Lấy màu từ màn hình"><Pipette className="h-3.5 w-3.5" />Chấm màu</button>
        </div>
        <div className="h-24 rounded-xl border border-slate-200" style={{ background: `repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0/16px 16px` }}>
          <div className="h-full w-full rounded-xl" style={{ background: toRgbString(color) }} />
        </div>
        {name && <p className="text-xs text-slate-500">Tên CSS: <b className="text-slate-700">{name}</b></p>}
        <div className="space-y-1.5">
          {formats.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-12 text-[11px] font-medium text-slate-500">{k}</span>
              <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 break-all">{v}</code>
              <button className={btnCls} onClick={() => copy(v)} aria-label={`Sao chép ${k}`}><Copy className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button className={btnCls} onClick={() => apply(randomHex())}><Shuffle className="h-3.5 w-3.5" />Màu ngẫu nhiên</button>
          <ShareLinkButton params={{ color: toHex(color, true) }} />
        </div>
      </div>
      <div className={panel}>
        <h2 className="text-sm font-semibold text-slate-800">Bảng màu phái sinh</h2>
        <Swatches apply={apply} title="Màu bổ túc" list={palettes.complementary} />
        <Swatches apply={apply} title="Màu tương tự" list={palettes.analogous} />
        <Swatches apply={apply} title="Bộ ba (triadic)" list={palettes.triadic} />
        <Swatches apply={apply} title="Bộ bốn (tetradic)" list={palettes.tetradic} />
        <Swatches apply={apply} title="Sắc đậm hơn (shades)" list={palettes.shades} />
        <Swatches apply={apply} title="Sắc nhạt hơn (tints)" list={palettes.tints} />
      </div>
    </div>
  );
}

// ---------------- Tương phản ----------------
function Row({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs border border-slate-200 rounded-lg px-3 py-2">
      <span className="text-slate-600">{label}</span>
      <span className={`flex items-center gap-1 font-semibold ${ok ? 'text-emerald-600' : 'text-red-600'}`}>
        {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{ok ? 'Đạt' : 'Không đạt'}
      </span>
    </div>
  );
}

function Contrast() {
  const [fgT, setFgT] = useState('#6b7280');
  const [bgT, setBgT] = useState('#ffffff');
  const fg = parseColor(fgT), bg = parseColor(bgT);
  const res = fg && bg ? wcag(fg, bg) : null;
  const suggestion = fg && bg && res && !res.aaNormal ? suggestForeground(fg, bg, 4.5) : null;

  return (
    <div className="grid lg:grid-cols-2 gap-3.5">
      <div className={panel}>
        <ColorInput label="Màu chữ (foreground)" value={fgT} onChange={setFgT} />
        <ColorInput label="Màu nền (background)" value={bgT} onChange={setBgT} />
        <button className={btnCls} onClick={() => { setFgT(bgT); setBgT(fgT); }}>Hoán đổi hai màu</button>
        {res && (
          <div className="text-center py-2">
            <div className="text-4xl font-bold text-slate-800">{res.ratio.toFixed(2)}<span className="text-lg text-slate-400"> : 1</span></div>
          </div>
        )}
        {res && (
          <div className="grid sm:grid-cols-2 gap-2">
            <Row label="AA - chữ thường (4.5)" ok={res.aaNormal} />
            <Row label="AA - chữ lớn (3)" ok={res.aaLarge} />
            <Row label="AAA - chữ thường (7)" ok={res.aaaNormal} />
            <Row label="AAA - chữ lớn (4.5)" ok={res.aaaLarge} />
            <Row label="Thành phần UI / đồ hoạ (3)" ok={res.ui} />
          </div>
        )}
        {res && !res.aaNormal && (
          <div className="bg-amber-50 text-amber-800 text-xs rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
            {suggestion ? (<>
              <Wand2 className="h-4 w-4" /> Gợi ý: đổi màu chữ thành <b>{toHex(suggestion)}</b> ({wcag(suggestion, bg!).ratio.toFixed(2)}:1) để đạt AA.
              <button className={btnCls} onClick={() => setFgT(toHex(suggestion))}>Áp dụng</button>
            </>) : 'Không thể đạt AA chỉ bằng cách chỉnh độ sáng của màu chữ; hãy đổi màu nền.'}
          </div>
        )}
      </div>
      <div className={panel}>
        <h2 className="text-sm font-semibold text-slate-800">Xem thử</h2>
        <div className="rounded-xl border border-slate-200 p-5 space-y-3" style={{ background: bg ? toRgbString(bg) : undefined, color: fg ? toRgbString(fg) : undefined }}>
          <p className="text-2xl font-bold">Chữ lớn đậm 24px</p>
          <p className="text-base">Chữ thường 16px: Thử nghiệm độ dễ đọc của văn bản.</p>
          <p className="text-xs">Chữ nhỏ 12px: Quick brown fox jumps over the lazy dog.</p>
          <button className="px-3 py-1.5 rounded-lg text-sm font-medium border-2 border-current">Nút bấm</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Gradient ----------------
function Gradient({ copy }: { copy: (s: string) => void }) {
  const [g, setG] = useState<GradientSpec>(GRADIENT_PRESETS[2].spec);
  const css = gradientCss(g);
  const bgDecl = `background: ${css};`;
  const tw = gradientTailwind(g);
  const setStop = (i: number, patch: Partial<GradientSpec['stops'][number]>) =>
    setG((p) => ({ ...p, stops: p.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const addStop = () => setG((p) => ({ ...p, stops: [...p.stops, { color: randomHex(), pos: 100 }] }));
  const removeStop = (i: number) => setG((p) => (p.stops.length <= 2 ? p : { ...p, stops: p.stops.filter((_, j) => j !== i) }));

  return (
    <div className="grid lg:grid-cols-2 gap-3.5">
      <div className={panel}>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="block text-[11px] font-medium text-slate-500 mb-1">Kiểu</span>
            <div className="flex gap-1">
              {([['linear', 'Tuyến tính'], ['radial', 'Tròn'], ['conic', 'Nón']] as [GradientType, string][]).map(([t, l]) => (
                <button key={t} onClick={() => setG((p) => ({ ...p, type: t }))}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${g.type === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>{l}</button>
              ))}
            </div>
          </div>
          {g.type !== 'radial' && (
            <div className="flex-1 min-w-40">
              <span className="block text-[11px] font-medium text-slate-500 mb-1">Góc: {g.angle}°</span>
              <input type="range" min={0} max={360} value={g.angle} onChange={(e) => setG((p) => ({ ...p, angle: +e.target.value }))} className="w-full" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          {g.stops.map((s, i) => {
            const pc = parseColor(s.color);
            return (
              <div key={i} className="flex items-center gap-2">
                <input type="color" aria-label={`Màu ${i + 1}`} value={pc ? toHex(pc) : '#000000'} onChange={(e) => setStop(i, { color: e.target.value })} className="h-8 w-10 rounded border border-slate-200 shrink-0" />
                <input className={`${inputCls} w-28 shrink-0 ${pc ? '' : 'border-red-300'}`} value={s.color} onChange={(e) => setStop(i, { color: e.target.value })} spellCheck={false} />
                <input type="range" min={0} max={100} value={s.pos} onChange={(e) => setStop(i, { pos: +e.target.value })} className="flex-1 min-w-16" aria-label={`Vị trí ${i + 1}`} />
                <input type="number" min={0} max={100} value={s.pos} onChange={(e) => setStop(i, { pos: Math.min(100, Math.max(0, +e.target.value || 0)) })} className={`${inputCls} w-16 shrink-0`} />
                <button className={btnCls} onClick={() => removeStop(i)} disabled={g.stops.length <= 2} aria-label="Xoá điểm màu"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className={btnCls} onClick={addStop} disabled={g.stops.length >= 10}><Plus className="h-3.5 w-3.5" />Thêm điểm màu</button>
          <button className={btnCls} onClick={() => setG(randomGradient())}><Shuffle className="h-3.5 w-3.5" />Ngẫu nhiên</button>
        </div>
        <div>
          <p className="text-[11px] font-medium text-slate-500 mb-1">Mẫu có sẵn</p>
          <div className="flex flex-wrap gap-1.5">
            {GRADIENT_PRESETS.map((p) => (
              <button key={p.name} onClick={() => setG(p.spec)} title={p.name} className="h-9 w-20 rounded-lg border border-slate-200 text-[10px] font-medium text-white drop-shadow" style={{ background: gradientCss(p.spec) }}>{p.name}</button>
            ))}
          </div>
        </div>
      </div>
      <div className={panel}>
        <div className="h-48 rounded-xl border border-slate-200" style={{ background: css }} />
        {[['CSS', bgDecl], ['Tailwind', tw]].map(([k, v]) => (
          <div key={k}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-slate-500">{k}</span>
              <button className={btnCls} onClick={() => copy(v)}><Copy className="h-3.5 w-3.5" />Sao chép</button>
            </div>
            <code className="block text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5 break-all">{v}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
