'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Regex,
  Copy,
  Check,
  Sparkles,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  BookOpen,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  ALL_FLAGS,
  CHEATSHEET,
  EXAMPLES,
  FLAG_INFO,
  MAX_MATCHES,
  buildRegex,
  findMatches,
  formatRegexLiteral,
  replaceAll,
  splitText,
  toHighlightParts,
} from '@/lib/regex-tester';

const DEFAULT_SAMPLE = EXAMPLES[0].sample;

const MARK_COLORS = ['bg-indigo-200/80', 'bg-amber-200/80', 'bg-emerald-200/80', 'bg-pink-200/80'];

const GROUP_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-pink-100 text-pink-700',
  'bg-sky-100 text-sky-700',
];

function visible(s: string) {
  return s.replace(/\n/g, '↵').replace(/\t/g, '→');
}

export default function RegexPage() {
  const { showToast } = useApp();
  const [pattern, setPattern] = useState(EXAMPLES[0].pattern);
  const [flags, setFlags] = useState(EXAMPLES[0].flags);
  const [text, setText] = useState(DEFAULT_SAMPLE);
  const [replacement, setReplacement] = useState('[$&]');
  const [showCheat, setShowCheat] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [replCopied, setReplCopied] = useState(false);

  // Khôi phục trạng thái từ link chia sẻ (đọc sau khi mount để tránh lệch hydration)
  useEffect(() => {
    const q = readShareParams();
    const p = q.get('p');
    if (p === null) return;
    const f = q.get('f');
    const t = q.get('t');
    const r = q.get('r');
    /* eslint-disable react-hooks/set-state-in-effect */
    setPattern(p.slice(0, 2000));
    if (f !== null) setFlags(Array.from(new Set(f.split(''))).filter((c) => ALL_FLAGS.includes(c as never)).join(''));
    if (t !== null) setText(t.slice(0, 5000));
    if (r !== null) setReplacement(r.slice(0, 500));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const built = useMemo(() => buildRegex(pattern, flags), [pattern, flags]);
  const regex = built.regex;

  const result = useMemo(
    () => (regex ? findMatches(regex, text) : { matches: [], capped: false, timedOut: false }),
    [regex, text]
  );
  const parts = useMemo(() => toHighlightParts(text, result.matches), [text, result.matches]);

  const replaced = useMemo(() => (regex ? replaceAll(regex, text, replacement) : null), [regex, text, replacement]);
  const split = useMemo(() => (regex ? splitText(regex, text) : null), [regex, text]);

  const toggleFlag = (f: string) => setFlags(flags.includes(f) ? flags.replace(f, '') : flags + f);

  const copy = async (value: string, msg: string, set: (b: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(value);
      set(true);
      showToast(msg);
      setTimeout(() => set(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const hasPattern = pattern !== '';
  const showMatchCount = result.matches.length;

  return (
    <div className="space-y-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Regex className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Kiểm thử Regex</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Thử biểu thức chính quy với tô sáng trực tiếp, nhóm bắt, thay thế và tách chuỗi. Mọi thứ xử lý ngay trên trình duyệt.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
        <ShareLinkButton
          params={{ p: pattern, f: flags, t: text, r: replacement }}
          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
        />
        <button
          onClick={() => {
            setPattern(EXAMPLES[0].pattern);
            setFlags(EXAMPLES[0].flags);
            setText(DEFAULT_SAMPLE);
            setReplacement('[$&]');
          }}
          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
        >
          <Sparkles className="h-3 w-3 text-amber-400" />
          Dùng mẫu thử
        </button>
        </div>
      </div>

      {/* PATTERN */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`flex-1 min-w-[240px] flex items-center rounded-lg border bg-slate-50/60 font-mono text-sm px-2.5 py-1.5 gap-1 focus-within:bg-white ${
                built.error ? 'border-red-400 ring-1 ring-red-200' : 'border-slate-200 focus-within:border-indigo-500'
              }`}
            >
              <span className="text-slate-400 select-none">/</span>
              <input
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                aria-label="Biểu thức chính quy"
                placeholder="nhập biểu thức, ví dụ \d+"
                className="flex-1 min-w-0 bg-transparent outline-hidden text-slate-800"
              />
              <span className="text-slate-400 select-none">/</span>
              <span className="text-indigo-600 font-semibold select-none">{flags}</span>
            </div>
            <div className="flex items-center gap-1">
              {ALL_FLAGS.map((f) => (
                <button
                  key={f}
                  onClick={() => toggleFlag(f)}
                  title={FLAG_INFO[f].desc}
                  aria-pressed={flags.includes(f)}
                  className={`h-8 w-8 rounded-lg text-xs font-mono font-bold border transition ${
                    flags.includes(f)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <button
              onClick={() => copy(formatRegexLiteral(pattern, flags), 'Đã sao chép /pattern/flags!', setIsCopied)}
              disabled={!hasPattern}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-xs transition flex items-center gap-1"
            >
              {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{isCopied ? 'Đã chép!' : 'Chép /pattern/flags'}</span>
            </button>
          </div>

          {built.error && (
            <div className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Biểu thức không hợp lệ: <span className="font-mono">{built.error}</span>
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500 font-medium mr-1">Ví dụ:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.name}
                onClick={() => {
                  setPattern(ex.pattern);
                  setFlags(ex.flags);
                  setText(ex.sample);
                }}
                className="px-2 py-0.5 rounded-md text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 font-medium transition"
              >
                {ex.name}
              </button>
            ))}
          </div>
        </div>

        {/* Cheat-sheet */}
        <div className="border-t border-slate-100">
          <button
            onClick={() => setShowCheat(!showCheat)}
            aria-expanded={showCheat}
            className="w-full px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 transition"
          >
            {showCheat ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <BookOpen className="h-3.5 w-3.5 text-indigo-500" />
            Bảng tra cú pháp nhanh
          </button>
          {showCheat && (
            <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
              {CHEATSHEET.map((c) => (
                <div key={c.token} className="flex gap-2 items-baseline">
                  <code className="shrink-0 min-w-[110px] font-mono bg-slate-100 text-indigo-700 rounded px-1.5 py-0.5">
                    {c.token}
                  </code>
                  <span className="text-slate-600">{c.desc}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* TEST STRING + HIGHLIGHT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col h-[300px] overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Chuỗi kiểm thử</span>
            <button
              onClick={() => setText('')}
              title="Xóa nội dung"
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="Nhập văn bản cần kiểm thử..."
            className="flex-1 w-full p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-none leading-relaxed text-slate-800 whitespace-pre"
          />
          <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400">{text.length} ký tự</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col h-[300px] overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Kết quả tô sáng</span>
            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 text-xs font-semibold">
              {showMatchCount} khớp{result.capped ? '+' : ''}
            </span>
          </div>
          <div className="flex-1 overflow-auto p-3 text-xs font-mono leading-relaxed text-slate-800 whitespace-pre-wrap break-all">
            {text === '' ? (
              <span className="text-slate-400">Chưa có văn bản.</span>
            ) : (
              parts.map((p, i) =>
                p.match === null ? (
                  <span key={i}>{p.text}</span>
                ) : p.empty ? (
                  <span
                    key={i}
                    title={`Khớp #${p.match + 1} (rỗng)`}
                    className="inline-block w-0.5 h-3.5 align-middle bg-red-500"
                  />
                ) : (
                  <mark
                    key={i}
                    title={`Khớp #${p.match + 1}`}
                    className={`${MARK_COLORS[p.match % MARK_COLORS.length]} text-slate-900 rounded-xs`}
                  >
                    {p.text}
                  </mark>
                )
              )
            )}
          </div>
          {(result.capped || result.timedOut) && (
            <div className="px-3 py-1.5 border-t border-amber-200 bg-amber-50 text-[11px] text-amber-800 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {result.capped
                ? `Chỉ hiển thị ${MAX_MATCHES} khớp đầu tiên.`
                : 'Quá thời gian xử lý, kết quả có thể chưa đầy đủ. Hãy thử biểu thức đơn giản hơn.'}
            </div>
          )}
        </div>
      </div>

      {/* MATCH LIST */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-3 border-b border-slate-100 bg-slate-50/60">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Danh sách khớp</span>
        </div>
        {!hasPattern ? (
          <div className="p-6 text-center text-sm text-slate-400">Nhập biểu thức để bắt đầu.</div>
        ) : built.error ? (
          <div className="p-6 text-center text-sm text-red-500">Sửa lỗi biểu thức để xem kết quả.</div>
        ) : result.matches.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">Không có khớp nào.</div>
        ) : (
          <div className="max-h-[360px] overflow-auto divide-y divide-slate-100">
            {result.matches.map((m, i) => {
              const named = Object.entries(m.named);
              return (
                <div key={m.no} className="px-3 py-2 text-xs flex flex-wrap gap-x-3 gap-y-1 items-start">
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded font-semibold ${MARK_COLORS[i % MARK_COLORS.length]} text-slate-800`}
                  >
                    #{m.no}
                  </span>
                  <span className="shrink-0 text-slate-400 font-mono">
                    [{m.index}–{m.end}]
                  </span>
                  <code className="font-mono text-slate-800 break-all bg-slate-100 rounded px-1.5 py-0.5 max-w-full">
                    {m.text === '' ? '(rỗng)' : visible(m.text)}
                  </code>
                  {(m.groups.length > 0 || named.length > 0) && (
                    <div className="basis-full flex flex-wrap gap-1.5 pl-1">
                      {m.groups.map((g, gi) => (
                        <span
                          key={gi}
                          className={`px-1.5 py-0.5 rounded font-mono ${GROUP_COLORS[gi % GROUP_COLORS.length]}`}
                        >
                          ${gi + 1}: {g === undefined ? 'undefined' : `"${visible(g)}"`}
                        </span>
                      ))}
                      {named.map(([k, v]) => (
                        <span key={k} className="px-1.5 py-0.5 rounded font-mono bg-slate-800 text-slate-100">
                          {'<'}
                          {k}
                          {'>'}: {v === undefined ? 'undefined' : `"${visible(v)}"`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* REPLACE + SPLIT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Thay thế</span>
            <button
              onClick={() => replaced && copy(replaced.output, 'Đã sao chép kết quả thay thế!', setReplCopied)}
              disabled={!replaced || !!replaced.error}
              className="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 rounded-lg transition flex items-center gap-1 border border-indigo-200"
            >
              {replCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              Chép kết quả
            </button>
          </div>
          <div className="p-3 space-y-2">
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              spellCheck={false}
              aria-label="Chuỗi thay thế"
              placeholder="Chuỗi thay thế, ví dụ $1-$<ten> hoặc $&"
              className="w-full rounded-lg border border-slate-200 bg-slate-50/60 focus:bg-white focus:border-indigo-500 outline-hidden px-2.5 py-1.5 text-xs font-mono text-slate-800"
            />
            <p className="text-[11px] text-slate-400">
              Hỗ trợ <code className="font-mono">$1</code>, <code className="font-mono">{'$<ten>'}</code>,{' '}
              <code className="font-mono">$&amp;</code> (toàn bộ khớp), <code className="font-mono">$$</code>. Cần cờ{' '}
              <code className="font-mono">g</code> để thay thế mọi khớp.
            </p>
            <pre className="min-h-[90px] max-h-[260px] overflow-auto rounded-lg bg-slate-50 border border-slate-100 p-2.5 text-xs font-mono text-slate-800 whitespace-pre-wrap break-all">
              {!replaced ? (
                <span className="text-slate-400">Chưa có biểu thức hợp lệ.</span>
              ) : replaced.error ? (
                <span className="text-red-600">{replaced.error}</span>
              ) : (
                replaced.output
              )}
            </pre>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Tách chuỗi (split)</span>
            {split && (
              <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-xs font-semibold">
                {split.total} phần
              </span>
            )}
          </div>
          <div className="p-3">
            {!split ? (
              <div className="text-sm text-slate-400 text-center py-6">Chưa có biểu thức hợp lệ.</div>
            ) : (
              <ol className="max-h-[320px] overflow-auto space-y-1 text-xs">
                {split.parts.map((s, i) => (
                  <li key={i} className="flex gap-2 items-baseline">
                    <span className="shrink-0 w-7 text-right text-slate-400 font-mono">{i + 1}</span>
                    <code className="font-mono bg-slate-100 rounded px-1.5 py-0.5 text-slate-800 break-all whitespace-pre-wrap">
                      {s === '' ? '(rỗng)' : s === undefined ? 'undefined' : visible(s)}
                    </code>
                  </li>
                ))}
                {split.truncated && (
                  <li className="text-[11px] text-amber-700">Chỉ hiển thị 1000 phần đầu tiên.</li>
                )}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
