'use client';

import { useEffect, useMemo, useState } from 'react';
import { Globe, Copy, Check, Plus, Trash2, ArrowUp, ArrowDown, CopyPlus, Sparkles, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  ArrayStyle,
  BatchSort,
  DEFAULT_NORMALIZE,
  EMPTY_UTM,
  EncodeMode,
  NormalizeOptions,
  QueryParam,
  RawParts,
  UtmFields,
  analyzeBatch,
  assembleUrl,
  batchToCsv,
  buildQuery,
  buildUtmUrl,
  dedupeAndSort,
  detectValue,
  flattenArrayKeys,
  hostForms,
  inspectPercent,
  joinUserinfo,
  normalizeUrl,
  parseQuery,
  parseUrl,
  pathToSegments,
  resolveRelative,
  safeDecode,
  segmentsToPath,
  splitUrl,
  splitUserinfo,
  splitQueryRaw,
} from '@/lib/url-tools';

const SAMPLE =
  'https://user:p%40ss@bücher.example:8443/san-pham/áo thun/../giày?utm_source=fb&utm_medium=cpc&tag=a&tag=b&q=xin%20ch%C3%A0o+b%E1%BA%A1n&token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJleHAiOjE5MDAwMDAwMDB9.sig&ts=1700000000&next=https%3A%2F%2Fa.com%2Fx%3Fy%3D1&cfg=%7B%22a%22%3A1%7D&fbclid=IwAR0#phan-2?x=1';

const TABS = [
  { id: 'parse', label: 'Phân tích' },
  { id: 'query', label: 'Query' },
  { id: 'percent', label: 'Mã hóa %' },
  { id: 'normalize', label: 'Chuẩn hóa' },
  { id: 'utm', label: 'UTM' },
  { id: 'resolve', label: 'Giải URL tương đối' },
  { id: 'batch', label: 'Hàng loạt' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const inputCls =
  'w-full px-2 py-1 text-xs font-mono rounded-md border border-slate-200 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400';
const btnCls =
  'px-2 py-1 rounded-md text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition inline-flex items-center gap-1 disabled:opacity-40';
const iconBtn = 'p-1 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 disabled:opacity-30 transition';
const panel = 'bg-white border border-slate-200 rounded-xl shadow-xs';

function CopyBtn({ text, label = 'Sao chép' }: { text: string; label?: string }) {
  const { showToast } = useApp();
  const [done, setDone] = useState(false);
  return (
    <button
      className={btnCls}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
        }
      }}
    >
      {done ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {label}
    </button>
  );
}

function Check2({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-indigo-600" />
      {children}
    </label>
  );
}

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <tr className="border-t border-slate-100 align-top">
      <th className="text-left text-xs font-semibold text-slate-600 py-2 pr-3 pl-3 w-32 whitespace-nowrap">{label}</th>
      <td className="py-1.5 pr-3">
        {children}
        {hint && <div className="text-[11px] text-slate-500 mt-1 leading-snug">{hint}</div>}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */

function InsightChips({ value, onApply, onOpenUrl }: { value: string; onApply: (v: string) => void; onOpenUrl: (v: string) => void }) {
  const insights = useMemo(() => detectValue(value), [value]);
  const [open, setOpen] = useState<number | null>(null);
  if (!insights.length) return null;
  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap gap-1">
        {insights.map((ins, i) => (
          <button
            key={ins.kind}
            onClick={() => setOpen(open === i ? null : i)}
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 inline-flex items-center gap-0.5"
          >
            {open === i ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
            {ins.label}
          </button>
        ))}
      </div>
      {open !== null && insights[open] && (
        <div className="rounded-md bg-slate-50 border border-slate-200 p-2">
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto text-slate-800">{insights[open].decoded}</pre>
          <div className="flex gap-1 mt-1.5">
            <CopyBtn text={insights[open].decoded} />
            {(insights[open].kind === 'percent' || insights[open].kind === 'base64') && (
              <button className={btnCls} onClick={() => onApply(insights[open].decoded)}>Thay giá trị bằng bản giải mã</button>
            )}
            {insights[open].kind === 'url' && (
              <button className={btnCls} onClick={() => onOpenUrl(insights[open].decoded)}>Phân tích URL này</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function UrlToolsPage() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<TabId>('parse');
  const [input, setInput] = useState('');
  const [base, setBase] = useState('');
  // query
  const [decodeView, setDecodeView] = useState(true);
  const [encMode, setEncMode] = useState<EncodeMode>('percent');
  const [arrStyle, setArrStyle] = useState<ArrayStyle>('brackets');
  // normalize
  const [norm, setNorm] = useState<NormalizeOptions>(DEFAULT_NORMALIZE);
  // percent
  const [pctText, setPctText] = useState('');
  // utm
  const [utmBase, setUtmBase] = useState('');
  const [utm, setUtm] = useState<UtmFields>(EMPTY_UTM);
  // resolve
  const [resBase, setResBase] = useState('https://example.com/a/b/c?x=1');
  const [resRel, setResRel] = useState('../d/e.html?y=2#top');
  // batch
  const [batchText, setBatchText] = useState('');
  const [dedupe, setDedupe] = useState(true);
  const [sort, setSort] = useState<BatchSort>('none');

  useEffect(() => {
    const u = readShareParams().get('u');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (u) setInput(u.slice(0, 5000));
  }, []);

  const parsed = useMemo(() => parseUrl(input, base), [input, base]);
  const raw: RawParts | null = useMemo(() => splitUrl(input), [input]);
  const params: QueryParam[] = useMemo(
    () => (raw && raw.query !== null ? parseQuery(raw.query, { decode: decodeView, plus: true }) : []),
    [raw, decodeView]
  );

  const patch = (p: Partial<RawParts>) => {
    if (!raw) return;
    setInput(assembleUrl({ ...raw, ...p }));
  };
  const writeParams = (list: QueryParam[], style: ArrayStyle = 'repeat') => {
    if (!raw) return;
    const q = buildQuery(list, { mode: decodeView ? encMode : 'none', style });
    patch({ query: q === '' && list.length === 0 ? null : q });
  };
  const updateParam = (i: number, p: Partial<QueryParam>) => writeParams(params.map((x, j) => (j === i ? { ...x, ...p, noEq: false } : x)));
  const moveParam = (i: number, d: number) => {
    const l = [...params];
    const [x] = l.splice(i, 1);
    l.splice(i + d, 0, x);
    writeParams(l);
  };

  const normResult = useMemo(() => (input.trim() ? normalizeUrl(input, norm) : null), [input, norm]);
  const pct = useMemo(() => inspectPercent(pctText), [pctText]);
  const utmResult = useMemo(() => (utmBase.trim() ? buildUtmUrl(utmBase, utm) : null), [utmBase, utm]);
  const resResult = useMemo(() => resolveRelative(resBase, resRel), [resBase, resRel]);
  const batch = useMemo(() => analyzeBatch(batchText, norm), [batchText, norm]);
  const batchRows = useMemo(() => dedupeAndSort(batch.rows, dedupe, sort), [batch, dedupe, sort]);

  const downloadCsv = () => {
    const blob = new Blob(['﻿' + batchToCsv(batchRows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'urls.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const setNormOpt = <K extends keyof NormalizeOptions>(k: K, v: NormalizeOptions[K]) => setNorm((n) => ({ ...n, [k]: v }));

  const NormOptions = (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      <Check2 checked={norm.removeDefaultPort} onChange={(v) => setNormOpt('removeDefaultPort', v)}>Bỏ cổng mặc định</Check2>
      <Check2 checked={norm.sortParams} onChange={(v) => setNormOpt('sortParams', v)}>Sắp xếp tham số</Check2>
      <Check2 checked={norm.stripTracking} onChange={(v) => setNormOpt('stripTracking', v)}>Bỏ tham số theo dõi (utm_*, fbclid, gclid...)</Check2>
      <Check2 checked={norm.removeEmptyParams} onChange={(v) => setNormOpt('removeEmptyParams', v)}>Bỏ tham số rỗng</Check2>
      <Check2 checked={norm.removeFragment} onChange={(v) => setNormOpt('removeFragment', v)}>Bỏ #fragment</Check2>
      <Check2 checked={norm.stripWww} onChange={(v) => setNormOpt('stripWww', v)}>Bỏ www.</Check2>
      <Check2 checked={norm.forceHttps} onChange={(v) => setNormOpt('forceHttps', v)}>http thành https</Check2>
      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
        Dấu / cuối:
        <select className={inputCls + ' w-auto'} value={norm.trailingSlash} onChange={(e) => setNormOpt('trailingSlash', e.target.value as NormalizeOptions['trailingSlash'])}>
          <option value="keep">Giữ nguyên</option>
          <option value="remove">Bỏ</option>
          <option value="add">Thêm</option>
        </select>
      </label>
    </div>
  );

  const userParts = raw ? splitUserinfo(raw.userinfo) : { user: '', pass: null };
  const segs = raw ? pathToSegments(raw.path) : [];
  const forms = raw ? hostForms(raw.host) : null;

  return (
    <div className="space-y-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Globe className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">URL Parser & Query Builder</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Phân tích, sửa từng phần, dựng query, chuẩn hóa và gắn UTM. Chạy hoàn toàn trên trình duyệt, không mở liên kết nào.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShareLinkButton params={{ u: input.length <= 1500 ? input : '' }} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1" />
          <button
            onClick={() => setInput(SAMPLE)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
          >
            <Sparkles className="h-3 w-3 text-amber-400" />
            Dùng mẫu thử
          </button>
        </div>
      </div>

      {/* INPUT */}
      <div className={panel + ' p-3 space-y-2'}>
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-semibold text-slate-600">URL</label>
          <div className="flex gap-1">
            <CopyBtn text={parsed.ok ? parsed.value.href : input} label="Chép URL chuẩn" />
            <button className={btnCls} onClick={() => setInput('')} disabled={!input}><Trash2 className="h-3 w-3" />Xóa</button>
          </div>
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/[\r\n]+/g, ''))}
          rows={2}
          spellCheck={false}
          placeholder="https://user@host:8080/path?x=1#frag  |  //cdn.com/a.js  |  mailto:a@b.com  |  data:text/plain;base64,...  |  ../x (cần Base URL)"
          className={inputCls + ' resize-y'}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 shrink-0">Base URL (cho URL tương đối)</label>
          <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://example.com/a/b/" className={inputCls} spellCheck={false} />
        </div>
        {input.trim() && !parsed.ok && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">{parsed.error}</div>}
        {parsed.ok && (
          <div className="text-[11px] text-slate-500 break-all">
            {parsed.value.href !== input.trim() && (
              <span>URL chuẩn hóa theo WHATWG: <span className="font-mono text-slate-700">{parsed.value.href}</span></span>
            )}
            {raw?.assumedScheme && <span className="ml-2 text-amber-600">Đã giả định https://</span>}
            {raw?.protocolRelative && <span className="ml-2 text-amber-600">URL protocol-relative: giả định https:</span>}
            {parsed.baseUsed && <span className="ml-2 text-amber-600">Đã giải theo Base URL.</span>}
          </div>
        )}
      </div>

      {/* TABS */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 transition ${tab === t.id ? 'border-indigo-600 text-indigo-700 bg-indigo-50' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* PARSE */}
      {tab === 'parse' && (
        <div className={panel + ' overflow-hidden'}>
          {!raw ? (
            <div className="p-6 text-center text-sm text-slate-500">Nhập một URL ở trên để xem từng thành phần. Sửa bất kỳ ô nào, URL sẽ được dựng lại ngay.</div>
          ) : (
            <table className="w-full">
              <tbody>
                <Row label="Scheme" hint={parsed.ok && parsed.value.summary.length === 0 ? undefined : undefined}>
                  <input className={inputCls} value={raw.scheme} onChange={(e) => patch({ scheme: e.target.value.trim() })} />
                </Row>
                <Row label="Có //authority">
                  <Check2 checked={raw.hasAuthority} onChange={(v) => patch({ hasAuthority: v })}>Có phần authority (userinfo, host, port)</Check2>
                </Row>
                {raw.hasAuthority && (
                  <>
                    <Row label="Userinfo" hint="Thông tin đăng nhập trong URL là rủi ro bảo mật, nên tránh dùng.">
                      <div className="grid grid-cols-2 gap-2">
                        <input className={inputCls} placeholder="user" value={userParts.user} onChange={(e) => patch({ userinfo: joinUserinfo(e.target.value, userParts.pass) })} />
                        <input className={inputCls} placeholder="password" value={userParts.pass ?? ''} onChange={(e) => patch({ userinfo: joinUserinfo(userParts.user, e.target.value) })} />
                      </div>
                    </Row>
                    <Row
                      label="Host"
                      hint={
                        forms && raw.host ? (
                          <span>
                            Unicode: <span className="font-mono text-slate-700">{forms.unicode}</span> | ASCII: <span className="font-mono text-slate-700">{forms.ascii}</span>
                            {forms.isIdn && <span className="ml-1 text-indigo-600">(tên miền quốc tế hóa / punycode)</span>}
                            {parsed.ok && parsed.value.isIPv6 && <span className="ml-1 text-indigo-600">(IPv6)</span>}
                            {parsed.ok && parsed.value.isIPv4 && <span className="ml-1 text-indigo-600">(IPv4)</span>}
                          </span>
                        ) : undefined
                      }
                    >
                      <input className={inputCls} value={raw.host} onChange={(e) => patch({ host: e.target.value.trim() })} />
                    </Row>
                    <Row
                      label="Cổng"
                      hint={
                        parsed.ok
                          ? parsed.value.defaultPort !== null
                            ? `Cổng mặc định của ${parsed.value.protocol}: ${parsed.value.defaultPort}. Cổng hiệu lực: ${parsed.value.effectivePort}${parsed.value.isDefaultPort && raw.port ? ' (trùng mặc định, có thể bỏ)' : ''}.`
                            : `Scheme ${parsed.value.protocol} không có cổng mặc định chuẩn.`
                          : undefined
                      }
                    >
                      <input className={inputCls + ' w-28'} inputMode="numeric" value={raw.port} onChange={(e) => patch({ port: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
                    </Row>
                  </>
                )}
                <Row label="Đường dẫn" hint="Mỗi đoạn sửa riêng; dấu / trong một đoạn sẽ tách thành đoạn mới.">
                  <input className={inputCls + ' mb-1.5'} value={raw.path} onChange={(e) => patch({ path: e.target.value })} />
                  {raw.hasAuthority && (
                    <div className="space-y-1">
                      {segs.map((sg, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 w-5 text-right">{i + 1}</span>
                          <input
                            className={inputCls}
                            value={sg}
                            onChange={(e) => {
                              const l = [...segs];
                              l[i] = e.target.value;
                              patch({ path: segmentsToPath(l.flatMap((x) => x.split('/')), false) });
                            }}
                          />
                          <span className="text-[10px] text-slate-400 shrink-0 hidden sm:inline max-w-40 truncate" title={safeDecode(sg)}>{safeDecode(sg) !== sg ? safeDecode(sg) : ''}</span>
                          <button className={iconBtn} disabled={i === 0} onClick={() => { const l = [...segs]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; patch({ path: segmentsToPath(l) }); }}><ArrowUp className="h-3 w-3" /></button>
                          <button className={iconBtn} disabled={i === segs.length - 1} onClick={() => { const l = [...segs]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; patch({ path: segmentsToPath(l) }); }}><ArrowDown className="h-3 w-3" /></button>
                          <button className={iconBtn} onClick={() => patch({ path: segmentsToPath(segs.filter((_, j) => j !== i), false) })}><Trash2 className="h-3 w-3" /></button>
                        </div>
                      ))}
                      <button className={btnCls} onClick={() => patch({ path: segmentsToPath([...segs, 'moi']) })}><Plus className="h-3 w-3" />Thêm đoạn</button>
                    </div>
                  )}
                </Row>
                <Row label="Query" hint={raw.query === null ? 'Không có query.' : `${params.length} tham số. Sửa chi tiết ở tab Query.`}>
                  <input className={inputCls} value={raw.query ?? ''} onChange={(e) => patch({ query: e.target.value === '' ? null : e.target.value })} />
                </Row>
                <Row label="Fragment" hint="Fragment không bao giờ được gửi tới server; dấu ? trong fragment không phải query.">
                  <input className={inputCls} value={raw.hash ?? ''} onChange={(e) => patch({ hash: e.target.value === '' ? null : e.target.value })} />
                </Row>
                {parsed.ok && (
                  <>
                    <Row label="Origin">
                      <span className="text-xs font-mono text-slate-700 break-all">{parsed.value.origin || '(không có origin)'}</span>
                    </Row>
                    {parsed.value.summary.length > 0 && (
                      <Row label={`Tóm tắt ${parsed.value.protocol}:`}>
                        <dl className="text-xs space-y-0.5">
                          {parsed.value.summary.map((s, i) => (
                            <div key={i} className="flex gap-2">
                              <dt className="text-slate-500 shrink-0">{s.label}:</dt>
                              <dd className="font-mono text-slate-800 break-all whitespace-pre-wrap">{s.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </Row>
                    )}
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* QUERY */}
      {tab === 'query' && (
        <div className="space-y-3">
          {!raw || !raw.hasAuthority && raw.query === null ? (
            <div className={panel + ' p-6 text-center text-sm text-slate-500'}>Nhập URL (có hoặc chưa có query) để chỉnh tham số.</div>
          ) : (
            <>
              <div className={panel + ' p-3 space-y-2'}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <Check2 checked={decodeView} onChange={setDecodeView}>Hiển thị đã giải mã (+ và %XX)</Check2>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                    Mã hóa khi ghi:
                    <select className={inputCls + ' w-auto'} value={encMode} onChange={(e) => setEncMode(e.target.value as EncodeMode)} disabled={!decodeView}>
                      <option value="percent">%20 (RFC 3986)</option>
                      <option value="plus">+ cho khoảng trắng (form)</option>
                      <option value="none">Không mã hóa</option>
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                    Kiểu mảng:
                    <select className={inputCls + ' w-auto'} value={arrStyle} onChange={(e) => setArrStyle(e.target.value as ArrayStyle)}>
                      <option value="repeat">a=1&amp;a=2 (lặp khóa)</option>
                      <option value="brackets">a[]=1&amp;a[]=2</option>
                      <option value="index">a[0]=1&amp;a[1]=2</option>
                      <option value="comma">a=1,2</option>
                    </select>
                  </label>
                  <button className={btnCls} onClick={() => writeParams(params, arrStyle)}>Áp dụng kiểu mảng</button>
                  <button className={btnCls} onClick={() => writeParams(flattenArrayKeys(params))}>Gỡ [] khỏi khóa</button>
                  <button
                    className={btnCls}
                    onClick={() => writeParams(params.flatMap((p) => (p.value.includes(',') ? p.value.split(',').map((v) => ({ key: p.key, value: v })) : [p])))}
                  >
                    Tách giá trị phẩy
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">Khóa lặp lại được giữ nguyên thứ tự. Kiểu mảng chỉ áp cho khóa xuất hiện từ 2 lần.</p>
              </div>

              <div className={panel + ' p-3'}>
                <table className="w-full">
                  <thead>
                    <tr className="text-[11px] text-slate-500 text-left">
                      <th className="w-6">#</th>
                      <th className="w-2/5 pr-2 pb-1">Khóa</th>
                      <th className="pb-1">Giá trị</th>
                      <th className="w-28"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {params.map((p, i) => (
                      <tr key={i} className="align-top border-t border-slate-100">
                        <td className="text-[10px] text-slate-400 pt-2.5">{i + 1}</td>
                        <td className="py-1 pr-2">
                          <input className={inputCls} value={p.key} onChange={(e) => updateParam(i, { key: e.target.value })} />
                        </td>
                        <td className="py-1 pr-2">
                          <input className={inputCls} value={p.value} onChange={(e) => updateParam(i, { value: e.target.value })} />
                          <InsightChips
                            value={p.value}
                            onApply={(v) => updateParam(i, { value: v })}
                            onOpenUrl={(v) => { setInput(v); setTab('parse'); }}
                          />
                        </td>
                        <td className="py-1 whitespace-nowrap">
                          <button className={iconBtn} title="Lên" disabled={i === 0} onClick={() => moveParam(i, -1)}><ArrowUp className="h-3 w-3" /></button>
                          <button className={iconBtn} title="Xuống" disabled={i === params.length - 1} onClick={() => moveParam(i, 1)}><ArrowDown className="h-3 w-3" /></button>
                          <button className={iconBtn} title="Nhân đôi" onClick={() => { const l = [...params]; l.splice(i + 1, 0, { ...p }); writeParams(l); }}><CopyPlus className="h-3 w-3" /></button>
                          <button className={iconBtn} title="Xóa" onClick={() => writeParams(params.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></button>
                        </td>
                      </tr>
                    ))}
                    {params.length === 0 && (
                      <tr><td colSpan={4} className="text-xs text-slate-500 py-3 text-center">Chưa có tham số.</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="flex gap-1 mt-2">
                  <button className={btnCls} onClick={() => writeParams([...params, { key: 'key', value: 'value' }])}><Plus className="h-3 w-3" />Thêm tham số</button>
                  <button
                    className={btnCls}
                    onClick={() => writeParams([...params].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)))}
                  >
                    Sắp xếp theo khóa
                  </button>
                </div>
              </div>

              <div className={panel + ' p-3 space-y-1.5'}>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-600">Sửa hàng loạt (dạng văn bản a=1&amp;b=2, hoặc mỗi dòng một tham số)</label>
                  <CopyBtn text={raw.query ?? ''} />
                </div>
                <textarea
                  rows={3}
                  className={inputCls}
                  spellCheck={false}
                  value={raw.query ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.replace(/^\?/, '').replace(/\r?\n+/g, '&');
                    patch({ query: v === '' ? null : v });
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* PERCENT */}
      {tab === 'percent' && (
        <div className={panel + ' p-3 space-y-3'}>
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-slate-600">Chuỗi cần soi (mã hóa phần trăm)</label>
            <div className="flex gap-1">
              <button className={btnCls} disabled={!raw} onClick={() => setPctText(raw ? [raw.path, raw.query !== null ? '?' + raw.query : ''].join('') : '')}>Lấy path + query từ URL</button>
              <button className={btnCls} onClick={() => setPctText('q=%E6%97%A5%E6%9C%AC&x=100%&dbl=a%2520b&bad=%E0%A4%A&plus=a+b%20c')}>Mẫu</button>
            </div>
          </div>
          <textarea rows={3} className={inputCls} value={pctText} onChange={(e) => setPctText(e.target.value)} spellCheck={false} placeholder="vd: a%2520b hoặc q=%E2%9C%93" />
          {pctText && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {pct.doubleEncoded && <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Có dấu hiệu mã hóa kép (%25XX), giải được {pct.layers} lớp</span>}
                {pct.invalidCount > 0 && <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">{pct.invalidCount} chuỗi % không hợp lệ</span>}
                {pct.plusCount > 0 && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">{pct.plusCount} dấu +: là khoảng trắng chỉ trong query dạng form, còn trong path thì là ký tự +</span>}
                {!pct.doubleEncoded && pct.invalidCount === 0 && <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Hợp lệ</span>}
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1">Phân tích từng đoạn</div>
                <div className="font-mono text-xs leading-relaxed break-all p-2 rounded-md bg-slate-50 border border-slate-200">
                  {pct.tokens.map((t, i) => (
                    <span
                      key={i}
                      title={t.kind === 'plain' ? '' : t.kind === 'valid' ? `Giải mã: ${t.decoded}` : t.kind === 'invalid' ? 'Dấu % không theo sau bởi 2 chữ số hex' : 'Dãy byte không phải UTF-8 hợp lệ'}
                      className={
                        t.kind === 'valid' ? 'bg-emerald-100 text-emerald-800 rounded-xs' : t.kind === 'plain' ? '' : 'bg-red-200 text-red-900 rounded-xs'
                      }
                    >
                      {t.raw}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-[11px] font-semibold text-slate-500">Giải mã 1 lớp</span><CopyBtn text={pct.decodedOnce} /></div>
                  <pre className="text-xs font-mono p-2 rounded-md bg-slate-900 text-slate-100 whitespace-pre-wrap break-all max-h-40 overflow-auto">{pct.decodedOnce}</pre>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-[11px] font-semibold text-slate-500">Giải mã hết ({pct.layers} lớp)</span><CopyBtn text={pct.finalDecoded} /></div>
                  <pre className="text-xs font-mono p-2 rounded-md bg-slate-900 text-slate-100 whitespace-pre-wrap break-all max-h-40 overflow-auto">{pct.finalDecoded}</pre>
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1">Dạng form (+ thành khoảng trắng)</div>
                <pre className="text-xs font-mono p-2 rounded-md bg-slate-50 border border-slate-200 whitespace-pre-wrap break-all">{safeDecode(pctText, true)}</pre>
              </div>
            </>
          )}
        </div>
      )}

      {/* NORMALIZE */}
      {tab === 'normalize' && (
        <div className={panel + ' p-3 space-y-3'}>
          {NormOptions}
          {!normResult ? (
            <div className="text-sm text-slate-500 text-center py-4">Nhập URL ở trên để chuẩn hóa.</div>
          ) : normResult.ok ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-1"><span className="text-[11px] font-semibold text-slate-500">Kết quả</span><CopyBtn text={normResult.url} /></div>
                <pre className="text-xs font-mono p-2 rounded-md bg-slate-900 text-slate-100 whitespace-pre-wrap break-all">{normResult.url}</pre>
              </div>
              <ul className="text-xs text-slate-600 list-disc pl-5 space-y-0.5">
                {normResult.changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              <button className={btnCls} onClick={() => setInput(normResult.url)}>Dùng kết quả làm URL chính</button>
            </>
          ) : (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">{normResult.error}</div>
          )}
          <p className="text-[11px] text-slate-500">Mẹo: chuẩn hóa luôn chữ thường scheme/host, giải ../ và ./, mã hóa lại ký tự đặc biệt theo WHATWG. Đặt sắp xếp tham số khi muốn so sánh/dedupe URL.</p>
        </div>
      )}

      {/* UTM */}
      {tab === 'utm' && (
        <div className={panel + ' p-3 space-y-3'}>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 shrink-0">URL gốc</label>
            <input className={inputCls} value={utmBase} onChange={(e) => setUtmBase(e.target.value)} placeholder="https://example.com/landing" spellCheck={false} />
            <button className={btnCls} onClick={() => setUtmBase(parsed.ok ? parsed.value.href : input)} disabled={!input.trim()}>Lấy từ URL chính</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(
              [
                ['source', 'utm_source *', 'newsletter'], ['medium', 'utm_medium *', 'email'], ['campaign', 'utm_campaign *', 'spring_sale'],
                ['term', 'utm_term', 'từ khóa trả phí'], ['content', 'utm_content', 'nut_dau_trang'], ['id', 'utm_id', 'abc123'],
              ] as [keyof UtmFields, string, string][]
            ).map(([k, label, ph]) => (
              <label key={k} className="text-[11px] text-slate-500 space-y-0.5 block">
                {label}
                <input className={inputCls} value={utm[k]} placeholder={ph} onChange={(e) => setUtm({ ...utm, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          {utmResult &&
            (utmResult.ok ? (
              <div>
                <div className="flex items-center justify-between mb-1"><span className="text-[11px] font-semibold text-slate-500">URL có UTM</span><CopyBtn text={utmResult.url} /></div>
                <pre className="text-xs font-mono p-2 rounded-md bg-slate-900 text-slate-100 whitespace-pre-wrap break-all">{utmResult.url}</pre>
              </div>
            ) : (
              <div className="text-xs text-red-600">{utmResult.error}</div>
            ))}
          <p className="text-[11px] text-slate-500">Mẹo: dùng chữ thường, không dấu cách (dùng gạch dưới) để báo cáo analytics không bị tách nhóm. Tham số utm_* cũ trong URL gốc sẽ bị thay thế.</p>
        </div>
      )}

      {/* RESOLVE */}
      {tab === 'resolve' && (
        <div className={panel + ' p-3 space-y-3'}>
          <label className="text-[11px] text-slate-500 space-y-0.5 block">
            Base URL
            <input className={inputCls} value={resBase} onChange={(e) => setResBase(e.target.value)} spellCheck={false} />
          </label>
          <label className="text-[11px] text-slate-500 space-y-0.5 block">
            URL tương đối (vd ../x, ./y?z=1, //cdn.com/a, ?q=1, #top)
            <input className={inputCls} value={resRel} onChange={(e) => setResRel(e.target.value)} spellCheck={false} />
          </label>
          {resResult.ok ? (
            <div>
              <div className="flex items-center justify-between mb-1"><span className="text-[11px] font-semibold text-slate-500">URL tuyệt đối</span><CopyBtn text={resResult.url} /></div>
              <pre className="text-xs font-mono p-2 rounded-md bg-slate-900 text-slate-100 whitespace-pre-wrap break-all">{resResult.url}</pre>
            </div>
          ) : (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">{resResult.error}</div>
          )}
        </div>
      )}

      {/* BATCH */}
      {tab === 'batch' && (
        <div className={panel + ' p-3 space-y-3'}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-600">Danh sách URL (mỗi dòng một URL, tối đa 5.000)</label>
            <button className={btnCls} onClick={() => setBatchText(['https://a.com/x?b=1&a=2', 'https://A.com/x/?a=2&b=1&utm_source=z', 'https://b.com:443/p#h', 'khong-hop-le', 'https://xn--bcher-kva.example/'].join('\n'))}>Mẫu</button>
          </div>
          <textarea rows={6} className={inputCls} value={batchText} onChange={(e) => setBatchText(e.target.value)} spellCheck={false} />
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-600 font-medium">Tùy chọn chuẩn hóa (dùng để dedupe)</summary>
            <div className="mt-2">{NormOptions}</div>
          </details>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Check2 checked={dedupe} onChange={setDedupe}>Loại trùng (theo URL đã chuẩn hóa)</Check2>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
              Sắp xếp:
              <select className={inputCls + ' w-auto'} value={sort} onChange={(e) => setSort(e.target.value as BatchSort)}>
                <option value="none">Giữ thứ tự</option>
                <option value="url">URL</option>
                <option value="host">Host</option>
                <option value="path">Path</option>
                <option value="params">Số tham số</option>
              </select>
            </label>
            <CopyBtn text={batchRows.filter((r) => r.ok).map((r) => r.normalized).join('\n')} label="Chép danh sách chuẩn hóa" />
            <button className={btnCls} onClick={downloadCsv} disabled={!batchRows.length}><Download className="h-3 w-3" />Tải CSV</button>
          </div>
          {batch.truncated && <div className="text-xs text-amber-600">Chỉ xử lý 5.000 dòng đầu.</div>}
          {batchRows.length > 0 ? (
            <div className="overflow-auto max-h-96 border border-slate-200 rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 text-left sticky top-0">
                  <tr><th className="px-2 py-1">#</th><th className="px-2 py-1">Host</th><th className="px-2 py-1">Path</th><th className="px-2 py-1">Tham số</th><th className="px-2 py-1">URL chuẩn hóa</th></tr>
                </thead>
                <tbody>
                  {batchRows.slice(0, 500).map((r) => (
                    <tr key={r.index} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1 text-slate-400">{r.index + 1}</td>
                      {r.ok ? (
                        <>
                          <td className="px-2 py-1 font-mono">{r.host}</td>
                          <td className="px-2 py-1 font-mono break-all">{r.path}</td>
                          <td className="px-2 py-1">{r.params}</td>
                          <td className="px-2 py-1 font-mono break-all">{r.normalized}</td>
                        </>
                      ) : (
                        <td colSpan={4} className="px-2 py-1 text-red-600"><span className="font-mono">{r.input}</span>: {r.error}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {batchRows.length > 500 && <div className="text-[11px] text-slate-500 p-2">Hiển thị 500/{batchRows.length} dòng; CSV chứa đầy đủ.</div>}
            </div>
          ) : (
            <div className="text-sm text-slate-500 text-center py-3">Dán danh sách URL để phân tích.</div>
          )}
          <div className="text-[11px] text-slate-500">
            {batch.rows.length} dòng, {batchRows.length} sau lọc, {batch.rows.filter((r) => !r.ok).length} lỗi. {splitQueryRaw('').length === 0 && ''}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Mẹo: fragment (#...) không gửi lên server; trong query, + nghĩa là khoảng trắng còn %20 thì luôn là khoảng trắng; tên miền Unicode được chuyển sang punycode (xn--) khi gửi qua mạng. Lỗi sao chép? <button className="underline" onClick={() => showToast('Dữ liệu chỉ xử lý trên trình duyệt của bạn.')}>Quyền riêng tư</button>
      </p>
    </div>
  );
}
