/**
 * Log Viewer: phân tích nhiều định dạng log, gom stack trace, lọc, thống kê, che dữ liệu nhạy cảm.
 * Thuần logic (không React), không ném lỗi với dữ liệu xấu.
 *
 * Quy ước thời gian: timestamp không có múi giờ được coi là UTC (xác định, không phụ thuộc máy).
 */

export type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'unknown';

export const LEVELS: Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'unknown'];
export const LEVEL_RANK: Record<Level, number> = {
  unknown: -1,
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};
export const LEVEL_LABEL: Record<Level, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  fatal: 'FATAL',
  unknown: '—',
};

export const MAX_LINE_LENGTH = 20000;
export const MAX_TRACE_LINES = 2000;
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export interface LogEntry {
  id: number;
  /** Số dòng (bắt đầu từ 1) của dòng đầu entry */
  line: number;
  ts: number | null;
  tsText: string;
  level: Level;
  message: string;
  format: string;
  fields: Record<string, string>;
  /** Dòng đầu tiên (nguyên văn) */
  raw: string;
  /** Các dòng tiếp theo (stack trace...) */
  trace: string[];
}

/* ------------------------------------------------------------------ */
/* Level                                                               */
/* ------------------------------------------------------------------ */

export function normLevel(v: string | number | null | undefined): Level {
  if (v === null || v === undefined) return 'unknown';
  if (typeof v === 'number') {
    if (v >= 60) return 'fatal';
    if (v >= 50) return 'error';
    if (v >= 40) return 'warn';
    if (v >= 30) return 'info';
    if (v >= 20) return 'debug';
    if (v >= 10) return 'trace';
    return 'unknown';
  }
  const s = v.trim().toLowerCase();
  if (!s) return 'unknown';
  if (/^\d+$/.test(s)) return normLevel(parseInt(s, 10));
  switch (s) {
    case 'trace': case 'trc': case 'finest': case 'finer': case 'verbose': case 'silly': case 'vrb':
      return 'trace';
    case 'debug': case 'dbg': case 'fine': case 'config': case 'dbug':
      return 'debug';
    case 'info': case 'inf': case 'information': case 'informational': case 'notice': case 'success':
      return 'info';
    case 'warn': case 'wrn': case 'warning':
      return 'warn';
    case 'error': case 'err': case 'severe': case 'failure': case 'exception':
      return 'error';
    case 'fatal': case 'ftl': case 'critical': case 'crit': case 'panic': case 'emerg': case 'emergency': case 'alert':
      return 'fatal';
    default:
      return 'unknown';
  }
}

function levelFromStatus(status: number): Level {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

function levelFromSyslogSeverity(sev: number): Level {
  if (sev <= 1) return 'fatal';
  if (sev <= 3) return 'error';
  if (sev === 4) return 'warn';
  if (sev <= 6) return 'info';
  return 'debug';
}

/* ------------------------------------------------------------------ */
/* Timestamp                                                           */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const TS_SRC =
  '(\\d{4})[-/](\\d{2})[-/](\\d{2})[T ](\\d{2}):(\\d{2}):(\\d{2})(?:[.,](\\d{1,9}))?(?:(Z|UTC|GMT)|\\s?([+-]\\d{2}:?\\d{2})|([+-]\\d{2})(?!\\d))?';
const TS_RE_G = new RegExp(TS_SRC, 'g');
const TIME_ONLY_RE = /^(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?/;
const APACHE_TS_RE = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?:\s?([+-]\d{2}:?\d{2}))?/;
const SYSLOG_TS_RE = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/;
const EPOCH_RE = /^(\d{9,19})(?:\.(\d{1,9}))?$/;

function fracToMs(frac: string | undefined): number {
  if (!frac) return 0;
  return parseInt((frac + '00').slice(0, 3), 10);
}

function offsetToMs(off: string | undefined): number {
  if (!off) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(off);
  if (!m) return 0;
  const v = (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10)) * 60000;
  return m[1] === '-' ? -v : v;
}

function validParts(mo: number, d: number, h: number, mi: number, s: number): boolean {
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h < 24 && mi < 60 && s < 61;
}

/** Epoch giây / mili giây / micro giây / nano giây → ms. null nếu không hợp lý (năm ngoài 2001..2286). */
export function epochToMs(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  let ms: number;
  if (n < 1e10) ms = n * 1000;
  else if (n < 1e13) ms = n;
  else if (n < 1e16) ms = n / 1000;
  else if (n < 1e19) ms = n / 1e6;
  else return null;
  if (ms < 9.9e11 || ms > 1e13) return null;
  return Math.round(ms);
}

/**
 * Tìm timestamp kiểu ISO/Go/Python trong `s` (trong `maxIndex` ký tự đầu).
 * Trả về vị trí và độ dài đoạn khớp.
 */
export function findTimestamp(s: string, maxIndex = 60): { ms: number; index: number; length: number } | null {
  const head = s.length > maxIndex + 40 ? s.slice(0, maxIndex + 40) : s;
  TS_RE_G.lastIndex = 0;
  const m = TS_RE_G.exec(head);
  if (!m || m.index > maxIndex) return null;
  const mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], sec = +m[6];
  if (!validParts(mo, d, h, mi, sec)) return null;
  const off = m[8] ? 0 : offsetToMs(m[9] || m[10]);
  const ms = Date.UTC(+m[1], mo - 1, d, h, mi, sec, fracToMs(m[7])) - off;
  if (Number.isNaN(ms)) return null;
  return { ms, index: m.index, length: m[0].length };
}

/**
 * Phân tích một giá trị thời gian thành ms epoch (UTC).
 * Hỗ trợ: ISO 8601 (có/không múi giờ), `2024-01-01 12:00:00,123`, Go `2009/11/10 23:00:00`,
 * Apache `10/Oct/2000:13:55:36 -0700`, syslog `Jan  5 10:00:00`, epoch giây/mili giây, chỉ giờ `12:00:00.123`.
 */
export function parseTimestamp(input: string | number, refYear: number = new Date().getUTCFullYear()): number | null {
  if (typeof input === 'number') return epochToMs(input);
  const s = input.trim();
  if (!s) return null;
  const e = EPOCH_RE.exec(s);
  if (e) return epochToMs(parseFloat(s));
  const f = findTimestamp(s, 0);
  if (f && f.index === 0) return f.ms;
  const a = APACHE_TS_RE.exec(s);
  if (a) {
    const mon = MONTHS[a[2].toLowerCase()];
    if (mon === undefined || !validParts(mon + 1, +a[1], +a[4], +a[5], +a[6])) return null;
    return Date.UTC(+a[3], mon, +a[1], +a[4], +a[5], +a[6]) - offsetToMs(a[7]);
  }
  const sy = SYSLOG_TS_RE.exec(s);
  if (sy) {
    const mon = MONTHS[sy[1].toLowerCase()];
    if (mon === undefined || !validParts(mon + 1, +sy[2], +sy[3], +sy[4], +sy[5])) return null;
    return Date.UTC(refYear, mon, +sy[2], +sy[3], +sy[4], +sy[5]);
  }
  const t = TIME_ONLY_RE.exec(s);
  if (t && +t[1] < 24 && +t[2] < 60 && +t[3] < 61) {
    return Date.UTC(1970, 0, 1, +t[1], +t[2], +t[3], fracToMs(t[4]));
  }
  if (/^[A-Za-z]{3},? /.test(s) || /^\d{1,2} [A-Za-z]{3} \d{4}/.test(s)) {
    const p = Date.parse(s);
    if (!Number.isNaN(p)) return p;
  }
  return null;
}

function two(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** Hiển thị ms → `YYYY-MM-DD HH:mm:ss.SSS` (UTC). */
export function formatTs(ms: number, withMs = true): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const base = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
  return withMs ? `${base}.${String(d.getUTCMilliseconds()).padStart(3, '0')}` : base;
}

/* ------------------------------------------------------------------ */
/* Parse từng dòng                                                     */
/* ------------------------------------------------------------------ */

export interface ParsedLine {
  ts: number | null;
  tsText: string;
  level: Level;
  message: string;
  format: string;
  fields: Record<string, string>;
  /** Dòng phụ (vd stack trong JSON) */
  trace?: string[];
}

const LVL =
  '(?:TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|ERR|SEVERE|CRITICAL|CRIT|FATAL|PANIC|EMERG|ALERT|FINEST|FINER|FINE|VERBOSE|SILLY|DBG|WRN|INF|FTL|TRC)';
const RE_SPRING = new RegExp(`^\\s*(${LVL})\\s+(\\d+)\\s+---\\s+(.*)$`, 'i');
const RE_LOGBACK = new RegExp(`^\\s*\\[([^\\]]*)\\]\\s+(${LVL})\\s+(\\S+)\\s+-\\s?(.*)$`, 'i');
const RE_LOG4J = new RegExp(`^\\s*(${LVL})\\s+\\[([^\\]]*)\\]\\s+(\\S+)\\s+-\\s?(.*)$`, 'i');
const RE_PYTHON_BASIC = new RegExp(`^\\s*(\\S+)\\s+-\\s+(${LVL})\\s+-\\s+(.*)$`, 'i');
const RE_PINO_PRETTY = new RegExp(`^\\s*(${LVL})\\s+\\(([^)]*)\\):?\\s?(.*)$`, 'i');
const RE_LEVEL_FIRST = new RegExp(`^[\\s|:-]*\\[?(${LVL})\\]?(?![A-Za-z])[\\s:|-]*(.*)$`, 'i');
const RE_LEVEL_AFTER_BRACKETS = new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*|\\([^)]*\\)\\s*){1,3}\\[?(${LVL})\\]?(?![A-Za-z])[\\s:|-]*(.*)$`, 'i');
const RE_PY_DEFAULT = /^(CRITICAL|ERROR|WARNING|INFO|DEBUG):([\w.$-]+):(.*)$/;
const RE_PLAIN_LEVEL_COLON = new RegExp(`^\\s*\\[?(${LVL})\\]?\\s*:\\s*(.*)$`, 'i');
const RE_PLAIN_LEVEL_UPPER = new RegExp(`^\\s*(?:\\[(${LVL})\\]|(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL))\\s+(.*)$`);
const RE_DOCKER = /^(stdout|stderr)\s+([FP])\s?(.*)$/;
const RE_ACCESS =
  /^(\S+) (\S+) (\S+) \[([^\]]+)\] "((?:[^"\\]|\\.)*)" (\d{3}) (\d+|-)(.*)$/;
const RE_REQUEST = /^(\S+)(?: (\S+))?(?: (HTTP\/[\d.]+))?$/;
const RE_ACCESS_TAIL = /^\s*"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"(.*)$/;
const RE_SYSLOG5424 =
  /^<(\d{1,3})>(\d)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*((?:-|(?:\[(?:[^\]\\]|\\.)*\])+))?\s*(.*)$/;
const RE_SYSLOG3164 =
  /^(?:<(\d{1,3})>)?([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^\s:[]+)(?:\[(\d+)\])?:\s*(.*)$/;
const RE_LOGFMT_START = /^[\w.@/-]+=(?:"(?:[^"\\]|\\.)*"|\S*)\s+[\w.@/-]+=/;
const RE_LOGFMT_PAIR = /([\w.@/-]+)=("(?:[^"\\]|\\.)*"|\S*)/g;
const RE_LATENCY_KEY = /(?:^|\s)(?:rt|request_time|duration|latency|time_taken|response_time)[=:]"?(\d+(?:\.\d+)?)/;
const RE_LATENCY_LAST = /(?:^|\s)"?(\d+\.\d+)"?\s*$/;

const MSG_KEYS = ['msg', 'message', 'event', 'text', 'log'];
const LEVEL_KEYS = ['level', 'severity', 'lvl', 'loglevel', 'log_level', 'levelname', 'log.level'];
const TIME_KEYS = ['time', 'ts', 'timestamp', '@timestamp', 't', 'datetime', 'asctime', 'date'];
const LOGGER_KEYS = ['logger', 'logger_name', 'name', 'category', 'component'];
const STACK_KEY_RE = /^(stack_?trace|stack|exception|exc_info|error\.stack|error\.stack_trace)$/i;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function flatten(obj: unknown, prefix: string, out: Record<string, string>, depth: number): void {
  if (Object.keys(out).length > 120) return;
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj) && depth < 3) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
    return;
  }
  let str: string;
  if (obj === null) str = 'null';
  else if (typeof obj === 'string') str = obj;
  else if (typeof obj === 'object') {
    try { str = JSON.stringify(obj); } catch { str = String(obj); }
  } else str = String(obj);
  out[prefix] = truncate(str, 2000);
}

function tsFromValue(v: string | undefined): { ts: number | null; text: string } {
  if (v === undefined) return { ts: null, text: '' };
  return { ts: parseTimestamp(v), text: v };
}

function parseJsonLine(line: string): ParsedLine | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const raw = obj as Record<string, unknown>;
  // Docker json-file: {"log":"...","stream":"stdout","time":"..."}
  if (typeof raw.log === 'string' && typeof raw.stream === 'string' && typeof raw.time === 'string') {
    const inner = parseLine(raw.log.replace(/\n$/, ''));
    const t = tsFromValue(raw.time);
    return {
      ...inner,
      ts: inner.ts ?? t.ts,
      tsText: inner.ts !== null ? inner.tsText : t.text,
      format: 'docker-json',
      fields: { stream: raw.stream, ...inner.fields },
    };
  }
  const flat: Record<string, string> = {};
  flatten(raw, '', flat, 0);
  // Tìm key theo tên (không phân biệt hoa thường, ưu tiên theo thứ tự danh sách)
  const lower = new Map<string, string>();
  for (const k of Object.keys(flat)) {
    const lk = k.toLowerCase();
    if (!lower.has(lk)) lower.set(lk, k);
  }
  const take = (keys: string[]): string | undefined => {
    for (const k of keys) {
      const real = lower.get(k);
      if (real !== undefined) {
        const v = flat[real];
        delete flat[real];
        lower.delete(k);
        return v;
      }
    }
    return undefined;
  };
  const levelRaw = take(LEVEL_KEYS);
  const timeRaw = take(TIME_KEYS);
  let msg = take(MSG_KEYS);
  const logger = take(LOGGER_KEYS);
  if (logger !== undefined) flat.logger = logger;
  const trace: string[] = [];
  for (const k of Object.keys(flat)) {
    if (STACK_KEY_RE.test(k) && flat[k].includes('\n')) {
      trace.push(...flat[k].split(/\r?\n/));
      delete flat[k];
    }
  }
  if (msg === undefined) msg = line.length > 300 ? line.slice(0, 300) + '…' : line;
  const t = tsFromValue(timeRaw);
  const lv = levelRaw !== undefined ? normLevel(levelRaw) : 'unknown';
  return {
    ts: t.ts,
    tsText: t.text,
    level: lv,
    message: msg,
    format: 'json',
    fields: flat,
    trace: trace.length ? trace : undefined,
  };
}

function unquote(v: string): string {
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    return v.slice(1, -1).replace(/\\(["\\nt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
  }
  return v;
}

function parseLogfmt(text: string, format = 'logfmt'): ParsedLine {
  const fields: Record<string, string> = {};
  RE_LOGFMT_PAIR.lastIndex = 0;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = RE_LOGFMT_PAIR.exec(text)) !== null && count++ < 120) {
    fields[m[1]] = truncate(unquote(m[2]), 2000);
  }
  const keys = new Map<string, string>();
  for (const k of Object.keys(fields)) if (!keys.has(k.toLowerCase())) keys.set(k.toLowerCase(), k);
  const take = (list: string[]): string | undefined => {
    for (const k of list) {
      const real = keys.get(k);
      if (real !== undefined) {
        const v = fields[real];
        delete fields[real];
        keys.delete(k);
        return v;
      }
    }
    return undefined;
  };
  const lvRaw = take(LEVEL_KEYS);
  const tRaw = take(TIME_KEYS);
  const msg = take(MSG_KEYS);
  const t = tsFromValue(tRaw);
  return {
    ts: t.ts,
    tsText: t.text,
    level: lvRaw !== undefined ? normLevel(lvRaw) : 'unknown',
    message: msg !== undefined ? msg : text,
    format,
    fields,
  };
}

function parseAccess(line: string): ParsedLine | null {
  const m = RE_ACCESS.exec(line);
  if (!m) return null;
  const status = parseInt(m[6], 10);
  const ts = parseTimestamp(m[4]);
  const req = RE_REQUEST.exec(m[5]);
  const fields: Record<string, string> = { ip: m[1] };
  if (m[3] !== '-') fields.user = m[3];
  let method = '';
  let path = '';
  if (req) {
    method = req[1];
    path = req[2] ?? '';
    fields.method = method;
    fields.path = path;
    if (req[3]) fields.protocol = req[3];
  } else {
    fields.request = m[5];
  }
  fields.status = String(status);
  fields.bytes = m[7] === '-' ? '0' : m[7];
  let tail = m[8];
  const t = RE_ACCESS_TAIL.exec(tail);
  if (t) {
    if (t[1] && t[1] !== '-') fields.referer = t[1];
    if (t[2] && t[2] !== '-') fields.ua = truncate(t[2], 500);
    tail = t[3];
  }
  if (tail) {
    const lk = RE_LATENCY_KEY.exec(tail) ?? RE_LATENCY_LAST.exec(tail);
    if (lk) fields.latency = String(Math.round(parseFloat(lk[1]) * 1000 * 1000) / 1000); // giây → ms
  }
  return {
    ts,
    tsText: m[4],
    level: levelFromStatus(status),
    message: `${method || m[5]} ${path} ${status}`.replace(/\s+/g, ' ').trim(),
    format: 'access',
    fields,
  };
}

function inferLevelFromText(msg: string): Level {
  if (/\b(fatal|panic|critical)\b/i.test(msg)) return 'fatal';
  if (/\b(error|fail(?:ed|ure)?|exception|denied)\b/i.test(msg)) return 'error';
  if (/\bwarn(?:ing)?\b/i.test(msg)) return 'warn';
  return 'info';
}

function parseSyslog(line: string, refYear: number): ParsedLine | null {
  const c = line.charCodeAt(0);
  if (c === 60 /* < */) {
    const m = RE_SYSLOG5424.exec(line);
    if (m) {
      const pri = parseInt(m[1], 10);
      const fields: Record<string, string> = {
        facility: String(pri >> 3),
        severity: String(pri & 7),
      };
      if (m[4] !== '-') fields.host = m[4];
      if (m[5] !== '-') fields.app = m[5];
      if (m[6] !== '-') fields.procid = m[6];
      if (m[7] !== '-') fields.msgid = m[7];
      if (m[8] && m[8] !== '-') fields.sd = truncate(m[8], 1000);
      return {
        ts: m[3] === '-' ? null : parseTimestamp(m[3]),
        tsText: m[3] === '-' ? '' : m[3],
        level: levelFromSyslogSeverity(pri & 7),
        message: m[9],
        format: 'syslog5424',
        fields,
      };
    }
  }
  if (c === 60 || (c >= 65 && c <= 90)) {
    const m = RE_SYSLOG3164.exec(line);
    if (m) {
      const fields: Record<string, string> = { host: m[3], app: m[4] };
      if (m[5]) fields.pid = m[5];
      let level: Level;
      if (m[1] !== undefined) {
        const pri = parseInt(m[1], 10);
        fields.facility = String(pri >> 3);
        level = levelFromSyslogSeverity(pri & 7);
      } else level = inferLevelFromText(m[6]);
      return {
        ts: parseTimestamp(m[2], refYear),
        tsText: m[2],
        level,
        message: m[6],
        format: 'syslog3164',
        fields,
      };
    }
  }
  return null;
}

/** Phân tích phần còn lại sau timestamp. */
function parseRest(rest: string): { level: Level; message: string; format: string; fields: Record<string, string> } {
  let m: RegExpExecArray | null;
  const fields: Record<string, string> = {};
  if ((m = RE_SPRING.exec(rest))) {
    fields.pid = m[2];
    let tail = m[3];
    const brackets: string[] = [];
    let b: RegExpExecArray | null;
    while ((b = /^\[([^\]]*)\]\s*/.exec(tail))) {
      brackets.push(b[1].trim());
      tail = tail.slice(b[0].length);
      if (brackets.length >= 3) break;
    }
    if (brackets.length) fields.thread = brackets[brackets.length - 1];
    if (brackets.length > 1) fields.app = brackets[0];
    const lg = /^(\S+)\s*:\s?(.*)$/.exec(tail);
    let message = tail;
    if (lg) {
      fields.logger = lg[1];
      message = lg[2];
    }
    return { level: normLevel(m[1]), message, format: 'spring', fields };
  }
  if ((m = RE_LOGBACK.exec(rest))) {
    fields.thread = m[1];
    fields.logger = m[3];
    return { level: normLevel(m[2]), message: m[4], format: 'logback', fields };
  }
  if ((m = RE_LOG4J.exec(rest))) {
    fields.thread = m[2];
    fields.logger = m[3];
    return { level: normLevel(m[1]), message: m[4], format: 'log4j', fields };
  }
  if ((m = RE_PYTHON_BASIC.exec(rest))) {
    fields.logger = m[1];
    return { level: normLevel(m[2]), message: m[3], format: 'python', fields };
  }
  if ((m = RE_PINO_PRETTY.exec(rest))) {
    fields.proc = m[2];
    return { level: normLevel(m[1]), message: m[3], format: 'pino-pretty', fields };
  }
  if (RE_LOGFMT_START.test(rest)) {
    const p = parseLogfmt(rest, 'logfmt');
    return { level: p.level, message: p.message, format: 'logfmt', fields: p.fields };
  }
  if ((m = RE_LEVEL_FIRST.exec(rest))) {
    let message = m[2];
    const lg = /^([\w.$-]{3,}):\s+(.*)$/.exec(message);
    if (lg && lg[1].includes('.')) {
      fields.logger = lg[1];
      message = lg[2];
    }
    return { level: normLevel(m[1]), message, format: 'winston', fields };
  }
  if ((m = RE_LEVEL_AFTER_BRACKETS.exec(rest))) {
    return { level: normLevel(m[1]), message: m[2], format: 'generic', fields };
  }
  return { level: 'unknown', message: rest.trim(), format: 'generic', fields };
}

/**
 * Phân tích một dòng (không xét stack trace). Không bao giờ ném lỗi.
 */
export function parseLine(rawLine: string, refYear: number = new Date().getUTCFullYear()): ParsedLine {
  const line = rawLine.length > MAX_LINE_LENGTH ? rawLine.slice(0, MAX_LINE_LENGTH) : rawLine;
  try {
    return parseLineInner(line, refYear);
  } catch {
    return { ts: null, tsText: '', level: 'unknown', message: line, format: 'text', fields: {} };
  }
}

function parseLineInner(line: string, refYear: number): ParsedLine {
  const c0 = line.charCodeAt(0);
  // JSON
  if (c0 === 123 /* { */ && line.charCodeAt(line.length - 1) === 125) {
    const j = parseJsonLine(line);
    if (j) return j;
  }
  // Syslog
  if (c0 === 60 || (c0 >= 65 && c0 <= 90)) {
    const s = parseSyslog(line, refYear);
    if (s) return s;
  }
  // Access log (bắt đầu bằng IP / host, có `[` và `"`)
  if (line.indexOf('] "') > 0) {
    const a = parseAccess(line);
    if (a) return a;
  }
  // Python logging mặc định: ERROR:root:message
  if (c0 >= 65 && c0 <= 90) {
    const py = RE_PY_DEFAULT.exec(line);
    if (py) {
      return {
        ts: null, tsText: '', level: normLevel(py[1]), message: py[3], format: 'python',
        fields: { logger: py[2] },
      };
    }
  }
  // logfmt
  if (RE_LOGFMT_START.test(line)) {
    return parseLogfmt(line);
  }
  // epoch ở đầu dòng
  let m: RegExpExecArray | null;
  let tsMs: number | null = null;
  let tsText = '';
  let prefix = '';
  let rest = '';
  let found = false;
  const f = findTimestamp(line, 48);
  if (f) {
    found = true;
    tsMs = f.ms;
    tsText = line.slice(f.index, f.index + f.length);
    prefix = line.slice(0, f.index);
    rest = line.slice(f.index + f.length);
  } else if ((m = /^\[?(\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?)\]?/.exec(line))) {
    const t = parseTimestamp(m[1]);
    if (t !== null) {
      found = true;
      tsMs = t;
      tsText = m[1];
      rest = line.slice(m[0].length);
    }
  } else if ((m = /^\[?(\d{10}(?:\.\d+)?|\d{13})\]?(?=\s|$)/.exec(line))) {
    const t = parseTimestamp(m[1]);
    if (t !== null) {
      found = true;
      tsMs = t;
      tsText = m[1];
      rest = line.slice(m[0].length);
    }
  }
  if (found) {
    // Docker / Kubernetes CRI: `<ts> stdout F message`
    if ((m = RE_DOCKER.exec(rest.replace(/^\s+/, '')))) {
      const inner = parseLine(m[3], refYear);
      return {
        ...inner,
        ts: inner.ts ?? tsMs,
        tsText: inner.ts !== null ? inner.tsText : tsText,
        format: 'docker',
        fields: { stream: m[1], ...inner.fields },
      };
    }
    const cleaned = rest.replace(/^[\]\s|]+/, '').replace(/^[-:]\s+/, '');
    const r = parseRest(cleaned);
    let level = r.level;
    if (level === 'unknown' && prefix) {
      const pl = RE_LEVEL_FIRST.exec(prefix.trim());
      if (pl && !pl[2]) level = normLevel(pl[1]);
    }
    const fields = r.fields;
    if (prefix.trim() && !fields.prefix) fields.prefix = truncate(prefix.trim(), 200);
    return { ts: tsMs, tsText, level, message: r.message, format: r.format, fields };
  }
  // Không có timestamp: `LEVEL: msg`, `[LEVEL] msg`
  if ((m = RE_PLAIN_LEVEL_COLON.exec(line))) {
    return { ts: null, tsText: '', level: normLevel(m[1]), message: m[2], format: 'text', fields: {} };
  }
  if ((m = RE_PLAIN_LEVEL_UPPER.exec(line))) {
    return { ts: null, tsText: '', level: normLevel(m[1] || m[2]), message: m[3], format: 'text', fields: {} };
  }
  return { ts: null, tsText: '', level: 'unknown', message: line, format: 'text', fields: {} };
}

/* ------------------------------------------------------------------ */
/* Gom stack trace                                                     */
/* ------------------------------------------------------------------ */

const RE_JAVA_AT = /^\s+at\s/;
const RE_EXC_HEADER = /^(?:Exception in thread\s|[\w$.]*(?:Exception|Error|Throwable)\b)/;
const RE_STARTS_TS = /^\s*\[?\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}/;

type TraceState = { py: boolean; go: boolean };

function isContinuation(line: string, st: TraceState): boolean {
  const c = line.charCodeAt(0);
  if (c === 32 || c === 9) {
    // dòng thụt lề: thuộc entry trước, trừ khi nó là JSON/ts rõ ràng
    return !RE_STARTS_TS.test(line);
  }
  if (st.go) return !RE_STARTS_TS.test(line);
  if (st.py) return true; // dòng ngoại lệ cuối traceback
  if (c === 67 /* C */ && line.startsWith('Caused by:')) return true;
  if (c === 83 /* S */ && line.startsWith('Suppressed:')) return true;
  if (c === 84 /* T */ && line.startsWith('Traceback (most recent call last)')) return true;
  if (c === 68 /* D */ && line.startsWith('During handling of the above exception')) return true;
  if (c === 84 && line.startsWith('The above exception was the direct cause')) return true;
  if (c === 103 /* g */ && /^goroutine \d+ \[/.test(line)) return true;
  if (c === 46 /* . */ && /^\.\.\. \d+ (?:more|common frames omitted)/.test(line)) return true;
  if (c === 69 || c === 74 || c === 106 || c >= 65) {
    if (RE_EXC_HEADER.test(line)) return true;
  }
  return false;
}

function updateTraceState(line: string, st: TraceState): void {
  if (st.py) {
    const c = line.charCodeAt(0);
    if (c !== 32 && c !== 9 && !line.startsWith('Traceback') && !line.startsWith('During handling') && !line.startsWith('The above exception')) {
      st.py = false; // đây là dòng ngoại lệ cuối
    }
  }
  if (line.startsWith('Traceback (most recent call last)')) st.py = true;
  else if (line.startsWith('During handling') || line.startsWith('The above exception')) st.py = false;
  if (/^goroutine \d+ \[/.test(line)) st.go = true;
}

export interface ParserOptions {
  refYear?: number;
}

/**
 * Parser tăng dần: đưa văn bản từng phần qua `feedText`, cuối cùng gọi `finish`.
 */
export class LogParser {
  entries: LogEntry[] = [];
  lineCount = 0;
  private buffer = '';
  private st: TraceState = { py: false, go: false };
  private refYear: number;
  private sawCR = false;

  constructor(opts: ParserOptions = {}) {
    this.refYear = opts.refYear ?? new Date().getUTCFullYear();
  }

  /** Thêm một khối văn bản (có thể kết thúc giữa dòng). */
  feedText(chunk: string): void {
    let text = this.buffer + chunk;
    this.buffer = '';
    let pos = 0;
    for (;;) {
      const nl = text.indexOf('\n', pos);
      if (nl === -1) break;
      this.pushLine(text.slice(pos, nl));
      pos = nl + 1;
    }
    this.buffer = text.slice(pos);
    if (this.buffer.length > MAX_LINE_LENGTH * 4) {
      // dòng quá dài không có xuống dòng: cắt bớt để không tốn bộ nhớ
      this.pushLine(this.buffer);
      this.buffer = '';
    }
    text = '';
  }

  finish(): LogEntry[] {
    if (this.buffer.length) {
      this.pushLine(this.buffer);
      this.buffer = '';
    }
    return this.entries;
  }

  pushLine(rawLine: string): void {
    this.lineCount++;
    let line = rawLine;
    if (line.charCodeAt(line.length - 1) === 13) {
      line = line.slice(0, -1);
      this.sawCR = true;
    }
    if (line.length === 0 || (line.length < 200 && line.trim() === '')) return;
    if (line.length > MAX_LINE_LENGTH) line = line.slice(0, MAX_LINE_LENGTH) + '…';
    const prev = this.entries.length ? this.entries[this.entries.length - 1] : null;
    if (prev && isContinuation(line, this.st)) {
      updateTraceState(line, this.st);
      if (prev.trace.length < MAX_TRACE_LINES) prev.trace.push(line);
      return;
    }
    const p = parseLine(line, this.refYear);
    this.st.py = false;
    this.st.go = false;
    updateTraceState(line, this.st);
    const trace = p.trace ? p.trace.slice(0, MAX_TRACE_LINES) : [];
    this.entries.push({
      id: this.entries.length,
      line: this.lineCount,
      ts: p.ts,
      tsText: p.tsText,
      level: p.level,
      message: p.message,
      format: p.format,
      fields: p.fields,
      raw: line,
      trace,
    });
  }
}

/** Phân tích toàn bộ văn bản (đồng bộ; dùng cho test / văn bản nhỏ). */
export function parseLogText(text: string, opts: ParserOptions = {}): LogEntry[] {
  const p = new LogParser(opts);
  p.feedText(text);
  return p.finish();
}

/** Nâng mức của entry có stack trace nhưng chưa rõ mức (ví dụ dòng plain text). */
export function entryFullText(e: LogEntry): string {
  return e.trace.length ? e.raw + '\n' + e.trace.join('\n') : e.raw;
}

/* ------------------------------------------------------------------ */
/* Gom nhóm tin nhắn tương tự                                          */
/* ------------------------------------------------------------------ */

const RE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RE_ISO_IN_MSG = /\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const RE_IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g;
const RE_HEX0X = /\b0x[0-9a-f]+\b/gi;
const RE_HEXLONG = /\b[0-9a-f]{16,}\b/gi;
const RE_TOKENLIKE = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g;
const RE_DIGITS = /\d+(?:\.\d+)?/g;

/** Chuẩn hoá thông điệp để gom nhóm: che số, UUID, IP, email, hex, token, thời gian. */
export function normalizeMessage(msg: string): string {
  const s = msg.length > 300 ? msg.slice(0, 300) : msg;
  return s
    .replace(RE_UUID, '<UUID>')
    .replace(RE_EMAIL, '<EMAIL>')
    .replace(RE_ISO_IN_MSG, '<TS>')
    .replace(RE_IPV4, '<IP>')
    .replace(RE_HEX0X, '<HEX>')
    .replace(RE_HEXLONG, '<HEX>')
    .replace(RE_TOKENLIKE, '<TOKEN>')
    .replace(RE_DIGITS, '<N>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePath(p: string): string {
  const q = p.indexOf('?');
  const path = q >= 0 ? p.slice(0, q) : p;
  return path
    .split('/')
    .map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f]{8,}$/i.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) ? ':id' : seg
    )
    .join('/');
}

/* ------------------------------------------------------------------ */
/* Che dữ liệu nhạy cảm                                                */
/* ------------------------------------------------------------------ */

export function maskSensitive(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '***JWT***')
    .replace(
      /(["']?(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|authorization|auth)["']?\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s,;&}"']+)/gi,
      (_m, k: string, v: string) => `${k}${v.startsWith('"') ? '"***"' : v.startsWith("'") ? "'***'" : '***'}`
    )
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')
    .replace(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, '$1.$2.*.*');
}

/* ------------------------------------------------------------------ */
/* Bộ lọc                                                              */
/* ------------------------------------------------------------------ */

export type CompileResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_REGEX_LENGTH = 300;
const REGEX_TEST_SLICE = 2000;

/** Biên dịch regex an toàn: giới hạn độ dài, từ chối mẫu lặp lồng nhau (nguy cơ catastrophic backtracking). */
export function safeCompileRegex(source: string, flags = 'i'): CompileResult<RegExp> {
  if (source.length > MAX_REGEX_LENGTH) {
    return { ok: false, error: `Regex quá dài (tối đa ${MAX_REGEX_LENGTH} ký tự).` };
  }
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,?\d*\})/.test(source) || /\(\?:?[^)]*\|[^)]*\)\s*[+*]\s*[+*]/.test(source)) {
    return {
      ok: false,
      error: 'Regex có nguy cơ backtracking nghiêm trọng (lặp lồng nhau như (a+)+). Hãy viết lại đơn giản hơn.',
    };
  }
  try {
    return { ok: true, value: new RegExp(source, flags) };
  } catch (e) {
    return { ok: false, error: 'Regex không hợp lệ: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

export type FieldOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | '~' | '!~';
export interface FieldCond {
  key: string;
  op: FieldOp;
  value: string;
}

const COND_RE = /\s*([A-Za-z_@][\w.@-]*)\s*(>=|<=|!=|!~|=|>|<|~)\s*(?![<>=!~])("(?:[^"\\]|\\.)*"|\S+)/y;

/** Cú pháp: `status>=500 logger=foo msg~timeout level>=warn` (AND). */
export function parseFieldQuery(q: string): CompileResult<FieldCond[]> {
  const conds: FieldCond[] = [];
  const s = q.trim();
  if (!s) return { ok: true, value: conds };
  if (s.length > 500) return { ok: false, error: 'Truy vấn trường quá dài.' };
  let pos = 0;
  while (pos < s.length) {
    // bỏ qua từ nối AND / &&
    const skip = /^\s*(?:AND\b|&&)\s*/i.exec(s.slice(pos));
    if (skip && skip[0].length) {
      pos += skip[0].length;
      continue;
    }
    COND_RE.lastIndex = pos;
    const m = COND_RE.exec(s);
    if (!m) {
      return {
        ok: false,
        error: `Không hiểu cú pháp tại "${s.slice(pos, pos + 20).trim()}". Dùng dạng: status>=500 logger=foo msg~timeout`,
      };
    }
    conds.push({ key: m[1], op: m[2] as FieldOp, value: unquote(m[3]) });
    pos = COND_RE.lastIndex;
    if (conds.length > 20) return { ok: false, error: 'Quá nhiều điều kiện (tối đa 20).' };
  }
  return { ok: true, value: conds };
}

function getFieldValue(e: LogEntry, key: string): string | undefined {
  const k = key.toLowerCase();
  if (k === 'level') return e.level;
  if (k === 'msg' || k === 'message') return e.message;
  if (k === 'format') return e.format;
  if (k === 'time' || k === 'ts' || k === 'timestamp') return e.ts !== null ? String(e.ts) : undefined;
  if (k === 'line') return String(e.line);
  const f = e.fields;
  if (k in f) return f[k];
  if (key in f) return f[key];
  for (const fk in f) if (fk.toLowerCase() === k) return f[fk];
  return undefined;
}

function globToRegex(g: string): RegExp {
  const esc = g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + esc + '$', 'i');
}

function condMatches(e: LogEntry, c: FieldCond): boolean {
  const key = c.key.toLowerCase();
  const neg = c.op === '!=' || c.op === '!~';
  const v = getFieldValue(e, c.key);
  if (v === undefined) return neg;
  if (key === 'level') {
    const want = normLevel(c.value);
    const a = LEVEL_RANK[e.level];
    const b = LEVEL_RANK[want];
    switch (c.op) {
      case '=': return e.level === want;
      case '!=': return e.level !== want;
      case '>': return a > b;
      case '>=': return a >= b;
      case '<': return a < b && a >= 0;
      case '<=': return a <= b && a >= 0;
      default: return false;
    }
  }
  if (key === 'time' || key === 'ts' || key === 'timestamp') {
    const t = parseTimestamp(c.value);
    if (t === null) return false;
    const x = Number(v);
    switch (c.op) {
      case '=': return x === t;
      case '!=': return x !== t;
      case '>': return x > t;
      case '>=': return x >= t;
      case '<': return x < t;
      case '<=': return x <= t;
      default: return false;
    }
  }
  const cls = /^([1-5])xx$/i.exec(c.value);
  if (cls && (c.op === '=' || c.op === '!=')) {
    const hit = v.length === 3 && v[0] === cls[1];
    return c.op === '=' ? hit : !hit;
  }
  switch (c.op) {
    case '=':
      return c.value.includes('*') ? globToRegex(c.value).test(v) : v === c.value || v.toLowerCase() === c.value.toLowerCase();
    case '!=':
      return c.value.includes('*') ? !globToRegex(c.value).test(v) : v.toLowerCase() !== c.value.toLowerCase();
    case '~':
      return v.toLowerCase().includes(c.value.toLowerCase());
    case '!~':
      return !v.toLowerCase().includes(c.value.toLowerCase());
    default: {
      const x = parseFloat(v);
      const y = parseFloat(c.value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const cmp = v.localeCompare(c.value);
        return c.op === '>' ? cmp > 0 : c.op === '>=' ? cmp >= 0 : c.op === '<' ? cmp < 0 : cmp <= 0;
      }
      return c.op === '>' ? x > y : c.op === '>=' ? x >= y : c.op === '<' ? x < y : x <= y;
    }
  }
}

export interface FilterSpec {
  levels: Set<Level>;
  text: string;
  regex: string;
  exclude: string;
  excludeIsRegex: boolean;
  from: number | null;
  to: number | null;
  fieldQuery: string;
  onlyTrace: boolean;
  cluster: string | null;
}

export const EMPTY_FILTER = (): FilterSpec => ({
  levels: new Set<Level>(LEVELS),
  text: '',
  regex: '',
  exclude: '',
  excludeIsRegex: false,
  from: null,
  to: null,
  fieldQuery: '',
  onlyTrace: false,
  cluster: null,
});

export interface CompiledFilter {
  test: (e: LogEntry) => boolean;
  usesRegex: boolean;
  /** Regex dùng để tô sáng (tìm kiếm văn bản hoặc regex) */
  highlight: RegExp | null;
}

function testRegex(re: RegExp, e: LogEntry): boolean {
  re.lastIndex = 0;
  const first = e.raw.length > REGEX_TEST_SLICE ? e.raw.slice(0, REGEX_TEST_SLICE) : e.raw;
  if (re.test(first)) return true;
  if (e.trace.length) {
    for (let i = 0; i < e.trace.length && i < 50; i++) {
      const t = e.trace[i];
      re.lastIndex = 0;
      if (re.test(t.length > REGEX_TEST_SLICE ? t.slice(0, REGEX_TEST_SLICE) : t)) return true;
    }
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileFilter(f: FilterSpec): CompileResult<CompiledFilter> {
  const tests: ((e: LogEntry) => boolean)[] = [];
  let usesRegex = false;
  let highlight: RegExp | null = null;

  if (f.levels.size < LEVELS.length) {
    const lv = f.levels;
    tests.push((e) => lv.has(e.level));
  }
  if (f.from !== null || f.to !== null) {
    const from = f.from;
    const to = f.to;
    tests.push((e) => e.ts !== null && (from === null || e.ts >= from) && (to === null || e.ts <= to));
  }
  if (f.onlyTrace) tests.push((e) => e.trace.length > 0);
  const text = f.text.trim();
  if (text) {
    const needle = text.toLowerCase();
    tests.push((e) => {
      if (e.raw.toLowerCase().includes(needle)) return true;
      for (let i = 0; i < e.trace.length; i++) if (e.trace[i].toLowerCase().includes(needle)) return true;
      return false;
    });
    highlight = new RegExp(escapeRegExp(text.slice(0, 200)), 'gi');
  }
  if (f.regex.trim()) {
    const r = safeCompileRegex(f.regex.trim(), 'i');
    if (!r.ok) return r;
    const re = r.value;
    usesRegex = true;
    tests.push((e) => testRegex(re, e));
    if (!highlight) {
      const h = safeCompileRegex(f.regex.trim(), 'gi');
      if (h.ok) highlight = h.value;
    }
  }
  if (f.exclude.trim()) {
    const ex = f.exclude.trim();
    if (f.excludeIsRegex) {
      const r = safeCompileRegex(ex, 'i');
      if (!r.ok) return { ok: false, error: 'Loại trừ: ' + r.error };
      usesRegex = true;
      const re = r.value;
      tests.push((e) => !testRegex(re, e));
    } else {
      const needle = ex.toLowerCase();
      tests.push((e) => !e.raw.toLowerCase().includes(needle));
    }
  }
  if (f.fieldQuery.trim()) {
    const q = parseFieldQuery(f.fieldQuery);
    if (!q.ok) return q;
    const conds = q.value;
    tests.push((e) => {
      for (let i = 0; i < conds.length; i++) if (!condMatches(e, conds[i])) return false;
      return true;
    });
  }
  if (f.cluster) {
    const key = f.cluster;
    tests.push((e) => normalizeMessage(e.message) === key);
  }
  const test =
    tests.length === 0
      ? () => true
      : tests.length === 1
        ? tests[0]
        : (e: LogEntry) => {
            for (let i = 0; i < tests.length; i++) if (!tests[i](e)) return false;
            return true;
          };
  return { ok: true, value: { test, usesRegex, highlight } };
}

/* ------------------------------------------------------------------ */
/* Thống kê                                                            */
/* ------------------------------------------------------------------ */

export interface Cluster {
  key: string;
  count: number;
  sample: string;
  level: Level;
}

export interface EndpointStat {
  key: string;
  count: number;
  avgMs: number;
  maxMs: number;
  errors: number;
}

export interface Bucket {
  start: number;
  end: number;
  count: number;
  errors: number;
}

export interface StatsResult {
  total: number;
  levelCounts: Record<Level, number>;
  clusters: Cluster[];
  clusterTotal: number;
  buckets: Bucket[];
  bucketMs: number;
  minTs: number | null;
  maxTs: number | null;
  noTs: number;
  access: null | {
    total: number;
    statusClasses: Record<string, number>;
    statuses: { key: string; count: number }[];
    slowest: EndpointStat[];
    topPaths: { key: string; count: number }[];
    topIps: { key: string; count: number }[];
  };
}

const NICE_BUCKETS = [
  1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000, 7200000,
  10800000, 21600000, 43200000, 86400000, 172800000, 604800000,
];

export function pickBucketMs(spanMs: number, target = 60): number {
  const ideal = spanMs / target;
  for (const b of NICE_BUCKETS) if (b >= ideal) return b;
  return NICE_BUCKETS[NICE_BUCKETS.length - 1];
}

const MAX_CLUSTER_KEYS = 20000;

export class StatsAccumulator {
  total = 0;
  private levelCounts: Record<Level, number> = { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0, unknown: 0 };
  private clusters = new Map<string, Cluster>();
  private clusterTotal = 0;
  private times: number[] = [];
  private errTimes: number[] = [];
  private noTs = 0;
  private accessTotal = 0;
  private statusClasses: Record<string, number> = {};
  private statuses = new Map<string, number>();
  private paths = new Map<string, number>();
  private ips = new Map<string, number>();
  private endpoints = new Map<string, { count: number; sum: number; max: number; timed: number; errors: number }>();

  add(e: LogEntry): void {
    this.total++;
    this.levelCounts[e.level]++;
    if (e.ts !== null) {
      this.times.push(e.ts);
      if (e.level === 'error' || e.level === 'fatal') this.errTimes.push(e.ts);
    } else this.noTs++;
    // Cụm thông điệp: bỏ qua entry mức thấp không có ý nghĩa lỗi? Giữ tất cả, UI sẽ sắp xếp theo số lượng.
    const key = normalizeMessage(e.message);
    if (key) {
      this.clusterTotal++;
      let c = this.clusters.get(key);
      if (!c) {
        if (this.clusters.size < MAX_CLUSTER_KEYS) {
          c = { key, count: 0, sample: e.message, level: e.level };
          this.clusters.set(key, c);
        }
      }
      if (c) {
        c.count++;
        if (LEVEL_RANK[e.level] > LEVEL_RANK[c.level]) c.level = e.level;
      }
    }
    if (e.format === 'access') {
      this.accessTotal++;
      const st = e.fields.status || '0';
      const cls = st[0] + 'xx';
      this.statusClasses[cls] = (this.statusClasses[cls] || 0) + 1;
      this.statuses.set(st, (this.statuses.get(st) || 0) + 1);
      const path = normalizePath(e.fields.path || e.fields.request || '?');
      this.paths.set(path, (this.paths.get(path) || 0) + 1);
      if (e.fields.ip) this.ips.set(e.fields.ip, (this.ips.get(e.fields.ip) || 0) + 1);
      const ep = `${e.fields.method || ''} ${path}`.trim();
      let s = this.endpoints.get(ep);
      if (!s) {
        s = { count: 0, sum: 0, max: 0, timed: 0, errors: 0 };
        this.endpoints.set(ep, s);
      }
      s.count++;
      if (st[0] === '5') s.errors++;
      if (e.fields.latency !== undefined) {
        const l = parseFloat(e.fields.latency);
        if (Number.isFinite(l)) {
          s.sum += l;
          s.timed++;
          if (l > s.max) s.max = l;
        }
      }
    }
  }

  result(topN = 15): StatsResult {
    const top = (m: Map<string, number>, n: number) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }));
    let minTs: number | null = null;
    let maxTs: number | null = null;
    for (const t of this.times) {
      if (minTs === null || t < minTs) minTs = t;
      if (maxTs === null || t > maxTs) maxTs = t;
    }
    let buckets: Bucket[] = [];
    let bucketMs = 0;
    if (minTs !== null && maxTs !== null) {
      bucketMs = pickBucketMs(maxTs - minTs);
      const start = Math.floor(minTs / bucketMs) * bucketMs;
      const n = Math.min(400, Math.floor((maxTs - start) / bucketMs) + 1);
      buckets = Array.from({ length: n }, (_, i) => ({
        start: start + i * bucketMs,
        end: start + (i + 1) * bucketMs,
        count: 0,
        errors: 0,
      }));
      for (const t of this.times) {
        const i = Math.min(n - 1, Math.floor((t - start) / bucketMs));
        buckets[i].count++;
      }
      for (const t of this.errTimes) {
        const i = Math.min(n - 1, Math.floor((t - start) / bucketMs));
        buckets[i].errors++;
      }
    }
    const clusters = [...this.clusters.values()].sort((a, b) => b.count - a.count).slice(0, topN);
    let access: StatsResult['access'] = null;
    if (this.accessTotal > 0) {
      const slowest = [...this.endpoints.entries()]
        .filter(([, s]) => s.timed > 0)
        .map(([key, s]) => ({ key, count: s.count, avgMs: s.sum / s.timed, maxMs: s.max, errors: s.errors }))
        .sort((a, b) => b.avgMs - a.avgMs)
        .slice(0, 10);
      access = {
        total: this.accessTotal,
        statusClasses: this.statusClasses,
        statuses: top(this.statuses, 10),
        slowest,
        topPaths: top(this.paths, 10),
        topIps: top(this.ips, 10),
      };
    }
    return {
      total: this.total,
      levelCounts: this.levelCounts,
      clusters,
      clusterTotal: this.clusterTotal,
      buckets,
      bucketMs,
      minTs,
      maxTs,
      noTs: this.noTs,
      access,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Xuất                                                                */
/* ------------------------------------------------------------------ */

export function exportLog(entries: LogEntry[], mask: boolean): string {
  const out: string[] = [];
  for (const e of entries) {
    out.push(entryFullText(e));
  }
  const s = out.join('\n') + (out.length ? '\n' : '');
  return mask ? maskSensitive(s) : s;
}

export function exportJson(entries: LogEntry[], mask: boolean): string {
  const m = (s: string) => (mask ? maskSensitive(s) : s);
  const arr = entries.map((e) => {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.fields)) fields[k] = m(v);
    return {
      line: e.line,
      time: e.ts !== null ? new Date(e.ts).toISOString() : null,
      level: e.level,
      format: e.format,
      message: m(e.message),
      fields,
      stack: e.trace.length ? m(e.trace.join('\n')) : undefined,
      raw: m(e.raw),
    };
  });
  return JSON.stringify(arr, null, 2);
}

function csvCell(s: string): string {
  let v = s;
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // chống CSV injection
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function exportCsv(entries: LogEntry[], mask: boolean): string {
  const m = (s: string) => (mask ? maskSensitive(s) : s);
  const rows = ['line,time,level,format,message,fields,stack'];
  for (const e of entries) {
    rows.push(
      [
        String(e.line),
        e.ts !== null ? new Date(e.ts).toISOString() : '',
        e.level,
        e.format,
        csvCell(m(e.message)),
        csvCell(Object.keys(e.fields).length ? m(JSON.stringify(e.fields)) : ''),
        csvCell(e.trace.length ? m(e.trace.join('\n')) : ''),
      ].join(',')
    );
  }
  return rows.join('\r\n') + '\r\n';
}
