/**
 * Logic thuần cho tool "Tạo ảnh Open Graph" (không phụ thuộc React/canvas).
 * Việc đo chữ được tiêm vào qua `measure(text, font) => width` để test được mà không cần canvas.
 */

// ───────────── kích thước ─────────────

export const OG_SIZES = [
  { id: 'og', label: 'Open Graph 1200×630', w: 1200, h: 630, note: 'Facebook, LinkedIn, Zalo, Slack, Discord' },
  { id: 'x', label: 'X / Twitter 1200×600', w: 1200, h: 600, note: 'summary_large_image (tỉ lệ 2:1)' },
  { id: 'square', label: 'Vuông 1080×1080', w: 1080, h: 1080, note: 'Instagram, bài đăng vuông' },
  { id: 'wide', label: '16:9 1600×900', w: 1600, h: 900, note: 'YouTube, banner 16:9' },
  { id: 'story', label: 'Story 1080×1920', w: 1080, h: 1920, note: 'Story / Reels dọc 9:16' },
] as const;

export type SizeId = (typeof OG_SIZES)[number]['id'];

export function getSize(id: SizeId): { id: SizeId; label: string; w: number; h: number; note: string } {
  return OG_SIZES.find((s) => s.id === id) ?? OG_SIZES[0];
}

export interface SafeZone {
  label: string;
  /** Toạ độ theo pixel của ảnh. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 'keep' = vùng nên giữ nội dung; 'trim' = vùng có thể bị cắt/che. */
  kind: 'keep' | 'trim';
}

/** Các vùng nền tảng có thể cắt/che; dùng để vẽ lớp phủ an toàn trên bản xem trước. */
export function safeZones(w: number, h: number): SafeZone[] {
  const zones: SafeZone[] = [];
  const ratio = w / h;
  // khung vuông ở giữa (một số feed/di động cắt 1:1)
  if (ratio > 1.15 || ratio < 0.87) {
    const sq = Math.min(w, h);
    zones.push({ label: 'Khung vuông 1:1 (một số ứng dụng cắt)', x: (w - sq) / 2, y: (h - sq) / 2, w: sq, h: sq, kind: 'keep' });
  }
  // khung 2:1 cho X/Twitter
  if (ratio > 1.2 && ratio < 2.05) {
    const th = Math.round(w / 2);
    if (th < h) zones.push({ label: 'Khung 2:1 (X/Twitter)', x: 0, y: (h - th) / 2, w, h: th, kind: 'keep' });
  }
  // lề an toàn 5% (góc bo, viền ứng dụng)
  const mx = Math.round(w * 0.05);
  const my = Math.round(h * 0.05);
  zones.push({ label: 'Lề an toàn 5%', x: mx, y: my, w: w - 2 * mx, h: h - 2 * my, kind: 'keep' });
  // story: vùng UI trên/dưới
  if (h / w > 1.6) {
    const top = Math.round(h * 0.13);
    const bot = Math.round(h * 0.13);
    zones.push({ label: 'Vùng giao diện Story (trên)', x: 0, y: 0, w, h: top, kind: 'trim' });
    zones.push({ label: 'Vùng giao diện Story (dưới)', x: 0, y: h - bot, w, h: bot, kind: 'trim' });
  }
  return zones;
}

// ───────────── màu & tương phản (WCAG) ─────────────

export function parseHex(input: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((input ?? '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function isHexColor(s: string): boolean {
  return parseHex(s) !== null;
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Tỉ lệ tương phản WCAG 2.x, từ 1 đến 21. Màu không hợp lệ -> 1. */
export function contrastRatio(a: string, b: string): number {
  if (!parseHex(a) || !parseHex(b)) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Tương phản thấp nhất của `fg` so với danh sách màu nền. */
export function minContrast(fg: string, bgs: string[]): number {
  if (bgs.length === 0) return 1;
  return Math.min(...bgs.map((b) => contrastRatio(fg, b)));
}

export const WCAG_AA = 4.5;

export function pickTextColor(
  bgs: string[],
  light = '#ffffff',
  dark = '#0f172a'
): { color: string; ratio: number } {
  const rl = minContrast(light, bgs);
  const rd = minContrast(dark, bgs);
  return rl >= rd ? { color: light, ratio: rl } : { color: dark, ratio: rd };
}

/** Trộn hai màu hex, t=0 -> a, t=1 -> b. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a) ?? [0, 0, 0];
  const cb = parseHex(b) ?? [0, 0, 0];
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex(ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k);
}

export function withAlpha(hex: string, alpha: number): string {
  const c = parseHex(hex) ?? [0, 0, 0];
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.round(a * 1000) / 1000})`;
}

// ───────────── gradient & ảnh nền ─────────────

/**
 * Đường gradient theo quy ước CSS: 0° hướng lên, 90° hướng sang phải.
 * Độ dài đường = |w·sin a| + |h·cos a| nên gradient luôn chạm đúng 2 góc.
 */
export function gradientLine(w: number, h: number, angleDeg: number): { x0: number; y0: number; x1: number; y1: number } {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = w / 2;
  const cy = h / 2;
  return { x0: cx - (dx * len) / 2, y0: cy - (dy * len) / 2, x1: cx + (dx * len) / 2, y1: cy + (dy * len) / 2 };
}

export function gradientStops(count: 2 | 3): number[] {
  return count === 2 ? [0, 1] : [0, 0.5, 1];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Vẽ ảnh nguồn sw×sh phủ kín khung dw×dh (cover). fx/fy = tiêu điểm 0..1. */
export function coverRect(sw: number, sh: number, dw: number, dh: number, fx = 0.5, fy = 0.5): Rect {
  if (!(sw > 0) || !(sh > 0)) return { x: 0, y: 0, w: dw, h: dh };
  const k = Math.max(dw / sw, dh / sh);
  const w = sw * k;
  const h = sh * k;
  return { x: (dw - w) * fx + 0, y: (dh - h) * fy + 0, w, h };
}

/** Vẽ ảnh nguồn lọt hẳn trong khung (contain), căn giữa. */
export function containRect(sw: number, sh: number, dw: number, dh: number): Rect {
  if (!(sw > 0) || !(sh > 0)) return { x: 0, y: 0, w: dw, h: dh };
  const k = Math.min(dw / sw, dh / sh);
  const w = sw * k;
  const h = sh * k;
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

// ───────────── tách grapheme, ngắt dòng, vừa chữ ─────────────

export type Measure = (text: string, font: string) => number;

const MARK_RE = new RegExp('^[\\p{M}\\u200D\\uFE0E\\uFE0F\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}]$', 'u');

function isRegionalIndicator(g: string): boolean {
  const cp = g.codePointAt(0) ?? 0;
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

/** Tách chuỗi thành "ký tự hiển thị": giữ dấu tổ hợp (tiếng Việt), emoji ZWJ, cờ. */
export function splitGraphemes(str: string): string[] {
  const cps = Array.from(str);
  const out: string[] = [];
  let i = 0;
  while (i < cps.length) {
    let g = cps[i++];
    if (isRegionalIndicator(g) && i < cps.length && isRegionalIndicator(cps[i])) g += cps[i++];
    while (i < cps.length && MARK_RE.test(cps[i])) {
      const c = cps[i++];
      g += c;
      if (c === '‍' && i < cps.length) g += cps[i++];
    }
    out.push(g);
  }
  return out;
}

export function isCjkChar(g: string): boolean {
  const cp = g.codePointAt(0) ?? 0;
  return (
    (cp >= 0x3000 && cp <= 0x30ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xffef) ||
    (cp >= 0x20000 && cp <= 0x2fa1f)
  );
}

// dấu câu không được đứng đầu dòng (kinsoku đơn giản)
const NO_LINE_START = '、。，．：；！？）］｝〉》」』】〕”’ゝゞ々ー・…';

interface Tk {
  t: string;
  kind: 'space' | 'word' | 'cjk';
}

function tokenizeParagraph(par: string): Tk[] {
  const out: Tk[] = [];
  for (const g of splitGraphemes(par)) {
    if (/^\s+$/.test(g)) {
      if (out.length && out[out.length - 1].kind === 'space') continue;
      out.push({ t: ' ', kind: 'space' });
    } else if (isCjkChar(g)) {
      const last = out[out.length - 1];
      if (last && last.kind !== 'space' && NO_LINE_START.includes(g)) last.t += g;
      else out.push({ t: g, kind: 'cjk' });
    } else {
      const last = out[out.length - 1];
      if (last && last.kind === 'word') last.t += g;
      else out.push({ t: g, kind: 'word' });
    }
  }
  return out;
}

const MAX_WRAP_GRAPHEMES = 3000;

function wrapParagraph(par: string, maxWidth: number, font: string, measure: Measure): string[] {
  const w = (s: string) => measure(s, font);
  const lines: string[] = [];
  let cur = '';
  let pendingSpace = false;

  const place = (t: string) => {
    if (w(t) <= maxWidth) {
      cur = t;
      return;
    }
    // từ quá dài: cắt theo grapheme (không tách dấu tổ hợp khỏi chữ gốc)
    let chunk = '';
    for (const g of splitGraphemes(t)) {
      if (chunk !== '' && w(chunk + g) > maxWidth) {
        lines.push(chunk);
        chunk = g;
      } else {
        chunk += g;
      }
    }
    cur = chunk;
  };

  for (const tok of tokenizeParagraph(par)) {
    if (tok.kind === 'space') {
      pendingSpace = cur !== '';
      continue;
    }
    const sep = pendingSpace ? ' ' : '';
    pendingSpace = false;
    if (cur === '') {
      place(tok.t);
    } else if (w(cur + sep + tok.t) <= maxWidth) {
      cur = cur + sep + tok.t;
    } else {
      lines.push(cur);
      cur = '';
      place(tok.t);
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

function addEllipsis(line: string, maxWidth: number, font: string, measure: Measure, ellipsis: string): string {
  const gs = splitGraphemes(line.trimEnd());
  while (gs.length > 0 && measure(gs.join('').trimEnd() + ellipsis, font) > maxWidth) gs.pop();
  return gs.join('').trimEnd() + ellipsis;
}

export interface WrapOptions {
  maxWidth: number;
  font: string;
  measure: Measure;
  maxLines?: number;
  ellipsis?: string;
}

export interface WrapResult {
  lines: string[];
  truncated: boolean;
}

/**
 * Ngắt dòng theo độ rộng: tách theo từ, từ quá dài cắt theo ký tự, CJK ngắt giữa mọi ký tự,
 * giữ nguyên dấu tiếng Việt tổ hợp. Dòng trống bị bỏ. Vượt maxLines -> cắt và thêm "…".
 */
export function wrapText(text: string, opts: WrapOptions): WrapResult {
  const { font, measure } = opts;
  const ellipsis = opts.ellipsis ?? '…';
  const maxWidth = Math.max(1, opts.maxWidth);
  const maxLines = opts.maxLines === undefined ? Infinity : Math.floor(opts.maxLines);
  let src = (text ?? '').normalize('NFC');
  if (src.length > MAX_WRAP_GRAPHEMES * 2) src = src.slice(0, MAX_WRAP_GRAPHEMES * 2);
  const paragraphs = src.split(/\r?\n/).filter((p) => p.trim() !== '');
  if (paragraphs.length === 0) return { lines: [], truncated: false };
  if (maxLines < 1) return { lines: [], truncated: true };

  const lines: string[] = [];
  for (const p of paragraphs) {
    lines.push(...wrapParagraph(p, maxWidth, font, measure));
    if (lines.length > maxLines + 1000) break;
  }
  if (lines.length <= maxLines) return { lines, truncated: false };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = addEllipsis(kept[maxLines - 1], maxWidth, font, measure, ellipsis);
  return { lines: kept, truncated: true };
}

export interface FitOptions {
  text: string;
  maxWidth: number;
  /** Chiều cao tối đa của khối chữ (px); bỏ qua nếu không đặt. */
  maxHeight?: number;
  maxLines: number;
  minSize: number;
  maxSize: number;
  /** Hệ số dãn dòng (line-height / size). */
  lineHeight: number;
  fontFor: (size: number) => string;
  measure: Measure;
  ellipsis?: string;
}

export interface FitResult {
  size: number;
  lines: string[];
  truncated: boolean;
  lineHeightPx: number;
  height: number;
}

/** Tìm cỡ chữ nguyên lớn nhất (nhị phân) để chữ vừa maxLines/maxHeight; không vừa -> minSize + ellipsis. */
export function fitText(o: FitOptions): FitResult {
  const minSize = Math.max(1, Math.floor(Math.min(o.minSize, o.maxSize)));
  const maxSize = Math.max(minSize, Math.floor(o.maxSize));
  const lh = Math.max(0.5, o.lineHeight);
  const maxLines = Math.max(1, Math.floor(o.maxLines));

  const run = (size: number, lines: number): WrapResult =>
    wrapText(o.text, { maxWidth: o.maxWidth, font: o.fontFor(size), measure: o.measure, maxLines: lines, ellipsis: o.ellipsis });
  const heightOf = (n: number, size: number) => n * size * lh;
  const fits = (size: number): WrapResult | null => {
    const r = run(size, maxLines);
    if (r.truncated) return null;
    if (o.maxHeight !== undefined && heightOf(r.lines.length, size) > o.maxHeight + 1e-6) return null;
    return r;
  };
  const build = (size: number, r: WrapResult): FitResult => ({
    size,
    lines: r.lines,
    truncated: r.truncated,
    lineHeightPx: size * lh,
    height: heightOf(r.lines.length, size),
  });

  if ((o.text ?? '').trim() === '') return { size: maxSize, lines: [], truncated: false, lineHeightPx: maxSize * lh, height: 0 };

  const top = fits(maxSize);
  if (top) return build(maxSize, top);

  let lo = minSize;
  let hi = maxSize - 1;
  let best: { size: number; r: WrapResult } | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = fits(mid);
    if (r) {
      best = { size: mid, r };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best) return build(best.size, best.r);

  // không vừa ngay cả ở cỡ nhỏ nhất -> giới hạn số dòng theo chiều cao, thêm "…"
  let lines = maxLines;
  if (o.maxHeight !== undefined) lines = Math.max(1, Math.min(lines, Math.floor(o.maxHeight / (minSize * lh))));
  const r = run(minSize, lines);
  return build(minSize, { lines: r.lines, truncated: true });
}

// ───────────── tokenizer code (tô màu cú pháp đơn giản) ─────────────

export type CodeLang = 'js' | 'ts' | 'python' | 'go' | 'json' | 'shell';
export type TokType = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'prop';
export interface Tok {
  t: string;
  type: TokType;
}

export const CODE_LANGS: { id: CodeLang; label: string }[] = [
  { id: 'js', label: 'JavaScript' },
  { id: 'ts', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'json', label: 'JSON' },
  { id: 'shell', label: 'Shell' },
];

const JS_KW =
  'const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this null undefined true false void yield static super delete';
const KEYWORDS: Record<CodeLang, Set<string>> = {
  js: new Set(JS_KW.split(' ')),
  ts: new Set(
    (JS_KW + ' interface type enum implements public private protected readonly as namespace declare abstract keyof string number boolean any unknown never').split(' ')
  ),
  python: new Set(
    'def class return if elif else for while in not and or is import from as with try except finally raise lambda pass break continue yield None True False async await global nonlocal del assert'.split(' ')
  ),
  go: new Set(
    'package import func return if else for range switch case default break continue go defer select chan map struct interface type var const nil true false fallthrough goto'.split(' ')
  ),
  json: new Set(['true', 'false', 'null']),
  shell: new Set('if then else elif fi for while do done case esac function in echo export cd return exit local'.split(' ')),
};

const NUM_RE = /0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+/y;
const IDENT_RE = /[A-Za-z_$][\w$]*/y;

export const MAX_CODE_LINES = 400;
export const MAX_CODE_LINE_LEN = 400;

/** Tách code thành các dòng token. Không ném lỗi, thời gian tuyến tính. */
export function tokenizeCode(code: string, lang: CodeLang): Tok[][] {
  const kw = KEYWORDS[lang] ?? KEYWORDS.js;
  const hashComment = lang === 'python' || lang === 'shell';
  const slashComment = lang === 'js' || lang === 'ts' || lang === 'go';
  const rawLines = (code ?? '').replace(/\t/g, '  ').split(/\r?\n/).slice(0, MAX_CODE_LINES);
  let block: null | 'comment' | '`' | '"""' | "'''" = null;
  const result: Tok[][] = [];

  for (const raw of rawLines) {
    const line = raw.length > MAX_CODE_LINE_LEN ? raw.slice(0, MAX_CODE_LINE_LEN) : raw;
    const toks: Tok[] = [];
    const push = (t: string, type: TokType) => {
      if (!t) return;
      const last = toks[toks.length - 1];
      if (last && last.type === type && type !== 'keyword') last.t += t;
      else toks.push({ t, type });
    };
    let i = 0;
    const n = line.length;
    while (i < n) {
      if (block === 'comment') {
        const e = line.indexOf('*/', i);
        if (e < 0) {
          push(line.slice(i), 'comment');
          i = n;
        } else {
          push(line.slice(i, e + 2), 'comment');
          i = e + 2;
          block = null;
        }
        continue;
      }
      if (block) {
        let j = i;
        let closed = false;
        while (j < n) {
          if (line[j] === '\\' && block !== '`') {
            j += 2;
            continue;
          }
          if (line.startsWith(block, j)) {
            j += block.length;
            closed = true;
            break;
          }
          j++;
        }
        j = Math.min(j, n);
        push(line.slice(i, j), 'string');
        i = j;
        if (closed) block = null;
        continue;
      }
      const c = line[i];
      if (slashComment && c === '/' && line[i + 1] === '/') {
        push(line.slice(i), 'comment');
        i = n;
        continue;
      }
      if (slashComment && c === '/' && line[i + 1] === '*') {
        push('/*', 'comment');
        i += 2;
        block = 'comment';
        continue;
      }
      if (hashComment && c === '#' && (lang === 'python' || i === 0 || /\s/.test(line[i - 1]))) {
        push(line.slice(i), 'comment');
        i = n;
        continue;
      }
      if (lang === 'python' && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
        block = line.slice(i, i + 3) as '"""' | "'''";
        push(block, 'string');
        i += 3;
        continue;
      }
      if (c === '`' && (lang === 'js' || lang === 'ts' || lang === 'go')) {
        block = '`';
        push('`', 'string');
        i += 1;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && line[j] !== c) {
          if (line[j] === '\\') j++;
          j++;
        }
        const end = Math.min(j + 1, n);
        const s = line.slice(i, end);
        let type: TokType = 'string';
        if (lang === 'json' && /^\s*:/.test(line.slice(end))) type = 'prop';
        push(s, type);
        i = end;
        continue;
      }
      if ((c >= '0' && c <= '9') || (c === '.' && line[i + 1] >= '0' && line[i + 1] <= '9')) {
        NUM_RE.lastIndex = i;
        const m = NUM_RE.exec(line);
        if (m) {
          push(m[0], 'number');
          i += m[0].length;
          continue;
        }
      }
      if (/[A-Za-z_$]/.test(c)) {
        IDENT_RE.lastIndex = i;
        const m = IDENT_RE.exec(line);
        if (m) {
          push(m[0], kw.has(m[0]) ? 'keyword' : 'plain');
          i += m[0].length;
          continue;
        }
      }
      push(c, 'plain');
      i += 1;
    }
    result.push(toks);
  }
  return result;
}

/** Cắt một dòng token còn tối đa maxCols ký tự, thêm "…" nếu bị cắt. */
export function clipTokenLine(tokens: Tok[], maxCols: number): Tok[] {
  const cols = Math.max(1, Math.floor(maxCols));
  const total = tokens.reduce((a, t) => a + t.t.length, 0);
  if (total <= cols) return tokens;
  const out: Tok[] = [];
  let left = cols - 1;
  for (const tk of tokens) {
    if (left <= 0) break;
    if (tk.t.length <= left) {
      out.push(tk);
      left -= tk.t.length;
    } else {
      out.push({ t: tk.t.slice(0, left), type: tk.type });
      left = 0;
    }
  }
  out.push({ t: '…', type: 'plain' });
  return out;
}

// ───────────── PRNG & hoạ tiết ─────────────

/** mulberry32: PRNG có seed, trả số trong [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PatternKind = 'dots' | 'grid' | 'geometric' | 'waves' | 'rings';

export const PATTERN_KINDS: { id: PatternKind; label: string }[] = [
  { id: 'dots', label: 'Chấm bi' },
  { id: 'grid', label: 'Lưới' },
  { id: 'geometric', label: 'Hình học' },
  { id: 'waves', label: 'Sóng' },
  { id: 'rings', label: 'Vòng tròn' },
];

export type PatternShape =
  | { k: 'circle'; x: number; y: number; r: number; a: number; fill: boolean; lw: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; a: number; lw: number }
  | { k: 'poly'; pts: [number, number][]; a: number; fill: boolean; lw: number; closed: boolean };

const MAX_SHAPES = 4000;

/** Sinh hoạ tiết bằng PRNG có seed: cùng seed + kích thước -> cùng kết quả. */
export function generatePattern(kind: PatternKind, w: number, h: number, seed: number): PatternShape[] {
  const rnd = mulberry32(seed);
  const u = Math.min(w / 1200, h / 630);
  const shapes: PatternShape[] = [];
  const add = (s: PatternShape) => {
    if (shapes.length < MAX_SHAPES) shapes.push(s);
  };

  if (kind === 'dots') {
    const g = 44 * u;
    for (let y = g / 2; y < h; y += g) {
      for (let x = g / 2; x < w; x += g) {
        const f = rnd();
        add({ k: 'circle', x, y, r: g * (0.06 + 0.16 * f), a: 0.08 + 0.22 * rnd(), fill: true, lw: 0 });
      }
    }
  } else if (kind === 'grid') {
    const g = 60 * u;
    for (let x = 0; x <= w; x += g) add({ k: 'line', x1: x, y1: 0, x2: x, y2: h, a: 0.14, lw: Math.max(1, u) });
    for (let y = 0; y <= h; y += g) add({ k: 'line', x1: 0, y1: y, x2: w, y2: y, a: 0.14, lw: Math.max(1, u) });
    const cols = Math.floor(w / g);
    const rows = Math.floor(h / g);
    const n = Math.round((cols * rows) / 9);
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(rnd() * cols) * g;
      const cy = Math.floor(rnd() * rows) * g;
      add({ k: 'poly', pts: [[cx, cy], [cx + g, cy], [cx + g, cy + g], [cx, cy + g]], a: 0.06 + 0.14 * rnd(), fill: true, lw: 0, closed: true });
    }
  } else if (kind === 'geometric') {
    const n = 26;
    for (let i = 0; i < n; i++) {
      const cx = rnd() * w;
      const cy = rnd() * h;
      const r = (40 + rnd() * 200) * u;
      const a = 0.05 + 0.17 * rnd();
      const fill = rnd() < 0.55;
      const lw = 2.5 * u;
      const type = Math.floor(rnd() * 4);
      const rot = rnd() * Math.PI * 2;
      if (type === 0) {
        add({ k: 'circle', x: cx, y: cy, r: r * 0.6, a, fill, lw });
      } else {
        const sides = type === 1 ? 3 : type === 2 ? 4 : 6;
        const pts: [number, number][] = [];
        for (let s = 0; s < sides; s++) {
          const ang = rot + (s * Math.PI * 2) / sides;
          pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
        }
        add({ k: 'poly', pts, a, fill, lw, closed: true });
      }
    }
  } else if (kind === 'waves') {
    const layers = 7;
    for (let i = 0; i < layers; i++) {
      const base = h * (0.3 + (i / layers) * 0.75);
      const amp = (18 + rnd() * 50) * u;
      const freq = (1 + rnd() * 2.2) * ((Math.PI * 2) / w);
      const phase = rnd() * Math.PI * 2;
      const pts: [number, number][] = [];
      const step = Math.max(6, 8 * u);
      for (let x = 0; x <= w + step; x += step) pts.push([x, base + Math.sin(x * freq + phase) * amp]);
      pts.push([w + step, h], [0, h]);
      add({ k: 'poly', pts, a: 0.05 + 0.04 * i, fill: true, lw: 0, closed: true });
    }
  } else {
    const corner = Math.floor(rnd() * 4);
    const cx = corner % 2 === 0 ? -0.05 * w : 1.05 * w;
    const cy = corner < 2 ? -0.1 * h : 1.1 * h;
    const gap = 46 * u;
    const maxR = Math.hypot(w, h);
    for (let r = gap, i = 0; r < maxR; r += gap, i++) {
      add({ k: 'circle', x: cx, y: cy, r, a: Math.max(0.04, 0.26 - i * 0.012), fill: false, lw: 2.5 * u });
    }
  }
  return shapes;
}

// ───────────── tiện ích chuỗi/xuất ─────────────

export function formatBytes(n: number): string {
  if (!isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function slugify(s: string, fallback = 'og-image'): string {
  const out = (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return out || fallback;
}

export type ExportFormat = 'png' | 'jpeg' | 'webp';
export const FORMAT_INFO: Record<ExportFormat, { mime: string; ext: string; label: string }> = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG' },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' },
};

export const LIMIT_TWITTER = 5 * 1024 * 1024;
export const LIMIT_FACEBOOK = 8 * 1024 * 1024;

export function exportWarnings(bytes: number, format: ExportFormat): string[] {
  const out: string[] = [];
  if (bytes > LIMIT_FACEBOOK) out.push('Vượt 8 MB: Facebook khuyến nghị ảnh dưới 8 MB, X/Twitter tối đa 5 MB.');
  else if (bytes > LIMIT_TWITTER) out.push('Vượt 5 MB: X/Twitter từ chối ảnh thẻ lớn hơn 5 MB. Hãy dùng JPEG/WebP hoặc giảm chất lượng.');
  else if (bytes > 1024 * 1024) out.push('Trên 1 MB: vẫn dùng được (X tối đa 5 MB, Facebook khuyến nghị < 8 MB) nhưng nên nén xuống dưới 1 MB để thẻ tải nhanh.');
  if (format === 'webp') out.push('WebP: một số ứng dụng/crawler chia sẻ chưa hiển thị tốt. PNG hoặc JPEG tương thích nhất.');
  return out;
}

export function escapeAttr(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Trả thông báo lỗi tiếng Việt nếu URL ảnh không hợp lệ cho og:image, hoặc null nếu ổn/để trống. */
export function checkImageUrl(url: string): string | null {
  const u = (url ?? '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) return 'og:image cần URL tuyệt đối bắt đầu bằng https:// (hoặc http://).';
  try {
    new URL(u);
  } catch {
    return 'URL ảnh không hợp lệ.';
  }
  if (/^http:\/\//i.test(u)) return 'Nên dùng https:// để mọi nền tảng tải được ảnh.';
  return null;
}

export function twitterCardFor(w: number, h: number): 'summary_large_image' | 'summary' {
  return h > 0 && w / h >= 1.5 ? 'summary_large_image' : 'summary';
}

export const DEFAULT_IMAGE_URL = 'https://example.com/og-image.png';

export function buildMetaSnippet(o: { imageUrl: string; width: number; height: number; alt: string; mime: string }): string {
  const url = escapeAttr((o.imageUrl || '').trim() || DEFAULT_IMAGE_URL);
  const alt = escapeAttr((o.alt || '').trim().replace(/\s+/g, ' '));
  const lines = [
    `<meta property="og:image" content="${url}" />`,
    `<meta property="og:image:type" content="${o.mime}" />`,
    `<meta property="og:image:width" content="${Math.round(o.width)}" />`,
    `<meta property="og:image:height" content="${Math.round(o.height)}" />`,
    `<meta property="og:image:alt" content="${alt}" />`,
    `<meta name="twitter:card" content="${twitterCardFor(o.width, o.height)}" />`,
    `<meta name="twitter:image" content="${url}" />`,
    `<meta name="twitter:image:alt" content="${alt}" />`,
  ];
  return lines.join('\n');
}

// ───────────── cài đặt ─────────────

export type TemplateId = 'hero' | 'blog' | 'code' | 'github' | 'launch' | 'minimal' | 'pattern' | 'photo';
export const TEMPLATES: { id: TemplateId; label: string; hint: string }[] = [
  { id: 'hero', label: 'Gradient hero', hint: 'Tiêu đề lớn trên nền gradient' },
  { id: 'blog', label: 'Blog bài viết', hint: 'Tiêu đề + tác giả + ngày + thời gian đọc' },
  { id: 'code', label: 'Code card', hint: 'Khung cửa sổ với đoạn code tô màu' },
  { id: 'github', label: 'GitHub repo card', hint: 'Tên repo, mô tả, sao/fork/issue, topic' },
  { id: 'launch', label: 'Ra mắt sản phẩm', hint: 'Tiêu đề lớn, phụ đề, nút CTA, logo' },
  { id: 'minimal', label: 'Tối giản', hint: 'Nền tối, chữ gọn' },
  { id: 'pattern', label: 'Họa tiết', hint: 'Nền hoạ tiết sinh bằng seed' },
  { id: 'photo', label: 'Ảnh + chữ', hint: 'Ảnh nền hoặc chia đôi, có lớp phủ' },
];

export type FontId = 'sans' | 'serif' | 'mono' | 'rounded';
export const FONT_STACKS: { id: FontId; label: string; stack: string }[] = [
  { id: 'sans', label: 'Sans (hệ thống)', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", "Noto Serif", serif' },
  { id: 'mono', label: 'Monospace', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' },
  { id: 'rounded', label: 'Bo tròn', stack: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif' },
];
export const EMOJI_FONTS = ', "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla"';

export type BgType = 'solid' | 'gradient2' | 'gradient3' | 'image';
export type Align = 'left' | 'center' | 'right';
export type LogoShape = 'circle' | 'rounded' | 'none';
export type PhotoLayout = 'full' | 'left' | 'right';

export interface OgSettings {
  size: SizeId;
  template: TemplateId;
  title: string;
  subtitle: string;
  author: string;
  tag: string;
  date: string;
  readTime: string;
  url: string;
  cta: string;
  code: string;
  codeLang: CodeLang;
  ghLang: string;
  ghStars: string;
  ghForks: string;
  ghIssues: string;
  topics: string;
  bgType: BgType;
  c1: string;
  c2: string;
  c3: string;
  angle: number;
  overlayTone: 'dark' | 'light';
  overlayOpacity: number;
  blur: number;
  accent: string;
  textAuto: boolean;
  textColor: string;
  fontFamily: FontId;
  weight: number;
  align: Align;
  padding: number;
  titleAuto: boolean;
  titleSize: number;
  maxLines: number;
  logoShape: LogoShape;
  patternKind: PatternKind;
  patternSeed: number;
  photoLayout: PhotoLayout;
  format: ExportFormat;
  quality: number;
  imageUrl: string;
  alt: string;
}

export const SAMPLE_CODE = `// Tạo ảnh Open Graph
async function render(title, opts = {}) {
  const size = opts.size ?? 1200;
  const res = await fetch(\`/api/og?t=\${title}\`);
  return res.ok ? res.blob() : null;
}`;

export const DEFAULT_SETTINGS: OgSettings = {
  size: 'og',
  template: 'hero',
  title: 'Hướng dẫn tối ưu ảnh Open Graph cho website',
  subtitle: 'Tạo ảnh chia sẻ đẹp, đúng kích thước cho Facebook, X và LinkedIn',
  author: 'Nguyễn Văn An',
  tag: 'Hướng dẫn',
  date: '08/10/2026',
  readTime: '5 phút đọc',
  url: 'example.com',
  cta: 'Dùng thử miễn phí',
  code: SAMPLE_CODE,
  codeLang: 'js',
  ghLang: 'TypeScript',
  ghStars: '12.4k',
  ghForks: '1.8k',
  ghIssues: '42',
  topics: 'react, nextjs, tools',
  bgType: 'gradient2',
  c1: '#4f46e5',
  c2: '#0ea5e9',
  c3: '#14b8a6',
  angle: 135,
  overlayTone: 'dark',
  overlayOpacity: 45,
  blur: 0,
  accent: '#fbbf24',
  textAuto: true,
  textColor: '#ffffff',
  fontFamily: 'sans',
  weight: 800,
  align: 'left',
  padding: 72,
  titleAuto: true,
  titleSize: 76,
  maxLines: 3,
  logoShape: 'circle',
  patternKind: 'geometric',
  patternSeed: 7,
  photoLayout: 'full',
  format: 'png',
  quality: 0.9,
  imageUrl: '',
  alt: '',
};

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fb: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fb;
}
function str(v: unknown, fb: string, max = 600): string {
  return typeof v === 'string' ? v.slice(0, max) : fb;
}
function num(v: unknown, fb: number, lo: number, hi: number): number {
  return typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fb;
}
function color(v: unknown, fb: string): string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fb;
}
function bool(v: unknown, fb: boolean): boolean {
  return typeof v === 'boolean' ? v : fb;
}

/** Làm sạch dữ liệu đọc từ localStorage/URL: giá trị sai kiểu/ngoài khoảng được thay bằng mặc định. */
export function sanitizeSettings(input: unknown): OgSettings {
  const d = DEFAULT_SETTINGS;
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    size: oneOf(o.size, OG_SIZES.map((s) => s.id), d.size),
    template: oneOf(o.template, TEMPLATES.map((t) => t.id), d.template),
    title: str(o.title, d.title, 300),
    subtitle: str(o.subtitle, d.subtitle, 400),
    author: str(o.author, d.author, 80),
    tag: str(o.tag, d.tag, 60),
    date: str(o.date, d.date, 40),
    readTime: str(o.readTime, d.readTime, 40),
    url: str(o.url, d.url, 120),
    cta: str(o.cta, d.cta, 60),
    code: str(o.code, d.code, 4000),
    codeLang: oneOf(o.codeLang, CODE_LANGS.map((l) => l.id), d.codeLang),
    ghLang: str(o.ghLang, d.ghLang, 40),
    ghStars: str(o.ghStars, d.ghStars, 12),
    ghForks: str(o.ghForks, d.ghForks, 12),
    ghIssues: str(o.ghIssues, d.ghIssues, 12),
    topics: str(o.topics, d.topics, 200),
    bgType: oneOf(o.bgType, ['solid', 'gradient2', 'gradient3', 'image'] as const, d.bgType),
    c1: color(o.c1, d.c1),
    c2: color(o.c2, d.c2),
    c3: color(o.c3, d.c3),
    angle: Math.round(num(o.angle, d.angle, 0, 360)),
    overlayTone: oneOf(o.overlayTone, ['dark', 'light'] as const, d.overlayTone),
    overlayOpacity: Math.round(num(o.overlayOpacity, d.overlayOpacity, 0, 90)),
    blur: Math.round(num(o.blur, d.blur, 0, 30)),
    accent: color(o.accent, d.accent),
    textAuto: bool(o.textAuto, d.textAuto),
    textColor: color(o.textColor, d.textColor),
    fontFamily: oneOf(o.fontFamily, FONT_STACKS.map((f) => f.id), d.fontFamily),
    weight: Math.round(num(o.weight, d.weight, 300, 900) / 100) * 100,
    align: oneOf(o.align, ['left', 'center', 'right'] as const, d.align),
    padding: Math.round(num(o.padding, d.padding, 16, 160)),
    titleAuto: bool(o.titleAuto, d.titleAuto),
    titleSize: Math.round(num(o.titleSize, d.titleSize, 20, 220)),
    maxLines: Math.round(num(o.maxLines, d.maxLines, 1, 6)),
    logoShape: oneOf(o.logoShape, ['circle', 'rounded', 'none'] as const, d.logoShape),
    patternKind: oneOf(o.patternKind, PATTERN_KINDS.map((p) => p.id), d.patternKind),
    patternSeed: Math.round(num(o.patternSeed, d.patternSeed, 0, 999999)),
    photoLayout: oneOf(o.photoLayout, ['full', 'left', 'right'] as const, d.photoLayout),
    format: oneOf(o.format, ['png', 'jpeg', 'webp'] as const, d.format),
    quality: num(o.quality, d.quality, 0.3, 1),
    imageUrl: str(o.imageUrl, d.imageUrl, 500),
    alt: str(o.alt, d.alt, 300),
  };
}

export const MINIMAL_BG = '#0a0a0b';
export const CODE_CARD_BG = '#0d1117';

/**
 * Các màu nền đại diện cho vùng chữ, dùng để tính tương phản.
 * Với ảnh nền chỉ ước lượng: lớp phủ trộn lên màu xám trung bình.
 */
export function backgroundSamples(s: OgSettings, hasImage: boolean): string[] {
  if (s.template === 'minimal') return [MINIMAL_BG];
  const flat = (): string[] => (s.bgType === 'solid' ? [s.c1] : s.bgType === 'gradient3' ? [s.c1, s.c2, s.c3] : [s.c1, s.c2]);
  if (s.template === 'photo' && s.photoLayout !== 'full') return flat();
  if (s.bgType === 'image') {
    if (!hasImage) return [s.c1, s.c2];
    const tone = s.overlayTone === 'dark' ? '#000000' : '#ffffff';
    return [mixHex('#808080', tone, s.overlayOpacity / 100)];
  }
  return flat();
}

/** Chữ màu nào + tỉ lệ tương phản kết quả (tự động hoặc thủ công) cho cài đặt hiện tại. */
export function resolveTextColor(s: OgSettings, hasImage: boolean): { color: string; ratio: number; warn: boolean } {
  const bgs = backgroundSamples(s, hasImage);
  if (s.textAuto) {
    const p = pickTextColor(bgs);
    return { color: p.color, ratio: p.ratio, warn: p.ratio < WCAG_AA };
  }
  const ratio = minContrast(s.textColor, bgs);
  return { color: s.textColor, ratio, warn: ratio < WCAG_AA };
}

// màu ngôn ngữ lập trình thường gặp (GitHub linguist)
export const LANG_COLORS: Record<string, string> = {
  typescript: '#3178c6',
  javascript: '#f1e05a',
  python: '#3572a5',
  go: '#00add8',
  rust: '#dea584',
  java: '#b07219',
  'c++': '#f34b7d',
  'c#': '#178600',
  c: '#555555',
  ruby: '#701516',
  php: '#4f5d95',
  swift: '#f05138',
  kotlin: '#a97bff',
  html: '#e34c26',
  css: '#563d7c',
  shell: '#89e051',
  vue: '#41b883',
  dart: '#00b4ab',
};

export function langColor(name: string): string {
  return LANG_COLORS[(name ?? '').trim().toLowerCase()] ?? '#94a3b8';
}

export function parseTopics(s: string, max = 6): string[] {
  return (s ?? '')
    .split(/[,\n;]+/)
    .map((t) => t.trim().replace(/^#/, '').replace(/\s+/g, '-'))
    .filter(Boolean)
    .slice(0, max);
}
