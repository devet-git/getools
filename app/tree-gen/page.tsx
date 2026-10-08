'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderTree,
  Folder,
  File as FileIcon,
  Copy,
  Download,
  FolderOpen,
  Trash2,
  Sparkles,
  Plus,
  Pencil,
  X,
  Check,
  BookOpen,
  FileUp,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  DEFAULT_TREE_OPTIONS,
  IGNORE_PRESET,
  MAX_ENTRIES,
  STYLE_LABELS,
  addChild,
  compileIgnore,
  countTree,
  deleteNode,
  isPathIgnored,
  parseTree,
  renameNode,
  renderTree,
  setComment,
  toPathList,
  toggleDir,
  transformTree,
  wrapForReadme,
  type IgnoreMatcher,
  type InputFormat,
  type OutputStyle,
  type SortMode,
  type TreeNode,
  type TreeOptions,
} from '@/lib/tree-gen';

import { SendToButton } from '@/components/SendToButton';
const SAMPLE = `package.json  # Khai báo dependency và script
README.md
src/index.ts  # Điểm vào của ứng dụng
src/components/Button.tsx
src/components/Card.tsx
src/lib/utils.ts  # Hàm tiện ích dùng chung
public/logo.svg
tests/utils.test.ts
.gitignore
node_modules/react/index.js`;

const FORMAT_LABEL: Record<InputFormat, string> = {
  empty: 'Chưa có dữ liệu',
  paths: 'Danh sách đường dẫn',
  indent: 'Dàn ý thụt lề',
  tree: 'Kết quả lệnh tree',
  json: 'JSON lồng nhau',
};

const STYLES = Object.keys(STYLE_LABELS) as OutputStyle[];
const SORTS: { id: SortMode; label: string }[] = [
  { id: 'folders', label: 'Thư mục trước' },
  { id: 'alpha', label: 'A → Z' },
  { id: 'natural', label: 'Tự nhiên (file2 < file10)' },
  { id: 'keep', label: 'Giữ nguyên thứ tự' },
];
const MAX_ROWS = 600;
const README_KEY = 'getools:readme-builder:tree';

const inputCls =
  'w-full px-2 py-1 text-xs border border-slate-200 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const btn =
  'px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1 disabled:opacity-40';

interface Draft {
  mode: 'rename' | 'add';
  id: string;
  value: string;
}

/** Duyệt thư mục được thả vào (File System Access / webkitGetAsEntry). Chỉ đọc đường dẫn. */
async function collectEntries(
  entries: FileSystemEntry[],
  ignore: IgnoreMatcher
): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = [];
  let truncated = false;
  const readAll = (dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> =>
    new Promise((resolve) => {
      const reader = dir.createReader();
      const out: FileSystemEntry[] = [];
      const next = () =>
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) resolve(out);
            else {
              out.push(...batch);
              next();
            }
          },
          () => resolve(out)
        );
      next();
    });
  const walk = async (e: FileSystemEntry, rel: string): Promise<void> => {
    if (paths.length >= MAX_ENTRIES) {
      truncated = true;
      return;
    }
    const p = rel ? rel + '/' + e.name : e.name;
    if (rel && ignore(p.split('/').slice(1).join('/'), e.isDirectory)) return;
    if (e.isDirectory) {
      const kids = await readAll(e as FileSystemDirectoryEntry);
      if (kids.length === 0) paths.push(p + '/');
      for (const k of kids) await walk(k, p);
    } else paths.push(p);
  };
  for (const e of entries) await walk(e, '');
  return { paths, truncated };
}

export default function TreeGenPage() {
  const { showToast } = useApp();
  const [input, setInput] = useState(SAMPLE);
  const [style, setStyle] = useState<OutputStyle>('unicode');
  const [opts, setOpts] = useState<TreeOptions>({ ...DEFAULT_TREE_OPTIONS, rootName: 'my-app', ignore: IGNORE_PRESET });
  const [edited, setEdited] = useState<TreeNode | null>(null);
  const [editedKey, setEditedKey] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [withHeading, setWithHeading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [loadNote, setLoadNote] = useState('');
  const folderRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = readShareParams();
    /* eslint-disable react-hooks/set-state-in-effect */
    const st = q.get('style') as OutputStyle | null;
    if (st && STYLES.includes(st)) setStyle(st);
    const so = q.get('sort') as SortMode | null;
    const d = parseInt(q.get('depth') ?? '', 10);
    setOpts((o) => ({
      ...o,
      sort: so && SORTS.some((s) => s.id === so) ? so : o.sort,
      maxDepth: Number.isFinite(d) && d >= 0 && d <= 50 ? d : o.maxDepth,
      slash: q.get('slash') === '0' ? false : o.slash,
    }));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const set = <K extends keyof TreeOptions>(k: K, v: TreeOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const deferredInput = useDeferredValue(input);
  const parsed = useMemo(() => parseTree(deferredInput), [deferredInput]);
  const model = edited && editedKey === deferredInput ? edited : parsed.root;
  const isEdited = model !== parsed.root;

  const view = useMemo(() => transformTree(model, opts), [model, opts]);
  const editorView = useMemo(() => transformTree(model, { ...opts, collapse: false }), [model, opts]);
  const output = useMemo(
    () => renderTree(view.root, style, opts, parsed.detectedRoot),
    [view, style, opts, parsed.detectedRoot]
  );
  const counts = useMemo(() => countTree(view.root), [view]);

  const rows = useMemo(() => {
    const out: { node: TreeNode; depth: number }[] = [];
    const walk = (n: TreeNode, depth: number) => {
      for (const c of n.children) {
        if (out.length >= MAX_ROWS) return;
        out.push({ node: c, depth });
        walk(c, depth + 1);
      }
    };
    walk(editorView.root, 0);
    return out;
  }, [editorView]);

  const apply = (fn: (r: TreeNode) => TreeNode) => {
    setEdited(fn(model));
    setEditedKey(deferredInput);
  };

  const commitDraft = () => {
    if (!draft) return;
    const v = draft.value.trim();
    if (v) {
      if (draft.mode === 'rename') apply((r) => renameNode(r, draft.id, v));
      else {
        const isDir = v.endsWith('/') || v.endsWith('\\');
        apply((r) => addChild(r, draft.id, v, isDir));
      }
    }
    setDraft(null);
  };

  const applyToInput = () => {
    setInput(toPathList(model));
    if (!opts.rootName.trim() && parsed.detectedRoot) set('rootName', parsed.detectedRoot);
    setEdited(null);
    showToast('Đã ghi cây đã chỉnh sửa vào ô nhập.');
  };

  const copy = useCallback(
    async (text: string, msg = 'Đã sao chép!') => {
      try {
        await navigator.clipboard.writeText(text);
        showToast(msg);
      } catch {
        showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
      }
    },
    [showToast]
  );

  const download = (ext: 'txt' | 'md' | 'json') => {
    let content = output;
    if (ext === 'md') content = wrapForReadme(output, withHeading);
    const type = ext === 'json' ? 'application/json' : 'text/plain';
    const url = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cau-truc-thu-muc.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const insertReadme = async () => {
    const block = wrapForReadme(output, withHeading);
    try {
      localStorage.setItem(README_KEY, output);
    } catch {
      /* bỏ qua */
    }
    await copy(block, 'Đã sao chép khối README (có thể dán vào mục Cấu trúc thư mục).');
  };

  const loadPaths = (paths: string[], root: string, truncated: boolean) => {
    setInput(paths.join('\n'));
    setEdited(null);
    if (root) set('rootName', root);
    setLoadNote(
      `Đã đọc ${paths.length.toLocaleString('vi-VN')} mục từ thư mục “${root}” (chỉ đọc tên, không đọc nội dung).` +
        (truncated ? ` Đã dừng ở giới hạn ${MAX_ENTRIES.toLocaleString('vi-VN')} mục.` : '')
    );
  };

  const onFolderPicked = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const ignore = compileIgnore(opts.ignore);
    const paths: string[] = [];
    let root = '';
    let truncated = false;
    for (const f of Array.from(files)) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const segs = rel.split('/');
      if (!root && segs.length > 1) root = segs[0];
      const sub = segs.length > 1 ? segs.slice(1).join('/') : rel;
      if (isPathIgnored(ignore, sub)) continue;
      if (paths.length >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      paths.push(sub);
    }
    loadPaths(paths, root, truncated);
    if (folderRef.current) folderRef.current.value = '';
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = Array.from(e.dataTransfer.items ?? []);
    const entries = items
      .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
      .filter((x): x is FileSystemEntry => !!x);
    if (entries.length === 0) {
      const f = e.dataTransfer.files?.[0];
      if (f && f.size < 2 * 1024 * 1024) {
        setInput(await f.text());
        setEdited(null);
      }
      return;
    }
    if (entries.length === 1 && !entries[0].isDirectory) {
      const f = e.dataTransfer.files?.[0];
      if (f && f.size < 2 * 1024 * 1024) {
        setInput(await f.text());
        setEdited(null);
      }
      return;
    }
    showToast('Đang đọc cấu trúc thư mục...');
    try {
      const ignore = compileIgnore(opts.ignore);
      if (entries.length === 1) {
        const { paths, truncated } = await collectEntries(entries[0].isDirectory ? [entries[0]] : entries, ignore);
        const root = entries[0].name;
        loadPaths(
          paths.map((p) => p.split('/').slice(1).join('/')).filter(Boolean),
          root,
          truncated
        );
      } else {
        const { paths, truncated } = await collectEntries(entries, ignore);
        loadPaths(paths, '', truncated);
      }
    } catch {
      showToast('Không đọc được thư mục đã thả vào.');
    }
  };

  const onFileText = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      showToast('File quá lớn (tối đa 2MB).');
      return;
    }
    setInput(await f.text());
    setEdited(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <FolderTree className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Sơ đồ cây thư mục</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Dán danh sách đường dẫn, dàn ý, kết quả lệnh tree hoặc JSON, hay thả cả thư mục vào để tạo sơ đồ cây cho README. Chỉ đọc tên, không đọc nội dung file.
            </p>
          </div>
        </div>
        <ShareLinkButton
          params={{
            style,
            sort: opts.sort,
            depth: opts.maxDepth ? String(opts.maxDepth) : '',
            slash: opts.slash ? '' : '0',
          }}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-3.5">
        {/* INPUT */}
        <div className="space-y-3.5">
          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold text-slate-700">Đầu vào</h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                  Nhận dạng: {FORMAT_LABEL[parsed.format]}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={btn} onClick={() => { setInput(SAMPLE); setEdited(null); }}>
                  <Sparkles className="h-3.5 w-3.5" /> Mẫu
                </button>
                <button type="button" className={btn} onClick={() => folderRef.current?.click()}>
                  <FolderOpen className="h-3.5 w-3.5" /> Chọn thư mục
                </button>
                <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
                  <FileUp className="h-3.5 w-3.5" /> Mở file
                </button>
                <button type="button" className={btn} onClick={() => { setInput(''); setEdited(null); setLoadNote(''); }}>
                  <Trash2 className="h-3.5 w-3.5" /> Xóa
                </button>
              </div>
            </div>
            <input
              ref={(el) => {
                folderRef.current = el;
                if (el) el.setAttribute('webkitdirectory', '');
              }}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => onFolderPicked(e.target.files)}
            />
            <input ref={fileRef} type="file" accept=".txt,.md,.json,.log,text/*" className="hidden" onChange={(e) => onFileText(e.target.files?.[0])} />
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`rounded-lg ${dragOver ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
                rows={13}
                placeholder={'Dán vào đây, ví dụ:\nsrc/index.ts\nsrc/lib/utils.ts  # ghi chú\n\nhoặc thả một thư mục vào ô này'}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
              />
            </div>
            {loadNote && <p className="text-[11px] text-emerald-700">{loadNote}</p>}
            {parsed.warnings.map((w) => (
              <p key={w} className="text-[11px] text-amber-700">{w}</p>
            ))}
            <p className="text-[11px] text-slate-500">
              Mẹo: thêm <code className="bg-slate-100 px-1 rounded">  # mô tả</code> sau tên để ghi chú. Thư mục kết thúc bằng <code className="bg-slate-100 px-1 rounded">/</code>. Hỗ trợ đường dẫn Windows, màu ANSI, <code className="bg-slate-100 px-1 rounded">unzip -l</code>, <code className="bg-slate-100 px-1 rounded">tar -tvf</code>.
            </p>
          </div>

          {/* OPTIONS */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
            <h2 className="text-xs font-bold text-slate-700">Tùy chọn</h2>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-slate-600 space-y-1">
                <span>Sắp xếp</span>
                <select className={inputCls} value={opts.sort} onChange={(e) => set('sort', e.target.value as SortMode)}>
                  {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-slate-600 space-y-1">
                <span>Độ sâu tối đa (0 = không giới hạn)</span>
                <input type="number" min={0} max={50} className={inputCls} value={opts.maxDepth}
                  onChange={(e) => set('maxDepth', Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0)))} />
              </label>
              <label className="text-[11px] text-slate-600 space-y-1 col-span-2">
                <span>Tên thư mục gốc</span>
                <input className={inputCls} value={opts.rootName} placeholder={parsed.detectedRoot ?? 'project'}
                  onChange={(e) => set('rootName', e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-700">
              {([
                ['showRoot', 'Hiện dòng thư mục gốc'],
                ['slash', 'Thêm “/” sau tên thư mục'],
                ['collapse', 'Gộp chuỗi thư mục 1 con (src/main/java)'],
                ['showDotfiles', 'Hiện file ẩn (.env, .git...)'],
                ['showComments', 'Hiện chú thích (# mô tả)'],
                ['align', 'Căn thẳng cột chú thích'],
              ] as [keyof TreeOptions, string][]).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={opts[k] as boolean} onChange={(e) => set(k, e.target.checked as never)} />
                  {label}
                </label>
              ))}
            </div>
            <label className="text-[11px] text-slate-600 space-y-1 block">
              <span className="flex items-center justify-between">
                Bỏ qua (mẫu giống .gitignore, mỗi dòng một mẫu)
                <span className="flex gap-1.5">
                  <button type="button" className="text-indigo-600 hover:underline" onClick={() => set('ignore', IGNORE_PRESET)}>
                    Dùng mẫu node_modules/.git/dist...
                  </button>
                  <button type="button" className="text-slate-500 hover:underline" onClick={() => set('ignore', '')}>Xóa</button>
                </span>
              </span>
              <textarea rows={3} spellCheck={false} className={inputCls + ' font-mono'} value={opts.ignore}
                placeholder={'node_modules\n*.log\n/build\n!keep.log'}
                onChange={(e) => set('ignore', e.target.value)} />
            </label>
          </div>
        </div>

        {/* OUTPUT */}
        <div className="space-y-3.5">
          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-bold text-slate-700">Kết quả</h2>
              <select className={inputCls + ' !w-auto'} value={style} onChange={(e) => setStyle(e.target.value as OutputStyle)}>
                {STYLES.map((s) => <option key={s} value={s}>{STYLE_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{counts.files.toLocaleString('vi-VN')} file</span>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{counts.folders.toLocaleString('vi-VN')} thư mục</span>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">sâu {counts.depth} cấp</span>
              {view.hidden > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">đã ẩn {view.hidden.toLocaleString('vi-VN')} mục</span>
              )}
            </div>
            {output.length > 200000 ? (
              <p className="text-xs text-amber-700">Kết quả quá lớn để hiển thị ({output.length.toLocaleString('vi-VN')} ký tự); vẫn có thể sao chép/tải về.</p>
            ) : (
              <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs font-mono overflow-auto max-h-[420px] whitespace-pre">
                {parsed.format === 'empty' ? 'Chưa có dữ liệu để tạo sơ đồ.' : output}
              </pre>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <SendToButton text={parsed.format === 'empty' ? '' : output} fromToolId="tree-gen" />
              <button type="button" className={btn} onClick={() => copy(output)} disabled={parsed.format === 'empty'}>
                <Copy className="h-3.5 w-3.5" /> Sao chép
              </button>
              <button type="button" className={btn} onClick={() => download('txt')} disabled={parsed.format === 'empty'}>
                <Download className="h-3.5 w-3.5" /> .txt
              </button>
              <button type="button" className={btn} onClick={() => download('md')} disabled={parsed.format === 'empty'}>
                <Download className="h-3.5 w-3.5" /> .md
              </button>
              <button type="button" className={btn + ' !bg-indigo-600 !text-white !border-indigo-600 hover:!bg-indigo-700'} onClick={insertReadme} disabled={parsed.format === 'empty'}>
                <BookOpen className="h-3.5 w-3.5" /> Chèn vào README
              </button>
              <label className="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
                <input type="checkbox" checked={withHeading} onChange={(e) => setWithHeading(e.target.checked)} />
                kèm tiêu đề “Cấu trúc thư mục”
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* EDITOR */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold text-slate-700">Chỉnh sửa trực tiếp và ghi chú</h2>
            <p className="text-[11px] text-slate-500">Đổi tên, xóa, thêm mục con (thêm “/” cuối để tạo thư mục) và nhập mô tả ở cột bên phải.</p>
          </div>
          {isEdited && (
            <button type="button" className={btn} onClick={applyToInput}>
              <Check className="h-3.5 w-3.5" /> Ghi vào ô nhập
            </button>
          )}
        </div>
        {isEdited && (
          <p className="text-[11px] text-amber-700">
            Bạn đã chỉnh sửa cây. Nếu sửa ô nhập, các chỉnh sửa này sẽ mất, hãy bấm “Ghi vào ô nhập” để giữ lại.
          </p>
        )}
        {rows.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">Chưa có mục nào để hiển thị.</p>
        ) : (
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[520px] overflow-auto">
            {rows.map(({ node, depth }) => {
              const dir = node.isDir || node.children.length > 0;
              const drafting = draft && draft.id === node.id ? draft : null;
              return (
                <div key={node.id}>
                  <div className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1" style={{ paddingLeft: Math.min(depth, 20) * 16 }}>
                      {dir ? <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" /> : <FileIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                      {drafting?.mode === 'rename' ? (
                        <input autoFocus className={inputCls} value={drafting.value}
                          onChange={(e) => setDraft({ ...drafting, value: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(); if (e.key === 'Escape') setDraft(null); }}
                          onBlur={commitDraft} />
                      ) : (
                        <span className="font-mono truncate text-slate-800" title={node.name}>{node.name}</span>
                      )}
                    </div>
                    <input
                      className={inputCls + ' !w-40 sm:!w-56 shrink-0'}
                      placeholder="# mô tả"
                      value={node.comment ?? ''}
                      onChange={(e) => apply((r) => setComment(r, node.id, e.target.value))}
                    />
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button type="button" title="Đổi tên" className="p-1 text-slate-500 hover:text-indigo-600"
                        onClick={() => setDraft({ mode: 'rename', id: node.id, value: node.name })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="Thêm mục con" className="p-1 text-slate-500 hover:text-emerald-600"
                        onClick={() => setDraft({ mode: 'add', id: node.id, value: '' })}>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title={dir ? 'Đổi thành file' : 'Đổi thành thư mục'}
                        className="p-1 text-slate-500 hover:text-amber-600 disabled:opacity-30"
                        disabled={node.children.length > 0}
                        onClick={() => apply((r) => toggleDir(r, node.id))}>
                        <Folder className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="Xóa" className="p-1 text-slate-500 hover:text-red-600"
                        onClick={() => apply((r) => deleteNode(r, node.id))}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {drafting?.mode === 'add' && (
                    <div className="flex items-center gap-2 px-2 py-1 bg-emerald-50" style={{ paddingLeft: Math.min(depth + 1, 21) * 16 + 8 }}>
                      <input autoFocus className={inputCls} placeholder="Tên mục mới (thêm / cuối để tạo thư mục)" value={drafting.value}
                        onChange={(e) => setDraft({ ...drafting, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(); if (e.key === 'Escape') setDraft(null); }} />
                      <button type="button" className={btn} onClick={commitDraft}>Thêm</button>
                      <button type="button" className={btn} onClick={() => setDraft(null)}>Hủy</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {counts.files + counts.folders > MAX_ROWS && (
          <p className="text-[11px] text-amber-700">Chỉ hiển thị {MAX_ROWS} mục đầu để giữ giao diện mượt; kết quả xuất vẫn đầy đủ.</p>
        )}
      </div>
    </div>
  );
}
