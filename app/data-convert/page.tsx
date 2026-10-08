'use client';

import { Select } from '@/components/ui/searchable-select';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Table2, Upload, ArrowLeftRight, Trash2, Copy, Check, Download, Sparkles, AlertTriangle } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  ConvertOptions,
  DEFAULT_OPTIONS,
  Delimiter,
  IN_FORMATS,
  InFormat,
  MAX_INPUT_BYTES,
  OUT_EXT,
  OUT_FORMATS,
  OutFormat,
  Table,
  cellToString,
  detectFormat,
  formatTable,
  parseTable,
} from '@/lib/data-convert';

import { SendToButton } from '@/components/SendToButton';
const SAMPLE = `Mã,Họ tên,Tuổi,Thành phố,Ghi chú
1,Nguyễn Văn A,28,Hà Nội,"Thích cà phê, trà"
2,Trần Thị B,34,TP. Hồ Chí Minh,"Nói: ""xin chào"""
3,Lê Văn C,41,Đà Nẵng,"Dòng 1
Dòng 2"
4,Phạm Thị D,,Huế,`;

const PREVIEW_ROWS = 200;
const OUTPUT_DISPLAY_CAP = 300_000;

const IN_LABEL: Record<InFormat, string> = { csv: 'CSV', tsv: 'TSV', json: 'JSON', markdown: 'Markdown' };
const OUT_LABEL: Record<OutFormat, string> = {
  csv: 'CSV',
  tsv: 'TSV',
  json: 'JSON',
  markdown: 'Markdown',
  html: 'HTML',
  sql: 'SQL INSERT',
};
const DELIM_LABEL: Record<Delimiter, string> = { ',': 'Dấu phẩy ( , )', ';': 'Chấm phẩy ( ; )', '\t': 'Tab', '|': 'Gạch đứng ( | )' };

const selectCls =
  'text-xs border border-slate-200 rounded-lg bg-white text-slate-700 px-2 py-1 outline-hidden focus:border-indigo-500';

export default function DataConvertPage() {
  const { showToast } = useApp();
  const [text, setText] = useState(SAMPLE);
  const [fileName, setFileName] = useState('');
  const [inFmt, setInFmt] = useState<InFormat | 'auto'>('auto');
  const [outFmt, setOutFmt] = useState<OutFormat>('json');
  const [opts, setOpts] = useState<ConvertOptions>(DEFAULT_OPTIONS);
  const [isCopied, setIsCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Khôi phục cấu hình từ link chia sẻ
  useEffect(() => {
    const p = readShareParams();
    if (p.size === 0) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    const i = p.get('in');
    if (i === 'auto' || (IN_FORMATS as string[]).includes(i ?? '')) setInFmt(i as InFormat | 'auto');
    const o = p.get('out');
    if ((OUT_FORMATS as string[]).includes(o ?? '')) setOutFmt(o as OutFormat);
    const flag = (k: string, d: boolean) => (p.has(k) ? p.get(k) === '1' : d);
    const d = p.get('delim');
    const od = p.get('odelim');
    setOpts((prev) => ({
      ...prev,
      header: flag('h', prev.header),
      trim: flag('trim', prev.trim),
      ignoreEmpty: flag('empty', prev.ignoreEmpty),
      pretty: flag('pretty', prev.pretty),
      infer: flag('infer', prev.infer),
      delimiter: d === 'auto' || [',', ';', '\t', '|'].includes(d ?? '') ? ((d ?? 'auto') as ConvertOptions['delimiter']) : prev.delimiter,
      outDelimiter: [',', ';', '\t', '|'].includes(od ?? '') ? (od as Delimiter) : prev.outDelimiter,
      tableName: (p.get('table') ?? prev.tableName).slice(0, 80),
    }));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const deferredText = useDeferredValue(text);
  const deferredOpts = useDeferredValue(opts);

  const detected: InFormat = useMemo(
    () => (inFmt === 'auto' ? detectFormat(deferredText) : inFmt),
    [inFmt, deferredText]
  );

  const parsed = useMemo<{ table: Table | null; error: string }>(() => {
    try {
      return { table: parseTable(deferredText, detected, deferredOpts), error: '' };
    } catch (e) {
      return { table: null, error: e instanceof Error ? e.message : 'Không thể đọc dữ liệu.' };
    }
  }, [deferredText, detected, deferredOpts]);

  const table = parsed.table;

  const output = useMemo(() => {
    if (!table) return '';
    try {
      return formatTable(table, outFmt, deferredOpts);
    } catch {
      return '';
    }
  }, [table, outFmt, deferredOpts]);

  const setOpt = <K extends keyof ConvertOptions>(k: K, v: ConvertOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const loadFile = async (file: File) => {
    if (file.size > MAX_INPUT_BYTES) {
      showToast(`File "${file.name}" quá lớn (tối đa 5 MB).`);
      return;
    }
    const content = await file.text();
    if (content.includes('\u0000')) {
      showToast(`"${file.name}" có vẻ là file nhị phân, chỉ hỗ trợ file văn bản.`);
      return;
    }
    setText(content);
    setFileName(file.name);
    setInFmt('auto');
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'tsv' || ext === 'tab') setInFmt('tsv');
    else if (ext === 'json') setInFmt('json');
    else if (ext === 'csv') setInFmt('csv');
    else if (ext === 'md') setInFmt('markdown');
  };

  const handleCopy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setIsCopied(true);
      showToast(`Đã sao chép kết quả ${OUT_LABEL[outFmt]}!`);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const handleDownload = () => {
    if (!output) return;
    const { ext, mime } = OUT_EXT[outFmt];
    const blob = new Blob([output], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `du_lieu_${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Đã tải xuống file .${ext}!`);
  };

  const handleSwap = () => {
    if (!output) return;
    if (!(IN_FORMATS as string[]).includes(outFmt)) {
      showToast('Không thể hoán đổi: HTML và SQL không dùng được làm dữ liệu đầu vào.');
      return;
    }
    const prevIn = detected;
    setText(output);
    setFileName('');
    setInFmt(outFmt as InFormat);
    setOutFmt(prevIn);
  };

  const cols = table?.headers.length ?? 0;
  const rowCount = table?.rows.length ?? 0;
  const shownOutput = output.length > OUTPUT_DISPLAY_CAP ? output.slice(0, OUTPUT_DISPLAY_CAP) : output;

  const flagToggles: [keyof ConvertOptions, string][] = [
    ['header', 'Dòng đầu là tiêu đề'],
    ['trim', 'Cắt khoảng trắng ô'],
    ['ignoreEmpty', 'Bỏ dòng trống'],
    ['pretty', 'Căn đều cột Markdown'],
    ['infer', 'Suy luận số/boolean/null'],
  ];

  const b = (v: boolean) => (v ? '1' : '0');

  return (
    <div className="space-y-3.5 lg:space-y-0 lg:gap-3.5 lg-fit-screen">
      {/* HEADER */}
      <div className="shrink-0 bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Table2 className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">CSV ⇄ JSON ⇄ Bảng Markdown</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Chuyển đổi qua lại giữa CSV, TSV, JSON, bảng Markdown, và xuất HTML / SQL INSERT. Xử lý hoàn toàn trên trình duyệt.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShareLinkButton
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
            params={{
              in: inFmt,
              out: outFmt,
              delim: opts.delimiter,
              odelim: opts.outDelimiter,
              h: b(opts.header),
              trim: b(opts.trim),
              empty: b(opts.ignoreEmpty),
              pretty: b(opts.pretty),
              infer: b(opts.infer),
              table: opts.tableName !== DEFAULT_OPTIONS.tableName ? opts.tableName : undefined,
            }}
          />
          <button
            onClick={() => {
              setText(SAMPLE);
              setFileName('');
              setInFmt('auto');
            }}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
          >
            <Sparkles className="h-3 w-3 text-amber-400" />
            Dùng mẫu thử
          </button>
        </div>
      </div>

      {/* OPTIONS */}
      <div className="shrink-0 bg-white rounded-xl border border-slate-200/90 shadow-xs px-3 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <label className="flex items-center gap-1.5 font-medium text-slate-700">
          Đầu vào
          <Select
            value={inFmt}
            onChange={(e) => setInFmt(e.target.value as InFormat | 'auto')}
            className={selectCls}
          >
            <option value="auto">Tự nhận diện{inFmt === 'auto' && text.trim() ? ` (${IN_LABEL[detected]})` : ''}</option>
            {IN_FORMATS.map((f) => (
              <option key={f} value={f}>
                {IN_LABEL[f]}
              </option>
            ))}
          </Select>
        </label>
        {detected === 'csv' && (
          <label className="flex items-center gap-1.5 font-medium text-slate-700">
            Phân cách đọc
            <Select
              value={opts.delimiter}
              onChange={(e) => setOpt('delimiter', e.target.value as ConvertOptions['delimiter'])}
              className={selectCls}
            >
              <option value="auto">
                Tự nhận diện
                {opts.delimiter === 'auto' && table?.delimiterUsed ? ` (${DELIM_LABEL[table.delimiterUsed]})` : ''}
              </option>
              {(Object.keys(DELIM_LABEL) as Delimiter[]).map((d) => (
                <option key={d} value={d}>
                  {DELIM_LABEL[d]}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="flex items-center gap-1.5 font-medium text-slate-700">
          Đầu ra
          <Select value={outFmt} onChange={(e) => setOutFmt(e.target.value as OutFormat)} className={selectCls}>
            {OUT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {OUT_LABEL[f]}
              </option>
            ))}
          </Select>
        </label>
        {outFmt === 'csv' && (
          <label className="flex items-center gap-1.5 font-medium text-slate-700">
            Phân cách ghi
            <Select
              value={opts.outDelimiter}
              onChange={(e) => setOpt('outDelimiter', e.target.value as Delimiter)}
              className={selectCls}
            >
              {(Object.keys(DELIM_LABEL) as Delimiter[]).map((d) => (
                <option key={d} value={d}>
                  {DELIM_LABEL[d]}
                </option>
              ))}
            </Select>
          </label>
        )}
        {outFmt === 'sql' && (
          <label className="flex items-center gap-1.5 font-medium text-slate-700">
            Tên bảng
            <input
              value={opts.tableName}
              onChange={(e) => setOpt('tableName', e.target.value)}
              maxLength={80}
              className={`${selectCls} w-36 font-mono`}
            />
          </label>
        )}
        {flagToggles.map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium">
            <input
              type="checkbox"
              checked={opts[key] as boolean}
              onChange={(e) => setOpt(key, e.target.checked as never)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
            />
            {label}
          </label>
        ))}
      </div>

      {/* INPUT / OUTPUT */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3.5 items-stretch lg:flex-[3] lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]">
        <div
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
          className={`bg-white rounded-xl border shadow-xs flex flex-col h-[360px] lg:h-full lg:min-h-0 overflow-hidden transition ${
            dragging ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200/90'
          }`}
        >
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider truncate">
              Đầu vào{' '}
              {text.trim() && (
                <span className="normal-case tracking-normal font-medium text-indigo-600">· {IN_LABEL[detected]}</span>
              )}
              {fileName && <span className="normal-case tracking-normal font-medium text-slate-400"> · {fileName}</span>}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => fileRef.current?.click()}
                className="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition flex items-center gap-1 border border-indigo-200"
              >
                <Upload className="h-3.5 w-3.5" />
                Chọn file
              </button>
              <button
                onClick={() => {
                  setText('');
                  setFileName('');
                }}
                title="Xóa nội dung"
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.tab,.txt,.json,.md,text/*,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName('');
            }}
            spellCheck={false}
            placeholder="Dán CSV, TSV (từ Excel), JSON hoặc bảng Markdown vào đây, hoặc kéo-thả / chọn file (tối đa 5 MB)..."
            className="flex-1 w-full p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-none leading-relaxed text-slate-800 whitespace-pre"
          />
          <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
            <span>{text ? text.split(/\r\n|\r|\n/).length : 0} dòng</span>
            <span>{text.length} ký tự</span>
          </div>
        </div>

        <div className="flex lg:flex-col items-center justify-center">
          <button
            onClick={handleSwap}
            title="Hoán đổi: dùng kết quả làm đầu vào"
            className="p-2 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-xs transition"
          >
            <ArrowLeftRight className="h-4 w-4 lg:rotate-0 rotate-90" />
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col h-[360px] lg:h-full lg:min-h-0 overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Kết quả <span className="normal-case tracking-normal font-medium text-emerald-600">· {OUT_LABEL[outFmt]}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <SendToButton text={output} fromToolId="data-convert" />
              <button
                onClick={handleCopy}
                disabled={!output}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white shadow-xs transition flex items-center gap-1"
              >
                {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{isCopied ? 'Đã chép!' : 'Sao chép'}</span>
              </button>
              <button
                onClick={handleDownload}
                disabled={!output}
                title={`Tải về file .${OUT_EXT[outFmt].ext}`}
                className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 border border-slate-200 rounded-lg transition"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {parsed.error ? (
            <div className="flex-1 p-4 text-sm text-red-700 bg-red-50/60 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{parsed.error}</span>
            </div>
          ) : (
            <textarea
              readOnly
              value={shownOutput}
              spellCheck={false}
              placeholder="Kết quả chuyển đổi sẽ hiện ở đây."
              className="flex-1 w-full p-3 text-xs font-mono bg-slate-50/60 outline-hidden resize-none leading-relaxed text-slate-800 whitespace-pre"
            />
          )}
          <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between gap-2">
            <span>
              {output.length > OUTPUT_DISPLAY_CAP
                ? `Chỉ hiển thị ${OUTPUT_DISPLAY_CAP.toLocaleString('vi-VN')} ký tự đầu; sao chép/tải về sẽ lấy đủ.`
                : `${output ? output.split('\n').length : 0} dòng`}
            </span>
            <span>{output.length} ký tự</span>
          </div>
        </div>
      </div>

      {/* PREVIEW */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col lg:flex-[2] lg:min-h-0">
        <div className="shrink-0 p-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-slate-800 uppercase tracking-wider">Xem trước dữ liệu</span>
          <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">{rowCount.toLocaleString('vi-VN')} dòng</span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">{cols} cột</span>
          {rowCount > PREVIEW_ROWS && (
            <span className="text-slate-500">Chỉ hiển thị {PREVIEW_ROWS} dòng đầu (kết quả chuyển đổi vẫn gồm toàn bộ).</span>
          )}
        </div>
        {table && table.warnings.length > 0 && (
          <ul className="px-3 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 space-y-0.5">
            {table.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        )}
        {!table || cols === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            {parsed.error ? 'Không thể hiển thị do dữ liệu đầu vào chưa hợp lệ.' : 'Nhập hoặc chọn file để xem trước bảng dữ liệu.'}
          </div>
        ) : (
          <div className="max-h-[420px] lg:max-h-none flex-1 min-h-0 overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0">
                <tr>
                  <th className="bg-slate-100 text-slate-400 font-medium px-2 py-1.5 text-right border-b border-slate-200 w-10">#</th>
                  {table.headers.map((h, i) => (
                    <th
                      key={i}
                      className={`bg-slate-100 text-slate-800 font-semibold px-3 py-1.5 border-b border-slate-200 whitespace-nowrap ${
                        table.align[i] === 'right' ? 'text-right' : table.align[i] === 'center' ? 'text-center' : 'text-left'
                      } ${table.hasHeader ? '' : 'text-slate-400 font-normal'}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, PREVIEW_ROWS).map((r, ri) => (
                  <tr key={ri} className="hover:bg-slate-50">
                    <td className="px-2 py-1 text-right text-slate-400 border-b border-slate-100 select-none">{ri + 1}</td>
                    {table.headers.map((_, ci) => {
                      const c = r[ci] ?? null;
                      return (
                        <td
                          key={ci}
                          className={`px-3 py-1 border-b border-slate-100 text-slate-800 max-w-[320px] truncate align-top ${
                            table.align[ci] === 'right' ? 'text-right' : table.align[ci] === 'center' ? 'text-center' : ''
                          }`}
                          title={cellToString(c)}
                        >
                          {c === null ? <span className="text-slate-300 italic">null</span> : cellToString(c)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
