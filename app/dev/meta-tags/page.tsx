'use client';

import { useEffect, useMemo, useState } from 'react';
import { Tags, Copy, Check, Plus, Trash2, Sparkles, AlertCircle, AlertTriangle, Info, CheckCircle2, ImageOff, Search } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  AnalyzedHead,
  FlatEl,
  Issue,
  JSONLD_FIELDS,
  JsonLdBlock,
  JsonLdType,
  MAX_HEAD_HTML,
  MetaState,
  analyzeHeadElements,
  auditAnalyzed,
  buildJsonLd,
  defaultMetaState,
  estimateTitlePx,
  nextMetadata,
  nuxtUseHead,
  reactHelmet,
  renderHtml,
  renderHtmlDocument,
  safeJsonForScript,
  sampleMetaState,
  truncateByPx,
  truncateChars,
  validateMeta,
} from '@/lib/meta-tags';
import { Select } from '@/components/ui/searchable-select';

const inputCls =
  'w-full px-2 py-1 text-xs rounded-md border border-slate-200 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400';
const autoRows = (t: string, min: number) => Math.max(min, Math.min(200, t.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 60)), 0)));
const btnCls =
  'px-2 py-1 rounded-md text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition inline-flex items-center gap-1 disabled:opacity-40';
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

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

function Meter({ value, min, max, hard, unit = 'ký tự' }: { value: number; min: number; max: number; hard: number; unit?: string }) {
  const pct = Math.min(100, (value / hard) * 100);
  const color = value === 0 ? 'bg-slate-300' : value > max ? 'bg-red-500' : value >= min ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] tabular-nums ${value > max ? 'text-red-600' : 'text-slate-500'}`}>
        {value} {unit} (nên {min}-{max})
      </span>
    </div>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className={panel + ' group'}>
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold text-slate-700 flex items-center justify-between">
        {title}
        <span className="text-slate-400 text-[10px] group-open:rotate-90 transition">▶</span>
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-slate-100">{children}</div>
    </details>
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

/* ---------------- Ảnh xem trước (không tải từ server) ---------------- */

function PreviewImg({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const ok = /^https?:\/\//i.test(src.trim());
  if (!ok || failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-slate-200 text-slate-500 ${className || ''}`}>
        <ImageOff className="h-5 w-5" />
        <span className="text-[10px] px-2 text-center">{!src.trim() ? 'Chưa có ảnh' : !ok ? 'URL ảnh không hợp lệ' : 'Không tải được ảnh'}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src.trim()} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`object-cover ${className || ''}`} />
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u.replace(/^https?:\/\//, '').split('/')[0];
  }
}

function crumbOf(u: string): string {
  try {
    const x = new URL(u);
    const parts = x.pathname.split('/').filter(Boolean);
    return [x.host, ...parts].join(' › ');
  } catch {
    return u;
  }
}

interface PreviewData {
  title: string;
  desc: string;
  url: string;
  image: string;
  imageAlt: string;
  siteName: string;
  themeColor: string;
  favicon: string;
  tw: { card: 'summary' | 'summary_large_image'; title: string; desc: string; image: string; site: string };
}

function GoogleCard({ d, mobile }: { d: PreviewData; mobile: boolean }) {
  const title = d.title || 'Tiêu đề trang';
  const tt = mobile ? truncateByPx(title, 1000) : truncateByPx(title, 580);
  const dd = truncateChars(d.desc || 'Chưa có mô tả. Google sẽ tự lấy một đoạn nội dung từ trang.', mobile ? 130 : 160);
  return (
    <div className={`bg-white border border-slate-200 rounded-lg p-3 ${mobile ? 'max-w-[360px]' : 'max-w-[600px]'}`}>
      <div className="flex items-center gap-2 mb-1">
        <div className="h-6 w-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
          {d.favicon && /^https?:\/\//i.test(d.favicon) ? <PreviewImg key={d.favicon} src={d.favicon} className="h-4 w-4" /> : <Search className="h-3 w-3 text-slate-400" />}
        </div>
        <div className="min-w-0">
          <div className="text-[12px] text-slate-800 truncate">{d.siteName || hostOf(d.url) || 'example.com'}</div>
          <div className="text-[11px] text-slate-500 truncate">{d.url ? crumbOf(d.url) : 'https://example.com › duong-dan'}</div>
        </div>
      </div>
      <div className={`text-[18px] leading-snug text-[#1a0dab] ${tt.truncated ? '' : ''}`} style={{ fontFamily: 'Arial, sans-serif' }}>{tt.text}</div>
      <div className="text-[13px] leading-snug text-slate-600 mt-0.5" style={{ fontFamily: 'Arial, sans-serif' }}>{dd.text}</div>
      {tt.truncated && <div className="text-[10px] text-amber-600 mt-1">Tiêu đề bị cắt ở ~{mobile ? '2 dòng' : '580px'}.</div>}
    </div>
  );
}

function FacebookCard({ d }: { d: PreviewData }) {
  return (
    <div className="max-w-[500px] border border-slate-300 bg-slate-100 overflow-hidden">
      <PreviewImg key={d.image} src={d.image} className="w-full aspect-[1.91/1]" />
      <div className="px-3 py-2 border-t border-slate-300 bg-slate-100">
        <div className="text-[11px] uppercase text-slate-500 truncate">{hostOf(d.url) || 'example.com'}</div>
        <div className="text-[15px] font-semibold text-slate-900 leading-tight line-clamp-2">{d.title || 'Tiêu đề'}</div>
        <div className="text-[13px] text-slate-600 line-clamp-1">{d.desc}</div>
      </div>
    </div>
  );
}

function TwitterPreview({ d }: { d: PreviewData }) {
  const w = d.tw;
  if (w.card === 'summary') {
    return (
      <div className="max-w-[500px] border border-slate-300 rounded-2xl overflow-hidden bg-white flex">
        <PreviewImg key={w.image} src={w.image} className="w-[125px] h-[125px] shrink-0" />
        <div className="p-3 min-w-0 flex flex-col justify-center">
          <div className="text-[12px] text-slate-500 truncate">{hostOf(d.url) || 'example.com'}</div>
          <div className="text-[14px] text-slate-900 font-medium leading-tight line-clamp-1">{w.title || 'Tiêu đề'}</div>
          <div className="text-[13px] text-slate-500 line-clamp-2">{w.desc}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[500px] rounded-2xl overflow-hidden border border-slate-300 bg-white">
      <div className="relative">
        <PreviewImg key={w.image} src={w.image} className="w-full aspect-[2/1]" />
        <div className="absolute left-2 bottom-2 max-w-[85%] bg-black/70 text-white text-[12px] px-2 py-0.5 rounded-md truncate">{w.title || 'Tiêu đề'}</div>
      </div>
      <div className="px-3 py-1.5 text-[12px] text-slate-500 truncate">{hostOf(d.url) || 'example.com'}{w.site ? ` · ${w.site}` : ''}</div>
    </div>
  );
}

function SlackCard({ d }: { d: PreviewData }) {
  return (
    <div className="max-w-[500px] flex gap-0 text-[13px]">
      <div className="w-1 rounded-full bg-slate-300 shrink-0" />
      <div className="pl-3 space-y-0.5 min-w-0">
        <div className="font-bold text-slate-900 text-[12px] truncate">{d.siteName || hostOf(d.url) || 'example.com'}</div>
        <div className="font-bold text-[#1264a3] leading-tight line-clamp-2">{d.title || 'Tiêu đề'}</div>
        <div className="text-slate-700 line-clamp-3">{d.desc}</div>
        {d.image && <PreviewImg key={d.image} src={d.image} className="mt-1 rounded-md max-h-[220px] w-full max-w-[360px] aspect-[1.91/1]" />}
      </div>
    </div>
  );
}

function DiscordCard({ d }: { d: PreviewData }) {
  return (
    <div className="max-w-[440px] rounded-md bg-slate-800 text-slate-100 flex overflow-hidden">
      <div className="w-1 shrink-0" style={{ background: d.themeColor || '#5865f2' }} />
      <div className="p-3 space-y-1 min-w-0">
        {d.siteName && <div className="text-[11px] text-slate-300 truncate">{d.siteName}</div>}
        <div className="text-[14px] font-semibold text-sky-300 leading-tight line-clamp-2">{d.title || 'Tiêu đề'}</div>
        <div className="text-[13px] text-slate-200 line-clamp-3">{d.desc}</div>
        {d.image && <PreviewImg key={d.image} src={d.image} className="rounded-md w-full aspect-[1.91/1] mt-1" />}
      </div>
    </div>
  );
}

/* ---------------- Danh sách vấn đề ---------------- */

const SEV: Record<Issue['severity'], { icon: typeof Info; cls: string }> = {
  error: { icon: AlertCircle, cls: 'text-red-700 bg-red-50 border-red-200' },
  warning: { icon: AlertTriangle, cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  info: { icon: Info, cls: 'text-sky-700 bg-sky-50 border-sky-200' },
  ok: { icon: CheckCircle2, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
};
const SEV_LABEL: Record<Issue['severity'], string> = { error: 'Lỗi', warning: 'Cảnh báo', info: 'Gợi ý', ok: 'Tốt' };

function IssueList({ issues }: { issues: Issue[] }) {
  const order = { error: 0, warning: 1, info: 2, ok: 3 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <ul className="space-y-1">
      {sorted.map((i, k) => {
        const S = SEV[i.severity];
        const Icon = S.icon;
        return (
          <li key={k} className={`flex items-start gap-2 text-xs rounded-md border px-2 py-1.5 ${S.cls}`}>
            <Icon className="h-3.5 w-3.5 mt-px shrink-0" />
            <span><b>{SEV_LABEL[i.severity]}:</b> {i.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- Trang ---------------- */

const OG_TYPES = ['website', 'article', 'product', 'profile', 'book', 'music.song', 'video.other'];
const OUT_TABS = [
  { id: 'html', label: 'HTML' },
  { id: 'doc', label: 'Trang HTML đầy đủ' },
  { id: 'next', label: 'Next.js metadata' },
  { id: 'helmet', label: 'React Helmet' },
  { id: 'nuxt', label: 'Nuxt useHead' },
] as const;
type OutTab = (typeof OUT_TABS)[number]['id'];

let blockSeq = 1;

export default function MetaTagsPage() {
  const [mode, setMode] = useState<'build' | 'analyze'>('build');
  const [s, setS] = useState<MetaState>(() => defaultMetaState());
  const [outTab, setOutTab] = useState<OutTab>('html');
  const [headHtml, setHeadHtml] = useState('');
  const [analysis, setAnalysis] = useState<AnalyzedHead | null>(null);
  const [anaError, setAnaError] = useState('');
  const { showToast } = useApp();

  useEffect(() => {
    const q = readShareParams();
    const g = (k: string) => (q.get(k) || '').slice(0, 600);
    if (!['t', 'd', 'c', 'oi', 'sn', 'tc'].some((k) => q.get(k))) return;
    setS((p) => ({
      ...p,
      title: g('t') || p.title,
      description: g('d') || p.description,
      canonical: g('c') || p.canonical,
      og: { ...p.og, image: g('oi') || p.og.image, siteName: g('sn') || p.og.siteName },
      twitter: { ...p.twitter, card: q.get('tc') === 'summary' ? 'summary' : p.twitter.card },
    }));
  }, []);

  const upd = (fn: (d: MetaState) => void) =>
    setS((prev) => {
      const n = structuredClone(prev);
      fn(n);
      return n;
    });

  const issues = useMemo(() => validateMeta(s), [s]);
  const outputs = useMemo(
    () => ({
      html: renderHtml(s),
      doc: renderHtmlDocument(s),
      next: nextMetadata(s),
      helmet: reactHelmet(s),
      nuxt: nuxtUseHead(s),
    }),
    [s]
  );

  const pd: PreviewData = useMemo(() => {
    const title = s.og.title.trim() || s.title.trim();
    const desc = s.og.description.trim() || s.description.trim();
    const image = s.og.image.trim();
    return {
      title,
      desc,
      url: s.og.url.trim() || s.canonical.trim(),
      image,
      imageAlt: s.og.imageAlt,
      siteName: s.og.siteName.trim(),
      themeColor: s.themeColor.trim(),
      favicon: s.favicon.trim(),
      tw: {
        card: s.twitter.card,
        title: s.twitter.title.trim() || title,
        desc: s.twitter.description.trim() || desc,
        image: s.twitter.image.trim() || image,
        site: s.twitter.site.trim(),
      },
    };
  }, [s]);

  const titlePx = estimateTitlePx(s.title.trim());

  const addBlock = (type: JsonLdType) =>
    upd((d) => {
      d.jsonld.push({ id: 'b' + blockSeq++, type, f: {}, items: type === 'BreadcrumbList' || type === 'FAQPage' ? [{ a: '', b: '' }] : [] });
    });

  const runAnalyze = () => {
    setAnaError('');
    setAnalysis(null);
    const html = headHtml.trim();
    if (!html) {
      setAnaError('Hãy dán mã HTML (phần <head> hoặc cả trang).');
      return;
    }
    if (html.length > MAX_HEAD_HTML) {
      setAnaError(`HTML quá lớn (tối đa ${MAX_HEAD_HTML.toLocaleString('vi-VN')} ký tự).`);
      return;
    }
    try {
      // DOMParser tạo tài liệu "inert": script không chạy, ảnh không tải
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const els: FlatEl[] = [];
      doc.querySelectorAll('title, meta, link, script').forEach((el) => {
        const attrs: Record<string, string> = {};
        for (const a of Array.from(el.attributes)) attrs[a.name.toLowerCase()] = a.value;
        els.push({ tag: el.tagName.toLowerCase(), attrs, text: el.textContent || '' });
      });
      const hasHtmlTag = /<html[\s>]/i.test(html);
      setAnalysis(analyzeHeadElements(els, hasHtmlTag ? doc.documentElement.getAttribute('lang') || '' : ''));
    } catch {
      setAnaError('Không phân tích được đoạn HTML này.');
    }
  };

  const shareParams = {
    t: s.title.slice(0, 200),
    d: s.description.slice(0, 400),
    c: s.canonical,
    oi: s.og.image,
    sn: s.og.siteName,
    tc: s.twitter.card,
  };

  const T = (path: 'title' | 'description' | 'canonical' | 'author' | 'themeColor' | 'favicon' | 'appleTouchIcon' | 'manifest' | 'lang' | 'charset' | 'viewport', label: string, ph = '') => (
    <Field label={label}>
      <input className={inputCls} placeholder={ph} value={s[path]} onChange={(e) => upd((d) => { d[path] = e.target.value; })} />
    </Field>
  );
  const OG = (k: keyof MetaState['og'], label: string, ph = '') => (
    <Field label={label}>
      <input className={inputCls} placeholder={ph} value={s.og[k] as string} onChange={(e) => upd((d) => { (d.og as Record<string, unknown>)[k] = e.target.value; })} />
    </Field>
  );

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Tags className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Meta Tags & Social Preview</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Sinh khối &lt;head&gt; SEO / Open Graph / Twitter Card / JSON-LD, xem trước Google, Facebook, X, Slack, Discord và kiểm tra lỗi.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShareLinkButton params={shareParams} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1" />
          <button
            onClick={() => { setS(sampleMetaState()); setMode('build'); }}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
          >
            <Sparkles className="h-3 w-3 text-amber-400" />
            Dùng mẫu thử
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {([['build', 'Tạo thẻ'], ['analyze', 'Phân tích HTML']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} className={`px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 transition ${mode === id ? 'border-indigo-600 text-indigo-700 bg-indigo-50' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'analyze' && (
        <div className="space-y-3">
          <div className={panel + ' p-3 space-y-2'}>
            <label className="text-xs font-semibold text-slate-600">Dán HTML của trang (hoặc chỉ phần &lt;head&gt;)</label>
            <textarea
              rows={Math.max(9, Math.min(3000, headHtml.split('\n').length + 1))}
              spellCheck={false}
              value={headHtml}
              onChange={(e) => setHeadHtml(e.target.value)}
              placeholder={'<head>\n  <title>...</title>\n  <meta name="description" content="...">\n  <meta property="og:image" content="...">\n</head>'}
              className={inputCls + ' font-mono resize-none overflow-x-auto overflow-y-hidden whitespace-pre'}
            />
            <div className="flex items-center gap-2">
              <button className={btnCls + ' bg-indigo-600! text-white! border-indigo-600!'} onClick={runAnalyze}>Phân tích</button>
              <span className="text-[11px] text-slate-500">HTML được đọc trong tài liệu trơ (DOMParser): không chạy script, không tải ảnh.</span>
            </div>
            {anaError && <div className="text-xs text-red-600">{anaError}</div>}
          </div>
          {analysis && (
            <>
              <div className={panel + ' p-3 space-y-2'}>
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold text-slate-700">Kiểm tra</h2>
                  <button
                    className={btnCls}
                    onClick={() => { setS(analysis.state); setMode('build'); showToast('Đã nạp vào trình tạo thẻ.'); }}
                  >
                    Nạp vào trình tạo & xem trước
                  </button>
                </div>
                <IssueList issues={auditAnalyzed(analysis)} />
              </div>
              <div className={panel + ' p-3 space-y-2'}>
                <h2 className="text-xs font-bold text-slate-700">Thẻ tìm thấy ({analysis.tags.length})</h2>
                <div className="overflow-x-auto border border-slate-200 rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="px-2 py-1">Loại</th><th className="px-2 py-1">Tên / rel</th><th className="px-2 py-1">Giá trị</th></tr></thead>
                    <tbody>
                      {analysis.tags.map((t, i) => (
                        <tr key={i} className="border-t border-slate-100 align-top">
                          <td className="px-2 py-1 text-slate-500">{t.tag}</td>
                          <td className="px-2 py-1 font-mono">{t.key}</td>
                          <td className="px-2 py-1 font-mono break-all">{t.value}</td>
                        </tr>
                      ))}
                      {analysis.tags.length === 0 && <tr><td colSpan={3} className="px-2 py-3 text-center text-slate-500">Không tìm thấy thẻ title/meta/link nào.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {analysis.jsonLd.length > 0 && (
                  <div className="space-y-1">
                    <h3 className="text-[11px] font-semibold text-slate-600">JSON-LD</h3>
                    {analysis.jsonLd.map((j, i) => (
                      <details key={i} className="text-xs border border-slate-200 rounded-md">
                        <summary className={`cursor-pointer px-2 py-1 ${j.valid ? 'text-emerald-700' : 'text-red-700'}`}>{j.valid ? `@type: ${j.type}` : `JSON lỗi: ${j.error}`}</summary>
                        <pre className="p-2 bg-slate-900 text-slate-100 overflow-x-auto whitespace-pre-wrap break-all">{j.raw}</pre>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'build' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5 items-start">
          {/* FORM */}
          <div className="space-y-2.5">
            <Section title="Cơ bản & SEO" defaultOpen>
              <Field label="Tiêu đề trang (title)">
                <input className={inputCls} value={s.title} onChange={(e) => upd((d) => { d.title = e.target.value; })} placeholder="Tên trang - Thương hiệu" />
                <Meter value={[...s.title.trim()].length} min={50} max={60} hard={80} />
                <Meter value={titlePx} min={450} max={580} hard={700} unit="px (ước tính)" />
              </Field>
              <Field label="Mô tả (meta description)">
                <textarea className={inputCls + ' resize-none overflow-hidden'} rows={autoRows(s.description, 3)} value={s.description} onChange={(e) => upd((d) => { d.description = e.target.value; })} placeholder="Tóm tắt 150-160 ký tự về nội dung trang" />
                <Meter value={[...s.description.trim()].length} min={150} max={160} hard={200} />
              </Field>
              {T('canonical', 'Canonical URL', 'https://example.com/trang')}
              <div className="grid grid-cols-2 gap-2">
                {T('lang', 'Ngôn ngữ (html lang)', 'vi')}
                {T('charset', 'Charset', 'utf-8')}
              </div>
              {T('viewport', 'Viewport')}
              <div className="grid grid-cols-2 gap-2">
                {T('themeColor', 'theme-color', '#0f172a')}
                {T('author', 'Tác giả (author)')}
              </div>
            </Section>

            <Section title="Robots">
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                <Check2 checked={s.robots.index} onChange={(v) => upd((d) => { d.robots.index = v; })}>index</Check2>
                <Check2 checked={s.robots.follow} onChange={(v) => upd((d) => { d.robots.follow = v; })}>follow</Check2>
                <Check2 checked={s.robots.noarchive} onChange={(v) => upd((d) => { d.robots.noarchive = v; })}>noarchive</Check2>
                <Check2 checked={s.robots.nosnippet} onChange={(v) => upd((d) => { d.robots.nosnippet = v; })}>nosnippet</Check2>
                <Check2 checked={s.robots.noimageindex} onChange={(v) => upd((d) => { d.robots.noimageindex = v; })}>noimageindex</Check2>
                <Check2 checked={s.robots.notranslate} onChange={(v) => upd((d) => { d.robots.notranslate = v; })}>notranslate</Check2>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="max-snippet"><input className={inputCls} inputMode="numeric" placeholder="-1" value={s.robots.maxSnippet} onChange={(e) => upd((d) => { d.robots.maxSnippet = e.target.value; })} /></Field>
                <Field label="max-image-preview">
                  <Select className={inputCls} value={s.robots.maxImagePreview} onChange={(e) => upd((d) => { d.robots.maxImagePreview = e.target.value as MetaState['robots']['maxImagePreview']; })}>
                    <option value="">(không đặt)</option><option value="none">none</option><option value="standard">standard</option><option value="large">large</option>
                  </Select>
                </Field>
                <Field label="max-video-preview"><input className={inputCls} inputMode="numeric" placeholder="-1" value={s.robots.maxVideoPreview} onChange={(e) => upd((d) => { d.robots.maxVideoPreview = e.target.value; })} /></Field>
              </div>
              <p className="text-[11px] text-slate-500">Mặc định index, follow thì thẻ robots được lược bỏ.</p>
            </Section>

            <Section title="Biểu tượng & liên kết">
              {T('favicon', 'Favicon URL', 'https://example.com/favicon.ico')}
              {T('appleTouchIcon', 'apple-touch-icon URL (180x180)')}
              {T('manifest', 'Web app manifest URL')}
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-slate-600">Preconnect (chỉ origin)</div>
                {s.preconnect.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input className={inputCls} placeholder="https://fonts.gstatic.com" value={p.href} onChange={(e) => upd((d) => { d.preconnect[i].href = e.target.value; })} />
                    <Check2 checked={p.crossorigin} onChange={(v) => upd((d) => { d.preconnect[i].crossorigin = v; })}>crossorigin</Check2>
                    <button className="p-1 text-slate-500 hover:text-red-600" onClick={() => upd((d) => { d.preconnect.splice(i, 1); })}><Trash2 className="h-3 w-3" /></button>
                  </div>
                ))}
                <button className={btnCls} onClick={() => upd((d) => { d.preconnect.push({ href: '', crossorigin: false }); })}><Plus className="h-3 w-3" />Thêm preconnect</button>
              </div>
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-slate-600">hreflang (bản ngôn ngữ khác)</div>
                {s.alternates.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input className={inputCls + ' w-24'} placeholder="en" value={a.hreflang} onChange={(e) => upd((d) => { d.alternates[i].hreflang = e.target.value; })} />
                    <input className={inputCls} placeholder="https://example.com/en/" value={a.href} onChange={(e) => upd((d) => { d.alternates[i].href = e.target.value; })} />
                    <button className="p-1 text-slate-500 hover:text-red-600" onClick={() => upd((d) => { d.alternates.splice(i, 1); })}><Trash2 className="h-3 w-3" /></button>
                  </div>
                ))}
                <button className={btnCls} onClick={() => upd((d) => { d.alternates.push({ hreflang: '', href: '' }); })}><Plus className="h-3 w-3" />Thêm hreflang</button>
              </div>
            </Section>

            <Section title="Open Graph (Facebook, LinkedIn, Slack...)" defaultOpen>
              <Check2 checked={s.og.enabled} onChange={(v) => upd((d) => { d.og.enabled = v; })}>Xuất thẻ Open Graph</Check2>
              <p className="text-[11px] text-slate-500">Để trống og:title / og:description / og:url sẽ lấy theo title / description / canonical.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {OG('title', 'og:title')}
                {OG('siteName', 'og:site_name')}
              </div>
              <Field label="og:description"><textarea rows={autoRows(s.og.description, 2)} className={inputCls + ' resize-none overflow-hidden'} value={s.og.description} onChange={(e) => upd((d) => { d.og.description = e.target.value; })} /></Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="og:type">
                  <input list="og-types" className={inputCls} value={s.og.type} onChange={(e) => upd((d) => { d.og.type = e.target.value; })} />
                  <datalist id="og-types">{OG_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
                </Field>
                {OG('locale', 'og:locale', 'vi_VN')}
                {OG('url', 'og:url')}
                {OG('image', 'og:image (URL tuyệt đối, 1200x630)', 'https://example.com/og.png')}
                {OG('imageAlt', 'og:image:alt')}
                <div className="grid grid-cols-2 gap-2">
                  {OG('imageWidth', 'Rộng', '1200')}
                  {OG('imageHeight', 'Cao', '630')}
                </div>
              </div>
              {s.og.type === 'article' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 rounded-md bg-slate-50 border border-slate-200">
                  <Field label="article:published_time"><input className={inputCls} placeholder="2025-01-31T08:00:00+07:00" value={s.article.publishedTime} onChange={(e) => upd((d) => { d.article.publishedTime = e.target.value; })} /></Field>
                  <Field label="article:modified_time"><input className={inputCls} value={s.article.modifiedTime} onChange={(e) => upd((d) => { d.article.modifiedTime = e.target.value; })} /></Field>
                  <Field label="article:author"><input className={inputCls} value={s.article.author} onChange={(e) => upd((d) => { d.article.author = e.target.value; })} /></Field>
                  <Field label="article:section"><input className={inputCls} value={s.article.section} onChange={(e) => upd((d) => { d.article.section = e.target.value; })} /></Field>
                  <Field label="article:tag (cách nhau bằng dấu phẩy)"><input className={inputCls} value={s.article.tags} onChange={(e) => upd((d) => { d.article.tags = e.target.value; })} /></Field>
                </div>
              )}
            </Section>

            <Section title="Twitter / X Card">
              <Check2 checked={s.twitter.enabled} onChange={(v) => upd((d) => { d.twitter.enabled = v; })}>Xuất thẻ Twitter Card</Check2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="twitter:card">
                  <Select className={inputCls} value={s.twitter.card} onChange={(e) => upd((d) => { d.twitter.card = e.target.value as 'summary' | 'summary_large_image'; })}>
                    <option value="summary_large_image">summary_large_image</option>
                    <option value="summary">summary</option>
                  </Select>
                </Field>
                <span />
                <Field label="twitter:site"><input className={inputCls} placeholder="@tenban" value={s.twitter.site} onChange={(e) => upd((d) => { d.twitter.site = e.target.value; })} /></Field>
                <Field label="twitter:creator"><input className={inputCls} placeholder="@tacgia" value={s.twitter.creator} onChange={(e) => upd((d) => { d.twitter.creator = e.target.value; })} /></Field>
                <Field label="twitter:title (tùy chọn)"><input className={inputCls} value={s.twitter.title} onChange={(e) => upd((d) => { d.twitter.title = e.target.value; })} /></Field>
                <Field label="twitter:image (tùy chọn)"><input className={inputCls} value={s.twitter.image} onChange={(e) => upd((d) => { d.twitter.image = e.target.value; })} /></Field>
              </div>
              <Field label="twitter:description (tùy chọn)"><input className={inputCls} value={s.twitter.description} onChange={(e) => upd((d) => { d.twitter.description = e.target.value; })} /></Field>
              <p className="text-[11px] text-slate-500">X tự dùng og:title / og:description / og:image nếu thiếu thẻ twitter:*.</p>
            </Section>

            <Section title="Dữ liệu có cấu trúc JSON-LD">
              <div className="flex flex-wrap gap-1">
                {(Object.keys(JSONLD_FIELDS) as JsonLdType[]).map((t) => (
                  <button key={t} className={btnCls} onClick={() => addBlock(t)}><Plus className="h-3 w-3" />{t}</button>
                ))}
              </div>
              {s.jsonld.length === 0 && <p className="text-[11px] text-slate-500">Chưa có khối nào. Chọn một loại ở trên để thêm.</p>}
              {s.jsonld.map((b: JsonLdBlock, bi) => (
                <div key={b.id} className="border border-slate-200 rounded-lg p-2 space-y-2 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-700">{b.type}</span>
                    <button className="p-1 text-slate-500 hover:text-red-600" onClick={() => upd((d) => { d.jsonld.splice(bi, 1); })}><Trash2 className="h-3 w-3" /></button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {JSONLD_FIELDS[b.type].map((f) => (
                      <Field key={f.key} label={f.label}>
                        {f.multiline ? (
                          <textarea rows={autoRows(b.f[f.key] || '', 2)} className={inputCls + ' resize-none overflow-hidden'} value={b.f[f.key] || ''} onChange={(e) => upd((d) => { d.jsonld[bi].f[f.key] = e.target.value; })} />
                        ) : (
                          <input className={inputCls} placeholder={f.placeholder} value={b.f[f.key] || ''} onChange={(e) => upd((d) => { d.jsonld[bi].f[f.key] = e.target.value; })} />
                        )}
                      </Field>
                    ))}
                  </div>
                  {(b.type === 'BreadcrumbList' || b.type === 'FAQPage') && (
                    <div className="space-y-1.5">
                      {b.items.map((it, ii) => (
                        <div key={ii} className="flex items-start gap-2">
                          <span className="text-[10px] text-slate-400 pt-1.5 w-4">{ii + 1}</span>
                          <input className={inputCls} placeholder={b.type === 'FAQPage' ? 'Câu hỏi' : 'Tên mục'} value={it.a} onChange={(e) => upd((d) => { d.jsonld[bi].items[ii].a = e.target.value; })} />
                          {b.type === 'FAQPage' ? (
                            <textarea rows={autoRows(it.b, 2)} className={inputCls + ' resize-none overflow-hidden'} placeholder="Câu trả lời" value={it.b} onChange={(e) => upd((d) => { d.jsonld[bi].items[ii].b = e.target.value; })} />
                          ) : (
                            <input className={inputCls} placeholder="URL" value={it.b} onChange={(e) => upd((d) => { d.jsonld[bi].items[ii].b = e.target.value; })} />
                          )}
                          <button className="p-1 text-slate-500 hover:text-red-600" onClick={() => upd((d) => { d.jsonld[bi].items.splice(ii, 1); })}><Trash2 className="h-3 w-3" /></button>
                        </div>
                      ))}
                      <button className={btnCls} onClick={() => upd((d) => { d.jsonld[bi].items.push({ a: '', b: '' }); })}><Plus className="h-3 w-3" />Thêm dòng</button>
                    </div>
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-600">Xem JSON-LD của khối này</summary>
                    <pre className="mt-1 p-2 rounded-md bg-slate-900 text-slate-100 overflow-x-auto whitespace-pre-wrap break-all">{(() => { const j = buildJsonLd(b); return j ? safeJsonForScript(j) : '(trống)'; })()}</pre>
                  </details>
                </div>
              ))}
            </Section>
          </div>

          {/* OUTPUT + PREVIEW */}
          <div className="space-y-3.5 xl:sticky xl:top-3">
            <div className={panel + ' p-3 space-y-2'}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {OUT_TABS.map((t) => (
                    <button key={t.id} onClick={() => setOutTab(t.id)} className={`px-2 py-1 text-[11px] font-medium rounded-md border transition ${outTab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`}>{t.label}</button>
                  ))}
                </div>
                <CopyBtn text={outputs[outTab]} />
              </div>
              <pre className="text-xs font-mono p-2.5 rounded-md bg-slate-900 text-slate-100 overflow-x-auto whitespace-pre">{outputs[outTab] || '(chưa có dữ liệu)'}</pre>
            </div>

            <div className={panel + ' p-3 space-y-3'}>
              <h2 className="text-xs font-bold text-slate-700">Xem trước (vẽ bằng HTML/CSS, ảnh tải trực tiếp từ trình duyệt của bạn)</h2>
              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1">Google - máy tính</div>
                <GoogleCard d={pd} mobile={false} />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1">Google - di động</div>
                <GoogleCard d={pd} mobile />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1">Facebook / LinkedIn</div>
                <FacebookCard d={pd} />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1">X / Twitter ({pd.tw.card})</div>
                <TwitterPreview d={pd} />
                <div className="text-[11px] font-semibold text-slate-500 mt-2 mb-1">X / Twitter ({pd.tw.card === 'summary' ? 'summary_large_image' : 'summary'}) để so sánh</div>
                <TwitterPreview d={{ ...pd, tw: { ...pd.tw, card: pd.tw.card === 'summary' ? 'summary_large_image' : 'summary' } }} />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1">Slack</div>
                <SlackCard d={pd} />
              </div>
              <div className="bg-slate-100 rounded-md p-2">
                <div className="text-[11px] font-semibold text-slate-500 mb-1">Discord (màu viền = theme-color)</div>
                <DiscordCard d={pd} />
              </div>
            </div>

            <div className={panel + ' p-3 space-y-2'}>
              <h2 className="text-xs font-bold text-slate-700">Kiểm tra</h2>
              <IssueList issues={issues} />
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Mẹo: ảnh og:image nên 1200x630 (tỉ lệ 1.91:1), dưới 5 MB và dùng https. Facebook/X lưu cache thẻ: sau khi đổi, hãy dùng công cụ debug của họ để làm mới. Mọi giá trị đều được escape HTML (&amp; &lt; &quot;) khi xuất.
      </p>
    </div>
  );
}
