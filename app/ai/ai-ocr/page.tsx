'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ScanText, ImagePlus, Copy, Download, Loader2, X, RotateCw, RotateCcw, Trash2, AlertTriangle, Info, Sparkles, Wand2, Crop, Eye, Gauge, Languages,
} from 'lucide-react';
import { Select } from '@/components/ui/searchable-select';
import { useApp } from '@/components/AppContext';
import { useAiSettings } from '@/lib/use-ai-config';
import { AiKeyNotice } from '@/components/AiKeyNotice';
import { AiSection } from '@/components/AiSection';
import { SendToButton } from '@/components/SendToButton';
import { AiError, callAi, toAiError } from '@/lib/ai-client';
import { IMAGE_MIME_WHITELIST, LANGUAGE_LABELS_VI, MAX_IMAGE_BASE64_BYTES, type AiImage } from '@/lib/ai-prompts';
import {
  DEFAULT_CLEAN, DEFAULT_LANGS, DEFAULT_PREPROCESS, MAX_LONG_SIDE, OCR_LANGS, PSM_OPTIONS,
  averageConfidence, buildCleanedResult, classifyOcrError, createOcrWorker, estimateSkew, langKey, linesFromBlocks,
  preprocess, preprocessSignature, rotate90, sanitizeLangs, toAiLang, toGray, isDarkImage,
  type CleanOptions, type OcrErrorInfo, type OcrLine, type OcrWorkerHandle, type PreprocessOptions, type ProgressInfo, type PsmMode, type RgbaImage,
} from '@/lib/ocr-local';

const MAX_AI_DIM = 2000;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_ITEMS = 20;
const LANG_STORE = 'ocr-local-langs';
const LOW_CONF = 60;
const PROSE =
  'prose prose-sm max-w-none text-slate-800 [&_h1]:text-base [&_h1]:font-extrabold [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_p]:leading-relaxed [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:bg-slate-100 [&_code]:text-indigo-700 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_th]:bg-slate-100 [&_th]:p-2 [&_th]:border [&_th]:border-slate-200 [&_td]:p-2 [&_td]:border [&_td]:border-slate-200';

interface Crop { x: number; y: number; w: number; h: number }
interface ItemResult { lines: OcrLine[]; sig: string; procW: number; procH: number }
interface Item {
  id: string;
  file: File;
  url: string;
  quarterTurns: number;
  deskew: number;
  crop: Crop | null;
  result?: ItemResult;
}

let idCounter = 0;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(blob);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = url;
  });
}

/** Giải mã ảnh thành RGBA (thu lại nếu cạnh dài > MAX_LONG_SIDE). */
async function decodeToRgba(url: string): Promise<RgbaImage> {
  const img = await loadImage(url);
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  const s = long > MAX_LONG_SIDE ? MAX_LONG_SIDE / long : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return { data: d.data, width: w, height: h };
}

function rgbaToCanvas(img: RgbaImage, canvas: HTMLCanvasElement) {
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  const copy = new Uint8ClampedArray(img.data.length);
  copy.set(img.data);
  ctx.putImageData(new ImageData(copy, img.width, img.height), 0, 0);
}

/** Thu nhỏ ảnh lớn (tối đa 2000px) và mã hoá lại JPEG 0.9 cho luồng AI; ảnh nhỏ giữ nguyên. */
async function prepareImage(file: File, objectUrl: string): Promise<{ image: AiImage; note: string }> {
  const img = await loadImage(objectUrl);
  const { naturalWidth: w, naturalHeight: h } = img;
  const needsResize = Math.max(w, h) > MAX_AI_DIM;
  const okMime = (IMAGE_MIME_WHITELIST as readonly string[]).includes(file.type);
  if (!needsResize && okMime && file.size <= 1.5 * 1024 * 1024) {
    return { image: { mimeType: file.type, data: await blobToBase64(file) }, note: `${w}×${h}px, giữ nguyên` };
  }
  const scale = Math.min(1, MAX_AI_DIM / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  if (!blob) throw new Error('encode');
  return { image: { mimeType: 'image/jpeg', data: await blobToBase64(blob) }, note: `${w}×${h} → ${cw}×${ch}px, JPEG` };
}

const btn = 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50';
const selectCls = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800';

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-indigo-600" />
      {label}
    </label>
  );
}

export default function AiOcrPage() {
  const { showToast, openSettings } = useApp();
  const { config: aiConfig, providerLabel } = useAiSettings();

  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  // Cấu hình OCR miễn phí
  const [langs, setLangs] = useState<string[]>(DEFAULT_LANGS);
  const [psm, setPsm] = useState<PsmMode>('auto');
  const [pre, setPre] = useState<PreprocessOptions>(DEFAULT_PREPROCESS);
  const [clean, setClean] = useState<CleanOptions>(DEFAULT_CLEAN);
  const [showBoxes, setShowBoxes] = useState(false);
  const [view, setView] = useState<'heat' | 'text'>('heat');

  // Trạng thái chạy
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ info: ProgressInfo | null; overall: number; index: number; total: number } | null>(null);
  const [ocrError, setOcrError] = useState<OcrErrorInfo | null>(null);
  const workerRef = useRef<OcrWorkerHandle | null>(null);
  const cancelRef = useRef(false);

  // Xem trước / sửa ảnh
  const srcCache = useRef(new Map<string, RgbaImage>());
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const [procSize, setProcSize] = useState<{ w: number; h: number } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewSig, setPreviewSig] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [skewInfo, setSkewInfo] = useState<{ angle: number; confident: boolean } | null>(null);
  const [darkHint, setDarkHint] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // AI
  const [keepTables, setKeepTables] = useState(true);
  const [hint, setHint] = useState('');
  const [aiMode, setAiMode] = useState<'text' | 'layout'>('text');
  const [aiKeepLayout, setAiKeepLayout] = useState(true);
  const [aiResult, setAiResult] = useState('');
  const [aiLabel, setAiLabel] = useState('');
  const [aiView, setAiView] = useState<'rendered' | 'raw'>('rendered');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiNote, setAiNote] = useState('');
  const aiAbort = useRef<AbortController | null>(null);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) || null, [items, selectedId]);
  const effective = useMemo<PreprocessOptions>(
    () => ({ ...pre, quarterTurns: selected?.quarterTurns ?? 0, deskewDeg: selected?.deskew ?? 0 }),
    [pre, selected?.quarterTurns, selected?.deskew],
  );
  const effectiveSig = preprocessSignature(effective);

  /* ---------- nạp ngôn ngữ đã lưu ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LANG_STORE);
      if (raw) setLangs(sanitizeLangs(JSON.parse(raw)));
    } catch { /* không có localStorage */ }
  }, []);
  const changeLangs = (next: string[]) => {
    const s = sanitizeLangs(next.length ? next : DEFAULT_LANGS);
    setLangs(s);
    try { localStorage.setItem(LANG_STORE, JSON.stringify(s)); } catch { /* bỏ qua */ }
  };

  /* ---------- thêm / xoá ảnh ---------- */
  const addFiles = useCallback((list: FileList | File[] | null | undefined) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    const added: Item[] = [];
    for (const f of files) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        showToast('Chưa hỗ trợ PDF trong công cụ OCR. Hãy xuất từng trang PDF thành ảnh bằng công cụ PDF/File rồi thả ảnh vào đây.');
        continue;
      }
      if (!f.type.startsWith('image/')) { showToast(`"${f.name}" không phải file ảnh.`); continue; }
      if (f.size > MAX_SOURCE_BYTES) { showToast(`"${f.name}" quá lớn (tối đa 25MB).`); continue; }
      added.push({ id: `img${++idCounter}`, file: f, url: URL.createObjectURL(f), quarterTurns: 0, deskew: 0, crop: null });
    }
    if (!added.length) return;
    const room = MAX_ITEMS - itemsRef.current.length;
    if (added.length > room) {
      showToast(`Tối đa ${MAX_ITEMS} ảnh trong hàng đợi.`);
      added.slice(Math.max(0, room)).forEach((a) => URL.revokeObjectURL(a.url));
    }
    const take = added.slice(0, Math.max(0, room));
    if (!take.length) return;
    setItems((cur) => [...cur, ...take]);
    setSelectedId(take[0].id);
    setOcrError(null);
  }, [showToast]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (files.length) { e.preventDefault(); addFiles(files); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const removeItem = (id: string) => {
    setItems((cur) => {
      const it = cur.find((x) => x.id === id);
      if (it) URL.revokeObjectURL(it.url);
      const next = cur.filter((x) => x.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id || '');
      return next;
    });
    srcCache.current.delete(id);
  };
  const clearAll = () => {
    items.forEach((i) => URL.revokeObjectURL(i.url));
    srcCache.current.clear();
    setItems([]);
    setSelectedId('');
    setAiResult('');
  };

  const patchItem = (id: string, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  /* ---------- dọn dẹp khi rời trang ---------- */
  useEffect(() => () => {
    cancelRef.current = true;
    aiAbort.current?.abort();
    void workerRef.current?.terminate().catch(() => {});
    workerRef.current = null;
    itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url));
  }, []);

  /* ---------- xem trước trực tiếp ---------- */
  const getSource = useCallback(async (it: Item): Promise<RgbaImage> => {
    const hit = srcCache.current.get(it.id);
    if (hit) return hit;
    const src = await decodeToRgba(it.url);
    srcCache.current.set(it.id, src);
    return src;
  }, []);

  useEffect(() => {
    if (!selected) { setProcSize(null); return; }
    let dead = false;
    setPreviewBusy(true);
    const t = setTimeout(async () => {
      try {
        const src = await getSource(selected);
        if (dead) return;
        const out = preprocess(src, effective);
        if (dead || !previewCanvas.current) return;
        rgbaToCanvas(out, previewCanvas.current);
        setProcSize({ w: out.width, h: out.height });
        setPreviewSig(effectiveSig);
      } catch {
        if (!dead) showToast('Không xử lý được ảnh này. Hãy thử ảnh khác.');
      } finally {
        if (!dead) setPreviewBusy(false);
      }
    }, 200);
    return () => { dead = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, effectiveSig, getSource, showToast]);

  // gợi ý nền tối + reset thông tin nghiêng khi đổi ảnh
  useEffect(() => {
    setSkewInfo(null);
    setDarkHint(false);
    if (!selected) return;
    let dead = false;
    void getSource(selected).then((src) => {
      if (dead) return;
      const small = src.width * src.height > 1_000_000 ? null : toGray(src);
      if (small && isDarkImage(small)) setDarkHint(true);
    }).catch(() => {});
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, getSource]);

  const detectSkew = async () => {
    if (!selected) return;
    try {
      const src = await getSource(selected);
      const base = rotate90(src, selected.quarterTurns);
      const r = estimateSkew(toGray(base));
      setSkewInfo({ angle: r.angle, confident: r.confident });
    } catch {
      showToast('Không dò được độ nghiêng.');
    }
  };

  /* ---------- kéo chọn vùng cắt ---------- */
  const pointFrac = (e: React.PointerEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onCropDown = (e: React.PointerEvent) => {
    if (!cropMode || !selected) return;
    const p = pointFrac(e);
    if (!p) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragStart(p);
    patchItem(selected.id, { crop: { x: p.x, y: p.y, w: 0, h: 0 } });
  };
  const onCropMove = (e: React.PointerEvent) => {
    if (!dragStart || !selected) return;
    const p = pointFrac(e);
    if (!p) return;
    patchItem(selected.id, { crop: { x: Math.min(dragStart.x, p.x), y: Math.min(dragStart.y, p.y), w: Math.abs(p.x - dragStart.x), h: Math.abs(p.y - dragStart.y) } });
  };
  const onCropUp = () => {
    if (!dragStart || !selected) return;
    setDragStart(null);
    if (selected.crop && (selected.crop.w < 0.02 || selected.crop.h < 0.02)) patchItem(selected.id, { crop: null });
  };

  /* ---------- chạy OCR miễn phí ---------- */

  const runOcr = async () => {
    if (running || !items.length) return;
    cancelRef.current = false;
    setRunning(true);
    setOcrError(null);
    setProgress({ info: null, overall: 0, index: 0, total: items.length });
    const queue = [...itemsRef.current];
    try {
      const key = langKey(langs);
      let reused = false;
      if (workerRef.current && workerRef.current.key !== key) {
        await workerRef.current.terminate().catch(() => {});
        workerRef.current = null;
      }
      let curIndex = 0;
      const onProg = (p: ProgressInfo) => {
        if (cancelRef.current) return;
        const own = reused ? (p.stage === 'recognize' ? p.stageProgress : 0) : p.overall;
        setProgress({ info: p, overall: (curIndex + own) / queue.length, index: curIndex, total: queue.length });
      };
      if (workerRef.current) reused = true;
      else {
        setProgress({ info: { stage: 'core', label: 'Đang tải lõi OCR', stageProgress: 0, overall: 0 }, overall: 0, index: 0, total: queue.length });
        workerRef.current = await createOcrWorker(langs, onProg);
      }
      const psmValue = PSM_OPTIONS.find((p) => p.id === psm)?.value || '3';
      for (let i = 0; i < queue.length; i++) {
        if (cancelRef.current) return;
        curIndex = i;
        const it = queue[i];
        const src = await getSource(it);
        const out = preprocess(src, { ...pre, quarterTurns: it.quarterTurns, deskewDeg: it.deskew });
        const canvas = document.createElement('canvas');
        rgbaToCanvas(out, canvas);
        const c = it.crop && it.crop.w > 0 && it.crop.h > 0 ? it.crop : null;
        const rectangle = c
          ? { left: Math.floor(c.x * out.width), top: Math.floor(c.y * out.height), width: Math.max(8, Math.floor(c.w * out.width)), height: Math.max(8, Math.floor(c.h * out.height)) }
          : undefined;
        const w = workerRef.current;
        if (!w) return;
        const res = await w.recognize(canvas, { psm: psmValue, rectangle });
        if (cancelRef.current) return;
        const lines = linesFromBlocks(res.blocks as Parameters<typeof linesFromBlocks>[0]);
        patchItem(it.id, { result: { lines, sig: preprocessSignature({ ...pre, quarterTurns: it.quarterTurns, deskewDeg: it.deskew }), procW: out.width, procH: out.height } });
        reused = true;
      }
      setProgress((p) => (p ? { ...p, overall: 1 } : p));
    } catch (e) {
      if (!cancelRef.current) {
        setOcrError(classifyOcrError(e, typeof navigator === 'undefined' ? true : navigator.onLine));
        // worker có thể đã hỏng: huỷ để lần thử lại tạo mới
        void workerRef.current?.terminate().catch(() => {});
        workerRef.current = null;
      }
    } finally {
      setRunning(false);
    }
  };

  const cancelOcr = () => {
    cancelRef.current = true;
    void workerRef.current?.terminate().catch(() => {});
    workerRef.current = null; // lần sau tạo worker mới (dữ liệu ngôn ngữ vẫn nằm trong bộ nhớ đệm)
    setRunning(false);
    setProgress(null);
  };

  /* ---------- kết quả gộp ---------- */
  const cleaned = useMemo(
    () => items.filter((i) => i.result).map((i) => ({ item: i, res: buildCleanedResult(i.result!.lines, clean) })),
    [items, clean],
  );
  const combinedText = useMemo(() => {
    if (cleaned.length <= 1) return cleaned[0]?.res.text || '';
    return cleaned.map((c, i) => `--- Ảnh ${i + 1}: ${c.item.file.name} ---\n${c.res.text}`).join('\n\n');
  }, [cleaned]);
  const avgConf = useMemo(() => {
    const all = cleaned.flatMap((c) => c.res.lines);
    return all.length ? averageConfidence(all) : null;
  }, [cleaned]);
  const selectedResult = selected?.result;
  const boxesValid = !!selectedResult && selectedResult.sig === previewSig && !!procSize && selectedResult.procW === procSize.w && selectedResult.procH === procSize.h;
  const selectedClean = cleaned.find((c) => c.item.id === selectedId)?.res;

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); showToast('Đã sao chép'); } catch { showToast('Không thể sao chép'); }
  };
  const download = (text: string, name: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ---------- AI ---------- */
  const aiFail = (e: unknown) => {
    if (e instanceof Error && !(e instanceof AiError)) {
      setAiError(e.message === 'size' ? 'Ảnh vẫn quá lớn sau khi nén. Hãy thử ảnh nhỏ hơn.' : 'Không xử lý được ảnh này. Hãy thử ảnh khác.');
    } else {
      const err = toAiError(e);
      if (!err.aborted) setAiError(err.message);
    }
  };

  const runAiImage = async () => {
    if (!selected || aiLoading) return;
    aiAbort.current?.abort();
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    setAiLoading(true);
    setAiError('');
    try {
      const { image, note } = await prepareImage(selected.file, selected.url);
      setAiNote(note);
      if (image.data.length > MAX_IMAGE_BASE64_BYTES) throw new Error('size');
      const text = await callAi({ task: 'ocr', options: { keepTables, hint, mode: aiMode }, image, ai: aiConfig, signal: ctrl.signal });
      setAiResult(text);
      setAiLabel('OCR bằng AI');
    } catch (e) {
      aiFail(e);
    } finally {
      if (aiAbort.current === ctrl) setAiLoading(false);
    }
  };

  const runAiFix = async () => {
    if (!combinedText.trim() || aiLoading) return;
    aiAbort.current?.abort();
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    setAiLoading(true);
    setAiError('');
    try {
      const text = await callAi({
        task: 'ocr-fix',
        input: combinedText,
        options: { language: hint || toAiLang(langs), keepLayout: aiKeepLayout },
        ai: aiConfig,
        signal: ctrl.signal,
      });
      setAiResult(text);
      setAiLabel('Văn bản OCR đã sửa bằng AI');
      setAiView('raw');
    } catch (e) {
      aiFail(e);
    } finally {
      if (aiAbort.current === ctrl) setAiLoading(false);
    }
  };

  const cancelAi = () => { aiAbort.current?.abort(); setAiLoading(false); };

  /* ---------- hiển thị ---------- */
  const setPreFlag = <K extends keyof PreprocessOptions>(k: K, v: PreprocessOptions[K]) => setPre((p) => ({ ...p, [k]: v }));
  const toggleLang = (code: string) => changeLangs(langs.includes(code) ? langs.filter((l) => l !== code) : [...langs, code]);
  const crop = selected?.crop && selected.crop.w > 0 && selected.crop.h > 0 ? selected.crop : null;
  const progressPct = progress ? Math.round(progress.overall * 100) : 0;

  const renderHeat = (res: { lines: OcrLine[] }) => {
    const rows: { para: number; nodes: React.ReactNode[] }[] = [];
    res.lines.forEach((l, li) => {
      const nodes = l.words.map((w, wi) => (
        <span
          key={`${li}-${wi}`}
          data-tooltip={`Độ tin cậy ${Math.round(w.conf)}%`}
          className={w.conf < LOW_CONF ? 'underline decoration-wavy decoration-red-500 underline-offset-2 bg-red-50' : ''}
        >
          {w.text}{' '}
        </span>
      ));
      if (clean.keepLineBreaks) rows.push({ para: l.para, nodes });
      else if (rows.length && rows[rows.length - 1].para === l.para) rows[rows.length - 1].nodes.push(...nodes);
      else rows.push({ para: l.para, nodes });
    });
    return (
      <div className="text-sm text-slate-800 leading-relaxed">
        {rows.map((r, i) => (
          <div key={i} className={i > 0 && rows[i - 1].para !== r.para ? 'mt-3' : ''}>{r.nodes}</div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
          <ScanText className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-sm sm:text-base font-bold tracking-tight">Đọc chữ từ ảnh (OCR)</h1>
          <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">Miễn phí, chạy ngay trong trình duyệt (ảnh không rời máy bạn). Có khóa AI thì thêm OCR chính xác hơn và sửa lỗi bằng AI.</p>
        </div>
      </div>

      <AiKeyNotice />

      <div className="grid lg:grid-cols-2 gap-3.5">
        {/* ===== Cột trái: ảnh + tuỳ chọn ===== */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            onClick={() => !selected && inputRef.current?.click()}
            className={`rounded-lg border-2 border-dashed min-h-48 flex items-center justify-center p-2 ${selected ? '' : 'cursor-pointer'} ${dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50'}`}
          >
            {selected ? (
              <div className="relative">
                <div
                  ref={wrapRef}
                  className="relative inline-block max-w-full touch-none select-none"
                  style={{ cursor: cropMode ? 'crosshair' : 'default' }}
                  onPointerDown={onCropDown}
                  onPointerMove={onCropMove}
                  onPointerUp={onCropUp}
                >
                  <canvas ref={previewCanvas} aria-label="Ảnh xem trước đã xử lý" className="block max-w-full max-h-96 w-auto h-auto rounded" />
                  {procSize && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${procSize.w} ${procSize.h}`} preserveAspectRatio="none">
                      {showBoxes && boxesValid && selectedResult!.lines.flatMap((l, li) => l.words.map((w, wi) => (
                        <rect key={`${li}-${wi}`} x={w.bbox.x0} y={w.bbox.y0} width={Math.max(1, w.bbox.x1 - w.bbox.x0)} height={Math.max(1, w.bbox.y1 - w.bbox.y0)}
                          fill="none" stroke={w.conf < LOW_CONF ? '#ef4444' : '#10b981'} strokeWidth={Math.max(1, procSize.w / 600)} />
                      )))}
                      {crop && (
                        <>
                          <path fillRule="evenodd" fill="rgba(15,23,42,0.45)"
                            d={`M0 0H${procSize.w}V${procSize.h}H0Z M${crop.x * procSize.w} ${crop.y * procSize.h}h${crop.w * procSize.w}v${crop.h * procSize.h}h${-crop.w * procSize.w}Z`} />
                          <rect x={crop.x * procSize.w} y={crop.y * procSize.h} width={crop.w * procSize.w} height={crop.h * procSize.h} fill="none" stroke="#6366f1" strokeWidth={Math.max(2, procSize.w / 400)} strokeDasharray="8 6" />
                        </>
                      )}
                    </svg>
                  )}
                  {previewBusy && <div className="absolute top-1 right-1 bg-slate-900/70 text-white rounded px-1.5 py-0.5 text-[10px] flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Đang xử lý</div>}
                </div>
              </div>
            ) : (
              <div className="text-center text-xs text-slate-500 space-y-1">
                <ImagePlus className="h-6 w-6 mx-auto text-slate-400" />
                <div>Nhấp để chọn, kéo thả hoặc dán (Ctrl+V) một hoặc nhiều ảnh (PNG, JPEG, WebP, GIF, BMP...)</div>
                <div className="text-[11px] text-slate-400">Chưa hỗ trợ PDF — hãy xuất trang PDF thành ảnh bằng công cụ PDF/File.</div>
              </div>
            )}
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {items.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {items.map((it, idx) => (
                  <div key={it.id} className={`relative shrink-0 h-14 w-14 rounded-md border-2 overflow-hidden ${it.id === selectedId ? 'border-indigo-500' : 'border-slate-200'}`}>
                    <button onClick={() => setSelectedId(it.id)} className="h-full w-full" data-tooltip={it.file.name}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.url} alt={`Ảnh ${idx + 1}`} className="h-full w-full object-cover" />
                    </button>
                    {it.result && <span className="absolute bottom-0 left-0 bg-emerald-600 text-white text-[9px] px-1">xong</span>}
                    <button onClick={() => removeItem(it.id)} aria-label="Xoá ảnh" className="absolute top-0 right-0 bg-slate-900/70 text-white rounded-bl p-0.5"><X className="h-3 w-3" /></button>
                  </div>
                ))}
                <button onClick={() => inputRef.current?.click()} className="shrink-0 h-14 w-14 rounded-md border-2 border-dashed border-slate-300 text-slate-400 hover:bg-slate-50 flex items-center justify-center" aria-label="Thêm ảnh"><ImagePlus className="h-4 w-4" /></button>
              </div>
              {selected && (
                <div className="flex items-center justify-between text-[11px] text-slate-500 gap-2">
                  <span className="truncate">{selected.file.name} · {(selected.file.size / 1024).toFixed(0)} KB{procSize && ` · ${procSize.w}×${procSize.h}px sau xử lý`}</span>
                  <button className={btn} onClick={clearAll}><Trash2 className="h-3 w-3" /> Xoá tất cả</button>
                </div>
              )}
            </div>
          )}

          {/* Ngôn ngữ */}
          <div>
            <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 mb-1"><Languages className="h-3 w-3" /> Ngôn ngữ trong ảnh (chọn nhiều được)</span>
            <div className="flex flex-wrap gap-1">
              {OCR_LANGS.map((l) => (
                <button key={l.code} onClick={() => toggleLang(l.code)} aria-pressed={langs.includes(l.code)}
                  className={`px-2 py-1 rounded-md text-[11px] border ${langs.includes(l.code) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {l.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Lần đầu tải mô hình ngôn ngữ (vài MB), sau đó dùng offline từ bộ nhớ đệm. Chọn càng ít ngôn ngữ càng nhanh và chính xác.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-2.5">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-500 mb-1">Kiểu bố cục trang</span>
              <Select value={psm} onChange={(e) => setPsm(e.target.value as PsmMode)} className={selectCls}>
                {PSM_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-500 mb-1">Đảo màu (ảnh nền tối)</span>
              <Select value={pre.invert} onChange={(e) => setPreFlag('invert', e.target.value as PreprocessOptions['invert'])} className={selectCls}>
                <option value="off">Tắt</option>
                <option value="auto">Tự động (nếu ảnh tối)</option>
                <option value="on">Luôn đảo</option>
              </Select>
            </label>
          </div>
          {darkHint && pre.invert === 'off' && (
            <div className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-2 flex items-center justify-between gap-2">
              Ảnh có vẻ nền tối (chữ sáng). Đảo màu thường đọc tốt hơn.
              <button className={btn} onClick={() => setPreFlag('invert', 'auto')}>Bật tự động</button>
            </div>
          )}

          {/* Tiền xử lý */}
          <details className="rounded-lg border border-slate-200 p-2.5" open>
            <summary className="text-[11px] font-semibold text-slate-600 cursor-pointer select-none">Xử lý ảnh trước khi đọc (xem trước trực tiếp)</summary>
            <div className="mt-2 space-y-2.5">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <Toggle checked={pre.upscale} onChange={(v) => setPreFlag('upscale', v)} label="Tự phóng ảnh nhỏ (~2000px)" />
                <Toggle checked={pre.grayscale} onChange={(v) => setPreFlag('grayscale', v)} label="Ảnh xám" />
                <Toggle checked={pre.levels} onChange={(v) => setPreFlag('levels', v)} label="Căng tương phản" />
                <Toggle checked={pre.denoise} onChange={(v) => setPreFlag('denoise', v)} label="Khử nhiễu (median 3×3)" />
                <Toggle checked={pre.sharpen} onChange={(v) => setPreFlag('sharpen', v)} label="Làm nét" />
              </div>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-500 mb-1">Nhị phân hoá (đen/trắng)</span>
                <Select value={pre.threshold} onChange={(e) => setPreFlag('threshold', e.target.value as PreprocessOptions['threshold'])} className={selectCls}>
                  <option value="off">Tắt</option>
                  <option value="otsu">Otsu (ảnh sáng đều)</option>
                  <option value="adaptive">Thích nghi (ánh sáng không đều)</option>
                </Select>
              </label>
              {selected && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button className={btn} onClick={() => patchItem(selected.id, { quarterTurns: (selected.quarterTurns + 3) % 4, crop: null, result: undefined })}><RotateCcw className="h-3 w-3" /> Xoay trái 90°</button>
                  <button className={btn} onClick={() => patchItem(selected.id, { quarterTurns: (selected.quarterTurns + 1) % 4, crop: null, result: undefined })}><RotateCw className="h-3 w-3" /> Xoay phải 90°</button>
                  <button className={`${btn} ${cropMode ? '!bg-indigo-600 !text-white' : ''}`} onClick={() => setCropMode((v) => !v)}><Crop className="h-3 w-3" /> {cropMode ? 'Đang chọn vùng: kéo trên ảnh' : 'Chọn vùng cần đọc'}</button>
                  {crop && <button className={btn} onClick={() => patchItem(selected.id, { crop: null })}>Bỏ vùng chọn</button>}
                  <button className={btn} onClick={detectSkew}><Gauge className="h-3 w-3" /> Dò độ nghiêng</button>
                  {selected.deskew !== 0 && <button className={btn} onClick={() => patchItem(selected.id, { deskew: 0, crop: null })}>Bỏ chỉnh nghiêng ({selected.deskew.toFixed(1)}°)</button>}
                </div>
              )}
              {skewInfo && selected && (
                <div className="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2 flex items-center justify-between gap-2">
                  {skewInfo.confident ? `Phát hiện ảnh nghiêng khoảng ${skewInfo.angle.toFixed(1)}°.` : 'Ảnh gần như thẳng (không phát hiện độ nghiêng đáng kể).'}
                  {skewInfo.confident && <button className={btn} onClick={() => { patchItem(selected.id, { deskew: -skewInfo.angle, crop: null, result: undefined }); setSkewInfo(null); }}><Wand2 className="h-3 w-3" /> Áp dụng chỉnh thẳng</button>}
                </div>
              )}
            </div>
          </details>

          {/* Hậu xử lý */}
          <details className="rounded-lg border border-slate-200 p-2.5">
            <summary className="text-[11px] font-semibold text-slate-600 cursor-pointer select-none">Làm sạch văn bản sau khi đọc</summary>
            <div className="mt-2 grid grid-cols-1 gap-1.5">
              <Toggle checked={clean.keepLineBreaks} onChange={(v) => setClean((c) => ({ ...c, keepLineBreaks: v }))} label="Giữ xuống dòng (tắt = nối các dòng thành đoạn)" />
              <Toggle checked={clean.removeNoise} onChange={(v) => setClean((c) => ({ ...c, removeNoise: v }))} label="Bỏ dòng nhiễu (ký tự lẻ loi, dấu rác)" />
              <Toggle checked={clean.tidySpaces} onChange={(v) => setClean((c) => ({ ...c, tidySpaces: v }))} label="Gọn khoảng trắng và dấu câu" />
              <Toggle checked={clean.fixConfusions} onChange={(v) => setClean((c) => ({ ...c, fixConfusions: v }))} label="Sửa nhầm lẫn trong số (O→0, l/I→1 cạnh chữ số)" />
            </div>
          </details>

          <div className="flex items-start gap-1.5 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Mẹo: chữ in rõ, ảnh thẳng và đủ lớn cho kết quả tốt nhất. Chữ viết tay và ảnh mờ thường kém — hãy thử OCR bằng AI bên dưới nếu có khóa.
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={runOcr} disabled={!items.length || running} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />} Đọc chữ{items.length > 1 ? ` (${items.length} ảnh)` : ''}
            </button>
            {running && (
              <button onClick={cancelOcr} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-50"><X className="h-3.5 w-3.5" /> Huỷ</button>
            )}
          </div>

          {progress && running && (
            <div className="space-y-1" role="status" aria-live="polite">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${progressPct}%` }} /></div>
              <div className="text-[11px] text-slate-500">
                {progress.info?.label || 'Đang chuẩn bị'}
                {progress.info && ` ${Math.round(progress.info.stageProgress * 100)}%`}
                {progress.total > 1 && ` · ảnh ${progress.index + 1}/${progress.total}`} · tổng {progressPct}%
                {progress.info?.stage === 'lang' || progress.info?.stage === 'core' ? ' (lần đầu cần mạng, các lần sau dùng bộ nhớ đệm)' : ''}
              </div>
            </div>
          )}

          {ocrError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs p-2.5" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1">{ocrError.message}</div>
              <button onClick={runOcr} disabled={running} className="underline shrink-0">Thử lại</button>
            </div>
          )}
        </div>

        {/* ===== Cột phải: kết quả ===== */}
        <div className="space-y-3.5">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5 min-h-[20rem]">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex gap-1 items-center">
                {(['heat', 'text'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${view === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    {v === 'heat' ? 'Độ tin cậy' : 'Văn bản'}
                  </button>
                ))}
                <label className="ml-2 flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} className="accent-indigo-600" />
                  <Eye className="h-3 w-3" /> Hộp chữ trên ảnh
                </label>
              </div>
              {combinedText && (
                <div className="flex gap-1.5 flex-wrap">
                  <button className={btn} onClick={() => copy(combinedText)}><Copy className="h-3 w-3" /> Sao chép</button>
                  <button className={btn} onClick={() => download(combinedText, 'ocr.txt')}><Download className="h-3 w-3" /> .txt</button>
                  <SendToButton text={combinedText} fromToolId="ai-ocr" />
                </div>
              )}
            </div>
            {avgConf !== null && (
              <div className="text-[11px] text-slate-600">
                Độ tin cậy trung bình: <span className={`font-bold ${avgConf >= 80 ? 'text-emerald-600' : avgConf >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{avgConf.toFixed(0)}%</span>
                {' · '}từ gạch chân đỏ có độ tin cậy dưới {LOW_CONF}%, nên kiểm tra lại
                {cleaned.some((c) => c.res.removedLines > 0) && ` · đã bỏ ${cleaned.reduce((s, c) => s + c.res.removedLines, 0)} dòng nhiễu`}
              </div>
            )}
            {running ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Đang đọc ảnh trong trình duyệt...</div>
            ) : cleaned.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-10">Chưa có kết quả. Chọn ảnh rồi bấm “Đọc chữ”.</div>
            ) : combinedText.trim() === '' ? (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Không tìm thấy chữ. Thử bật “Căng tương phản”/“Nhị phân hoá”, đổi kiểu bố cục, chọn đúng ngôn ngữ hoặc dùng OCR bằng AI.</div>
            ) : view === 'text' ? (
              <textarea readOnly value={combinedText} aria-label="Văn bản OCR" className="w-full min-h-64 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-mono text-slate-800" />
            ) : (
              <div className="space-y-3">
                {cleaned.map((c, i) => (
                  <div key={c.item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    {cleaned.length > 1 && <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Ảnh {i + 1}: {c.item.file.name}</div>}
                    {renderHeat(c.res)}
                  </div>
                ))}
              </div>
            )}
            {selectedClean && showBoxes && !boxesValid && (
              <p className="text-[11px] text-amber-700">Cài đặt xử lý ảnh đã đổi sau lần đọc trước nên hộp chữ không còn khớp. Bấm “Đọc chữ” lại.</p>
            )}
          </div>

          <AiSection requires="any" title="Tính năng AI nâng cao" description="OCR bằng AI giữ được bảng và bố cục; sửa lỗi OCR giúp khôi phục dấu tiếng Việt. Phần OCR miễn phí bên trái vẫn dùng bình thường.">
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800"><Sparkles className="h-3.5 w-3.5 text-indigo-600" /> Nâng cao bằng AI ({providerLabel})</div>

              <div className="rounded-lg border border-slate-200 p-2.5 space-y-2">
                <div className="text-[11px] font-semibold text-slate-700">OCR bằng AI (chính xác hơn, giữ bảng)</div>
                <div className="grid sm:grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="block text-[11px] font-semibold text-slate-500 mb-1">Ngôn ngữ gợi ý</span>
                    <Select searchThreshold={0} value={hint} onChange={(e) => setHint(e.target.value)} className={selectCls}>
                      <option value="">Tự phát hiện</option>
                      {Object.entries(LANGUAGE_LABELS_VI).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                    </Select>
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-semibold text-slate-500 mb-1">Chế độ</span>
                    <Select value={aiMode} onChange={(e) => setAiMode(e.target.value as 'text' | 'layout')} className={selectCls}>
                      <option value="text">Chỉ trích xuất chữ</option>
                      <option value="layout">Chữ + mô tả bố cục</option>
                    </Select>
                  </label>
                </div>
                <Toggle checked={keepTables} onChange={setKeepTables} label="Giữ định dạng bảng thành Markdown" />
                <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  Khác OCR miễn phí: ảnh được thu nhỏ tối đa {MAX_AI_DIM}px rồi gửi tới {providerLabel}. Tránh gửi ảnh chứa thông tin nhạy cảm.
                </div>
                <button onClick={runAiImage} disabled={!selected || aiLoading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Đọc ảnh đang chọn bằng AI
                </button>
                {aiNote && <span className="ml-2 text-[11px] text-slate-500">{aiNote}</span>}
              </div>

              <div className="rounded-lg border border-slate-200 p-2.5 space-y-2">
                <div className="text-[11px] font-semibold text-slate-700">Sửa lỗi OCR bằng AI</div>
                <p className="text-[11px] text-slate-500">Chỉ gửi phần văn bản OCR miễn phí (không gửi ảnh) — rẻ hơn và hợp để khôi phục dấu tiếng Việt.</p>
                <Toggle checked={aiKeepLayout} onChange={setAiKeepLayout} label="Giữ nguyên xuống dòng" />
                <button onClick={runAiFix} disabled={!combinedText.trim() || aiLoading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Sửa lỗi văn bản đã đọc
                </button>
                {!combinedText.trim() && <span className="ml-2 text-[11px] text-slate-400">Hãy chạy OCR miễn phí trước.</span>}
              </div>

              {aiLoading && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý với AI...
                  <button onClick={cancelAi} className="underline">Huỷ</button>
                </div>
              )}
              {aiError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs p-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    {aiError}
                    {/Cài đặt/.test(aiError) && <button onClick={() => openSettings('ai')} className="ml-1 underline font-semibold">Mở Cài đặt</button>}
                  </div>
                </div>
              )}
              {aiResult && !aiLoading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-semibold text-slate-600 mr-1">{aiLabel}</span>
                      {(['rendered', 'raw'] as const).map((v) => (
                        <button key={v} onClick={() => setAiView(v)} className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${aiView === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                          {v === 'rendered' ? 'Hiển thị' : 'Văn bản gốc'}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <button className={btn} onClick={() => copy(aiResult)}><Copy className="h-3 w-3" /> Sao chép</button>
                      <button className={btn} onClick={() => download(aiResult, 'ocr-ai.md')}><Download className="h-3 w-3" /> .md</button>
                      <button className={btn} onClick={() => download(aiResult, 'ocr-ai.txt')}><Download className="h-3 w-3" /> .txt</button>
                      <SendToButton text={aiResult} fromToolId="ai-ocr" />
                    </div>
                  </div>
                  {aiView === 'rendered' ? (
                    <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{aiResult}</ReactMarkdown></div>
                  ) : (
                    <pre className="whitespace-pre-wrap text-xs text-slate-800 font-mono bg-slate-50 rounded-lg p-3 border border-slate-200">{aiResult}</pre>
                  )}
                </div>
              )}
            </div>
          </AiSection>
        </div>
      </div>
    </div>
  );
}
