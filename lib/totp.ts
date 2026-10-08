// HOTP (RFC 4226) / TOTP (RFC 6238) / Base32 (RFC 4648) / otpauth:// URI. Chỉ dùng Web Crypto.

export type OtpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';
export type OtpType = 'totp' | 'hotp';

export const ALGORITHMS: OtpAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-512'];
const URI_NAME: Record<OtpAlgorithm, string> = { 'SHA-1': 'SHA1', 'SHA-256': 'SHA256', 'SHA-512': 'SHA512' };

export const MAX_SECRET_BYTES = 256;
export const MAX_URI_LENGTH = 2048;

// ---------- Base32 ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array, padding = true): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  if (padding) while (out.length % 8 !== 0) out += '=';
  return out;
}

export type Base32Result = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/** Giải mã Base32 khoan dung: không phân biệt hoa/thường, bỏ khoảng trắng, dấu gạch, thiếu padding. */
export function base32Decode(input: string): Base32Result {
  if (input.length > MAX_SECRET_BYTES * 4) return { ok: false, error: 'Secret quá dài.' };
  const cleaned = input.replace(/[\s-]+/g, '').toUpperCase();
  const m = /^([^=]*)(=*)$/.exec(cleaned);
  if (!m) return { ok: false, error: 'Dấu "=" chỉ được xuất hiện ở cuối chuỗi Base32.' };
  const body = m[1];
  if (body.length === 0) return { ok: false, error: 'Secret đang trống.' };
  for (let i = 0; i < body.length; i++) {
    if (!B32.includes(body[i])) {
      const ch = body[i];
      const hint = '0189'.includes(ch) ? ' (Base32 không có 0, 1, 8, 9 — nhầm O, I/L, B, g?)' : '';
      return { ok: false, error: `Ký tự không hợp lệ "${ch}" ở vị trí ${i + 1}${hint}. Base32 chỉ gồm A–Z và 2–7.` };
    }
  }
  if (m[2].length > 6) return { ok: false, error: 'Quá nhiều ký tự padding "=".' };
  // độ dài hợp lệ (mod 8): 0,2,4,5,7
  if (![0, 2, 4, 5, 7].includes(body.length % 8)) {
    return { ok: false, error: `Độ dài Base32 không hợp lệ (${body.length} ký tự) — có thể bị thiếu hoặc thừa ký tự.` };
  }
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of body) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  if (bytes.length > MAX_SECRET_BYTES) return { ok: false, error: `Secret quá dài (tối đa ${MAX_SECRET_BYTES} byte).` };
  if (bytes.length === 0) return { ok: false, error: 'Secret quá ngắn.' };
  return { ok: true, bytes: Uint8Array.from(bytes) };
}

// ---------- HOTP / TOTP ----------
export interface OtpParams {
  algorithm: OtpAlgorithm;
  digits: number; // 6..8
  period: number; // 15..120 (TOTP)
  t0?: number; // giây, mặc định 0
}

export const DEFAULT_PARAMS: OtpParams = { algorithm: 'SHA-1', digits: 6, period: 30, t0: 0 };

export function validateParams(p: Partial<OtpParams>): string | null {
  if (p.algorithm !== undefined && !ALGORITHMS.includes(p.algorithm)) return 'Thuật toán không hợp lệ (SHA-1, SHA-256, SHA-512).';
  if (p.digits !== undefined && (!Number.isInteger(p.digits) || p.digits < 6 || p.digits > 8)) return 'Số chữ số phải từ 6 đến 8.';
  if (p.period !== undefined && (!Number.isInteger(p.period) || p.period < 15 || p.period > 120)) return 'Chu kỳ phải từ 15 đến 120 giây.';
  return null;
}

const MAX_U64 = (BigInt(1) << BigInt(64)) - BigInt(1);

async function hmac(secret: Uint8Array, data: Uint8Array, algorithm: OtpAlgorithm): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(secret), { name: 'HMAC', hash: algorithm }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array(data)));
}

/** HOTP (RFC 4226) với bộ đếm 64-bit. Ném lỗi nếu tham số sai. */
export async function hotp(secret: Uint8Array, counter: bigint | number, algorithm: OtpAlgorithm = 'SHA-1', digits = 6): Promise<string> {
  const c = typeof counter === 'bigint' ? counter : BigInt(Math.trunc(counter));
  if (c < BigInt(0) || c > MAX_U64) throw new Error('Bộ đếm phải nằm trong khoảng 0 – 2^64−1.');
  const err = validateParams({ algorithm, digits });
  if (err) throw new Error(err);
  if (secret.length === 0) throw new Error('Secret đang trống.');
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, c, false);
  const h = await hmac(secret, new Uint8Array(buf), algorithm);
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  const mod = 10 ** digits;
  return String(bin % mod).padStart(digits, '0');
}

/** Số bước (counter) của TOTP tại thời điểm timeMs (mili giây). */
export function totpCounter(timeMs: number, period = 30, t0 = 0): bigint {
  const secs = Math.floor(timeMs / 1000) - t0;
  if (secs < 0) return BigInt(0);
  return BigInt(Math.floor(secs / period));
}

export async function totp(secret: Uint8Array, timeMs: number, params: Partial<OtpParams> = {}): Promise<string> {
  const p = { ...DEFAULT_PARAMS, ...params };
  const err = validateParams(p);
  if (err) throw new Error(err);
  return hotp(secret, totpCounter(timeMs, p.period, p.t0 ?? 0), p.algorithm, p.digits);
}

/** Số giây còn lại của bước hiện tại (số thực) và tiến độ 0..1. */
export function stepProgress(timeMs: number, period = 30, t0 = 0): { remaining: number; fraction: number } {
  const secs = timeMs / 1000 - t0;
  const into = ((secs % period) + period) % period;
  return { remaining: period - into, fraction: into / period };
}

// ---------- Xác minh ----------
export interface VerifyResult {
  valid: boolean;
  /** Độ lệch bước: 0 = hiện tại, -1 = bước trước, +1 = bước kế. */
  drift?: number;
  error?: string;
}

export async function verifyTotp(
  secret: Uint8Array,
  code: string,
  timeMs: number,
  params: Partial<OtpParams> = {},
  window = 1,
): Promise<VerifyResult> {
  const p = { ...DEFAULT_PARAMS, ...params };
  const err = validateParams(p);
  if (err) return { valid: false, error: err };
  const clean = code.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(clean)) return { valid: false, error: 'Mã chỉ gồm chữ số.' };
  if (clean.length !== p.digits) return { valid: false, error: `Mã phải có đúng ${p.digits} chữ số.` };
  const w = Math.max(0, Math.min(10, Math.trunc(window)));
  const base = totpCounter(timeMs, p.period, p.t0 ?? 0);
  const order: number[] = [0];
  for (let i = 1; i <= w; i++) order.push(-i, i);
  for (const d of order) {
    const c = base + BigInt(d);
    if (c < BigInt(0)) continue;
    if ((await hotp(secret, c, p.algorithm, p.digits)) === clean) return { valid: true, drift: d };
  }
  return { valid: false };
}

export async function verifyHotp(
  secret: Uint8Array, code: string, counter: bigint, algorithm: OtpAlgorithm = 'SHA-1', digits = 6, lookAhead = 5,
): Promise<VerifyResult> {
  const clean = code.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(clean) || clean.length !== digits) return { valid: false, error: `Mã phải có đúng ${digits} chữ số.` };
  for (let d = 0; d <= lookAhead; d++) {
    const c = counter + BigInt(d);
    if (c > MAX_U64) break;
    if ((await hotp(secret, c, algorithm, digits)) === clean) return { valid: true, drift: d };
  }
  return { valid: false };
}

// ---------- Secret ----------
export function generateSecret(bits = 160): Uint8Array {
  if (!(Number.isInteger(bits) && bits >= 128 && bits <= 512 && bits % 8 === 0)) {
    throw new Error('Độ dài secret phải từ 128 đến 512 bit (bội của 8).');
  }
  const a = new Uint8Array(bits / 8);
  crypto.getRandomValues(a);
  return a;
}

// ---------- Đồng bộ thời gian ----------
/** Giờ hiệu dụng (ms) = giờ máy + độ lệch thủ công (giây). */
export function effectiveTime(localMs: number, offsetSeconds = 0): number {
  const off = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  return localMs + off * 1000;
}

/** Độ lệch (giây) cần cộng vào đồng hồ máy để khớp với giờ tham chiếu. */
export function clockOffsetSeconds(referenceMs: number, localMs: number): number {
  return Math.round((referenceMs - localMs) / 1000);
}

// ---------- otpauth:// URI ----------
export interface OtpUri {
  type: OtpType;
  issuer: string;
  account: string;
  secret: string; // base32 (không padding, in hoa)
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
  counter: number;
}

export type UriParseResult = { ok: true; value: OtpUri } | { ok: false; error: string };

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export function parseOtpUri(uri: string): UriParseResult {
  const text = uri.trim();
  if (!text) return { ok: false, error: 'URI đang trống.' };
  if (text.length > MAX_URI_LENGTH) return { ok: false, error: 'URI quá dài.' };
  const m = /^otpauth:\/\/([^/?#]*)\/?([^?#]*)(?:\?([^#]*))?/i.exec(text);
  if (!m) return { ok: false, error: 'URI phải bắt đầu bằng "otpauth://".' };
  const type = m[1].toLowerCase();
  if (type !== 'totp' && type !== 'hotp') return { ok: false, error: `Loại "${m[1]}" không được hỗ trợ (chỉ totp hoặc hotp).` };
  const rawLabel = m[2];
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(m[3] ?? '');
  } catch {
    return { ok: false, error: 'Chuỗi truy vấn của URI không hợp lệ.' };
  }
  const secretRaw = q.get('secret');
  if (!secretRaw) return { ok: false, error: 'URI thiếu tham số "secret".' };
  const dec = base32Decode(secretRaw);
  if (!dec.ok) return { ok: false, error: `Secret không hợp lệ: ${dec.error}` };

  // label: Issuer:account (':' hoặc %3A)
  let labelIssuer = '';
  let labelAccount = '';
  let idx = rawLabel.indexOf(':');
  let sepLen = 1;
  if (idx < 0) {
    const mm = /%3a/i.exec(rawLabel);
    idx = mm ? mm.index : -1;
    sepLen = 3;
  }
  if (idx >= 0) {
    const a = safeDecode(rawLabel.slice(0, idx));
    const b = safeDecode(rawLabel.slice(idx + sepLen));
    if (a === null || b === null) return { ok: false, error: 'Nhãn (label) chứa mã phần trăm không hợp lệ.' };
    labelIssuer = a.trim();
    labelAccount = b.trim();
  } else {
    const b = safeDecode(rawLabel);
    if (b === null) return { ok: false, error: 'Nhãn (label) chứa mã phần trăm không hợp lệ.' };
    labelAccount = b.trim();
  }
  const issuer = (q.get('issuer') ?? '').trim() || labelIssuer;

  let algorithm: OtpAlgorithm = 'SHA-1';
  const alg = q.get('algorithm');
  if (alg) {
    const a = alg.toUpperCase().replace('-', '');
    if (a === 'SHA1') algorithm = 'SHA-1';
    else if (a === 'SHA256') algorithm = 'SHA-256';
    else if (a === 'SHA512') algorithm = 'SHA-512';
    else return { ok: false, error: `Thuật toán "${alg}" không được hỗ trợ (SHA1, SHA256, SHA512).` };
  }
  let digits = 6;
  const d = q.get('digits');
  if (d !== null && d !== '') {
    if (!/^\d+$/.test(d)) return { ok: false, error: 'Tham số "digits" phải là số.' };
    digits = Number(d);
    if (digits < 6 || digits > 8) return { ok: false, error: 'Tham số "digits" phải từ 6 đến 8.' };
  }
  let period = 30;
  const pr = q.get('period');
  if (pr !== null && pr !== '') {
    if (!/^\d+$/.test(pr)) return { ok: false, error: 'Tham số "period" phải là số.' };
    period = Number(pr);
    if (period < 15 || period > 120) return { ok: false, error: 'Tham số "period" phải từ 15 đến 120 giây.' };
  }
  let counter = 0;
  const cn = q.get('counter');
  if (type === 'hotp') {
    if (cn === null || cn === '') return { ok: false, error: 'URI loại hotp thiếu tham số "counter".' };
  }
  if (cn !== null && cn !== '') {
    if (!/^\d{1,15}$/.test(cn)) return { ok: false, error: 'Tham số "counter" phải là số nguyên không âm.' };
    counter = Number(cn);
  }
  return {
    ok: true,
    value: { type, issuer, account: labelAccount, secret: base32Encode(dec.bytes, false), algorithm, digits, period, counter },
  };
}

/** Tạo otpauth:// URI. Trả về { ok, value: string } hoặc { ok:false, error }. */
export function buildOtpUri(o: Partial<OtpUri> & { secret: string }): { ok: true; value: string } | { ok: false; error: string } {
  const type = o.type ?? 'totp';
  const dec = base32Decode(o.secret);
  if (!dec.ok) return { ok: false, error: `Secret không hợp lệ: ${dec.error}` };
  const algorithm = o.algorithm ?? 'SHA-1';
  const digits = o.digits ?? 6;
  const period = o.period ?? 30;
  const err = validateParams({ algorithm, digits, period });
  if (err) return { ok: false, error: err };
  const issuer = (o.issuer ?? '').trim();
  const account = (o.account ?? '').trim();
  if (!issuer && !account) return { ok: false, error: 'Cần nhập ít nhất Issuer hoặc Tài khoản.' };
  const issuerLabel = issuer.replace(/:/g, '');
  let label: string;
  if (issuerLabel) label = `${encodeURIComponent(issuerLabel)}:${encodeURIComponent(account)}`;
  else if (account.includes(':')) label = `%3A${encodeURIComponent(account)}`;
  else label = encodeURIComponent(account);
  const parts = [`secret=${base32Encode(dec.bytes, false)}`];
  if (issuer) parts.push(`issuer=${encodeURIComponent(issuer)}`);
  parts.push(`algorithm=${URI_NAME[algorithm]}`, `digits=${digits}`);
  if (type === 'totp') parts.push(`period=${period}`);
  else {
    const c = o.counter ?? 0;
    if (!Number.isInteger(c) || c < 0) return { ok: false, error: 'Counter phải là số nguyên không âm.' };
    parts.push(`counter=${c}`);
  }
  return { ok: true, value: `otpauth://${type}/${label}?${parts.join('&')}` };
}

/**
 * Nhận đầu vào tự do: URI otpauth://, chuỗi "secret=...&..." hoặc Base32 thuần.
 * Trả về secret + tham số nếu có.
 */
export function parseSecretInput(input: string): { ok: true; secret: string; uri?: OtpUri } | { ok: false; error: string } {
  const t = input.trim();
  if (/^otpauth:\/\//i.test(t)) {
    const r = parseOtpUri(t);
    return r.ok ? { ok: true, secret: r.value.secret, uri: r.value } : r;
  }
  const m = /(?:^|[?&\s])secret=([^&\s]+)/i.exec(t);
  if (m) {
    const v = safeDecode(m[1]) ?? m[1];
    const dec = base32Decode(v);
    if (!dec.ok) return dec;
    return { ok: true, secret: base32Encode(dec.bytes, false) };
  }
  const dec = base32Decode(t);
  if (!dec.ok) return dec;
  return { ok: true, secret: base32Encode(dec.bytes, false) };
}

export function groupDigits(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  if (code.length === 7) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}

export function formatSecret(b32: string): string {
  return b32.replace(/=+$/, '').replace(/(.{4})/g, '$1 ').trim();
}
