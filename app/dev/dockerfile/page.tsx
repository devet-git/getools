'use client';

import { Select } from '@/components/ui/searchable-select';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  Copy,
  Check,
  Download,
  Trash2,
  Sparkles,
  Upload,
  Wrench,
  TriangleAlert,
  CircleAlert,
  Info,
  Palette,
  ShieldCheck,
  FileCode,
  ArrowRight,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  DEFAULT_GEN,
  RULES,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  STACKS,
  VARIANT_LABEL,
  VARIANT_IDS,
  STACK_IDS,
  applyAllFixes,
  applyFix,
  defaultImages,
  generateDockerfile,
  lintDockerfile,
  sanitizeOptions,
  stackDef,
  autoValues,
  type GenOptions,
  type InitMode,
  type LintIssue,
  type Severity,
  type StackId,
  type Variant,
} from '@/lib/dockerfile-tools';

const MAX_UPLOAD = 1024 * 1024;

const SAMPLE_BAD = `FROM node
MAINTAINER dev@example.com
ENV DB_PASSWORD=supersecret
WORKDIR app
COPY . .
RUN npm install
RUN apt-get update
RUN apt-get install curl
RUN curl -fsSL https://example.com/install.sh | sh
RUN cd /tmp && chmod -R 777 /app
ADD config.json /app/
EXPOSE 99999
CMD npm start
`;

const SEV_STYLE: Record<Severity, { chip: string; row: string; gutter: string; icon: string }> = {
  error: { chip: 'bg-red-100 text-red-700', row: 'bg-red-500/15', gutter: 'bg-red-500/30 text-red-200', icon: 'text-red-500' },
  warning: { chip: 'bg-amber-100 text-amber-700', row: 'bg-amber-500/15', gutter: 'bg-amber-500/30 text-amber-200', icon: 'text-amber-500' },
  info: { chip: 'bg-indigo-100 text-indigo-700', row: 'bg-indigo-500/15', gutter: 'bg-indigo-500/30 text-indigo-200', icon: 'text-indigo-500' },
  style: { chip: 'bg-slate-200 text-slate-700', row: 'bg-slate-500/15', gutter: 'bg-slate-500/40 text-slate-200', icon: 'text-slate-400' },
};

function SevIcon({ sev, className = 'h-3.5 w-3.5' }: { sev: Severity; className?: string }) {
  const cls = `${className} shrink-0 ${SEV_STYLE[sev].icon}`;
  if (sev === 'error') return <CircleAlert className={cls} />;
  if (sev === 'warning') return <TriangleAlert className={cls} />;
  if (sev === 'info') return <Info className={cls} />;
  return <Palette className={cls} />;
}

function Toggle({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <label data-tooltip={title} className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium text-xs">
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

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-semibold text-slate-600 mb-0.5">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-slate-400 mt-0.5 leading-tight">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400';

/* ---------------- Code view có số dòng & đánh dấu ---------------- */

const KEYWORD_RE = /^(\s*)(FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/i;
const MAX_RENDER_LINES = 3000;
const FIT_H = 'max-h-[560px] lg:max-h-none lg:flex-1 lg:min-h-0';

function CodeView({
  text,
  issues,
  selected,
  onSelectLine,
  maxHeight = 'max-h-[560px]',
}: {
  text: string;
  issues: LintIssue[];
  selected: LintIssue | null;
  onSelectLine?: (line: number) => void;
  maxHeight?: string;
}) {
  const lines = useMemo(() => text.split(/\r\n|\n/), [text]);
  const worst = useMemo(() => {
    const m = new Map<number, Severity>();
    for (const it of issues) {
      for (let l = it.line; l <= Math.min(it.endLine, it.line + 40); l++) {
        const cur = m.get(l);
        if (!cur || SEVERITY_ORDER.indexOf(it.severity) < SEVERITY_ORDER.indexOf(cur)) m.set(l, it.severity);
      }
    }
    return m;
  }, [issues]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected || !boxRef.current) return;
    const el = boxRef.current.querySelector<HTMLElement>(`[data-ln="${selected.line}"]`);
    if (el) boxRef.current.scrollTo({ top: Math.max(0, el.offsetTop - boxRef.current.clientHeight / 3), behavior: 'smooth' });
  }, [selected]);

  const shown = lines.length > MAX_RENDER_LINES ? lines.slice(0, MAX_RENDER_LINES) : lines;
  return (
    <div ref={boxRef} className={`relative ${maxHeight} overflow-auto bg-slate-900 text-slate-100 rounded-lg border border-slate-700 font-mono text-[12px] leading-5`}>
      <div className="min-w-max">
        {shown.map((ln, i) => {
          const no = i + 1;
          const sev = worst.get(no);
          const isSel = !!selected && no >= selected.line && no <= selected.endLine;
          const trimmed = ln.trimStart();
          const km = KEYWORD_RE.exec(ln);
          return (
            <div
              key={i}
              data-ln={no}
              onClick={() => onSelectLine?.(no)}
              className={`flex ${isSel ? 'bg-amber-400/25 outline outline-1 outline-amber-400/60' : sev ? SEV_STYLE[sev].row : ''} ${onSelectLine ? 'cursor-pointer' : ''}`}
            >
              <span className={`w-12 shrink-0 select-none text-right pr-2 ${sev ? SEV_STYLE[sev].gutter : 'text-slate-500 bg-slate-800/60'}`}>{no}</span>
              <span className="pl-3 pr-4 whitespace-pre">
                {trimmed.startsWith('#') ? (
                  <span className="text-slate-500">{ln || ' '}</span>
                ) : km ? (
                  <>
                    {km[1]}
                    <span className="text-emerald-300 font-semibold">{ln.slice(km[1].length, km[0].length)}</span>
                    {ln.slice(km[0].length) || ' '}
                  </>
                ) : (
                  ln || ' '
                )}
              </span>
            </div>
          );
        })}
        {lines.length > MAX_RENDER_LINES && (
          <div className="px-3 py-2 text-amber-300 text-xs">… đã ẩn {lines.length - MAX_RENDER_LINES} dòng còn lại để trang không bị chậm.</div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Tổng quan & danh sách lỗi ---------------- */

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 90 ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : score >= 70 ? 'text-amber-600 border-amber-300 bg-amber-50' : 'text-red-600 border-red-300 bg-red-50';
  return (
    <div className={`h-12 w-12 rounded-full border-2 flex flex-col items-center justify-center shrink-0 ${tone}`} data-tooltip="Điểm = 100 − (15 × lỗi + 6 × cảnh báo + 2 × gợi ý + 1 × phong cách)">
      <span className="text-base font-bold leading-none">{score}</span>
      <span className="text-[8px] uppercase tracking-wider">điểm</span>
    </div>
  );
}

function Summary({
  counts,
  score,
  filter,
  onFilter,
}: {
  counts: Record<Severity, number>;
  score: number;
  filter: Severity | null;
  onFilter: (s: Severity | null) => void;
}) {
  const total = counts.error + counts.warning + counts.info + counts.style;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ScoreBadge score={score} />
      <div className="min-w-0">
        <div className="text-sm font-bold text-slate-800">
          {total === 0 ? 'Không phát hiện vấn đề nào' : `${total} vấn đề được phát hiện`}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {SEVERITY_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => onFilter(filter === s ? null : s)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1 border transition ${SEV_STYLE[s].chip} ${filter === s ? 'border-slate-500' : 'border-transparent'} ${counts[s] === 0 ? 'opacity-50' : ''}`}
              data-tooltip="Bấm để lọc theo mức độ"
            >
              <SevIcon sev={s} className="h-3 w-3" />
              {counts[s]} {SEVERITY_LABEL[s].toLowerCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function IssueList({
  issues,
  selectedKey,
  onSelect,
  onApplyFix,
  canFix,
  maxHeight = 'max-h-[560px]',
}: {
  maxHeight?: string;
  issues: LintIssue[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onApplyFix?: (issue: LintIssue) => void;
  canFix: boolean;
}) {
  if (!issues.length) return <div className="text-xs text-slate-500 p-3">Không có vấn đề nào ở mức độ này.</div>;
  return (
    <ul className={`divide-y divide-slate-100 ${maxHeight} overflow-auto`}>
      {issues.map((it) => {
        const key = `${it.id}:${it.line}:${it.message}`;
        const sel = key === selectedKey;
        return (
          <li key={key} className={sel ? 'bg-amber-50' : ''}>
            <button onClick={() => onSelect(key)} className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-slate-50 transition">
              <SevIcon sev={it.severity} className="h-4 w-4 mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-mono font-bold text-slate-800">{it.id}</span>
                  <span className={`px-1.5 rounded ${SEV_STYLE[it.severity].chip}`}>{SEVERITY_LABEL[it.severity]}</span>
                  <span className="text-slate-500">dòng {it.line}{it.endLine > it.line ? `–${it.endLine}` : ''}</span>
                </span>
                <span className="block text-xs text-slate-800 mt-0.5">{it.message}</span>
              </span>
            </button>
            {sel && (
              <div className="px-3 pb-3 pl-9 space-y-2">
                <p className="text-xs text-slate-600 leading-relaxed">{it.explain}</p>
                {it.fix && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2">
                    <div className="text-[11px] font-semibold text-emerald-800 flex items-center gap-1">
                      <Wrench className="h-3 w-3" /> Gợi ý sửa{it.fix.safe ? '' : ' (cần kiểm tra lại)'}: {it.fix.description}
                    </div>
                    <pre className="mt-1 text-[11px] font-mono bg-slate-900 text-emerald-200 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">{it.fix.replacement}</pre>
                    {canFix && onApplyFix && (
                      <button
                        onClick={() => onApplyFix(it)}
                        className="mt-1.5 px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition"
                      >
                        Áp dụng sửa này
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- Trang chính ---------------- */

type Tab = 'gen' | 'lint';
type OutTab = 'dockerfile' | 'ignore' | 'cmd' | 'compose' | 'extra' | 'notes';

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const SHARE_KEYS: [keyof GenOptions, string][] = [
  ['stack', 's'], ['variant', 'v'], ['pm', 'pm'], ['framework', 'fw'], ['port', 'p'], ['appDir', 'd'], ['uid', 'u'], ['appName', 'n'],
  ['entry', 'e'], ['buildCmd', 'b'], ['outDir', 'o'], ['testCmd', 't'], ['healthPath', 'h'], ['buildImage', 'bi'], ['runImage', 'ri'],
  ['tz', 'tz'], ['buildArgs', 'ba'], ['repoUrl', 'ru'],
];
const SHARE_FLAGS: [keyof GenOptions, string][] = [
  ['buildkit', 'bk'], ['healthcheck', 'hc'], ['labels', 'lb'], ['tests', 'ts'], ['multiarch', 'ma'], ['spa', 'spa'],
];

export default function DockerfilePage() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<Tab>('gen');
  const [opts, setOpts] = useState<GenOptions>(DEFAULT_GEN);
  const [outTab, setOutTab] = useState<OutTab>('dockerfile');
  const [copied, setCopied] = useState<string | null>(null);

  const [lintText, setLintText] = useState('');
  const [ignoreText, setIgnoreText] = useState('');
  const [view, setView] = useState<'edit' | 'view'>('edit');
  const [filter, setFilter] = useState<Severity | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [genSelKey, setGenSelKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Khởi tạo từ URL
  useEffect(() => {
    const q = readShareParams();
    /* eslint-disable react-hooks/set-state-in-effect */
    const next: Partial<GenOptions> = {};
    const stack = q.get('s');
    if (stack && STACK_IDS.has(stack)) next.stack = stack as StackId;
    const variant = q.get('v');
    if (variant && VARIANT_IDS.has(variant)) next.variant = variant as Variant;
    for (const [k, p] of SHARE_KEYS) {
      if (k === 'stack' || k === 'variant') continue;
      const v = q.get(p);
      if (v !== null) (next as Record<string, unknown>)[k] = v;
    }
    for (const [k, p] of SHARE_FLAGS) {
      const v = q.get(p);
      if (v === '0' || v === '1') (next as Record<string, unknown>)[k] = v === '1';
    }
    const init = q.get('i');
    if (init === 'tini' || init === 'dumb-init' || init === 'none') next.init = init as InitMode;
    if (Object.keys(next).length) setOpts((o) => ({ ...o, ...next }));
    if (q.get('tab') === 'lint') setTab('lint');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const set = <K extends keyof GenOptions>(k: K, v: GenOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const setStack = (id: StackId) => {
    const def = stackDef(id);
    setOpts((o) => ({
      ...o,
      stack: id,
      variant: def.variants[0],
      pm: def.pms[0]?.id ?? '',
      framework: def.frameworks[0]?.id ?? '',
      entry: '',
      buildCmd: '',
      outDir: '',
      testCmd: '',
      healthPath: '',
      port: '',
      buildImage: '',
      runImage: '',
    }));
  };

  const def = stackDef(opts.stack);
  const gen = useMemo(() => generateDockerfile(opts), [opts]);
  const eff = gen.options;
  const auto = useMemo(() => autoValues(sanitizeOptions({ ...opts, variant: def.variants.includes(opts.variant) ? opts.variant : def.variants[0] })), [opts, def]);
  const imgDefaults = useMemo(() => defaultImages({ ...opts, buildImage: '', runImage: '' }), [opts]);
  const genLint = useMemo(() => lintDockerfile(gen.dockerfile), [gen.dockerfile]);

  const deferredLint = useDeferredValue(lintText);
  const ignoreList = useMemo(() => ignoreText.split(/[\s,;]+/).filter(Boolean), [ignoreText]);
  const lint = useMemo(() => lintDockerfile(deferredLint, { ignore: ignoreList }), [deferredLint, ignoreList]);

  const shareParams = useMemo(() => {
    const p: Record<string, string> = { tab: tab === 'lint' ? 'lint' : '' };
    const e = gen.options;
    for (const [k, short] of SHARE_KEYS) {
      const raw = opts[k] as string;
      if (k === 'stack' || k === 'variant') p[short] = String(e[k]);
      else if (raw) p[short] = raw;
    }
    for (const [k, short] of SHARE_FLAGS) if (opts[k] !== DEFAULT_GEN[k]) p[short] = opts[k] ? '1' : '0';
    if (opts.init !== 'none') p.i = opts.init;
    return p;
  }, [opts, gen.options, tab]);

  const copy = async (text: string, id: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      showToast('Đã sao chép!');
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD) {
      showToast('File quá lớn (tối đa 1MB).');
      return;
    }
    file.text().then((t) => {
      setLintText(t);
      setSelKey(null);
      showToast(`Đã nạp ${file.name}`);
    }).catch(() => showToast('Không đọc được file.'));
  };

  const issuesFiltered = (issues: LintIssue[], f: Severity | null) => (f ? issues.filter((i) => i.severity === f) : issues);
  const keyOf = (i: LintIssue) => `${i.id}:${i.line}:${i.message}`;

  const lintIssues = issuesFiltered(lint.issues, filter);
  const lintSelected = lint.issues.find((i) => keyOf(i) === selKey) ?? null;
  const genIssues = genLint.issues;
  const genSelected = genIssues.find((i) => keyOf(i) === genSelKey) ?? null;

  const fixCount = lint.issues.filter((i) => i.fix?.safe).length;
  const fixAnyCount = lint.issues.filter((i) => i.fix).length;

  const outputs: Record<OutTab, { label: string; text: string; file: string }> = {
    dockerfile: { label: 'Dockerfile', text: gen.dockerfile, file: 'Dockerfile' },
    ignore: { label: '.dockerignore', text: gen.dockerignore, file: '.dockerignore' },
    cmd: { label: 'Lệnh build / run', text: gen.commands, file: 'docker-commands.sh' },
    compose: { label: 'docker-compose', text: gen.compose, file: 'docker-compose.yml' },
    extra: { label: gen.extras[0]?.name ?? 'Tệp thêm', text: gen.extras.map((e) => e.content).join('\n'), file: gen.extras[0]?.name ?? 'extra.txt' },
    notes: { label: 'Lớp & kích thước', text: gen.notes.join('\n\n'), file: 'ghi-chu.txt' },
  };
  const outTabs = (Object.keys(outputs) as OutTab[]).filter((k) => k !== 'extra' || gen.extras.length > 0);
  const curOut = outputs[outTabs.includes(outTab) ? outTab : 'dockerfile'];
  const showPmField = def.pms.length > 0;
  const hasOutDir = ['node', 'vite', 'static', 'php', 'bun'].includes(opts.stack);
  const hasBuild = !['static', 'php'].includes(opts.stack);

  return (
    <div className="space-y-3.5 lg-fit-screen lg:space-y-0 lg:gap-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs shrink-0 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Boxes className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Dockerfile Generator &amp; Linter</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Sinh Dockerfile multi-stage chuẩn production theo ngôn ngữ, kiểm tra Dockerfile bất kỳ theo quy tắc kiểu hadolint. Chạy hoàn toàn trên trình duyệt.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShareLinkButton
            params={shareParams}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
          />
        </div>
      </div>

      {/* TABS */}
      <div className="flex gap-1.5 shrink-0">
        {([['gen', 'Tạo Dockerfile', FileCode], ['lint', 'Kiểm tra (Lint)', ShieldCheck]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'gen' && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-3.5 lg:flex-1 lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]">
          {/* OPTIONS */}
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3 space-y-3 min-w-0 lg:h-full lg:min-h-0 lg:overflow-auto">
            <div>
              <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">Công nghệ</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {STACKS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStack(s.id)}
                    data-tooltip={s.hint}
                    className={`px-2 py-1.5 rounded-lg text-xs font-semibold text-left border transition ${opts.stack === s.id ? 'bg-indigo-50 border-indigo-400 text-indigo-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">{def.hint}</p>
            </div>

            <div>
              <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">Image gốc (base variant)</div>
              <div className="flex flex-wrap gap-1.5">
                {def.variants.map((v) => (
                  <button
                    key={v}
                    onClick={() => setOpts((o) => ({ ...o, variant: v, buildImage: '', runImage: '' }))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${eff.variant === v ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                  >
                    {VARIANT_LABEL[v]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {showPmField && (
                <Field label="Trình quản lý gói">
                  <Select value={eff.pm} onChange={(e) => set('pm', e.target.value)} className={inputCls}>
                    {def.pms.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </Select>
                </Field>
              )}
              {def.frameworks.length > 0 && (
                <Field label="Framework / cách chạy">
                  <Select value={eff.framework} onChange={(e) => set('framework', e.target.value)} className={inputCls}>
                    {def.frameworks.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Cổng (EXPOSE)">
                <input value={opts.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder={auto.port} className={inputCls} inputMode="numeric" />
              </Field>
              <Field label="Thư mục ứng dụng">
                <input value={opts.appDir} onChange={(e) => set('appDir', e.target.value)} placeholder="/app" className={inputCls} />
              </Field>
              <Field label="UID người dùng non-root" hint={eff.variant === 'distroless' ? 'Distroless dùng UID 65532 có sẵn' : opts.stack === 'vite' || opts.stack === 'static' ? 'nginx-unprivileged dùng UID 101' : undefined}>
                <input value={opts.uid} onChange={(e) => set('uid', e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="10001" className={inputCls} inputMode="numeric" />
              </Field>
              <Field label="Tên ứng dụng / binary" hint="Dùng cho nhãn, tên binary (Go/Rust), DLL (.NET)">
                <input value={opts.appName} onChange={(e) => set('appName', e.target.value)} placeholder="app" className={inputCls} />
              </Field>
            </div>

            <div className="space-y-2">
              <Field label="Lệnh chạy (CMD)" hint="Tự chuyển sang dạng exec (JSON). Để trống = mặc định theo stack.">
                <input value={opts.entry} onChange={(e) => set('entry', e.target.value)} placeholder={auto.entry} className={inputCls} />
              </Field>
              {hasBuild && (
                <Field label="Lệnh build" hint={opts.stack === 'node' || opts.stack === 'bun' || opts.stack === 'deno' ? 'Để trống = không có bước build' : 'Để trống = mặc định theo stack'}>
                  <input value={opts.buildCmd} onChange={(e) => set('buildCmd', e.target.value)} placeholder={auto.buildCmd || '(không build)'} className={inputCls} />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-2">
                {hasOutDir && (
                  <Field label="Thư mục kết quả / web root">
                    <input value={opts.outDir} onChange={(e) => set('outDir', e.target.value)} placeholder={auto.outDir} className={inputCls} />
                  </Field>
                )}
                {opts.healthcheck && (
                  <Field label="Đường dẫn healthcheck">
                    <input value={opts.healthPath} onChange={(e) => set('healthPath', e.target.value)} placeholder={auto.healthPath} className={inputCls} />
                  </Field>
                )}
              </div>
              {opts.tests && (
                <Field label="Lệnh test (stage test)">
                  <input value={opts.testCmd} onChange={(e) => set('testCmd', e.target.value)} placeholder={auto.testCmd} className={inputCls} />
                </Field>
              )}
              <Field label="Build ARG (TEN=giá trị, phân cách bằng dấu phẩy)" hint="Đừng đặt bí mật ở đây — build ARG lộ trong docker history.">
                <input value={opts.buildArgs} onChange={(e) => set('buildArgs', e.target.value)} placeholder="NODE_ENV=production, VITE_API_URL=/api" className={inputCls} />
              </Field>
            </div>

            <div className="space-y-2">
              <Field label="Image build (ghim tag, có thể sửa)">
                <input value={opts.buildImage} onChange={(e) => set('buildImage', e.target.value)} placeholder={imgDefaults.build || '(không có stage build)'} className={inputCls} disabled={!imgDefaults.build} />
              </Field>
              <Field label="Image runtime (ghim tag, có thể sửa)" hint="Ở production nên ghim thêm digest @sha256:…">
                <input value={opts.runImage} onChange={(e) => set('runImage', e.target.value)} placeholder={imgDefaults.run} className={inputCls} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-1">
              <Toggle checked={opts.buildkit} onChange={(v) => set('buildkit', v)} label="BuildKit cache mount" title="Dùng RUN --mount=type=cache và # syntax=docker/dockerfile:1" />
              <Toggle checked={opts.healthcheck} onChange={(v) => set('healthcheck', v)} label="HEALTHCHECK" />
              <Toggle checked={opts.labels} onChange={(v) => set('labels', v)} label="Nhãn OCI" />
              <Toggle checked={opts.tests} onChange={(v) => set('tests', v)} label="Stage test" />
              <Toggle checked={opts.multiarch} onChange={(v) => set('multiarch', v)} label="Ghi chú multi-arch" />
              {(opts.stack === 'vite' || opts.stack === 'static') && <Toggle checked={opts.spa} onChange={(v) => set('spa', v)} label="SPA fallback (index.html)" />}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Init (PID 1)">
                <Select value={opts.init} onChange={(e) => set('init', e.target.value as InitMode)} className={inputCls}>
                  <option value="none">Không</option>
                  <option value="tini">tini</option>
                  <option value="dumb-init">dumb-init</option>
                </Select>
              </Field>
              <Field label="Múi giờ (TZ)">
                <input value={opts.tz} onChange={(e) => set('tz', e.target.value)} placeholder="Asia/Ho_Chi_Minh" className={inputCls} />
              </Field>
            </div>
            <Field label="URL repo (nhãn source, tuỳ chọn)">
              <input value={opts.repoUrl} onChange={(e) => set('repoUrl', e.target.value)} placeholder="https://github.com/org/repo" className={inputCls} />
            </Field>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              <b>Mẹo:</b> các ô để trống sẽ dùng giá trị tự động (hiện mờ trong ô). Tag image đã ghim sẵn nhưng hãy kiểm tra phiên bản mới nhất; giá trị nhập vào luôn được làm sạch để không chèn thêm chỉ thị.
            </p>
          </div>

          {/* OUTPUT */}
          <div className="flex flex-col gap-3.5 min-w-0 lg:h-full lg:min-h-0">
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col lg:flex-1 lg:min-h-0">
              <div className="px-2 pt-2 shrink-0 flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50/60">
                {outTabs.map((k) => (
                  <button
                    key={k}
                    onClick={() => setOutTab(k)}
                    className={`px-2.5 py-1.5 rounded-t-lg text-xs font-semibold transition ${curOut === outputs[k] ? 'bg-white text-indigo-700 border border-b-white border-slate-200 -mb-px' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    {outputs[k].label}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-1.5 pb-1.5">
                  <button
                    onClick={() => copy(curOut.text, 'out')}
                    className="px-2 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition"
                  >
                    {copied === 'out' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    Sao chép
                  </button>
                  <button
                    onClick={() => {
                      download(curOut.file, curOut.text);
                      showToast(`Đã tải ${curOut.file}`);
                    }}
                    className="px-2 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition"
                  >
                    <Download className="h-3 w-3" />
                    Tải xuống
                  </button>
                </div>
              </div>
              <div className="p-3 flex flex-col lg:flex-1 lg:min-h-0">
                {curOut === outputs.dockerfile ? (
                  <CodeView maxHeight={FIT_H} text={gen.dockerfile} issues={genIssues} selected={genSelected} onSelectLine={(ln) => {
                    const hit = genIssues.find((i) => ln >= i.line && ln <= i.endLine);
                    if (hit) setGenSelKey(keyOf(hit));
                  }} />
                ) : curOut === outputs.notes ? (
                  <div className="space-y-2 max-h-[560px] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-auto">
                    {gen.notes.map((n, i) => (
                      <p key={i} className="text-xs text-slate-700 leading-relaxed flex gap-2">
                        <Info className="h-3.5 w-3.5 text-indigo-400 shrink-0 mt-0.5" />
                        <span>{n}</span>
                      </p>
                    ))}
                  </div>
                ) : curOut === outputs.extra ? (
                  <div className="space-y-3 lg:flex-1 lg:min-h-0 overflow-auto">
                    {gen.extras.map((ex) => (
                      <div key={ex.name}>
                        <div className="text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between gap-2">
                          <span><span className="font-mono">{ex.name}</span> — {ex.note}</span>
                          <button onClick={() => download(ex.name, ex.content)} className="px-2 py-0.5 rounded-md text-[11px] border border-slate-200 hover:bg-slate-100 flex items-center gap-1"><Download className="h-3 w-3" />Tải</button>
                        </div>
                        <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-[12px] leading-5 font-mono overflow-auto max-h-[420px]">{ex.content}</pre>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-[12px] leading-5 font-mono overflow-auto max-h-[560px] lg:max-h-none lg:flex-1 lg:min-h-0 whitespace-pre">{curOut.text}</pre>
                )}
              </div>
            </div>

            {/* LIVE LINT */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden shrink-0">
              <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Kiểm tra trực tiếp Dockerfile vừa tạo</span>
                <button
                  onClick={() => {
                    setLintText(gen.dockerfile);
                    setSelKey(null);
                    setTab('lint');
                  }}
                  className="px-2 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition"
                >
                  Mở trong tab Kiểm tra <ArrowRight className="h-3 w-3" />
                </button>
              </div>
              <div className="p-3 space-y-2">
                <Summary counts={genLint.counts} score={genLint.score} filter={null} onFilter={() => {}} />
                {genIssues.length > 0 && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <IssueList maxHeight="max-h-40" issues={genIssues} selectedKey={genSelKey} onSelect={(k) => { setGenSelKey(k === genSelKey ? null : k); setOutTab('dockerfile'); }} canFix={false} />
                  </div>
                )}
                <p className="text-[11px] text-slate-500">
                  Dockerfile sinh ra luôn qua linter: không có lỗi/cảnh báo. Các mục &quot;gợi ý&quot; (ví dụ thiếu HEALTHCHECK trên image không có shell) là chủ ý và được giải thích trong ghi chú.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'lint' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 lg:flex-1 lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]">
          {/* EDITOR / CODE VIEW */}
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden min-w-0 flex flex-col lg:h-full lg:min-h-0">
            <div className="px-2 pt-2 shrink-0 flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50/60">
              {([['edit', 'Soạn thảo'], ['view', 'Xem dòng & lỗi']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setView(k)}
                  className={`px-2.5 py-1.5 rounded-t-lg text-xs font-semibold transition ${view === k ? 'bg-white text-indigo-700 border border-b-white border-slate-200 -mb-px' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {label}
                </button>
              ))}
              <div className="ml-auto flex flex-wrap items-center gap-1.5 pb-1.5">
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
                <button onClick={() => fileRef.current?.click()} className="px-2 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition">
                  <Upload className="h-3 w-3" /> Mở file
                </button>
                <button onClick={() => { setLintText(SAMPLE_BAD); setSelKey(null); }} className="px-2 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition">
                  <Sparkles className="h-3 w-3 text-amber-500" /> Mẫu lỗi
                </button>
                <button onClick={() => { setLintText(gen.dockerfile); setSelKey(null); }} className="px-2 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition">
                  Dùng bản vừa tạo
                </button>
                <button onClick={() => { setLintText(''); setSelKey(null); }} className="px-2 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition">
                  <Trash2 className="h-3 w-3" /> Xóa
                </button>
              </div>
            </div>
            <div className="p-3 flex flex-col gap-2 lg:flex-1 lg:min-h-0">
              {view === 'edit' ? (
                <textarea
                  value={lintText}
                  onChange={(e) => { setLintText(e.target.value); setSelKey(null); }}
                  spellCheck={false}
                  placeholder={'Dán nội dung Dockerfile vào đây…\n\nFROM node:24-bookworm-slim\nWORKDIR /app\n…'}
                  className="w-full h-[480px] lg:h-auto lg:flex-1 lg:min-h-0 p-3 rounded-lg border border-slate-200 bg-slate-50 font-mono text-[12px] leading-5 text-slate-800 resize-y lg:resize-none focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40"
                />
              ) : lintText ? (
                <CodeView
                  maxHeight={FIT_H}
                  text={lintText}
                  issues={lint.issues}
                  selected={lintSelected}
                  onSelectLine={(ln) => {
                    const hit = lint.issues.find((i) => ln >= i.line && ln <= i.endLine);
                    if (hit) setSelKey(keyOf(hit));
                  }}
                />
              ) : (
                <div className="text-xs text-slate-500 p-6 text-center">Chưa có nội dung. Dán Dockerfile ở tab &quot;Soạn thảo&quot; hoặc bấm &quot;Mẫu lỗi&quot;.</div>
              )}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  disabled={!fixCount}
                  onClick={() => {
                    const r = applyAllFixes(lintText, { safeOnly: true, ignore: ignoreList });
                    setLintText(r.text);
                    setSelKey(null);
                    showToast(r.applied ? `Đã áp dụng ${r.applied} sửa an toàn.` : 'Không có sửa chữa an toàn nào.');
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white flex items-center gap-1 transition"
                >
                  <Wrench className="h-3.5 w-3.5" /> Sửa tất cả (an toàn){fixCount ? ` · ${fixCount}` : ''}
                </button>
                <button
                  disabled={!fixAnyCount}
                  onClick={() => {
                    const r = applyAllFixes(lintText, { ignore: ignoreList });
                    setLintText(r.text);
                    setSelKey(null);
                    showToast(r.applied ? `Đã áp dụng ${r.applied} sửa — hãy xem lại kết quả.` : 'Không có gợi ý sửa.');
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 transition"
                  data-tooltip="Gồm cả các sửa cần kiểm tra lại (gộp RUN, thêm USER, ...)"
                >
                  Sửa cả gợi ý cần kiểm tra
                </button>
                <button onClick={() => copy(lintText, 'lint')} disabled={!lintText} className="px-2 py-1.5 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 flex items-center gap-1 transition">
                  {copied === 'lint' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />} Sao chép
                </button>
                <button onClick={() => { download('Dockerfile', lintText); showToast('Đã tải Dockerfile'); }} disabled={!lintText} className="px-2 py-1.5 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 flex items-center gap-1 transition">
                  <Download className="h-3 w-3" /> Tải xuống
                </button>
              </div>
              <Field label="Bỏ qua rule (ID, cách nhau bởi dấu phẩy)" hint="Hoặc ghi chú ngay trên chỉ thị: # hadolint ignore=DL3008,DL3015">
                <input value={ignoreText} onChange={(e) => setIgnoreText(e.target.value.toUpperCase())} placeholder="DL3057, DL3059" className={inputCls} />
              </Field>
            </div>
          </div>

          {/* RESULTS */}
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden min-w-0 flex flex-col lg:h-full lg:min-h-0">
            <div className="px-3 py-2 shrink-0 border-b border-slate-100 bg-slate-50/60 text-xs font-bold text-slate-800 uppercase tracking-wider">Kết quả kiểm tra</div>
            <div className="lg:flex-1 lg:min-h-0 lg:overflow-auto">
            {!lintText.trim() ? (
              <div className="p-6 text-xs text-slate-500 text-center space-y-1">
                <p>Dán một Dockerfile ở bên trái để kiểm tra ngay (xử lý tại trình duyệt, không gửi đi đâu).</p>
                <p><b>Mẹo:</b> bấm vào một vấn đề để nhảy tới đúng dòng; nhiều vấn đề có nút &quot;Áp dụng sửa này&quot;.</p>
              </div>
            ) : (
              <>
                <div className="p-3 border-b border-slate-100">
                  <Summary counts={lint.counts} score={lint.score} filter={filter} onFilter={setFilter} />
                  {deferredLint !== lintText && <p className="text-[11px] text-slate-400 mt-1">Đang cập nhật…</p>}
                </div>
                <IssueList
                  maxHeight="max-h-[560px] lg:max-h-none lg:overflow-visible"
                  issues={lintIssues}
                  selectedKey={selKey}
                  canFix
                  onSelect={(k) => {
                    setSelKey(k === selKey ? null : k);
                    if (k !== selKey) setView('view');
                  }}
                  onApplyFix={(it) => {
                    if (!it.fix) return;
                    setLintText(applyFix(lintText, it.fix));
                    setSelKey(null);
                    showToast('Đã áp dụng sửa.');
                  }}
                />
              </>
            )}
            <details className="border-t border-slate-100">
              <summary className="px-3 py-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">Danh sách quy tắc ({Object.keys(RULES).length})</summary>
              <ul className="px-3 pb-3 grid grid-cols-1 gap-1 max-h-72 lg:max-h-none overflow-auto lg:overflow-visible">
                {Object.entries(RULES).map(([id, r]) => (
                  <li key={id} className="text-[11px] flex items-start gap-2">
                    <span className="font-mono font-semibold text-slate-800 w-14 shrink-0">{id}</span>
                    <span className={`px-1 rounded shrink-0 ${SEV_STYLE[r.severity].chip}`}>{SEVERITY_LABEL[r.severity]}</span>
                    <span className="text-slate-600">{r.title}</span>
                  </li>
                ))}
              </ul>
            </details>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
