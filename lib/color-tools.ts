/** Chuyển đổi & tính toán màu (không phụ thuộc React). */

export interface RGBA { r: number; g: number; b: number; a: number }
export interface HSL { h: number; s: number; l: number }
export interface HSV { h: number; s: number; v: number }

const NAMED = 'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';
const NAMED_MAP: Record<string, string> = Object.fromEntries(NAMED.split(',').map((p) => p.split(':') as [string, string]));

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round = (n: number, d = 0) => { const f = 10 ** d; return Math.round(n * f) / f; };

function hexToRgba(hex: string): RGBA | null {
  let h = hex.replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? round(parseInt(h.slice(6, 8), 16) / 255, 3) : 1,
  };
}

function parseNum(s: string, percentScale: number): number | null {
  s = s.trim();
  if (s === 'none') return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|turn|rad|grad)?$/i.exec(s);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = (m[2] || '').toLowerCase();
  if (u === '%') return (v / 100) * percentScale;
  return v;
}

function parseHue(s: string): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/i.exec(s.trim());
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = (m[2] || 'deg').toLowerCase();
  const deg = u === 'turn' ? v * 360 : u === 'rad' ? (v * 180) / Math.PI : u === 'grad' ? v * 0.9 : v;
  return ((deg % 360) + 360) % 360;
}

function parseAlpha(s: string | undefined): number | null {
  if (s === undefined) return 1;
  const v = parseNum(s, 1);
  return v === null ? null : clamp(v, 0, 1);
}

/** Phân tích chuỗi màu: HEX 3/4/6/8, rgb(a), hsl(a), hwb, tên CSS. Trả về null nếu không hợp lệ. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED_MAP[s]) return hexToRgba(NAMED_MAP[s]);
  if (/^#?[0-9a-f]{3,8}$/.test(s) && (s.startsWith('#') || /^[0-9a-f]{3,8}$/.test(s))) {
    return hexToRgba(s);
  }
  const m = /^(rgba?|hsla?|hwb)\(\s*(.*?)\s*\)$/.exec(s);
  if (!m) return null;
  const fn = m[1];
  const parts = m[2].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const alpha = parseAlpha(parts[3]);
  if (alpha === null) return null;
  if (fn.startsWith('rgb')) {
    const c = parts.slice(0, 3).map((p) => parseNum(p, 255));
    if (c.some((v) => v === null)) return null;
    return { r: Math.round(clamp(c[0]!, 0, 255)), g: Math.round(clamp(c[1]!, 0, 255)), b: Math.round(clamp(c[2]!, 0, 255)), a: alpha };
  }
  const h = parseHue(parts[0]);
  const x = parseNum(parts[1], 100);
  const y = parseNum(parts[2], 100);
  if (h === null || x === null || y === null) return null;
  if (fn === 'hwb') {
    const w = clamp(x, 0, 100) / 100;
    const bl = clamp(y, 0, 100) / 100;
    if (w + bl >= 1) { const g = Math.round((w / (w + bl)) * 255); return { r: g, g, b: g, a: alpha }; }
    const { r, g, b } = hslToRgb({ h, s: 100, l: 50 });
    const f = (v: number) => Math.round((v / 255) * (1 - w - bl) * 255 + w * 255);
    return { r: f(r), g: f(g), b: f(b), a: alpha };
  }
  const { r, g, b } = hslToRgb({ h, s: clamp(x, 0, 100), l: clamp(y, 0, 100) });
  return { r, g, b, a: alpha };
}

export function hslToRgb({ h, s, l }: HSL): { r: number; g: number; b: number } {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

export function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): HSL {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: round(h, 1), s: round(s * 100, 1), l: round(l * 100, 1) };
}

export function rgbToHsv({ r, g, b }: { r: number; g: number; b: number }): HSV {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const d = max - min;
  const hsl = rgbToHsl({ r, g, b });
  return { h: hsl.h, s: round(max === 0 ? 0 : (d / max) * 100, 1), v: round(max * 100, 1) };
}

export function rgbToCmyk({ r, g, b }: { r: number; g: number; b: number }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const k = 1 - Math.max(R, G, B);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: round(((1 - R - k) / (1 - k)) * 100, 1),
    m: round(((1 - G - k) / (1 - k)) * 100, 1),
    y: round(((1 - B - k) / (1 - k)) * 100, 1),
    k: round(k * 100, 1),
  };
}

export function toHex(c: { r: number; g: number; b: number; a?: number }, withAlpha = false): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return withAlpha && c.a !== undefined && c.a < 1 ? base + h(c.a * 255) : base;
}

const fmt = (n: number) => String(round(n, 1));
export function toRgbString(c: RGBA): string {
  return c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${round(c.a, 3)})` : `rgb(${c.r}, ${c.g}, ${c.b})`;
}
export function toHslString(c: RGBA): string {
  const { h, s, l } = rgbToHsl(c);
  return c.a < 1 ? `hsla(${fmt(h)}, ${fmt(s)}%, ${fmt(l)}%, ${round(c.a, 3)})` : `hsl(${fmt(h)}, ${fmt(s)}%, ${fmt(l)}%)`;
}
export function toHsvString(c: RGBA): string {
  const { h, s, v } = rgbToHsv(c);
  return `hsv(${fmt(h)}, ${fmt(s)}%, ${fmt(v)}%)`;
}
export function toCmykString(c: RGBA): string {
  const { c: C, m, y, k } = rgbToCmyk(c);
  return `cmyk(${fmt(C)}%, ${fmt(m)}%, ${fmt(y)}%, ${fmt(k)}%)`;
}

/** Tên màu CSS khớp chính xác (nếu có). */
export function exactColorName(c: RGBA): string | null {
  if (c.a < 1) return null;
  const hex = toHex(c).slice(1);
  const e = Object.entries(NAMED_MAP).find(([, v]) => v === hex);
  return e ? e[0] : null;
}

// ---------- Bảng màu phái sinh ----------
const fromHsl = (h: number, s: number, l: number): RGBA => ({
  ...hslToRgb({ h: ((h % 360) + 360) % 360, s: clamp(s, 0, 100), l: clamp(l, 0, 100) }),
  a: 1,
});

export function rotateHue(c: RGBA, deg: number): RGBA {
  const { h, s, l } = rgbToHsl(c);
  return { ...fromHsl(h + deg, s, l), a: c.a };
}

export interface Palettes {
  complementary: string[];
  analogous: string[];
  triadic: string[];
  tetradic: string[];
  shades: string[];
  tints: string[];
}

export function buildPalettes(c: RGBA): Palettes {
  const { h, s, l } = rgbToHsl(c);
  const hx = (deg: number) => toHex(fromHsl(h + deg, s, l));
  const steps = [1, 2, 3, 4, 5];
  return {
    complementary: [toHex(c), hx(180)],
    analogous: [hx(-30), toHex(c), hx(30)],
    triadic: [toHex(c), hx(120), hx(240)],
    tetradic: [toHex(c), hx(90), hx(180), hx(270)],
    shades: steps.map((i) => toHex(fromHsl(h, s, l * (1 - i / 6)))),
    tints: steps.map((i) => toHex(fromHsl(h, s, l + (100 - l) * (i / 6)))),
  };
}

// ---------- WCAG ----------
export function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const l1 = relativeLuminance(a), l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export interface WcagResult {
  ratio: number;
  aaNormal: boolean; aaLarge: boolean; aaaNormal: boolean; aaaLarge: boolean; ui: boolean;
}
export function wcag(fg: RGBA, bg: RGBA): WcagResult {
  const ratio = contrastRatio(fg, bg);
  return { ratio, aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, aaaLarge: ratio >= 4.5, ui: ratio >= 3 };
}

/** Điều chỉnh độ sáng của `fg` (giữ nguyên sắc độ) cho đến khi đạt tỉ lệ `target`. Null nếu không thể. */
export function suggestForeground(fg: RGBA, bg: RGBA, target = 4.5): RGBA | null {
  if (contrastRatio(fg, bg) >= target) return fg;
  const { h, s, l } = rgbToHsl(fg);
  const tryDir = (dir: 1 | -1): RGBA | null => {
    for (let step = 0; step <= 200; step++) {
      const nl = l + (dir * step) / 2;
      if (nl < 0 || nl > 100) return null;
      const cand = fromHsl(h, s, nl);
      if (contrastRatio(cand, bg) >= target) return { ...cand, a: fg.a };
    }
    return null;
  };
  const bgDark = relativeLuminance(bg) < 0.18;
  const first = bgDark ? 1 : -1;
  return tryDir(first as 1 | -1) ?? tryDir((-first) as 1 | -1);
}

// ---------- Gradient ----------
export type GradientType = 'linear' | 'radial' | 'conic';
export interface ColorStop { color: string; pos: number }
export interface GradientSpec { type: GradientType; angle: number; stops: ColorStop[] }

export function gradientCss(g: GradientSpec): string {
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${round(s.pos, 1)}%`).join(', ');
  const prefix = g.type === 'linear' ? `linear-gradient(${Math.round(g.angle)}deg, ` : g.type === 'radial' ? 'radial-gradient(circle, ' : `conic-gradient(from ${Math.round(g.angle)}deg, `;
  return prefix + stops + ')';
}

/** Lớp Tailwind giá trị tùy ý: khoảng trắng thay bằng `_`. */
export function gradientTailwind(g: GradientSpec): string {
  return `bg-[${gradientCss(g).replace(/, /g, ',').replace(/ /g, '_')}]`;
}

export function randomHex(rand: () => number = Math.random): string {
  return toHex(fromHsl(rand() * 360, 55 + rand() * 40, 40 + rand() * 25));
}

export function randomGradient(rand: () => number = Math.random): GradientSpec {
  const n = 2 + Math.floor(rand() * 2);
  const type: GradientType = (['linear', 'linear', 'radial', 'conic'] as const)[Math.floor(rand() * 4)];
  return {
    type,
    angle: Math.floor(rand() * 360),
    stops: Array.from({ length: n }, (_, i) => ({ color: randomHex(rand), pos: Math.round((i / (n - 1)) * 100) })),
  };
}

export const GRADIENT_PRESETS: { name: string; spec: GradientSpec }[] = [
  { name: 'Hoàng hôn', spec: { type: 'linear', angle: 135, stops: [{ color: '#ff7e5f', pos: 0 }, { color: '#feb47b', pos: 100 }] } },
  { name: 'Đại dương', spec: { type: 'linear', angle: 90, stops: [{ color: '#2193b0', pos: 0 }, { color: '#6dd5ed', pos: 100 }] } },
  { name: 'Oải hương', spec: { type: 'linear', angle: 45, stops: [{ color: '#667eea', pos: 0 }, { color: '#764ba2', pos: 100 }] } },
  { name: 'Rừng xanh', spec: { type: 'linear', angle: 160, stops: [{ color: '#11998e', pos: 0 }, { color: '#38ef7d', pos: 100 }] } },
  { name: 'Cầu vồng', spec: { type: 'linear', angle: 90, stops: [{ color: '#ef4444', pos: 0 }, { color: '#f59e0b', pos: 25 }, { color: '#10b981', pos: 50 }, { color: '#3b82f6', pos: 75 }, { color: '#8b5cf6', pos: 100 }] } },
  { name: 'Tia sáng', spec: { type: 'radial', angle: 0, stops: [{ color: '#fff7ad', pos: 0 }, { color: '#ffa9f9', pos: 100 }] } },
  { name: 'Bánh xe màu', spec: { type: 'conic', angle: 0, stops: [{ color: '#ff0000', pos: 0 }, { color: '#ffff00', pos: 17 }, { color: '#00ff00', pos: 33 }, { color: '#00ffff', pos: 50 }, { color: '#0000ff', pos: 67 }, { color: '#ff00ff', pos: 83 }, { color: '#ff0000', pos: 100 }] } },
];
