/**
 * Công cụ phân tích / dựng / chuẩn hóa URL. Thuần logic, không phụ thuộc React.
 * Không bao giờ ném lỗi ra ngoài: hàm trả về đối tượng lỗi (thông báo tiếng Việt).
 */
import { base64Decode, decodeJwt } from './encoders';
import { detectTimestamp } from './time-tools';

export const MAX_URL_LENGTH = 100_000;

/* ---------------- Mã hóa / giải mã phần trăm ---------------- */

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });
const utf8Loose = new TextDecoder('utf-8');

function fixSurrogates(s: string): string {
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}

/** encodeURIComponent không ném lỗi với surrogate lẻ. */
export function encodeComponent(s: string, spaceAsPlus = false): string {
  const out = encodeURIComponent(fixSurrogates(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return spaceAsPlus ? out.replace(/%20/g, '+') : out;
}

/** Giải mã %XX theo UTF-8; chuỗi sai giữ nguyên. `plus` đổi + thành khoảng trắng (form-encoding). */
export function safeDecode(s: string, plus = false): string {
  const src = plus ? s.replace(/\+/g, ' ') : s;
  return src.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(run.substr(i * 3 + 1, 2), 16);
    try {
      return utf8Fatal.decode(bytes);
    } catch {
      // Giải mã từng đoạn hợp lệ, byte hỏng giữ nguyên dạng %XX
      let out = '';
      let i = 0;
      while (i < bytes.length) {
        let ok = false;
        for (let len = Math.min(4, bytes.length - i); len >= 1; len--) {
          try {
            out += utf8Fatal.decode(bytes.subarray(i, i + len));
            i += len;
            ok = true;
            break;
          } catch {
            /* thử độ dài ngắn hơn */
          }
        }
        if (!ok) {
          out += run.substr(i * 3, 3);
          i++;
        }
      }
      return out;
    }
  });
}

export interface PercentToken {
  raw: string;
  decoded: string;
  kind: 'plain' | 'valid' | 'invalid' | 'badutf8';
}

export interface PercentInspection {
  tokens: PercentToken[];
  decodedOnce: string;
  layers: number; // số lớp mã hóa có thể giải
  finalDecoded: string;
  doubleEncoded: boolean;
  invalidCount: number;
  plusCount: number;
}

/** Soi mã hóa phần trăm: đoạn hợp lệ, % hỏng, UTF-8 hỏng, mã hóa kép. */
export function inspectPercent(input: string): PercentInspection {
  const s = input.slice(0, 20_000);
  const tokens: PercentToken[] = [];
  const re = /(?:%[0-9A-Fa-f]{2})+|%/g;
  let last = 0;
  let invalidCount = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) tokens.push({ raw: s.slice(last, m.index), decoded: s.slice(last, m.index), kind: 'plain' });
    if (m[0] === '%') {
      invalidCount++;
      tokens.push({ raw: '%', decoded: '%', kind: 'invalid' });
    } else {
      const bytes = new Uint8Array(m[0].length / 3);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(m[0].substr(i * 3 + 1, 2), 16);
      try {
        tokens.push({ raw: m[0], decoded: utf8Fatal.decode(bytes), kind: 'valid' });
      } catch {
        invalidCount++;
        tokens.push({ raw: m[0], decoded: utf8Loose.decode(bytes), kind: 'badutf8' });
      }
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) tokens.push({ raw: s.slice(last), decoded: s.slice(last), kind: 'plain' });
  const decodedOnce = safeDecode(s);
  let layers = 0;
  let cur = s;
  for (let i = 0; i < 6; i++) {
    const next = safeDecode(cur);
    if (next === cur) break;
    layers++;
    cur = next;
  }
  return {
    tokens,
    decodedOnce,
    layers,
    finalDecoded: cur,
    doubleEncoded: /%25[0-9A-Fa-f]{2}/.test(s) && layers >= 2,
    invalidCount,
    plusCount: (s.match(/\+/g) || []).length,
  };
}

/* ---------------- Punycode / IDN ---------------- */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;

function adapt(delta: number, numPoints: number, first: boolean): number {
  let d = first ? Math.floor(delta / 700) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + 38));
}

/** Giải mã một nhãn punycode (không kèm tiền tố xn--). Trả null nếu sai. */
export function punycodeDecode(input: string): string | null {
  const out: number[] = [];
  let basic = input.lastIndexOf('-');
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) {
    if (input.charCodeAt(j) >= 0x80) return null;
    out.push(input.charCodeAt(j));
  }
  let n = 128;
  let bias = 72;
  let i = 0;
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (idx >= input.length) return null;
      const c = input.charCodeAt(idx++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : BASE;
      if (digit >= BASE) return null;
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
      if (!Number.isFinite(w) || w > 1e12) return null;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    if (n > 0x10ffff) return null;
    out.splice(i++, 0, n);
  }
  try {
    return String.fromCodePoint(...out);
  } catch {
    return null;
  }
}

export interface HostForms {
  unicode: string;
  ascii: string;
  isIdn: boolean;
}

/** Hai dạng của tên miền: Unicode và ASCII (punycode). */
export function hostForms(host: string): HostForms {
  if (!host) return { unicode: '', ascii: '', isIdn: false };
  if (host.startsWith('[')) return { unicode: host.toLowerCase(), ascii: host.toLowerCase(), isIdn: false };
  let ascii = host;
  try {
    ascii = new URL('http://' + host).hostname || host;
  } catch {
    ascii = host.toLowerCase();
  }
  const unicode = ascii
    .split('.')
    .map((l) => (l.toLowerCase().startsWith('xn--') ? punycodeDecode(l.slice(4)) ?? l : l))
    .join('.');
  return { unicode, ascii, isIdn: unicode !== ascii || /[^\x00-\x7f]/.test(host) };
}

/* ---------------- Tách URL thô (giữ nguyên văn bản người dùng gõ) ---------------- */

export interface RawParts {
  scheme: string; // không có dấu ':'
  hasAuthority: boolean;
  userinfo: string; // 'user:pass' (thô), '' nếu không có
  host: string; // thô, kể cả [ipv6]
  port: string;
  path: string;
  query: string | null; // không có '?'
  hash: string | null; // không có '#'
  assumedScheme: boolean;
  protocolRelative: boolean;
}

export const DEFAULT_PORTS: Record<string, number> = {
  http: 80, https: 443, ftp: 21, ws: 80, wss: 443, ssh: 22, sftp: 22, smtp: 25, imap: 143, pop3: 110,
  ldap: 389, ldaps: 636, mysql: 3306, postgres: 5432, postgresql: 5432, redis: 6379, mongodb: 27017, amqp: 5672,
  rtsp: 554, git: 9418,
};

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*$/;
const OPAQUE_SCHEMES = new Set(['mailto', 'data', 'tel', 'sms', 'javascript', 'blob', 'urn', 'about', 'magnet', 'geo']);

function splitAuthority(auth: string): { userinfo: string; host: string; port: string } {
  const at = auth.lastIndexOf('@');
  const userinfo = at >= 0 ? auth.slice(0, at) : '';
  const hp = at >= 0 ? auth.slice(at + 1) : auth;
  if (hp.startsWith('[')) {
    const close = hp.indexOf(']');
    if (close >= 0) {
      const rest = hp.slice(close + 1);
      return { userinfo, host: hp.slice(0, close + 1), port: rest.startsWith(':') ? rest.slice(1) : '' };
    }
  }
  const colon = hp.lastIndexOf(':');
  if (colon >= 0 && /^\d*$/.test(hp.slice(colon + 1))) return { userinfo, host: hp.slice(0, colon), port: hp.slice(colon + 1) };
  return { userinfo, host: hp, port: '' };
}

/** Tách URL thành các phần mà không chuẩn hóa. Trả null nếu chuỗi rỗng hoặc không nhận ra được. */
export function splitUrl(input: string): RawParts | null {
  let s = input.trim();
  if (!s || s.length > MAX_URL_LENGTH) return null;
  let assumedScheme = false;
  let protocolRelative = false;
  if (s.startsWith('//')) {
    protocolRelative = true;
    s = 'https:' + s;
  }
  let scheme = '';
  let rest = s;
  const m = /^([^:/?#]+):/.exec(s);
  if (m && SCHEME_RE.test(m[1])) {
    const after = s.slice(m[0].length);
    // "localhost:3000/x" hoặc "example.com:8080" là host:port, không phải scheme
    if (/^\d+([/?#]|$)/.test(after) && !OPAQUE_SCHEMES.has(m[1].toLowerCase())) {
      scheme = 'https';
      assumedScheme = true;
      rest = s;
      rest = '//' + rest;
    } else {
      scheme = m[1];
      rest = after;
    }
  } else if (/^[^/?#:\s]+\.[^/?#\s]+/.test(s) || /^\[[0-9a-fA-F:.]+\]/.test(s)) {
    // "example.com/path" -> giả định https
    scheme = 'https';
    assumedScheme = true;
    rest = '//' + s;
  } else {
    return null;
  }
  let hash: string | null = null;
  const hi = rest.indexOf('#');
  if (hi >= 0) {
    hash = rest.slice(hi + 1);
    rest = rest.slice(0, hi);
  }
  let query: string | null = null;
  const qi = rest.indexOf('?');
  if (qi >= 0) {
    query = rest.slice(qi + 1);
    rest = rest.slice(0, qi);
  }
  let hasAuthority = false;
  let userinfo = '';
  let host = '';
  let port = '';
  let path = rest;
  if (rest.startsWith('//')) {
    hasAuthority = true;
    const end = rest.indexOf('/', 2);
    const auth = end >= 0 ? rest.slice(2, end) : rest.slice(2);
    path = end >= 0 ? rest.slice(end) : '';
    ({ userinfo, host, port } = splitAuthority(auth));
  }
  return { scheme, hasAuthority, userinfo, host, port, path, query, hash, assumedScheme, protocolRelative };
}

/** Ghép các phần thô lại thành chuỗi URL. */
export function assembleUrl(p: Pick<RawParts, 'scheme' | 'hasAuthority' | 'userinfo' | 'host' | 'port' | 'path' | 'query' | 'hash'>): string {
  let out = p.scheme ? p.scheme + ':' : '';
  if (p.hasAuthority) {
    out += '//';
    if (p.userinfo) out += p.userinfo + '@';
    out += p.host;
    if (p.port) out += ':' + p.port;
  }
  let path = p.path;
  if (p.hasAuthority && path && !path.startsWith('/')) path = '/' + path;
  out += path;
  if (p.query !== null) out += '?' + p.query;
  if (p.hash !== null) out += '#' + p.hash;
  return out;
}

export function splitUserinfo(userinfo: string): { user: string; pass: string | null } {
  const i = userinfo.indexOf(':');
  return i < 0 ? { user: userinfo, pass: null } : { user: userinfo.slice(0, i), pass: userinfo.slice(i + 1) };
}

export function joinUserinfo(user: string, pass: string | null): string {
  if (!user && !pass) return '';
  return pass === null || pass === '' ? user : `${user}:${pass}`;
}

export function pathToSegments(path: string): string[] {
  if (!path || path === '/') return [];
  return (path.startsWith('/') ? path.slice(1) : path).split('/');
}

export function segmentsToPath(segs: string[], keepRoot = true): string {
  if (!segs.length) return keepRoot ? '/' : '';
  return '/' + segs.join('/');
}

/* ---------------- Parse bằng WHATWG URL ---------------- */

export interface ParsedUrl {
  href: string;
  protocol: string;
  hostname: string;
  port: string;
  effectivePort: string;
  defaultPort: number | null;
  isDefaultPort: boolean;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  isIPv6: boolean;
  isIPv4: boolean;
  hostForms: HostForms;
  summary: { label: string; value: string }[];
}

export type ParseResult = { ok: true; value: ParsedUrl; raw: RawParts | null; baseUsed: boolean } | { ok: false; error: string };

function schemeSummary(u: URL): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const proto = u.protocol.replace(/:$/, '').toLowerCase();
  if (proto === 'mailto') {
    const [toPart] = u.pathname.split('?');
    out.push({ label: 'Người nhận (to)', value: safeDecode(toPart) || '(trống)' });
    for (const k of ['cc', 'bcc', 'subject', 'body']) {
      const v = u.searchParams.get(k);
      if (v !== null) out.push({ label: k, value: v });
    }
  } else if (proto === 'tel' || proto === 'sms') {
    out.push({ label: 'Số điện thoại', value: safeDecode(u.pathname) });
  } else if (proto === 'data') {
    out.push(...summarizeDataUri(u.href));
  } else if (proto === 'javascript') {
    out.push({ label: 'Cảnh báo', value: 'URL javascript: có thể thực thi mã. Công cụ này không mở liên kết.' });
  }
  return out;
}

export function summarizeDataUri(uri: string): { label: string; value: string }[] {
  const m = /^data:([^,]*),([\s\S]*)$/i.exec(uri);
  if (!m) return [{ label: 'Lỗi', value: 'Data URI không hợp lệ (thiếu dấu phẩy).' }];
  const meta = m[1].split(';');
  const isB64 = meta.some((x) => x.toLowerCase() === 'base64');
  const mime = meta[0] && meta[0].includes('/') ? meta[0] : 'text/plain';
  const charset = meta.find((x) => x.toLowerCase().startsWith('charset='))?.slice(8) || '';
  const payload = m[2];
  let bytes = 0;
  if (isB64) {
    const clean = payload.replace(/\s+/g, '');
    bytes = Math.max(0, Math.floor((clean.replace(/=+$/, '').length * 3) / 4));
  } else {
    bytes = new TextEncoder().encode(safeDecode(payload)).length;
  }
  const out = [
    { label: 'MIME', value: mime },
    { label: 'Mã hóa', value: isB64 ? 'base64' : 'phần trăm' + (charset ? `, charset=${charset}` : '') },
    { label: 'Kích thước dữ liệu', value: `${bytes.toLocaleString('vi-VN')} byte` },
  ];
  let preview = '';
  if (/^(text\/|application\/(json|xml|javascript))/.test(mime) || mime.includes('+xml') || mime.includes('+json')) {
    try {
      preview = isB64 ? base64Decode(payload.slice(0, 4000)) : safeDecode(payload.slice(0, 2000));
    } catch {
      preview = '';
    }
  }
  if (preview) out.push({ label: 'Xem trước', value: preview.slice(0, 300) });
  return out;
}

/** Phân tích URL; hỗ trợ protocol-relative, tương đối (cần base), thiếu scheme (giả định https). */
export function parseUrl(input: string, base?: string): ParseResult {
  const s = input.trim();
  if (!s) return { ok: false, error: 'Chưa nhập URL.' };
  if (s.length > MAX_URL_LENGTH) return { ok: false, error: `URL quá dài (tối đa ${MAX_URL_LENGTH.toLocaleString('vi-VN')} ký tự).` };
  const raw = splitUrl(s);
  let u: URL | null = null;
  let baseUsed = false;
  const hasBase = !!(base && base.trim());
  if (!(raw?.protocolRelative && hasBase)) {
    try {
      u = new URL(raw && (raw.assumedScheme || raw.protocolRelative) ? assembleUrl(raw) : s);
    } catch {
      u = null;
    }
  }
  if (!u && base && base.trim()) {
    try {
      u = new URL(s, base.trim());
      baseUsed = true;
    } catch {
      u = null;
    }
  }
  if (!u) {
    const needBase = !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(s);
    return {
      ok: false,
      error: needBase ? 'URL tương đối: hãy nhập "Base URL" để giải thành URL tuyệt đối.' : 'URL không hợp lệ (không thể phân tích theo chuẩn WHATWG).',
    };
  }
  const proto = u.protocol.replace(/:$/, '');
  const dp = DEFAULT_PORTS[proto] ?? null;
  const hostname = u.hostname;
  const isIPv6 = hostname.startsWith('[');
  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  return {
    ok: true,
    raw: baseUsed ? splitUrl(u.href) : raw,
    baseUsed,
    value: {
      href: u.href,
      protocol: proto,
      hostname,
      port: u.port,
      effectivePort: u.port || (dp !== null ? String(dp) : ''),
      defaultPort: dp,
      isDefaultPort: dp !== null && (u.port === '' || u.port === String(dp)),
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
      origin: u.origin === 'null' ? '' : u.origin,
      isIPv6,
      isIPv4,
      hostForms: hostForms(isIPv6 ? hostname : hostname),
      summary: schemeSummary(u),
    },
  };
}

/* ---------------- Query ---------------- */

export interface QueryParam {
  key: string;
  value: string;
  /** true nếu token gốc không có dấu '=' (vd "?flag") */
  noEq?: boolean;
}

export function splitQueryRaw(query: string): string[] {
  const q = query.startsWith('?') ? query.slice(1) : query;
  if (!q) return [];
  return q.split('&').filter((t) => t !== '');
}

/** Phân tích chuỗi query. `plus`: coi + là khoảng trắng; `decode`: giải %XX. */
export function parseQuery(query: string, opts: { decode?: boolean; plus?: boolean } = {}): QueryParam[] {
  const { decode = true, plus = true } = opts;
  return splitQueryRaw(query.slice(0, MAX_URL_LENGTH)).map((tok) => {
    const i = tok.indexOf('=');
    const k = i < 0 ? tok : tok.slice(0, i);
    const v = i < 0 ? '' : tok.slice(i + 1);
    return decode
      ? { key: safeDecode(k, plus), value: safeDecode(v, plus), noEq: i < 0 }
      : { key: k, value: v, noEq: i < 0 };
  });
}

export type ArrayStyle = 'repeat' | 'brackets' | 'index' | 'comma';
export type EncodeMode = 'percent' | 'plus' | 'none';

/** Biến đổi danh sách tham số trùng khóa theo kiểu mảng. */
export function applyArrayStyle(params: QueryParam[], style: ArrayStyle): QueryParam[] {
  if (style === 'repeat') return params;
  const counts = new Map<string, number>();
  for (const p of params) counts.set(p.key, (counts.get(p.key) || 0) + 1);
  if (style === 'comma') {
    const out: QueryParam[] = [];
    const seen = new Map<string, QueryParam>();
    for (const p of params) {
      const ex = seen.get(p.key);
      if (ex) ex.value += ',' + p.value;
      else {
        const c = { ...p };
        seen.set(p.key, c);
        out.push(c);
      }
    }
    return out;
  }
  const idx = new Map<string, number>();
  return params.map((p) => {
    if ((counts.get(p.key) || 0) < 2) return p;
    const base = p.key.replace(/\[\d*\]$/, '');
    if (style === 'brackets') return { ...p, key: base + '[]' };
    const n = idx.get(base) || 0;
    idx.set(base, n + 1);
    return { ...p, key: `${base}[${n}]` };
  });
}

/** Gom các khóa dạng `a[]`, `a[0]` thành khóa trùng `a` (đảo ngược applyArrayStyle). */
export function flattenArrayKeys(params: QueryParam[]): QueryParam[] {
  return params.map((p) => ({ ...p, key: p.key.replace(/\[\d*\]$/, '') }));
}

export function buildQuery(params: QueryParam[], opts: { mode?: EncodeMode; style?: ArrayStyle } = {}): string {
  const { mode = 'percent', style = 'repeat' } = opts;
  const list = applyArrayStyle(params, style);
  const enc = (s: string) => (mode === 'none' ? s : encodeComponent(s, mode === 'plus'));
  return list
    .filter((p) => p.key !== '' || p.value !== '')
    .map((p) => {
      if (p.noEq && p.value === '') return enc(p.key);
      return `${enc(p.key)}=${enc(p.value)}`;
    })
    .join('&');
}

/* ---------------- Phát hiện giá trị đặc biệt ---------------- */

export type ValueKind = 'url' | 'json' | 'jwt' | 'base64' | 'timestamp' | 'percent';

export interface ValueInsight {
  kind: ValueKind;
  label: string;
  /** Nội dung đã giải mã / diễn giải (đã cắt ngắn). */
  decoded: string;
}

function printableRatio(s: string): number {
  if (!s) return 0;
  let ok = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127 && c !== 0xfffd && !(c >= 0x80 && c < 0xa0))) ok++;
  }
  return ok / [...s].length;
}

export function detectValue(value: string): ValueInsight[] {
  const out: ValueInsight[] = [];
  const v = value.trim();
  if (!v || v.length > 50_000) return out;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+$/.test(v) || /^(mailto|tel):\S+$/i.test(v)) {
    out.push({ kind: 'url', label: 'URL lồng nhau', decoded: v });
  }
  if (/%[0-9A-Fa-f]{2}/.test(v)) {
    const d = safeDecode(v);
    if (d !== v) out.push({ kind: 'percent', label: 'Còn mã hóa %XX', decoded: d.slice(0, 2000) });
  }
  if (/^[[{]/.test(v)) {
    try {
      const j = JSON.parse(v);
      if (j && typeof j === 'object') out.push({ kind: 'json', label: 'JSON', decoded: JSON.stringify(j, null, 2).slice(0, 4000) });
    } catch {
      /* không phải JSON */
    }
  }
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(v)) {
    try {
      const r = decodeJwt(v);
      out.push({ kind: 'jwt', label: 'JWT', decoded: `header: ${JSON.stringify(r.header)}\npayload: ${r.payloadJson}`.slice(0, 4000) });
    } catch {
      /* không phải JWT */
    }
  } else if (/^[A-Za-z0-9+/_-]{12,}={0,2}$/.test(v) && !/^\d+$/.test(v)) {
    try {
      const d = base64Decode(v);
      if (printableRatio(d) > 0.92 && d.length >= 4) out.push({ kind: 'base64', label: 'Base64', decoded: d.slice(0, 4000) });
    } catch {
      /* không phải Base64 */
    }
  }
  if (/^\d{9,19}$/.test(v)) {
    const t = detectTimestamp(v);
    if (t) {
      const y = new Date(t.ms).getUTCFullYear();
      if (y >= 1990 && y <= 2100) {
        out.push({ kind: 'timestamp', label: `Timestamp (${t.unit})`, decoded: new Date(t.ms).toISOString() });
      }
    }
  }
  return out;
}

/* ---------------- Chuẩn hóa ---------------- */

export const TRACKING_PARAMS = [
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'igshid', 'mc_cid', 'mc_eid', '_ga', '_gl', 'mkt_tok', 'vero_id', 'ref_src', 'ref_url', 'spm', 's_cid', 'oly_anon_id', 'oly_enc_id',
];

export function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || TRACKING_PARAMS.includes(k);
}

export interface NormalizeOptions {
  removeDefaultPort: boolean;
  sortParams: boolean;
  stripTracking: boolean;
  trailingSlash: 'keep' | 'remove' | 'add';
  removeFragment: boolean;
  removeEmptyParams: boolean;
  stripWww: boolean;
  forceHttps: boolean;
}

export const DEFAULT_NORMALIZE: NormalizeOptions = {
  removeDefaultPort: true,
  sortParams: true,
  stripTracking: true,
  trailingSlash: 'remove',
  removeFragment: false,
  removeEmptyParams: false,
  stripWww: false,
  forceHttps: false,
};

export type NormalizeResult = { ok: true; url: string; changes: string[] } | { ok: false; error: string };

export function normalizeUrl(input: string, o: NormalizeOptions = DEFAULT_NORMALIZE): NormalizeResult {
  const r = splitUrl(input);
  if (!r) return { ok: false, error: 'URL không hợp lệ.' };
  let u: URL;
  try {
    u = new URL(r.assumedScheme || r.protocolRelative ? assembleUrl(r) : input.trim());
  } catch {
    return { ok: false, error: 'URL không hợp lệ.' };
  }
  const changes: string[] = [];
  const before = input.trim();
  if (r.assumedScheme) changes.push('Thêm scheme https://');
  if (u.protocol !== (r.scheme.toLowerCase() + ':') && !r.assumedScheme) changes.push('Chữ thường scheme');
  if (o.forceHttps && u.protocol === 'http:') {
    // URL không cho đổi sang https trực tiếp từ http qua .protocol? Thực tế được vì cả hai đều special.
    u.protocol = 'https:';
    changes.push('Đổi http -> https');
  }
  if (o.removeDefaultPort && r.port && u.port === '' ) changes.push('Bỏ cổng mặc định :' + r.port);
  if (r.hasAuthority && r.host && r.host !== u.hostname && r.host.toLowerCase() === u.hostname) changes.push('Chữ thường tên miền');
  if (!o.removeDefaultPort && u.port === '' && r.port) {
    // URL tự bỏ cổng mặc định; không thể giữ lại
  }
  if (o.stripWww && u.hostname.startsWith('www.') && u.hostname.split('.').length > 2) {
    u.hostname = u.hostname.slice(4);
    changes.push('Bỏ www.');
  }
  if (o.removeFragment && u.hash) {
    u.hash = '';
    changes.push('Bỏ fragment');
  }
  // path
  const pathBefore = r.path;
  let pn = u.pathname;
  if (o.trailingSlash === 'remove' && pn.length > 1 && pn.endsWith('/')) {
    pn = pn.replace(/\/+$/, '') || '/';
    changes.push('Bỏ dấu / cuối đường dẫn');
  } else if (o.trailingSlash === 'add' && !pn.endsWith('/') && !/\.[A-Za-z0-9]{1,6}$/.test(pn.split('/').pop() || '')) {
    pn += '/';
    changes.push('Thêm dấu / cuối đường dẫn');
  }
  if (u.pathname !== pn && !u.protocol.match(/^(mailto|data|javascript):$/)) u.pathname = pn;
  if (/(^|\/)\.\.?(\/|$)/.test(pathBefore.replace(/%2e/gi, '.'))) changes.push('Giải ".." / "." trong đường dẫn');
  // query
  if (u.search) {
    let toks = splitQueryRaw(u.search);
    const n0 = toks.length;
    const keyOf = (t: string) => safeDecode(t.split('=')[0], true);
    if (o.stripTracking) {
      toks = toks.filter((t) => !isTrackingParam(keyOf(t)));
      if (toks.length < n0) changes.push(`Bỏ ${n0 - toks.length} tham số theo dõi`);
    }
    if (o.removeEmptyParams) {
      const n1 = toks.length;
      toks = toks.filter((t) => t.includes('=') && t.slice(t.indexOf('=') + 1) !== '');
      if (toks.length < n1) changes.push(`Bỏ ${n1 - toks.length} tham số rỗng`);
    }
    if (o.sortParams) {
      const sorted = toks
        .map((t, i) => ({ t, i, k: keyOf(t) }))
        .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
        .map((x) => x.t);
      if (sorted.join('&') !== toks.join('&')) changes.push('Sắp xếp tham số theo tên');
      toks = sorted;
    }
    u.search = toks.length ? '?' + toks.join('&') : '';
  }
  let url = u.href;
  if (u.search === '' && u.href.endsWith('?')) url = url.slice(0, -1);
  if (url === before && !changes.length) changes.push('Không có thay đổi');
  return { ok: true, url, changes };
}

/* ---------------- Resolver / UTM ---------------- */

export function resolveRelative(base: string, rel: string): { ok: true; url: string } | { ok: false; error: string } {
  if (!base.trim()) return { ok: false, error: 'Chưa nhập Base URL.' };
  try {
    return { ok: true, url: new URL(rel.trim(), base.trim()).href };
  } catch {
    return { ok: false, error: 'Không giải được: Base URL phải là URL tuyệt đối hợp lệ.' };
  }
}

export interface UtmFields {
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
  id: string;
}

export const EMPTY_UTM: UtmFields = { source: '', medium: '', campaign: '', term: '', content: '', id: '' };

export function buildUtmUrl(baseUrl: string, utm: UtmFields): { ok: true; url: string } | { ok: false; error: string } {
  const raw = splitUrl(baseUrl);
  if (!raw) return { ok: false, error: 'Nhập URL gốc hợp lệ.' };
  const toks = splitQueryRaw(raw.query ?? '');
  const entries: [string, string][] = [
    ['utm_source', utm.source], ['utm_medium', utm.medium], ['utm_campaign', utm.campaign],
    ['utm_term', utm.term], ['utm_content', utm.content], ['utm_id', utm.id],
  ];
  const keys = new Set(entries.filter(([, v]) => v.trim() !== '').map(([k]) => k));
  const kept = toks.filter((t) => !keys.has(safeDecode(t.split('=')[0], true).toLowerCase()));
  for (const [k, v] of entries) if (v.trim() !== '') kept.push(`${k}=${encodeComponent(v.trim())}`);
  const url = assembleUrl({ ...raw, query: kept.length ? kept.join('&') : raw.query === null ? null : '' });
  return { ok: true, url };
}

/* ---------------- Batch ---------------- */

export interface BatchRow {
  index: number;
  input: string;
  ok: boolean;
  error?: string;
  host: string;
  path: string;
  params: number;
  normalized: string;
}

export const MAX_BATCH = 5000;

export function analyzeBatch(text: string, norm: NormalizeOptions): { rows: BatchRow[]; truncated: boolean } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const truncated = lines.length > MAX_BATCH;
  const rows = lines.slice(0, MAX_BATCH).map((input, index): BatchRow => {
    const p = parseUrl(input);
    if (!p.ok) return { index, input, ok: false, error: p.error, host: '', path: '', params: 0, normalized: '' };
    const n = normalizeUrl(input, norm);
    return {
      index,
      input,
      ok: true,
      host: p.value.hostForms.unicode || p.value.hostname,
      path: p.value.pathname,
      params: splitQueryRaw(p.value.search).length,
      normalized: n.ok ? n.url : p.value.href,
    };
  });
  return { rows, truncated };
}

export type BatchSort = 'none' | 'url' | 'host' | 'path' | 'params';

export function dedupeAndSort(rows: BatchRow[], dedupe: boolean, sort: BatchSort): BatchRow[] {
  let out = rows;
  if (dedupe) {
    const seen = new Set<string>();
    out = out.filter((r) => {
      const k = r.ok ? r.normalized : 'x:' + r.input;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (sort !== 'none') {
    const key = (r: BatchRow): string | number =>
      sort === 'url' ? r.normalized || r.input : sort === 'host' ? r.host : sort === 'path' ? r.path : r.params;
    out = [...out].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return x < y ? -1 : x > y ? 1 : a.index - b.index;
    });
  }
  return out;
}

function csvCell(s: string): string {
  // Chống CSV injection + escape
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function batchToCsv(rows: BatchRow[]): string {
  const head = 'url,host,path,params,normalized,loi';
  return [head, ...rows.map((r) => [r.input, r.host, r.path, String(r.params), r.normalized, r.error || ''].map(csvCell).join(','))].join('\n');
}
