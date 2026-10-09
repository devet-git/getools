// Biên tập PDF ngay trên trình duyệt bằng pdf-lib: đánh số trang, watermark, xoay/xóa/sắp xếp, ảnh → PDF.
// Font chuẩn của PDF (Helvetica) không có chữ tiếng Việt có dấu nên văn bản chèn vào được bỏ dấu.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** Bỏ dấu tiếng Việt và ký tự ngoài ASCII in được (Helvetica chuẩn không vẽ được chúng). */
export function toPdfSafeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, '').trim();
}

export type Pos = 'bl' | 'bc' | 'br' | 'tl' | 'tc' | 'tr';

/**
 * Đổi tọa độ trong khung nhìn của trang (gốc dưới-trái của trang SAU khi xoay) về tọa độ thật của trang,
 * kèm góc quay chữ để chữ luôn thẳng khi người dùng xem. Cần vì /Rotate khiến trục của trang bị xoay.
 */
export function viewToPage(page: PDFPage, vx: number, vy: number): { x: number; y: number; angle: number } {
  const { width: W, height: H } = page.getSize();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  if (r === 90) return { x: W - vy, y: vx, angle: 90 };
  if (r === 180) return { x: W - vx, y: H - vy, angle: 180 };
  if (r === 270) return { x: vy, y: H - vx, angle: 270 };
  return { x: vx, y: vy, angle: 0 };
}

export function viewSize(page: PDFPage): { w: number; h: number } {
  const { width, height } = page.getSize();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  return r === 90 || r === 270 ? { w: height, h: width } : { w: width, h: height };
}

/** Vẽ chữ tại điểm (vx, vy) của khung nhìn, `anchorX` là phần chiều rộng chữ nằm bên trái điểm đó (0 = trái, 0.5 = giữa, 1 = phải). */
function drawViewText(page: PDFPage, font: PDFFont, text: string, vx: number, vy: number, size: number, anchorX: number, opts: { color?: ReturnType<typeof rgb>; opacity?: number; extraAngle?: number } = {}) {
  const w = font.widthOfTextAtSize(text, size);
  const { angle } = viewToPage(page, 0, 0);
  // dịch điểm đặt dọc theo hướng chữ (trong khung nhìn) để căn trái/giữa/phải
  const dx = -w * anchorX * Math.cos(((opts.extraAngle ?? 0) * Math.PI) / 180);
  const dy = -w * anchorX * Math.sin(((opts.extraAngle ?? 0) * Math.PI) / 180);
  const base = viewToPage(page, vx + dx, vy + dy);
  page.drawText(text, { x: base.x, y: base.y, size, font, color: opts.color ?? rgb(0.25, 0.25, 0.25), opacity: opts.opacity ?? 1, rotate: degrees(angle + (opts.extraAngle ?? 0)) });
}

export type NumberFormat = 'n' | 'n/N' | '-n-' | 'Page n of N';

export interface PageNumberOptions {
  position: Pos;
  format: NumberFormat;
  start: number;
  fontSize: number;
  /** Bỏ qua trang bìa: trang 1 không đánh số, trang 2 mang số `start` */
  skipFirst: boolean;
  margin: number;
}

export const formatPageLabel = (fmt: NumberFormat, n: number, total: number): string =>
  fmt === 'n' ? String(n) : fmt === 'n/N' ? `${n} / ${total}` : fmt === '-n-' ? `- ${n} -` : `Page ${n} of ${total}`;

export async function addPageNumbers(bytes: Uint8Array, o: PageNumberOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const firstIdx = o.skipFirst ? 1 : 0;
  const total = pages.length - firstIdx;
  pages.forEach((page, i) => {
    if (i < firstIdx) return;
    const label = formatPageLabel(o.format, o.start + (i - firstIdx), o.start + total - 1);
    const { w, h } = viewSize(page);
    const vx = o.position.endsWith('l') ? o.margin : o.position.endsWith('r') ? w - o.margin : w / 2;
    const vy = o.position.startsWith('t') ? h - o.margin - o.fontSize : o.margin;
    const anchor = o.position.endsWith('l') ? 0 : o.position.endsWith('r') ? 1 : 0.5;
    drawViewText(page, font, label, vx, vy, o.fontSize, anchor);
  });
  return doc.save();
}

export interface WatermarkOptions { text: string; size: number; opacity: number; angle: number; color: [number, number, number]; tile: boolean }

export async function addWatermark(bytes: Uint8Array, o: WatermarkOptions): Promise<Uint8Array> {
  const text = toPdfSafeText(o.text);
  if (!text) throw new Error('Nội dung watermark trống (ký tự ngoài ASCII sẽ bị bỏ).');
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const color = rgb(o.color[0], o.color[1], o.color[2]);
  for (const page of doc.getPages()) {
    const { w, h } = viewSize(page);
    const points: [number, number][] = o.tile
      ? [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]].map(([a, b]) => [a * w, b * h])
      : [[w / 2, h / 2]];
    const tw = font.widthOfTextAtSize(text, o.size);
    const th = o.size * 0.7;
    const rad = (o.angle * Math.PI) / 180;
    for (const [cx, cy] of points) {
      // đặt tâm chữ vào (cx, cy): lùi nửa chiều rộng dọc hướng chữ và nửa chiều cao vuông góc hướng đó
      const vx = cx - (tw / 2) * Math.cos(rad) + (th / 2) * Math.sin(rad);
      const vy = cy - (tw / 2) * Math.sin(rad) - (th / 2) * Math.cos(rad);
      drawViewText(page, font, text, vx, vy, o.size, 0, { color, opacity: o.opacity, extraAngle: o.angle });
    }
  }
  return doc.save();
}

export interface PageEdit { source: number; rotate: 0 | 90 | 180 | 270 }

/** Dựng PDF mới từ danh sách trang (có thể bỏ, lặp, đổi thứ tự) kèm góc xoay cộng thêm. `source` đánh số từ 1. */
export async function rebuildPages(bytes: Uint8Array, edits: PageEdit[]): Promise<Uint8Array> {
  if (edits.length === 0) throw new Error('Cần giữ lại ít nhất một trang.');
  const src = await PDFDocument.load(bytes);
  const n = src.getPageCount();
  for (const e of edits) if (!Number.isInteger(e.source) || e.source < 1 || e.source > n) throw new Error(`Trang ${e.source} không tồn tại (PDF có ${n} trang).`);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, edits.map((e) => e.source - 1));
  copied.forEach((p, i) => {
    const total = (((p.getRotation().angle + edits[i].rotate) % 360) + 360) % 360;
    p.setRotation(degrees(total));
    out.addPage(p);
  });
  return out.save();
}

export async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

export interface ImagePage { bytes: Uint8Array; type: 'jpg' | 'png' }
export interface ImagesToPdfOptions { size: 'a4' | 'fit'; margin: number; landscapeAuto: boolean }

const A4: [number, number] = [595.28, 841.89];

export async function imagesToPdf(images: ImagePage[], o: ImagesToPdfOptions): Promise<Uint8Array> {
  if (images.length === 0) throw new Error('Chưa có ảnh nào.');
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = im.type === 'jpg' ? await doc.embedJpg(im.bytes) : await doc.embedPng(im.bytes);
    if (o.size === 'fit') {
      const page = doc.addPage([img.width + o.margin * 2, img.height + o.margin * 2]);
      page.drawImage(img, { x: o.margin, y: o.margin, width: img.width, height: img.height });
      continue;
    }
    const landscape = o.landscapeAuto && img.width > img.height;
    const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
    const page = doc.addPage([pw, ph]);
    const scale = Math.min((pw - o.margin * 2) / img.width, (ph - o.margin * 2) / img.height, Infinity);
    const w = img.width * scale, h = img.height * scale;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return doc.save();
}
