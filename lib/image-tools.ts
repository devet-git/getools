/** Hàm thuần cho công cụ nén / đổi cỡ / đổi định dạng ảnh. */

export type OutputFormat = 'keep' | 'jpeg' | 'png' | 'webp';
export type ResizeMode = 'none' | 'max' | 'exact' | 'percent';

export interface ResizeOptions {
  mode: ResizeMode;
  maxWidth: number;
  maxHeight: number;
  width: number;
  height: number;
  lockAspect: boolean;
  percent: number;
}

export const MAX_FILES = 30;
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
/** Giới hạn cạnh/diện tích canvas an toàn cho trình duyệt phổ biến. */
export const MAX_DIMENSION = 16384;
export const MAX_PIXELS = 100_000_000;

export const MIME_BY_FORMAT: Record<Exclude<OutputFormat, 'keep'>, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const RESIZE_PRESETS: { label: string; maxWidth: number; maxHeight: number }[] = [
  { label: 'Full HD (1920×1080)', maxWidth: 1920, maxHeight: 1080 },
  { label: 'HD (1280×720)', maxWidth: 1280, maxHeight: 720 },
  { label: '800 px', maxWidth: 800, maxHeight: 800 },
  { label: '400 px', maxWidth: 400, maxHeight: 400 },
  { label: 'Avatar 256', maxWidth: 256, maxHeight: 256 },
];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

/** Phần trăm tiết kiệm (có thể âm nếu kết quả lớn hơn). */
export function percentSaved(original: number, result: number): number {
  if (original <= 0) return 0;
  return Math.round(((original - result) / original) * 1000) / 10;
}

function clampInt(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_DIMENSION, Math.round(n)));
}

export function calcDimensions(srcW: number, srcH: number, o: ResizeOptions): { width: number; height: number } {
  if (srcW <= 0 || srcH <= 0) return { width: 1, height: 1 };
  switch (o.mode) {
    case 'max': {
      const mw = o.maxWidth > 0 ? o.maxWidth : Infinity;
      const mh = o.maxHeight > 0 ? o.maxHeight : Infinity;
      const scale = Math.min(1, mw / srcW, mh / srcH); // không phóng to
      return { width: clampInt(srcW * scale), height: clampInt(srcH * scale) };
    }
    case 'exact': {
      const w = o.width > 0 ? o.width : 0;
      const h = o.height > 0 ? o.height : 0;
      if (o.lockAspect) {
        if (w && h) {
          const scale = Math.min(w / srcW, h / srcH);
          return { width: clampInt(srcW * scale), height: clampInt(srcH * scale) };
        }
        if (w) return { width: clampInt(w), height: clampInt((srcH * w) / srcW) };
        if (h) return { width: clampInt((srcW * h) / srcH), height: clampInt(h) };
        return { width: srcW, height: srcH };
      }
      return { width: clampInt(w || srcW), height: clampInt(h || srcH) };
    }
    case 'percent': {
      const p = o.percent > 0 ? o.percent / 100 : 1;
      return { width: clampInt(srcW * p), height: clampInt(srcH * p) };
    }
    default:
      return { width: srcW, height: srcH };
  }
}

/** Chia tỉ lệ cho chế độ "kích thước chính xác" khi khoá tỉ lệ: nhập một chiều, tính chiều kia. */
export function linkedDimension(changed: number, srcW: number, srcH: number, axis: 'w' | 'h'): number {
  if (srcW <= 0 || srcH <= 0 || !(changed > 0)) return 0;
  return axis === 'w' ? Math.round((changed * srcH) / srcW) : Math.round((changed * srcW) / srcH);
}

export function splitName(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, i), ext: name.slice(i + 1) };
}

function sanitizeBase(base: string): string {
  const s = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return s || 'anh';
}

/** Tên file kết quả: <tên><hậu tố>.<đuôi mới>. */
export function buildFileName(original: string, suffix: string, ext: string): string {
  const { base } = splitName(original);
  return `${sanitizeBase(base)}${suffix}.${ext}`;
}

/** Bảo đảm tên duy nhất (không phân biệt hoa thường) trong tập `used`; thêm vào `used`. */
export function dedupeName(name: string, used: Set<string>): string {
  const { base, ext } = splitName(name);
  let candidate = name;
  let n = 1;
  while (used.has(candidate.toLowerCase())) {
    n++;
    candidate = ext ? `${base} (${n}).${ext}` : `${base} (${n})`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Quyết định MIME đầu ra từ lựa chọn và MIME gốc. Trả về MIME mà canvas có thể mã hoá. */
export function resolveOutputMime(format: OutputFormat, sourceMime: string): string {
  if (format !== 'keep') return MIME_BY_FORMAT[format];
  if (sourceMime === 'image/jpeg' || sourceMime === 'image/webp' || sourceMime === 'image/png') return sourceMime;
  return 'image/png'; // GIF, BMP, AVIF, SVG... -> PNG
}

export function isLossy(mime: string): boolean {
  return mime === 'image/jpeg' || mime === 'image/webp';
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'png';
}
