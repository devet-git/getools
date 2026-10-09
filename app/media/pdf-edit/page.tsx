'use client';

import { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { FilePen, Upload, ArrowUp, ArrowDown, Trash2, ImagePlus, Download } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ToolHeader } from '@/components/ToolHeader';
import { Select } from '@/components/ui/searchable-select';
import { baseName, formatBytes, parsePageRanges, sanitizeFileName, stripExt } from '@/lib/file-tools';
import {
  addPageNumbers, addWatermark, formatPageLabel, imagesToPdf, pageCountOf, rebuildPages, toPdfSafeText,
  type ImagePage, type NumberFormat, type PageEdit, type Pos,
} from '@/lib/pdf-edit';
import { MAX_PIXELS, pdfRenderError, renderPages, type ImageFormat, type RenderedPage } from '@/lib/pdf-render';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const lbl = 'block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1';
const btn = 'px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50';
const MAX_BYTES = 150 * 1024 * 1024;
const TABS = [
  { id: 'number', label: 'Đánh số trang' },
  { id: 'watermark', label: 'Watermark' },
  { id: 'pages', label: 'Xoay / Xóa / Sắp xếp' },
  { id: 'images', label: 'Ảnh → PDF' },
  { id: 'toimg', label: 'PDF → Ảnh' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const errMsg = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  return /encrypt/i.test(m) ? 'PDF này được đặt mật khẩu / mã hóa nên không chỉnh sửa được.' : /Failed to parse|No PDF header|Invalid/i.test(m) ? 'Không đọc được file PDF (có thể bị hỏng).' : m;
};

interface Loaded { name: string; bytes: Uint8Array; pages: number }

/** Chọn và nạp một file PDF; dùng chung cho 3 tab chỉnh sửa. */
function PdfPicker({ loaded, onLoad }: { loaded: Loaded | null; onLoad: (l: Loaded | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { setError('Hãy chọn file PDF.'); return; }
    if (f.size > MAX_BYTES) { setError(`File quá lớn (tối đa ${formatBytes(MAX_BYTES)}).`); return; }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      onLoad({ name: f.name, bytes, pages: await pageCountOf(bytes) });
    } catch (e) {
      onLoad(null);
      // lỗi nạp file: luôn dùng thông báo thân thiện, không lộ thông điệp kỹ thuật của thư viện
      setError(/encrypt/i.test(e instanceof Error ? e.message : String(e)) ? errMsg(e) : 'Không đọc được file PDF (có thể bị hỏng hoặc không phải PDF).');
    }
  };
  return (
    <div className="space-y-1.5">
      <input ref={ref} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      <button onClick={() => ref.current?.click()} className="px-3 py-2 rounded-lg text-sm font-medium border border-dashed border-slate-300 hover:bg-slate-50 flex items-center gap-2 w-full justify-center"><Upload className="h-4 w-4" /> {loaded ? 'Chọn file PDF khác' : 'Chọn file PDF'}</button>
      {loaded && <p className="text-xs text-slate-600"><b>{loaded.name}</b> · {loaded.pages} trang · {formatBytes(loaded.bytes.length)}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function useRun() {
  const { showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<{ bytes: Uint8Array; name: string }>) => {
    setBusy(true); setError('');
    try {
      const { bytes, name } = await fn();
      saveAs(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name);
      showToast('Đã tạo file PDF');
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return { busy, error, run };
}

const outName = (l: Loaded, suffix: string) => `${sanitizeFileName(stripExt(baseName(l.name)), 'file')}_${suffix}.pdf`;

function NumberTab({ file }: { file: Loaded | null }) {
  const { busy, error, run } = useRun();
  const [position, setPosition] = useState<Pos>('bc');
  const [format, setFormat] = useState<NumberFormat>('n/N');
  const [start, setStart] = useState('1');
  const [size, setSize] = useState('11');
  const [skipFirst, setSkipFirst] = useState(false);
  const st = Number(start);
  const sz = Number(size);
  const valid = Number.isInteger(st) && st >= 0 && st <= 100000 && sz >= 6 && sz <= 48;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Vị trí
          <Select value={position} onChange={(e) => setPosition(e.target.value as Pos)}>
            <option value="bc">Dưới giữa</option><option value="br">Dưới phải</option><option value="bl">Dưới trái</option>
            <option value="tc">Trên giữa</option><option value="tr">Trên phải</option><option value="tl">Trên trái</option>
          </Select>
        </label>
        <label className={lbl}>Kiểu số
          <Select value={format} onChange={(e) => setFormat(e.target.value as NumberFormat)}>
            {(['n', 'n/N', '-n-', 'Page n of N'] as NumberFormat[]).map((f) => <option key={f} value={f}>{formatPageLabel(f, 3, 12)}</option>)}
          </Select>
        </label>
        <label className={lbl}>Bắt đầu từ số<input inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} className={field} /></label>
        <label className={lbl}>Cỡ chữ (pt)<input inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} className={field} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} /> Bỏ qua trang đầu (trang bìa không đánh số)</label>
      {!valid && <p className="text-sm text-red-600">Số bắt đầu 0–100000, cỡ chữ 6–48.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className={btn} disabled={!file || busy || !valid} onClick={() => file && run(async () => ({ bytes: await addPageNumbers(file.bytes, { position, format, start: st, fontSize: sz, skipFirst, margin: 24 }), name: outName(file, 'danhso') }))}>{busy ? 'Đang xử lý…' : 'Đánh số & tải về'}</button>
    </div>
  );
}

function WatermarkTab({ file }: { file: Loaded | null }) {
  const { busy, error, run } = useRun();
  const [text, setText] = useState('BAN NHAP');
  const [size, setSize] = useState('64');
  const [opacity, setOpacity] = useState(25);
  const [angle, setAngle] = useState(45);
  const [color, setColor] = useState('#cc0000');
  const [tile, setTile] = useState(false);
  const safe = toPdfSafeText(text);
  const rgbOf = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const sz = Number(size);
  const valid = safe.length > 0 && sz >= 8 && sz <= 300;
  return (
    <div className="space-y-3">
      <label className={lbl}>Nội dung<input value={text} onChange={(e) => setText(e.target.value)} className={field} maxLength={60} /></label>
      {text.trim() && safe !== text.trim() && <p className="text-xs text-amber-700">Font PDF chuẩn không có chữ có dấu, nội dung sẽ thành: &quot;{safe || '(trống)'}&quot;</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Cỡ chữ (pt)<input inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} className={field} /></label>
        <label className={lbl}>Màu<input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-full rounded-lg border border-slate-200 bg-white" /></label>
        <label className={lbl}>Độ đậm: {opacity}%<input type="range" min={5} max={100} value={opacity} onChange={(e) => setOpacity(+e.target.value)} className="w-full" /></label>
        <label className={lbl}>Góc nghiêng: {angle}°<input type="range" min={0} max={90} value={angle} onChange={(e) => setAngle(+e.target.value)} className="w-full" /></label>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={tile} onChange={(e) => setTile(e.target.checked)} /> Lặp 6 lần trên mỗi trang</label>
      {!valid && <p className="text-sm text-red-600">Nhập nội dung (ASCII) và cỡ chữ 8–300.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className={btn} disabled={!file || busy || !valid} onClick={() => file && run(async () => ({ bytes: await addWatermark(file.bytes, { text, size: sz, opacity: opacity / 100, angle, color: rgbOf(color), tile }), name: outName(file, 'watermark') }))}>{busy ? 'Đang xử lý…' : 'Thêm watermark & tải về'}</button>
    </div>
  );
}

function PagesTab({ file }: { file: Loaded | null }) {
  const { busy, error, run } = useRun();
  const [keep, setKeep] = useState('');
  const [rot, setRot] = useState('');
  const [deg, setDeg] = useState<'90' | '180' | '270'>('90');
  const total = file?.pages ?? 0;
  const keepRes = file ? (keep.trim() ? parsePageRanges(keep, total) : ({ ok: true, pages: Array.from({ length: total }, (_, i) => i + 1) } as const)) : null;
  const rotRes = file && rot.trim() ? parsePageRanges(rot, total) : null;
  const problem = keepRes && !keepRes.ok ? keepRes.error : rotRes && !rotRes.ok ? rotRes.error : '';
  const build = (): PageEdit[] => {
    const rotSet = new Set(rotRes && rotRes.ok ? rotRes.pages : []);
    return (keepRes && keepRes.ok ? keepRes.pages : []).map((p) => ({ source: p, rotate: rotSet.has(p) ? (Number(deg) as 90 | 180 | 270) : 0 }));
  };
  return (
    <div className="space-y-3">
      <label className={lbl}>Trang giữ lại, theo thứ tự mới (để trống = giữ tất cả)
        <input value={keep} onChange={(e) => setKeep(e.target.value)} placeholder={file ? `vd. 3, 1-2, 5-${total}` : 'vd. 3, 1-2, 5-8'} className={field} />
      </label>
      <p className="text-xs text-slate-500">Bỏ trang nào thì không ghi trang đó. &quot;3, 1-2&quot; đưa trang 3 lên đầu. Mỗi trang chỉ xuất hiện một lần.</p>
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <label className={lbl}>Xoay các trang<input value={rot} onChange={(e) => setRot(e.target.value)} placeholder="vd. 2, 4-6" className={field} /></label>
        <label className={lbl}>Góc (theo chiều kim đồng hồ)
          <Select value={deg} onChange={(e) => setDeg(e.target.value as '90' | '180' | '270')}><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></Select>
        </label>
      </div>
      {file && keepRes?.ok && !problem && <p className="text-xs text-slate-600">Kết quả: {keepRes.pages.length}/{total} trang.</p>}
      {(problem || error) && <p className="text-sm text-red-600">{problem || error}</p>}
      <button className={btn} disabled={!file || busy || !!problem} onClick={() => file && run(async () => ({ bytes: await rebuildPages(file.bytes, build()), name: outName(file, 'chinhsua') }))}>{busy ? 'Đang xử lý…' : 'Áp dụng & tải về'}</button>
    </div>
  );
}

interface Img { id: number; name: string; page: ImagePage }

async function toImagePage(f: File): Promise<ImagePage> {
  const buf = new Uint8Array(await f.arrayBuffer());
  if (f.type === 'image/jpeg') return { bytes: buf, type: 'jpg' };
  if (f.type === 'image/png') return { bytes: buf, type: 'png' };
  // WebP, GIF, BMP...: vẽ qua canvas rồi xuất PNG để pdf-lib nhúng được
  const bmp = await createImageBitmap(f);
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  cv.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
  if (!blob) throw new Error(`Không chuyển được "${f.name}".`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' };
}

function ImagesTab() {
  const { busy, error: runError, run } = useRun();
  const [imgs, setImgs] = useState<Img[]>([]);
  const [error, setError] = useState('');
  const [size, setSize] = useState<'a4' | 'fit'>('a4');
  const [margin, setMargin] = useState('24');
  const id = useRef(1);
  const ref = useRef<HTMLInputElement>(null);
  const total = imgs.reduce((s, i) => s + i.page.bytes.length, 0);
  const add = async (list: FileList | null) => {
    if (!list) return;
    setError('');
    const errs: string[] = [];
    const added: Img[] = [];
    let running = total;
    for (const f of Array.from(list)) {
      if (!f.type.startsWith('image/')) { errs.push(`"${f.name}" không phải ảnh.`); continue; }
      if (running + f.size > MAX_BYTES) { errs.push(`Bỏ qua "${f.name}": vượt giới hạn ${formatBytes(MAX_BYTES)}.`); continue; }
      try { const page = await toImagePage(f); running += f.size; added.push({ id: id.current++, name: f.name, page }); }
      catch { errs.push(`Không đọc được "${f.name}".`); }
    }
    setImgs((p) => [...p, ...added]);
    setError(errs.join('\n'));
  };
  const move = (i: number, d: number) => setImgs((p) => { const j = i + d; if (j < 0 || j >= p.length) return p; const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const m = Number(margin);
  const valid = Number.isFinite(m) && m >= 0 && m <= 200;
  return (
    <div className="space-y-3">
      <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      <button onClick={() => ref.current?.click()} className="px-3 py-2 rounded-lg text-sm font-medium border border-dashed border-slate-300 hover:bg-slate-50 flex items-center gap-2 w-full justify-center"><ImagePlus className="h-4 w-4" /> Thêm ảnh (JPG, PNG, WebP…)</button>
      {imgs.length > 0 && (
        <ul className="space-y-1">
          {imgs.map((im, i) => (
            <li key={im.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm">
              <span className="w-5 text-slate-400">{i + 1}</span><span className="flex-1 truncate">{im.name}</span><span className="text-xs text-slate-500">{formatBytes(im.page.bytes.length)}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Lên" className="p-1 text-slate-500 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button onClick={() => move(i, 1)} disabled={i === imgs.length - 1} aria-label="Xuống" className="p-1 text-slate-500 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button onClick={() => setImgs(imgs.filter((x) => x.id !== im.id))} aria-label="Xóa" className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Cỡ trang<Select value={size} onChange={(e) => setSize(e.target.value as 'a4' | 'fit')}><option value="a4">A4 (ảnh vừa trang, tự xoay ngang)</option><option value="fit">Theo kích thước ảnh</option></Select></label>
        <label className={lbl}>Lề (pt)<input inputMode="numeric" value={margin} onChange={(e) => setMargin(e.target.value)} className={field} /></label>
      </div>
      {!valid && <p className="text-sm text-red-600">Lề từ 0 đến 200.</p>}
      {(error || runError) && <p className="text-sm text-red-600 whitespace-pre-line">{error || runError}</p>}
      <button className={btn} disabled={imgs.length === 0 || busy || !valid} onClick={() => run(async () => ({ bytes: await imagesToPdf(imgs.map((i) => i.page), { size, margin: m, landscapeAuto: true }), name: 'anh.pdf' }))}>{busy ? 'Đang xử lý…' : `Tạo PDF từ ${imgs.length} ảnh`}</button>
    </div>
  );
}

const MAX_RENDER_PAGES = 60;

function ToImageTab({ file }: { file: Loaded | null }) {
  const [pages, setPages] = useState('');
  const [dpi, setDpi] = useState('150');
  const [format, setFormat] = useState<ImageFormat>('png');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<{ r: RenderedPage; url: string }[]>([]);
  const cancel = useRef({ cancelled: false });
  const total = file?.pages ?? 0;

  const range = file ? (pages.trim() ? parsePageRanges(pages, total) : ({ ok: true, pages: Array.from({ length: Math.min(total, MAX_RENDER_PAGES) }, (_, i) => i + 1) } as const)) : null;
  const rangeError = range && !range.ok ? range.error : range && range.ok && range.pages.length > MAX_RENDER_PAGES ? `Mỗi lần tối đa ${MAX_RENDER_PAGES} trang, hãy nhập khoảng trang nhỏ hơn.` : '';
  const dpiNum = Number(dpi);
  const dpiOk = Number.isFinite(dpiNum) && dpiNum >= 36 && dpiNum <= 600;

  // thu hồi object URL khi kết quả đổi hoặc rời trang
  useEffect(() => () => { results.forEach((x) => URL.revokeObjectURL(x.url)); }, [results]);
  useEffect(() => () => { cancel.current.cancelled = true; }, []);

  const run = async () => {
    if (!file || !range || !range.ok) return;
    cancel.current = { cancelled: false };
    setBusy(true); setError(''); setResults([]);
    try {
      const rendered = await renderPages(file.bytes, { pages: range.pages, dpi: dpiNum, format, quality: 0.92 }, (d, t) => setProgress(`Đang chuyển ${d}/${t} trang…`), cancel.current);
      setResults(rendered.map((r) => ({ r, url: URL.createObjectURL(r.blob) })));
    } catch (e) { setError(pdfRenderError(e)); } finally { setBusy(false); setProgress(''); }
  };

  const ext = format === 'png' ? 'png' : 'jpg';
  const base = file ? sanitizeFileName(stripExt(baseName(file.name)), 'file') : 'file';
  const nameOf = (page: number) => `${base}_trang${String(page).padStart(String(total).length, '0')}.${ext}`;
  const zipAll = async () => {
    const zip = new JSZip();
    results.forEach(({ r }) => zip.file(nameOf(r.page), r.blob));
    saveAs(await zip.generateAsync({ type: 'blob' }), `${base}_anh.zip`);
  };

  return (
    <div className="space-y-3">
      <label className={lbl}>Trang cần chuyển (để trống = tất cả{total > MAX_RENDER_PAGES ? `, tối đa ${MAX_RENDER_PAGES} trang đầu` : ''})
        <input value={pages} onChange={(e) => setPages(e.target.value)} placeholder={file ? `vd. 1-3, 5 (PDF có ${total} trang)` : 'vd. 1-3, 5'} className={field} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Độ phân giải (dpi)<input inputMode="numeric" value={dpi} onChange={(e) => setDpi(e.target.value)} className={field} /></label>
        <label className={lbl}>Định dạng<Select value={format} onChange={(e) => setFormat(e.target.value as ImageFormat)}><option value="png">PNG (nét, dung lượng lớn)</option><option value="jpeg">JPG (nhẹ hơn)</option></Select></label>
      </div>
      <p className="text-xs text-slate-500">150 dpi hợp để xem trên màn hình, 300 dpi để in. Ảnh quá lớn (&gt; {(MAX_PIXELS / 1e6).toFixed(0)} triệu điểm ảnh) sẽ tự giảm độ phân giải.</p>
      {!dpiOk && <p className="text-sm text-red-600">Độ phân giải từ 36 đến 600 dpi.</p>}
      {(rangeError || error) && <p className="text-sm text-red-600">{rangeError || error}</p>}
      <div className="flex items-center gap-3">
        <button className={btn} disabled={!file || busy || !dpiOk || !!rangeError} onClick={run}>{busy ? 'Đang xử lý…' : 'Chuyển thành ảnh'}</button>
        {progress && <span className="text-xs text-slate-500" role="status">{progress}</span>}
      </div>
      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-700">{results.length} ảnh</p>
            {results.length > 1 && <button onClick={zipAll} className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5"><Download className="h-4 w-4" /> Tải tất cả (ZIP)</button>}
          </div>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {results.map(({ r, url }) => (
              <li key={r.page} className="rounded-lg border border-slate-200 p-1.5 space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Trang ${r.page}`} className="w-full h-36 object-contain bg-slate-50 rounded" />
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Trang {r.page} · {r.width}×{r.height}</span>
                  <button onClick={() => saveAs(r.blob, nameOf(r.page))} aria-label={`Tải trang ${r.page}`} className="p-1 text-indigo-600 hover:bg-indigo-50 rounded"><Download className="h-3.5 w-3.5" /></button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PdfEditPage() {
  const [tab, setTab] = useState<Tab>('number');
  const [file, setFile] = useState<Loaded | null>(null);
  return (
    <div className="space-y-3.5">
      <ToolHeader icon={FilePen} title="Biên tập PDF" desc="Đánh số trang, thêm watermark, xoay / xóa / sắp xếp trang, ghép ảnh thành PDF và chuyển PDF thành ảnh. File không rời khỏi trình duyệt." />
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${tab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{t.label}</button>)}
      </div>
      <section className={`${card} space-y-3 max-w-2xl`}>
        {tab !== 'images' && <PdfPicker loaded={file} onLoad={setFile} />}
        {tab === 'number' && <NumberTab file={file} />}
        {tab === 'watermark' && <WatermarkTab file={file} />}
        {tab === 'pages' && <PagesTab key={file?.name} file={file} />}
        {tab === 'images' && <ImagesTab />}
        {tab === 'toimg' && <ToImageTab key={file?.name} file={file} />}
        <p className="text-xs text-slate-500">Mọi xử lý diễn ra trên trình duyệt của bạn. PDF có mật khẩu không chỉnh sửa được. Chữ chèn vào dùng font chuẩn nên tiếng Việt sẽ được bỏ dấu. Muốn gộp hoặc tách file, dùng tool &quot;PDF &amp; ZIP&quot;.</p>
      </section>
    </div>
  );
}
