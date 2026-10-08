'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText,
  Table as TableIcon,
  Copy,
  Check,
  Download,
  Trash2,
  Sparkles,
  Settings2,
  Eye,
  Code2,
  FileSpreadsheet,
  CheckCircle2,
  ClipboardPaste,
  BookOpen,
  Layers,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import {
  convertToMarkdown,
  TableConvertOptions,
  DEFAULT_CONVERT_OPTIONS,
  SAMPLE_INPUTS,
} from '@/lib/markdown-converter';

export default function HtmlToMarkdownPage() {
  const { showToast } = useApp();
  const [inputText, setInputText] = useState(() => {
    if (typeof window !== 'undefined') {
      const incoming = sessionStorage.getItem('stt_to_md_text');
      if (incoming) {
        sessionStorage.removeItem('stt_to_md_text');
        return incoming;
      }
    }
    return SAMPLE_INPUTS.fullArticle.html;
  });
  const [markdownOutput, setMarkdownOutput] = useState('');
  const [detectedType, setDetectedType] = useState<string>('html-rich');
  const [activeTab, setActiveTab] = useState<'preview' | 'editor' | 'table-focus'>('preview');
  const [options, setOptions] = useState<TableConvertOptions>(DEFAULT_CONVERT_OPTIONS);
  const [isCopied, setIsCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [, startTransition] = useTransition();
  const pasteZoneRef = useRef<HTMLDivElement>(null);

  // Convert whenever input or options change
  useEffect(() => {
    startTransition(() => {
      const res = convertToMarkdown(inputText, options);
      setMarkdownOutput(res.markdown);
      setDetectedType(res.detectedType);
    });
  }, [inputText, options]);

  // Handle direct paste event with rich text/html detection
  const handlePasteEvent = (e: React.ClipboardEvent<any>) => {
    const clipboard = e.clipboardData;
    const html = clipboard.getData('text/html');
    const text = clipboard.getData('text/plain');

    if (html && html.trim().length > 0) {
      e.preventDefault();
      setInputText(html);
      showToast('Đã dán thành công mã HTML / Rich Text từ Clipboard!');
    } else if (text && text.trim().length > 0) {
      if (text.includes('\t') && text.includes('\n')) {
        e.preventDefault();
        setInputText(text);
        showToast('Đã nhận diện bảng dữ liệu dạng Tab (Excel / Google Sheets)!');
      }
    }
  };

  const handleCopyMarkdown = async () => {
    if (!markdownOutput) {
      showToast('Chưa có nội dung Markdown để sao chép.');
      return;
    }
    try {
      await navigator.clipboard.writeText(markdownOutput);
      setIsCopied(true);
      showToast('Đã sao chép Markdown vào bộ nhớ tạm!');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const handleDownloadMarkdown = () => {
    if (!markdownOutput) {
      showToast('Chưa có nội dung để tải về.');
      return;
    }
    const blob = new Blob([markdownOutput], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `converted_document_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Đã tải xuống file .md thành công!');
  };

  const handlePasteFromClipboardBtn = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('text/html')) {
            const blob = await item.getType('text/html');
            const htmlText = await blob.text();
            setInputText(htmlText);
            showToast('Đã dán toàn bộ định dạng HTML từ clipboard!');
            return;
          }
        }
      }
      const text = await navigator.clipboard.readText();
      if (text) {
        setInputText(text);
        showToast('Đã dán văn bản từ clipboard!');
      } else {
        showToast('Clipboard trống.');
      }
    } catch {
      showToast('Vui lòng nhấn Ctrl+V trực tiếp vào khung nhập liệu!');
    }
  };

  const tableRows = markdownOutput.split('\n').filter((l) => l.trim().startsWith('|')).length;
  const wordCount = markdownOutput.trim() ? markdownOutput.trim().split(/\s+/).length : 0;
  const charCount = markdownOutput.length;

  return (
    <div className="space-y-3.5">
      {/* COMPACT SLIM HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight">
                Chuyển Text / HTML sang Markdown
              </h1>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                Toàn diện + Tối ưu Bảng
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Hỗ trợ đầy đủ: Tiêu đề H1-H6, Danh sách, Code block, Trích dẫn, Ảnh, Link & đặc biệt tối ưu cho Bảng Excel/Web.
            </p>
          </div>
        </div>

        {/* Compact Sample Chips on the right */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-slate-400 mr-1 hidden md:inline flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-amber-400" />
            Mẫu thử:
          </span>
          <button
            onClick={() => setInputText(SAMPLE_INPUTS.fullArticle.html)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
            title="Tài liệu toàn diện có đầy đủ tiêu đề, code, list và bảng"
          >
            <BookOpen className="h-3 w-3 text-amber-400" />
            Bài viết Toàn diện
          </button>
          <button
            onClick={() => setInputText(SAMPLE_INPUTS.excelSales.html)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
            title="Bảng doanh số sao chép từ Excel hoặc Google Sheets"
          >
            <FileSpreadsheet className="h-3 w-3 text-emerald-400" />
            Bảng Excel / Sheets
          </button>
          <button
            onClick={() => setInputText(SAMPLE_INPUTS.techComparison.html)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
            title="Bảng so sánh công nghệ với code và link"
          >
            <TableIcon className="h-3 w-3 text-cyan-400" />
            Bảng So sánh
          </button>
        </div>
      </div>

      {/* Main Dual-Pane Converter Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        {/* LEFT COLUMN: Input Source */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col h-[560px] overflow-hidden">
          {/* Header & Controls */}
          <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <ClipboardPaste className="h-4 w-4 text-indigo-600" />
                Nguồn vào (HTML / Văn bản / Excel)
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700">
                {detectedType === 'html-rich' && 'HTML Toàn diện'}
                {detectedType === 'html-table' && 'HTML có Bảng'}
                {detectedType === 'tsv-table' && 'Bảng Tab (Excel/Sheets)'}
                {detectedType === 'csv-table' && 'Bảng CSV'}
                {detectedType === 'plain-text' && 'Văn bản thuần'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={handlePasteFromClipboardBtn}
                title="Dán nhanh từ Clipboard"
                className="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition flex items-center gap-1 border border-indigo-200"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                Dán Clipboard
              </button>
              <button
                onClick={() => setInputText('')}
                title="Xóa nội dung"
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Interactive Paste & Edit Zone */}
          <div
            ref={pasteZoneRef}
            onPaste={handlePasteEvent}
            className="flex-1 flex flex-col p-3 relative group"
          >
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onPaste={handlePasteEvent}
              placeholder="Dán mã HTML bất kỳ (hoặc bôi đen bảng Excel/Sheets/Web rồi Ctrl+V vào đây)..."
              className="w-full flex-1 p-3 text-xs font-mono bg-slate-50/60 hover:bg-slate-50/90 focus:bg-white rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden resize-none transition leading-relaxed text-slate-800"
            />

            <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between px-1">
              <span>💡 Hỗ trợ đầy đủ: Heading H1-H6, Danh sách, Code, Blockquote, Ảnh, Link & Bảng tính</span>
              <span>{inputText.length} ký tự</span>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Output Markdown */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col h-[560px] overflow-hidden">
          {/* Header & View Tabs */}
          <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Code2 className="h-4 w-4 text-emerald-600" />
                Kết quả Markdown GFM
              </span>

              {/* View toggle */}
              <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs">
                <button
                  onClick={() => setActiveTab('preview')}
                  className={`px-2 py-0.5 rounded-md font-medium transition flex items-center gap-1 ${
                    activeTab === 'preview'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Xem trước kết quả đã render toàn bộ Markdown (Heading, List, Code, Bảng)"
                >
                  <Eye className="h-3 w-3" />
                  Xem trước
                </button>
                <button
                  onClick={() => setActiveTab('editor')}
                  className={`px-2 py-0.5 rounded-md font-medium transition flex items-center gap-1 ${
                    activeTab === 'editor'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Xem mã nguồn Markdown thuần"
                >
                  <Code2 className="h-3 w-3" />
                  Mã Markdown
                </button>
                {tableRows > 0 && (
                  <button
                    onClick={() => setActiveTab('table-focus')}
                    className={`px-2 py-0.5 rounded-md font-medium transition flex items-center gap-1 ${
                      activeTab === 'table-focus'
                        ? 'bg-white text-emerald-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Chế độ tập trung kiểm tra Bảng biểu"
                  >
                    <TableIcon className="h-3 w-3 text-emerald-600" />
                    Bảng ({tableRows})
                  </button>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowSettings(!showSettings)}
                title="Tùy chọn cấu hình Markdown & Bảng"
                className={`p-1.5 rounded-lg border transition ${
                  showSettings
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'text-slate-500 hover:text-slate-800 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleCopyMarkdown}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition flex items-center gap-1"
              >
                {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{isCopied ? 'Đã chép!' : 'Chép MD'}</span>
              </button>
              <button
                onClick={handleDownloadMarkdown}
                title="Tải về file .md"
                className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg transition"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Settings Bar (Collapsible) */}
          {showSettings && (
            <div className="p-2.5 bg-indigo-50/70 border-b border-indigo-100 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium">
                <input
                  type="checkbox"
                  checked={options.prettyAlign}
                  onChange={(e) => setOptions({ ...options, prettyAlign: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                <span>Căn đều cột bảng</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium">
                <input
                  type="checkbox"
                  checked={options.preserveBreaks}
                  onChange={(e) => setOptions({ ...options, preserveBreaks: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                <span>Giữ xuống dòng ô (&lt;br&gt;)</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium">
                <input
                  type="checkbox"
                  checked={options.cleanWordExcelJunk}
                  onChange={(e) => setOptions({ ...options, cleanWordExcelJunk: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                <span>Lọc rác Word/Excel</span>
              </label>

              <label className="flex items-center gap-1.5 text-slate-700 font-medium">
                <span className="text-slate-500">Tiêu đề:</span>
                <select
                  value={options.headingStyle}
                  onChange={(e) => setOptions({ ...options, headingStyle: e.target.value as any })}
                  className="text-xs bg-white rounded border border-slate-200 px-1 py-0.5"
                >
                  <option value="atx"># ATX</option>
                  <option value="setext">Setext (===)</option>
                </select>
              </label>
            </div>
          )}

          {/* Content Pane */}
          <div className="flex-1 overflow-auto p-3.5 bg-slate-50/40">
            {activeTab === 'editor' && (
              <textarea
                value={markdownOutput}
                onChange={(e) => setMarkdownOutput(e.target.value)}
                placeholder="Kết quả Markdown sẽ hiển thị ở đây..."
                className="w-full h-full p-3 text-xs font-mono bg-white rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-hidden resize-none leading-relaxed text-slate-800"
              />
            )}

            {activeTab === 'preview' && (
              <div className="bg-white p-4 sm:p-5 rounded-lg border border-slate-200 h-full overflow-auto text-slate-800 text-xs">
                {markdownOutput ? (
                  <div className="prose prose-xs max-w-none text-slate-800 space-y-2 [&_h1]:text-base [&_h1]:font-extrabold [&_h1]:border-b [&_h1]:border-slate-200 [&_h1]:pb-1 [&_h1]:mt-2 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-bold [&_p]:leading-relaxed [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-600 [&_code]:bg-slate-100 [&_code]:text-indigo-700 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_th]:bg-slate-100 [&_th]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:font-bold [&_td]:p-2 [&_td]:border [&_td]:border-slate-200 [&_tr:nth-child(even)]:bg-slate-50">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {markdownOutput}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="py-12 text-center text-slate-400">
                    Chưa có nội dung để hiển thị. Hãy dán mã HTML vào khung bên trái.
                  </div>
                )}
              </div>
            )}

            {activeTab === 'table-focus' && (
              <div className="bg-white p-4 rounded-lg border border-slate-200 h-full overflow-auto text-slate-800 text-xs">
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <span className="font-bold text-slate-700 flex items-center gap-1.5">
                      <TableIcon className="h-4 w-4 text-emerald-600" />
                      Chế độ kiểm tra Bảng ({tableRows} dòng)
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Căn đều GFM hoàn hảo
                    </span>
                  </div>
                  <MarkdownTableViewer markdown={markdownOutput} />
                </div>
              </div>
            )}
          </div>

          {/* Footer Stats */}
          <div className="p-2.5 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between text-[11px] text-slate-500">
            <div className="flex items-center gap-3">
              <span>Số dòng bảng: <strong>{tableRows}</strong></span>
              <span>Từ: <strong>{wordCount}</strong></span>
              <span>Ký tự: <strong>{charCount}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyMarkdown}
                className="text-emerald-700 hover:underline font-semibold flex items-center gap-1"
              >
                <Copy className="h-3 w-3" />
                Sao chép Markdown
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feature Guide & Highlights (Compact 3-cards row) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-xs space-y-1">
          <div className="flex items-center gap-1.5 text-indigo-700 font-bold text-xs">
            <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
            <span>Hỗ trợ Toàn diện Mọi Thành phần</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Chuyển đổi hoàn hảo Tiêu đề (H1-H6), Danh sách có thứ tự/không thứ tự, Task list [x], Code block, Trích dẫn blockquote, In đậm, In nghiêng, Gạch ngang, Ảnh và Liên kết.
          </p>
        </div>

        <div className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-xs space-y-1">
          <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-xs">
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>Tối ưu Vượt trội cho Bảng biểu</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Nhận diện cấu trúc bảng sao chép từ Excel, Google Sheets, Word hay website bất kỳ. Tự động căn lề trái/giữa/phải, căn đều cột (Pretty Pad) và xử lý xuống dòng trong ô.
          </p>
        </div>

        <div className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-xs space-y-1">
          <div className="flex items-center gap-1.5 text-indigo-700 font-bold text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>Chuẩn GitHub & Tương thích 100%</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Mã xuất ra tuân thủ tiêu chuẩn GitHub Flavored Markdown (GFM), hiển thị đẹp mắt trên GitHub README, GitLab, Obsidian, Notion, StackOverflow và các trình render Markdown.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Component to visually inspect the parsed Markdown table specifically
 */
function MarkdownTableViewer({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');
  const tableLines = lines.filter((l) => l.trim().startsWith('|') && l.trim().endsWith('|'));

  if (tableLines.length < 2) {
    return (
      <div className="py-8 text-center text-slate-400">
        <p>Tài liệu này không chứa bảng biểu Markdown dạng cột.</p>
        <p className="text-[11px] mt-1 text-slate-500">
          Hãy chuyển sang tab &ldquo;Xem trước&rdquo; để xem toàn bộ tài liệu (tiêu đề, danh sách, code, văn bản).
        </p>
      </div>
    );
  }

  const headerCells = tableLines[0]
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());

  const alignCells = tableLines[1]
    .split('|')
    .slice(1, -1)
    .map((c) => {
      const s = c.trim();
      if (s.startsWith(':') && s.endsWith(':')) return 'center';
      if (s.endsWith(':')) return 'right';
      return 'left';
    });

  const rowData = tableLines.slice(2).map((rowLine) => {
    return rowLine
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
  });

  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-slate-100 text-slate-800 font-bold">
          <tr>
            {headerCells.map((cell, idx) => (
              <th
                key={idx}
                className={`p-2 border-b border-slate-200 ${
                  alignCells[idx] === 'right'
                    ? 'text-right'
                    : alignCells[idx] === 'center'
                    ? 'text-center'
                    : 'text-left'
                }`}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rowData.map((row, rIdx) => (
            <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
              {row.map((cell, cIdx) => (
                <td
                  key={cIdx}
                  className={`p-2 text-slate-700 ${
                    alignCells[cIdx] === 'right'
                      ? 'text-right font-mono'
                      : alignCells[cIdx] === 'center'
                      ? 'text-center'
                      : 'text-left'
                  }`}
                >
                  {cell.replace(/<br\s*[\/]?>/gi, '\n')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
