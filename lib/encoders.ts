// Logic thuần cho công cụ Mã hóa / Giải mã (chạy hoàn toàn trên trình duyệt).

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

/* ---------------- Base64 ---------------- */

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64Encode(text: string, urlSafe = false): string {
  const b64 = bytesToBase64(enc.encode(text));
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

/** Chấp nhận cả Base64 chuẩn lẫn URL-safe, có/không padding, có khoảng trắng. */
export function base64Decode(input: string): string {
  let s = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('Chuỗi Base64 chứa ký tự không hợp lệ.');
  s = s.replace(/=+$/, '');
  if (s.length % 4 === 1) throw new Error('Độ dài chuỗi Base64 không hợp lệ.');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(s);
  } catch {
    throw new Error('Chuỗi Base64 không hợp lệ.');
  }
  try {
    return dec.decode(bytes);
  } catch {
    throw new Error('Dữ liệu sau giải mã không phải văn bản UTF-8 hợp lệ.');
  }
}

/* ---------------- URL ---------------- */

export type UrlMode = 'component' | 'uri';

export function urlEncode(text: string, mode: UrlMode): string {
  return mode === 'component' ? encodeURIComponent(text) : encodeURI(text);
}

export function urlDecode(text: string, mode: UrlMode): string {
  try {
    return mode === 'component' ? decodeURIComponent(text) : decodeURI(text);
  } catch {
    throw new Error('Chuỗi URL chứa chuỗi % không hợp lệ.');
  }
}

/* ---------------- HTML entities ---------------- */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®',
  trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“',
  rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·', euro: '€', pound: '£',
  yen: '¥', cent: '¢', sect: '§', deg: '°', plusmn: '±', times: '×', divide: '÷',
  frac12: '½', frac14: '¼', frac34: '¾', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
  hearts: '♥', check: '✓', infin: '∞', ne: '≠', le: '≤', ge: '≥',
};

export function htmlEncode(text: string, encodeNonAscii = false): string {
  let out = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  if (encodeNonAscii) {
    out = Array.from(out)
      .map((ch) => {
        const cp = ch.codePointAt(0)!;
        return cp > 126 ? `&#${cp};` : ch;
      })
      .join('');
  }
  return out;
}

/** Giải mã bằng bảng thực thể + thực thể số; không dùng DOM nên an toàn với input không tin cậy. */
export function htmlDecode(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
      return String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : m;
  });
}

/* ---------------- JWT ---------------- */

export interface JwtTimeClaim {
  claim: 'exp' | 'iat' | 'nbf';
  label: string;
  seconds: number;
  iso: string;
}

export interface JwtResult {
  header: unknown;
  payload: unknown;
  headerJson: string;
  payloadJson: string;
  signature: string;
  times: JwtTimeClaim[];
  expired: boolean | null; // null nếu không có exp
  notYetValid: boolean;
}

function decodeJwtPart(part: string, name: string): unknown {
  try {
    return JSON.parse(base64Decode(part));
  } catch {
    throw new Error(`Phần ${name} của JWT không phải JSON Base64URL hợp lệ.`);
  }
}

export function decodeJwt(token: string, nowMs: number = Date.now()): JwtResult {
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) throw new Error('JWT phải có đúng 3 phần ngăn cách bởi dấu chấm (header.payload.signature).');
  const header = decodeJwtPart(parts[0], 'header');
  const payload = decodeJwtPart(parts[1], 'payload');
  const labels = { exp: 'Hết hạn (exp)', iat: 'Phát hành (iat)', nbf: 'Có hiệu lực từ (nbf)' } as const;
  const times: JwtTimeClaim[] = [];
  const p = payload as Record<string, unknown> | null;
  if (p && typeof p === 'object') {
    for (const claim of ['exp', 'iat', 'nbf'] as const) {
      const v = p[claim];
      if (typeof v === 'number' && Number.isFinite(v)) {
        const d = new Date(v * 1000);
        if (!Number.isNaN(d.getTime())) times.push({ claim, label: labels[claim], seconds: v, iso: d.toISOString() });
      }
    }
  }
  const exp = times.find((t) => t.claim === 'exp');
  const nbf = times.find((t) => t.claim === 'nbf');
  return {
    header,
    payload,
    headerJson: JSON.stringify(header, null, 2),
    payloadJson: JSON.stringify(payload, null, 2),
    signature: parts[2],
    times,
    expired: exp ? exp.seconds * 1000 <= nowMs : null,
    notYetValid: nbf ? nbf.seconds * 1000 > nowMs : false,
  };
}

/* ---------------- Hash ---------------- */

export type ShaAlgo = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export const HASH_ALGOS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const;
export type HashAlgo = (typeof HASH_ALGOS)[number];

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Int32Array(64);
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;

export function md5Bytes(data: Uint8Array): string {
  const len = data.length;
  const total = (((len + 8) >>> 6) + 1) << 6;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, (len << 3) >>> 0, true);
  view.setUint32(total - 4, Math.floor(len / 0x20000000) >>> 0, true);

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;
  const M = new Int32Array(16);

  for (let off = 0; off < total; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = view.getInt32(off + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + MD5_K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      const s = MD5_S[i];
      B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setInt32(0, a0, true);
  ov.setInt32(4, b0, true);
  ov.setInt32(8, c0, true);
  ov.setInt32(12, d0, true);
  return toHex(out);
}

export async function hashBytes(algo: HashAlgo, data: Uint8Array): Promise<string> {
  if (algo === 'MD5') return md5Bytes(data);
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await crypto.subtle.digest(algo, copy.buffer);
  return toHex(new Uint8Array(digest));
}

export async function hashText(algo: HashAlgo, text: string): Promise<string> {
  return hashBytes(algo, enc.encode(text));
}

export const MAX_HASH_FILE_SIZE = 200 * 1024 * 1024;

export async function hashAll(data: Uint8Array): Promise<Record<HashAlgo, string>> {
  const res = await Promise.all(HASH_ALGOS.map((a) => hashBytes(a, data)));
  const out = {} as Record<HashAlgo, string>;
  HASH_ALGOS.forEach((a, i) => (out[a] = res[i]));
  return out;
}

/* ---------------- Generators ---------------- */

export function generateUuids(count: number): string[] {
  const n = Math.max(1, Math.min(1000, Math.floor(count) || 1));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(crypto.randomUUID());
  return out;
}

/** Số nguyên ngẫu nhiên đều trong [0, max) bằng rejection sampling (không lệch modulo). */
export function randomInt(max: number): number {
  if (max <= 0 || max > 0x100000000) throw new Error('max không hợp lệ');
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 16,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

const AMBIGUOUS = /[Il1O0o]/g;

export function passwordSets(o: PasswordOptions): string[] {
  const sets: string[] = [];
  if (o.lower) sets.push('abcdefghijklmnopqrstuvwxyz');
  if (o.upper) sets.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  if (o.digits) sets.push('0123456789');
  if (o.symbols) sets.push('!@#$%^&*()-_=+[]{};:,.?/~');
  return o.excludeAmbiguous ? sets.map((s) => s.replace(AMBIGUOUS, '')) : sets;
}

export function generatePassword(o: PasswordOptions): string {
  const sets = passwordSets(o);
  if (sets.length === 0) throw new Error('Hãy chọn ít nhất một loại ký tự.');
  const length = Math.max(1, Math.min(256, Math.floor(o.length) || 1));
  if (length < sets.length) throw new Error(`Độ dài tối thiểu là ${sets.length} để chứa đủ các loại ký tự đã chọn.`);
  const all = sets.join('');
  const chars: string[] = sets.map((s) => s[randomInt(s.length)]); // đảm bảo mỗi loại có mặt
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function passwordEntropyBits(o: PasswordOptions): number {
  const size = new Set(passwordSets(o).join('')).size;
  return size > 1 ? Math.round(o.length * Math.log2(size)) : 0;
}
