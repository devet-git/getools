'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Database, Copy, Check, Download, Trash2, Wand2, Minimize2, AlertTriangle, ListOrdered } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  DEFAULT_SQL_OPTIONS,
  DIALECT_LABEL,
  SQL_SAMPLES,
  extractParams,
  formatSql,
  type SqlCommaStyle,
  type SqlDialect,
  type SqlFormatOptions,
  type SqlKeywordCase,
} from '@/lib/sql-format';

import { SendToButton } from '@/components/SendToButton';
const MAX_CHARS = 500_000;

const DIALECTS = Object.keys(DIALECT_LABEL) as SqlDialect[];
const CASES: { v: SqlKeywordCase; l: string }[] = [
  { v: 'upper', l: 'IN HOA' },
  { v: 'lower', l: 'in thường' },
  { v: 'keep', l: 'Giữ nguyên' },
];
const INDENTS: { v: SqlFormatOptions['indent']; l: string }[] = [
  { v: 2, l: '2 dấu cách' },
  { v: 4, l: '4 dấu cách' },
  { v: 'tab', l: 'Tab' },
];

const selectCls =
  'px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 outline-hidden focus:border-indigo-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
      {label}
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-indigo-600" />
      {label}
    </label>
  );
}

export default function SqlToolsPage() {
  const { showToast } = useApp();
  const [input, setInput] = useState(SQL_SAMPLES[0].sql);
  const [opts, setOpts] = useState<SqlFormatOptions>(DEFAULT_SQL_OPTIONS);
  const [copied, setCopied] = useState(false);
  const [showParams, setShowParams] = useState(true);

  // Khởi tạo tuỳ chọn từ URL
  useEffect(() => {
    const sp = readShareParams();
    const next: Partial<SqlFormatOptions> = {};
    const d = sp.get('d') as SqlDialect | null;
    if (d && DIALECTS.includes(d)) next.dialect = d;
    const kc = sp.get('kc') as SqlKeywordCase | null;
    if (kc && CASES.some((c) => c.v === kc)) next.keywordCase = kc;
    const ind = sp.get('ind');
    if (ind === '2') next.indent = 2;
    else if (ind === '4') next.indent = 4;
    else if (ind === 'tab') next.indent = 'tab';
    const cm = sp.get('cm');
    if (cm === 'leading' || cm === 'trailing') next.commaStyle = cm as SqlCommaStyle;
    const w = Number(sp.get('w'));
    if (w >= 20 && w <= 300) next.maxWidth = Math.round(w);
    if (sp.get('ao') === '0') next.breakAndOr = false;
    if (sp.get('sc') === '1') next.stripComments = true;
    if (sp.get('m') === '1') next.minify = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Object.keys(next).length) setOpts((o) => ({ ...o, ...next }));
  }, []);

  const set = <K extends keyof SqlFormatOptions>(k: K, v: SqlFormatOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const deferred = useDeferredValue(input);
  const tooBig = deferred.length > MAX_CHARS;
  const result = useMemo(() => {
    if (tooBig || !deferred.trim()) return null;
    return formatSql(deferred, opts);
  }, [deferred, opts, tooBig]);
  const params = useMemo(() => (tooBig || !deferred.trim() ? [] : extractParams(deferred, opts.dialect)), [deferred, opts.dialect, tooBig]);

  const output = result?.output ?? '';
  const inLines = input ? input.split('\n').length : 0;
  const outLines = output ? output.split('\n').length : 0;

  const handleCopy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      showToast('Đã sao chép SQL!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output + '\n'], { type: 'application/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = opts.minify ? 'query.min.sql' : 'query.sql';
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadSample = (id: string) => {
    const s = SQL_SAMPLES.find((x) => x.id === id);
    if (!s) return;
    setInput(s.sql);
    set('dialect', s.dialect);
  };

  const shareParams = {
    d: opts.dialect === 'standard' ? '' : opts.dialect,
    kc: opts.keywordCase === 'upper' ? '' : opts.keywordCase,
    ind: opts.indent === 2 ? '' : String(opts.indent),
    cm: opts.commaStyle === 'trailing' ? '' : opts.commaStyle,
    w: opts.maxWidth === 80 ? '' : String(opts.maxWidth),
    ao: opts.breakAndOr ? '' : '0',
    sc: opts.stripComments ? '1' : '',
    m: opts.minify ? '1' : '',
  };

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">SQL Formatter</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Định dạng, nén và làm đẹp SQL ngay trên trình duyệt - không gửi dữ liệu đi đâu
            </p>
          </div>
        </div>
        <ShareLinkButton params={shareParams} />
      </div>

      {/* Mẫu */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mr-1">Mẫu</span>
        {SQL_SAMPLES.map((s) => (
          <button
            key={s.id}
            onClick={() => loadSample(s.id)}
            className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-full transition"
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Tuỳ chọn */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Phương ngữ">
            <select className={selectCls} value={opts.dialect} onChange={(e) => set('dialect', e.target.value as SqlDialect)}>
              {DIALECTS.map((d) => (
                <option key={d} value={d}>
                  {DIALECT_LABEL[d]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Từ khóa">
            <select className={selectCls} value={opts.keywordCase} onChange={(e) => set('keywordCase', e.target.value as SqlKeywordCase)}>
              {CASES.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Thụt lề">
            <select
              className={selectCls}
              value={String(opts.indent)}
              onChange={(e) => set('indent', e.target.value === 'tab' ? 'tab' : e.target.value === '4' ? 4 : 2)}
            >
              {INDENTS.map((c) => (
                <option key={String(c.v)} value={String(c.v)}>
                  {c.l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dấu phẩy">
            <select className={selectCls} value={opts.commaStyle} onChange={(e) => set('commaStyle', e.target.value as SqlCommaStyle)}>
              <option value="trailing">Cuối dòng (a,)</option>
              <option value="leading">Đầu dòng (, a)</option>
            </select>
          </Field>
          <Field label="Rộng tối đa">
            <input
              type="number"
              min={20}
              max={300}
              value={opts.maxWidth}
              onChange={(e) => set('maxWidth', Math.min(300, Math.max(20, Number(e.target.value) || 80)))}
              className={selectCls + ' w-20'}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Toggle checked={opts.breakAndOr} onChange={(v) => set('breakAndOr', v)} label="Xuống dòng trước AND / OR" />
          <Toggle checked={opts.blankBetween} onChange={(v) => set('blankBetween', v)} label="Dòng trống giữa các câu lệnh" />
          <Toggle checked={opts.stripComments} onChange={(v) => set('stripComments', v)} label="Bỏ chú thích" />
          <Toggle checked={opts.minify} onChange={(v) => set('minify', v)} label="Nén thành 1 dòng" />
          <Toggle checked={showParams} onChange={setShowParams} label="Trích xuất tham số" />
        </div>
      </div>

      {/* Hai khung */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">SQL đầu vào</span>
            <button
              onClick={() => setInput('')}
              title="Xóa"
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder="Dán câu lệnh SQL vào đây..."
            className="w-full min-h-[360px] lg:min-h-[480px] p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-y leading-relaxed text-slate-800 whitespace-pre"
          />
          <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
            <span>{inLines} dòng</span>
            <span>{input.length.toLocaleString('vi-VN')} ký tự</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              {opts.minify ? <Minimize2 className="h-3.5 w-3.5 text-indigo-500" /> : <Wand2 className="h-3.5 w-3.5 text-indigo-500" />}
              {opts.minify ? 'SQL đã nén' : 'SQL đã định dạng'}
            </span>
            <div className="flex items-center gap-1.5">
              <SendToButton text={output} fromToolId="sql-tools" />
              <button
                onClick={handleCopy}
                disabled={!output}
                className="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 rounded-lg transition flex items-center gap-1 border border-indigo-200"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                Sao chép
              </button>
              <button
                onClick={handleDownload}
                disabled={!output}
                className="px-2 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 rounded-lg transition flex items-center gap-1 border border-slate-200"
              >
                <Download className="h-3.5 w-3.5" />
                Tải .sql
              </button>
            </div>
          </div>
          <pre className="flex-1 min-h-[360px] lg:min-h-[480px] max-h-[640px] overflow-auto p-3 text-xs font-mono bg-slate-900 text-slate-100 leading-relaxed whitespace-pre">
            {tooBig
              ? `Đầu vào quá lớn (${deferred.length.toLocaleString('vi-VN')} ký tự). Giới hạn là ${MAX_CHARS.toLocaleString('vi-VN')} ký tự.`
              : result?.error
                ? result.error
                : output || 'Kết quả sẽ hiển thị ở đây.'}
          </pre>
          <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
            <span>
              {outLines} dòng
              {result && result.statements > 0 ? ` · ${result.statements} câu lệnh` : ''}
            </span>
            <span>{output.length.toLocaleString('vi-VN')} ký tự</span>
          </div>
        </div>
      </div>

      {result && result.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 text-xs space-y-0.5">
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {showParams && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <ListOrdered className="h-3.5 w-3.5 text-indigo-500" />
            Tham số tìm thấy ({params.length})
          </div>
          {params.length === 0 ? (
            <p className="p-3 text-xs text-slate-400">
              Không có tham số. Hỗ trợ <code>?</code>, <code>$1</code>, <code>:name</code>, <code>@var</code>, <code>%s</code>, <code>%(name)s</code>.
            </p>
          ) : (
            <div className="p-3 flex flex-wrap gap-2">
              {params.map((p, i) => (
                <div key={p.text + i} className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs">
                  <code className="font-mono font-semibold text-indigo-700">{p.text}</code>
                  <span className="text-slate-400">
                    {' '}
                    · {p.kind === 'named' ? 'tên' : 'vị trí'} · {p.count}x · dòng {p.lines.join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Mẹo: phương ngữ chỉ ảnh hưởng cách nhận diện dấu nháy/chú thích và bộ từ khóa. Chuỗi, định danh, chú thích và tham số luôn được giữ nguyên
        từng ký tự; chú thích gợi ý (hint) dạng <code>{'/*+ ... */'}</code> được giữ lại cả khi bật “Bỏ chú thích”.
      </p>
    </div>
  );
}
