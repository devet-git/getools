'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  FileCog,
  Copy,
  Check,
  Download,
  Trash2,
  Sparkles,
  AlertTriangle,
  AlertCircle,
  Info,
  Eye,
  EyeOff,
  ShieldAlert,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  convertEnv,
  DEFAULT_CONVERT,
  diffDotenv,
  EnvPair,
  ExampleMode,
  formatEnvOutput,
  generateExample,
  InFormat,
  IN_FORMATS,
  isSecretKey,
  lintDotenv,
  maskValue,
  OutFormat,
  OUT_FORMATS,
  parseDotenv,
  resolveInterpolation,
  SAMPLE_ENV,
  sortDotenv,
} from '@/lib/env-tools';

type Tab = 'convert' | 'lint' | 'diff' | 'example' | 'resolve';

const TABS: { id: Tab; label: string }[] = [
  { id: 'convert', label: 'Chuyển đổi' },
  { id: 'lint', label: 'Kiểm tra (lint)' },
  { id: 'diff', label: 'So sánh 2 file' },
  { id: 'example', label: '.env.example' },
  { id: 'resolve', label: 'Giải nội suy ${VAR}' },
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
      />
      {label}
    </label>
  );
}

const selectCls =
  'text-xs font-medium bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-800 focus:border-indigo-500 outline-hidden';
const inputCls =
  'text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-800 focus:border-indigo-500 outline-hidden w-32';

function Editor({
  title,
  value,
  onChange,
  onClear,
  placeholder,
  height = 'h-[380px]',
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onClear?: () => void;
  placeholder?: string;
  height?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col overflow-hidden ${height}`}>
      <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">{title}</span>
        {onClear && (
          <button
            onClick={onClear}
            title="Xóa nội dung"
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        aria-label={title}
        placeholder={placeholder}
        className="flex-1 w-full p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-none leading-relaxed text-slate-800 whitespace-pre"
      />
      <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
        <span>{value ? value.split(/\r\n|\r|\n/).length : 0} dòng</span>
        <span>{value.length} ký tự</span>
      </div>
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-xl px-3 py-2 space-y-1">
      {items.map((w, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-slate-700">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          {w}
        </div>
      ))}
    </div>
  );
}

export default function EnvToolsPage() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<Tab>('convert');
  const [input, setInput] = useState(SAMPLE_ENV);
  const [inputB, setInputB] = useState('');
  const [from, setFrom] = useState<InFormat>('auto');
  const [to, setTo] = useState<OutFormat>('json');
  const [name, setName] = useState(DEFAULT_CONVERT.name);
  const [namespace, setNamespace] = useState('');
  const [sort, setSort] = useState(false);
  const [inferTypes, setInferTypes] = useState(false);
  const [exportPrefix, setExportPrefix] = useState(false);
  const [dockerOneLine, setDockerOneLine] = useState(false);
  const [maskPreview, setMaskPreview] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [exMode, setExMode] = useState<ExampleMode>('placeholder');
  const [exComments, setExComments] = useState(true);
  const [exSort, setExSort] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const q = readShareParams();
    /* eslint-disable react-hooks/set-state-in-effect */
    const f = q.get('from');
    const t = q.get('to');
    const tb = q.get('tab');
    if (f && IN_FORMATS.some((x) => x.id === f)) setFrom(f as InFormat);
    if (t && OUT_FORMATS.some((x) => x.id === t)) setTo(t as OutFormat);
    if (tb && TABS.some((x) => x.id === tb)) setTab(tb as Tab);
    const n = q.get('name');
    if (n) setName(n.slice(0, 80));
    const ns = q.get('ns');
    if (ns) setNamespace(ns.slice(0, 80));
    if (q.get('sort') === '1') setSort(true);
    if (q.get('infer') === '1') setInferTypes(true);
    if (q.get('exp') === '1') setExportPrefix(true);
    if (q.get('mask') === '0') setMaskPreview(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const deferred = useDeferredValue(input);
  const deferredB = useDeferredValue(inputB);
  const pending = deferred !== input;

  const opts = useMemo(
    () => ({ ...DEFAULT_CONVERT, from, to, name, namespace, sort, inferTypes, exportPrefix, dockerOneLine }),
    [from, to, name, namespace, sort, inferTypes, exportPrefix, dockerOneLine]
  );

  const conv = useMemo(() => (tab === 'convert' ? convertEnv(deferred, opts) : null), [tab, deferred, opts]);

  const maskedOutput = useMemo(() => {
    if (!conv || !conv.ok) return '';
    const masked: EnvPair[] = conv.pairs.map((p) => (isSecretKey(p.key) && p.value ? { ...p, value: '********' } : p));
    return formatEnvOutput(masked, opts).output;
  }, [conv, opts]);

  const secretCount = conv?.pairs.filter((p) => isSecretKey(p.key) && p.value).length ?? 0;
  const shownOutput = conv?.ok ? (maskPreview && secretCount > 0 ? maskedOutput : conv.output) : '';

  const lint = useMemo(() => (tab === 'lint' ? lintDotenv(deferred) : []), [tab, deferred]);
  const diff = useMemo(() => (tab === 'diff' ? diffDotenv(deferred, deferredB) : []), [tab, deferred, deferredB]);
  const example = useMemo(
    () => (tab === 'example' ? generateExample(deferred, { mode: exMode, keepComments: exComments, sort: exSort }) : ''),
    [tab, deferred, exMode, exComments, exSort]
  );
  const resolved = useMemo(
    () => (tab === 'resolve' ? resolveInterpolation(parseDotenv(deferred).entries.map((e) => ({ key: e.key!, value: e.value ?? '', quote: e.quote }))) : []),
    [tab, deferred]
  );

  const copy = async (text: string, id: string, msg = 'Đã sao chép!') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      showToast(msg);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const download = (text: string, filename: string) => {
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Đã tải xuống ${filename}!`);
  };

  const ext: Record<OutFormat, string> = {
    dotenv: '.env', json: 'env.json', yaml: 'env.yaml', docker: 'env-flags.txt', 'compose-map': 'environment.yaml',
    'compose-list': 'environment.yaml', 'k8s-configmap': 'configmap.yaml', 'k8s-secret-string': 'secret.yaml',
    'k8s-secret-data': 'secret.yaml', shell: 'env.sh', cmd: 'env.bat', powershell: 'env.ps1',
  };

  const show = (v: string, key: string) => (reveal || !isSecretKey(key) ? v : maskValue(v));

  const copyBtn = (text: string, id: string, label = 'Sao chép') => (
    <button
      onClick={() => copy(text, id)}
      disabled={!text}
      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white shadow-xs transition flex items-center gap-1"
    >
      {copied === id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === id ? 'Đã chép!' : label}
    </button>
  );

  const revealBtn = () => (
    <button
      onClick={() => setReveal(!reveal)}
      className="px-2 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1"
    >
      {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      {reveal ? 'Ẩn giá trị bí mật' : 'Hiện giá trị bí mật'}
    </button>
  );

  const levelIcon = (l: 'error' | 'warn' | 'info') =>
    l === 'error' ? (
      <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
    ) : l === 'warn' ? (
      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
    ) : (
      <Info className="h-3.5 w-3.5 text-indigo-400 shrink-0 mt-0.5" />
    );

  const diffStats = {
    added: diff.filter((d) => d.status === 'added').length,
    removed: diff.filter((d) => d.status === 'removed').length,
    changed: diff.filter((d) => d.status === 'changed').length,
    same: diff.filter((d) => d.status === 'same').length,
  };

  return (
    <div className="space-y-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <FileCog className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">.env &amp; Config</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Đổi qua lại giữa .env, JSON, YAML, cờ docker -e, Compose, Kubernetes ConfigMap/Secret, shell, CMD, PowerShell. Kiểm tra, so sánh, tạo .env.example. Xử lý ngay trên trình duyệt.
            </p>
          </div>
        </div>
        <button
          onClick={() => setInput(SAMPLE_ENV)}
          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
        >
          <Sparkles className="h-3 w-3 text-amber-400" />
          Dùng mẫu thử
        </button>
      </div>

      {/* TABS */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap bg-slate-200/80 p-0.5 rounded-lg text-xs">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                tab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-slate-500 hidden md:inline">Link chỉ lưu tùy chọn, không chứa nội dung .env.</span>
          <ShareLinkButton
            params={{
              tab: tab === 'convert' ? undefined : tab,
              from: from === 'auto' ? undefined : from,
              to,
              name: name === DEFAULT_CONVERT.name ? undefined : name,
              ns: namespace || undefined,
              sort: sort ? '1' : undefined,
              infer: inferTypes ? '1' : undefined,
              exp: exportPrefix ? '1' : undefined,
              mask: maskPreview ? undefined : '0',
            }}
          />
        </div>
      </div>

      {/* ===== CONVERT ===== */}
      {tab === 'convert' && (
        <>
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              Từ
              <select value={from} onChange={(e) => setFrom(e.target.value as InFormat)} className={selectCls}>
                {IN_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              Sang
              <select value={to} onChange={(e) => setTo(e.target.value as OutFormat)} className={selectCls}>
                {OUT_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            {to.startsWith('k8s') && (
              <>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  Tên
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </label>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  Namespace
                  <input value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="(tùy chọn)" className={inputCls} />
                </label>
              </>
            )}
            <Toggle checked={sort} onChange={setSort} label="Sắp xếp khóa A→Z" />
            {(to === 'json' || to === 'yaml') && <Toggle checked={inferTypes} onChange={setInferTypes} label="Suy luận kiểu (số/boolean)" />}
            {to === 'dotenv' && <Toggle checked={exportPrefix} onChange={setExportPrefix} label='Thêm "export"' />}
            {to === 'docker' && <Toggle checked={dockerOneLine} onChange={setDockerOneLine} label="Một dòng" />}
            <Toggle checked={maskPreview} onChange={setMaskPreview} label="Che bí mật trong xem trước" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            <Editor
              title={`Đầu vào${conv?.detected && from === 'auto' ? ` (nhận diện: ${IN_FORMATS.find((f) => f.id === conv.detected)?.label})` : ''}`}
              value={input}
              onChange={setInput}
              onClear={() => setInput('')}
              placeholder="Dán nội dung .env, JSON, YAML, lệnh docker run, ConfigMap/Secret..."
              height="h-[420px]"
            />
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col overflow-hidden h-[420px]">
              <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  Kết quả
                  {conv?.ok && conv.pairs.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 normal-case font-semibold">{conv.pairs.length} biến</span>
                  )}
                  {secretCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 normal-case font-semibold flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3" />
                      {secretCount} bí mật
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1.5">
                  {copyBtn(conv?.ok ? conv.output : '', 'out')}
                  <button
                    onClick={() => download(conv?.output ?? '', ext[to])}
                    disabled={!conv?.output}
                    title={`Tải ${ext[to]}`}
                    className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg transition disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {conv && !conv.ok ? (
                <div className="flex-1 p-4 text-sm text-red-700 bg-red-50/60 overflow-auto">
                  <div className="font-semibold mb-1">Không chuyển đổi được</div>
                  {conv.error}
                </div>
              ) : !shownOutput ? (
                <div className="flex-1 flex items-center justify-center p-6 text-sm text-slate-400 text-center">
                  {input.trim() ? 'Không có biến nào trong đầu vào.' : 'Nhập nội dung ở bên trái để xem kết quả.'}
                </div>
              ) : (
                <pre className="flex-1 overflow-auto p-3 text-xs font-mono bg-slate-900 text-slate-100 leading-relaxed whitespace-pre">{shownOutput}</pre>
              )}
              <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
                <span>{maskPreview && secretCount > 0 ? 'Xem trước đã che giá trị bí mật; nút Sao chép lấy giá trị thật.' : ' '}</span>
                <span>{pending ? 'Đang xử lý…' : ''}</span>
              </div>
            </div>
          </div>
          <Warnings items={conv?.warnings ?? []} />
        </>
      )}

      {/* ===== LINT ===== */}
      {tab === 'lint' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Editor title="Nội dung .env" value={input} onChange={setInput} onClear={() => setInput('')} placeholder="Dán nội dung .env để kiểm tra..." height="h-[420px]" />
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col overflow-hidden h-[420px]">
            <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 text-xs font-bold text-slate-800 uppercase tracking-wider flex flex-wrap items-center gap-2">
              Kết quả kiểm tra
              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 normal-case">{lint.filter((l) => l.level === 'error').length} lỗi</span>
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 normal-case">{lint.filter((l) => l.level === 'warn').length} cảnh báo</span>
              <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 normal-case">{lint.filter((l) => l.level === 'info').length} gợi ý</span>
            </div>
            {!input.trim() ? (
              <div className="flex-1 flex items-center justify-center p-6 text-sm text-slate-400">Nhập nội dung .env để kiểm tra.</div>
            ) : lint.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-6 text-sm text-emerald-700 bg-emerald-50/60">✓ Không phát hiện vấn đề nào.</div>
            ) : (
              <ul className="flex-1 overflow-auto p-3 space-y-1.5">
                {lint.map((l, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    {levelIcon(l.level)}
                    <span className="text-slate-700">
                      <span className="font-mono text-slate-400 mr-1.5">dòng {l.line}</span>
                      {l.key && <span className="font-mono font-semibold text-slate-900 mr-1.5">{l.key}</span>}
                      {l.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ===== DIFF ===== */}
      {tab === 'diff' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            <Editor title="File A (gốc)" value={input} onChange={setInput} onClear={() => setInput('')} placeholder="Dán .env gốc..." height="h-[260px]" />
            <Editor title="File B (mới)" value={inputB} onChange={setInputB} onClear={() => setInputB('')} placeholder="Dán .env mới..." height="h-[260px]" />
          </div>
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="p-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold text-slate-800 uppercase tracking-wider">Khác biệt</span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">+{diffStats.added} thêm</span>
                <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">−{diffStats.removed} xóa</span>
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">~{diffStats.changed} đổi</span>
                <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">{diffStats.same} giống</span>
              </div>
              {revealBtn()}
            </div>
            {diff.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">Nhập nội dung ở cả hai bên để so sánh.</div>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-xs font-mono border-collapse">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500 text-left">
                    <tr>
                      <th className="px-3 py-1.5 w-8"></th>
                      <th className="px-3 py-1.5">Khóa</th>
                      <th className="px-3 py-1.5">A</th>
                      <th className="px-3 py-1.5">B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.map((d) => (
                      <tr
                        key={d.key}
                        className={
                          d.status === 'added'
                            ? 'bg-emerald-50'
                            : d.status === 'removed'
                              ? 'bg-red-50'
                              : d.status === 'changed'
                                ? 'bg-amber-50'
                                : ''
                        }
                      >
                        <td className="px-3 py-1 text-center font-bold text-slate-500">
                          {d.status === 'added' ? '+' : d.status === 'removed' ? '−' : d.status === 'changed' ? '~' : ''}
                        </td>
                        <td className="px-3 py-1 text-slate-900 font-semibold break-all">{d.key}</td>
                        <td className="px-3 py-1 text-slate-700 break-all whitespace-pre-wrap">{d.a !== undefined ? show(d.a, d.key) : ''}</td>
                        <td className="px-3 py-1 text-slate-700 break-all whitespace-pre-wrap">{d.b !== undefined ? show(d.b, d.key) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== EXAMPLE ===== */}
      {tab === 'example' && (
        <>
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              Giá trị
              <select value={exMode} onChange={(e) => setExMode(e.target.value as ExampleMode)} className={selectCls}>
                <option value="placeholder">Bí mật → your_ten_bien, giữ giá trị thường</option>
                <option value="keep">Giữ giá trị thường, bí mật để trống</option>
                <option value="empty">Để trống tất cả</option>
              </select>
            </label>
            <Toggle checked={exComments} onChange={setExComments} label="Giữ comment & dòng trống" />
            <Toggle checked={exSort} onChange={setExSort} label="Sắp xếp khóa A→Z" />
            <button
              onClick={() => {
                setInput(sortDotenv(input));
                showToast('Đã sắp xếp khóa trong .env gốc!');
              }}
              className="px-2 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg"
            >
              Sắp xếp .env gốc (giữ comment)
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            <Editor title="File .env gốc" value={input} onChange={setInput} onClear={() => setInput('')} height="h-[420px]" />
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col overflow-hidden h-[420px]">
              <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">.env.example</span>
                <div className="flex items-center gap-1.5">
                  {copyBtn(example, 'ex')}
                  <button
                    onClick={() => download(example, '.env.example')}
                    disabled={!example}
                    title="Tải .env.example"
                    className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg transition disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {example ? (
                <pre className="flex-1 overflow-auto p-3 text-xs font-mono bg-slate-900 text-slate-100 leading-relaxed whitespace-pre">{example}</pre>
              ) : (
                <div className="flex-1 flex items-center justify-center p-6 text-sm text-slate-400">Nhập .env ở bên trái để tạo file mẫu.</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ===== RESOLVE ===== */}
      {tab === 'resolve' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Editor title="Nội dung .env" value={input} onChange={setInput} onClear={() => setInput('')} height="h-[420px]" />
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col overflow-hidden h-[420px]">
            <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Giá trị sau khi nội suy</span>
              {revealBtn()}
            </div>
            {resolved.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-6 text-sm text-slate-400">Nhập .env có dùng ${'{VAR}'} hoặc $VAR để xem kết quả.</div>
            ) : (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs font-mono border-collapse">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500 text-left">
                    <tr>
                      <th className="px-3 py-1.5">Khóa</th>
                      <th className="px-3 py-1.5">Gốc → Đã giải</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolved.map((r) => {
                      const changed = r.raw !== r.resolved;
                      return (
                        <tr key={r.key} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-1.5 text-slate-900 font-semibold break-all">{r.key}</td>
                          <td className="px-3 py-1.5 break-all whitespace-pre-wrap">
                            {changed ? (
                              <>
                                <div className="text-slate-400">{show(r.raw, r.key)}</div>
                                <div className="text-emerald-700">→ {show(r.resolved, r.key)}</div>
                              </>
                            ) : (
                              <div className="text-slate-700">{show(r.raw, r.key)}</div>
                            )}
                            {r.noInterpolation && <div className="text-[10px] text-slate-400">nháy đơn: không nội suy</div>}
                            {r.missing.length > 0 && (
                              <div className="text-[10px] text-amber-600">chưa định nghĩa: {r.missing.join(', ')}</div>
                            )}
                            {r.cyclic && <div className="text-[10px] text-red-600">tham chiếu vòng</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-500 px-1 leading-relaxed">
        <b>Mẹo:</b> các biến có tên chứa KEY / SECRET / TOKEN / PASSWORD được coi là bí mật và bị che trong phần xem trước. Nội dung .env chỉ được xử lý trên trình duyệt của bạn
        và không bao giờ được đưa vào link chia sẻ. Base64 của Kubernetes Secret chỉ là mã hóa, không phải bảo mật.
      </p>
    </div>
  );
}
