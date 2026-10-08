'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Terminal,
  Copy,
  Check,
  Download,
  Trash2,
  Sparkles,
  AlertTriangle,
  Plus,
  X,
  ArrowRightLeft,
  Info,
  Lock,
  ListChecks,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  CURL_SAMPLES,
  LANGUAGES,
  MAX_CURL_INPUT,
  buildCurlCommand,
  generateCode,
  jsonNodeToString,
  parseCurl,
  type CurlBuildInput,
  type ParsedCurl,
} from '@/lib/curl-converter';

const DEFAULT_LANG = 'js-fetch';

const METHOD_STYLE: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-700',
  POST: 'bg-indigo-100 text-indigo-700',
  PUT: 'bg-amber-100 text-amber-700',
  PATCH: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-red-100 text-red-700',
  HEAD: 'bg-slate-100 text-slate-700',
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function download(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Summary({ req }: { req: ParsedCurl }) {
  const body = req.body;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="px-3.5 py-2 border-b border-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <ListChecks className="h-4 w-4 text-indigo-500" />
        Request đã phân tích
      </div>
      <div className="p-3.5 space-y-3 text-xs">
        <div className="flex flex-wrap items-start gap-2">
          <span className={`px-2 py-0.5 rounded-md font-bold ${METHOD_STYLE[req.method] ?? 'bg-slate-100 text-slate-700'}`}>
            {req.method}
          </span>
          <code className="font-mono text-slate-800 break-all flex-1 min-w-0">{req.baseUrl}</code>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {req.auth && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 flex items-center gap-1">
              <Lock className="h-3 w-3" /> Basic auth: {req.auth.user}
            </span>
          )}
          {req.follow && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">-L theo redirect</span>}
          {req.insecure && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">-k bỏ qua TLS</span>}
          {req.compressed && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">--compressed</span>}
        </div>

        {req.query.length > 0 && (
          <div>
            <div className="font-semibold text-slate-600 mb-1">Tham số query ({req.query.length})</div>
            <div className="rounded-lg border border-slate-200 overflow-x-auto">
              <table className="w-full text-left">
                <tbody>
                  {req.query.map((q, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-1 font-mono text-slate-700 whitespace-nowrap align-top">{q.name}</td>
                      <td className="px-2 py-1 font-mono text-slate-500 break-all">{q.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {req.headers.length > 0 && (
          <div>
            <div className="font-semibold text-slate-600 mb-1">Headers ({req.headers.length})</div>
            <div className="rounded-lg border border-slate-200 overflow-x-auto">
              <table className="w-full text-left">
                <tbody>
                  {req.headers.map((h, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-1 font-mono text-slate-700 whitespace-nowrap align-top">{h.name}</td>
                      <td className="px-2 py-1 font-mono text-slate-500 break-all">
                        {h.value}
                        {h.inferred && (
                          <span className="ml-1.5 px-1 py-px rounded bg-indigo-50 text-indigo-600 text-[10px] font-sans">
                            tự suy ra
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {req.form && (
          <div>
            <div className="font-semibold text-slate-600 mb-1">Form multipart ({req.form.length} trường)</div>
            <div className="rounded-lg border border-slate-200 overflow-x-auto">
              <table className="w-full text-left">
                <tbody>
                  {req.form.map((f, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-1 font-mono text-slate-700 whitespace-nowrap align-top">{f.name}</td>
                      <td className="px-2 py-1 font-mono text-slate-500 break-all">
                        {f.kind === 'file' ? '@' : f.kind === 'filetext' ? '<' : ''}
                        {f.value}
                        {f.type && <span className="ml-1.5 text-indigo-600">[{f.type}]</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {body && (
          <div>
            <div className="font-semibold text-slate-600 mb-1">
              Body {body.kind === 'text' && body.json ? '(JSON)' : body.kind === 'file' ? '(file)' : ''}
            </div>
            <pre className="rounded-lg bg-slate-50 border border-slate-200 p-2 font-mono text-[11px] text-slate-700 whitespace-pre-wrap break-all max-h-56 overflow-auto">
              {body.kind === 'file'
                ? `@${body.path}`
                : body.json
                  ? jsonNodeToString(body.json, 2)
                  : body.text.length > 20000
                    ? body.text.slice(0, 20000) + '\n… (đã cắt bớt)'
                    : body.text}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

let rowId = 1;

function ReverseBuilder({ onUse }: { onUse: (cmd: string) => void }) {
  const { showToast } = useApp();
  const [method, setMethod] = useState('POST');
  const [url, setUrl] = useState('https://api.example.com/v1/items');
  const [headers, setHeaders] = useState<HeaderRow[]>([
    { id: rowId++, name: 'Authorization', value: 'Bearer TOKEN' },
    { id: rowId++, name: '', value: '' },
  ]);
  const [bodyType, setBodyType] = useState<CurlBuildInput['bodyType']>('json');
  const [body, setBody] = useState('{\n  "name": "Áo thun",\n  "price": 199000\n}');
  const [user, setUser] = useState('');
  const [location, setLocation] = useState(false);
  const [insecure, setInsecure] = useState(false);
  const [compressed, setCompressed] = useState(false);
  const [silent, setSilent] = useState(false);
  const [multiline, setMultiline] = useState(true);
  const [copied, setCopied] = useState(false);

  const result = useMemo(
    () =>
      buildCurlCommand({
        method,
        url,
        headers: headers.map((h) => ({ name: h.name, value: h.value })),
        bodyType,
        body,
        user,
        location,
        insecure,
        compressed,
        silent,
        multiline,
      }),
    [method, url, headers, bodyType, body, user, location, insecure, compressed, silent, multiline]
  );

  const updateRow = (id: number, patch: Partial<HeaderRow>) =>
    setHeaders((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.command);
      setCopied(true);
      showToast('Đã sao chép lệnh cURL!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const input = 'w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:border-indigo-400';
  const check = (label: string, v: boolean, set: (b: boolean) => void) => (
    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} className="accent-indigo-600" />
      {label}
    </label>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-3.5 space-y-3">
        <div className="flex gap-2">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${input} w-28 font-semibold`}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/path" className={`${input} font-mono`} />
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">Headers</div>
          <div className="space-y-1.5">
            {headers.map((h) => (
              <div key={h.id} className="flex gap-1.5">
                <input value={h.name} onChange={(e) => updateRow(h.id, { name: e.target.value })} placeholder="Tên" className={`${input} font-mono w-2/5`} />
                <input value={h.value} onChange={(e) => updateRow(h.id, { value: e.target.value })} placeholder="Giá trị" className={`${input} font-mono`} />
                <button
                  onClick={() => setHeaders((rows) => rows.filter((r) => r.id !== h.id))}
                  className="px-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-slate-100"
                  title="Xóa header"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setHeaders((rows) => [...rows, { id: rowId++, name: '', value: '' }])}
            className="mt-1.5 px-2 py-1 rounded-lg text-xs text-indigo-600 hover:bg-indigo-50 flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Thêm header
          </button>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-slate-600">Body</span>
            <select value={bodyType} onChange={(e) => setBodyType(e.target.value as CurlBuildInput['bodyType'])} className="px-2 py-0.5 text-xs rounded-lg border border-slate-200 bg-white">
              <option value="none">Không có</option>
              <option value="json">JSON</option>
              <option value="raw">Văn bản thô</option>
              <option value="urlencoded">Form urlencoded (mỗi dòng tên=giá trị)</option>
            </select>
          </div>
          {bodyType !== 'none' && (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} spellCheck={false} className={`${input} font-mono resize-y`} />
          )}
        </div>

        <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Basic auth (tên:mật khẩu) — tùy chọn" className={`${input} font-mono`} />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {check('-L theo redirect', location, setLocation)}
          {check('-k bỏ qua TLS', insecure, setInsecure)}
          {check('--compressed', compressed, setCompressed)}
          {check('-s im lặng', silent, setSilent)}
          {check('Nhiều dòng', multiline, setMultiline)}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
        <div className="px-3.5 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-800">Lệnh cURL</span>
          <div className="flex gap-1.5">
            <button onClick={copy} disabled={!result.command} className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1 disabled:opacity-50">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              Sao chép
            </button>
            <button onClick={() => onUse(result.command)} disabled={!result.command} className="px-2.5 py-1 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition flex items-center gap-1 disabled:opacity-50">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Chuyển sang code
            </button>
          </div>
        </div>
        <pre className="flex-1 bg-slate-900 text-slate-100 p-3.5 font-mono text-xs whitespace-pre-wrap break-all overflow-auto min-h-40">
          {result.command || 'Nhập URL để tạo lệnh cURL.'}
        </pre>
        {result.warnings.length > 0 && (
          <ul className="p-3 space-y-1 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
            {result.warnings.map((w, i) => (
              <li key={i} className="flex gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                {w}
              </li>
            ))}
          </ul>
        )}
        <p className="px-3.5 py-2 text-[11px] text-slate-500 border-t border-slate-100">
          Mọi giá trị được đặt trong dấu nháy đơn, dấu <code>&apos;</code> bên trong được thoát thành <code>&apos;\&apos;&apos;</code> nên an toàn khi dán vào bash/zsh.
        </p>
      </div>
    </div>
  );
}

export default function CurlConverterPage() {
  const { showToast } = useApp();
  const [mode, setMode] = useState<'parse' | 'build'>('parse');
  const [input, setInput] = useState(CURL_SAMPLES[1].command);
  const [lang, setLang] = useState(DEFAULT_LANG);
  const [rawBody, setRawBody] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const p = readShareParams();
    const l = p.get('lang');
    setTimeout(() => {
      if (l && LANGUAGES.some((x) => x.id === l)) setLang(l);
      if (p.get('raw') === '1') setRawBody(true);
    }, 0);
  }, []);

  const deferred = useDeferredValue(input);
  const parsed = useMemo(() => parseCurl(deferred), [deferred]);
  const langInfo = LANGUAGES.find((l) => l.id === lang) ?? LANGUAGES[0];
  const gen = useMemo(() => (parsed.ok ? generateCode(parsed.req, lang, { rawBody }) : null), [parsed, lang, rawBody]);
  const hasJson = parsed.ok && parsed.req.body?.kind === 'text' && !!parsed.req.body.json;

  const copy = async () => {
    if (!gen?.code) return;
    try {
      await navigator.clipboard.writeText(gen.code);
      setCopied(true);
      showToast('Đã sao chép mã!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const save = () => {
    if (!gen?.code) return;
    const name = langInfo.ext === 'java' ? 'Main.java' : `request.${langInfo.ext}`;
    download(gen.code, name);
    showToast(`Đã tải xuống ${name}!`);
  };

  const warnings = parsed.ok ? parsed.req.warnings : parsed.warnings;
  const tooLong = input.length > MAX_CURL_INPUT;

  return (
    <div className="space-y-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">cURL → Code</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Đổi lệnh cURL (kể cả &quot;Copy as cURL&quot; của DevTools) sang fetch, axios, Python, Go, PHP, Java, C#, Rust... và ngược lại. Xử lý hoàn toàn trên trình duyệt.
            </p>
          </div>
        </div>
        <div className="flex rounded-lg bg-slate-800 border border-slate-700 p-0.5 text-xs">
          {(
            [
              ['parse', 'cURL → Code'],
              ['build', 'Dựng lệnh cURL'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded-md font-medium transition ${mode === m ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'build' ? (
        <ReverseBuilder
          onUse={(cmd) => {
            setInput(cmd);
            setMode('parse');
          }}
        />
      ) : (
        <>
          {/* INPUT */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-3.5 py-2 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">Lệnh cURL</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                {CURL_SAMPLES.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => setInput(s.command)}
                    className="px-2 py-0.5 rounded-md text-[11px] font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition"
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  onClick={() => setInput('')}
                  className="px-2 py-0.5 rounded-md text-[11px] font-medium text-red-600 hover:bg-red-50 border border-slate-200 transition flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" /> Xóa
                </button>
              </div>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              rows={9}
              placeholder={`Dán lệnh cURL vào đây, ví dụ:\ncurl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{"name":"An"}'`}
              className="w-full px-3.5 py-3 font-mono text-xs text-slate-800 bg-slate-50 focus:outline-hidden resize-y"
            />
            <p className="px-3.5 py-1.5 text-[11px] text-slate-500 border-t border-slate-100 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
              Mẹo: hỗ trợ nháy đơn/kép, <code>$&apos;...&apos;</code> của Chrome, nối dòng bằng <code>\</code>, và dạng Windows cmd (<code>^</code>). Trong DevTools: chuột phải request → Copy → Copy as cURL.
            </p>
          </div>

          {tooLong && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">Lệnh quá dài (giới hạn 1.000.000 ký tự).</div>
          )}

          {!parsed.ok && input.trim() && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {parsed.error}
            </div>
          )}

          {warnings.length > 0 && input.trim() && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
              <div className="text-xs font-semibold text-amber-800 mb-1 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Cảnh báo ({warnings.length})
              </div>
              <ul className="space-y-0.5 text-xs text-amber-800 list-disc pl-5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {parsed.ok && (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3.5 items-start">
              <Summary req={parsed.req} />

              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-2.5 py-2 border-b border-slate-100 flex flex-wrap gap-1" role="tablist" aria-label="Ngôn ngữ đích">
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.id}
                      role="tab"
                      aria-selected={l.id === lang}
                      onClick={() => setLang(l.id)}
                      className={`px-2 py-1 rounded-md text-xs font-medium transition ${
                        l.id === lang ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>

                <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100">
                  <label
                    className={`flex items-center gap-1.5 text-xs cursor-pointer ${hasJson ? 'text-slate-700' : 'text-slate-400'}`}
                    title="Bật để giữ body ở dạng chuỗi gốc thay vì cấu trúc native (object/dict/map)"
                  >
                    <input
                      type="checkbox"
                      checked={rawBody}
                      onChange={(e) => setRawBody(e.target.checked)}
                      disabled={!hasJson}
                      className="accent-indigo-600"
                    />
                    Giữ nguyên chuỗi body
                  </label>
                  <div className="flex items-center gap-1.5">
                    <ShareLinkButton params={{ lang: lang === DEFAULT_LANG ? '' : lang, raw: rawBody ? '1' : '' }} />
                    <button
                      onClick={copy}
                      disabled={!gen?.code}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1 disabled:opacity-50"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      Sao chép
                    </button>
                    <button
                      onClick={save}
                      disabled={!gen?.code}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition flex items-center gap-1 disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Tải xuống
                    </button>
                  </div>
                </div>

                <pre className="bg-slate-900 text-slate-100 p-3.5 font-mono text-xs overflow-auto max-h-[36rem] whitespace-pre">
                  {gen?.code || '// Không sinh được mã.'}
                </pre>

                {gen && gen.notes.length > 0 && (
                  <ul className="p-3 space-y-1 bg-slate-50 border-t border-slate-100 text-xs text-slate-600">
                    {gen.notes.map((n, i) => (
                      <li key={i} className="flex gap-1.5">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-px text-indigo-500" />
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
