/**
 * Chia sẻ trạng thái tool qua URL (query string).
 * Dùng cùng `ShareLinkButton`. Chỉ đưa dữ liệu nhỏ (cấu hình, mẫu ngắn) vào link.
 */
const MAX_URL_LENGTH = 6000;

export function readShareParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/** Trả về URL đầy đủ của trang hiện tại kèm tham số; null nếu quá dài. Giá trị rỗng bị bỏ qua. */
export function buildShareUrl(params: Record<string, string | undefined | null>): string | null {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const out = url.toString();
  return out.length > MAX_URL_LENGTH ? null : out;
}

/* ------------------------------------------------------------------
 * Link chia sẻ nén: khi trạng thái quá lớn cho query string, đóng gói
 * toàn bộ params thành JSON -> nén (deflate-raw) -> base64url trong #z=...
 * Định dạng: `#z=<c><data>` với c = 'd' (deflate-raw) hoặc 'p' (không nén).
 * ------------------------------------------------------------------ */

const SHORT_URL_LENGTH = 2000;
const MAX_FRAGMENT_CHARS = 120_000;
const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_PARAM_COUNT = 200;
const MAX_KEY_LENGTH = 100;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hasStreams(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

async function readAll(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function pipeThrough(
  data: Uint8Array,
  transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> },
  maxBytes: number,
): Promise<Uint8Array | null> {
  const writer = transform.writable.getWriter();
  // Ghi song song với đọc để tránh nghẽn; lỗi ghi (dữ liệu hỏng/bị hủy) bị bỏ qua, phía đọc sẽ báo lỗi.
  const writing = writer
    .write(data as unknown as Uint8Array<ArrayBuffer>)
    .then(() => writer.close())
    .catch(() => {});
  const out = await readAll(transform.readable, maxBytes);
  if (out === null) await writer.abort().catch(() => {});
  await writing;
  return out;
}

/** Đóng gói params thành chuỗi fragment (không gồm `#z=`); null nếu quá lớn. */
export async function packShareState(params: Record<string, string>): Promise<string | null> {
  const json = new TextEncoder().encode(JSON.stringify(params));
  let flag = 'p';
  let payload: Uint8Array = json;
  if (hasStreams()) {
    try {
      const z = await pipeThrough(json, new CompressionStream('deflate-raw') as never, Number.MAX_SAFE_INTEGER);
      if (z) {
        flag = 'd';
        payload = z;
      }
    } catch {
      /* dùng bản không nén */
    }
  }
  const frag = flag + bytesToBase64Url(payload);
  return frag.length > MAX_FRAGMENT_CHARS ? null : frag;
}

function validateParams(v: unknown): Record<string, string> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > MAX_PARAM_COUNT) return null;
  const out: Record<string, string> = {};
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k) || k.length === 0 || k.length > MAX_KEY_LENGTH) return null;
    const val = (v as Record<string, unknown>)[k];
    if (typeof val !== 'string') return null;
    Object.defineProperty(out, k, { value: val, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** Giải mã fragment (không gồm `#z=`) thành params; null nếu hỏng/quá lớn/không hợp lệ. */
export async function unpackShareState(frag: string): Promise<Record<string, string> | null> {
  if (frag.length < 2 || frag.length > MAX_FRAGMENT_CHARS) return null;
  const flag = frag[0];
  const bytes = base64UrlToBytes(frag.slice(1));
  if (!bytes) return null;
  let raw: Uint8Array | null;
  if (flag === 'p') {
    raw = bytes.length > MAX_DECOMPRESSED_BYTES ? null : bytes;
  } else if (flag === 'd' && hasStreams()) {
    try {
      raw = await pipeThrough(bytes, new DecompressionStream('deflate-raw') as never, MAX_DECOMPRESSED_BYTES);
    } catch {
      raw = null;
    }
  } else {
    return null;
  }
  if (!raw) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    return validateParams(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Như buildShareUrl nhưng với trạng thái lớn sẽ nén vào fragment `#z=`. Null nếu vẫn quá lớn. */
export async function buildShareUrlAsync(params: Record<string, string | undefined | null>): Promise<string | null> {
  const plain = buildShareUrl(params);
  if (plain && plain.length <= SHORT_URL_LENGTH) return plain;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && !FORBIDDEN_KEYS.has(k)) {
      Object.defineProperty(clean, k, { value: v, enumerable: true, writable: true, configurable: true });
    }
  }
  const frag = await packShareState(clean);
  if (frag === null) return plain; // quá lớn để nén: dùng link thường nếu còn vừa (<= 6000), nếu không là null
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  const compact = `${url.origin}${url.pathname}#z=${frag}`;
  return plain && plain.length <= compact.length ? plain : compact;
}

/** True nếu đường dẫn hiện tại có fragment nén `#z=`. */
export function hasSharedFragment(): boolean {
  return typeof window !== 'undefined' && window.location.hash.startsWith('#z=');
}

/**
 * Nếu URL có `#z=...`: giải mã, ghi lại thanh địa chỉ thành `path?query` (không hash) rồi trả true.
 * Trang công cụ cần được mount lại để đọc query qua readShareParams().
 */
export async function restoreSharedState(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#z=')) return false;
  const frag = window.location.hash.slice(3);
  const params = await unpackShareState(frag);
  const url = new URL(window.location.href);
  url.hash = '';
  if (!params) {
    // Fragment hỏng: bỏ đi để không gây nhầm lẫn
    try {
      window.history.replaceState(window.history.state, '', url.pathname + url.search);
    } catch {
      /* bỏ qua */
    }
    return false;
  }
  url.search = '';
  for (const [k, v] of Object.entries(params)) if (v !== '') url.searchParams.set(k, v);
  try {
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  } catch {
    return false;
  }
  return true;
}
