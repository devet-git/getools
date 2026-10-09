// DOCX → HTML / Markdown / TXT bằng mammoth (bản trình duyệt, nạp động khi cần).
import type { ConvertOutput } from './types';
import { outName, safeBase, textBlob, wrapHtml } from './util';

type Mammoth = typeof import('mammoth/mammoth.browser');

async function loadMammoth(): Promise<Mammoth> {
  const mod = (await import('mammoth/mammoth.browser')) as Mammoth & { default?: Mammoth };
  // Module CommonJS: webpack có thể đặt export dưới `default`
  return mod.default ?? mod;
}

async function docxHtmlBody(file: File): Promise<string> {
  const mammoth = await loadMammoth();
  // Ảnh nhúng được giữ dạng data URI để file HTML tự chứa, không cần thư mục ảnh kèm theo
  const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return res.value;
}

export async function docxToHtml(file: File): Promise<ConvertOutput[]> {
  const html = wrapHtml(safeBase(file.name), await docxHtmlBody(file));
  return [{ blob: textBlob(html, 'text/html'), name: outName(file.name, 'html') }];
}

export async function docxToMarkdown(file: File): Promise<ConvertOutput[]> {
  const body = await docxHtmlBody(file);
  const { htmlToMarkdown } = await import('./data');
  return [{ blob: textBlob(htmlToMarkdown(body), 'text/markdown'), name: outName(file.name, 'md') }];
}

export async function docxToText(file: File): Promise<ConvertOutput[]> {
  const mammoth = await loadMammoth();
  const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  // mammoth tách đoạn bằng hai dấu xuống dòng; gom bớt dòng trống thừa
  const text = res.value.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return [{ blob: textBlob(text, 'text/plain'), name: outName(file.name, 'txt') }];
}
