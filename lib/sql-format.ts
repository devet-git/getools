/**
 * SQL Formatter: tokenizer + bộ định dạng tự viết (không dùng thư viện ngoài).
 * Thuần logic, không phụ thuộc React. Mọi hàm đều không ném lỗi ra ngoài.
 *
 * Nguyên tắc: bộ định dạng chỉ thêm/bớt khoảng trắng và đổi chữ hoa/thường của
 * từ khóa; không bao giờ đổi nội dung chuỗi, định danh, chú thích hay tham số.
 */

export type SqlDialect = 'standard' | 'mysql' | 'postgres' | 'tsql' | 'sqlite' | 'oracle';
export type SqlKeywordCase = 'upper' | 'lower' | 'keep';
export type SqlCommaStyle = 'trailing' | 'leading';

export interface SqlFormatOptions {
  dialect: SqlDialect;
  keywordCase: SqlKeywordCase;
  /** 2, 4 hoặc 'tab' */
  indent: 2 | 4 | 'tab';
  commaStyle: SqlCommaStyle;
  /** Độ rộng tối đa trước khi ngắt các danh sách trong ngoặc */
  maxWidth: number;
  /** Xuống dòng trước AND/OR trong WHERE/ON/HAVING */
  breakAndOr: boolean;
  /** Dòng trống giữa các câu lệnh */
  blankBetween: boolean;
  /** Nén thành 1 dòng */
  minify: boolean;
  /** Bỏ chú thích (giữ lại hint kiểu "/*+" và "/*!") */
  stripComments: boolean;
}

export const DEFAULT_SQL_OPTIONS: SqlFormatOptions = {
  dialect: 'standard',
  keywordCase: 'upper',
  indent: 2,
  commaStyle: 'trailing',
  maxWidth: 80,
  breakAndOr: true,
  blankBetween: true,
  minify: false,
  stripComments: false,
};

export const DIALECT_LABEL: Record<SqlDialect, string> = {
  standard: 'Chuẩn',
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  tsql: 'SQL Server',
  sqlite: 'SQLite',
  oracle: 'Oracle',
};

/* ------------------------------------------------------------------ */
/* Tokenizer                                                           */
/* ------------------------------------------------------------------ */

export type SqlTokenType =
  | 'ws'
  | 'lineComment'
  | 'blockComment'
  | 'string'
  | 'qident'
  | 'word'
  | 'number'
  | 'op'
  | 'punct'
  | 'param'
  | 'other';

export interface SqlToken {
  type: SqlTokenType;
  text: string;
  start: number;
  /** true nếu chuỗi / định danh / chú thích chưa được đóng */
  open?: boolean;
}

function isWs(c: string | undefined): boolean {
  if (c === undefined) return false;
  if (c === ' ' || c === '\n' || c === '\t' || c === '\r') return true;
  const k = c.charCodeAt(0);
  if (k < 128) return k === 12 || k === 11;
  return /\s/.test(c);
}
function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}
function isWordStart(c: string | undefined): boolean {
  if (c === undefined) return false;
  const k = c.charCodeAt(0);
  if ((k >= 65 && k <= 90) || (k >= 97 && k <= 122) || k === 95) return true;
  return k >= 128 && !isWs(c);
}
function isWordChar(c: string | undefined): boolean {
  return isWordStart(c) || isDigit(c) || c === '$';
}
function isHex(c: string | undefined): boolean {
  return c !== undefined && /[0-9a-fA-F]/.test(c);
}

const OPS: string[] = [
  '<=>', '->>', '#>>', '!~*', '||/', '<->', '<#>', '!~~',
  '->', '#>', '#-', '@>', '<@', '?|', '?&', '||', '&&', '::', ':=', '<=', '>=', '<>', '!=', '==',
  '>>', '<<', '~*', '!~', '~~', '**', '=>', '|/', '@@', '=~',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '#', ':', '@',
].sort((a, b) => b.length - a.length);

const OP_FIRST = new Set(OPS.map((o) => o[0]));

export function tokenize(src: string, dialect: SqlDialect = 'standard'): SqlToken[] {
  const out: SqlToken[] = [];
  const n = src.length;
  let i = 0;
  const lastBr = src.lastIndexOf(']');
  const nested = dialect === 'postgres';
  const bracketOk = dialect === 'tsql' || dialect === 'sqlite' || dialect === 'standard';
  const dollarOk = dialect === 'postgres' || dialect === 'standard';
  const push = (type: SqlTokenType, s: number, e: number, open?: boolean) => {
    const t: SqlToken = { type, text: src.slice(s, e), start: s };
    if (open) t.open = true;
    out.push(t);
  };
  const readQuoted = (from: number, q: string, bs: boolean): { end: number; open: boolean } => {
    let j = from + 1;
    while (j < n) {
      const ch = src[j];
      if (bs && ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === q) {
        if (src[j + 1] === q) {
          j += 2;
          continue;
        }
        return { end: j + 1, open: false };
      }
      j++;
    }
    return { end: n, open: true };
  };

  while (i < n) {
    const c = src[i];
    const s = i;

    if (isWs(c)) {
      i++;
      while (i < n && isWs(src[i])) i++;
      push('ws', s, i);
      continue;
    }

    // Chú thích dòng --
    if (c === '-' && src[i + 1] === '-') {
      const okMy = dialect !== 'mysql' || i + 2 >= n || isWs(src[i + 2]) || src.charCodeAt(i + 2) < 32;
      if (okMy) {
        let e = i;
        while (e < n && src[e] !== '\n' && src[e] !== '\r') e++;
        while (e > i && isWs(src[e - 1])) e--;
        push('lineComment', s, e);
        i = e;
        continue;
      }
    }
    // Chú thích dòng #
    if (c === '#') {
      const isPgOp = src.startsWith('#>', i) || src.startsWith('#-', i);
      if (dialect === 'mysql' || (dialect === 'standard' && !isPgOp)) {
        let e = i;
        while (e < n && src[e] !== '\n' && src[e] !== '\r') e++;
        while (e > i && isWs(src[e - 1])) e--;
        push('lineComment', s, e);
        i = e;
        continue;
      }
      if (dialect === 'tsql') {
        let j = i;
        while (src[j] === '#') j++;
        if (isWordChar(src[j])) {
          while (j < n && isWordChar(src[j])) j++;
          push('word', s, j);
          i = j;
          continue;
        }
      }
    }
    // Chú thích khối
    if (c === '/' && src[i + 1] === '*') {
      let d = 1;
      let j = i + 2;
      while (j < n && d > 0) {
        if (src[j] === '*' && src[j + 1] === '/') {
          d--;
          j += 2;
        } else if (nested && src[j] === '/' && src[j + 1] === '*') {
          d++;
          j += 2;
        } else j++;
      }
      push('blockComment', s, j, d > 0);
      i = j;
      continue;
    }

    // Chuỗi '...'
    if (c === "'") {
      const r = readQuoted(i, "'", dialect === 'mysql');
      push('string', s, r.end, r.open);
      i = r.end;
      continue;
    }
    // "..." : định danh (MySQL: chuỗi)
    if (c === '"') {
      const r = readQuoted(i, '"', dialect === 'mysql');
      push(dialect === 'mysql' ? 'string' : 'qident', s, r.end, r.open);
      i = r.end;
      continue;
    }
    if (c === '`') {
      const r = readQuoted(i, '`', false);
      push('qident', s, r.end, r.open);
      i = r.end;
      continue;
    }
    // [định danh] (T-SQL...)
    if (c === '[' && bracketOk && i < lastBr) {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (src[j] === ']') {
          if (src[j + 1] === ']') {
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        j++;
      }
      const content = src.slice(i + 1, closed ? j - 1 : j);
      const numeric = /^\d+$/.test(content);
      if (closed && !(numeric && dialect !== 'tsql')) {
        push('qident', s, j);
        i = j;
        continue;
      }
    }

    // $ : tham số $1, chuỗi dollar-quoted
    if (c === '$') {
      if (isDigit(src[i + 1])) {
        let j = i + 1;
        while (isDigit(src[j])) j++;
        push('param', s, j);
        i = j;
        continue;
      }
      if (dollarOk) {
        let j = i + 1;
        if (isWordStart(src[j])) while (j < n && isWordChar(src[j]) && src[j] !== '$') j++;
        if (src[j] === '$') {
          const tag = src.slice(i, j + 1);
          const idx = src.indexOf(tag, j + 1);
          if (idx >= 0) {
            push('string', s, idx + tag.length);
            i = idx + tag.length;
            continue;
          }
        }
      }
      push('other', s, s + 1);
      i++;
      continue;
    }

    // Số
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]) && !(i > 0 && /[\w"\]\)`$]/.test(src[i - 1])))) {
      let j = i;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X') && isHex(src[i + 2])) {
        j = i + 2;
        while (isHex(src[j])) j++;
      } else {
        while (isDigit(src[j])) j++;
        if (src[j] === '.' && (isDigit(src[j + 1]) || !isWordStart(src[j + 1]))) {
          j++;
          while (isDigit(src[j])) j++;
        }
        if ((src[j] === 'e' || src[j] === 'E') && (isDigit(src[j + 1]) || ((src[j + 1] === '+' || src[j + 1] === '-') && isDigit(src[j + 2])))) {
          j += 2;
          while (isDigit(src[j])) j++;
        }
      }
      push('number', s, j);
      i = j;
      continue;
    }

    // Từ
    if (isWordStart(c)) {
      let j = i + 1;
      while (j < n && isWordChar(src[j])) j++;
      const w = src.slice(i, j);
      if (src[j] === "'") {
        if (/^[eExXbBnN]$/.test(w)) {
          const r = readQuoted(j, "'", /^[eE]$/.test(w) || dialect === 'mysql');
          push('string', s, r.end, r.open);
          i = r.end;
          continue;
        }
        if (dialect === 'oracle' && /^[qQ]$/.test(w) && src[j + 1] !== undefined && !isWs(src[j + 1])) {
          const open = src[j + 1];
          const close = ({ '[': ']', '{': '}', '(': ')', '<': '>' } as Record<string, string>)[open] ?? open;
          const idx = src.indexOf(close + "'", j + 2);
          if (idx >= 0) {
            push('string', s, idx + 2);
            i = idx + 2;
            continue;
          }
        }
      }
      if ((w === 'U' || w === 'u') && src[j] === '&' && (src[j + 1] === "'" || src[j + 1] === '"')) {
        const q = src[j + 1];
        const r = readQuoted(j + 1, q, false);
        push(q === "'" ? 'string' : 'qident', s, r.end, r.open);
        i = r.end;
        continue;
      }
      push('word', s, j);
      i = j;
      continue;
    }

    // Tham số
    if (c === '?') {
      if (dialect === 'postgres' && (src[i + 1] === '|' || src[i + 1] === '&')) {
        push('op', s, s + 2);
        i += 2;
        continue;
      }
      let j = i + 1;
      while (isDigit(src[j])) j++;
      push('param', s, j);
      i = j;
      continue;
    }
    if (c === ':' && src[i + 1] !== ':' && src[i + 1] !== '=' && src[i - 1] !== ':' && (isWordStart(src[i + 1]) || (dialect === 'oracle' && isDigit(src[i + 1])))) {
      let j = i + 1;
      while (j < n && isWordChar(src[j])) j++;
      push('param', s, j);
      i = j;
      continue;
    }
    if (c === '@' && src[i + 1] !== '>') {
      let j = i + 1;
      if (src[j] === '@') j++;
      if (isWordStart(src[j])) {
        while (j < n && isWordChar(src[j])) j++;
        push('param', s, j);
        i = j;
        continue;
      }
    }
    if (c === '%') {
      if ((src[i + 1] === 's' || src[i + 1] === 'd') && !isWordChar(src[i + 2])) {
        push('param', s, i + 2);
        i += 2;
        continue;
      }
      if (src[i + 1] === '(') {
        const m = /^%\(\w+\)[sdif]/.exec(src.slice(i, i + 80));
        if (m) {
          push('param', s, i + m[0].length);
          i += m[0].length;
          continue;
        }
      }
    }

    // Toán tử
    if (OP_FIRST.has(c)) {
      let matched = '';
      for (const op of OPS) {
        if (op[0] === c && src.startsWith(op, i)) {
          matched = op;
          break;
        }
      }
      if (matched) {
        push('op', s, s + matched.length);
        i += matched.length;
        continue;
      }
    }
    if (c === '(' || c === ')' || c === ',' || c === ';' || c === '.' || c === '[' || c === ']') {
      push('punct', s, s + 1);
      i++;
      continue;
    }
    push('other', s, s + 1);
    i++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Trích xuất tham số                                                  */
/* ------------------------------------------------------------------ */

export interface SqlParam {
  text: string;
  kind: 'positional' | 'named';
  name: string;
  count: number;
  lines: number[];
}

export function extractParams(src: string, dialect: SqlDialect = 'standard'): SqlParam[] {
  const toks = tokenize(src, dialect);
  const map = new Map<string, SqlParam>();
  const list: SqlParam[] = [];
  let line = 1;
  let pos = 0;
  let qIndex = 0;
  for (const t of toks) {
    if (t.type === 'param') {
      for (; pos < t.start; pos++) if (src[pos] === '\n') line++;
      let key = t.text;
      const positional = t.text === '?' || t.text === '%s' || t.text === '%d' || /^\$\d+$/.test(t.text) || /^\?\d+$/.test(t.text);
      if (t.text === '?') key = `?#${++qIndex}`;
      let p = map.get(key);
      if (!p) {
        const name = t.text.replace(/^[:@$?%(]+/, '').replace(/\)[sdif]$/, '');
        p = { text: t.text, kind: positional ? 'positional' : 'named', name, count: 0, lines: [] };
        map.set(key, p);
        list.push(p);
      }
      p.count++;
      if (p.lines.length < 20 && !p.lines.includes(line)) p.lines.push(line);
    }
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* Từ khóa                                                             */
/* ------------------------------------------------------------------ */

const w = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const KEYWORDS = w(`
SELECT FROM WHERE AND OR NOT IN IS NULL LIKE ILIKE BETWEEN EXISTS ANY SOME ALL DISTINCT AS ON USING
JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL LATERAL GROUP BY ORDER HAVING LIMIT OFFSET FETCH ROWS ONLY
UNION INTERSECT EXCEPT MINUS WITH RECURSIVE INSERT INTO VALUES UPDATE SET DELETE CREATE ALTER DROP
TABLE VIEW INDEX UNIQUE PRIMARY KEY FOREIGN REFERENCES CONSTRAINT CHECK DEFAULT IF CASE WHEN THEN ELSE END
CAST ASC DESC NULLS OVER PARTITION RANGE GROUPS UNBOUNDED PRECEDING FOLLOWING CURRENT TRUE FALSE RETURNING
CONFLICT DO NOTHING TRUNCATE BEGIN COMMIT ROLLBACK TRANSACTION GRANT REVOKE EXPLAIN ANALYZE TEMP TEMPORARY
COLUMN ADD MODIFY RENAME TO CASCADE RESTRICT MATERIALIZED FOR SHARE WINDOW FILTER WITHIN INTERVAL COLLATE
ESCAPE TOP PERCENT TIES MERGE MATCHED DUPLICATE QUALIFY SIMILAR AUTO_INCREMENT ROW ARRAY FUNCTION RETURNS LANGUAGE ZONE
INT INTEGER BIGINT SMALLINT TINYINT VARCHAR NVARCHAR CHAR NCHAR BOOLEAN BOOL DECIMAL NUMERIC FLOAT DOUBLE REAL
SERIAL BIGSERIAL UUID JSON JSONB BLOB CLOB DATETIME TIMESTAMP
`);

const DIALECT_KEYWORDS: Record<SqlDialect, Set<string>> = {
  standard: new Set(),
  mysql: w('UNSIGNED ENGINE IGNORE STRAIGHT_JOIN CHARSET SIGNED ZEROFILL MEDIUMINT LONGTEXT MEDIUMTEXT TINYTEXT ENUM'),
  postgres: w('SERIAL BIGSERIAL BYTEA RETURNING ONLY LATERAL TABLESAMPLE'),
  tsql: w('NOLOCK IDENTITY OUTPUT APPLY GO NVARCHAR NCHAR UNIQUEIDENTIFIER BIT MONEY PROC PROCEDURE EXEC EXECUTE'),
  sqlite: w('AUTOINCREMENT PRAGMA WITHOUT ROWID VACUUM'),
  oracle: w('DUAL ROWNUM VARCHAR2 NVARCHAR2 NUMBER SYSDATE CONNECT START PRIOR DECODE MINUS'),
};

const FUNCTIONS = w(`
COUNT SUM AVG MIN MAX COALESCE NULLIF IFNULL ISNULL NVL NVL2 CONCAT CONCAT_WS SUBSTRING SUBSTR LENGTH LEN LOWER
UPPER TRIM LTRIM RTRIM REPLACE ROUND FLOOR CEIL CEILING ABS MOD POWER SQRT NOW DATE_TRUNC DATE_PART EXTRACT
TO_CHAR TO_DATE TO_TIMESTAMP TO_NUMBER DATE DATEADD DATEDIFF DATE_ADD DATE_SUB GETDATE STRING_AGG ARRAY_AGG
GROUP_CONCAT JSON_EXTRACT JSON_AGG JSONB_AGG JSON_BUILD_OBJECT JSONB_BUILD_OBJECT ROW_NUMBER RANK DENSE_RANK NTILE
LAG LEAD FIRST_VALUE LAST_VALUE NTH_VALUE CUME_DIST PERCENT_RANK GREATEST LEAST CONVERT TRY_CAST DECODE
POSITION CHARINDEX UNNEST GENERATE_SERIES ARRAY ROW TIMESTAMP_ISO CURRENT_DATE CURRENT_TIMESTAMP
`);

/** Từ khóa cần dấu cách trước "(" (khác với tên hàm: COUNT(...)) */
const SPACE_BEFORE_PAREN = w(`
IN FROM JOIN AS ON USING EXISTS ANY SOME ALL AND OR NOT WHERE HAVING SELECT WHEN THEN ELSE VALUES OVER UNION
INTERSECT EXCEPT MINUS WITH SET BY CONFLICT KEY UNIQUE CHECK PRIMARY REFERENCES BETWEEN LIKE ILIKE IS WINDOW
RETURNING DISTINCT LATERAL RECURSIVE FILTER GROUP DEFAULT IF WHILE RETURN TOP INTO TABLE CASE END ESCAPE
DO UPDATE DELETE INSERT PARTITION ORDER LIMIT OFFSET FETCH MATERIALIZED QUALIFY APPLY
`);

/** Sau các từ này, tên + "(" cũng có dấu cách: INSERT INTO t (a), CREATE TABLE t (...) */
const PAREN_INTRODUCERS = w('INTO TABLE VIEW REFERENCES EXISTS WITH RECURSIVE');

const UNARY_CTX = w(`
SELECT WHERE AND OR NOT THEN ELSE WHEN BY ON IN BETWEEN LIKE ILIKE IS HAVING LIMIT OFFSET DISTINCT ALL CASE
VALUES SET RETURN RETURNING QUALIFY ANY SOME
`);

/* ------------------------------------------------------------------ */
/* Cấu trúc nội bộ                                                     */
/* ------------------------------------------------------------------ */

interface Tok {
  type: SqlTokenType;
  text: string;
  out: string;
  up: string;
  lead: Tok[];
  trail: Tok[];
}

interface Grp {
  kind: 'paren' | 'case';
  open: Tok;
  close: Tok | null;
  kids: Node[];
  size: number;
  noFlat: boolean;
  sub: boolean;
}

type Node = Tok | Grp;

const isGrp = (n: Node | undefined): n is Grp => n !== undefined && 'kids' in n;
const isTok = (n: Node | undefined): n is Tok => n !== undefined && !('kids' in n);
const isHint = (t: string) => t.startsWith('/*+') || t.startsWith('/*!');

function mkTok(type: SqlTokenType, text: string): Tok {
  return {
    type,
    text,
    out: text,
    up: type === 'word' ? text.toUpperCase() : '',
    lead: [],
    trail: [],
  };
}

interface Prepared {
  sig: Tok[];
  tail: Tok[];
}

function prepare(raw: SqlToken[], o: SqlFormatOptions): Prepared {
  const sig: Tok[] = [];
  let pendingLead: Tok[] = [];
  let nl = false;
  let prev: Tok | null = null;
  for (const t of raw) {
    if (t.type === 'ws') {
      if (/[\r\n]/.test(t.text)) nl = true;
      continue;
    }
    if (t.type === 'lineComment' || t.type === 'blockComment') {
      if (o.stripComments && !isHint(t.text)) continue;
      const c = mkTok(t.type, t.text);
      if (nl || pendingLead.length > 0 || !prev) pendingLead.push(c);
      else prev.trail.push(c);
      nl = false;
      continue;
    }
    const tok = mkTok(t.type, t.text);
    tok.lead = pendingLead;
    pendingLead = [];
    sig.push(tok);
    prev = tok;
    nl = false;
  }

  // Từ khóa: đổi chữ hoa/thường
  const extra = DIALECT_KEYWORDS[o.dialect];
  if (o.keywordCase !== 'keep') {
    for (let k = 0; k < sig.length; k++) {
      const t = sig[k];
      if (t.type !== 'word') continue;
      const p = sig[k - 1];
      const nx = sig[k + 1];
      if (p && p.type === 'punct' && p.text === '.') continue;
      if (nx && nx.type === 'punct' && nx.text === '.') continue;
      const isKw = KEYWORDS.has(t.up) || extra.has(t.up);
      const isFn = FUNCTIONS.has(t.up) && nx !== undefined && nx.type === 'punct' && nx.text === '(';
      if (isKw || isFn) t.out = o.keywordCase === 'upper' ? t.up : t.text.toLowerCase();
    }
  }

  // Dấu phẩy / chấm phẩy không được đứng sau chú thích dòng
  for (let k = 1; k < sig.length; k++) {
    const t = sig[k];
    if (t.type !== 'punct') continue;
    const moves = t.text === ';' || (t.text === ',' && !o.minify && o.commaStyle === 'trailing');
    if (!moves) continue;
    const p = sig[k - 1];
    if (p.trail.some((c) => c.type === 'lineComment')) {
      t.trail = p.trail.concat(t.trail);
      p.trail = [];
    }
  }
  return { sig, tail: pendingLead };
}

/* ------------------------------------------------------------------ */
/* Dựng cây ngoặc                                                      */
/* ------------------------------------------------------------------ */

const MAX_DEPTH = 100;

function tokWeight(t: Tok): number {
  let s = t.out.length + 1;
  for (const c of t.lead) s += c.text.length + 1;
  for (const c of t.trail) s += c.text.length + 1;
  return s;
}
function tokNoFlat(t: Tok): boolean {
  for (const c of t.lead) if (c.type === 'lineComment' || c.text.includes('\n')) return true;
  for (const c of t.trail) if (c.type === 'lineComment' || c.text.includes('\n')) return true;
  return false;
}
const nodeSize = (n: Node) => (isGrp(n) ? n.size : tokWeight(n));
const nodeNoFlat = (n: Node) => (isGrp(n) ? n.noFlat : tokNoFlat(n));

function startsSub(kids: Node[]): boolean {
  let k: Node | undefined = kids[0];
  let guard = 0;
  while (isGrp(k) && k.kind === 'paren' && guard++ < MAX_DEPTH + 2) k = k.kids[0];
  return isTok(k) && k.type === 'word' && (k.up === 'SELECT' || k.up === 'WITH' || k.up === 'VALUES');
}

interface ParseResult {
  root: Node[];
  unclosedParens: number;
  strayClose: number;
  unclosedCase: number;
}

function parse(sig: Tok[]): ParseResult {
  const root: Node[] = [];
  const stack: Grp[] = [];
  let overflow = 0;
  let strayClose = 0;
  let unclosedCase = 0;

  const add = (n: Node) => (stack.length ? stack[stack.length - 1].kids : root).push(n);
  const finish = (g: Grp) => {
    let size = tokWeight(g.open) + (g.close ? tokWeight(g.close) : 0);
    let noFlat = tokNoFlat(g.open) || (g.close ? tokNoFlat(g.close) : false);
    for (const k of g.kids) {
      size += nodeSize(k);
      if (nodeNoFlat(k)) noFlat = true;
    }
    g.size = size;
    g.noFlat = noFlat;
    g.sub = g.kind === 'paren' && startsSub(g.kids);
  };
  const pop = (close: Tok | null) => {
    const g = stack.pop()!;
    g.close = close;
    if (!close && g.kind === 'case') unclosedCase++;
    finish(g);
  };

  for (const t of sig) {
    if (t.type === 'punct' && t.text === '(') {
      if (stack.length >= MAX_DEPTH) {
        overflow++;
        add(t);
        continue;
      }
      const g: Grp = { kind: 'paren', open: t, close: null, kids: [], size: 0, noFlat: false, sub: false };
      add(g);
      stack.push(g);
    } else if (t.type === 'punct' && t.text === ')') {
      if (overflow > 0) {
        overflow--;
        add(t);
        continue;
      }
      let idx = -1;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].kind === 'paren') {
          idx = k;
          break;
        }
      }
      if (idx < 0) {
        strayClose++;
        add(t);
        continue;
      }
      while (stack.length - 1 > idx) pop(null);
      pop(t);
    } else if (t.type === 'word' && t.up === 'CASE') {
      if (stack.length >= MAX_DEPTH) {
        add(t);
        continue;
      }
      const g: Grp = { kind: 'case', open: t, close: null, kids: [], size: 0, noFlat: false, sub: false };
      add(g);
      stack.push(g);
    } else if (t.type === 'word' && t.up === 'END' && stack.length && stack[stack.length - 1].kind === 'case') {
      pop(t);
    } else {
      add(t);
    }
  }
  let unclosedParens = 0;
  while (stack.length) {
    if (stack[stack.length - 1].kind === 'paren') unclosedParens++;
    pop(null);
  }
  return { root, unclosedParens, strayClose, unclosedCase };
}

/* ------------------------------------------------------------------ */
/* Quy tắc khoảng trắng giữa hai token liền kề                         */
/* ------------------------------------------------------------------ */

const isComment = (t: Tok) => t.type === 'lineComment' || t.type === 'blockComment';
const isP = (t: Tok, s: string) => t.type === 'punct' && t.text === s;
const isIdentLike = (t: Tok) => t.type === 'word' || t.type === 'qident';

function sigBefore(h: Tok[], idx: number): Tok | undefined {
  for (let k = idx; k >= 0; k--) if (!isComment(h[k])) return h[k];
  return undefined;
}

function isUnaryAt(h: Tok[], idx: number): boolean {
  const a = h[idx];
  if (a.type !== 'op' || (a.text !== '-' && a.text !== '+' && a.text !== '~')) return false;
  const p = sigBefore(h, idx - 1);
  if (!p) return true;
  if (p.type === 'op') return true;
  if (p.type === 'punct') return p.text === '(' || p.text === ',' || p.text === '[';
  if (p.type === 'word') return UNARY_CTX.has(p.up);
  return false;
}

/** h: các token đã ghi (kể cả chú thích), b: token sắp ghi */
function needSpace(h: Tok[], b: Tok): boolean {
  const idx = h.length - 1;
  if (idx < 0) return false;
  const a = h[idx];
  if (isComment(b)) return true;
  if (isComment(a)) return !(b.type === 'punct' && (b.text === ',' || b.text === ';' || b.text === ')'));
  if (b.type === 'punct') {
    if (b.text === ',' || b.text === ';' || b.text === ')' || b.text === ']') return false;
    if (b.text === '.') return !(isIdentLike(a) || isP(a, ')') || isP(a, ']'));
    if (b.text === '(') {
      if (isP(a, '(') || isP(a, '[') || isP(a, '.')) return false;
      if (a.type === 'word') {
        if (a.up === 'VALUES') {
          const pv = sigBefore(h, idx - 1);
          return !(pv && pv.type === 'op');
        }
        if (SPACE_BEFORE_PAREN.has(a.up)) return true;
      } else if (a.type !== 'qident') {
        return !(a.type === 'op' && isUnaryAt(h, idx));
      }
      // tên hàm / bảng: INSERT INTO t (a, b) có dấu cách, hàm thì không
      let j = idx;
      while (j >= 2 && isP(h[j - 1], '.') && isIdentLike(h[j - 2])) j -= 2;
      const pw = sigBefore(h, j - 1);
      return !!pw && pw.type === 'word' && PAREN_INTRODUCERS.has(pw.up) && !SPACE_BEFORE_PAREN.has(a.up);
    }
    if (b.text === '[') {
      if (isP(a, '(') || isP(a, '[') || isP(a, '.')) return false;
      if (a.type === 'word') return SPACE_BEFORE_PAREN.has(a.up);
      return !(a.type === 'qident' || isP(a, ']') || isP(a, ')'));
    }
  }
  if (a.type === 'punct') {
    if (a.text === '(' || a.text === '[') return false;
    if (a.text === '.') return !(isIdentLike(b) || (b.type === 'op' && b.text === '*'));
  }
  const around = (x: Tok) => isIdentLike(x) || x.type === 'number' || x.type === 'string' || x.type === 'param' || isP(x, ')') || isP(x, ']') || isP(x, '(');
  if (b.type === 'op' && b.text === '::') return !around(a);
  if (a.type === 'op' && a.text === '::') return !around(b) || (b.type === 'param' && b.text[0] === ':');
  if (a.type === 'op' && isUnaryAt(h, idx)) return b.type === 'op';
  return true;
}

/* ------------------------------------------------------------------ */
/* Writer: gom dòng, thụt lề, ngắt dòng "lười"                          */
/* ------------------------------------------------------------------ */

interface Line {
  lvl: number;
  text: string;
  closed: boolean;
}

class Writer {
  lines: Line[] = [];
  pending: number | null = null;
  hist: Tok[] = [];
  constructor(public iw: number, public maxW: number) {}

  get cur(): Line | undefined {
    return this.lines[this.lines.length - 1];
  }
  nextLvl(): number {
    if (this.pending !== null) return this.pending;
    const c = this.cur;
    if (!c) return 0;
    return c.closed ? c.lvl + 1 : c.lvl;
  }
  breakNext(l: number) {
    this.pending = l;
  }
  private note(t: Tok) {
    this.hist.push(t);
    if (this.hist.length > 12) this.hist.shift();
  }
  private fresh(lvl: number) {
    this.lines.push({ lvl, text: '', closed: false });
  }
  atom(t: Tok) {
    let space = false;
    if (this.pending !== null) {
      this.fresh(this.pending);
      this.pending = null;
    } else if (!this.cur) {
      this.fresh(0);
    } else if (this.cur.closed) {
      this.fresh(this.cur.lvl + 1);
    } else if (this.cur.text !== '') {
      space = needSpace(this.hist, t);
    }
    const c = this.cur!;
    c.text += (space ? ' ' : '') + t.out;
    if (t.type === 'lineComment') c.closed = true;
    this.note(t);
  }
  /** Chú thích đứng cuối dòng của token trước đó */
  trail(t: Tok) {
    const c = this.cur;
    if (!c) {
      this.atom(t);
      return;
    }
    c.text += ' ' + t.text;
    if (t.type === 'lineComment') c.closed = true;
    this.note(t);
  }
  /** Chú thích đứng riêng một dòng trước token kế tiếp */
  lead(t: Tok) {
    const l = this.nextLvl();
    const c = this.cur;
    if (this.pending !== null || !c || c.text !== '' || c.closed) {
      this.fresh(l);
      this.pending = null;
    }
    const cc = this.cur!;
    cc.text = t.text;
    cc.closed = t.type === 'lineComment';
    this.note(t);
    this.pending = cc.lvl;
  }
  emit(t: Tok) {
    for (const c of t.lead) this.lead(c);
    this.atom(t);
    for (const c of t.trail) this.trail(c);
  }
  /** Chiều rộng cột hiện tại nếu ghi tiếp (chưa tính token) */
  col(): number {
    if (this.pending !== null) return this.pending * this.iw;
    const c = this.cur;
    if (!c) return 0;
    if (c.closed) return (c.lvl + 1) * this.iw;
    return c.lvl * this.iw + c.text.length;
  }
  toString(indent: string): string {
    return this.lines.map((l) => indent.repeat(l.lvl) + l.text).join('\n');
  }
}

/* ------------------------------------------------------------------ */
/* Phẳng hóa node thành danh sách nguyên tử                            */
/* ------------------------------------------------------------------ */

function flatAtoms(nodes: Node[], outArr: Tok[] = []): Tok[] {
  for (const n of nodes) {
    if (isGrp(n)) {
      pushTok(n.open, outArr);
      flatAtoms(n.kids, outArr);
      if (n.close) pushTok(n.close, outArr);
    } else pushTok(n, outArr);
  }
  return outArr;
}
function pushTok(t: Tok, arr: Tok[]) {
  for (const c of t.lead) arr.push(c);
  arr.push(t);
  for (const c of t.trail) arr.push(c);
}

/* ------------------------------------------------------------------ */
/* Bố cục                                                              */
/* ------------------------------------------------------------------ */

interface Ctx {
  w: Writer;
  o: SqlFormatOptions;
}

function fitsNodes(nodes: Node[], c: Ctx, extra = 1): boolean {
  const w = c.w;
  let size = 0;
  for (const n of nodes) {
    if (nodeNoFlat(n)) return false;
    size += nodeSize(n);
    if (size > w.maxW + 2 * nodes.length) return false;
  }
  const atoms = flatAtoms(nodes);
  const h = w.hist.slice();
  let len = 0;
  const first = w.pending === null && w.cur && w.cur.text !== '' && !w.cur.closed;
  for (let k = 0; k < atoms.length; k++) {
    const a = atoms[k];
    if (k > 0 || first) {
      if (needSpace(h, a)) len++;
    }
    len += a.out.length;
    h.push(a);
  }
  return w.col() + len + extra <= w.maxW;
}

function emitFlat(nodes: Node[], c: Ctx) {
  for (const a of flatAtoms(nodes)) c.w.atom(a);
}

const up = (n: Node | undefined): string => (n !== undefined && isTok(n) && n.type === 'word' ? n.up : '');
const isComma = (n: Node | undefined): n is Tok => n !== undefined && isTok(n) && n.type === 'punct' && n.text === ',';

function renderInline(nodes: Node[], c: Ctx) {
  for (const n of nodes) emitNode(n, c, false);
}

function emitNode(n: Node, c: Ctx, caseForce: boolean) {
  if (!isGrp(n)) {
    c.w.emit(n);
    return;
  }
  if (n.kind === 'case') layoutCase(n, c, caseForce);
  else if (n.sub) layoutSub(n, c);
  else renderParen(n, c, false);
}

function renderParen(g: Grp, c: Ctx, force: boolean) {
  if (!force && fitsNodes([g], c)) emitFlat([g], c);
  else expandParen(g, c);
}

const WINDOW_WORDS = new Set(['PARTITION', 'ORDER', 'ROWS', 'RANGE', 'GROUPS']);

interface Split {
  parts: Node[][];
  commas: Tok[];
  byComma: boolean;
}

function splitElements(kids: Node[], o: SqlFormatOptions): Split {
  const first = kids.find((k) => true);
  const startsWindow = first !== undefined && WINDOW_WORDS.has(up(first));
  if (startsWindow) {
    const parts: Node[][] = [[]];
    kids.forEach((k, i) => {
      const u = up(k);
      const isB = (u === 'PARTITION' || u === 'ORDER' ? up(kids[i + 1]) === 'BY' : WINDOW_WORDS.has(u)) && parts[parts.length - 1].length > 0;
      if (isB) parts.push([]);
      parts[parts.length - 1].push(k);
    });
    return { parts, commas: [], byComma: false };
  }
  if (kids.some(isComma)) {
    const parts: Node[][] = [[]];
    const commas: Tok[] = [];
    for (const k of kids) {
      if (isComma(k)) {
        commas.push(k);
        parts.push([]);
      } else parts[parts.length - 1].push(k);
    }
    return { parts, commas, byComma: true };
  }
  if (o.breakAndOr && kids.some((k) => up(k) === 'AND' || up(k) === 'OR')) {
    const parts: Node[][] = [[]];
    let between = 0;
    for (const k of kids) {
      const u = up(k);
      if (u === 'BETWEEN') between++;
      const isB = (u === 'OR' || u === 'AND') && !(u === 'AND' && between > 0) && parts[parts.length - 1].length > 0;
      if (u === 'AND' && between > 0) between--;
      if (isB) parts.push([]);
      parts[parts.length - 1].push(k);
    }
    return { parts, commas: [], byComma: false };
  }
  return { parts: [kids], commas: [], byComma: false };
}

function emitElement(part: Node[], c: Ctx) {
  if (part.length === 0) return;
  if (fitsNodes(part, c, 1)) emitFlat(part, c);
  else renderInline(part, c);
}

function expandParen(g: Grp, c: Ctx) {
  const w = c.w;
  const openLvl = w.nextLvl();
  w.emit(g.open);
  const sp = splitElements(g.kids, c.o);
  const leading = c.o.commaStyle === 'leading';
  sp.parts.forEach((part, idx) => {
    w.breakNext(openLvl + 1);
    if (sp.byComma && leading && idx > 0) w.emit(sp.commas[idx - 1]);
    emitElement(part, c);
    if (sp.byComma && !leading && idx < sp.parts.length - 1) w.emit(sp.commas[idx]);
  });
  w.breakNext(openLvl);
  if (g.close) w.emit(g.close);
}

function layoutSub(g: Grp, c: Ctx) {
  const w = c.w;
  const openLvl = w.nextLvl();
  w.emit(g.open);
  w.breakNext(openLvl + 1);
  layoutSeq(g.kids, c, openLvl + 1);
  w.breakNext(openLvl);
  if (g.close) w.emit(g.close);
}

function layoutCase(g: Grp, c: Ctx, force: boolean) {
  if (!force && fitsNodes([g], c)) {
    emitFlat([g], c);
    return;
  }
  const w = c.w;
  const openLvl = w.nextLvl();
  w.emit(g.open);
  const segs: Node[][] = [[]];
  let seenBranch = false;
  for (const k of g.kids) {
    const u = up(k);
    if (u === 'WHEN' || u === 'ELSE') {
      segs.push([]);
      seenBranch = true;
    }
    segs[segs.length - 1].push(k);
  }
  void seenBranch;
  segs.forEach((s, idx) => {
    if (idx > 0) w.breakNext(openLvl + 1);
    renderInline(s, c);
  });
  w.breakNext(openLvl);
  if (g.close) w.emit(g.close);
}

/* ---- Nhận diện mệnh đề ---- */

const JOIN_MODS = new Set(['NATURAL', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'SEMI', 'ANTI']);
const ALTER_ACTIONS = new Set(['ADD', 'DROP', 'RENAME', 'MODIFY', 'CHANGE', 'OWNER', 'ENABLE', 'DISABLE', 'VALIDATE', 'ATTACH', 'DETACH', 'ALTER']);
const NO_SET = new Set(['ALTER', 'CREATE', 'DROP', 'SET', 'GRANT', 'REVOKE', 'DECLARE', 'SHOW', 'RESET', 'PRAGMA', 'USE']);
const HEAD_WORDS = new Set(['DISTINCT', 'ALL', 'TOP', 'PERCENT', 'TIES', 'DISTINCTROW', 'SQL_CALC_FOUND_ROWS', 'HIGH_PRIORITY', 'SQL_NO_CACHE']);

type ClauseKind = 'select' | 'list' | 'cond' | 'plain' | 'join' | 'on' | 'with' | 'setop' | 'action';
interface Clause {
  n: number;
  kind: ClauseKind;
}
interface St {
  first: string;
  inJoin: boolean;
  actionSeen: boolean;
}

function matchClause(nodes: Node[], i: number, st: St): Clause | null {
  const t = nodes[i];
  if (!isTok(t) || t.type !== 'word') return null;
  const u = t.up;
  const u1 = up(nodes[i + 1]);
  const u2 = up(nodes[i + 2]);
  const prev = nodes[i - 1];
  const atStart = i === 0 || isGrp(prev);
  switch (u) {
    case 'SELECT':
      return { n: 1, kind: 'select' };
    case 'FROM':
      return up(prev) === 'DISTINCT' ? null : { n: 1, kind: 'list' };
    case 'WHERE':
    case 'HAVING':
    case 'QUALIFY':
      return { n: 1, kind: 'cond' };
    case 'GROUP':
    case 'ORDER':
      return u1 === 'BY' ? { n: 2, kind: 'list' } : null;
    case 'LIMIT':
    case 'OFFSET':
      return { n: 1, kind: 'plain' };
    case 'FETCH':
      return u1 === 'FIRST' || u1 === 'NEXT' ? { n: 1, kind: 'plain' } : null;
    case 'FOR':
      return u1 === 'UPDATE' || u1 === 'SHARE' || u1 === 'NO' ? { n: 1, kind: 'plain' } : null;
    case 'UNION':
    case 'INTERSECT':
    case 'EXCEPT':
    case 'MINUS': {
      const pv = prev;
      if (i === 0 || (isTok(pv) && pv.type === 'op')) return null;
      return { n: 1 + (u1 === 'ALL' || u1 === 'DISTINCT' ? 1 : 0), kind: 'setop' };
    }
    case 'WITH': {
      let j = i + 1;
      if (up(nodes[j]) === 'RECURSIVE') j++;
      const nm = nodes[j];
      if (!isTok(nm) || (nm.type !== 'word' && nm.type !== 'qident')) return null;
      j++;
      if (isGrp(nodes[j]) && (nodes[j] as Grp).kind === 'paren') j++;
      return up(nodes[j]) === 'AS' ? { n: 1, kind: 'with' } : null;
    }
    case 'UPDATE':
      return atStart ? { n: 1, kind: 'plain' } : null;
    case 'DELETE':
      return atStart ? { n: u1 === 'FROM' ? 2 : 1, kind: 'plain' } : null;
    case 'INSERT':
    case 'REPLACE': {
      if (!atStart || isGrp(nodes[i + 1])) return null;
      for (let k = 1; k <= 4; k++) if (up(nodes[i + k]) === 'INTO') return { n: k + 1, kind: 'plain' };
      return { n: 1, kind: 'plain' };
    }
    case 'SET':
      return i > 0 && !NO_SET.has(st.first) ? { n: 1, kind: 'list' } : null;
    case 'VALUES': {
      const pv = prev;
      if (isTok(pv) && pv.type === 'op') return null;
      return { n: 1, kind: 'list' };
    }
    case 'RETURNING':
      return { n: 1, kind: 'list' };
    case 'USING':
      return st.first === 'MERGE' && !st.inJoin ? { n: 1, kind: 'plain' } : null;
    case 'ON':
      if (u1 === 'CONFLICT') return { n: 2, kind: 'plain' };
      if (u1 === 'DUPLICATE' && u2 === 'KEY' && up(nodes[i + 3]) === 'UPDATE') return { n: 4, kind: 'list' };
      return st.inJoin ? { n: 1, kind: 'on' } : null;
    case 'WHEN':
      if (u1 === 'MATCHED') return { n: 2, kind: 'plain' };
      if (u1 === 'NOT' && u2 === 'MATCHED') return { n: 3, kind: 'plain' };
      return null;
    case 'WINDOW':
      return up(nodes[i + 2]) === 'AS' ? { n: 1, kind: 'list' } : null;
    case 'JOIN':
    case 'STRAIGHT_JOIN':
      return { n: 1, kind: 'join' };
    default:
      break;
  }
  if (JOIN_MODS.has(u)) {
    let k = 1;
    while (JOIN_MODS.has(up(nodes[i + k]))) k++;
    const e = up(nodes[i + k]);
    if (e === 'JOIN') return { n: k + 1, kind: 'join' };
    if ((u === 'CROSS' || u === 'OUTER') && e === 'APPLY') return { n: k + 1, kind: 'join' };
    return null;
  }
  if (st.first === 'ALTER' && ALTER_ACTIONS.has(u) && i >= 3 && (!st.actionSeen || isComma(prev))) {
    return { n: 1, kind: 'action' };
  }
  return null;
}

function countCommas(nodes: Node[], from: number, st: St): number {
  let cnt = 0;
  for (let j = from; j < nodes.length; j++) {
    if (matchClause(nodes, j, { ...st, inJoin: true })) break;
    if (isComma(nodes[j])) cnt++;
  }
  return cnt;
}

function layoutSeq(nodes: Node[], c: Ctx, base: number) {
  const w = c.w;
  const o = c.o;
  const st: St = { first: up(nodes[0]), inJoin: false, actionSeen: false };
  let listMode = false;
  let itemLvl = base + 1;
  let pendItem = false;
  let head = false;
  let headSkip = 0;
  let lastHead = '';
  let isCond = false;
  let between = 0;
  let sawTable = false;
  let createDone = false;
  let clauseSeen = false;
  const leading = o.commaStyle === 'leading';

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];

    if (head) {
      if (headSkip > 0) {
        headSkip--;
        emitNode(n, c, true);
        continue;
      }
      const u = up(n);
      if (u && (HEAD_WORDS.has(u) || (u === 'ON' && lastHead === 'DISTINCT') || (u === 'WITH' && up(nodes[i + 1]) === 'TIES'))) {
        if (u === 'TOP' || (u === 'ON' && lastHead === 'DISTINCT')) headSkip = 1;
        lastHead = u;
        emitNode(n, c, true);
        continue;
      }
      head = false;
    }
    if (pendItem) {
      if (listMode) w.breakNext(itemLvl);
      pendItem = false;
    }

    if (isTok(n) && n.type === 'word') {
      const m = matchClause(nodes, i, st);
      if (m) {
        const explainInline = st.first === 'EXPLAIN' && !clauseSeen;
        clauseSeen = true;
        if (!explainInline) w.breakNext(m.kind === 'on' || m.kind === 'action' ? base + 1 : base);
        for (let k = 0; k < m.n; k++) w.emit(nodes[i + k] as Tok);
        const after = i + m.n;
        i += m.n - 1;
        isCond = false;
        between = 0;
        if (m.kind !== 'join' && m.kind !== 'on') st.inJoin = false;
        switch (m.kind) {
          case 'select':
            head = true;
            lastHead = '';
            headSkip = 0;
            listMode = countCommas(nodes, after, st) > 0;
            itemLvl = base + 1;
            pendItem = true;
            break;
          case 'list':
            listMode = countCommas(nodes, after, st) > 0;
            itemLvl = base + 1;
            pendItem = true;
            break;
          case 'with':
            listMode = countCommas(nodes, after, st) > 0;
            itemLvl = base;
            break;
          case 'cond':
            isCond = true;
            listMode = false;
            break;
          case 'join':
            st.inJoin = true;
            listMode = false;
            break;
          case 'on':
            isCond = true;
            listMode = false;
            break;
          case 'action':
            st.actionSeen = true;
            listMode = false;
            break;
          default:
            listMode = false;
            if (u_(nodes[i]) === 'USING' && st.first === 'MERGE') st.inJoin = true;
            break;
        }
        continue;
      }
      if (n.up === 'TABLE') sawTable = true;
      if (n.up === 'BETWEEN') between++;
      if (isCond && o.breakAndOr && (n.up === 'AND' || n.up === 'OR')) {
        if (n.up === 'AND' && between > 0) between--;
        else w.breakNext(base + 1);
      }
      w.emit(n);
      continue;
    }

    if (isComma(n) && listMode) {
      if (leading) {
        w.breakNext(itemLvl);
        w.emit(n);
      } else {
        w.emit(n);
        w.breakNext(itemLvl);
      }
      continue;
    }

    if (isGrp(n)) {
      if (n.kind === 'case') layoutCase(n, c, true);
      else if (n.sub) layoutSub(n, c);
      else if (st.first === 'CREATE' && sawTable && !createDone && isTok(nodes[i - 1]) && ((nodes[i - 1] as Tok).type === 'word' || (nodes[i - 1] as Tok).type === 'qident' || up(nodes[i - 1]) === '')) {
        createDone = true;
        renderParen(n, c, true);
      } else renderParen(n, c, false);
      continue;
    }
    w.emit(n);
  }
}

function u_(n: Node | undefined): string {
  return up(n);
}

/* ------------------------------------------------------------------ */
/* API chính                                                           */
/* ------------------------------------------------------------------ */

export interface SqlFormatResult {
  output: string;
  warnings: string[];
  error?: string;
  statements: number;
  tokens: number;
}

function indentString(o: SqlFormatOptions): string {
  return o.indent === 'tab' ? '\t' : ' '.repeat(o.indent === 4 ? 4 : 2);
}

function minifyAtoms(prep: Prepared): string {
  const atoms: Tok[] = [];
  for (const t of prep.sig) pushTok(t, atoms);
  for (const t of prep.tail) atoms.push(t);
  let s = '';
  const h: Tok[] = [];
  let afterLine = false;
  for (const a of atoms) {
    if (s !== '' && !afterLine && needSpace(h, a)) s += ' ';
    s += a.out;
    h.push(a);
    if (h.length > 12) h.shift();
    if (a.type === 'lineComment') {
      s += '\n';
      afterLine = true;
    } else afterLine = false;
  }
  return afterLine ? s.slice(0, -1) : s;
}

export function formatSql(input: string, opts: Partial<SqlFormatOptions> = {}): SqlFormatResult {
  const o: SqlFormatOptions = { ...DEFAULT_SQL_OPTIONS, ...opts };
  if (!(o.maxWidth >= 20)) o.maxWidth = 80;
  const res: SqlFormatResult = { output: '', warnings: [], statements: 0, tokens: 0 };
  try {
    const raw = tokenize(input, o.dialect);
    res.tokens = raw.filter((t) => t.type !== 'ws').length;
    for (const t of raw) {
      if (t.open) {
        if (t.type === 'blockComment') res.warnings.push('Có chú thích /* ... */ chưa được đóng.');
        else if (t.type === 'string') res.warnings.push('Có chuỗi ký tự chưa được đóng nháy.');
        else res.warnings.push('Có định danh trong ngoặc kép/backtick chưa được đóng.');
        break;
      }
    }
    const prep = prepare(raw, o);
    const tree = parse(prep.sig);
    if (tree.unclosedParens) res.warnings.push(`Thiếu ${tree.unclosedParens} dấu đóng ngoặc ")".`);
    if (tree.strayClose) res.warnings.push(`Thừa ${tree.strayClose} dấu đóng ngoặc ")" không có dấu mở.`);
    if (tree.unclosedCase) res.warnings.push(`Có ${tree.unclosedCase} biểu thức CASE thiếu END.`);

    // Tách câu lệnh theo ';' ở mức ngoài cùng
    const stmts: Node[][] = [];
    let curS: Node[] = [];
    for (const n of tree.root) {
      curS.push(n);
      if (isTok(n) && n.type === 'punct' && n.text === ';') {
        stmts.push(curS);
        curS = [];
      }
    }
    if (curS.length) stmts.push(curS);
    res.statements = stmts.length;

    if (o.minify) {
      res.output = minifyAtoms(prep);
      return res;
    }
    const ind = indentString(o);
    const iw = o.indent === 'tab' ? 4 : o.indent;
    const parts: string[] = [];
    for (const s of stmts) {
      const wr = new Writer(iw, o.maxWidth);
      layoutSeq(s, { w: wr, o }, 0);
      parts.push(wr.toString(ind));
    }
    let outStr = parts.join(o.blankBetween ? '\n\n' : '\n');
    if (prep.tail.length) {
      const tw = prep.tail.map((t) => t.text).join('\n');
      outStr = outStr ? outStr + '\n' + tw : tw;
    }
    res.output = outStr;
    return res;
  } catch (e) {
    res.output = input;
    res.error = 'Không thể định dạng đoạn SQL này: ' + (e instanceof Error ? e.message : String(e));
    return res;
  }
}

/** Danh sách token có nghĩa (bỏ khoảng trắng + chú thích) - dùng để kiểm thử */
export function significantTokens(src: string, dialect: SqlDialect = 'standard'): string[] {
  return tokenize(src, dialect)
    .filter((t) => t.type !== 'ws' && t.type !== 'lineComment' && t.type !== 'blockComment')
    .map((t) => t.text);
}

/* ------------------------------------------------------------------ */
/* Mẫu                                                                 */
/* ------------------------------------------------------------------ */

export interface SqlSample {
  id: string;
  label: string;
  dialect: SqlDialect;
  sql: string;
}

export const SQL_SAMPLES: SqlSample[] = [
  {
    id: 'join',
    label: 'SELECT + JOIN',
    dialect: 'standard',
    sql: `select o.id,o.created_at,c.name as customer,sum(oi.qty*oi.price) as total from orders o inner join customers c on c.id=o.customer_id left join order_items oi on oi.order_id=o.id and oi.deleted_at is null where o.status in ('paid','shipped') and o.created_at>='2024-01-01' or o.vip=1 group by o.id,o.created_at,c.name having sum(oi.qty*oi.price)>100 order by total desc,o.id limit 20 offset 40;`,
  },
  {
    id: 'cte',
    label: 'CTE + cửa sổ',
    dialect: 'postgres',
    sql: `with recursive tree as (select id,parent_id,name,1 as depth from categories where parent_id is null union all select c.id,c.parent_id,c.name,t.depth+1 from categories c join tree t on t.id=c.parent_id), ranked as (select *, row_number() over (partition by parent_id order by name) as rn, sum(price) over (partition by dept order by hired_at rows between unbounded preceding and current row) as running from tree) select * from ranked where rn<=3;`,
  },
  {
    id: 'case',
    label: 'CASE WHEN',
    dialect: 'standard',
    sql: `SELECT id, CASE WHEN score>=90 THEN 'A' WHEN score>=80 THEN 'B' WHEN score>=70 THEN 'C' ELSE 'F' END AS grade, CASE status WHEN 1 THEN 'active' ELSE 'off' END state FROM students WHERE score IS NOT NULL;`,
  },
  {
    id: 'insert',
    label: 'INSERT nhiều dòng',
    dialect: 'mysql',
    sql: "insert into users (name,email,created_at) values ('An','an@example.com',now()),('Bình','binh@example.com',now()),('Chi','chi@example.com',now()) on duplicate key update name=values(name);",
  },
  {
    id: 'update',
    label: 'UPDATE / DELETE',
    dialect: 'standard',
    sql: `update products set price=price*1.1,updated_at=now() where category_id in (select id from categories where active=1) and stock>0;
delete from sessions where expires_at<now() and user_id not in (select id from users where banned=0);`,
  },
  {
    id: 'create',
    label: 'CREATE TABLE',
    dialect: 'postgres',
    sql: `create table if not exists accounts (id bigserial primary key, email varchar(255) not null unique, balance numeric(12,2) default 0 check (balance>=0), meta jsonb default '{}'::jsonb, created_at timestamp with time zone default now(), org_id int references orgs(id) on delete cascade);
create index idx_accounts_email on accounts (lower(email));`,
  },
  {
    id: 'pg-json',
    label: 'PostgreSQL JSON / cast',
    dialect: 'postgres',
    sql: `select data->>'name' as name, (data->'address'->>'zip')::int as zip, tags || array['x'] as tags2 from events where data @> '{"type":"click"}' and created_at > now() - interval '7 days' and $1 = any(tags);
create function f() returns int as $$ begin return 1; end; $$ language plpgsql;`,
  },
  {
    id: 'tsql',
    label: 'T-SQL',
    dialect: 'tsql',
    sql: `select top 10 [Id],[Full Name],isnull([Phone],'n/a') as phone from [dbo].[Customers] with (nolock) where [Country]=@country and [Created]>@since order by [Id] desc;`,
  },
  {
    id: 'comments',
    label: 'Có chú thích',
    dialect: 'standard',
    sql: `-- báo cáo doanh thu
select a, /* cột a */ b -- cột b
from t /* bảng chính */
where x = 1 -- điều kiện
  and y = 2;
/* câu lệnh khác */
select 1;`,
  },
  {
    id: 'params',
    label: 'Có tham số',
    dialect: 'standard',
    sql: `select * from users where id = ? and email = :email and age > @age and city = $1 and name like %s;`,
  },
];
