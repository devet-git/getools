/**
 * Comprehensive HTML / Rich-Text / TSV / Excel Table to Markdown Converter
 * Specially optimized for copied tables from Excel, Google Sheets, Word, and Webpages
 */

import TurndownService from 'turndown';
import { gfm, tables } from 'turndown-plugin-gfm';

export interface TableConvertOptions {
  prettyAlign?: boolean;
  detectHeaders?: boolean;
  preserveBreaks?: boolean;
  cleanWordExcelJunk?: boolean;
  bulletListMarker?: '-' | '*' | '+';
  headingStyle?: 'atx' | 'setext';
  codeBlockStyle?: 'fenced' | 'indented';
}

export const DEFAULT_CONVERT_OPTIONS: TableConvertOptions = {
  prettyAlign: true,
  detectHeaders: true,
  preserveBreaks: true,
  cleanWordExcelJunk: true,
  bulletListMarker: '-',
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
};

/**
 * Parses tab-separated values (TSV) or comma-separated values (CSV)
 * into a GitHub Flavored Markdown table with optional column padding alignment.
 */
export function tsvToMarkdownTable(text: string, options: TableConvertOptions = DEFAULT_CONVERT_OPTIONS): string {
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return '';

  // Detect delimiter: tab is standard for Excel/Sheets copy-paste
  const firstLine = lines[0];
  const hasTabs = firstLine.includes('\t');
  const delimiter = hasTabs ? '\t' : (firstLine.includes(',') && !firstLine.includes('|') ? ',' : '\t');

  const matrix: string[][] = lines.map(line => {
    // If TSV, simple split by tab
    if (delimiter === '\t') {
      return line.split('\t').map(cell => cleanTableCell(cell, options.preserveBreaks));
    }
    // Simple CSV parser respecting quoted values
    return parseCsvLine(line).map(cell => cleanTableCell(cell, options.preserveBreaks));
  });

  if (matrix.length === 0 || matrix[0].length === 0) return '';

  // Normalize column count
  const maxCols = Math.max(...matrix.map(row => row.length));
  for (const row of matrix) {
    while (row.length < maxCols) {
      row.push('');
    }
  }

  return formatMatrixToMarkdownTable(matrix, options.prettyAlign ?? true);
}

/**
 * Cleans a cell's string: replaces internal unescaped pipes and handles newlines
 */
function cleanTableCell(cell: string, preserveBreaks = true): string {
  let val = cell.trim();
  // Escape pipes
  val = val.replace(/\|/g, '\\|');
  // Handle newlines within cell
  if (preserveBreaks) {
    val = val.replace(/\r?\n/g, '<br />');
  } else {
    val = val.replace(/\r?\n/g, ' ');
  }
  return val;
}

/**
 * Parses a simple CSV line with quotes support
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Pads and aligns a 2D matrix of strings into a pristine Markdown GFM table
 */
export function formatMatrixToMarkdownTable(
  matrix: string[][],
  prettyAlign = true,
  alignments?: ('left' | 'center' | 'right')[]
): string {
  if (matrix.length === 0) return '';
  const colCount = Math.max(...matrix.map(r => r.length));
  if (colCount === 0) return '';

  // Ensure every row has colCount columns
  const normalized = matrix.map(row => {
    const r = [...row];
    while (r.length < colCount) r.push('');
    return r;
  });

  // Calculate maximum column widths
  const colWidths = new Array(colCount).fill(3);
  for (const row of normalized) {
    row.forEach((cell, colIdx) => {
      colWidths[colIdx] = Math.max(colWidths[colIdx], cell.length);
    });
  }

  const effectiveAligns: ('left' | 'center' | 'right')[] = [];
  for (let c = 0; c < colCount; c++) {
    effectiveAligns[c] = alignments?.[c] || 'left';
  }

  // Header row
  const headerRow = normalized[0];
  // Separator row
  const sepRow = effectiveAligns.map((align, colIdx) => {
    const width = prettyAlign ? colWidths[colIdx] : 3;
    if (align === 'center') {
      return `:${'-'.repeat(Math.max(1, width - 2))}:`;
    } else if (align === 'right') {
      return `${'-'.repeat(Math.max(2, width - 1))}:`;
    } else {
      return `:${'-'.repeat(Math.max(2, width - 1))}`;
    }
  });

  const outputLines: string[] = [];

  const formatRow = (cells: string[]) => {
    if (!prettyAlign) {
      return `| ${cells.join(' | ')} |`;
    }
    const formattedCells = cells.map((cell, colIdx) => {
      const align = effectiveAligns[colIdx];
      const width = colWidths[colIdx];
      const pad = width - cell.length;
      if (pad <= 0) return cell;
      if (align === 'right') {
        return ' '.repeat(pad) + cell;
      } else if (align === 'center') {
        const left = Math.floor(pad / 2);
        const right = pad - left;
        return ' '.repeat(left) + cell + ' '.repeat(right);
      } else {
        return cell + ' '.repeat(pad);
      }
    });
    return `| ${formattedCells.join(' | ')} |`;
  };

  outputLines.push(formatRow(headerRow));
  outputLines.push(formatRow(sepRow));

  for (let r = 1; r < normalized.length; r++) {
    outputLines.push(formatRow(normalized[r]));
  }

  return outputLines.join('\n');
}

/**
 * Pre-cleans HTML string from Microsoft Office, Google Docs, or messy web scrapers
 */
export function cleanHtmlSource(rawHtml: string): string {
  let html = rawHtml;

  // Remove XML namespace declarations & MS Office comments
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<xml[\s\S]*?<\/xml>/gi, '');
  html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<o:[^>]+>[\s\S]*?<\/o:[^>]+>/gi, '');
  html = html.replace(/<meta[^>]*>/gi, '');
  html = html.replace(/<link[^>]*>/gi, '');

  // Strip empty spans and mso classes
  html = html.replace(/ class="[^"]*mso[^"]*"/gi, '');
  html = html.replace(/ style="[^"]*mso-[^"]*"/gi, '');

  // Normalize excessive breaks inside tables
  return html.trim();
}

/**
 * Specialized DOM parser for <table> elements to ensure zero loss of table cells,
 * proper alignment extraction, colspan normalization, and nested tag formatting.
 */
function parseHtmlTablesWithDOM(container: Element, prettyAlign = true): void {
  const tables = container.querySelectorAll('table');
  
  tables.forEach(table => {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return;

    const matrix: string[][] = [];
    const alignments: ('left' | 'center' | 'right')[] = [];

    rows.forEach((tr, rowIdx) => {
      const cells = Array.from(tr.querySelectorAll('th, td'));
      const rowData: string[] = [];

      cells.forEach((cell, cellIdx) => {
        // Detect alignment from attribute or inline style
        if (rowIdx === 0 || alignments[cellIdx] === undefined) {
          const alignAttr = (cell.getAttribute('align') || '').toLowerCase();
          const style = (cell.getAttribute('style') || '').toLowerCase();
          if (alignAttr === 'center' || style.includes('text-align: center') || style.includes('text-align:center')) {
            alignments[cellIdx] = 'center';
          } else if (alignAttr === 'right' || style.includes('text-align: right') || style.includes('text-align:right')) {
            alignments[cellIdx] = 'right';
          } else {
            alignments[cellIdx] = 'left';
          }
        }

        // Clean cell content, preserve inner markdown (like bold, links, code)
        let cellText = cell.innerHTML
          .replace(/<br\s*[\/]?>/gi, '<br />')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&quot;/gi, '"')
          .trim();

        // Convert common inline tags in cells
        cellText = cellText
          .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**')
          .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '*$2*')
          .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
          .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
          .replace(/<[^>]+>/g, '') // strip remaining tags
          .replace(/\|/g, '\\|')
          .replace(/\r?\n+/g, ' ')
          .trim();

        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
        rowData.push(cellText);
        for (let c = 1; c < colspan; c++) {
          rowData.push(''); // Fill empty spanned columns
        }
      });

      if (rowData.length > 0) {
        matrix.push(rowData);
      }
    });

    if (matrix.length > 0) {
      const mdTable = formatMatrixToMarkdownTable(matrix, prettyAlign, alignments);
      // Replace table in container with a pre-formatted placeholder
      const placeholder = document.createElement('pre');
      placeholder.setAttribute('data-md-table', 'true');
      placeholder.textContent = '\n\n' + mdTable + '\n\n';
      table.parentNode?.replaceChild(placeholder, table);
    }
  });
}

/**
 * Main conversion function: converts HTML or plain text (TSV/CSV/rich text) to clean GitHub Flavored Markdown
 */
export function convertToMarkdown(input: string, options: TableConvertOptions = DEFAULT_CONVERT_OPTIONS): { markdown: string; detectedType: 'html-table' | 'html-rich' | 'tsv-table' | 'csv-table' | 'plain-text' } {
  if (!input || !input.trim()) {
    return { markdown: '', detectedType: 'plain-text' };
  }

  const trimmed = input.trim();

  // 1. Check if input is plain TSV (copied directly from Excel / Google Sheets cells without HTML tags)
  const isTsv = !trimmed.includes('<') && trimmed.includes('\t') && trimmed.includes('\n');
  if (isTsv) {
    return {
      markdown: tsvToMarkdownTable(trimmed, options),
      detectedType: 'tsv-table',
    };
  }

  // 2. Check if input is CSV with tabular lines
  const lines = trimmed.split('\n');
  const isCsv = !trimmed.includes('<') && lines.length > 1 && lines[0].includes(',') && lines[1]?.includes(',');
  if (isCsv && !trimmed.startsWith('#')) {
    return {
      markdown: tsvToMarkdownTable(trimmed, options),
      detectedType: 'csv-table',
    };
  }

  // 3. HTML Input (from webpage clipboard, rich text editor, or direct HTML code)
  const hasHtml = /<\/?[a-z][\s\S]*>/i.test(trimmed);

  if (hasHtml && typeof window !== 'undefined') {
    const cleanedHtml = cleanHtmlSource(trimmed);
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanedHtml, 'text/html');

    // Check if contains table
    const hasTable = doc.body.querySelector('table') !== null;
    if (hasTable) {
      parseHtmlTablesWithDOM(doc.body, options.prettyAlign ?? true);
    }

    // Initialize Turndown
    const turndownService = new TurndownService({
      headingStyle: options.headingStyle || 'atx',
      bulletListMarker: options.bulletListMarker || '-',
      codeBlockStyle: options.codeBlockStyle || 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      hr: '---',
    });

    turndownService.use(gfm);
    turndownService.use(tables);

    // Custom rule for code blocks with language extraction
    turndownService.addRule('fencedCodeBlocks', {
      filter: (node) => {
        return node.nodeName === 'PRE' && node.querySelector('code') !== null && node.getAttribute('data-md-table') !== 'true';
      },
      replacement: (_content, node) => {
        const codeEl = (node as HTMLElement).querySelector('code');
        const className = codeEl?.getAttribute('class') || (node as HTMLElement).getAttribute('class') || '';
        const langMatch = className.match(/(?:language|lang)-([\w-]+)/i);
        const lang = langMatch ? langMatch[1] : '';
        const text = codeEl?.textContent || (node as HTMLElement).textContent || '';
        return `\n\n\`\`\`${lang}\n${text.trim()}\n\`\`\`\n\n`;
      },
    });

    // Custom rule for task lists
    turndownService.addRule('taskLists', {
      filter: (node) => {
        return node.nodeName === 'LI' && node.querySelector('input[type="checkbox"]') !== null;
      },
      replacement: (_content, node) => {
        const checkbox = (node as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        const checked = checkbox ? checkbox.checked : false;
        const text = (node as HTMLElement).textContent?.replace(/^\[[ x]\]\s*/i, '').trim() || '';
        return `\n- [${checked ? 'x' : ' '}] ${text}`;
      },
    });

    // Rule for preserved Markdown tables
    turndownService.addRule('preFormattedMdTable', {
      filter: (node) => {
        return node.nodeName === 'PRE' && node.getAttribute('data-md-table') === 'true';
      },
      replacement: (_content, node) => {
        return (node as HTMLElement).textContent || '';
      },
    });

    // Custom rule to cleanly preserve image alt and src
    turndownService.addRule('cleanImages', {
      filter: 'img',
      replacement: (_content, node) => {
        const el = node as HTMLImageElement;
        const alt = el.getAttribute('alt') || '';
        const src = el.getAttribute('src') || '';
        if (!src) return '';
        return `![${alt}](${src})`;
      },
    });

    // Custom rule for blockquotes
    turndownService.addRule('cleanBlockquotes', {
      filter: 'blockquote',
      replacement: (content) => {
        const lines = content.trim().split('\n');
        return '\n\n' + lines.map(line => `> ${line}`).join('\n') + '\n\n';
      },
    });

    let markdown = turndownService.turndown(doc.body.innerHTML);
    // Tidy up consecutive empty lines
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

    return {
      markdown,
      detectedType: hasTable ? 'html-table' : 'html-rich',
    };
  }

  // Fallback for non-browser or plain text
  return {
    markdown: trimmed,
    detectedType: 'plain-text',
  };
}

export const SAMPLE_INPUTS = {
  fullArticle: {
    title: 'Bài viết Toàn diện (Đầy đủ Markdown + Bảng)',
    description: 'Bao gồm Tiêu đề H1-H3, Định dạng in đậm/nghiêng, Code block, Danh sách, Task list, Trích dẫn và Bảng biểu',
    html: `<h1>Hướng dẫn Kiến trúc Web & Quản lý Mã nguồn</h1>
<p>Markdown là ngôn ngữ định dạng tiêu chuẩn được phát triển nhằm mục đích <strong>dễ đọc</strong>, <em>dễ viết</em> và tương thích 100% với các nền tảng lập trình hiện đại như <strong>GitHub</strong>, <strong>GitLab</strong>, và <em>Notion</em>.</p>

<blockquote>
  <p>💡 <strong>Lời khuyên của chuyên gia:</strong> Việc chuyển đổi toàn bộ tài liệu HTML sang Markdown giúp lưu trữ phiên bản nhẹ hơn 80% và dễ dàng tích hợp vào hệ thống CI/CD.</p>
</blockquote>

<h2>1. Tính năng nổi bật & Nhiệm vụ</h2>
<p>Dưới đây là danh sách công việc đã và đang triển khai:</p>
<ul>
  <li>Hỗ trợ chuyển đổi toàn diện tất cả thẻ HTML chuẩn</li>
  <li>Bảo toàn nguyên vẹn liên kết <a href="https://github.com">GitHub Repository</a> và hình ảnh</li>
  <li>Tối ưu đặc biệt cho <strong>bảng tính phức tạp</strong> sao chép từ Excel hoặc Web</li>
</ul>

<p>Danh sách việc cần làm (Task list):</p>
<ul>
  <li><input type="checkbox" checked /> Tích hợp Web Speech API Speech-to-Text</li>
  <li><input type="checkbox" checked /> Tối ưu không gian hiển thị (Compact layout)</li>
  <li><input type="checkbox" /> Xuất tài liệu sang PDF và Word</li>
</ul>

<h2>2. Bảng so sánh chỉ số hiệu năng (Performance Benchmarks)</h2>
<p>Bảng dưới đây thể hiện các chỉ số đo lường với căn lề trái, giữa và phải:</p>
<table border="1" width="100%">
  <thead>
    <tr style="background-color: #f8fafc;">
      <th align="left">Nền tảng / Công cụ</th>
      <th align="center">Kiến trúc lõi</th>
      <th align="center">Hỗ trợ Bảng</th>
      <th align="right">Tốc độ (req/s)</th>
      <th align="right">Độ trễ trung bình</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>Next.js 15</code></td>
      <td align="center">React Server Components</td>
      <td align="center">GFM Full Support</td>
      <td align="right"><strong>45,200</strong></td>
      <td align="right">1.2 ms</td>
    </tr>
    <tr>
      <td><code>Astro 5</code></td>
      <td align="center">Zero JS Islands</td>
      <td align="center">GFM Full Support</td>
      <td align="right"><strong>52,800</strong></td>
      <td align="right">0.8 ms</td>
    </tr>
    <tr>
      <td><code>Remix / RR7</code></td>
      <td align="center">SSR Streaming</td>
      <td align="center">GFM Full Support</td>
      <td align="right"><strong>38,900</strong></td>
      <td align="right">1.5 ms</td>
    </tr>
  </tbody>
</table>

<h2>3. Mã nguồn mẫu (Code Snippet)</h2>
<p>Đoạn mã cấu hình TypeScript chuẩn cho ứng dụng:</p>
<pre><code class="language-typescript">interface AppConfig {
  appName: string;
  version: string;
  features: {
    tts: boolean;
    stt: boolean;
    markdownConverter: boolean;
  };
}

const config: AppConfig = {
  appName: 'AI Studio Multi-Tool',
  version: '2.0.0',
  features: { tts: true, stt: true, markdownConverter: true }
};</code></pre>

<hr />
<p><em>Tài liệu được chuyển đổi tự động bởi hệ thống Multi-Tool Converter.</em></p>`,
  },
  excelSales: {
    title: 'Bảng Doanh số Excel / Google Sheets',
    description: 'Bảng biểu mẫu doanh số với căn phải số tiền, căn giữa mã và căn trái tên',
    html: `<table>
  <thead>
    <tr style="background-color: #f1f5f9;">
      <th align="left">Mã SP</th>
      <th align="left">Tên sản phẩm</th>
      <th align="center">Danh mục</th>
      <th align="right">Số lượng</th>
      <th align="right">Đơn giá (VNĐ)</th>
      <th align="right">Thành tiền (VNĐ)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>SKU-001</code></td>
      <td><strong>MacBook Pro 16" M3 Max</strong></td>
      <td align="center">Laptop</td>
      <td align="right">5</td>
      <td align="right">89,990,000</td>
      <td align="right">449,950,000</td>
    </tr>
    <tr>
      <td><code>SKU-002</code></td>
      <td><strong>Dell XPS 15 OLED</strong></td>
      <td align="center">Laptop</td>
      <td align="right">8</td>
      <td align="right">54,500,000</td>
      <td align="right">436,000,000</td>
    </tr>
    <tr>
      <td><code>SKU-003</code></td>
      <td><strong>LG UltraFine 32" 4K Ergo</strong></td>
      <td align="center">Màn hình</td>
      <td align="right">15</td>
      <td align="right">14,200,000</td>
      <td align="right">213,000,000</td>
    </tr>
    <tr>
      <td><code>SKU-004</code></td>
      <td><strong>Bàn phím cơ Keychron Q1 Pro</strong></td>
      <td align="center">Phụ kiện</td>
      <td align="right">20</td>
      <td align="right">4,690,000</td>
      <td align="right">93,800,000</td>
    </tr>
  </tbody>
</table>`,
  },
  techComparison: {
    title: 'Bảng So sánh Kỹ thuật Web',
    description: 'So sánh framework với liên kết, thẻ code và định dạng',
    html: `<table border="1">
  <tr>
    <th align="left">Framework</th>
    <th align="center">Renderer</th>
    <th align="center">Data Fetching</th>
    <th align="left">Trang chủ tài liệu</th>
  </tr>
  <tr>
    <td><strong>Next.js 15</strong></td>
    <td align="center">React Server Components</td>
    <td align="center">Server Actions & fetch cache</td>
    <td><a href="https://nextjs.org">nextjs.org</a></td>
  </tr>
  <tr>
    <td><strong>Remix / React Router 7</strong></td>
    <td align="center">SSR + Hydration</td>
    <td align="center">Loaders & Actions</td>
    <td><a href="https://remix.run">remix.run</a></td>
  </tr>
  <tr>
    <td><strong>Astro 5</strong></td>
    <td align="center">Islands Architecture</td>
    <td align="center">Static + Server Endpoints</td>
    <td><a href="https://astro.build">astro.build</a></td>
  </tr>
</table>`,
  },
  richArticle: {
    title: 'Bài viết HTML đa dạng có Bảng',
    description: 'Văn bản có tiêu đề, danh sách, trích dẫn và bảng dữ liệu',
    html: `<h2>Hướng dẫn xuất dữ liệu sang Markdown</h2>
<p>Markdown là định dạng chuẩn của <strong>GitHub</strong>, <em>GitLab</em>, Notion và tài liệu kỹ thuật.</p>
<blockquote>
  <p>Tính năng chuyển đổi này giúp bảo toàn 100% cấu trúc ô, căn lề và định dạng bảng khi sao chép từ Excel hoặc Web.</p>
</blockquote>
<h3>Các bước thực hiện nhanh:</h3>
<ul>
  <li>Mở bảng tính trong Excel hoặc Google Sheets</li>
  <li>Chọn vùng dữ liệu cần sao chép và bấm <code>Ctrl + C</code></li>
  <li>Dán trực tiếp (<code>Ctrl + V</code>) vào khung chuyển đổi</li>
</ul>
<table width="100%">
  <tr>
    <th align="left">Bước</th>
    <th align="left">Thao tác</th>
    <th align="center">Phím tắt</th>
  </tr>
  <tr>
    <td>1</td>
    <td>Sao chép bảng nguồn</td>
    <td align="center"><kbd>Ctrl+C</kbd></td>
  </tr>
  <tr>
    <td>2</td>
    <td>Dán vào trình chuyển đổi</td>
    <td align="center"><kbd>Ctrl+V</kbd></td>
  </tr>
  <tr>
    <td>3</td>
    <td>Lấy kết quả Markdown chuẩn</td>
    <td align="center"><kbd>1-Click Copy</kbd></td>
  </tr>
</table>`,
  },
};
