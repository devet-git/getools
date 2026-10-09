'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  GitCommitHorizontal, Upload, Copy, Loader2, X, Trash2, AlertTriangle, CheckCircle2, ShieldAlert, Sparkles, Cpu,
  ChevronDown, ChevronUp, FileSearch, FlaskConical, Bug, KeyRound,
} from 'lucide-react';
import { Select } from '@/components/ui/searchable-select';
import { useApp } from '@/components/AppContext';
import { useAiSettings } from '@/lib/use-ai-config';
import { AiKeyNotice } from '@/components/AiKeyNotice';
import { AiSection } from '@/components/AiSection';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import { callAi, toAiError } from '@/lib/ai-client';
import { MAX_INPUT_CHARS, buildGitCommitCommand, checkCommitMessage, splitPrText, truncateDiff } from '@/lib/ai-prompts';
import {
  CATEGORY_ORDER, analyzeDiff, buildAiHint, categoryLabel,
  type Analysis, type CommitStyle, type FileCategory, type FileDiff, type Lang, type Risk,
} from '@/lib/diff-analyze';
import { toolHref } from '@/lib/tools';

const MAX_FILE = 5 * 1024 * 1024;
const PROSE =
  'prose prose-sm max-w-none text-slate-800 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:rounded [&_table]:text-xs';
const sel = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40';
const lbl = 'block text-[11px] font-semibold text-slate-500 mb-1';
const btn = 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50';
const card = 'bg-white border border-slate-200 rounded-xl p-3.5';

const SAMPLE = `diff --git a/src/api/user-export.ts b/src/api/user-export.ts
new file mode 100644
--- /dev/null
+++ b/src/api/user-export.ts
@@ -0,0 +1,9 @@
+import { db } from '../db';
+
+export async function GET() {
+  const users = await db.users.findMany();
+  if (!users) return Response.json([]);
+  // TODO: stream large exports
+  console.log('exporting', users.length);
+  return Response.json(users);
+}
diff --git a/tests/user-export.test.ts b/tests/user-export.test.ts
new file mode 100644
--- /dev/null
+++ b/tests/user-export.test.ts
@@ -0,0 +1,4 @@
+import { GET } from '../src/api/user-export';
+it('returns all users', async () => {
+  expect(await GET()).toBeDefined();
+});
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -10,5 +10,5 @@
   "dependencies": {
-    "next": "^15.1.0",
+    "next": "^15.4.9",
     "react": "^19.0.0"
   }
`;

const CAT_STYLE: Record<FileCategory, { fill: string; dot: string }> = {
  source: { fill: 'fill-indigo-500', dot: 'bg-indigo-500' },
  test: { fill: 'fill-emerald-500', dot: 'bg-emerald-500' },
  docs: { fill: 'fill-amber-400', dot: 'bg-amber-400' },
  config: { fill: 'fill-slate-400', dot: 'bg-slate-400' },
  build: { fill: 'fill-indigo-300', dot: 'bg-indigo-300' },
  ci: { fill: 'fill-amber-600', dot: 'bg-amber-600' },
  migration: { fill: 'fill-red-400', dot: 'bg-red-400' },
  asset: { fill: 'fill-emerald-300', dot: 'bg-emerald-300' },
  lockfile: { fill: 'fill-slate-300', dot: 'bg-slate-300' },
  generated: { fill: 'fill-slate-200', dot: 'bg-slate-200' },
};

const LEVEL_CLS: Record<Risk['level'], string> = {
  high: 'text-red-700 bg-red-50 border-red-200',
  medium: 'text-amber-800 bg-amber-50 border-amber-200',
  low: 'text-slate-700 bg-slate-50 border-slate-200',
};
const LEVEL_VI: Record<Risk['level'], string> = { high: 'Cao', medium: 'Trung bình', low: 'Thấp' };

type SortKey = 'churn' | 'path' | 'status' | 'category';

export default function AiCommitPage() {
  const { showToast, openSettings } = useApp();
  const { config: aiConfig, providerLabel } = useAiSettings();
  const [diff, setDiff] = useState('');
  const [style, setStyle] = useState<CommitStyle>('conventional');
  const [language, setLanguage] = useState<Lang>('en');
  const [scope, setScope] = useState('');
  const [issue, setIssue] = useState('');
  const [edit, setEdit] = useState<{ base: string; text: string } | null>(null);
  const [showReasons, setShowReasons] = useState(false);
  const [prRaw, setPrRaw] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('churn');
  const [sortDesc, setSortDesc] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // AI: viết lại
  const [useHint, setUseHint] = useState(true);
  const [aiCommit, setAiCommit] = useState('');
  const [aiPr, setAiPr] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  // AI: review
  const [focus, setFocus] = useState('all');
  const [reviewLang, setReviewLang] = useState('vi');
  const [review, setReview] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const reviewAbortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = readShareParams();
    const s = p.get('style');
    if (s === 'conventional' || s === 'short' || s === 'detailed') setStyle(s);
    const l = p.get('lang');
    if (l === 'en' || l === 'vi') setLanguage(l);
    const sc = p.get('scope');
    if (sc) setScope(sc.slice(0, 40));
    const is = p.get('issue');
    if (is) setIssue(is.slice(0, 120));
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    reviewAbortRef.current?.abort();
  }, []);

  const deferredDiff = useDeferredValue(diff);
  const analysis: Analysis | null = useMemo(
    () => (deferredDiff.trim() ? analyzeDiff(deferredDiff, { style, language, scope, issue }) : null),
    [deferredDiff, style, language, scope, issue],
  );
  const trunc = useMemo(() => (deferredDiff.trim() ? truncateDiff(deferredDiff) : null), [deferredDiff]);

  const message = analysis?.ok ? (edit && edit.base === analysis.commitMessage ? edit.text : analysis.commitMessage) : '';
  const check = useMemo(() => (message.trim() ? checkCommitMessage(message, style) : null), [message, style]);
  const command = useMemo(() => (message.trim() ? buildGitCommitCommand(message) : ''), [message]);

  const aiCheck = useMemo(() => (aiCommit ? checkCommitMessage(aiCommit, style) : null), [aiCommit, style]);
  const aiFull = aiCheck ? (aiCheck.body ? `${aiCheck.subject}\n\n${aiCheck.body}` : aiCheck.subject) : '';
  const aiCommand = useMemo(() => (aiFull ? buildGitCommitCommand(aiFull) : ''), [aiFull]);
  const aiPrParts = useMemo(() => (aiPr ? splitPrText(aiPr) : null), [aiPr]);

  const files = useMemo(() => {
    if (!analysis?.ok) return [] as FileDiff[];
    const arr = analysis.parsed.files.slice();
    const dir = sortDesc ? -1 : 1;
    arr.sort((a, b) => {
      let c = 0;
      if (sortKey === 'churn') c = a.added + a.removed - (b.added + b.removed);
      else if (sortKey === 'path') c = a.path.localeCompare(b.path);
      else if (sortKey === 'status') c = a.status.localeCompare(b.status);
      else c = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
      return c * dir || a.path.localeCompare(b.path);
    });
    return arr;
  }, [analysis, sortKey, sortDesc]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Đã sao chép ${what}`);
    } catch {
      showToast('Không thể sao chép');
    }
  };

  const onFile = async (f?: File | null) => {
    if (!f) return;
    if (f.size > MAX_FILE) return showToast('File quá lớn (tối đa 5MB).');
    try {
      setDiff(await f.text());
    } catch {
      showToast('Không đọc được file.');
    }
  };

  const clearAll = () => {
    setDiff('');
    setAiCommit('');
    setAiPr('');
    setReview('');
    setAiError('');
    setReviewError('');
    setEdit(null);
  };

  const aiInput = () => {
    const t = truncateDiff(diff);
    const hint = useHint && analysis?.ok ? buildAiHint(analysis) : '';
    return (hint + t.text).slice(0, MAX_INPUT_CHARS);
  };

  const runAi = async () => {
    if (!diff.trim() || aiLoading) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAiLoading(true);
    setAiError('');
    const input = aiInput();
    const firstIssue = analysis?.issues.closes[0] || analysis?.issues.refs[0] || '';
    const options = { style, language, scope: scope || (analysis?.ok ? analysis.scope : ''), issue: firstIssue };
    try {
      const [c, p] = await Promise.allSettled([
        callAi({ task: 'commit-message', input, options, ai: aiConfig, signal: ctrl.signal }),
        callAi({ task: 'pr-description', input, options, ai: aiConfig, signal: ctrl.signal }),
      ]);
      if (c.status === 'fulfilled') setAiCommit(c.value);
      if (p.status === 'fulfilled') setAiPr(p.value);
      const failed = [c, p].find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) {
        const err = toAiError(failed.reason);
        if (!err.aborted) setAiError(err.message);
      }
    } finally {
      if (abortRef.current === ctrl) setAiLoading(false);
    }
  };

  const runReview = async () => {
    if (!diff.trim() || reviewLoading) return;
    reviewAbortRef.current?.abort();
    const ctrl = new AbortController();
    reviewAbortRef.current = ctrl;
    setReviewLoading(true);
    setReviewError('');
    try {
      const out = await callAi({
        task: 'diff-review',
        input: truncateDiff(diff).text,
        options: { focus, language: reviewLang },
        ai: aiConfig,
        signal: ctrl.signal,
      });
      setReview(out);
    } catch (e) {
      const err = toAiError(e);
      if (!err.aborted) setReviewError(err.message);
    } finally {
      if (reviewAbortRef.current === ctrl) setReviewLoading(false);
    }
  };

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(k === 'churn'); }
  };

  const ok = !!analysis?.ok;
  const secrets = analysis?.findings.filter((f) => f.kind === 'secret') ?? [];

  const errorBox = (msg: string, retry: () => void) => (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs p-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1">
        {msg}
        {/Cài đặt/.test(msg) && <button onClick={() => openSettings('ai')} className="ml-1 underline font-semibold">Mở Cài đặt</button>}
      </div>
      <button onClick={retry} className="underline shrink-0">Thử lại</button>
    </div>
  );

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
          <GitCommitHorizontal className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm sm:text-base font-bold tracking-tight">Commit message & mô tả PR</h1>
          <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
            Dán <code>git diff</code> hoặc mở file .diff/.patch. Công cụ <Link href={toolHref('compare')} className="underline">So sánh File</Link> có thể xuất unified diff.
          </p>
        </div>
        <ShareLinkButton params={{ style, lang: language, scope, issue: issue.slice(0, 120) }} />
      </div>

      <AiKeyNotice />

      <div className="flex items-start gap-2 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
        <Cpu className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          <b>Phân tích cục bộ bằng heuristic</b> ngay trên trình duyệt: không cần khóa AI, <b>không gửi diff đi đâu cả</b>. Kết quả là gợi ý dựa trên quy tắc (tên file, dòng thêm/xóa, từ khóa), hãy đọc lại trước khi commit. Phần AI bên dưới chỉ là tùy chọn mở rộng.
        </span>
      </div>

      <div className="grid lg:grid-cols-2 gap-3.5">
        <div className={card + ' space-y-3'}>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className={lbl}>Kiểu commit</span>
              <Select className={sel} value={style} onChange={(e) => setStyle(e.target.value as CommitStyle)}>
                <option value="conventional">Conventional Commits</option>
                <option value="short">Ngắn gọn</option>
                <option value="detailed">Chi tiết</option>
              </Select>
            </label>
            <label className="block">
              <span className={lbl}>Ngôn ngữ</span>
              <Select searchThreshold={0} className={sel} value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
                <option value="en">Tiếng Anh</option>
                <option value="vi">Tiếng Việt</option>
              </Select>
            </label>
            <label className="block">
              <span className={lbl}>Ghi đè scope (tuỳ chọn)</span>
              <input className={sel} maxLength={40} placeholder={analysis?.ok && analysis.scope ? `tự động: ${analysis.scope}` : 'vd: auth, api'} value={scope} onChange={(e) => setScope(e.target.value)} />
            </label>
            <label className="block">
              <span className={lbl}>Issue / tên nhánh / trailer (tuỳ chọn)</span>
              <input className={sel} maxLength={120} placeholder="vd: #123, feat/ABC-12-export" value={issue} onChange={(e) => setIssue(e.target.value)} />
            </label>
          </div>
          {analysis?.ok && (analysis.issues.refs.length > 0 || analysis.issues.closes.length > 0) && (
            <div className="text-[11px] text-slate-500">
              Nhận diện: {[...analysis.issues.closes.map((x) => `Closes ${x}`), ...analysis.issues.refs.map((x) => `Refs ${x}`)].join(', ')}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1 flex-wrap gap-1.5">
              <span className={lbl + ' mb-0'}>Diff</span>
              <div className="flex gap-1.5 flex-wrap">
                <button className={btn} onClick={() => setDiff(SAMPLE)}><FlaskConical className="h-3 w-3" /> Diff mẫu</button>
                <button className={btn} onClick={() => fileRef.current?.click()}><Upload className="h-3 w-3" /> Mở .diff/.patch</button>
                <button className={btn} onClick={clearAll}><Trash2 className="h-3 w-3" /> Xoá</button>
                <input ref={fileRef} type="file" accept=".diff,.patch,.txt,text/*" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            </div>
            <textarea
              value={diff}
              onChange={(e) => setDiff(e.target.value)}
              spellCheck={false}
              placeholder={'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n...'}
              rows={Math.max(12, Math.min(3000, diff.split('\n').length + 1))}
              className="w-full resize-none overflow-x-auto overflow-y-hidden whitespace-pre rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <div className="text-[11px] mt-1 text-slate-400 text-right">{diff.length.toLocaleString('vi-VN')} ký tự</div>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Mẹo: <code>git diff --staged</code> cho thay đổi sắp commit, <code>git diff main...HEAD</code> cho cả nhánh (mô tả PR). Hỗ trợ cả <code>git show</code>/<code>format-patch</code> và <code>diff -u</code>.
          </p>
        </div>

        <div className="space-y-3.5">
          {!diff.trim() && <div className="bg-white border border-slate-200 rounded-xl p-10 text-xs text-slate-400 text-center">Dán diff ở bên trái để nhận ngay commit message và mô tả PR (miễn phí).</div>}
          {diff.trim() && analysis && !analysis.ok && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs p-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{analysis.error}</span>
            </div>
          )}

          {ok && analysis && check && (
            <div className={card + ' space-y-2.5'}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  Commit message
                  <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-semibold">{analysis.type}</span>
                  {analysis.breaking && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-semibold">BREAKING</span>}
                </h2>
                <div className="flex gap-1.5">
                  <button className={btn} onClick={() => copy(check.subject, 'tiêu đề')}><Copy className="h-3 w-3" /> Tiêu đề</button>
                  <button className={btn} onClick={() => copy(message, 'commit message')}><Copy className="h-3 w-3" /> Toàn bộ</button>
                </div>
              </div>
              <textarea
                value={message}
                onChange={(e) => setEdit({ base: analysis.commitMessage, text: e.target.value })}
                spellCheck={false}
                rows={Math.max(3, message.split('\n').length + 1)}
                aria-label="Commit message (có thể chỉnh sửa)"
                className="w-full resize-none overflow-hidden rounded-lg bg-slate-50 border border-slate-200 p-2.5 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className={`text-[11px] ${check.subject.length > 72 ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>Tiêu đề: {check.subject.length}/72 ký tự</div>
                {edit && edit.base === analysis.commitMessage && (
                  <button className="text-[11px] underline text-slate-500" onClick={() => setEdit(null)}>Khôi phục bản tự động</button>
                )}
              </div>
              <div className="text-[11px] text-slate-600">
                <button className="inline-flex items-center gap-1 underline" onClick={() => setShowReasons((s) => !s)}>
                  Độ tin cậy suy luận type: <b>{Math.round(analysis.confidence * 100)}%</b>
                  {showReasons ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                {analysis.confidence < 0.5 && <span className="ml-1.5 text-amber-700">thấp, hãy kiểm tra lại type</span>}
                {showReasons && (
                  <ul className="mt-1 list-disc pl-4 space-y-0.5 text-slate-500">
                    {analysis.reasons.map((r) => <li key={r}>{r}</li>)}
                    <li>scope: {analysis.scope ? <code>{analysis.scope}</code> : 'không có'} ({{ override: 'do bạn nhập', monorepo: 'tên package monorepo', directory: 'thư mục chung', file: 'tên file', deps: 'dependency', none: 'không xác định' }[analysis.scopeSource]})</li>
                    {analysis.breakingReasons.map((r) => <li key={r} className="text-red-700">breaking: {r}</li>)}
                  </ul>
                )}
              </div>
              {check.warnings.length > 0 ? (
                <ul className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-0.5">
                  {check.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{w}</li>)}
                </ul>
              ) : (
                <div className="text-[11px] text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Đạt các quy tắc kiểm tra.</div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className={lbl + ' mb-0'}>Lệnh git</span>
                  <button className={btn} onClick={() => copy(command, 'lệnh git')}><Copy className="h-3 w-3" /> Sao chép lệnh</button>
                </div>
                <pre className="bg-slate-900 text-slate-100 rounded-lg p-2.5 text-[11px] overflow-x-auto whitespace-pre-wrap break-all">{command}</pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {ok && analysis && (
        <>
          <div className="grid lg:grid-cols-2 gap-3.5">
            <div className={card + ' space-y-2.5'}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-xs font-bold text-slate-800">Mô tả Pull Request</h2>
                <div className="flex gap-1.5 flex-wrap">
                  <button className={btn} onClick={() => setPrRaw((v) => !v)}>{prRaw ? 'Xem trước' : 'Markdown thô'}</button>
                  <button className={btn} onClick={() => copy(analysis.prTitle, 'tiêu đề PR')}><Copy className="h-3 w-3" /> Tiêu đề</button>
                  <button className={btn} onClick={() => copy(analysis.prDescription, 'mô tả PR')}><Copy className="h-3 w-3" /> Mô tả</button>
                </div>
              </div>
              <div className="text-sm font-bold text-slate-900 break-words">{analysis.prTitle}</div>
              {prRaw ? (
                <pre className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-[11px] font-mono text-slate-800 whitespace-pre-wrap break-words">{analysis.prDescription}</pre>
              ) : (
                <div className={PROSE + ''}><ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis.prDescription}</ReactMarkdown></div>
              )}
            </div>

            <div className="space-y-3.5">
              <div className={card + ' space-y-2'}>
                <h2 className="text-xs font-bold text-slate-800">Thống kê thay đổi</h2>
                <StatsBar analysis={analysis} />
              </div>

              <div className={card + ' space-y-2'}>
                <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5" /> Cảnh báo (chỉ quét dòng thêm mới)</h2>
                {analysis.findings.length === 0 ? (
                  <div className="text-[11px] text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Không thấy secret, lệnh debug hay TODO/FIXME trong dòng được thêm.</div>
                ) : (
                  <ul className="space-y-1">
                    {analysis.findings.slice(0, 60).map((f, i) => (
                      <li key={i} className={`text-[11px] rounded-md border px-2 py-1 ${f.kind === 'secret' ? LEVEL_CLS.high : f.kind === 'debug' ? LEVEL_CLS.medium : LEVEL_CLS.low}`}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <b>{f.kind === 'secret' ? 'Bí mật' : f.kind === 'debug' ? 'Debug' : 'TODO'}</b>
                          <span className="opacity-80">{f.rule}</span>
                          <code className="font-mono text-[10px] break-all">{f.file}:{f.line}</code>
                        </div>
                        <code className="block font-mono text-[10px] opacity-80 break-all">{f.text}</code>
                      </li>
                    ))}
                    {analysis.findings.length > 60 && <li className="text-[11px] text-slate-400">... và {analysis.findings.length - 60} cảnh báo khác</li>}
                  </ul>
                )}
                {secrets.length > 0 && <p className="text-[11px] text-red-700">Có nghi ngờ lộ bí mật: hãy thu hồi khóa nếu đã lỡ commit/push, và dùng biến môi trường thay vì ghi cứng.</p>}
              </div>

              <div className={card + ' space-y-2'}>
                <h2 className="text-xs font-bold text-slate-800">Checklist rủi ro (tự động)</h2>
                {analysis.risks.length === 0 ? (
                  <div className="text-[11px] text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Chưa phát hiện rủi ro rõ ràng.</div>
                ) : (
                  <ul className="space-y-1">
                    {analysis.risks.map((r) => (
                      <li key={r.id} className={`text-[11px] rounded-md border px-2 py-1 ${LEVEL_CLS[r.level]}`}>
                        <b>[{LEVEL_VI[r.level]}]</b> {r.vi}
                        {r.items && r.items.length > 0 && <div className="font-mono text-[10px] opacity-80 break-all">{r.items.slice(0, 4).join(' · ')}{r.items.length > 4 ? ` · +${r.items.length - 4}` : ''}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className={card + ' space-y-2'}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-xs font-bold text-slate-800">File thay đổi ({files.length})</h2>
              <div className="flex gap-1 text-[11px] text-slate-500 items-center">
                Sắp xếp:
                {([['churn', 'Mức thay đổi'], ['path', 'Đường dẫn'], ['status', 'Trạng thái'], ['category', 'Nhóm']] as [SortKey, string][]).map(([k, label]) => (
                  <button key={k} onClick={() => toggleSort(k)} className={`px-1.5 py-0.5 rounded border ${sortKey === k ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                    {label}{sortKey === k ? (sortDesc ? ' ↓' : ' ↑') : ''}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1 pr-2 font-semibold w-8">TT</th>
                    <th className="py-1 pr-2 font-semibold">File</th>
                    <th className="py-1 pr-2 font-semibold">Nhóm</th>
                    <th className="py-1 pr-2 font-semibold">Ngôn ngữ</th>
                    <th className="py-1 pr-2 font-semibold text-right">+</th>
                    <th className="py-1 pr-2 font-semibold text-right">-</th>
                    <th className="py-1 font-semibold w-24">Tỷ lệ</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAll ? files : files.slice(0, 100)).map((f) => <FileRow key={f.path + f.oldPath} f={f} max={Math.max(1, ...files.slice(0, 200).map((x) => x.added + x.removed))} />)}
                </tbody>
              </table>
            </div>
            {files.length > 100 && (
              <button className={btn} onClick={() => setShowAll((s) => !s)}>{showAll ? 'Thu gọn' : `Hiển thị tất cả ${files.length} file`}</button>
            )}
          </div>
        </>
      )}

      {/* ------------------------------ AI (tùy chọn) ------------------------------ */}
      <div className="space-y-3.5">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 px-1">
          <Sparkles className="h-3.5 w-3.5 text-indigo-600" /> Mở rộng bằng AI (tùy chọn, cần khóa AI)
        </div>

        <AiSection requires="any" title="Viết lại bằng AI" description="AI đọc nội dung diff để viết commit message và mô tả PR hiểu ngữ nghĩa hơn bản heuristic.">
          <div className={card + ' space-y-3'}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-xs font-bold text-slate-800">Viết lại bằng AI (hiểu ngữ nghĩa)</h2>
            </div>
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Khi bấm nút bên dưới, diff của bạn sẽ được gửi tới {providerLabel} để phân tích. Đừng dán diff chứa mật khẩu, khoá API hoặc mã nguồn bí mật.</span>
            </div>
            {trunc?.truncated && (
              <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Diff lớn nên chỉ gửi bản rút gọn ({trunc.keptLines.toLocaleString('vi-VN')}/{trunc.originalLines.toLocaleString('vi-VN')} dòng, giới hạn {MAX_INPUT_CHARS.toLocaleString('vi-VN')} ký tự).
                  {trunc.skippedFiles.length > 0 && ` Bỏ qua nội dung: ${trunc.skippedFiles.slice(0, 5).join(', ')}${trunc.skippedFiles.length > 5 ? '...' : ''}.`}
                </span>
              </div>
            )}
            <label className="flex items-center gap-2 text-[11px] text-slate-600">
              <input type="checkbox" checked={useHint} onChange={(e) => setUseHint(e.target.checked)} />
              Gửi kèm gợi ý cục bộ (type, scope, tiêu đề dự kiến) để AI tham khảo
            </label>
            <div className="flex gap-2">
              <button onClick={runAi} disabled={aiLoading || !diff.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Viết lại bằng AI
              </button>
              {aiLoading && <button onClick={() => { abortRef.current?.abort(); setAiLoading(false); }} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-50"><X className="h-3.5 w-3.5" /> Huỷ</button>}
            </div>
            {aiError && errorBox(aiError, runAi)}
            {aiLoading && <div className="flex items-center gap-2 text-xs text-slate-500 justify-center p-4"><Loader2 className="h-4 w-4 animate-spin" /> Đang phân tích diff với AI...</div>}

            {aiCheck && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-xs font-bold text-slate-800">Commit message (AI)</h3>
                  <div className="flex gap-1.5">
                    <button className={btn} onClick={() => copy(aiCheck.subject, 'tiêu đề')}><Copy className="h-3 w-3" /> Tiêu đề</button>
                    <button className={btn} onClick={() => copy(aiFull, 'commit message')}><Copy className="h-3 w-3" /> Toàn bộ</button>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 font-mono text-xs text-slate-800 whitespace-pre-wrap break-words">
                  <div className="font-bold">{aiCheck.subject}</div>
                  {aiCheck.body && <div className="mt-2">{aiCheck.body}</div>}
                </div>
                <div className={`text-[11px] ${aiCheck.subject.length > 72 ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>Tiêu đề: {aiCheck.subject.length}/72 ký tự</div>
                {aiCheck.warnings.length > 0 ? (
                  <ul className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-0.5">
                    {aiCheck.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{w}</li>)}
                  </ul>
                ) : (
                  <div className="text-[11px] text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Đạt các quy tắc kiểm tra.</div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={lbl + ' mb-0'}>Lệnh git</span>
                    <button className={btn} onClick={() => copy(aiCommand, 'lệnh git')}><Copy className="h-3 w-3" /> Sao chép lệnh</button>
                  </div>
                  <pre className="bg-slate-900 text-slate-100 rounded-lg p-2.5 text-[11px] overflow-x-auto whitespace-pre-wrap break-all">{aiCommand}</pre>
                </div>
              </div>
            )}
            {aiPrParts && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-xs font-bold text-slate-800">Pull Request (AI)</h3>
                  <div className="flex gap-1.5">
                    <button className={btn} onClick={() => copy(aiPrParts.title, 'tiêu đề PR')}><Copy className="h-3 w-3" /> Tiêu đề</button>
                    <button className={btn} onClick={() => copy(aiPrParts.description, 'mô tả PR')}><Copy className="h-3 w-3" /> Mô tả</button>
                  </div>
                </div>
                <div className="text-sm font-bold text-slate-900">{aiPrParts.title}</div>
                <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{aiPrParts.description}</ReactMarkdown></div>
              </div>
            )}
          </div>
        </AiSection>

        <AiSection requires="any" title="Review diff bằng AI" description="AI review diff: lỗi logic, bảo mật, hiệu năng, phong cách, test.">
          <div className={card + ' space-y-3'}>
            <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><FileSearch className="h-3.5 w-3.5" /> Review diff bằng AI</h2>
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Khi bấm review, diff của bạn sẽ được gửi tới {providerLabel} để phân tích. Đừng dán diff chứa mật khẩu, khoá API hoặc mã nguồn bí mật.</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 max-w-md">
              <label className="block">
                <span className={lbl}>Trọng tâm</span>
                <Select className={sel} value={focus} onChange={(e) => setFocus(e.target.value)}>
                  <option value="all">Toàn diện</option>
                  <option value="bugs">Lỗi logic</option>
                  <option value="security">Bảo mật</option>
                  <option value="performance">Hiệu năng</option>
                  <option value="style">Phong cách / dễ đọc</option>
                  <option value="tests">Kiểm thử</option>
                </Select>
              </label>
              <label className="block">
                <span className={lbl}>Ngôn ngữ review</span>
                <Select searchThreshold={0} className={sel} value={reviewLang} onChange={(e) => setReviewLang(e.target.value)}>
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">Tiếng Anh</option>
                </Select>
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={runReview} disabled={reviewLoading || !diff.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
                {reviewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bug className="h-3.5 w-3.5" />} Review diff
              </button>
              {reviewLoading && <button onClick={() => { reviewAbortRef.current?.abort(); setReviewLoading(false); }} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-50"><X className="h-3.5 w-3.5" /> Huỷ</button>}
            </div>
            {reviewError && errorBox(reviewError, runReview)}
            {reviewLoading && <div className="flex items-center gap-2 text-xs text-slate-500 justify-center p-4"><Loader2 className="h-4 w-4 animate-spin" /> Đang review diff với AI...</div>}
            {review && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-slate-800">Kết quả review</h3>
                  <button className={btn} onClick={() => copy(review, 'kết quả review')}><Copy className="h-3 w-3" /> Sao chép</button>
                </div>
                <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{review}</ReactMarkdown></div>
              </div>
            )}
          </div>
        </AiSection>
        <p className="text-[11px] text-slate-400 px-1 flex items-center gap-1"><KeyRound className="h-3 w-3" /> Chỉ khi bấm nút AI thì diff mới được gửi đi; toàn bộ phần phân tích phía trên chạy cục bộ.</p>
      </div>
    </div>
  );
}

function FileRow({ f, max }: { f: FileDiff; max: number }) {
  const churn = f.added + f.removed;
  const w = Math.max(2, (churn / max) * 100);
  const aw = churn ? (f.added / churn) * w : 0;
  const st = { A: 'text-emerald-700 bg-emerald-50', M: 'text-indigo-700 bg-indigo-50', D: 'text-red-700 bg-red-50', R: 'text-amber-800 bg-amber-50', C: 'text-amber-800 bg-amber-50' }[f.status];
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-1 pr-2"><span className={`inline-block px-1.5 rounded font-mono font-semibold ${st}`}>{f.status}</span></td>
      <td className="py-1 pr-2 font-mono break-all text-slate-800">
        {f.status === 'R' && f.oldPath !== f.path ? <>{f.oldPath} <span className="text-slate-400">→</span> {f.path}</> : f.path}
        {f.binary && <span className="ml-1 text-slate-400">(nhị phân)</span>}
        {f.modeChange && <span className="ml-1 text-slate-400">(đổi quyền)</span>}
      </td>
      <td className="py-1 pr-2 text-slate-600 whitespace-nowrap">{categoryLabel(f.category, 'vi')}</td>
      <td className="py-1 pr-2 text-slate-500 whitespace-nowrap">{f.language || '-'}</td>
      <td className="py-1 pr-2 text-right text-emerald-700 tabular-nums">{f.added ? `+${f.added}` : ''}</td>
      <td className="py-1 pr-2 text-right text-red-600 tabular-nums">{f.removed ? `-${f.removed}` : ''}</td>
      <td className="py-1">
        <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="w-24 h-1.5" role="img" aria-label={`${f.added} dòng thêm, ${f.removed} dòng xóa`}>
          <rect x="0" y="0" width="100" height="6" className="fill-slate-100" />
          <rect x="0" y="0" width={aw} height="6" className="fill-emerald-500" />
          <rect x={aw} y="0" width={Math.max(0, w - aw)} height="6" className="fill-red-400" />
        </svg>
      </td>
    </tr>
  );
}

function StatsBar({ analysis }: { analysis: Analysis }) {
  const { totalAdded, totalRemoved, files } = analysis.parsed;
  const total = totalAdded + totalRemoved;
  const aw = total ? (totalAdded / total) * 100 : 0;
  const cats = analysis.categoryStats;
  const catTotal = cats.reduce((s, c) => s + c.added + c.removed, 0) || 1;
  const segs = cats.map((c, i) => ({ c, w: ((c.added + c.removed) / catTotal) * 100, x: cats.slice(0, i).reduce((s, k) => s + ((k.added + k.removed) / catTotal) * 100, 0) }));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs flex-wrap">
        <span className="text-slate-700"><b>{files.length}</b> file</span>
        <span className="text-emerald-700 font-semibold">+{totalAdded.toLocaleString('vi-VN')}</span>
        <span className="text-red-600 font-semibold">-{totalRemoved.toLocaleString('vi-VN')}</span>
      </div>
      <svg viewBox="0 0 100 5" preserveAspectRatio="none" className="w-full h-2.5 rounded" role="img" aria-label={`${totalAdded} dòng thêm, ${totalRemoved} dòng xóa`}>
        <rect x="0" y="0" width="100" height="5" className="fill-slate-100" />
        {total > 0 && <rect x="0" y="0" width={aw} height="5" className="fill-emerald-500" />}
        {total > 0 && <rect x={aw} y="0" width={100 - aw} height="5" className="fill-red-400" />}
      </svg>
      <svg viewBox="0 0 100 5" preserveAspectRatio="none" className="w-full h-2.5 rounded" role="img" aria-label="Phân bố thay đổi theo nhóm file">
        <rect x="0" y="0" width="100" height="5" className="fill-slate-100" />
        {segs.map(({ c, w, x }) => <rect key={c.category} x={x} y="0" width={w} height="5" className={CAT_STYLE[c.category].fill} />)}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
        {cats.map((c) => (
          <span key={c.category} className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${CAT_STYLE[c.category].dot}`} />
            {categoryLabel(c.category, 'vi')} <span className="text-slate-400">{c.files} file, +{c.added}/-{c.removed}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
