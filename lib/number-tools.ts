/**
 * Hệ cơ số, Bit & IEEE-754 — logic thuần (không phụ thuộc React).
 * Dùng BigInt ở mọi nơi cần chính xác. (Không dùng literal `10n` vì target ES2017.)
 */

const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const B5 = BigInt(5);
const B8 = BigInt(8);
const B10 = BigInt(10);
const B255 = BigInt(255);

export const MAX_DIGITS = 20000;

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* 1. Đổi cơ số                                                        */
/* ------------------------------------------------------------------ */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export interface ParsedInt {
  value: bigint;
  base: number;
  prefix: string | null;
}

/** Phân tích số nguyên (có thể âm, có tiền tố 0x/0b/0o, ngăn cách _ hoặc khoảng trắng). */
export function parseInteger(text: string, base: number): Result<ParsedInt> {
  if (!Number.isInteger(base) || base < 2 || base > 36) return { ok: false, error: 'Cơ số phải nằm trong khoảng 2–36.' };
  let s = text.replace(/[\s_,]/g, '');
  if (s === '') return { ok: false, error: 'Chưa nhập số.' };
  let neg = false;
  if (s[0] === '-' || s[0] === '+') {
    neg = s[0] === '-';
    s = s.slice(1);
  }
  let usedBase = base;
  let prefix: string | null = null;
  const m = /^0([xbo])/i.exec(s);
  if (m && s.length > 2) {
    const p = m[1].toLowerCase();
    if (p === 'x' && (base === 16 || base < 34)) usedBase = 16;
    else if (p === 'b' && base <= 11) usedBase = 2;
    else if (p === 'o' && base < 25) usedBase = 8;
    if (usedBase !== base || (usedBase === 16 && p === 'x')) {
      prefix = '0' + p;
      s = s.slice(2);
    }
  }
  if (s === '') return { ok: false, error: 'Chưa nhập chữ số nào sau tiền tố.' };
  if (s.length > MAX_DIGITS) return { ok: false, error: `Số quá dài (tối đa ${MAX_DIGITS} chữ số).` };
  s = s.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const d = DIGITS.indexOf(s[i]);
    if (d < 0 || d >= usedBase) {
      return { ok: false, error: `Ký tự "${s[i]}" không hợp lệ trong hệ cơ số ${usedBase}.` };
    }
  }
  let v: bigint;
  if (usedBase === 16 || usedBase === 2 || usedBase === 8) {
    const pre = usedBase === 16 ? '0x' : usedBase === 2 ? '0b' : '0o';
    v = BigInt(pre + s);
  } else {
    v = B0;
    const bb = BigInt(usedBase);
    // Gom nhóm để giảm số phép nhân BigInt.
    let chunk = 0;
    let chunkMul = 1;
    const flush = () => {
      v = v * BigInt(chunkMul) + BigInt(chunk);
      chunk = 0;
      chunkMul = 1;
    };
    void bb;
    for (let i = 0; i < s.length; i++) {
      chunk = chunk * usedBase + DIGITS.indexOf(s[i]);
      chunkMul *= usedBase;
      if (chunkMul > 1e9) flush();
    }
    flush();
  }
  return { ok: true, value: neg ? -v : v, base: usedBase, prefix };
}

export function toBase(v: bigint, base: number): string {
  return v.toString(base);
}

/** Chèn dấu cách mỗi `n` ký tự tính từ bên phải (giữ dấu âm). */
export function groupDigits(str: string, n: number, sep = ' '): string {
  let sign = '';
  let s = str;
  if (s[0] === '-') {
    sign = '-';
    s = s.slice(1);
  }
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= n) parts.unshift(s.slice(Math.max(0, i - n), i));
  return sign + parts.join(sep);
}

export const WIDTHS = [8, 16, 32, 64, 128] as const;

export interface WidthInfo {
  width: number;
  /** Mẫu bit (không dấu) sau khi cắt về `width` bit = bù 2 của giá trị. */
  unsigned: bigint;
  signed: bigint;
  bin: string;
  hex: string;
  fitsUnsigned: boolean;
  fitsSigned: boolean;
  /** Cắt bớt làm mất thông tin? (không vừa cả hai cách hiểu) */
  overflow: boolean;
}

export function widthInfo(v: bigint, width: number): WidthInfo {
  const unsigned = BigInt.asUintN(width, v);
  const signed = BigInt.asIntN(width, v);
  const max = B1 << BigInt(width);
  const half = B1 << BigInt(width - 1);
  const fitsUnsigned = v >= B0 && v < max;
  const fitsSigned = v >= -half && v < half;
  return {
    width,
    unsigned,
    signed,
    bin: unsigned.toString(2).padStart(width, '0'),
    hex: unsigned.toString(16).toUpperCase().padStart(width / 4, '0'),
    fitsUnsigned,
    fitsSigned,
    overflow: !fitsUnsigned && !fitsSigned,
  };
}

/** Số bit tối thiểu để biểu diễn (không dấu theo |v|; có dấu bù 2). */
export function minBits(v: bigint): { unsigned: number; signed: number } {
  const abs = v < B0 ? -v : v;
  const u = abs === B0 ? 1 : abs.toString(2).length;
  let s: number;
  if (v >= B0) s = u + 1;
  else {
    // -2^(k-1) cần k bit
    const m = (-v - B1).toString(2);
    s = (v === -B1 ? 0 : m.length) + 1;
  }
  return { unsigned: u, signed: s };
}

/* ------------------------------------------------------------------ */
/* 2. Thao tác bit                                                     */
/* ------------------------------------------------------------------ */

export function mask(width: number): bigint {
  return (B1 << BigInt(width)) - B1;
}

export type BitOp = 'and' | 'or' | 'xor' | 'not' | 'shl' | 'shr' | 'ushr' | 'rotl' | 'rotr';

export const BIT_OPS: { id: BitOp; label: string; unary?: boolean; shift?: boolean }[] = [
  { id: 'and', label: 'A & B' },
  { id: 'or', label: 'A | B' },
  { id: 'xor', label: 'A ^ B' },
  { id: 'not', label: '~A', unary: true },
  { id: 'shl', label: 'A << n', shift: true },
  { id: 'shr', label: 'A >> n (số học)', shift: true },
  { id: 'ushr', label: 'A >>> n (logic)', shift: true },
  { id: 'rotl', label: 'Xoay trái n', shift: true },
  { id: 'rotr', label: 'Xoay phải n', shift: true },
];

/** a, b là mẫu bit không dấu trong `width`. Kết quả cũng là mẫu bit không dấu. */
export function applyBitOp(op: BitOp, a: bigint, b: bigint, width: number): bigint {
  const m = mask(width);
  a = a & m;
  const w = BigInt(width);
  switch (op) {
    case 'and':
      return a & (b & m);
    case 'or':
      return a | (b & m);
    case 'xor':
      return a ^ (b & m);
    case 'not':
      return ~a & m;
    case 'shl':
      return b >= w ? B0 : (a << b) & m;
    case 'shr': {
      const sa = BigInt.asIntN(width, a);
      const n = b >= w ? w : b;
      return BigInt.asUintN(width, sa >> n);
    }
    case 'ushr':
      return b >= w ? B0 : a >> b;
    case 'rotl': {
      const n = b % w;
      return ((a << n) | (a >> (w - n))) & m;
    }
    case 'rotr': {
      const n = b % w;
      return ((a >> n) | (a << (w - n))) & m;
    }
  }
}

export function popCount(a: bigint, width: number): number {
  let c = 0;
  const s = (a & mask(width)).toString(2);
  for (let i = 0; i < s.length; i++) if (s[i] === '1') c++;
  return c;
}

export function leadingZeros(a: bigint, width: number): number {
  const v = a & mask(width);
  return v === B0 ? width : width - v.toString(2).length;
}

export function trailingZeros(a: bigint, width: number): number {
  const v = a & mask(width);
  if (v === B0) return width;
  const s = v.toString(2);
  return s.length - 1 - s.lastIndexOf('1');
}

export function isPowerOfTwo(a: bigint): boolean {
  return a > B0 && (a & (a - B1)) === B0;
}

/** Lũy thừa 2 nhỏ nhất >= a (a = 0 → 1). */
export function nextPowerOfTwo(a: bigint): bigint {
  if (a <= B1) return B1;
  return B1 << BigInt((a - B1).toString(2).length);
}

export function toggleBit(a: bigint, index: number): bigint {
  return a ^ (B1 << BigInt(index));
}

export function getBit(a: bigint, index: number): boolean {
  return ((a >> BigInt(index)) & B1) === B1;
}

/** Trích trường bit: bắt đầu từ bit `start` (0 = LSB), dài `length` bit. */
export function extractField(a: bigint, start: number, length: number, width: number): Result<{ value: bigint; signed: bigint }> {
  if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 1) {
    return { ok: false, error: 'Bit bắt đầu và độ dài phải là số nguyên dương.' };
  }
  if (start + length > width) return { ok: false, error: `Vượt quá ${width} bit (bit ${start + length - 1}).` };
  const value = (a >> BigInt(start)) & mask(length);
  return { ok: true, value, signed: BigInt.asIntN(length, value) };
}

export interface FlagDef {
  name: string;
  bit: number;
}

/** Phân tích "READ=0, WRITE=1" hoặc nhiều dòng. */
export function parseFlags(text: string, width: number): Result<{ flags: FlagDef[] }> {
  const flags: FlagDef[] = [];
  const parts = text.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
  const seen = new Set<number>();
  for (const p of parts) {
    const m = /^([A-Za-z_][\w]*)\s*[=:]\s*(\d{1,3})$/.exec(p);
    if (!m) return { ok: false, error: `Dòng "${p.slice(0, 30)}" sai cú pháp. Dùng TÊN=số_bit.` };
    const bit = Number(m[2]);
    if (bit >= width) return { ok: false, error: `Bit ${bit} vượt quá độ rộng ${width} bit.` };
    if (seen.has(bit)) return { ok: false, error: `Bit ${bit} bị đặt tên hai lần.` };
    seen.add(bit);
    flags.push({ name: m[1], bit });
  }
  return { ok: true, flags };
}

/* ------------------------------------------------------------------ */
/* 3. IEEE-754                                                         */
/* ------------------------------------------------------------------ */

export type FloatFormatId = 'f16' | 'f32' | 'f64';

export interface FloatFormat {
  id: FloatFormatId;
  label: string;
  total: number;
  expBits: number;
  mantBits: number;
  bias: number;
}

export const FLOAT_FORMATS: Record<FloatFormatId, FloatFormat> = {
  f16: { id: 'f16', label: 'float16 (half)', total: 16, expBits: 5, mantBits: 10, bias: 15 },
  f32: { id: 'f32', label: 'float32 (single)', total: 32, expBits: 8, mantBits: 23, bias: 127 },
  f64: { id: 'f64', label: 'float64 (double)', total: 64, expBits: 11, mantBits: 52, bias: 1023 },
};

export type FloatClass = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan';

export interface FloatParts {
  fmt: FloatFormat;
  bits: bigint;
  sign: 0 | 1;
  expField: number;
  mantissa: bigint;
  cls: FloatClass;
  quietNaN: boolean;
  /** Số mũ không thiên lệch (subnormal: 1 - bias). null với inf/nan. */
  unbiased: number | null;
  /** Giá trị chính xác = (-1)^s * n * 2^q (chỉ với số hữu hạn). */
  n: bigint;
  q: number;
}

export function decomposeBits(bitsIn: bigint, fmt: FloatFormat): FloatParts {
  const bits = bitsIn & mask(fmt.total);
  const sign = Number(bits >> BigInt(fmt.total - 1)) as 0 | 1;
  const expField = Number((bits >> BigInt(fmt.mantBits)) & mask(fmt.expBits));
  const mantissa = bits & mask(fmt.mantBits);
  const expMax = (1 << fmt.expBits) - 1;
  let cls: FloatClass;
  if (expField === expMax) cls = mantissa === B0 ? 'infinity' : 'nan';
  else if (expField === 0) cls = mantissa === B0 ? 'zero' : 'subnormal';
  else cls = 'normal';
  const quietNaN = cls === 'nan' && ((mantissa >> BigInt(fmt.mantBits - 1)) & B1) === B1;
  let n = B0;
  let q = 0;
  let unbiased: number | null = null;
  if (cls === 'normal') {
    n = mantissa | (B1 << BigInt(fmt.mantBits));
    unbiased = expField - fmt.bias;
    q = unbiased - fmt.mantBits;
  } else if (cls === 'subnormal' || cls === 'zero') {
    n = mantissa;
    unbiased = 1 - fmt.bias;
    q = unbiased - fmt.mantBits;
  }
  return { fmt, bits, sign, expField, mantissa, cls, quietNaN, unbiased, n, q };
}

/** Biểu diễn thập phân CHÍNH XÁC của n * 2^q (n >= 0). */
export function exactDecimal(n: bigint, q: number): string {
  if (n === B0) return '0';
  if (q >= 0) return (n << BigInt(q)).toString();
  const k = -q;
  // n / 2^k = n * 5^k / 10^k
  let s = (n * B5 ** BigInt(k)).toString();
  if (s.length <= k) s = '0'.repeat(k - s.length + 1) + s;
  const intPart = s.slice(0, s.length - k);
  let frac = s.slice(s.length - k);
  frac = frac.replace(/0+$/, '');
  return frac ? `${intPart}.${frac}` : intPart;
}

export function exactValueString(p: FloatParts): string {
  if (p.cls === 'nan') return 'NaN';
  const sg = p.sign ? '-' : '';
  if (p.cls === 'infinity') return sg + 'Infinity';
  return sg + exactDecimal(p.n, p.q);
}

/** Giá trị JS number (chính xác với f16/f32/f64 hữu hạn). */
export function bitsToNumber(bits: bigint, fmt: FloatFormat): number {
  const p = decomposeBits(bits, fmt);
  if (p.cls === 'nan') return NaN;
  const sg = p.sign ? -1 : 1;
  if (p.cls === 'infinity') return sg * Infinity;
  if (p.n === B0) return sg * 0;
  // n < 2^53 nên Number(n) chính xác; nhân 2^q theo hai bước để tránh tràn/underflow trung gian.
  let x = Number(p.n);
  let q = p.q;
  while (q > 1000) {
    x *= Math.pow(2, 1000);
    q -= 1000;
  }
  while (q < -1000) {
    x *= Math.pow(2, -1000);
    q += 1000;
  }
  return sg * x * Math.pow(2, q);
}

/** Dùng DataView (đường tham chiếu độc lập với giải mã thủ công). */
export function bitsToNumberDataView(bits: bigint, fmt: FloatFormat): number | null {
  const dv = new DataView(new ArrayBuffer(8));
  if (fmt.id === 'f64') {
    dv.setBigUint64(0, bits & mask(64));
    return dv.getFloat64(0);
  }
  if (fmt.id === 'f32') {
    dv.setUint32(0, Number(bits & mask(32)));
    return dv.getFloat32(0);
  }
  return null;
}

/** Mã hoá một number (double) sang bit của định dạng, làm tròn về số gần nhất (chẵn khi hoà). */
export function numberToBits(x: number, fmt: FloatFormat): bigint {
  const signBit = (Object.is(x, -0) || x < 0 ? B1 : B0) << BigInt(fmt.total - 1);
  const expMax = (1 << fmt.expBits) - 1;
  if (Number.isNaN(x)) {
    return (BigInt(expMax) << BigInt(fmt.mantBits)) | (B1 << BigInt(fmt.mantBits - 1));
  }
  if (!Number.isFinite(x)) return signBit | (BigInt(expMax) << BigInt(fmt.mantBits));
  if (x === 0) return signBit;
  if (fmt.id === 'f64') {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, x);
    return dv.getBigUint64(0);
  }
  if (fmt.id === 'f32') {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, x);
    return BigInt(dv.getUint32(0));
  }
  // Tổng quát (float16): lấy x = M * 2^E (từ bit float64) rồi làm tròn thủ công.
  const d = decomposeBits(numberToBits(Math.abs(x), FLOAT_FORMATS.f64), FLOAT_FORMATS.f64);
  const M = d.n;
  const E = d.q;
  const emin = 1 - fmt.bias;
  const eTop = M.toString(2).length - 1 + E; // floor(log2 |x|)
  let q = Math.max(eTop - fmt.mantBits, emin - fmt.mantBits);
  let n: bigint;
  if (E - q >= 0) n = M << BigInt(E - q);
  else {
    const s = BigInt(q - E);
    n = M >> s;
    const rem = M & ((B1 << s) - B1);
    const half = B1 << (s - B1);
    if (rem > half || (rem === half && (n & B1) === B1)) n += B1;
  }
  if (n >= B1 << BigInt(fmt.mantBits + 1)) {
    n >>= B1;
    q += 1;
  }
  const maxQ = expMax - 1 - fmt.bias - fmt.mantBits;
  if (q > maxQ) return signBit | (BigInt(expMax) << BigInt(fmt.mantBits));
  if (n < B1 << BigInt(fmt.mantBits)) {
    // subnormal (hoặc về 0)
    return signBit | n;
  }
  const expField = q + fmt.mantBits + fmt.bias;
  return signBit | (BigInt(expField) << BigInt(fmt.mantBits)) | (n - (B1 << BigInt(fmt.mantBits)));
}

/** Chuỗi thập phân ngắn nhất mà khi đọc lại cho đúng bit này. */
export function shortestDecimal(bits: bigint, fmt: FloatFormat): string {
  const x = bitsToNumber(bits, fmt);
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x < 0 ? '-Infinity' : 'Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  for (let p = 1; p <= 17; p++) {
    const s = x.toPrecision(p);
    if (numberToBits(Number(s), fmt) === (bits & mask(fmt.total))) return String(Number(s));
  }
  return String(x);
}

export function nextUp(bits: bigint, fmt: FloatFormat): bigint | null {
  const p = decomposeBits(bits, fmt);
  if (p.cls === 'nan') return null;
  const negZero = p.sign === 1 && p.n === B0 && p.cls === 'zero';
  if (negZero) return B1;
  if (p.sign === 0) {
    if (p.cls === 'infinity') return null;
    return p.bits + B1;
  }
  if (p.cls === 'infinity') return p.bits - B1;
  return p.bits - B1;
}

export function nextDown(bits: bigint, fmt: FloatFormat): bigint | null {
  const p = decomposeBits(bits, fmt);
  if (p.cls === 'nan') return null;
  const signMask = B1 << BigInt(fmt.total - 1);
  if (p.cls === 'zero' && p.sign === 0) return signMask | B1;
  if (p.sign === 1) {
    if (p.cls === 'infinity') return null;
    return p.bits + B1;
  }
  if (p.cls === 'infinity') return p.bits - B1;
  return p.bits - B1;
}

/** ULP của giá trị: 2^q (chuỗi chính xác). null với inf/nan. */
export function ulpString(p: FloatParts): string | null {
  if (p.cls === 'nan' || p.cls === 'infinity') return null;
  return exactDecimal(B1, p.q);
}

export function formatFloatBits(bits: bigint, fmt: FloatFormat): { sign: string; exp: string; mant: string; hex: string } {
  const all = (bits & mask(fmt.total)).toString(2).padStart(fmt.total, '0');
  return {
    sign: all.slice(0, 1),
    exp: all.slice(1, 1 + fmt.expBits),
    mant: all.slice(1 + fmt.expBits),
    hex: '0x' + (bits & mask(fmt.total)).toString(16).toUpperCase().padStart(fmt.total / 4, '0'),
  };
}

export const CLASS_LABEL: Record<FloatClass, string> = {
  zero: 'Số không (±0)',
  subnormal: 'Số dưới chuẩn (subnormal)',
  normal: 'Số chuẩn hoá (normal)',
  infinity: 'Vô cực (±Infinity)',
  nan: 'NaN (không phải số)',
};

export interface FloatInput {
  bits: bigint;
  source: 'decimal' | 'hex' | 'bin';
  /** Giá trị double đã đọc (chỉ khi nhập thập phân). */
  typed?: number;
}

/** Đọc ô nhập: thập phân ("0.1", "1e-5", "NaN", "-inf"), hoặc mẫu bit hex "0x3FB999999999999A" / nhị phân "0b...". */
export function parseFloatInput(text: string, fmt: FloatFormat): Result<FloatInput> {
  const t = text.trim().replace(/[_\s]/g, '');
  if (!t) return { ok: false, error: 'Chưa nhập giá trị.' };
  if (t.length > 200) return { ok: false, error: 'Chuỗi quá dài.' };
  const hexM = /^0x([0-9a-f]+)$/i.exec(t);
  if (hexM) {
    const bits = BigInt('0x' + hexM[1]);
    if (bits >> BigInt(fmt.total) !== B0) return { ok: false, error: `Mẫu bit vượt quá ${fmt.total} bit.` };
    return { ok: true, bits, source: 'hex' };
  }
  const binM = /^0b([01]+)$/i.exec(t);
  if (binM) {
    const bits = BigInt('0b' + binM[1]);
    if (bits >> BigInt(fmt.total) !== B0) return { ok: false, error: `Mẫu bit vượt quá ${fmt.total} bit.` };
    return { ok: true, bits, source: 'bin' };
  }
  const low = t.toLowerCase();
  let x: number;
  if (low === 'nan') x = NaN;
  else if (/^[+]?(inf|infinity|∞)$/.test(low)) x = Infinity;
  else if (/^-(inf|infinity|∞)$/.test(low)) x = -Infinity;
  else if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(low)) x = Number(low);
  else return { ok: false, error: 'Không đọc được. Nhập số thập phân (0.1, 1e-5), NaN, Infinity hoặc mẫu bit 0x… / 0b….' };
  return { ok: true, bits: numberToBits(x, fmt), source: 'decimal', typed: x };
}

/** Công thức tái dựng giá trị, bằng tiếng Việt/ký hiệu. */
export function reconstructionFormula(p: FloatParts): string {
  const s = p.sign ? '-1' : '+1';
  const m = p.fmt.mantBits;
  if (p.cls === 'nan') return `Mũ = toàn bit 1 và mantissa ≠ 0 → NaN (${p.quietNaN ? 'quiet' : 'signaling'}), payload = 0x${(p.mantissa & (mask(m - 1))).toString(16).toUpperCase()}`;
  if (p.cls === 'infinity') return `Mũ = toàn bit 1 và mantissa = 0 → ${p.sign ? '−' : '+'}Infinity`;
  if (p.cls === 'zero') return `Mũ = 0 và mantissa = 0 → ${p.sign ? '−0' : '+0'}`;
  if (p.cls === 'subnormal') {
    return `(${s}) × 0.mantissa × 2^${1 - p.fmt.bias} = (${s}) × (${p.mantissa}/2^${m}) × 2^${1 - p.fmt.bias}`;
  }
  return `(${s}) × 1.mantissa × 2^(${p.expField} − ${p.fmt.bias}) = (${s}) × (${p.n}/2^${m}) × 2^${p.unbiased}`;
}

/* ------------------------------------------------------------------ */
/* 4. Dung lượng & thời gian                                           */
/* ------------------------------------------------------------------ */

export interface SizeUnit {
  name: string;
  factor: bigint;
  system: 'SI' | 'IEC' | 'B';
}

const SI_NAMES = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
const IEC_NAMES = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];

export const SI_UNITS: SizeUnit[] = SI_NAMES.map((name, i) => ({ name, factor: BigInt(1000) ** BigInt(i), system: i === 0 ? 'B' : 'SI' }));
export const IEC_UNITS: SizeUnit[] = IEC_NAMES.map((name, i) => ({ name, factor: BigInt(1024) ** BigInt(i), system: i === 0 ? 'B' : 'IEC' }));

/** Phân tích số thập phân dạng chuỗi thành phân số (tử, 10^scale). */
export function parseDecimalRational(s: string): { num: bigint; den: bigint } | null {
  const m = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
  if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) return null;
  const frac = m[2] ?? '';
  let num = BigInt((m[1] || '0') + frac);
  let scale = frac.length;
  if (m[3] !== undefined) {
    const e = Number(m[3]);
    if (Math.abs(e) > 60) return null;
    scale -= e;
  }
  if (scale < 0) {
    num *= B10 ** BigInt(-scale);
    scale = 0;
  }
  return { num, den: B10 ** BigInt(scale) };
}

/** Chia làm tròn tới số gần nhất (half-up). */
function divRound(a: bigint, b: bigint): bigint {
  return (a * B2 + b) / (b * B2);
}

/** Đọc "1.5 GiB", "300kb", "2 MB", "512 bytes", "8 Mbit". Trả về số byte (làm tròn) hoặc số bit. */
export function parseHumanSize(text: string): Result<{ bytes: bigint; exactBits: bigint | null; unit: string }> {
  const t = text.trim().replace(/,/g, '.').replace(/_/g, '');
  const m = /^([+]?[\d.]+(?:e[+-]?\d+)?)\s*([a-zA-Z]*)$/i.exec(t);
  if (!m) return { ok: false, error: 'Không đọc được. Ví dụ: 1.5 GiB, 300kb, 2 MB, 512 bytes.' };
  const r = parseDecimalRational(m[1]);
  if (!r) return { ok: false, error: 'Số không hợp lệ.' };
  const raw = m[2];
  let u = raw.toLowerCase();
  if (u === '') u = 'b';
  const mm = /^([kmgtpe]?)(i?)(b|byte|bytes|o|bit|bits)$/.exec(u);
  if (!mm) return { ok: false, error: `Đơn vị "${raw}" không nhận ra. Dùng B, KB, MB, GB, TB, KiB, MiB, GiB, TiB...` };
  const prefixes = ['', 'k', 'm', 'g', 't', 'p', 'e'];
  const idx = prefixes.indexOf(mm[1]);
  const isBit = mm[3] === 'bit' || mm[3] === 'bits';
  const base = mm[2] ? BigInt(1024) : BigInt(1000);
  const factor = base ** BigInt(idx);
  const num = r.num * factor;
  if (isBit) {
    const bits = divRound(num, r.den);
    return { ok: true, bytes: divRound(num, r.den * B8), exactBits: bits, unit: raw };
  }
  return { ok: true, bytes: divRound(num, r.den), exactBits: null, unit: raw };
}

/** bytes / factor dưới dạng thập phân với tối đa `digits` chữ số lẻ (cắt bỏ số 0 thừa). */
export function divideDecimal(bytes: bigint, factor: bigint, digits = 6): string {
  const neg = bytes < B0;
  const a = neg ? -bytes : bytes;
  const scale = B10 ** BigInt(digits);
  const scaled = divRound(a * scale, factor);
  let s = scaled.toString().padStart(digits + 1, '0');
  const ip = s.slice(0, s.length - digits);
  const fp = s.slice(s.length - digits).replace(/0+$/, '');
  s = fp ? `${ip}.${fp}` : ip;
  return (neg ? '-' : '') + s;
}

export function humanSize(bytes: bigint, system: 'SI' | 'IEC'): string {
  const units = system === 'SI' ? SI_UNITS : IEC_UNITS;
  let best = units[0];
  for (const u of units) if ((bytes < B0 ? -bytes : bytes) >= u.factor) best = u;
  const v = best.factor === B1 ? bytes.toString() : divideDecimal(bytes, best.factor, 2);
  return `${v} ${best.name}`;
}

export interface SpeedUnit {
  id: string;
  label: string;
  /** bit trên giây */
  bps: number;
}

export const SPEED_UNITS: SpeedUnit[] = [
  { id: 'kbps', label: 'Kbps', bps: 1e3 },
  { id: 'mbps', label: 'Mbps', bps: 1e6 },
  { id: 'gbps', label: 'Gbps', bps: 1e9 },
  { id: 'kBps', label: 'KB/s', bps: 8e3 },
  { id: 'MBps', label: 'MB/s', bps: 8e6 },
  { id: 'GBps', label: 'GB/s', bps: 8e9 },
  { id: 'MiBps', label: 'MiB/s', bps: 8 * 1048576 },
  { id: 'GiBps', label: 'GiB/s', bps: 8 * 1073741824 },
];

/** Thời gian truyền (giây) = bit / (bit/s × hiệu suất). */
export function transferSeconds(bytes: bigint, speed: number, unit: SpeedUnit, efficiency = 1): number {
  if (!(speed > 0) || !(efficiency > 0)) return Infinity;
  return (Number(bytes) * 8) / (speed * unit.bps * efficiency);
}

const DUR_UNITS: { id: string; label: string; ms: number }[] = [
  { id: 'ms', label: 'mili giây', ms: 1 },
  { id: 's', label: 'giây', ms: 1000 },
  { id: 'min', label: 'phút', ms: 60000 },
  { id: 'h', label: 'giờ', ms: 3600000 },
  { id: 'd', label: 'ngày', ms: 86400000 },
  { id: 'w', label: 'tuần', ms: 604800000 },
];
export { DUR_UNITS };

/** "1h30m", "90 phút", "1.5d", "2 days 3 hours", "1500ms". Trả về mili giây. */
export function parseDuration(text: string): Result<{ ms: number }> {
  const t = text.trim().toLowerCase().replace(/,/g, '.');
  if (!t) return { ok: false, error: 'Chưa nhập thời lượng.' };
  const re = /([+-]?\d*\.?\d+)\s*([a-zà-ỹ]+)/g;
  let total = 0;
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = re.exec(t)) !== null) {
    const unit = m[2];
    let mult: number | null = null;
    if (['ms', 'mili', 'milli', 'millisecond', 'milliseconds'].includes(unit)) mult = 1;
    else if (['s', 'sec', 'secs', 'second', 'seconds', 'giây', 'giay'].includes(unit)) mult = 1000;
    else if (['m', 'min', 'mins', 'minute', 'minutes', 'phút', 'phut'].includes(unit)) mult = 60000;
    else if (['h', 'hr', 'hrs', 'hour', 'hours', 'giờ', 'gio'].includes(unit)) mult = 3600000;
    else if (['d', 'day', 'days', 'ngày', 'ngay'].includes(unit)) mult = 86400000;
    else if (['w', 'week', 'weeks', 'tuần', 'tuan'].includes(unit)) mult = 604800000;
    if (mult === null) return { ok: false, error: `Đơn vị "${unit}" không nhận ra (ms, s, min, h, d, w).` };
    total += Number(m[1]) * mult;
    any = true;
  }
  if (!any || t.replace(re, '').trim() !== '') {
    return { ok: false, error: 'Không đọc được. Ví dụ: 1h30m, 90 phút, 1.5d, 2d 3h.' };
  }
  if (!Number.isFinite(total)) return { ok: false, error: 'Giá trị quá lớn.' };
  return { ok: true, ms: total };
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  if (ms === 0) return '0 ms';
  const neg = ms < 0;
  let rest = Math.abs(ms);
  if (rest < 1000) return `${neg ? '-' : ''}${+rest.toFixed(3)} ms`;
  const parts: string[] = [];
  const spec: [string, number][] = [['ngày', 86400000], ['giờ', 3600000], ['phút', 60000], ['giây', 1000]];
  for (const [label, size] of spec) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n} ${label}`);
      rest -= n * size;
    }
  }
  if (rest >= 1 && parts.length < 3) parts.push(`${+rest.toFixed(0)} ms`);
  return (neg ? '-' : '') + parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* 5. Endian & bytes                                                   */
/* ------------------------------------------------------------------ */

export function bigintToBytes(v: bigint, size: number, little: boolean): Uint8Array {
  const out = new Uint8Array(size);
  let x = BigInt.asUintN(size * 8, v);
  for (let i = 0; i < size; i++) {
    const b = Number(x & B255);
    out[little ? i : size - 1 - i] = b;
    x >>= B8;
  }
  return out;
}

export function bytesToBigint(bytes: Uint8Array, little: boolean): bigint {
  let x = B0;
  const n = bytes.length;
  for (let i = 0; i < n; i++) {
    const b = little ? bytes[n - 1 - i] : bytes[i];
    x = (x << B8) | BigInt(b);
  }
  return x;
}

export function byteSwap(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes).reverse();
}

export function bytesToHex(bytes: Uint8Array, sep = ' ', upper = true): string {
  const arr: string[] = [];
  for (let i = 0; i < bytes.length; i++) arr.push(bytes[i].toString(16).padStart(2, '0'));
  const s = arr.join(sep);
  return upper ? s.toUpperCase() : s;
}

export const MAX_HEX_BYTES = 5 * 1024 * 1024;

/** Đọc chuỗi hex: "DE AD be-ef", "0xDEADBEEF", "\\xDE\\xAD", "de,ad". */
export function parseHexBytes(text: string): Result<{ bytes: Uint8Array }> {
  let s = text.replace(/\\x/gi, ' ').replace(/0x/gi, ' ').replace(/[\s,:_;-]+/g, '');
  if (s === '') return { ok: false, error: 'Chưa nhập chuỗi hex.' };
  if (!/^[0-9a-fA-F]+$/.test(s)) return { ok: false, error: 'Chuỗi hex chỉ gồm 0-9, a-f (ngăn cách bằng khoảng trắng, dấu phẩy, 0x hoặc \\x).' };
  if (s.length % 2 === 1) return { ok: false, error: 'Số chữ số hex phải chẵn (mỗi byte 2 chữ số).' };
  if (s.length / 2 > MAX_HEX_BYTES) return { ok: false, error: 'Chuỗi quá lớn.' };
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  s = '';
  return { ok: true, bytes: out };
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): { text: string; valid: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), valid: true };
  } catch {
    return { text: new TextDecoder('utf-8').decode(bytes), valid: false };
  }
}

export interface HexLine {
  offset: string;
  hex: string;
  ascii: string;
}

/** Hexdump kiểu `xxd`/`hexdump -C`: offset, hex, ASCII. Giới hạn bằng [start, start+length). */
export function hexdump(bytes: Uint8Array, opts: { width?: number; start?: number; length?: number } = {}): HexLine[] {
  const width = opts.width ?? 16;
  const start = Math.max(0, opts.start ?? 0);
  const end = Math.min(bytes.length, start + (opts.length ?? bytes.length));
  const offW = Math.max(8, bytes.length.toString(16).length);
  const lines: HexLine[] = [];
  for (let off = start; off < end; off += width) {
    const chunk = bytes.subarray(off, Math.min(end, off + width));
    let hex = '';
    let ascii = '';
    for (let i = 0; i < width; i++) {
      if (i < chunk.length) {
        const b = chunk[i];
        hex += b.toString(16).padStart(2, '0') + ' ';
        ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
      } else hex += '   ';
      if (i === width / 2 - 1) hex += ' ';
    }
    lines.push({ offset: off.toString(16).padStart(offW, '0'), hex: hex.trimEnd(), ascii });
  }
  return lines;
}

export function hexdumpText(bytes: Uint8Array, opts: { width?: number; start?: number; length?: number } = {}): string {
  const width = opts.width ?? 16;
  return hexdump(bytes, opts)
    .map((l) => `${l.offset}  ${l.hex.padEnd(width * 3 + 1)} |${l.ascii}|`)
    .join('\n');
}

export type NumType = 'u8' | 'u16' | 'u32' | 'u64' | 'i8' | 'i16' | 'i32' | 'i64' | 'f32' | 'f64';

export const NUM_TYPES: { id: NumType; size: number }[] = [
  { id: 'u8', size: 1 },
  { id: 'u16', size: 2 },
  { id: 'u32', size: 4 },
  { id: 'u64', size: 8 },
  { id: 'i8', size: 1 },
  { id: 'i16', size: 2 },
  { id: 'i32', size: 4 },
  { id: 'i64', size: 8 },
  { id: 'f32', size: 4 },
  { id: 'f64', size: 8 },
];

/** Diễn giải đúng `size` byte đầu (bytes.length phải >= size). */
export function interpretBytes(bytes: Uint8Array, type: NumType, little: boolean): string | null {
  const def = NUM_TYPES.find((t) => t.id === type)!;
  if (bytes.length < def.size) return null;
  const sl = bytes.subarray(0, def.size);
  const raw = bytesToBigint(sl, little);
  if (type[0] === 'u') return raw.toString();
  if (type[0] === 'i') return BigInt.asIntN(def.size * 8, raw).toString();
  const fmt = type === 'f32' ? FLOAT_FORMATS.f32 : FLOAT_FORMATS.f64;
  return shortestDecimal(raw, fmt);
}

/** Đọc số từ ô nhập (nguyên hoặc thực) sang mẫu byte theo kiểu. */
export function encodeNumber(text: string, type: NumType, little: boolean): Result<{ bytes: Uint8Array }> {
  const def = NUM_TYPES.find((t) => t.id === type)!;
  if (type[0] === 'f') {
    const fmt = type === 'f32' ? FLOAT_FORMATS.f32 : FLOAT_FORMATS.f64;
    const r = parseFloatInput(text, fmt);
    if (!r.ok) return r;
    return { ok: true, bytes: bigintToBytes(r.bits, def.size, little) };
  }
  const r = parseInteger(text, 10);
  if (!r.ok) return r;
  const bitsN = def.size * 8;
  const signed = type[0] === 'i';
  const lo = signed ? -(B1 << BigInt(bitsN - 1)) : B0;
  const hi = signed ? (B1 << BigInt(bitsN - 1)) - B1 : (B1 << BigInt(bitsN)) - B1;
  if (r.value < lo || r.value > hi) return { ok: false, error: `Giá trị ngoài phạm vi ${type} (${lo} … ${hi}).` };
  return { ok: true, bytes: bigintToBytes(r.value, def.size, little) };
}
