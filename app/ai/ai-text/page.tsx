'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Upload, Copy, Download, Loader2, X, RotateCw, Mic, Trash2, AlertTriangle, Zap, Globe, Cpu, CheckCircle2, FileSearch } from 'lucide-react';
import { Select } from '@/components/ui/searchable-select';
import { useApp } from '@/components/AppContext';
import { useAiSettings } from '@/lib/use-ai-config';
import { AiKeyNotice } from '@/components/AiKeyNotice';
import { AiSection } from '@/components/AiSection';
import { callAi, toAiError } from '@/lib/ai-client';
import { LANGUAGE_LABELS_VI, MAX_INPUT_CHARS, type AiTask } from '@/lib/ai-prompts';
import {
  analyzeCode,
  BROWSER_AI_NO_MESSAGE,
  BROWSER_AI_OK_MESSAGE,
  CODE_LANG_LABELS,
  describeBrowserAiError,
  detectBrowserAi,
  detectLanguage,
  detectLanguageBrowser,
  formatMinutes,
  summarizeLocal,
  summarizeWithBrowser,
  textStats,
  translateWithBrowser,
  translatorAvailability,
  type BrowserAiAvailability,
  type BrowserAiSupport,
  type CodeAnalysis,
  type CodeLang,
  type DetectedLang,
  type LocalSummary,
  type Severity,
} from '@/lib/text-local';

import { SendToButton } from '@/components/SendToButton';
import { toolHref } from '@/lib/tools';

type Mode = 'summarize' | 'translate' | 'explain-code';
const MODES: { id: Mode; label: string }[] = [
  { id: 'summarize', label: 'Tóm tắt' },
  { id: 'translate', label: 'Dịch' },
  { id: 'explain-code', label: 'Giải thích code' },
];

type Source = 'local' | 'browser' | 'ai';
const SOURCE_LABEL: Record<Source, string> = {
  local: 'Miễn phí · tóm tắt cục bộ (trích xuất)',
  browser: 'Miễn phí · AI tích hợp của trình duyệt',
  ai: 'AI (khóa của bạn)',
};

const PROSE =
  'prose prose-sm max-w-none text-slate-800 [&_h1]:text-base [&_h1]:font-extrabold [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h3]:text-xs [&_h3]:font-bold [&_p]:leading-relaxed [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:pl-3 [&_code]:bg-slate-100 [&_code]:text-indigo-700 [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:text-slate-100 [&_table]:w-full [&_table]:border-collapse [&_th]:bg-slate-100 [&_th]:p-2 [&_th]:border [&_th]:border-slate-200 [&_td]:p-2 [&_td]:border [&_td]:border-slate-200';

const selectCls = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40';
const labelCls = 'block text-[11px] font-semibold text-slate-500 mb-1';
const smallBtn = 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50';
const MAX_FILE = 2 * 1024 * 1024;
const MAX_LOCAL_CHARS = 400_000;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-indigo-600" />
      {label}
    </label>
  );
}

const SEV_CLS: Record<Severity, string> = {
  danger: 'border-red-200 bg-red-50 text-red-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
};
const SEV_LABEL: Record<Severity, string> = { danger: 'Nghiêm trọng', warn: 'Cảnh báo', info: 'Gợi ý' };
const KIND_LABEL: Record<string, string> = {
  import: 'Nhập (import)', export: 'Xuất (export)', class: 'Lớp / kiểu', function: 'Hàm / phương thức', constant: 'Hằng số', route: 'Route / endpoint', sql: 'SQL', todo: 'TODO / FIXME', section: 'Cấu trúc',
};

function analysisToMarkdown(a: CodeAnalysis): string {
  const out: string[] = [];
  out.push(`# Phân tích mã cục bộ`);
  out.push(`*Phân tích tĩnh bằng quy tắc — không phải giải thích ngữ nghĩa.*`);
  out.push(`- Ngôn ngữ: **${a.langLabel}**${a.detected ? ` (đoán, độ tin cậy ${Math.round(a.langConfidence * 100)}%)` : ''}`);
  out.push(`- Dòng: ${a.lines.total} (mã ${a.lines.code}, chú thích ${a.lines.comment}, trống ${a.lines.blank}) · tỷ lệ chú thích ${(a.commentRatio * 100).toFixed(0)}%`);
  out.push(`- Độ lồng sâu tối đa: ${a.maxNesting} · Tổng độ phức tạp các hàm: ${a.totalComplexity}`);
  if (a.functions.length) {
    out.push('', '## Hàm', '| Hàm | Dòng | Số dòng | Tham số | Phức tạp | Lồng |', '|---|---|---|---|---|---|');
    for (const f of a.functions) out.push(`| \`${f.fullName}\` | ${f.line}-${f.endLine} | ${f.lines} | ${f.paramCount} | ${f.complexity} | ${f.maxDepth} |`);
  }
  const groups = new Map<string, string[]>();
  for (const o of a.outline) {
    if (o.kind === 'function') continue;
    const arr = groups.get(o.kind) ?? [];
    arr.push(`- \`${o.name}\`${o.detail ? ` — ${o.detail}` : ''} (dòng ${o.line})`);
    groups.set(o.kind, arr);
  }
  for (const [k, v] of groups) out.push('', `## ${KIND_LABEL[k] ?? k}`, ...v);
  if (a.smells.length) {
    out.push('', '## Vấn đề phát hiện');
    for (const s of a.smells) out.push(`- **[${SEV_LABEL[s.severity]}]** ${s.title}${s.line ? ` (dòng ${s.line})` : ''}: ${s.explain}${s.detail ? ` _${s.detail}_` : ''}`);
  }
  return out.join('\n');
}

function AnalysisView({ a, onCopy }: { a: CodeAnalysis; onCopy: () => void }) {
  const outlineGroups = useMemo(() => {
    const m = new Map<string, typeof a.outline>();
    for (const o of a.outline) {
      if (o.kind === 'function') continue;
      const arr = m.get(o.kind) ?? [];
      arr.push(o);
      m.set(o.kind, arr);
    }
    return Array.from(m.entries());
  }, [a]);
  const stat = 'rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
          <FileSearch className="h-3.5 w-3.5 text-emerald-600" /> Phân tích mã cục bộ
          <span className="font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 text-[10px]">Miễn phí</span>
        </div>
        <button onClick={onCopy} className={smallBtn}><Copy className="h-3 w-3" /> Sao chép báo cáo</button>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Đây là <b>phân tích tĩnh</b> bằng quy tắc (regex/đếm), chạy ngay trên máy bạn — cho dàn ý, số đo và cảnh báo thường gặp, <b>không</b> hiểu ý nghĩa mã. Muốn lời giải thích bằng ngôn ngữ tự nhiên, dùng phần AI bên dưới.
      </p>
      {a.truncated && <div className="text-[11px] text-amber-700">Mã quá dài, chỉ phân tích 300.000 ký tự đầu.</div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className={stat}><div className="text-slate-500">Ngôn ngữ</div><div className="font-bold text-slate-900">{a.langLabel}</div><div className="text-slate-400">{a.detected ? `đoán · ${Math.round(a.langConfidence * 100)}%` : 'chọn thủ công'}</div></div>
        <div className={stat}><div className="text-slate-500">Dòng</div><div className="font-bold text-slate-900">{a.lines.total}</div><div className="text-slate-400">mã {a.lines.code} · cmt {a.lines.comment} · trống {a.lines.blank}</div></div>
        <div className={stat}><div className="text-slate-500">Chú thích</div><div className="font-bold text-slate-900">{(a.commentRatio * 100).toFixed(0)}%</div><div className="text-slate-400">{a.commentRatio < 0.05 && a.lines.code > 40 ? 'khá ít' : 'ổn'}</div></div>
        <div className={stat}><div className="text-slate-500">Lồng sâu / Σ phức tạp</div><div className="font-bold text-slate-900">{a.maxNesting} / {a.totalComplexity}</div><div className="text-slate-400">{a.functions.length} hàm · {a.classes.length} lớp</div></div>
      </div>

      {a.functions.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-slate-700 mb-1">Hàm / phương thức</div>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="text-left p-1.5">Tên</th><th className="p-1.5">Dòng</th><th className="p-1.5">Độ dài</th><th className="p-1.5">Tham số</th><th className="p-1.5">Phức tạp</th><th className="p-1.5">Lồng</th></tr>
              </thead>
              <tbody>
                {a.functions.map((f, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-1.5 font-mono text-slate-800">{f.fullName}<span className="text-slate-400">({f.params.map((p) => p.replace(/\s*=.*$/, '')).join(', ').slice(0, 50)})</span></td>
                    <td className="p-1.5 text-center text-slate-500">{f.line}–{f.endLine}</td>
                    <td className={`p-1.5 text-center ${f.lines > 50 ? 'text-amber-700 font-bold' : ''}`}>{f.lines}</td>
                    <td className={`p-1.5 text-center ${f.paramCount > 5 ? 'text-amber-700 font-bold' : ''}`}>{f.paramCount}</td>
                    <td className={`p-1.5 text-center ${f.complexity > 10 ? 'text-red-600 font-bold' : f.complexity > 5 ? 'text-amber-700' : ''}`}>{f.complexity}</td>
                    <td className={`p-1.5 text-center ${f.maxDepth >= 5 ? 'text-amber-700 font-bold' : ''}`}>{f.maxDepth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {outlineGroups.map(([kind, items]) => (
        <div key={kind}>
          <div className="text-[11px] font-bold text-slate-700 mb-1">{KIND_LABEL[kind] ?? kind} <span className="font-normal text-slate-400">({items.length})</span></div>
          <ul className="space-y-0.5">
            {items.slice(0, 40).map((o, i) => (
              <li key={i} className="text-[11px] text-slate-700 flex gap-1.5">
                <span className="text-slate-400 w-10 shrink-0 text-right">:{o.line}</span>
                <code className="font-mono bg-slate-100 text-indigo-700 rounded px-1 break-all">{o.name}</code>
                {o.detail && <span className="text-slate-500 break-all">{o.detail}</span>}
              </li>
            ))}
            {items.length > 40 && <li className="text-[11px] text-slate-400">… và {items.length - 40} mục nữa</li>}
          </ul>
        </div>
      ))}

      <div>
        <div className="text-[11px] font-bold text-slate-700 mb-1">Vấn đề phát hiện <span className="font-normal text-slate-400">({a.smells.length})</span></div>
        {a.smells.length === 0 ? (
          <div className="text-[11px] text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Không phát hiện mùi mã thường gặp (không có nghĩa là mã không có lỗi).</div>
        ) : (
          <ul className="space-y-1.5">
            {a.smells.map((s, i) => (
              <li key={i} className={`rounded-lg border p-2 text-[11px] ${SEV_CLS[s.severity]}`}>
                <div className="font-semibold">
                  <span className="uppercase text-[9px] tracking-wide mr-1.5 opacity-80">{SEV_LABEL[s.severity]}</span>
                  {s.title}
                  {s.line ? <span className="font-normal opacity-70"> · dòng {s.line}</span> : null}
                </div>
                <div className="mt-0.5 leading-relaxed opacity-90">{s.explain}</div>
                {s.detail && <div className="mt-0.5 opacity-70">{s.detail}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SummaryMeta({ meta, input }: { meta: LocalSummary; input: string }) {
  const st = useMemo(() => textStats(input), [input]);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
      <div className="text-[11px] text-slate-600">
        Chọn <b>{meta.picked.length}</b> / {meta.total} câu · Đọc bản gốc ~{formatMinutes(st.readingMinutes)}, bản tóm tắt ~{formatMinutes(Math.max(0.05, meta.text.split(/\s+/).length / 200))}
      </div>
      {meta.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {meta.keywords.map((k) => (
            <span key={k.term} className={`px-1.5 py-0.5 rounded-md text-[11px] border ${k.phrase ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-700'}`}>
              {k.term} <span className="text-slate-400">×{k.count}</span>
            </span>
          ))}
        </div>
      )}
      <div className="text-[10px] text-slate-400">
        {st.words.toLocaleString('vi-VN')} từ · {st.sentences} câu · {st.paragraphs} đoạn · {st.uniqueWords.toLocaleString('vi-VN')} từ khác nhau
      </div>
    </div>
  );
}

export default function AiTextPage() {
  const { showToast, openSettings } = useApp();
  const { config: aiConfig, providerLabel } = useAiSettings();
  const [mode, setMode] = useState<Mode>('summarize');
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');
  const [resultSource, setResultSource] = useState<Source>('ai');
  const [view, setView] = useState<'rendered' | 'raw'>('rendered');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [dl, setDl] = useState<number | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastAction = useRef<(() => void) | null>(null);

  // summarize
  const [length, setLength] = useState('medium');
  const [style, setStyle] = useState('paragraph');
  const [outLang, setOutLang] = useState('vi');
  // translate
  const [source, setSource] = useState('auto');
  const [target, setTarget] = useState('en');
  const [tone, setTone] = useState('keep');
  const [preserveMd, setPreserveMd] = useState(true);
  // explain
  const [codeLang, setCodeLang] = useState('');
  const [level, setLevel] = useState('beginner');
  const [complexity, setComplexity] = useState(true);
  const [bugs, setBugs] = useState(true);

  // kết quả miễn phí
  const [summaryMeta, setSummaryMeta] = useState<LocalSummary | null>(null);
  const [analysis, setAnalysis] = useState<CodeAnalysis | null>(null);
  const [support, setSupport] = useState<BrowserAiSupport | null>(null);
  const [trAvail, setTrAvail] = useState<BrowserAiAvailability | null>(null);
  const [detected, setDetected] = useState<DetectedLang | null>(null);

  // Nhận văn bản chuyển từ STT (đọc một lần rồi xoá)
  useEffect(() => {
    try {
      const incoming = sessionStorage.getItem('ai_text_input');
      if (incoming) {
        sessionStorage.removeItem('ai_text_input');
        setInput(incoming.slice(0, MAX_LOCAL_CHARS));
      }
    } catch {
      /* sessionStorage không khả dụng */
    }
  }, []);

  useEffect(() => {
    setSupport(detectBrowserAi());
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const tooLong = input.length > MAX_INPUT_CHARS;
  const hasInput = input.trim().length > 0;

  // nhận diện ngôn ngữ văn bản (cục bộ, có debounce) cho tab Tóm tắt/Dịch
  useEffect(() => {
    if (mode === 'explain-code' || !input.trim()) {
      setDetected(null);
      return;
    }
    const sample = input.slice(0, 3000);
    const local = detectLanguage(sample);
    setDetected(local);
    if (!support?.languageDetector) return;
    let alive = true;
    const t = setTimeout(() => {
      detectLanguageBrowser(sample).then((d) => {
        if (alive && d && d.confidence >= 0.5) setDetected(d);
      });
    }, 500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [input, mode, support]);

  // trạng thái Translator cho cặp ngôn ngữ đang chọn
  const effSource = source === 'auto' ? detected?.code ?? 'und' : source;
  useEffect(() => {
    if (mode !== 'translate' || !support?.translator || effSource === 'und') {
      setTrAvail(null);
      return;
    }
    let alive = true;
    translatorAvailability(effSource, target).then((a) => alive && setTrAvail(a));
    return () => {
      alive = false;
    };
  }, [mode, support, effSource, target]);

  const begin = (msg: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setLoadingMsg(msg);
    setDl(null);
    setError('');
    return ctrl;
  };
  const end = (ctrl: AbortController) => {
    if (abortRef.current === ctrl) {
      setLoading(false);
      setDl(null);
    }
  };

  /* ---------- Miễn phí: tóm tắt cục bộ ---------- */
  const runLocalSummary = useCallback(() => {
    if (!hasInput) return;
    lastAction.current = runLocalSummary;
    setError('');
    const sum = summarizeLocal(input, { length: length as 'short' | 'medium' | 'long', style: style as 'paragraph' | 'bullets' | 'tldr' });
    setSummaryMeta(sum);
    setResult(sum.text || '');
    setResultSource('local');
    if (!sum.text) setError('Không tách được câu nào từ văn bản.');
  }, [hasInput, input, length, style]);

  /* ---------- Miễn phí: Summarizer tích hợp ---------- */
  const runBrowserSummary = useCallback(async () => {
    if (!hasInput || loading) return;
    lastAction.current = () => void runBrowserSummary();
    const ctrl = begin('Đang tóm tắt bằng AI tích hợp…');
    setSummaryMeta(null);
    setResult('');
    setResultSource('browser');
    try {
      const out = await summarizeWithBrowser(input, {
        type: style === 'tldr' ? 'tldr' : style === 'bullets' ? 'key-points' : 'teaser',
        format: 'markdown',
        length: length as 'short' | 'medium' | 'long',
        outputLanguage: outLang,
        signal: ctrl.signal,
        onDownload: (f) => {
          setDl(f);
          setLoadingMsg(`Đang tải mô hình tóm tắt… ${Math.round(f * 100)}%`);
        },
        onText: (t) => {
          setLoadingMsg('Đang tóm tắt bằng AI tích hợp…');
          setResult(t);
        },
      });
      setResult(out);
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setError(describeBrowserAiError(e));
    } finally {
      end(ctrl);
    }
  }, [hasInput, loading, input, style, length, outLang]);

  /* ---------- Miễn phí: Translator tích hợp ---------- */
  const runBrowserTranslate = useCallback(async () => {
    if (!hasInput || loading) return;
    lastAction.current = () => void runBrowserTranslate();
    const ctrl = begin('Đang dịch bằng trình duyệt…');
    setResult('');
    setResultSource('browser');
    try {
      const out = await translateWithBrowser(input, source, target, {
        signal: ctrl.signal,
        onDownload: (f) => {
          setDl(f);
          setLoadingMsg(`Đang tải mô hình dịch (một lần)… ${Math.round(f * 100)}%`);
        },
        onText: (t) => {
          setLoadingMsg('Đang dịch bằng trình duyệt…');
          setResult(t);
        },
      });
      setResult(out);
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setError(e instanceof Error && !(e as { name?: string }).name?.endsWith('Error') ? e.message : describeBrowserAiError(e));
    } finally {
      end(ctrl);
    }
  }, [hasInput, loading, input, source, target]);

  /* ---------- Miễn phí: phân tích mã ---------- */
  const runAnalysis = useCallback(() => {
    if (!hasInput) return;
    lastAction.current = runAnalysis;
    setError('');
    const forced = codeLang.trim().toLowerCase();
    const map: Record<string, CodeLang> = { js: 'javascript', javascript: 'javascript', ts: 'typescript', typescript: 'typescript', py: 'python', python: 'python', go: 'go', golang: 'go', rust: 'rust', rs: 'rust', java: 'java', 'c#': 'csharp', csharp: 'csharp', cs: 'csharp', c: 'c', 'c++': 'cpp', cpp: 'cpp', php: 'php', ruby: 'ruby', rb: 'ruby', kotlin: 'kotlin', kt: 'kotlin', swift: 'swift', sql: 'sql', bash: 'bash', sh: 'bash', shell: 'bash', html: 'html', css: 'css', json: 'json', yaml: 'yaml', yml: 'yaml' };
    setAnalysis(analyzeCode(input, map[forced] ?? ''));
  }, [hasInput, input, codeLang]);

  /* ---------- AI (khóa) ---------- */
  const runAi = useCallback(async () => {
    if (!input.trim() || tooLong || loading) return;
    lastAction.current = () => void runAi();
    const ctrl = begin('Đang xử lý với AI...');
    const options: Record<string, string | boolean> =
      mode === 'summarize'
        ? { length, style, language: outLang }
        : mode === 'translate'
          ? { source, target, tone, preserveMarkdown: preserveMd }
          : { language: codeLang.trim() || (analysis && analysis.lang !== 'unknown' ? CODE_LANG_LABELS[analysis.lang] : 'auto'), level, complexity, bugs };
    try {
      const text = await callAi({ task: mode as AiTask, input, options, ai: aiConfig, signal: ctrl.signal });
      setResult(text);
      setResultSource('ai');
      if (mode === 'summarize') setSummaryMeta(null);
    } catch (e) {
      const err = toAiError(e);
      if (!err.aborted) setError(err.message);
    } finally {
      end(ctrl);
    }
  }, [input, tooLong, loading, mode, length, style, outLang, source, target, tone, preserveMd, codeLang, level, complexity, bugs, aiConfig, analysis]);

  const cancel = () => {
    abortRef.current?.abort();
    setLoading(false);
    setDl(null);
  };

  const retry = () => lastAction.current?.();

  const onFile = async (f?: File | null) => {
    if (!f) return;
    if (f.size > MAX_FILE) return showToast('File quá lớn (tối đa 2MB).');
    try {
      const t = await f.text();
      if (t.includes('\u0000')) return showToast('Đây không phải file văn bản.');
      setInput(t.slice(0, MAX_LOCAL_CHARS));
      if (t.length > MAX_LOCAL_CHARS) showToast('Nội dung đã được cắt bớt theo giới hạn.');
    } catch {
      showToast('Không đọc được file.');
    }
  };

  const copyText = async (text: string, msg = 'Đã sao chép kết quả') => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(msg);
    } catch {
      showToast('Không thể sao chép');
    }
  };

  const download = () => {
    const blob = new Blob([result], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mode}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const langOptions = Object.entries(LANGUAGE_LABELS_VI);
  const supportChip = support
    ? mode === 'summarize'
      ? support.summarizer
      : support.translator || support.summarizer
    : null;
  const showMetaForSummary = mode === 'summarize' && summaryMeta && resultSource === 'local';
  const runBtn = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50';

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm sm:text-base font-bold tracking-tight">Tóm tắt / Dịch / Giải thích code</h1>
          <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
            Chạy miễn phí ngay trong trình duyệt; thêm khóa AI để nâng cao. Văn bản chỉ được gửi tới {providerLabel} khi bạn bấm nút AI.
          </p>
        </div>
        {support && (
          <span
            title={supportChip ? BROWSER_AI_OK_MESSAGE : BROWSER_AI_NO_MESSAGE}
            className={`ml-auto hidden md:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border shrink-0 ${supportChip ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300' : 'bg-slate-700/60 border-slate-600 text-slate-300'}`}
          >
            <Cpu className="h-3 w-3" /> {supportChip ? BROWSER_AI_OK_MESSAGE : BROWSER_AI_NO_MESSAGE}
          </span>
        )}
      </div>

      <AiKeyNotice />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === m.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {support && (
          <span className={`md:hidden inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border ${supportChip ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
            <Cpu className="h-3 w-3" /> {supportChip ? BROWSER_AI_OK_MESSAGE : BROWSER_AI_NO_MESSAGE}
          </span>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-3.5">
        {/* INPUT */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
              <span className={labelCls + ' mb-0'}>Nội dung đầu vào</span>
              <div className="flex gap-1.5 flex-wrap">
                <Link href={toolHref('stt')} className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline">
                  <Mic className="h-3 w-3" /> Dùng STT để đọc bằng giọng nói
                </Link>
                <button onClick={() => fileRef.current?.click()} className={smallBtn}>
                  <Upload className="h-3 w-3" /> Mở file
                </button>
                <button onClick={() => { setInput(''); setResult(''); setError(''); setSummaryMeta(null); setAnalysis(null); }} className={smallBtn}>
                  <Trash2 className="h-3 w-3" /> Xoá
                </button>
                <input ref={fileRef} type="file" accept="text/*,.md,.txt,.json,.js,.ts,.tsx,.jsx,.py,.java,.go,.rs,.c,.cpp,.cs,.php,.rb,.sh,.sql,.html,.css,.yml,.yaml" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            </div>
            <textarea
              data-handoff
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              placeholder={mode === 'explain-code' ? 'Dán đoạn code cần phân tích / giải thích...' : 'Dán hoặc nhập văn bản...'}
              className={`w-full h-64 resize-y rounded-lg border bg-white p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 ${mode === 'explain-code' ? 'font-mono' : ''} ${tooLong ? 'border-amber-400' : 'border-slate-200'}`}
            />
            <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-slate-400 flex-wrap">
              <span>
                {mode !== 'explain-code' && detected && detected.code !== 'und' ? (
                  <>Ngôn ngữ phát hiện: <b className="text-slate-600">{detected.label}</b>{detected.method === 'browser' ? ' (trình duyệt)' : ''}</>
                ) : (
                  'Xử lý miễn phí ngay trên máy bạn'
                )}
              </span>
              <span className={tooLong ? 'text-amber-600 font-semibold' : ''}>
                {input.length.toLocaleString('vi-VN')} ký tự{tooLong ? ` · vượt giới hạn AI ${MAX_INPUT_CHARS.toLocaleString('vi-VN')} (phần miễn phí vẫn dùng được)` : ''}
              </span>
            </div>
          </div>

          {/* ===== MIỄN PHÍ ===== */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2.5">
            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-emerald-600" /> Miễn phí (trình duyệt)
              <span className="text-[10px] font-medium text-slate-500">không cần khóa AI, không gửi dữ liệu đi đâu</span>
            </div>

            {mode === 'summarize' && (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Độ dài">
                    <Select className={selectCls} value={length} onChange={(e) => setLength(e.target.value)}>
                      <option value="short">Ngắn</option>
                      <option value="medium">Vừa</option>
                      <option value="long">Chi tiết</option>
                    </Select>
                  </Field>
                  <Field label="Kiểu trình bày">
                    <Select className={selectCls} value={style} onChange={(e) => setStyle(e.target.value)}>
                      <option value="paragraph">Đoạn văn</option>
                      <option value="bullets">Gạch đầu dòng</option>
                      <option value="tldr">TL;DR</option>
                    </Select>
                  </Field>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={runLocalSummary} disabled={!hasInput || loading} className={`${runBtn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    <Zap className="h-3.5 w-3.5" /> Tóm tắt cục bộ
                  </button>
                  {support?.summarizer && (
                    <button onClick={runBrowserSummary} disabled={!hasInput || loading} className={`${runBtn} bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50`}>
                      <Cpu className="h-3.5 w-3.5" /> Tóm tắt bằng AI tích hợp
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Tóm tắt cục bộ chọn ra những câu quan trọng nhất (trích xuất, giữ nguyên thứ tự gốc, lọc câu trùng ý) kèm từ khóa và thời gian đọc.
                  {support && !support.summarizer && ' Trình duyệt này chưa có Summarizer tích hợp (Chrome 138+ trên máy tính).'}
                  {support?.summarizer && ' Summarizer tích hợp hiện xuất tiếng Anh/Tây Ban Nha/Nhật; muốn tiếng Việt hãy dùng tóm tắt cục bộ hoặc AI.'}
                </p>
              </>
            )}

            {mode === 'translate' && (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Ngôn ngữ nguồn">
                    <Select searchThreshold={0} className={selectCls} value={source} onChange={(e) => setSource(e.target.value)}>
                      <option value="auto">Tự phát hiện</option>
                      {langOptions.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                    </Select>
                  </Field>
                  <Field label="Dịch sang">
                    <Select searchThreshold={0} className={selectCls} value={target} onChange={(e) => setTarget(e.target.value)}>
                      {langOptions.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                    </Select>
                  </Field>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {support?.translator ? (
                    <button onClick={runBrowserTranslate} disabled={!hasInput || loading || trAvail === 'unavailable'} className={`${runBtn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                      <Globe className="h-3.5 w-3.5" /> Dịch bằng trình duyệt
                    </button>
                  ) : null}
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border ${support?.translator && trAvail !== 'unavailable' ? 'bg-white border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'}`}
                  >
                    <Cpu className="h-3 w-3" />
                    {!support
                      ? 'Đang kiểm tra…'
                      : !support.translator
                        ? BROWSER_AI_NO_MESSAGE
                        : trAvail === 'available'
                          ? `${BROWSER_AI_OK_MESSAGE} · sẵn sàng`
                          : trAvail === 'downloadable' || trAvail === 'downloading'
                            ? `${BROWSER_AI_OK_MESSAGE} · cần tải mô hình ngôn ngữ (một lần)`
                            : trAvail === 'unavailable'
                              ? 'Cặp ngôn ngữ này chưa được trình duyệt hỗ trợ — thử cặp khác hoặc dùng AI'
                              : BROWSER_AI_OK_MESSAGE}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {support?.translator
                    ? 'Dịch trực tiếp trên máy bằng mô hình của Chrome; lần đầu cho mỗi cặp ngôn ngữ sẽ tải mô hình (có thể vài chục MB, được lưu lại). Văn bản dài được chia khối tự động.'
                    : 'Không có bản dịch miễn phí trên trình duyệt này. Dùng Chrome 138+ trên máy tính để dịch tích hợp, hoặc dùng phần AI bên dưới để dịch chất lượng cao cho mọi cặp ngôn ngữ.'}
                </p>
              </>
            )}

            {mode === 'explain-code' && (
              <>
                <Field label="Ngôn ngữ lập trình (để trống = tự phát hiện)">
                  <input className={selectCls} placeholder="vd. python, ts, go, c#…" maxLength={30} value={codeLang} onChange={(e) => setCodeLang(e.target.value)} />
                </Field>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={runAnalysis} disabled={!hasInput || loading} className={`${runBtn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    <FileSearch className="h-3.5 w-3.5" /> Phân tích mã cục bộ
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Phân tích tĩnh: đoán ngôn ngữ, dàn ý (import, hàm, lớp, route, SQL, TODO), độ phức tạp, độ sâu lồng, mùi mã & gợi ý bảo mật. Đây không phải lời giải thích ngữ nghĩa — mã không bị chạy hay gửi đi.
                </p>
              </>
            )}
          </div>

          {/* ===== AI MỞ RỘNG ===== */}
          <AiSection
            requires="any"
            title={mode === 'summarize' ? 'Tóm tắt trừu tượng bằng AI' : mode === 'translate' ? 'Dịch chất lượng cao bằng AI' : 'Giải thích code bằng AI'}
            description={
              mode === 'summarize'
                ? 'AI viết lại ý chính bằng lời văn tự nhiên, theo ngôn ngữ bạn chọn.'
                : mode === 'translate'
                  ? 'Dịch mượt cho mọi cặp ngôn ngữ, giữ giọng văn và Markdown/code.'
                  : 'AI giải thích code bằng ngôn ngữ tự nhiên theo trình độ người đọc, kèm độ phức tạp và lỗi tiềm ẩn.'
            }
          >
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2.5">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" /> Nâng cao với AI
                <span className="text-[10px] font-medium text-slate-500">gửi nội dung tới {providerLabel}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {mode === 'summarize' && (
                  <Field label="Ngôn ngữ đầu ra">
                    <Select searchThreshold={0} className={selectCls} value={outLang} onChange={(e) => setOutLang(e.target.value)}>
                      <option value="auto">Giống văn bản gốc</option>
                      {langOptions.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                    </Select>
                  </Field>
                )}
                {mode === 'translate' && (
                  <>
                    <Field label="Giọng văn">
                      <Select className={selectCls} value={tone} onChange={(e) => setTone(e.target.value)}>
                        <option value="keep">Giữ nguyên</option>
                        <option value="formal">Trang trọng</option>
                        <option value="casual">Thân mật</option>
                      </Select>
                    </Field>
                    <div className="col-span-2 flex items-end">
                      <Check label="Giữ nguyên Markdown / code" checked={preserveMd} onChange={setPreserveMd} />
                    </div>
                  </>
                )}
                {mode === 'explain-code' && (
                  <>
                    <Field label="Trình độ người đọc">
                      <Select className={selectCls} value={level} onChange={(e) => setLevel(e.target.value)}>
                        <option value="beginner">Người mới</option>
                        <option value="expert">Có kinh nghiệm</option>
                      </Select>
                    </Field>
                    <div className="flex flex-col justify-end gap-1.5 col-span-2">
                      <Check label="Độ phức tạp" checked={complexity} onChange={setComplexity} />
                      <Check label="Gợi ý lỗi tiềm ẩn" checked={bugs} onChange={setBugs} />
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={runAi}
                  disabled={loading || !hasInput || tooLong}
                  className={`${runBtn} bg-indigo-600 text-white hover:bg-indigo-700`}
                >
                  {loading && resultSource === 'ai' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {mode === 'summarize' ? 'Tóm tắt bằng AI' : mode === 'translate' ? 'Dịch bằng AI' : 'Giải thích bằng AI'}
                </button>
                {tooLong && <span className="text-[11px] text-amber-600">Văn bản dài hơn giới hạn AI ({MAX_INPUT_CHARS.toLocaleString('vi-VN')} ký tự).</span>}
              </div>
            </div>
          </AiSection>

          {loading && (
            <div className="flex items-center gap-2">
              <button onClick={cancel} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-50">
                <X className="h-3.5 w-3.5" /> Huỷ
              </button>
            </div>
          )}
        </div>

        {/* OUTPUT */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5 min-h-[20rem]">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1">
              {(['rendered', 'raw'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${view === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {v === 'rendered' ? 'Hiển thị' : 'Markdown gốc'}
                </button>
              ))}
            </div>
            {result && (
              <div className="flex gap-1.5 flex-wrap">
                <SendToButton text={result} fromToolId="ai-text" />
                <button onClick={() => copyText(result)} className={smallBtn}><Copy className="h-3 w-3" /> Sao chép</button>
                <button onClick={download} className={smallBtn}><Download className="h-3 w-3" /> Tải .md</button>
                <button onClick={retry} disabled={loading} className={smallBtn}><RotateCw className="h-3 w-3" /> Tạo lại</button>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs p-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                {error}
                {/Cài đặt/.test(error) && (
                  <button onClick={() => openSettings('ai')} className="ml-1 underline font-semibold">Mở Cài đặt</button>
                )}
              </div>
              <button onClick={retry} className="underline shrink-0">Thử lại</button>
            </div>
          )}

          {mode === 'explain-code' && analysis && (
            <div className="border-b border-slate-100 pb-3">
              <AnalysisView a={analysis} onCopy={() => copyText(analysisToMarkdown(analysis), 'Đã sao chép báo cáo phân tích')} />
            </div>
          )}

          {loading && (
            <div className="space-y-1.5 py-4">
              <div className="flex items-center gap-2 text-xs text-slate-500 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> {loadingMsg}</div>
              {dl !== null && (
                <div className="mx-auto max-w-xs h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(dl * 100)}%` }} />
                </div>
              )}
            </div>
          )}

          {result ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold">
                <span className={`px-1.5 py-0.5 rounded border ${resultSource === 'ai' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>{SOURCE_LABEL[resultSource]}</span>
                {mode === 'explain-code' && analysis && resultSource === 'ai' && <span className="text-slate-400">Giải thích bằng AI</span>}
              </div>
              {view === 'rendered' ? (
                <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown></div>
              ) : (
                <pre className="whitespace-pre-wrap text-xs text-slate-800 font-mono bg-slate-50 rounded-lg p-3 border border-slate-200">{result}</pre>
              )}
              {showMetaForSummary && <SummaryMeta meta={summaryMeta} input={input} />}
            </div>
          ) : (
            !error && !loading && !(mode === 'explain-code' && analysis) && (
              <div className="text-xs text-slate-400 text-center py-10">
                {mode === 'explain-code' ? 'Bấm “Phân tích mã cục bộ” (miễn phí) để xem dàn ý và cảnh báo.' : 'Kết quả sẽ hiển thị ở đây. Các nút “Miễn phí” hoạt động ngay, không cần khóa AI.'}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
