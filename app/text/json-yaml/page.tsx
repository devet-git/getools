'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Braces, Copy, Check, Download, ArrowLeftRight, Trash2, Sparkles, AlertCircle } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  convert,
  formatBytes,
  MODES,
  SAMPLE_JSON,
  SAMPLE_YAML,
  Indent,
  Mode,
} from '@/lib/json-yaml';

import { SendToButton } from '@/components/SendToButton';
import { Select } from '@/components/ui/searchable-select';
const INDENTS: { id: Indent; label: string }[] = [
  { id: 2, label: '2 khoảng trắng' },
  { id: 4, label: '4 khoảng trắng' },
  { id: 'tab', label: 'Tab' },
];

export default function JsonYamlPage() {
  const { showToast } = useApp();
  const [input, setInput] = useState(SAMPLE_JSON);
  const [mode, setMode] = useState<Mode>('format');
  const [indent, setIndent] = useState<Indent>(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Khôi phục trạng thái từ link chia sẻ (đọc sau khi mount để tránh lệch hydration)
  useEffect(() => {
    const q = readShareParams();
    const m = q.get('m');
    const i = q.get('i');
    const s = q.get('s');
    const t = q.get('t');
    /* eslint-disable react-hooks/set-state-in-effect */
    if (m && MODES.some((x) => x.id === m)) setMode(m as Mode);
    if (i === '2') setIndent(2);
    else if (i === '4') setIndent(4);
    else if (i === 'tab') setIndent('tab');
    if (s === '1') setSortKeys(true);
    if (t !== null) setInput(t.slice(0, 1_000_000));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Hoãn xử lý khi gõ/dán nội dung lớn để giao diện không bị đơ
  const deferred = useDeferredValue(input);
  const pending = deferred !== input;

  const result = useMemo(() => convert(deferred, { mode, indent, sortKeys }), [deferred, mode, indent, sortKeys]);

  const inLines = input ? input.split(/\r\n|\r|\n/).length : 0;
  const outLines = result.output ? result.output.split('\n').length : 0;
  const ext = result.outFormat === 'yaml' ? 'yaml' : 'json';
  const delta =
    result.ok && result.inputBytes > 0
      ? Math.round(((result.outputBytes - result.inputBytes) / result.inputBytes) * 100)
      : null;

  const handleCopy = async () => {
    if (!result.output) return;
    try {
      await navigator.clipboard.writeText(result.output);
      setIsCopied(true);
      showToast('Đã sao chép kết quả!');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const handleDownload = () => {
    if (!result.output) return;
    const type = ext === 'yaml' ? 'application/yaml' : 'application/json';
    const blob = new Blob([result.output], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data_${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Đã tải xuống file .${ext}!`);
  };

  const handleSwap = () => {
    if (!result.ok || !result.output) {
      showToast('Chưa có kết quả hợp lệ để đưa lên ô nhập.');
      return;
    }
    setInput(result.output);
  };

  return (
    <div className="space-y-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Braces className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">JSON / YAML</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Định dạng, nén, sắp xếp khóa và chuyển đổi qua lại giữa JSON và YAML. Mọi thứ xử lý ngay trên trình duyệt.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <ShareLinkButton
            params={{ m: mode, i: String(indent), s: sortKeys ? '1' : '0', t: input }}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
          />
          <button
            onClick={() => setInput(SAMPLE_JSON)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
          >
            <Sparkles className="h-3 w-3 text-amber-400" />
            Mẫu JSON
          </button>
          <button
            onClick={() => setInput(SAMPLE_YAML)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
          >
            <Sparkles className="h-3 w-3 text-amber-400" />
            Mẫu YAML
          </button>
        </div>
      </div>

      {/* OPTIONS */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex flex-wrap bg-slate-200/80 p-0.5 rounded-lg text-xs">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                mode === m.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
          Thụt lề
          <Select
            value={String(indent)}
            onChange={(e) => setIndent(e.target.value === 'tab' ? 'tab' : (Number(e.target.value) as Indent))}
            disabled={mode === 'minify'}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white disabled:opacity-50"
          >
            {INDENTS.map((i) => (
              <option key={String(i.id)} value={String(i.id)}>
                {i.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-slate-700 font-medium">
          <input
            type="checkbox"
            checked={sortKeys || mode === 'sort'}
            disabled={mode === 'sort'}
            onChange={() => setSortKeys(!sortKeys)}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
          />
          Sắp xếp khóa A→Z
        </label>
        {result.detected && (
          <span className="ml-auto px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 text-xs font-semibold">
            Nhận diện: {result.detected.toUpperCase()}
          </span>
        )}
      </div>

      {/* PANES */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3.5 items-stretch">
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col h-[420px] overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Đầu vào</span>
            <button
              onClick={() => setInput('')}
              data-tooltip="Xóa nội dung" aria-label="Xóa nội dung"
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder="Dán JSON hoặc YAML vào đây..."
            className="flex-1 w-full p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-none leading-relaxed text-slate-800 whitespace-pre"
          />
          <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
            <span>{inLines} dòng</span>
            <span>{formatBytes(result.inputBytes)}</span>
          </div>
        </div>

        <div className="flex lg:flex-col items-center justify-center">
          <button
            onClick={handleSwap}
            data-tooltip="Đưa kết quả lên ô nhập" aria-label="Đưa kết quả lên ô nhập"
            className="p-2 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-xs transition"
          >
            <ArrowLeftRight className="h-4 w-4 rotate-90 lg:rotate-0" />
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col h-[420px] overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              Kết quả
              <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-semibold">
                {ext.toUpperCase()}
              </span>
              {pending && <span className="text-[10px] font-medium normal-case text-slate-400">đang xử lý...</span>}
            </span>
            <div className="flex items-center gap-1.5">
              <SendToButton text={result.output} fromToolId="json-yaml" />
              <button
                onClick={handleCopy}
                disabled={!result.output}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition flex items-center gap-1 disabled:opacity-50"
              >
                {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{isCopied ? 'Đã chép!' : 'Sao chép'}</span>
              </button>
              <button
                onClick={handleDownload}
                disabled={!result.output}
                data-tooltip={`Tải về file .${ext}`} aria-label={`Tải về file .${ext}`}
                className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg transition disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {result.error ? (
            <div className="flex-1 p-4 overflow-auto bg-red-50/60">
              <div className="flex items-start gap-2 text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="text-xs space-y-1.5 min-w-0">
                  <p className="font-bold">
                    Lỗi cú pháp{result.error.line ? ` tại dòng ${result.error.line}` : ''}
                    {result.error.col ? `, cột ${result.error.col}` : ''}
                  </p>
                  <p className="break-words">{result.error.message}</p>
                  {result.error.snippet !== undefined && (
                    <pre className="mt-2 p-2 rounded bg-white border border-red-200 font-mono text-[11px] text-slate-800 overflow-x-auto">
                      {result.error.snippet}
                      {result.error.col ? '\n' + ' '.repeat(Math.max(0, Math.min(result.error.col - 1, 200))) + '^' : ''}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <textarea
              readOnly
              value={result.output}
              spellCheck={false}
              placeholder="Kết quả sẽ hiển thị ở đây..."
              className="flex-1 w-full p-3 text-xs font-mono bg-slate-50/60 outline-hidden resize-none leading-relaxed text-slate-800 whitespace-pre"
            />
          )}
          <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
            <span>{outLines} dòng</span>
            <span>{formatBytes(result.outputBytes)}</span>
          </div>
        </div>
      </div>

      {/* STATS */}
      {result.ok && result.stats && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-slate-800 uppercase tracking-wider mr-1">Thống kê</span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">
            Trước: {formatBytes(result.inputBytes)}
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">
            Sau: {formatBytes(result.outputBytes)}
            {delta !== null && delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta}%)` : ''}
          </span>
          <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">
            {result.stats.keys.toLocaleString('vi-VN')} khóa
          </span>
          <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">
            Độ sâu {result.stats.depth}
          </span>
        </div>
      )}
    </div>
  );
}
