// Chuyển dữ liệu văn bản: JSON ⇄ YAML, JSON ⇄ CSV, Markdown ⇄ HTML. Dùng lại parser sẵn có của các tool khác.
import { DEFAULT_OPTIONS as TABLE_OPTS, parseTable, toDelimited, toJson, type InFormat } from '@/lib/data-convert';
import { parseJson, parseYaml, toYamlString, type ParseError } from '@/lib/json-yaml';
import { convertToMarkdown } from '@/lib/markdown-converter';
import type { ConvertOutput } from './types';
import { outName, readText, safeBase, textBlob } from './util';

function describe(kind: string, err: ParseError): string {
  const pos = err.line ? ` (dòng ${err.line}${err.col ? `, cột ${err.col}` : ''})` : '';
  return `${kind} không hợp lệ: ${err.message}${pos}`;
}

function parseJsonOrThrow(text: string): unknown {
  if (!text.trim()) throw new Error('File JSON trống.');
  const r = parseJson(text);
  if (!r.ok) throw new Error(describe('JSON', r.error));
  return r.value;
}

export function jsonToYaml(text: string): string {
  return toYamlString(parseJsonOrThrow(text), 2);
}

export function yamlToJson(text: string): string {
  if (!text.trim()) throw new Error('File YAML trống.');
  const r = parseYaml(text);
  if (!r.ok) throw new Error(describe('YAML', r.error));
  return JSON.stringify(r.value ?? null, null, 2) + '\n';
}

/** JSON (mảng đối tượng / mảng các mảng / một đối tượng) → CSV có dòng tiêu đề. */
export function jsonToCsv(text: string): string {
  parseJsonOrThrow(text); // báo lỗi kèm dòng/cột trước khi dựng bảng
  const table = parseTable(text, 'json', TABLE_OPTS);
  if (table.headers.length === 0) throw new Error('JSON không có dữ liệu dạng bảng.');
  return toDelimited(table, ',', true) + '\n';
}

/** CSV/TSV → JSON mảng đối tượng, dòng đầu làm tiêu đề, tự suy luận số / true / false / null. */
export function delimitedToJson(text: string, format: Extract<InFormat, 'csv' | 'tsv'>): string {
  if (!text.trim()) throw new Error('File trống.');
  const table = parseTable(text, format, TABLE_OPTS);
  return toJson(table, true) + '\n';
}

/** HTML → Markdown (GFM, giữ bảng). Cần DOM nên chỉ chạy trên trình duyệt. */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  return convertToMarkdown(html).markdown + '\n';
}

/** Markdown → trang HTML độc lập; tiêu đề lấy từ heading đầu, không có thì dùng tên file. */
export async function markdownToHtml(md: string, fallbackTitle = 'Tài liệu Markdown'): Promise<string> {
  // react-dom/server nặng nên chỉ nạp khi thực sự chuyển Markdown
  const { extractTitle, markdownToStandaloneHtml } = await import('@/lib/markdown-export');
  return markdownToStandaloneHtml(md, { title: extractTitle(md, fallbackTitle) });
}

type TextFn = (text: string, file: File) => string | Promise<string>;

/** Bọc một hàm text→text thành converter đọc File và đặt tên đầu ra. */
export async function convertText(file: File, to: string, mime: string, fn: TextFn): Promise<ConvertOutput[]> {
  const out = await fn(await readText(file), file);
  return [{ blob: textBlob(out, mime), name: outName(file.name, to) }];
}

export const textFns = {
  jsonToYaml: (t: string) => jsonToYaml(t),
  yamlToJson: (t: string) => yamlToJson(t),
  jsonToCsv: (t: string) => jsonToCsv(t),
  csvToJson: (t: string, f: File) => delimitedToJson(t, /\.tsv$/i.test(f.name) ? 'tsv' : 'csv'),
  htmlToMarkdown: (t: string) => htmlToMarkdown(t),
  markdownToHtml: (t: string, f: File) => markdownToHtml(t, safeBase(f.name)),
} satisfies Record<string, TextFn>;
