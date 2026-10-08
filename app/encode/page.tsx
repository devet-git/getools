'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Binary,
  Copy,
  Check,
  Trash2,
  Upload,
  ArrowDownUp,
  ShieldAlert,
  RefreshCw,
  FileText,
  Download,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { SendToButton } from '@/components/SendToButton';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  base64Encode,
  base64Decode,
  urlEncode,
  urlDecode,
  UrlMode,
  htmlEncode,
  htmlDecode,
  decodeJwt,
  JwtResult,
  HASH_ALGOS,
  HashAlgo,
  hashAll,
  MAX_HASH_FILE_SIZE,
  generateUuids,
  generatePassword,
  passwordEntropyBits,
  DEFAULT_PASSWORD_OPTIONS,
  PasswordOptions,
} from '@/lib/encoders';

type TabId = 'base64' | 'url' | 'html' | 'jwt' | 'hash' | 'gen';

const TABS: { id: TabId; label: string }[] = [
  { id: 'base64', label: 'Base64' },
  { id: 'url', label: 'URL' },
  { id: 'html', label: 'HTML entities' },
  { id: 'jwt', label: 'JWT' },
  { id: 'hash', label: 'Hash' },
  { id: 'gen', label: 'UUID / Mật khẩu' },
];

const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRy4bqnbiBWxINuIEEiLCJpYXQiOjE1MTYyMzkwMjIsImV4cCI6MTUxNjI0MjYyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const cardCls = 'bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden';
const taCls =
  'w-full p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-y leading-relaxed text-slate-800 min-h-[140px]';
const btnPrimary =
  'px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition flex items-center gap-1';
const checkCls = 'rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5';

function useCopy() {
  const { showToast } = useApp();
  return async (text: string, msg = 'Đã sao chép!') => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(msg);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };
}

function CopyButton({ text, label = 'Chép', disabled }: { text: string; label?: string; disabled?: boolean }) {
  const copy = useCopy();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <button
      disabled={disabled || !text}
      onClick={async () => {
        await copy(text);
        setDone(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1500);
      }}
      className={`${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Đã chép!' : label}
    </button>
  );
}

function Pane({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`${cardCls} flex flex-col`}>
      <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2 min-h-[46px]">
        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">{title}</span>
        <div className="flex items-center gap-1.5">{right}</div>
      </div>
      {children}
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div role="alert" className="px-3 py-2 text-xs text-red-700 bg-red-50 border-t border-red-100">
      {msg}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2 py-0.5 rounded-md font-medium transition ${
            value === o.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type TabProps = { initial: Initial; onShare: (s: ShareState) => void };

/* ---------- Tab chung cho Base64 / URL / HTML ---------- */

type Dir = 'encode' | 'decode';

type ShareState = { t: string; d?: string };
type Initial = { tab: TabId; t: string | null; d: string | null };

function TextConverter({
  convert,
  options,
  sample,
  initial,
  onShare,
}: {
  convert: (input: string, dir: Dir) => string;
  options?: React.ReactNode;
  sample: string;
  initial: Initial;
  onShare: (s: ShareState) => void;
}) {
  const [dir, setDir] = useState<Dir>(initial.d === 'decode' ? 'decode' : 'encode');
  const [input, setInput] = useState(initial.t ?? sample);

  useEffect(() => {
    onShare({ t: input, d: dir });
  }, [input, dir, onShare]);

  const { output, error } = useMemo(() => {
    if (!input) return { output: '', error: '' };
    try {
      return { output: convert(input, dir), error: '' };
    } catch (e) {
      return { output: '', error: e instanceof Error ? e.message : 'Lỗi không xác định.' };
    }
  }, [input, dir, convert]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={dir}
          onChange={setDir}
          options={[
            { id: 'encode', label: 'Mã hóa' },
            { id: 'decode', label: 'Giải mã' },
          ]}
        />
        {options}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3.5 items-stretch">
        <Pane
          title="Đầu vào"
          right={
            <button onClick={() => setInput('')} title="Xóa" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
              <Trash2 className="h-4 w-4" />
            </button>
          }
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder="Nhập văn bản..."
            className={taCls}
          />
        </Pane>
        <div className="flex lg:flex-col items-center justify-center">
          <button
            disabled={!output}
            onClick={() => {
              setInput(output);
              setDir(dir === 'encode' ? 'decode' : 'encode');
            }}
            title="Đưa kết quả làm đầu vào và đảo chiều"
            className="p-2 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-xs transition disabled:opacity-40"
          >
            <ArrowDownUp className="h-4 w-4 lg:-rotate-90" />
          </button>
        </div>
        <Pane title="Kết quả" right={<div className="flex items-center gap-1.5"><SendToButton text={output} fromToolId="encode" /><CopyButton text={output} /></div>}>
          <textarea readOnly value={output} spellCheck={false} className={taCls} />
          {error && <ErrorBox msg={error} />}
        </Pane>
      </div>
    </div>
  );
}

function Base64Tab({ initial, onShare }: TabProps) {
  const [urlSafe, setUrlSafe] = useState(false);
  const convert = useMemo(
    () => (s: string, d: Dir) => (d === 'encode' ? base64Encode(s, urlSafe) : base64Decode(s)),
    [urlSafe]
  );
  return (
    <TextConverter
      initial={initial}
      onShare={onShare}
      sample="Xin chào Việt Nam! 🇻🇳"
      convert={convert}
      options={
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-slate-700 font-medium">
          <input type="checkbox" checked={urlSafe} onChange={() => setUrlSafe(!urlSafe)} className={checkCls} />
          Biến thể URL-safe (- _ , bỏ dấu =) khi mã hóa
        </label>
      }
    />
  );
}

function UrlTab({ initial, onShare }: TabProps) {
  const [mode, setMode] = useState<UrlMode>('component');
  const convert = useMemo(
    () => (s: string, d: Dir) => (d === 'encode' ? urlEncode(s, mode) : urlDecode(s, mode)),
    [mode]
  );
  return (
    <TextConverter
      initial={initial}
      onShare={onShare}
      sample="https://example.com/tìm-kiếm?q=xin chào&lang=vi"
      convert={convert}
      options={
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { id: 'component', label: 'Component' },
            { id: 'uri', label: 'Toàn bộ URI' },
          ]}
        />
      }
    />
  );
}

function HtmlTab({ initial, onShare }: TabProps) {
  const [nonAscii, setNonAscii] = useState(false);
  const convert = useMemo(
    () => (s: string, d: Dir) => (d === 'encode' ? htmlEncode(s, nonAscii) : htmlDecode(s)),
    [nonAscii]
  );
  return (
    <TextConverter
      initial={initial}
      onShare={onShare}
      sample={'<p class="note">Tom & Jerry — "Việt Nam"</p>'}
      convert={convert}
      options={
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-slate-700 font-medium">
          <input type="checkbox" checked={nonAscii} onChange={() => setNonAscii(!nonAscii)} className={checkCls} />
          Mã hóa cả ký tự ngoài ASCII (&amp;#số;)
        </label>
      }
    />
  );
}

/* ---------- JWT ---------- */

function JwtTab({ initial, onShare }: TabProps) {
  const [token, setToken] = useState(initial.t ?? SAMPLE_JWT);
  useEffect(() => {
    onShare({ t: token });
  }, [token, onShare]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const { result, error } = useMemo((): { result: JwtResult | null; error: string } => {
    if (!token.trim()) return { result: null, error: '' };
    try {
      return { result: decodeJwt(token, now), error: '' };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : 'Lỗi không xác định.' };
    }
  }, [token, now]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleString('vi-VN')}  (${iso})`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-px" />
        <span>
          <strong>Chữ ký KHÔNG được xác minh.</strong> Công cụ chỉ giải mã nội dung header và payload; không dùng kết quả này để tin tưởng token.
        </span>
      </div>
      <Pane
        title="JWT"
        right={
          <button onClick={() => setToken('')} title="Xóa" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
            <Trash2 className="h-4 w-4" />
          </button>
        }
      >
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          spellCheck={false}
          placeholder="Dán JWT dạng xxxxx.yyyyy.zzzzz"
          className={`${taCls} break-all`}
        />
        {error && <ErrorBox msg={error} />}
      </Pane>

      {result && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {result.expired === true && (
              <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">Đã hết hạn</span>
            )}
            {result.expired === false && (
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">Chưa hết hạn</span>
            )}
            {result.expired === null && (
              <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">Không có claim exp</span>
            )}
            {result.notYetValid && (
              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">Chưa có hiệu lực (nbf)</span>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            <Pane title="Header" right={<CopyButton text={result.headerJson} />}>
              <pre className="p-3 text-xs font-mono text-slate-800 overflow-auto max-h-[320px] whitespace-pre-wrap break-all">{result.headerJson}</pre>
            </Pane>
            <Pane title="Payload" right={<CopyButton text={result.payloadJson} />}>
              <pre className="p-3 text-xs font-mono text-slate-800 overflow-auto max-h-[320px] whitespace-pre-wrap break-all">{result.payloadJson}</pre>
            </Pane>
          </div>
          {result.times.length > 0 && (
            <Pane title="Thời gian">
              <table className="w-full text-xs">
                <tbody>
                  {result.times.map((t) => (
                    <tr key={t.claim} className="border-t border-slate-100 first:border-t-0">
                      <td className="px-3 py-1.5 font-semibold text-slate-700 whitespace-nowrap">{t.label}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-800 break-all">{fmt(t.iso)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Pane>
          )}
          <Pane title="Chữ ký (chưa xác minh)" right={<CopyButton text={result.signature} />}>
            <div className="p-3 text-xs font-mono text-slate-600 break-all">{result.signature || '(trống)'}</div>
          </Pane>
        </>
      )}
    </div>
  );
}

/* ---------- Hash ---------- */

type HashResult = Record<HashAlgo, string> | null;

function HashRows({ result, busy }: { result: HashResult; busy: boolean }) {
  return (
    <div className={`${cardCls}`}>
      {HASH_ALGOS.map((a) => (
        <div key={a} className="flex items-center gap-2 px-3 py-2 border-t border-slate-100 first:border-t-0">
          <span className="w-16 shrink-0 text-xs font-bold text-slate-700">{a}</span>
          <code className="flex-1 min-w-0 text-xs font-mono text-slate-800 break-all">
            {busy ? '...' : result?.[a] ?? ''}
          </code>
          <CopyButton text={result?.[a] ?? ''} />
        </div>
      ))}
    </div>
  );
}

function HashTab({ initial, onShare }: TabProps) {
  const { showToast } = useApp();
  const [text, setText] = useState(initial.t ?? 'abc');
  useEffect(() => {
    onShare({ t: text });
  }, [text, onShare]);
  const [textHash, setTextHash] = useState<HashResult>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [fileHash, setFileHash] = useState<HashResult>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    hashAll(new TextEncoder().encode(text)).then((r) => {
      if (!cancelled) setTextHash(r);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  const loadFile = async (f: File) => {
    if (f.size > MAX_HASH_FILE_SIZE) {
      showToast(`File "${f.name}" quá lớn (tối đa ${MAX_HASH_FILE_SIZE / 1024 / 1024} MB).`);
      return;
    }
    const seq = ++fileSeq.current;
    setFile({ name: f.name, size: f.size });
    setFileHash(null);
    setFileBusy(true);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const r = await hashAll(buf);
      if (seq === fileSeq.current) setFileHash(r);
    } catch {
      showToast('Không đọc hoặc băm được file này.');
    } finally {
      if (seq === fileSeq.current) setFileBusy(false);
    }
  };

  const fmtSize = (n: number) =>
    n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;

  return (
    <div className="space-y-3.5">
      <Pane
        title="Băm văn bản (UTF-8)"
        right={
          <button onClick={() => setText('')} title="Xóa" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
            <Trash2 className="h-4 w-4" />
          </button>
        }
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder="Nhập văn bản cần băm..."
          className={`${taCls} min-h-[90px]`}
        />
      </Pane>
      <HashRows result={textHash} busy={false} />

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
        className={`rounded-xl border-2 border-dashed px-4 py-5 flex flex-wrap items-center justify-between gap-3 transition ${
          dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'
        }`}
      >
        <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
          <FileText className="h-5 w-5 text-slate-400 shrink-0" />
          <span className="min-w-0 break-all">
            {file ? (
              <>
                <strong className="text-slate-800">{file.name}</strong> · {fmtSize(file.size)}
              </>
            ) : (
              <>Kéo-thả file vào đây để tính hash (tối đa {MAX_HASH_FILE_SIZE / 1024 / 1024} MB, đọc cục bộ, không tải lên)</>
            )}
          </span>
        </div>
        <button onClick={() => inputRef.current?.click()} className={btnPrimary}>
          <Upload className="h-3.5 w-3.5" />
          Chọn file
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {file && <HashRows result={fileHash} busy={fileBusy} />}
      <p className="text-[11px] text-slate-400">
        MD5 và SHA-1 đã bị phá vỡ về mặt mật mã, chỉ nên dùng để kiểm tra toàn vẹn thông thường, không dùng cho bảo mật.
      </p>
    </div>
  );
}

/* ---------- Generators ---------- */

function GeneratorTab() {
  const { showToast } = useApp();
  const [count, setCount] = useState(5);
  const [uuids, setUuids] = useState<string[]>(() => generateUuids(5));
  const [opts, setOpts] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [password, setPassword] = useState(() => generatePassword(DEFAULT_PASSWORD_OPTIONS));

  const genPassword = (o: PasswordOptions = opts) => {
    try {
      setPassword(generatePassword(o));
    } catch (e) {
      setPassword('');
      showToast(e instanceof Error ? e.message : 'Không tạo được mật khẩu.');
    }
  };

  const update = (patch: Partial<PasswordOptions>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    genPassword(next);
  };

  const download = () => {
    const blob = new Blob([uuids.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'uuids.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const bits = passwordEntropyBits(opts);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
      <Pane
        title="UUID v4"
        right={
          <>
            <button onClick={download} disabled={!uuids.length} title="Tải về .txt" className="p-1.5 text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg transition disabled:opacity-40">
              <Download className="h-3.5 w-3.5" />
            </button>
            <CopyButton text={uuids.join('\n')} label="Chép tất cả" />
          </>
        }
      >
        <div className="px-3 py-2 bg-indigo-50/70 border-b border-indigo-100 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 font-medium text-slate-700">
            Số lượng
            <input
              type="number"
              min={1}
              max={1000}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
              className="w-20 px-2 py-0.5 rounded-md border border-slate-300 bg-white text-xs"
            />
          </label>
          <button onClick={() => setUuids(generateUuids(count))} className={btnPrimary}>
            <RefreshCw className="h-3.5 w-3.5" />
            Tạo UUID
          </button>
        </div>
        <textarea readOnly value={uuids.join('\n')} spellCheck={false} className={`${taCls} min-h-[220px]`} />
      </Pane>

      <Pane title="Mật khẩu ngẫu nhiên" right={<CopyButton text={password} />}>
        <div className="p-3 border-b border-slate-100">
          <div className="font-mono text-sm break-all text-slate-900 bg-slate-50 rounded-lg border border-slate-200 px-3 py-2 min-h-[42px]">
            {password}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500">
            Độ mạnh ước tính: ~{bits} bit entropy
            {bits < 60 ? ' (yếu)' : bits < 100 ? ' (khá)' : ' (mạnh)'}
          </div>
        </div>
        <div className="px-3 py-3 space-y-3 text-xs">
          <label className="flex items-center gap-3 font-medium text-slate-700">
            <span className="w-20">Độ dài: {opts.length}</span>
            <input
              type="range"
              min={4}
              max={128}
              value={opts.length}
              onChange={(e) => update({ length: Number(e.target.value) })}
              className="flex-1 accent-indigo-600"
            />
          </label>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {(
              [
                ['lower', 'Chữ thường (a-z)'],
                ['upper', 'Chữ hoa (A-Z)'],
                ['digits', 'Chữ số (0-9)'],
                ['symbols', 'Ký hiệu (!@#...)'],
                ['excludeAmbiguous', 'Loại ký tự dễ nhầm (Il1O0o)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium">
                <input type="checkbox" checked={opts[key]} onChange={() => update({ [key]: !opts[key] })} className={checkCls} />
                {label}
              </label>
            ))}
          </div>
          <button onClick={() => genPassword()} className={btnPrimary}>
            <RefreshCw className="h-3.5 w-3.5" />
            Tạo mật khẩu mới
          </button>
        </div>
      </Pane>
    </div>
  );
}

/* ---------- Page ---------- */

export default function EncodePage() {
  const [tab, setTab] = useState<TabId>('base64');
  // Trạng thái khôi phục từ link chia sẻ; null cho tới khi đọc xong (tránh lệch hydration)
  const [initial, setInitial] = useState<Initial | null>(null);
  const [share, setShare] = useState<ShareState>({ t: '' });

  useEffect(() => {
    const q = readShareParams();
    const rawTab = q.get('tab');
    const t = TABS.find((x) => x.id === rawTab)?.id ?? 'base64';
    const text = q.get('t');
    /* eslint-disable react-hooks/set-state-in-effect */
    setTab(t);
    setInitial({ tab: t, t: text !== null && t !== 'gen' ? text.slice(0, 500_000) : null, d: q.get('d') });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const changeTab = (id: TabId) => {
    setTab(id);
    setShare({ t: '' });
    // Sau lần đầu, chuyển tab dùng giá trị mặc định
    setInitial({ tab: id, t: null, d: null });
  };
  const shareParams: Record<string, string | undefined> = { tab };
  if (tab !== 'gen') {
    shareParams.t = share.t;
    if (share.d === 'decode') shareParams.d = 'decode';
  }

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Binary className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Mã hóa / Giải mã</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Base64, URL, HTML entities, JWT, hash và bộ tạo UUID / mật khẩu. Mọi thứ xử lý ngay trên trình duyệt, không gửi dữ liệu đi đâu.
            </p>
          </div>
        </div>
        <ShareLinkButton
          params={shareParams}
          className="ml-auto px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
        />
      </div>

      <div role="tablist" className="flex flex-wrap gap-1 bg-slate-200/70 p-1 rounded-xl w-fit max-w-full">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => changeTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              tab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {initial && tab === 'base64' && <Base64Tab initial={initial} onShare={setShare} />}
      {initial && tab === 'url' && <UrlTab initial={initial} onShare={setShare} />}
      {initial && tab === 'html' && <HtmlTab initial={initial} onShare={setShare} />}
      {initial && tab === 'jwt' && <JwtTab initial={initial} onShare={setShare} />}
      {initial && tab === 'hash' && <HashTab initial={initial} onShare={setShare} />}
      {initial && tab === 'gen' && <GeneratorTab />}
    </div>
  );
}
