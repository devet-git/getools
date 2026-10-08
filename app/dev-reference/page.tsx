'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, Search, X, Check, Copy } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import { REF_TABLES, checkCors, filterRows, type CorsInput, type RefRow, type RefTable } from '@/lib/dev-reference';

const STATUS_COLOR: Record<string, string> = {
  '1xx': 'bg-sky-100 text-sky-800',
  '2xx': 'bg-emerald-100 text-emerald-800',
  '3xx': 'bg-indigo-100 text-indigo-800',
  '4xx': 'bg-amber-100 text-amber-800',
  '5xx': 'bg-red-100 text-red-800',
};

const YES_NO: Record<string, string> = { 'Có': 'text-emerald-700 font-medium', 'Không': 'text-red-600 font-medium' };

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs';
const inputCls = 'w-full px-2 py-1 text-xs rounded-md border border-slate-200 bg-white text-slate-800 focus:border-indigo-500 outline-hidden';

const MAX_Q = 120;

function useCopyCell() {
  const { showToast } = useApp();
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return {
    copied,
    copy: async (text: string, key: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        showToast(`Đã sao chép: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(null), 1200);
      } catch {
        showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
      }
    },
  };
}

function RefTableView({
  table, q, cat, selected, onSelect, focusRow,
}: {
  table: RefTable; q: string; cat: string; selected: string; onSelect: (id: string) => void; focusRow: string;
}) {
  const { copy, copied } = useCopyCell();
  const rows = useMemo(() => filterRows(table.rows, q, cat), [table, q, cat]);
  const selRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    // chỉ cuộn tới dòng khi mở từ link chia sẻ
    if (focusRow) selRef.current?.scrollIntoView({ block: 'center' });
  }, [focusRow, table.id]);

  const cellClass = (row: RefRow, ci: number, text: string) => {
    if (table.id === 'status' && ci === 0) return `font-mono font-bold px-1.5 py-0.5 rounded ${STATUS_COLOR[row.cat] ?? ''}`;
    if (table.id === 'methods' && ci >= 2 && ci <= 4) {
      const key = text.startsWith('Có') ? 'Có' : text.startsWith('Không') ? 'Không' : '';
      return YES_NO[key] ?? 'text-amber-700';
    }
    if (table.id === 'symbols' && ci === 0) return 'text-2xl leading-none';
    if (table.id === 'ascii' && ci === 4) return 'font-bold text-indigo-700';
    return '';
  };

  if (rows.length === 0) {
    return <div className="p-8 text-center text-sm text-slate-400">Không có kết quả khớp. Thử từ khóa khác hoặc bỏ bộ lọc nhóm.</div>;
  }

  return (
    <div className="overflow-auto max-h-[70vh]">
      <table className="w-full text-xs border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr>
            {table.columns.map((c) => (
              <th key={c} className="bg-slate-100 text-left font-bold text-slate-600 uppercase tracking-wider text-[10px] px-2 py-1.5 border-b border-slate-200 whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSel = row.id === selected;
            return (
              <tr key={row.id} ref={isSel ? selRef : undefined} className={isSel ? 'bg-indigo-50' : 'hover:bg-slate-50'}>
                {row.cells.map((text, ci) => {
                  const k = `${row.id}:${ci}`;
                  const mono = table.mono.includes(ci);
                  return (
                    <td key={ci} className="px-1 py-0.5 border-b border-slate-100 align-top">
                      <button
                        type="button"
                        title="Bấm để sao chép ô này"
                        onClick={() => { onSelect(row.id); void copy(text, k); }}
                        className={`text-left w-full px-1 py-0.5 rounded hover:bg-indigo-100/60 flex items-start gap-1 ${mono ? 'font-mono' : ''}`}
                      >
                        <span className={`${cellClass(row, ci, text)} ${table.id === 'status' && ci === 0 ? '' : 'break-words min-w-0'}`}>{text}</span>
                        {copied === k && <Check className="h-3 w-3 text-emerald-600 shrink-0 mt-0.5" />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------- CORS CHECKER ----------------------------- */

const CORS_DEFAULT: CorsInput = {
  sameOrigin: false,
  method: 'POST',
  headers: 'Authorization',
  contentType: 'application/json',
  credentials: false,
  origin: 'https://app.example.com',
  exposeHeaders: '',
};

function KV({ title, rows, tone }: { title: string; rows: [string, string][]; tone: string }) {
  const { copy } = useCopyCell();
  if (!rows.length) return null;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className={`flex items-center justify-between px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${tone}`}>
        {title}
        <button type="button" onClick={() => copy(text, title)} className="flex items-center gap-1 normal-case font-medium"><Copy className="h-3 w-3" />Sao chép</button>
      </div>
      <pre className="bg-slate-900 text-slate-100 text-xs font-mono p-3 whitespace-pre-wrap break-all">{text}</pre>
    </div>
  );
}

function CorsChecker({ sp }: { sp: URLSearchParams }) {
  const [inp, setInp] = useState<CorsInput>(() => ({
    ...CORS_DEFAULT,
    method: (sp.get('m') ?? CORS_DEFAULT.method).slice(0, 20),
    headers: (sp.get('h') ?? CORS_DEFAULT.headers).slice(0, 200),
    contentType: (sp.get('ct') ?? CORS_DEFAULT.contentType).slice(0, 100),
    credentials: sp.get('cred') === '1',
    sameOrigin: sp.get('same') === '1',
  }));
  const res = useMemo(() => checkCors(inp), [inp]);
  const set = <K extends keyof CorsInput>(k: K, v: CorsInput[K]) => setInp((p) => ({ ...p, [k]: v }));

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-3 p-3">
      <div className="space-y-2.5">
        <label className="block text-[11px] font-medium text-slate-600">
          Method
          <input list="cors-methods" value={inp.method} onChange={(e) => set('method', e.target.value)} className={`${inputCls} mt-0.5`} />
          <datalist id="cors-methods">{['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label className="block text-[11px] font-medium text-slate-600">
          Header tùy chỉnh (cách nhau dấu phẩy, không gồm Content-Type)
          <input value={inp.headers} onChange={(e) => set('headers', e.target.value)} placeholder="Authorization, X-Request-ID" className={`${inputCls} mt-0.5`} />
        </label>
        <label className="block text-[11px] font-medium text-slate-600">
          Content-Type của body
          <input list="cors-ct" value={inp.contentType} onChange={(e) => set('contentType', e.target.value)} placeholder="(không có body)" className={`${inputCls} mt-0.5`} />
          <datalist id="cors-ct">{['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'].map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label className="block text-[11px] font-medium text-slate-600">
          Origin của trang gọi
          <input value={inp.origin} onChange={(e) => set('origin', e.target.value)} className={`${inputCls} mt-0.5`} />
        </label>
        <label className="block text-[11px] font-medium text-slate-600">
          Header phản hồi tùy chỉnh mà JS cần đọc
          <input value={inp.exposeHeaders} onChange={(e) => set('exposeHeaders', e.target.value)} placeholder="X-Total-Count" className={`${inputCls} mt-0.5`} />
        </label>
        <label className="text-xs text-slate-700 flex items-center gap-1.5"><input type="checkbox" checked={inp.credentials} onChange={(e) => set('credentials', e.target.checked)} />Gửi cookie / credentials (include)</label>
        <label className="text-xs text-slate-700 flex items-center gap-1.5"><input type="checkbox" checked={inp.sameOrigin} onChange={(e) => set('sameOrigin', e.target.checked)} />Request cùng origin</label>
        <ShareLinkButton params={{ tab: 'cors', m: inp.method, h: inp.headers, ct: inp.contentType, cred: inp.credentials ? '1' : '', same: inp.sameOrigin ? '1' : '' }} />
        <p className="text-[11px] text-slate-500 bg-amber-50 border border-amber-100 rounded-md px-2 py-1">
          Mẹo: Content-Type: application/json luôn kích hoạt preflight; muốn tránh, gửi text/plain hoặc form-urlencoded (đổi lại phía server phải tự parse).
        </p>
      </div>

      <div className="space-y-2.5 min-w-0">
        {res.error ? (
          <div className="bg-red-50 text-red-700 text-xs rounded-lg px-3 py-2 border border-red-100">{res.error}</div>
        ) : (
          <>
            <div className={`rounded-lg px-3 py-2 text-sm font-medium border ${!res.cors ? 'bg-slate-50 border-slate-200 text-slate-700' : res.preflight ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
              {!res.cors ? 'Không áp dụng CORS (cùng origin).' : res.preflight ? 'Trình duyệt SẼ gửi preflight (OPTIONS) trước request thật.' : 'KHÔNG cần preflight: đây là "simple request".'}
            </div>
            <ul className="list-disc pl-5 text-xs text-slate-700 space-y-0.5">
              {res.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <KV title="1. Preflight request (trình duyệt gửi)" rows={res.preflightRequest} tone="bg-amber-100 text-amber-900" />
            <KV title="2. Server phải trả lời OPTIONS" rows={res.preflightResponse} tone="bg-indigo-100 text-indigo-900" />
            {res.cors && <KV title={res.preflight ? '3. Phản hồi của request thật cũng cần' : 'Phản hồi của request cần có'} rows={res.actualResponse} tone="bg-emerald-100 text-emerald-900" />}
            {res.notes.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Lưu ý</div>
                {res.notes.map((n, i) => <p key={i} className="text-xs text-slate-700">• {n}</p>)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- PAGE ----------------------------- */

const TAB_IDS = [...REF_TABLES.map((t) => t.id), 'cors'];

export default function DevReferencePage() {
  const [sp, setSp] = useState<URLSearchParams | null>(null);
  const [tab, setTab] = useState<string>(REF_TABLES[0].id);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [row, setRow] = useState('');
  const [focusRow, setFocusRow] = useState('');

  useEffect(() => {
    const p = readShareParams();
    const t = p.get('tab') ?? '';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSp(p);
    if (TAB_IDS.includes(t)) setTab(t);
    setQ((p.get('q') ?? '').slice(0, MAX_Q));
    setCat((p.get('cat') ?? '').slice(0, 40));
    setRow((p.get('row') ?? '').slice(0, 80));
    setFocusRow((p.get('row') ?? '').slice(0, 80));
  }, []);

  const table = REF_TABLES.find((t) => t.id === tab) ?? null;
  const switchTab = (id: string) => {
    setTab(id);
    setCat('');
    setRow('');
    setFocusRow('');
  };
  const count = useMemo(() => (table ? filterRows(table.rows, q, cat).length : 0), [table, q, cat]);

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <BookMarked className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Tra cứu nhanh cho Dev</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              HTTP status, header, method, cổng mạng, MIME, ASCII, entity và bộ kiểm tra CORS preflight. Bấm vào ô để sao chép.
            </p>
          </div>
        </div>
        <ShareLinkButton params={{ tab, q, cat, row }} label="Link tới kết quả này" />
      </div>

      <div className="flex flex-wrap gap-1" role="tablist">
        {REF_TABLES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => switchTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              tab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'cors'}
          onClick={() => switchTab('cors')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            tab === 'cors' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          CORS preflight
        </button>
      </div>

      <div className={card}>
        {table && (
          <>
            <div className="p-3 border-b border-slate-100 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-48">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    value={q}
                    onChange={(e) => { setQ(e.target.value.slice(0, MAX_Q)); setRow(''); }}
                    placeholder="Lọc nhanh (không cần gõ dấu; nhiều từ = và)…"
                    aria-label="Lọc bảng"
                    className={`${inputCls} pl-7! pr-7!`}
                  />
                  {q && (
                    <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {table.categories.length > 0 && (
                  <select value={cat} onChange={(e) => { setCat(e.target.value); setRow(''); }} aria-label="Lọc theo nhóm" className={`${inputCls} w-auto!`}>
                    <option value="">Tất cả nhóm</option>
                    {table.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                )}
                <span className="text-xs text-slate-500">{count}/{table.rows.length} dòng</span>
              </div>
              <p className="text-[11px] text-slate-500">{table.hint}</p>
            </div>
            <RefTableView key={table.id} table={table} q={q} cat={cat} selected={row} onSelect={setRow} focusRow={focusRow} />
          </>
        )}
        {tab === 'cors' && sp && <CorsChecker sp={sp} />}
      </div>
    </div>
  );
}
