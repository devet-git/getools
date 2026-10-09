'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FileJson2, Copy, Check, Download, Trash2, Upload, AlertCircle, Crosshair } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  analyze,
  render,
  suggestFileName,
  DEFAULT_OPTIONS,
  GenOptions,
  Lang,
  LANGS,
  SAMPLES,
  MAX_INPUT_CHARS,
} from '@/lib/json-to-code';

import { SendToButton } from '@/components/SendToButton';
import { Select as SearchSelect } from '@/components/ui/searchable-select';
const MAX_DISPLAY = 300_000;
const MAX_SHARE_ROOT = 40;

const bool = (v: boolean) => (v ? '1' : '0');

function Toggle({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  title?: string;
}) {
  return (
    <label data-tooltip={title} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600"
      />
      {label}
    </label>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
  label: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-600">
      {label}
      <SearchSelect
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="px-1.5 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 outline-hidden focus:border-indigo-500"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </SearchSelect>
    </label>
  );
}

export default function JsonToCodePage() {
  const { showToast } = useApp();
  const [text, setText] = useState(SAMPLES[0].json);
  const [lang, setLang] = useState<Lang>('typescript');
  const [opts, setOpts] = useState<GenOptions>(DEFAULT_OPTIONS);
  const [copied, setCopied] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof GenOptions>(k: K, v: GenOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  // Khôi phục cấu hình từ URL
  useEffect(() => {
    const p = readShareParams();
    const l = p.get('lang');
    if (l && LANGS.some((x) => x.id === l)) queueMicrotask(() => setLang(l as Lang));
    queueMicrotask(() => setOpts((o) => {
      const n = { ...o };
      const root = p.get('root');
      if (root) n.rootName = root.slice(0, MAX_SHARE_ROOT);
      const b = (k: string, f: (v: boolean) => void) => {
        const v = p.get(k);
        if (v === '0' || v === '1') f(v === '1');
      };
      b('unwrap', (v) => (n.unwrapRoot = v));
      b('split', (v) => (n.splitNumbers = v));
      b('dates', (v) => (n.detectDates = v));
      b('maps', (v) => (n.detectMaps = v));
      b('ro', (v) => (n.readonly = v));
      b('exp', (v) => (n.exportTypes = v));
      b('ks', (v) => (n.kotlinSerial = v));
      const nm = p.get('naming');
      if (nm === 'short' || nm === 'path') n.naming = nm;
      const td = p.get('ts');
      if (td === 'interface' || td === 'type') n.tsDecl = td;
      const ta = p.get('any');
      if (ta === 'unknown' || ta === 'any') n.tsAny = ta;
      const py = p.get('py');
      if (py === 'dataclass' || py === 'typeddict' || py === 'pydantic') n.pyStyle = py;
      const sq = p.get('sql');
      if (sq === 'postgres' || sq === 'mysql' || sq === 'sqlite') n.sqlDialect = sq;
      return n;
    }));
  }, []);

  const deferredText = useDeferredValue(text);
  const analysis = useMemo(() => analyze(deferredText, opts), [deferredText, opts]);
  const result = useMemo(() => (analysis.ok ? render(analysis, lang) : analysis), [analysis, lang]);

  const empty = !text.trim();
  const code = result.ok ? result.code : '';
  const shown = code.length > MAX_DISPLAY ? code.slice(0, MAX_DISPLAY) : code;

  const shareParams = {
    lang,
    root: opts.rootName !== DEFAULT_OPTIONS.rootName ? opts.rootName.slice(0, MAX_SHARE_ROOT) : '',
    unwrap: bool(opts.unwrapRoot),
    split: bool(opts.splitNumbers),
    dates: bool(opts.detectDates),
    maps: bool(opts.detectMaps),
    naming: opts.naming,
    ts: opts.tsDecl,
    any: opts.tsAny,
    ro: bool(opts.readonly),
    exp: bool(opts.exportTypes),
    py: opts.pyStyle,
    ks: bool(opts.kotlinSerial),
    sql: opts.sqlDialect,
  };

  const copy = async () => {
    if (!result.ok) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      showToast('Đã sao chép mã!');
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const download = () => {
    if (!result.ok) return;
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestFileName(lang, opts.rootName);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Đã tải xuống ${a.download}!`);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_INPUT_CHARS) {
      showToast('File quá lớn (tối đa 5 MB).');
      return;
    }
    try {
      setText(await f.text());
    } catch {
      showToast('Không đọc được file.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const gotoError = () => {
    if (result.ok || result.pos === undefined || !taRef.current) return;
    const ta = taRef.current;
    ta.focus();
    ta.setSelectionRange(result.pos, Math.min(result.pos + 1, ta.value.length));
  };

  // Dòng chứa lỗi (cắt ngắn) để hiển thị kèm dấu ^
  const errorSnippet = useMemo(() => {
    if (result.ok || result.line === undefined || result.col === undefined || deferredText !== text) return null;
    const line = text.split('\n')[result.line - 1] ?? '';
    const col = result.col - 1;
    const start = Math.max(0, col - 40);
    const seg = line.slice(start, start + 90);
    return { seg, caret: ' '.repeat(Math.max(0, col - start)) + '^' };
  }, [result, text, deferredText]);

  const info = LANGS.find((l) => l.id === lang)!;
  const stats = result.ok ? result.stats : null;

  return (
    <div className="lg-fit-screen space-y-3.5 lg:space-y-0 lg:gap-3.5 lg:[&>*]:shrink-0">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <FileJson2 className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">JSON → Code</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Sinh kiểu dữ liệu từ JSON mẫu: TypeScript, Go, Python, Kotlin, Rust, Java, C#, Zod, JSON Schema, SQL
            </p>
          </div>
        </div>
        <ShareLinkButton params={shareParams} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-500 mr-1">Dữ liệu mẫu:</span>
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setText(s.json)}
            className="px-2.5 py-1 rounded-full border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-200 text-slate-700 transition"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-stretch lg:flex-1! lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]">
        {/* Đầu vào */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col min-h-[420px] lg:min-h-0 lg:h-full">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">JSON đầu vào</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition flex items-center gap-1 border border-indigo-200"
              >
                <Upload className="h-3.5 w-3.5" />
                Mở file
              </button>
              <button
                type="button"
                onClick={() => setText('')}
                data-tooltip="Xóa" aria-label="Xóa"
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.jsonl,.ndjson,.txt,application/json"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>
          </div>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={'Dán JSON vào đây. Có thể dán nhiều mẫu (mảng các object hoặc nhiều JSON nối tiếp) để suy luận trường tùy chọn.'}
            className="flex-1 w-full min-h-[300px] lg:min-h-0 p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-none leading-relaxed text-slate-800 whitespace-pre"
          />
          {!result.ok && !empty && (
            <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <div className="flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span className="flex-1 min-w-0 break-words">{result.error}</span>
                {result.pos !== undefined && (
                  <button
                    type="button"
                    onClick={gotoError}
                    className="shrink-0 px-2 py-0.5 rounded-md bg-white border border-red-200 hover:bg-red-100 flex items-center gap-1"
                  >
                    <Crosshair className="h-3 w-3" />
                    Đến vị trí lỗi
                  </button>
                )}
              </div>
              {errorSnippet && (
                <pre className="mt-1.5 font-mono text-[11px] overflow-x-auto leading-tight">
                  {errorSnippet.seg}
                  {'\n'}
                  {errorSnippet.caret}
                </pre>
              )}
            </div>
          )}
          <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between gap-2">
            <span>{text.length.toLocaleString('vi-VN')} ký tự</span>
            <span>{analysis.ok ? `${analysis.samples} mẫu` : ''}</span>
          </div>
        </div>

        {/* Đầu ra */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col min-h-[420px] lg:min-h-0 lg:h-full">
          <div className="px-2.5 pt-2.5 border-b border-slate-100 bg-slate-50/60">
            <div className="flex gap-1 overflow-x-auto pb-2.5">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLang(l.id)}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                    lang === l.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-3 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Tên kiểu gốc
              <input
                value={opts.rootName}
                onChange={(e) => set('rootName', e.target.value.slice(0, 60))}
                className="w-28 px-1.5 py-1 rounded-lg border border-slate-200 text-xs font-mono outline-hidden focus:border-indigo-500"
              />
            </label>
            <Select
              label="Đặt tên kiểu lồng"
              value={opts.naming}
              onChange={(v) => set('naming', v)}
              options={[
                { id: 'short', label: 'Theo khóa (Address)' },
                { id: 'path', label: 'Theo đường dẫn (UserAddress)' },
              ]}
            />
            <Toggle checked={opts.splitNumbers} onChange={(v) => set('splitNumbers', v)} label="Tách int / float" />
            <Toggle checked={opts.detectDates} onChange={(v) => set('detectDates', v)} label="Nhận diện ngày giờ ISO" />
            <Toggle checked={opts.detectMaps} onChange={(v) => set('detectMaps', v)} label="Nhận diện map (khóa là ID)" title="Object có ≥ 5 khóa dạng số/UUID sẽ thành Map thay vì struct" />
            <Toggle checked={opts.unwrapRoot} onChange={(v) => set('unwrapRoot', v)} label="Mảng gốc = danh sách mẫu" title="Bật: các phần tử của mảng gốc được gộp thành một kiểu" />

            {lang === 'typescript' && (
              <>
                <Select label="Khai báo" value={opts.tsDecl} onChange={(v) => set('tsDecl', v)} options={[{ id: 'interface', label: 'interface' }, { id: 'type', label: 'type' }]} />
                <Select label="Không rõ" value={opts.tsAny} onChange={(v) => set('tsAny', v)} options={[{ id: 'unknown', label: 'unknown' }, { id: 'any', label: 'any' }]} />
              </>
            )}
            {lang === 'zod' && (
              <Select label="Không rõ" value={opts.tsAny} onChange={(v) => set('tsAny', v)} options={[{ id: 'unknown', label: 'z.unknown()' }, { id: 'any', label: 'z.any()' }]} />
            )}
            {lang === 'python' && (
              <Select
                label="Kiểu"
                value={opts.pyStyle}
                onChange={(v) => set('pyStyle', v)}
                options={[{ id: 'dataclass', label: 'dataclass' }, { id: 'typeddict', label: 'TypedDict' }, { id: 'pydantic', label: 'Pydantic v2' }]}
              />
            )}
            {lang === 'kotlin' && <Toggle checked={opts.kotlinSerial} onChange={(v) => set('kotlinSerial', v)} label="kotlinx.serialization" />}
            {lang === 'sql' && (
              <Select
                label="CSDL"
                value={opts.sqlDialect}
                onChange={(v) => set('sqlDialect', v)}
                options={[{ id: 'postgres', label: 'PostgreSQL' }, { id: 'mysql', label: 'MySQL' }, { id: 'sqlite', label: 'SQLite' }]}
              />
            )}
            {['typescript', 'zod', 'python', 'csharp'].includes(lang) && (
              <Toggle
                checked={opts.readonly}
                onChange={(v) => set('readonly', v)}
                label="readonly"
                title="TypeScript/Zod: readonly · Python: frozen · C#: init"
              />
            )}
            {['typescript', 'zod', 'rust'].includes(lang) && (
              <Toggle checked={opts.exportTypes} onChange={(v) => set('exportTypes', v)} label={lang === 'rust' ? 'pub' : 'export'} />
            )}
          </div>

          <div className="relative flex-1 min-h-[260px] lg:min-h-0 bg-slate-900">
            {result.ok ? (
              <pre className="absolute inset-0 overflow-auto p-3 text-xs font-mono text-slate-100 leading-relaxed whitespace-pre">
                {shown}
                {code.length > shown.length && `\n\n/* … đã cắt bớt khi hiển thị (${code.length.toLocaleString('vi-VN')} ký tự). Dùng Sao chép / Tải xuống để lấy đủ. */`}
              </pre>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-slate-400">
                {empty ? 'Dán JSON ở bên trái để xem mã được sinh ra.' : 'Không thể sinh mã: ' + result.error}
              </div>
            )}
          </div>

          <div className="px-3 py-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
              {stats && (
                <>
                  <span><b className="text-slate-700">{stats.models}</b> kiểu</span>
                  <span><b className="text-slate-700">{stats.fields}</b> trường</span>
                  <span><b className="text-slate-700">{stats.optionalFields}</b> tùy chọn</span>
                  <span><b className="text-slate-700">{stats.nullableFields}</b> nullable</span>
                  <span><b className="text-slate-700">{stats.samples}</b> mẫu</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <SendToButton text={code} fromToolId="json-to-code" />
              <button
                type="button"
                onClick={copy}
                disabled={!result.ok}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1 disabled:opacity-50"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                Sao chép
              </button>
              <button
                type="button"
                onClick={download}
                disabled={!result.ok}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition flex items-center gap-1 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Tải .{info.ext}
              </button>
            </div>
          </div>
          {result.ok && result.warnings.length > 0 && (
            <div className="px-3 py-1.5 border-t border-amber-200 bg-amber-50 text-[11px] text-amber-800 space-y-0.5">
              {result.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Mẹo: dán một mảng các object hoặc nhiều JSON liền nhau (mỗi dòng một JSON) để công cụ gộp các mẫu — trường chỉ có ở một
        số mẫu sẽ thành tùy chọn (<code>?</code>, <code>omitempty</code>, <code>Option</code>), kiểu khác nhau thành union.
        Mọi xử lý diễn ra trên trình duyệt của bạn.
      </p>
    </div>
  );
}
