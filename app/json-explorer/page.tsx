'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ListTree,
  Upload,
  Trash2,
  Copy,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Search,
  ArrowDown,
  ArrowUp,
  FoldVertical,
  UnfoldVertical,
  AlertTriangle,
  Crosshair,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { byteLength, detectFormat, formatBytes, parseJson, parseYaml, ParseError } from '@/lib/json-yaml';
import {
  EXAMPLE_QUERIES,
  JsonPathMatch,
  PathSeg,
  SAMPLE_DOC,
  queryJsonPath,
  toJsonPath,
  toPointer,
  typeOf,
} from '@/lib/json-path';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const CHILD_CAP = 200;
const EXPAND_NODE_CAP = 4000;
const SEARCH_VISIT_CAP = 400_000;
const SEARCH_MATCH_CAP = 2000;

type Parsed =
  | { state: 'empty' }
  | { state: 'ok'; value: unknown; format: 'json' | 'yaml'; bytes: number }
  | { state: 'error'; error: ParseError };

function parseInput(text: string): Parsed {
  if (!text.trim()) return { state: 'empty' };
  const bytes = byteLength(text);
  if (bytes > MAX_INPUT_BYTES) {
    return { state: 'error', error: { message: `Dữ liệu quá lớn (${formatBytes(bytes)}). Giới hạn ${formatBytes(MAX_INPUT_BYTES)}.` } };
  }
  const fmt = detectFormat(text) ?? 'json';
  const r = fmt === 'json' ? parseJson(text) : parseYaml(text);
  return r.ok ? { state: 'ok', value: r.value, format: fmt, bytes } : { state: 'error', error: r.error };
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function childEntries(v: unknown): [PathSeg, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [i, x]);
  if (v && typeof v === 'object') return Object.keys(v).map((k) => [k, (v as Record<string, unknown>)[k]]);
  return [];
}

function childCount(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return 0;
}

function valueAt(root: unknown, path: PathSeg[]): unknown {
  let cur = root;
  for (const k of path) {
    if (Array.isArray(cur)) cur = cur[k as number];
    else if (cur && typeof cur === 'object' && hasOwn(cur, String(k))) cur = (cur as Record<string, unknown>)[String(k)];
    else return undefined;
  }
  return cur;
}

/** Tập con trỏ của các nút container có độ sâu < maxDepth (giới hạn số nút). */
function collectExpanded(root: unknown, maxDepth: number): { set: Set<string>; capped: boolean } {
  const set = new Set<string>();
  let capped = false;
  const stack: { v: unknown; path: PathSeg[] }[] = [{ v: root, path: [] }];
  while (stack.length) {
    const { v, path } = stack.pop()!;
    if (path.length >= maxDepth || !v || typeof v !== 'object') continue;
    if (set.size >= EXPAND_NODE_CAP) {
      capped = true;
      break;
    }
    set.add(toPointer(path));
    const entries = childEntries(v);
    for (let i = Math.min(entries.length, CHILD_CAP) - 1; i >= 0; i--) {
      const [k, c] = entries[i];
      if (c && typeof c === 'object') stack.push({ v: c, path: [...path, k] });
    }
  }
  return { set, capped };
}

function findMatches(root: unknown, q: string): { paths: PathSeg[][]; capped: boolean } {
  const needle = q.toLowerCase();
  const paths: PathSeg[][] = [];
  let visited = 0;
  let capped = false;
  const stack: { v: unknown; path: PathSeg[] }[] = [{ v: root, path: [] }];
  while (stack.length) {
    const { v, path } = stack.pop()!;
    if (++visited > SEARCH_VISIT_CAP || paths.length >= SEARCH_MATCH_CAP) {
      capped = true;
      break;
    }
    const keyHit = path.length > 0 && String(path[path.length - 1]).toLowerCase().includes(needle);
    const isLeaf = !v || typeof v !== 'object';
    const valHit = isLeaf && v !== undefined && String(v).toLowerCase().includes(needle);
    if (keyHit || valHit) paths.push(path);
    if (!isLeaf) {
      const entries = childEntries(v);
      for (let i = entries.length - 1; i >= 0; i--) stack.push({ v: entries[i][1], path: [...path, entries[i][0]] });
    }
  }
  return { paths, capped };
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length && n < 20) {
    const at = lower.indexOf(needle, i);
    if (at < 0) break;
    if (at > i) parts.push(text.slice(i, at));
    parts.push(
      <mark key={n++} className="bg-amber-300 text-slate-900 rounded-xs px-px">
        {text.slice(at, at + needle.length)}
      </mark>
    );
    i = at + needle.length;
  }
  parts.push(text.slice(i));
  return <>{parts}</>;
}

// ---------------------------------------------------------------------------
// Cây
// ---------------------------------------------------------------------------

interface TreeCtx {
  expanded: Set<string>;
  toggle: (ptr: string) => void;
  selectedPtr: string | null;
  select: (path: PathSeg[]) => void;
  matchSet: Set<string>;
  searchSet: Set<string>;
  currentSearchPtr: string | null;
  q: string;
}

function ValueText({ v, q }: { v: unknown; q: string }) {
  const t = typeOf(v);
  if (t === 'string') {
    const s = v as string;
    const shown = s.length > 200 ? s.slice(0, 200) + '…' : s;
    return (
      <span className="text-emerald-700 break-all">
        &quot;<Highlight text={shown} q={q} />
        &quot;
      </span>
    );
  }
  if (t === 'number') return <span className="text-indigo-600"><Highlight text={String(v)} q={q} /></span>;
  if (t === 'boolean') return <span className="text-amber-600 font-medium"><Highlight text={String(v)} q={q} /></span>;
  return <span className="text-slate-400 italic">null</span>;
}

function Row({ k, value, path, ctx }: { k: PathSeg | null; value: unknown; path: PathSeg[]; ctx: TreeCtx }) {
  const ptr = toPointer(path);
  const composite = !!value && typeof value === 'object';
  const isOpen = composite && ctx.expanded.has(ptr);
  const [limit, setLimit] = useState(CHILD_CAP);
  const count = composite ? childCount(value) : 0;
  const isArr = Array.isArray(value);
  const selected = ctx.selectedPtr === ptr;
  const matched = ctx.matchSet.has(ptr);
  const found = ctx.searchSet.has(ptr);
  const current = ctx.currentSearchPtr === ptr;

  let bg = 'hover:bg-slate-100';
  if (selected) bg = 'bg-indigo-100 ring-1 ring-indigo-300';
  else if (current) bg = 'bg-amber-200';
  else if (matched) bg = 'bg-emerald-100';
  else if (found) bg = 'bg-amber-50';

  const entries = isOpen ? childEntries(value) : [];
  return (
    <div>
      <div
        data-ptr={ptr}
        onClick={() => ctx.select(path)}
        className={`flex items-start gap-1 rounded px-1 py-px text-xs font-mono cursor-pointer ${bg}`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (composite) ctx.toggle(ptr);
          }}
          className="w-4 h-4 shrink-0 mt-px text-slate-400 hover:text-slate-700"
          tabIndex={composite ? 0 : -1}
          aria-label={isOpen ? 'Thu gọn' : 'Mở rộng'}
        >
          {composite ? isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" /> : null}
        </button>
        {k !== null && (
          <span className="text-slate-800 font-semibold break-all">
            {typeof k === 'number' ? (
              <span className="text-slate-400 font-normal">{k}</span>
            ) : (
              <>
                &quot;<Highlight text={k} q={ctx.q} />
                &quot;
              </>
            )}
            <span className="text-slate-400 font-normal">: </span>
          </span>
        )}
        {composite ? (
          <span className="text-slate-500">
            {isArr ? '[' : '{'}
            {!isOpen && (
              <>
                {count > 0 ? ` ${count} ${isArr ? 'phần tử' : 'khóa'} ` : ''}
                {isArr ? ']' : '}'}
              </>
            )}
            {isOpen && <span className="ml-1 text-[10px] text-slate-400">{count} {isArr ? 'phần tử' : 'khóa'}</span>}
          </span>
        ) : (
          <ValueText v={value} q={ctx.q} />
        )}
      </div>
      {isOpen && (
        <div className="ml-[7px] pl-2.5 border-l border-slate-200">
          {entries.slice(0, limit).map(([ck, cv]) => (
            <Row key={String(ck)} k={ck} value={cv} path={[...path, ck]} ctx={ctx} />
          ))}
          {entries.length > limit && (
            <button onClick={() => setLimit(limit + CHILD_CAP)} className="text-[11px] text-indigo-600 hover:underline px-5 py-0.5">
              hiển thị thêm ({entries.length - limit} mục nữa)
            </button>
          )}
          <div className="text-slate-500 text-xs font-mono px-5">{isArr ? ']' : '}'}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trang
// ---------------------------------------------------------------------------

const SAMPLE_TEXT = JSON.stringify(SAMPLE_DOC, null, 2);

export default function JsonExplorerPage() {
  const { showToast } = useApp();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [selPath, setSelPath] = useState<PathSeg[] | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [pathQ, setPathQ] = useState('');
  const [resLimit, setResLimit] = useState(100);
  const [inputOpen, setInputOpen] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [focusPtr, setFocusPtr] = useState<{ ptr: string; n: number } | null>(null);

  const dText = useDeferredValue(text);
  const parsed = useMemo(() => parseInput(dText), [dText]);
  const root = parsed.state === 'ok' ? parsed.value : undefined;

  // đặt lại trạng thái cây khi dữ liệu thay đổi
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (parsed.state === 'ok') {
      setExpanded(collectExpanded(parsed.value, 2).set);
    } else setExpanded(new Set(['']));
    setSelPath(null);
    setMatchIdx(0);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [parsed]);

  const copy = async (t: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(t);
      showToast(msg);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const loadFile = async (file: File) => {
    if (file.size > MAX_INPUT_BYTES) {
      showToast(`File quá lớn (${formatBytes(file.size)}). Giới hạn ${formatBytes(MAX_INPUT_BYTES)}.`);
      return;
    }
    try {
      setText(await file.text());
      setFileName(file.name);
    } catch {
      showToast('Không đọc được file.');
    }
  };

  const reveal = (path: PathSeg[]) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      for (let i = 0; i < path.length; i++) n.add(toPointer(path.slice(0, i)));
      return n;
    });
  };

  const select = (path: PathSeg[]) => setSelPath(path);

  const goTo = (path: PathSeg[]) => {
    reveal(path);
    setSelPath(path);
    setFocusPtr((f) => ({ ptr: toPointer(path), n: (f?.n ?? 0) + 1 }));
  };

  useEffect(() => {
    if (!focusPtr || !treeRef.current) return;
    const els = treeRef.current.querySelectorAll<HTMLElement>('[data-ptr]');
    for (const el of els) {
      if (el.dataset.ptr === focusPtr.ptr) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        break;
      }
    }
  }, [focusPtr]);

  // tìm kiếm
  const dSearch = useDeferredValue(searchQ.trim());
  const search = useMemo(() => {
    if (!dSearch || root === undefined) return { paths: [] as PathSeg[][], capped: false };
    return findMatches(root, dSearch);
  }, [dSearch, root]);
  const searchSet = useMemo(() => new Set(search.paths.map((p) => toPointer(p))), [search]);
  const curIdx = search.paths.length ? ((matchIdx % search.paths.length) + search.paths.length) % search.paths.length : 0;
  const stepMatch = (d: number) => {
    if (!search.paths.length) return;
    const n = (curIdx + d + search.paths.length) % search.paths.length;
    setMatchIdx(n);
    goTo(search.paths[n]);
  };

  // JSONPath
  const dPath = useDeferredValue(pathQ);
  const qres = useMemo(() => {
    if (root === undefined || !dPath.trim()) return null;
    return queryJsonPath(root, dPath);
  }, [root, dPath]);
  const matches: JsonPathMatch[] = useMemo(() => (qres && qres.ok ? qres.matches : []), [qres]);
  const matchSet = useMemo(() => new Set(matches.map((m) => m.pointer)), [matches]);

  const selPtr = selPath ? toPointer(selPath) : null;
  const selValue = selPath && root !== undefined ? valueAt(root, selPath) : undefined;
  const selText = useMemo(() => {
    if (selPath === null || selValue === undefined) return '';
    try {
      const s = JSON.stringify(selValue, null, 2) ?? '';
      return s.length > 20000 ? s.slice(0, 20000) + '\n… (đã cắt bớt khi hiển thị)' : s;
    } catch {
      return '';
    }
  }, [selPath, selValue]);
  const fullSelText = () => {
    try {
      return JSON.stringify(selValue, null, 2) ?? '';
    } catch {
      return '';
    }
  };

  const expandToDepth = (d: number) => {
    if (root === undefined) return;
    const { set, capped } = collectExpanded(root, d);
    setExpanded(set);
    if (capped) showToast(`Tài liệu lớn: chỉ mở tối đa ${EXPAND_NODE_CAP} nút.`);
  };

  const ctx: TreeCtx = {
    expanded,
    toggle: (ptr) =>
      setExpanded((prev) => {
        const n = new Set(prev);
        if (n.has(ptr)) n.delete(ptr);
        else n.add(ptr);
        return n;
      }),
    selectedPtr: selPtr,
    select,
    matchSet,
    searchSet,
    currentSearchPtr: search.paths.length && dSearch ? toPointer(search.paths[curIdx]) : null,
    q: dSearch,
  };

  const btnDark =
    'px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1';
  const btnLight =
    'px-2 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition flex items-center gap-1';

  const rootType = root !== undefined ? typeOf(root) : null;

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <ListTree className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">JSON Explorer &amp; JSONPath</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Duyệt JSON dạng cây, tìm kiếm, lấy JSONPath / JSON Pointer và chạy truy vấn JSONPath ngay trên trình duyệt.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setText(SAMPLE_TEXT);
              setFileName('');
              setPathQ('$.store.book[?(@.price < 10)].title');
            }}
            className={btnDark}
          >
            <Sparkles className="h-3 w-3 text-amber-400" />
            Dữ liệu mẫu
          </button>
        </div>
      </div>

      {/* Nhập liệu */}
      <div
        className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) void loadFile(f);
        }}
      >
        <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
          <button onClick={() => setInputOpen(!inputOpen)} className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            {inputOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Dữ liệu JSON {fileName && <span className="normal-case tracking-normal font-medium text-slate-500">· {fileName}</span>}
          </button>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition flex items-center gap-1 border border-indigo-200"
            >
              <Upload className="h-3.5 w-3.5" />
              Chọn file
            </button>
            <button
              onClick={() => {
                setText('');
                setFileName('');
              }}
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
        {inputOpen && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="Dán JSON (hoặc YAML) vào đây, hoặc kéo-thả / chọn file..."
            className="w-full h-40 p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-y leading-relaxed text-slate-800 whitespace-pre"
          />
        )}
        <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] flex justify-between gap-2">
          {parsed.state === 'error' ? (
            <span className="text-red-600">
              Lỗi{parsed.error.line ? ` (dòng ${parsed.error.line}${parsed.error.col ? `, cột ${parsed.error.col}` : ''})` : ''}: {parsed.error.message}
            </span>
          ) : parsed.state === 'ok' ? (
            <span className="text-emerald-600">
              Hợp lệ ({parsed.format.toUpperCase()}) · {formatBytes(parsed.bytes)} · gốc là {rootType}
              {root !== undefined && typeof root === 'object' && root !== null ? ` (${childCount(root)} mục)` : ''}
            </span>
          ) : (
            <span className="text-slate-400">Chưa có dữ liệu</span>
          )}
          <span className="text-slate-400">{text.length} ký tự</span>
        </div>
      </div>

      {parsed.state === 'ok' && (
        <div className="grid gap-3 lg:grid-cols-2 items-start">
          {/* Cây */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="relative flex-1 min-w-[140px]">
                  <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchQ}
                    onChange={(e) => {
                      setSearchQ(e.target.value);
                      setMatchIdx(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1);
                    }}
                    placeholder="Tìm khóa hoặc giá trị (Enter = kết quả tiếp)"
                    className="w-full pl-7 pr-2 py-1 text-xs rounded-lg border border-slate-200 bg-white outline-hidden focus:border-indigo-400"
                  />
                </div>
                {dSearch && (
                  <>
                    <span className="text-[11px] text-slate-500 whitespace-nowrap">
                      {search.paths.length ? `${curIdx + 1}/${search.paths.length}${search.capped ? '+' : ''}` : '0 kết quả'}
                    </span>
                    <button onClick={() => stepMatch(-1)} title="Kết quả trước" className={btnLight} disabled={!search.paths.length}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => stepMatch(1)} title="Kết quả tiếp theo" className={btnLight} disabled={!search.paths.length}>
                      <ArrowDown className="h-3.5 w-3.5" />
                      Tiếp
                    </button>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <button onClick={() => expandToDepth(999)} className={btnLight}>
                  <UnfoldVertical className="h-3.5 w-3.5" />
                  Mở tất cả
                </button>
                <button onClick={() => setExpanded(new Set())} className={btnLight}>
                  <FoldVertical className="h-3.5 w-3.5" />
                  Thu gọn
                </button>
                <span className="text-slate-500 ml-1">Mở đến cấp</span>
                {[1, 2, 3, 4].map((d) => (
                  <button key={d} onClick={() => expandToDepth(d)} className={`${btnLight} px-2`}>
                    {d}
                  </button>
                ))}
              </div>
              {/* Breadcrumbs */}
              <div className="flex flex-wrap items-center gap-0.5 text-[11px] font-mono min-h-5">
                <button onClick={() => goTo([])} className="px-1 rounded hover:bg-slate-200 text-indigo-600 font-semibold">
                  $
                </button>
                {selPath?.map((seg, i) => (
                  <span key={i} className="flex items-center">
                    <ChevronRight className="h-3 w-3 text-slate-300" />
                    <button
                      onClick={() => goTo(selPath.slice(0, i + 1))}
                      className={`px-1 rounded hover:bg-slate-200 ${i === selPath.length - 1 ? 'font-bold text-slate-800' : 'text-slate-600'}`}
                    >
                      {typeof seg === 'number' ? `[${seg}]` : seg}
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div ref={treeRef} className="p-2 max-h-[620px] overflow-auto">
              <Row k={null} value={root} path={[]} ctx={ctx} />
            </div>
          </div>

          {/* JSONPath + chi tiết */}
          <div className="space-y-3">
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-2.5 border-b border-slate-100 bg-slate-50/60">
                <div className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-1.5">Truy vấn JSONPath</div>
                <input
                  value={pathQ}
                  onChange={(e) => {
                    setPathQ(e.target.value);
                    setResLimit(100);
                  }}
                  spellCheck={false}
                  placeholder="$.store.book[?(@.price < 10)].title"
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 bg-white outline-hidden focus:border-indigo-400"
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {EXAMPLE_QUERIES.map((e) => (
                    <button
                      key={e.query}
                      onClick={() => {
                        setPathQ(e.query);
                        setResLimit(100);
                      }}
                      title={e.query}
                      className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-100 transition"
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">
                  Hỗ trợ <code>{"$ .key ['key'] [n] [-1] [*] [a:b:c] [0,2] ..key ..*"}</code>, bộ lọc <code>[?(@.x &lt; 10 &amp;&amp; @.t == &apos;a&apos;)]</code>, <code>@.length</code>, <code>=~ /regex/i</code>, <code>contains() startsWith() match()</code>. Mẫu chỉ dùng được với dữ liệu mẫu.
                </p>
              </div>
              <div>
                {!pathQ.trim() ? (
                  <div className="p-5 text-center text-xs text-slate-400">Nhập truy vấn hoặc bấm một ví dụ ở trên.</div>
                ) : qres && !qres.ok ? (
                  <div className="p-3 text-xs text-red-600 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                    {qres.error}
                  </div>
                ) : qres ? (
                  <>
                    <div className="px-3 py-1.5 border-b border-slate-100 text-xs flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700">
                        {matches.length} kết quả{qres.ok && qres.truncated ? ' (đã cắt bớt)' : ''}
                      </span>
                      {matches.length > 0 && (
                        <button
                          onClick={() => void copy(JSON.stringify(matches.map((m) => m.value), null, 2), 'Đã chép các giá trị kết quả!')}
                          className={btnLight}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Chép giá trị
                        </button>
                      )}
                    </div>
                    {matches.length === 0 ? (
                      <div className="p-5 text-center text-xs text-slate-400">Không có nút nào khớp truy vấn.</div>
                    ) : (
                      <div className="divide-y divide-slate-100 max-h-[320px] overflow-auto">
                        {matches.slice(0, resLimit).map((m, i) => (
                          <button
                            key={i}
                            onClick={() => goTo(m.path)}
                            className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 text-xs font-mono block"
                          >
                            <div className="text-indigo-600 break-all">{m.jsonPath}</div>
                            <div className="text-slate-700 break-all">
                              {(() => {
                                let s: string;
                                try {
                                  s = JSON.stringify(m.value) ?? 'undefined';
                                } catch {
                                  s = String(m.value);
                                }
                                return s.length > 160 ? s.slice(0, 160) + '…' : s;
                              })()}
                            </div>
                          </button>
                        ))}
                        {matches.length > resLimit && (
                          <button onClick={() => setResLimit(resLimit + 200)} className="w-full py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50">
                            Hiển thị thêm ({matches.length - resLimit})
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Crosshair className="h-4 w-4 text-indigo-500" />
                Nút đang chọn
              </div>
              {selPath === null ? (
                <div className="p-5 text-center text-xs text-slate-400">Bấm vào một nút trong cây để xem JSONPath, JSON Pointer và giá trị.</div>
              ) : (
                <div className="p-3 space-y-2 text-xs">
                  {(
                    [
                      ['JSONPath', toJsonPath(selPath), 'Đã chép JSONPath!'],
                      ['JSON Pointer', toPointer(selPath) || '(gốc tài liệu)', 'Đã chép JSON Pointer!'],
                    ] as const
                  ).map(([label, val, msg]) => (
                    <div key={label} className="flex items-start gap-2">
                      <span className="w-24 shrink-0 text-slate-500 pt-1">{label}</span>
                      <code className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-50 border border-slate-100 font-mono break-all">{val}</code>
                      <button
                        onClick={() => void copy(label === 'JSON Pointer' ? toPointer(selPath) : val, msg)}
                        title={`Chép ${label}`}
                        className={btnLight}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-slate-500">Kiểu</span>
                    <span className="font-medium text-slate-700">
                      {typeOf(selValue)}
                      {selValue && typeof selValue === 'object' ? ` · ${childCount(selValue)} ${Array.isArray(selValue) ? 'phần tử' : 'khóa'}` : ''}
                    </span>
                    <button onClick={() => void copy(fullSelText(), 'Đã chép giá trị!')} className={`${btnLight} ml-auto`}>
                      <Copy className="h-3.5 w-3.5" />
                      Chép giá trị
                    </button>
                  </div>
                  <pre className="bg-slate-900 text-slate-100 rounded-lg p-2.5 text-[11px] font-mono overflow-auto max-h-64 whitespace-pre-wrap break-all">
                    {selText}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {parsed.state === 'empty' && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          Dán JSON, chọn file hoặc bấm &quot;Dữ liệu mẫu&quot; để bắt đầu khám phá.
        </div>
      )}
    </div>
  );
}
