'use client';

import { Select } from '@/components/ui/searchable-select';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Coins,
  Upload,
  Trash2,
  Copy,
  Download,
  AlertTriangle,
  Scissors,
  Layers,
  FlaskConical,
  RotateCcw,
  Plus,
  ArrowUpDown,
  Info,
  FileArchive,
  CheckCircle2,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  FAMILIES,
  FamilyId,
  TokenEstimate,
  Chunk,
  ChunkBoundary,
  estimateMany,
  chunkText,
  findBudgetIndex,
  snapBack,
  parseConversation,
  chatOverhead,
  textStats,
  runSelfChecks,
  SelfCheckResult,
} from '@/lib/llm-tokens';
import {
  DEFAULT_MODELS,
  EDITABLE_FIELDS,
  EditableField,
  EMPTY_PRICING_STATE,
  LlmModel,
  PRICING_AS_OF,
  PricingState,
  applyPricingState,
  formatUsd,
  isOverridden,
  loadPricingState,
  savePricingState,
  scenarioCost,
  tokensCost,
} from '@/lib/llm-pricing';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALL_FAMILIES = FAMILIES.map((f) => f.id);
const DEFAULT_SELECTED = [
  'gpt-5',
  'gpt-5-mini',
  'gpt-4.1',
  'gpt-4o',
  'gpt-4o-mini',
  'claude-sonnet-4.5',
  'claude-haiku-4.5',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'deepseek-chat',
  'llama-3.3-70b',
];

const SAMPLE = `system: Bạn là trợ lý hữu ích, trả lời ngắn gọn bằng tiếng Việt.
user: Xin chào! Hãy giải thích token trong mô hình ngôn ngữ lớn (LLM) là gì.
assistant: Token là đơn vị nhỏ nhất mà mô hình đọc: một từ, một phần của từ, dấu câu hoặc ký tự đặc biệt.

Ví dụ: "hello world" ≈ 2 token. Tiếng Việt có dấu thường tốn nhiều token hơn tiếng Anh.
user: function getUserName(userId) { return users[userId]?.name ?? "N/A"; } // 12345 😀`;

const nf = new Intl.NumberFormat('vi-VN');
const fmt = (n: number) => nf.format(Math.round(n));
const fmtCtx = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

type SortKey = 'name' | 'tokens' | 'context' | 'cost' | 'monthly';

interface Row {
  model: LlmModel;
  est: TokenEstimate;
  pct: number;
  fits: boolean;
  costIn: number;
  costInMin: number;
  costInMax: number;
  perCall: number;
  scen: ReturnType<typeof scenarioCost>;
}

function download(name: string, content: string, type = 'text/plain;charset=utf-8') {
  saveAs(new Blob([content], { type }), name);
}

function NumCell({
  value,
  edited,
  onCommit,
  step,
  placeholder,
}: {
  value: number | undefined;
  edited: boolean;
  onCommit: (v: number | undefined) => void;
  step?: string;
  placeholder?: string;
}) {
  return (
    <input
      key={String(value)}
      type="number"
      min={0}
      step={step ?? 'any'}
      defaultValue={value ?? ''}
      placeholder={placeholder}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (raw === '') return onCommit(undefined);
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) onCommit(n);
        else e.target.value = String(value ?? '');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={`w-24 px-1.5 py-1 rounded-sm border text-xs text-right bg-white outline-hidden focus:border-indigo-500 ${
        edited ? 'border-amber-400 bg-amber-50' : 'border-slate-200'
      }`}
    />
  );
}

export default function LlmTokensPage() {
  const { showToast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState(SAMPLE);
  const [dtext, setDtext] = useState(SAMPLE);
  const [dragging, setDragging] = useState(false);
  const [counts, setCounts] = useState<Record<FamilyId, TokenEstimate> | null>(null);
  const [computing, setComputing] = useState(false);

  const [pricing, setPricing] = useState<PricingState>(EMPTY_PRICING_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTED);

  const [expectedOut, setExpectedOut] = useState(500);
  const [callsPerDay, setCallsPerDay] = useState(1000);
  const [daysPerMonth, setDaysPerMonth] = useState(30);
  const [cachedPct, setCachedPct] = useState(0);
  const [batch, setBatch] = useState(false);
  const [convMode, setConvMode] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [chartMetric, setChartMetric] = useState<'call' | 'month'>('month');

  // Cắt theo token
  const [cutFam, setCutFam] = useState<FamilyId>('o200k');
  const [budget, setBudget] = useState(100);
  const [snap, setSnap] = useState(true);

  // Chia đoạn
  const [chFam, setChFam] = useState<FamilyId>('o200k');
  const [chSize, setChSize] = useState(200);
  const [chOverlap, setChOverlap] = useState(20);
  const [chBoundary, setChBoundary] = useState<ChunkBoundary>('paragraph');
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [chunking, setChunking] = useState(false);

  const [checks, setChecks] = useState<SelfCheckResult[] | null>(null);

  const [newModel, setNewModel] = useState({
    name: '',
    provider: '',
    family: 'o200k' as FamilyId,
    context: 128000,
    maxOutput: 8192,
    input: 1,
    output: 3,
    cachedInput: '',
  });

  /* ---------- khởi tạo từ localStorage & URL ---------- */
  useEffect(() => {
    setPricing(loadPricingState());
    const p = readShareParams();
    const m = p.get('m');
    if (m) setSelected(m.split(',').filter(Boolean).slice(0, 80));
    const n = (k: string) => {
      const v = Number(p.get(k));
      return p.get(k) !== null && Number.isFinite(v) && v >= 0 ? v : null;
    };
    const o = n('out');
    if (o !== null) setExpectedOut(o);
    const c = n('cpd');
    if (c !== null) setCallsPerDay(c);
    const d = n('days');
    if (d !== null) setDaysPerMonth(Math.min(31, d));
    const ca = n('cache');
    if (ca !== null) setCachedPct(Math.min(100, ca));
    if (p.get('batch') === '1') setBatch(true);
    if (p.get('conv') === '1') setConvMode(true);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) savePricingState(pricing);
  }, [pricing, hydrated]);

  const models = useMemo(() => applyPricingState(DEFAULT_MODELS, pricing), [pricing]);

  /* ---------- tính toán (debounce) ---------- */
  useEffect(() => {
    const t = setTimeout(() => setDtext(text), text.length > 200_000 ? 500 : 200);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    setComputing(true);
    const t = setTimeout(() => {
      setCounts(estimateMany(dtext, ALL_FAMILIES));
      setComputing(false);
    }, 0);
    return () => clearTimeout(t);
  }, [dtext]);

  const stats = useMemo(() => textStats(dtext), [dtext]);
  const messages = useMemo(() => (convMode ? parseConversation(dtext) : []), [convMode, dtext]);

  const rows: Row[] = useMemo(() => {
    if (!counts) return [];
    return models.map((model) => {
      const over = convMode ? chatOverhead(model.family, messages.length) : 0;
      const base = counts[model.family];
      const est: TokenEstimate = {
        min: base.min + over,
        likely: base.likely + over,
        max: base.max + over,
      };
      const out = Math.max(0, expectedOut);
      const pct = ((est.likely + out) / Math.max(1, model.context)) * 100;
      const fits = est.likely + out <= model.context && out <= model.maxOutput;
      const costIn = tokensCost(est.likely, model.input);
      const scen = scenarioCost(model, {
        inputTokens: est.likely,
        outputTokens: out,
        cachedShare: cachedPct / 100,
        batch,
        callsPerDay,
        daysPerMonth,
      });
      return {
        model,
        est,
        pct,
        fits,
        costIn,
        costInMin: tokensCost(est.min, model.input),
        costInMax: tokensCost(est.max, model.input),
        perCall: costIn + tokensCost(out, model.output),
        scen,
      };
    });
  }, [counts, models, expectedOut, convMode, messages.length, cachedPct, batch, callsPerDay, daysPerMonth]);

  const sorted = useMemo(() => {
    const val = (r: Row): number | string => {
      switch (sortKey) {
        case 'name': return r.model.provider + r.model.name;
        case 'tokens': return r.est.likely;
        case 'context': return r.model.context;
        case 'monthly': return r.scen.monthly;
        default: return r.perCall;
      }
    };
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
      return c * sortDir;
    });
  }, [rows, sortKey, sortDir]);

  const considered = useMemo(() => {
    const sel = rows.filter((r) => selected.includes(r.model.id));
    return sel.length ? sel : rows;
  }, [rows, selected]);

  const cheapest = useMemo(() => {
    const fit = considered.filter((r) => r.fits);
    if (!fit.length) return null;
    return fit.reduce((a, b) => (b.scen.perCall < a.scen.perCall ? b : a));
  }, [considered]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === 'context' ? -1 : 1);
    }
  };

  const toggleSel = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /* ---------- file ---------- */
  const loadFile = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      showToast(`File "${file.name}" quá lớn (tối đa 5 MB).`);
      return;
    }
    try {
      const t = await file.text();
      if (t.includes('\u0000')) {
        showToast(`"${file.name}" có vẻ là file nhị phân, chỉ hỗ trợ văn bản.`);
        return;
      }
      setText(t);
      setDtext(t);
      showToast(`Đã mở "${file.name}".`);
    } catch {
      showToast('Không đọc được file.');
    }
  };

  /* ---------- cắt theo token ---------- */
  const cut = useMemo(() => {
    if (!dtext) return null;
    const b = Math.max(0, Math.floor(budget));
    const r = findBudgetIndex(dtext, cutFam, b);
    let index = r.index;
    if (!r.fitsAll && snap) index = snapBack(dtext, index);
    const sliced = dtext.slice(0, index);
    const est = estimateMany(sliced, [cutFam])[cutFam];
    return { index, fitsAll: r.fitsAll, est, sliced };
  }, [dtext, cutFam, budget, snap]);

  /* ---------- chia đoạn ---------- */
  const runChunking = () => {
    if (!dtext) {
      showToast('Chưa có văn bản để chia.');
      return;
    }
    setChunking(true);
    setTimeout(() => {
      try {
        const size = Math.max(1, Math.floor(chSize));
        const res = chunkText(dtext, chFam, { size, overlap: Math.max(0, Math.floor(chOverlap)), boundary: chBoundary });
        setChunks(res);
      } catch {
        showToast('Không chia được đoạn (văn bản quá bất thường).');
      }
      setChunking(false);
    }, 0);
  };

  const copyText = async (s: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(s);
      showToast(msg);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const downloadZip = async () => {
    if (!chunks) return;
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const pad = Math.max(3, String(chunks.length).length);
      chunks.forEach((c) => zip.file(`chunk_${String(c.index + 1).padStart(pad, '0')}.txt`, c.text));
      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'chunks.zip');
    } catch {
      showToast('Không tạo được file zip.');
    }
  };

  /* ---------- chỉnh bảng giá ---------- */
  const setField = (m: LlmModel, field: EditableField, value: number | undefined) => {
    setPricing((p) => {
      if (m.custom) {
        return {
          ...p,
          custom: p.custom.map((c) => {
            if (c.id !== m.id) return c;
            const next = { ...c, [field]: value } as LlmModel;
            if ((field === 'input' || field === 'output' || field === 'context' || field === 'maxOutput') && value === undefined) return c;
            return next;
          }),
        };
      }
      const def = DEFAULT_MODELS.find((d) => d.id === m.id);
      const overrides = { ...p.overrides };
      const cur = { ...(overrides[m.id] || {}) };
      if (value === undefined || (def && def[field] === value)) delete cur[field];
      else cur[field] = value;
      if (Object.keys(cur).length) overrides[m.id] = cur;
      else delete overrides[m.id];
      return { ...p, overrides };
    });
  };

  const addCustom = () => {
    const name = newModel.name.trim();
    if (!name) {
      showToast('Hãy nhập tên model.');
      return;
    }
    const id = `custom-${Date.now().toString(36)}`;
    const ci = newModel.cachedInput.trim() === '' ? undefined : Number(newModel.cachedInput);
    const model: LlmModel = {
      id,
      provider: newModel.provider.trim() || 'Tùy chỉnh',
      name,
      family: newModel.family,
      context: Math.max(1, newModel.context),
      maxOutput: Math.max(1, newModel.maxOutput),
      input: Math.max(0, newModel.input),
      output: Math.max(0, newModel.output),
      cachedInput: ci !== undefined && Number.isFinite(ci) && ci >= 0 ? ci : undefined,
      confidence: 'kém chắc chắn',
      asOf: new Date().toISOString().slice(0, 10),
      source: 'Do người dùng nhập',
      custom: true,
    };
    setPricing((p) => ({ ...p, custom: [...p.custom, model] }));
    setSelected((s) => [...s, id]);
    setNewModel((n) => ({ ...n, name: '' }));
    showToast(`Đã thêm model "${name}".`);
  };

  const removeCustom = (id: string) => {
    setPricing((p) => ({ ...p, custom: p.custom.filter((c) => c.id !== id) }));
    setSelected((s) => s.filter((x) => x !== id));
  };

  const hasPricingEdits = Object.keys(pricing.overrides).length > 0 || pricing.custom.length > 0;

  /* ---------- hiển thị ---------- */
  const chartRows = useMemo(() => {
    const list = considered.map((r) => ({ r, v: chartMetric === 'month' ? r.scen.monthly : r.scen.perCall }));
    return list.sort((a, b) => a.v - b.v);
  }, [considered, chartMetric]);
  const chartMax = Math.max(1e-12, ...chartRows.map((x) => x.v));

  const SortTh = ({ k, children, className = '' }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={`px-2 py-2 font-semibold ${className}`}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-indigo-600">
        {children}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === k ? 'text-indigo-600' : 'text-slate-300'}`} />
      </button>
    </th>
  );

  const panel = 'bg-white rounded-xl border border-slate-200/90 shadow-xs';
  const inputCls = 'px-2 py-1.5 rounded-lg border border-slate-200 text-sm bg-white outline-hidden focus:border-indigo-500 w-full';
  const labelCls = 'text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1';
  const btn = 'px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1 disabled:opacity-50';

  const numInput = (value: number, set: (n: number) => void, min = 0, max?: number) => (
    <input
      type="number"
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => {
        const n = Number(e.target.value);
        set(Number.isFinite(n) ? Math.max(min, max !== undefined ? Math.min(max, n) : n) : min);
      }}
      className={inputCls}
    />
  );

  return (
    <div className="flex flex-col h-full bg-slate-50/50 min-h-screen">
      <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-amber-300" />
          <h1 className="text-base font-bold">Đếm token & chi phí LLM</h1>
          <span className="text-xs text-slate-400 hidden sm:inline">Ước tính offline, không gửi dữ liệu đi đâu</span>
        </div>
        <ShareLinkButton
          params={{
            m: selected.join(','),
            out: String(expectedOut),
            cpd: String(callsPerDay),
            days: String(daysPerMonth),
            cache: String(cachedPct),
            batch: batch ? '1' : '',
            conv: convMode ? '1' : '',
          }}
        />
      </div>

      <div className="p-4 space-y-4 max-w-7xl w-full mx-auto">
        {/* Banner giá */}
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm flex gap-2.5 items-start">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Giá chỉ mang tính tham khảo, hãy kiểm tra trên trang chính thức của nhà cung cấp.</p>
            <p className="text-xs mt-0.5">
              Bảng giá tổng hợp đến {PRICING_AS_OF}; model mới hơn có thể chưa có. Bạn có thể sửa giá / context từng dòng hoặc thêm model riêng ở mục
              &ldquo;Bảng giá & model&rdquo; bên dưới.
            </p>
            <p className="text-xs mt-1">
              <b>Số token là ước tính ±10–15%</b> (rộng hơn với tiếng Trung/Nhật/Hàn, emoji, base64): công cụ dùng heuristic mô phỏng cách BPE chia từ theo
              từng họ tokenizer, không dùng từ điển thật. Với Claude và Gemini sai số có thể lớn hơn. Cần số chính xác, hãy dùng API đếm token của nhà cung cấp.
            </p>
          </div>
        </div>

        {/* Nhập liệu */}
        <div
          className={`${panel} overflow-hidden transition ${dragging ? 'border-indigo-500 ring-2 ring-indigo-200' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void loadFile(f);
          }}
        >
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Văn bản / prompt</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="text/*,.md,.json,.csv,.log,.txt,.js,.ts,.tsx,.py,.html,.xml,.yaml,.yml"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                  e.target.value = '';
                }}
              />
              <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Mở file (≤ 5 MB)
              </button>
              <button type="button" className={btn} onClick={() => { setText(SAMPLE); setDtext(SAMPLE); }}>
                Dùng mẫu
              </button>
              <button type="button" className={btn} onClick={() => { setText(''); setDtext(''); }}>
                <Trash2 className="h-3.5 w-3.5" /> Xóa
              </button>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="Dán văn bản, prompt, mã nguồn... hoặc kéo thả file vào đây."
            className="w-full h-56 p-3 text-sm font-mono outline-hidden resize-y bg-white"
          />
          <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/60 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
            <span>Ký tự: <b>{fmt(stats.chars)}</b></span>
            <span>Từ: <b>{fmt(stats.words)}</b></span>
            <span>Dòng: <b>{fmt(stats.lines)}</b></span>
            <span>Byte (UTF-8): <b>{fmt(stats.bytes)}</b></span>
            {computing && <span className="text-indigo-600">Đang tính...</span>}
            {text.length > 2_000_000 && <span className="text-amber-700">Văn bản lớn, có thể hơi chậm.</span>}
          </div>
        </div>

        {/* Thông số */}
        <div className={`${panel} p-4`}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className={labelCls}>Token đầu ra dự kiến</label>
              {numInput(expectedOut, setExpectedOut)}
            </div>
            <div>
              <label className={labelCls}>Số lần gọi / ngày</label>
              {numInput(callsPerDay, setCallsPerDay)}
            </div>
            <div>
              <label className={labelCls}>Số ngày / tháng</label>
              {numInput(daysPerMonth, setDaysPerMonth, 0, 31)}
            </div>
            <div>
              <label className={labelCls}>Tiền tố cache (% đầu vào)</label>
              {numInput(cachedPct, setCachedPct, 0, 100)}
            </div>
            <div className="flex flex-col justify-end gap-1.5">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={batch} onChange={(e) => setBatch(e.target.checked)} className="accent-indigo-600" />
                Dùng Batch API
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer" data-tooltip="Cộng thêm phụ phí định dạng chat cho mỗi tin nhắn">
                <input type="checkbox" checked={convMode} onChange={(e) => setConvMode(e.target.checked)} className="accent-indigo-600" />
                Văn bản là hội thoại
              </label>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 flex gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Cache chỉ áp dụng cho model có giá cache; Batch chỉ áp dụng cho nhà cung cấp có giảm giá batch (thường 50%, áp cho cả đầu vào và đầu ra).
            Không tính phí ghi cache. Chi phí = số lần gọi/ngày × số ngày/tháng × chi phí mỗi lần.
          </p>
          {convMode && (
            <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
              <p className="font-semibold mb-1">Phụ phí định dạng chat (ước tính, thay đổi theo API/phiên bản)</p>
              <p className="mb-1.5">
                Nhận diện {messages.length} tin nhắn từ các dòng bắt đầu bằng <code>system:</code>, <code>user:</code>, <code>assistant:</code>
                {messages.length > 0 && <> ({Array.from(new Set(messages.map((m) => m.role))).join(', ')})</>}. Dòng không có nhãn nối vào tin nhắn trước.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {FAMILIES.map((f) => (
                  <span key={f.id}>
                    {f.label}: <b>+{chatOverhead(f.id, messages.length)}</b> token
                  </span>
                ))}
              </div>
              <p className="mt-1 text-slate-500">Giả định: mỗi tin nhắn cộng một số token cho thẻ vai trò/ngăn cách, cộng thêm hằng số cho cả hội thoại (ví dụ OpenAI ~3 + 3).</p>
            </div>
          )}
        </div>

        {/* Bảng kết quả */}
        <div className={`${panel} overflow-hidden`}>
          <div className="p-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Kết quả theo model</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className={btn} onClick={() => setSelected(models.map((m) => m.id))}>Chọn tất cả</button>
              <button type="button" className={btn} onClick={() => setSelected([])}>Bỏ chọn</button>
              <button type="button" className={btn} onClick={() => setSelected(DEFAULT_SELECTED)}>Mặc định</button>
            </div>
          </div>
          {cheapest && (
            <div className="px-3 py-2 text-sm bg-emerald-50 text-emerald-800 border-b border-emerald-100 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Rẻ nhất mà vẫn vừa ngữ cảnh{selected.length ? ' (trong các model đã chọn)' : ''}:{' '}
              <b>{cheapest.model.name}</b> — {formatUsd(cheapest.scen.perCall)} / lần, {formatUsd(cheapest.scen.monthly)} / tháng.
            </div>
          )}
          {!cheapest && rows.length > 0 && (
            <div className="px-3 py-2 text-sm bg-red-50 text-red-800 border-b border-red-100 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Không model nào đủ ngữ cảnh cho văn bản này. Hãy cắt hoặc chia đoạn bên dưới.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-2 py-2 w-8"></th>
                  <SortTh k="name">Model</SortTh>
                  <SortTh k="tokens" className="text-right">Token ước tính</SortTh>
                  <SortTh k="context">Ngữ cảnh đã dùng</SortTh>
                  <th className="px-2 py-2 font-semibold text-right">Chi phí đầu vào</th>
                  <SortTh k="cost" className="text-right">Tổng / lần gọi</SortTh>
                  <SortTh k="monthly" className="text-right">Kịch bản / tháng</SortTh>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const isSel = selected.includes(r.model.id);
                  const isCheap = cheapest?.model.id === r.model.id;
                  const barColor = r.pct > 100 ? 'bg-red-500' : r.pct > 80 ? 'bg-amber-500' : 'bg-emerald-500';
                  return (
                    <tr key={r.model.id} className={`border-t border-slate-100 ${isCheap ? 'bg-emerald-50' : isSel ? '' : 'opacity-60'}`}>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleSel(r.model.id)}
                          aria-label={`Chọn ${r.model.name}`}
                          className="accent-indigo-600"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                          {r.model.name}
                          {isCheap && <span className="px-1.5 rounded-sm bg-emerald-600 text-white text-[10px]">Rẻ nhất vừa ngữ cảnh</span>}
                          {r.model.custom && <span className="px-1.5 rounded-sm bg-indigo-100 text-indigo-700 text-[10px]">Tùy chỉnh</span>}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {r.model.provider} · {FAMILIES.find((f) => f.id === r.model.family)?.label} · {r.model.confidence}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap" data-tooltip="min – likely – max">
                        <div className="font-semibold text-slate-800">{fmt(r.est.likely)}</div>
                        <div className="text-[10px] text-slate-500">{fmt(r.est.min)} – {fmt(r.est.max)}</div>
                      </td>
                      <td className="px-2 py-2 min-w-[150px]">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
                          <span>{fmtCtx(r.model.context)}</span>
                          <span className={r.pct > 100 ? 'text-red-600 font-bold' : r.pct > 80 ? 'text-amber-600 font-semibold' : ''}>
                            {r.pct < 0.01 ? '<0,01' : r.pct.toFixed(r.pct < 10 ? 2 : 1)}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                          <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                        </div>
                        {r.pct > 100 && <div className="text-[10px] text-red-600 mt-0.5">Vượt giới hạn ngữ cảnh</div>}
                        {r.pct <= 100 && r.pct > 80 && <div className="text-[10px] text-amber-600 mt-0.5">Gần đầy (&gt; 80%)</div>}
                        {r.pct <= 100 && expectedOut > r.model.maxOutput && <div className="text-[10px] text-red-600 mt-0.5">Đầu ra &gt; tối đa {fmtCtx(r.model.maxOutput)}</div>}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap" data-tooltip={`${formatUsd(r.costInMin)} – ${formatUsd(r.costInMax)}`}>
                        <div className="text-slate-800">{formatUsd(r.costIn)}</div>
                        <div className="text-[10px] text-slate-500">{formatUsd(r.costInMin)} – {formatUsd(r.costInMax)}</div>
                      </td>
                      <td className="px-2 py-2 text-right font-semibold text-slate-800 whitespace-nowrap">{formatUsd(r.scen.perCall)}</td>
                      <td className="px-2 py-2 text-right font-semibold text-slate-800 whitespace-nowrap">{formatUsd(r.scen.monthly)}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">Đang tính...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-100">
            &ldquo;Ngữ cảnh đã dùng&rdquo; = (token đầu vào + token đầu ra dự kiến) / cửa sổ ngữ cảnh. &ldquo;Tổng / lần gọi&rdquo; và &ldquo;Kịch bản&rdquo; đã tính cache và batch nếu bạn bật.
            Cột &ldquo;chi phí đầu vào&rdquo; là giá niêm yết đầy đủ cho văn bản này, kèm khoảng min – max.
          </p>
        </div>

        {/* Chi tiết kịch bản */}
        <div className={`${panel} overflow-hidden`}>
          <div className="p-3 border-b border-slate-100 bg-slate-50/60">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Chi tiết kịch bản hàng tháng</span>
            <span className="ml-2 text-xs text-slate-500">
              {fmt(callsPerDay)} lần/ngày × {daysPerMonth} ngày = {fmt(callsPerDay * daysPerMonth)} lần/tháng
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-2 py-2">Model</th>
                  <th className="px-2 py-2 text-right">Đầu vào (không cache)</th>
                  <th className="px-2 py-2 text-right">Đầu vào (cache)</th>
                  <th className="px-2 py-2 text-right">Đầu ra</th>
                  <th className="px-2 py-2 text-right">Mỗi lần gọi</th>
                  <th className="px-2 py-2 text-right">Mỗi tháng</th>
                  <th className="px-2 py-2">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {[...considered].sort((a, b) => a.scen.monthly - b.scen.monthly).map((r) => (
                  <tr key={r.model.id} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 font-medium text-slate-800">{r.model.name}</td>
                    <td className="px-2 py-1.5 text-right">{formatUsd(r.scen.inputFresh * r.scen.callsPerMonth)}</td>
                    <td className="px-2 py-1.5 text-right">{formatUsd(r.scen.inputCached * r.scen.callsPerMonth)}</td>
                    <td className="px-2 py-1.5 text-right">{formatUsd(r.scen.monthlyOutput)}</td>
                    <td className="px-2 py-1.5 text-right">{formatUsd(r.scen.perCall)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">{formatUsd(r.scen.monthly)}</td>
                    <td className="px-2 py-1.5 text-slate-500">
                      {cachedPct > 0 && !r.scen.cacheApplied && 'Không có giá cache. '}
                      {batch && !r.scen.batchApplied && 'Không có batch. '}
                      {batch && r.scen.batchApplied && `Batch −${Math.round((1 - r.scen.batchFactor) * 100)}%. `}
                      {!r.fits && <span className="text-red-600">Không vừa ngữ cảnh.</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Biểu đồ */}
        <div className={`${panel} p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">So sánh chi phí</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setChartMetric('call')} className={`${btn} ${chartMetric === 'call' ? 'border-indigo-500! text-indigo-700!' : ''}`}>Mỗi lần gọi</button>
              <button type="button" onClick={() => setChartMetric('month')} className={`${btn} ${chartMetric === 'month' ? 'border-indigo-500! text-indigo-700!' : ''}`}>Mỗi tháng</button>
            </div>
          </div>
          {chartRows.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có dữ liệu.</p>
          ) : (
            <svg
              viewBox={`0 0 720 ${chartRows.length * 26 + 8}`}
              className="w-full"
              role="img"
              aria-label="Biểu đồ cột so sánh chi phí giữa các model"
            >
              {chartRows.map(({ r, v }, i) => {
                const w = Math.max(2, (v / chartMax) * 360);
                const y = i * 26 + 4;
                const cheap = cheapest?.model.id === r.model.id;
                return (
                  <g key={r.model.id}>
                    <text x={190} y={y + 15} textAnchor="end" fontSize="11" fill="currentColor" className="text-slate-700">
                      {r.model.name.length > 28 ? r.model.name.slice(0, 27) + '…' : r.model.name}
                    </text>
                    <rect x={198} y={y + 3} width={w} height={16} rx={3} fill="currentColor" className={r.fits ? (cheap ? 'text-emerald-500' : 'text-indigo-500') : 'text-red-400'} />
                    <text x={198 + w + 6} y={y + 15} fontSize="11" fill="currentColor" className="text-slate-600">
                      {formatUsd(v)}
                      {!r.fits ? ' (không vừa)' : ''}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
          <p className="text-[11px] text-slate-500 mt-1">Xanh lá = rẻ nhất vừa ngữ cảnh; đỏ = văn bản + đầu ra vượt giới hạn của model.</p>
        </div>

        {/* Cắt theo token */}
        <div className={`${panel} p-4`}>
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 mb-3">
            <Scissors className="h-4 w-4 text-indigo-600" /> Cắt theo giới hạn token
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className={labelCls}>Họ tokenizer</label>
              <Select searchThreshold={0} value={cutFam} onChange={(e) => setCutFam(e.target.value as FamilyId)} className={inputCls}>
                {FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
            </div>
            <div>
              <label className={labelCls}>Ngân sách token</label>
              {numInput(budget, setBudget)}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer col-span-2">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} className="accent-indigo-600" />
              Cắt tại ranh giới câu/dòng (lùi về dấu chấm / xuống dòng gần nhất)
            </label>
          </div>
          {cut && (
            <div className="mt-3 text-sm text-slate-700">
              {cut.fitsAll ? (
                <p className="text-emerald-700">Toàn bộ văn bản nằm trong ngân sách ({fmt(cut.est.likely)} token ước tính).</p>
              ) : (
                <p>
                  Chạm ngân sách tại ký tự thứ <b>{fmt(cut.index)}</b> / {fmt(dtext.length)} (giữ lại {fmt(cut.est.likely)} token ước tính, khoảng {fmt(cut.est.min)} – {fmt(cut.est.max)}).
                </p>
              )}
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 text-slate-100 text-xs p-3 whitespace-pre-wrap break-words">
                {cut.sliced.length > 1200 ? '…' + cut.sliced.slice(-1200) : cut.sliced || '(trống)'}
              </pre>
              <div className="flex gap-1.5 mt-2">
                <button type="button" className={btn} onClick={() => copyText(cut.sliced, 'Đã sao chép phần văn bản đã cắt.')}>
                  <Copy className="h-3.5 w-3.5" /> Sao chép phần giữ lại
                </button>
                <button type="button" className={btn} onClick={() => download('truncated.txt', cut.sliced)}>
                  <Download className="h-3.5 w-3.5" /> Tải .txt
                </button>
                <button type="button" className={btn} onClick={() => { setText(cut.sliced); setDtext(cut.sliced); }}>
                  Thay vào ô nhập
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Chunking */}
        <div className={`${panel} p-4`}>
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 mb-3">
            <Layers className="h-4 w-4 text-indigo-600" /> Chia đoạn (chunking)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <div>
              <label className={labelCls}>Họ tokenizer</label>
              <Select searchThreshold={0} value={chFam} onChange={(e) => setChFam(e.target.value as FamilyId)} className={inputCls}>
                {FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
            </div>
            <div>
              <label className={labelCls}>Kích thước (token)</label>
              {numInput(chSize, setChSize, 1)}
            </div>
            <div>
              <label className={labelCls}>Chồng lấn (token)</label>
              {numInput(chOverlap, setChOverlap)}
            </div>
            <div>
              <label className={labelCls}>Tách theo</label>
              <Select value={chBoundary} onChange={(e) => setChBoundary(e.target.value as ChunkBoundary)} className={inputCls}>
                <option value="paragraph">Đoạn văn</option>
                <option value="sentence">Câu</option>
                <option value="line">Dòng</option>
              </Select>
            </div>
            <button
              type="button"
              onClick={runChunking}
              disabled={chunking}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition disabled:opacity-50"
            >
              {chunking ? 'Đang chia...' : 'Chia đoạn'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Ưu tiên ranh giới đã chọn, đoạn quá dài sẽ được tách mịn hơn (câu, từ, cuối cùng là cắt cứng, không bao giờ cắt giữa cặp surrogate/emoji).
            Số token là ước tính nên một đoạn có thể lệch vài phần trăm so với kích thước đặt.
          </p>
          {chunks && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-sm text-slate-700">
                  <b>{chunks.length}</b> đoạn, tối đa {fmt(Math.max(0, ...chunks.map((c) => c.tokens)))} token ước tính.
                </span>
                <button type="button" className={btn} onClick={() => copyText(chunks.map((c) => c.text).join('\n\n---\n\n'), 'Đã sao chép tất cả các đoạn.')}>
                  <Copy className="h-3.5 w-3.5" /> Sao chép tất cả
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() =>
                    download(
                      'chunks.jsonl',
                      chunks.map((c) => JSON.stringify({ index: c.index, start: c.start, end: c.end, tokens: c.tokens, text: c.text })).join('\n') + '\n',
                      'application/x-ndjson;charset=utf-8'
                    )
                  }
                >
                  <Download className="h-3.5 w-3.5" /> JSONL
                </button>
                <button type="button" className={btn} onClick={downloadZip}>
                  <FileArchive className="h-3.5 w-3.5" /> .txt (zip)
                </button>
              </div>
              <div className="space-y-1.5">
                {chunks.slice(0, 150).map((c) => (
                  <details key={c.index} className="rounded-lg border border-slate-200 bg-slate-50/60 text-xs">
                    <summary className="cursor-pointer px-2.5 py-1.5 flex items-center gap-2">
                      <b className="text-slate-800">#{c.index + 1}</b>
                      <span className="text-slate-500">{fmt(c.tokens)} token · ký tự {fmt(c.start)}–{fmt(c.end)}</span>
                      <span className="truncate text-slate-600">{c.text.replace(/\s+/g, ' ').slice(0, 90)}</span>
                    </summary>
                    <pre className="px-2.5 pb-2 whitespace-pre-wrap break-words text-slate-700">{c.text.length > 3000 ? c.text.slice(0, 3000) + '…' : c.text}</pre>
                  </details>
                ))}
                {chunks.length > 150 && <p className="text-xs text-slate-500">Chỉ hiển thị 150 đoạn đầu; các nút sao chép/tải xuống dùng toàn bộ {chunks.length} đoạn.</p>}
              </div>
            </div>
          )}
        </div>

        {/* Bảng giá */}
        <details className={`${panel}`}>
          <summary className="cursor-pointer p-3 text-xs font-bold text-slate-800 uppercase tracking-wider">
            Bảng giá & model (chỉnh sửa) — số liệu tính đến {PRICING_AS_OF}
          </summary>
          <div className="p-3 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="text-xs text-slate-600 flex-1 min-w-[240px]">
                Giá USD / 1 triệu token. Ô viền vàng là giá bạn đã sửa (lưu trong trình duyệt này). Nhập xong nhấn Enter hoặc bấm ra ngoài.
              </p>
              <button
                type="button"
                className={btn}
                disabled={!hasPricingEdits}
                onClick={() => {
                  setPricing(EMPTY_PRICING_STATE);
                  setSelected((s) => s.filter((id) => !id.startsWith('custom-')));
                  showToast('Đã đặt lại bảng giá về mặc định.');
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Đặt lại mặc định
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-2 py-2">Model</th>
                    <th className="px-2 py-2 text-right">Input $/1M</th>
                    <th className="px-2 py-2 text-right">Output $/1M</th>
                    <th className="px-2 py-2 text-right">Cached input $/1M</th>
                    <th className="px-2 py-2 text-right">Context</th>
                    <th className="px-2 py-2 text-right">Max output</th>
                    <th className="px-2 py-2">Nguồn / độ tin cậy</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-slate-800">{m.name}</div>
                        <div className="text-[10px] text-slate-500">{m.provider}</div>
                      </td>
                      {EDITABLE_FIELDS.map((f) => (
                        <td key={f} className="px-2 py-1.5 text-right">
                          <NumCell
                            value={m[f]}
                            edited={!m.custom && isOverridden(pricing, m.id, f)}
                            placeholder={f === 'cachedInput' ? 'không có' : undefined}
                            onCommit={(v) => setField(m, f, v)}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-[10px] text-slate-500 max-w-[260px]">
                        <span className={m.confidence === 'tham khảo' ? 'text-slate-600' : 'text-amber-700'}>{m.confidence}</span> · {m.asOf} · {m.source}
                        {m.custom && (
                          <button type="button" onClick={() => removeCustom(m.id)} className="ml-2 text-red-600 hover:underline">Xóa</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Thêm model tùy chỉnh</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div><label className={labelCls}>Tên</label><input value={newModel.name} onChange={(e) => setNewModel({ ...newModel, name: e.target.value })} className={inputCls} placeholder="vd. Model nội bộ" /></div>
                <div><label className={labelCls}>Nhà cung cấp</label><input value={newModel.provider} onChange={(e) => setNewModel({ ...newModel, provider: e.target.value })} className={inputCls} /></div>
                <div>
                  <label className={labelCls}>Họ tokenizer</label>
                  <Select searchThreshold={0} value={newModel.family} onChange={(e) => setNewModel({ ...newModel, family: e.target.value as FamilyId })} className={inputCls}>
                    {FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </Select>
                </div>
                <div><label className={labelCls}>Context</label>{numInput(newModel.context, (n) => setNewModel({ ...newModel, context: n }), 1)}</div>
                <div><label className={labelCls}>Max output</label>{numInput(newModel.maxOutput, (n) => setNewModel({ ...newModel, maxOutput: n }), 1)}</div>
                <div><label className={labelCls}>Input $/1M</label>{numInput(newModel.input, (n) => setNewModel({ ...newModel, input: n }))}</div>
                <div><label className={labelCls}>Output $/1M</label>{numInput(newModel.output, (n) => setNewModel({ ...newModel, output: n }))}</div>
                <div><label className={labelCls}>Cached input $/1M (tùy chọn)</label><input value={newModel.cachedInput} onChange={(e) => setNewModel({ ...newModel, cachedInput: e.target.value })} className={inputCls} /></div>
              </div>
              <button type="button" onClick={addCustom} className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition">Thêm model</button>
            </div>
          </div>
        </details>

        {/* Tự kiểm tra */}
        <details className={`${panel}`}>
          <summary className="cursor-pointer p-3 text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <FlaskConical className="h-4 w-4 inline text-indigo-600" /> Cách ước tính & tự kiểm tra
          </summary>
          <div className="p-3 border-t border-slate-100 text-xs text-slate-700 space-y-2">
            <p>
              Văn bản được cắt thành các pre-token (từ có dấu cách đứng trước, nhóm chữ số ≤ 3, chuỗi dấu câu, khoảng trắng/xuống dòng, URL, base64/hex, emoji, ranh giới CamelCase/snake_case),
              rồi mỗi mảnh được tính theo độ dài và hệ chữ viết bằng hằng số riêng của từng họ tokenizer (OpenAI o200k, cl100k, Claude, Gemini, Llama). Từ ngắn thường là 1 token; tiếng Việt có dấu
              tốn khoảng 1,15–1,25× (từ vựng mới) đến 1,5–1,7× (từ vựng cũ); chữ Hán ≈ 0,65–1,2 token/ký tự; chuỗi base64 ≈ 2,5 ký tự/token.
              Các hằng số và giả định hiệu chỉnh được ghi chú trong <code>lib/llm-tokens.ts</code>.
            </p>
            <p><b>Mẹo:</b> để bảo đảm không vượt giới hạn, chừa dư ~15% so với số &ldquo;max&rdquo;; với prompt lặp lại nhiều lần, hãy đặt phần cố định ở đầu để hưởng giá cache.</p>
            <button type="button" className={btn} onClick={() => setChecks(runSelfChecks())}>
              <FlaskConical className="h-3.5 w-3.5" /> Chạy tự kiểm tra
            </button>
            {checks && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="font-semibold mb-1">{checks.filter((c) => c.ok).length}/{checks.length} phép kiểm tra đạt</p>
                {checks.map((c, i) => (
                  <div key={i} className={c.ok ? 'text-emerald-700' : 'text-red-600'}>
                    {c.ok ? '✓' : '✗'} {c.name} {c.detail && <span className="text-slate-500">({c.detail})</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
