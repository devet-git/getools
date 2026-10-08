'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GitCommitHorizontal, Upload, Copy, Loader2, X, Trash2, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { useAiSettings } from '@/lib/use-ai-config';
import { AiKeyNotice } from '@/components/AiKeyNotice';
import { callAi, toAiError } from '@/lib/ai-client';
import { MAX_INPUT_CHARS, buildGitCommitCommand, checkCommitMessage, splitPrText, truncateDiff } from '@/lib/ai-prompts';

const MAX_FILE = 5 * 1024 * 1024;
const PROSE =
  'prose prose-sm max-w-none text-slate-800 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:rounded';
const sel = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40';
const lbl = 'block text-[11px] font-semibold text-slate-500 mb-1';
const btn = 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50';

export default function AiCommitPage() {
  const { showToast, setIsSettingsOpen } = useApp();
  const { config: aiConfig, providerLabel } = useAiSettings();
  const [diff, setDiff] = useState('');
  const [style, setStyle] = useState('conventional');
  const [language, setLanguage] = useState('en');
  const [scope, setScope] = useState('');
  const [issue, setIssue] = useState('');
  const [commit, setCommit] = useState('');
  const [pr, setPr] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const trunc = useMemo(() => (diff.trim() ? truncateDiff(diff) : null), [diff]);
  const check = useMemo(() => (commit ? checkCommitMessage(commit, style) : null), [commit, style]);
  const prParts = useMemo(() => (pr ? splitPrText(pr) : null), [pr]);
  const fullMessage = check ? (check.body ? `${check.subject}\n\n${check.body}` : check.subject) : '';
  const command = useMemo(() => (fullMessage ? buildGitCommitCommand(fullMessage) : ''), [fullMessage]);

  const run = async () => {
    if (!diff.trim() || loading) return;
    const t = truncateDiff(diff);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');
    const options = { style, language, scope, issue };
    try {
      const [c, p] = await Promise.allSettled([
        callAi({ task: 'commit-message', input: t.text, options, ai: aiConfig, signal: ctrl.signal }),
        callAi({ task: 'pr-description', input: t.text, options, ai: aiConfig, signal: ctrl.signal }),
      ]);
      if (c.status === 'fulfilled') setCommit(c.value);
      if (p.status === 'fulfilled') setPr(p.value);
      const failed = [c, p].find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) {
        const err = toAiError(failed.reason);
        if (!err.aborted) setError(err.message);
      }
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setLoading(false);
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

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Đã sao chép ${what}`);
    } catch {
      showToast('Không thể sao chép');
    }
  };

  const hasOutput = !!(commit || pr);

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
          <GitCommitHorizontal className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-sm sm:text-base font-bold tracking-tight">Commit message & mô tả PR (AI)</h1>
          <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
            Dán <code>git diff</code> hoặc mở file .diff/.patch. Công cụ <Link href="/compare" className="underline">So sánh File</Link> có thể xuất unified diff.
          </p>
        </div>
      </div>

      <AiKeyNotice />

      <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Diff của bạn sẽ được gửi tới {providerLabel} để phân tích. Đừng dán diff chứa mật khẩu, khoá API hoặc mã nguồn bí mật.</span>
      </div>

      <div className="grid lg:grid-cols-2 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className={lbl}>Kiểu commit</span>
              <select className={sel} value={style} onChange={(e) => setStyle(e.target.value)}>
                <option value="conventional">Conventional Commits</option>
                <option value="short">Ngắn gọn</option>
                <option value="detailed">Chi tiết</option>
              </select>
            </label>
            <label className="block">
              <span className={lbl}>Ngôn ngữ</span>
              <select className={sel} value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en">Tiếng Anh</option>
                <option value="vi">Tiếng Việt</option>
              </select>
            </label>
            <label className="block">
              <span className={lbl}>Gợi ý scope (tuỳ chọn)</span>
              <input className={sel} maxLength={40} placeholder="vd: auth, api" value={scope} onChange={(e) => setScope(e.target.value)} />
            </label>
            <label className="block">
              <span className={lbl}>Số issue (tuỳ chọn)</span>
              <input className={sel} maxLength={30} placeholder="vd: #123" value={issue} onChange={(e) => setIssue(e.target.value)} />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className={lbl + ' mb-0'}>Diff</span>
              <div className="flex gap-1.5">
                <button className={btn} onClick={() => fileRef.current?.click()}><Upload className="h-3 w-3" /> Mở .diff/.patch</button>
                <button className={btn} onClick={() => { setDiff(''); setCommit(''); setPr(''); setError(''); }}><Trash2 className="h-3 w-3" /> Xoá</button>
                <input ref={fileRef} type="file" accept=".diff,.patch,.txt,text/*" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            </div>
            <textarea
              value={diff}
              onChange={(e) => setDiff(e.target.value)}
              spellCheck={false}
              placeholder={'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n...'}
              className="w-full h-72 resize-y rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <div className="text-[11px] mt-1 text-slate-400 text-right">{diff.length.toLocaleString('vi-VN')} ký tự</div>
            {trunc?.truncated && (
              <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Diff lớn nên chỉ gửi bản rút gọn ({trunc.keptLines.toLocaleString('vi-VN')}/{trunc.originalLines.toLocaleString('vi-VN')} dòng, giới hạn {MAX_INPUT_CHARS.toLocaleString('vi-VN')} ký tự).
                  {trunc.skippedFiles.length > 0 && ` Bỏ qua nội dung: ${trunc.skippedFiles.slice(0, 5).join(', ')}${trunc.skippedFiles.length > 5 ? '...' : ''}.`}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={run} disabled={loading || !diff.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommitHorizontal className="h-3.5 w-3.5" />} Tạo commit & PR
            </button>
            {loading && <button onClick={cancel} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-50"><X className="h-3.5 w-3.5" /> Huỷ</button>}
          </div>
        </div>

        <div className="space-y-3.5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs p-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                {error}
                {/Cài đặt/.test(error) && <button onClick={() => setIsSettingsOpen(true)} className="ml-1 underline font-semibold">Mở Cài đặt</button>}
              </div>
              <button onClick={run} className="underline shrink-0">Thử lại</button>
            </div>
          )}
          {loading && <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-2 text-xs text-slate-500 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Đang phân tích diff với AI...</div>}
          {!hasOutput && !loading && !error && <div className="bg-white border border-slate-200 rounded-xl p-10 text-xs text-slate-400 text-center">Kết quả sẽ hiển thị ở đây.</div>}

          {check && (
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-xs font-bold text-slate-800">Commit message</h2>
                <div className="flex gap-1.5">
                  <button className={btn} onClick={() => copy(check.subject, 'tiêu đề')}><Copy className="h-3 w-3" /> Tiêu đề</button>
                  <button className={btn} onClick={() => copy(fullMessage, 'commit message')}><Copy className="h-3 w-3" /> Toàn bộ</button>
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 font-mono text-xs text-slate-800 whitespace-pre-wrap break-words">
                <div className="font-bold">{check.subject}</div>
                {check.body && <div className="mt-2">{check.body}</div>}
              </div>
              <div className={`text-[11px] ${check.subject.length > 72 ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                Tiêu đề: {check.subject.length}/72 ký tự
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

          {prParts && (
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-xs font-bold text-slate-800">Pull Request</h2>
                <div className="flex gap-1.5">
                  <button className={btn} onClick={() => copy(prParts.title, 'tiêu đề PR')}><Copy className="h-3 w-3" /> Tiêu đề</button>
                  <button className={btn} onClick={() => copy(prParts.description, 'mô tả PR')}><Copy className="h-3 w-3" /> Mô tả</button>
                </div>
              </div>
              <div className="text-sm font-bold text-slate-900">{prParts.title}</div>
              <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{prParts.description}</ReactMarkdown></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
