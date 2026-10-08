'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChartNoAxesCombined,
  Search,
  Loader2,
  AlertTriangle,
  Info,
  Copy,
  Download,
  ExternalLink,
  Star,
  GitFork,
  Check,
  X,
  Users,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import { parseRepoInput, RepoError, RateInfo, formatReset } from '@/lib/repo-viewer';
import {
  Analysis,
  AGE_BUCKETS,
  DAY_NAMES,
  DAY_ORDER,
  Heatmap,
  CodeFreqPoint,
  WeekPoint,
  OpenSummary,
  analyzeRepo,
  analysisJson,
  analysisMarkdown,
  busFactorRisk,
  commitsPerWeek,
  contributorsCsv,
  formatDays,
  keyMetrics,
} from '@/lib/repo-analytics';

const SAMPLES = ['sindresorhus/slugify', 'lukeed/clsx', 'tj/commander.js', 'vercel/swr'];
const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('vi-VN'));
const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('vi-VN') : '—');
const fmtWeek = (sec: number) => new Date(sec * 1000).toLocaleDateString('vi-VN');

const STATUS_STYLE = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  slowing: 'bg-amber-50 text-amber-700 border-amber-200',
  dormant: 'bg-red-50 text-red-700 border-red-200',
} as const;

function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- Biểu đồ SVG ---------------- */

function Heatmap7x24({ h }: { h: Heatmap }) {
  const cw = 22;
  const ch = 20;
  const left = 28;
  const top = 16;
  const W = left + 24 * cw;
  const H = top + 7 * ch + 2;
  const label = h.peak
    ? `Bản đồ nhiệt commit theo thứ và giờ (UTC). Cao điểm: ${DAY_NAMES[h.peak.day]} lúc ${h.peak.hour}:00 với ${h.peak.count} commit.`
    : 'Bản đồ nhiệt commit theo thứ và giờ (UTC), chưa có dữ liệu.';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full max-w-3xl text-emerald-600">
      <title>{label}</title>
      {Array.from({ length: 24 }, (_, hr) =>
        hr % 3 === 0 ? (
          <text key={hr} x={left + hr * cw + cw / 2} y={10} textAnchor="middle" fontSize="9" className="fill-slate-500">
            {hr}
          </text>
        ) : null
      )}
      {DAY_ORDER.map((d, row) => (
        <g key={d}>
          <text x={left - 5} y={top + row * ch + ch / 2 + 3} textAnchor="end" fontSize="9" className="fill-slate-500">
            {DAY_NAMES[d]}
          </text>
          {h.matrix[d].map((c, hr) => (
            <g key={hr}>
              <rect x={left + hr * cw + 1} y={top + row * ch + 1} width={cw - 2} height={ch - 2} rx={3} className="fill-slate-100" />
              {c > 0 && (
                <rect
                  x={left + hr * cw + 1}
                  y={top + row * ch + 1}
                  width={cw - 2}
                  height={ch - 2}
                  rx={3}
                  fill="currentColor"
                  fillOpacity={0.15 + 0.85 * (c / h.max)}
                >
                  <title>{`${DAY_NAMES[d]} ${String(hr).padStart(2, '0')}:00 UTC: ${c} commit`}</title>
                </rect>
              )}
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

function WeeklyBars({ weeks }: { weeks: WeekPoint[] }) {
  const W = 520;
  const H = 90;
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const bw = W / Math.max(1, weeks.length);
  const total = weeks.reduce((s, w) => s + w.total, 0);
  const label = `Biểu đồ cột số commit mỗi tuần trong ${weeks.length} tuần, tổng ${total} commit, cao nhất ${max} commit/tuần.`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={label} className="w-full text-indigo-500">
        <title>{label}</title>
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-slate-200" />
        {weeks.map((w, i) => {
          const h = (w.total / max) * (H - 4);
          return (
            <rect key={i} x={i * bw + 0.5} y={H - h} width={Math.max(1, bw - 1)} height={h} fill="currentColor" rx={1}>
              <title>{`Tuần ${fmtWeek(w.week)}: ${w.total} commit`}</title>
            </rect>
          );
        })}
        {weeks.length > 0 && (
          <>
            <text x={0} y={H + 11} fontSize="9" className="fill-slate-500">{fmtWeek(weeks[0].week)}</text>
            <text x={W} y={H + 11} fontSize="9" textAnchor="end" className="fill-slate-500">{fmtWeek(weeks[weeks.length - 1].week)}</text>
            <text x={W} y={9} fontSize="9" textAnchor="end" className="fill-slate-500">max {max}</text>
          </>
        )}
      </svg>
    </div>
  );
}

function CodeFreqChart({ data }: { data: CodeFreqPoint[] }) {
  const W = 520;
  const H = 120;
  const mid = H / 2;
  const max = Math.max(1, ...data.map((d) => Math.max(d.additions, d.deletions)));
  const n = Math.max(1, data.length - 1);
  const x = (i: number) => (i / n) * W;
  const up = data.map((d, i) => `${x(i).toFixed(1)},${(mid - (d.additions / max) * (mid - 4)).toFixed(1)}`).join(' ');
  const down = data.map((d, i) => `${x(i).toFixed(1)},${(mid + (d.deletions / max) * (mid - 4)).toFixed(1)}`).join(' ');
  const label = `Biểu đồ đường số dòng thêm (xanh, phía trên) và xóa (đỏ, phía dưới) theo tuần, ${data.length} tuần, cao nhất ${fmtNum(max)} dòng/tuần.`;
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={label} className="w-full">
      <title>{label}</title>
      <line x1={0} x2={W} y1={mid} y2={mid} className="stroke-slate-300" />
      <polyline points={up} fill="none" strokeWidth={1.5} className="stroke-emerald-500" />
      <polyline points={down} fill="none" strokeWidth={1.5} className="stroke-red-500" />
      {data.map((d, i) => (
        <rect key={i} x={x(i) - 3} y={0} width={6} height={H} fill="transparent">
          <title>{`Tuần ${fmtWeek(d.week)}: +${fmtNum(d.additions)} / -${fmtNum(d.deletions)}`}</title>
        </rect>
      ))}
      {data.length > 0 && (
        <>
          <text x={0} y={H + 11} fontSize="9" className="fill-slate-500">{fmtWeek(data[0].week)}</text>
          <text x={W} y={H + 11} fontSize="9" textAnchor="end" className="fill-slate-500">{fmtWeek(data[data.length - 1].week)}</text>
          <text x={W} y={10} fontSize="9" textAnchor="end" className="fill-emerald-600">+{fmtNum(max)}</text>
          <text x={W} y={H - 2} fontSize="9" textAnchor="end" className="fill-red-600">-{fmtNum(max)}</text>
        </>
      )}
    </svg>
  );
}

function HBars({ rows, label, colorClass = 'fill-indigo-500' }: { rows: { label: string; value: number; note?: string }[]; label: string; colorClass?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const rh = 22;
  const lw = 92;
  const W = 420;
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * rh}`} role="img" aria-label={label} className="w-full max-w-xl">
      <title>{label}</title>
      {rows.map((r, i) => {
        const w = (r.value / max) * (W - lw - 60);
        return (
          <g key={r.label}>
            <text x={lw - 6} y={i * rh + 15} textAnchor="end" fontSize="11" className="fill-slate-600">{r.label}</text>
            <rect x={lw} y={i * rh + 4} width={Math.max(r.value > 0 ? 2 : 0, w)} height={rh - 8} rx={3} className={colorClass}>
              <title>{`${r.label}: ${r.value}${r.note ? ` ${r.note}` : ''}`}</title>
            </rect>
            <text x={lw + Math.max(2, w) + 5} y={i * rh + 15} fontSize="11" className="fill-slate-700">{fmtNum(r.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LangBar({ langs }: { langs: NonNullable<Analysis['languages']> }) {
  const label = `Tỷ lệ ngôn ngữ: ${langs.slice(0, 6).map((l) => `${l.name} ${l.percent.toFixed(1)}%`).join(', ')}`;
  const offsets = langs.map((_, i) => langs.slice(0, i).reduce((s, l) => s + l.percent, 0));
  return (
    <div>
      <svg viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label={label} className="w-full h-3 rounded-full overflow-hidden">
        <title>{label}</title>
        {langs.map((l, i) => (
          <rect key={l.name} x={offsets[i]} y={0} width={l.percent} height={6} fill={l.color}>
            <title>{`${l.name}: ${l.percent.toFixed(1)}%`}</title>
          </rect>
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        {langs.slice(0, 10).map((l) => (
          <li key={l.name} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.color }} aria-hidden />
            {l.name} <span className="text-slate-400">{l.percent.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReleaseTimeline({ list }: { list: NonNullable<Analysis['releases']>['list'] }) {
  const W = 520;
  const H = 40;
  const t = list.map((r) => Date.parse(r.date));
  const t0 = Math.min(...t);
  const span = Math.max(1, Math.max(...t) - t0);
  const label = `Dòng thời gian ${list.length} bản phát hành từ ${fmtDate(list[0].date)} đến ${fmtDate(list[list.length - 1].date)}.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full text-indigo-500">
      <title>{label}</title>
      <line x1={6} x2={W - 6} y1={16} y2={16} className="stroke-slate-300" />
      {list.map((r, i) => (
        <circle key={i} cx={6 + ((t[i] - t0) / span) * (W - 12)} cy={16} r={r.prerelease ? 3 : 4.5} fill={r.prerelease ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth={1.5} fillOpacity={0.75}>
          <title>{`${r.tag} — ${fmtDate(r.date)}${r.prerelease ? ' (pre-release)' : ''}`}</title>
        </circle>
      ))}
      <text x={6} y={36} fontSize="9" className="fill-slate-500">{fmtDate(list[0].date)}</text>
      <text x={W - 6} y={36} fontSize="9" textAnchor="end" className="fill-slate-500">{fmtDate(list[list.length - 1].date)}</text>
    </svg>
  );
}

/* ---------------- UI nhỏ ---------------- */

function Card({ title, hint, children, id }: { title: string; hint?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-800 leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-slate-500">{children}</p>;

function SectionNote({ a, keyName, loading }: { a: Analysis; keyName: string; loading: boolean }) {
  if (a.errors[keyName]) return <p className="text-xs text-red-600 flex items-start gap-1"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{a.errors[keyName]}</p>;
  if (a.skipped.includes(keyName)) return <Muted>Đã bỏ qua mục này vì gần hết lượt gọi API. Thêm GitHub Token trong Cài đặt hoặc thử lại sau.</Muted>;
  if (loading) return <p className="text-xs text-slate-500 flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang tải…</p>;
  return null;
}

function OpenBlock({ title, s, a, keyName, loading }: { title: string; s?: OpenSummary; a: Analysis; keyName: string; loading: boolean }) {
  return (
    <Card title={title} hint="Lấy qua Search API (giới hạn riêng, thấp hơn API thường).">
      {!s ? (
        <SectionNote a={a} keyName={keyName} loading={loading} />
      ) : (
        <div className="space-y-3">
          <div className="text-2xl font-bold text-slate-800">{fmtNum(s.total)} <span className="text-sm font-normal text-slate-500">đang mở</span></div>
          {s.bucketsExact && s.buckets.length > 0 ? (
            <HBars
              label={`Phân bố tuổi của ${title}: ${AGE_BUCKETS.map((b, i) => `${b.label} ${s.buckets[i]}`).join(', ')}`}
              rows={AGE_BUCKETS.map((b, i) => ({ label: b.label, value: s.buckets[i] }))}
            />
          ) : (
            <Muted>Chưa đủ lượt Search API để dựng biểu đồ tuổi cho toàn bộ mục.</Muted>
          )}
          {s.oldest.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">10 mục lâu nhất</div>
              <ul className="text-xs divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {s.oldest.map((it) => (
                  <li key={it.number} className="px-2 py-1.5 flex items-center gap-2">
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline shrink-0">#{it.number}</a>
                    <span className="truncate flex-1 text-slate-700" title={it.title}>{it.title}</span>
                    <span className="text-slate-400 shrink-0">{fmtDate(it.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function errText(e: unknown): string {
  if (e instanceof RepoError) return e.message;
  return e instanceof Error ? e.message : 'Đã xảy ra lỗi không xác định.';
}

/* ---------------- Trang ---------------- */

export default function RepoAnalyticsPage() {
  const { keys, showToast } = useApp();
  const tokenRef = useRef(keys.github || undefined);
  useEffect(() => {
    tokenRef.current = keys.github || undefined;
  }, [keys.github]);

  const [input, setInput] = useState('');
  const [input2, setInput2] = useState('');
  const [compare, setCompare] = useState(false);
  const [inputError, setInputError] = useState('');
  const [target, setTarget] = useState<{ a: string; b: string; n: number } | null>(null);

  const [data, setData] = useState<Analysis | null>(null);
  const [dataB, setDataB] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyB, setBusyB] = useState(false);
  const [fatal, setFatal] = useState('');
  const [fatalB, setFatalB] = useState('');
  const [rate, setRate] = useState<RateInfo | null>(null);
  const [searchRate, setSearchRate] = useState<RateInfo | null>(null);

  const start = useCallback((raw: string, raw2: string, withCompare: boolean) => {
    const pa = parseRepoInput(raw);
    if (!pa) {
      setInputError('Không nhận ra repo. Hãy nhập dạng owner/repo hoặc link github.com/owner/repo.');
      return;
    }
    let b = '';
    if (withCompare && raw2.trim()) {
      const pb = parseRepoInput(raw2);
      if (!pb) {
        setInputError('Repo thứ hai không hợp lệ. Hãy nhập dạng owner/repo.');
        return;
      }
      b = `${pb.owner}/${pb.repo}`;
      setInput2(b);
    }
    setInputError('');
    const a = `${pa.owner}/${pa.repo}`;
    setInput(a);
    setTarget((t) => ({ a, b, n: (t?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    const sp = readShareParams();
    const r = sp.get('r');
    if (r) {
      const c = sp.get('c') || '';
      if (c) {
        setCompare(true);
        setInput2(c);
      }
      start(r, c, !!c);
    }
  }, [start]);

  useEffect(() => {
    if (!target) return;
    const ac = new AbortController();
    const run = async (full: string, light: boolean, set: (a: Analysis | null) => void, setB: (b: boolean) => void, setF: (s: string) => void) => {
      const [o, r] = full.split('/');
      set(null);
      setF('');
      setB(true);
      try {
        await analyzeRepo(
          o,
          r,
          { token: tokenRef.current, signal: ac.signal },
          { onUpdate: (a) => set(a), onRate: setRate, onSearchRate: light ? undefined : setSearchRate },
          light
        );
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        setF(errText(e));
      } finally {
        if (!ac.signal.aborted) setB(false);
      }
    };
    setDataB(null);
    void run(target.a, false, setData, setBusy, setFatal);
    if (target.b) void run(target.b, true, setDataB, setBusyB, setFatalB);
    else {
      setBusyB(false);
      setFatalB('');
    }
    return () => ac.abort();
  }, [target]);

  const a = data;
  const loading = busy;
  const cpw = a?.weekly ? commitsPerWeek(a.weekly) : null;
  const risk = a?.bus ? busFactorRisk(a.bus.n) : null;
  const lowQuota = rate && rate.remaining !== null && rate.remaining < 30;

  const compareRows = useMemo(() => {
    if (!a || !dataB) return null;
    const x = keyMetrics(a);
    const y = keyMetrics(dataB);
    return [
      { label: 'Sao', a: x.stars, b: y.stars, fmt: fmtNum },
      { label: 'Contributor', a: x.contributors, b: y.contributors, fmt: fmtNum },
      { label: 'Commit/tuần (TB 52 tuần)', a: x.commitsPerWeek, b: y.commitsPerWeek, fmt: (v: number | null) => (v === null ? '—' : v.toFixed(1)) },
      { label: 'Chu kỳ release (trung vị, ngày; thấp = thường xuyên hơn)', a: x.releaseIntervalDays, b: y.releaseIntervalDays, fmt: (v: number | null) => formatDays(v) },
      { label: 'Issue + PR đang mở', a: x.openIssues, b: y.openIssues, fmt: fmtNum },
    ];
  }, [a, dataB]);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ChartNoAxesCombined className="h-5 w-5 text-indigo-300" />
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Phân tích Repo</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Thống kê hoạt động, contributor, release, issue/PR và sức khỏe cộng đồng của repo GitHub công khai.
            </p>
          </div>
        </div>
        {a && <ShareLinkButton params={{ r: target?.a, c: compare ? target?.b : '' }} />}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(input, input2, compare);
          }}
        >
          <div className="flex flex-wrap gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="owner/repo hoặc https://github.com/owner/repo"
              aria-label="Repo GitHub"
              className="flex-1 min-w-60 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {compare && (
              <input
                value={input2}
                onChange={(e) => setInput2(e.target.value)}
                placeholder="Repo để so sánh (owner/repo)"
                aria-label="Repo so sánh"
                className="flex-1 min-w-60 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            )}
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Phân tích
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Thử nhanh:</span>
            {SAMPLES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setInput(s);
                  start(s, input2, compare);
                }}
                className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
              >
                {s}
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1 text-slate-600 cursor-pointer">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              So sánh 2 repo
            </label>
            {rate && rate.remaining !== null && (
              <span className={`ml-auto ${rate.remaining < 30 ? 'text-red-600' : 'text-slate-500'}`} title={rate.reset ? `Đặt lại ${formatReset(rate.reset)}` : undefined}>
                API còn {fmtNum(rate.remaining)}
                {rate.limit ? `/${fmtNum(rate.limit)}` : ''} lượt{keys.github ? '' : ' (chưa dùng token)'}
                {searchRate && searchRate.remaining !== null ? ` · Search còn ${searchRate.remaining}` : ''}
              </span>
            )}
          </div>
        </form>
        {inputError && <p className="text-xs text-red-600">{inputError}</p>}
        <p className="text-[11px] text-slate-500 flex items-start gap-1">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Mẹo: chưa có token chỉ được 60 lượt/giờ — dễ cạn khi phân tích đầy đủ. Thêm GitHub Token trong Cài đặt (chỉ gửi tới api.github.com) để có 5.000 lượt/giờ.
        </p>
      </div>

      {fatal && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {fatal}
        </div>
      )}
      {lowQuota && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs p-3">
          Lượt gọi API sắp hết (còn {rate?.remaining}). Một số mục nặng (phản hồi issue, thống kê chi tiết) sẽ được bỏ qua
          {rate?.reset ? `; quota đặt lại ${formatReset(rate.reset)}` : ''}.
        </div>
      )}
      {a?.computing && busy && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs p-3 flex items-center gap-2" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          GitHub đang tính thống kê… (có thể mất tới ~20 giây ở lần đầu)
        </div>
      )}

      {!a && !fatal && !busy && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Nhập một repo GitHub công khai để xem thống kê hoạt động, bus factor, chu kỳ release, tuổi issue và nhiều hơn nữa.
        </div>
      )}
      {!a && busy && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải thông tin repo…
        </div>
      )}

      {a && (
        <>
          {/* Tổng quan */}
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <a href={a.info.html_url} target="_blank" rel="noopener noreferrer" className="text-base font-bold text-indigo-600 hover:underline inline-flex items-center gap-1">
                  {a.fullName} <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {a.info.description && <p className="text-sm text-slate-600 mt-0.5">{a.info.description}</p>}
              </div>
              {a.status && (
                <div className={`px-3 py-1.5 rounded-lg border text-xs ${STATUS_STYLE[a.status.level]}`} title={a.status.reason}>
                  <div className="font-bold">{a.status.label}</div>
                  <div className="max-w-xs">{a.status.reason}</div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Sao" value={<span className="flex items-center gap-1"><Star className="h-4 w-4 text-amber-500" />{fmtNum(a.info.stargazers_count)}</span>} />
              <Stat label="Fork" value={<span className="flex items-center gap-1"><GitFork className="h-4 w-4 text-slate-500" />{fmtNum(a.info.forks_count)}</span>} />
              <Stat label="Commit/tuần (TB 52 tuần)" value={cpw === null ? '—' : cpw.toFixed(1)} sub={a.weekly ? `${fmtNum(a.weekly.reduce((s, w) => s + w.total, 0))} commit` : undefined} />
              <Stat label="Push cuối" value={fmtDate(a.info.pushed_at)} sub={`Tạo ${fmtDate(a.info.created_at)}`} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(analysisMarkdown(a)).then(() => showToast('Đã sao chép báo cáo Markdown!'), () => showToast('Lỗi khi sao chép.'));
                }}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1"
              >
                <Copy className="h-3.5 w-3.5" /> Chép Markdown
              </button>
              <button type="button" onClick={() => download(`${a.fullName.replace('/', '-')}-analytics.md`, analysisMarkdown(a), 'text/markdown')} className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1">
                <Download className="h-3.5 w-3.5" /> Tải .md
              </button>
              <button type="button" onClick={() => download(`${a.fullName.replace('/', '-')}-analytics.json`, analysisJson(a), 'application/json')} className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1">
                <Download className="h-3.5 w-3.5" /> Tải JSON
              </button>
              <button
                type="button"
                disabled={!a.contributors?.length}
                onClick={() => a.contributors && download(`${a.fullName.replace('/', '-')}-contributors.csv`, contributorsCsv(a.contributors), 'text/csv')}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" /> CSV contributor
              </button>
              {busy && <span className="text-slate-500 flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang tải các mục còn lại…</span>}
            </div>
          </section>

          {/* So sánh */}
          {target?.b && (
            <Card title="So sánh hai repo" hint="Repo thứ hai dùng bản phân tích nhẹ (không có issue/PR qua Search, punch card...). Số issue + PR mở lấy từ thông tin repo.">
              {fatalB ? (
                <p className="text-xs text-red-600">{fatalB}</p>
              ) : !compareRows ? (
                <p className="text-xs text-slate-500 flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang tải {target.b}…</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-indigo-600">{a.fullName}</span>
                    <span className="text-emerald-600">{dataB?.fullName}</span>
                  </div>
                  {compareRows.map((row) => {
                    const max = Math.max(1, row.a ?? 0, row.b ?? 0);
                    return (
                      <div key={row.label} role="group" aria-label={row.label}>
                        <div className="text-[11px] text-slate-500 text-center mb-0.5">{row.label}</div>
                        <div className="grid grid-cols-2 gap-3 items-center text-xs">
                          {([['a', row.a, 'bg-indigo-500', 'justify-end'], ['b', row.b, 'bg-emerald-500', 'justify-start']] as const).map(([k, v, bg, just]) => (
                            <div key={k} className={`flex items-center gap-2 ${just}`}>
                              {k === 'a' && <span className="font-semibold text-slate-700">{row.fmt(v as never)}</span>}
                              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden flex" style={{ justifyContent: k === 'a' ? 'flex-end' : 'flex-start' }}>
                                <div className={`h-2 rounded-full ${bg}`} style={{ width: `${((v ?? 0) / max) * 100}%` }} />
                              </div>
                              {k === 'b' && <span className="font-semibold text-slate-700">{row.fmt(v as never)}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* Hoạt động */}
          <Card title="Commit theo tuần (52 tuần gần nhất)">
            {a.weekly && a.weekly.length > 0 ? <WeeklyBars weeks={a.weekly} /> : a.weekly ? <Muted>Chưa có dữ liệu commit.</Muted> : <SectionNote a={a} keyName="Hoạt động theo tuần" loading={loading} />}
          </Card>

          <Card title="Giờ commit (UTC)" hint="Múi giờ: UTC. Mỗi ô là tổng commit theo thứ trong tuần và giờ trong ngày, cộng dồn toàn lịch sử repo.">
            {a.heatmap && a.heatmap.total > 0 ? (
              <>
                <Heatmap7x24 h={a.heatmap} />
                {a.heatmap.peak && <Muted>Cao điểm: {DAY_NAMES[a.heatmap.peak.day]} lúc {String(a.heatmap.peak.hour).padStart(2, '0')}:00 UTC ({fmtNum(a.heatmap.peak.count)} commit).</Muted>}
              </>
            ) : a.heatmap ? <Muted>Chưa có dữ liệu.</Muted> : <SectionNote a={a} keyName="Punch card" loading={loading} />}
          </Card>

          <Card title="Dòng code thêm / xóa theo tuần" hint="Đường xanh phía trên: dòng thêm. Đường đỏ phía dưới: dòng xóa.">
            {a.codeFreq && a.codeFreq.length > 0 ? <CodeFreqChart data={a.codeFreq} /> : a.codeFreq ? <Muted>Chưa có dữ liệu.</Muted> : <SectionNote a={a} keyName="Code frequency" loading={loading} />}
          </Card>

          {/* Contributor */}
          <Card title="Contributor hàng đầu" hint={a.contributorsSource === 'list' ? 'Dùng danh sách /contributors (thống kê chi tiết không khả dụng) — tối đa 100 người.' : undefined}>
            {a.contributors && a.contributors.length > 0 ? (
              <div className="space-y-3">
                {a.bus && risk && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 flex items-start gap-2">
                    <Users className="h-4 w-4 mt-0.5 shrink-0 text-indigo-500" />
                    <div>
                      <div>
                        <strong>Bus factor (ước lượng): {a.bus.n}</strong> — số người ít nhất mà tổng commit của họ chiếm từ 50% trong {fmtNum(a.bus.total)} commit.{' '}
                        <span className={risk.level === 'high' ? 'text-red-600' : risk.level === 'medium' ? 'text-amber-600' : 'text-emerald-600'}>{risk.text}</span>
                      </div>
                      <div className="text-slate-500 mt-0.5">Chỉ là chỉ số tham khảo: chưa tính review, issue, bot hay việc đổi tài khoản.</div>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-1 pr-2 font-medium">#</th>
                        <th className="py-1 pr-2 font-medium">Tài khoản</th>
                        <th className="py-1 pr-2 font-medium text-right">Commit</th>
                        <th className="py-1 pr-2 font-medium w-1/3">Tỷ lệ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.contributors.slice(0, 15).map((c, i) => (
                        <tr key={c.login + i} className="border-b border-slate-100">
                          <td className="py-1 pr-2 text-slate-400">{i + 1}</td>
                          <td className="py-1 pr-2">{c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{c.login}</a> : c.login}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{fmtNum(c.commits)}</td>
                          <td className="py-1 pr-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden" role="img" aria-label={`${c.share.toFixed(1)}%`}>
                                <div className="h-2 bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, c.share)}%` }} />
                              </div>
                              <span className="w-12 text-right tabular-nums">{c.share.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Muted>Tổng {fmtNum(a.contributors.length)} contributor{a.contributorsTruncated ? ' (đã cắt ở 100 người)' : ''}.</Muted>
              </div>
            ) : a.contributors ? <Muted>Không có dữ liệu contributor.</Muted> : <SectionNote a={a} keyName="Contributor" loading={loading} />}
          </Card>

          {/* Release */}
          <Card title="Chu kỳ phát hành">
            {a.releases ? (
              a.releases.list.length === 0 ? (
                <Muted>Repo chưa có release nào trên GitHub (có thể chỉ dùng tag).</Muted>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Stat label="Số release (ổn định)" value={fmtNum(a.releases.cadence.count)} sub={a.releases.list.length >= 100 ? 'tối đa 100 gần nhất' : undefined} />
                    <Stat label="Trung vị giữa 2 bản" value={formatDays(a.releases.cadence.medianDays)} />
                    <Stat label="Trung bình giữa 2 bản" value={formatDays(a.releases.cadence.meanDays)} />
                    <Stat label="Bản gần nhất cách đây" value={formatDays(a.releases.cadence.daysSinceLast)} />
                  </div>
                  <ReleaseTimeline list={a.releases.list} />
                  <div className="text-xs text-slate-600">
                    <span className="font-semibold">Mới nhất:</span>{' '}
                    {a.releases.list.slice(-6).reverse().map((r) => (
                      <a key={r.tag} href={r.url} target="_blank" rel="noopener noreferrer" className="inline-block mr-2 text-indigo-600 hover:underline">
                        {r.tag}
                      </a>
                    ))}
                  </div>
                  {a.releases.mix.parseable > 1 ? (
                    <HBars
                      label={`Tỷ lệ kiểu bản phát hành: major ${a.releases.mix.major}, minor ${a.releases.mix.minor}, patch ${a.releases.mix.patch}, khác ${a.releases.mix.other}`}
                      rows={[
                        { label: 'Major', value: a.releases.mix.major },
                        { label: 'Minor', value: a.releases.mix.minor },
                        { label: 'Patch', value: a.releases.mix.patch },
                        { label: 'Khác', value: a.releases.mix.other },
                      ]}
                      colorClass="fill-emerald-500"
                    />
                  ) : (
                    <Muted>Tag không theo semver nên không phân loại major/minor/patch.</Muted>
                  )}
                </div>
              )
            ) : <SectionNote a={a} keyName="Releases" loading={loading} />}
          </Card>

          {(
            <>
              <div className="grid md:grid-cols-2 gap-4">
                <OpenBlock title="Issue đang mở" s={a.issues} a={a} keyName="Issue đang mở" loading={loading} />
                <OpenBlock title="PR đang mở" s={a.prs} a={a} keyName="PR đang mở" loading={loading} />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <Card title="Thời gian merge PR" hint="Mẫu: 50 PR đã đóng gần nhất.">
                  {a.prMerge ? (
                    a.prMerge.merged ? (
                      <div className="space-y-1">
                        <div className="text-2xl font-bold text-slate-800">{formatDays(a.prMerge.median)} <span className="text-sm font-normal text-slate-500">trung vị</span></div>
                        <Muted>Trung bình {formatDays(a.prMerge.mean)} · {a.prMerge.merged}/{a.prMerge.sample} PR trong mẫu đã được merge.</Muted>
                      </div>
                    ) : <Muted>Không có PR nào được merge trong mẫu.</Muted>
                  ) : <SectionNote a={a} keyName="PR đã đóng" loading={loading} />}
                </Card>
                <Card title="Phản hồi issue đầu tiên (ước lượng)" hint="Ước lượng thô từ tối đa 30 issue mới nhất, bỏ qua bình luận của chính tác giả và bot.">
                  {a.firstResponse ? (
                    a.firstResponse.responded ? (
                      <div className="space-y-1">
                        <div className="text-2xl font-bold text-slate-800">~{formatDays(a.firstResponse.medianDays)} <span className="text-sm font-normal text-slate-500">trung vị (ước lượng)</span></div>
                        <Muted>{a.firstResponse.responded}/{a.firstResponse.sample} issue trong mẫu có người khác phản hồi; {a.firstResponse.unanswered} chưa có. Mẫu nhỏ nên chỉ mang tính tham khảo.</Muted>
                      </div>
                    ) : <Muted>Chưa có issue nào trong mẫu ({a.firstResponse.sample}) được người khác phản hồi.</Muted>
                  ) : <SectionNote a={a} keyName="Phản hồi issue đầu tiên" loading={loading} />}
                </Card>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <Card title="Ngôn ngữ">
                  {a.languages ? (a.languages.length ? <LangBar langs={a.languages} /> : <Muted>Không có dữ liệu ngôn ngữ.</Muted>) : <SectionNote a={a} keyName="Ngôn ngữ" loading={loading} />}
                </Card>
                <Card title="Sức khỏe cộng đồng">
                  {a.community ? (
                    <div className="space-y-2">
                      {a.community.healthPercentage !== null && <div className="text-2xl font-bold text-slate-800">{a.community.healthPercentage}%</div>}
                      <ul className="grid grid-cols-2 gap-1 text-xs">
                        {a.community.items.map((it) => (
                          <li key={it.key} className="flex items-center gap-1.5">
                            {it.present ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-label="có" /> : <X className="h-3.5 w-3.5 text-red-500" aria-label="thiếu" />}
                            <span className={it.present ? 'text-slate-700' : 'text-slate-500'}>{it.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : <SectionNote a={a} keyName="Sức khỏe cộng đồng" loading={loading} />}
                </Card>
              </div>
            </>
          )}

          {a.skipped.length > 0 && (
            <p className="text-xs text-amber-700">Đã bỏ qua do gần hết quota API: {a.skipped.join(', ')}.</p>
          )}
        </>
      )}
    </div>
  );
}
