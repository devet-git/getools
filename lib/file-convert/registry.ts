// Danh sách converter. Thêm định dạng mới = thêm một object vào CONVERTERS.
// Thư viện nặng (pdf.js, mammoth, exceljs, yaml, turndown…) chỉ được nạp động bên trong convert().
import { formatBytes } from '@/lib/file-tools';
import { DEFAULT_OPTIONS, type ConvertGroup, type ConvertOptions, type ConvertOutput, type Converter } from './types';
import { errorMessage, extOf, MAX_FILE_BYTES, withDefaults } from './util';

const IMAGE_IN = ['png', 'jpg', 'webp', 'gif', 'bmp', 'svg', 'avif', 'heic', 'ico'];
const AUDIO_IN = ['mp3', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm'];

const text = (to: string, mime: string, fn: keyof typeof import('./data').textFns) =>
  async (file: File) => {
    const m = await import('./data');
    return m.convertText(file, to, mime, m.textFns[fn]);
  };

export const CONVERTERS: Converter[] = [
  // Ảnh
  { id: 'img-png', label: 'PNG', from: IMAGE_IN, to: 'png', group: 'image', convert: async (f, o) => (await import('./image')).imageToRaster(f, 'png', withDefaults(o)) },
  { id: 'img-jpg', label: 'JPG', from: IMAGE_IN, to: 'jpg', group: 'image', options: ['quality'], convert: async (f, o) => (await import('./image')).imageToRaster(f, 'jpg', withDefaults(o)) },
  { id: 'img-webp', label: 'WebP', from: IMAGE_IN, to: 'webp', group: 'image', options: ['quality'], convert: async (f, o) => (await import('./image')).imageToRaster(f, 'webp', withDefaults(o)) },
  { id: 'img-ico', label: 'ICO (favicon ≤ 256px)', from: IMAGE_IN, to: 'ico', group: 'image', convert: async (f) => (await import('./image')).imageToIco(f) },
  { id: 'img-pdf', label: 'PDF', from: IMAGE_IN, to: 'pdf', group: 'image', convert: async (f) => (await import('./image')).imageToPdf(f) },

  // Tài liệu
  { id: 'pdf-png', label: 'PNG (mỗi trang một ảnh)', from: ['pdf'], to: 'png', group: 'document', options: ['dpi'], convert: async (f, o) => (await import('./pdf')).pdfToImages(f, 'png', withDefaults(o)) },
  { id: 'pdf-jpg', label: 'JPG (mỗi trang một ảnh)', from: ['pdf'], to: 'jpg', group: 'document', options: ['dpi', 'quality'], convert: async (f, o) => (await import('./pdf')).pdfToImages(f, 'jpg', withDefaults(o)) },
  { id: 'pdf-txt', label: 'TXT (văn bản)', from: ['pdf'], to: 'txt', group: 'document', convert: async (f) => (await import('./pdf')).pdfToText(f) },
  { id: 'docx-html', label: 'HTML', from: ['docx'], to: 'html', group: 'document', maxBytes: 50 * 1024 * 1024, convert: async (f) => (await import('./docx')).docxToHtml(f) },
  { id: 'docx-md', label: 'Markdown', from: ['docx'], to: 'md', group: 'document', maxBytes: 50 * 1024 * 1024, convert: async (f) => (await import('./docx')).docxToMarkdown(f) },
  { id: 'docx-txt', label: 'TXT (văn bản)', from: ['docx'], to: 'txt', group: 'document', maxBytes: 50 * 1024 * 1024, convert: async (f) => (await import('./docx')).docxToText(f) },

  // Bảng tính
  { id: 'xlsx-csv', label: 'CSV (mỗi sheet một file)', from: ['xlsx'], to: 'csv', group: 'spreadsheet', maxBytes: 50 * 1024 * 1024, convert: async (f) => (await import('./sheet')).xlsxToCsv(f) },
  { id: 'xlsx-json', label: 'JSON (mỗi sheet một file)', from: ['xlsx'], to: 'json', group: 'spreadsheet', maxBytes: 50 * 1024 * 1024, convert: async (f) => (await import('./sheet')).xlsxToJson(f) },
  { id: 'xlsx-html', label: 'HTML (bảng)', from: ['xlsx'], to: 'html', group: 'spreadsheet', maxBytes: 50 * 1024 * 1024, convert: async (f) => (await import('./sheet')).xlsxToHtml(f) },
  { id: 'table-xlsx', label: 'XLSX (Excel)', from: ['csv', 'tsv', 'json'], to: 'xlsx', group: 'spreadsheet', convert: async (f) => (await import('./sheet')).tableToXlsx(f) },

  // Dữ liệu & văn bản
  { id: 'json-yaml', label: 'YAML', from: ['json'], to: 'yaml', group: 'data', convert: text('yaml', 'application/yaml', 'jsonToYaml') },
  { id: 'json-csv', label: 'CSV', from: ['json'], to: 'csv', group: 'data', convert: text('csv', 'text/csv', 'jsonToCsv') },
  { id: 'yaml-json', label: 'JSON', from: ['yaml'], to: 'json', group: 'data', convert: text('json', 'application/json', 'yamlToJson') },
  { id: 'csv-json', label: 'JSON', from: ['csv', 'tsv'], to: 'json', group: 'data', convert: text('json', 'application/json', 'csvToJson') },
  { id: 'md-html', label: 'HTML', from: ['md'], to: 'html', group: 'data', convert: text('html', 'text/html', 'markdownToHtml') },
  { id: 'html-md', label: 'Markdown', from: ['html'], to: 'md', group: 'data', convert: text('md', 'text/markdown', 'htmlToMarkdown') },

  // Âm thanh
  { id: 'audio-wav', label: 'WAV (PCM 16-bit)', from: AUDIO_IN, to: 'wav', group: 'audio', convert: async (f) => (await import('./audio')).audioToWav(f) },
];

export const GROUP_LABEL: Record<ConvertGroup, string> = {
  image: 'Ảnh',
  document: 'Tài liệu',
  spreadsheet: 'Bảng tính',
  data: 'Dữ liệu & văn bản',
  audio: 'Âm thanh',
};

/** Định dạng hay gặp nhưng chưa hỗ trợ: báo lý do cụ thể thay vì "không nhận ra". */
const UNSUPPORTED: Record<string, string> = {
  xls: 'File Excel cũ (.xls) chưa được hỗ trợ. Hãy mở bằng Excel/Google Sheets và lưu lại dạng .xlsx.',
  ods: 'File OpenDocument (.ods) chưa được hỗ trợ. Hãy lưu lại dạng .xlsx rồi chuyển.',
  doc: 'File Word cũ (.doc) chưa được hỗ trợ. Hãy lưu lại dạng .docx rồi chuyển.',
  odt: 'File OpenDocument (.odt) chưa được hỗ trợ. Hãy lưu lại dạng .docx rồi chuyển.',
  ppt: 'Chưa hỗ trợ chuyển file PowerPoint.',
  pptx: 'Chưa hỗ trợ chuyển file PowerPoint.',
  tiff: 'Ảnh TIFF chưa được hỗ trợ (đa số trình duyệt không đọc được).',
  mp4: 'Chưa hỗ trợ file video. Riêng âm thanh WebM có thể chuyển sang WAV.',
  mov: 'Chưa hỗ trợ file video.',
  wav: 'File đã ở dạng WAV, không cần chuyển.',
};

/** Các converter áp dụng cho file (bỏ chuyển sang chính định dạng gốc). */
export function convertersFor(file: { name: string; type?: string }): Converter[] {
  const ext = extOf(file);
  if (!ext) return [];
  return CONVERTERS.filter((c) => c.from.includes(ext) && c.to !== ext);
}

/** Lý do không chuyển được file (null nếu có ít nhất một đích hợp lệ). */
export function unsupportedReason(file: { name: string; type?: string; size: number }): string | null {
  if (file.size > MAX_FILE_BYTES) return `File quá lớn (${formatBytes(file.size)}), tối đa ${formatBytes(MAX_FILE_BYTES)}.`;
  if (file.size === 0) return 'File rỗng (0 byte).';
  const ext = extOf(file);
  if (UNSUPPORTED[ext]) return UNSUPPORTED[ext];
  if (convertersFor(file).length === 0) return ext ? `Chưa hỗ trợ chuyển file .${ext}.` : 'Không nhận ra định dạng file (thiếu phần mở rộng).';
  return null;
}

/** Nhãn loại file hiển thị trong danh sách. */
export function kindLabel(file: { name: string; type?: string }): string {
  const ext = extOf(file);
  const c = CONVERTERS.find((x) => x.from.includes(ext));
  if (!c) return ext ? ext.toUpperCase() : '?';
  const g = c.group === 'data' || c.group === 'spreadsheet' ? '' : `${GROUP_LABEL[c.group]} `;
  return `${g}${ext.toUpperCase()}`;
}

/** Chạy một converter có kiểm tra kích thước và chuẩn hoá thông báo lỗi. */
export async function runConverter(conv: Converter, file: File, opts?: Partial<ConvertOptions>): Promise<ConvertOutput[]> {
  const reason = unsupportedReason(file);
  if (reason) throw new Error(reason);
  if (conv.maxBytes && file.size > conv.maxBytes) throw new Error(`File quá lớn cho kiểu chuyển này (tối đa ${formatBytes(conv.maxBytes)}).`);
  try {
    const out = await conv.convert(file, { ...DEFAULT_OPTIONS, ...opts });
    if (out.length === 0) throw new Error('Không tạo được file kết quả nào.');
    return out;
  } catch (e) {
    throw new Error(errorMessage(e));
  }
}

export interface SupportRow { from: string[]; to: string[] }

/** Bảng định dạng hỗ trợ, nhóm theo loại, sinh từ CONVERTERS để luôn khớp với code. */
export function supportSummary(): { group: ConvertGroup; label: string; rows: SupportRow[] }[] {
  const groups = new Map<ConvertGroup, Map<string, SupportRow>>();
  for (const c of CONVERTERS) {
    const rows = groups.get(c.group) ?? new Map<string, SupportRow>();
    groups.set(c.group, rows);
    const key = c.from.join(',');
    const row = rows.get(key) ?? { from: c.from, to: [] };
    rows.set(key, row);
    if (!row.to.includes(c.to)) row.to.push(c.to);
  }
  return [...groups].map(([group, rows]) => ({ group, label: GROUP_LABEL[group], rows: [...rows.values()] }));
}

/** Giá trị `accept` cho ô chọn file. */
export const ACCEPT = [...new Set(CONVERTERS.flatMap((c) => c.from))]
  .flatMap((e) => (e === 'jpg' ? ['.jpg', '.jpeg'] : e === 'yaml' ? ['.yaml', '.yml'] : e === 'md' ? ['.md', '.markdown'] : e === 'html' ? ['.html', '.htm'] : e === 'heic' ? ['.heic', '.heif'] : [`.${e}`]))
  .join(',');
