// PDF → ảnh từng trang / văn bản, dùng lại lớp bọc pdf.js trong lib/pdf-render.
import { loadPdfForRender, pdfRenderError, renderPages } from '@/lib/pdf-render';
import type { ConvertOptions, ConvertOutput } from './types';
import { outName, textBlob } from './util';

/** Giới hạn số trang mỗi lần để không giữ quá nhiều ảnh trong bộ nhớ. */
export const MAX_PDF_PAGES = 300;

async function bytesOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function pad(n: number, total: number): string {
  return String(n).padStart(String(total).length, '0');
}

export async function pdfToImages(file: File, to: 'png' | 'jpg', o: ConvertOptions): Promise<ConvertOutput[]> {
  const bytes = await bytesOf(file);
  let total: number;
  try {
    const { doc, destroy } = await loadPdfForRender(bytes);
    total = doc.numPages;
    await destroy();
  } catch (e) {
    throw new Error(pdfRenderError(e));
  }
  if (total > MAX_PDF_PAGES) throw new Error(`PDF có ${total} trang, chỉ hỗ trợ tối đa ${MAX_PDF_PAGES} trang mỗi lần. Hãy tách file trước.`);
  try {
    const pages = await renderPages(bytes, {
      pages: Array.from({ length: total }, (_, i) => i + 1),
      dpi: o.dpi,
      format: to === 'png' ? 'png' : 'jpeg',
      quality: o.quality,
    });
    // Một trang thì giữ nguyên tên; nhiều trang thì đánh số có đệm 0 để sắp xếp đúng
    return pages.map((p) => ({ blob: p.blob, name: outName(file.name, to, total > 1 ? `trang-${pad(p.page, total)}` : undefined) }));
  } catch (e) {
    throw new Error(pdfRenderError(e));
  }
}

interface TextItemLike { str?: string; hasEOL?: boolean }

export async function pdfToText(file: File): Promise<ConvertOutput[]> {
  let loaded: Awaited<ReturnType<typeof loadPdfForRender>>;
  try {
    loaded = await loadPdfForRender(await bytesOf(file));
  } catch (e) {
    throw new Error(pdfRenderError(e));
  }
  const { doc, destroy } = loaded;
  const parts: string[] = [];
  let hasText = false;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let s = '';
      for (const it of content.items as TextItemLike[]) {
        if (typeof it.str !== 'string') continue;
        s += it.str;
        if (it.hasEOL) s += '\n';
      }
      s = s.replace(/[ \t]+\n/g, '\n').trim();
      if (s) hasText = true;
      parts.push(`===== Trang ${i} =====\n${s}`);
      page.cleanup();
    }
  } catch (e) {
    throw new Error(pdfRenderError(e));
  } finally {
    await destroy();
  }
  // PDF scan chỉ chứa ảnh: báo rõ thay vì trả file rỗng
  if (!hasText) throw new Error('PDF không có lớp chữ (có thể là bản scan). Hãy dùng tool OCR để nhận dạng chữ.');
  return [{ blob: textBlob(parts.join('\n\n') + '\n', 'text/plain'), name: outName(file.name, 'txt') }];
}
