'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LayoutGrid, Copy, Check, Plus, Trash2, Eraser, Wand2 } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  COMMON_BREAKPOINTS,
  CSS_UNITS,
  DEFAULT_FLEX_CONTAINER,
  DEFAULT_GRID,
  DEFAULT_UNIT_CTX,
  SCALE_RATIOS,
  SHADOW_PRESETS,
  TEXT_SHADOW_PRESETS,
  areasToCss,
  convertCssUnits,
  convertUnit,
  declsToStyle,
  evalFluid,
  extractSelectors,
  flexContainerDecls,
  flexCss,
  flexHtml,
  flexItemDecls,
  flexTailwind,
  fluidClamp,
  fmtNum,
  gridContainerDecls,
  gridCss,
  gridHtml,
  gridItemDecls,
  gridTailwind,
  hasAutoRepeat,
  newFlexItem,
  newGridItem,
  newTrack,
  radiusTailwind,
  radiusValue,
  rankSelectors,
  resizeAreas,
  sanitizeAreaName,
  shadowTailwind,
  shadowValue,
  specificityOf,
  typeScale,
  validateAreas,
  type CssUnit,
  type FlexContainer,
  type FlexItem,
  type GridContainer,
  type GridItem,
  type Radius,
  type ShadowLayer,
  type Track,
  type TrackKind,
} from '@/lib/css-tools';

/* ------------------------------ helpers UI ------------------------------ */

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs';
const inputCls =
  'w-full px-2 py-1 text-xs rounded-md border border-slate-200 bg-white text-slate-800 focus:border-indigo-500 outline-hidden';
const btnCls =
  'px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1';

function useCopy() {
  const { showToast } = useApp();
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return {
    done,
    copy: async (text: string, id = 'x') => {
      try {
        await navigator.clipboard.writeText(text);
        setDone(id);
        showToast('Đã sao chép!');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(null), 1500);
      } catch {
        showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
      }
    },
  };
}

function CodeBlock({ title, code, light }: { title: string; code: string; light?: boolean }) {
  const { copy, done } = useCopy();
  return (
    <div className="rounded-lg overflow-hidden border border-slate-200">
      <div className="flex items-center justify-between px-2.5 py-1 bg-slate-100 border-b border-slate-200">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">{title}</span>
        <button type="button" onClick={() => copy(code, title)} className={btnCls}>
          {done === title ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          Sao chép
        </button>
      </div>
      <pre
        className={`p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-72 overflow-auto ${
          light ? 'bg-slate-50 text-slate-800' : 'bg-slate-900 text-slate-100'
        }`}
      >
        {code}
      </pre>
    </div>
  );
}

function Num({
  label, value, onChange, min, max, step = 1, suffix,
}: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <label className="block text-[11px] font-medium text-slate-600">
      {label}
      <div className="flex items-center gap-1 mt-0.5">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          className={inputCls}
        />
        {suffix && <span className="text-[11px] text-slate-400">{suffix}</span>}
      </div>
    </label>
  );
}

function Sel<T extends string>({
  label, value, onChange, options,
}: {
  label: string; value: T; onChange: (v: T) => void; options: (T | { value: T; label: string })[];
}) {
  return (
    <label className="block text-[11px] font-medium text-slate-600">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={`${inputCls} mt-0.5`}>
        {options.map((o) => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </label>
  );
}

function Txt({ label, value, onChange, placeholder, list }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; list?: string[] }) {
  const id = useId();
  return (
    <label className="block text-[11px] font-medium text-slate-600">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} list={list ? id : undefined} className={`${inputCls} mt-0.5`} />
      {list && <datalist id={id}>{list.map((x) => <option key={x} value={x} />)}</datalist>}
    </label>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-xs rounded-md font-medium transition ${
            value === o.value ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const ITEM_COLORS = [
  'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500', 'bg-teal-500', 'bg-orange-500',
];

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-slate-500 bg-amber-50 border border-amber-100 rounded-md px-2 py-1">Mẹo: {children}</p>;
}

/* ------------------------------ FLEXBOX ------------------------------ */

function FlexTab() {
  const [c, setC] = useState<FlexContainer>(DEFAULT_FLEX_CONTAINER);
  const [items, setItems] = useState<FlexItem[]>(() => [1, 2, 3].map((i) => ({ ...newFlexItem(i), height: i === 2 ? '60px' : 'auto' })));
  const [sel, setSel] = useState<number>(1);
  const nextId = useRef(4);
  const cur = items.find((i) => i.id === sel) ?? null;
  const up = <K extends keyof FlexContainer>(k: K, v: FlexContainer[K]) => setC((p) => ({ ...p, [k]: v }));
  const upItem = (patch: Partial<FlexItem>) => setItems((p) => p.map((i) => (i.id === sel ? { ...i, ...patch } : i)));

  const add = () => {
    if (items.length >= 24) return;
    const id = nextId.current++;
    setItems((p) => [...p, newFlexItem(id)]);
    setSel(id);
  };
  const remove = () => {
    if (!cur) return;
    const rest = items.filter((i) => i.id !== cur.id);
    setItems(rest);
    setSel(rest[0]?.id ?? -1);
  };

  const css = flexCss(c, items);
  const tw = flexTailwind(c, items);
  const html = flexHtml(c, items);
  const cStyle = declsToStyle(flexContainerDecls(c));

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-3">
      <div className={`${card} p-3 space-y-2.5`}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Container</h3>
        <div className="grid grid-cols-2 gap-2">
          <Sel label="flex-direction" value={c.direction} onChange={(v) => up('direction', v)} options={['row', 'row-reverse', 'column', 'column-reverse']} />
          <Sel label="flex-wrap" value={c.wrap} onChange={(v) => up('wrap', v)} options={['nowrap', 'wrap', 'wrap-reverse']} />
          <Sel label="justify-content" value={c.justify} onChange={(v) => up('justify', v)} options={['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly']} />
          <Sel label="align-items" value={c.alignItems} onChange={(v) => up('alignItems', v)} options={['stretch', 'flex-start', 'flex-end', 'center', 'baseline']} />
          <Sel label="align-content" value={c.alignContent} onChange={(v) => up('alignContent', v)} options={['normal', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch']} />
          <div />
          <Num label="row-gap" value={c.rowGap} onChange={(n) => up('rowGap', n)} min={0} suffix="px" />
          <Num label="column-gap" value={c.colGap} onChange={(n) => up('colGap', n)} min={0} suffix="px" />
          <Txt label="Chiều rộng" value={c.width} onChange={(v) => up('width', v)} list={['auto', '100%', '75%', '50%', '600px', '400px', '320px']} />
          <Txt label="Chiều cao" value={c.height} onChange={(v) => up('height', v)} list={['auto', '120px', '220px', '320px', '50vh']} />
        </div>
        <Tip>với wrap, align-content mới có tác dụng; còn một dòng thì dùng align-items.</Tip>
        <div className="border-t border-slate-100 pt-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Item {cur ? `#${items.indexOf(cur) + 1}` : ''}</h3>
            <div className="flex gap-1">
              <button type="button" onClick={add} className={btnCls}><Plus className="h-3 w-3" />Thêm</button>
              <button type="button" onClick={remove} disabled={!cur} className={`${btnCls} disabled:opacity-40`}><Trash2 className="h-3 w-3" />Xóa</button>
            </div>
          </div>
          {cur ? (
            <div className="grid grid-cols-2 gap-2">
              <Num label="flex-grow" value={cur.grow} onChange={(n) => upItem({ grow: n })} min={0} step={0.5} />
              <Num label="flex-shrink" value={cur.shrink} onChange={(n) => upItem({ shrink: n })} min={0} step={0.5} />
              <Txt label="flex-basis" value={cur.basis} onChange={(v) => upItem({ basis: v })} list={['auto', '0', '100px', '200px', '25%', '50%', '100%']} />
              <Sel label="align-self" value={cur.alignSelf} onChange={(v) => upItem({ alignSelf: v })} options={['auto', 'flex-start', 'flex-end', 'center', 'baseline', 'stretch']} />
              <Num label="order" value={cur.order} onChange={(n) => upItem({ order: n })} />
              <div />
              <Txt label="width" value={cur.width} onChange={(v) => upItem({ width: v })} list={['auto', '60px', '80px', '120px', '30%']} />
              <Txt label="height" value={cur.height} onChange={(v) => upItem({ height: v })} list={['auto', '40px', '60px', '100px']} />
            </div>
          ) : (
            <p className="text-xs text-slate-400">Chưa chọn item. Bấm một ô trong vùng xem trước.</p>
          )}
        </div>
      </div>

      <div className="space-y-3 min-w-0">
        <div className={`${card} p-3`}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Xem trước (bấm ô để chọn item)</div>
          <div className="overflow-auto rounded-lg bg-slate-50 border border-dashed border-slate-300 p-2">
            <div style={{ ...cStyle, minHeight: 40 }} className="bg-white border border-slate-300 rounded-md box-border">
              {items.map((it, i) => (
                <button
                  type="button"
                  key={it.id}
                  onClick={() => setSel(it.id)}
                  style={{ ...declsToStyle(flexItemDecls(it)), minWidth: 28, minHeight: 28 }}
                  className={`${ITEM_COLORS[i % ITEM_COLORS.length]} text-white text-sm font-bold rounded-md flex items-center justify-center box-border ${
                    it.id === sel ? 'ring-2 ring-offset-1 ring-slate-900' : ''
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid xl:grid-cols-2 gap-3">
          <CodeBlock title="CSS" code={css} />
          <CodeBlock title="Tailwind" code={tw} />
        </div>
        <CodeBlock title="HTML" code={html} light />
      </div>
    </div>
  );
}

/* ------------------------------ GRID ------------------------------ */

const TRACK_KINDS: { value: TrackKind; label: string }[] = [
  { value: 'fr', label: 'fr' },
  { value: 'px', label: 'px' },
  { value: '%', label: '%' },
  { value: 'auto', label: 'auto' },
  { value: 'min-content', label: 'min-content' },
  { value: 'max-content', label: 'max-content' },
  { value: 'minmax', label: 'minmax()' },
  { value: 'repeat', label: 'repeat(…, minmax())' },
];

function TrackEditor({ title, tracks, onChange }: { title: string; tracks: Track[]; onChange: (t: Track[]) => void }) {
  const set = (i: number, patch: Partial<Track>) => onChange(tracks.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">{title} ({tracks.length})</span>
        <button type="button" onClick={() => tracks.length < 12 && onChange([...tracks, newTrack('fr', 1)])} className={btnCls}>
          <Plus className="h-3 w-3" />Thêm
        </button>
      </div>
      {tracks.map((t, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="text-[10px] text-slate-400 w-4 shrink-0">{i + 1}</span>
          <select value={t.kind} onChange={(e) => set(i, { kind: e.target.value as TrackKind })} className={`${inputCls} w-28! shrink-0`}>
            {TRACK_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          {(t.kind === 'fr' || t.kind === 'px' || t.kind === '%') && (
            <input type="number" min={0} step={t.kind === 'fr' ? 0.5 : 1} value={Number.isFinite(t.v) ? t.v : ''} onChange={(e) => set(i, { v: e.target.value === '' ? NaN : Number(e.target.value) })} className={inputCls} />
          )}
          {t.kind === 'repeat' && (
            <select value={t.rep} onChange={(e) => set(i, { rep: e.target.value })} className={`${inputCls} w-24! shrink-0`}>
              <option value="auto-fit">auto-fit</option>
              <option value="auto-fill">auto-fill</option>
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={String(n)}>{n} lần</option>)}
            </select>
          )}
          {(t.kind === 'minmax' || t.kind === 'repeat') && (
            <>
              <input value={t.min} onChange={(e) => set(i, { min: e.target.value })} aria-label="min" placeholder="min" className={inputCls} />
              <input value={t.max} onChange={(e) => set(i, { max: e.target.value })} aria-label="max" placeholder="max" className={inputCls} />
            </>
          )}
          <button type="button" aria-label="Xóa track" onClick={() => tracks.length > 1 && onChange(tracks.filter((_, k) => k !== i))} className="p-1 text-slate-400 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

const AREA_COLORS = [
  'bg-indigo-200 text-indigo-900', 'bg-emerald-200 text-emerald-900', 'bg-amber-200 text-amber-900', 'bg-rose-200 text-rose-900',
  'bg-sky-200 text-sky-900', 'bg-violet-200 text-violet-900', 'bg-teal-200 text-teal-900', 'bg-orange-200 text-orange-900',
];

function GridTab() {
  const [g, setG] = useState<GridContainer>({
    ...DEFAULT_GRID,
    cols: [newTrack('px', 200), newTrack('fr', 1)],
    rows: [newTrack('px', 60), newTrack('fr', 1), newTrack('px', 50)],
  });
  const [rawCells, setRawCells] = useState<string[][]>([
    ['header', 'header'],
    ['sidebar', 'main'],
    ['footer', 'footer'],
  ]);
  const [useAreas, setUseAreas] = useState(true);
  const [brush, setBrush] = useState('header');
  const [items, setItems] = useState<GridItem[]>(() => [
    { ...newGridItem(1), area: 'header' }, { ...newGridItem(2), area: 'sidebar' }, { ...newGridItem(3), area: 'main' }, { ...newGridItem(4), area: 'footer' },
  ]);
  const nextId = useRef(5);
  const painting = useRef(false);

  const rows = Math.min(12, g.rows.length);
  const cols = Math.min(12, g.cols.length);
  const cells = useMemo(() => resizeAreas(rawCells, rows, cols), [rawCells, rows, cols]);
  const auto = hasAutoRepeat(g.cols) || hasAutoRepeat(g.rows);
  const val = useMemo(() => validateAreas(cells), [cells]);
  const areasOn = useAreas && !auto && val.ok && val.names.length > 0;
  const areas = areasOn ? cells : null;
  const names = areasOn ? val.names : [];

  useEffect(() => {
    const stop = () => { painting.current = false; };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const paint = (r: number, c: number, erase: boolean) =>
    setRawCells(resizeAreas(cells, rows, cols).map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? (erase ? '' : sanitizeAreaName(brush)) : v))));

  const upItem = (id: number, patch: Partial<GridItem>) => setItems((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const colorOf = (n: string) => AREA_COLORS[Math.max(0, val.names.indexOf(n)) % AREA_COLORS.length];

  const css = gridCss(g, items, areas);
  const tw = gridTailwind(g, items, areas);
  const html = gridHtml(items, names);
  const cStyle = declsToStyle(gridContainerDecls(g, areas));

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-3">
      <div className="space-y-3">
        <div className={`${card} p-3 space-y-3`}>
          <TrackEditor title="Cột (columns)" tracks={g.cols} onChange={(t) => setG((p) => ({ ...p, cols: t }))} />
          <TrackEditor title="Hàng (rows)" tracks={g.rows} onChange={(t) => setG((p) => ({ ...p, rows: t }))} />
          <div className="grid grid-cols-2 gap-2">
            <Num label="row-gap" value={g.rowGap} onChange={(n) => setG({ ...g, rowGap: n })} min={0} suffix="px" />
            <Num label="column-gap" value={g.colGap} onChange={(n) => setG({ ...g, colGap: n })} min={0} suffix="px" />
            <Sel label="justify-items" value={g.justifyItems} onChange={(v) => setG({ ...g, justifyItems: v })} options={['stretch', 'start', 'end', 'center']} />
            <Sel label="align-items" value={g.alignItems} onChange={(v) => setG({ ...g, alignItems: v })} options={['stretch', 'start', 'end', 'center']} />
            <Sel label="justify-content" value={g.justifyContent} onChange={(v) => setG({ ...g, justifyContent: v })} options={['normal', 'start', 'end', 'center', 'stretch', 'space-between', 'space-around', 'space-evenly']} />
            <Sel label="align-content" value={g.alignContent} onChange={(v) => setG({ ...g, alignContent: v })} options={['normal', 'start', 'end', 'center', 'stretch', 'space-between', 'space-around', 'space-evenly']} />
            <Sel label="grid-auto-flow" value={g.autoFlow} onChange={(v) => setG({ ...g, autoFlow: v })} options={['row', 'column', 'row dense', 'column dense']} />
            <Txt label="grid-auto-rows" value={g.autoRows} onChange={(v) => setG({ ...g, autoRows: v })} placeholder="vd: 100px" />
          </div>
          <Tip>
            repeat(auto-fit, minmax(200px, 1fr)) cho lưới tự co giãn không cần media query. Chọn kiểu &quot;repeat(…, minmax())&quot; ở cột.
          </Tip>
        </div>

        <div className={`${card} p-3 space-y-2`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">grid-template-areas</span>
            <label className="text-[11px] text-slate-600 flex items-center gap-1">
              <input type="checkbox" checked={useAreas} onChange={(e) => setUseAreas(e.target.checked)} /> Dùng
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <input value={brush} onChange={(e) => setBrush(e.target.value)} placeholder="tên vùng" aria-label="Tên vùng đang vẽ" className={inputCls} />
            <button type="button" onClick={() => setRawCells(resizeAreas([], rows, cols))} className={btnCls}><Eraser className="h-3 w-3" />Xóa hết</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {val.names.map((n) => (
              <button key={n} type="button" onClick={() => setBrush(n)} className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${colorOf(n)} ${brush === n ? 'ring-2 ring-slate-800' : ''}`}>{n}</button>
            ))}
          </div>
          <div className="grid gap-1 select-none touch-none" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {cells.map((row, r) =>
              row.map((n, c) => (
                <div
                  key={`${r}-${c}`}
                  onPointerDown={(e) => { e.preventDefault(); painting.current = true; paint(r, c, e.button === 2 || (!!n && n === sanitizeAreaName(brush) && e.shiftKey)); }}
                  onPointerEnter={() => painting.current && paint(r, c, false)}
                  onContextMenu={(e) => { e.preventDefault(); paint(r, c, true); }}
                  className={`h-9 rounded text-[10px] font-medium flex items-center justify-center cursor-pointer border border-slate-200 truncate px-0.5 ${n ? colorOf(n) : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                >
                  {n || '.'}
                </div>
              ))
            )}
          </div>
          <p className="text-[11px] text-slate-500">Bấm/kéo để tô ô bằng tên vùng hiện tại; chuột phải để xóa ô. Mỗi vùng phải là hình chữ nhật.</p>
          {auto && <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1">Có repeat(auto-fit/auto-fill) nên không thể dùng template-areas.</p>}
          {val.errors.map((e) => <p key={e} className="text-[11px] text-red-600 bg-red-50 rounded px-2 py-1">{e}</p>)}
        </div>
      </div>

      <div className="space-y-3 min-w-0">
        <div className={`${card} p-3`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Xem trước</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => items.length < 30 && setItems((p) => [...p, newGridItem(nextId.current++)])} className={btnCls}><Plus className="h-3 w-3" />Item</button>
              <button type="button" disabled={!val.names.length} onClick={() => setItems(val.names.map((n) => ({ ...newGridItem(nextId.current++), area: n })))} className={`${btnCls} disabled:opacity-40`}><Wand2 className="h-3 w-3" />Item từ vùng</button>
            </div>
          </div>
          <div className="overflow-auto rounded-lg bg-slate-50 border border-dashed border-slate-300 p-2">
            <div style={{ ...cStyle, minHeight: 120 }} className="bg-white border border-slate-300 rounded-md box-border">
              {items.map((it, i) => (
                <div
                  key={it.id}
                  style={declsToStyle(gridItemDecls(it, names))}
                  className={`${it.area && names.includes(it.area) ? colorOf(it.area) : ITEM_COLORS[i % ITEM_COLORS.length] + ' text-white'} rounded-md text-sm font-bold flex items-center justify-center min-h-8 min-w-0 p-1`}
                >
                  {it.area && names.includes(it.area) ? it.area : i + 1}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={`${card} p-3 space-y-1.5`}>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Đặt vị trí item</span>
          {items.length === 0 && <p className="text-xs text-slate-400">Chưa có item nào.</p>}
          {items.map((it, i) => (
            <div key={it.id} className="grid grid-cols-[1.5rem_1fr_repeat(4,4rem)_1.5rem] gap-1.5 items-end">
              <span className="text-xs font-bold text-slate-500 pb-1.5">{i + 1}</span>
              <Sel label={i === 0 ? 'Vùng' : ''} value={it.area} onChange={(v) => upItem(it.id, { area: v })} options={[{ value: '', label: '— tường minh —' }, ...names.map((n) => ({ value: n, label: n }))]} />
              <Num label={i === 0 ? 'col start' : ''} value={it.colStart} onChange={(n) => upItem(it.id, { colStart: n })} min={0} />
              <Num label={i === 0 ? 'col span' : ''} value={it.colSpan} onChange={(n) => upItem(it.id, { colSpan: n })} min={1} />
              <Num label={i === 0 ? 'row start' : ''} value={it.rowStart} onChange={(n) => upItem(it.id, { rowStart: n })} min={0} />
              <Num label={i === 0 ? 'row span' : ''} value={it.rowSpan} onChange={(n) => upItem(it.id, { rowSpan: n })} min={1} />
              <button type="button" aria-label="Xóa item" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} className="p-1 pb-1.5 text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">start = 0 nghĩa là auto. Chọn vùng thì item dùng <code>grid-area</code>.</p>
        </div>

        <div className="grid xl:grid-cols-2 gap-3">
          <CodeBlock title="CSS" code={css} />
          <CodeBlock title="Tailwind" code={tw} />
        </div>
        <CodeBlock title="HTML" code={html} light />
        {areas && <p className="text-[11px] text-slate-500">grid-template-areas: <code>{areasToCss(areas)}</code></p>}
      </div>
    </div>
  );
}

/* ------------------------------ CLAMP FLUID ------------------------------ */

function FluidGraph({ r, minVw, maxVw }: { r: Extract<ReturnType<typeof fluidClamp>, { ok: true }>; minVw: number; maxVw: number }) {
  const W = 560, H = 220, P = 36;
  const xMax = Math.max(maxVw * 1.3, 1);
  const lo = Math.max(0, r.loPx - (r.hiPx - r.loPx) * 0.2 - 1);
  const hi = r.hiPx + (r.hiPx - r.loPx) * 0.2 + 1;
  const X = (v: number) => P + (v / xMax) * (W - P - 10);
  const Y = (v: number) => H - P - ((v - lo) / (hi - lo)) * (H - P - 10);
  const pts = Array.from({ length: 61 }, (_, i) => {
    const vw = (xMax * i) / 60;
    return `${X(vw).toFixed(1)},${Y(evalFluid(r, vw)).toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-slate-50 rounded-lg border border-slate-200" role="img" aria-label="Đồ thị kích thước theo viewport">
      <line x1={P} y1={H - P} x2={W - 10} y2={H - P} stroke="currentColor" className="text-slate-300" />
      <line x1={P} y1={10} x2={P} y2={H - P} stroke="currentColor" className="text-slate-300" />
      {[minVw, maxVw].map((v, i) => (
        <g key={i}>
          <line x1={X(v)} y1={10} x2={X(v)} y2={H - P} stroke="currentColor" strokeDasharray="4 3" className="text-slate-300" />
          <text x={X(v)} y={H - P + 14} textAnchor="middle" fontSize="10" fill="currentColor" className="text-slate-500">{fmtNum(v, 0)}px</text>
        </g>
      ))}
      {[r.loPx, r.hiPx].map((v, i) => (
        <text key={i} x={P - 4} y={Y(v) + 3} textAnchor="end" fontSize="10" fill="currentColor" className="text-slate-500">{fmtNum(v, 1)}</text>
      ))}
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-indigo-600" />
      <text x={W - 10} y={H - 6} textAnchor="end" fontSize="10" fill="currentColor" className="text-slate-400">viewport (px)</text>
    </svg>
  );
}

function FluidTab({ sp }: { sp: URLSearchParams }) {
  const num = (k: string, d: number) => { const v = Number(sp.get(k)); return sp.get(k) && Number.isFinite(v) ? v : d; };
  const [minSize, setMinSize] = useState(num('min', 16));
  const [maxSize, setMaxSize] = useState(num('max', 24));
  const [minVw, setMinVw] = useState(num('vmin', 320));
  const [maxVw, setMaxVw] = useState(num('vmax', 1280));
  const [root, setRoot] = useState(num('root', 16));
  const [unit, setUnit] = useState<'rem' | 'px'>(sp.get('unit') === 'px' ? 'px' : 'rem');
  const [prop, setProp] = useState('--fluid-size');
  const { copy, done } = useCopy();

  const r = useMemo(() => fluidClamp({ minSize, maxSize, minVw, maxVw, rootPx: root, unit }), [minSize, maxSize, minVw, maxVw, root, unit]);
  const customProp = r.ok ? `${prop.replace(/[^a-zA-Z0-9_-]/g, '') .replace(/^(?!--)/, '--')}: ${r.css};` : '';

  // type scale
  const [baseMin, setBaseMin] = useState(16);
  const [baseMax, setBaseMax] = useState(20);
  const [ratioMin, setRatioMin] = useState(1.2);
  const [ratioMax, setRatioMax] = useState(1.333);
  const [down, setDown] = useState(2);
  const [up, setUp] = useState(5);
  const scale = useMemo(
    () => typeScale({ baseMin, baseMax, ratioMin, ratioMax, minVw, maxVw, rootPx: root, unit, down, up, prefix: 'step' }),
    [baseMin, baseMax, ratioMin, ratioMax, minVw, maxVw, root, unit, down, up]
  );
  const [demoVw, setDemoVw] = useState(768);

  return (
    <div className="space-y-3">
      <div className="grid lg:grid-cols-[300px_1fr] gap-3">
        <div className={`${card} p-3 space-y-2.5`}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Clamp() fluid</h3>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Cỡ nhỏ nhất" value={minSize} onChange={setMinSize} min={0} step={0.5} suffix="px" />
            <Num label="Cỡ lớn nhất" value={maxSize} onChange={setMaxSize} min={0} step={0.5} suffix="px" />
            <Num label="Viewport nhỏ nhất" value={minVw} onChange={setMinVw} min={1} suffix="px" />
            <Num label="Viewport lớn nhất" value={maxVw} onChange={setMaxVw} min={1} suffix="px" />
            <Num label="Root font-size" value={root} onChange={setRoot} min={1} suffix="px" />
            <Sel label="Đơn vị" value={unit} onChange={setUnit} options={['rem', 'px']} />
          </div>
          <Txt label="Tên custom property" value={prop} onChange={setProp} />
          <ShareLinkButton params={{ tab: 'fluid', min: String(minSize), max: String(maxSize), vmin: String(minVw), vmax: String(maxVw), root: String(root), unit }} />
        </div>
        <div className="space-y-3 min-w-0">
          {r.ok ? (
            <>
              <div className={`${card} p-3 space-y-2`}>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="flex-1 min-w-0 text-sm font-mono bg-slate-900 text-slate-100 rounded-md px-3 py-2 break-all">{r.css}</code>
                  <button type="button" onClick={() => copy(r.css, 'v')} className={btnCls}>{done === 'v' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}Giá trị</button>
                  <button type="button" onClick={() => copy(customProp, 'p')} className={btnCls}>{done === 'p' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}Custom property</button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Độ dốc = {fmtNum(r.slopeVw, 4)}vw, điểm cắt = {fmtNum(r.interceptPx, 4)}px. Tại {fmtNum(minVw, 0)}px được {fmtNum(minSize, 2)}px, tại {fmtNum(maxVw, 0)}px được {fmtNum(maxSize, 2)}px.
                </p>
                <FluidGraph r={r} minVw={minVw} maxVw={maxVw} />
              </div>
              <div className={`${card} p-3 overflow-auto`}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-1 pr-3">Viewport</th>
                      {COMMON_BREAKPOINTS.map((b) => <th key={b} className="py-1 px-2 text-right font-mono">{b}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1 pr-3 font-medium text-slate-700">Kích thước (px)</td>
                      {COMMON_BREAKPOINTS.map((b) => <td key={b} className="py-1 px-2 text-right font-mono">{fmtNum(evalFluid(r, b), 2)}</td>)}
                    </tr>
                    <tr>
                      <td className="py-1 pr-3 font-medium text-slate-700">Kích thước (rem)</td>
                      {COMMON_BREAKPOINTS.map((b) => <td key={b} className="py-1 px-2 text-right font-mono">{fmtNum(evalFluid(r, b) / root, 3)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="bg-red-50 text-red-700 text-xs rounded-lg px-3 py-2 border border-red-100">{r.error}</div>
          )}
        </div>
      </div>

      <div className={`${card} p-3 space-y-3`}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Thang cỡ chữ fluid (type scale)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <Num label="Cỡ gốc @min" value={baseMin} onChange={setBaseMin} min={1} suffix="px" />
          <Num label="Cỡ gốc @max" value={baseMax} onChange={setBaseMax} min={1} suffix="px" />
          <Sel label="Tỉ lệ @min" value={String(ratioMin)} onChange={(v) => setRatioMin(Number(v))} options={SCALE_RATIOS.map((x) => ({ value: String(x.value), label: x.label }))} />
          <Sel label="Tỉ lệ @max" value={String(ratioMax)} onChange={(v) => setRatioMax(Number(v))} options={SCALE_RATIOS.map((x) => ({ value: String(x.value), label: x.label }))} />
          <Num label="Bước nhỏ hơn" value={down} onChange={setDown} min={0} max={6} />
          <Num label="Bước lớn hơn" value={up} onChange={setUp} min={0} max={10} />
          <Num label="Xem thử @ viewport" value={demoVw} onChange={setDemoVw} min={1} suffix="px" />
        </div>
        <Tip>dùng viewport &amp; root ở khung trên. Tỉ lệ @min nhỏ hơn @max giúp chữ tiêu đề lớn dần mượt hơn trên màn hình rộng.</Tip>
        {scale.ok ? (
          <div className="grid lg:grid-cols-2 gap-3">
            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 text-left">
                  <tr><th className="p-1.5">Bước</th><th className="p-1.5">Min → Max (px)</th><th className="p-1.5">@{demoVw}px</th></tr>
                </thead>
                <tbody>
                  {[...scale.steps].reverse().map((s) => {
                    const px = fluidClamp({ minSize: s.minPx, maxSize: s.maxPx, minVw, maxVw, rootPx: root, unit });
                    const now = px.ok ? evalFluid(px, demoVw) : s.minPx;
                    return (
                      <tr key={s.step} className="border-t border-slate-100">
                        <td className="p-1.5 font-mono">{s.step}</td>
                        <td className="p-1.5 font-mono">{fmtNum(s.minPx, 2)} → {fmtNum(s.maxPx, 2)}</td>
                        <td className="p-1.5 whitespace-nowrap" style={{ fontSize: Math.min(now, 64) }}>Aa {fmtNum(now, 1)}px</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <CodeBlock title="CSS custom properties" code={scale.cssVars} />
          </div>
        ) : (
          <div className="bg-red-50 text-red-700 text-xs rounded-lg px-3 py-2 border border-red-100">{scale.error}</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ CONVERTER ------------------------------ */

const SAMPLE_CSS = `.card {
  padding: 24px 16px;
  margin: -8px auto;
  border: 1px solid #ddd;
  font-size: 18px;
  background: url("img/bg-16px.png");
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
}
@media (min-width: 768px) {
  .card { padding: 32px; max-width: 640px; }
}`;

function ConvertTab({ sp }: { sp: URLSearchParams }) {
  const [value, setValue] = useState(() => { const v = Number(sp.get('v')); return sp.get('v') && Number.isFinite(v) ? v : 24; });
  const [from, setFrom] = useState<CssUnit>(() => (CSS_UNITS.includes(sp.get('from') as CssUnit) ? (sp.get('from') as CssUnit) : 'px'));
  const [ctx, setCtx] = useState(DEFAULT_UNIT_CTX);
  const { copy } = useCopy();
  const setC = (k: keyof typeof ctx, n: number) => setCtx((p) => ({ ...p, [k]: n }));

  const [mode, setMode] = useState<'px2rem' | 'rem2px'>('px2rem');
  const [input, setInput] = useState(SAMPLE_CSS);
  const [bulkRoot, setBulkRoot] = useState(16);
  const [precision, setPrecision] = useState(4);
  const [convertMedia, setConvertMedia] = useState(false);
  const [keepThin, setKeepThin] = useState(true);
  const bulk = useMemo(
    () => convertCssUnits(input.slice(0, 300000), { mode, rootPx: bulkRoot, precision, convertMedia, keepThinPx: keepThin }),
    [input, mode, bulkRoot, precision, convertMedia, keepThin]
  );

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <div className={`${card} p-3 space-y-3`}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Đổi đơn vị</h3>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Giá trị" value={value} onChange={setValue} step={0.5} />
          <Sel label="Từ đơn vị" value={from} onChange={setFrom} options={CSS_UNITS} />
          <Num label="Root font-size (rem)" value={ctx.rootPx} onChange={(n) => setC('rootPx', n)} min={1} suffix="px" />
          <Num label="Font-size cha (em)" value={ctx.emPx} onChange={(n) => setC('emPx', n)} min={1} suffix="px" />
          <Num label="Viewport width (vw)" value={ctx.vwPx} onChange={(n) => setC('vwPx', n)} min={1} suffix="px" />
          <Num label="Viewport height (vh)" value={ctx.vhPx} onChange={(n) => setC('vhPx', n)} min={1} suffix="px" />
          <Num label="100% bằng (%)" value={ctx.percentBasePx} onChange={(n) => setC('percentBasePx', n)} min={1} suffix="px" />
        </div>
        <ShareLinkButton params={{ tab: 'convert', v: String(value), from }} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CSS_UNITS.map((u) => {
            const r = convertUnit(value, from, u, ctx);
            const text = r === null ? '—' : `${fmtNum(r, 4)}${u}`;
            return (
              <button key={u} type="button" disabled={r === null} onClick={() => copy(text, u)} title="Bấm để sao chép" className={`text-left rounded-lg border px-2.5 py-1.5 hover:bg-slate-50 ${u === from ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200'}`}>
                <div className="text-[10px] uppercase text-slate-400">{u}</div>
                <div className="text-sm font-mono text-slate-800 break-all">{text}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className={`${card} p-3 space-y-2.5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Chuyển hàng loạt trong CSS</h3>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'px2rem', label: 'px → rem' }, { value: 'rem2px', label: 'rem → px' }]} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-24"><Num label="Root (px)" value={bulkRoot} onChange={setBulkRoot} min={1} /></div>
          <div className="w-24"><Num label="Số lẻ tối đa" value={precision} onChange={setPrecision} min={0} max={8} /></div>
          <label className="text-xs text-slate-600 flex items-center gap-1"><input type="checkbox" checked={convertMedia} onChange={(e) => setConvertMedia(e.target.checked)} />Đổi cả trong @media</label>
          {mode === 'px2rem' && <label className="text-xs text-slate-600 flex items-center gap-1"><input type="checkbox" checked={keepThin} onChange={(e) => setKeepThin(e.target.checked)} />Giữ 1px (viền)</label>}
        </div>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} rows={9} placeholder="Dán CSS vào đây..." className="w-full p-2 text-xs font-mono rounded-lg border border-slate-200 bg-slate-50 text-slate-800 outline-hidden focus:border-indigo-500" />
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Đã đổi {bulk.count} giá trị. Bỏ qua url(), chuỗi và comment.</span>
          <button type="button" onClick={() => copy(bulk.out, 'bulk')} className={btnCls}><Copy className="h-3 w-3" />Sao chép kết quả</button>
        </div>
        <pre className="p-3 text-xs font-mono bg-slate-900 text-slate-100 rounded-lg max-h-64 overflow-auto whitespace-pre-wrap break-all">{bulk.out}</pre>
        <Tip>media query dùng rem tính theo cỡ chữ mặc định của trình duyệt, không theo html {'{'} font-size {'}'} — nên mặc định giữ px.</Tip>
      </div>
    </div>
  );
}

/* ------------------------------ SHADOW ------------------------------ */

type ShadowKind = 'box' | 'text' | 'radius';

function ShadowTab() {
  const [kind, setKind] = useState<ShadowKind>('box');
  const [box, setBox] = useState<ShadowLayer[]>(SHADOW_PRESETS[1].layers);
  const [text, setText] = useState<ShadowLayer[]>(TEXT_SHADOW_PRESETS[0].layers);
  const [radius, setRadius] = useState<Radius>({ tl: 16, tr: 16, br: 16, bl: 16, unit: 'px' });
  const [linked, setLinked] = useState(true);
  const [dark, setDark] = useState(false);
  const layers = kind === 'text' ? text : box;
  const setLayers = kind === 'text' ? setText : setBox;
  const upLayer = (i: number, patch: Partial<ShadowLayer>) => setLayers((p) => p.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const presets = kind === 'text' ? TEXT_SHADOW_PRESETS : SHADOW_PRESETS;

  const bv = shadowValue(box, 'box');
  const tv = shadowValue(text, 'text');
  const rv = radiusValue(radius);
  const output = kind === 'radius'
    ? { css: `border-radius: ${rv};`, tw: radiusTailwind(radius) }
    : kind === 'box'
      ? { css: `box-shadow: ${bv};`, tw: shadowTailwind(box, 'box') }
      : { css: `text-shadow: ${tv};`, tw: shadowTailwind(text, 'text') };

  const setCorner = (k: 'tl' | 'tr' | 'br' | 'bl', n: number) =>
    setRadius((p) => (linked ? { ...p, tl: n, tr: n, br: n, bl: n } : { ...p, [k]: n }));

  return (
    <div className="grid lg:grid-cols-[1fr_1fr] gap-3">
      <div className={`${card} p-3 space-y-2.5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented value={kind} onChange={setKind} options={[{ value: 'box', label: 'Box-shadow' }, { value: 'text', label: 'Text-shadow' }, { value: 'radius', label: 'Border-radius' }]} />
          {kind !== 'radius' && (
            <button type="button" onClick={() => setLayers((p) => (p.length < 8 ? [...p, { inset: false, x: 0, y: 4, blur: 8, spread: 0, color: '#000000', alpha: 0.2 }] : p))} className={btnCls}><Plus className="h-3 w-3" />Thêm lớp</button>
          )}
        </div>
        {kind !== 'radius' && (
          <>
            <div className="flex flex-wrap gap-1">
              {presets.map((p) => (
                <button key={p.name} type="button" onClick={() => { setLayers(p.layers); if (p.dark) setDark(true); }} className="px-2 py-0.5 rounded-full text-[11px] border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-300 text-slate-700">{p.name}</button>
              ))}
            </div>
            {layers.length === 0 && <p className="text-xs text-slate-400">Chưa có lớp nào (kết quả: none).</p>}
            {layers.map((l, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-600">Lớp {i + 1}</span>
                  <div className="flex items-center gap-2">
                    {kind === 'box' && <label className="text-[11px] text-slate-600 flex items-center gap-1"><input type="checkbox" checked={l.inset} onChange={(e) => upLayer(i, { inset: e.target.checked })} />inset</label>}
                    <button type="button" aria-label="Xóa lớp" onClick={() => setLayers((p) => p.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <div className={`grid gap-1.5 ${kind === 'box' ? 'grid-cols-4' : 'grid-cols-3'}`}>
                  <Num label="X" value={l.x} onChange={(n) => upLayer(i, { x: n })} />
                  <Num label="Y" value={l.y} onChange={(n) => upLayer(i, { y: n })} />
                  <Num label="Blur" value={l.blur} onChange={(n) => upLayer(i, { blur: n })} min={0} />
                  {kind === 'box' && <Num label="Spread" value={l.spread} onChange={(n) => upLayer(i, { spread: n })} />}
                </div>
                <div className="flex items-center gap-2">
                  <input type="color" value={l.color} onChange={(e) => upLayer(i, { color: e.target.value })} aria-label="Màu" className="h-7 w-9 rounded border border-slate-200 p-0 bg-white" />
                  <input type="range" min={0} max={1} step={0.01} value={l.alpha} onChange={(e) => upLayer(i, { alpha: Number(e.target.value) })} aria-label="Độ trong suốt" className="flex-1" />
                  <span className="text-[11px] font-mono text-slate-600 w-10 text-right">{Math.round(l.alpha * 100)}%</span>
                </div>
              </div>
            ))}
          </>
        )}
        {kind === 'radius' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Num label="Trên-trái" value={radius.tl} onChange={(n) => setCorner('tl', n)} min={0} />
              <Num label="Trên-phải" value={radius.tr} onChange={(n) => setCorner('tr', n)} min={0} />
              <Num label="Dưới-trái" value={radius.bl} onChange={(n) => setCorner('bl', n)} min={0} />
              <Num label="Dưới-phải" value={radius.br} onChange={(n) => setCorner('br', n)} min={0} />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-600 flex items-center gap-1"><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />Đồng bộ 4 góc</label>
              <Segmented value={radius.unit} onChange={(u) => setRadius((p) => ({ ...p, unit: u }))} options={[{ value: 'px', label: 'px' }, { value: '%', label: '%' }]} />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 min-w-0">
        <div className={`${card} p-3`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Xem trước</span>
            <Segmented value={dark ? 'dark' : 'light'} onChange={(v) => setDark(v === 'dark')} options={[{ value: 'light', label: 'Nền sáng' }, { value: 'dark', label: 'Nền tối' }]} />
          </div>
          <div className="rounded-lg h-56 flex items-center justify-center overflow-hidden" style={{ background: dark ? '#0f172a' : kind === 'box' && box.some((l) => l.color.toLowerCase() === '#a3b1c6') ? '#e0e5ec' : '#f8fafc' }}>
            {kind === 'text' ? (
              <span className="text-5xl font-extrabold" style={{ color: dark ? '#f8fafc' : '#1e293b', textShadow: tv }}>Xin chào</span>
            ) : (
              <div
                className="h-28 w-44 flex items-center justify-center text-sm font-medium"
                style={{
                  background: dark ? '#1e293b' : kind === 'box' && box.some((l) => l.color.toLowerCase() === '#a3b1c6') ? '#e0e5ec' : '#ffffff',
                  color: dark ? '#e2e8f0' : '#334155',
                  boxShadow: kind === 'box' ? bv : undefined,
                  borderRadius: kind === 'radius' ? rv : 12,
                  border: kind === 'radius' ? '2px solid #6366f1' : undefined,
                }}
              >
                {kind === 'radius' ? rv : 'Hộp mẫu'}
              </div>
            )}
          </div>
        </div>
        <CodeBlock title="CSS" code={output.css} />
        <CodeBlock title="Tailwind (giá trị tùy ý)" code={output.tw} />
        {kind === 'box' && <Tip>Neumorphism cần nền giống màu hộp (đã tự đổi nền xem trước khi chọn preset).</Tip>}
      </div>
    </div>
  );
}

/* ------------------------------ SPECIFICITY ------------------------------ */

const SPEC_SAMPLE = `#nav .item:hover
ul li.active > a
a:not(.btn, #x)
:where(.card) p
.btn.primary::before
body main article p:first-child
*
div:is(#a, .b) span[data-x="1"]`;

const specColor: Record<string, string> = {
  a: 'bg-red-100 text-red-800',
  b: 'bg-amber-100 text-amber-800',
  c: 'bg-sky-100 text-sky-800',
  zero: 'bg-slate-100 text-slate-500',
};

function SpecTab({ sp }: { sp: URLSearchParams }) {
  const [text, setText] = useState(() => (sp.get('sel') ?? SPEC_SAMPLE).slice(0, 500));
  const selectors = useMemo(() => extractSelectors(text), [text]);
  const ranked = useMemo(() => rankSelectors(selectors), [selectors]);
  const first = selectors[0] ? specificityOf(selectors[0]) : null;
  const { copy } = useCopy();

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <div className={`${card} p-3 space-y-2`}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Selector (mỗi dòng một selector, hoặc dán nguyên rule CSS)</h3>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={10} className="w-full p-2 text-xs font-mono rounded-lg border border-slate-200 bg-slate-50 text-slate-800 outline-hidden focus:border-indigo-500" />
        <div className="flex items-center gap-2">
          <ShareLinkButton params={{ tab: 'spec', sel: selectors.slice(0, 5).join('\n').slice(0, 300) }} />
          <button type="button" onClick={() => copy(ranked.map((x) => `${x.result.selector}  (${x.result.spec.join(',')})`).join('\n'), 'rank')} className={btnCls}><Copy className="h-3 w-3" />Sao chép thứ tự</button>
        </div>
        <Tip>độ ưu tiên so sánh từng cột từ trái sang phải: (a) ID, (b) class/attribute/pseudo-class, (c) thẻ/pseudo-element. Bằng nhau thì rule viết sau thắng. !important và style nội tuyến nằm ngoài (a,b,c).</Tip>
        {first && !first.error && first.parts.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-2 space-y-1">
            <div className="text-[11px] font-bold text-slate-600">Giải thích: <code>{first.selector}</code></div>
            {first.parts.map((p, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`px-1.5 rounded font-mono ${specColor[p.kind]}`}>{p.text}</span>
                <span className="text-slate-600">{p.note}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={`${card} p-3 space-y-2 min-w-0`}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Xếp theo độ ưu tiên (cao → thấp)</h3>
        {ranked.length === 0 && <p className="text-xs text-slate-400">Chưa có selector nào.</p>}
        <div className="space-y-1 max-h-[32rem] overflow-auto">
          {ranked.map(({ result: r, index }, k) => (
            <div key={index} className="rounded-lg border border-slate-200 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-5">{k + 1}</span>
                <code className="flex-1 min-w-0 text-xs font-mono break-all text-slate-800">{r.selector}</code>
                {r.error ? (
                  <span className="text-[11px] text-red-600">Lỗi</span>
                ) : (
                  <span className="font-mono text-xs flex gap-0.5 shrink-0">
                    <span className={`px-1 rounded ${specColor.a}`}>{r.spec[0]}</span>
                    <span className={`px-1 rounded ${specColor.b}`}>{r.spec[1]}</span>
                    <span className={`px-1 rounded ${specColor.c}`}>{r.spec[2]}</span>
                  </span>
                )}
              </div>
              {r.error ? (
                <p className="text-[11px] text-red-600 mt-0.5">{r.error}</p>
              ) : (
                <p className="text-[11px] text-slate-500 mt-0.5 ml-7">
                  ({r.spec.join(',')}) = {r.spec[0]} ID, {r.spec[1]} class/attr/pseudo-class, {r.spec[2]} thẻ/pseudo-element
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ PAGE ------------------------------ */

const TABS = [
  { id: 'flex', label: 'Flexbox' },
  { id: 'grid', label: 'Grid' },
  { id: 'fluid', label: 'clamp() fluid' },
  { id: 'convert', label: 'px ⇄ rem' },
  { id: 'shadow', label: 'Shadow & Radius' },
  { id: 'spec', label: 'Specificity' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function CssPlaygroundPage() {
  const [sp, setSp] = useState<URLSearchParams | null>(null);
  const [tab, setTab] = useState<TabId>('flex');

  useEffect(() => {
    const p = readShareParams();
    const t = p.get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSp(p);
    if (TABS.some((x) => x.id === t)) setTab(t as TabId);
  }, []);

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <LayoutGrid className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">CSS Flex / Grid &amp; Tiện ích</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Sân chơi Flexbox, Grid, clamp() fluid, đổi đơn vị, shadow và máy tính specificity. Mọi thứ chạy ngay trên trình duyệt.
            </p>
          </div>
        </div>
        <ShareLinkButton params={{ tab }} label="Link tab này" />
      </div>

      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              tab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sp && (
        <>
          <div hidden={tab !== 'flex'}><FlexTab /></div>
          <div hidden={tab !== 'grid'}><GridTab /></div>
          <div hidden={tab !== 'fluid'}><FluidTab sp={sp} /></div>
          <div hidden={tab !== 'convert'}><ConvertTab sp={sp} /></div>
          <div hidden={tab !== 'shadow'}><ShadowTab /></div>
          <div hidden={tab !== 'spec'}><SpecTab sp={sp} /></div>
        </>
      )}
    </div>
  );
}
