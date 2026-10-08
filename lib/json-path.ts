/**
 * JSONPath (tự cài đặt, không dùng thư viện) + tiện ích JSON Pointer.
 *
 * Hỗ trợ: $, .key, ['key'], [n] (kể cả âm), [*], .*, slice [a:b:c], union ['a','b'] / [0,2],
 * đệ quy ..key / ..* / ..[..], bộ lọc [?(@.price < 10 && @.tag == 'x')] với so sánh,
 * &&, ||, !, ngoặc, kiểm tra tồn tại, @.length, regex (=~ /re/i) và một số hàm chuỗi.
 */

export type PathSeg = string | number;

export class JsonPathError extends Error {
  pos: number;
  constructor(message: string, pos = -1) {
    super(message);
    this.pos = pos;
  }
}

// ---------------------------------------------------------------------------
// Định dạng đường dẫn
// ---------------------------------------------------------------------------

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function escapeQuoted(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out;
}

/** Chuyển danh sách khóa thành JSONPath dạng `$.a.b[2]['c d']`. */
export function toJsonPath(segs: readonly PathSeg[]): string {
  let s = '$';
  for (const k of segs) {
    if (typeof k === 'number') s += `[${k}]`;
    else if (IDENT_RE.test(k)) s += '.' + k;
    else s += `['${escapeQuoted(k)}']`;
  }
  return s;
}

export function escapePointerToken(t: string): string {
  return t.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapePointerToken(t: string): string {
  return t.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** RFC 6901: `["a/b", 0]` -> `/a~1b/0`; đường dẫn rỗng -> "". */
export function toPointer(segs: readonly PathSeg[]): string {
  let s = '';
  for (const k of segs) s += '/' + escapePointerToken(String(k));
  return s;
}

/** Phân tích JSON Pointer thành các token (chuỗi). Trả về null nếu không hợp lệ. */
export function parsePointer(ptr: string): string[] | null {
  if (ptr === '') return [];
  if (ptr[0] !== '/') return null;
  const out: string[] = [];
  for (const t of ptr.slice(1).split('/')) {
    if (/~(?![01])/.test(t)) return null;
    out.push(unescapePointerToken(t));
  }
  return out;
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export type JsonType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

export function typeOf(v: unknown): JsonType {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'object') return 'object';
  if (t === 'boolean' || t === 'number' || t === 'string') return t;
  return 'string';
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Selector =
  | { t: 'name'; name: string }
  | { t: 'index'; i: number }
  | { t: 'slice'; start: number | null; end: number | null; step: number | null }
  | { t: 'wild' }
  | { t: 'filter'; expr: Expr };

interface Segment {
  desc: boolean;
  sels: Selector[];
}

interface PathQuery {
  root: '$' | '@';
  segs: Segment[];
}

type Expr =
  | { k: 'or' | 'and'; l: Expr; r: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'cmp'; op: string; l: Expr; r: Expr }
  | { k: 'lit'; v: unknown }
  | { k: 'path'; q: PathQuery }
  | { k: 'fn'; name: string; args: Expr[] }
  | { k: 're'; re: RegExp };

export interface CompiledPath {
  source: string;
  query: PathQuery;
}

// ---------------------------------------------------------------------------
// Regex an toàn
// ---------------------------------------------------------------------------

const MAX_REGEX_LEN = 256;
const MAX_REGEX_INPUT = 20000;
const NESTED_QUANT_RE = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/;

export function compileSafeRegex(src: string, flags = ''): RegExp {
  if (src.length > MAX_REGEX_LEN) throw new JsonPathError(`Regex quá dài (tối đa ${MAX_REGEX_LEN} ký tự).`);
  if (NESTED_QUANT_RE.test(src)) throw new JsonPathError('Regex có lượng từ lồng nhau, có nguy cơ chạy rất chậm.');
  if (/\\[1-9]|\\k</.test(src)) throw new JsonPathError('Không hỗ trợ tham chiếu ngược (backreference) trong regex.');
  const f = flags.replace(/[gy]/g, '');
  if (/[^imsu]/.test(f)) throw new JsonPathError(`Cờ regex không hợp lệ: ${flags}`);
  try {
    return new RegExp(src, f);
  } catch (e) {
    throw new JsonPathError('Regex không hợp lệ: ' + (e instanceof Error ? e.message : String(e)));
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const MAX_DEPTH = 40;
const NAME_STOP = new Set([' ', '\t', '\n', '\r', '.', '[', ']', '(', ')', '=', '<', '>', '!', '&', '|', ',', "'", '"', '*', '?']);

class Parser {
  pos = 0;
  depth = 0;
  constructor(private src: string) {}

  err(msg: string, pos = this.pos): never {
    throw new JsonPathError(`${msg} (vị trí ${pos + 1})`, pos);
  }
  ws() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }
  peek(): string {
    return this.src[this.pos] ?? '';
  }
  eat(s: string): boolean {
    if (this.src.startsWith(s, this.pos)) {
      this.pos += s.length;
      return true;
    }
    return false;
  }
  expect(s: string) {
    if (!this.eat(s)) this.err(`Cần "${s}"`);
  }

  parseTop(): PathQuery {
    this.ws();
    let q: PathQuery;
    if (this.peek() === '$') {
      this.pos++;
      q = { root: '$', segs: this.parseSegments(false) };
    } else if (this.peek() === '@') {
      this.err('Truy vấn phải bắt đầu bằng "$"');
    } else {
      q = { root: '$', segs: this.parseSegments(true) };
    }
    this.ws();
    if (this.pos < this.src.length) this.err(`Ký tự không mong đợi "${this.peek()}"`);
    return q;
  }

  parseSegments(implicitFirst: boolean): Segment[] {
    const segs: Segment[] = [];
    let first = implicitFirst;
    for (;;) {
      if (first) {
        first = false;
        if (this.peek() === '[') {
          segs.push({ desc: false, sels: this.parseBracket() });
        } else if (this.peek() === '*') {
          this.pos++;
          segs.push({ desc: false, sels: [{ t: 'wild' }] });
        } else if (this.peek() === '.') {
          continue;
        } else {
          segs.push({ desc: false, sels: [{ t: 'name', name: this.parseName() }] });
        }
        continue;
      }
      if (this.src.startsWith('..', this.pos)) {
        this.pos += 2;
        if (this.peek() === '[') segs.push({ desc: true, sels: this.parseBracket() });
        else if (this.peek() === '*') {
          this.pos++;
          segs.push({ desc: true, sels: [{ t: 'wild' }] });
        } else segs.push({ desc: true, sels: [{ t: 'name', name: this.parseName() }] });
      } else if (this.peek() === '.') {
        this.pos++;
        if (this.peek() === '*') {
          this.pos++;
          segs.push({ desc: false, sels: [{ t: 'wild' }] });
        } else if (this.peek() === '[') {
          segs.push({ desc: false, sels: this.parseBracket() });
        } else segs.push({ desc: false, sels: [{ t: 'name', name: this.parseName() }] });
      } else if (this.peek() === '[') {
        segs.push({ desc: false, sels: this.parseBracket() });
      } else break;
    }
    return segs;
  }

  parseName(): string {
    const start = this.pos;
    while (this.pos < this.src.length && !NAME_STOP.has(this.src[this.pos])) this.pos++;
    if (this.pos === start) this.err('Thiếu tên khóa');
    return this.src.slice(start, this.pos);
  }

  parseQuoted(): string {
    const q = this.src[this.pos];
    const start = this.pos;
    this.pos++;
    let out = '';
    for (;;) {
      if (this.pos >= this.src.length) this.err('Chuỗi chưa đóng dấu nháy', start);
      const ch = this.src[this.pos++];
      if (ch === q) return out;
      if (ch === '\\') {
        const n = this.src[this.pos++];
        switch (n) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case '/': out += '/'; break;
          case '\\': out += '\\'; break;
          case "'": out += "'"; break;
          case '"': out += '"'; break;
          case 'u': {
            const hex = this.src.slice(this.pos, this.pos + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.err('Escape \\u không hợp lệ');
            out += String.fromCharCode(parseInt(hex, 16));
            this.pos += 4;
            break;
          }
          default:
            this.err('Escape không hợp lệ trong chuỗi');
        }
      } else out += ch;
    }
  }

  parseInt_(): number | null {
    const m = /^-?\d+/.exec(this.src.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    const n = Number(m[0]);
    if (!Number.isSafeInteger(n)) this.err('Số nguyên quá lớn');
    return n;
  }

  parseBracket(): Selector[] {
    this.expect('[');
    const sels: Selector[] = [];
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === '') this.err('Thiếu dấu "]"');
      if (c === "'" || c === '"') {
        sels.push({ t: 'name', name: this.parseQuoted() });
      } else if (c === '*') {
        this.pos++;
        sels.push({ t: 'wild' });
      } else if (c === '?') {
        this.pos++;
        this.ws();
        sels.push({ t: 'filter', expr: this.parseOr() });
      } else {
        const start = this.parseInt_();
        this.ws();
        if (this.peek() === ':') {
          this.pos++;
          this.ws();
          const end = this.parseInt_();
          this.ws();
          let step: number | null = null;
          if (this.peek() === ':') {
            this.pos++;
            this.ws();
            step = this.parseInt_();
          }
          sels.push({ t: 'slice', start, end, step });
        } else if (start !== null) {
          sels.push({ t: 'index', i: start });
        } else if (c === ']' || c === ',') {
          this.err('Bộ chọn trống');
        } else {
          // khóa không nháy trong ngoặc, vd [name]
          this.err(`Bộ chọn không hợp lệ "${c}"`);
        }
      }
      this.ws();
      if (this.eat(',')) continue;
      this.expect(']');
      return sels;
    }
  }

  // --- biểu thức bộ lọc ---
  parseOr(): Expr {
    if (++this.depth > MAX_DEPTH) this.err('Biểu thức lồng quá sâu');
    let l = this.parseAnd();
    for (;;) {
      this.ws();
      if (this.eat('||')) l = { k: 'or', l, r: this.parseAnd() };
      else break;
    }
    this.depth--;
    return l;
  }
  parseAnd(): Expr {
    let l = this.parseUnary();
    for (;;) {
      this.ws();
      if (this.eat('&&')) l = { k: 'and', l, r: this.parseUnary() };
      else break;
    }
    return l;
  }
  parseUnary(): Expr {
    this.ws();
    if (this.peek() === '!' && this.src[this.pos + 1] !== '=') {
      this.pos++;
      if (++this.depth > MAX_DEPTH) this.err('Biểu thức lồng quá sâu');
      const e = this.parseUnary();
      this.depth--;
      return { k: 'not', e };
    }
    return this.parseCmp();
  }
  parseCmp(): Expr {
    const l = this.parsePrimary();
    this.ws();
    for (const op of ['===', '!==', '==', '!=', '<=', '>=', '=~', '<', '>']) {
      if (this.eat(op)) {
        this.ws();
        const r = this.parsePrimary();
        return { k: 'cmp', op: op === '===' ? '==' : op === '!==' ? '!=' : op, l, r };
      }
    }
    return l;
  }
  parsePrimary(): Expr {
    this.ws();
    const c = this.peek();
    if (c === '') this.err('Biểu thức chưa hoàn chỉnh');
    if (c === '(') {
      this.pos++;
      const e = this.parseOr();
      this.ws();
      this.expect(')');
      return e;
    }
    if (c === '@' || c === '$') {
      this.pos++;
      return { k: 'path', q: { root: c, segs: this.parseSegments(false) } };
    }
    if (c === "'" || c === '"') return { k: 'lit', v: this.parseQuoted() };
    if (c === '/') return this.parseRegexLiteral();
    const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
    if (num) {
      this.pos += num[0].length;
      return { k: 'lit', v: Number(num[0]) };
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.pos));
    if (id) {
      const name = id[0];
      this.pos += name.length;
      if (name === 'true') return { k: 'lit', v: true };
      if (name === 'false') return { k: 'lit', v: false };
      if (name === 'null') return { k: 'lit', v: null };
      this.ws();
      if (this.peek() === '(') {
        if (!FUNCS[name]) this.err(`Hàm không được hỗ trợ: ${name}`);
        this.pos++;
        const args: Expr[] = [];
        this.ws();
        if (!this.eat(')')) {
          for (;;) {
            args.push(this.parseOr());
            this.ws();
            if (this.eat(',')) continue;
            this.expect(')');
            break;
          }
        }
        return { k: 'fn', name, args };
      }
      this.err(`Định danh không hợp lệ "${name}"`);
    }
    this.err(`Ký tự không mong đợi "${c}"`);
  }
  parseRegexLiteral(): Expr {
    const start = this.pos;
    this.pos++;
    let inClass = false;
    let body = '';
    for (;;) {
      if (this.pos >= this.src.length) this.err('Regex chưa đóng dấu "/"', start);
      const ch = this.src[this.pos++];
      if (ch === '\\') {
        body += ch + (this.src[this.pos++] ?? '');
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) break;
      body += ch;
    }
    const fm = /^[a-z]*/.exec(this.src.slice(this.pos))!;
    this.pos += fm[0].length;
    try {
      return { k: 're', re: compileSafeRegex(body, fm[0]) };
    } catch (e) {
      if (e instanceof JsonPathError) this.err(e.message.replace(/ \(vị trí \d+\)$/, ''), start);
      throw e;
    }
  }
}

export type CompileResult = { ok: true; compiled: CompiledPath } | { ok: false; error: string };

export function compileJsonPath(source: string): CompileResult {
  if (source.length > 2000) return { ok: false, error: 'Truy vấn quá dài (tối đa 2000 ký tự).' };
  if (!source.trim()) return { ok: false, error: 'Nhập truy vấn JSONPath, ví dụ $.store.book[*].title' };
  try {
    const p = new Parser(source);
    return { ok: true, compiled: { source, query: p.parseTop() } };
  } catch (e) {
    if (e instanceof JsonPathError) return { ok: false, error: e.message };
    return { ok: false, error: 'Không phân tích được truy vấn.' };
  }
}

// ---------------------------------------------------------------------------
// Đánh giá
// ---------------------------------------------------------------------------

const NOTHING = Symbol('nothing');
const MAX_STEPS = 4_000_000;
export const MAX_RESULTS = 20000;

interface Node {
  v: unknown;
  p: PathSeg[] | null;
}

interface Ctx {
  root: unknown;
  steps: number;
  truncated: boolean;
  reCache: Map<string, RegExp | null>;
}

function step(ctx: Ctx, n = 1) {
  ctx.steps += n;
  if (ctx.steps > MAX_STEPS) throw new JsonPathError('Truy vấn quá nặng (vượt giới hạn xử lý). Hãy thu hẹp phạm vi.');
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function childNode(n: Node, key: PathSeg, v: unknown): Node {
  return { v, p: n.p ? [...n.p, key] : null };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!hasOwn(b as object, k) || !deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

function children(n: Node): Node[] {
  const v = n.v;
  if (Array.isArray(v)) return v.map((x, i) => childNode(n, i, x));
  if (isObj(v)) return Object.keys(v).map((k) => childNode(n, k, v[k]));
  return [];
}

function descendantsOrSelf(n: Node, ctx: Ctx): Node[] {
  const out: Node[] = [];
  const stack: Node[] = [n];
  while (stack.length) {
    const cur = stack.pop()!;
    step(ctx);
    out.push(cur);
    if (out.length > MAX_RESULTS * 10) throw new JsonPathError('Quá nhiều nút khi duyệt đệ quy.');
    const ch = children(cur);
    for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
  }
  return out;
}

function sliceIndices(len: number, start: number | null, end: number | null, stepN: number | null): number[] {
  const st = stepN ?? 1;
  if (st === 0) return [];
  const norm = (i: number) => (i >= 0 ? i : len + i);
  const out: number[] = [];
  if (st > 0) {
    const s = start === null ? 0 : norm(start);
    const e = end === null ? len : norm(end);
    const lower = Math.min(Math.max(s, 0), len);
    const upper = Math.min(Math.max(e, 0), len);
    for (let i = lower; i < upper; i += st) out.push(i);
  } else {
    const s = start === null ? len - 1 : norm(start);
    const e = end === null ? -len - 1 : norm(end);
    const upper = Math.min(Math.max(s, -1), len - 1);
    const lower = Math.min(Math.max(e, -1), len - 1);
    for (let i = upper; lower < i; i += st) out.push(i);
  }
  return out;
}

function select(c: Node, sel: Selector, out: Node[], ctx: Ctx, inFilter: boolean) {
  const v = c.v;
  switch (sel.t) {
    case 'name':
      if (isObj(v) && hasOwn(v, sel.name)) out.push(childNode(c, sel.name, v[sel.name]));
      else if (inFilter && sel.name === 'length' && (Array.isArray(v) || typeof v === 'string'))
        out.push(childNode(c, 'length', v.length));
      break;
    case 'index':
      if (Array.isArray(v)) {
        const i = sel.i < 0 ? v.length + sel.i : sel.i;
        if (i >= 0 && i < v.length) out.push(childNode(c, i, v[i]));
      }
      break;
    case 'slice':
      if (Array.isArray(v)) {
        for (const i of sliceIndices(v.length, sel.start, sel.end, sel.step)) out.push(childNode(c, i, v[i]));
      }
      break;
    case 'wild':
      out.push(...children(c));
      break;
    case 'filter': {
      for (const ch of children(c)) {
        step(ctx);
        if (toBool(sel.expr, ch, ctx)) out.push(ch);
      }
      break;
    }
  }
}

function applySegments(start: Node[], segs: Segment[], ctx: Ctx, inFilter: boolean): Node[] {
  let cur = start;
  for (const seg of segs) {
    const next: Node[] = [];
    for (const n of cur) {
      const cands = seg.desc ? descendantsOrSelf(n, ctx) : [n];
      for (const c of cands) {
        step(ctx);
        for (const sel of seg.sels) select(c, sel, next, ctx, inFilter);
      }
      if (next.length > MAX_RESULTS) {
        ctx.truncated = true;
        next.length = MAX_RESULTS;
        break;
      }
    }
    cur = next;
    if (!cur.length) break;
  }
  return cur;
}

function evalPath(q: PathQuery, cur: Node, ctx: Ctx): Node[] {
  const start: Node = q.root === '@' ? cur : { v: ctx.root, p: null };
  return applySegments([start], q.segs, ctx, true);
}

function getRegex(ctx: Ctx, pattern: string): RegExp | null {
  if (ctx.reCache.has(pattern)) return ctx.reCache.get(pattern)!;
  let re: RegExp | null = null;
  try {
    re = compileSafeRegex(pattern);
  } catch {
    re = null;
  }
  if (ctx.reCache.size < 200) ctx.reCache.set(pattern, re);
  return re;
}

function reTest(re: RegExp, s: string): boolean {
  return re.test(s.length > MAX_REGEX_INPUT ? s.slice(0, MAX_REGEX_INPUT) : s);
}

type Fn = (args: unknown[], ctx: Ctx) => unknown;

const FUNCS: Record<string, Fn> = {
  length: ([a]) => {
    if (typeof a === 'string' || Array.isArray(a)) return a.length;
    if (isObj(a)) return Object.keys(a).length;
    return NOTHING;
  },
  contains: ([a, b]) => {
    if (typeof a === 'string' && typeof b === 'string') return a.includes(b);
    if (Array.isArray(a) && b !== NOTHING) return a.some((x) => deepEqual(x, b));
    return false;
  },
  startsWith: ([a, b]) => typeof a === 'string' && typeof b === 'string' && a.startsWith(b),
  endsWith: ([a, b]) => typeof a === 'string' && typeof b === 'string' && a.endsWith(b),
  lower: ([a]) => (typeof a === 'string' ? a.toLowerCase() : NOTHING),
  upper: ([a]) => (typeof a === 'string' ? a.toUpperCase() : NOTHING),
  match: ([a, p], ctx) => {
    if (typeof a !== 'string' || typeof p !== 'string') return false;
    const re = getRegex(ctx, `^(?:${p})$`);
    return !!re && reTest(re, a);
  },
  search: ([a, p], ctx) => {
    if (typeof a !== 'string' || typeof p !== 'string') return false;
    const re = getRegex(ctx, p);
    return !!re && reTest(re, a);
  },
};

function compare(op: string, a: unknown, b: unknown, ctx: Ctx, rexpr: Expr): boolean {
  if (op === '=~') {
    if (typeof a !== 'string') return false;
    let re: RegExp | null;
    if (rexpr.k === 're') re = rexpr.re;
    else if (typeof b === 'string') re = getRegex(ctx, b);
    else return false;
    return !!re && reTest(re, a);
  }
  if (op === '==') {
    if (a === NOTHING || b === NOTHING) return a === b;
    return deepEqual(a, b);
  }
  if (op === '!=') return !compare('==', a, b, ctx, rexpr);
  if (a === NOTHING || b === NOTHING) return false;
  let c: number;
  if (typeof a === 'number' && typeof b === 'number') c = a < b ? -1 : a > b ? 1 : a === b ? 0 : NaN;
  else if (typeof a === 'string' && typeof b === 'string') c = a < b ? -1 : a > b ? 1 : 0;
  else return false;
  if (Number.isNaN(c)) return false;
  switch (op) {
    case '<': return c < 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    case '>=': return c >= 0;
  }
  return false;
}

function evalExpr(e: Expr, cur: Node, ctx: Ctx): unknown {
  step(ctx);
  switch (e.k) {
    case 'lit':
      return e.v;
    case 're':
      return e.re;
    case 'path': {
      const nodes = evalPath(e.q, cur, ctx);
      return nodes.length ? nodes[0].v : NOTHING;
    }
    case 'fn':
      return FUNCS[e.name](
        e.args.map((a) => evalExpr(a, cur, ctx)),
        ctx
      );
    case 'cmp':
      return compare(e.op, evalExpr(e.l, cur, ctx), evalExpr(e.r, cur, ctx), ctx, e.r);
    case 'not':
      return !toBool(e.e, cur, ctx);
    case 'and':
      return toBool(e.l, cur, ctx) && toBool(e.r, cur, ctx);
    case 'or':
      return toBool(e.l, cur, ctx) || toBool(e.r, cur, ctx);
  }
}

function toBool(e: Expr, cur: Node, ctx: Ctx): boolean {
  if (e.k === 'path') {
    // kiểm tra tồn tại (giá trị `false` được coi là không đúng để dùng được `!@.flag`)
    const nodes = evalPath(e.q, cur, ctx);
    return nodes.length > 0 && nodes[0].v !== false;
  }
  const v = evalExpr(e, cur, ctx);
  if (v === NOTHING) return false;
  if (v instanceof RegExp) return true;
  return Boolean(v);
}

export interface JsonPathMatch {
  path: PathSeg[];
  jsonPath: string;
  pointer: string;
  value: unknown;
}

export type QueryResult =
  | { ok: true; matches: JsonPathMatch[]; truncated: boolean }
  | { ok: false; error: string };

export function runCompiled(root: unknown, compiled: CompiledPath): QueryResult {
  const ctx: Ctx = { root, steps: 0, truncated: false, reCache: new Map() };
  try {
    const nodes = applySegments([{ v: root, p: [] }], compiled.query.segs, ctx, false);
    return {
      ok: true,
      truncated: ctx.truncated,
      matches: nodes.map((n) => ({
        path: n.p!,
        jsonPath: toJsonPath(n.p!),
        pointer: toPointer(n.p!),
        value: n.v,
      })),
    };
  } catch (e) {
    if (e instanceof JsonPathError) return { ok: false, error: e.message };
    if (e instanceof RangeError) return { ok: false, error: 'Dữ liệu lồng quá sâu để truy vấn.' };
    return { ok: false, error: 'Lỗi khi thực thi truy vấn.' };
  }
}

/** Biên dịch và chạy truy vấn JSONPath; không bao giờ ném lỗi. */
export function queryJsonPath(root: unknown, source: string): QueryResult {
  const c = compileJsonPath(source);
  if (!c.ok) return c;
  return runCompiled(root, c.compiled);
}

/** Tra cứu giá trị theo JSON Pointer. */
export function getByPointer(root: unknown, ptr: string): { found: boolean; value?: unknown } {
  const toks = parsePointer(ptr);
  if (!toks) return { found: false };
  let cur = root;
  for (const t of toks) {
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d*)$/.test(t) || Number(t) >= cur.length) return { found: false };
      cur = cur[Number(t)];
    } else if (isObj(cur) && hasOwn(cur, t)) cur = cur[t];
    else return { found: false };
  }
  return { found: true, value: cur };
}

// ---------------------------------------------------------------------------
// Dữ liệu mẫu
// ---------------------------------------------------------------------------

export const SAMPLE_DOC = {
  store: {
    name: 'Hiệu sách Sao Mai',
    book: [
      { id: 1, category: 'tham-khao', author: 'Nguyễn Nhật Ánh', title: 'Mắt biếc', price: 8.95, tags: ['van-hoc', 'tinh-yeu'], inStock: true },
      { id: 2, category: 'tham-khao', author: 'Tô Hoài', title: 'Dế Mèn phiêu lưu ký', price: 12.99, tags: ['thieu-nhi'], inStock: true },
      { id: 3, category: 'tieu-thuyet', author: 'Nam Cao', title: 'Chí Phèo', price: 8.99, tags: ['van-hoc', 'hien-thuc'], inStock: false },
      { id: 4, category: 'tieu-thuyet', author: 'Vũ Trọng Phụng', title: 'Số đỏ', price: 22.99, tags: ['van-hoc', 'trao-phung'], inStock: true },
    ],
    bicycle: { color: 'đỏ', price: 19.95 },
    'open hours': { mon: '8-17', sat: null },
  },
  expensive: 10,
};

export const EXAMPLE_QUERIES: { label: string; query: string }[] = [
  { label: 'Tất cả tiêu đề', query: '$.store.book[*].title' },
  { label: 'Sách rẻ hơn 10', query: '$.store.book[?(@.price < 10)].title' },
  { label: 'Giá bất kỳ (..price)', query: '$..price' },
  { label: 'Sách cuối cùng', query: '$.store.book[-1]' },
  { label: 'Hai sách đầu', query: '$.store.book[0:2].title' },
  { label: 'Lọc phức hợp', query: "$.store.book[?(@.price > 8.95 && @.category == 'tieu-thuyet')]" },
  { label: 'Có tag văn học', query: "$.store.book[?(@.tags.length > 1 && contains(@.tags, 'van-hoc'))].title" },
  { label: 'Regex tác giả', query: '$.store.book[?(@.author =~ /^(nam|tô)/i)].author' },
  { label: 'Union', query: "$.store.book[0,2]['title','price']" },
  { label: 'Hết hàng', query: '$.store.book[?(!@.inStock)].title' },
  { label: 'Khóa có dấu cách', query: "$.store['open hours']" },
];
