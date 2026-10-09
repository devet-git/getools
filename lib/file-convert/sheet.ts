// Bảng tính XLSX ⇄ CSV / JSON / HTML bằng exceljs (nạp động). Không dùng SheetJS vì bản npm còn lỗ hổng chưa vá.
import type { Workbook, Worksheet, CellValue } from 'exceljs';
import { DEFAULT_OPTIONS as TABLE_OPTS, escapeHtml, inferValue, parseTable, toDelimited, type Cell, type Table } from '@/lib/data-convert';
import type { ConvertOutput } from './types';
import { extOf, outName, readText, safeBase, textBlob, wrapHtml } from './util';

/** Chặn bảng tính khổng lồ (thường là file nén cực mạnh) làm treo tab. */
export const MAX_SHEET_CELLS = 5_000_000;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function newWorkbook(): Promise<Workbook> {
  const mod = (await import('exceljs')) as typeof import('exceljs') & { default?: typeof import('exceljs') };
  // Bản build trình duyệt là UMD: lớp Workbook có thể nằm dưới `default`
  const Excel = mod.default ?? mod;
  return new Excel.Workbook();
}

/** Ngày không có giờ → YYYY-MM-DD, có giờ → ISO đầy đủ. exceljs lưu ngày theo UTC. */
function dateText(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('.000Z', 'Z');
}

/** Giá trị ô exceljs → giá trị JSON đơn giản (công thức lấy kết quả đã tính, rich text ghép chữ). */
export function cellPlain(v: CellValue | undefined): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return dateText(v);
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('');
    if ('result' in o) return o.result === undefined ? null : cellPlain(o.result as CellValue);
    if ('formula' in o || 'sharedFormula' in o) return null; // công thức chưa có kết quả lưu sẵn
    if (typeof o.text === 'string') return o.text; // hyperlink
    if (typeof o.error === 'string') return o.error;
  }
  return String(v);
}

/** Đọc một sheet thành ma trận giá trị (bỏ hàng trống ở cuối). */
function sheetMatrix(ws: Worksheet): Cell[][] {
  const rows = ws.actualRowCount ? ws.rowCount : 0;
  const cols = ws.columnCount;
  if (rows * cols > MAX_SHEET_CELLS) throw new Error(`Sheet "${ws.name}" quá lớn (${rows}×${cols} ô).`);
  const out: Cell[][] = [];
  for (let r = 1; r <= rows; r++) {
    const row = ws.getRow(r);
    const line: Cell[] = [];
    for (let c = 1; c <= cols; c++) line.push(cellPlain(row.getCell(c).value));
    out.push(line);
  }
  const empty = (r: Cell[]) => r.every((c) => c === null || c === '');
  while (out.length && empty(out[out.length - 1])) out.pop();
  // Hàng trống phía trên bảng: bỏ để hàng đầu tiên có dữ liệu làm tiêu đề
  while (out.length && empty(out[0])) out.shift();
  return out;
}

async function loadXlsx(file: File): Promise<{ name: string; matrix: Cell[][] }[]> {
  const wb = await newWorkbook();
  try {
    await wb.xlsx.load((await file.arrayBuffer()) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new Error('Không đọc được file XLSX (file hỏng, có mật khẩu hoặc không phải định dạng Excel 2007+).');
  }
  const sheets = wb.worksheets.map((ws) => ({ name: ws.name, matrix: sheetMatrix(ws) }));
  if (sheets.length === 0) throw new Error('File XLSX không có sheet nào.');
  return sheets;
}

/** Dựng bảng (tiêu đề = hàng đầu) bằng cùng logic với tool chuyển dữ liệu: tên cột trống/trùng được đặt lại. */
function matrixTable(matrix: Cell[][]): Table {
  const csv = matrix.map((r) => r.map((c) => (c === null ? '' : String(c))));
  // Đi qua CSV để tái sử dụng normalize tiêu đề + bù ô của parseTable
  const text = csv.map((r) => r.map((c) => (/[",\n\r]/.test(c) || /^\s|\s$/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  return parseTable(text, 'csv', { ...TABLE_OPTS, delimiter: ',' });
}

function sheetSuffix(sheets: unknown[], name: string): string | undefined {
  return sheets.length > 1 ? name : undefined;
}

export async function xlsxToCsv(file: File): Promise<ConvertOutput[]> {
  const sheets = await loadXlsx(file);
  return sheets.map((s) => {
    const csv = s.matrix.length ? toDelimited(matrixTable(s.matrix), ',', true) + '\n' : '';
    // BOM giúp Excel mở CSV UTF-8 hiển thị đúng tiếng Việt
    return { blob: textBlob('﻿' + csv, 'text/csv'), name: outName(file.name, 'csv', sheetSuffix(sheets, s.name)) };
  });
}

export async function xlsxToJson(file: File): Promise<ConvertOutput[]> {
  const sheets = await loadXlsx(file);
  return sheets.map((s) => {
    const t = s.matrix.length ? matrixTable(s.matrix) : null;
    // Số/boolean trong ô giữ nguyên kiểu; chuỗi giữ nguyên (không đoán kiểu để tránh mất số 0 đầu)
    const rows = t ? s.matrix.slice(1).filter((r) => r.some((c) => c !== null && c !== '')).map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i] ?? null]))) : [];
    return { blob: textBlob(JSON.stringify(rows, null, 2) + '\n', 'application/json'), name: outName(file.name, 'json', sheetSuffix(sheets, s.name)) };
  });
}

export async function xlsxToHtml(file: File): Promise<ConvertOutput[]> {
  const sheets = await loadXlsx(file);
  const body = sheets
    .map((s) => {
      const rows = s.matrix
        .map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${escapeHtml(c === null ? '' : String(c))}</th>` : `<td>${escapeHtml(c === null ? '' : String(c))}</td>`)).join('')}</tr>`)
        .join('\n');
      return `<h2>${escapeHtml(s.name)}</h2>\n<table>\n${rows}\n</table>`;
    })
    .join('\n');
  return [{ blob: textBlob(wrapHtml(safeBase(file.name), body), 'text/html'), name: outName(file.name, 'html') }];
}

/** CSV / TSV / JSON (mảng đối tượng) → XLSX một sheet, hàng tiêu đề in đậm. */
export async function tableToXlsx(file: File): Promise<ConvertOutput[]> {
  const ext = extOf(file);
  const text = await readText(file);
  if (!text.trim()) throw new Error('File trống.');
  const format = ext === 'json' ? 'json' : ext === 'tsv' ? 'tsv' : 'csv';
  const table = parseTable(text, format, TABLE_OPTS);
  if (table.headers.length === 0) throw new Error('Không có dữ liệu dạng bảng.');
  if (table.headers.length * (table.rows.length + 1) > MAX_SHEET_CELLS) throw new Error('Dữ liệu quá lớn để tạo XLSX.');
  const wb = await newWorkbook();
  const ws = wb.addWorksheet(safeBase(file.name).replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet1');
  ws.addRow(table.headers).font = { bold: true };
  // Chuỗi số trong CSV được đổi sang số để Excel tính toán được; "007" giữ là chữ
  for (const r of table.rows) ws.addRow(r.map((c) => (format === 'json' ? c : inferValue(c))));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  return [{ blob: new Blob([buf as BlobPart], { type: XLSX_MIME }), name: outName(file.name, 'xlsx') }];
}
