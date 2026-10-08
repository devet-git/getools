/**
 * OCR miễn phí chạy trong trình duyệt (tesseract.js) + xử lý ảnh bằng toán thuần.
 * Phần "pure" không đụng DOM nên test được bằng tsx; riêng `loadTesseract`/`createOcrWorker` nạp tesseract.js lười.
 */

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
export interface GrayImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Kích thước                                                          */
/* ------------------------------------------------------------------ */

export const UPSCALE_TARGET = 2000;
export const MAX_LONG_SIDE = 4000;
export const MAX_UPSCALE = 4;

/** Hệ số phóng/thu để cạnh dài hướng tới ~target px. Ảnh >= 70% target giữ nguyên; ảnh quá lớn (> maxSide) thu lại. */
export function upscaleFactor(width: number, height: number, target = UPSCALE_TARGET, maxSide = MAX_LONG_SIDE): number {
  const long = Math.max(width, height);
  if (!(long > 0)) return 1;
  if (long > maxSide) return maxSide / long;
  if (long >= target * 0.7) return 1;
  return Math.min(MAX_UPSCALE, target / long);
}

/* ------------------------------------------------------------------ */
/* Phép biến đổi hình học                                              */
/* ------------------------------------------------------------------ */

export function rotate90(img: RgbaImage, quarterTurns: number): RgbaImage {
  const q = ((Math.round(quarterTurns) % 4) + 4) % 4;
  if (q === 0) return img;
  const { width: w, height: h, data } = img;
  const ow = q === 2 ? w : h;
  const oh = q === 2 ? h : w;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number, ny: number;
      if (q === 1) { nx = h - 1 - y; ny = x; } // 90° theo chiều kim đồng hồ
      else if (q === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      const s = (y * w + x) * 4;
      const d = (ny * ow + nx) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
  }
  return { data: out, width: ow, height: oh };
}

/** Xoay góc tuỳ ý (độ, dương = theo chiều kim đồng hồ), nội suy song tuyến, nền lấy màu góc trên-trái. */
export function rotateArbitrary(img: RgbaImage, deg: number): RgbaImage {
  if (!Number.isFinite(deg) || Math.abs(deg) < 0.01) return img;
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t);
  const { width: w, height: h, data } = img;
  const ow = Math.max(1, Math.ceil(Math.abs(w * cos) + Math.abs(h * sin)));
  const oh = Math.max(1, Math.ceil(Math.abs(w * sin) + Math.abs(h * cos)));
  const out = new Uint8ClampedArray(ow * oh * 4);
  const bg = [data[0], data[1], data[2], 255];
  const cx = w / 2, cy = h / 2, ocx = ow / 2, ocy = oh / 2;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const dx = x + 0.5 - ocx, dy = y + 0.5 - ocy;
      const sx = dx * cos + dy * sin + cx - 0.5;
      const sy = -dx * sin + dy * cos + cy - 0.5;
      const o = (y * ow + x) * 4;
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) {
        out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2]; out[o + 3] = 255;
        continue;
      }
      const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy));
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0));
      for (let c = 0; c < 3; c++) {
        const a = data[(y0 * w + x0) * 4 + c] * (1 - fx) + data[(y0 * w + x1) * 4 + c] * fx;
        const b = data[(y1 * w + x0) * 4 + c] * (1 - fx) + data[(y1 * w + x1) * 4 + c] * fx;
        out[o + c] = a * (1 - fy) + b * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: ow, height: oh };
}

export function resizeBilinear(img: RgbaImage, nw: number, nh: number): RgbaImage {
  nw = Math.max(1, Math.round(nw));
  nh = Math.max(1, Math.round(nh));
  if (nw === img.width && nh === img.height) return img;
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(nw * nh * 4);
  const rx = w / nw, ry = h / nh;
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) * ry - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) * rx - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      const o = (y * nw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = data[(y0 * w + x0) * 4 + c] * (1 - fx) + data[(y0 * w + x1) * 4 + c] * fx;
        const b = data[(y1 * w + x0) * 4 + c] * (1 - fx) + data[(y1 * w + x1) * 4 + c] * fx;
        out[o + c] = a * (1 - fy) + b * fy;
      }
    }
  }
  return { data: out, width: nw, height: nh };
}

/* ------------------------------------------------------------------ */
/* Lọc ảnh xám                                                         */
/* ------------------------------------------------------------------ */

export function toGray(img: RgbaImage): GrayImage {
  const n = img.width * img.height;
  const g = new Uint8ClampedArray(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    // ghép trên nền trắng để PNG trong suốt không thành đen
    const r = d[i * 4] * a + 255 * (1 - a), gg = d[i * 4 + 1] * a + 255 * (1 - a), b = d[i * 4 + 2] * a + 255 * (1 - a);
    g[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
  }
  return { data: g, width: img.width, height: img.height };
}

export function grayToRgba(g: GrayImage): RgbaImage {
  const n = g.width * g.height;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = g.data[i];
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return { data: out, width: g.width, height: g.height };
}

export function meanBrightness(g: GrayImage): number {
  const n = g.data.length;
  if (!n) return 255;
  let s = 0;
  for (let i = 0; i < n; i++) s += g.data[i];
  return s / n;
}

/** Ảnh nền tối (ảnh chụp màn hình dark mode): độ sáng trung bình thấp. */
export function isDarkImage(g: GrayImage, threshold = 110): boolean {
  return meanBrightness(g) < threshold;
}

export function invertGray(g: GrayImage): GrayImage {
  const out = new Uint8ClampedArray(g.data.length);
  for (let i = 0; i < out.length; i++) out[i] = 255 - g.data[i];
  return { data: out, width: g.width, height: g.height };
}

export function histogram(g: GrayImage): number[] {
  const h = new Array<number>(256).fill(0);
  for (let i = 0; i < g.data.length; i++) h[g.data[i]]++;
  return h;
}

/** Căng độ tương phản: kéo phân vị lowPct..highPct về 0..255. */
export function autoLevels(g: GrayImage, lowPct = 0.01, highPct = 0.99): GrayImage {
  const hist = histogram(g);
  const total = g.data.length;
  if (!total) return g;
  let acc = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * lowPct) { lo = i; break; } }
  acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * highPct) { hi = i; break; } }
  if (hi - lo < 8) return g; // gần như phẳng, không kéo (tránh khuếch đại nhiễu)
  const out = new Uint8ClampedArray(total);
  const scale = 255 / (hi - lo);
  for (let i = 0; i < total; i++) out[i] = (g.data[i] - lo) * scale;
  return { data: out, width: g.width, height: g.height };
}

/** Ngưỡng Otsu từ histogram 256 bin. Trả về t: điểm <= t là "tối". */
export function otsuThreshold(hist: ArrayLike<number>): number {
  let total = 0, sumAll = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sumAll += i * hist[i]; }
  if (!total) return 127;
  let wB = 0, sumB = 0, best = -1, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

export function thresholdOtsu(g: GrayImage): GrayImage {
  const t = otsuThreshold(histogram(g));
  const out = new Uint8ClampedArray(g.data.length);
  for (let i = 0; i < out.length; i++) out[i] = g.data[i] > t ? 255 : 0;
  return { data: out, width: g.width, height: g.height };
}

/** Ngưỡng thích nghi (trung bình cục bộ qua ảnh tích phân) — tốt cho ảnh chụp ánh sáng không đều. */
export function thresholdAdaptive(g: GrayImage, windowSize?: number, c = 10): GrayImage {
  const { width: w, height: h, data } = g;
  let win = windowSize ?? Math.max(15, Math.round(Math.min(w, h) / 16));
  if (win % 2 === 0) win++;
  const half = (win - 1) / 2;
  const iw = w + 1;
  const integral = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      integral[(y + 1) * iw + x + 1] = integral[y * iw + x + 1] + row;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
      const area = (x1 - x0) * (y1 - y0);
      const sum = integral[y1 * iw + x1] - integral[y0 * iw + x1] - integral[y1 * iw + x0] + integral[y0 * iw + x0];
      out[y * w + x] = data[y * w + x] * area < sum - c * area ? 0 : 255;
    }
  }
  return { data: out, width: w, height: h };
}

export function median3(g: GrayImage): GrayImage {
  const { width: w, height: h, data } = g;
  const out = new Uint8ClampedArray(data.length);
  const win = new Array<number>(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          win[k++] = data[yy * w + xx];
        }
      }
      win.sort((a, b) => a - b);
      out[y * w + x] = win[4];
    }
  }
  return { data: out, width: w, height: h };
}

export function sharpen(g: GrayImage, amount = 1): GrayImage {
  const { width: w, height: h, data } = g;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = data[y * w + x];
      const up = data[Math.max(0, y - 1) * w + x];
      const dn = data[Math.min(h - 1, y + 1) * w + x];
      const lf = data[y * w + Math.max(0, x - 1)];
      const rt = data[y * w + Math.min(w - 1, x + 1)];
      out[y * w + x] = c + amount * (4 * c - up - dn - lf - rt);
    }
  }
  return { data: out, width: w, height: h };
}

/* ------------------------------------------------------------------ */
/* Ước lượng độ nghiêng (projection profile)                           */
/* ------------------------------------------------------------------ */

export interface SkewResult {
  /** Góc nghiêng của dòng chữ, độ, dương = dòng đi xuống về bên phải (nghiêng theo chiều kim đồng hồ). */
  angle: number;
  /** Độ cải thiện của điểm profile so với góc 0 (1 = như nhau). */
  gain: number;
  /** Có đủ tin cậy để đề xuất xoay không. */
  confident: boolean;
}

/** Điểm profile: tổng bình phương số điểm mực trong mỗi hàng sau khi cắt chéo theo góc a. */
export function projectionScore(xs: Float32Array, ys: Float32Array, angleDeg: number, bins: number): number {
  const t = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t);
  const off = Math.ceil(Math.abs(sin) * (bins) + 2);
  const prof = new Float64Array(bins + 2 * off + 2);
  for (let i = 0; i < xs.length; i++) {
    const yy = ys[i] * cos - xs[i] * sin;
    prof[Math.round(yy) + off]++;
  }
  let s = 0;
  for (let i = 0; i < prof.length; i++) s += prof[i] * prof[i];
  return s;
}

export function estimateSkew(g: GrayImage, range = 10, step = 0.25): SkewResult {
  const none: SkewResult = { angle: 0, gain: 1, confident: false };
  const { width: w, height: h, data } = g;
  if (w < 20 || h < 20) return none;
  const t = otsuThreshold(histogram(g));
  // điểm mực = phía thiểu số của ngưỡng (chữ thường chiếm ít diện tích hơn nền)
  let dark = 0;
  for (let i = 0; i < data.length; i++) if (data[i] <= t) dark++;
  const inkIsDark = dark <= data.length / 2;
  const maxSide = 600;
  const sc = Math.min(1, maxSide / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * sc)), sh = Math.max(1, Math.round(h * sc));
  const xsArr: number[] = [], ysArr: number[] = [];
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(h - 1, Math.floor(y / sc));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / sc));
      const isDark = data[sy * w + sx] <= t;
      if (isDark === inkIsDark) { xsArr.push(x); ysArr.push(y); }
    }
  }
  if (xsArr.length < 50 || xsArr.length > 0.6 * sw * sh) return none;
  const xs = Float32Array.from(xsArr), ys = Float32Array.from(ysArr);
  const bins = sh + 2;
  const base = projectionScore(xs, ys, 0, bins);
  let best = base, bestAngle = 0;
  const n = Math.round(range / step);
  for (let i = -n; i <= n; i++) {
    const a = i * step;
    if (a === 0) continue;
    const s = projectionScore(xs, ys, a, bins);
    if (s > best * 1.0000001 || (s > best * 0.9999999 && Math.abs(a) < Math.abs(bestAngle))) { best = s; bestAngle = a; }
  }
  // tinh chỉnh quanh góc tốt nhất
  const fine = step / 5;
  for (let k = -4; k <= 4; k++) {
    const a = bestAngle + k * fine;
    if (Math.abs(a) > range) continue;
    const s = projectionScore(xs, ys, a, bins);
    if (s > best) { best = s; bestAngle = a; }
  }
  const gain = base > 0 ? best / base : 1;
  return { angle: Math.round(bestAngle * 100) / 100, gain, confident: Math.abs(bestAngle) >= 0.3 && gain > 1.03 };
}

/* ------------------------------------------------------------------ */
/* Pipeline tiền xử lý                                                  */
/* ------------------------------------------------------------------ */

export type ThresholdMode = 'off' | 'otsu' | 'adaptive';
export type InvertMode = 'off' | 'auto' | 'on';

export interface PreprocessOptions {
  quarterTurns: number;
  /** Góc xoay bổ sung (độ, dương = theo chiều kim đồng hồ); dùng để áp dụng deskew. */
  deskewDeg: number;
  upscale: boolean;
  grayscale: boolean;
  levels: boolean;
  invert: InvertMode;
  denoise: boolean;
  sharpen: boolean;
  threshold: ThresholdMode;
}

export const DEFAULT_PREPROCESS: PreprocessOptions = {
  quarterTurns: 0,
  deskewDeg: 0,
  upscale: true,
  grayscale: false,
  levels: false,
  invert: 'off',
  denoise: false,
  sharpen: false,
  threshold: 'off',
};

export function preprocessSignature(o: PreprocessOptions): string {
  return JSON.stringify(o);
}

export function preprocess(src: RgbaImage, o: PreprocessOptions): RgbaImage {
  let img = rotate90(src, o.quarterTurns);
  if (o.deskewDeg) img = rotateArbitrary(img, o.deskewDeg);
  if (o.upscale) {
    const f = upscaleFactor(img.width, img.height);
    if (f !== 1) img = resizeBilinear(img, img.width * f, img.height * f);
  }
  const needGray = o.grayscale || o.levels || o.invert !== 'off' || o.denoise || o.sharpen || o.threshold !== 'off';
  if (!needGray) return img;
  let g = toGray(img);
  if (o.invert === 'on' || (o.invert === 'auto' && isDarkImage(g))) g = invertGray(g);
  if (o.levels) g = autoLevels(g);
  if (o.denoise) g = median3(g);
  if (o.sharpen) g = sharpen(g);
  if (o.threshold === 'otsu') g = thresholdOtsu(g);
  else if (o.threshold === 'adaptive') g = thresholdAdaptive(g);
  return grayToRgba(g);
}

/* ------------------------------------------------------------------ */
/* Kết quả OCR + hậu xử lý văn bản                                      */
/* ------------------------------------------------------------------ */

export interface OcrWord {
  text: string;
  conf: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
export interface OcrLine {
  para: number;
  words: OcrWord[];
}

/** Cấu trúc tối thiểu của `data.blocks` mà ta cần (khớp Tesseract.Block). */
interface RawBlocks {
  paragraphs?: { lines?: { words?: { text: string; confidence: number; bbox: OcrWord['bbox'] }[] }[] }[];
}

export function linesFromBlocks(blocks: RawBlocks[] | null | undefined): OcrLine[] {
  const out: OcrLine[] = [];
  let para = 0;
  for (const b of blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        const words = (l.words || [])
          .filter((w) => w.text && w.text.trim())
          .map((w) => ({ text: w.text.trim(), conf: Math.max(0, Math.min(100, w.confidence)), bbox: w.bbox }));
        if (words.length) out.push({ para, words });
      }
      para++;
    }
  }
  return out;
}

export interface CleanOptions {
  /** true = giữ xuống dòng; false = nối các dòng cùng đoạn thành đoạn văn. */
  keepLineBreaks: boolean;
  removeNoise: boolean;
  fixConfusions: boolean;
  /** Bỏ khoảng trắng thừa trước dấu câu, gộp nhiều khoảng trắng. */
  tidySpaces: boolean;
}

export const DEFAULT_CLEAN: CleanOptions = { keepLineBreaks: true, removeNoise: true, fixConfusions: false, tidySpaces: true };

/** Sửa nhầm lẫn bảo thủ: chỉ trong ngữ cảnh chữ số (O→0, l/I/|→1 nằm giữa/cạnh chữ số). Không đoán chữ. */
export function fixConfusionsInToken(tok: string): string {
  if (!/\d/.test(tok)) return tok;
  let s = tok;
  // O/o giữa hai chữ số: 1O5 -> 105 (lặp để xử lý 1OO5)
  for (let i = 0; i < 3; i++) s = s.replace(/(\d)[Oo](?=\d|[.,]\d)/g, '$10').replace(/([.,])[Oo](?=\d)/g, '$10');
  for (let i = 0; i < 3; i++) s = s.replace(/(\d)[lI|](?=\d)/g, '$11');
  // token gần như toàn số mà có 1 ký tự lạ ở đầu/cuối: l23 -> 123, 45O -> 450
  if (/^[lI|][\d.,]{2,}$/.test(s)) s = '1' + s.slice(1);
  if (/^[\d.,]{2,}[Oo]$/.test(s)) s = s.slice(0, -1) + '0';
  return s;
}

export function tidyLine(s: string): string {
  return s.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:!?%)\]])/g, '$1').replace(/([(\[])\s+/g, '$1').trim();
}

/** Dòng nhiễu: không có chữ/số nào, hoặc chỉ 1 ký tự chữ-số với độ tin cậy thấp. */
export function isNoiseLine(line: OcrLine): boolean {
  const txt = line.words.map((w) => w.text).join('');
  const alnum = txt.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const conf = line.words.reduce((s, w) => s + w.conf, 0) / line.words.length;
  if (alnum === 0) return txt.length <= 3;
  if (alnum === 1 && line.words.length === 1) return conf < 85;
  return false;
}

export function averageConfidence(lines: OcrLine[]): number {
  let s = 0, n = 0;
  for (const l of lines) for (const w of l.words) { s += w.conf; n++; }
  return n ? s / n : 0;
}

export interface CleanedResult {
  text: string;
  lines: OcrLine[];
  removedLines: number;
}

export function buildCleanedResult(rawLines: OcrLine[], o: CleanOptions): CleanedResult {
  let lines = rawLines.map((l) => ({
    para: l.para,
    words: l.words.map((w) => ({ ...w, text: o.fixConfusions ? fixConfusionsInToken(w.text) : w.text })),
  }));
  let removed = 0;
  if (o.removeNoise) {
    const kept = lines.filter((l) => !isNoiseLine(l));
    removed = lines.length - kept.length;
    lines = kept;
  }
  const lineText = (l: OcrLine) => {
    const t = l.words.map((w) => w.text).join(' ');
    return o.tidySpaces ? tidyLine(t) : t;
  };
  const out: string[] = [];
  if (o.keepLineBreaks) {
    let prev = -1;
    for (const l of lines) {
      if (prev !== -1 && l.para !== prev) out.push('');
      out.push(lineText(l));
      prev = l.para;
    }
    return { text: out.join('\n'), lines, removedLines: removed };
  }
  // nối thành đoạn
  const paras: string[] = [];
  let cur = '';
  let prev = -1;
  for (const l of lines) {
    const t = lineText(l);
    if (prev !== -1 && l.para !== prev) { paras.push(cur); cur = ''; }
    if (!cur) cur = t;
    else if (/[A-Za-zÀ-ỹ]-$/.test(cur) && /^[a-zà-ỹ]/.test(t)) cur = cur.slice(0, -1) + t; // gạch nối cuối dòng
    else cur += ' ' + t;
    prev = l.para;
  }
  if (cur) paras.push(cur);
  return { text: paras.join('\n\n'), lines, removedLines: removed };
}

/* ------------------------------------------------------------------ */
/* Ngôn ngữ, PSM, tiến trình, lỗi                                       */
/* ------------------------------------------------------------------ */

export const OCR_LANGS: { code: string; label: string }[] = [
  { code: 'vie', label: 'Tiếng Việt' },
  { code: 'eng', label: 'Tiếng Anh' },
  { code: 'jpn', label: 'Tiếng Nhật' },
  { code: 'kor', label: 'Tiếng Hàn' },
  { code: 'chi_sim', label: 'Trung giản thể' },
  { code: 'chi_tra', label: 'Trung phồn thể' },
  { code: 'fra', label: 'Tiếng Pháp' },
  { code: 'deu', label: 'Tiếng Đức' },
  { code: 'spa', label: 'Tiếng Tây Ban Nha' },
  { code: 'por', label: 'Tiếng Bồ Đào Nha' },
  { code: 'ita', label: 'Tiếng Ý' },
  { code: 'rus', label: 'Tiếng Nga' },
  { code: 'tha', label: 'Tiếng Thái' },
];
export const DEFAULT_LANGS = ['vie', 'eng'];

export function sanitizeLangs(input: unknown): string[] {
  const valid = new Set(OCR_LANGS.map((l) => l.code));
  const arr = Array.isArray(input) ? input.filter((x): x is string => typeof x === 'string' && valid.has(x)) : [];
  const uniq = Array.from(new Set(arr));
  return uniq.length ? uniq : [...DEFAULT_LANGS];
}

export function langKey(langs: string[]): string {
  return [...langs].sort().join('+');
}

/** Mã ngôn ngữ OCR -> mã 2 chữ cho tác vụ AI. */
export function toAiLang(langs: string[]): string {
  const map: Record<string, string> = { vie: 'vi', eng: 'en', jpn: 'ja', kor: 'ko', chi_sim: 'zh', chi_tra: 'zh', fra: 'fr', deu: 'de', spa: 'es', rus: 'ru', tha: 'th', por: 'pt', ita: 'it' };
  return map[langs[0]] ?? 'auto';
}

export type PsmMode = 'auto' | 'block' | 'line' | 'sparse';
export const PSM_OPTIONS: { id: PsmMode; value: string; label: string }[] = [
  { id: 'auto', value: '3', label: 'Tự động (trang nhiều đoạn)' },
  { id: 'block', value: '6', label: 'Một khối văn bản' },
  { id: 'line', value: '7', label: 'Một dòng' },
  { id: 'sparse', value: '11', label: 'Chữ rải rác (biển báo, sơ đồ)' },
];

export type OcrStage = 'core' | 'lang' | 'init' | 'recognize';
export interface ProgressInfo {
  stage: OcrStage;
  label: string;
  /** 0..1 trong chính giai đoạn */
  stageProgress: number;
  /** 0..1 cho một ảnh */
  overall: number;
}

const STAGES: { match: string; stage: OcrStage; label: string; from: number; to: number }[] = [
  { match: 'loading tesseract core', stage: 'core', label: 'Đang tải lõi OCR', from: 0, to: 0.1 },
  { match: 'initializing tesseract', stage: 'init', label: 'Đang khởi tạo', from: 0.1, to: 0.15 },
  { match: 'loading language traineddata', stage: 'lang', label: 'Đang tải dữ liệu ngôn ngữ', from: 0.15, to: 0.5 },
  { match: 'initializing api', stage: 'init', label: 'Đang khởi tạo mô hình', from: 0.5, to: 0.55 },
  { match: 'recognizing text', stage: 'recognize', label: 'Đang nhận dạng', from: 0.55, to: 1 },
];

/** Ánh xạ thông điệp logger của tesseract.js sang tiến trình xác định. Trả null nếu không nhận ra. */
export function mapProgress(status: string, progress: number): ProgressInfo | null {
  const s = STAGES.find((x) => status.startsWith(x.match));
  if (!s) return null;
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return { stage: s.stage, label: s.label, stageProgress: p, overall: s.from + (s.to - s.from) * p };
}

export type OcrErrorKind = 'offline' | 'blocked' | 'langdata' | 'memory' | 'unknown';
export interface OcrErrorInfo {
  kind: OcrErrorKind;
  message: string;
}

export function classifyOcrError(err: unknown, online: boolean): OcrErrorInfo {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err ?? '');
  const m = raw.toLowerCase();
  if (/content security policy|csp|refused to (load|create|connect)|importscripts|securityerror|blocked/.test(m)) {
    return { kind: 'blocked', message: 'Trình duyệt hoặc chính sách bảo mật (CSP) đang chặn worker/WASM hoặc tải từ CDN. Thử tắt tiện ích chặn quảng cáo/script, mở ở cửa sổ thường (không phải chế độ nghiêm ngặt), hoặc dùng trình duyệt khác.' };
  }
  if (!online || /failed to fetch|networkerror|network error|load failed|err_internet|timeout/.test(m)) {
    return { kind: 'offline', message: online ? 'Không tải được lõi OCR hoặc dữ liệu ngôn ngữ (lỗi mạng hoặc CDN không truy cập được). Kiểm tra kết nối rồi bấm Thử lại.' : 'Bạn đang ngoại tuyến. Lần đầu dùng cần mạng để tải mô hình ngôn ngữ (vài MB); sau đó sẽ dùng được offline. Kết nối mạng rồi bấm Thử lại.' };
  }
  if (/traineddata|404|error opening data file|failed loading language|couldn.t load|could not initialize/.test(m)) {
    return { kind: 'langdata', message: 'Không tải được dữ liệu ngôn ngữ đã chọn (có thể bị chặn hoặc tải dở). Thử chọn lại ngôn ngữ, giảm số ngôn ngữ, hoặc bấm Thử lại.' };
  }
  if (/memory|out of bounds|allocation|rangeerror|aborted\(/.test(m)) {
    return { kind: 'memory', message: 'Thiếu bộ nhớ khi xử lý ảnh. Hãy cắt vùng cần đọc, tắt tự phóng to, hoặc dùng ảnh nhỏ hơn.' };
  }
  return { kind: 'unknown', message: `OCR gặp lỗi không xác định${raw ? `: ${raw.slice(0, 160)}` : ''}. Bấm Thử lại; nếu vẫn lỗi hãy thử ảnh/ngôn ngữ khác.` };
}

/* ------------------------------------------------------------------ */
/* tesseract.js (nạp lười)                                              */
/* ------------------------------------------------------------------ */

export interface OcrWorkerHandle {
  key: string;
  recognize: (
    image: HTMLCanvasElement,
    opts: { psm: string; rectangle?: { left: number; top: number; width: number; height: number } },
  ) => Promise<{ text: string; blocks: unknown; confidence: number }>;
  terminate: () => Promise<void>;
}

/**
 * Tạo worker tesseract.js v7. Gọi CHỈ khi người dùng bấm "Đọc chữ".
 * langPath: để mặc định, v7 tự tải từ jsDelivr `@tesseract.js-data/<lang>/4.0.0_best_int` (LSTM-only, gz) và lưu IndexedDB.
 */
export async function createOcrWorker(langs: string[], onProgress: (p: ProgressInfo) => void): Promise<OcrWorkerHandle> {
  const mod = await import('tesseract.js');
  const createWorker = mod.createWorker ?? mod.default?.createWorker;
  const worker = await createWorker(langs, 1 /* OEM.LSTM_ONLY */, {
    logger: (m) => {
      const p = mapProgress(m.status, m.progress);
      if (p) onProgress(p);
    },
    errorHandler: () => {},
  });
  return {
    key: langKey(langs),
    async recognize(image, opts) {
      await worker.setParameters({ tessedit_pageseg_mode: opts.psm as never, preserve_interword_spaces: '1' });
      const res = await worker.recognize(image, opts.rectangle ? { rectangle: opts.rectangle } : {}, { text: true, blocks: true });
      return { text: res.data.text, blocks: res.data.blocks, confidence: res.data.confidence };
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
