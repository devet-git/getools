/**
 * Smart Paste: nhận diện loại dữ liệu người dùng dán vào và gợi ý tool phù hợp.
 * Thuần logic (không React), không ném lỗi, chỉ lấy mẫu ~200KB đầu.
 */

export type DetectedKind = 'json' | 'json-lines' | 'yaml' | 'jwt' | 'curl' | 'url' | 'cron' | 'timestamp' | 'sql' | 'dotenv' | 'uuid' | 'color' | 'log' | 'base64' | 'pem-cert' | 'markdown' | 'html' | 'csv' | 'diff' | 'docker-run' | 'dockerfile' | 'otpauth' | 'unix-mode' | 'email' | 'ip' | 'path-list' | 'regex' | 'text';

export interface ToolTarget { toolId: string; why: string }
export interface Detection { kind: DetectedKind; label: string; confidence: number; reason: string; targets: ToolTarget[] }

export const MAX_SAMPLE_CHARS = 200_000;

const LABELS: Record<DetectedKind, string> = {
  json: 'JSON',
  'json-lines': 'JSON Lines (NDJSON)',
  yaml: 'YAML / cấu hình',
  jwt: 'JWT token',
  curl: 'Lệnh cURL',
  url: 'URL / liên kết',
  cron: 'Biểu thức Cron',
  timestamp: 'Timestamp / ngày giờ',
  sql: 'Câu lệnh SQL',
  dotenv: 'File .env',
  uuid: 'UUID',
  color: 'Màu sắc / gradient',
  log: 'Log',
  base64: 'Base64 / hex / hash',
  'pem-cert': 'Chứng chỉ / khóa PEM',
  markdown: 'Markdown',
  html: 'HTML',
  csv: 'Bảng CSV / TSV',
  diff: 'Diff (unified)',
  'docker-run': 'Lệnh docker run',
  dockerfile: 'Dockerfile',
  otpauth: 'Liên kết otpauth (2FA)',
  'unix-mode': 'Quyền file Unix',
  email: 'Địa chỉ email',
  ip: 'Địa chỉ IP',
  'path-list': 'Danh sách đường dẫn',
  regex: 'Biểu thức chính quy',
  text: 'Văn bản thường',
};

function mk(kind: DetectedKind, confidence: number, reason: string, targets: ToolTarget[]): Detection {
  return { kind, label: LABELS[kind], confidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)), reason, targets };
}
const T = (toolId: string, why: string): ToolTarget => ({ toolId, why });

const NONEMPTY_LINE_CAP = 3000;

interface Ctx {
  raw: string;
  t: string; // trimmed
  head: string; // 4000 ký tự đầu của t
  lines: string[]; // dòng không rỗng (đã trim), tối đa NONEMPTY_LINE_CAP
  truncated: boolean;
}

function allLines(c: Ctx, pred: (l: string) => boolean): boolean {
  return c.lines.length > 0 && c.lines.every(pred);
}

// ---------------------------------------------------------------------------
// Từng detector
// ---------------------------------------------------------------------------

function dJson(c: Ctx): Detection | null {
  const { t } = c;
  const a = t[0];
  const z = t[t.length - 1];
  if (!((a === '{' && (z === '}' || c.truncated)) || (a === '[' && (z === ']' || c.truncated)))) return null;
  if (c.truncated) {
    return mk('json', 0.7, 'Bắt đầu như JSON nhưng dữ liệu rất lớn nên chỉ kiểm tra sơ bộ.', [
      T('json-yaml', 'Định dạng / chuyển sang YAML'), T('json-explorer', 'Duyệt cây & JSONPath'),
    ]);
  }
  let v: unknown;
  try { v = JSON.parse(t); } catch { return null; }
  if (v === null || typeof v !== 'object') return null;
  const empty = Array.isArray(v) ? v.length === 0 : Object.keys(v as object).length === 0;
  const targets = [
    T('json-yaml', 'Định dạng, kiểm tra hợp lệ, chuyển sang YAML'),
    T('json-explorer', 'Duyệt cây và truy vấn JSONPath'),
    T('json-to-code', 'Sinh kiểu dữ liệu TypeScript, Go, Python...'),
    T('json-diff', 'So sánh cấu trúc với JSON khác'),
  ];
  if (Array.isArray(v) && v.length > 0 && v.slice(0, 100).every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    targets.push(T('data-convert', 'Chuyển mảng đối tượng thành CSV / bảng Markdown'));
  }
  const kind = Array.isArray(v) ? 'mảng' : 'đối tượng';
  return mk('json', empty ? 0.8 : 0.97, `Phân tích được thành JSON hợp lệ (${kind}).`, targets);
}

function dJsonLines(c: Ctx): Detection | null {
  if (c.lines.length < 2 || c.t[0] !== '{') return null;
  const sample = c.lines.slice(0, 50);
  for (const l of sample) {
    if (l[0] !== '{' || l[l.length - 1] !== '}') return null;
    try { const v = JSON.parse(l); if (!v || typeof v !== 'object') return null; } catch { return null; }
  }
  return mk('json-lines', 0.93, `${c.lines.length >= 50 ? '50+' : c.lines.length} dòng, mỗi dòng là một đối tượng JSON.`, [
    T('log-viewer', 'Xem như log có cấu trúc, lọc theo mức / thời gian'),
    T('data-convert', 'Chuyển sang bảng / CSV'),
    T('json-yaml', 'Định dạng từng bản ghi'),
  ]);
}

const KEYLINE = /^(?:-\s+)?["']?[A-Za-z_][\w.\-/ ]{0,60}["']?\s*:(?:\s|$)/;
const LEVEL_KEYS = /^(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|FATAL|CRITICAL)\s*:/;

function dYaml(c: Ctx): Detection | null {
  const { t } = c;
  if (t[0] === '{' || t[0] === '[' || c.lines.length < 2) return null;
  const body = c.raw.split('\n', 400).filter((l) => l.trim() && !/^\s*#/.test(l) && l.trim() !== '---' && l.trim() !== '...');
  if (body.length < 2) return null;
  let key = 0, item = 0, other = 0;
  for (const l of body) {
    if (LEVEL_KEYS.test(l.trim())) return null;
    if (KEYLINE.test(l.trim()) || KEYLINE.test(l)) key++;
    else if (/^\s*-\s+\S/.test(l)) item++;
    else if (/^\s+\S/.test(l)) other++; // nội dung thụt lề (block scalar, nested)
    else other += 2;
  }
  if (key < 2) return null;
  const ratio = (key + item + other * 0.5) / (body.length + other * 0.5);
  const keyRatio = key / body.length;
  if (keyRatio < 0.4 || ratio < 0.7) return null;
  const hasDoc = /^---\s*$/m.test(t.slice(0, 2000));
  let conf = 0.5 + 0.25 * keyRatio + (hasDoc ? 0.08 : 0);
  conf = Math.min(conf, 0.84);
  const targets = [T('json-yaml', 'Chuyển YAML sang JSON, kiểm tra cú pháp')];
  if (/^services\s*:/m.test(t) || /^version\s*:.*\n[\s\S]*services\s*:/m.test(t)) targets.push(T('docker-tools', 'Chuyển Docker Compose sang lệnh docker run'));
  if (/^on\s*:/m.test(t) && /^jobs\s*:/m.test(t)) targets.unshift(T('github-actions', 'Chỉnh workflow GitHub Actions'));
  return mk('yaml', conf, `${key} dòng dạng "khóa: giá trị" với cấu trúc thụt lề.`, targets);
}

function dJwt(c: Ctx): Detection | null {
  const m = /^(?:bearer\s+)?([A-Za-z0-9_-]{4,})\.([A-Za-z0-9_-]{4,})\.([A-Za-z0-9_-]*)$/i.exec(c.t);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    if (!json || typeof json !== 'object' || !('alg' in json || 'typ' in json)) return null;
  } catch { return null; }
  return mk('jwt', 0.98, 'Ba phần ngăn bởi dấu chấm, phần header giải mã được thành JSON có "alg".', [
    T('jwt-tools', 'Giải mã, ký và xác minh JWT'), T('encode', 'Giải mã Base64URL từng phần'),
  ]);
}

function dCurl(c: Ctx): Detection | null {
  if (!/^(?:\$\s*)?curl(?:\s|\.exe\s)/i.test(c.t)) return null;
  return mk('curl', 0.97, 'Bắt đầu bằng lệnh curl.', [T('curl-converter', 'Chuyển cURL sang fetch, axios, Python, Go...')]);
}

const GH = /^https?:\/\/(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+)(\/[^\s]*)?$/i;

function isUrl(l: string): boolean {
  if (/\s/.test(l) || !/^(?:https?|ftp|wss?|file|ssh|git):\/\/[^/\s]+/i.test(l)) return false;
  try { new URL(l); return true; } catch { return false; }
}

function dUrl(c: Ctx): Detection | null {
  if (!allLines(c, isUrl)) return null;
  const n = c.lines.length;
  const targets = [T('url-tools', n > 1 ? 'Phân tích hàng loạt URL, tham số query' : 'Phân tích URL, chỉnh query string')];
  const gh = c.lines.filter((l) => GH.test(l) || /^https?:\/\/raw\.githubusercontent\.com\//i.test(l));
  if (gh.length) {
    targets.push(T('link-converter', 'Chuyển link GitHub (blob / raw / tree / zip)'));
    const repoOnly = gh.some((l) => { const m = GH.exec(l); return !!m && (!m[3] || m[3] === '/'); });
    if (repoOnly) {
      targets.push(T('repo-viewer', 'Xem nhanh cấu trúc repo'));
      targets.push(T('repo-analytics', 'Phân tích repo: ngôn ngữ, đóng góp'));
    }
    if (gh.some((l) => /\/(?:tree|blob)\//.test(l))) targets.push(T('download', 'Tải file / thư mục từ GitHub'));
    if (gh.some((l) => /\/releases/.test(l))) targets.push(T('releases', 'Xem và tải GitHub Releases'));
  }
  targets.push(T('qr', 'Tạo mã QR cho liên kết'));
  const reason = n > 1 ? `${n} dòng, mỗi dòng là một URL hợp lệ.` : 'Một URL hợp lệ có giao thức.';
  return mk('url', n > 1 ? 0.92 : 0.95, reason, targets);
}

const CRON_NAMES_M = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';
const CRON_NAMES_D = 'SUN|MON|TUE|WED|THU|FRI|SAT';

function cronField(f: string, min: number, max: number, names?: string, special?: boolean): { ok: boolean; fancy: boolean } {
  let fancy = false;
  if (!f) return { ok: false, fancy };
  for (const part of f.split(',')) {
    if (!part) return { ok: false, fancy };
    if (part !== f) fancy = true;
    const [base, step, extra] = part.split('/');
    if (extra !== undefined) return { ok: false, fancy };
    if (step !== undefined) {
      fancy = true;
      if (!/^\d+$/.test(step) || +step < 1 || +step > max) return { ok: false, fancy };
    }
    if (base === '*' || base === '?') { if (base === '*') fancy = true; continue; }
    if (special && (/^\d{1,2}[LW#]\d?$/i.test(base) || /^L(?:-\d+)?$/i.test(base) || /^[A-Z]{3}#\d$/i.test(base))) { fancy = true; continue; }
    const rng = base.split('-');
    if (rng.length > 2) return { ok: false, fancy };
    if (rng.length === 2) fancy = true;
    for (const x of rng) {
      if (/^\d+$/.test(x)) { if (+x < min || +x > max) return { ok: false, fancy }; }
      else if (names && new RegExp(`^(?:${names})$`, 'i').test(x)) fancy = true;
      else return { ok: false, fancy };
    }
  }
  return { ok: true, fancy };
}

function cronTokens(tok: string[]): { ok: boolean; fancy: boolean } {
  const six = tok.length === 6;
  const f = six ? tok.slice(1) : tok;
  const checks = [
    ...(six ? [cronField(tok[0], 0, 59)] : []),
    cronField(f[0], 0, 59), cronField(f[1], 0, 23), cronField(f[2], 1, 31, undefined, true),
    cronField(f[3], 1, 12, CRON_NAMES_M), cronField(f[4], 0, 7, CRON_NAMES_D, true),
  ];
  return { ok: checks.every((x) => x.ok), fancy: checks.some((x) => x.fancy) };
}

function dCron(c: Ctx): Detection | null {
  if (c.lines.length !== 1) return null;
  const l = c.lines[0];
  const targets = [T('cron', 'Giải thích bằng ngôn ngữ thường và xem các lần chạy tiếp theo')];
  if (/^@(?:yearly|annually|monthly|weekly|daily|midnight|hourly|reboot)$/i.test(l)) {
    return mk('cron', 0.93, 'Macro cron (@daily, @hourly...).', targets);
  }
  const tok = l.split(/\s+/);
  if (tok.length === 5 || tok.length === 6) {
    const r = cronTokens(tok);
    if (r.ok) {
      return r.fancy
        ? mk('cron', 0.94, `${tok.length} trường, mỗi trường đều đúng cú pháp cron.`, targets)
        : mk('cron', 0.28, `${tok.length} số trong phạm vi hợp lệ của cron (có thể chỉ là dãy số).`, targets);
    }
  }
  if (tok.length > 5) {
    const r = cronTokens(tok.slice(0, 5));
    if (r.ok && r.fancy && /^[\w/.~"'-]/.test(tok[5]) && !/^\d/.test(tok[5])) {
      return mk('cron', 0.84, 'Dòng crontab: 5 trường cron theo sau là lệnh.', targets);
    }
  }
  return null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s?(?:Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?))?)?$/;
const RFC_RE = /^[A-Z][a-z]{2},\s\d{1,2}\s[A-Z][a-z]{2}\s\d{4}\s\d{2}:\d{2}:\d{2}\s(?:GMT|UTC|[+-]\d{4})$/;
const MAX_TS_SEC = 4102444800; // 2100-01-01

function tsScore(l: string): number {
  if (/^[1-9]\d{8,12}(?:\.\d{1,9})?$/.test(l)) {
    const n = Number(l);
    const sec = n <= MAX_TS_SEC ? n : null;
    const ms = n / 1000 <= MAX_TS_SEC && n >= 1e10 ? n : null;
    if (sec === null && ms === null) return 0;
    const intDigits = l.split('.')[0].length;
    if ((intDigits === 10 && l[0] === '1') || (intDigits === 13 && l[0] === '1')) return 0.92;
    if (intDigits === 10 || intDigits === 13) return 0.82;
    return 0.55;
  }
  if (ISO_RE.test(l)) {
    if (Number.isNaN(Date.parse(l.replace(' ', 'T').replace(/\sUTC|\sGMT/, 'Z').replace(',', '.')))) return 0;
    return l.length > 10 ? 0.88 : 0.7;
  }
  if (RFC_RE.test(l) && !Number.isNaN(Date.parse(l))) return 0.88;
  return 0;
}

function dTimestamp(c: Ctx): Detection | null {
  if (c.lines.length === 0 || c.lines.length > 500) return null;
  let min = 1;
  for (const l of c.lines) { const s = tsScore(l); if (!s) return null; min = Math.min(min, s); }
  const n = c.lines.length;
  const isNum = /^\d/.test(c.lines[0]) && !c.lines[0].includes('-');
  const targets = [T('time-tools', 'Đổi sang ngày giờ, múi giờ, tính khoảng cách')];
  if (isNum) targets.push(T('number-tools', 'Xem dưới dạng hệ cơ số / bit'));
  return mk('timestamp', min, n > 1 ? `${n} dòng đều là mốc thời gian hợp lệ.` : isNum ? 'Dãy số nằm trong khoảng Unix timestamp 1970–2100.' : 'Chuỗi ngày giờ hợp lệ (ISO 8601 / RFC 2822).', targets);
}

function dSql(c: Ctx): Detection | null {
  const h = c.head.replace(/^(?:\s*(?:--[^\n]*|\/\*[\s\S]*?\*\/)\s*)+/, '');
  const targets = [T('sql-tools', 'Định dạng, thu gọn và làm đẹp SQL')];
  let m: RegExpExecArray | null;
  if ((m = /^\s*(insert\s+into|delete\s+from|create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?(?:table|index|unique\s+index|view|database|schema|trigger)|alter\s+table|drop\s+(?:table|index|view|database|schema)|truncate\s+table)\s+\S/i.exec(h))) {
    return mk('sql', 0.93, `Bắt đầu bằng "${m[1].replace(/\s+/g, ' ').toUpperCase()}".`, targets);
  }
  if (/^\s*update\s+[\w.`"[\]]+\s+set\s+\S/i.test(h)) return mk('sql', 0.93, 'Câu lệnh UPDATE ... SET.', targets);
  if (/^\s*with\s+(?:recursive\s+)?[\w"`]+\s*(?:\([^)]*\))?\s*as\s*\(/i.test(h) && /\bselect\b/i.test(h)) {
    return mk('sql', 0.9, 'Câu lệnh CTE (WITH ... AS (SELECT ...)).', targets);
  }
  const sel = /^\s*select\s+(?:distinct\s+|top\s+\d+\s+)?([\s\S]+?)\s+from\s+([\s\S]*)$/i.exec(h);
  if (sel) {
    let s = 0.45;
    const list = sel[1];
    if (/^\*$|^[\w.`"[\]]+\.\*$|,|\(|\bas\b|^[\w.`"]+\.[\w.`"]+/i.test(list)) s += 0.2;
    if (/\b(?:where|join|group\s+by|order\s+by|limit|having|union|offset)\b/i.test(sel[2])) s += 0.2;
    if (/^[\w.`"[\]]+(?:\s+(?:as\s+)?\w+)?\s*(?:$|;|,|\b(?:where|join|inner|left|right|group|order|limit|having|union|on)\b)/i.test(sel[2].trim())
      && !/^(?:the|a|an|this|that|my|your|our|these|those|all|each)\b/i.test(sel[2].trim())) s += 0.15;
    if (/;\s*$/.test(c.t)) s += 0.08;
    if (/^SELECT\b/.test(h) && /\bFROM\b/.test(h)) s += 0.05; // từ khóa viết hoa
    if (s >= 0.6) return mk('sql', Math.min(0.95, s), 'Câu lệnh SELECT ... FROM với cấu trúc SQL.', targets);
  }
  return null;
}

function dDotenv(c: Ctx): Detection | null {
  const re = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/;
  const rows = c.raw.split('\n', 1000).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (rows.length === 0) return null;
  let upper = 0;
  for (const l of rows) {
    const m = re.exec(l);
    if (!m || /^=+$/.test(m[2]) || /^[=&]/.test(m[2])) return null;
    if (/^[A-Z_][A-Z0-9_]*$/.test(m[1])) upper++;
  }
  if (rows.length < 2 && upper < 1) return null;
  if (rows.length < 2 && /^[A-Za-z0-9+/]+={1,2}$/.test(rows[0])) return null;
  if (upper === 0 && rows.length < 3) return null;
  const conf = rows.length >= 2 ? 0.55 + 0.4 * (upper / rows.length) : 0.65;
  return mk('dotenv', conf, `${rows.length} dòng dạng KEY=giá trị${upper ? ', khóa viết hoa kiểu biến môi trường' : ''}.`, [
    T('env-tools', 'Kiểm tra, so sánh, chuyển .env sang JSON / YAML / docker'),
  ]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function dUuid(c: Ctx): Detection | null {
  if (c.lines.length > 2000) return null;
  if (allLines(c, (l) => UUID_RE.test(l.replace(/^[{"']|[}"',]$/g, '')))) {
    const n = c.lines.length;
    return mk('uuid', 0.98, n > 1 ? `${n} dòng, mỗi dòng là một UUID.` : 'Đúng định dạng UUID 8-4-4-4-12.', [
      T('encode', 'Chuyển hex / Base64, băm, xem nhị phân'),
      T('number-tools', 'Xem dưới dạng số 128-bit'),
    ]);
  }
  if (c.lines.length === 1 && ULID_RE.test(c.t) && /[A-Z]/.test(c.t) && /\d/.test(c.t)) {
    return mk('uuid', 0.6, 'Có thể là ULID (26 ký tự Crockford Base32).', [T('encode', 'Xử lý chuỗi định danh')]);
  }
  return null;
}

const NAMED_CSS = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\))$/i;

function dColor(c: Ctx): Detection | null {
  const t = c.t;
  const targets = [T('color-tools', 'Chuyển HEX / RGB / HSL, kiểm tra độ tương phản'), T('css-playground', 'Thử trong CSS playground')];
  if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(t) && t.endsWith(')') && t.length < 2000) {
    return mk('color', 0.93, 'Hàm gradient CSS.', [T('color-tools', 'Dựng và chỉnh gradient'), T('css-playground', 'Thử trong CSS playground')]);
  }
  if (c.lines.length > 200) return null;
  const toks = c.lines.length === 1 && t.includes(',') && !/[()]/.test(t)
    ? t.split(/\s*,\s*/) : c.lines.map((l) => l.replace(/[;,]$/, ''));
  if (!toks.length || !toks.every((x) => NAMED_CSS.test(x))) return null;
  return mk('color', toks.length > 1 ? 0.92 : 0.95, toks.length > 1 ? `${toks.length} giá trị màu CSS.` : 'Giá trị màu CSS (HEX / rgb / hsl).', targets);
}

const LEVEL_RE = /(?:\b(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|FATAL|CRITICAL|SEVERE)\b|\[(?:trace|debug|info|warn|warning|error|fatal)\]|\blevel[=:]\s*"?(?:trace|debug|info|warn|warning|error|fatal)\b)/;
const TS_RE = /^\[?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\d{2}:\d{2}:\d{2}|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}|\d{1,2}\/[A-Z][a-z]{2}\/\d{4})/;
const ACCESS_RE = /^\S+\s+\S+\s+\S+\s+\[\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2}/;
const TRACE_RE = /^(?:at\s+\S+.*\(?.*:\d+(?::\d+)?\)?$|Traceback \(most recent call last\)|File ".*", line \d+|Caused by:|\.\.\. \d+ more|goroutine \d+ \[)/;

function dLog(c: Ctx): Detection | null {
  const ls = c.lines.slice(0, 400);
  if (ls.length < 2) return null;
  let lvl = 0, ts = 0, both = 0, access = 0, trace = 0;
  for (const l of ls) {
    const a = LEVEL_RE.test(l.slice(0, 200)), b = TS_RE.test(l);
    if (ACCESS_RE.test(l)) access++;
    else if (TRACE_RE.test(l)) trace++;
    if (a) lvl++;
    if (b) ts++;
    if (a && b) both++;
  }
  const n = ls.length;
  const fr = (lvl + access + trace) / n;
  if (access / n > 0.6) return mk('log', 0.9, 'Dòng log truy cập dạng Apache / Nginx.', [T('log-viewer', 'Lọc, tìm kiếm và thống kê log'), T('ai-text', 'Nhờ AI giải thích log')]);
  if (fr < 0.4 || lvl === 0) return null;
  const conf = 0.5 + 0.25 * fr + 0.12 * (both / n) + (ts / n > 0.5 ? 0.05 : 0);
  return mk('log', Math.min(0.9, conf), `${lvl}/${n} dòng có mức log (INFO, WARN, ERROR...)${ts ? ' và mốc thời gian' : ''}.`, [
    T('log-viewer', 'Lọc theo mức, tìm kiếm, gom nhóm log'), T('ai-text', 'Nhờ AI giải thích lỗi'),
  ]);
}

function dPem(c: Ctx): Detection | null {
  const m = /-----BEGIN ((?:[A-Z0-9]+ )*[A-Z0-9]+)-----[\s\S]*?-----END \1-----/.exec(c.t);
  if (!m) return null;
  const type = m[1];
  const isCert = /CERTIFICATE/.test(type);
  const isPriv = /PRIVATE KEY/.test(type);
  return mk('pem-cert', isCert ? 0.98 : 0.9, `Khối PEM "${type}".${isPriv ? ' Đây là khóa riêng tư, hãy cẩn thận khi chia sẻ.' : ''}`, [
    T('x509', isCert ? 'Giải mã chứng chỉ: chủ thể, hạn, SAN, vân tay' : 'Xem thông tin khóa / PEM'),
    T('encode', 'Chuyển đổi Base64 / hex'),
  ]);
}

function dBase64(c: Ctx): Detection | null {
  const t = c.t;
  const data = /^data:([\w.+-]+\/[\w.+-]+)?(?:;[\w=.+-]+)*;base64,([A-Za-z0-9+/=_-]+)$/.exec(t.length < 1_000_000 ? t : '');
  if (data) {
    const img = (data[1] || '').startsWith('image/');
    return mk('base64', 0.95, `Data URI ${data[1] || ''} mã hóa Base64.`.replace('  ', ' '), [
      T('encode', 'Giải mã Base64'), ...(img ? [T('image-tools', 'Mở / nén / đổi định dạng ảnh')] : []),
    ]);
  }
  if (c.lines.length !== 1 && !(c.lines.length > 1 && c.lines.length < 400 && c.lines.every((l) => /^[A-Za-z0-9+/]+={0,2}$/.test(l) && (l.length === c.lines[0].length || l === c.lines[c.lines.length - 1])))) return null;
  const s = c.lines.join('');
  if (s.length > 190_000) return null;
  const encTargets = [T('encode', 'Giải mã / mã hóa, băm, chuyển đổi')];
  // hex / hash
  if (/^[0-9a-fA-F]+$/.test(s)) {
    const hashes: Record<number, string> = { 32: 'MD5', 40: 'SHA-1', 56: 'SHA-224', 64: 'SHA-256', 96: 'SHA-384', 128: 'SHA-512' };
    if (hashes[s.length]) return mk('base64', 0.9, `Chuỗi hex dài ${s.length} ký tự, đúng kích thước hash ${hashes[s.length]}.`, encTargets);
    if (s.length >= 8 && s.length % 2 === 0 && /[a-fA-F]/.test(s)) return mk('base64', 0.7, 'Chuỗi hex có độ dài chẵn.', [...encTargets, T('number-tools', 'Chuyển hệ cơ số')]);
    return null;
  }
  if (/^\d+$/.test(s)) return null;
  const urlSafe = /^[A-Za-z0-9_-]+={0,2}$/.test(s) && /[-_]/.test(s);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) && !urlSafe) return null;
  if (s.length < 12) return null;
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  if (!urlSafe && s.length % 4 !== 0) return null;
  let bytes: Uint8Array;
  try {
    const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
    bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch { return null; }
  let printable = 0;
  const lim = Math.min(bytes.length, 4000);
  for (let i = 0; i < lim; i++) { const b = bytes[i]; if ((b >= 32 && b < 127) || b === 10 || b === 13 || b === 9 || b >= 0xc2) printable++; }
  let isText = false;
  if (lim > 0 && printable / lim >= 0.97) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, lim)); isText = true; } catch { /* không phải utf-8 */ }
  }
  if (isText && bytes.length >= 6) {
    return mk('base64', 0.9, 'Chuỗi Base64 hợp lệ, giải mã ra văn bản đọc được.', encTargets);
  }
  const mixed = /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);
  if (s.length >= 24 && (mixed || /[+/=]/.test(s))) return mk('base64', 0.6, 'Trông giống chuỗi Base64 (có thể là dữ liệu nhị phân).', encTargets);
  return null;
}

function dMarkdown(c: Ctx): Detection | null {
  const ls = c.raw.split('\n', 600);
  if (ls.length < 2 && c.t.length < 40) return null;
  const sig = new Set<string>();
  let fence = false;
  for (const l of ls) {
    if (/^\s*(```|~~~)/.test(l)) { sig.add('fence'); fence = !fence; continue; }
    if (fence) continue;
    if (/^#{1,6}\s+\S/.test(l)) sig.add('heading');
    else if (/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?\S/.test(l)) sig.add('ul');
    else if (/^\s*\d+[.)]\s+\S/.test(l)) sig.add('ol');
    else if (/^>\s?\S/.test(l)) sig.add('quote');
    else if (/^\s*\|?\s*:?-{3,}:?\s*\|\s*:?-{3,}/.test(l)) sig.add('table');
    else if (/^(?:---|\*\*\*|___)\s*$/.test(l)) sig.add('hr');
    if (/\*\*[^*\s][^*]*\*\*|__[^_\s][^_]*__/.test(l)) sig.add('bold');
    if (/!?\[[^\]\n]+\]\((?:https?:\/\/|\/|#|\.)[^)\s]*\)/.test(l)) sig.add('link');
    if (/`[^`\n]+`/.test(l)) sig.add('code');
  }
  const strong = ['heading', 'fence', 'table', 'link', 'bold'].filter((k) => sig.has(k)).length;
  const n = sig.size;
  if (strong < 1 || (n < 2 && !sig.has('table') && !sig.has('fence'))) return null;
  if (n === 2 && strong === 1 && sig.has('hr')) return null;
  const conf = Math.min(0.88, 0.42 + 0.1 * n + 0.04 * strong);
  return mk('markdown', conf, `Có ${n} dấu hiệu Markdown (${[...sig].slice(0, 5).join(', ')}).`, [
    T('markdown-preview', 'Xem trước và xuất Markdown'), T('readme-builder', 'Hoàn thiện thành README'), T('ai-text', 'Tóm tắt / dịch bằng AI'),
  ]);
}

const KNOWN_TAGS = 'html|head|body|div|span|p|a|ul|ol|li|h[1-6]|table|thead|tbody|tr|td|th|img|br|hr|section|article|header|footer|nav|main|meta|link|script|style|title|form|input|button|label|select|option|textarea|pre|code|strong|em|b|i|svg|iframe|video|audio';

function dHtml(c: Ctx): Detection | null {
  const h = c.t.slice(0, 20000);
  if (h[0] !== '<' && !/<\w/.test(h)) return null;
  const hasMeta = /<(?:meta|title|link)\b/i.test(h) || /<head\b/i.test(h);
  const targets = [T('html-to-markdown', 'Chuyển HTML sang Markdown')];
  if (hasMeta) targets.push(T('meta-tags', 'Kiểm tra meta tag và xem trước chia sẻ mạng xã hội'));
  if (/^<!doctype\s+html|^<html[\s>]/i.test(h)) return mk('html', 0.97, 'Tài liệu HTML đầy đủ (doctype / thẻ html).', targets);
  const tags = h.match(new RegExp(`</?(?:${KNOWN_TAGS})(?:\\s[^<>]{0,300})?/?>`, 'gi')) || [];
  if (tags.length < 2) return null;
  const closing = tags.some((x) => x.startsWith('</')) || tags.some((x) => /\/>$/.test(x)) || /<(?:br|hr|img|meta|link|input)\b/i.test(h);
  if (!closing) return null;
  const distinct = new Set(tags.map((x) => x.replace(/[<>/]/g, '').split(/\s/)[0].toLowerCase())).size;
  return mk('html', Math.min(0.92, 0.6 + 0.06 * tags.length + 0.03 * distinct), `Có ${tags.length} thẻ HTML.`, targets);
}

function splitCount(line: string, d: string): number {
  let q = false, n = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n + 1;
}

function dCsv(c: Ctx): Detection | null {
  const ls = c.lines.slice(0, 60);
  if (ls.length < 2) return null;
  if (ls[0][0] === '{' || ls[0][0] === '[' || ls[0][0] === '<') return null;
  let best: Detection | null = null;
  for (const d of [',', '\t', ';', '|']) {
    if (d === '|' && ls.every((l) => l.startsWith('|'))) continue; // bảng Markdown
    const cols = ls.map((l) => splitCount(l, d));
    const first = cols[0];
    if (first < 2) continue;
    const ok = cols.filter((x) => x === first).length;
    if (ok / cols.length < 0.9) continue;
    const rows = c.lines.length;
    let conf = 0.5;
    if (d === '\t') conf = 0.82;
    else if (first >= 3) conf = 0.7;
    else conf = rows >= 4 ? 0.58 : 0.3;
    const avg = ls.join('').length / (ls.length * first);
    if (avg > 40) conf -= 0.2;
    if (d === ',') {
      const sp = (ls.join('\n').match(/, /g) || []).length;
      const cm = (ls.join('\n').match(/,/g) || []).length;
      if (cm && sp / cm > 0.8 && /[a-z]{3,} [a-z]{3,}/i.test(ls[0])) conf -= 0.25;
    }
    const hdr = ls[0].split(d).every((x) => !/^\s*-?\d+(\.\d+)?\s*$/.test(x));
    if (hdr && ls.slice(1).some((l) => l.split(d).some((x) => /^\s*-?\d+(\.\d+)?\s*$/.test(x)))) conf += 0.1;
    if (rows >= 5) conf += 0.05;
    if (conf < 0.25) continue;
    const name = { ',': 'dấu phẩy', '\t': 'Tab', ';': 'dấu chấm phẩy', '|': 'dấu |' }[d];
    const det = mk('csv', Math.min(0.9, conf), `${rows} dòng, mỗi dòng ${first} cột ngăn bởi ${name}.`, [
      T('data-convert', 'Chuyển CSV sang JSON / bảng Markdown'),
    ]);
    if (!best || det.confidence > best.confidence) best = det;
  }
  return best;
}

function dDiff(c: Ctx): Detection | null {
  const h = c.raw.slice(0, 50000);
  const hunk = (h.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm) || []).length;
  const git = /^diff --git a\/.+ b\/.+/m.test(h);
  const files = /^--- (?:a\/|\/dev\/null|\S).*\n\+\+\+ (?:b\/|\/dev\/null|\S)/m.test(h);
  if (!hunk && !git) return null;
  let conf = 0.55;
  if (hunk) conf += 0.15;
  if (git) conf += 0.15;
  if (files) conf += 0.12;
  return mk('diff', Math.min(0.97, conf), `Unified diff${git ? ' kiểu git' : ''}${hunk ? `, ${hunk} khối thay đổi` : ''}.`, [
    T('ai-commit', 'Sinh commit message / mô tả PR từ diff'), T('ai-text', 'Nhờ AI giải thích thay đổi'),
  ]);
}

function dDockerRun(c: Ctx): Detection | null {
  if (!/^(?:\$\s*)?(?:sudo\s+)?docker\s+(?:container\s+)?run\s/i.test(c.t)) return null;
  return mk('docker-run', 0.97, 'Bắt đầu bằng lệnh docker run.', [T('docker-tools', 'Chuyển docker run sang docker-compose và ngược lại')]);
}

const DOCKER_INSTR = /^(FROM|RUN|CMD|COPY|ADD|ENV|ARG|EXPOSE|WORKDIR|ENTRYPOINT|USER|LABEL|VOLUME|HEALTHCHECK|SHELL|STOPSIGNAL|ONBUILD|MAINTAINER)\s/;

function dDockerfile(c: Ctx): Detection | null {
  const rows = c.raw.split('\n', 500);
  let first: string | null = null, instr = 0;
  let cont = false;
  for (const raw of rows) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    if (cont) { cont = l.endsWith('\\'); continue; }
    if (first === null) first = l;
    if (DOCKER_INSTR.test(l) || /^(?:FROM|ARG)$/.test(l)) instr++;
    else return null;
    cont = l.endsWith('\\');
  }
  if (!first || !/^(?:FROM|ARG)\s/.test(first)) return null;
  if (/^FROM\s+\S+/.test(first) === false && !/^ARG/.test(first)) return null;
  const img = first.split(/\s+/)[1] || '';
  const known = /[:/@]/.test(img) || /^(?:scratch|alpine|ubuntu|debian|node|python|golang|busybox|nginx|ruby|php|java|rust)$/i.test(img);
  return mk('dockerfile', Math.min(0.97, instr === 1 ? (known ? 0.85 : 0.3) : 0.78 + 0.05 * instr), `Dockerfile với ${instr} chỉ thị, bắt đầu bằng ${first.split(/\s/)[0]}.`, [
    T('dockerfile', 'Kiểm tra lỗi (lint) và tối ưu Dockerfile'),
  ]);
}

function dOtp(c: Ctx): Detection | null {
  if (!/^otpauth(?:-migration)?:\/\//i.test(c.t)) return null;
  return mk('otpauth', 0.99, 'URI otpauth:// của ứng dụng xác thực 2 yếu tố.', [T('totp', 'Sinh mã TOTP, xem bí mật, tạo QR')]);
}

function dMode(c: Ctx): Detection | null {
  const t = c.t;
  const targets = [T('chmod', 'Chuyển đổi giữa số bát phân và rwx')];
  if (/^[-dlbcps][r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(t) || /^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(t)) {
    return mk('unix-mode', 0.95, 'Chuỗi quyền dạng rwxr-xr-x.', targets);
  }
  if (/^chmod\s+(?:-[A-Za-z]+\s+)*(?:[0-7]{3,4}|[ugoa]*[+=-][rwxXst]+(?:,[ugoa]*[+=-][rwxXst]+)*)(?:\s+\S+)*$/.test(t)) {
    return mk('unix-mode', 0.92, 'Lệnh chmod.', targets);
  }
  if (/^[0-7]{3,4}$/.test(t)) {
    const common = ['755', '644', '777', '600', '700', '750', '640', '666', '400', '444', '775', '664', '0755', '0644', '0777', '0600', '0700', '1777', '4755'];
    return common.includes(t)
      ? mk('unix-mode', 0.72, 'Giá trị 3–4 chữ số bát phân, một mode quen thuộc (chmod).', targets)
      : mk('unix-mode', 0.4, 'Số 3–4 chữ số bát phân, có thể là mode chmod.', targets);
  }
  return null;
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

function dEmail(c: Ctx): Detection | null {
  if (c.lines.length > 2000) return null;
  const toks = c.lines.length === 1 ? c.t.split(/\s*[,;]\s*|\s+/) : c.lines.map((l) => l.replace(/[,;]$/, ''));
  if (!toks.length || !toks.every((x) => EMAIL_RE.test(x.replace(/^<|>$/g, '')))) return null;
  return mk('email', toks.length > 1 ? 0.85 : 0.88, toks.length > 1 ? `${toks.length} địa chỉ email.` : 'Địa chỉ email hợp lệ.', [
    T('text-tools', 'Tách, loại trùng, sắp xếp danh sách'), T('qr', 'Tạo mã QR mailto'),
  ]);
}

function ipv4(s: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2})|:(\d{1,5}))?$/.exec(s);
  if (!m) return false;
  if (!m.slice(1, 5).every((x) => +x <= 255 && (x === '0' || x[0] !== '0'))) return false;
  if (m[5] !== undefined && +m[5] > 32) return false;
  if (m[6] !== undefined && +m[6] > 65535) return false;
  return true;
}
const IPV6 = /^(?:\[)?(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:\])?(?:\/\d{1,3})?$/i;

function dIp(c: Ctx): Detection | null {
  if (c.lines.length > 2000) return null;
  const toks = c.lines.length === 1 ? c.t.split(/\s*[,;]\s*|\s+/) : c.lines.map((l) => l.replace(/[,;]$/, ''));
  if (!toks.length) return null;
  let v6 = false;
  for (const x of toks) {
    if (ipv4(x)) continue;
    if (IPV6.test(x) && x.split(':').length >= 3) { v6 = true; continue; }
    return null;
  }
  return mk('ip', toks.length > 1 ? 0.88 : v6 ? 0.88 : 0.86, toks.length > 1 ? `${toks.length} địa chỉ IP.` : v6 ? 'Địa chỉ IPv6.' : 'Địa chỉ IPv4 hợp lệ.', [
    T('number-tools', 'Chuyển IP sang số nguyên, nhị phân, hex'), T('url-tools', 'Ghép thành URL, phân tích cổng'),
  ]);
}

const PATH_LINE = /^(?:\.{0,2}\/|~\/|[A-Za-z]:[\\/])?[\w@.\-~+$%#=\[\]()]+(?:[\\/][\w@.\-~+$%#=\[\]()]*)+$/;
const BARE_FILE = /^[\w@\-~+]+(?:\.[\w-]+)+$/;

function dPathList(c: Ctx): Detection | null {
  const ls = c.lines;
  if (ls.length === 0) return null;
  if (ls.some((l) => /:\/\/|\s/.test(l))) {
    // cho phép tiền tố như "├── " của tree: không hỗ trợ, chỉ danh sách thuần
    return null;
  }
  if (!ls.every((l) => PATH_LINE.test(l) || (ls.length > 1 && BARE_FILE.test(l)))) return null;
  if (!ls.some((l) => PATH_LINE.test(l))) return null;
  const strong = ls.filter((l) => (l.match(/[\\/]/g) || []).length >= 2 || /\.\w{1,6}$/.test(l) || /^(?:\.{0,2}\/|~\/|[A-Za-z]:[\\/])/.test(l)).length;
  if (strong / ls.length < 0.6) return null;
  if (ls.length === 1 && !/^(?:\.{1,2}\/|\/|~\/|[A-Za-z]:[\\/])/.test(ls[0])) return null;
  const n = ls.length;
  const conf = n === 1 ? 0.5 : Math.min(0.88, 0.62 + 0.04 * n);
  return mk('path-list', conf, n === 1 ? 'Một đường dẫn file / thư mục.' : `${n} dòng, mỗi dòng là một đường dẫn.`, [
    T('tree-gen', 'Vẽ sơ đồ cây thư mục từ danh sách đường dẫn'),
  ]);
}

function dRegex(c: Ctx): Detection | null {
  if (c.lines.length !== 1) return null;
  const m = /^\/(.+)\/([dgimsuvy]{0,8})$/.exec(c.t);
  if (!m) return null;
  const body = m[1];
  let cls = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') { i++; continue; }
    if (cls) { if (ch === ']') cls = false; continue; }
    if (ch === '[') cls = true;
    else if (ch === '/') return null;
  }
  const meta = /[\\[\](){}*+?^$|]/.test(body);
  try { new RegExp(body, m[2]); } catch { return null; }
  if (!meta) return m[2] ? mk('regex', 0.5, 'Dạng /mẫu/cờ.', [T('regex', 'Thử biểu thức chính quy')]) : null;
  return mk('regex', 0.9, 'Biểu thức chính quy dạng /mẫu/cờ hợp lệ.', [T('regex', 'Thử, giải thích và kiểm tra mẫu')]);
}

// ---------------------------------------------------------------------------

const DETECTORS: ((c: Ctx) => Detection | null)[] = [
  dJwt, dPem, dOtp, dJson, dJsonLines, dCurl, dDockerRun, dDiff, dDockerfile, dUrl, dCron, dTimestamp,
  dUuid, dColor, dRegex, dMode, dEmail, dIp, dSql, dHtml, dLog, dDotenv, dYaml, dBase64, dMarkdown, dCsv, dPathList,
];

function makeCtx(text: string): Ctx {
  const truncated = text.length > MAX_SAMPLE_CHARS;
  const raw = (truncated ? text.slice(0, MAX_SAMPLE_CHARS) : text).replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const t = raw.trim();
  const lines: string[] = [];
  let i = 0;
  while (i <= raw.length && lines.length < NONEMPTY_LINE_CAP) {
    let j = raw.indexOf('\n', i);
    if (j < 0) j = raw.length;
    const l = raw.slice(i, j).trim();
    if (l) lines.push(l);
    i = j + 1;
  }
  return { raw, t, head: t.slice(0, 4000), lines, truncated };
}

export function detect(text: string): Detection[] {
  try {
    if (typeof text !== 'string' || !text.trim()) return [];
    const c = makeCtx(text);
    const out: Detection[] = [];
    for (const d of DETECTORS) {
      try {
        const r = d(c);
        if (r && r.confidence > 0) out.push(r);
      } catch { /* bỏ qua detector lỗi */ }
    }
    const best = out.reduce((m, d) => Math.max(m, d.confidence), 0);
    // URL nhúng trong văn bản
    if (!out.some((d) => d.kind === 'url')) {
      const urls = c.head.match(/https?:\/\/[^\s<>"')\]]+/g);
      if (urls && urls.length) {
        out.push(mk('url', Math.min(0.4, 0.3 + 0.02 * urls.length), `Văn bản chứa ${urls.length} URL.`, [T('url-tools', 'Phân tích các URL trong văn bản')]));
      }
    }
    out.push(mk('text', best >= 0.5 ? 0.15 : 0.32, `${c.t.length.toLocaleString('vi-VN')} ký tự, ${c.lines.length} dòng không rỗng.`, [
      T('text-tools', 'Đếm, làm sạch, đổi kiểu chữ'),
      T('ai-text', 'Tóm tắt / dịch / giải thích bằng AI'),
      T('compare', 'So sánh với một văn bản khác'),
      T('markdown-preview', 'Xem như Markdown'),
      T('llm-tokens', 'Đếm token và chi phí LLM'),
    ]));
    return out.sort((a, b) => b.confidence - a.confidence);
  } catch {
    return [];
  }
}

export function suggestTools(text: string, limit = 6): { toolId: string; why: string; kind: DetectedKind; confidence: number }[] {
  const res: { toolId: string; why: string; kind: DetectedKind; confidence: number }[] = [];
  const seen = new Set<string>();
  for (const d of detect(text)) {
    for (const tg of d.targets) {
      if (seen.has(tg.toolId)) continue;
      seen.add(tg.toolId);
      res.push({ toolId: tg.toolId, why: tg.why, kind: d.kind, confidence: d.confidence });
      if (res.length >= limit) return res;
    }
  }
  return res;
}
