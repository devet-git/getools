'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ImageDown,
  Upload,
  Trash2,
  Download,
  Archive,
  X,
  Loader2,
  AlertTriangle,
  Undo2,
  Info,
  Check,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  OutputFormat,
  ResizeMode,
  ResizeOptions,
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_DIMENSION,
  MAX_PIXELS,
  MIME_BY_FORMAT,
  RESIZE_PRESETS,
  formatBytes,
  percentSaved,
  calcDimensions,
  buildFileName,
  dedupeName,
  resolveOutputMime,
  isLossy,
  extForMime,
} from '@/lib/image-tools';
import { Select } from '@/components/ui/searchable-select';

const CONCURRENCY = 3;

interface Options {
  format: OutputFormat;
  quality: number;
  resize: ResizeOptions;
  background: string;
  suffix: string;
}

const DEFAULT_OPTIONS: Options = {
  format: 'keep',
  quality: 80,
  resize: { mode: 'none', maxWidth: 1920, maxHeight: 1080, width: 800, height: 600, lockAspect: true, percent: 50 },
  background: '#ffffff',
  suffix: '-nen',
};

interface Result {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  mime: string;
  note?: string;
}

interface Item {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  origW?: number;
  origH?: number;
  result?: Result;
  keepOriginal?: boolean;
  error?: string;
}

/* ---------- Xử lý ảnh ---------- */

interface Decoded {
  src: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decodeImage(file: File): Promise<Decoded> {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (!isSvg && typeof createImageBitmap === 'function') {
    for (const opts of [{ imageOrientation: 'from-image' as const }, undefined]) {
      try {
        const bmp = opts ? await createImageBitmap(file, opts) : await createImageBitmap(file);
        return { src: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
      } catch {
        /* thử cách khác */
      }
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Không giải mã được ảnh (định dạng không được hỗ trợ hoặc file hỏng).'));
      img.src = url;
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return {
    src: img,
    width: img.naturalWidth || 1024,
    height: img.naturalHeight || 1024,
    close: () => URL.revokeObjectURL(url),
  };
}

async function encodeCanvas(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void,
  mime: string,
  quality: number | undefined
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d');
      if (ctx) {
        draw(ctx);
        return await c.convertToBlob({ type: mime, quality });
      }
    } catch {
      /* rơi xuống HTMLCanvasElement */
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không tạo được canvas.');
  draw(ctx);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('Không mã hoá được ảnh (có thể ảnh quá lớn).');
  return blob;
}

const FORMAT_LABEL: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };

async function processImage(file: File, o: Options): Promise<{ result: Result; origW: number; origH: number }> {
  const dec = await decodeImage(file);
  try {
    const { width, height } = calcDimensions(dec.width, dec.height, o.resize);
    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
      throw new Error('Kích thước đầu ra quá lớn so với giới hạn của trình duyệt.');
    }
    const wantMime = resolveOutputMime(o.format, file.type);
    const quality = isLossy(wantMime) ? o.quality / 100 : undefined;
    const blob = await encodeCanvas(
      width,
      height,
      (ctx) => {
        if (wantMime === 'image/jpeg') {
          ctx.fillStyle = o.background;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(dec.src, 0, 0, width, height);
      },
      wantMime,
      quality
    );
    let mime = wantMime;
    let note: string | undefined;
    if (blob.type && blob.type !== wantMime) {
      mime = blob.type;
      note = `Trình duyệt không hỗ trợ xuất ${FORMAT_LABEL[wantMime] ?? wantMime}, đã dùng ${FORMAT_LABEL[mime] ?? mime}.`;
    } else if (o.format === 'keep' && file.type && file.type !== wantMime) {
      note = `Định dạng gốc không xuất trực tiếp được, đã chuyển sang ${FORMAT_LABEL[wantMime]}.`;
    }
    return {
      origW: dec.width,
      origH: dec.height,
      result: { blob, url: URL.createObjectURL(blob), width, height, mime, note },
    };
  } finally {
    dec.close();
  }
}

/* ---------- Giao diện ---------- */

let idCounter = 0;
const newId = () => `img-${Date.now().toString(36)}-${++idCounter}`;

function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(f.name);
}

function Compare({ item }: { item: Item }) {
  const [pos, setPos] = useState(50);
  const r = item.result;
  if (!r) return null;
  return (
    <div className="space-y-2">
      <div
        className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-lg border border-slate-200 bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] select-none"
        style={{ aspectRatio: `${r.width} / ${r.height}`, maxHeight: '70vh' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.url} alt="Sau" className="absolute inset-0 h-full w-full object-fill" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.previewUrl}
          alt="Trước"
          className="absolute inset-0 h-full w-full object-fill"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
          draggable={false}
        />
        <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow pointer-events-none" style={{ left: `${pos}%` }} />
        <span className="absolute left-2 top-2 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          Trước
        </span>
        <span className="absolute right-2 top-2 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          Sau
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label="Kéo để so sánh trước/sau"
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
      <p className="text-center text-[11px] text-slate-500">
        Kéo ngang trên ảnh để so sánh. Trước: {formatBytes(item.file.size)} ({item.origW}×{item.origH}) · Sau:{' '}
        {formatBytes(r.blob.size)} ({r.width}×{r.height})
      </p>
    </div>
  );
}

export default function ImageToolsPage() {
  const { showToast } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zipping, setZipping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const itemsRef = useRef<Item[]>([]);
  const optsRef = useRef<Options>(DEFAULT_OPTIONS);
  const epochRef = useRef(0);
  const inflight = useRef(new Set<string>());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Dọn object URL khi rời trang
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const it of itemsRef.current) {
        URL.revokeObjectURL(it.previewUrl);
        if (it.result) URL.revokeObjectURL(it.result.url);
      }
    };
  }, []);

  const updateOpts = useCallback((patch: Partial<Options>) => {
    const next = { ...optsRef.current, ...patch };
    optsRef.current = next;
    epochRef.current++;
    setOpts(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setItems((prev) =>
        prev.map((it) => {
          if (it.result) URL.revokeObjectURL(it.result.url);
          return { ...it, status: 'pending', result: undefined, keepOriginal: false, error: undefined };
        })
      );
    }, 300);
  }, []);

  const updateResize = (patch: Partial<ResizeOptions>) => updateOpts({ resize: { ...optsRef.current.resize, ...patch } });

  // Khởi tạo từ link chia sẻ
  useEffect(() => {
    const p = readShareParams();
    if (![...p.keys()].length) return;
    const num = (k: string, d: number) => {
      const v = Number(p.get(k));
      return p.has(k) && Number.isFinite(v) && v > 0 ? v : d;
    };
    const fmt = p.get('fmt');
    const mode = p.get('rm');
    const bg = p.get('bg');
    const base = DEFAULT_OPTIONS;
    const next: Options = {
      ...base,
      format: fmt === 'jpeg' || fmt === 'png' || fmt === 'webp' ? fmt : 'keep',
      quality: Math.min(100, Math.round(num('q', base.quality))),
      background: bg && /^[0-9a-f]{6}$/i.test(bg) ? `#${bg}` : base.background,
      resize: {
        ...base.resize,
        mode: mode === 'max' || mode === 'exact' || mode === 'percent' ? mode : 'none',
        maxWidth: num('mw', base.resize.maxWidth),
        maxHeight: num('mh', base.resize.maxHeight),
        width: num('w', base.resize.width),
        height: num('h', base.resize.height),
        percent: num('pc', base.resize.percent),
        lockAspect: p.get('lock') !== '0',
      },
    };
    optsRef.current = next;
    setOpts(next);
  }, []);

  // Bơm hàng đợi xử lý với giới hạn đồng thời
  useEffect(() => {
    for (const it of items) {
      if (inflight.current.size >= CONCURRENCY) break;
      if (it.status !== 'pending' || inflight.current.has(it.id)) continue;
      inflight.current.add(it.id);
      const epoch = epochRef.current;
      const id = it.id;
      setItems((p) => p.map((x) => (x.id === id ? { ...x, status: 'processing' } : x)));
      processImage(it.file, optsRef.current)
        .then(({ result, origW, origH }) => {
          inflight.current.delete(id);
          const exists = itemsRef.current.some((x) => x.id === id);
          if (!exists) {
            URL.revokeObjectURL(result.url);
            return;
          }
          if (epoch !== epochRef.current) {
            URL.revokeObjectURL(result.url);
            setItems((p) => p.map((x) => (x.id === id ? { ...x, status: 'pending', origW, origH } : x)));
            return;
          }
          setItems((p) => p.map((x) => (x.id === id ? { ...x, status: 'done', result, origW, origH } : x)));
        })
        .catch((e: unknown) => {
          inflight.current.delete(id);
          const msg = e instanceof Error ? e.message : 'Lỗi không xác định khi xử lý ảnh.';
          setItems((p) => p.map((x) => (x.id === id ? { ...x, status: 'error', error: msg } : x)));
        });
    }
  }, [items]);

  const addFiles = useCallback(
    (files: File[]) => {
      const imgs = files.filter(isImageFile);
      if (!imgs.length) {
        if (files.length) showToast('Không có file ảnh hợp lệ.');
        return;
      }
      const room = MAX_FILES - itemsRef.current.length;
      const accepted: File[] = [];
      let tooBig = 0;
      for (const f of imgs) {
        if (f.size > MAX_FILE_SIZE) tooBig++;
        else accepted.push(f);
      }
      const limited = accepted.slice(0, Math.max(0, room));
      if (tooBig) showToast(`Bỏ qua ${tooBig} ảnh lớn hơn ${formatBytes(MAX_FILE_SIZE)}.`);
      if (accepted.length > limited.length) showToast(`Chỉ xử lý tối đa ${MAX_FILES} ảnh mỗi lần.`);
      if (!limited.length) return;
      const added: Item[] = limited.map((file) => ({
        id: newId(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'pending',
      }));
      setItems((prev) => [...prev, ...added]);
      setSelectedId((s) => s ?? added[0].id);
    },
    [showToast]
  );

  // Dán ảnh bằng Ctrl+V
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      const stamp = Date.now();
      addFiles(
        files.map((f, i) => {
          const generic = !f.name || /^image\.\w+$/i.test(f.name);
          return generic ? new File([f], `dan-${stamp}-${i + 1}.${f.type.split('/')[1] || 'png'}`, { type: f.type }) : f;
        })
      );
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const removeItem = (id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (it) {
      URL.revokeObjectURL(it.previewUrl);
      if (it.result) URL.revokeObjectURL(it.result.url);
    }
    setItems((p) => p.filter((x) => x.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  };

  const clearAll = () => {
    for (const it of itemsRef.current) {
      URL.revokeObjectURL(it.previewUrl);
      if (it.result) URL.revokeObjectURL(it.result.url);
    }
    setItems([]);
    setSelectedId(null);
  };

  const toggleKeep = (id: string) =>
    setItems((p) => p.map((x) => (x.id === id ? { ...x, keepOriginal: !x.keepOriginal } : x)));

  // Tên file xuất (không trùng nhau)
  const outNames = useMemo(() => {
    const used = new Set<string>();
    const map = new Map<string, string>();
    for (const it of items) {
      if (it.keepOriginal) {
        map.set(it.id, dedupeName(it.file.name, used));
      } else {
        const ext = it.result ? extForMime(it.result.mime) : extForMime(resolveOutputMime(opts.format, it.file.type));
        map.set(it.id, dedupeName(buildFileName(it.file.name, opts.suffix, ext), used));
      }
    }
    return map;
  }, [items, opts.format, opts.suffix]);

  const blobOf = (it: Item): Blob | null => (it.keepOriginal ? it.file : (it.result?.blob ?? null));

  const downloadOne = (it: Item) => {
    const b = blobOf(it);
    if (b) saveAs(b, outNames.get(it.id) ?? it.file.name);
  };

  const downloadZip = async () => {
    const ready = items.filter((i) => blobOf(i));
    if (!ready.length) return;
    setZipping(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const it of ready) zip.file(outNames.get(it.id) ?? it.file.name, blobOf(it) as Blob);
      const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      saveAs(out, 'anh-da-xu-ly.zip');
    } catch {
      showToast('Không tạo được file ZIP.');
    } finally {
      setZipping(false);
    }
  };

  const doneItems = items.filter((i) => i.status === 'done');
  const busy = items.some((i) => i.status === 'pending' || i.status === 'processing');
  const totalOrig = doneItems.reduce((s, i) => s + i.file.size, 0);
  const totalNew = doneItems.reduce((s, i) => s + (i.keepOriginal ? i.file.size : (i.result?.blob.size ?? 0)), 0);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const outMime = resolveOutputMime(opts.format, 'image/png');
  const showQuality = opts.format === 'keep' || isLossy(MIME_BY_FORMAT[opts.format]);
  const rz = opts.resize;
  const inputCls =
    'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none';
  const labelCls = 'block text-[11px] font-semibold text-slate-600 mb-1';

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <ImageDown className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Nén / Đổi cỡ / Đổi định dạng ảnh</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Xử lý nhiều ảnh cùng lúc ngay trên trình duyệt, ảnh không bao giờ được tải lên máy chủ.
            </p>
          </div>
        </div>
        <ShareLinkButton
          params={{
            fmt: opts.format === 'keep' ? '' : opts.format,
            q: String(opts.quality),
            rm: rz.mode === 'none' ? '' : rz.mode,
            mw: rz.mode === 'max' ? String(rz.maxWidth) : '',
            mh: rz.mode === 'max' ? String(rz.maxHeight) : '',
            w: rz.mode === 'exact' ? String(rz.width) : '',
            h: rz.mode === 'exact' ? String(rz.height) : '',
            lock: rz.mode === 'exact' && !rz.lockAspect ? '0' : '',
            pc: rz.mode === 'percent' ? String(rz.percent) : '',
            bg: opts.background.slice(1),
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-100"
        />
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[320px_1fr] items-start">
        {/* Tuỳ chọn */}
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 space-y-3.5">
          <div>
            <label className={labelCls}>Định dạng đầu ra</label>
            <Select
              className={inputCls}
              value={opts.format}
              onChange={(e) => updateOpts({ format: e.target.value as OutputFormat })}
            >
              <option value="keep">Giữ nguyên (GIF/BMP/AVIF/SVG → PNG)</option>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </Select>
          </div>

          {showQuality && (
            <div>
              <label className={labelCls}>
                Chất lượng: {opts.quality}%{' '}
                <span className="font-normal text-slate-400">(chỉ áp dụng cho JPEG / WebP)</span>
              </label>
              <input
                type="range"
                min={1}
                max={100}
                value={opts.quality}
                onChange={(e) => updateOpts({ quality: Number(e.target.value) })}
                className="w-full accent-indigo-600"
              />
            </div>
          )}

          <div className="space-y-2">
            <label className={labelCls}>Đổi kích thước</label>
            <Select
              className={inputCls}
              value={rz.mode}
              onChange={(e) => updateResize({ mode: e.target.value as ResizeMode })}
            >
              <option value="none">Giữ nguyên kích thước</option>
              <option value="max">Giới hạn rộng / cao tối đa (giữ tỉ lệ)</option>
              <option value="exact">Rộng × cao cụ thể</option>
              <option value="percent">Theo tỉ lệ %</option>
            </Select>

            {rz.mode === 'max' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Rộng tối đa (px)</label>
                    <input
                      type="number"
                      min={1}
                      className={inputCls}
                      value={rz.maxWidth || ''}
                      onChange={(e) => updateResize({ maxWidth: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Cao tối đa (px)</label>
                    <input
                      type="number"
                      min={1}
                      className={inputCls}
                      value={rz.maxHeight || ''}
                      onChange={(e) => updateResize({ maxHeight: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {RESIZE_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => updateResize({ mode: 'max', maxWidth: p.maxWidth, maxHeight: p.maxHeight })}
                      className="rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2 py-1 text-[11px] text-slate-700"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">Chỉ thu nhỏ, không phóng to ảnh nhỏ hơn giới hạn.</p>
              </>
            )}

            {rz.mode === 'exact' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Rộng (px)</label>
                    <input
                      type="number"
                      min={1}
                      className={inputCls}
                      value={rz.width || ''}
                      onChange={(e) => updateResize({ width: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Cao (px)</label>
                    <input
                      type="number"
                      min={1}
                      className={inputCls}
                      value={rz.height || ''}
                      onChange={(e) => updateResize({ height: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={rz.lockAspect}
                    onChange={(e) => updateResize({ lockAspect: e.target.checked })}
                    className="accent-indigo-600"
                  />
                  Khoá tỉ lệ (vừa trong khung rộng × cao)
                </label>
              </>
            )}

            {rz.mode === 'percent' && (
              <div>
                <label className={labelCls}>Tỉ lệ: {rz.percent}%</label>
                <input
                  type="range"
                  min={5}
                  max={300}
                  value={rz.percent}
                  onChange={(e) => updateResize({ percent: Number(e.target.value) })}
                  className="w-full accent-indigo-600"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Nền khi ảnh trong suốt → JPEG</label>
              <input
                type="color"
                value={opts.background}
                onChange={(e) => updateOpts({ background: e.target.value })}
                className="h-8 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-0.5"
              />
            </div>
            <div>
              <label className={labelCls}>Hậu tố tên file</label>
              <input
                className={inputCls}
                value={opts.suffix}
                maxLength={30}
                onChange={(e) => updateOpts({ suffix: e.target.value })}
              />
            </div>
          </div>

          <div className="flex gap-2 rounded-md bg-slate-50 border border-slate-200 p-2 text-[11px] text-slate-600">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span>
              Ảnh được vẽ lại qua canvas nên toàn bộ metadata (EXIF, GPS, thông tin máy ảnh) tự động bị xoá. Hướng xoay EXIF
              được áp dụng trước khi xử lý. GIF động chỉ lấy khung hình đầu. Định dạng mặc định khi giữ nguyên:{' '}
              {FORMAT_LABEL[outMime]}.
            </span>
          </div>
        </div>

        {/* Danh sách */}
        <div className="space-y-3.5 min-w-0">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(Array.from(e.dataTransfer.files));
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
            }}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:bg-slate-50'
            }`}
          >
            <Upload className="mx-auto h-6 w-6 text-slate-400" />
            <p className="mt-1.5 text-sm font-medium text-slate-700">Kéo thả ảnh vào đây, bấm để chọn, hoặc dán (Ctrl+V)</p>
            <p className="text-[11px] text-slate-500">
              PNG, JPEG, WebP, GIF, BMP, AVIF, SVG · tối đa {MAX_FILES} ảnh, mỗi ảnh {formatBytes(MAX_FILE_SIZE)}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>

          {items.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-600">
                {items.length} ảnh · {doneItems.length} xong
                {busy && (
                  <span className="inline-flex items-center gap-1 ml-2 text-indigo-600">
                    <Loader2 className="h-3 w-3 animate-spin" /> Đang xử lý...
                  </span>
                )}
                {doneItems.length > 0 && (
                  <span className="ml-2 font-medium text-slate-800">
                    {formatBytes(totalOrig)} → {formatBytes(totalNew)} ({percentSaved(totalOrig, totalNew)}% tiết kiệm)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={downloadZip}
                  disabled={!doneItems.length || zipping}
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white"
                >
                  {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                  Tải tất cả (ZIP)
                </button>
                <button
                  onClick={clearAll}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Xoá hết
                </button>
              </div>
            </div>
          )}

          {items.length === 0 && (
            <p className="text-center text-xs text-slate-500 py-4">Chưa có ảnh nào. Thêm ảnh để bắt đầu.</p>
          )}

          <div className="space-y-2">
            {items.map((it) => {
              const r = it.result;
              const saved = r ? percentSaved(it.file.size, r.blob.size) : 0;
              const larger = !!r && r.blob.size >= it.file.size;
              const isSel = it.id === selectedId;
              return (
                <div
                  key={it.id}
                  className={`bg-white rounded-xl border p-2.5 flex gap-3 ${
                    isSel ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-slate-200'
                  }`}
                >
                  <button
                    onClick={() => setSelectedId(isSel ? null : it.id)}
                    className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                    title="Xem so sánh trước/sau"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.previewUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  </button>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-800" title={it.file.name}>
                        {it.file.name}
                      </p>
                      <button
                        onClick={() => removeItem(it.id)}
                        className="shrink-0 text-slate-400 hover:text-red-600"
                        aria-label="Xoá ảnh"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Gốc: {formatBytes(it.file.size)}
                      {it.origW ? ` · ${it.origW}×${it.origH}` : ''}
                    </p>
                    {(it.status === 'pending' || it.status === 'processing') && (
                      <p className="inline-flex items-center gap-1 text-[11px] text-indigo-600">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {it.status === 'pending' ? 'Đang chờ...' : 'Đang xử lý...'}
                      </p>
                    )}
                    {it.status === 'error' && (
                      <p className="inline-flex items-center gap-1 text-[11px] text-red-600">
                        <AlertTriangle className="h-3 w-3" /> {it.error}
                      </p>
                    )}
                    {it.status === 'done' && r && (
                      <>
                        <p className="text-[11px] text-slate-700">
                          {it.keepOriginal ? (
                            <span className="font-medium text-amber-700">Giữ ảnh gốc: {formatBytes(it.file.size)}</span>
                          ) : (
                            <>
                              Kết quả: <span className="font-medium">{formatBytes(r.blob.size)}</span> · {r.width}×{r.height} ·{' '}
                              <span className={larger ? 'font-semibold text-red-600' : 'font-semibold text-emerald-600'}>
                                {saved >= 0 ? `-${saved}%` : `+${Math.abs(saved)}%`}
                              </span>
                            </>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-slate-400">{outNames.get(it.id)}</p>
                        {r.note && <p className="text-[11px] text-amber-700">{r.note}</p>}
                        {larger && !it.keepOriginal && (
                          <p className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                            <AlertTriangle className="h-3 w-3" /> Kết quả lớn hơn ảnh gốc.
                          </p>
                        )}
                      </>
                    )}
                    {it.status === 'done' && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button
                          onClick={() => downloadOne(it)}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 px-2 py-1 text-[11px] font-medium text-white"
                        >
                          <Download className="h-3 w-3" /> Tải về
                        </button>
                        {(larger || it.keepOriginal) && (
                          <button
                            onClick={() => toggleKeep(it.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800"
                          >
                            {it.keepOriginal ? (
                              <>
                                <Undo2 className="h-3 w-3" /> Dùng kết quả mới
                              </>
                            ) : (
                              <>
                                <Check className="h-3 w-3" /> Giữ ảnh gốc
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {selected && selected.status === 'done' && (
            <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
              <h2 className="text-xs font-bold text-slate-700">So sánh trước / sau: {selected.file.name}</h2>
              <Compare key={selected.result?.url} item={selected} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
