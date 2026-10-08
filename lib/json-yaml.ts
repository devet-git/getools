import YAML from 'yaml';

export type Mode = 'format' | 'minify' | 'toYaml' | 'toJson' | 'sort';
export type Format = 'json' | 'yaml';
export type Indent = 2 | 4 | 'tab';

export interface ConvertOptions {
  mode: Mode;
  indent: Indent;
  sortKeys: boolean;
}

export interface ParseError {
  message: string;
  line?: number;
  col?: number;
  /** Dòng văn bản gây lỗi (đã cắt ngắn) */
  snippet?: string;
}

export interface Stats {
  keys: number;
  depth: number;
}

export interface ConvertResult {
  ok: boolean;
  output: string;
  outFormat: Format;
  detected: Format | null;
  error?: ParseError;
  stats?: Stats;
  inputBytes: number;
  outputBytes: number;
}

export const MODES: { id: Mode; label: string }[] = [
  { id: 'format', label: 'Định dạng JSON' },
  { id: 'minify', label: 'Nén JSON' },
  { id: 'toYaml', label: 'JSON → YAML' },
  { id: 'toJson', label: 'YAML → JSON' },
  { id: 'sort', label: 'Sắp xếp khóa' },
];

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
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
  return { line, col: end - last };
}

function snippetOf(text: string, line?: number): string | undefined {
  if (!line) return undefined;
  const l = text.split(/\r\n|\r|\n/)[line - 1];
  if (l === undefined) return undefined;
  return l.length > 200 ? l.slice(0, 200) + '…' : l;
}

/** Quét JSON nghiêm ngặt để tìm vị trí lỗi đầu tiên (-1 nếu hợp lệ) */
function findJsonErrorPos(t: string): number {
  const n = t.length;
  let i = 0;
  const ws = () => {
    while (i < n && (t[i] === ' ' || t[i] === '\t' || t[i] === '\n' || t[i] === '\r')) i++;
  };
  const str = (): boolean => {
    i++;
    while (i < n) {
      const c = t[i];
      if (c === '"') {
        i++;
        return true;
      }
      if (c < ' ') return false;
      if (c === '\\') {
        const e = t[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(t.slice(i + 2, i + 6))) return false;
          i += 6;
          continue;
        }
        if (!e || !'"\\/bfnrt'.includes(e)) return false;
        i += 2;
        continue;
      }
      i++;
    }
    return false;
  };
  // stack: 'o' (object) | 'a' (array); state machine
  const stack: string[] = [];
  let expectValue = true;
  for (;;) {
    ws();
    if (expectValue) {
      const c = t[i];
      if (c === undefined) return n;
      if (c === '{') {
        stack.push('o');
        i++;
        ws();
        if (t[i] === '}') {
          stack.pop();
          i++;
          expectValue = false;
          continue;
        }
        if (t[i] !== '"') return i;
        if (!str()) return i;
        ws();
        if (t[i] !== ':') return i;
        i++;
        continue;
      }
      if (c === '[') {
        stack.push('a');
        i++;
        ws();
        if (t[i] === ']') {
          stack.pop();
          i++;
          expectValue = false;
          continue;
        }
        continue;
      }
      if (c === '"') {
        if (!str()) return i;
      } else {
        const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(t.slice(i, i + 400));
        if (!m) return i;
        i += m[0].length;
      }
      expectValue = false;
      continue;
    }
    // sau một giá trị
    const top = stack[stack.length - 1];
    if (!top) return i < n ? i : -1;
    const c = t[i];
    if (c === undefined) return n;
    if (top === 'o') {
      if (c === '}') {
        stack.pop();
        i++;
        continue;
      }
      if (c !== ',') return i;
      i++;
      ws();
      if (t[i] !== '"') return i;
      if (!str()) return i;
      ws();
      if (t[i] !== ':') return i;
      i++;
      expectValue = true;
    } else {
      if (c === ']') {
        stack.pop();
        i++;
        continue;
      }
      if (c !== ',') return i;
      i++;
      expectValue = true;
    }
  }
}

function jsonError(text: string, e: unknown): ParseError {
  const raw = e instanceof Error ? e.message : String(e);
  let line: number | undefined;
  let col: number | undefined;
  const lc = /line (\d+) column (\d+)/i.exec(raw);
  const pos = /position (\d+)/i.exec(raw);
  if (lc) {
    line = Number(lc[1]);
    col = Number(lc[2]);
  } else if (pos) {
    ({ line, col } = lineCol(text, Number(pos[1])));
  } else {
    const p = findJsonErrorPos(text);
    if (p >= 0) ({ line, col } = lineCol(text, p));
  }
  const message = raw.replace(/\s*\(line \d+ column \d+\)/i, '').replace(/\s*in JSON at position \d+/i, '');
  return { message, line, col, snippet: snippetOf(text, line) };
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: ParseError };

export function parseJson(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: jsonError(text, e) };
  }
}

export function parseYaml(text: string): Parsed {
  try {
    const doc = YAML.parseDocument(text, { uniqueKeys: true });
    if (doc.errors.length > 0) {
      const err = doc.errors[0];
      const lp = err.linePos?.[0];
      const message = err.message.split('\n')[0].replace(/\s+at line \d+, column \d+:?$/, '');
      return {
        ok: false,
        error: { message, line: lp?.line, col: lp?.col, snippet: snippetOf(text, lp?.line) },
      };
    }
    return { ok: true, value: doc.toJS({ maxAliasCount: 1000 }) };
  } catch (e) {
    return { ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

/** Đoán định dạng đầu vào (không parse đầy đủ nếu không cần) */
export function detectFormat(text: string): Format | null {
  const t = text.trim();
  if (!t) return null;
  if (t[0] === '{' || t[0] === '[') {
    if (parseJson(t).ok) return 'json';
    return parseYaml(t).ok ? 'yaml' : 'json';
  }
  if (parseJson(t).ok) return 'json';
  return 'yaml';
}

export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      out[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function computeStats(root: unknown): Stats {
  let keys = 0;
  let maxDepth = 0;
  const stack: [unknown, number][] = [[root, 0]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (d > maxDepth) maxDepth = d;
    if (Array.isArray(v)) {
      for (const x of v) stack.push([x, d + 1]);
    } else if (v && typeof v === 'object') {
      const ks = Object.keys(v);
      keys += ks.length;
      for (const k of ks) stack.push([(v as Record<string, unknown>)[k], d + 1]);
    }
  }
  return { keys, depth: maxDepth };
}

export function toJsonString(v: unknown, indent: Indent | 0): string {
  const space = indent === 0 ? undefined : indent === 'tab' ? '\t' : indent;
  return JSON.stringify(v, null, space) ?? 'null';
}

export function toYamlString(v: unknown, indent: Indent): string {
  return YAML.stringify(v, { indent: indent === 'tab' ? 2 : indent, lineWidth: 0 });
}

export function convert(input: string, opts: ConvertOptions): ConvertResult {
  const inputBytes = byteLength(input);
  const detected = detectFormat(input);
  const base = { detected, inputBytes, outputBytes: 0 };
  const outFormat: Format = opts.mode === 'toYaml' ? 'yaml' : opts.mode === 'sort' && detected === 'yaml' ? 'yaml' : 'json';

  if (!input.trim()) return { ...base, ok: true, output: '', outFormat };

  // Chế độ JSON bắt buộc JSON hợp lệ; YAML → JSON dùng bộ parse YAML (YAML là tập cha của JSON)
  const parsed =
    opts.mode === 'format' || opts.mode === 'minify'
      ? parseJson(input)
      : opts.mode === 'toJson'
        ? parseYaml(input)
        : detected === 'yaml'
          ? parseYaml(input)
          : parseJson(input);

  if (!parsed.ok) return { ...base, ok: false, output: '', outFormat, error: parsed.error };

  let value = parsed.value;
  if (opts.sortKeys || opts.mode === 'sort') value = sortKeysDeep(value);

  let output: string;
  try {
    output = outFormat === 'yaml' ? toYamlString(value, opts.indent) : toJsonString(value, opts.mode === 'minify' ? 0 : opts.indent);
  } catch (e) {
    return {
      ...base,
      ok: false,
      output: '',
      outFormat,
      error: { message: e instanceof Error ? e.message : String(e) },
    };
  }
  return { ...base, ok: true, output, outFormat, stats: computeStats(value), outputBytes: byteLength(output) };
}

export const SAMPLE_JSON = `{
  "tên": "GeTools",
  "phiênBản": "1.2.0",
  "tínhNăng": ["định dạng", "nén", "chuyển đổi"],
  "cấuHình": { "indent": 2, "sortKeys": false, "ngônNgữ": "vi" },
  "hoạtĐộng": true,
  "ghiChú": null
}`;

export const SAMPLE_YAML = `# Cấu hình mẫu
tên: GeTools
phiênBản: "1.2.0"
tínhNăng:
  - định dạng
  - nén
  - chuyển đổi
cấuHình:
  indent: 2
  sortKeys: false
hoạtĐộng: true
`;
