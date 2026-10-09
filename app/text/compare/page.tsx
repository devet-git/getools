'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import {
  GitCompare,
  Upload,
  ArrowLeftRight,
  Trash2,
  Copy,
  Check,
  Download,
  Columns2,
  Rows2,
  Sparkles,
  FileText,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import {
  computeDiff,
  toUnifiedDiff,
  DEFAULT_DIFF_OPTIONS,
  DiffOptions,
  DiffRow,
  Segment,
} from '@/lib/diff';

const SAMPLE_LEFT = `# Danh sách công việc
- Thiết kế giao diện
- Viết API đăng nhập
- Kiểm thử đơn vị

Phiên bản: 1.0.0
Tác giả: Nguyen Van A`;

const SAMPLE_RIGHT = `# Danh sách công việc
- Thiết kế giao diện mới
- Viết API đăng nhập
- Viết API đăng xuất
- Kiểm thử đơn vị

Phiên bản: 1.1.0
Tác giả: Nguyen Van A`;

const MAX_FILE_SIZE = 5 * 1024 * 1024;

interface Side {
  name: string;
  text: string;
}

const rowBg: Record<DiffRow['kind'], string> = {
  equal: '',
  add: 'bg-emerald-50',
  remove: 'bg-red-50',
};

const gutterBg: Record<DiffRow['kind'], string> = {
  equal: 'bg-slate-50 text-slate-400',
  add: 'bg-emerald-100 text-emerald-700',
  remove: 'bg-red-100 text-red-700',
};

function Segments({ row }: { row: DiffRow }) {
  if (!row.segments) return <>{row.text || ' '}</>;
  return (
    <>
      {row.segments.map((s: Segment, i) =>
        s.kind === 'equal' ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span
            key={i}
            className={s.kind === 'add' ? 'bg-emerald-300/70 rounded-xs' : 'bg-red-300/70 rounded-xs'}
          >
            {s.text}
          </span>
        )
      )}
    </>
  );
}

function FilePane({
  title,
  side,
  onChange,
  onError,
  accent,
}: {
  title: string;
  side: Side;
  onChange: (s: Side) => void;
  onError: (msg: string) => void;
  accent: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const loadFile = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      onError(`File "${file.name}" quá lớn (tối đa 5 MB).`);
      return;
    }
    const text = await file.text();
    if (text.includes('\u0000')) {
      onError(`"${file.name}" có vẻ là file nhị phân, chỉ hỗ trợ so sánh file văn bản.`);
      return;
    }
    onChange({ name: file.name, text });
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void loadFile(file);
      }}
      className={`bg-white rounded-xl border shadow-xs flex flex-col h-[320px] overflow-hidden transition ${
        dragging ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200/90'
      }`}
    >
      <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 min-w-0">
          <FileText className={`h-4 w-4 shrink-0 ${accent}`} />
          <span className="shrink-0">{title}</span>
          <input
            value={side.name}
            onChange={(e) => onChange({ ...side, name: e.target.value })}
            aria-label={`Tên ${title}`}
            className="min-w-0 normal-case tracking-normal font-medium text-slate-600 bg-transparent border-b border-dashed border-slate-300 focus:border-indigo-500 outline-hidden px-1 text-xs"
          />
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => inputRef.current?.click()}
            className="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition flex items-center gap-1 border border-indigo-200"
          >
            <Upload className="h-3.5 w-3.5" />
            Chọn file
          </button>
          <button
            onClick={() => onChange({ name: side.name, text: '' })}
            data-tooltip="Xóa nội dung" aria-label="Xóa nội dung"
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <textarea
        value={side.text}
        onChange={(e) => onChange({ ...side, text: e.target.value })}
        spellCheck={false}
        placeholder="Dán văn bản, hoặc kéo-thả / chọn file vào đây..."
        className="flex-1 w-full p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-none leading-relaxed text-slate-800 whitespace-pre"
      />
      <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
        <span>{side.text ? side.text.split(/\r\n|\r|\n/).length : 0} dòng</span>
        <span>{side.text.length} ký tự</span>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const { showToast } = useApp();
  const [left, setLeft] = useState<Side>({ name: 'goc.txt', text: SAMPLE_LEFT });
  const [right, setRight] = useState<Side>({ name: 'moi.txt', text: SAMPLE_RIGHT });
  const [options, setOptions] = useState<DiffOptions>(DEFAULT_DIFF_OPTIONS);
  const [view, setView] = useState<'split' | 'unified'>('split');
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const { rows, stats } = useMemo(
    () => computeDiff(left.text, right.text, options),
    [left.text, right.text, options]
  );

  const hasChanges = stats.added + stats.removed > 0;

  // Với chế độ "chỉ hiện thay đổi", giữ 2 dòng ngữ cảnh quanh mỗi thay đổi
  const visibleRows = useMemo(() => {
    if (!onlyChanges) return rows.map((r, i) => ({ row: r, gap: false, key: i }));
    const CTX = 2;
    const keep = new Array(rows.length).fill(false);
    rows.forEach((r, i) => {
      if (r.kind === 'equal') return;
      for (let d = -CTX; d <= CTX; d++) if (i + d >= 0 && i + d < rows.length) keep[i + d] = true;
    });
    const out: { row: DiffRow; gap: boolean; key: number }[] = [];
    let prevKept = true;
    rows.forEach((r, i) => {
      if (!keep[i]) {
        prevKept = false;
        return;
      }
      out.push({ row: r, gap: !prevKept && out.length > 0, key: i });
      prevKept = true;
    });
    return out;
  }, [rows, onlyChanges]);

  // Tách thành các cặp trái/phải cho chế độ song song
  const splitRows = useMemo(() => {
    const out: { l: DiffRow | null; r: DiffRow | null; gap: boolean; key: number }[] = [];
    let i = 0;
    while (i < visibleRows.length) {
      const { row, gap, key } = visibleRows[i];
      if (row.kind === 'equal') {
        out.push({ l: row, r: row, gap, key });
        i++;
        continue;
      }
      const removes: DiffRow[] = [];
      const adds: DiffRow[] = [];
      const firstGap = gap;
      const firstKey = key;
      while (i < visibleRows.length && visibleRows[i].row.kind !== 'equal') {
        if (i > 0 && visibleRows[i].gap && removes.length + adds.length > 0) break;
        const cur = visibleRows[i].row;
        if (cur.kind === 'remove') removes.push(cur);
        else adds.push(cur);
        i++;
      }
      const n = Math.max(removes.length, adds.length);
      for (let p = 0; p < n; p++) {
        out.push({
          l: removes[p] ?? null,
          r: adds[p] ?? null,
          gap: p === 0 && firstGap,
          key: firstKey * 1000 + p,
        });
      }
    }
    return out;
  }, [visibleRows]);

  const unified = () => toUnifiedDiff(rows, left.name || 'goc', right.name || 'moi');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(unified());
      setIsCopied(true);
      showToast('Đã sao chép kết quả so sánh (unified diff)!');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([unified()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diff_${new Date().toISOString().slice(0, 10)}.patch`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Đã tải xuống file .patch!');
  };

  const handleSwap = () => {
    setLeft(right);
    setRight(left);
  };

  const toggle = (key: keyof DiffOptions) => setOptions({ ...options, [key]: !options[key] });

  const GapRow = ({ cols }: { cols: number }) => (
    <tr>
      <td colSpan={cols} className="bg-slate-100 text-center text-[10px] text-slate-400 py-0.5 select-none">
        ⋯
      </td>
    </tr>
  );

  return (
    <div className="space-y-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <GitCompare className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">So sánh File / Văn bản</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Tìm điểm khác nhau giữa hai file hoặc đoạn văn bản, hiển thị theo dòng và theo từng từ. Mọi thứ xử lý ngay trên trình duyệt.
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setLeft({ name: 'goc.txt', text: SAMPLE_LEFT });
            setRight({ name: 'moi.txt', text: SAMPLE_RIGHT });
          }}
          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
        >
          <Sparkles className="h-3 w-3 text-amber-400" />
          Dùng mẫu thử
        </button>
      </div>

      {/* INPUTS */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3.5 items-stretch">
        <FilePane title="Gốc" side={left} onChange={setLeft} onError={showToast} accent="text-red-500" />
        <div className="flex lg:flex-col items-center justify-center">
          <button
            onClick={handleSwap}
            data-tooltip="Hoán đổi hai bên" aria-label="Hoán đổi hai bên"
            className="p-2 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-xs transition"
          >
            <ArrowLeftRight className="h-4 w-4 lg:rotate-0 rotate-90" />
          </button>
        </div>
        <FilePane title="Mới" side={right} onChange={setRight} onError={showToast} accent="text-emerald-500" />
      </div>

      {/* RESULT */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center flex-wrap gap-2 text-xs">
            <span className="font-bold text-slate-800 uppercase tracking-wider">Kết quả</span>
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">+{stats.added} thêm</span>
            <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">−{stats.removed} xóa</span>
            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">{stats.unchanged} dòng giống</span>
            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">Giống {stats.similarity}%</span>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs">
              <button
                onClick={() => setView('split')}
                className={`px-2 py-0.5 rounded-md font-medium transition flex items-center gap-1 ${
                  view === 'split' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Columns2 className="h-3 w-3" />
                Song song
              </button>
              <button
                onClick={() => setView('unified')}
                className={`px-2 py-0.5 rounded-md font-medium transition flex items-center gap-1 ${
                  view === 'unified' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Rows2 className="h-3 w-3" />
                Gộp
              </button>
            </div>
            <button
              onClick={handleCopy}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition flex items-center gap-1"
            >
              {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{isCopied ? 'Đã chép!' : 'Chép diff'}</span>
            </button>
            <button
              onClick={handleDownload}
              data-tooltip="Tải về file .patch" aria-label="Tải về file .patch"
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg transition"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Options */}
        <div className="px-3 py-2 bg-indigo-50/70 border-b border-indigo-100 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {(
            [
              ['ignoreCase', 'Bỏ qua hoa/thường'],
              ['ignoreWhitespace', 'Bỏ qua khoảng trắng'],
              ['ignoreBlankLines', 'Bỏ qua dòng trống'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium">
              <input
                type="checkbox"
                checked={options[key]}
                onChange={() => toggle(key)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
              />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium">
            <input
              type="checkbox"
              checked={onlyChanges}
              onChange={() => setOnlyChanges(!onlyChanges)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
            />
            Chỉ hiện phần thay đổi
          </label>
        </div>

        {/* Diff body */}
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Nhập hoặc chọn file ở cả hai bên để bắt đầu so sánh.</div>
        ) : !hasChanges ? (
          <div className="p-8 text-center text-sm text-emerald-700 bg-emerald-50/60">
            ✓ Hai nội dung giống hệt nhau{Object.values(options).some(Boolean) ? ' (theo các tùy chọn bỏ qua đang bật)' : ''}.
          </div>
        ) : (
          <div className="max-h-[600px] overflow-auto">
            {view === 'unified' ? (
              <table className="w-full text-xs font-mono border-collapse">
                <tbody>
                  {visibleRows.map(({ row, gap, key }) => (
                    <Fragment key={key}>
                      {gap && <GapRow cols={4} />}
                      <tr className={rowBg[row.kind]}>
                        <td className={`w-10 px-2 text-right select-none ${gutterBg[row.kind]}`}>{row.leftNo ?? ''}</td>
                        <td className={`w-10 px-2 text-right select-none ${gutterBg[row.kind]}`}>{row.rightNo ?? ''}</td>
                        <td className={`w-5 text-center select-none ${gutterBg[row.kind]}`}>
                          {row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ''}
                        </td>
                        <td className="px-2 whitespace-pre-wrap break-all text-slate-800">
                          <Segments row={row} />
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-xs font-mono border-collapse table-fixed">
                <tbody>
                  {splitRows.map(({ l, r, gap, key }) => (
                    <Fragment key={key}>
                      {gap && <GapRow cols={4} />}
                      <tr>
                        <td className={`w-10 px-2 text-right select-none align-top ${l ? gutterBg[l.kind] : 'bg-slate-50'}`}>
                          {l?.leftNo ?? ''}
                        </td>
                        <td
                          className={`px-2 whitespace-pre-wrap break-all align-top border-r border-slate-200 text-slate-800 ${
                            l ? rowBg[l.kind] : 'bg-slate-50'
                          }`}
                        >
                          {l && <Segments row={l} />}
                        </td>
                        <td className={`w-10 px-2 text-right select-none align-top ${r ? gutterBg[r.kind] : 'bg-slate-50'}`}>
                          {r?.rightNo ?? ''}
                        </td>
                        <td
                          className={`px-2 whitespace-pre-wrap break-all align-top text-slate-800 ${
                            r ? rowBg[r.kind] : 'bg-slate-50'
                          }`}
                        >
                          {r && <Segments row={r} />}
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
