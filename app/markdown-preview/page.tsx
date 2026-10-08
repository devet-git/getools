'use client';

import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpenText,
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Link as LinkIcon,
  Image as ImageIcon,
  Code,
  SquareCode,
  Quote,
  List,
  ListOrdered,
  ListChecks,
  Table as TableIcon,
  Minus,
  Copy,
  Download,
  FileUp,
  Printer,
  Sparkles,
  Trash2,
  ListTree,
  FileCode2,
  PenLine,
  Columns2,
  Eye,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';

import { SendToButton } from '@/components/SendToButton';
type ViewMode = 'edit' | 'split' | 'preview';
interface OutlineItem {
  level: number;
  text: string;
}

const DRAFT_KEY = 'getools:markdown-preview:draft';
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const SAMPLE = `# Xin chào Markdown

Đây là **tài liệu mẫu** để thử trình xem trước. Bạn có thể dùng *in nghiêng*, ~~gạch ngang~~, \`mã nội dòng\` và liên kết tự động như https://example.com.

## Danh sách

- Mục thứ nhất
- Mục thứ hai
  - Mục con
1. Bước một
2. Bước hai

### Danh sách công việc

- [x] Viết bản nháp
- [x] Xem trước kết quả
- [ ] Xuất ra HTML

## Bảng

| Công cụ | Loại | Trạng thái |
| :------ | :--: | ---------: |
| Soạn thảo | Editor | Sẵn sàng |
| Xem trước | Preview | Sẵn sàng |

## Mã nguồn

\`\`\`ts
function chao(ten: string) {
  return \`Xin chào, \${ten}!\`;
}
\`\`\`

> Trích dẫn: Markdown dễ đọc, dễ viết và dễ chia sẻ.

---

Kết thúc tài liệu.
`;

const PREVIEW_CLASS =
  'prose-md max-w-none text-slate-800 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-extrabold [&_h1]:border-b [&_h1]:border-slate-200 [&_h1]:pb-1.5 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:border-b [&_h2]:border-slate-100 [&_h2]:pb-1 [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h4]:font-bold [&_h4]:mt-3 [&_h5]:font-bold [&_h6]:font-bold [&_h6]:text-slate-500 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 [&_ul.contains-task-list]:list-none [&_ul.contains-task-list]:pl-1 [&_li>input]:mr-2 [&_a]:text-indigo-600 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-600 [&_blockquote]:my-3 [&_code]:bg-slate-100 [&_code]:text-indigo-700 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.85em] [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-3 [&_pre_code]:bg-transparent [&_pre_code]:text-slate-100 [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_th]:bg-slate-100 [&_th]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:font-bold [&_td]:p-2 [&_td]:border [&_td]:border-slate-200 [&_tr:nth-child(even)]:bg-slate-50 [&_hr]:my-5 [&_hr]:border-slate-200 [&_img]:max-w-full [&_img]:h-auto break-words';

const PRINT_CSS = `
@media print {
  body.md-printing > *:not(.md-print-clone) { display: none !important; }
  body.md-printing { background: #fff !important; }
  .md-print-clone { display: block !important; padding: 0; margin: 0; background: #fff !important; color: #111 !important; }
  .md-print-clone * { color: #111 !important; background-color: transparent !important; }
  .md-print-clone pre { background: #f3f4f6 !important; white-space: pre-wrap; }
  .md-print-clone th { background: #f3f4f6 !important; }
  .md-print-clone a { color: #1d4ed8 !important; }
}
@media screen { .md-print-clone { display: none; } }
`;

function formatNumber(n: number) {
  return n.toLocaleString('vi-VN');
}

export default function MarkdownPreviewPage() {
  const { showToast } = useApp();
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<ViewMode>('split');
  const [showStats, setShowStats] = useState(true);
  const [showOutline, setShowOutline] = useState(false);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeSide = useRef<'editor' | 'preview'>('editor');

  const deferred = useDeferredValue(text);

  // Khôi phục bản nháp
  useEffect(() => {
    let draft: string | null = null;
    try {
      draft = localStorage.getItem(DRAFT_KEY);
    } catch {
      /* bỏ qua */
    }
    setText(draft !== null ? draft : SAMPLE);
    setLoaded(true);
  }, []);

  // Tự động lưu bản nháp
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, text);
      } catch {
        /* đầy bộ nhớ hoặc bị chặn */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [text, loaded]);

  // Dàn ý lấy từ DOM đã render (chính xác với setext, heading trong trích dẫn...)
  useEffect(() => {
    const el = previewRef.current;
    if (!el) {
        setOutline([]);
      return;
    }
    const hs = Array.from(el.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    setOutline(
      hs.slice(0, 500).map((h) => ({
        level: Number(h.tagName.slice(1)),
        text: (h.textContent || '').trim(),
      })),
    );
  }, [deferred, mode]);

  const stats = useMemo(() => {
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const lines = text === '' ? 1 : text.split('\n').length;
    return { words, lines, chars: text.length, minutes: Math.max(words > 0 ? 1 : 0, Math.ceil(words / 200)) };
  }, [text]);

  // ---- Chỉnh sửa tại vùng chọn (giữ undo qua execCommand) ----
  const applyEdit = useCallback(
    (start: number, end: number, replacement: string, selStart: number, selEnd: number) => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(start, end);
      let ok = false;
      try {
        ok = document.execCommand('insertText', false, replacement);
      } catch {
        ok = false;
      }
      if (!ok) {
        ta.setRangeText(replacement, start, end, 'end');
        setText(ta.value);
      }
      ta.setSelectionRange(selStart, selEnd);
    },
    [],
  );

  const wrap = useCallback(
    (before: string, after: string, placeholder: string) => {
      const ta = taRef.current;
      if (!ta) return;
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const sel = value.slice(s, e);
      // Bỏ định dạng nếu vùng chọn đã bao quanh sẵn
      if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
        const inner = sel.slice(before.length, sel.length - after.length);
        applyEdit(s, e, inner, s, s + inner.length);
        return;
      }
      const body = sel || placeholder;
      applyEdit(s, e, before + body + after, s + before.length, s + before.length + body.length);
    },
    [applyEdit],
  );

  const linePrefix = useCallback(
    (prefixFor: (i: number) => string, matcher: RegExp) => {
      const ta = taRef.current;
      if (!ta) return;
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const ls = value.lastIndexOf('\n', s - 1) + 1;
      let le = value.indexOf('\n', e > s && value[e - 1] === '\n' ? e - 1 : e);
      if (le === -1) le = value.length;
      const lines = value.slice(ls, le).split('\n');
      const allHave = lines.every((l) => matcher.test(l));
      const out = lines
        .map((l, i) => (allHave ? l.replace(matcher, '') : prefixFor(i) + l.replace(matcher, '')))
        .join('\n');
      applyEdit(ls, le, out, ls, ls + out.length);
    },
    [applyEdit],
  );

  const insertBlock = useCallback(
    (block: string, selFrom: number, selTo: number) => {
      const ta = taRef.current;
      if (!ta) return;
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const needLead = s > 0 && value[s - 1] !== '\n' ? '\n\n' : s > 0 && value[s - 2] !== '\n' && value[s - 1] === '\n' ? '\n' : '';
      const needTrail = e < value.length && value[e] !== '\n' ? '\n\n' : '';
      const full = needLead + block + needTrail;
      const base = s + needLead.length;
      applyEdit(s, e, full, base + selFrom, base + selTo);
    },
    [applyEdit],
  );

  const toolbar: { key: string; title: string; icon: React.ReactNode; run: () => void }[] = [
    { key: 'b', title: 'In đậm (Ctrl+B)', icon: <Bold className="h-3.5 w-3.5" />, run: () => wrap('**', '**', 'in đậm') },
    { key: 'i', title: 'In nghiêng (Ctrl+I)', icon: <Italic className="h-3.5 w-3.5" />, run: () => wrap('*', '*', 'in nghiêng') },
    { key: 's', title: 'Gạch ngang', icon: <Strikethrough className="h-3.5 w-3.5" />, run: () => wrap('~~', '~~', 'gạch ngang') },
    {
      key: 'h',
      title: 'Tiêu đề (bấm nhiều lần để đổi cấp)',
      icon: <Heading2 className="h-3.5 w-3.5" />,
      run: () => {
        const ta = taRef.current;
        if (!ta) return;
        const { selectionStart: s, value } = ta;
        const ls = value.lastIndexOf('\n', s - 1) + 1;
        let le = value.indexOf('\n', s);
        if (le === -1) le = value.length;
        const line = value.slice(ls, le);
        const m = /^(#{1,6})\s+/.exec(line);
        let out: string;
        if (!m) out = '## ' + line;
        else if (m[1].length >= 6) out = line.replace(/^#{1,6}\s+/, '');
        else out = '#' + line;
        applyEdit(ls, le, out, ls + out.length, ls + out.length);
      },
    },
    {
      key: 'a',
      title: 'Liên kết (Ctrl+K)',
      icon: <LinkIcon className="h-3.5 w-3.5" />,
      run: () => {
        const ta = taRef.current;
        if (!ta) return;
        const { selectionStart: s, selectionEnd: e, value } = ta;
        const sel = value.slice(s, e);
        const label = sel || 'văn bản liên kết';
        const url = 'https://';
        const out = `[${label}](${url})`;
        const urlStart = s + label.length + 3;
        applyEdit(s, e, out, urlStart, urlStart + url.length);
      },
    },
    {
      key: 'img',
      title: 'Hình ảnh',
      icon: <ImageIcon className="h-3.5 w-3.5" />,
      run: () => {
        const ta = taRef.current;
        if (!ta) return;
        const { selectionStart: s, selectionEnd: e, value } = ta;
        const alt = value.slice(s, e) || 'mô tả ảnh';
        const url = 'https://';
        const out = `![${alt}](${url})`;
        const urlStart = s + alt.length + 4;
        applyEdit(s, e, out, urlStart, urlStart + url.length);
      },
    },
    { key: 'c', title: 'Mã nội dòng', icon: <Code className="h-3.5 w-3.5" />, run: () => wrap('`', '`', 'mã') },
    {
      key: 'cb',
      title: 'Khối mã',
      icon: <SquareCode className="h-3.5 w-3.5" />,
      run: () => {
        const ta = taRef.current;
        if (!ta) return;
        const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        const body = sel || 'mã nguồn';
        insertBlock('```\n' + body + '\n```', 4, 4 + body.length);
      },
    },
    { key: 'q', title: 'Trích dẫn', icon: <Quote className="h-3.5 w-3.5" />, run: () => linePrefix(() => '> ', /^>\s?/) },
    { key: 'ul', title: 'Danh sách dấu đầu dòng', icon: <List className="h-3.5 w-3.5" />, run: () => linePrefix(() => '- ', /^[-*+]\s(?!\[[ xX]\])/) },
    { key: 'ol', title: 'Danh sách đánh số', icon: <ListOrdered className="h-3.5 w-3.5" />, run: () => linePrefix((i) => `${i + 1}. `, /^\d+\.\s/) },
    { key: 'task', title: 'Danh sách công việc', icon: <ListChecks className="h-3.5 w-3.5" />, run: () => linePrefix(() => '- [ ] ', /^[-*+]\s\[[ xX]\]\s/) },
    {
      key: 'tb',
      title: 'Chèn bảng mẫu',
      icon: <TableIcon className="h-3.5 w-3.5" />,
      run: () => {
        const t = '| Cột 1 | Cột 2 | Cột 3 |\n| ----- | ----- | ----- |\n| Ô 1 | Ô 2 | Ô 3 |\n| Ô 4 | Ô 5 | Ô 6 |';
        insertBlock(t, 2, 7);
      },
    },
    { key: 'hr', title: 'Đường kẻ ngang', icon: <Minus className="h-3.5 w-3.5" />, run: () => insertBlock('---', 3, 3) },
  ];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en, value } = ta;
      const multi = value.slice(s, en).includes('\n');
      if (!multi && !e.shiftKey) {
        applyEdit(s, en, '  ', s + 2, s + 2);
        return;
      }
      const ls = value.lastIndexOf('\n', s - 1) + 1;
      let le = value.indexOf('\n', en > s && value[en - 1] === '\n' ? en - 1 : en);
      if (le === -1) le = value.length;
      const lines = value.slice(ls, le).split('\n');
      const out = lines
        .map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l))
        .join('\n');
      applyEdit(ls, le, out, ls, ls + out.length);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const found = k === 'b' ? 'b' : k === 'i' ? 'i' : k === 'k' ? 'a' : null;
      if (found) {
        e.preventDefault();
        toolbar.find((t) => t.key === found)?.run();
      }
    }
  };

  // ---- Đồng bộ cuộn theo tỉ lệ ----
  const syncScroll = (from: 'editor' | 'preview') => {
    if (mode !== 'split' || activeSide.current !== from) return;
    const a = from === 'editor' ? taRef.current : previewRef.current;
    const b = from === 'editor' ? previewRef.current : taRef.current;
    if (!a || !b) return;
    const max = a.scrollHeight - a.clientHeight;
    const ratio = max > 0 ? a.scrollTop / max : 0;
    b.scrollTop = ratio * (b.scrollHeight - b.clientHeight);
  };

  const scrollToHeading = (index: number) => {
    const root = previewRef.current;
    if (!root) return;
    const h = root.querySelectorAll('h1,h2,h3,h4,h5,h6')[index] as HTMLElement | undefined;
    if (!h) return;
    activeSide.current = 'preview';
    const top = h.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 8;
    root.scrollTo({ top, behavior: 'smooth' });
  };

  // ---- Tệp ----
  const loadFile = async (file: File) => {
    if (!/\.(md|markdown|txt)$/i.test(file.name) && !file.type.startsWith('text/')) {
      showToast('Chỉ hỗ trợ tệp .md, .markdown hoặc .txt.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast('Tệp quá lớn (tối đa 2 MB).');
      return;
    }
    try {
      const content = await file.text();
      setText(content);
      showToast(`Đã mở "${file.name}".`);
    } catch {
      showToast('Không đọc được tệp.');
    }
  };

  const download = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const stamp = () => new Date().toISOString().slice(0, 10);

  const copyText = async (value: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(okMsg);
    } catch {
      showToast('Không sao chép được vào bộ nhớ tạm.');
    }
  };

  const handleCopyMd = () => {
    if (!text) return showToast('Chưa có nội dung Markdown.');
    copyText(text, 'Đã sao chép Markdown!');
  };

  const handleDownloadMd = () => {
    if (!text) return showToast('Chưa có nội dung để tải.');
    download(text, `tai-lieu-${stamp()}.md`, 'text/markdown;charset=utf-8');
    showToast('Đã tải file .md.');
  };

  const buildHtml = async () => {
    const { markdownToStandaloneHtml } = await import('@/lib/markdown-export');
    return markdownToStandaloneHtml(text);
  };

  const handleCopyHtml = async () => {
    if (!text) return showToast('Chưa có nội dung để xuất.');
    try {
      copyText(await buildHtml(), 'Đã sao chép HTML!');
    } catch {
      showToast('Lỗi khi tạo HTML.');
    }
  };

  const handleDownloadHtml = async () => {
    if (!text) return showToast('Chưa có nội dung để xuất.');
    try {
      download(await buildHtml(), `tai-lieu-${stamp()}.html`, 'text/html;charset=utf-8');
      showToast('Đã tải file .html.');
    } catch {
      showToast('Lỗi khi tạo HTML.');
    }
  };

  const doPrint = () => {
    if (!text) return showToast('Chưa có nội dung để in.');
    const run = () => {
      const src = previewRef.current;
      if (!src) return;
      const clone = src.cloneNode(true) as HTMLElement;
      clone.className = 'md-print-clone ' + PREVIEW_CLASS;
      clone.removeAttribute('style');
      document.body.appendChild(clone);
      document.body.classList.add('md-printing');
      const cleanup = () => {
        document.body.classList.remove('md-printing');
        clone.remove();
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      // Trình duyệt chặn print() đồng bộ sẽ trả về sau khi đóng hộp thoại
      setTimeout(cleanup, 1000);
    };
    if (mode === 'edit') {
      setMode('split');
      setTimeout(run, 250);
    } else {
      run();
    }
  };

  const btn =
    'px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 text-slate-700 bg-white hover:bg-slate-100 transition flex items-center gap-1';

  const showEditor = mode !== 'preview';
  const showPreview = mode !== 'edit';

  return (
    <div className="space-y-3.5">
      <style>{PRINT_CSS}</style>

      {/* Header */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
            <BookOpenText className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Xem trước Markdown</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Soạn và xem kết quả trực tiếp (GFM). Tự lưu bản nháp, xuất Markdown / HTML / PDF.
            </p>
          </div>
        </div>
        <div className="flex bg-slate-800 p-0.5 rounded-lg text-xs">
          {(
            [
              ['edit', 'Soạn', <PenLine key="e" className="h-3 w-3" />],
              ['split', 'Song song', <Columns2 key="s" className="h-3 w-3" />],
              ['preview', 'Xem trước', <Eye key="p" className="h-3 w-3" />],
            ] as [ViewMode, string, React.ReactNode][]
          ).map(([m, label, icon]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded-md font-medium transition flex items-center gap-1 ${
                mode === m ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setText(SAMPLE)} className={btn} title="Nạp tài liệu mẫu">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          Mẫu
        </button>
        <button onClick={() => fileRef.current?.click()} className={btn} title="Mở tệp .md / .txt (hoặc kéo thả vào khung soạn)">
          <FileUp className="h-3.5 w-3.5" />
          Mở tệp
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = '';
          }}
        />
        <SendToButton text={text} fromToolId="markdown-preview" />
        <button onClick={handleCopyMd} className={btn}>
          <Copy className="h-3.5 w-3.5" />
          Chép MD
        </button>
        <button onClick={handleDownloadMd} className={btn}>
          <Download className="h-3.5 w-3.5" />
          Tải .md
        </button>
        <button onClick={handleCopyHtml} className={btn}>
          <FileCode2 className="h-3.5 w-3.5" />
          Chép HTML
        </button>
        <button onClick={handleDownloadHtml} className={btn}>
          <Download className="h-3.5 w-3.5" />
          Tải .html
        </button>
        <button onClick={doPrint} className={btn} title="In hoặc lưu thành PDF (chỉ in phần xem trước)">
          <Printer className="h-3.5 w-3.5" />
          In / PDF
        </button>
        <button
          onClick={() => setShowOutline((v) => !v)}
          className={`${btn} ${showOutline ? '!bg-indigo-50 !border-indigo-300 !text-indigo-700' : ''}`}
        >
          <ListTree className="h-3.5 w-3.5" />
          Dàn ý
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 px-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showStats}
            onChange={(e) => setShowStats(e.target.checked)}
            className="rounded border-slate-300 text-indigo-600 h-3.5 w-3.5"
          />
          Thống kê
        </label>
        <button
          onClick={() => {
            if (!text || confirm('Xóa toàn bộ nội dung?')) setText('');
          }}
          className="ml-auto p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
          title="Xóa nội dung"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-3.5 items-stretch">
        {/* Outline */}
        {showOutline && (
          <aside className="bg-white rounded-xl border border-slate-200/90 shadow-xs lg:w-56 shrink-0 max-h-48 lg:max-h-[640px] overflow-auto">
            <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <ListTree className="h-4 w-4 text-indigo-600" />
              Dàn ý
            </div>
            {mode === 'edit' ? (
              <p className="p-3 text-xs text-slate-400">Chuyển sang chế độ &ldquo;Song song&rdquo; hoặc &ldquo;Xem trước&rdquo; để dùng dàn ý.</p>
            ) : outline.length === 0 ? (
              <p className="p-3 text-xs text-slate-400">Chưa có tiêu đề nào.</p>
            ) : (
              <ul className="p-1.5 text-xs">
                {outline.map((o, i) => (
                  <li key={i}>
                    <button
                      onClick={() => scrollToHeading(i)}
                      style={{ paddingLeft: `${(o.level - 1) * 12 + 8}px` }}
                      className="w-full text-left py-1 pr-2 rounded hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 truncate"
                      title={o.text}
                    >
                      {o.text || '(trống)'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

        <div className={`flex-1 min-w-0 grid gap-3.5 grid-cols-1 ${mode === 'split' ? 'lg:grid-cols-2' : ''}`}>
          {/* Editor */}
          {showEditor && (
            <div
              className={`bg-white rounded-xl border shadow-xs flex flex-col h-[520px] lg:h-[640px] overflow-hidden min-w-0 ${
                dragOver ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200/90'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) loadFile(f);
              }}
            >
              <div className="p-2 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-0.5">
                {toolbar.map((t) => (
                  <button
                    key={t.key}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={t.run}
                    title={t.title}
                    aria-label={t.title}
                    className="p-1.5 rounded-md text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 transition"
                  >
                    {t.icon}
                  </button>
                ))}
              </div>
              <textarea
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onScroll={() => syncScroll('editor')}
                onMouseEnter={() => (activeSide.current = 'editor')}
                onTouchStart={() => (activeSide.current = 'editor')}
                onFocus={() => (activeSide.current = 'editor')}
                spellCheck={false}
                placeholder="Nhập Markdown tại đây, hoặc kéo thả tệp .md vào..."
                className="flex-1 w-full p-3 text-xs font-mono bg-slate-50/40 focus:bg-white outline-hidden resize-none leading-relaxed text-slate-800"
              />
              <div className="px-3 py-1.5 border-t border-slate-100 bg-slate-50/80 text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3">
                <span>Dòng: <strong>{formatNumber(stats.lines)}</strong></span>
                {showStats && (
                  <>
                    <span>Từ: <strong>{formatNumber(stats.words)}</strong></span>
                    <span>Ký tự: <strong>{formatNumber(stats.chars)}</strong></span>
                    <span>Đọc khoảng: <strong>{stats.minutes} phút</strong></span>
                  </>
                )}
                <span className="ml-auto text-slate-400">Tự động lưu nháp</span>
              </div>
            </div>
          )}

          {/* Preview */}
          {showPreview && (
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col h-[520px] lg:h-[640px] overflow-hidden min-w-0">
              <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="h-4 w-4 text-emerald-600" />
                Xem trước
              </div>
              <div
                ref={previewRef}
                onScroll={() => syncScroll('preview')}
                onMouseEnter={() => (activeSide.current = 'preview')}
                onTouchStart={() => (activeSide.current = 'preview')}
                onWheel={() => (activeSide.current = 'preview')}
                className="flex-1 overflow-auto p-4 sm:p-5"
              >
                {deferred.trim() ? (
                  <div className={PREVIEW_CLASS}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferred}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="py-12 text-center text-sm text-slate-400">
                    Chưa có nội dung. Hãy nhập Markdown hoặc bấm &ldquo;Mẫu&rdquo;.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
