// Tiện ích thuần cho bộ chuyển đổi: nhận diện phần mở rộng, đặt tên file đầu ra, đọc văn bản an toàn.
import { escapeHtml } from '@/lib/data-convert';
import { baseName, formatBytes, sanitizeFileName, stripExt } from '@/lib/file-tools';
import { DEFAULT_OPTIONS, type ConvertOptions } from './types';

/** Giới hạn chung cho mỗi file đầu vào. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** File văn bản (JSON/CSV/YAML/HTML…) lớn hơn mức này dễ làm treo tab khi parse. */
export const MAX_TEXT_BYTES = 50 * 1024 * 1024;

/** Đoán phần mở rộng khi tên file không có đuôi (vd. ảnh dán từ clipboard). */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/json': 'json',
  'application/yaml': 'yaml',
  'text/yaml': 'yaml',
  'text/markdown': 'md',
  'text/html': 'html',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/webm': 'webm',
};

/** Đồng nghĩa: gom về một tên để so khớp converter. */
const EXT_ALIAS: Record<string, string> = { jpeg: 'jpg', jpe: 'jpg', yml: 'yaml', markdown: 'md', htm: 'html', heif: 'heic', tif: 'tiff' };

export function normalizeExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  return EXT_ALIAS[e] ?? e;
}

/** Phần mở rộng (đã chuẩn hoá) của file; dựa vào tên trước, MIME sau. */
export function extOf(file: { name: string; type?: string }): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(file.name);
  if (m) return normalizeExt(m[1]);
  return file.type ? MIME_EXT[file.type.toLowerCase()] ?? '' : '';
}

/** Tên gốc an toàn (không đường dẫn, không đuôi). */
export function safeBase(fileName: string): string {
  return sanitizeFileName(stripExt(baseName(fileName)), 'file').slice(0, 150);
}

/** Tên đầu ra: giữ tên gốc, đổi đuôi; `suffix` dùng khi một file sinh nhiều kết quả (trang, sheet). */
export function outName(fileName: string, ext: string, suffix?: string): string {
  const s = suffix ? sanitizeFileName(suffix, '').slice(0, 80) : '';
  return `${safeBase(fileName)}${s ? `-${s}` : ''}.${ext}`;
}

/** Trùng tên trong cùng một ZIP: thêm " (2)", " (3)"… trước đuôi. */
export function dedupeNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    let name = n;
    let k = 2;
    const dot = n.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [n.slice(0, dot), n.slice(dot)] : [n, ''];
    while (used.has(name.toLowerCase())) name = `${stem} (${k++})${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function withDefaults(opts?: Partial<ConvertOptions>): ConvertOptions {
  const q = Number(opts?.quality);
  const d = Number(opts?.dpi);
  return {
    quality: Number.isFinite(q) ? Math.min(1, Math.max(0.1, q)) : DEFAULT_OPTIONS.quality,
    dpi: Number.isFinite(d) ? Math.min(600, Math.max(36, d)) : DEFAULT_OPTIONS.dpi,
  };
}

/** Đọc file văn bản UTF-8, bỏ BOM; chặn file quá lớn trước khi đưa vào parser. */
export async function readText(file: File): Promise<string> {
  if (file.size > MAX_TEXT_BYTES) throw new Error(`File văn bản quá lớn (tối đa ${formatBytes(MAX_TEXT_BYTES)}).`);
  const text = await file.text();
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function textBlob(text: string, mime: string): Blob {
  return new Blob([text], { type: `${mime};charset=utf-8` });
}

export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Lỗi giải nén của thư viện đọc DOCX/XLSX: file không phải zip hợp lệ
  if (/central directory|zip file|end of data|Corrupted zip|is this a zip/i.test(msg)) {
    return 'File không đúng định dạng hoặc bị hỏng (không giải nén được).';
  }
  return msg || 'Lỗi không xác định.';
}

const DOC_CSS = `body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;max-width:820px;margin:2rem auto;padding:0 1rem;color:#1e293b}
img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px;vertical-align:top}`;

/** Bọc phần thân HTML thành tài liệu độc lập (UTF-8, CSS gọn, không script). */
export function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${DOC_CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

