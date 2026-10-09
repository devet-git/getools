// Chuyển trang PDF thành ảnh bằng pdf.js ngay trên trình duyệt. Chỉ chạy ở client (cần canvas + worker).

export type ImageFormat = 'png' | 'jpeg';
export interface RenderOptions { pages: number[]; dpi: number; format: ImageFormat; quality: number }
export interface RenderedPage { page: number; blob: Blob; width: number; height: number }

/** Giới hạn số điểm ảnh mỗi trang để tránh cạn bộ nhớ (canvas quá lớn bị trình duyệt từ chối). */
export const MAX_PIXELS = 36_000_000;

/** Hệ số phóng (72 dpi = 1.0) sau khi hạ xuống nếu vượt MAX_PIXELS. */
export function effectiveScale(widthPt: number, heightPt: number, dpi: number): number {
  const want = dpi / 72;
  const maxScale = Math.sqrt(MAX_PIXELS / (widthPt * heightPt));
  return Math.min(want, maxScale);
}

export function pdfRenderError(e: unknown): string {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'PasswordException') return 'PDF này được đặt mật khẩu nên không chuyển thành ảnh được.';
  if (name === 'InvalidPDFException') return 'Không đọc được file PDF (có thể bị hỏng).';
  return msg;
}

export async function loadPdfForRender(bytes: Uint8Array) {
  // Bản legacy có polyfill cho trình duyệt chưa có các API mới (vd. Map.getOrInsertComputed) mà bản thường cần.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  // pdf.js chuyển quyền sở hữu buffer sang worker nên phải đưa bản sao
  const task = pdfjs.getDocument({ data: bytes.slice() });
  return { doc: await task.promise, destroy: () => task.destroy() };
}

export async function renderPages(
  bytes: Uint8Array, o: RenderOptions, onProgress?: (done: number, total: number) => void, signal?: { cancelled: boolean },
): Promise<RenderedPage[]> {
  const { doc, destroy } = await loadPdfForRender(bytes);
  const out: RenderedPage[] = [];
  try {
    for (let i = 0; i < o.pages.length; i++) {
      if (signal?.cancelled) break;
      const pageNo = o.pages[i];
      const page = await doc.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: effectiveScale(base.width, base.height, o.dpi) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Trình duyệt không tạo được canvas.');
      // JPEG không có kênh trong suốt nên nền trang phải trắng
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, o.format === 'png' ? 'image/png' : 'image/jpeg', o.quality));
      if (!blob) throw new Error(`Không xuất được ảnh trang ${pageNo}.`);
      out.push({ page: pageNo, blob, width: canvas.width, height: canvas.height });
      page.cleanup();
      onProgress?.(i + 1, o.pages.length);
    }
  } finally {
    await destroy();
  }
  return out;
}
