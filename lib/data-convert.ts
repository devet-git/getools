/**
 * Chuyển đổi dữ liệu dạng bảng: CSV / TSV / JSON / Bảng Markdown -> CSV, TSV, JSON, Markdown, HTML, SQL.
 * Logic thuần, không phụ thuộc React.
 */

export type InFormat = 'csv' | 'tsv' | 'json' | 'markdown';
export type OutFormat = 'csv' | 'tsv' | 'json' | 'markdown' | 'html' | 'sql';
export type Delimiter = ',' | ';' | '\t' | '|';
export type Align = 'left' | 'right' | 'center' | null;
export type Cell = string | number | boolean | null;

export const IN_FORMATS: InFormat[] = ['csv', 'tsv', 'json', 'markdown'];
export const OUT_FORMATS: OutFormat[] = ['csv', 'tsv', 'json', 'markdown', 'html', 'sql'];
export const DELIMITERS: Delimiter[] = [',', ';', '\t', '|'];

export interface ConvertOptions {
  /** Dòng đầu là tiêu đề */
  header: boolean;
  trim: boolean;
  ignoreEmpty: boolean;
  /** Dấu phân cách khi đọc CSV; 'auto' = tự nhận diện */
  delimiter: Delimiter | 'auto';
  /** Dấu phân cách khi xuất CSV */
  outDelimiter: Delimiter;
  /** Suy luận số / boolean / null khi xuất JSON, SQL */
  infer: boolean;
  /** Căn đều cột Markdown */
  pretty: boolean;
  tableName: string;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  header: true,
  trim: false,
  ignoreEmpty: true,
  delimiter: 'auto',
  outDelimiter: ',',
  infer: true,
  pretty: true,
  tableName: 'bang_du_lieu',
};

export interface Table {
  headers: string[];
  rows: Cell[][];
  /** Dữ liệu gốc có dòng tiêu đề thật (false: tiêu đề được đặt tự động col1, col2...) */
  hasHeader: boolean;
  align: Align[];
  warnings: string[];
  /** Dấu phân cách đã dùng (CSV) */
  delimiterUsed?: Delimiter;
}

export const MAX_INPUT_BYTES = 5 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Đọc CSV                                                             */
/* ------------------------------------------------------------------ */

/** Phân tích CSV theo RFC 4180 (hỗ trợ nháy kép, nháy kép escape, xuống dòng trong ô, BOM). */
export function parseCsv(input: string, delim: string, maxRows = Infinity): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStart = true; // đang ở đầu ô (chưa có ký tự nào)
  let afterQuote = false; // vừa đóng nháy kép
  const n = text.length;
  let i = 0;
  let pending = false; // có dữ liệu chưa đẩy vào row

  const endField = () => {
    row.push(field);
    field = '';
    fieldStart = true;
    afterQuote = false;
    pending = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    pending = false;
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        afterQuote = true;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      pending = true;
      i++;
      continue;
    }
    if (c === delim) {
      endField();
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
      i++;
      if (rows.length >= maxRows) return rows;
      continue;
    }
    // ký tự thường (kể cả nháy kép lạc giữa ô -> giữ nguyên)
    field += c;
    fieldStart = false;
    afterQuote = false;
    pending = true;
    i++;
  }
  void afterQuote;
  if (pending || field !== '' || row.length > 0) endRow();
  return rows;
}

/** Đoán dấu phân cách CSV dựa trên tính đồng đều số cột giữa các dòng đầu. */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ',';
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const rows = parseCsv(text, d, 30).filter((r) => !(r.length === 1 && r[0].trim() === ''));
    if (rows.length === 0) continue;
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    let modal = 0;
    let modalN = 0;
    for (const [cols, cnt] of counts) {
      if (cnt > modalN || (cnt === modalN && cols > modal)) {
        modal = cols;
        modalN = cnt;
      }
    }
    if (modal < 2) continue;
    const score = (modalN / rows.length) * 100 + Math.min(modal, 50) * 0.1;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Phát hiện định dạng                                                 */
/* ------------------------------------------------------------------ */

const MD_SEP_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function looksLikeMarkdownTable(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '').slice(0, 50);
  if (lines.length < 2) return false;
  if (!lines[0].includes('|')) return false;
  return lines.slice(1, 3).some((l) => l.includes('|') && MD_SEP_ROW.test(l));
}

export function detectFormat(text: string): InFormat {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  t = t.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      /* tiếp tục */
    }
  }
  if (looksLikeMarkdownTable(t)) return 'markdown';
  const lines = t.split(/\r\n|\r|\n/).slice(0, 20).filter((l) => l.trim() !== '');
  if (lines.length > 0) {
    const tabs = lines.filter((l) => l.includes('\t')).length;
    const commas = lines.filter((l) => l.includes(',')).length;
    if (tabs >= Math.ceil(lines.length / 2) && tabs >= commas) return 'tsv';
  }
  return 'csv';
}

/* ------------------------------------------------------------------ */
/* Dựng bảng chuẩn                                                     */
/* ------------------------------------------------------------------ */

function cellToDisplay(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'bigint') return v.toString();
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return String(v);
  }
}

export function cellToString(v: Cell): string {
  if (v === null) return '';
  return typeof v === 'string' ? v : String(v);
}

function isEmptyCell(v: Cell): boolean {
  return v === null || (typeof v === 'string' && v.trim() === '');
}

/** Chuẩn hóa tiêu đề: rỗng -> colN, trùng -> name_2, name_3... */
function normalizeHeaders(raw: string[], warnings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let emptyCount = 0;
  let dupCount = 0;
  raw.forEach((h, i) => {
    let name = h;
    if (name.trim() === '') {
      name = `col${i + 1}`;
      emptyCount++;
    }
    if (seen.has(name)) {
      let k = 2;
      while (seen.has(`${name}_${k}`)) k++;
      name = `${name}_${k}`;
      dupCount++;
    }
    seen.add(name);
    out.push(name);
  });
  if (emptyCount) warnings.push(`${emptyCount} tiêu đề cột trống đã được đặt tên tự động (colN).`);
  if (dupCount) warnings.push(`${dupCount} tiêu đề cột bị trùng đã được thêm hậu tố _2, _3...`);
  return out;
}

function buildFromMatrix(
  matrix: Cell[][],
  useHeader: boolean,
  opts: ConvertOptions,
  align: Align[] = []
): Table {
  const warnings: string[] = [];
  let data = matrix.map((r) =>
    opts.trim ? r.map((c) => (typeof c === 'string' ? c.trim() : c)) : r
  );
  if (opts.ignoreEmpty) {
    const before = data.length;
    data = data.filter((r) => !r.every(isEmptyCell));
    void before;
  }
  let headerRow: string[] = [];
  let hasHeader = false;
  if (useHeader && data.length > 0) {
    headerRow = data[0].map(cellToString);
    data = data.slice(1);
    hasHeader = true;
  }
  let width = headerRow.length;
  for (const r of data) if (r.length > width) width = r.length;
  let ragged = 0;
  const rows: Cell[][] = data.map((r) => {
    if (r.length !== width) {
      if (hasHeader || r.length < width) ragged++;
    }
    if (r.length === width) return r;
    const copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
  if (ragged) warnings.push(`${ragged} dòng có số cột khác với tiêu đề, đã được bù ô trống.`);
  if (headerRow.length < width) {
    if (hasHeader && headerRow.length > 0 && data.some((r) => r.length > headerRow.length)) {
      warnings.push('Có dòng dài hơn tiêu đề, các cột thừa được đặt tên tự động.');
    }
    while (headerRow.length < width) headerRow.push('');
  }
  const headers = hasHeader
    ? normalizeHeaders(headerRow, warnings)
    : Array.from({ length: width }, (_, i) => `col${i + 1}`);
  const al: Align[] = Array.from({ length: width }, (_, i) => align[i] ?? null);
  return { headers, rows, hasHeader, align: al, warnings };
}

function parseJsonTable(text: string, opts: ConvertOptions): Table {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  let data: unknown;
  try {
    data = JSON.parse(t);
  } catch (e) {
    throw new Error(`JSON không hợp lệ: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (data === null || typeof data !== 'object') {
    throw new Error('JSON phải là một mảng (các đối tượng hoặc các mảng) hoặc một đối tượng.');
  }
  const arr: unknown[] = Array.isArray(data) ? data : [data];
  const warnings: string[] = [];
  const isObj = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);

  if (arr.length > 0 && arr.every(Array.isArray)) {
    const matrix = (arr as unknown[][]).map((r) => r.map(cellToDisplay));
    return buildFromMatrix(matrix, opts.header, opts);
  }

  // Mảng các đối tượng (hoặc hỗn hợp)
  const keys: string[] = [];
  const keySet = new Set<string>();
  let hasPrimitive = false;
  for (const item of arr) {
    if (isObj(item)) {
      for (const k of Object.keys(item as object)) {
        if (!keySet.has(k)) {
          keySet.add(k);
          keys.push(k);
        }
      }
    } else {
      hasPrimitive = true;
    }
  }
  if (hasPrimitive) {
    if (!keySet.has('value')) {
      keySet.add('value');
      keys.push('value');
    }
    warnings.push('Có phần tử không phải đối tượng, giá trị được đưa vào cột "value".');
  }
  let rowsOut: Cell[][] = arr.map((item) => {
    if (isObj(item)) {
      const o = item as Record<string, unknown>;
      return keys.map((k) => (k in o ? cellToDisplay(o[k]) : null));
    }
    return keys.map((k) => (k === 'value' ? cellToDisplay(item) : null));
  });
  if (opts.trim) rowsOut = rowsOut.map((r) => r.map((c) => (typeof c === 'string' ? c.trim() : c)));
  if (opts.ignoreEmpty) rowsOut = rowsOut.filter((r) => !r.every(isEmptyCell));
  const nested = arr.some(
    (item) => isObj(item) && Object.values(item as object).some((v) => v !== null && typeof v === 'object')
  );
  if (nested) warnings.push('Giá trị lồng nhau (đối tượng/mảng) được chuyển thành chuỗi JSON.');
  const headers = normalizeHeaders(keys, warnings);
  return { headers, rows: rowsOut, hasHeader: true, align: headers.map(() => null), warnings };
}

/** Tách một dòng bảng Markdown thành các ô (bỏ qua | đã escape). */
function splitMarkdownRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '`') {
      inCode = !inCode;
      cur += c;
    } else if (c === '|' && !inCode) {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  // Ô cuối: nếu dòng kết thúc bằng | thì cur rỗng và không phải ô thật
  if (!(cur.trim() === '' && /(^|[^\\])\|\s*$/.test(line))) cells.push(cur);
  return cells.map((c) => c.trim().replace(/<br\s*\/?>/gi, '\n'));
}

function parseMarkdownTable(text: string, opts: ConvertOptions): Table {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== '' && l.includes('|'));
  if (lines.length === 0) throw new Error('Không tìm thấy bảng Markdown (cần các dòng chứa dấu |).');
  const matrix: Cell[][] = [];
  let align: Align[] = [];
  let sawSeparator = false;
  lines.forEach((line, idx) => {
    if (idx === 1 && MD_SEP_ROW.test(line)) {
      sawSeparator = true;
      align = splitMarkdownRow(line).map((c) => {
        const l = c.startsWith(':');
        const r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
      });
      return;
    }
    matrix.push(splitMarkdownRow(line));
  });
  return buildFromMatrix(matrix, sawSeparator ? true : opts.header, opts, align);
}

/** Đọc văn bản đầu vào thành bảng chuẩn. Ném Error (tiếng Việt) nếu không đọc được. */
export function parseTable(text: string, format: InFormat, opts: ConvertOptions): Table {
  if (text.trim() === '') return { headers: [], rows: [], hasHeader: false, align: [], warnings: [] };
  if (format === 'json') return parseJsonTable(text, opts);
  if (format === 'markdown') return parseMarkdownTable(text, opts);
  const delim: Delimiter =
    format === 'tsv' ? '\t' : opts.delimiter === 'auto' ? detectDelimiter(text) : opts.delimiter;
  const matrix = parseCsv(text, delim);
  const table = buildFromMatrix(matrix, opts.header, opts);
  table.delimiterUsed = delim;
  return table;
}

/* ------------------------------------------------------------------ */
/* Suy luận kiểu                                                       */
/* ------------------------------------------------------------------ */

const NUM_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** Chuỗi -> number / boolean / null nếu có thể; giữ nguyên nếu không chắc (vd "007", số quá lớn). */
export function inferValue(v: Cell): Cell {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (s === '' || s === 'null' || s === 'NULL') return null;
  if (s === 'true' || s === 'TRUE' || s === 'True') return true;
  if (s === 'false' || s === 'FALSE' || s === 'False') return false;
  if (NUM_RE.test(s)) {
    const num = Number(s);
    if (!Number.isFinite(num)) return v;
    if (/^-?\d+$/.test(s) && !Number.isSafeInteger(num)) return v;
    if (s === '-0') return v;
    return num;
  }
  return v;
}

function typed(v: Cell, infer: boolean): Cell {
  return infer ? inferValue(v) : v;
}

/* ------------------------------------------------------------------ */
/* Xuất                                                                */
/* ------------------------------------------------------------------ */

function csvField(s: string, delim: string): string {
  if (s === '') return '';
  if (s.includes('"') || s.includes(delim) || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toDelimited(table: Table, delim: string, withHeader: boolean): string {
  const lines: string[] = [];
  if (withHeader) lines.push(table.headers.map((h) => csvField(h, delim)).join(delim));
  for (const r of table.rows) lines.push(r.map((c) => csvField(cellToString(c), delim)).join(delim));
  return lines.join('\n');
}

export function toJson(table: Table, infer: boolean): string {
  if (table.hasHeader || table.headers.length === 0) {
    const objs = table.rows.map((r) => {
      const o: Record<string, Cell> = {};
      table.headers.forEach((h, i) => {
        o[h] = typed(r[i] ?? null, infer);
      });
      return o;
    });
    return JSON.stringify(objs, null, 2);
  }
  return JSON.stringify(
    table.rows.map((r) => r.map((c) => typed(c, infer))),
    null,
    2
  );
}

function mdEscape(s: string): string {
  return s.replace(/\\(?=\|)/g, '\\\\').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');
}

function strWidth(s: string): number {
  // Đếm theo điểm mã; ký tự CJK/emoji rộng ~2 cột
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x300 && cp <= 0x36f) continue; // dấu kết hợp
    w += (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x1f300
      ? 2
      : 1;
  }
  return w;
}

function isNumericCol(table: Table, i: number): boolean {
  let any = false;
  for (const r of table.rows) {
    const c = r[i];
    if (c === null || c === '') continue;
    if (typeof c === 'number') {
      any = true;
      continue;
    }
    if (typeof c === 'string' && NUM_RE.test(c.trim())) {
      any = true;
      continue;
    }
    return false;
  }
  return any;
}

export function toMarkdown(table: Table, pretty: boolean): string {
  const cols = table.headers.length;
  if (cols === 0) return '';
  const aligns: Align[] = table.headers.map((_, i) => table.align[i] ?? (isNumericCol(table, i) ? 'right' : null));
  const head = table.headers.map(mdEscape);
  const body = table.rows.map((r) => table.headers.map((_, i) => mdEscape(cellToString(r[i] ?? null))));
  const widths = table.headers.map((_, i) => {
    if (!pretty) return 3;
    let w = Math.max(3, strWidth(head[i]));
    for (const r of body) w = Math.max(w, strWidth(r[i]));
    return w;
  });
  const pad = (s: string, w: number, a: Align) => {
    if (!pretty) return s;
    const gap = w - strWidth(s);
    if (gap <= 0) return s;
    if (a === 'right') return ' '.repeat(gap) + s;
    if (a === 'center') {
      const l = Math.floor(gap / 2);
      return ' '.repeat(l) + s + ' '.repeat(gap - l);
    }
    return s + ' '.repeat(gap);
  };
  const line = (cells: string[]) => `| ${cells.map((c, i) => pad(c, widths[i], aligns[i])).join(' | ')} |`;
  const sep = aligns.map((a, i) => {
    const w = widths[i];
    if (a === 'center') return ':' + '-'.repeat(w - 2) + ':';
    if (a === 'right') return '-'.repeat(w - 1) + ':';
    if (a === 'left') return ':' + '-'.repeat(w - 1);
    return '-'.repeat(w);
  });
  return [line(head), `| ${sep.join(' | ')} |`, ...body.map(line)].join('\n');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function toHtml(table: Table): string {
  const lines: string[] = ['<table>'];
  lines.push('  <thead>', '    <tr>');
  for (const h of table.headers) lines.push(`      <th>${escapeHtml(h)}</th>`);
  lines.push('    </tr>', '  </thead>', '  <tbody>');
  for (const r of table.rows) {
    lines.push('    <tr>');
    table.headers.forEach((_, i) => {
      const a = table.align[i];
      const attr = a ? ` style="text-align: ${a}"` : '';
      lines.push(`      <td${attr}>${escapeHtml(cellToString(r[i] ?? null)).replace(/\r\n|\r|\n/g, '<br>')}</td>`);
    });
    lines.push('    </tr>');
  }
  lines.push('  </tbody>', '</table>');
  return lines.join('\n');
}

export function sqlIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlValue(v: Cell, infer: boolean): string {
  const t = typed(v, infer);
  if (t === null) return 'NULL';
  if (typeof t === 'number') return String(t);
  if (typeof t === 'boolean') return t ? 'TRUE' : 'FALSE';
  return sqlString(t);
}

export function toSql(table: Table, tableName: string, infer: boolean): string {
  if (table.headers.length === 0) return '';
  const name =
    (tableName.trim() || 'bang_du_lieu')
      .split('.')
      .map((p) => sqlIdent(p.trim() || 'bang_du_lieu'))
      .join('.');
  const cols = table.headers.map(sqlIdent).join(', ');
  if (table.rows.length === 0) return `-- Không có dòng dữ liệu để chèn vào ${name}`;
  const CHUNK = 500;
  const stmts: string[] = [];
  for (let s = 0; s < table.rows.length; s += CHUNK) {
    const vals = table.rows
      .slice(s, s + CHUNK)
      .map((r) => `  (${table.headers.map((_, i) => sqlValue(r[i] ?? null, infer)).join(', ')})`);
    stmts.push(`INSERT INTO ${name} (${cols}) VALUES\n${vals.join(',\n')};`);
  }
  return stmts.join('\n\n');
}

export function formatTable(table: Table, format: OutFormat, opts: ConvertOptions): string {
  if (table.headers.length === 0) return '';
  switch (format) {
    case 'csv':
      return toDelimited(table, opts.outDelimiter, table.hasHeader);
    case 'tsv':
      return toDelimited(table, '\t', table.hasHeader);
    case 'json':
      return toJson(table, opts.infer);
    case 'markdown':
      return toMarkdown(table, opts.pretty);
    case 'html':
      return toHtml(table);
    case 'sql':
      return toSql(table, opts.tableName, opts.infer);
  }
}

export const OUT_EXT: Record<OutFormat, { ext: string; mime: string }> = {
  csv: { ext: 'csv', mime: 'text/csv' },
  tsv: { ext: 'tsv', mime: 'text/tab-separated-values' },
  json: { ext: 'json', mime: 'application/json' },
  markdown: { ext: 'md', mime: 'text/markdown' },
  html: { ext: 'html', mime: 'text/html' },
  sql: { ext: 'sql', mime: 'application/sql' },
};
