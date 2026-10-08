/**
 * Logic thuần cho tool "Favicon & App Icon": bộ mã hoá ICO (nhúng PNG), danh sách kích thước,
 * dựng manifest / snippet <head>, toán học cover/contain, chuẩn hoá SVG. Không phụ thuộc DOM.
 */

// ───────────────────────────── ICO ─────────────────────────────

export interface IcoImage {
  /** Kích thước (vuông) thực của ảnh PNG, 1..256. */
  size: number;
  /** Dữ liệu PNG đã nén. */
  data: Uint8Array;
}

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Đọc kích thước từ IHDR của PNG; null nếu không phải PNG hợp lệ. */
export function readPngSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 24) return null;
  for (let i = 0; i < 8; i++) if (data[i] !== PNG_SIGNATURE[i]) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint32(12) !== 0x49484452) return null; // 'IHDR'
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** Ghi file .ico gồm ICONDIR + các ICONDIRENTRY + dữ liệu PNG. Kích thước 256 được mã hoá thành 0. */
export function encodeIco(images: IcoImage[]): Uint8Array {
  if (images.length === 0) throw new Error('Cần ít nhất một ảnh để tạo ICO.');
  if (images.length > 0xffff) throw new Error('Quá nhiều ảnh trong ICO.');
  const n = images.length;
  const headerSize = 6 + 16 * n;
  const total = images.reduce((s, im) => s + im.data.length, headerSize);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0, true); // reserved
  dv.setUint16(2, 1, true); // type 1 = icon
  dv.setUint16(4, n, true);
  let offset = headerSize;
  images.forEach((im, i) => {
    if (!Number.isInteger(im.size) || im.size < 1 || im.size > 256) {
      throw new Error(`Kích thước ICO không hợp lệ: ${im.size} (chỉ hỗ trợ 1–256).`);
    }
    const p = 6 + 16 * i;
    const dim = im.size >= 256 ? 0 : im.size;
    dv.setUint8(p, dim); // width
    dv.setUint8(p + 1, dim); // height
    dv.setUint8(p + 2, 0); // colour count (0 = không dùng bảng màu)
    dv.setUint8(p + 3, 0); // reserved
    dv.setUint16(p + 4, 1, true); // planes
    dv.setUint16(p + 6, 32, true); // bit count
    dv.setUint32(p + 8, im.data.length, true); // bytes in resource
    dv.setUint32(p + 12, offset, true); // offset
    out.set(im.data, offset);
    offset += im.data.length;
  });
  return out;
}

export interface IcoEntryInfo {
  width: number; // 256 nếu header ghi 0
  height: number;
  planes: number;
  bitCount: number;
  bytes: number;
  offset: number;
  isPng: boolean;
}

export type IcoParseResult = { ok: true; entries: IcoEntryInfo[] } | { ok: false; error: string };

/** Đọc lại file ICO (dùng kiểm thử & xác minh). Không throw. */
export function parseIco(data: Uint8Array): IcoParseResult {
  if (data.length < 6) return { ok: false, error: 'File ICO quá ngắn.' };
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint16(0, true) !== 0 || dv.getUint16(2, true) !== 1) {
    return { ok: false, error: 'Header ICO không hợp lệ.' };
  }
  const n = dv.getUint16(4, true);
  if (6 + 16 * n > data.length) return { ok: false, error: 'Bảng ICONDIRENTRY bị cắt cụt.' };
  const entries: IcoEntryInfo[] = [];
  for (let i = 0; i < n; i++) {
    const p = 6 + 16 * i;
    const w = dv.getUint8(p) || 256;
    const h = dv.getUint8(p + 1) || 256;
    const bytes = dv.getUint32(p + 8, true);
    const offset = dv.getUint32(p + 12, true);
    if (offset + bytes > data.length) return { ok: false, error: `Mục ${i} vượt quá kích thước file.` };
    const sub = data.subarray(offset, offset + bytes);
    entries.push({
      width: w,
      height: h,
      planes: dv.getUint16(p + 4, true),
      bitCount: dv.getUint16(p + 6, true),
      bytes,
      offset,
      isPng: readPngSize(sub) !== null,
    });
  }
  return { ok: true, entries };
}

// ───────────────────────────── Danh sách file ─────────────────────────────

export type FileId =
  | 'ico'
  | 'png16'
  | 'png32'
  | 'png48'
  | 'apple'
  | 'android192'
  | 'android512'
  | 'maskable'
  | 'mstile'
  | 'browserconfig'
  | 'svg'
  | 'manifest'
  | 'dark32';

export interface FileDef {
  id: FileId;
  name: string;
  desc: string;
  /** Kích thước ảnh (nếu là ảnh raster). */
  size?: number;
  /** Biến thể render: any (có mask), opaque (nền đặc), maskable (vùng an toàn). */
  variant?: 'any' | 'opaque' | 'maskable';
  defaultOn: boolean;
}

export const FILE_DEFS: FileDef[] = [
  { id: 'ico', name: 'favicon.ico', desc: 'Đa kích thước 16/32/48 (PNG nhúng)', defaultOn: true },
  { id: 'png16', name: 'favicon-16x16.png', desc: 'Tab trình duyệt', size: 16, variant: 'any', defaultOn: true },
  { id: 'png32', name: 'favicon-32x32.png', desc: 'Tab trình duyệt (retina)', size: 32, variant: 'any', defaultOn: true },
  { id: 'png48', name: 'favicon-48x48.png', desc: 'Windows / kết quả tìm kiếm', size: 48, variant: 'any', defaultOn: true },
  { id: 'apple', name: 'apple-touch-icon.png', desc: '180×180, nền đặc cho iOS', size: 180, variant: 'opaque', defaultOn: true },
  { id: 'android192', name: 'android-chrome-192x192.png', desc: 'Android / PWA', size: 192, variant: 'any', defaultOn: true },
  { id: 'android512', name: 'android-chrome-512x512.png', desc: 'Android / PWA (splash)', size: 512, variant: 'any', defaultOn: true },
  { id: 'maskable', name: 'maskable-icon-512.png', desc: 'Icon maskable, lề an toàn ~10%', size: 512, variant: 'maskable', defaultOn: true },
  { id: 'mstile', name: 'mstile-150x150.png', desc: 'Ô Windows (nền đặc)', size: 150, variant: 'opaque', defaultOn: true },
  { id: 'browserconfig', name: 'browserconfig.xml', desc: 'Cấu hình ô Windows', defaultOn: false },
  { id: 'svg', name: 'favicon.svg', desc: 'Chỉ khả dụng khi nguồn là SVG', defaultOn: true },
  { id: 'manifest', name: 'site.webmanifest', desc: 'Web App Manifest', defaultOn: true },
  { id: 'dark32', name: 'favicon-dark-32x32.png', desc: 'Biến thể chế độ tối (cần ảnh thay thế)', size: 32, variant: 'any', defaultOn: true },
];

export const ICO_SIZES = [16, 32, 48];

// ───────────────────────────── Manifest / snippet ─────────────────────────────

export interface PackOptions {
  appName: string;
  shortName: string;
  themeColor: string;
  backgroundColor: string;
  /** Thư mục chứa icon trên site, mặc định "/". */
  basePath: string;
  include: Partial<Record<FileId, boolean>>;
  hasSvg: boolean;
  hasDark: boolean;
}

export function normalizeBasePath(p: string): string {
  let s = (p || '/').trim().replace(/\s+/g, '');
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/')) s += '/';
  return s.replace(/\/{2,}/g, '/');
}

export function isHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

export function isIncluded(o: PackOptions, id: FileId): boolean {
  if (!o.include[id]) return false;
  if (id === 'svg' && !o.hasSvg) return false;
  if (id === 'dark32' && !o.hasDark) return false;
  return true;
}

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

export function buildManifest(o: PackOptions): string {
  const base = normalizeBasePath(o.basePath);
  const icons: ManifestIcon[] = [];
  if (isIncluded(o, 'android192'))
    icons.push({ src: `${base}android-chrome-192x192.png`, sizes: '192x192', type: 'image/png' });
  if (isIncluded(o, 'android512'))
    icons.push({ src: `${base}android-chrome-512x512.png`, sizes: '512x512', type: 'image/png' });
  if (isIncluded(o, 'maskable'))
    icons.push({ src: `${base}maskable-icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  const name = o.appName.trim() || 'My App';
  const manifest = {
    name,
    short_name: (o.shortName.trim() || name).slice(0, 12),
    icons,
    theme_color: o.themeColor,
    background_color: o.backgroundColor,
    display: 'standalone',
    start_url: '/',
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

export function buildBrowserConfig(o: PackOptions): string {
  const base = normalizeBasePath(o.basePath);
  return `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square150x150logo src="${base}mstile-150x150.png"/>
      <TileColor>${o.themeColor}</TileColor>
    </tile>
  </msapplication>
</browserconfig>
`;
}

export function buildHeadSnippet(o: PackOptions): string {
  const base = normalizeBasePath(o.basePath);
  const L: string[] = [];
  if (isIncluded(o, 'ico')) L.push(`<link rel="icon" href="${base}favicon.ico" sizes="48x48">`);
  if (isIncluded(o, 'svg')) L.push(`<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">`);
  if (isIncluded(o, 'png16'))
    L.push(`<link rel="icon" type="image/png" sizes="16x16" href="${base}favicon-16x16.png">`);
  if (isIncluded(o, 'png32'))
    L.push(`<link rel="icon" type="image/png" sizes="32x32" href="${base}favicon-32x32.png">`);
  if (isIncluded(o, 'png48'))
    L.push(`<link rel="icon" type="image/png" sizes="48x48" href="${base}favicon-48x48.png">`);
  if (isIncluded(o, 'dark32'))
    L.push(
      `<link rel="icon" type="image/png" sizes="32x32" href="${base}favicon-dark-32x32.png" media="(prefers-color-scheme: dark)">`
    );
  if (isIncluded(o, 'apple'))
    L.push(`<link rel="apple-touch-icon" sizes="180x180" href="${base}apple-touch-icon.png">`);
  if (isIncluded(o, 'manifest')) L.push(`<link rel="manifest" href="${base}site.webmanifest">`);
  L.push(`<meta name="theme-color" content="${o.themeColor}">`);
  if (isIncluded(o, 'mstile')) {
    L.push(`<meta name="msapplication-TileColor" content="${o.themeColor}">`);
    L.push(`<meta name="msapplication-TileImage" content="${base}mstile-150x150.png">`);
    if (isIncluded(o, 'browserconfig')) L.push(`<meta name="msapplication-config" content="${base}browserconfig.xml">`);
  }
  return L.join('\n');
}

export function nextjsNote(o: PackOptions): string {
  const L = ['Next.js (App Router) - đặt file trong thư mục app/:'];
  L.push('  app/favicon.ico            <- favicon.ico');
  L.push('  app/icon.png               <- android-chrome-512x512.png (hoặc favicon-32x32.png)');
  if (o.hasSvg) L.push('  app/icon.svg               <- favicon.svg');
  L.push('  app/apple-icon.png         <- apple-touch-icon.png');
  L.push('  app/manifest.webmanifest   <- site.webmanifest (hoặc app/manifest.ts)');
  L.push('Next.js tự sinh các thẻ <link> trong <head>; không cần chép snippet bên trên.');
  return L.join('\n');
}

export function vitePublicNote(o: PackOptions): string {
  const base = normalizeBasePath(o.basePath);
  return [
    'Vite / CRA / site tĩnh - đặt toàn bộ file vào thư mục public/ (sẽ được phục vụ tại ' + base + '):',
    '  public/favicon.ico, public/favicon-*.png, public/apple-touch-icon.png, public/site.webmanifest ...',
    'Sau đó dán snippet <head> bên trên vào index.html (Vite) hoặc public/index.html (CRA).',
    'CRA: thay %PUBLIC_URL%/ cho tiền tố đường dẫn nếu app chạy trong thư mục con.',
  ].join('\n');
}

export const SAFARI_PINNED_NOTE =
  'Safari pinned tab: cần một file SVG đơn sắc (một màu, không gradient) và thẻ ' +
  '<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#5bbad5">. Safari 12+ đã dùng favicon thường, ' +
  'nên bước này chỉ cần cho Safari cũ.';

// ───────────────────────────── Hình học ─────────────────────────────

export type FitMode = 'cover' | 'contain';

export interface FitRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Tính hình chữ nhật đích để vẽ ảnh srcW×srcH vào ô vuông `size`.
 * zoom >= 1 (1 = vừa khít), pan tính theo tỉ lệ của `size` (-1..1). Cover được kẹp để không lộ khoảng trống.
 */
export function fitRect(
  srcW: number,
  srcH: number,
  size: number,
  mode: FitMode,
  zoom = 1,
  panX = 0,
  panY = 0
): FitRect {
  if (!(srcW > 0) || !(srcH > 0) || !(size > 0)) return { dx: 0, dy: 0, dw: 0, dh: 0 };
  const z = clamp(Number.isFinite(zoom) ? zoom : 1, 0.1, 10);
  const base = mode === 'cover' ? Math.max(size / srcW, size / srcH) : Math.min(size / srcW, size / srcH);
  const dw = srcW * base * z;
  const dh = srcH * base * z;
  let ox = (Number.isFinite(panX) ? panX : 0) * size;
  let oy = (Number.isFinite(panY) ? panY : 0) * size;
  if (mode === 'cover') {
    const mx = Math.max(0, (dw - size) / 2);
    const my = Math.max(0, (dh - size) / 2);
    ox = clamp(ox, -mx, mx);
    oy = clamp(oy, -my, my);
  } else {
    ox = clamp(ox, -size, size);
    oy = clamp(oy, -size, size);
  }
  return { dx: (size - dw) / 2 + ox, dy: (size - dh) / 2 + oy, dw, dh };
}

/** Hộp vùng an toàn của icon maskable: padding mỗi bên (mặc định 10%). */
export function maskableBox(size: number, padding = 0.1): { offset: number; inner: number } {
  const offset = Math.round(size * padding);
  return { offset, inner: size - offset * 2 };
}

/** Các kích thước trung gian khi thu nhỏ từng bậc (mỗi bước tối đa giảm một nửa). */
export function stepSizes(from: number, to: number): number[] {
  const out: number[] = [];
  if (!(from > 0) || !(to > 0)) return out;
  let s = Math.floor(from);
  while (s / 2 > to) {
    s = Math.floor(s / 2);
    out.push(s);
  }
  out.push(Math.round(to));
  return out;
}

export type IconShape = 'square' | 'rounded' | 'circle';

/** Bán kính bo góc theo tỉ lệ cạnh (0..0.5). */
export function shapeRadius(shape: IconShape): number {
  return shape === 'circle' ? 0.5 : shape === 'rounded' ? 0.22 : 0;
}

/** Điểm đầu/cuối của gradient tuyến tính theo góc CSS (0deg = từ dưới lên trên) trong ô vuông `size`. */
export function gradientLine(size: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(size * dx) + Math.abs(size * dy)) / 2;
  const c = size / 2;
  return { x0: c - dx * half, y0: c - dy * half, x1: c + dx * half, y1: c + dy * half };
}

/** Giới hạn văn bản icon còn tối đa n ký tự hiển thị (grapheme nếu có Intl.Segmenter). */
export function clampGraphemes(text: string, n = 3): string {
  const t = text.replace(/[\r\n\t]+/g, ' ');
  let parts: string[];
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<{ segment: string }> } })
    .Segmenter;
  if (Seg) {
    parts = Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(t), (x) => x.segment);
  } else {
    parts = Array.from(t);
  }
  return parts.slice(0, n).join('');
}

// ───────────────────────────── SVG ─────────────────────────────

export const MAX_SVG_CHARS = 2_000_000;

export type SvgNormalizeResult =
  | { ok: true; text: string; width: number; height: number }
  | { ok: false; error: string };

function numAttr(tag: string, name: string): number | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)(?:px)?\\s*["']`, 'i').exec(tag);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return v > 0 ? v : null;
}

/** Kiểm tra & chuẩn hoá SVG để vẽ qua <img>: đảm bảo xmlns và width/height. Không bao giờ throw. */
export function normalizeSvg(input: string): SvgNormalizeResult {
  if (!input || !input.trim()) return { ok: false, error: 'Chưa có mã SVG.' };
  if (input.length > MAX_SVG_CHARS) return { ok: false, error: 'Mã SVG quá lớn (tối đa 2 triệu ký tự).' };
  const m = /<svg\b[^>]*>/i.exec(input);
  if (!m) return { ok: false, error: 'Không tìm thấy thẻ <svg> trong mã.' };
  let tag = m[0];
  let w = numAttr(tag, 'width');
  let h = numAttr(tag, 'height');
  if (w === null || h === null) {
    const vb = /\sviewBox\s*=\s*["']\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)\s*["']/i.exec(tag);
    const vw = vb ? parseFloat(vb[3]) : NaN;
    const vh = vb ? parseFloat(vb[4]) : NaN;
    if (vw > 0 && vh > 0) {
      if (w !== null) h = (w * vh) / vw;
      else if (h !== null) w = (h * vw) / vh;
      else {
        w = vw;
        h = vh;
      }
    } else {
      w = w ?? 512;
      h = h ?? w;
    }
    tag = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    tag = tag.replace(/<svg\b/i, `<svg width="${w}" height="${h}"`);
  }
  if (!/\sxmlns\s*=/i.test(tag)) tag = tag.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const text = input.slice(0, m.index) + tag + input.slice(m.index + m[0].length);
  return { ok: true, text, width: w, height: h };
}

export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <path d="M20 34l8 8 16-18" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const MAX_INPUT_BYTES = 15 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export interface SourceWarning {
  text: string;
}

/** Cảnh báo chất lượng ảnh nguồn (nhỏ hơn 512px hoặc không vuông). */
export function sourceWarnings(w: number, h: number, isVector = false): string[] {
  const out: string[] = [];
  if (!(w > 0) || !(h > 0)) return out;
  if (!isVector && Math.min(w, h) < 512)
    out.push(`Ảnh nhỏ hơn 512px (${w}×${h}) - icon 512×512 sẽ bị phóng to và mờ.`);
  if (Math.abs(w - h) > 1)
    out.push(`Ảnh không vuông (${w}×${h}) - chọn chế độ Cover (cắt) hoặc Contain (lồng vào, có nền).`);
  return out;
}
