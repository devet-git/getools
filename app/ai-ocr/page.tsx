'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScanText, ImagePlus, Copy, Download, Loader2, X, RotateCw, Trash2, AlertTriangle, Info } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { useAiSettings } from '@/lib/use-ai-config';
import { AiKeyNotice } from '@/components/AiKeyNotice';
import { AiError, callAi, toAiError } from '@/lib/ai-client';
import { IMAGE_MIME_WHITELIST, LANGUAGE_LABELS_VI, MAX_IMAGE_BASE64_BYTES, type AiImage } from '@/lib/ai-prompts';

const MAX_DIM = 2000;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const PROSE =
  'prose prose-sm max-w-none text-slate-800 [&_h1]:text-base [&_h1]:font-extrabold [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_p]:leading-relaxed [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:bg-slate-100 [&_code]:text-indigo-700 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_th]:bg-slate-100 [&_th]:p-2 [&_th]:border [&_th]:border-slate-200 [&_td]:p-2 [&_td]:border [&_td]:border-slate-200';

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

/** Thu nhỏ ảnh lớn (tối đa 2000px) và mã hoá lại JPEG 0.9; ảnh nhỏ giữ nguyên. */
async function prepareImage(file: File, objectUrl: string): Promise<{ image: AiImage; note: string }> {
  const img = await loadImage(objectUrl);
  const { naturalWidth: w, naturalHeight: h } = img;
  const needsResize = Math.max(w, h) > MAX_DIM;
  const okMime = (IMAGE_MIME_WHITELIST as readonly string[]).includes(file.type);
  if (!needsResize && okMime && file.size <= 1.5 * 1024 * 1024) {
    return { image: { mimeType: file.type, data: await blobToBase64(file) }, note: `${w}×${h}px, giữ nguyên` };
  }
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
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

export default function AiOcrPage() {
  const { showToast, setIsSettingsOpen } = useApp();
  const { config: aiConfig, providerLabel } = useAiSettings();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [keepTables, setKeepTables] = useState(true);
  const [hint, setHint] = useState('');
  const [mode, setMode] = useState<'text' | 'layout'>('text');
  const [result, setResult] = useState('');
  const [view, setView] = useState<'rendered' | 'raw'>('rendered');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setImageFile = useCallback((f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return showToast('Vui lòng chọn một file ảnh.');
    if (f.size > MAX_SOURCE_BYTES) return showToast('Ảnh quá lớn (tối đa 25MB).');
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    setFile(f);
    setResult('');
    setError('');
    setNote('');
  }, [showToast]);

  // Dán ảnh từ clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) {
        e.preventDefault();
        setImageFile(f);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [setImageFile]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const run = async () => {
    if (!file || loading) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');
    try {
      const { image, note: n } = await prepareImage(file, previewUrl);
      setNote(n);
      if (image.data.length > MAX_IMAGE_BASE64_BYTES) throw new Error('size');
      const text = await callAi({
        task: 'ocr',
        options: { keepTables, hint, mode },
        image,
        ai: aiConfig,
        signal: ctrl.signal,
      });
      setResult(text);
    } catch (e) {
      if (e instanceof Error && !(e instanceof AiError)) {
        setError(e.message === 'size' ? 'Ảnh vẫn quá lớn sau khi nén. Hãy thử ảnh nhỏ hơn.' : 'Không xử lý được ảnh này. Hãy thử ảnh khác.');
      } else {
        const err = toAiError(e);
        if (!err.aborted) setError(err.message);
      }
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      showToast('Đã sao chép kết quả');
    } catch {
      showToast('Không thể sao chép');
    }
  };

  const download = (ext: 'md' | 'txt') => {
    const blob = new Blob([result], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const btn = 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50';

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
          <ScanText className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-sm sm:text-base font-bold tracking-tight">Đọc chữ từ ảnh (OCR)</h1>
          <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">Chọn, kéo thả hoặc dán (Ctrl+V) ảnh. Ảnh sẽ được gửi tới {providerLabel} để nhận dạng.</p>
        </div>
      </div>

      <AiKeyNotice />

      <div className="grid lg:grid-cols-2 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); setImageFile(e.dataTransfer.files?.[0]); }}
            onClick={() => !file && inputRef.current?.click()}
            className={`rounded-lg border-2 border-dashed min-h-48 flex items-center justify-center p-2 ${file ? '' : 'cursor-pointer'} ${dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50'}`}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Ảnh xem trước" className="max-h-80 max-w-full object-contain rounded" />
            ) : (
              <div className="text-center text-xs text-slate-500 space-y-1">
                <ImagePlus className="h-6 w-6 mx-auto text-slate-400" />
                <div>Nhấp để chọn, kéo thả hoặc dán ảnh (PNG, JPEG, WebP, GIF...)</div>
              </div>
            )}
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { setImageFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          {file && (
            <div className="flex items-center justify-between text-[11px] text-slate-500 gap-2">
              <span className="truncate">{file.name} · {(file.size / 1024).toFixed(0)} KB{note && ` · ${note}`}</span>
              <div className="flex gap-1.5 shrink-0">
                <button className={btn} onClick={() => inputRef.current?.click()}>Đổi ảnh</button>
                <button className={btn} onClick={() => { setFile(null); setPreviewUrl(''); setResult(''); setError(''); setNote(''); }}><Trash2 className="h-3 w-3" /> Xoá</button>
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-2.5">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-500 mb-1">Ngôn ngữ gợi ý</span>
              <select value={hint} onChange={(e) => setHint(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800">
                <option value="">Tự phát hiện</option>
                {Object.entries(LANGUAGE_LABELS_VI).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-500 mb-1">Chế độ</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'text' | 'layout')} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800">
                <option value="text">Chỉ trích xuất chữ</option>
                <option value="layout">Chữ + mô tả bố cục</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input type="checkbox" checked={keepTables} onChange={(e) => setKeepTables(e.target.checked)} className="accent-indigo-600" />
            Giữ định dạng bảng thành Markdown
          </label>

          <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Ảnh lớn được thu nhỏ tối đa {MAX_DIM}px ngay trên trình duyệt trước khi gửi. Tránh gửi ảnh chứa thông tin nhạy cảm.
          </div>

          <div className="flex gap-2">
            <button onClick={run} disabled={!file || loading} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />} Đọc chữ
            </button>
            {loading && (
              <button onClick={cancel} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-50"><X className="h-3.5 w-3.5" /> Huỷ</button>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5 min-h-[20rem]">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1">
              {(['rendered', 'raw'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${view === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {v === 'rendered' ? 'Hiển thị' : 'Văn bản gốc'}
                </button>
              ))}
            </div>
            {result && (
              <div className="flex gap-1.5 flex-wrap">
                <button className={btn} onClick={copy}><Copy className="h-3 w-3" /> Sao chép</button>
                <button className={btn} onClick={() => download('md')}><Download className="h-3 w-3" /> .md</button>
                <button className={btn} onClick={() => download('txt')}><Download className="h-3 w-3" /> .txt</button>
                <button className={btn} onClick={run} disabled={loading}><RotateCw className="h-3 w-3" /> Đọc lại</button>
              </div>
            )}
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs p-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                {error}
                {/Cài đặt/.test(error) && <button onClick={() => setIsSettingsOpen(true)} className="ml-1 underline font-semibold">Mở Cài đặt</button>}
              </div>
              <button onClick={run} className="underline shrink-0">Thử lại</button>
            </div>
          )}
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Đang đọc ảnh với AI...</div>
          ) : result ? (
            view === 'rendered' ? (
              <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown></div>
            ) : (
              <pre className="whitespace-pre-wrap text-xs text-slate-800 font-mono bg-slate-50 rounded-lg p-3 border border-slate-200">{result}</pre>
            )
          ) : (
            !error && <div className="text-xs text-slate-400 text-center py-10">Văn bản trích xuất sẽ hiển thị ở đây.</div>
          )}
        </div>
      </div>
    </div>
  );
}
