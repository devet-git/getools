'use client';

import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  GitCompareArrows,
  Upload,
  ArrowLeftRight,
  Trash2,
  Copy,
  Check,
  Download,
  Sparkles,
  FileText,
  ChevronRight,
  ChevronDown,
  Search,
  ListChecks,
  ListTree,
  Columns2,
  FileJson,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import { byteLength, detectFormat, formatBytes, parseJson, parseYaml, ParseError } from '@/lib/json-yaml';
import { computeDiff, DiffRow, Segment } from '@/lib/diff';
import {
  Change,
  ChangeKind,
  DEFAULT_DIFF_OPTIONS,
  DiffOptions,
  MAX_CHANGES,
  MergedNode,
  SAMPLE_A,
  SAMPLE_B,
  applyPatch,
  diffJson,
  isEqualJson,
  prepareForView,
  previewValue,
  summarizeText,
} from '@/lib/json-diff';

const MAX_INPUT_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Phân tích đầu vào
// ---------------------------------------------------------------------------

type Parsed =
  | { state: 'empty' }
  | { state: 'ok'; value: unknown; format: 'json' | 'yaml'; bytes: number }
  | { state: 'error'; error: ParseError };

function parseInput(text: string): Parsed {
  if (!text.trim()) return { state: 'empty' };
  const bytes = byteLength(text);
  if (bytes > MAX_INPUT_BYTES) {
    return { state: 'error', error: { message: `Dữ liệu quá lớn (${formatBytes(bytes)}). Giới hạn ${formatBytes(MAX_INPUT_BYTES)} mỗi bên.` } };
  }
  const fmt = detectFormat(text) ?? 'json';
  const r = fmt === 'json' ? parseJson(text) : parseYaml(text);
  if (r.ok) return { state: 'ok', value: r.value, format: fmt, bytes };
  return { state: 'error', error: r.error };
}

// ---------------------------------------------------------------------------
// Giao diện chung
// ---------------------------------------------------------------------------

const KIND_META: Record<ChangeKind, { label: string; badge: string; row: string; sym: string }> = {
  added: { label: 'Thêm', badge: 'bg-emerald-100 text-emerald-700', row: 'border-l-emerald-500 bg-emerald-50/50', sym: '+' },
  removed: { label: 'Xóa', badge: 'bg-red-100 text-red-700', row: 'border-l-red-500 bg-red-50/50', sym: '−' },
  changed: { label: 'Sửa', badge: 'bg-amber-100 text-amber-700', row: 'border-l-amber-500 bg-amber-50/50', sym: '~' },
  'type-changed': { label: 'Đổi kiểu', badge: 'bg-indigo-100 text-indigo-700', row: 'border-l-indigo-500 bg-indigo-50/50', sym: '!' },
  moved: { label: 'Di chuyển', badge: 'bg-slate-200 text-slate-700', row: 'border-l-slate-400 bg-slate-100/60', sym: '↔' },
};
const KIND_ORDER: ChangeKind[] = ['added', 'removed', 'changed', 'type-changed', 'moved'];

const btnDark =
  'px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1';
const btnLight =
  'px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition flex items-center gap-1';

function useCopy() {
  const { showToast } = useApp();
  return async (text: string, msg = 'Đã sao chép!') => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(msg);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };
}

function downloadText(name: string, text: string, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface Side {
  name: string;
  text: string;
}

function Pane({
  title,
  side,
  onChange,
  parsed,
  accent,
}: {
  title: string;
  side: Side;
  onChange: (s: Side) => void;
  parsed: Parsed;
  accent: string;
}) {
  const { showToast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const loadFile = async (file: File) => {
    if (file.size > MAX_INPUT_BYTES) {
      showToast(`File quá lớn (${formatBytes(file.size)}). Giới hạn ${formatBytes(MAX_INPUT_BYTES)}.`);
      return;
    }
    try {
      onChange({ name: file.name, text: await file.text() });
    } catch {
      showToast('Không đọc được file.');
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void loadFile(f);
      }}
      className={`bg-white rounded-xl border shadow-xs flex flex-col overflow-hidden transition ${
        drag ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200'
      }`}
    >
      <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 min-w-0">
          <FileText className={`h-4 w-4 shrink-0 ${accent}`} />
          <span className="shrink-0">{title}</span>
          <input
            value={side.name}
            onChange={(e) => onChange({ ...side, name: e.target.value })}
            placeholder="tên file (tuỳ chọn)"
            className="min-w-0 normal-case tracking-normal font-medium text-slate-600 bg-transparent border-b border-dashed border-slate-300 focus:border-indigo-500 outline-hidden px-1 text-xs"
          />
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => fileRef.current?.click()}
            className="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition flex items-center gap-1 border border-indigo-200"
          >
            <Upload className="h-3.5 w-3.5" />
            Chọn file
          </button>
          <button
            onClick={() => onChange({ name: '', text: '' })}
            title="Xóa nội dung"
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.yaml,.yml,.txt,application/json,text/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <textarea
        value={side.text}
        onChange={(e) => onChange({ ...side, text: e.target.value })}
        spellCheck={false}
        placeholder="Dán JSON (hoặc YAML), hoặc kéo-thả / chọn file vào đây..."
        rows={Math.max(12, Math.min(3000, side.text.split('\n').length + 1))}
        className="w-full p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-none overflow-x-auto overflow-y-hidden leading-relaxed text-slate-800 whitespace-pre"
      />
      <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] flex justify-between gap-2">
        {parsed.state === 'error' ? (
          <span className="text-red-600 truncate" title={parsed.error.message}>
            Lỗi{parsed.error.line ? ` (dòng ${parsed.error.line}${parsed.error.col ? `, cột ${parsed.error.col}` : ''})` : ''}: {parsed.error.message}
          </span>
        ) : parsed.state === 'ok' ? (
          <span className="text-emerald-600">
            Hợp lệ ({parsed.format.toUpperCase()}) · {formatBytes(parsed.bytes)}
          </span>
        ) : (
          <span className="text-slate-400">Chưa có dữ liệu</span>
        )}
        <span className="text-slate-400 shrink-0">{side.text.length} ký tự</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Danh sách thay đổi
// ---------------------------------------------------------------------------

function ValueBox({ v, tone }: { v: unknown; tone: 'old' | 'new' }) {
  const full = previewValue(v, 4000);
  return (
    <code
      title={full}
      className={`block px-1.5 py-0.5 rounded text-[11px] font-mono break-all whitespace-pre-wrap max-h-24 overflow-hidden ${
        tone === 'old' ? 'bg-red-100/70 text-red-800' : 'bg-emerald-100/70 text-emerald-800'
      }`}
    >
      {previewValue(v, 240)}
    </code>
  );
}

function ChangeRow({ ch, onCopy }: { ch: Change; onCopy: (t: string, m?: string) => void }) {
  const meta = KIND_META[ch.kind];
  return (
    <div className={`border-l-4 ${meta.row} px-3 py-2 text-xs flex flex-col gap-1.5`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${meta.badge}`}>{meta.label}</span>
        <button
          onClick={() => onCopy(ch.jsonPath, 'Đã chép JSONPath!')}
          title="Bấm để chép JSONPath"
          className="font-mono font-semibold text-slate-800 break-all text-left hover:text-indigo-600"
        >
          {ch.jsonPath}
        </button>
        <button
          onClick={() => onCopy(ch.pointer, 'Đã chép JSON Pointer!')}
          title="Bấm để chép JSON Pointer"
          className="font-mono text-[11px] text-slate-400 break-all hover:text-indigo-600"
        >
          {ch.pointer || '(gốc)'}
        </button>
        {ch.kind === 'type-changed' && (
          <span className="text-[11px] text-indigo-700 font-medium">
            {ch.oldType} → {ch.newType}
          </span>
        )}
        {ch.kind === 'moved' && <span className="text-[11px] text-slate-500 font-mono break-all">từ {ch.fromJsonPath}</span>}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {ch.hasOld && ch.kind !== 'moved' && <ValueBox v={ch.oldValue} tone="old" />}
        {ch.hasNew && <ValueBox v={ch.newValue} tone="new" />}
      </div>
    </div>
  );
}

function ChangeList({ changes, onCopy }: { changes: Change[]; onCopy: (t: string, m?: string) => void }) {
  const [enabled, setEnabled] = useState<Set<ChangeKind>>(new Set(KIND_ORDER));
  const [query, setQuery] = useState('');
  const [grouped, setGrouped] = useState(false);
  const [limit, setLimit] = useState(200);

  const counts = useMemo(() => {
    const c: Record<ChangeKind, number> = { added: 0, removed: 0, changed: 0, 'type-changed': 0, moved: 0 };
    for (const ch of changes) c[ch.kind]++;
    return c;
  }, [changes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = changes.filter((c) => enabled.has(c.kind));
    if (q) {
      list = list.filter(
        (c) =>
          c.jsonPath.toLowerCase().includes(q) ||
          c.pointer.toLowerCase().includes(q) ||
          (c.hasOld && previewValue(c.oldValue, 500).toLowerCase().includes(q)) ||
          (c.hasNew && previewValue(c.newValue, 500).toLowerCase().includes(q))
      );
    }
    if (grouped) list = [...list].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    return list;
  }, [changes, enabled, query, grouped]);

  const toggle = (k: ChangeKind) => {
    setEnabled((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
    setLimit(200);
  };

  const shown = filtered.slice(0, limit);
  return (
    <div>
      <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2">
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            onClick={() => toggle(k)}
            disabled={counts[k] === 0}
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border transition disabled:opacity-40 ${
              enabled.has(k) ? `${KIND_META[k].badge} border-transparent` : 'bg-white text-slate-400 border-slate-200 line-through'
            }`}
          >
            {KIND_META[k].label} {counts[k]}
          </button>
        ))}
        <div className="relative flex-1 min-w-[160px]">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(200);
            }}
            placeholder="Tìm theo đường dẫn hoặc giá trị..."
            className="w-full pl-7 pr-2 py-1 text-xs rounded-lg border border-slate-200 bg-white outline-hidden focus:border-indigo-400"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={grouped}
            onChange={() => setGrouped(!grouped)}
            className="rounded border-slate-300 text-indigo-600 h-3.5 w-3.5"
          />
          Nhóm theo loại
        </label>
      </div>
      {filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">Không có thay đổi nào khớp bộ lọc.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {shown.map((ch, i) => (
            <Fragment key={i}>
              {grouped && (i === 0 || shown[i - 1].kind !== ch.kind) && (
                <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 sticky top-0">
                  {KIND_META[ch.kind].label} ({counts[ch.kind]})
                </div>
              )}
              <ChangeRow ch={ch} onCopy={onCopy} />
            </Fragment>
          ))}
          {filtered.length > limit && (
            <button
              onClick={() => setLimit(limit + 300)}
              className="w-full py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
            >
              Hiển thị thêm ({filtered.length - limit} thay đổi nữa)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cây hợp nhất
// ---------------------------------------------------------------------------

const NODE_TONE: Record<string, string> = {
  same: 'text-slate-500',
  container: 'text-slate-700',
  added: 'bg-emerald-50 text-emerald-800',
  removed: 'bg-red-50 text-red-800 line-through decoration-red-300',
  changed: 'bg-amber-50 text-amber-900',
  'type-changed': 'bg-indigo-50 text-indigo-900',
  moved: 'bg-slate-100 text-slate-800',
};
const NODE_SYM: Record<string, string> = { added: '+', removed: '−', changed: '~', 'type-changed': '!', moved: '↔' };

function isComposite(v: unknown): boolean {
  return typeof v === 'object' && v !== null;
}

function summaryOf(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (isComposite(v)) return `{${Object.keys(v as object).length}}`;
  return previewValue(v, 80);
}

function RawJson({ v }: { v: unknown }) {
  const text = useMemo(() => {
    try {
      const s = JSON.stringify(v, null, 2) ?? '';
      return s.length > 6000 ? s.slice(0, 6000) + '\n… (đã cắt bớt)' : s;
    } catch {
      return '';
    }
  }, [v]);
  return <pre className="ml-6 my-0.5 p-2 rounded bg-slate-50 border border-slate-100 text-[11px] font-mono text-slate-700 overflow-x-auto">{text}</pre>;
}

function TreeNode({ node, depth, openDepth }: { node: MergedNode; depth: number; openDepth: number }) {
  const hasKids = node.status === 'container';
  const valueForRaw = node.status === 'removed' ? node.oldValue : node.newValue;
  const composite = isComposite(valueForRaw);
  const expandable = hasKids || (composite && node.status !== 'changed' && node.status !== 'type-changed');
  const [open, setOpen] = useState(hasKids && depth < openDepth);
  const [showSame, setShowSame] = useState(false);
  const [limit, setLimit] = useState(200);

  const label = node.key === null ? '$' : typeof node.key === 'number' ? `[${node.key}]` : node.key;
  const kids = node.children ?? [];
  const sameCount = kids.filter((k) => k.status === 'same').length;
  const visible = showSame ? kids : kids.filter((k) => k.status !== 'same');

  return (
    <div>
      <div
        className={`flex items-start gap-1 rounded px-1 py-px text-xs font-mono ${NODE_TONE[node.status]} ${expandable ? 'cursor-pointer' : ''}`}
        onClick={() => expandable && setOpen(!open)}
      >
        <span className="w-4 shrink-0 text-slate-400 pt-0.5">
          {expandable ? open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" /> : null}
        </span>
        {NODE_SYM[node.status] && <span className="w-3 shrink-0 font-bold">{NODE_SYM[node.status]}</span>}
        <span className="font-semibold break-all">{label}:</span>
        {node.status === 'changed' || node.status === 'type-changed' ? (
          <span className="break-all">
            <span className="line-through opacity-70">{summaryOf(node.oldValue)}</span> → <span className="font-semibold">{summaryOf(node.newValue)}</span>
          </span>
        ) : node.status === 'moved' ? (
          <span className="break-all">
            {summaryOf(node.newValue)} <span className="text-slate-500">(từ [{node.fromIndex}])</span>
          </span>
        ) : (
          <span className="break-all">{summaryOf(valueForRaw)}</span>
        )}
      </div>
      {open && hasKids && (
        <div className="ml-4 pl-2 border-l border-slate-200">
          {visible.slice(0, limit).map((k, i) => (
            <TreeNode key={`${String(k.key)}-${i}`} node={k} depth={depth + 1} openDepth={openDepth} />
          ))}
          {visible.length > limit && (
            <button onClick={() => setLimit(limit + 300)} className="text-[11px] text-indigo-600 hover:underline px-1 py-0.5">
              Hiển thị thêm ({visible.length - limit})
            </button>
          )}
          {sameCount > 0 && (
            <button
              onClick={() => setShowSame(!showSame)}
              className="text-[11px] text-slate-400 hover:text-indigo-600 px-1 py-0.5 block"
            >
              {showSame ? 'Ẩn' : 'Hiện'} {sameCount} mục không đổi
            </button>
          )}
        </div>
      )}
      {open && !hasKids && composite && <RawJson v={valueForRaw} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Song song
// ---------------------------------------------------------------------------

interface SplitRow {
  l: DiffRow | null;
  r: DiffRow | null;
}

function buildSplit(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.kind === 'equal') {
      out.push({ l: r, r });
      i++;
      continue;
    }
    const rem: DiffRow[] = [];
    const add: DiffRow[] = [];
    while (i < rows.length && rows[i].kind !== 'equal') {
      (rows[i].kind === 'remove' ? rem : add).push(rows[i]);
      i++;
    }
    const n = Math.max(rem.length, add.length);
    for (let k = 0; k < n; k++) out.push({ l: rem[k] ?? null, r: add[k] ?? null });
  }
  return out;
}

function Segs({ row }: { row: DiffRow }) {
  if (!row.segments) return <>{row.text || ' '}</>;
  return (
    <>
      {row.segments.map((s: Segment, i) =>
        s.kind === 'equal' ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span key={i} className={s.kind === 'add' ? 'bg-emerald-300/70 rounded-xs' : 'bg-red-300/70 rounded-xs'}>
            {s.text}
          </span>
        )
      )}
    </>
  );
}

function SideBySide({ a, b, options }: { a: unknown; b: unknown; options: DiffOptions }) {
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [limit, setLimit] = useState(1500);
  const rows = useMemo(() => {
    const pa = JSON.stringify(prepareForView(a, options), null, 2) ?? '';
    const pb = JSON.stringify(prepareForView(b, options), null, 2) ?? '';
    return buildSplit(computeDiff(pa, pb).rows);
  }, [a, b, options]);

  const view = useMemo(() => {
    if (!onlyChanges) return rows.map((r, idx) => ({ ...r, idx, gap: false }));
    const keep = new Set<number>();
    rows.forEach((r, i) => {
      if (r.l?.kind !== 'equal' || r.r?.kind !== 'equal') for (let k = Math.max(0, i - 2); k <= Math.min(rows.length - 1, i + 2); k++) keep.add(k);
    });
    const out: (SplitRow & { idx: number; gap: boolean })[] = [];
    let prev = -2;
    for (let i = 0; i < rows.length; i++) {
      if (!keep.has(i)) continue;
      out.push({ ...rows[i], idx: i, gap: i !== prev + 1 && out.length > 0 });
      prev = i;
    }
    return out;
  }, [rows, onlyChanges]);

  const bg = (r: DiffRow | null, side: 'l' | 'r') =>
    !r ? 'bg-slate-100' : r.kind === 'equal' ? '' : side === 'l' ? 'bg-red-50' : 'bg-emerald-50';

  return (
    <div>
      <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={onlyChanges} onChange={() => setOnlyChanges(!onlyChanges)} className="rounded border-slate-300 text-indigo-600 h-3.5 w-3.5" />
          Chỉ hiện vùng khác biệt
        </label>
        <span className="text-slate-400">Khóa được sắp xếp A→Z; khóa bị bỏ qua đã được ẩn. Sự khác biệt dưới đây là theo dòng văn bản.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse table-fixed">
          <tbody>
            {view.slice(0, limit).map((row) => (
              <Fragment key={row.idx}>
                {row.gap && (
                  <tr>
                    <td colSpan={4} className="text-center text-[11px] text-slate-400 bg-slate-50 py-0.5 select-none">
                      ⋯
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="w-9 px-1 text-right select-none align-top bg-slate-50 text-slate-400">{row.l?.leftNo ?? ''}</td>
                  <td className={`px-2 whitespace-pre-wrap break-all align-top border-r border-slate-200 text-slate-800 ${bg(row.l, 'l')}`}>
                    {row.l && <Segs row={row.l} />}
                  </td>
                  <td className="w-9 px-1 text-right select-none align-top bg-slate-50 text-slate-400">{row.r?.rightNo ?? ''}</td>
                  <td className={`px-2 whitespace-pre-wrap break-all align-top text-slate-800 ${bg(row.r, 'r')}`}>
                    {row.r && <Segs row={row.r} />}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        {view.length > limit && (
          <button onClick={() => setLimit(limit + 2000)} className="w-full py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50">
            Hiển thị thêm ({view.length - limit} dòng)
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trang chính
// ---------------------------------------------------------------------------

type View = 'list' | 'tree' | 'side' | 'patch';

export default function JsonDiffPage() {
  const copy = useCopy();
  const { showToast } = useApp();
  const [left, setLeft] = useState<Side>({ name: '', text: '' });
  const [right, setRight] = useState<Side>({ name: '', text: '' });
  const [opts, setOpts] = useState<DiffOptions>(DEFAULT_DIFF_OPTIONS);
  const [view, setView] = useState<View>('list');
  const [openDepth, setOpenDepth] = useState(4);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const q = readShareParams();
    /* eslint-disable react-hooks/set-state-in-effect */
    setOpts((o) => {
      const tol = Number(q.get('tol'));
      return {
        ignoreArrayOrder: q.get('io') === '1' || o.ignoreArrayOrder,
        arrayKey: (q.get('ak') ?? o.arrayKey).slice(0, 60),
        ignoreKeys: (q.get('ik') ?? o.ignoreKeys).slice(0, 300),
        tolerance: Number.isFinite(tol) && tol > 0 ? tol : o.tolerance,
        caseInsensitive: q.get('ci') === '1' || o.caseInsensitive,
        trim: q.get('tr') === '1' || o.trim,
        nullAsMissing: q.get('nm') === '1' || o.nullAsMissing,
      };
    });
    const v = q.get('v');
    if (v === 'list' || v === 'tree' || v === 'side' || v === 'patch') setView(v);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const dl = useDeferredValue(left.text);
  const dr = useDeferredValue(right.text);
  const pa = useMemo(() => parseInput(dl), [dl]);
  const pb = useMemo(() => parseInput(dr), [dr]);
  const dOpts = useDeferredValue(opts);

  const result = useMemo(() => {
    if (pa.state !== 'ok' || pb.state !== 'ok') return null;
    return diffJson(pa.value, pb.value, dOpts);
  }, [pa, pb, dOpts]);

  const verified = useMemo(() => {
    if (!result || result.truncated || result.error || view !== 'patch') return null;
    if (pa.state !== 'ok' || pb.state !== 'ok') return null;
    const ap = applyPatch(pa.value, result.patch);
    if (!ap.ok) return { ok: false as const, msg: ap.error };
    return { ok: isEqualJson(ap.result, pb.value, dOpts), msg: '' };
  }, [result, view, pa, pb, dOpts]);

  const patchText = useMemo(() => {
    if (!result || view !== 'patch') return '';
    return JSON.stringify(result.patch, null, 2);
  }, [result, view]);

  const set = <K extends keyof DiffOptions>(k: K, v: DiffOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const shareParams = {
    io: opts.ignoreArrayOrder ? '1' : '',
    ak: opts.arrayKey,
    ik: opts.ignoreKeys,
    tol: opts.tolerance > 0 ? String(opts.tolerance) : '',
    ci: opts.caseInsensitive ? '1' : '',
    tr: opts.trim ? '1' : '',
    nm: opts.nullAsMissing ? '1' : '',
    v: view,
  };

  const viewTabs: { id: View; label: string; icon: typeof ListChecks }[] = [
    { id: 'list', label: 'Danh sách thay đổi', icon: ListChecks },
    { id: 'tree', label: 'Cây hợp nhất', icon: ListTree },
    { id: 'side', label: 'Song song', icon: Columns2 },
    { id: 'patch', label: 'JSON Patch', icon: FileJson },
  ];

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <GitCompareArrows className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">So sánh JSON (theo cấu trúc)</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Tìm khác biệt theo ngữ nghĩa, không phụ thuộc thứ tự khóa hay định dạng. Xuất JSON Patch (RFC 6902). Hỗ trợ cả YAML.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <ShareLinkButton params={shareParams} className={btnDark} />
          <button
            onClick={() => {
              setLeft({ name: 'a.json', text: SAMPLE_A });
              setRight({ name: 'b.json', text: SAMPLE_B });
            }}
            className={btnDark}
          >
            <Sparkles className="h-3 w-3 text-amber-400" />
            Dữ liệu mẫu
          </button>
          <button
            onClick={() => {
              setLeft(right);
              setRight(left);
            }}
            title="Đổi chỗ hai bên"
            className={btnDark}
          >
            <ArrowLeftRight className="h-3 w-3" />
            Đổi bên
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Pane title="Gốc (A)" side={left} onChange={setLeft} parsed={pa} accent="text-red-500" />
        <Pane title="Mới (B)" side={right} onChange={setRight} parsed={pb} accent="text-emerald-500" />
      </div>

      {/* Tùy chọn */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-3 space-y-2.5">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
          {(
            [
              ['ignoreArrayOrder', 'Bỏ qua thứ tự mảng (coi như tập hợp)'],
              ['caseInsensitive', 'Không phân biệt hoa/thường (chuỗi)'],
              ['trim', 'Cắt khoảng trắng đầu/cuối chuỗi'],
              ['nullAsMissing', 'Coi null như không tồn tại'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium">
              <input
                type="checkbox"
                checked={opts[k]}
                onChange={() => set(k, !opts[k])}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
              />
              {label}
            </label>
          ))}
        </div>
        <div className="grid gap-2.5 sm:grid-cols-3 text-xs">
          <label className="flex flex-col gap-1 text-slate-600 font-medium">
            Ghép phần tử mảng theo khóa
            <input
              value={opts.arrayKey}
              onChange={(e) => set('arrayKey', e.target.value)}
              disabled={!opts.ignoreArrayOrder}
              placeholder="vd: id (cần bật bỏ qua thứ tự mảng)"
              className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white font-mono outline-hidden focus:border-indigo-400 disabled:bg-slate-100 disabled:text-slate-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-slate-600 font-medium">
            Bỏ qua khóa (phân tách bằng dấu phẩy, hỗ trợ *)
            <input
              value={opts.ignoreKeys}
              onChange={(e) => set('ignoreKeys', e.target.value)}
              placeholder="vd: updatedAt, _*, $.users[*].token"
              className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white font-mono outline-hidden focus:border-indigo-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-slate-600 font-medium">
            Sai số cho số (tuyệt đối)
            <input
              type="number"
              min={0}
              step="any"
              value={opts.tolerance || ''}
              onChange={(e) => set('tolerance', Math.max(0, Number(e.target.value) || 0))}
              placeholder="0 = chính xác"
              className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white font-mono outline-hidden focus:border-indigo-400"
            />
          </label>
        </div>
        <p className="text-[11px] text-slate-400">
          Mẹo: khóa thường (vd <code>id</code>) khớp ở mọi cấp; đường dẫn bắt đầu bằng <code>$</code> khớp theo vị trí, chỉ số mảng được coi là <code>[*]</code>. Kéo-thả file vào ô nhập để tải nhanh (tối đa 2MB mỗi bên).
        </p>
      </div>

      {/* Kết quả */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {pa.state === 'error' || pb.state === 'error' ? (
          <div className="p-8 text-center text-sm text-red-600 flex flex-col items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Không thể so sánh vì {pa.state === 'error' ? 'bên A' : 'bên B'} không phải JSON/YAML hợp lệ. Xem thông báo lỗi ở dưới ô nhập.
          </div>
        ) : !result ? (
          <div className="p-8 text-center text-sm text-slate-400">Nhập hoặc chọn dữ liệu ở cả hai bên (hoặc bấm &quot;Dữ liệu mẫu&quot;) để bắt đầu so sánh.</div>
        ) : result.error ? (
          <div className="p-8 text-center text-sm text-red-600">{result.error}</div>
        ) : (
          <>
            <div className="p-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center flex-wrap gap-2 text-xs">
                <span className="font-bold text-slate-800 uppercase tracking-wider">Kết quả</span>
                {result.counts.total === 0 ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">Giống hệt nhau</span>
                ) : (
                  <>
                    <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">{result.counts.total} thay đổi</span>
                    {KIND_ORDER.map((k) => {
                      const n =
                        k === 'type-changed' ? result.counts.typeChanged : result.counts[k as 'added' | 'removed' | 'changed' | 'moved'];
                      return n > 0 ? (
                        <span key={k} className={`px-2 py-0.5 rounded font-semibold ${KIND_META[k].badge}`}>
                          {KIND_META[k].sym} {n} {KIND_META[k].label.toLowerCase()}
                        </span>
                      ) : null;
                    })}
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => void copy(summarizeText(result), 'Đã chép tóm tắt!')} className={btnLight}>
                  <Copy className="h-3.5 w-3.5" />
                  Chép tóm tắt
                </button>
                <button
                  onClick={() => {
                    downloadText(`json-diff_${stamp}.txt`, summarizeText(result));
                    showToast('Đã tải xuống tóm tắt!');
                  }}
                  className={btnLight}
                >
                  <Download className="h-3.5 w-3.5" />
                  Tải tóm tắt
                </button>
              </div>
            </div>
            {result.truncated && (
              <div className="px-3 py-2 bg-amber-50 text-amber-800 text-xs border-b border-amber-100 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Có quá nhiều thay đổi: chỉ hiển thị {MAX_CHANGES} thay đổi đầu tiên và JSON Patch không đầy đủ.
              </div>
            )}

            <div className="px-3 pt-2 border-b border-slate-100 flex flex-wrap gap-1">
              {viewTabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setView(t.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 transition flex items-center gap-1.5 ${
                    view === t.id ? 'border-indigo-600 text-indigo-700 bg-indigo-50/60' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            {view === 'list' &&
              (result.changes.length === 0 ? (
                <div className="p-8 text-center text-sm text-emerald-700 bg-emerald-50/60">
                  ✓ Hai bên giống hệt nhau về mặt cấu trúc
                  {opts.ignoreArrayOrder || opts.ignoreKeys || opts.tolerance > 0 || opts.trim || opts.caseInsensitive || opts.nullAsMissing
                    ? ' (theo các tùy chọn đang bật)'
                    : ''}
                  .
                </div>
              ) : (
                <ChangeList changes={result.changes} onCopy={(t, m) => void copy(t, m)} />
              ))}

            {view === 'tree' && (
              <div>
                <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span>Mở đến cấp:</span>
                  {[1, 2, 3, 4, 99].map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setOpenDepth(d);
                        setEpoch((e) => e + 1);
                      }}
                      className={`px-2 py-0.5 rounded border transition ${
                        openDepth === d ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {d === 99 ? 'Tất cả' : d}
                    </button>
                  ))}
                  <span className="text-slate-400">Bấm vào dòng để mở/thu gọn; nhánh không đổi được ẩn mặc định.</span>
                </div>
                <div className="p-3 overflow-x-auto">
                  {result.counts.total === 0 ? (
                    <div className="p-6 text-center text-sm text-emerald-700">✓ Không có thay đổi.</div>
                  ) : (
                    <TreeNode key={epoch} node={result.merged} depth={0} openDepth={openDepth} />
                  )}
                </div>
              </div>
            )}

            {view === 'side' && pa.state === 'ok' && pb.state === 'ok' && <SideBySide a={pa.value} b={pb.value} options={dOpts} />}

            {view === 'patch' && (
              <div>
                <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs">
                    {verified === null ? null : verified.ok ? (
                      <span className="text-emerald-700 font-medium flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Đã kiểm chứng: áp dụng patch lên A cho kết quả khớp B{opts.ignoreArrayOrder || opts.ignoreKeys ? ' (theo tùy chọn)' : ''}.
                      </span>
                    ) : (
                      <span className="text-red-600 font-medium flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Không kiểm chứng được patch{verified.msg ? `: ${verified.msg}` : '.'}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => void copy(patchText, 'Đã chép JSON Patch!')} className={btnLight}>
                      <Copy className="h-3.5 w-3.5" />
                      Chép patch
                    </button>
                    <button
                      onClick={() => {
                        downloadText(`patch_${stamp}.json`, patchText, 'application/json;charset=utf-8');
                        showToast('Đã tải xuống JSON Patch!');
                      }}
                      className={btnLight}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Tải patch
                    </button>
                  </div>
                </div>
                <pre className="bg-slate-900 text-slate-100 text-xs font-mono p-3 overflow-x-auto whitespace-pre">
                  {patchText.length > 200000 ? patchText.slice(0, 200000) + '\n… (đã cắt bớt khi hiển thị; bản chép/tải về vẫn đầy đủ)' : patchText}
                </pre>
                <p className="px-3 py-2 text-[11px] text-slate-400">
                  Các thao tác add/remove/replace được sắp xếp để áp dụng tuần tự đúng chỉ số mảng (xóa từ chỉ số lớn đến nhỏ, rồi chèn theo thứ tự). Khóa chứa <code>/</code> và <code>~</code> được escape thành <code>~1</code> và <code>~0</code>.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
