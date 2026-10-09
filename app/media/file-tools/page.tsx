'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileArchive,
  FileText,
  Upload,
  Trash2,
  Download,
  ArrowUp,
  ArrowDown,
  GripVertical,
  ShieldCheck,
  AlertTriangle,
  Folder,
  Search,
  Eye,
  Loader2,
  Package,
} from 'lucide-react';
import { PDFDocument, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  parsePageRanges,
  parsePageGroups,
  chunkPages,
  formatPageList,
  isUnsafeZipPath,
  sanitizeZipPath,
  sanitizeFileName,
  baseName,
  stripExt,
  formatBytes,
  looksBinary,
  dedupeName,
} from '@/lib/file-tools';
import { showConfirm } from '@/lib/dialog';

const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const TEXT_PREVIEW_CAP = 500 * 1024;
const IMAGE_PREVIEW_CAP = 10 * 1024 * 1024;
const BIG_ENTRY_CONFIRM = 200 * 1024 * 1024;
const BIG_TOTAL_WARN = 1024 * 1024 * 1024;
const ROW_RENDER_CAP = 1500;

type Tab = 'merge' | 'split' | 'zip';

const btn =
  'px-2.5 py-1.5 text-xs font-medium rounded-lg transition flex items-center gap-1 border disabled:opacity-50 disabled:cursor-not-allowed';
const btnPrimary = `${btn} bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600`;
const btnGhost = `${btn} bg-white hover:bg-slate-50 text-slate-700 border-slate-200`;
const inputCls =
  'w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-hidden focus:border-indigo-500 text-slate-800';

function pdfErrorMessage(e: unknown, name: string): string {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/encrypt|password/i.test(msg)) {
    return `"${name}" được mã hóa / đặt mật khẩu nên không thể xử lý. Hãy gỡ mật khẩu bằng ứng dụng khác rồi thử lại.`;
  }
  return `"${name}" bị hỏng hoặc không phải file PDF hợp lệ.`;
}

function download(bytes: Uint8Array | Blob, name: string, type: string) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  saveAs(blob, name);
}

async function loadPdf(file: File): Promise<{ doc: PDFDocument; pages: number }> {
  const buf = await file.arrayBuffer();
  const doc = await PDFDocument.load(buf); // không dùng ignoreEncryption: đó không phải giải mã
  return { doc, pages: doc.getPageCount() };
}

/* ------------------------------------------------------------------ */
/* Tab 1: Gộp PDF                                                       */
/* ------------------------------------------------------------------ */

interface MergeItem {
  id: number;
  file: File;
  pages: number;
  range: string;
}

function PrivacyNote() {
  return (
    <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
      Mọi thao tác chạy hoàn toàn trong trình duyệt của bạn — file không bao giờ được tải lên máy chủ.
    </p>
  );
}

function MergeTab() {
  const { showToast } = useApp();
  const [items, setItems] = useState<MergeItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragId, setDragId] = useState<number | null>(null);
  const idRef = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalBytes = items.reduce((s, i) => s + i.file.size, 0);

  const addFiles = async (list: FileList | File[]) => {
    setError('');
    setBusy(true);
    const errs: string[] = [];
    let running = totalBytes;
    const added: MergeItem[] = [];
    for (const file of Array.from(list)) {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        errs.push(`"${file.name}" không phải file PDF.`);
        continue;
      }
      if (running + file.size > MAX_TOTAL_BYTES) {
        errs.push(`Bỏ qua "${file.name}": tổng dung lượng vượt giới hạn ${formatBytes(MAX_TOTAL_BYTES)}.`);
        continue;
      }
      try {
        const { pages } = await loadPdf(file);
        running += file.size;
        added.push({ id: idRef.current++, file, pages, range: '' });
      } catch (e) {
        errs.push(pdfErrorMessage(e, file.name));
      }
    }
    setItems((prev) => [...prev, ...added]);
    setError(errs.join('\n'));
    setBusy(false);
  };

  const move = (from: number, to: number) => {
    setItems((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };

  const rangeError = (it: MergeItem): string => {
    if (!it.range.trim()) return '';
    const r = parsePageRanges(it.range, it.pages);
    return r.ok ? '' : r.error;
  };
  const anyRangeError = items.some((i) => rangeError(i));

  const merge = async () => {
    setError('');
    setBusy(true);
    try {
      const out = await PDFDocument.create();
      for (const it of items) {
        const { doc } = await loadPdf(it.file);
        let idx: number[];
        if (it.range.trim()) {
          const r = parsePageRanges(it.range, it.pages);
          if (!r.ok) throw new Error(`${it.file.name}: ${r.error}`);
          idx = r.pages.map((p) => p - 1);
        } else {
          idx = doc.getPageIndices();
        }
        const copied = await out.copyPages(doc, idx);
        copied.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      download(bytes, 'merged.pdf', 'application/pdf');
      showToast(`Đã gộp ${out.getPageCount()} trang thành merged.pdf`);
    } catch (e) {
      setError(e instanceof Error && !/encrypt|Invalid|parse/i.test(e.message) ? e.message : 'Không thể gộp: có file bị hỏng hoặc được mã hóa.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
        className="border-2 border-dashed border-slate-300 rounded-xl bg-white p-5 text-center"
      >
        <Upload className="h-6 w-6 mx-auto text-slate-400" />
        <p className="text-xs text-slate-600 mt-1.5">Kéo thả nhiều file PDF vào đây hoặc</p>
        <button type="button" onClick={() => inputRef.current?.click()} className={`${btnPrimary} mx-auto mt-2`}>
          Chọn file PDF
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="text-[11px] text-slate-400 mt-1.5">Tổng tối đa {formatBytes(MAX_TOTAL_BYTES)}.</p>
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 whitespace-pre-line flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {items.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-600">
              {items.length} file · {items.reduce((s, i) => s + i.pages, 0)} trang · {formatBytes(totalBytes)}
            </span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setItems([])} className={btnGhost}>
                <Trash2 className="h-3.5 w-3.5" /> Xóa hết
              </button>
              <button type="button" onClick={merge} disabled={busy || anyRangeError} className={btnPrimary}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Gộp &amp; tải xuống
              </button>
            </div>
          </div>
          <ul className="divide-y divide-slate-100">
            {items.map((it, idx) => {
              const err = rangeError(it);
              return (
                <li
                  key={it.id}
                  draggable
                  onDragStart={() => setDragId(it.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragId !== null) move(items.findIndex((x) => x.id === dragId), idx);
                    setDragId(null);
                  }}
                  onDragEnd={() => setDragId(null)}
                  className={`p-2.5 flex flex-wrap items-center gap-2 ${dragId === it.id ? 'opacity-50' : ''}`}
                >
                  <GripVertical className="h-4 w-4 text-slate-400 cursor-grab shrink-0" aria-label="Kéo để sắp xếp" />
                  <span className="text-[11px] text-slate-400 w-5 shrink-0">{idx + 1}.</span>
                  <FileText className="h-4 w-4 text-red-500 shrink-0" />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-xs font-medium text-slate-800 truncate" data-tooltip={it.file.name}>
                      {it.file.name}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {it.pages} trang · {formatBytes(it.file.size)}
                    </p>
                  </div>
                  <div className="w-44 shrink-0">
                    <input
                      value={it.range}
                      onChange={(e) =>
                        setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, range: e.target.value } : x)))
                      }
                      placeholder="Tất cả trang (hoặc 1-3,5)"
                      aria-label={`Khoảng trang của ${it.file.name}`}
                      className={`${inputCls} ${err ? 'border-red-400' : ''}`}
                    />
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button type="button" onClick={() => move(idx, idx - 1)} disabled={idx === 0} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg disabled:opacity-30" aria-label="Lên">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => move(idx, idx + 1)} disabled={idx === items.length - 1} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg disabled:opacity-30" aria-label="Xuống">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" aria-label="Xóa">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {err && <p className="basis-full text-[11px] text-red-600 pl-7">{err}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <PrivacyNote />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 2: Tách PDF                                                      */
/* ------------------------------------------------------------------ */

type SplitMode = 'extract' | 'each' | 'every' | 'groups' | 'rotate' | 'delete';

const MODE_LABEL: Record<SplitMode, string> = {
  extract: 'Trích khoảng trang → 1 file',
  each: 'Mỗi trang một file',
  every: 'Tách mỗi N trang',
  groups: 'Tách theo nhóm tùy chỉnh',
  rotate: 'Xoay trang',
  delete: 'Xóa trang',
};

interface SplitResult {
  name: string;
  bytes: Uint8Array;
  pages: number;
}

function SplitTab() {
  const { showToast } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mode, setMode] = useState<SplitMode>('extract');
  const [range, setRange] = useState('');
  const [every, setEvery] = useState('2');
  const [groups, setGroups] = useState('');
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [results, setResults] = useState<SplitResult[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = readShareParams();
    const m = p.get('sm') as SplitMode | null;
    if (m && m in MODE_LABEL) setMode(m);
    const e = p.get('n');
    if (e && /^\d+$/.test(e)) setEvery(e);
    const a = Number(p.get('a'));
    if (a === 90 || a === 180 || a === 270) setAngle(a);
  }, []);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    setResults([]);
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      setError(`"${f.name}" không phải file PDF.`);
      return;
    }
    if (f.size > MAX_TOTAL_BYTES) {
      setError(`File quá lớn (${formatBytes(f.size)}). Giới hạn ${formatBytes(MAX_TOTAL_BYTES)}.`);
      return;
    }
    setBusy(true);
    try {
      const { pages } = await loadPdf(f);
      setFile(f);
      setPageCount(pages);
    } catch (e) {
      setFile(null);
      setPageCount(0);
      setError(pdfErrorMessage(e, f.name));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!file) return;
    setError('');
    setResults([]);
    const stem = sanitizeFileName(stripExt(file.name), 'pdf');
    // kiểm tra đầu vào trước khi đọc file
    let plan: Array<{ name: string; pages: number[] }> = [];
    let rotateDelete: number[] = [];
    if (mode === 'extract') {
      const r = parsePageRanges(range, pageCount);
      if (!r.ok) return setError(r.error);
      plan = [{ name: `${stem}_trang_${formatPageList(r.pages).replace(/,/g, '_')}.pdf`, pages: r.pages }];
    } else if (mode === 'each') {
      plan = chunkPages(pageCount, 1).map((g) => ({ name: `${stem}_trang_${g[0]}.pdf`, pages: g }));
    } else if (mode === 'every') {
      const n = Number(every);
      if (!Number.isInteger(n) || n < 1) return setError('N phải là số nguyên từ 1 trở lên.');
      plan = chunkPages(pageCount, n).map((g) => ({
        name: `${stem}_phan_${g[0]}-${g[g.length - 1]}.pdf`,
        pages: g,
      }));
    } else if (mode === 'groups') {
      const g = parsePageGroups(groups, pageCount);
      if (!g.ok) return setError(g.error);
      plan = g.groups.map((pages, i) => ({ name: `${stem}_nhom_${i + 1}.pdf`, pages }));
    } else {
      const r = parsePageRanges(range, pageCount);
      if (!r.ok) return setError(r.error);
      rotateDelete = r.pages;
      if (mode === 'delete' && rotateDelete.length >= pageCount) {
        return setError('Không thể xóa toàn bộ trang của file.');
      }
    }
    if (plan.length > 500) return setError(`Sẽ tạo ${plan.length} file — quá nhiều (tối đa 500). Hãy tăng N.`);

    setBusy(true);
    try {
      const { doc: src } = await loadPdf(file);
      const out: SplitResult[] = [];
      if (mode === 'rotate' || mode === 'delete') {
        if (mode === 'rotate') {
          for (const p of rotateDelete) {
            const page = src.getPage(p - 1);
            page.setRotation(degrees((((page.getRotation().angle + angle) % 360) + 360) % 360));
          }
        } else {
          [...rotateDelete].sort((a, b) => b - a).forEach((p) => src.removePage(p - 1));
        }
        const bytes = await src.save();
        out.push({
          name: `${stem}_${mode === 'rotate' ? `xoay${angle}` : 'da_xoa_trang'}.pdf`,
          bytes,
          pages: src.getPageCount(),
        });
      } else {
        for (const item of plan) {
          const doc = await PDFDocument.create();
          const copied = await doc.copyPages(src, item.pages.map((p) => p - 1));
          copied.forEach((p) => doc.addPage(p));
          out.push({ name: item.name, bytes: await doc.save(), pages: item.pages.length });
          // nhường luồng giao diện giữa các file
          await new Promise((r) => setTimeout(r));
        }
      }
      setResults(out);
      showToast(`Hoàn tất: ${out.length} file.`);
    } catch (e) {
      setError(pdfErrorMessage(e, file.name));
    } finally {
      setBusy(false);
    }
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    const used = new Set<string>();
    results.forEach((r) => zip.file(dedupeName(r.name, used), r.bytes));
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `${sanitizeFileName(stripExt(file?.name ?? 'pdf'))}_tach.zip`);
  };

  const needsRange = mode === 'extract' || mode === 'rotate' || mode === 'delete';

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void pick(e.dataTransfer.files[0]);
        }}
        className="border-2 border-dashed border-slate-300 rounded-xl bg-white p-4 flex flex-wrap items-center gap-3"
      >
        <FileText className="h-6 w-6 text-red-500 shrink-0" />
        <div className="min-w-0 flex-1 basis-48">
          {file ? (
            <>
              <p className="text-xs font-medium text-slate-800 truncate">{file.name}</p>
              <p className="text-[11px] text-slate-400">
                {pageCount} trang · {formatBytes(file.size)}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-600">Kéo thả một file PDF vào đây hoặc chọn từ máy.</p>
          )}
        </div>
        <button type="button" onClick={() => inputRef.current?.click()} className={btnPrimary} disabled={busy}>
          <Upload className="h-3.5 w-3.5" /> Chọn file PDF
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 whitespace-pre-line flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {file && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(MODE_LABEL) as SplitMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setResults([]);
                  setError('');
                }}
                className={`px-2.5 py-1 text-xs rounded-lg border transition ${
                  mode === m
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          {needsRange && (
            <label className="block text-xs text-slate-600 space-y-1">
              <span>
                {mode === 'extract' ? 'Trang cần trích' : mode === 'rotate' ? 'Trang cần xoay' : 'Trang cần xóa'} (1–{pageCount}, ví dụ 1-3,5,8-10)
              </span>
              <input value={range} onChange={(e) => setRange(e.target.value)} placeholder="1-3,5" className={inputCls} />
            </label>
          )}
          {mode === 'every' && (
            <label className="block text-xs text-slate-600 space-y-1">
              <span>Số trang mỗi file (N)</span>
              <input value={every} onChange={(e) => setEvery(e.target.value)} inputMode="numeric" className={`${inputCls} max-w-32`} />
            </label>
          )}
          {mode === 'groups' && (
            <label className="block text-xs text-slate-600 space-y-1">
              <span>Mỗi dòng (hoặc phân cách bằng “|”) là một file, ví dụ: 1-3 | 4,6 | 7-9</span>
              <textarea value={groups} onChange={(e) => setGroups(e.target.value)} rows={4} placeholder={'1-3\n4,6\n7-9'} className={`${inputCls} font-mono`} />
            </label>
          )}
          {mode === 'rotate' && (
            <div className="flex gap-1.5 items-center text-xs text-slate-600">
              Góc xoay (theo chiều kim đồng hồ):
              {([90, 180, 270] as const).map((a) => (
                <button key={a} type="button" onClick={() => setAngle(a)} className={`px-2 py-1 rounded-lg border ${angle === a ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>
                  {a}°
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" onClick={run} disabled={busy} className={btnPrimary}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
              Thực hiện
            </button>
            <ShareLinkButton params={{ sm: mode, n: mode === 'every' ? every : '', a: mode === 'rotate' ? String(angle) : '' }} />
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Kết quả ({results.length} file)</span>
            {results.length > 1 && (
              <button type="button" onClick={downloadZip} className={btnPrimary}>
                <FileArchive className="h-3.5 w-3.5" /> Tải tất cả (ZIP)
              </button>
            )}
          </div>
          <ul className="divide-y divide-slate-100 max-h-96 overflow-auto">
            {results.map((r, i) => (
              <li key={i} className="px-3 py-2 flex items-center gap-2">
                <FileText className="h-4 w-4 text-red-500 shrink-0" />
                <span className="text-xs text-slate-800 truncate flex-1 min-w-0">{r.name}</span>
                <span className="text-[11px] text-slate-400 shrink-0">
                  {r.pages} trang · {formatBytes(r.bytes.length)}
                </span>
                <button type="button" onClick={() => download(r.bytes, r.name, 'application/pdf')} className={btnGhost}>
                  <Download className="h-3.5 w-3.5" /> Tải
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <PrivacyNote />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 3: Xem ZIP                                                       */
/* ------------------------------------------------------------------ */

interface ZipRow {
  path: string; // tên gốc
  dir: boolean;
  size: number | null; // chưa nén
  csize: number | null;
  date: Date | null;
  unsafe: boolean;
}

interface Preview {
  path: string;
  kind: 'text' | 'image' | 'binary' | 'toobig';
  text?: string;
  url?: string;
  note?: string;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

function extOf(p: string) {
  const m = /\.([^./]+)$/.exec(p);
  return m ? m[1].toLowerCase() : '';
}

/** Đọc kích thước từ dữ liệu nội bộ của JSZip (không công khai trong typings). */
function entrySizes(entry: JSZip.JSZipObject): { size: number | null; csize: number | null } {
  const d = (entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } })._data;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { size: num(d?.uncompressedSize), csize: num(d?.compressedSize) };
}

function ZipTab() {
  const { showToast } = useApp();
  const zipRef = useRef<JSZip | null>(null);
  const [zipName, setZipName] = useState('');
  const [zipSize, setZipSize] = useState(0);
  const [rows, setRows] = useState<ZipRow[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview]);

  const open = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    setPreview(null);
    setSelected(new Set());
    setFilter('');
    if (f.size > MAX_TOTAL_BYTES * 5) {
      setError(`File ZIP quá lớn (${formatBytes(f.size)}), giới hạn ${formatBytes(MAX_TOTAL_BYTES * 5)}.`);
      return;
    }
    setBusy(true);
    try {
      const zip = await JSZip.loadAsync(f); // chỉ đọc mục lục, chưa giải nén nội dung
      const list: ZipRow[] = [];
      zip.forEach((path, entry) => {
        const s = entrySizes(entry);
        list.push({
          path,
          dir: entry.dir,
          size: entry.dir ? 0 : s.size,
          csize: entry.dir ? 0 : s.csize,
          date: entry.date ?? null,
          unsafe: isUnsafeZipPath(path),
        });
      });
      list.sort((a, b) => a.path.localeCompare(b.path));
      zipRef.current = zip;
      setRows(list);
      setZipName(f.name);
      setZipSize(f.size);
    } catch (e) {
      zipRef.current = null;
      setRows([]);
      setZipName('');
      const msg = e instanceof Error ? e.message : '';
      setError(
        /encrypted/i.test(msg)
          ? `"${f.name}" được mã hóa bằng mật khẩu nên không thể mở.`
          : `Không thể đọc "${f.name}": file ZIP bị hỏng hoặc không đúng định dạng.`
      );
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(() => {
    let files = 0;
    let dirs = 0;
    let size = 0;
    let csize = 0;
    let unknown = false;
    let unsafe = 0;
    for (const r of rows) {
      if (r.unsafe) unsafe++;
      if (r.dir) {
        dirs++;
        continue;
      }
      files++;
      if (r.size === null) unknown = true;
      else size += r.size;
      csize += r.csize ?? 0;
    }
    return { files, dirs, size, csize, unknown, unsafe };
  }, [rows]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => r.path.toLowerCase().includes(q)) : rows;
  }, [rows, filter]);

  const ratio = totals.size > 0 && totals.csize > 0 ? totals.size / totals.csize : null;
  const bombSuspect = totals.size > BIG_TOTAL_WARN || (ratio !== null && ratio > 100);

  const getEntry = (path: string) => zipRef.current?.file(path) ?? null;

  const confirmBig = (size: number | null) =>
    size !== null && size > BIG_ENTRY_CONFIRM
      ? showConfirm(`File này khi giải nén là ${formatBytes(size)}. Có thể làm trình duyệt chậm hoặc treo. Vẫn tiếp tục?`, { title: 'File lớn', confirmText: 'Vẫn giải nén' })
      : Promise.resolve(true);

  const doPreview = async (row: ZipRow) => {
    const entry = getEntry(row.path);
    if (!entry) return;
    const ext = extOf(row.path);
    const mime = IMAGE_MIME[ext];
    const cap = mime ? IMAGE_PREVIEW_CAP : TEXT_PREVIEW_CAP;
    if (row.size === null || row.size > cap) {
      setPreview({
        path: row.path,
        kind: 'toobig',
        note: `Không xem trước được ${
          row.size === null ? '(không rõ kích thước)' : `(${formatBytes(row.size)} > ${formatBytes(cap)})`
        }. Hãy tải xuống file này.`,
      });
      return;
    }
    setBusy(true);
    try {
      const data = await entry.async('uint8array');
      if (mime) {
        const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
        setPreview({ path: row.path, kind: 'image', url });
      } else if (looksBinary(data)) {
        setPreview({ path: row.path, kind: 'binary', note: 'File nhị phân — không hiển thị dạng văn bản. Hãy tải xuống.' });
      } else {
        setPreview({ path: row.path, kind: 'text', text: new TextDecoder('utf-8').decode(data) });
      }
    } catch {
      setPreview({ path: row.path, kind: 'binary', note: 'Không giải nén được mục này (có thể bị hỏng hoặc có mật khẩu).' });
    } finally {
      setBusy(false);
    }
  };

  const downloadOne = async (row: ZipRow) => {
    const entry = getEntry(row.path);
    if (!entry || !(await confirmBig(row.size))) return;
    setBusy(true);
    try {
      const blob = await entry.async('blob');
      saveAs(blob, sanitizeFileName(baseName(row.path), 'file'));
    } catch {
      setError(`Không giải nén được "${row.path}".`);
    } finally {
      setBusy(false);
    }
  };

  const downloadSelected = async () => {
    const files = rows.filter((r) => selected.has(r.path) && !r.dir);
    if (files.length === 0) return showToast('Chưa chọn file nào.');
    const total = files.reduce((s, r) => s + (r.size ?? 0), 0);
    if (total > BIG_ENTRY_CONFIRM && !(await showConfirm(`Các file đã chọn có tổng ${formatBytes(total)} khi giải nén. Có thể làm trình duyệt chậm. Vẫn tiếp tục?`, { title: 'Dung lượng lớn', confirmText: 'Vẫn tải' }))) return;
    setBusy(true);
    try {
      const out = new JSZip();
      const used = new Set<string>();
      let renamed = 0;
      for (const r of files) {
        const safe = sanitizeZipPath(r.path);
        if (!safe || safe.endsWith('/')) continue;
        if (safe !== r.path) renamed++;
        const entry = getEntry(r.path);
        if (entry) out.file(dedupeName(safe, used), entry.async('uint8array'), { date: r.date ?? undefined });
      }
      const blob = await out.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      saveAs(blob, `${sanitizeFileName(stripExt(zipName), 'zip')}_chon.zip`);
      showToast(renamed ? `Đã tạo ZIP (${renamed} tên đã được làm sạch).` : 'Đã tạo ZIP mới.');
    } catch {
      setError('Không thể tạo ZIP mới: có mục bị hỏng.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (path: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const visible = shown.slice(0, ROW_RENDER_CAP);
  const visibleFiles = visible.filter((r) => !r.dir);
  const allSel = visibleFiles.length > 0 && visibleFiles.every((r) => selected.has(r.path));

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void open(e.dataTransfer.files[0]);
        }}
        className="border-2 border-dashed border-slate-300 rounded-xl bg-white p-4 flex flex-wrap items-center gap-3"
      >
        <FileArchive className="h-6 w-6 text-amber-500 shrink-0" />
        <div className="min-w-0 flex-1 basis-48">
          {zipName ? (
            <>
              <p className="text-xs font-medium text-slate-800 truncate">{zipName}</p>
              <p className="text-[11px] text-slate-400">{formatBytes(zipSize)}</p>
            </>
          ) : (
            <p className="text-xs text-slate-600">Kéo thả file .zip vào đây hoặc chọn từ máy. Nội dung chỉ được giải nén khi bạn bấm xem/tải.</p>
          )}
        </div>
        <button type="button" onClick={() => inputRef.current?.click()} className={btnPrimary} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Chọn file ZIP
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            void open(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3 text-xs text-slate-600 flex flex-wrap gap-x-5 gap-y-1">
            <span>
              <b className="text-slate-800">{totals.files}</b> file, <b className="text-slate-800">{totals.dirs}</b> thư mục
            </span>
            <span>
              Chưa nén: <b className="text-slate-800">{formatBytes(totals.size)}</b>
              {totals.unknown && ' (+ mục không rõ kích thước)'}
            </span>
            <span>
              Đã nén: <b className="text-slate-800">{formatBytes(totals.csize)}</b>
            </span>
            <span>
              Tỉ lệ nén:{' '}
              <b className="text-slate-800">
                {ratio !== null ? `${ratio.toFixed(2)}× (tiết kiệm ${Math.max(0, (1 - 1 / ratio) * 100).toFixed(1)}%)` : '—'}
              </b>
            </span>
          </div>

          {bombSuspect && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Cảnh báo: tổng dung lượng giải nén rất lớn ({formatBytes(totals.size)}
                {ratio !== null && `, tỉ lệ nén ${ratio.toFixed(0)}×`}). Có thể là “zip bomb”. Công cụ không tự giải nén — chỉ giải nén từng mục khi bạn bấm.
              </span>
            </div>
          )}
          {totals.unsafe > 0 && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {totals.unsafe} mục có đường dẫn nguy hiểm (chứa “..” hoặc đường dẫn tuyệt đối) — đã đánh dấu đỏ. Không giải nén file này bằng công cụ không kiểm tra; khi nén lại tại đây, tên sẽ được làm sạch.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3 items-start">
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
              <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-2">
                <div className="relative flex-1 basis-40">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Lọc theo tên…" className={`${inputCls} pl-7`} />
                </div>
                <button type="button" onClick={downloadSelected} disabled={busy || selected.size === 0} className={btnPrimary}>
                  <Download className="h-3.5 w-3.5" /> ZIP mục đã chọn ({selected.size})
                </button>
              </div>
              <div className="overflow-auto max-h-[28rem]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500 text-[11px]">
                    <tr>
                      <th className="p-2 w-8">
                        <input
                          type="checkbox"
                          checked={allSel}
                          onChange={() =>
                            setSelected((prev) => {
                              const n = new Set(prev);
                              visibleFiles.forEach((r) => (allSel ? n.delete(r.path) : n.add(r.path)));
                              return n;
                            })
                          }
                          aria-label="Chọn tất cả"
                        />
                      </th>
                      <th className="p-2 text-left">Tên</th>
                      <th className="p-2 text-right whitespace-nowrap">Chưa nén</th>
                      <th className="p-2 text-right whitespace-nowrap">Đã nén</th>
                      <th className="p-2 text-left whitespace-nowrap hidden sm:table-cell">Ngày</th>
                      <th className="p-2 w-16" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((r) => {
                      const clean = r.path.replace(/\/$/, '');
                      const depth = clean.split('/').length - 1;
                      return (
                        <tr key={r.path} className={r.unsafe ? 'bg-red-50' : r.dir ? 'bg-slate-50/60' : ''}>
                          <td className="p-2">
                            {!r.dir && <input type="checkbox" checked={selected.has(r.path)} onChange={() => toggle(r.path)} aria-label={`Chọn ${r.path}`} />}
                          </td>
                          <td className="p-2 max-w-0 w-full">
                            <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: Math.min(depth, 8) * 12 }}>
                              {r.dir ? <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" /> : <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                              <span className={`truncate ${r.unsafe ? 'text-red-700 font-medium' : 'text-slate-800'}`} data-tooltip={r.path}>
                                {baseName(clean) || r.path}
                              </span>
                              {r.unsafe && (
                                <span className="shrink-0 text-[10px] bg-red-100 text-red-700 border border-red-200 rounded px-1">đường dẫn nguy hiểm</span>
                              )}
                            </div>
                            {r.unsafe && <p className="text-[10px] text-red-500 truncate pl-5">{r.path}</p>}
                          </td>
                          <td className="p-2 text-right text-slate-500 whitespace-nowrap">{r.dir ? '' : formatBytes(r.size)}</td>
                          <td className="p-2 text-right text-slate-500 whitespace-nowrap">{r.dir ? '' : formatBytes(r.csize)}</td>
                          <td className="p-2 text-slate-400 whitespace-nowrap hidden sm:table-cell">
                            {r.date ? r.date.toLocaleString('vi-VN') : ''}
                          </td>
                          <td className="p-2">
                            {!r.dir && (
                              <div className="flex gap-0.5">
                                <button type="button" onClick={() => void doPreview(r)} disabled={busy} className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded" aria-label="Xem trước">
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => void downloadOne(r)} disabled={busy} className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded" aria-label="Tải xuống">
                                  <Download className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {shown.length === 0 && <p className="p-4 text-center text-xs text-slate-400">Không có mục nào khớp.</p>}
                {shown.length > ROW_RENDER_CAP && (
                  <p className="p-2 text-center text-[11px] text-slate-400">
                    Chỉ hiển thị {ROW_RENDER_CAP}/{shown.length} mục — hãy dùng ô lọc để thu hẹp.
                  </p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
              <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 text-xs font-bold text-slate-800 uppercase tracking-wider">Xem trước</div>
              <div className="p-3 text-xs">
                {!preview && <p className="text-slate-400">Bấm biểu tượng mắt để xem file văn bản (≤ 500 KB) hoặc ảnh.</p>}
                {preview && (
                  <>
                    <p className="font-medium text-slate-800 truncate mb-2" data-tooltip={preview.path}>
                      {preview.path}
                    </p>
                    {preview.kind === 'text' && (
                      <pre className="max-h-96 overflow-auto bg-slate-50 border border-slate-100 rounded-lg p-2 font-mono text-[11px] text-slate-800 whitespace-pre-wrap break-words">
                        {preview.text}
                      </pre>
                    )}
                    {preview.kind === 'image' && preview.url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={preview.url} alt={preview.path} className="max-w-full max-h-96 mx-auto rounded-lg border border-slate-100" />
                    )}
                    {(preview.kind === 'binary' || preview.kind === 'toobig') && <p className="text-amber-700">{preview.note}</p>}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}

/* ------------------------------------------------------------------ */

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'merge', label: 'Gộp PDF' },
  { id: 'split', label: 'Tách PDF' },
  { id: 'zip', label: 'Xem ZIP' },
];

export default function FileToolsPage() {
  const [tab, setTab] = useState<Tab>('merge');

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const t = readShareParams().get('tab');
    if (t === 'merge' || t === 'split' || t === 'zip') setTab(t);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <FileArchive className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">PDF &amp; ZIP</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Gộp / tách PDF và xem nội dung ZIP — xử lý ngay trên trình duyệt, file không rời khỏi máy bạn
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-1.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
              tab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'merge' && <MergeTab />}
      {tab === 'split' && <SplitTab />}
      {tab === 'zip' && <ZipTab />}
    </div>
  );
}
