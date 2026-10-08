/**
 * cURL → Code: phân tích lệnh cURL (POSIX shell / Chrome DevTools / Windows cmd) và sinh mã cho nhiều ngôn ngữ.
 * Thuần logic, không phụ thuộc React. Không bao giờ throw với đầu vào sai: trả về lỗi tiếng Việt.
 */

export const MAX_CURL_INPUT = 1_000_000;

/* ------------------------------------------------------------------ */
/* JSON giữ nguyên thứ tự khóa và số gốc                               */
/* ------------------------------------------------------------------ */

export type JNode =
  | { t: 'obj'; e: [string, JNode][] }
  | { t: 'arr'; v: JNode[] }
  | { t: 'str'; v: string }
  | { t: 'num'; raw: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' };

const NUM_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/;

/** Parser JSON chặt chẽ; trả null nếu không hợp lệ. Giữ thứ tự khóa, khóa trùng và số nguyên bản. */
export function parseJsonNode(text: string): JNode | null {
  let i = 0;
  const n = text.length;
  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  class Fail extends Error {}
  const fail = (): never => {
    throw new Fail();
  };
  const str = (): string => {
    // text[i] === '"'
    i++;
    let out = '';
    for (;;) {
      if (i >= n) fail();
      const c = text[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c === '\\') {
        const d = text[i + 1];
        i += 2;
        switch (d) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const h = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) fail();
            out += String.fromCharCode(parseInt(h, 16));
            i += 4;
            break;
          }
          default:
            fail();
        }
        continue;
      }
      if (c.charCodeAt(0) < 0x20) fail();
      out += c;
      i++;
    }
  };
  const val = (depth: number): JNode => {
    if (depth > 120) fail();
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const e: [string, JNode][] = [];
      ws();
      if (text[i] === '}') {
        i++;
        return { t: 'obj', e };
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        const k = str();
        ws();
        if (text[i] !== ':') fail();
        i++;
        e.push([k, val(depth + 1)]);
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return { t: 'obj', e };
        }
        fail();
      }
    }
    if (c === '[') {
      i++;
      const v: JNode[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return { t: 'arr', v };
      }
      for (;;) {
        v.push(val(depth + 1));
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return { t: 'arr', v };
        }
        fail();
      }
    }
    if (c === '"') return { t: 'str', v: str() };
    if (text.startsWith('true', i)) {
      i += 4;
      return { t: 'bool', v: true };
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return { t: 'bool', v: false };
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return { t: 'null' };
    }
    const m = NUM_RE.exec(text.slice(i, i + 400));
    if (!m) return fail();
    i += m[0].length;
    return { t: 'num', raw: m[0] };
  };
  try {
    const r = val(0);
    ws();
    if (i < n) return null;
    return r;
  } catch {
    return null;
  }
}

/** Kiểm tra JSON có thể biểu diễn nguyên vẹn bằng cấu trúc native của ngôn ngữ đích không. */
export function jsonSafeFor(node: JNode, flavor: 'generic' | 'js' | 'php'): boolean {
  const walk = (x: JNode): boolean => {
    switch (x.t) {
      case 'num': {
        const v = Number(x.raw);
        if (!Number.isFinite(v)) return false;
        const isInt = /^-?\d+$/.test(x.raw);
        if (isInt) return Number.isSafeInteger(v);
        const digits = x.raw.replace(/[eE].*$/, '').replace(/[-.]/g, '').replace(/^0+/, '');
        return digits.length <= 15;
      }
      case 'arr':
        return x.v.every(walk);
      case 'obj': {
        const seen = new Set<string>();
        for (const [k, v] of x.e) {
          if (seen.has(k)) return false;
          seen.add(k);
          if (flavor === 'js' && (k === '__proto__' || /^(0|[1-9]\d{0,9})$/.test(k))) return false;
          if (flavor === 'php' && /^(0|-?[1-9]\d*)$/.test(k)) return false;
          if (!walk(v)) return false;
        }
        return true;
      }
      default:
        return true;
    }
  };
  return walk(node);
}

function jsonStr(s: string): string {
  return JSON.stringify(s);
}

/** Chuỗi JSON đã định dạng (indent) từ JNode. */
export function jsonNodeToString(n: JNode, indent = 2, depth = 0): string {
  const pad = (d: number) => ' '.repeat(indent * d);
  switch (n.t) {
    case 'str': return jsonStr(n.v);
    case 'num': return n.raw;
    case 'bool': return n.v ? 'true' : 'false';
    case 'null': return 'null';
    case 'arr':
      if (!n.v.length) return '[]';
      return '[\n' + n.v.map((x) => pad(depth + 1) + jsonNodeToString(x, indent, depth + 1)).join(',\n') + '\n' + pad(depth) + ']';
    case 'obj':
      if (!n.e.length) return '{}';
      return (
        '{\n' +
        n.e.map(([k, v]) => pad(depth + 1) + jsonStr(k) + ': ' + jsonNodeToString(v, indent, depth + 1)).join(',\n') +
        '\n' + pad(depth) + '}'
      );
  }
}

/** JSON nén (một dòng). */
export function jsonNodeToCompact(n: JNode): string {
  switch (n.t) {
    case 'str': return jsonStr(n.v);
    case 'num': return n.raw;
    case 'bool': return n.v ? 'true' : 'false';
    case 'null': return 'null';
    case 'arr': return '[' + n.v.map(jsonNodeToCompact).join(',') + ']';
    case 'obj': return '{' + n.e.map(([k, v]) => jsonStr(k) + ':' + jsonNodeToCompact(v)).join(',') + '}';
  }
}

interface JCfg {
  indent: string;
  key: (k: string) => string;
  str: (s: string) => string;
  kv: string;
  t: string;
  f: string;
  nul: string;
  obj: [string, string];
  arr: [string, string];
  emptyObj: string;
  emptyArr: string;
}

function renderJson(n: JNode, c: JCfg, depth = 0): string {
  const pad = (d: number) => c.indent.repeat(d);
  if (n.t === 'arr' && n.v.length && n.v.every((x) => x.t !== 'arr' && x.t !== 'obj')) {
    const inline = c.arr[0] + n.v.map((x) => renderJson(x, c, depth + 1)).join(', ') + c.arr[1];
    if (inline.length <= 72 && !inline.includes('\n')) return inline;
  }
  switch (n.t) {
    case 'str': return c.str(n.v);
    case 'num': return n.raw;
    case 'bool': return n.v ? c.t : c.f;
    case 'null': return c.nul;
    case 'arr':
      if (!n.v.length) return c.emptyArr;
      return c.arr[0] + '\n' + n.v.map((x) => pad(depth + 1) + renderJson(x, c, depth + 1)).join(',\n') + '\n' + pad(depth) + c.arr[1];
    case 'obj':
      if (!n.e.length) return c.emptyObj;
      return (
        c.obj[0] + '\n' +
        n.e.map(([k, v]) => pad(depth + 1) + c.key(k) + c.kv + renderJson(v, c, depth + 1)).join(',\n') +
        '\n' + pad(depth) + c.obj[1]
      );
  }
}

/* ------------------------------------------------------------------ */
/* Tokenizer (shell word splitting)                                    */
/* ------------------------------------------------------------------ */

export interface TokenizeResult {
  words: string[];
  notes: string[];
}

function decodeBytes(bytes: number[]): string {
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function safeFromCodePoint(cp: number): string {
  if (cp >= 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
  return '\uFFFD';
}

/** Giải mã nội dung `$'...'` bắt đầu tại s[i] (ngay sau dấu nháy mở). Trả về chuỗi và vị trí sau dấu nháy đóng. */
function readAnsiC(s: string, start: number): { value: string; end: number; closed: boolean } {
  let i = start;
  let out = '';
  let bytes: number[] = [];
  const flush = () => {
    if (bytes.length) {
      out += decodeBytes(bytes);
      bytes = [];
    }
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      flush();
      return { value: out, end: i + 1, closed: true };
    }
    if (c !== '\\') {
      flush();
      out += c;
      i++;
      continue;
    }
    const d = s[i + 1];
    if (d === undefined) {
      flush();
      out += '\\';
      i++;
      continue;
    }
    const simple: Record<string, string> = {
      n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v',
      '\\': '\\', "'": "'", '"': '"', '?': '?',
    };
    if (d in simple) {
      flush();
      out += simple[d];
      i += 2;
    } else if (d === 'x') {
      const m = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 2, i + 4));
      if (m) {
        bytes.push(parseInt(m[0], 16));
        i += 2 + m[0].length;
      } else {
        flush();
        out += '\\x';
        i += 2;
      }
    } else if (d === 'u' || d === 'U') {
      const max = d === 'u' ? 4 : 8;
      const m = new RegExp(`^[0-9a-fA-F]{1,${max}}`).exec(s.slice(i + 2, i + 2 + max));
      flush();
      if (m) {
        out += safeFromCodePoint(parseInt(m[0], 16));
        i += 2 + m[0].length;
      } else {
        out += '\\' + d;
        i += 2;
      }
    } else if (d >= '0' && d <= '7') {
      const m = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))!;
      bytes.push(parseInt(m[0], 8) & 0xff);
      i += 1 + m[0].length;
    } else if (d === 'c' && s[i + 2] !== undefined) {
      flush();
      out += String.fromCharCode(s.charCodeAt(i + 2) & 0x1f);
      i += 3;
    } else {
      flush();
      out += '\\' + d;
      i += 2;
    }
  }
  flush();
  return { value: out, end: i, closed: false };
}

/** Tiền xử lý kiểu Windows cmd: bỏ ký tự thoát `^`. */
function stripCaret(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '^' && i + 1 < s.length) {
      const d = s[i + 1];
      i++;
      if (d === '\n') continue; // nối dòng
      if (d === '\r' && s[i + 1] === '\n') {
        i++;
        continue;
      }
      out += d;
    } else if (c === '^') {
      // caret ở cuối chuỗi: bỏ
    } else out += c;
  }
  return out;
}

export function tokenize(input: string, forceMode?: 'posix' | 'cmd'): TokenizeResult {
  let s = input;
  const notes: string[] = [];
  const cmd = forceMode ? forceMode === 'cmd' : /(^|\s)\^"/.test(s) || /[ \t]\^[ \t]*\r?\n/.test(s);
  if (cmd) {
    s = stripCaret(s);
    notes.push('Phát hiện cú pháp Windows cmd (ký tự ^), đã thoát ký tự theo kiểu best-effort.');
  }
  const words: string[] = [];
  let cur = '';
  let has = false;
  let warnedVar = false;
  let truncated = false;
  const flush = () => {
    if (has || cur !== '') words.push(cur);
    cur = '';
    has = false;
  };
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      flush();
      i++;
      continue;
    }
    if (!has && cur === '') {
      if (c === '#' && !cmd) {
        while (i < n && s[i] !== '\n') i++;
        continue;
      }
      if (c === '|' || c === ';' || c === '>' || (c === '&' && (s[i + 1] === '&' || s[i + 1] === ' ' || s[i + 1] === undefined)) || (c === '2' && s[i + 1] === '>')) {
        truncated = true;
        break;
      }
    }
    if (c === '`' && !cmd && /^[ \t]*\r?\n/.test(s.slice(i + 1, i + 40))) {
      i += 1 + s.slice(i + 1).search(/\n/) + 1;
      continue;
    }
    if (c === '\\' && !cmd) {
      const d = s[i + 1];
      if (d === '\n') {
        i += 2;
        continue;
      }
      if (d === '\r' && s[i + 2] === '\n') {
        i += 3;
        continue;
      }
      if (d === undefined) {
        cur += '\\';
        has = true;
        i++;
        continue;
      }
      cur += d;
      has = true;
      i += 2;
      continue;
    }
    if (c === "'" && !cmd) {
      const j = s.indexOf("'", i + 1);
      if (j < 0) {
        notes.push('Dấu nháy đơn chưa được đóng; lấy phần còn lại làm giá trị.');
        cur += s.slice(i + 1);
        has = true;
        i = n;
      } else {
        cur += s.slice(i + 1, j);
        has = true;
        i = j + 1;
      }
      continue;
    }
    if (c === '$' && s[i + 1] === "'" && !cmd) {
      const r = readAnsiC(s, i + 2);
      if (!r.closed) notes.push("Chuỗi $'...' chưa được đóng.");
      cur += r.value;
      has = true;
      i = r.end;
      continue;
    }
    if (c === '"' || (c === '$' && s[i + 1] === '"' && !cmd)) {
      i += c === '$' ? 2 : 1;
      has = true;
      let closed = false;
      while (i < n) {
        const ch = s[i];
        if (ch === '"') {
          closed = true;
          i++;
          break;
        }
        if (ch === '\\') {
          const d = s[i + 1];
          if (d === '\n') {
            i += 2;
            continue;
          }
          if (d === '\r' && s[i + 2] === '\n') {
            i += 3;
            continue;
          }
          if (d === '"' || d === '\\' || (!cmd && (d === '$' || d === '`'))) {
            cur += d;
            i += 2;
            continue;
          }
          cur += '\\';
          i++;
          continue;
        }
        if (ch === '$' && !cmd && !warnedVar && /[A-Za-z_{(]/.test(s[i + 1] ?? '')) {
          warnedVar = true;
          notes.push('Có biến/thay thế shell ($VAR, $(...)) — được giữ nguyên dạng văn bản, hãy tự thay giá trị thật.');
        }
        cur += ch;
        i++;
      }
      if (!closed) notes.push('Dấu nháy kép chưa được đóng; lấy phần còn lại làm giá trị.');
      continue;
    }
    if (c === '$' && !cmd && !warnedVar && /[A-Za-z_{(]/.test(s[i + 1] ?? '')) {
      warnedVar = true;
      notes.push('Có biến/thay thế shell ($VAR, $(...)) — được giữ nguyên dạng văn bản, hãy tự thay giá trị thật.');
    }
    cur += c;
    has = true;
    i++;
  }
  flush();
  if (truncated) notes.push('Phát hiện toán tử shell (| ; && >) — chỉ phân tích phần lệnh cURL đầu tiên.');
  return { words, notes };
}

/* ------------------------------------------------------------------ */
/* Mô hình request                                                     */
/* ------------------------------------------------------------------ */

export interface Header {
  name: string;
  value: string;
  inferred?: boolean;
}

export interface FormField {
  name: string;
  value: string; // text: nội dung; file: đường dẫn
  kind: 'text' | 'file' | 'filetext';
  type?: string;
  filename?: string;
}

export type CurlBody =
  | { kind: 'text'; text: string; json: JNode | null }
  | { kind: 'file'; path: string }
  | null;

export interface ParsedCurl {
  method: string;
  methodExplicit: boolean;
  url: string; // đầy đủ, gồm query
  baseUrl: string; // không có query/fragment
  query: { name: string; value: string }[];
  headers: Header[];
  body: CurlBody;
  form: FormField[] | null;
  auth: { user: string; password: string } | null;
  insecure: boolean;
  follow: boolean;
  compressed: boolean;
  head: boolean;
  contentType: string | null;
  warnings: string[];
}

export type ParseResult =
  | { ok: true; req: ParsedCurl }
  | { ok: false; error: string; warnings: string[] };

const SHORT_WITH_ARG = new Set('AbcCdDeEFHKmoPQrtTuUwxXyYz'.split(''));

const SHORT_MAP: Record<string, string> = {
  X: 'request', H: 'header', d: 'data', F: 'form', u: 'user', A: 'user-agent', e: 'referer', b: 'cookie',
  k: 'insecure', L: 'location', G: 'get', I: 'head', o: 'output', x: 'proxy', T: 'upload-file',
  s: 'silent', S: 'show-error', v: 'verbose', i: 'include', f: 'fail', O: 'remote-name', J: 'remote-header-name',
  N: 'no-buffer', g: 'globoff', '4': 'ipv4', '6': 'ipv6', n: 'netrc', q: 'disable', '#': 'progress-bar',
  '0': 'http1.0', '1': 'tlsv1', '2': 'sslv2', '3': 'sslv3', j: 'junk-session-cookies', B: 'use-ascii',
  a: 'append', l: 'list-only', p: 'proxytunnel', R: 'remote-time', Z: 'parallel', M: 'manual',
  c: 'cookie-jar', D: 'dump-header', w: 'write-out', m: 'max-time', E: 'cert', K: 'config', C: 'continue-at',
  r: 'range', t: 'telnet-option', P: 'ftp-port', Q: 'quote', U: 'proxy-user', y: 'speed-time', Y: 'speed-limit',
  z: 'time-cond',
};

const LONG_WITH_ARG = new Set([
  'request', 'header', 'data', 'data-ascii', 'data-raw', 'data-binary', 'data-urlencode', 'form', 'form-string',
  'user', 'user-agent', 'referer', 'cookie', 'url', 'proxy', 'output', 'write-out', 'connect-timeout', 'max-time',
  'retry', 'retry-delay', 'retry-max-time', 'max-redirs', 'cacert', 'cert', 'key', 'capath', 'interface',
  'dump-header', 'cookie-jar', 'config', 'resolve', 'limit-rate', 'noproxy', 'proxy-user', 'upload-file',
  'oauth2-bearer', 'cert-type', 'key-type', 'pass', 'ciphers', 'tls13-ciphers', 'range', 'time-cond', 'dns-servers',
  'expect100-timeout', 'keepalive-time', 'local-port', 'proxy-header', 'request-target', 'speed-limit', 'speed-time',
  'trace', 'trace-ascii', 'unix-socket', 'aws-sigv4', 'json', 'url-query', 'variable', 'etag-save', 'etag-compare',
  'connect-to', 'curves', 'max-filesize', 'proto', 'proto-redir', 'doh-url', 'stderr', 'continue-at', 'quote',
  'telnet-option', 'ftp-port', 'proxy-cacert', 'proxy-cert', 'proxy-key', 'cookie-jar', 'ech', 'hsts', 'alt-svc',
  'happy-eyeballs-timeout-ms', 'rate', 'retry-connrefused-x', 'socks5', 'socks5-hostname', 'socks4', 'socks4a',
  'service-name', 'login-options', 'mail-from', 'mail-rcpt', 'krb', 'engine', 'pinnedpubkey', 'sasl-authzid',
  'parallel-max', 'output-dir', 'tftp-blksize', 'ssl-reqd-x', 'expand-data', 'expand-url', 'expand-header',
]);

const LONG_ALIASES: Record<string, string> = {
  'data-ascii': 'data',
  'compressed-ssh': 'compressed-ssh',
  'http1.1': 'http1.1',
};

const SILENT_IGNORE = new Set([
  'silent', 'show-error', 'verbose', 'include', 'fail', 'fail-with-body', 'remote-name', 'remote-header-name',
  'no-buffer', 'globoff', 'ipv4', 'ipv6', 'netrc', 'disable', 'progress-bar', 'http1.0', 'http1.1', 'http2',
  'http2-prior-knowledge', 'http3', 'tlsv1', 'tlsv1.0', 'tlsv1.1', 'tlsv1.2', 'tlsv1.3', 'sslv2', 'sslv3',
  'tcp-nodelay', 'no-keepalive', 'path-as-is', 'raw', 'fail-early', 'junk-session-cookies', 'use-ascii', 'append',
  'list-only', 'remote-time', 'parallel', 'manual', 'basic', 'no-progress-meter', 'styled-output', 'no-styled-output',
  'tr-encoding', 'ssl', 'ssl-reqd', 'ssl-no-revoke', 'location-trusted-x', 'disallow-username-in-url', 'xattr',
  'no-sessionid', 'compressed-ssh', 'suppress-connect-headers', 'http0.9', 'create-dirs', 'tcp-fastopen',
  'proxy-insecure-x', 'retry-connrefused', 'retry-all-errors', 'ignore-content-length', 'no-clobber', 'anyauth-x',
  'parallel-immediate', 'fail-with-body', 'location-trusted',
]);

const AUTH_WARN = new Set(['digest', 'ntlm', 'negotiate', 'anyauth', 'aws-sigv4']);

function isSafeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

export function parseQueryString(qs: string): { name: string; value: string }[] {
  if (!qs) return [];
  return qs
    .split('&')
    .filter((p) => p !== '')
    .map((p) => {
      const eq = p.indexOf('=');
      return eq < 0
        ? { name: isSafeDecode(p), value: '' }
        : { name: isSafeDecode(p.slice(0, eq)), value: isSafeDecode(p.slice(eq + 1)) };
    });
}

/** Mã hóa % kiểu curl --data-urlencode (chỉ giữ lại ký tự unreserved). */
export function curlUrlEncode(s: string): string {
  let out = '';
  for (const ch of s) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else {
      let enc: string;
      try {
        enc = encodeURIComponent(ch);
      } catch {
        enc = '%EF%BF%BD';
      }
      out += enc.replace(/[!*'()]/g, (m) => '%' + m.charCodeAt(0).toString(16).toUpperCase());
    }
  }
  return out;
}

function parseHeaderArg(h: string, headers: Header[], warnings: string[]) {
  if (h.startsWith('@')) {
    warnings.push(`Header "${h}" đọc từ file — không thể mở file trong trình duyệt, đã bỏ qua.`);
    return;
  }
  const idx = h.indexOf(':', h.startsWith(':') ? 1 : 0);
  if (idx < 0) {
    if (h.trim().endsWith(';')) {
      headers.push({ name: h.trim().slice(0, -1).trim(), value: '' });
      return;
    }
    warnings.push(`Header không hợp lệ (thiếu dấu ":"): ${h}`);
    return;
  }
  const name = h.slice(0, idx).trim();
  const value = h.slice(idx + 1).trim();
  if (!name) {
    warnings.push(`Header không hợp lệ: ${h}`);
    return;
  }
  if (name.startsWith(':')) {
    warnings.push(`Bỏ qua pseudo-header HTTP/2 "${name}".`);
    return;
  }
  if (value === '') {
    warnings.push(`"${name}:" không có giá trị nghĩa là xóa header mặc định của curl — đã bỏ qua.`);
    return;
  }
  headers.push({ name, value });
}

function parseFormArg(arg: string, literal: boolean, warnings: string[]): FormField | null {
  const eq = arg.indexOf('=');
  if (eq < 1) {
    warnings.push(`Trường form không hợp lệ (cần dạng tên=giá trị): ${arg}`);
    return null;
  }
  const name = arg.slice(0, eq);
  let rest = arg.slice(eq + 1);
  if (literal) return { name, value: rest, kind: 'text' };
  let kind: FormField['kind'] = 'text';
  if (rest.startsWith('@')) {
    kind = 'file';
    rest = rest.slice(1);
  } else if (rest.startsWith('<')) {
    kind = 'filetext';
    rest = rest.slice(1);
  }
  let type: string | undefined;
  let filename: string | undefined;
  let value = rest;
  const semi = kind === 'text' ? rest.search(/;(type|filename|headers|encoder)=/) : rest.indexOf(';');
  if (semi >= 0) {
    value = rest.slice(0, semi);
    for (const part of rest.slice(semi + 1).split(';')) {
      const m = /^(type|filename)=(.*)$/.exec(part.trim());
      if (m) {
        const v = m[2].replace(/^"(.*)"$/, '$1');
        if (m[1] === 'type') type = v;
        else filename = v;
      }
    }
  }
  if (kind !== 'text') value = value.replace(/^"(.*)"$/, '$1');
  if (kind !== 'text' && value.includes(',')) {
    warnings.push(`Trường "${name}" có nhiều file (${value}) — chỉ lấy file đầu tiên.`);
    value = value.split(',')[0];
  }
  return { name, value, kind, type, filename };
}

function splitUrl(raw: string): { base: string; query: string } {
  let u = raw;
  const h = u.indexOf('#');
  if (h >= 0) u = u.slice(0, h);
  const q = u.indexOf('?');
  return q < 0 ? { base: u, query: '' } : { base: u.slice(0, q), query: u.slice(q + 1) };
}

export function getHeaderValue(headers: Header[], name: string): string | undefined {
  const l = name.toLowerCase();
  for (let i = headers.length - 1; i >= 0; i--) if (headers[i].name.toLowerCase() === l) return headers[i].value;
  return undefined;
}

const hasHeader = (headers: Header[], name: string) => getHeaderValue(headers, name) !== undefined;

export function parseCurl(input: string): ParseResult {
  const warnings: string[] = [];
  try {
    return parseCurlUnsafe(input, warnings);
  } catch {
    return { ok: false, error: 'Không thể phân tích lệnh cURL này.', warnings };
  }
}

function parseCurlUnsafe(input: string, warnings: string[]): ParseResult {
  if (!input.trim()) return { ok: false, error: 'Hãy dán lệnh cURL vào ô nhập.', warnings };
  if (input.length > MAX_CURL_INPUT) {
    return { ok: false, error: 'Lệnh quá dài (giới hạn 1.000.000 ký tự).', warnings };
  }
  const tk = tokenize(input);
  warnings.push(...tk.notes);
  let words = tk.words;
  // bỏ tiền tố: $ , sudo, biến môi trường...
  let k = 0;
  while (k < words.length && k < 6 && /^(\$|%|>|sudo|time|env|command|nohup)$|^[A-Za-z_]\w*=/.test(words[k])) k++;
  const first = words[k];
  if (first !== undefined && /(^|[\\/])curl(\.exe)?$/i.test(first)) {
    words = words.slice(k + 1);
  } else if (first !== undefined && /^[a-z][a-z0-9+.-]*:\/\//i.test(first)) {
    words = words.slice(k);
    warnings.push('Không thấy từ khóa "curl" ở đầu lệnh; coi toàn bộ là tham số.');
  } else {
    return { ok: false, error: 'Không tìm thấy lệnh "curl". Hãy dán toàn bộ lệnh bắt đầu bằng curl.', warnings };
  }

  let method = null as string | null;
  const headers: Header[] = [];
  const dataParts: string[] = [];
  let dataFile = null as string | null;
  let jsonMode = false;
  const form: FormField[] = [];
  let userArg = null as string | null;
  let agent = null as string | null;
  let referer = null as string | null;
  const cookies: string[] = [];
  let bearer = null as string | null;
  let compressed = false;
  let insecure = false;
  let follow = false;
  let getMode = false;
  let head = false;
  let upload = false;
  const urls: string[] = [];
  const urlQueries: string[] = [];
  const positional: string[] = [];
  const ignored = new Set<string>();

  const note = (flag: string, why: string) => {
    const key = flag + why;
    if (ignored.has(key)) return;
    ignored.add(key);
    warnings.push(`Bỏ qua ${flag} — ${why}`);
  };

  const addData = (kind: string, val: string) => {
    if (kind === 'data-urlencode') {
      const at = val.indexOf('@');
      const eq = val.indexOf('=');
      if (eq >= 0 && (at < 0 || eq < at || (at >= 0 && eq < at))) {
        const name = val.slice(0, eq);
        const enc = curlUrlEncode(val.slice(eq + 1));
        dataParts.push(name ? `${name}=${enc}` : enc);
      } else if (at >= 0) {
        const name = val.slice(0, at);
        const path = val.slice(at + 1);
        warnings.push(`--data-urlencode đọc nội dung từ file "${path}" — không thể đọc file, dùng placeholder.`);
        dataParts.push(name ? `${name}=<nội dung file ${path}>` : `<nội dung file ${path}>`);
      } else dataParts.push(curlUrlEncode(val));
      return;
    }
    if (kind !== 'data-raw' && val.startsWith('@')) {
      const path = val.slice(1);
      if (path === '-') {
        warnings.push('Dữ liệu đọc từ stdin (@-) — đã dùng placeholder.');
        dataParts.push('<stdin>');
      } else if (dataParts.length === 0 && dataFile === null) {
        dataFile = path;
        dataParts.push('');
        warnings.push(`Dữ liệu đọc từ file "${path}" — mã sinh ra sẽ đọc file tương ứng.`);
      } else {
        warnings.push(`Dữ liệu đọc từ file "${path}" kết hợp nhiều -d — dùng placeholder.`);
        dataParts.push(`<nội dung file ${path}>`);
      }
      return;
    }
    dataParts.push(val);
  };

  const apply = (key: string, val: string | null) => {
    switch (key) {
      case 'request': method = (val ?? '').trim().toUpperCase() || method; break;
      case 'header': parseHeaderArg(val ?? '', headers, warnings); break;
      case 'data':
      case 'data-ascii':
      case 'data-raw':
      case 'data-binary':
      case 'data-urlencode':
        addData(key === 'data-ascii' ? 'data' : key, val ?? '');
        break;
      case 'json':
        jsonMode = true;
        if ((val ?? '').startsWith('@')) {
          warnings.push(`--json đọc từ file "${(val ?? '').slice(1)}" — dùng placeholder.`);
          dataParts.push(`<nội dung file ${(val ?? '').slice(1)}>`);
        } else dataParts.push(val ?? '');
        break;
      case 'form':
      case 'form-string': {
        const f = parseFormArg(val ?? '', key === 'form-string', warnings);
        if (f) form.push(f);
        break;
      }
      case 'user': userArg = val ?? ''; break;
      case 'user-agent': agent = val ?? ''; break;
      case 'referer': referer = (val ?? '').replace(/;auto$/i, ''); break;
      case 'cookie': {
        const v = val ?? '';
        if (v.includes('=')) cookies.push(v);
        else warnings.push(`-b "${v}" đọc cookie từ file — không thể đọc file, đã bỏ qua.`);
        break;
      }
      case 'compressed': compressed = true; break;
      case 'insecure': insecure = true; break;
      case 'location': follow = true; break;
      case 'get': getMode = true; break;
      case 'head': head = true; break;
      case 'url': if (val) urls.push(val); break;
      case 'url-query': {
        const v = val ?? '';
        const eq = v.indexOf('=');
        urlQueries.push(eq >= 0 ? (eq === 0 ? curlUrlEncode(v.slice(1)) : `${v.slice(0, eq)}=${curlUrlEncode(v.slice(eq + 1))}`) : curlUrlEncode(v));
        break;
      }
      case 'proxy': note('-x/--proxy', `proxy "${val}" không được hỗ trợ khi sinh mã (hãy cấu hình proxy trong môi trường chạy).`); break;
      case 'upload-file': upload = true; note('-T/--upload-file', `tải file "${val}" lên; chuyển thành PUT, không đính kèm nội dung file.`); break;
      case 'oauth2-bearer': bearer = val ?? ''; break;
      case 'output': note('-o/--output', 'ghi kết quả ra file không áp dụng cho mã sinh ra.'); break;
      case 'cookie-jar': case 'dump-header': case 'write-out': case 'connect-timeout': case 'max-time': case 'retry':
      case 'retry-delay': case 'retry-max-time': case 'max-redirs': case 'cacert': case 'cert': case 'key': case 'capath':
      case 'interface': case 'resolve': case 'limit-rate': case 'noproxy': case 'proxy-user': case 'config':
        note(`--${key}`, 'không có tương đương trực tiếp, hãy tự cấu hình nếu cần.');
        break;
      default:
        if (AUTH_WARN.has(key)) note(`--${key}`, 'kiểu xác thực này không được hỗ trợ; dùng Basic nếu có -u.');
        else if (SILENT_IGNORE.has(key)) {
          /* bỏ qua im lặng */
        } else if (key.startsWith('no-')) {
          /* các cờ phủ định */
        } else if (LONG_WITH_ARG.has(key)) note(`--${key}`, 'cờ này không ảnh hưởng đến request được sinh.');
        else note(`--${key}`, 'cờ không nhận diện được.');
    }
  };

  let endOpts = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (endOpts || w === '-' || !w.startsWith('-')) {
      positional.push(w);
      continue;
    }
    if (w === '--') {
      endOpts = true;
      continue;
    }
    if (w.startsWith('--')) {
      let name = w.slice(2);
      let val: string | null = null;
      const eq = name.indexOf('=');
      if (eq >= 0) {
        val = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      name = LONG_ALIASES[name] ?? name;
      if (val === null && LONG_WITH_ARG.has(name)) {
        if (i + 1 < words.length) val = words[++i];
        else {
          warnings.push(`Cờ --${name} thiếu giá trị.`);
          continue;
        }
      }
      apply(name, val);
      continue;
    }
    // cờ ngắn, có thể gộp: -sSL, -XPOST, -H'a: b'
    for (let j = 1; j < w.length; j++) {
      const ch = w[j];
      const long = SHORT_MAP[ch];
      if (!long) {
        warnings.push(`Bỏ qua cờ -${ch} — không nhận diện được.`);
        continue;
      }
      if (SHORT_WITH_ARG.has(ch)) {
        let val: string;
        if (j + 1 < w.length) val = w.slice(j + 1);
        else if (i + 1 < words.length) val = words[++i];
        else {
          warnings.push(`Cờ -${ch} thiếu giá trị.`);
          break;
        }
        apply(long, val);
        break;
      }
      apply(long, null);
    }
  }

  // URL
  const allUrls = [...urls, ...positional];
  if (allUrls.length === 0) return { ok: false, error: 'Không tìm thấy URL trong lệnh cURL.', warnings };
  let rawUrl = allUrls[0];
  if (urls.length === 0 && positional.length > 1) {
    const better =
      positional.find((p) => /^[a-z][a-z0-9+.-]*:\/\//i.test(p)) ??
      positional.find((p) => /^(localhost|[\w-]+(\.[\w-]+)+|\[?[0-9a-f:]+\]?)(:\d+)?([/?#]|$)/i.test(p));
    if (better) rawUrl = better;
  }
  if (allUrls.length > 1) warnings.push(`Có ${allUrls.length} URL — chỉ dùng URL đầu tiên: ${rawUrl}`);
  rawUrl = rawUrl.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) && !/^(localhost|[\w.-]+):\d+/i.test(rawUrl)) {
      return { ok: false, error: `URL không được hỗ trợ: ${rawUrl}`, warnings };
    }
    warnings.push('URL không có scheme — curl mặc định dùng http://. Đổi thành https:// nếu cần.');
    rawUrl = 'http://' + rawUrl.replace(/^\/\//, '');
  }
  if (/\s/.test(rawUrl)) warnings.push('URL chứa khoảng trắng — hãy kiểm tra lại dấu nháy.');
  if (/[{}[\]]/.test(rawUrl.replace(/^[a-z]+:\/\/\[[0-9a-f:.]+\]/i, ''))) {
    warnings.push('URL có ký tự {} hoặc [] — curl hiểu đó là "globbing"; mã sinh ra giữ nguyên chúng.');
  }
  if (!/^https?:\/\//i.test(rawUrl)) warnings.push('Scheme không phải HTTP/HTTPS — mã sinh ra có thể không chạy.');

  // body
  const bodyText = dataParts.join(jsonMode ? '' : '&');
  const hasData = dataParts.length > 0;
  const hasForm = form.length > 0;
  if (hasData && hasForm) warnings.push('Dùng đồng thời -d và -F — curl không cho phép; ưu tiên multipart (-F).');

  // Header suy luận
  if (agent !== null && !hasHeader(headers, 'User-Agent')) headers.push({ name: 'User-Agent', value: agent });
  if (referer !== null && referer !== '' && !hasHeader(headers, 'Referer')) headers.push({ name: 'Referer', value: referer });
  if (cookies.length) {
    const existing = headers.findIndex((h) => h.name.toLowerCase() === 'cookie');
    const joined = cookies.join('; ');
    if (existing >= 0) headers[existing] = { ...headers[existing], value: headers[existing].value + '; ' + joined };
    else headers.push({ name: 'Cookie', value: joined });
  }
  if (bearer !== null && !hasHeader(headers, 'Authorization')) {
    headers.push({ name: 'Authorization', value: `Bearer ${bearer}`, inferred: true });
  }
  if (jsonMode) {
    if (!hasHeader(headers, 'Content-Type')) headers.push({ name: 'Content-Type', value: 'application/json', inferred: true });
    if (!hasHeader(headers, 'Accept')) headers.push({ name: 'Accept', value: 'application/json', inferred: true });
  }

  let auth: ParsedCurl['auth'] = null;
  if (userArg !== null) {
    const c = userArg.indexOf(':');
    auth = c < 0 ? { user: userArg, password: '' } : { user: userArg.slice(0, c), password: userArg.slice(c + 1) };
    if (c < 0) warnings.push('-u chỉ có tên người dùng — curl sẽ hỏi mật khẩu; mật khẩu được để trống.');
    if (hasHeader(headers, 'Authorization')) warnings.push('Có cả -u và header Authorization — giữ cả hai, hãy kiểm tra lại.');
  }

  // URL + query
  const sp = splitUrl(rawUrl);
  let queryStr = sp.query;
  let urlOnlyData = '';
  if (getMode && hasData && dataFile === null) {
    urlOnlyData = bodyText;
  } else if (getMode && hasData) {
    warnings.push('-G kết hợp dữ liệu từ file — không thể chuyển vào query.');
  }
  for (const extra of [urlOnlyData, ...urlQueries]) {
    if (extra) queryStr = queryStr ? queryStr + '&' + extra : extra;
  }
  const query = parseQueryString(queryStr);
  const url = sp.base + (queryStr ? '?' + queryStr : '');

  let body: CurlBody = null;
  let formOut: FormField[] | null = null;
  if (hasForm) formOut = form;
  else if (hasData && !(getMode && dataFile === null)) {
    if (dataFile !== null && dataParts.length === 1) body = { kind: 'file', path: dataFile };
    else body = { kind: 'text', text: bodyText, json: null };
  }

  // method
  let finalMethod: string;
  const explicit = method !== null;
  if (method !== null) finalMethod = method;
  else if (head) finalMethod = 'HEAD';
  else if (getMode) finalMethod = 'GET';
  else if (formOut || body || upload) finalMethod = upload && !formOut && !body ? 'PUT' : 'POST';
  else finalMethod = 'GET';
  if (head && explicit && finalMethod !== 'HEAD') warnings.push(`-I và -X ${finalMethod} cùng xuất hiện — dùng phương thức ${finalMethod}.`);
  if (head && (body || formOut)) {
    warnings.push('-I (HEAD) kèm dữ liệu — dữ liệu bị bỏ qua.');
    body = null;
    formOut = null;
  }

  // Content-Type
  if (formOut) {
    const ct = getHeaderValue(headers, 'Content-Type');
    if (ct && /^multipart\/form-data/i.test(ct) && !/boundary=/i.test(ct)) {
      for (let i = headers.length - 1; i >= 0; i--) if (headers[i].name.toLowerCase() === 'content-type') headers.splice(i, 1);
    } else if (ct && !/^multipart\//i.test(ct)) {
      warnings.push(`Có -F nhưng Content-Type là "${ct}" — thư viện sẽ tự đặt multipart, header này có thể bị ghi đè.`);
    }
  } else if (body && !hasHeader(headers, 'Content-Type')) {
    headers.push({ name: 'Content-Type', value: 'application/x-www-form-urlencoded', inferred: true });
  }
  const contentType = getHeaderValue(headers, 'Content-Type') ?? null;

  // JSON
  if (body && body.kind === 'text') {
    const t = body.text.trim();
    const looksJson = (t.startsWith('{') || t.startsWith('[')) && t.length > 1;
    const node = looksJson || (contentType && /json/i.test(contentType)) ? parseJsonNode(body.text) : null;
    if (node && contentType && /json/i.test(contentType)) body.json = node;
    else if (node && looksJson && contentType && /x-www-form-urlencoded/i.test(contentType)) {
      warnings.push(
        'Body trông như JSON nhưng không có Content-Type: application/json — curl sẽ gửi dưới dạng application/x-www-form-urlencoded. Thêm -H "Content-Type: application/json" nếu muốn gửi JSON.'
      );
    } else if (!node && contentType && /json/i.test(contentType) && body.text.trim()) {
      warnings.push('Content-Type là JSON nhưng body không phải JSON hợp lệ — giữ nguyên dạng chuỗi.');
    }
  }
  if ((finalMethod === 'GET' || finalMethod === 'HEAD') && (body || formOut) && !getMode) {
    warnings.push(`Phương thức ${finalMethod} kèm body — một số thư viện (fetch, XHR) không cho phép.`);
  }

  return {
    ok: true,
    req: {
      method: finalMethod,
      methodExplicit: explicit,
      url,
      baseUrl: sp.base,
      query,
      headers,
      body,
      form: formOut,
      auth,
      insecure,
      follow,
      compressed,
      head: finalMethod === 'HEAD',
      contentType,
      warnings,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Tiện ích sinh mã                                                    */
/* ------------------------------------------------------------------ */

export interface GenOptions {
  /** Giữ nguyên chuỗi body thay vì chuyển JSON thành cấu trúc native. */
  rawBody: boolean;
}

export interface GenResult {
  code: string;
  notes: string[];
}

export interface LangInfo {
  id: string;
  label: string;
  group: string;
  ext: string;
}

export const LANGUAGES: LangInfo[] = [
  { id: 'js-fetch', label: 'JavaScript (fetch)', group: 'JavaScript', ext: 'js' },
  { id: 'js-axios', label: 'JavaScript (axios)', group: 'JavaScript', ext: 'js' },
  { id: 'node-fetch', label: 'Node.js (fetch)', group: 'JavaScript', ext: 'mjs' },
  { id: 'python-requests', label: 'Python (requests)', group: 'Python', ext: 'py' },
  { id: 'python-httpx', label: 'Python (httpx)', group: 'Python', ext: 'py' },
  { id: 'go', label: 'Go (net/http)', group: 'Khác', ext: 'go' },
  { id: 'php-curl', label: 'PHP (cURL)', group: 'PHP', ext: 'php' },
  { id: 'php-guzzle', label: 'PHP (Guzzle)', group: 'PHP', ext: 'php' },
  { id: 'ruby', label: 'Ruby (Net::HTTP)', group: 'Khác', ext: 'rb' },
  { id: 'java', label: 'Java (HttpClient)', group: 'Khác', ext: 'java' },
  { id: 'csharp', label: 'C# (HttpClient)', group: 'Khác', ext: 'cs' },
  { id: 'rust', label: 'Rust (reqwest)', group: 'Khác', ext: 'rs' },
  { id: 'httpie', label: 'HTTPie', group: 'CLI', ext: 'sh' },
  { id: 'wget', label: 'wget', group: 'CLI', ext: 'sh' },
  { id: 'powershell', label: 'PowerShell', group: 'CLI', ext: 'ps1' },
];

/** Trích dấu nháy an toàn cho bash. */
export function shellQuote(s: string): string {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function b64utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const lc = (s: string) => s.toLowerCase();

function hasDupHeaders(h: { name: string }[]): boolean {
  const seen = new Set<string>();
  for (const x of h) {
    const l = lc(x.name);
    if (seen.has(l)) return true;
    seen.add(l);
  }
  return false;
}

/** Gộp header trùng tên (không phân biệt hoa/thường). */
function mergeHeaders(h: Header[]): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const idx = new Map<string, number>();
  for (const x of h) {
    const l = lc(x.name);
    const at = idx.get(l);
    if (at === undefined) {
      idx.set(l, out.length);
      out.push({ name: x.name, value: x.value });
    } else out[at].value += (l === 'cookie' ? '; ' : ', ') + x.value;
  }
  return out;
}

function isExactJsonCT(h: Header): boolean {
  return lc(h.name) === 'content-type' && lc(h.value.trim()) === 'application/json';
}

function jsonNative(req: ParsedCurl, o: GenOptions, flavor: 'generic' | 'js' | 'php' = 'generic'): JNode | null {
  if (o.rawBody || !req.body || req.body.kind !== 'text' || !req.body.json) return null;
  return jsonSafeFor(req.body.json, flavor) ? req.body.json : null;
}

const isNonAscii = (s: string) => /[^\x00-\x7f]/.test(s);

const FORBIDDEN_BROWSER =
  /^(accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|connection|content-length|cookie|cookie2|date|dnt|expect|host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|user-agent|via|sec-.*|proxy-.*)$/i;

function browserForbiddenNote(req: ParsedCurl): string | null {
  const bad = req.headers.filter((h) => FORBIDDEN_BROWSER.test(h.name)).map((h) => h.name);
  const uniq = [...new Set(bad)];
  return uniq.length
    ? `Trình duyệt chặn/bỏ qua các header: ${uniq.join(', ')}. Chúng chỉ có tác dụng khi chạy trên Node.js.`
    : null;
}

function funcMethod(m: string, map: Record<string, string>): string | null {
  return map[m] ?? null;
}

/* ---------- JavaScript ---------- */

function jsStr(s: string): string {
  return JSON.stringify(s);
}

function jsTemplate(s: string): string {
  return '`' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\r/g, '\\r') + '`';
}

function jsKey(k: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? k : jsStr(k);
}

const JS_CFG: JCfg = {
  indent: '  ', key: jsKey, str: jsStr, kv: ': ', t: 'true', f: 'false', nul: 'null',
  obj: ['{', '}'], arr: ['[', ']'], emptyObj: '{}', emptyArr: '[]',
};

function jsBodyString(text: string, raw: boolean): string {
  return raw && text.includes('\n') && !/[\u2028\u2029]/.test(text) ? jsTemplate(text) : jsStr(text);
}

function jsAuthExpr(a: { user: string; password: string }): string {
  const pair = `${a.user}:${a.password}`;
  // btoa chỉ nhận Latin-1
  return /^[\x00-\xff]*$/.test(pair) ? `"Basic " + btoa(${jsStr(pair)})` : jsStr('Basic ' + b64utf8(pair));
}

interface JsHeaderEntry {
  name: string;
  expr: string;
}

function jsHeaderEntries(req: ParsedCurl): JsHeaderEntry[] {
  const list: JsHeaderEntry[] = req.headers.map((h) => ({ name: h.name, expr: jsStr(h.value) }));
  if (req.auth) list.push({ name: 'Authorization', expr: jsAuthExpr(req.auth) });
  return list;
}

function jsFormLines(req: ParsedCurl, env: 'browser' | 'node', notes: string[], imports: Set<string>): string[] {
  const L = ['const form = new FormData();'];
  for (const f of req.form ?? []) {
    if (f.kind === 'text') {
      if (f.type) {
        L.push(`form.append(${jsStr(f.name)}, new Blob([${jsStr(f.value)}], { type: ${jsStr(f.type)} }));`);
      } else L.push(`form.append(${jsStr(f.name)}, ${jsStr(f.value)});`);
    } else if (f.kind === 'filetext') {
      if (env === 'node') {
        imports.add("import { readFile } from 'node:fs/promises';");
        L.push(`form.append(${jsStr(f.name)}, await readFile(${jsStr(f.value)}, "utf8"));`);
      } else L.push(`form.append(${jsStr(f.name)}, /* nội dung file ${f.value} */ "");`);
    } else {
      const fname = f.filename ?? f.value.split(/[\\/]/).pop() ?? 'file';
      if (env === 'node') {
        imports.add("import { openAsBlob } from 'node:fs';");
        const typ = f.type ? `, { type: ${jsStr(f.type)} }` : '';
        L.push(`form.append(${jsStr(f.name)}, await openAsBlob(${jsStr(f.value)}${typ}), ${jsStr(fname)});`);
      } else {
        L.push(`// Thay bằng File thật của "${f.value}" (vd. từ <input type="file">)`);
        const typ = f.type ? `, { type: ${jsStr(f.type)} }` : '';
        L.push(`form.append(${jsStr(f.name)}, new File([/* nội dung */], ${jsStr(fname)}${typ}));`);
      }
    }
  }
  if (env === 'node' && (req.form ?? []).some((f) => f.kind === 'file')) notes.push('openAsBlob cần Node.js 19.8+.');
  return L;
}

function genFetch(req: ParsedCurl, o: GenOptions, env: 'browser' | 'node'): GenResult {
  const notes: string[] = [];
  const imports = new Set<string>();
  const pre: string[] = [];
  const entries = jsHeaderEntries(req);
  const native = jsonNative(req, o, 'js');
  const opt: string[] = [];
  opt.push(`  method: ${jsStr(req.method)},`);
  if (entries.length) {
    if (hasDupHeaders(entries)) {
      opt.push('  headers: [');
      for (const e of entries) opt.push(`    [${jsStr(e.name)}, ${e.expr}],`);
      opt.push('  ],');
    } else {
      opt.push('  headers: {');
      for (const e of entries) opt.push(`    ${jsKey(e.name)}: ${e.expr},`);
      opt.push('  },');
    }
  }
  if (req.form) {
    pre.push(...jsFormLines(req, env, notes, imports), '');
    opt.push('  body: form,');
  } else if (req.body?.kind === 'file') {
    if (env === 'node') {
      imports.add("import { readFile } from 'node:fs/promises';");
      opt.push(`  body: await readFile(${jsStr(req.body.path)}),`);
    } else opt.push(`  body: /* nội dung file ${req.body.path} */ "",`);
  } else if (native) {
    opt.push(`  body: JSON.stringify(${renderJson(native, JS_CFG, 1)}),`);
  } else if (req.body?.kind === 'text') {
    opt.push(`  body: ${jsBodyString(req.body.text, o.rawBody)},`);
  }
  if (req.compressed) {
    /* fetch tự giải nén */
  }
  if (req.insecure) {
    if (env === 'node') pre.unshift('// Bỏ qua kiểm tra chứng chỉ TLS (tương đương -k) — chỉ dùng khi phát triển', 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";', '');
    else notes.push('-k (bỏ qua chứng chỉ TLS) không thể thực hiện trong trình duyệt.');
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && (req.body || req.form)) {
    notes.push(`fetch ném TypeError nếu ${req.method} có body — hãy dùng phương thức khác hoặc chuyển dữ liệu vào query.`);
  }
  if (env === 'browser') {
    const n = browserForbiddenNote(req);
    if (n) notes.push(n);
  }
  if (req.follow) notes.push('fetch mặc định tự theo redirect (tương đương -L).');
  const L: string[] = [];
  if (imports.size) L.push(...imports, '');
  L.push(...pre);
  L.push(`const response = await fetch(${jsStr(req.url)}, {`, ...opt, '});', '');
  L.push('console.log(response.status);', 'console.log(await response.text());');
  return { code: L.join('\n') + '\n', notes };
}

function genAxios(req: ParsedCurl, o: GenOptions): GenResult {
  const notes: string[] = [];
  const imports = new Set<string>(["import axios from 'axios';"]);
  const pre: string[] = [];
  const native = jsonNative(req, o, 'js');
  const merged = (() => {
    const list = jsHeaderEntries(req).filter((e) => !(native && lc(e.name) === 'content-type' && lc(e.expr) === '"application/json"') || false);
    return list;
  })();
  // gộp trùng tên
  const hmap: JsHeaderEntry[] = [];
  const hidx = new Map<string, number>();
  let dup = false;
  for (const e of merged) {
    const l = lc(e.name);
    const at = hidx.get(l);
    if (at === undefined) {
      hidx.set(l, hmap.length);
      hmap.push({ ...e });
    } else {
      dup = true;
      hmap[at].expr += ` + ${jsStr(l === 'cookie' ? '; ' : ', ')} + ${e.expr}`;
    }
  }
  if (dup) notes.push('Các header trùng tên đã được gộp (axios dùng object nên không lặp được header).');
  const opt: string[] = [`  method: ${jsStr(req.method.toLowerCase())},`, `  url: ${jsStr(req.url)},`];
  if (hmap.length) {
    opt.push('  headers: {');
    for (const e of hmap) opt.push(`    ${jsKey(e.name)}: ${e.expr},`);
    opt.push('  },');
  }
  if (req.form) {
    pre.push(...jsFormLines(req, 'node', notes, imports), '');
    opt.push('  data: form,');
  } else if (req.body?.kind === 'file') {
    imports.add("import { readFile } from 'node:fs/promises';");
    opt.push(`  data: await readFile(${jsStr(req.body.path)}),`);
  } else if (native) {
    opt.push(`  data: ${renderJson(native, JS_CFG, 1)},`);
  } else if (req.body?.kind === 'text') {
    opt.push(`  data: ${jsBodyString(req.body.text, o.rawBody)},`);
  }
  if (req.insecure) {
    imports.add("import https from 'node:https';");
    opt.push('  httpsAgent: new https.Agent({ rejectUnauthorized: false }),');
  }
  if (!req.follow) {
    /* axios mặc định theo redirect; giữ nguyên */
  }
  const n = browserForbiddenNote(req);
  if (n) notes.push(n.replace('Chúng chỉ có tác dụng khi chạy trên Node.js.', 'Chạy trên Node.js để gửi được chúng.'));
  const L = [...imports, '', ...pre, 'const response = await axios({', ...opt, '});', '', 'console.log(response.status);', 'console.log(response.data);'];
  if (req.compressed) notes.push('axios tự giải nén gzip/deflate/br (--compressed).');
  return { code: L.join('\n') + '\n', notes };
}

/* ---------- Python ---------- */

function pyStr(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp >= 0xd800 && cp <= 0xdfff) out += '\\u' + cp.toString(16);
    else out += ch;
  }
  return "'" + out + "'";
}

const PY_CFG: JCfg = {
  indent: '    ', key: pyStr, str: pyStr, kv: ': ', t: 'True', f: 'False', nul: 'None',
  obj: ['{', '}'], arr: ['[', ']'], emptyObj: '{}', emptyArr: '[]',
};

function pyFilesList(req: ParsedCurl, withText: boolean): string[] {
  const L: string[] = [];
  for (const f of req.form ?? []) {
    if (f.kind === 'text') {
      if (withText) L.push(`    (${pyStr(f.name)}, (None, ${pyStr(f.value)}${f.type ? ', ' + pyStr(f.type) : ''})),`);
    } else if (f.kind === 'filetext') {
      L.push(`    (${pyStr(f.name)}, (None, open(${pyStr(f.value)}, 'r', encoding='utf-8').read())),`);
    } else {
      const fname = f.filename ?? f.value.split(/[\\/]/).pop() ?? 'file';
      L.push(`    (${pyStr(f.name)}, (${pyStr(fname)}, open(${pyStr(f.value)}, 'rb')${f.type ? ', ' + pyStr(f.type) : ''})),`);
    }
  }
  return L;
}

function genPython(req: ParsedCurl, o: GenOptions, lib: 'requests' | 'httpx'): GenResult {
  const notes: string[] = [];
  const native = jsonNative(req, o);
  const hs = req.headers.filter((h) => !(native && isExactJsonCT(h)));
  const L: string[] = [`import ${lib}`, '', `url = ${pyStr(req.url)}`, ''];
  const args: string[] = [];
  if (hs.length) {
    if (lib === 'httpx' && hasDupHeaders(hs)) {
      L.push('headers = [');
      for (const h of hs) L.push(`    (${pyStr(h.name)}, ${pyStr(h.value)}),`);
      L.push(']', '');
    } else {
      const m = mergeHeaders(hs);
      if (m.length !== hs.length) notes.push('Các header trùng tên đã được gộp (dict của requests không lặp được header).');
      L.push('headers = {');
      for (const h of m) L.push(`    ${pyStr(h.name)}: ${pyStr(h.value)},`);
      L.push('}', '');
    }
    args.push('headers=headers');
  }
  const textFields = (req.form ?? []).filter((f) => f.kind === 'text');
  if (req.form) {
    if (lib === 'requests') {
      L.push('files = [', ...pyFilesList(req, true), ']', '');
      args.push('files=files');
    } else {
      if (textFields.length) {
        const names = new Map<string, string[]>();
        for (const f of textFields) names.set(f.name, [...(names.get(f.name) ?? []), f.value]);
        L.push('data = {');
        for (const [k, v] of names) L.push(`    ${pyStr(k)}: ${v.length === 1 ? pyStr(v[0]) : '[' + v.map(pyStr).join(', ') + ']'},`);
        L.push('}', '');
        args.push('data=data');
      }
      const fl = pyFilesList(req, false);
      if (fl.length) {
        L.push('files = [', ...fl, ']', '');
        args.push('files=files');
      } else if (!textFields.length) args.push('data={}');
      else if (textFields.some((f) => f.type)) notes.push('httpx không cho đặt Content-Type riêng cho trường văn bản.');
      if (!fl.length && textFields.length) {
        notes.push('httpx chỉ gửi multipart khi có file; hãy thêm files=... hoặc dùng requests.');
      }
    }
  } else if (req.body?.kind === 'file') {
    L.push(`with open(${pyStr(req.body.path)}, 'rb') as f:`, '    data = f.read()', '');
    args.push(lib === 'requests' ? 'data=data' : 'content=data');
  } else if (native) {
    L.push(`json_data = ${renderJson(native, PY_CFG)}`, '');
    args.push('json=json_data');
  } else if (req.body?.kind === 'text') {
    const lit = pyStr(req.body.text);
    const enc = lib === 'requests' && isNonAscii(req.body.text);
    L.push(`data = ${lit}${enc ? ".encode('utf-8')" : ''}`, '');
    args.push(lib === 'requests' ? 'data=data' : 'content=data');
  }
  if (req.auth) args.push(lib === 'requests' ? `auth=(${pyStr(req.auth.user)}, ${pyStr(req.auth.password)})` : `auth=(${pyStr(req.auth.user)}, ${pyStr(req.auth.password)})`);
  if (req.insecure) args.push('verify=False');
  if (lib === 'httpx') {
    if (req.follow) args.push('follow_redirects=True');
  } else if (req.method !== 'HEAD' && !req.follow) {
    /* requests mặc định theo redirect */
  } else if (req.method === 'HEAD' && req.follow) args.push('allow_redirects=True');
  if (req.insecure && lib === 'requests') notes.push('Dùng verify=False sẽ in cảnh báo InsecureRequestWarning.');
  const known: Record<string, string> = { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', HEAD: 'head', OPTIONS: 'options' };
  const fn = funcMethod(req.method, known);
  const head = fn ? `${lib}.${fn}(` : `${lib}.request(`;
  if (!args.length && fn) L.push(`response = ${lib}.${fn}(url)`);
  else L.push(`response = ${head}`, ...(fn ? [] : [`    ${pyStr(req.method)},`]), '    url,', ...args.map((a) => `    ${a},`), ')');
  L.push('', 'print(response.status_code)', 'print(response.text)');
  return { code: L.join('\n') + '\n', notes };
}

/* ---------- Go ---------- */

function goStr(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp < 0x20 || cp === 0x7f) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp >= 0xd800 && cp <= 0xdfff) out += '\\uFFFD';
    else out += ch;
  }
  return '"' + out + '"';
}

function goBody(s: string): string {
  if ((s.includes('\n') || s.includes('"')) && !/[`\r\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufeff\ud800-\udfff]/.test(s)) return '`' + s + '`';
  return goStr(s);
}

function genGo(req: ParsedCurl, o: GenOptions): GenResult {
  void o;
  const notes: string[] = [];
  const imports = new Set<string>(['fmt', 'io', 'net/http']);
  const body: string[] = [];
  let bodyArg = 'nil';
  let ctFromForm = false;
  if (req.form) {
    imports.add('bytes');
    imports.add('mime/multipart');
    body.push('\tvar buf bytes.Buffer', '\tw := multipart.NewWriter(&buf)');
    for (const f of req.form) {
      if (f.kind === 'text') {
        if (f.type) {
          imports.add('net/textproto');
          body.push(
            '\t{',
            '\t\th := make(textproto.MIMEHeader)',
            `\t\th.Set("Content-Disposition", fmt.Sprintf("form-data; name=%q", ${goStr(f.name)}))`,
            `\t\th.Set("Content-Type", ${goStr(f.type)})`,
            '\t\tpart, _ := w.CreatePart(h)',
            `\t\tpart.Write([]byte(${goStr(f.value)}))`,
            '\t}'
          );
        } else body.push(`\tw.WriteField(${goStr(f.name)}, ${goStr(f.value)})`);
      } else if (f.kind === 'filetext') {
        imports.add('os');
        body.push('\t{', `\t\tdata, err := os.ReadFile(${goStr(f.value)})`, '\t\tif err != nil {', '\t\t\tpanic(err)', '\t\t}', `\t\tw.WriteField(${goStr(f.name)}, string(data))`, '\t}');
      } else {
        imports.add('os');
        const fname = f.filename ?? f.value.split(/[\\/]/).pop() ?? 'file';
        const create = f.type
          ? (imports.add('net/textproto'),
            `h := make(textproto.MIMEHeader)\n\t\th.Set("Content-Disposition", fmt.Sprintf("form-data; name=%q; filename=%q", ${goStr(f.name)}, ${goStr(fname)}))\n\t\th.Set("Content-Type", ${goStr(f.type)})\n\t\tpart, err := w.CreatePart(h)`)
          : `part, err := w.CreateFormFile(${goStr(f.name)}, ${goStr(fname)})`;
        body.push(
          '\t{',
          `\t\tfile, err := os.Open(${goStr(f.value)})`,
          '\t\tif err != nil {',
          '\t\t\tpanic(err)',
          '\t\t}',
          '\t\tdefer file.Close()',
          `\t\t${create}`,
          '\t\tif err != nil {',
          '\t\t\tpanic(err)',
          '\t\t}',
          '\t\tio.Copy(part, file)',
          '\t}'
        );
      }
    }
    body.push('\tw.Close()', '');
    bodyArg = '&buf';
    ctFromForm = true;
  } else if (req.body?.kind === 'file') {
    imports.add('os');
    body.push(`\tfile, err := os.Open(${goStr(req.body.path)})`, '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer file.Close()', '');
    bodyArg = 'file';
  } else if (req.body?.kind === 'text') {
    imports.add('strings');
    body.push(`\tbody := strings.NewReader(${goBody(req.body.text)})`, '');
    bodyArg = 'body';
  }
  const L: string[] = [];
  const tail: string[] = [];
  let clientDecl = '\tclient := &http.Client{}';
  if (req.insecure) {
    imports.add('crypto/tls');
    clientDecl = '\tclient := &http.Client{\n\t\tTransport: &http.Transport{\n\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true},\n\t\t},\n\t}';
  }
  tail.push(`\treq, err := http.NewRequest(${goStr(req.method)}, ${goStr(req.url)}, ${bodyArg})`, '\tif err != nil {', '\t\tpanic(err)', '\t}');
  for (const h of req.headers) {
    if (lc(h.name) === 'host') tail.push(`\treq.Host = ${goStr(h.value)}`);
    else tail.push(`\treq.Header.Add(${goStr(h.name)}, ${goStr(h.value)})`);
  }
  if (ctFromForm) tail.push('\treq.Header.Set("Content-Type", w.FormDataContentType())');
  if (req.auth) tail.push(`\treq.SetBasicAuth(${goStr(req.auth.user)}, ${goStr(req.auth.password)})`);
  if (!req.follow) {
    /* Go mặc định theo redirect */
  }
  tail.push('', clientDecl, '\tresp, err := client.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer resp.Body.Close()', '', '\tresult, _ := io.ReadAll(resp.Body)', '\tfmt.Println(resp.Status)', '\tfmt.Println(string(result))');
  const std = [...imports].filter((i) => !i.includes('.')).sort();
  L.push('package main', '', 'import (', ...std.map((i) => `\t"${i}"`), ')', '', 'func main() {', ...body, ...tail, '}');
  if (req.compressed) notes.push('Go tự gửi Accept-Encoding: gzip và giải nén (tương đương --compressed).');
  return { code: L.join('\n') + '\n', notes };
}

/* ---------- PHP ---------- */

function phpStr(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

const PHP_CFG: JCfg = {
  indent: '    ', key: phpStr, str: phpStr, kv: ' => ', t: 'true', f: 'false', nul: 'null',
  obj: ['[', ']'], arr: ['[', ']'], emptyObj: 'new stdClass()', emptyArr: '[]',
};

function genPhpCurl(req: ParsedCurl, o: GenOptions): GenResult {
  const notes: string[] = [];
  const native = jsonNative(req, o, 'php');
  const opts: string[] = [`    CURLOPT_URL => ${phpStr(req.url)},`, '    CURLOPT_RETURNTRANSFER => true,'];
  const m = req.method;
  if (m === 'HEAD') opts.push('    CURLOPT_NOBODY => true,');
  else if (m === 'POST' && (req.body || req.form)) opts.push('    CURLOPT_POST => true,');
  else if (m !== 'GET') opts.push(`    CURLOPT_CUSTOMREQUEST => ${phpStr(m)},`);
  const hs = req.headers.map((h) => `        ${phpStr(h.name + ': ' + h.value)},`);
  if (hs.length) opts.push('    CURLOPT_HTTPHEADER => [', ...hs, '    ],');
  if (req.form) {
    const names = (req.form ?? []).map((f) => f.name);
    if (new Set(names).size !== names.length) notes.push('PHP dùng mảng nên tên trường trùng nhau sẽ ghi đè; dùng tên dạng "ten[]" nếu cần.');
    opts.push('    CURLOPT_POSTFIELDS => [');
    for (const f of req.form) {
      if (f.kind === 'text') opts.push(`        ${phpStr(f.name)} => ${phpStr(f.value)},`);
      else if (f.kind === 'filetext') opts.push(`        ${phpStr(f.name)} => file_get_contents(${phpStr(f.value)}),`);
      else {
        const fname = f.filename ?? f.value.split(/[\\/]/).pop() ?? 'file';
        opts.push(`        ${phpStr(f.name)} => new CURLFile(${phpStr(f.value)}, ${phpStr(f.type ?? '')}, ${phpStr(fname)}),`);
      }
    }
    opts.push('    ],');
  } else if (req.body?.kind === 'file') {
    opts.push(`    CURLOPT_POSTFIELDS => file_get_contents(${phpStr(req.body.path)}),`);
  } else if (native) {
    opts.push(`    CURLOPT_POSTFIELDS => json_encode(${renderJson(native, PHP_CFG, 1)}),`);
  } else if (req.body?.kind === 'text') {
    opts.push(`    CURLOPT_POSTFIELDS => ${phpStr(req.body.text)},`);
  }
  if (req.auth) opts.push(`    CURLOPT_USERPWD => ${phpStr(req.auth.user + ':' + req.auth.password)},`);
  if (req.follow) opts.push('    CURLOPT_FOLLOWLOCATION => true,');
  if (req.compressed) opts.push("    CURLOPT_ENCODING => '',");
  if (req.insecure) opts.push('    CURLOPT_SSL_VERIFYPEER => false,', '    CURLOPT_SSL_VERIFYHOST => 0,');
  const L = [
    '<?php', '', '$ch = curl_init();', '', 'curl_setopt_array($ch, [', ...opts, ']);', '',
    '$response = curl_exec($ch);', '',
    'if (curl_errno($ch)) {', "    echo 'Lỗi: ' . curl_error($ch);", '}', '',
    "echo curl_getinfo($ch, CURLINFO_HTTP_CODE) . \"\\n\";", 'curl_close($ch);', 'echo $response;',
  ];
  return { code: L.join('\n') + '\n', notes };
}

function genGuzzle(req: ParsedCurl, o: GenOptions): GenResult {
  const notes: string[] = [];
  const native = jsonNative(req, o, 'php');
  const hs = req.headers.filter((h) => !(native && isExactJsonCT(h)));
  const opts: string[] = [];
  if (hs.length) {
    const groups = new Map<string, { name: string; values: string[] }>();
    for (const h of hs) {
      const g = groups.get(lc(h.name));
      if (g) g.values.push(h.value);
      else groups.set(lc(h.name), { name: h.name, values: [h.value] });
    }
    opts.push("    'headers' => [");
    for (const g of groups.values()) {
      opts.push(`        ${phpStr(g.name)} => ${g.values.length === 1 ? phpStr(g.values[0]) : '[' + g.values.map(phpStr).join(', ') + ']'},`);
    }
    opts.push('    ],');
  }
  if (req.form) {
    opts.push("    'multipart' => [");
    for (const f of req.form) {
      const parts = [`'name' => ${phpStr(f.name)}`];
      if (f.kind === 'text') parts.push(`'contents' => ${phpStr(f.value)}`);
      else if (f.kind === 'filetext') parts.push(`'contents' => file_get_contents(${phpStr(f.value)})`);
      else {
        parts.push(`'contents' => fopen(${phpStr(f.value)}, 'r')`);
        parts.push(`'filename' => ${phpStr(f.filename ?? f.value.split(/[\\/]/).pop() ?? 'file')}`);
      }
      if (f.type) parts.push(`'headers' => ['Content-Type' => ${phpStr(f.type)}]`);
      opts.push(`        [${parts.join(', ')}],`);
    }
    opts.push('    ],');
  } else if (req.body?.kind === 'file') {
    opts.push(`    'body' => fopen(${phpStr(req.body.path)}, 'r'),`);
  } else if (native) {
    opts.push(`    'json' => ${renderJson(native, PHP_CFG, 1)},`);
  } else if (req.body?.kind === 'text') {
    opts.push(`    'body' => ${phpStr(req.body.text)},`);
  }
  if (req.auth) opts.push(`    'auth' => [${phpStr(req.auth.user)}, ${phpStr(req.auth.password)}],`);
  if (req.insecure) opts.push("    'verify' => false,");
  opts.push("    'http_errors' => false,");
  const L = [
    '<?php', '', "require 'vendor/autoload.php';", '', '$client = new \\GuzzleHttp\\Client();', '',
    `$response = $client->request(${phpStr(req.method)}, ${phpStr(req.url)}, [`, ...opts, ']);', '',
    'echo $response->getStatusCode() . "\\n";', 'echo $response->getBody();',
  ];
  notes.push('Cài đặt: composer require guzzlehttp/guzzle');
  return { code: L.join('\n') + '\n', notes };
}

/* ---------- Ruby ---------- */

function rbStr(s: string): string {
  if (/[\r\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)) {
    let out = '';
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\\' || ch === '"') out += '\\' + ch;
      else if (ch === '#') out += '\\#';
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (cp < 0x20 || cp === 0x7f) out += '\\x' + cp.toString(16).padStart(2, '0');
      else out += ch;
    }
    return '"' + out + '"';
  }
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

const RB_CFG: JCfg = {
  indent: '  ', key: rbStr, str: rbStr, kv: ' => ', t: 'true', f: 'false', nul: 'nil',
  obj: ['{', '}'], arr: ['[', ']'], emptyObj: '{}', emptyArr: '[]',
};

function genRuby(req: ParsedCurl, o: GenOptions): GenResult {
  const notes: string[] = [];
  const native = jsonNative(req, o);
  const classes: Record<string, string> = {
    GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options',
  };
  const L: string[] = ["require 'net/http'", "require 'uri'"];
  if (native) L.push("require 'json'");
  if (req.insecure) L.push("require 'openssl'");
  L.push('', `uri = URI.parse(${rbStr(req.url)})`, 'http = Net::HTTP.new(uri.host, uri.port)', "http.use_ssl = (uri.scheme == 'https')");
  if (req.insecure) L.push('http.verify_mode = OpenSSL::SSL::VERIFY_NONE');
  const cls = classes[req.method];
  L.push('', cls ? `request = Net::HTTP::${cls}.new(uri.request_uri)` : `request = Net::HTTPGenericRequest.new(${rbStr(req.method)}, ${req.body || req.form ? 'true' : 'false'}, true, uri.request_uri)`);
  const seen = new Set<string>();
  for (const h of req.headers) {
    if (seen.has(lc(h.name))) L.push(`request.add_field(${rbStr(h.name)}, ${rbStr(h.value)})`);
    else L.push(`request[${rbStr(h.name)}] = ${rbStr(h.value)}`);
    seen.add(lc(h.name));
  }
  if (req.auth) L.push(`request.basic_auth(${rbStr(req.auth.user)}, ${rbStr(req.auth.password)})`);
  if (req.form) {
    L.push('request.set_form([');
    for (const f of req.form) {
      if (f.kind === 'text') L.push(`  [${rbStr(f.name)}, ${rbStr(f.value)}],`);
      else if (f.kind === 'filetext') L.push(`  [${rbStr(f.name)}, File.read(${rbStr(f.value)})],`);
      else {
        const extra = [`filename: ${rbStr(f.filename ?? f.value.split(/[\\/]/).pop() ?? 'file')}`];
        if (f.type) extra.push(`content_type: ${rbStr(f.type)}`);
        L.push(`  [${rbStr(f.name)}, File.open(${rbStr(f.value)}), { ${extra.join(', ')} }],`);
      }
    }
    L.push("], 'multipart/form-data')");
  } else if (req.body?.kind === 'file') {
    L.push(`request.body = File.read(${rbStr(req.body.path)})`);
  } else if (native) {
    L.push(`request.body = ${renderJson(native, RB_CFG)}.to_json`);
  } else if (req.body?.kind === 'text') {
    L.push(`request.body = ${rbStr(req.body.text)}`);
  }
  L.push('', 'response = http.request(request)', 'puts response.code', 'puts response.body');
  if (req.follow) notes.push('Net::HTTP không tự theo redirect (-L); hãy xử lý response["location"] nếu cần.');
  if (req.compressed) notes.push('Net::HTTP tự gửi Accept-Encoding và giải nén gzip/deflate.');
  return { code: L.join('\n') + '\n', notes };
}

/* ---------- Java ---------- */

function javaStr(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20 || c === 0x7f) out += '\\' + c.toString(8).padStart(3, '0');
    else if (c > 0x7e) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return '"' + out + '"';
}

function javaTextBlockOk(s: string): boolean {
  if (!s.includes('\n') || s.includes('\r') || s.endsWith('"') || s.endsWith('\\')) return false;
  const lines = s.split('\n');
  if (lines.some((l) => /[ \t]$/.test(l))) return false;
  if (!lines.some((l) => l !== '' && !/^\s/.test(l))) return false;
  return !/[^\x09\x0a\x20-\x7e]/.test(s);
}

function javaTextBlock(s: string): string {
  const esc = s.replace(/\\/g, '\\\\').replace(/"""/g, '""\\"').replace(/\t/g, '\\t');
  return '"""\n' + esc + '"""';
}

const JAVA_RESTRICTED = new Set(['connection', 'content-length', 'expect', 'host', 'upgrade']);

function genJava(req: ParsedCurl, o: GenOptions): GenResult {
  void o;
  const notes: string[] = [];
  const imports = new Set<string>([
    'java.net.URI', 'java.net.http.HttpClient', 'java.net.http.HttpRequest', 'java.net.http.HttpResponse',
  ]);
  const pre: string[] = [];
  let publisher = 'HttpRequest.BodyPublishers.noBody()';
  if (req.form) {
    imports.add('java.io.ByteArrayOutputStream');
    imports.add('java.nio.charset.StandardCharsets');
    imports.add('java.util.UUID');
    pre.push(
      '        String boundary = "----JavaBoundary" + UUID.randomUUID();',
      '        ByteArrayOutputStream out = new ByteArrayOutputStream();'
    );
    for (const f of req.form) {
      if (f.kind === 'text' || f.kind === 'filetext') {
        pre.push(
          `        out.write(("--" + boundary + "\\r\\nContent-Disposition: form-data; name=\\"" + ${javaStr(f.name)} + "\\"${f.type ? '\\r\\nContent-Type: " + ' + javaStr(f.type) + ' + "' : ''}\\r\\n\\r\\n").getBytes(StandardCharsets.UTF_8));`,
          f.kind === 'text'
            ? `        out.write(${javaStr(f.value)}.getBytes(StandardCharsets.UTF_8));`
            : `        out.write(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(${javaStr(f.value)})));`,
          '        out.write("\\r\\n".getBytes(StandardCharsets.UTF_8));'
        );
      } else {
        const fname = f.filename ?? f.value.split(/[\\/]/).pop() ?? 'file';
        pre.push(
          `        out.write(("--" + boundary + "\\r\\nContent-Disposition: form-data; name=\\"" + ${javaStr(f.name)} + "\\"; filename=\\"" + ${javaStr(fname)} + "\\"\\r\\nContent-Type: " + ${javaStr(f.type ?? 'application/octet-stream')} + "\\r\\n\\r\\n").getBytes(StandardCharsets.UTF_8));`,
          `        out.write(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(${javaStr(f.value)})));`,
          '        out.write("\\r\\n".getBytes(StandardCharsets.UTF_8));'
        );
      }
    }
    pre.push('        out.write(("--" + boundary + "--\\r\\n").getBytes(StandardCharsets.UTF_8));', '');
    publisher = 'HttpRequest.BodyPublishers.ofByteArray(out.toByteArray())';
    notes.push('Java không có sẵn multipart nên body được dựng thủ công với boundary ngẫu nhiên.');
  } else if (req.body?.kind === 'file') {
    publisher = `HttpRequest.BodyPublishers.ofFile(java.nio.file.Path.of(${javaStr(req.body.path)}))`;
  } else if (req.body?.kind === 'text') {
    const t = req.body.text;
    if (javaTextBlockOk(t)) {
      pre.push(`        String body = ${javaTextBlock(t)};`, '');
      publisher = 'HttpRequest.BodyPublishers.ofString(body)';
      notes.push('Text block (""") cần Java 15+.');
    } else publisher = `HttpRequest.BodyPublishers.ofString(${javaStr(t)})`;
  }
  const chain: string[] = [`                .uri(URI.create(${javaStr(req.url)}))`];
  for (const h of req.headers) {
    if (JAVA_RESTRICTED.has(lc(h.name))) {
      chain.push(`                // .header(${javaStr(h.name)}, ${javaStr(h.value)}) // HttpClient không cho đặt header này`);
      notes.push(`Header "${h.name}" bị HttpClient hạn chế nên đã được comment lại (cần -Djdk.httpclient.allowRestrictedHeaders=${lc(h.name)} để bật).`);
    } else chain.push(`                .header(${javaStr(h.name)}, ${javaStr(h.value)})`);
  }
  if (req.auth) {
    imports.add('java.util.Base64');
    imports.add('java.nio.charset.StandardCharsets');
    chain.push(`                .header("Authorization", "Basic " + Base64.getEncoder().encodeToString((${javaStr(req.auth.user + ':' + req.auth.password)}).getBytes(StandardCharsets.UTF_8)))`);
  }
  if (req.form) chain.push('                .header("Content-Type", "multipart/form-data; boundary=" + boundary)');
  if (req.method === 'GET' && !req.body && !req.form) chain.push('                .GET()');
  else chain.push(`                .method(${javaStr(req.method)}, ${publisher})`);
  chain.push('                .build();');
  let builder = '        HttpClient client = HttpClient.newBuilder()';
  const bchain: string[] = [];
  if (req.follow) bchain.push('                .followRedirects(HttpClient.Redirect.NORMAL)');
  bchain.push('                .build();');
  if (req.insecure) notes.push('Java không có tùy chọn đơn giản để bỏ qua chứng chỉ TLS (-k); cần tạo SSLContext tin cậy tất cả rồi gọi .sslContext(...).');
  if (req.compressed) notes.push('HttpClient không tự giải nén gzip (--compressed).');
  builder += '\n' + bchain.join('\n');
  const sorted = [...imports].sort();
  const L = [
    ...sorted.map((i) => `import ${i};`), '', 'public class Main {', '    public static void main(String[] args) throws Exception {',
    builder, '', ...pre, '        HttpRequest request = HttpRequest.newBuilder()', ...chain, '',
    '        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());',
    '        System.out.println(response.statusCode());', '        System.out.println(response.body());', '    }', '}',
  ];
  return { code: L.join('\n') + '\n', notes };
}

/* ---------- C# ---------- */

function csStr(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp < 0x20 || cp === 0x7f || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0x2028 || cp === 0x2029 || cp === 0x85)
      out += '\\u' + cp.toString(16).padStart(4, '0');
    else out += ch;
  }
  return '"' + out + '"';
}

function csBody(s: string): string {
  if ((s.includes('"') || s.includes('\\') || s.includes('\n')) && !/[\r\ud800-\udfff\u2028\u2029\u0085]/.test(s)) {
    return '@"' + s.replace(/"/g, '""') + '"';
  }
  return csStr(s);
}

const CS_CONTENT_HEADERS = new Set(['content-type', 'content-length', 'content-encoding', 'content-language', 'content-disposition', 'content-location', 'content-md5', 'content-range', 'expires', 'last-modified', 'allow']);

function genCsharp(req: ParsedCurl, o: GenOptions): GenResult {
  void o;
  const notes: string[] = [];
  const L: string[] = ['using System;', 'using System.IO;', 'using System.Net.Http;', 'using System.Net.Http.Headers;', 'using System.Text;', ''];
  const handlerProps: string[] = [];
  if (req.insecure) handlerProps.push('    ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator');
  if (req.compressed) handlerProps.push('    AutomaticDecompression = System.Net.DecompressionMethods.All');
  if (!req.follow) {
    /* .NET mặc định theo redirect */
  }
  if (handlerProps.length) L.push('var handler = new HttpClientHandler', '{', handlerProps.join(',\n'), '};', 'using var client = new HttpClient(handler);');
  else L.push('using var client = new HttpClient();');
  L.push('', `var request = new HttpRequestMessage(new HttpMethod(${csStr(req.method)}), ${csStr(req.url)});`);
  const contentHeaders: Header[] = [];
  for (const h of req.headers) {
    if (CS_CONTENT_HEADERS.has(lc(h.name))) contentHeaders.push(h);
    else L.push(`request.Headers.TryAddWithoutValidation(${csStr(h.name)}, ${csStr(h.value)});`);
  }
  if (req.auth) {
    L.push(`request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(${csStr(req.auth.user + ':' + req.auth.password)})));`);
  }
  const ct = contentHeaders.find((h) => lc(h.name) === 'content-type');
  const hasContent = !!(req.body || req.form);
  if (req.form) {
    L.push('', 'var content = new MultipartFormDataContent();');
    for (const f of req.form) {
      if (f.kind === 'text' || f.kind === 'filetext') {
        const valueExpr = f.kind === 'text' ? csStr(f.value) : `File.ReadAllText(${csStr(f.value)})`;
        if (f.type) {
          L.push('{', `    var part = new StringContent(${valueExpr}, Encoding.UTF8);`, `    part.Headers.ContentType = MediaTypeHeaderValue.Parse(${csStr(f.type)});`, `    content.Add(part, ${csStr(f.name)});`, '}');
        } else L.push(`content.Add(new StringContent(${valueExpr}), ${csStr(f.name)});`);
      } else {
        const fname = f.filename ?? f.value.split(/[\\/]/).pop() ?? 'file';
        L.push('{', `    var part = new ByteArrayContent(File.ReadAllBytes(${csStr(f.value)}));`);
        if (f.type) L.push(`    part.Headers.ContentType = MediaTypeHeaderValue.Parse(${csStr(f.type)});`);
        L.push(`    content.Add(part, ${csStr(f.name)}, ${csStr(fname)});`, '}');
      }
    }
    L.push('request.Content = content;');
  } else if (req.body?.kind === 'file') {
    L.push('', `request.Content = new ByteArrayContent(File.ReadAllBytes(${csStr(req.body.path)}));`);
  } else if (req.body?.kind === 'text') {
    L.push('', `request.Content = new StringContent(${csBody(req.body.text)}, Encoding.UTF8);`);
  }
  if (hasContent && !req.form) {
    if (ct) L.push(`request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(${csStr(ct.value)});`);
  }
  for (const h of contentHeaders) {
    if (lc(h.name) === 'content-type') continue;
    if (hasContent) L.push(`request.Content.Headers.TryAddWithoutValidation(${csStr(h.name)}, ${csStr(h.value)});`);
    else notes.push(`Header "${h.name}" là header của nội dung nhưng request không có body nên bị bỏ qua.`);
  }
  if (!hasContent && ct) notes.push('Content-Type bị bỏ qua vì request không có body.');
  L.push('', 'var response = await client.SendAsync(request);', 'Console.WriteLine((int)response.StatusCode);', 'Console.WriteLine(await response.Content.ReadAsStringAsync());');
  notes.push('Dùng top-level statements (C# 9+/.NET 6+).');
  return { code: L.join('\n') + '\n', notes };
}

/* ---------- Rust ---------- */

function rsStr(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp === 0) out += '\\0';
    else if (cp < 0x20 || cp === 0x7f) out += '\\u{' + cp.toString(16) + '}';
    else if (cp >= 0xd800 && cp <= 0xdfff) out += '\\u{fffd}';
    else out += ch;
  }
  return '"' + out + '"';
}

function rsBody(s: string): string {
  if ((s.includes('"') || s.includes('\\') || s.includes('\n')) && !/[\r\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]/.test(s)) {
    let n = 0;
    while (s.includes('"' + '#'.repeat(n))) n++;
    return `r${'#'.repeat(n)}"${s}"${'#'.repeat(n)}`;
  }
  return rsStr(s);
}

const RS_CFG: JCfg = {
  indent: '    ', key: rsStr, str: rsStr, kv: ': ', t: 'true', f: 'false', nul: 'null',
  obj: ['{', '}'], arr: ['[', ']'], emptyObj: '{}', emptyArr: '[]',
};

function genRust(req: ParsedCurl, o: GenOptions): GenResult {
  const notes: string[] = [];
  const native = jsonNative(req, o);
  const pre: string[] = [];
  const chain: string[] = [];
  const known: Record<string, string> = { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', HEAD: 'head' };
  const fn = funcMethod(req.method, known);
  if (fn) chain.push(`        .${fn}(${rsStr(req.url)})`);
  else if (req.method === 'OPTIONS') chain.push(`        .request(reqwest::Method::OPTIONS, ${rsStr(req.url)})`);
  else chain.push(`        .request(reqwest::Method::from_bytes(${rsStr(req.method)}.as_bytes())?, ${rsStr(req.url)})`);
  for (const h of req.headers) {
    if (native && isExactJsonCT(h)) continue;
    chain.push(`        .header(${rsStr(h.name)}, ${rsStr(h.value)})`);
  }
  if (req.auth) chain.push(`        .basic_auth(${rsStr(req.auth.user)}, Some(${rsStr(req.auth.password)}))`);
  if (req.form) {
    pre.push('    let form = reqwest::multipart::Form::new()');
    const parts: string[] = [];
    for (const f of req.form) {
      if (f.kind === 'text') {
        if (f.type) {
          parts.push(`        .part(${rsStr(f.name)}, reqwest::multipart::Part::text(${rsBody(f.value)}).mime_str(${rsStr(f.type)})?)`);
        } else parts.push(`        .text(${rsStr(f.name)}, ${rsBody(f.value)})`);
      } else if (f.kind === 'filetext') {
        parts.push(`        .text(${rsStr(f.name)}, std::fs::read_to_string(${rsStr(f.value)})?)`);
      } else {
        const fname = f.filename ?? f.value.split(/[\\/]/).pop() ?? 'file';
        parts.push(`        .part(${rsStr(f.name)}, reqwest::multipart::Part::bytes(std::fs::read(${rsStr(f.value)})?).file_name(${rsStr(fname)})${f.type ? `.mime_str(${rsStr(f.type)})?` : ''})`);
      }
    }
    pre.push(...parts.map((p, i) => (i === parts.length - 1 ? p + ';' : p)));
    if (!parts.length) pre[0] += ';';
    pre.push('');
    chain.push('        .multipart(form)');
    notes.push('Cần bật feature "multipart" của reqwest: reqwest = { version = "0.12", features = ["multipart", "json"] }');
  } else if (req.body?.kind === 'file') {
    chain.push(`        .body(std::fs::read(${rsStr(req.body.path)})?)`);
  } else if (native) {
    chain.push(`        .json(&serde_json::json!(${renderJson(native, RS_CFG, 2)}))`);
    notes.push('Cần crate serde_json và feature "json" của reqwest.');
  } else if (req.body?.kind === 'text') {
    chain.push(`        .body(${rsBody(req.body.text)})`);
  }
  let clientExpr = 'reqwest::Client::new()';
  const cb: string[] = [];
  if (req.insecure) cb.push('.danger_accept_invalid_certs(true)');
  if (cb.length) clientExpr = `reqwest::Client::builder()\n        ${cb.join('\n        ')}\n        .build()?`;
  const L = [
    '#[tokio::main]', 'async fn main() -> Result<(), Box<dyn std::error::Error>> {', `    let client = ${clientExpr};`, '',
    ...pre, '    let response = client', ...chain, '        .send()', '        .await?;', '',
    '    println!("{}", response.status());', '    println!("{}", response.text().await?);', '    Ok(())', '}',
  ];
  return { code: L.join('\n') + '\n', notes };
}

/* ---------- HTTPie ---------- */

function genHttpie(req: ParsedCurl, o: GenOptions): GenResult {
  const notes: string[] = [];
  const native = jsonNative(req, o);
  const parts: string[] = [];
  const flags: string[] = [];
  if (req.insecure) flags.push('--verify=no');
  if (req.follow) flags.push('--follow');
  if (req.form) flags.push('--form');
  if (req.auth) flags.push(`-a ${shellQuote(req.auth.user + ':' + req.auth.password)}`);
  const items: string[] = [];
  const useItems = !!native && native.t === 'obj' && native.e.length > 0 && native.e.every(([k]) => k !== '' && !/[\\=:@;]/.test(k));
  for (const h of req.headers) {
    if (useItems && isExactJsonCT(h)) continue;
    items.push(h.value === '' ? shellQuote(`${h.name};`) : shellQuote(`${h.name}:${h.value}`));
  }
  const esc = (k: string) => k.replace(/([\\=:@;])/g, '\\$1');
  let stdin: string | null = null;
  if (req.form) {
    for (const f of req.form) {
      if (f.kind === 'text') items.push(shellQuote(`${esc(f.name)}=${f.value}`));
      else if (f.kind === 'filetext') items.push(shellQuote(`${esc(f.name)}=@${f.value}`));
      else items.push(shellQuote(`${esc(f.name)}@${f.value}${f.type ? ';type=' + f.type : ''}`));
    }
    if (req.form.some((f) => f.filename)) notes.push('HTTPie lấy tên file từ đường dẫn; tùy chọn filename= của curl không được chuyển đổi.');
  } else if (req.body?.kind === 'file') {
    stdin = `${shellQuote(req.body.path)}`;
  } else if (useItems && native && native.t === 'obj') {
    for (const [k, v] of native.e) {
      if (v.t === 'str') items.push(shellQuote(`${k}=${v.v}`));
      else items.push(shellQuote(`${k}:=${jsonNodeToCompact(v)}`));
    }
  } else if (req.body?.kind === 'text') {
    flags.push(`--raw ${shellQuote(req.body.text)}`);
    if (native) notes.push('Dùng --raw vì JSON không biểu diễn được bằng các item key=value.');
    else if (req.body.json && o.rawBody) notes.push('Đang giữ nguyên chuỗi body bằng --raw.');
  }
  if (stdin !== null) {
    parts.push(`http ${[...flags, req.method, shellQuote(req.url), ...items].join(' ')} < ${stdin}`);
    return { code: parts.join('\n') + '\n', notes };
  }
  const line = ['http', ...flags, req.method, shellQuote(req.url), ...items].join(' ');
  if (req.compressed) notes.push('HTTPie tự gửi Accept-Encoding và giải nén.');
  if (!req.form && !req.body && req.headers.some((h) => lc(h.name) === 'content-type')) notes.push('Request không có body nhưng có Content-Type.');
  return { code: line + '\n', notes };
}

/* ---------- wget ---------- */

function genWget(req: ParsedCurl, o: GenOptions): GenResult {
  void o;
  const notes: string[] = [];
  const args: string[] = [];
  args.push(`--method=${req.method}`);
  for (const h of req.headers) args.push(`--header=${shellQuote(`${h.name}: ${h.value}`)}`);
  if (req.auth) {
    args.push(`--user=${shellQuote(req.auth.user)}`, `--password=${shellQuote(req.auth.password)}`, '--auth-no-challenge');
  }
  if (req.insecure) args.push('--no-check-certificate');
  if (req.compressed) args.push('--compression=auto');
  if (req.form) {
    notes.push('wget không hỗ trợ multipart/form-data — hãy dùng curl hoặc HTTPie.');
    return {
      code: `# wget không hỗ trợ multipart/form-data (-F). Dùng cURL hoặc HTTPie thay thế.\n`,
      notes,
    };
  }
  if (req.body?.kind === 'file') args.push(`--body-file=${shellQuote(req.body.path)}`);
  else if (req.body?.kind === 'text') args.push(`--body-data=${shellQuote(req.body.text)}`);
  if (req.method === 'HEAD') args.push('-S');
  args.push('-O -', shellQuote(req.url));
  notes.push('Cần wget 1.15+ để dùng --method / --body-data.');
  return { code: 'wget ' + args.join(' \\\n  ') + '\n', notes };
}

/* ---------- PowerShell ---------- */

function psStr(s: string): string {
  return "'" + s.replace(/['\u2018\u2019\u201a\u201b]/g, (m) => m + m) + "'";
}

function psBody(s: string): string {
  if (s.includes('\n') && !/(^|\n)'@/.test(s) && !s.includes('\r')) return "@'\n" + s + "\n'@";
  return psStr(s);
}

function genPowerShell(req: ParsedCurl, o: GenOptions): GenResult {
  void o;
  const notes: string[] = [];
  const L: string[] = [];
  const cmd = req.method === 'HEAD' ? 'Invoke-WebRequest' : 'Invoke-RestMethod';
  const methods: Record<string, string> = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options' };
  const args: string[] = [`-Uri ${psStr(req.url)}`, `-Method ${methods[req.method] ?? psStr(req.method)}`];
  let ct: string | undefined;
  let ua: string | undefined;
  const hs: Header[] = [];
  for (const h of req.headers) {
    if (lc(h.name) === 'content-type' && !req.form) ct = h.value;
    else if (lc(h.name) === 'user-agent') ua = h.value;
    else hs.push(h);
  }
  const merged = mergeHeaders(hs);
  if (merged.length !== hs.length) notes.push('Các header trùng tên đã được gộp (hashtable không lặp được key).');
  const needAuth = !!req.auth;
  if (needAuth) {
    L.push(`$pair = ${psStr(req.auth!.user + ':' + req.auth!.password)}`, '$token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))', '');
  }
  if (merged.length || needAuth) {
    L.push('$headers = @{');
    for (const h of merged) L.push(`    ${psStr(h.name)} = ${psStr(h.value)}`);
    if (needAuth) L.push('    "Authorization" = "Basic $token"');
    L.push('}', '');
    args.push('-Headers $headers');
  }
  if (ct) args.push(`-ContentType ${psStr(ct)}`);
  if (ua) args.push(`-UserAgent ${psStr(ua)}`);
  if (req.form) {
    L.push('$form = @{');
    const grouped = new Map<string, string[]>();
    for (const f of req.form) {
      const expr =
        f.kind === 'text' ? psStr(f.value) : f.kind === 'filetext' ? `(Get-Content -Raw ${psStr(f.value)})` : `(Get-Item ${psStr(f.value)})`;
      grouped.set(f.name, [...(grouped.get(f.name) ?? []), expr]);
    }
    for (const [name, exprs] of grouped) L.push(`    ${psStr(name)} = ${exprs.length === 1 ? exprs[0] : '@(' + exprs.join(', ') + ')'}`);
    L.push('}', '');
    args.push('-Form $form');
    notes.push('-Form cần PowerShell 6.1+.');
    if ((req.form ?? []).some((f) => f.type || f.filename)) notes.push('PowerShell không cho đặt type=/filename= riêng cho trường form.');
  } else if (req.body?.kind === 'file') {
    args.push(`-InFile ${psStr(req.body.path)}`);
  } else if (req.body?.kind === 'text') {
    L.push(`$body = ${psBody(req.body.text)}`, '');
    args.push('-Body $body');
  }
  if (req.insecure) {
    args.push('-SkipCertificateCheck');
    notes.push('-SkipCertificateCheck cần PowerShell 6+.');
  }
  L.push(`$response = ${cmd} ${args.join(' `\n    ')}`, '$response');
  return { code: L.join('\n') + '\n', notes };
}

export function generateCode(req: ParsedCurl, lang: string, opts: GenOptions): GenResult {
  try {
    switch (lang) {
      case 'js-fetch': return genFetch(req, opts, 'browser');
      case 'node-fetch': return genFetch(req, opts, 'node');
      case 'js-axios': return genAxios(req, opts);
      case 'python-requests': return genPython(req, opts, 'requests');
      case 'python-httpx': return genPython(req, opts, 'httpx');
      case 'go': return genGo(req, opts);
      case 'php-curl': return genPhpCurl(req, opts);
      case 'php-guzzle': return genGuzzle(req, opts);
      case 'ruby': return genRuby(req, opts);
      case 'java': return genJava(req, opts);
      case 'csharp': return genCsharp(req, opts);
      case 'rust': return genRust(req, opts);
      case 'httpie': return genHttpie(req, opts);
      case 'wget': return genWget(req, opts);
      case 'powershell': return genPowerShell(req, opts);
      default: return { code: '', notes: ['Ngôn ngữ không được hỗ trợ.'] };
    }
  } catch {
    return { code: '', notes: ['Không thể sinh mã cho request này.'] };
  }
}

/* ------------------------------------------------------------------ */
/* Ngược lại: dựng lệnh cURL                                           */
/* ------------------------------------------------------------------ */

export interface CurlBuildInput {
  method: string;
  url: string;
  headers: { name: string; value: string }[];
  bodyType: 'none' | 'raw' | 'json' | 'urlencoded';
  body: string;
  user: string;
  location: boolean;
  insecure: boolean;
  compressed: boolean;
  silent: boolean;
  multiline: boolean;
}

export interface CurlBuildResult {
  command: string;
  warnings: string[];
}

export function buildCurlCommand(inp: CurlBuildInput): CurlBuildResult {
  const warnings: string[] = [];
  const method = (inp.method || 'GET').trim().toUpperCase();
  const url = inp.url.trim();
  if (!url) return { command: '', warnings: ['Hãy nhập URL.'] };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) warnings.push('URL chưa có scheme (http:// hoặc https://).');
  const parts: string[] = ['curl'];
  const flags: string[] = [];
  if (inp.silent) flags.push('-s');
  if (inp.location) flags.push('-L');
  if (inp.insecure) flags.push('-k');
  if (inp.compressed) flags.push('--compressed');
  if (flags.length) parts.push(flags.join(' '));
  const hasBody = inp.bodyType !== 'none' && inp.body !== '';
  const impliedPost = hasBody;
  if (method === 'HEAD') parts.push('-I');
  else if (!(method === 'GET' && !hasBody) && !(method === 'POST' && impliedPost)) parts.push(`-X ${shellQuote(method)}`);
  parts.push(shellQuote(url));
  const headers = inp.headers.filter((h) => h.name.trim() !== '');
  const hasCT = headers.some((h) => lc(h.name.trim()) === 'content-type');
  for (const h of headers) {
    if (/[\r\n]/.test(h.name) || /[\r\n]/.test(h.value)) warnings.push(`Header "${h.name}" chứa xuống dòng — không hợp lệ.`);
    if (h.name.includes(':')) warnings.push(`Tên header "${h.name}" chứa dấu ":".`);
    parts.push(`-H ${shellQuote(`${h.name.trim()}: ${h.value.trim()}`)}`);
  }
  if (inp.user.trim()) parts.push(`-u ${shellQuote(inp.user)}`);
  if (hasBody) {
    if (inp.bodyType === 'json') {
      if (!hasCT) parts.push(`-H ${shellQuote('Content-Type: application/json')}`);
      if (!parseJsonNode(inp.body)) warnings.push('Body không phải JSON hợp lệ.');
      parts.push(`--data-raw ${shellQuote(inp.body)}`);
    } else if (inp.bodyType === 'urlencoded') {
      for (const line of inp.body.split(/\r?\n/)) {
        if (!line.trim()) continue;
        parts.push(`--data-urlencode ${shellQuote(line)}`);
      }
    } else parts.push(`--data-raw ${shellQuote(inp.body)}`);
  }
  const sep = inp.multiline ? ' \\\n  ' : ' ';
  // gộp "curl" + cờ + URL trên dòng đầu
  let first = parts.shift()!;
  while (parts.length && !parts[0].startsWith('-H') && !parts[0].startsWith('-u') && !parts[0].startsWith('--data')) {
    first += ' ' + parts.shift();
  }
  return { command: [first, ...parts].join(sep), warnings };
}

/* ------------------------------------------------------------------ */
/* Mẫu                                                                 */
/* ------------------------------------------------------------------ */

export interface CurlSample {
  label: string;
  command: string;
}

export const CURL_SAMPLES: CurlSample[] = [
  {
    label: 'GET đơn giản',
    command: `curl -sSL 'https://api.github.com/repos/vercel/next.js/issues?state=open&per_page=5' \\
  -H 'Accept: application/vnd.github+json' \\
  -H 'X-GitHub-Api-Version: 2022-11-28'`,
  },
  {
    label: 'POST JSON',
    command: `curl -X POST https://api.example.com/v1/users \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{"name":"Nguyễn Văn A","email":"a@example.com","tags":["dev","vn"],"profile":{"age":30,"vip":true,"note":null},"quote":"He said \\"hi\\""}'`,
  },
  {
    label: 'DevTools (Copy as cURL)',
    command: `curl 'https://example.com/api/search?q=caf%C3%A9&page=2' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'accept-language: vi-VN,vi;q=0.9,en-US;q=0.8' \\
  -H 'content-type: application/json' \\
  -H 'cookie: session=abc123; theme=dark' \\
  -H 'origin: https://example.com' \\
  -H 'referer: https://example.com/' \\
  -H 'sec-ch-ua: "Chromium";v="124", "Google Chrome";v="124"' \\
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' \\
  --data-raw $'{"query":"caf\\u00e9","filters":{"tags":["a","b"]},"note":"dòng 1\\\\ndòng 2 it\\'s \\\\"quoted\\\\""}' \\
  --compressed`,
  },
  {
    label: 'Multipart + file',
    command: `curl -X POST https://api.example.com/upload \\
  -u admin:s3cr3t \\
  -F 'title=Báo cáo tháng 5' \\
  -F 'file=@./report.pdf;type=application/pdf' \\
  -F 'tags=a' -F 'tags=b'`,
  },
  {
    label: 'Form urlencode + -G',
    command: `curl -G https://httpbin.org/get \\
  --data-urlencode 'q=hello world & more' \\
  --data-urlencode 'lang=vi' \\
  -H 'X-Trace: 1' -H 'X-Trace: 2'`,
  },
  {
    label: '--json + Basic auth',
    command: `curl --json '{"title":"foo","body":"bar \\"baz\\"","userId":1}' -u user:pa$$word -k https://jsonplaceholder.typicode.com/posts`,
  },
];

/** Chỉ dùng cho kiểm thử: các hàm thoát chuỗi theo ngôn ngữ. */
export const __literals = {
  pyStr, jsStr, jsTemplate, goStr, goBody, phpStr, rbStr, javaStr, csStr, csBody, rsStr, rsBody, psStr, psBody,
};
