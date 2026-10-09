'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dices,
  Plus,
  Trash2,
  Copy,
  Check,
  Download,
  ChevronUp,
  ChevronDown,
  CopyPlus,
  Shuffle,
  AlertTriangle,
  Loader2,
  Lightbulb,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  FieldDef,
  FIELD_TYPES,
  TYPE_BY_ID,
  TYPE_GROUPS,
  PRESETS,
  getPreset,
  makeField,
  defaultOpts,
  validateSchema,
  generateDatasetAsync,
  formatDataset,
  clampCount,
  MAX_ROWS,
  MAX_FIELDS,
  OUTPUT_FORMATS,
  DEFAULT_FORMAT_OPTIONS,
  FormatOptions,
  OutputFormat,
  SqlDialect,
  Locale,
  Dataset,
  OptDef,
} from '@/lib/mock-data';

import { Select, SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { SendToButton } from '@/components/SendToButton';
const STORAGE_KEY = 'mock-data:v1';
const PREVIEW_ROWS = 10;
const PREVIEW_CHARS = 30000;

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400';
const TYPE_OPTIONS: SelectOption[] = TYPE_GROUPS.flatMap((g) =>
  FIELD_TYPES.filter((t) => t.group === g).map((t) => ({ value: t.id, label: t.label, group: g, keywords: t.id })),
);
const iconBtn =
  'p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition disabled:opacity-30 disabled:hover:bg-transparent';

function OptInput({ def, value, onChange }: { def: OptDef; value: string; onChange: (v: string) => void }) {
  return (
    <label className={`block ${def.wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
      <span className="block text-[10px] font-medium text-slate-500 mb-0.5">{def.label}</span>
      {def.kind === 'select' ? (
        <Select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
          {def.choices?.map((c) => (
            <option key={c.v} value={c.v}>
              {c.l}
            </option>
          ))}
        </Select>
      ) : def.kind === 'area' ? (
        <textarea
          className={`${inputCls} font-mono resize-y`}
          rows={3}
          value={value}
          placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={`${inputCls} ${def.kind === 'number' ? '' : 'font-mono'}`}
          type="text"
          inputMode={def.kind === 'number' ? 'decimal' : undefined}
          value={value}
          placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function FieldRow({
  field,
  index,
  total,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  field: FieldDef;
  index: number;
  total: number;
  onChange: (f: FieldDef) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const def = TYPE_BY_ID[field.type];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-slate-400 w-5 text-right tabular-nums">{index + 1}</span>
        <input
          className={`${inputCls} font-mono sm:w-40 min-w-28 sm:flex-none flex-1`}
          value={field.name}
          placeholder="tên_trường"
          aria-label="Tên trường"
          onChange={(e) => onChange({ ...field, name: e.target.value })}
        />
        <SearchableSelect
          className={`${inputCls} sm:w-52 min-w-36 flex-1 sm:flex-none`}
          value={field.type}
          aria-label="Kiểu dữ liệu"
          options={TYPE_OPTIONS}
          searchThreshold={0}
          searchPlaceholder="Tìm kiểu dữ liệu..."
          onChange={(v) => onChange({ ...field, type: v, opts: defaultOpts(v) })}
        />
        <label className="flex items-center gap-1 text-[11px] text-slate-600 select-none" data-tooltip="Đảm bảo giá trị không trùng giữa các dòng">
          <input
            type="checkbox"
            checked={!!field.unique}
            onChange={(e) => onChange({ ...field, unique: e.target.checked })}
            className="accent-indigo-600"
          />
          Duy nhất
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-600" data-tooltip="Tỉ lệ giá trị null (0-100%)">
          null
          <input
            className={`${inputCls} w-14`}
            type="number"
            min={0}
            max={100}
            value={field.nullPct ?? 0}
            onChange={(e) => onChange({ ...field, nullPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
          />
          %
        </label>
        <div className="ml-auto flex items-center">
          <button className={iconBtn} disabled={index === 0} onClick={() => onMove(-1)} data-tooltip="Lên" aria-label="Chuyển lên">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button className={iconBtn} disabled={index === total - 1} onClick={() => onMove(1)} data-tooltip="Xuống" aria-label="Chuyển xuống">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button className={iconBtn} onClick={onDuplicate} data-tooltip="Nhân đôi" aria-label="Nhân đôi trường">
            <CopyPlus className="h-3.5 w-3.5" />
          </button>
          <button className={`${iconBtn} hover:text-red-600`} onClick={onRemove} data-tooltip="Xóa" aria-label="Xóa trường">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {def?.opts && def.opts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 pl-7">
          {def.opts.map((od) => (
            <OptInput
              key={od.key}
              def={od}
              value={field.opts[od.key] ?? od.def}
              onChange={(v) => onChange({ ...field, opts: { ...field.opts, [od.key]: v } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface Saved {
  fields: FieldDef[];
  seed: string;
  count: number;
  locale: Locale;
  format: OutputFormat;
  fmt: FormatOptions;
}

function sanitizeFields(raw: unknown): FieldDef[] | null {
  if (!Array.isArray(raw)) return null;
  const out: FieldDef[] = [];
  for (const r of raw.slice(0, MAX_FIELDS)) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    if (typeof x.name !== 'string' || typeof x.type !== 'string' || !TYPE_BY_ID[x.type]) continue;
    const opts: Record<string, string> = { ...defaultOpts(x.type) };
    if (x.opts && typeof x.opts === 'object') {
      for (const [k, v] of Object.entries(x.opts as Record<string, unknown>)) if (typeof v === 'string') opts[k] = v;
    }
    out.push({
      ...makeField(x.name, x.type, opts),
      unique: x.unique === true,
      nullPct: typeof x.nullPct === 'number' ? Math.max(0, Math.min(100, x.nullPct)) : 0,
    });
  }
  return out.length ? out : null;
}

export default function MockDataPage() {
  const { showToast } = useApp();
  const [fields, setFields] = useState<FieldDef[]>(() => PRESETS[0].build());
  const [seed, setSeed] = useState('12345');
  const [count, setCount] = useState(20);
  const [locale, setLocale] = useState<Locale>('vi');
  const [format, setFormat] = useState<OutputFormat>('json');
  const [fmt, setFmt] = useState<FormatOptions>({ ...DEFAULT_FORMAT_OPTIONS, sqlTable: PRESETS[0].table });
  const [activePreset, setActivePreset] = useState<string | null>('users');
  const [ready, setReady] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const fullCache = useRef<{ ds: Dataset; key: string; text: string } | null>(null);

  /* Khởi tạo từ URL, nếu không có thì từ localStorage */
  useEffect(() => {
    const params = readShareParams();
    const pid = params.get('preset');
    const preset = pid ? getPreset(pid) : undefined;
    if (preset) {
      setFields(preset.build());
      setActivePreset(preset.id);
      setFmt((f) => ({ ...f, sqlTable: preset.table }));
      const s = params.get('seed');
      if (s) setSeed(s.slice(0, 40));
      const c = Number(params.get('count'));
      if (Number.isFinite(c) && c > 0) setCount(clampCount(c));
      const l = params.get('locale');
      if (l === 'vi' || l === 'en') setLocale(l);
    } else {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const sv = JSON.parse(raw) as Partial<Saved>;
          const fl = sanitizeFields(sv.fields);
          if (fl) {
            setFields(fl);
            setActivePreset(null);
          }
          if (typeof sv.seed === 'string') setSeed(sv.seed.slice(0, 40));
          if (typeof sv.count === 'number') setCount(clampCount(sv.count));
          if (sv.locale === 'vi' || sv.locale === 'en') setLocale(sv.locale);
          if (sv.format && OUTPUT_FORMATS.some((f) => f.id === sv.format)) setFormat(sv.format);
          if (sv.fmt && typeof sv.fmt === 'object') setFmt((f) => ({ ...f, ...sv.fmt }));
        }
      } catch {
        /* bỏ qua: localStorage không khả dụng hoặc dữ liệu hỏng */
      }
    }
    setReady(true);
  }, []);

  /* Lưu schema */
  useEffect(() => {
    if (!ready) return;
    try {
      const data: Saved = { fields, seed, count, locale, format, fmt };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* bỏ qua */
    }
  }, [ready, fields, seed, count, locale, format, fmt]);

  const errors = useMemo(() => validateSchema(fields), [fields]);

  /* Sinh dữ liệu (debounce + chia khối) */
  const schemaKey = useMemo(() => JSON.stringify(fields.map((f) => [f.name, f.type, f.opts, f.unique, f.nullPct])), [fields]);
  useEffect(() => {
    if (!ready || errors.length > 0) return;
    const token = { cancelled: false };
    const timer = setTimeout(() => {
      setProgress(0);
      generateDatasetAsync(fields, count, { seed, locale }, token, (d, t) => {
        if (!token.cancelled) setProgress(d / t);
      })
        .then((ds) => {
          if (ds && !token.cancelled) {
            setDataset(ds);
            setProgress(null);
          }
        })
        .catch(() => {
          if (!token.cancelled) {
            setProgress(null);
            showToast('Không thể sinh dữ liệu với cấu hình này.');
          }
        });
    }, 300);
    return () => {
      token.cancelled = true;
      clearTimeout(timer);
    };
    // fields được theo dõi qua schemaKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, schemaKey, seed, count, locale, errors.length]);

  const preview = useMemo(() => {
    if (!dataset) return '';
    const head: Dataset = { ...dataset, rows: dataset.rows.slice(0, PREVIEW_ROWS) };
    let text = formatDataset(head, format, fmt);
    if (text.length > PREVIEW_CHARS) text = text.slice(0, PREVIEW_CHARS) + '\n…';
    return text;
  }, [dataset, format, fmt]);

  const getFull = useCallback((): string => {
    if (!dataset) return '';
    const key = JSON.stringify([format, fmt]);
    const c = fullCache.current;
    if (c && c.ds === dataset && c.key === key) return c.text;
    const text = formatDataset(dataset, format, fmt);
    fullCache.current = { ds: dataset, key, text };
    return text;
  }, [dataset, format, fmt]);

  const handleCopy = async () => {
    const text = getFull();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast('Đã sao chép toàn bộ dữ liệu!');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const handleDownload = () => {
    const text = getFull();
    if (!text) return;
    const meta = OUTPUT_FORMATS.find((f) => f.id === format)!;
    const blob = new Blob([text], { type: `${meta.mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mock-data.${meta.ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Đã tải xuống mock-data.${meta.ext}!`);
  };

  /* Thao tác trên schema (làm mất trạng thái "preset") */
  const editFields = (next: FieldDef[]) => {
    setFields(next);
    setActivePreset(null);
  };
  const updateField = (i: number, f: FieldDef) => editFields(fields.map((x, k) => (k === i ? f : x)));
  const moveField = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = fields.slice();
    [next[i], next[j]] = [next[j], next[i]];
    editFields(next);
  };
  const duplicateField = (i: number) => {
    if (fields.length >= MAX_FIELDS) return showToast(`Tối đa ${MAX_FIELDS} trường.`);
    const src = fields[i];
    let name = src.name + '_copy';
    const names = new Set(fields.map((f) => f.name));
    for (let k = 2; names.has(name); k++) name = `${src.name}_copy${k}`;
    const copy: FieldDef = { ...makeField(name, src.type, { ...src.opts }), unique: src.unique, nullPct: src.nullPct };
    const next = fields.slice();
    next.splice(i + 1, 0, copy);
    editFields(next);
  };
  const removeField = (i: number) => editFields(fields.filter((_, k) => k !== i));
  const addField = () => {
    if (fields.length >= MAX_FIELDS) return showToast(`Tối đa ${MAX_FIELDS} trường.`);
    const names = new Set(fields.map((f) => f.name));
    let n = fields.length + 1;
    while (names.has(`field_${n}`)) n++;
    editFields([...fields, makeField(`field_${n}`, 'fullName')]);
  };
  const applyPreset = (id: string) => {
    const p = getPreset(id);
    if (!p) return;
    setFields(p.build());
    setActivePreset(p.id);
    setFmt((f) => ({ ...f, sqlTable: p.table }));
  };

  const randomSeed = () => setSeed(String(Math.floor(Math.random() * 1e9)));

  const bytes = useMemo(() => (dataset && preview ? dataset.rows.length : 0), [dataset, preview]);
  const setF = <K extends keyof FormatOptions>(k: K, v: FormatOptions[K]) => setFmt((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3.5 lg-fit-screen lg:space-y-0 lg:gap-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs shrink-0 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Dices className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Sinh dữ liệu giả</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Thiết kế schema, sinh tới {MAX_ROWS.toLocaleString('vi-VN')} dòng dữ liệu mẫu (tên, SĐT, địa chỉ Việt Nam…) với seed tái lập được. Chạy hoàn toàn trên trình duyệt.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                activePreset === p.id
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-3.5 lg:flex-1 lg:min-h-0">
        {/* SCHEMA */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-3 flex flex-col gap-3 min-w-0 lg:min-h-0 lg:h-full">
          <div className="flex flex-wrap items-end gap-3 shrink-0">
            <label className="block">
              <span className="block text-[10px] font-medium text-slate-500 mb-0.5">Seed</span>
              <div className="flex gap-1">
                <input
                  className={`${inputCls} w-32 font-mono`}
                  value={seed}
                  maxLength={40}
                  onChange={(e) => setSeed(e.target.value)}
                />
                <button
                  onClick={randomSeed}
                  className="px-2 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1"
                  data-tooltip="Chọn seed ngẫu nhiên"
                >
                  <Shuffle className="h-3 w-3" />
                  Ngẫu nhiên
                </button>
              </div>
            </label>
            <label className="block">
              <span className="block text-[10px] font-medium text-slate-500 mb-0.5">Số dòng (1–{MAX_ROWS.toLocaleString('vi-VN')})</span>
              <input
                className={`${inputCls} w-24`}
                type="number"
                min={1}
                max={MAX_ROWS}
                value={count}
                onChange={(e) => setCount(clampCount(Number(e.target.value)))}
              />
            </label>
            <div>
              <span className="block text-[10px] font-medium text-slate-500 mb-0.5">Ngôn ngữ tên</span>
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                {(['vi', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLocale(l)}
                    className={`px-2.5 py-1 text-xs font-medium transition ${
                      locale === l ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {l === 'vi' ? 'Tiếng Việt' : 'English'}
                  </button>
                ))}
              </div>
            </div>
            {activePreset && <div className="ml-auto"><ShareLinkButton params={{ preset: activePreset, seed, count: String(count), locale }} /></div>}
          </div>

          <div className="space-y-2 lg:flex-1 lg:min-h-0 lg:overflow-auto lg:pr-1">
            {fields.map((f, i) => (
              <FieldRow
                key={f.id}
                field={f}
                index={i}
                total={fields.length}
                onChange={(nf) => updateField(i, nf)}
                onMove={(d) => moveField(i, d)}
                onDuplicate={() => duplicateField(i)}
                onRemove={() => removeField(i)}
              />
            ))}
            {fields.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-6">Chưa có trường nào. Nhấn &quot;Thêm trường&quot; hoặc chọn một mẫu ở trên.</p>
            )}
          </div>
          <button
            onClick={addField}
            className="self-start shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm trường
          </button>
          <p className="text-[11px] text-slate-500 flex gap-1.5 shrink-0">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-px" />
            <span>
              Mẹo: các trường &quot;Người&quot; trong cùng một dòng luôn nhất quán (họ tên, giới tính, email, CCCD, ngày sinh). Dùng &quot;Tham chiếu&quot; để tạo email từ first_name/last_name, và &quot;Công thức&quot; (ví dụ <code className="font-mono">price*qty</code>) cho cột tính toán. Chỉ nút Chia sẻ khả dụng khi dùng nguyên mẫu có sẵn.
            </span>
          </p>
        </div>

        {/* OUTPUT */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-3 flex flex-col gap-3 min-w-0 lg:min-h-0 lg:h-full">
          <div className="flex flex-wrap gap-1 shrink-0">
            {OUTPUT_FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFormat(f.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                  format === f.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {format === 'sql' && (
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="block text-[10px] font-medium text-slate-500 mb-0.5">Tên bảng</span>
                <input className={`${inputCls} font-mono`} value={fmt.sqlTable} onChange={(e) => setF('sqlTable', e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-[10px] font-medium text-slate-500 mb-0.5">Dialect</span>
                <Select className={inputCls} value={fmt.sqlDialect} onChange={(e) => setF('sqlDialect', e.target.value as SqlDialect)}>
                  <option value="mysql">MySQL</option>
                  <option value="postgres">PostgreSQL</option>
                  <option value="sqlite">SQLite</option>
                  <option value="mssql">SQL Server</option>
                </Select>
              </label>
              <label className="block">
                <span className="block text-[10px] font-medium text-slate-500 mb-0.5">Dòng / INSERT</span>
                <input
                  className={inputCls}
                  type="number"
                  min={1}
                  max={5000}
                  value={fmt.sqlBatch}
                  onChange={(e) => setF('sqlBatch', Math.max(1, Math.min(5000, Number(e.target.value) || 1)))}
                />
              </label>
            </div>
          )}
          {(format === 'csv' || format === 'tsv') && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" className="accent-indigo-600" checked={fmt.csvHeader} onChange={(e) => setF('csvHeader', e.target.checked)} />
              Có dòng tiêu đề
            </label>
          )}
          {(format === 'js' || format === 'ts') && (
            <label className="block w-40">
              <span className="block text-[10px] font-medium text-slate-500 mb-0.5">Tên biến</span>
              <input className={`${inputCls} font-mono`} value={fmt.constName} onChange={(e) => setF('constName', e.target.value)} />
            </label>
          )}
          {format === 'xml' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[10px] font-medium text-slate-500 mb-0.5">Thẻ gốc</span>
                <input className={`${inputCls} font-mono`} value={fmt.xmlRoot} onChange={(e) => setF('xmlRoot', e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-[10px] font-medium text-slate-500 mb-0.5">Thẻ mỗi dòng</span>
                <input className={`${inputCls} font-mono`} value={fmt.xmlRow} onChange={(e) => setF('xmlRow', e.target.value)} />
              </label>
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs p-2.5 space-y-0.5">
              {errors.map((e) => (
                <div key={e} className="flex gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {e}
                </div>
              ))}
            </div>
          )}
          {errors.length === 0 && dataset && dataset.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs p-2.5 space-y-0.5">
              {dataset.warnings.map((w) => (
                <div key={w} className="flex gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {w}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <SendToButton text={dataset && dataset.rows.length <= 2000 && errors.length === 0 ? getFull() : ''} fromToolId="mock-data" />
            <button
              onClick={handleCopy}
              disabled={!dataset || errors.length > 0}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 transition flex items-center gap-1"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              Sao chép tất cả
            </button>
            <button
              onClick={handleDownload}
              disabled={!dataset || errors.length > 0}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 disabled:opacity-40 transition flex items-center gap-1"
            >
              <Download className="h-3.5 w-3.5" />
              Tải xuống
            </button>
            <span className="text-[11px] text-slate-500 flex items-center gap-1 ml-auto">
              {progress !== null && <Loader2 className="h-3 w-3 animate-spin" />}
              {progress !== null
                ? `Đang sinh… ${Math.round(progress * 100)}%`
                : dataset
                  ? `${dataset.rows.length.toLocaleString('vi-VN')} dòng × ${dataset.columns.length} cột`
                  : ''}
            </span>
          </div>

          <div className="flex flex-col lg:flex-1 lg:min-h-0">
            <div className="text-[10px] font-medium text-slate-500 mb-1 shrink-0">
              Xem trước {bytes > PREVIEW_ROWS ? `${PREVIEW_ROWS} dòng đầu (còn ${(bytes - PREVIEW_ROWS).toLocaleString('vi-VN')} dòng khi sao chép / tải xuống)` : 'toàn bộ'}
            </div>
            <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-[11px] leading-relaxed font-mono overflow-auto max-h-[28rem] lg:max-h-none lg:flex-1 lg:min-h-0 whitespace-pre">
              {errors.length > 0 ? '// Hãy sửa lỗi schema để xem dữ liệu.' : preview || '// Đang chuẩn bị…'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
