/**
 * JSON → Code: suy luận kiểu từ một hoặc nhiều mẫu JSON rồi sinh mã cho nhiều ngôn ngữ.
 * Thuần logic (không React), không ném lỗi ra ngoài: lỗi trả về dạng đối tượng với thông báo tiếng Việt.
 */

// ───────────────────────── Kiểu công khai ─────────────────────────

export type Lang =
  | 'typescript'
  | 'go'
  | 'python'
  | 'kotlin'
  | 'rust'
  | 'java'
  | 'csharp'
  | 'zod'
  | 'jsonschema'
  | 'sql';

export interface LangInfo {
  id: Lang;
  label: string;
  ext: string;
}

export const LANGS: LangInfo[] = [
  { id: 'typescript', label: 'TypeScript', ext: 'ts' },
  { id: 'go', label: 'Go', ext: 'go' },
  { id: 'python', label: 'Python', ext: 'py' },
  { id: 'kotlin', label: 'Kotlin', ext: 'kt' },
  { id: 'rust', label: 'Rust', ext: 'rs' },
  { id: 'java', label: 'Java', ext: 'java' },
  { id: 'csharp', label: 'C#', ext: 'cs' },
  { id: 'zod', label: 'Zod', ext: 'ts' },
  { id: 'jsonschema', label: 'JSON Schema', ext: 'schema.json' },
  { id: 'sql', label: 'SQL', ext: 'sql' },
];

export interface GenOptions {
  rootName: string;
  /** Mảng gốc (hoặc nhiều tài liệu) được coi là danh sách mẫu của cùng một kiểu */
  unwrapRoot: boolean;
  /** Tách số nguyên / số thực */
  splitNumbers: boolean;
  /** Nhận diện chuỗi ISO 8601 date-time */
  detectDates: boolean;
  /** Nhận diện object dạng map (khóa là ID/UUID) */
  detectMaps: boolean;
  /** Cách đặt tên kiểu lồng nhau: theo khóa, hoặc theo đường dẫn (UserAddress) */
  naming: 'short' | 'path';
  tsDecl: 'interface' | 'type';
  tsAny: 'unknown' | 'any';
  readonly: boolean;
  exportTypes: boolean;
  pyStyle: 'dataclass' | 'typeddict' | 'pydantic';
  kotlinSerial: boolean;
  sqlDialect: 'postgres' | 'mysql' | 'sqlite';
}

export const DEFAULT_OPTIONS: GenOptions = {
  rootName: 'Root',
  unwrapRoot: true,
  splitNumbers: true,
  detectDates: true,
  detectMaps: true,
  naming: 'short',
  tsDecl: 'interface',
  tsAny: 'unknown',
  readonly: false,
  exportTypes: true,
  pyStyle: 'dataclass',
  kotlinSerial: true,
  sqlDialect: 'postgres',
};

export const MAX_INPUT_CHARS = 5 * 1024 * 1024;
const MAX_DOCS = 5000;
const MAX_DEPTH = 200;
const MAX_NODES = 1_500_000;

export interface ParseErrorInfo {
  message: string;
  pos: number;
  line: number;
  col: number;
}

export interface GenStats {
  samples: number;
  models: number;
  fields: number;
  optionalFields: number;
  nullableFields: number;
}

export type GenResult =
  | { ok: true; code: string; stats: GenStats; warnings: string[] }
  | { ok: false; error: string; pos?: number; line?: number; col?: number };

// ───────────────────────── Bộ phân tích JSON ─────────────────────────

interface JNum {
  readonly num: true;
  readonly kind: 'int' | 'big' | 'float';
}
const N_INT: JNum = { num: true, kind: 'int' };
const N_BIG: JNum = { num: true, kind: 'big' };
const N_FLOAT: JNum = { num: true, kind: 'float' };

export type JVal = null | boolean | string | JNum | JVal[] | Map<string, JVal>;

class PErr extends Error {
  pos: number;
  constructor(msg: string, pos: number) {
    super(msg);
    this.pos = pos;
  }
}

function lineCol(text: string, pos: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  const end = Math.min(pos, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: pos - last };
}

const NUM_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Phân tích một hoặc nhiều tài liệu JSON liền nhau (NDJSON, nối bằng khoảng trắng/dấu phẩy). */
export function parseDocs(
  input: string
): { ok: true; docs: JVal[] } | { ok: false; error: ParseErrorInfo } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const n = text.length;
  let i = 0;

  const fail = (msg: string, pos = i): never => {
    throw new PErr(msg, pos);
  };
  const near = (): string =>
    i >= n ? 'hết dữ liệu' : `ký tự "${text[i] === '\n' ? '\\n' : text[i]}"`;
  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) i++;
      else break;
    }
  };

  const str = (): string => {
    const open = i;
    i++; // "
    const start = i;
    let out: string | null = null;
    let chunk = start;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        const tail = text.slice(chunk, i);
        i++;
        return out === null ? tail : out + tail;
      }
      if (c < 32) fail('Ký tự điều khiển chưa được escape trong chuỗi', i);
      if (c === 92) {
        out = (out ?? '') + text.slice(chunk, i);
        i++;
        const e = text[i];
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const hex = text.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Chuỗi escape \\u không hợp lệ', i - 1);
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            fail(`Chuỗi escape không hợp lệ "\\${e ?? ''}"`, i - 1);
        }
        i++;
        chunk = i;
        continue;
      }
      i++;
    }
    return fail('Chuỗi không được đóng bằng dấu "', open);
  };

  const value = (depth: number): JVal => {
    if (depth > MAX_DEPTH) fail(`JSON lồng quá sâu (hơn ${MAX_DEPTH} cấp)`);
    ws();
    if (i >= n) fail('Dữ liệu kết thúc đột ngột, thiếu giá trị');
    const c = text[i];
    if (c === '{') {
      i++;
      const map = new Map<string, JVal>();
      ws();
      if (text[i] === '}') {
        i++;
        return map;
      }
      for (;;) {
        ws();
        if (text[i] === '}') fail('Dấu phẩy thừa trước "}"');
        if (text[i] !== '"') fail(`Khóa của object phải là chuỗi trong dấu "...", gặp ${near()}`);
        const key = str();
        ws();
        if (text[i] !== ':') fail(`Thiếu dấu ":" sau khóa, gặp ${near()}`);
        i++;
        map.set(key, value(depth + 1));
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return map;
        }
        fail(`Mong đợi "," hoặc "}", gặp ${near()}`);
      }
    }
    if (c === '[') {
      i++;
      const arr: JVal[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        ws();
        if (text[i] === ']') fail('Dấu phẩy thừa trước "]"');
        arr.push(value(depth + 1));
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return arr;
        }
        fail(`Mong đợi "," hoặc "]", gặp ${near()}`);
      }
    }
    if (c === '"') return str();
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(text);
      if (!m) return fail('Số không hợp lệ');
      i += m[0].length;
      const tok = m[0];
      if (/[.eE]/.test(tok)) return N_FLOAT;
      if (tok.length >= 10 && Math.abs(Number(tok)) > 2147483647) return N_BIG;
      return N_INT;
    }
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    return fail(`Ký tự không hợp lệ "${c}"`);
  };

  try {
    const docs: JVal[] = [];
    for (;;) {
      ws();
      if (i >= n) break;
      if (docs.length >= MAX_DOCS) fail(`Quá nhiều tài liệu JSON (tối đa ${MAX_DOCS})`);
      docs.push(value(0));
      ws();
      if (text[i] === ',') i++;
    }
    return { ok: true, docs };
  } catch (e) {
    const pos = e instanceof PErr ? e.pos : i;
    const message = e instanceof PErr ? e.message : 'Không phân tích được JSON';
    const { line, col } = lineCol(text, pos);
    return { ok: false, error: { message, pos, line, col } };
  }
}

// ───────────────────────── Từ vựng / đặt tên ─────────────────────────

const WORD_RE = /\p{Lu}+\p{N}*(?=\p{Lu}\p{Ll})|\p{Lu}?[\p{Ll}\p{Lo}\p{Lm}]+\p{N}*|\p{Lu}+\p{N}*|\p{N}+[\p{Ll}\p{Lo}]*|\p{Lo}+/gu;

export function splitWords(s: string): string[] {
  return s.normalize('NFC').match(WORD_RE) ?? [];
}

const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

const GO_INITIALISMS = new Set([
  'id', 'url', 'uri', 'api', 'http', 'https', 'json', 'xml', 'html', 'sql', 'uuid', 'ip', 'tcp', 'udp',
  'tls', 'ssl', 'cpu', 'guid', 'ui', 'ascii', 'ram', 'dns', 'ssh', 'css', 'jwt', 'os', 'smtp', 'rpc',
  'ttl', 'acl', 'xss', 'vm', 'eof', 'sla', 'qps', 'utf8',
]);

function pascalFrom(words: string[], go = false): string {
  return words
    .map((w) => {
      const lw = w.toLowerCase();
      if (go) {
        if (GO_INITIALISMS.has(lw)) return lw.toUpperCase();
        if (lw.endsWith('s') && GO_INITIALISMS.has(lw.slice(0, -1))) return lw.slice(0, -1).toUpperCase() + 's';
      }
      return cap(lw);
    })
    .join('');
}
const camelFrom = (words: string[]) =>
  words.map((w, i) => (i === 0 ? w.toLowerCase() : cap(w.toLowerCase()))).join('');
const snakeFrom = (words: string[]) => words.map((w) => w.toLowerCase()).join('_');

const IRREGULAR: Record<string, string> = {
  people: 'person', children: 'child', men: 'man', women: 'woman', mice: 'mouse', geese: 'goose',
  feet: 'foot', teeth: 'tooth', indices: 'index', vertices: 'vertex', matrices: 'matrix',
  statuses: 'status', buses: 'bus', bonuses: 'bonus', campuses: 'campus', viruses: 'virus',
  movies: 'movie', cookies: 'cookie', zombies: 'zombie', selfies: 'selfie', calories: 'calorie',
  species: 'species', series: 'series', news: 'news', analyses: 'analysis', queries: 'query',
  addresses: 'address', aliases: 'alias', responses: 'response', licenses: 'license',
};

export function singularWord(w: string): string {
  const lw = w.toLowerCase();
  const irr = IRREGULAR[lw];
  let out: string;
  if (irr) out = irr;
  else if (lw.length > 3 && lw.endsWith('ies')) out = lw.slice(0, -3) + 'y';
  else if (/(ss|x|ch|sh)es$/.test(lw)) out = lw.slice(0, -2);
  else if (lw.length > 2 && lw.endsWith('s') && !/(ss|us|is)$/.test(lw)) out = lw.slice(0, -1);
  else return w;
  return w === w.toUpperCase() && w.length > 1 ? out.toUpperCase() : out;
}

const reIdentAscii = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const reIdentUni = /^[\p{L}_][\p{L}\p{N}_]*$/u;

// ───────────────────────── Suy luận kiểu ─────────────────────────

interface Shape {
  nul: boolean;
  bool: boolean;
  int: boolean;
  big: boolean;
  flt: boolean;
  str: boolean;
  dt: boolean;
  arr: Shape | null;
  obj: ObjShape | null;
  map: Shape | null;
}
interface ObjShape {
  count: number;
  fields: Map<string, { shape: Shape; count: number }>;
}
const newShape = (): Shape => ({
  nul: false, bool: false, int: false, big: false, flt: false, str: false, dt: false,
  arr: null, obj: null, map: null,
});

const DT_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/;
export const isDateTimeString = (s: string) => s.length >= 16 && s.length <= 40 && DT_RE.test(s);

const MAP_KEY_RE = /^(?:\d+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{24}|[0-9a-fA-F]{32})$/;
function looksLikeMap(m: Map<string, JVal>): boolean {
  if (m.size < 5) return false;
  for (const k of m.keys()) if (!MAP_KEY_RE.test(k)) return false;
  return true;
}

interface MergeCtx {
  nodes: number;
  truncated: boolean;
  dates: boolean;
  maps: boolean;
}

function mergeVal(s: Shape, v: JVal, c: MergeCtx): void {
  if (++c.nodes > MAX_NODES) {
    c.truncated = true;
    return;
  }
  if (v === null) s.nul = true;
  else if (typeof v === 'boolean') s.bool = true;
  else if (typeof v === 'string') {
    if (c.dates && isDateTimeString(v)) s.dt = true;
    else s.str = true;
  } else if (Array.isArray(v)) {
    const item = (s.arr ??= newShape());
    for (const x of v) {
      if (c.truncated) break;
      mergeVal(item, x, c);
    }
  } else if (v instanceof Map) {
    if (c.maps && looksLikeMap(v)) {
      const val = (s.map ??= newShape());
      for (const x of v.values()) mergeVal(val, x, c);
    } else {
      const o = (s.obj ??= { count: 0, fields: new Map() });
      o.count++;
      for (const [k, x] of v) {
        let f = o.fields.get(k);
        if (!f) {
          f = { shape: newShape(), count: 0 };
          o.fields.set(k, f);
        }
        f.count++;
        mergeVal(f.shape, x, c);
      }
    }
  } else {
    if (v.kind === 'float') s.flt = true;
    else {
      s.int = true;
      if (v.kind === 'big') s.big = true;
    }
  }
}

// IR sau khi chốt kiểu
interface Ty {
  k: 'any' | 'null' | 'bool' | 'int' | 'float' | 'str' | 'dt' | 'arr' | 'map' | 'obj' | 'union';
  nullable: boolean;
  big?: boolean;
  of?: Ty;
  m?: Model;
  alts?: Ty[];
}
interface Field {
  key: string;
  ty: Ty;
  optional: boolean;
}
interface Model {
  id: number;
  name: string;
  fields: Field[];
}

export interface Analysis {
  ok: true;
  samples: number;
  shape: Shape;
  truncated: boolean;
  opts: GenOptions;
}

/** Phân tích văn bản (1 hoặc nhiều tài liệu JSON) và gộp thành một "hình dạng" chung. */
export function analyze(
  text: string,
  opts: GenOptions
): Analysis | { ok: false; error: string; pos?: number; line?: number; col?: number } {
  if (!text.trim()) return { ok: false, error: 'Chưa có dữ liệu JSON.' };
  if (text.length > MAX_INPUT_CHARS)
    return { ok: false, error: `Dữ liệu quá lớn (tối đa ${Math.round(MAX_INPUT_CHARS / 1048576)} MB).` };
  const parsed = parseDocs(text);
  if (!parsed.ok) {
    const e = parsed.error;
    return { ok: false, error: `${e.message} (dòng ${e.line}, cột ${e.col})`, pos: e.pos, line: e.line, col: e.col };
  }
  const c: MergeCtx = { nodes: 0, truncated: false, dates: opts.detectDates, maps: opts.detectMaps };
  const shape = newShape();
  let samples = 0;
  for (const d of parsed.docs) {
    if (opts.unwrapRoot && Array.isArray(d)) {
      for (const x of d) {
        if (c.truncated) break;
        mergeVal(shape, x, c);
        samples++;
      }
    } else {
      mergeVal(shape, d, c);
      samples++;
    }
    if (c.truncated) break;
  }
  if (samples === 0) {
    // mảng gốc rỗng
    shape.arr = null;
    return { ok: true, samples: 0, shape, truncated: false, opts };
  }
  return { ok: true, samples, shape, truncated: c.truncated, opts };
}

// ───────────────────────── Chốt kiểu + đặt tên model ─────────────────────────

const RESERVED_TYPES: Record<Lang, string[]> = {
  typescript: ['Date', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Record', 'Map', 'Set', 'Promise', 'Function', 'Symbol', 'Error', 'Partial', 'Readonly'],
  go: ['Time'],
  python: ['List', 'Dict', 'Optional', 'Union', 'Any', 'BaseModel', 'Field', 'TypedDict', 'NotRequired', 'ConfigDict'],
  kotlin: ['String', 'Int', 'Long', 'Double', 'Boolean', 'List', 'Map', 'Any', 'Instant', 'Serializable', 'SerialName', 'JsonElement', 'Unit', 'Nothing', 'Array', 'Set', 'Pair'],
  rust: ['String', 'Vec', 'Option', 'HashMap', 'Box', 'Result', 'Value', 'DateTime', 'Utc', 'Serialize', 'Deserialize', 'Self'],
  java: ['String', 'Object', 'List', 'Map', 'Integer', 'Long', 'Double', 'Boolean', 'Instant', 'Record', 'Class', 'Number', 'Void', 'JsonProperty', 'Optional', 'Set', 'Math', 'System', 'Thread', 'Date'],
  csharp: ['String', 'Object', 'List', 'Dictionary', 'DateTime', 'Int32', 'Int64', 'Boolean', 'Double', 'Task', 'Type', 'Array', 'Attribute', 'JsonPropertyName', 'Enum', 'Exception', 'Math', 'Guid'],
  zod: ['Date', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Record', 'Map', 'Set'],
  jsonschema: [],
  sql: [],
};

interface Built {
  root: Ty;
  models: Model[]; // thứ tự hậu tố: kiểu con trước, root (nếu là object) cuối
  rootModel: Model | null;
  rootName: string;
}

function cleanRootName(name: string): string {
  const t = name.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return t;
  const p = pascalFrom(splitWords(t));
  if (!p) return 'Root';
  return /^\p{N}/u.test(p) ? 'T' + p : p;
}

function tySig(t: Ty): string {
  const n = t.nullable ? '?' : '';
  switch (t.k) {
    case 'arr':
    case 'map':
      return `${t.k}<${tySig(t.of as Ty)}>${n}`;
    case 'obj':
      return `#${(t.m as Model).id}${n}`;
    case 'union':
      return `U(${(t.alts as Ty[]).map(tySig).join('|')})${n}`;
    case 'int':
      return (t.big ? 'I64' : 'I32') + n;
    default:
      return t.k + n;
  }
}

function build(a: Analysis, lang: Lang): Built {
  const opts = a.opts;
  const rootName = cleanRootName(opts.rootName);
  const used = new Set<string>([rootName]);
  const reserved = new Set(RESERVED_TYPES[lang]);
  const bySig = new Map<string, Model>();
  const models: Model[] = [];
  let nextId = 1;

  const allocName = (words: string[], isRoot: boolean): string => {
    if (isRoot) return rootName;
    let base = pascalFrom(words);
    if (!base) base = 'Item';
    if (/^\p{N}/u.test(base)) base = 'T' + base;
    if (reserved.has(base)) base += 'Type';
    let name = base;
    let i = 2;
    while (used.has(name)) name = base + i++;
    used.add(name);
    return name;
  };

  const singularWords = (w: string[]): string[] => {
    if (w.length === 0) return ['item'];
    const last = w[w.length - 1];
    const s = singularWord(last);
    if (s === last) return [...w, 'item'];
    return [...w.slice(0, -1), s];
  };

  const fin = (s: Shape, hint: string[], path: string[], isRoot: boolean): Ty => {
    const alts: Ty[] = [];
    if (s.str || s.dt) alts.push({ k: s.str || !s.dt ? 'str' : 'dt', nullable: false });
    if (s.int || s.flt) {
      if (s.flt || !opts.splitNumbers) alts.push({ k: 'float', nullable: false });
      else alts.push({ k: 'int', nullable: false, big: s.big });
    }
    if (s.bool) alts.push({ k: 'bool', nullable: false });
    if (s.arr) {
      const ih = singularWords(hint);
      const ip = path.length ? singularWords(path) : ih;
      alts.push({ k: 'arr', nullable: false, of: fin(s.arr, isRoot ? [...splitWords(rootName), 'item'] : ih, isRoot ? [] : ip, false) });
    }
    if (s.map) {
      alts.push({ k: 'map', nullable: false, of: fin(s.map, [...hint, 'value'], [...path, 'value'], false) });
    } else if (s.obj) {
      const o = s.obj;
      const fields: Field[] = [];
      for (const [key, f] of o.fields) {
        const kw = splitWords(key);
        fields.push({
          key,
          ty: fin(f.shape, kw, [...path, ...kw], false),
          optional: f.count < o.count,
        });
      }
      const sig = [...fields]
        .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
        .map((f) => `${JSON.stringify(f.key)}${f.optional ? '?' : ''}:${tySig(f.ty)}`)
        .join(',');
      let m = isRoot ? undefined : bySig.get(sig);
      if (!m) {
        const words = opts.naming === 'path' && path.length ? path : hint;
        m = { id: nextId++, name: allocName(words, isRoot), fields };
        if (!isRoot) bySig.set(sig, m);
        models.push(m);
      }
      alts.push({ k: 'obj', nullable: false, m });
    }
    if (alts.length === 0) return s.nul ? { k: 'null', nullable: false } : { k: 'any', nullable: false };
    if (alts.length === 1) return { ...alts[0], nullable: s.nul };
    return { k: 'union', nullable: s.nul, alts };
  };

  let root: Ty;
  if (a.samples === 0) root = { k: 'arr', nullable: false, of: { k: 'any', nullable: false } };
  else root = fin(a.shape, splitWords(rootName), [], true);
  const rootModel = root.k === 'obj' && !root.nullable ? (root.m as Model) : null;
  return { root, models, rootModel, rootName };
}

// ───────────────────────── Tiện ích render ─────────────────────────

interface FInfo {
  f: Field;
  name: string;
  renamed: boolean;
}

function namedFields(m: Model, conv: (key: string) => string, avoid?: string): FInfo[] {
  const taken = new Set<string>();
  if (avoid) taken.add(avoid);
  return m.fields.map((f) => {
    const base = conv(f.key);
    let n = base;
    let i = 2;
    while (taken.has(n)) n = base + i++;
    taken.add(n);
    return { f, name: n, renamed: n !== f.key };
  });
}

const camelName = (kw: Set<string>) => (key: string) => {
  let n = camelFrom(splitWords(key)) || 'field';
  if (/^\p{N}/u.test(n)) n = '_' + n;
  return kw.has(n) ? n + '_' : n;
};
const snakeName = (kw: Set<string>) => (key: string) => {
  let n = snakeFrom(splitWords(key)) || 'field';
  if (/^\p{N}/u.test(n)) n = '_' + n;
  return kw.has(n) ? n + '_' : n;
};

const q = (s: string) => JSON.stringify(s);
const indent = (s: string, n = 2) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');
const tsKey = (k: string) => (reIdentAscii.test(k) ? k : q(k));

// ───────────────────────── Render: TypeScript ─────────────────────────

function renderTS(b: Built, o: GenOptions): string {
  const any = o.tsAny;
  const t = (ty: Ty): string => {
    let s: string;
    switch (ty.k) {
      case 'any': return any;
      case 'null': return 'null';
      case 'bool': s = 'boolean'; break;
      case 'int': case 'float': s = 'number'; break;
      case 'str': s = 'string'; break;
      case 'dt': s = 'Date'; break;
      case 'arr': {
        const e = ty.of as Ty;
        const inner = t(e);
        s = e.k === 'union' || (e.nullable && e.k !== 'any') ? `(${inner})[]` : `${inner}[]`;
        break;
      }
      case 'map': s = `Record<string, ${t(ty.of as Ty)}>`; break;
      case 'obj': s = (ty.m as Model).name; break;
      default: s = (ty.alts as Ty[]).map(t).join(' | ');
    }
    return ty.nullable ? `${s} | null` : s;
  };
  const exp = o.exportTypes ? 'export ' : '';
  const ro = o.readonly ? 'readonly ' : '';
  const out: string[] = [];
  const ordered = [...b.models].reverse();
  const rootAlias = !b.rootModel ? `${exp}type ${b.rootName} = ${t(b.root)};` : null;
  if (rootAlias) out.push(rootAlias);
  for (const m of ordered) {
    const lines = m.fields.map((f) => `  ${ro}${tsKey(f.key)}${f.optional ? '?' : ''}: ${t(f.ty)};`);
    const body = lines.length ? `\n${lines.join('\n')}\n` : '';
    out.push(
      o.tsDecl === 'interface'
        ? `${exp}interface ${m.name} {${body}}`
        : `${exp}type ${m.name} = {${body}};`
    );
  }
  return out.join('\n\n') + '\n';
}

// ───────────────────────── Render: Go ─────────────────────────

function renderGo(b: Built): string {
  let usesTime = false;
  const t = (ty: Ty): string => {
    let s: string;
    let ptr = true;
    switch (ty.k) {
      case 'any': case 'null': case 'union': return 'interface{}';
      case 'bool': s = 'bool'; break;
      case 'int': s = ty.big ? 'int64' : 'int'; break;
      case 'float': s = 'float64'; break;
      case 'str': s = 'string'; break;
      case 'dt': s = 'time.Time'; usesTime = true; break;
      case 'arr': s = '[]' + t(ty.of as Ty); ptr = false; break;
      case 'map': s = 'map[string]' + t(ty.of as Ty); ptr = false; break;
      default: s = (ty.m as Model).name;
    }
    return ty.nullable && ptr ? '*' + s : s;
  };
  const goName = (key: string) => {
    let n = pascalFrom(splitWords(key), true) || 'Field';
    const first = [...n][0];
    if (!(first.toUpperCase() === first && first.toLowerCase() !== first)) n = 'X' + n;
    return n;
  };
  const tag = (key: string, optional: boolean) => {
    const inner = `json:${q(key + (optional ? ',omitempty' : ''))}`;
    return inner.includes('`') ? q(inner) : '`' + inner + '`';
  };
  const blocks: string[] = [];
  if (!b.rootModel) blocks.push(`type ${b.rootName} ${t(b.root)}`);
  for (const m of [...b.models].reverse()) {
    const infos = namedFields(m, goName);
    const rows = infos.map((i) => [i.name, t(i.f.ty), tag(i.f.key, i.f.optional)]);
    const w0 = Math.max(0, ...rows.map((r) => r[0].length));
    const w1 = Math.max(0, ...rows.map((r) => r[1].length));
    const lines = rows.map((r) => `\t${r[0].padEnd(w0)} ${r[1].padEnd(w1)} ${r[2]}`);
    blocks.push(`type ${m.name} struct {\n${lines.join('\n')}${lines.length ? '\n' : ''}}`);
  }
  const head = `package model\n\n${usesTime ? 'import "time"\n\n' : ''}`;
  return head + blocks.join('\n\n') + '\n';
}

// ───────────────────────── Render: Python ─────────────────────────

const PY_KW = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);
const PYDANTIC_BAD = new Set(['json', 'dict', 'copy', 'schema', 'validate', 'construct', 'fields', 'model_config', 'schema_json']);

function renderPython(b: Built, o: GenOptions): string {
  const imp = { Any: false, List: false, Dict: false, Optional: false, Union: false, datetime: false, NotRequired: false };
  const t = (ty: Ty): string => {
    let s: string;
    switch (ty.k) {
      case 'any': imp.Any = true; return 'Any';
      case 'null': return 'None';
      case 'bool': s = 'bool'; break;
      case 'int': s = 'int'; break;
      case 'float': s = 'float'; break;
      case 'str': s = 'str'; break;
      case 'dt': s = 'datetime'; imp.datetime = true; break;
      case 'arr': imp.List = true; s = `List[${t(ty.of as Ty)}]`; break;
      case 'map': imp.Dict = true; s = `Dict[str, ${t(ty.of as Ty)}]`; break;
      case 'obj': s = (ty.m as Model).name; break;
      default: imp.Union = true; s = `Union[${(ty.alts as Ty[]).map(t).join(', ')}]`;
    }
    if (ty.nullable) {
      imp.Optional = true;
      return `Optional[${s}]`;
    }
    return s;
  };
  const optT = (f: Field) => {
    const s = t(f.ty);
    if (f.optional && !s.startsWith('Optional[') && s !== 'Any') {
      imp.Optional = true;
      return `Optional[${s}]`;
    }
    return s;
  };
  const style = o.pyStyle;
  const pyName = (key: string) => {
    const bad = style === 'pydantic' ? key.startsWith('_') || PYDANTIC_BAD.has(key) || key.startsWith('model_') : false;
    if (reIdentUni.test(key) && !PY_KW.has(key) && !bad) return key;
    if (PY_KW.has(key) || PYDANTIC_BAD.has(key) || key.startsWith('model_')) return key + '_';
    let n = snakeFrom(splitWords(key)) || 'field';
    if (/^\p{N}/u.test(n) || (style === 'pydantic' && n.startsWith('_'))) n = (style === 'pydantic' ? 'f_' : '_') + n;
    return PY_KW.has(n) ? n + '_' : n;
  };
  const blocks: string[] = [];
  let usesField = false;
  let usesBase = false, usesDC = false, usesTD = false, usesCfg = false;
  for (const m of b.models) {
    const infos = namedFields(m, pyName);
    if (style === 'dataclass') {
      usesDC = true;
      const sorted = [...infos.filter((i) => !i.f.optional), ...infos.filter((i) => i.f.optional)];
      const lines = sorted.map((i) => {
        const c = i.renamed ? `  # json: ${q(i.f.key)}` : '';
        return `    ${i.name}: ${optT(i.f)}${i.f.optional ? ' = None' : ''}${c}`;
      });
      blocks.push(`@dataclass${o.readonly ? '(frozen=True)' : ''}\nclass ${m.name}:\n${lines.join('\n') || '    pass'}`);
    } else if (style === 'typeddict') {
      usesTD = true;
      const tdT = (f: Field) => {
        const s = t(f.ty);
        if (f.optional) { imp.NotRequired = true; return `NotRequired[${s}]`; }
        return s;
      };
      if (infos.some((i) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(i.f.key) || PY_KW.has(i.f.key))) {
        const items = m.fields.map((f) => `    ${q(f.key)}: ${tdT(f)},`);
        blocks.push(`${m.name} = TypedDict(${q(m.name)}, {\n${items.join('\n')}\n})`);
      } else {
        const lines = m.fields.map((f) => `    ${f.key}: ${tdT(f)}`);
        blocks.push(`class ${m.name}(TypedDict):\n${lines.join('\n') || '    pass'}`);
      }
    } else {
      usesBase = true;
      const cfg: string[] = [];
      if (o.readonly) cfg.push('frozen=True');
      if (infos.some((i) => i.renamed)) cfg.push('populate_by_name=True');
      const lines: string[] = [];
      if (cfg.length) { usesCfg = true; lines.push(`    model_config = ConfigDict(${cfg.join(', ')})`); }
      for (const i of infos) {
        const args: string[] = [];
        if (i.f.optional) args.push('default=None');
        if (i.renamed) args.push(`alias=${q(i.f.key)}`);
        let rhs = '';
        if (i.renamed) { usesField = true; rhs = ` = Field(${args.join(', ')})`; }
        else if (i.f.optional) rhs = ' = None';
        lines.push(`    ${i.name}: ${optT(i.f)}${rhs}`);
      }
      blocks.push(`class ${m.name}(BaseModel):\n${lines.join('\n') || '    pass'}`);
    }
  }
  if (!b.rootModel) blocks.push(`${b.rootName} = ${t(b.root)}`);
  const head: string[] = [];
  if (usesDC) head.push('from dataclasses import dataclass');
  if (imp.datetime) head.push('from datetime import datetime');
  const typing = [imp.Any && 'Any', imp.Dict && 'Dict', imp.List && 'List', imp.NotRequired && 'NotRequired', imp.Optional && 'Optional', usesTD && 'TypedDict', imp.Union && 'Union'].filter(Boolean);
  if (typing.length) head.push(`from typing import ${typing.join(', ')}`);
  if (usesBase) head.push(`from pydantic import ${['BaseModel', usesCfg && 'ConfigDict', usesField && 'Field'].filter(Boolean).join(', ')}`);
  const note = imp.NotRequired ? '# NotRequired cần Python 3.11+ (hoặc typing_extensions)\n' : '';
  return `${head.join('\n')}${head.length ? '\n\n\n' : ''}${note}${blocks.join('\n\n\n')}\n`;
}

// ───────────────────────── Render: Kotlin ─────────────────────────

const KT_KW = new Set(['as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while']);

function renderKotlin(b: Built, o: GenOptions): string {
  const ser = o.kotlinSerial;
  let usesInstant = false, usesJsonEl = false, usesSerialName = false;
  const t = (ty: Ty): string => {
    let s: string;
    switch (ty.k) {
      case 'any': case 'null': case 'union':
        if (ser) { usesJsonEl = true; return 'JsonElement'; }
        return 'Any?';
      case 'bool': s = 'Boolean'; break;
      case 'int': s = ty.big ? 'Long' : 'Int'; break;
      case 'float': s = 'Double'; break;
      case 'str': s = 'String'; break;
      case 'dt': s = 'Instant'; usesInstant = true; break;
      case 'arr': s = `List<${t(ty.of as Ty)}>`; break;
      case 'map': s = `Map<String, ${t(ty.of as Ty)}>`; break;
      default: s = (ty.m as Model).name;
    }
    return ty.nullable ? s + '?' : s;
  };
  const blocks: string[] = [];
  if (!b.rootModel) blocks.push(`typealias ${b.rootName} = ${t(b.root)}`);
  for (const m of [...b.models].reverse()) {
    const infos = namedFields(m, camelName(KT_KW));
    const ann = ser ? '@Serializable\n' : '';
    if (infos.length === 0) {
      blocks.push(`${ann}class ${m.name}`);
      continue;
    }
    const lines = infos.map((i) => {
      let ty = t(i.f.ty);
      if (i.f.optional && !ty.endsWith('?') && !ty.startsWith('JsonElement')) ty += '?';
      const def = i.f.optional ? ' = null' : '';
      let pre = '';
      let post = '';
      if (i.renamed) {
        if (ser) { pre = `@SerialName(${q(i.f.key)}) `; usesSerialName = true; }
        else post = ` // json: ${q(i.f.key)}`;
      }
      return `    ${pre}val ${i.name}: ${ty}${def},${post}`;
    });
    blocks.push(`${ann}data class ${m.name}(\n${lines.join('\n')}\n)`);
  }
  const imps: string[] = [];
  if (usesInstant) imps.push('import kotlinx.datetime.Instant');
  if (ser) {
    if (usesSerialName) imps.push('import kotlinx.serialization.SerialName');
    if (b.models.length) imps.push('import kotlinx.serialization.Serializable');
    if (usesJsonEl) imps.push('import kotlinx.serialization.json.JsonElement');
  }
  imps.sort();
  return (imps.length ? imps.join('\n') + '\n\n' : '') + blocks.join('\n\n') + '\n';
}

// ───────────────────────── Render: Rust ─────────────────────────

const RS_KW = new Set(['as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'async', 'await', 'dyn', 'abstract', 'become', 'box', 'do', 'final', 'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield', 'try']);

function renderRust(b: Built, o: GenOptions): string {
  let usesChrono = false, usesMap = false;
  const VAL = 'serde_json::Value';
  const t = (ty: Ty): string => {
    let s: string;
    switch (ty.k) {
      case 'any': case 'null': case 'union': return VAL;
      case 'bool': s = 'bool'; break;
      case 'int': s = ty.big ? 'i64' : 'i32'; break;
      case 'float': s = 'f64'; break;
      case 'str': s = 'String'; break;
      case 'dt': s = 'DateTime<Utc>'; usesChrono = true; break;
      case 'arr': s = `Vec<${t(ty.of as Ty)}>`; break;
      case 'map': s = `HashMap<String, ${t(ty.of as Ty)}>`; usesMap = true; break;
      default: s = (ty.m as Model).name;
    }
    return ty.nullable ? `Option<${s}>` : s;
  };
  const pub = o.exportTypes ? 'pub ' : '';
  const blocks: string[] = [];
  if (!b.rootModel) blocks.push(`${pub}type ${b.rootName} = ${t(b.root)};`);
  for (const m of [...b.models].reverse()) {
    const infos = namedFields(m, snakeName(RS_KW));
    const lines: string[] = [];
    for (const i of infos) {
      let ty = t(i.f.ty);
      if (i.f.optional && !ty.startsWith('Option<') && ty !== VAL) ty = `Option<${ty}>`;
      const attrs: string[] = [];
      if (i.renamed) attrs.push(`rename = ${q(i.f.key)}`);
      if (i.f.optional) attrs.push(ty === VAL ? 'default, skip_serializing_if = "Value::is_null"' : 'default, skip_serializing_if = "Option::is_none"');
      if (attrs.length) lines.push(`    #[serde(${attrs.join(', ')})]`);
      lines.push(`    ${pub}${i.name}: ${ty},`);
    }
    blocks.push(`#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n${pub}struct ${m.name} {\n${lines.join('\n')}${lines.length ? '\n' : ''}}`);
  }
  const head = ['use serde::{Deserialize, Serialize};'];
  if (usesMap) head.unshift('use std::collections::HashMap;');
  if (usesChrono) head.push('use chrono::{DateTime, Utc};');
  if (blocks.join('').includes('Value::is_null')) head.push('use serde_json::Value;');
  return head.join('\n') + '\n\n' + blocks.join('\n\n') + '\n';
}

// ───────────────────────── Render: Java ─────────────────────────

const JAVA_KW = new Set(['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null', '_', 'record', 'var', 'yield']);

function renderJava(b: Built): string {
  let usesList = false, usesMap = false, usesInstant = false, usesProp = false;
  const t = (ty: Ty, boxed: boolean): string => {
    const bx = boxed || ty.nullable;
    switch (ty.k) {
      case 'bool': return bx ? 'Boolean' : 'boolean';
      case 'int': return ty.big ? (bx ? 'Long' : 'long') : bx ? 'Integer' : 'int';
      case 'float': return bx ? 'Double' : 'double';
      case 'str': return 'String';
      case 'dt': usesInstant = true; return 'Instant';
      case 'arr': usesList = true; return `List<${t(ty.of as Ty, true)}>`;
      case 'map': usesMap = true; return `Map<String, ${t(ty.of as Ty, true)}>`;
      case 'obj': return (ty.m as Model).name;
      default: return 'Object';
    }
  };
  const blocks: string[] = [];
  if (!b.rootModel) blocks.push(`// ${b.rootName} = ${t(b.root, false)}`);
  for (const m of [...b.models].reverse()) {
    const infos = namedFields(m, camelName(JAVA_KW));
    const parts = infos.map((i) => {
      let pre = '';
      if (i.renamed) { usesProp = true; pre = `@JsonProperty(${q(i.f.key)}) `; }
      return `    ${pre}${t(i.f.ty, i.f.optional)} ${i.name}`;
    });
    blocks.push(parts.length ? `record ${m.name}(\n${parts.join(',\n')}\n) {}` : `record ${m.name}() {}`);
  }
  const imps: string[] = [];
  if (usesProp) imps.push('import com.fasterxml.jackson.annotation.JsonProperty;');
  if (usesInstant) imps.push('import java.time.Instant;');
  if (usesList) imps.push('import java.util.List;');
  if (usesMap) imps.push('import java.util.Map;');
  return (imps.length ? imps.join('\n') + '\n\n' : '') + blocks.join('\n\n') + '\n';
}

// ───────────────────────── Render: C# ─────────────────────────

function renderCSharp(b: Built, o: GenOptions): string {
  let usesColl = false;
  const t = (ty: Ty): string => {
    let s: string;
    switch (ty.k) {
      case 'any': case 'null': case 'union': return 'object?';
      case 'bool': s = 'bool'; break;
      case 'int': s = ty.big ? 'long' : 'int'; break;
      case 'float': s = 'double'; break;
      case 'str': s = 'string'; break;
      case 'dt': s = 'DateTime'; break;
      case 'arr': s = `List<${t(ty.of as Ty)}>`; usesColl = true; break;
      case 'map': s = `Dictionary<string, ${t(ty.of as Ty)}>`; usesColl = true; break;
      default: s = (ty.m as Model).name;
    }
    return ty.nullable ? s + '?' : s;
  };
  const csName = (key: string) => {
    const n = pascalFrom(splitWords(key)) || 'Field';
    return /^\p{N}/u.test(n) ? 'N' + n : n;
  };
  const acc = o.readonly ? '{ get; init; }' : '{ get; set; }';
  const blocks: string[] = [];
  if (!b.rootModel) blocks.push(`// ${b.rootName} = ${t(b.root)}`);
  for (const m of [...b.models].reverse()) {
    const infos = namedFields(m, csName, m.name);
    const lines = infos.map((i) => {
      let ty = t(i.f.ty);
      if (i.f.optional && !ty.endsWith('?')) ty += '?';
      return `    [JsonPropertyName(${q(i.f.key)})]\n    public ${ty} ${i.name} ${acc}`;
    });
    blocks.push(`public class ${m.name}\n{\n${lines.join('\n\n')}\n}`);
  }
  const head = ['using System.Text.Json.Serialization;'];
  if (usesColl) head.unshift('using System.Collections.Generic;');
  if (b.models.length && blocks.join('').includes('DateTime')) head.unshift('using System;');
  head.sort();
  return head.join('\n') + '\n\n' + blocks.join('\n\n') + '\n';
}

// ───────────────────────── Render: Zod ─────────────────────────

function renderZod(b: Built, o: GenOptions): string {
  const t = (ty: Ty): string => {
    let s: string;
    switch (ty.k) {
      case 'any': return o.tsAny === 'any' ? 'z.any()' : 'z.unknown()';
      case 'null': return 'z.null()';
      case 'bool': s = 'z.boolean()'; break;
      case 'int': s = 'z.number().int()'; break;
      case 'float': s = 'z.number()'; break;
      case 'str': s = 'z.string()'; break;
      case 'dt': s = 'z.coerce.date()'; break;
      case 'arr': s = `z.array(${t(ty.of as Ty)})`; break;
      case 'map': s = `z.record(z.string(), ${t(ty.of as Ty)})`; break;
      case 'obj': s = (ty.m as Model).name + 'Schema'; break;
      default: s = `z.union([${(ty.alts as Ty[]).map(t).join(', ')}])`;
    }
    return ty.nullable ? s + '.nullable()' : s;
  };
  const exp = o.exportTypes ? 'export ' : '';
  const blocks: string[] = [];
  for (const m of b.models) {
    const lines = m.fields.map((f) => `  ${tsKey(f.key)}: ${t(f.ty)}${f.optional ? '.optional()' : ''},`);
    const body = lines.length ? `\n${lines.join('\n')}\n` : '';
    blocks.push(
      `${exp}const ${m.name}Schema = z.object({${body}})${o.readonly ? '.readonly()' : ''};\n${exp}type ${m.name} = z.infer<typeof ${m.name}Schema>;`
    );
  }
  if (!b.rootModel) {
    blocks.push(`${exp}const ${b.rootName}Schema = ${t(b.root)};\n${exp}type ${b.rootName} = z.infer<typeof ${b.rootName}Schema>;`);
  }
  return `import { z } from "zod";\n\n${blocks.join('\n\n')}\n`;
}

// ───────────────────────── Render: JSON Schema ─────────────────────────

type Dict = Record<string, unknown>;
const dict = (): Dict => Object.create(null) as Dict;

function renderJsonSchema(b: Built): string {
  const sch = (ty: Ty): Dict => {
    let s = dict();
    let simple: string | null = null;
    switch (ty.k) {
      case 'any': return dict();
      case 'null': s.type = 'null'; return s;
      case 'bool': simple = 'boolean'; s.type = simple; break;
      case 'int': simple = 'integer'; s.type = simple; break;
      case 'float': simple = 'number'; s.type = simple; break;
      case 'str': simple = 'string'; s.type = simple; break;
      case 'dt': simple = 'string'; s.type = simple; s.format = 'date-time'; break;
      case 'arr': s.type = 'array'; s.items = sch(ty.of as Ty); break;
      case 'map': s.type = 'object'; s.additionalProperties = sch(ty.of as Ty); break;
      case 'obj': s['$ref'] = `#/$defs/${(ty.m as Model).name}`; break;
      default: s.anyOf = (ty.alts as Ty[]).map(sch);
    }
    if (ty.nullable) {
      if (simple) s.type = [simple, 'null'];
      else {
        const wrap = dict();
        wrap.anyOf = [s, { type: 'null' }];
        s = wrap;
      }
    }
    return s;
  };
  const modelSchema = (m: Model): Dict => {
    const s = dict();
    s.type = 'object';
    const props = dict();
    const req: string[] = [];
    for (const f of m.fields) {
      props[f.key] = sch(f.ty);
      if (!f.optional) req.push(f.key);
    }
    s.properties = props;
    if (req.length) s.required = req;
    return s;
  };
  const out = dict();
  out['$schema'] = 'https://json-schema.org/draft/2020-12/schema';
  out.title = b.rootName;
  const body = b.rootModel ? modelSchema(b.rootModel) : sch(b.root);
  for (const k of Object.keys(body)) out[k] = body[k];
  const defs = dict();
  for (const m of b.models) if (m !== b.rootModel) defs[m.name] = modelSchema(m);
  if (Object.keys(defs).length) out['$defs'] = defs;
  return JSON.stringify(out, null, 2) + '\n';
}

// ───────────────────────── Render: SQL ─────────────────────────

function renderSql(b: Built, o: GenOptions, warnings: string[]): string | null {
  const m = b.rootModel;
  if (!m) return null;
  const d = o.sqlDialect;
  const qi = (s: string) => (d === 'mysql' ? '`' + s.replace(/`/g, '``') + '`' : '"' + s.replace(/"/g, '""') + '"');
  const types = {
    int: { postgres: 'INTEGER', mysql: 'INT', sqlite: 'INTEGER' },
    big: { postgres: 'BIGINT', mysql: 'BIGINT', sqlite: 'INTEGER' },
    float: { postgres: 'DOUBLE PRECISION', mysql: 'DOUBLE', sqlite: 'REAL' },
    bool: { postgres: 'BOOLEAN', mysql: 'BOOLEAN', sqlite: 'INTEGER' },
    str: { postgres: 'TEXT', mysql: 'VARCHAR(255)', sqlite: 'TEXT' },
    dt: { postgres: 'TIMESTAMPTZ', mysql: 'DATETIME', sqlite: 'TEXT' },
    json: { postgres: 'JSONB', mysql: 'JSON', sqlite: 'TEXT' },
  };
  const tableName = snakeFrom(splitWords(b.rootName)) || 'root';
  const names = namedFields(m, (k) => snakeFrom(splitWords(k)) || 'col');
  let nested = false;
  const cols = names.map((i) => {
    const ty = i.f.ty;
    let sqlT: string;
    switch (ty.k) {
      case 'int': sqlT = types[ty.big ? 'big' : 'int'][d]; break;
      case 'float': sqlT = types.float[d]; break;
      case 'bool': sqlT = types.bool[d]; break;
      case 'str': sqlT = types.str[d]; break;
      case 'dt': sqlT = types.dt[d]; break;
      default: sqlT = types.json[d]; nested = true;
    }
    const nullable = ty.nullable || i.f.optional || ty.k === 'null';
    const pk = i.name === 'id' && !nullable && (ty.k === 'int' || ty.k === 'str');
    let line = `  ${qi(i.name)} ${sqlT}`;
    if (pk) line += ' PRIMARY KEY';
    else if (!nullable) line += ' NOT NULL';
    return { line, comment: i.renamed ? ` -- json: ${q(i.f.key)}` : '' };
  });
  if (nested) warnings.push('Object/mảng/kiểu hỗn hợp được lưu vào cột JSON (SQL chỉ hỗ trợ object phẳng).');
  const body = cols.map((c, idx) => c.line + (idx < cols.length - 1 ? ',' : '') + c.comment).join('\n');
  return `CREATE TABLE ${qi(tableName)} (\n${body}\n);\n`;
}

// ───────────────────────── Điểm vào ─────────────────────────

/** Sinh mã từ kết quả `analyze` cho một ngôn ngữ. */
export function render(a: Analysis, lang: Lang): GenResult {
  try {
    const o = a.opts;
    const b = build(a, lang);
    const warnings: string[] = [];
    if (a.truncated) warnings.push('Dữ liệu quá lớn: chỉ phân tích phần đầu để tránh treo trình duyệt.');
    if (a.samples === 0) warnings.push('Mảng gốc rỗng: không có mẫu để suy luận kiểu.');
    let code: string | null;
    switch (lang) {
      case 'typescript': code = renderTS(b, o); break;
      case 'go': code = renderGo(b); break;
      case 'python': code = renderPython(b, o); break;
      case 'kotlin': code = renderKotlin(b, o); break;
      case 'rust': code = renderRust(b, o); break;
      case 'java': code = renderJava(b); break;
      case 'csharp': code = renderCSharp(b, o); break;
      case 'zod': code = renderZod(b, o); break;
      case 'jsonschema': code = renderJsonSchema(b); break;
      case 'sql': code = renderSql(b, o, warnings); break;
    }
    if (code === null) {
      return { ok: false, error: 'SQL chỉ hỗ trợ khi JSON gốc là object (hoặc mảng các object) phẳng.' };
    }
    if (!b.rootModel && lang !== 'typescript' && lang !== 'zod' && lang !== 'jsonschema') {
      if (lang === 'java' || lang === 'csharp') warnings.push('JSON gốc không phải object: ngôn ngữ này không có type alias nên chỉ ghi chú kiểu gốc.');
    }
    let fields = 0, optionalFields = 0, nullableFields = 0;
    for (const m of b.models) {
      for (const f of m.fields) {
        fields++;
        if (f.optional) optionalFields++;
        if (f.ty.nullable) nullableFields++;
      }
    }
    return {
      ok: true,
      code,
      stats: { samples: a.samples, models: b.models.length, fields, optionalFields, nullableFields },
      warnings,
    };
  } catch {
    return { ok: false, error: 'Không thể sinh mã từ dữ liệu này.' };
  }
}

/** Tiện ích một bước: phân tích + sinh mã. */
export function generate(text: string, lang: Lang, opts: Partial<GenOptions> = {}): GenResult {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const a = analyze(text, o);
  if (!a.ok) return a;
  return render(a, lang);
}

/** Tên file gợi ý khi tải xuống. */
export function suggestFileName(lang: Lang, rootName: string): string {
  const info = LANGS.find((l) => l.id === lang);
  const root = cleanRootName(rootName);
  const pascalLangs: Lang[] = ['java', 'csharp', 'kotlin'];
  const base = pascalLangs.includes(lang) ? root : snakeFrom(splitWords(root)) || 'model';
  return `${base}.${info?.ext ?? 'txt'}`;
}

// ───────────────────────── Mẫu ─────────────────────────

export const SAMPLES: { id: string; label: string; json: string }[] = [
  {
    id: 'user',
    label: 'Người dùng',
    json: `{
  "id": 1024,
  "user_name": "nguyen.van.a",
  "email": "a@example.com",
  "score": 9.5,
  "isActive": true,
  "avatarURL": null,
  "createdAt": "2024-05-12T08:30:00Z",
  "tags": ["dev", "vn"],
  "address": { "street": "12 Lê Lợi", "city": "Hà Nội", "zip": "100000" },
  "friends": [
    { "id": 1, "name": "Bình" },
    { "id": 2, "name": "Chi" }
  ]
}`,
  },
  {
    id: 'multi',
    label: 'Nhiều mẫu (optional)',
    json: `[
  { "id": 1, "name": "Áo thun", "price": 199000, "discount": 0.1, "tags": ["new"] },
  { "id": 2, "name": "Quần jean", "price": 450000, "stock": null },
  { "id": 3, "name": "Nón", "price": 99000.5, "tags": [], "brand": { "name": "X", "country": "VN" } }
]`,
  },
  {
    id: 'mixed',
    label: 'Mảng hỗn hợp / union',
    json: `{
  "values": [1, "hai", true, null, 4.5],
  "points": [[1, 2], [3, 4]],
  "item": { "type": "circle", "radius": 3 },
  "data": [{ "a": 1 }, { "a": "x", "b": [] }],
  "empty": [],
  "unknown": null
}`,
  },
  {
    id: 'keys',
    label: 'Khóa đặc biệt',
    json: `{
  "type": "user",
  "class": "A",
  "default": true,
  "user-name": "x",
  "first name": "Minh",
  "1st_place": 1,
  "tên": "Lan",
  "": "rỗng",
  "HTTPServer": "h",
  "user_id": 7,
  "user-id": 8
}`,
  },
  {
    id: 'ndjson',
    label: 'Nhiều JSON (NDJSON)',
    json: `{"event":"login","user":{"id":1,"name":"A"},"at":"2024-01-01T10:00:00Z"}
{"event":"purchase","user":{"id":2,"name":"B"},"amount":120000,"items":[{"sku":"S1","qty":2}]}
{"event":"logout","user":{"id":1,"name":"A"},"at":"2024-01-01T10:05:00Z","reason":null}`,
  },
  {
    id: 'map',
    label: 'Map theo ID',
    json: `{
  "version": 3,
  "users": {
    "1001": { "name": "An", "age": 30 },
    "1002": { "name": "Bình", "age": 25 },
    "1003": { "name": "Chi", "age": 41 },
    "1004": { "name": "Dũng", "age": 19 },
    "1005": { "name": "Em", "age": 33 }
  }
}`,
  },
];
