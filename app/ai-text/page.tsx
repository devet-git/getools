'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Upload, Copy, Download, Loader2, X, RotateCw, Mic, Trash2, AlertTriangle } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { useAiSettings } from '@/lib/use-ai-config';
import { AiKeyNotice } from '@/components/AiKeyNotice';
import { callAi, toAiError } from '@/lib/ai-client';
import { LANGUAGE_LABELS_VI, MAX_INPUT_CHARS, type AiTask } from '@/lib/ai-prompts';

type Mode = 'summarize' | 'translate' | 'explain-code';
const MODES: { id: Mode; label: string }[] = [
  { id: 'summarize', label: 'Tóm tắt' },
  { id: 'translate', label: 'Dịch' },
  { id: 'explain-code', label: 'Giải thích code' },
];

const PROSE =
  'prose prose-sm max-w-none text-slate-800 [&_h1]:text-base [&_h1]:font-extrabold [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h3]:text-xs [&_h3]:font-bold [&_p]:leading-relaxed [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:pl-3 [&_code]:bg-slate-100 [&_code]:text-indigo-700 [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:text-slate-100 [&_table]:w-full [&_table]:border-collapse [&_th]:bg-slate-100 [&_th]:p-2 [&_th]:border [&_th]:border-slate-200 [&_td]:p-2 [&_td]:border [&_td]:border-slate-200';

const selectCls = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40';
const labelCls = 'block text-[11px] font-semibold text-slate-500 mb-1';
const MAX_FILE = 2 * 1024 * 1024;

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

export default function AiTextPage() {
  const { showToast, openSettings } = useApp();
  const { config: aiConfig, providerLabel } = useAiSettings();
  const [mode, setMode] = useState<Mode>('summarize');
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');
  const [view, setView] = useState<'rendered' | 'raw'>('rendered');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // Nhận văn bản chuyển từ STT (đọc một lần rồi xoá)
  useEffect(() => {
    try {
      const incoming = sessionStorage.getItem('ai_text_input');
      if (incoming) {
        sessionStorage.removeItem('ai_text_input');
        setInput(incoming.slice(0, MAX_INPUT_CHARS));
      }
    } catch {
      /* sessionStorage không khả dụng */
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const tooLong = input.length > MAX_INPUT_CHARS;

  const run = async () => {
    if (!input.trim() || tooLong || loading) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');
    const options: Record<string, string | boolean> =
      mode === 'summarize'
        ? { length, style, language: outLang }
        : mode === 'translate'
          ? { source, target, tone, preserveMarkdown: preserveMd }
          : { language: codeLang.trim() || 'auto', level, complexity, bugs };
    try {
      const text = await callAi({ task: mode as AiTask, input, options, ai: aiConfig, signal: ctrl.signal });
      setResult(text);
    } catch (e) {
      const err = toAiError(e);
      if (!err.aborted) setError(err.message);
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
    if (f.size > MAX_FILE) return showToast('File quá lớn (tối đa 2MB).');
    try {
      const t = await f.text();
      if (t.includes('\u0000')) return showToast('Đây không phải file văn bản.');
      setInput(t.slice(0, MAX_INPUT_CHARS));
      if (t.length > MAX_INPUT_CHARS) showToast('Nội dung đã được cắt bớt theo giới hạn.');
    } catch {
      showToast('Không đọc được file.');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      showToast('Đã sao chép kết quả');
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

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-sm sm:text-base font-bold tracking-tight">Tóm tắt / Dịch / Giải thích code (AI)</h1>
          <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
            Nội dung bạn nhập sẽ được gửi tới {providerLabel} để xử lý.
          </p>
        </div>
      </div>

      <AiKeyNotice />

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

      <div className="grid lg:grid-cols-2 gap-3.5">
        {/* INPUT */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {mode === 'summarize' && (
              <>
                <Field label="Độ dài">
                  <select className={selectCls} value={length} onChange={(e) => setLength(e.target.value)}>
                    <option value="short">Ngắn</option>
                    <option value="medium">Vừa</option>
                    <option value="long">Chi tiết</option>
                  </select>
                </Field>
                <Field label="Kiểu trình bày">
                  <select className={selectCls} value={style} onChange={(e) => setStyle(e.target.value)}>
                    <option value="paragraph">Đoạn văn</option>
                    <option value="bullets">Gạch đầu dòng</option>
                    <option value="tldr">TL;DR</option>
                  </select>
                </Field>
                <Field label="Ngôn ngữ đầu ra">
                  <select className={selectCls} value={outLang} onChange={(e) => setOutLang(e.target.value)}>
                    <option value="auto">Giống văn bản gốc</option>
                    {langOptions.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                  </select>
                </Field>
              </>
            )}
            {mode === 'translate' && (
              <>
                <Field label="Ngôn ngữ nguồn">
                  <select className={selectCls} value={source} onChange={(e) => setSource(e.target.value)}>
                    <option value="auto">Tự phát hiện</option>
                    {langOptions.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Dịch sang">
                  <select className={selectCls} value={target} onChange={(e) => setTarget(e.target.value)}>
                    {langOptions.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Giọng văn">
                  <select className={selectCls} value={tone} onChange={(e) => setTone(e.target.value)}>
                    <option value="keep">Giữ nguyên</option>
                    <option value="formal">Trang trọng</option>
                    <option value="casual">Thân mật</option>
                  </select>
                </Field>
                <div className="col-span-2 sm:col-span-3">
                  <Check label="Giữ nguyên Markdown / code" checked={preserveMd} onChange={setPreserveMd} />
                </div>
              </>
            )}
            {mode === 'explain-code' && (
              <>
                <Field label="Ngôn ngữ lập trình">
                  <input
                    className={selectCls}
                    placeholder="Tự phát hiện"
                    maxLength={30}
                    value={codeLang}
                    onChange={(e) => setCodeLang(e.target.value)}
                  />
                </Field>
                <Field label="Trình độ người đọc">
                  <select className={selectCls} value={level} onChange={(e) => setLevel(e.target.value)}>
                    <option value="beginner">Người mới</option>
                    <option value="expert">Có kinh nghiệm</option>
                  </select>
                </Field>
                <div className="flex flex-col justify-end gap-1.5">
                  <Check label="Độ phức tạp" checked={complexity} onChange={setComplexity} />
                  <Check label="Gợi ý lỗi tiềm ẩn" checked={bugs} onChange={setBugs} />
                </div>
              </>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
              <span className={labelCls + ' mb-0'}>Nội dung đầu vào</span>
              <div className="flex gap-1.5">
                <Link href="/stt" className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline">
                  <Mic className="h-3 w-3" /> Dùng STT để đọc bằng giọng nói
                </Link>
                <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50">
                  <Upload className="h-3 w-3" /> Mở file
                </button>
                <button onClick={() => { setInput(''); setResult(''); setError(''); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50">
                  <Trash2 className="h-3 w-3" /> Xoá
                </button>
                <input ref={fileRef} type="file" accept="text/*,.md,.txt,.json,.js,.ts,.tsx,.jsx,.py,.java,.go,.rs,.c,.cpp,.cs,.php,.rb,.sh,.sql,.html,.css,.yml,.yaml" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              placeholder={mode === 'explain-code' ? 'Dán đoạn code cần giải thích...' : 'Dán hoặc nhập văn bản...'}
              className={`w-full h-64 resize-y rounded-lg border bg-white p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 ${mode === 'explain-code' ? 'font-mono' : ''} ${tooLong ? 'border-red-400' : 'border-slate-200'}`}
            />
            <div className={`text-[11px] mt-1 text-right ${tooLong ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
              {input.length.toLocaleString('vi-VN')} / {MAX_INPUT_CHARS.toLocaleString('vi-VN')} ký tự
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={run}
              disabled={loading || !input.trim() || tooLong}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {MODES.find((m) => m.id === mode)?.label}
            </button>
            {loading && (
              <button onClick={cancel} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-50">
                <X className="h-3.5 w-3.5" /> Huỷ
              </button>
            )}
          </div>
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
              <div className="flex gap-1.5">
                <button onClick={copy} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50"><Copy className="h-3 w-3" /> Sao chép</button>
                <button onClick={download} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50"><Download className="h-3 w-3" /> Tải .md</button>
                <button onClick={run} disabled={loading} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RotateCw className="h-3 w-3" /> Tạo lại</button>
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
              <button onClick={run} className="underline shrink-0">Thử lại</button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý với AI...</div>
          ) : result ? (
            view === 'rendered' ? (
              <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown></div>
            ) : (
              <pre className="whitespace-pre-wrap text-xs text-slate-800 font-mono bg-slate-50 rounded-lg p-3 border border-slate-200">{result}</pre>
            )
          ) : (
            !error && <div className="text-xs text-slate-400 text-center py-10">Kết quả sẽ hiển thị ở đây.</div>
          )}
        </div>
      </div>
    </div>
  );
}
