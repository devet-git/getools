'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { FileOutput, CheckCircle2, Download, FileArchive, Loader2, Play, Trash2, Upload, X, XCircle } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/searchable-select';
import { formatBytes } from '@/lib/file-tools';
import { ACCEPT, convertersFor, kindLabel, runConverter, supportSummary, unsupportedReason } from '@/lib/file-convert/registry';
import { DEFAULT_OPTIONS, type ConvertOutput, type Converter } from '@/lib/file-convert/types';
import { dedupeNames, MAX_FILE_BYTES, safeBase } from '@/lib/file-convert/util';
import { useLeaveGuard } from '@/hooks/use-leave-guard';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const MAX_FILES = 100;
/** Số file kết quả hiển thị trong mỗi thẻ; phần còn lại tải qua ZIP. */
const SHOW_RESULTS = 12;
const DPI_CHOICES = [72, 96, 150, 200, 300];

type Status = 'idle' | 'running' | 'done' | 'error';

interface Item {
  id: number;
  file: File;
  kind: string;
  targets: Converter[];
  targetId: string;
  quality: number;
  dpi: number;
  status: Status;
  error: string;
  results: ConvertOutput[];
  /** Lý do không chuyển được (định dạng chưa hỗ trợ, quá lớn…). */
  reason: string | null;
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  idle: { label: 'Đang chờ', cls: 'bg-slate-100 text-slate-600' },
  running: { label: 'Đang chuyển', cls: 'bg-indigo-50 text-indigo-700' },
  done: { label: 'Xong', cls: 'bg-emerald-50 text-emerald-700' },
  error: { label: 'Lỗi', cls: 'bg-red-50 text-red-700' },
};

async function zipAndSave(files: ConvertOutput[], zipName: string) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const names = dedupeNames(files.map((f) => f.name));
  files.forEach((f, i) => zip.file(names[i], f.blob));
  saveAs(await zip.generateAsync({ type: 'blob' }), zipName);
}

export default function FileConvertPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [notice, setNotice] = useState('');
  useLeaveGuard(running || zipping, 'Đang chuyển đổi file, rời trang sẽ dừng và mất kết quả chưa tải về.');
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  // Bản mới nhất của danh sách để vòng chuyển tuần tự đọc đúng lựa chọn hiện tại
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const summary = useMemo(() => supportSummary(), []);

  const patch = (id: number, p: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const room = MAX_FILES - itemsRef.current.length;
    const take = files.slice(0, Math.max(0, room));
    setNotice(files.length > take.length ? `Chỉ nhận tối đa ${MAX_FILES} file mỗi lượt, đã bỏ qua ${files.length - take.length} file.` : '');
    const added: Item[] = take.map((file) => {
      const targets = convertersFor(file);
      const reason = unsupportedReason(file);
      return {
        id: nextId.current++, file, kind: kindLabel(file), targets, targetId: targets[0]?.id ?? '',
        quality: DEFAULT_OPTIONS.quality, dpi: DEFAULT_OPTIONS.dpi, status: 'idle', error: '', results: [], reason,
      };
    });
    setItems((list) => [...list, ...added]);
  };

  // Đổi đích / tuỳ chọn thì kết quả cũ không còn đúng
  const changeOpt = (id: number, p: Partial<Pick<Item, 'targetId' | 'quality' | 'dpi'>>) => patch(id, { ...p, status: 'idle', error: '', results: [] });

  const convertOne = async (id: number) => {
    const it = itemsRef.current.find((x) => x.id === id);
    const conv = it?.targets.find((c) => c.id === it.targetId);
    if (!it || !conv || it.reason) return;
    patch(id, { status: 'running', error: '', results: [] });
    try {
      const results = await runConverter(conv, it.file, { quality: it.quality, dpi: it.dpi });
      patch(id, { status: 'done', results });
    } catch (e) {
      patch(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };

  const runAll = async () => {
    setRunning(true);
    try {
      // Tuần tự để không giữ nhiều file lớn trong bộ nhớ cùng lúc
      for (const it of itemsRef.current) {
        if (!it.reason && it.targetId && it.status !== 'done') await convertOne(it.id);
      }
    } finally {
      setRunning(false);
    }
  };

  const pending = items.filter((it) => !it.reason && it.targetId && it.status !== 'done').length;
  const allResults = items.flatMap((it) => it.results);

  const downloadAll = async () => {
    if (allResults.length === 1) { saveAs(allResults[0].blob, allResults[0].name); return; }
    setZipping(true);
    try {
      await zipAndSave(allResults, `chuyen-doi-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (e) {
      setNotice(`Không tạo được file ZIP: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <ToolHeader icon={FileOutput} title="Chuyển đổi định dạng file" desc="Ảnh, PDF, Word, Excel, JSON/YAML/CSV, Markdown, âm thanh. Xử lý ngay trên trình duyệt, file không rời khỏi máy bạn." />

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3.5 min-w-0">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
          >
            <Upload className="mx-auto h-6 w-6 text-slate-400" />
            <p className="mt-1.5 text-sm font-medium text-slate-700">Kéo thả file vào đây hoặc bấm để chọn (nhiều file)</p>
            <p className="text-[11px] text-slate-500">Tối đa {MAX_FILES} file, mỗi file {formatBytes(MAX_FILE_BYTES)}</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
            />
          </div>

          {notice && <p className="text-sm text-amber-700">{notice}</p>}

          {items.length > 0 && (
            <section className={`${card} space-y-3`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-700">{items.length} file · {allResults.length} kết quả</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={runAll} disabled={running || pending === 0}>
                    {running ? <Loader2 className="animate-spin" /> : <Play />} Chuyển tất cả{pending > 0 ? ` (${pending})` : ''}
                  </Button>
                  <Button variant="outline" onClick={downloadAll} disabled={allResults.length === 0 || zipping}>
                    {zipping ? <Loader2 className="animate-spin" /> : <FileArchive />} {allResults.length > 1 ? 'Tải tất cả (.zip)' : 'Tải xuống'}
                  </Button>
                  <Button variant="ghost" onClick={() => { setItems([]); setNotice(''); }} disabled={running}>
                    <Trash2 /> Xoá hết
                  </Button>
                </div>
              </div>

              <ul className="space-y-2">
                {items.map((it) => (
                  <FileRow
                    key={it.id}
                    item={it}
                    busy={running}
                    onChange={(p) => changeOpt(it.id, p)}
                    onConvert={() => convertOne(it.id)}
                    onRemove={() => setItems((list) => list.filter((x) => x.id !== it.id))}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className={`${card} space-y-3 h-fit`}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Định dạng hỗ trợ</h2>
          {summary.map((g) => (
            <div key={g.group} className="space-y-1">
              <p className="text-xs font-semibold text-indigo-700">{g.label}</p>
              <ul className="space-y-1">
                {g.rows.map((r) => (
                  <li key={r.from.join(',')} className="text-xs text-slate-600 leading-snug">
                    <span className="font-medium text-slate-700">{r.from.map((e) => e.toUpperCase()).join(', ')}</span>
                    <span className="text-slate-400"> → </span>
                    {r.to.map((e) => e.toUpperCase()).join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-slate-500">
            <li>GIF động chỉ lấy khung hình đầu. HEIC/AVIF tuỳ trình duyệt có đọc được hay không (HEIC thường chỉ Safari).</li>
            <li>JPG không có nền trong suốt nên vùng trong suốt thành màu trắng.</li>
            <li>PDF nhiều trang, XLSX nhiều sheet tạo nhiều file kết quả.</li>
            <li>Âm thanh xuất WAV 16-bit, 44.1 kHz (WebM: 48 kHz).</li>
            <li>Chưa hỗ trợ .xls, .ods, .doc, .odt: hãy lưu lại dạng .xlsx / .docx trước.</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}

function FileRow({ item: it, busy, onChange, onConvert, onRemove }: {
  item: Item;
  busy: boolean;
  onChange: (p: Partial<Pick<Item, 'targetId' | 'quality' | 'dpi'>>) => void;
  onConvert: () => void;
  onRemove: () => void;
}) {
  const conv = it.targets.find((c) => c.id === it.targetId);
  const st = STATUS[it.status];
  const locked = busy || it.status === 'running';
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState('');
  const zipThis = async () => {
    setZipping(true); setZipError('');
    try { await zipAndSave(it.results, `${safeBase(it.file.name)}.zip`); } catch (e) { setZipError(`Không tạo được ZIP: ${e instanceof Error ? e.message : String(e)}`); } finally { setZipping(false); }
  };

  return (
    <li className="rounded-lg border border-slate-200 p-2.5 space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 truncate">{it.file.name}</p>
          <p className="text-[11px] text-slate-500">{it.kind} · {formatBytes(it.file.size)}</p>
        </div>
        {!it.reason && (
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>
            {it.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
            {it.status === 'done' && <CheckCircle2 className="h-3 w-3" />}
            {it.status === 'error' && <XCircle className="h-3 w-3" />}
            {st.label}
          </span>
        )}
        <Button variant="ghost" size="icon-xs" onClick={onRemove} disabled={locked} aria-label={`Bỏ ${it.file.name}`} data-tooltip="Bỏ khỏi danh sách">
          <X />
        </Button>
      </div>

      {it.reason ? (
        <p className="text-xs text-amber-700">{it.reason}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-semibold text-slate-600 space-y-0.5">
            <span className="block">Chuyển sang</span>
            <Select value={it.targetId} onChange={(e) => onChange({ targetId: e.target.value })} disabled={locked} className="w-56" aria-label="Định dạng đích">
              {it.targets.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </label>
          {conv?.options?.includes('dpi') && (
            <label className="text-[11px] font-semibold text-slate-600 space-y-0.5">
              <span className="block">Độ phân giải</span>
              <Select value={String(it.dpi)} onChange={(e) => onChange({ dpi: Number(e.target.value) })} disabled={locked} className="w-28" aria-label="Độ phân giải (dpi)">
                {DPI_CHOICES.map((d) => <option key={d} value={String(d)}>{d} dpi</option>)}
              </Select>
            </label>
          )}
          {conv?.options?.includes('quality') && (
            <label className="text-[11px] font-semibold text-slate-600 space-y-0.5 w-36">
              <span className="block">Chất lượng: {Math.round(it.quality * 100)}%</span>
              <input
                type="range" min={10} max={100} step={5} value={Math.round(it.quality * 100)} disabled={locked}
                onChange={(e) => onChange({ quality: Number(e.target.value) / 100 })} className="w-full accent-indigo-600"
              />
            </label>
          )}
          <Button variant="outline" size="sm" onClick={onConvert} disabled={locked || !conv}>
            {it.status === 'done' ? 'Chuyển lại' : 'Chuyển'}
          </Button>
        </div>
      )}

      {it.status === 'error' && <p className="text-xs text-red-600" role="alert">{it.error}</p>}
      {zipError && <p className="text-xs text-red-600" role="alert">{zipError}</p>}

      {it.results.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {it.results.slice(0, SHOW_RESULTS).map((r, i) => (
            <button
              key={i}
              onClick={() => saveAs(r.blob, r.name)}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100"
              data-tooltip={`Tải ${r.name} (${formatBytes(r.blob.size)})`}
            >
              <Download className="h-3 w-3 shrink-0" /> <span className="truncate">{r.name}</span>
            </button>
          ))}
          {it.results.length > SHOW_RESULTS && <span className="text-xs text-slate-500">+{it.results.length - SHOW_RESULTS} file khác</span>}
          {it.results.length > 1 && (
            <Button variant="ghost" size="xs" onClick={zipThis} disabled={zipping}>
              {zipping ? <Loader2 className="animate-spin" /> : <FileArchive />} ZIP {it.results.length} file
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
