'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Type,
  Copy,
  Check,
  Download,
  Trash2,
  Sparkles,
  ArrowDownToLine,
  Shuffle,
  Upload,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  CASE_LABELS,
  CaseMode,
  DEFAULT_LINE_OPTIONS,
  DEFAULT_REPLACE_OPTIONS,
  LineOptions,
  ReplaceOptions,
  SortMode,
  computeStats,
  convertCase,
  countNonEmptyLines,
  findReplace,
  formatDuration,
  processLines,
  splitLines,
} from '@/lib/text-tools';

import { SendToButton } from '@/components/SendToButton';
import { Select } from '@/components/ui/searchable-select';
type Tab = 'stats' | 'lines' | 'case' | 'replace';

const TABS: { id: Tab; label: string }[] = [
  { id: 'stats', label: 'Thống kê' },
  { id: 'lines', label: 'Làm sạch dòng' },
  { id: 'case', label: 'Đổi kiểu chữ' },
  { id: 'replace', label: 'Tìm & thay thế' },
];

const SORTS: { id: SortMode; label: string }[] = [
  { id: 'none', label: 'Giữ nguyên thứ tự' },
  { id: 'asc', label: 'A → Z' },
  { id: 'desc', label: 'Z → A' },
  { id: 'length', label: 'Theo độ dài' },
  { id: 'natural', label: 'Tự nhiên (file2 < file10)' },
  { id: 'reverse', label: 'Đảo ngược' },
  { id: 'shuffle', label: 'Xáo trộn' },
];

const SAMPLE = `Việt Nam là một quốc gia nằm ở phía đông bán đảo Đông Dương. Thủ đô là Hà Nội!

Thành phố Hồ Chí Minh là trung tâm kinh tế lớn nhất. Đà Nẵng, Huế và Hà Nội đều là những điểm đến nổi tiếng.
Hà Nội
hà nội
file10.txt
file2.txt

file1.txt
Đường Nguyễn Huệ   rất   đẹp`;

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const checkboxCls = 'h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500';
const inputCls =
  'px-2 py-1 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 focus:border-indigo-500 outline-hidden';
const btnCls =
  'px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed';

const nf = new Intl.NumberFormat('vi-VN');

function Check1({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
      <input type="checkbox" className={checkboxCls} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200/90 bg-slate-50/60 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-900 leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export default function TextToolsPage() {
  const { showToast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('stats');
  const [input, setInput] = useState('');
  const deferred = useDeferredValue(input);
  const [copied, setCopied] = useState(false);

  const [noStop, setNoStop] = useState(false);
  const [lineOpts, setLineOpts] = useState<LineOptions>(DEFAULT_LINE_OPTIONS);
  const [caseMode, setCaseMode] = useState<CaseMode>('lower');
  const [nfc, setNfc] = useState(true);
  const [idNoAccent, setIdNoAccent] = useState(true);
  const [rep, setRep] = useState<ReplaceOptions>(DEFAULT_REPLACE_OPTIONS);

  // Khôi phục tùy chọn từ URL
  useEffect(() => {
    const p = readShareParams();
    /* eslint-disable react-hooks/set-state-in-effect */
    const t = p.get('tab');
    if (t && TABS.some((x) => x.id === t)) setTab(t as Tab);
    if (p.get('sw') === '1') setNoStop(true);
    const c = p.get('case');
    if (c && CASE_LABELS.some((x) => x.id === c)) setCaseMode(c as CaseMode);
    if (p.get('nfc') === '0') setNfc(false);
    if (p.get('acc') === '0') setIdNoAccent(false);
    const s = p.get('sort');
    setLineOpts((o) => {
      const n = { ...o };
      if (s && SORTS.some((x) => x.id === s)) n.sort = s as SortMode;
      for (const [k, key] of [
        ['trim', 'trim'],
        ['sp', 'collapseSpaces'],
        ['emp', 'removeEmpty'],
        ['dup', 'dedupe'],
        ['num', 'lineNumbers'],
      ] as const) {
        if (p.get(k) === '1') n[key] = true;
      }
      if (p.get('cs') === '0') n.caseSensitive = false;
      return n;
    });
    setRep((o) => ({
      ...o,
      regex: p.get('re') === '1',
      wholeWord: p.get('ww') === '1',
      caseSensitive: p.get('rcs') === '1',
      flags: (p.get('fl') ?? '').replace(/[^msu]/g, ''),
    }));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const stale = deferred !== input;

  const stats = useMemo(
    () => (tab === 'stats' ? computeStats(deferred, { noStopwords: noStop }) : null),
    [tab, deferred, noStop]
  );

  const lineOut = useMemo(
    () => (tab === 'lines' ? processLines(deferred, lineOpts) : ''),
    [tab, deferred, lineOpts]
  );
  const caseOut = useMemo(
    () => (tab === 'case' ? convertCase(deferred, caseMode, { nfc, noAccentIdentifiers: idNoAccent }) : ''),
    [tab, deferred, caseMode, nfc, idNoAccent]
  );
  const repRes = useMemo(
    () => (tab === 'replace' ? findReplace(deferred, rep) : { output: '', count: 0 }),
    [tab, deferred, rep]
  );

  const output = tab === 'lines' ? lineOut : tab === 'case' ? caseOut : tab === 'replace' ? repRes.output : '';

  const beforeAfter = useMemo(() => {
    if (tab !== 'lines') return null;
    return {
      beforeLines: splitLines(deferred).length,
      beforeNonEmpty: countNonEmptyLines(deferred),
      afterLines: lineOut === '' ? 0 : lineOpts.joinOn ? 1 : splitLines(lineOut).length,
    };
  }, [tab, deferred, lineOut, lineOpts.joinOn]);

  const setLine = <K extends keyof LineOptions>(k: K, v: LineOptions[K]) => setLineOpts((o) => ({ ...o, [k]: v }));
  const setRepo = <K extends keyof ReplaceOptions>(k: K, v: ReplaceOptions[K]) => setRep((o) => ({ ...o, [k]: v }));

  const copyText = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast(msg);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const download = (text: string, name: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Đã tải xuống file!');
  };

  const loadFile = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      showToast(`File "${file.name}" quá lớn (tối đa 5 MB).`);
      return;
    }
    const text = await file.text();
    if (text.includes('\u0000')) {
      showToast(`"${file.name}" có vẻ là file nhị phân, chỉ hỗ trợ file văn bản.`);
      return;
    }
    setInput(text);
  };

  const useAsInput = () => {
    if (!output) return;
    setInput(output);
    showToast('Đã dùng kết quả làm đầu vào mới.');
  };

  const shareParams = {
    tab,
    sw: tab === 'stats' && noStop ? '1' : undefined,
    case: tab === 'case' ? caseMode : undefined,
    nfc: tab === 'case' && !nfc ? '0' : undefined,
    acc: tab === 'case' && !idNoAccent ? '0' : undefined,
    sort: tab === 'lines' && lineOpts.sort !== 'none' ? lineOpts.sort : undefined,
    trim: tab === 'lines' && lineOpts.trim ? '1' : undefined,
    sp: tab === 'lines' && lineOpts.collapseSpaces ? '1' : undefined,
    emp: tab === 'lines' && lineOpts.removeEmpty ? '1' : undefined,
    dup: tab === 'lines' && lineOpts.dedupe ? '1' : undefined,
    cs: tab === 'lines' && lineOpts.dedupe && !lineOpts.caseSensitive ? '0' : undefined,
    num: tab === 'lines' && lineOpts.lineNumbers ? '1' : undefined,
    re: tab === 'replace' && rep.regex ? '1' : undefined,
    ww: tab === 'replace' && rep.wholeWord ? '1' : undefined,
    rcs: tab === 'replace' && rep.caseSensitive ? '1' : undefined,
    fl: tab === 'replace' && rep.flags ? rep.flags : undefined,
  };

  const inputChars = input.length;

  return (
    <div className="space-y-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Type className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Đếm & làm sạch văn bản</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Thống kê, lọc dòng, đổi kiểu chữ, bỏ dấu tiếng Việt, tìm & thay thế. Mọi thứ xử lý ngay trên trình duyệt.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShareLinkButton params={shareParams} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1" />
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
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Đầu vào
            <span className="ml-2 normal-case tracking-normal font-medium text-slate-500">
              {nf.format(inputChars)} ký tự
            </span>
          </span>
          <div className="flex items-center gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept="text/*,.txt,.md,.csv,.json,.log"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
                e.target.value = '';
              }}
            />
            <button onClick={() => fileRef.current?.click()} className={btnCls}>
              <Upload className="h-3.5 w-3.5" />
              Chọn file
            </button>
            <button onClick={() => setInput('')} disabled={!input} className={btnCls}>
              <Trash2 className="h-3.5 w-3.5" />
              Xóa
            </button>
          </div>
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          placeholder="Dán hoặc nhập văn bản vào đây..."
          className="w-full h-56 p-3 text-sm font-mono text-slate-800 bg-white resize-y outline-hidden"
        />
      </div>

      {/* TABS */}
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
              tab === t.id
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* OPTIONS / STATS */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-3">
        {tab === 'stats' && stats && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              <Stat label="Ký tự (có khoảng trắng)" value={nf.format(stats.chars)} />
              <Stat label="Ký tự (không khoảng trắng)" value={nf.format(stats.charsNoSpaces)} />
              <Stat label="Từ" value={nf.format(stats.words)} sub={`${nf.format(stats.uniqueWords)} từ khác nhau`} />
              <Stat label="Câu" value={nf.format(stats.sentences)} />
              <Stat label="Đoạn" value={nf.format(stats.paragraphs)} />
              <Stat label="Dòng" value={nf.format(stats.lines)} />
              <Stat label="Byte (UTF-8)" value={nf.format(stats.bytes)} />
              <Stat label="Thời gian đọc" value={formatDuration(stats.readingMinutes)} sub="≈ 200 từ/phút" />
              <Stat label="Thời gian nói" value={formatDuration(stats.speakingMinutes)} sub="≈ 130 từ/phút" />
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Top 10 từ xuất hiện nhiều nhất</h2>
                <Check1 checked={noStop} onChange={setNoStop} label="Loại bỏ từ dừng (và, là, của, the, a...)" />
              </div>
              {stats.topWords.length === 0 ? (
                <p className="text-xs text-slate-400">Chưa có dữ liệu.</p>
              ) : (
                <ul className="space-y-1">
                  {stats.topWords.map((w) => {
                    const pct = (w.count / stats.topWords[0].count) * 100;
                    return (
                      <li key={w.word} className="flex items-center gap-2 text-xs">
                        <span className="w-28 sm:w-40 truncate text-slate-800 font-medium" data-tooltip={w.word}>
                          {w.word}
                        </span>
                        <div className="flex-1 h-2 rounded bg-slate-100 overflow-hidden">
                          <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-10 text-right tabular-nums text-slate-600">{nf.format(w.count)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {tab === 'lines' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
              <Check1 checked={lineOpts.dedupe} onChange={(v) => setLine('dedupe', v)} label="Xóa dòng trùng (giữ dòng đầu, giữ thứ tự)" />
              <Check1
                checked={lineOpts.caseSensitive}
                onChange={(v) => setLine('caseSensitive', v)}
                label="Phân biệt hoa/thường khi so trùng"
              />
              <Check1 checked={lineOpts.removeEmpty} onChange={(v) => setLine('removeEmpty', v)} label="Xóa dòng trống" />
              <Check1 checked={lineOpts.trim} onChange={(v) => setLine('trim', v)} label="Cắt khoảng trắng đầu/cuối mỗi dòng" />
              <Check1
                checked={lineOpts.collapseSpaces}
                onChange={(v) => setLine('collapseSpaces', v)}
                label="Gộp nhiều khoảng trắng thành một"
              />
              <Check1 checked={lineOpts.lineNumbers} onChange={(v) => setLine('lineNumbers', v)} label="Thêm số thứ tự dòng" />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                Sắp xếp
                <Select
                  value={lineOpts.sort}
                  onChange={(e) => setLine('sort', e.target.value as SortMode)}
                  className={inputCls}
                >
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </label>
              {lineOpts.sort === 'shuffle' && (
                <button onClick={() => setLine('shuffleSeed', lineOpts.shuffleSeed + 1)} className={btnCls}>
                  <Shuffle className="h-3.5 w-3.5" />
                  Xáo lại
                </button>
              )}
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                Tiền tố
                <input
                  value={lineOpts.prefix}
                  onChange={(e) => setLine('prefix', e.target.value)}
                  className={`${inputCls} w-24`}
                  placeholder="vd: - "
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                Hậu tố
                <input
                  value={lineOpts.suffix}
                  onChange={(e) => setLine('suffix', e.target.value)}
                  className={`${inputCls} w-24`}
                  placeholder="vd: ;"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                Xóa dòng chứa
                <input
                  value={lineOpts.removeContaining}
                  onChange={(e) => setLine('removeContaining', e.target.value)}
                  className={`${inputCls} w-32`}
                  placeholder="văn bản..."
                />
              </label>
              <Check1
                checked={lineOpts.removeContainingCase}
                onChange={(v) => setLine('removeContainingCase', v)}
                label="Phân biệt hoa/thường"
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-1.5">
                <Check1 checked={lineOpts.splitOn} onChange={(v) => setLine('splitOn', v)} label="Tách thành dòng theo" />
                <input
                  value={lineOpts.splitSep}
                  onChange={(e) => setLine('splitSep', e.target.value)}
                  className={`${inputCls} w-20`}
                  aria-label="Ký tự tách"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Check1 checked={lineOpts.joinOn} onChange={(v) => setLine('joinOn', v)} label="Nối các dòng bằng" />
                <input
                  value={lineOpts.joinSep}
                  onChange={(e) => setLine('joinSep', e.target.value)}
                  className={`${inputCls} w-20`}
                  aria-label="Ký tự nối"
                />
              </div>
              <span className="text-[11px] text-slate-400">Dùng \n, \t để biểu diễn xuống dòng / tab.</span>
              <button onClick={() => setLineOpts(DEFAULT_LINE_OPTIONS)} className={btnCls}>
                Đặt lại tùy chọn
              </button>
            </div>
            {beforeAfter && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">
                  Trước: {nf.format(beforeAfter.beforeLines)} dòng ({nf.format(beforeAfter.beforeNonEmpty)} dòng có chữ)
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">
                  Sau: {nf.format(beforeAfter.afterLines)} dòng
                </span>
                {beforeAfter.afterLines < beforeAfter.beforeLines && (
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    Giảm {nf.format(beforeAfter.beforeLines - beforeAfter.afterLines)} dòng
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'case' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {CASE_LABELS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCaseMode(c.id)}
                  className={`text-left px-2.5 py-1.5 rounded-lg border transition ${
                    caseMode === c.id
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="text-xs font-semibold">{c.label}</div>
                  <div className="text-[11px] text-slate-400 truncate">{c.example}</div>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <Check1 checked={nfc} onChange={setNfc} label="Chuẩn hóa Unicode NFC trước khi đổi (gộp dấu rời)" />
              <Check1
                checked={idNoAccent}
                onChange={setIdNoAccent}
                label="Bỏ dấu khi đổi sang camelCase / snake_case / kebab-case / ..."
              />
            </div>
            <p className="text-[11px] text-slate-400">
              IN HOA / in thường dùng quy tắc ngôn ngữ tiếng Việt nên giữ đúng dấu (vd: đ ↔ Đ, ế ↔ Ế).
            </p>
          </div>
        )}

        {tab === 'replace' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="text-xs text-slate-700 space-y-1 block">
                <span className="font-medium">Tìm</span>
                <input
                  value={rep.find}
                  onChange={(e) => setRepo('find', e.target.value)}
                  className={`${inputCls} w-full font-mono`}
                  placeholder={rep.regex ? 'Biểu thức chính quy, vd: (\\d+)' : 'Chuỗi cần tìm'}
                />
              </label>
              <label className="text-xs text-slate-700 space-y-1 block">
                <span className="font-medium">Thay bằng</span>
                <input
                  value={rep.replace}
                  onChange={(e) => setRepo('replace', e.target.value)}
                  className={`${inputCls} w-full font-mono`}
                  placeholder={rep.regex ? 'Có thể dùng $1, $&' : 'Chuỗi thay thế (để trống = xóa)'}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Check1 checked={rep.regex} onChange={(v) => setRepo('regex', v)} label="Biểu thức chính quy" />
              <Check1 checked={rep.wholeWord} onChange={(v) => setRepo('wholeWord', v)} label="Khớp nguyên từ" />
              <Check1 checked={rep.caseSensitive} onChange={(v) => setRepo('caseSensitive', v)} label="Phân biệt hoa/thường" />
              {rep.regex && (
                <label className="flex items-center gap-1.5 text-xs text-slate-700">
                  Cờ thêm
                  <input
                    value={rep.flags}
                    onChange={(e) => setRepo('flags', e.target.value.replace(/[^msu]/g, ''))}
                    className={`${inputCls} w-16 font-mono`}
                    placeholder="msu"
                    maxLength={3}
                  />
                </label>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {repRes.error ? (
                <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">Lỗi biểu thức: {repRes.error}</span>
              ) : rep.find === '' ? (
                <span className="text-slate-400">Nhập chuỗi cần tìm để bắt đầu.</span>
              ) : (
                <span
                  className={`px-2 py-0.5 rounded font-semibold ${
                    repRes.count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {repRes.count > 0 ? `Đã thay ${nf.format(repRes.count)} vị trí` : 'Không tìm thấy kết quả nào'}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* OUTPUT */}
      {tab !== 'stats' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Kết quả
              <span className="ml-2 normal-case tracking-normal font-medium text-slate-500">
                {nf.format(output.length)} ký tự{stale ? ' · đang cập nhật...' : ''}
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={useAsInput} disabled={!output} className={btnCls}>
                <ArrowDownToLine className="h-3.5 w-3.5 rotate-180" />
                Dùng kết quả làm đầu vào
              </button>
              <SendToButton text={output} fromToolId="text-tools" />
              <button
                onClick={() => void copyText(output, 'Đã sao chép kết quả!')}
                disabled={!output}
                className={btnCls}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                Sao chép
              </button>
              <button
                onClick={() => download(output, `ket-qua_${new Date().toISOString().slice(0, 10)}.txt`)}
                disabled={!output}
                className={btnCls}
              >
                <Download className="h-3.5 w-3.5" />
                Tải xuống
              </button>
            </div>
          </div>
          <textarea
            readOnly
            value={output}
            spellCheck={false}
            placeholder="Kết quả sẽ hiển thị ở đây."
            className="w-full h-56 p-3 text-sm font-mono text-slate-800 bg-slate-50/40 resize-y outline-hidden"
          />
        </div>
      )}
    </div>
  );
}
