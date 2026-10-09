// Chuyển ảnh qua canvas: PNG / JPG / WebP / ICO / PDF. Chỉ chạy trên trình duyệt (cần canvas).
import { encodeIco, normalizeSvg } from '@/lib/favicon-gen';
import type { ConvertOptions, ConvertOutput } from './types';
import { extOf, outName, readText } from './util';

/** Canvas quá lớn bị trình duyệt từ chối hoặc làm cạn bộ nhớ. */
export const MAX_IMAGE_PIXELS = 50_000_000;

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = url;
  });
}

async function decodeSvg(file: File): Promise<Decoded> {
  const norm = normalizeSvg(await readText(file));
  if (!norm.ok) throw new Error(norm.error);
  // Vẽ SVG qua <img> nên script bên trong không bao giờ chạy
  const url = URL.createObjectURL(new Blob([norm.text], { type: 'image/svg+xml' }));
  try {
    const img = await loadImg(url);
    const width = Math.round(img.naturalWidth || norm.width);
    const height = Math.round(img.naturalHeight || norm.height);
    return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Không vẽ được SVG (mã SVG lỗi hoặc tham chiếu tài nguyên ngoài).');
  }
}

/** Giải mã ảnh; GIF động chỉ lấy khung đầu. HEIC/AVIF phụ thuộc trình duyệt. */
export async function decodeImage(file: File): Promise<Decoded> {
  const ext = extOf(file);
  if (ext === 'svg') return decodeSvg(file);
  try {
    // createImageBitmap tự xoay theo EXIF và nhanh hơn <img>
    const bmp = await createImageBitmap(file);
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    // Safari giải mã HEIC qua <img> nhưng không qua createImageBitmap
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImg(url);
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      if (ext === 'heic') throw new Error('Trình duyệt này không đọc được ảnh HEIC (thường chỉ Safari hỗ trợ). Hãy mở bằng Safari hoặc xuất sang JPG trên điện thoại trước.');
      if (ext === 'avif') throw new Error('Trình duyệt này không đọc được ảnh AVIF. Hãy cập nhật trình duyệt hoặc thử Chrome/Firefox bản mới.');
      throw new Error('Không đọc được ảnh (file hỏng hoặc trình duyệt không hỗ trợ định dạng này).');
    }
  }
}

function checkSize(w: number, h: number) {
  if (!w || !h) throw new Error('Ảnh không có kích thước hợp lệ.');
  if (w * h > MAX_IMAGE_PIXELS) throw new Error(`Ảnh quá lớn (${w}×${h}, tối đa ${MAX_IMAGE_PIXELS / 1e6} triệu điểm ảnh).`);
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không tạo được canvas.');
  return { canvas, ctx };
}

async function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, quality));
  if (!blob) throw new Error('Không xuất được ảnh (ảnh có thể quá lớn).');
  // Trình duyệt không hỗ trợ định dạng sẽ lặng lẽ trả PNG
  if (blob.type && blob.type !== mime) throw new Error(`Trình duyệt này không hỗ trợ xuất ${mime.replace('image/', '').toUpperCase()}.`);
  return blob;
}

/** Vẽ ảnh lên canvas cùng kích thước; `background` dùng cho định dạng không có kênh trong suốt. */
async function renderFull(file: File, background?: string) {
  const img = await decodeImage(file);
  try {
    checkSize(img.width, img.height);
    const { canvas, ctx } = makeCanvas(img.width, img.height);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, img.width, img.height);
    }
    ctx.drawImage(img.source, 0, 0, img.width, img.height);
    return canvas;
  } finally {
    img.close();
  }
}

const RASTER_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

export async function imageToRaster(file: File, to: keyof typeof RASTER_MIME, o: ConvertOptions): Promise<ConvertOutput[]> {
  // JPG không có kênh alpha: phủ nền trắng để vùng trong suốt không thành đen
  const canvas = await renderFull(file, to === 'jpg' ? '#ffffff' : undefined);
  const blob = await canvasToBlob(canvas, RASTER_MIME[to], to === 'png' ? undefined : o.quality);
  return [{ blob, name: outName(file.name, to) }];
}

/** ICO một ảnh PNG vuông ≤ 256px (giữ tỉ lệ, phần thừa trong suốt). */
export async function imageToIco(file: File): Promise<ConvertOutput[]> {
  const img = await decodeImage(file);
  let png: Uint8Array;
  let size: number;
  try {
    checkSize(img.width, img.height);
    size = Math.min(256, Math.max(img.width, img.height));
    const scale = size / Math.max(img.width, img.height);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const { canvas, ctx } = makeCanvas(size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
    png = new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
  } finally {
    img.close();
  }
  const ico = encodeIco([{ size, data: png }]);
  return [{ blob: new Blob([ico as BlobPart], { type: 'image/x-icon' }), name: outName(file.name, 'ico') }];
}

/** PDF một trang, khổ trang theo ảnh ở 96 dpi. Ảnh JPG giữ dạng JPEG để file nhỏ. */
export async function imageToPdf(file: File): Promise<ConvertOutput[]> {
  const isJpg = extOf(file) === 'jpg';
  // Luôn đi qua canvas để áp dụng xoay EXIF và giải mã mọi định dạng về PNG/JPEG mà pdf-lib nhúng được
  const canvas = await renderFull(file, isJpg ? '#ffffff' : undefined);
  const blob = await canvasToBlob(canvas, isJpg ? 'image/jpeg' : 'image/png', isJpg ? 0.95 : undefined);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const embedded = isJpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  const w = embedded.width * 0.75;
  const h = embedded.height * 0.75;
  const page = doc.addPage([w, h]);
  page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  const out = await doc.save();
  return [{ blob: new Blob([out as BlobPart], { type: 'application/pdf' }), name: outName(file.name, 'pdf') }];
}
