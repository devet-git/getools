import YAML from 'yaml';
import { shellTokenize, shQuote, stringifyYaml } from '@/lib/docker-tools';

/* ============================================================
 * .env & Config — logic thuần. Mọi parser KHÔNG bao giờ ném lỗi.
 * ============================================================ */

export const MAX_ENV_INPUT = 1_000_000;
const MAX_MULTILINE = 2000;

export type Level = 'error' | 'warn' | 'info';

/* ---------------- Dotenv: parser ---------------- */

export type QuoteKind = 'none' | 'single' | 'double' | 'backtick';

export interface DotenvItem {
  kind: 'entry' | 'comment' | 'blank' | 'invalid';
  /** Số dòng bắt đầu (1-based) */
  line: number;
  endLine: number;
  raw: string;
  key?: string;
  value?: string;
  quote?: QuoteKind;
  exported?: boolean;
  /** Nội dung comment (bao gồm dấu #) với kind=comment */
  text?: string;
  inlineComment?: string;
  /** Có khoảng trắng thừa ở cuối giá trị không nháy */
  trailingSpace?: boolean;
  /** Có khoảng trắng quanh dấu = */
  spacedEquals?: boolean;
  /** Ký tự thừa sau nháy đóng */
  junkAfterQuote?: boolean;
  unterminated?: boolean;
}

export interface DotenvParse {
  items: DotenvItem[];
  entries: DotenvItem[];
  hadBom: boolean;
  hadCrlf: boolean;
}

function unescapeDouble(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const e = s[i + 1];
      i++;
      if (e === 'n') out += '\n';
      else if (e === 'r') out += '\r';
      else if (e === 't') out += '\t';
      else if (e === '\\') out += '\\';
      else if (e === '"') out += '"';
      else if (e === "'") out += "'";
      else if (e === '$') out += '\\$'; // giữ lại để bước nội suy biết đây là $ nguyên văn
      else out += '\\' + e;
    } else out += c;
  }
  return out;
}

const LINE_RE = /^[ \t]*(?:export[ \t]+)?([^\s=#'"`]+)([ \t]*)=([ \t]*)(.*)$/;

export function parseDotenv(input: string): DotenvParse {
  let text = input.length > MAX_ENV_INPUT ? input.slice(0, MAX_ENV_INPUT) : input;
  const hadBom = text.charCodeAt(0) === 0xfeff;
  if (hadBom) text = text.slice(1);
  const hadCrlf = /\r\n/.test(text);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const items: DotenvItem[] = [];
  let li = 0;
  while (li < lines.length) {
    const line = lines[li];
    const trimmed = line.trim();
    const lineNo = li + 1;
    if (trimmed === '') {
      // bỏ dòng trống cuối cùng do split
      if (li === lines.length - 1) break;
      items.push({ kind: 'blank', line: lineNo, endLine: lineNo, raw: line });
      li++;
      continue;
    }
    if (trimmed.startsWith('#')) {
      items.push({ kind: 'comment', line: lineNo, endLine: lineNo, raw: line, text: trimmed });
      li++;
      continue;
    }
    const m = LINE_RE.exec(line);
    if (!m) {
      items.push({ kind: 'invalid', line: lineNo, endLine: lineNo, raw: line });
      li++;
      continue;
    }
    const exported = /^[ \t]*export[ \t]/.test(line) && !/^[ \t]*export[ \t]*=/.test(line);
    const key = m[1];
    const spaced = m[2].length > 0 || m[3].length > 0;
    const rest = m[4];
    const q = rest[0];
    if (q === '"' || q === "'" || q === '`') {
      // tìm nháy đóng, có thể qua nhiều dòng
      let buf = rest.slice(1);
      let endLine = li;
      let closeAt = -1;
      let scanFrom = 0;
      for (;;) {
        let idx = -1;
        if (q === '"') {
          for (let k = scanFrom; k < buf.length; k++) {
            if (buf[k] === '\\') {
              k++;
              continue;
            }
            if (buf[k] === '"') {
              idx = k;
              break;
            }
          }
        } else idx = buf.indexOf(q, scanFrom);
        if (idx >= 0) {
          closeAt = idx;
          break;
        }
        if (endLine + 1 >= lines.length || endLine - li >= MAX_MULTILINE) break;
        scanFrom = buf.length + 1;
        endLine++;
        buf += '\n' + lines[endLine];
      }
      if (closeAt < 0) {
        // chưa đóng: coi cả phần còn lại của dòng đầu là giá trị thô
        items.push({
          kind: 'entry', line: lineNo, endLine: lineNo, raw: line, key, value: rest, quote: 'none',
          exported, spacedEquals: spaced, unterminated: true,
        });
        li++;
        continue;
      }
      const inner = buf.slice(0, closeAt);
      const after = buf.slice(closeAt + 1);
      const afterTrim = after.trim();
      let inlineComment: string | undefined;
      let junk = false;
      if (afterTrim.startsWith('#')) inlineComment = afterTrim;
      else if (afterTrim !== '') junk = true;
      items.push({
        kind: 'entry', line: lineNo, endLine: endLine + 1, raw: lines.slice(li, endLine + 1).join('\n'), key,
        value: q === '"' ? unescapeDouble(inner) : inner,
        quote: q === '"' ? 'double' : q === "'" ? 'single' : 'backtick',
        exported, inlineComment, spacedEquals: spaced, junkAfterQuote: junk,
      });
      li = endLine + 1;
      continue;
    }
    // giá trị không nháy
    let val = rest;
    let inlineComment: string | undefined;
    const cm = /(^|[ \t])#/.exec(val);
    if (cm) {
      inlineComment = val.slice(cm.index + cm[1].length).trim();
      val = val.slice(0, cm.index);
    }
    const trailing = !cm && /[ \t]+$/.test(val);
    items.push({
      kind: 'entry', line: lineNo, endLine: lineNo, raw: line, key, value: val.replace(/[ \t]+$/, ''), quote: 'none',
      exported, inlineComment, trailingSpace: trailing, spacedEquals: spaced,
    });
    li++;
  }
  return { items, entries: items.filter((i) => i.kind === 'entry'), hadBom, hadCrlf };
}

/* ---------------- Dotenv: ghi ---------------- */

export function formatDotenvValue(v: string, interpolate = false): string {
  if (v === '') return '';
  if (/^[^\s#"'`$\\]+$/.test(v) && !/^[-+]?$/.test(v)) return v;
  const hasRef = /\$[{A-Za-z_]/.test(v);
  if (/[\n\r']/.test(v) || (interpolate && hasRef)) {
    let esc = v
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
    if (!interpolate) esc = esc.replace(/\$(?=[{A-Za-z_])/g, '\\$');
    return `"${esc}"`;
  }
  if (/["$\\`]/.test(v)) return `'${v}'`;
  return `"${v}"`;
}

export function formatDotenvLine(key: string, value: string, exported = false, interpolate = false): string {
  return `${exported ? 'export ' : ''}${key}=${formatDotenvValue(value, interpolate)}`;
}

export interface EnvPair {
  key: string;
  value: string;
  /** Comment đứng ngay trước (chỉ dùng với dotenv) */
  comment?: string;
}

export function pairsFromDotenv(text: string): EnvPair[] {
  const { items } = parseDotenv(text);
  const pairs: EnvPair[] = [];
  let pending: string[] = [];
  for (const it of items) {
    if (it.kind === 'comment') pending.push(it.text ?? '');
    else if (it.kind === 'entry') {
      pairs.push({ key: it.key!, value: it.value ?? '', comment: pending.length ? pending.join('\n') : undefined });
      pending = [];
    } else if (it.kind === 'blank') pending = [];
  }
  return pairs;
}

/* ---------------- Bí mật: che / nhận diện ---------------- */

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASS(WORD|WD|PHRASE)?|PWD|CREDENTIAL|PRIVATE|AUTH|SALT|SIGNATURE|CERT|DSN|CONN(ECTION)?_?STR(ING)?|COOKIE|SESSION)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_NAME.test(key);
}

export function maskValue(v: string): string {
  return v === '' ? '' : '••••••••';
}

const TOKEN_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /^AKIA[0-9A-Z]{16}$/, label: 'AWS access key' },
  { re: /^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}$/, label: 'GitHub token' },
  { re: /^github_pat_[A-Za-z0-9_]{20,}$/, label: 'GitHub token' },
  { re: /^sk-[A-Za-z0-9_-]{20,}$/, label: 'API key (sk-…)' },
  { re: /^(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}$/, label: 'Stripe key' },
  { re: /^xox[baprs]-[A-Za-z0-9-]{10,}$/, label: 'Slack token' },
  { re: /^AIza[0-9A-Za-z_-]{35}$/, label: 'Google API key' },
  { re: /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/, label: 'JWT' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'khóa riêng (private key)' },
];

const WEAK_VALUE = /^(changeme|change_me|password|passw0rd|secret|123456|12345678|admin|root|test|default|todo|qwerty|letmein)$/i;

export function detectTokenLabel(v: string): string | null {
  for (const p of TOKEN_PATTERNS) if (p.re.test(v)) return p.label;
  return null;
}

/* ---------------- Nội suy biến ---------------- */

export interface ResolvedEntry {
  key: string;
  raw: string;
  resolved: string;
  refs: string[];
  missing: string[];
  cyclic: boolean;
  noInterpolation: boolean;
}

const MAX_EXPANSION = 100_000;

export function resolveInterpolation(entries: { key: string; value: string; quote?: QuoteKind }[], external: Record<string, string> = {}): ResolvedEntry[] {
  const map = new Map<string, { value: string; quote?: QuoteKind }>();
  for (const e of entries) map.set(e.key, { value: e.value, quote: e.quote });
  const memo = new Map<string, { value: string; missing: Set<string>; cyclic: boolean }>();
  const stack: string[] = [];

  const lookup = (name: string, missing: Set<string>, st: { cyclic: boolean }): string | undefined => {
    if (map.has(name)) {
      if (stack.includes(name)) {
        st.cyclic = true;
        if (name in external) return external[name];
        missing.add(name);
        return undefined;
      }
      const r = resolveKey(name);
      if (r.cyclic) st.cyclic = true;
      r.missing.forEach((m) => missing.add(m));
      return r.value;
    }
    if (name in external) return external[name];
    missing.add(name);
    return undefined;
  };

  const expand = (s: string, missing: Set<string>, st: { cyclic: boolean }, refs: Set<string> | null, depth: number): string => {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (out.length > MAX_EXPANSION) break;
      const c = s[i];
      if (c === '\\' && s[i + 1] === '$') {
        out += '$';
        i += 2;
        continue;
      }
      if (c !== '$') {
        out += c;
        i++;
        continue;
      }
      if (s[i + 1] === '{') {
        // tìm ngoặc đóng tương ứng
        let d = 1;
        let j = i + 2;
        while (j < s.length && d > 0) {
          if (s[j] === '{') d++;
          else if (s[j] === '}') d--;
          j++;
        }
        if (d !== 0) {
          out += s.slice(i);
          break;
        }
        const body = s.slice(i + 2, j - 1);
        const m = /^([A-Za-z_][A-Za-z0-9_.]*)(?:(:?[-+?])([\s\S]*))?$/.exec(body);
        if (!m) {
          out += s.slice(i, j);
          i = j;
          continue;
        }
        const name = m[1];
        refs?.add(name);
        const op = m[2];
        const arg = m[3] ?? '';
        const localMissing = new Set<string>();
        const val = lookup(name, localMissing, st);
        const isSet = val !== undefined;
        const isEmpty = !isSet || val === '';
        const colon = op?.startsWith(':');
        if (!op) {
          localMissing.forEach((x) => missing.add(x));
          out += val ?? '';
        } else if (op.endsWith('-')) {
          if (colon ? isEmpty : !isSet) out += depth < 20 ? expand(arg, missing, st, refs, depth + 1) : arg;
          else out += val ?? '';
        } else if (op.endsWith('+')) {
          if (colon ? !isEmpty : isSet) out += depth < 20 ? expand(arg, missing, st, refs, depth + 1) : arg;
        } else {
          // ?
          if (colon ? isEmpty : !isSet) localMissing.forEach((x) => missing.add(x));
          out += val ?? '';
        }
        i = j;
        continue;
      }
      const m2 = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i + 1, i + 200));
      if (m2) {
        refs?.add(m2[0]);
        const lm = new Set<string>();
        const val = lookup(m2[0], lm, st);
        lm.forEach((x) => missing.add(x));
        out += val ?? '';
        i += 1 + m2[0].length;
        continue;
      }
      out += c;
      i++;
    }
    return out.length > MAX_EXPANSION ? out.slice(0, MAX_EXPANSION) : out;
  };

  const resolveKey = (key: string): { value: string; missing: Set<string>; cyclic: boolean } => {
    const cached = memo.get(key);
    if (cached) return cached;
    const e = map.get(key)!;
    const missing = new Set<string>();
    const st = { cyclic: false };
    stack.push(key);
    let value: string;
    if (e.quote === 'single' || e.quote === 'backtick') value = e.value;
    else value = expand(e.value, missing, st, null, 0);
    stack.pop();
    const r = { value, missing, cyclic: st.cyclic };
    memo.set(key, r);
    return r;
  };

  const out: ResolvedEntry[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    const last = map.get(e.key)!;
    const noInterp = last.quote === 'single' || last.quote === 'backtick';
    const r = resolveKey(e.key);
    const refs = new Set<string>();
    if (!noInterp) expand(last.value, new Set(), { cyclic: false }, refs, 0);
    out.push({
      key: e.key, raw: last.value, resolved: r.value, refs: [...refs], missing: [...r.missing], cyclic: r.cyclic,
      noInterpolation: noInterp,
    });
  }
  return out;
}

/* ---------------- Lint ---------------- */

export interface LintIssue {
  level: Level;
  line: number;
  key?: string;
  message: string;
}

export function lintDotenv(text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!text.trim()) return issues;
  const { items, hadBom, hadCrlf } = parseDotenv(text);
  if (hadBom) issues.push({ level: 'warn', line: 1, message: 'File bắt đầu bằng BOM (UTF-8 BOM) — một số công cụ sẽ đọc sai khóa đầu tiên. Nên lưu UTF-8 không BOM.' });
  if (hadCrlf) issues.push({ level: 'info', line: 1, message: 'File dùng kết thúc dòng CRLF (Windows) — có thể gây ký tự \\r thừa khi chạy trên Linux.' });
  const seen = new Map<string, number>();
  for (const it of items) {
    if (it.kind === 'invalid') {
      issues.push({ level: 'error', line: it.line, message: `Dòng không hợp lệ (cần dạng KEY=value): ${it.raw.trim().slice(0, 80)}` });
      continue;
    }
    if (it.kind !== 'entry') continue;
    const key = it.key!;
    const value = it.value ?? '';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      issues.push({ level: 'warn', line: it.line, key, message: `Tên biến "${key}" không hợp lệ cho shell (chỉ chữ, số, _ và không bắt đầu bằng số).` });
    } else if (key !== key.toUpperCase()) {
      issues.push({ level: 'info', line: it.line, key, message: `Tên biến "${key}" không viết hoa — quy ước thường là UPPER_SNAKE_CASE.` });
    }
    const prev = seen.get(key);
    if (prev !== undefined) issues.push({ level: 'warn', line: it.line, key, message: `Khóa "${key}" bị trùng (đã khai báo ở dòng ${prev}); giá trị sau sẽ ghi đè.` });
    else seen.set(key, it.line);
    if (it.unterminated) issues.push({ level: 'error', line: it.line, key, message: 'Dấu nháy mở nhưng không có dấu nháy đóng.' });
    if (it.junkAfterQuote) issues.push({ level: 'warn', line: it.line, key, message: 'Có ký tự thừa sau dấu nháy đóng (sẽ bị bỏ qua).' });
    if (it.trailingSpace) issues.push({ level: 'warn', line: it.line, key, message: 'Có khoảng trắng thừa ở cuối giá trị.' });
    if (it.spacedEquals) issues.push({ level: 'warn', line: it.line, key, message: 'Có khoảng trắng quanh dấu "=" — không phải trình đọc nào cũng chấp nhận.' });
    if (value === '' && !it.unterminated) issues.push({ level: 'info', line: it.line, key, message: 'Giá trị rỗng.' });
    if (it.quote === 'none' && !it.unterminated) {
      if (/\s/.test(value)) issues.push({ level: 'info', line: it.line, key, message: 'Giá trị chứa khoảng trắng nhưng không đặt trong nháy — nên dùng "…".' });
      if (value.includes('#')) issues.push({ level: 'info', line: it.line, key, message: 'Giá trị chứa "#" không nháy — một số trình đọc coi đó là comment. Nên đặt trong nháy.' });
      if (/\$[{A-Za-z_]/.test(value)) issues.push({ level: 'info', line: it.line, key, message: 'Giá trị chứa $ — sẽ được nội suy; dùng nháy đơn nếu muốn giữ nguyên.' });
    }
    if (value) {
      const label = detectTokenLabel(value);
      if (label) issues.push({ level: 'warn', line: it.line, key, message: `Giá trị trông giống ${label} thật — đừng commit lên git.` });
      else if (isSecretKey(key)) {
        if (WEAK_VALUE.test(value) || value.length < 6) {
          issues.push({ level: 'warn', line: it.line, key, message: 'Biến có vẻ là bí mật nhưng giá trị yếu/giả — nhớ đổi trước khi triển khai.' });
        } else if (!/^\$\{?[A-Za-z_]/.test(value)) {
          issues.push({ level: 'info', line: it.line, key, message: 'Có vẻ là bí mật — không commit file .env, hãy dùng .env.example.' });
        }
      }
      if (/:\/\/[^/\s:@]+:[^/\s@]+@/.test(value)) issues.push({ level: 'warn', line: it.line, key, message: 'URL chứa mật khẩu nhúng sẵn (user:pass@host).' });
    }
  }
  return issues;
}

/* ---------------- Diff hai file .env ---------------- */

export interface EnvDiffRow {
  key: string;
  status: 'added' | 'removed' | 'changed' | 'same';
  a?: string;
  b?: string;
}

export function diffDotenv(aText: string, bText: string): EnvDiffRow[] {
  const toMap = (t: string) => {
    const m = new Map<string, string>();
    for (const e of parseDotenv(t).entries) m.set(e.key!, e.value ?? '');
    return m;
  };
  const a = toMap(aText);
  const b = toMap(bText);
  const rows: EnvDiffRow[] = [];
  for (const [k, v] of a) {
    if (!b.has(k)) rows.push({ key: k, status: 'removed', a: v });
    else if (b.get(k) !== v) rows.push({ key: k, status: 'changed', a: v, b: b.get(k) });
    else rows.push({ key: k, status: 'same', a: v, b: v });
  }
  for (const [k, v] of b) if (!a.has(k)) rows.push({ key: k, status: 'added', b: v });
  return rows;
}

/* ---------------- .env.example & sắp xếp ---------------- */

export type ExampleMode = 'empty' | 'placeholder' | 'keep';

export function generateExample(text: string, opts: { mode: ExampleMode; keepComments: boolean; sort?: boolean }): string {
  const { items } = parseDotenv(text);
  const groups = buildGroups(items, opts.keepComments);
  if (opts.sort) {
    const tail = groups.length && groups[groups.length - 1].key === undefined ? groups.pop() : undefined;
    groups.sort((x, y) => cmp(x.key ?? '', y.key ?? ''));
    if (tail) groups.push(tail);
  }
  const lines: string[] = [];
  for (const g of groups) {
    for (const l of g.pre) lines.push(l);
    if (g.key === undefined) continue;
    const e = g.entry!;
    let v = e.value ?? '';
    const secret = isSecretKey(g.key) || detectTokenLabel(v) !== null;
    if (opts.mode === 'empty') v = '';
    else if (secret) v = opts.mode === 'placeholder' ? `your_${g.key.toLowerCase()}` : '';
    else v = v.replace(/(:\/\/[^/\s:@]+:)[^/\s@]+@/, opts.mode === 'placeholder' ? '$1password@' : '$1@');
    lines.push(formatDotenvLine(g.key, v, e.exported, e.quote !== 'single' && e.quote !== 'backtick'));
  }
  return trimBlank(lines).join('\n') + (lines.length ? '\n' : '');
}

interface Group {
  key?: string;
  entry?: DotenvItem;
  pre: string[];
}

function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function trimBlank(lines: string[]): string[] {
  const out = [...lines];
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/** Gom comment/dòng trống đứng trước mỗi khóa thành một nhóm */
function buildGroups(items: DotenvItem[], keepComments: boolean): Group[] {
  const groups: Group[] = [];
  let pre: string[] = [];
  for (const it of items) {
    if (it.kind === 'comment') {
      if (keepComments) pre.push(it.raw.trim());
    } else if (it.kind === 'blank') {
      if (keepComments) pre.push('');
    } else if (it.kind === 'entry') {
      groups.push({ key: it.key, entry: it, pre });
      pre = [];
    } else {
      // dòng không hợp lệ: giữ nguyên như comment nếu keepComments
      if (keepComments) pre.push(`# ${it.raw.trim()}`);
    }
  }
  if (pre.length) groups.push({ pre });
  return groups;
}

export function sortDotenv(text: string): string {
  const { items } = parseDotenv(text);
  const groups = buildGroups(items, true);
  const tail = groups.length && groups[groups.length - 1].key === undefined ? groups.pop()! : null;
  groups.sort((x, y) => cmp(x.key!, y.key!));
  const lines: string[] = [];
  for (const g of groups) {
    // bỏ dòng trống đầu nhóm để không bị dồn lại
    const pre = g.pre.slice();
    while (pre.length && pre[0] === '') pre.shift();
    lines.push(...pre);
    const e = g.entry!;
    lines.push(formatDotenvLine(g.key!, e.value ?? '', e.exported, e.quote !== 'single' && e.quote !== 'backtick') + (e.inlineComment ? ` ${e.inlineComment}` : ''));
  }
  if (tail) lines.push(...tail.pre);
  return trimBlank(lines).join('\n') + (lines.length ? '\n' : '');
}

/* ---------------- Base64 UTF-8 ---------------- */

export function encodeB64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

export function decodeB64Utf8(b64: string): string | null {
  try {
    const clean = b64.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) return null;
    const std = clean.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(std.padEnd(Math.ceil(std.length / 4) * 4, '='));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/* ---------------- Chuyển đổi định dạng ---------------- */

export type InFormat = 'auto' | 'dotenv' | 'json' | 'yaml' | 'docker' | 'compose' | 'k8s' | 'shell' | 'cmd' | 'powershell';
export type OutFormat =
  | 'dotenv' | 'json' | 'yaml' | 'docker' | 'compose-map' | 'compose-list' | 'k8s-configmap'
  | 'k8s-secret-string' | 'k8s-secret-data' | 'shell' | 'cmd' | 'powershell';

export const IN_FORMATS: { id: InFormat; label: string }[] = [
  { id: 'auto', label: 'Tự nhận diện' },
  { id: 'dotenv', label: '.env (dotenv)' },
  { id: 'json', label: 'JSON object' },
  { id: 'yaml', label: 'YAML map' },
  { id: 'docker', label: 'Cờ docker run -e' },
  { id: 'compose', label: 'docker-compose (environment)' },
  { id: 'k8s', label: 'Kubernetes ConfigMap/Secret' },
  { id: 'shell', label: 'Shell export' },
  { id: 'cmd', label: 'Windows CMD (set)' },
  { id: 'powershell', label: 'PowerShell ($env:)' },
];

export const OUT_FORMATS: { id: OutFormat; label: string }[] = [
  { id: 'dotenv', label: '.env (dotenv)' },
  { id: 'json', label: 'JSON object' },
  { id: 'yaml', label: 'YAML map' },
  { id: 'docker', label: 'Cờ docker run -e' },
  { id: 'compose-map', label: 'Compose environment (map)' },
  { id: 'compose-list', label: 'Compose environment (list)' },
  { id: 'k8s-configmap', label: 'Kubernetes ConfigMap' },
  { id: 'k8s-secret-string', label: 'Kubernetes Secret (stringData)' },
  { id: 'k8s-secret-data', label: 'Kubernetes Secret (data base64)' },
  { id: 'shell', label: 'Shell export' },
  { id: 'cmd', label: 'Windows CMD (set)' },
  { id: 'powershell', label: 'PowerShell ($env:)' },
];

export interface ConvertOptions {
  from: InFormat;
  to: OutFormat;
  name: string;
  namespace: string;
  sort: boolean;
  inferTypes: boolean;
  exportPrefix: boolean;
  keepComments: boolean;
  dockerOneLine: boolean;
}

export const DEFAULT_CONVERT: ConvertOptions = {
  from: 'auto', to: 'json', name: 'app-config', namespace: '', sort: false, inferTypes: false,
  exportPrefix: false, keepComments: true, dockerOneLine: false,
};

export interface ConvertResult {
  ok: boolean;
  output: string;
  pairs: EnvPair[];
  warnings: string[];
  error?: string;
  detected?: Exclude<InFormat, 'auto'>;
}

interface Parsed {
  pairs: EnvPair[];
  warnings: string[];
  error?: string;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function detectEnvFormat(text: string): Exclude<InFormat, 'auto'> {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) return 'dotenv';
  if (t[0] === '{') return 'json';
  if (/^\s*\$env:|\[Environment\]::SetEnvironmentVariable|^\s*\$\{env:/im.test(t)) return 'powershell';
  if (/^\s*(@echo\s+off|setx?\s+("?[A-Za-z_]))/im.test(t) && !/^\s*export\s/m.test(t)) return 'cmd';
  if (/(^|\s)docker\s+(container\s+)?run\b/.test(t) || /^\s*(-e|--env)(\s|=)/m.test(t)) return 'docker';
  if (/^\s*kind:\s*(ConfigMap|Secret)\b/m.test(t)) return 'k8s';
  if (/^\s*services:\s*$/m.test(t) || /^\s*environment:\s*$/m.test(t)) return 'compose';
  if (/^\s*-\s+[A-Za-z_][A-Za-z0-9_.]*(=|\s*$)/m.test(t) && !/^\s*[A-Za-z_][A-Za-z0-9_]*=/m.test(t)) return 'compose';
  if (/^\s*export\s+[A-Za-z_]/m.test(t)) return 'shell';
  const lines = t.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length && /^[A-Za-z_][\w.-]*\s*:(\s|$)/.test(lines[0].trim()) && !lines.some((l) => /^\s*(export\s+)?[A-Za-z_]\w*\s*=/.test(l))) return 'yaml';
  return 'dotenv';
}

function scalarToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function flatten(obj: unknown, warnings: string[]): EnvPair[] {
  const out: EnvPair[] = [];
  let flattened = false;
  let arrays = false;
  const walk = (v: unknown, path: string, depth: number) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 10) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (out.length > 20000) return;
        const p = path ? `${path}_${k}` : k;
        if (x && typeof x === 'object' && !Array.isArray(x)) {
          flattened = true;
          walk(x, p, depth + 1);
        } else {
          if (Array.isArray(x)) arrays = true;
          out.push({ key: p, value: scalarToString(x) });
        }
      }
      return;
    }
    if (path) out.push({ key: path, value: scalarToString(v) });
  };
  walk(obj, '', 0);
  if (flattened) warnings.push('Đối tượng lồng nhau đã được làm phẳng bằng dấu "_" (vd. db.host → db_host).');
  if (arrays) warnings.push('Giá trị mảng được lưu dưới dạng chuỗi JSON.');
  return out;
}

function pairsFromList(list: unknown[], warnings: string[]): EnvPair[] {
  const out: EnvPair[] = [];
  for (const x of list) {
    if (typeof x === 'string') {
      const i = x.indexOf('=');
      if (i < 0) {
        out.push({ key: x, value: '' });
        warnings.push(`"${x}" không có giá trị (trong Compose là lấy từ môi trường) — đặt rỗng.`);
      } else out.push({ key: x.slice(0, i), value: x.slice(i + 1) });
    } else if (x && typeof x === 'object') {
      for (const [k, v] of Object.entries(x as Record<string, unknown>)) out.push({ key: k, value: scalarToString(v) });
    } else if (x !== null && x !== undefined) out.push({ key: String(x), value: '' });
  }
  return out;
}

function parseYamlSafe(text: string): { value?: unknown; docs?: unknown[]; error?: string } {
  try {
    const docs = YAML.parseAllDocuments(text, { merge: true, uniqueKeys: false });
    const arr = Array.isArray(docs) ? docs : [docs];
    for (const d of arr) {
      if (d.errors.length) {
        const lp = d.errors[0].linePos?.[0];
        return { error: `YAML không hợp lệ${lp ? ` (dòng ${lp.line}, cột ${lp.col})` : ''}: ${d.errors[0].message.split('\n')[0]}` };
      }
    }
    const js = arr.map((d) => d.toJS({ maxAliasCount: 200 }));
    return { value: js[0], docs: js };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function parseJsonInput(text: string): Parsed {
  const warnings: string[] = [];
  try {
    const v: unknown = JSON.parse(text.replace(/^﻿/, ''));
    if (Array.isArray(v)) return { pairs: pairsFromList(v, warnings), warnings };
    if (!v || typeof v !== 'object') return { pairs: [], warnings, error: 'JSON phải là một đối tượng { "KEY": "value" }.' };
    return { pairs: flatten(v, warnings), warnings };
  } catch (e) {
    return { pairs: [], warnings, error: `JSON không hợp lệ: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function parseYamlInput(text: string): Parsed {
  const warnings: string[] = [];
  const r = parseYamlSafe(text);
  if (r.error) return { pairs: [], warnings, error: r.error };
  const v = r.value;
  if (v === null || v === undefined) return { pairs: [], warnings };
  if (Array.isArray(v)) return { pairs: pairsFromList(v, warnings), warnings };
  if (typeof v !== 'object') return { pairs: [], warnings, error: 'YAML phải là một map KEY: value.' };
  return { pairs: flatten(v, warnings), warnings };
}

function parseComposeInput(text: string): Parsed {
  const warnings: string[] = [];
  const r = parseYamlSafe(text);
  if (r.error) return { pairs: [], warnings, error: r.error };
  const v = r.value;
  if (Array.isArray(v)) return { pairs: pairsFromList(v, warnings), warnings };
  if (!v || typeof v !== 'object') return { pairs: [], warnings, error: 'Không tìm thấy mục environment trong YAML.' };
  const o = v as Record<string, unknown>;
  const envToPairs = (e: unknown): EnvPair[] => {
    if (Array.isArray(e)) return pairsFromList(e, warnings);
    if (e && typeof e === 'object') return Object.entries(e as Record<string, unknown>).map(([k, x]) => ({ key: k, value: scalarToString(x) }));
    return [];
  };
  if (o.services && typeof o.services === 'object') {
    const pairs: EnvPair[] = [];
    const names = Object.keys(o.services as object);
    const owner = new Map<string, string>();
    for (const n of names) {
      const s = (o.services as Record<string, unknown>)[n];
      if (!s || typeof s !== 'object') continue;
      for (const p of envToPairs((s as Record<string, unknown>).environment)) {
        const prev = owner.get(p.key);
        if (prev && prev !== n) warnings.push(`Khóa "${p.key}" xuất hiện ở nhiều service (${prev}, ${n}); lấy giá trị sau.`);
        owner.set(p.key, n);
        pairs.push(p);
      }
    }
    if (names.length > 1) warnings.push(`Đã gộp environment của ${names.length} service.`);
    return { pairs, warnings };
  }
  if ('environment' in o) return { pairs: envToPairs(o.environment), warnings };
  return { pairs: flatten(o, warnings), warnings };
}

function parseK8sInput(text: string): Parsed {
  const warnings: string[] = [];
  const r = parseYamlSafe(text);
  if (r.error) return { pairs: [], warnings, error: r.error };
  const pairs: EnvPair[] = [];
  let found = 0;
  for (const d of r.docs ?? []) {
    if (!d || typeof d !== 'object') continue;
    const o = d as Record<string, unknown>;
    const kind = typeof o.kind === 'string' ? o.kind : '';
    if (kind && kind !== 'ConfigMap' && kind !== 'Secret') {
      warnings.push(`Bỏ qua tài liệu kind: ${kind}.`);
      continue;
    }
    const data = o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : null;
    const sdata = o.stringData && typeof o.stringData === 'object' ? (o.stringData as Record<string, unknown>) : null;
    if (!data && !sdata) continue;
    found++;
    const local = new Map<string, string>();
    if (data) {
      for (const [k, x] of Object.entries(data)) {
        const s = scalarToString(x);
        if (kind === 'Secret') {
          const dec = decodeB64Utf8(s);
          if (dec === null) {
            warnings.push(`Giá trị của "${k}" không phải base64/UTF-8 hợp lệ — giữ nguyên chuỗi gốc.`);
            local.set(k, s);
          } else local.set(k, dec);
        } else local.set(k, s);
      }
    }
    if (sdata) for (const [k, x] of Object.entries(sdata)) local.set(k, scalarToString(x));
    if (o.binaryData) warnings.push('binaryData bị bỏ qua.');
    for (const [k, v] of local) pairs.push({ key: k, value: v });
  }
  if (!found) return { pairs: [], warnings, error: 'Không tìm thấy mục data/stringData của ConfigMap/Secret.' };
  return { pairs, warnings };
}

function parseDockerInput(text: string): Parsed {
  const warnings: string[] = [];
  const sh = shellTokenize(text);
  const pairs: EnvPair[] = [];
  for (const e of sh.errors) warnings.push(e);
  const add = (v: string) => {
    const i = v.indexOf('=');
    if (i < 0) {
      if (v) {
        pairs.push({ key: v, value: '' });
        warnings.push(`-e ${v} không có giá trị (lấy từ môi trường shell) — đặt rỗng.`);
      }
    } else pairs.push({ key: v.slice(0, i), value: v.slice(i + 1) });
  };
  for (const words of sh.commands) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w === '-e' || w === '--env') {
        if (i + 1 < words.length) add(words[++i]);
      } else if (w.startsWith('--env=')) add(w.slice(6));
      else if (/^-e./.test(w) && !w.startsWith('--')) add(w.slice(2).replace(/^=/, ''));
      else if (w === '--env-file' || w.startsWith('--env-file=')) {
        warnings.push('--env-file bị bỏ qua (không đọc được nội dung file).');
        if (w === '--env-file') i++;
      }
    }
  }
  return { pairs, warnings };
}

function parseShellInput(text: string): Parsed {
  const warnings: string[] = [];
  const sh = shellTokenize(text);
  const pairs: EnvPair[] = [];
  for (const e of sh.errors) warnings.push(e);
  for (const words of sh.commands) {
    for (const w of words) {
      if (w === 'export' || w === 'declare' || w === '-x' || w === 'typeset' || w === 'readonly' || w === 'env') continue;
      const i = w.indexOf('=');
      if (i > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(w.slice(0, i))) pairs.push({ key: w.slice(0, i), value: w.slice(i + 1) });
      else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(w)) continue; // `export FOO` không có giá trị
      else warnings.push(`Bỏ qua: ${w.length > 40 ? w.slice(0, 40) + '…' : w}`);
    }
  }
  return { pairs, warnings };
}

function parseCmdInput(text: string): Parsed {
  const warnings: string[] = [];
  const pairs: EnvPair[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || /^(@echo\s+off|rem\b|::)/i.test(line)) return;
    let m = /^@?set\s+\/[pa]\b/i.exec(line);
    if (m) {
      warnings.push(`Dòng ${idx + 1}: "set /p|/a" không được hỗ trợ.`);
      return;
    }
    m = /^@?setx\s+("?)([^\s="]+)\1\s+(.*)$/i.exec(line);
    if (m) {
      let v = m[3].trim();
      if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
      pairs.push({ key: m[2], value: v });
      return;
    }
    m = /^@?set\s+"([^=]+)=(.*)"\s*$/i.exec(line);
    if (m) {
      pairs.push({ key: m[1].trim(), value: m[2] });
      return;
    }
    m = /^@?set\s+([^=\s][^=]*)=(.*)$/i.exec(line);
    if (m) {
      pairs.push({ key: m[1].trim(), value: m[2].replace(/\s+$/, '') });
      return;
    }
    warnings.push(`Dòng ${idx + 1} không nhận diện được: ${line.slice(0, 50)}`);
  });
  return { pairs, warnings };
}

function psParse(v: string): { value: string; closed: boolean } {
  v = v.trim();
  if (v.startsWith("'")) {
    // nháy đơn: '' → '
    let out = '';
    for (let i = 1; i < v.length; i++) {
      if (v[i] === "'") {
        if (v[i + 1] === "'") {
          out += "'";
          i++;
        } else return { value: out, closed: true };
      } else out += v[i];
    }
    return { value: out, closed: false };
  }
  if (v.startsWith('"')) {
    let out = '';
    for (let i = 1; i < v.length; i++) {
      const c = v[i];
      if (c === '`' && i + 1 < v.length) {
        const e = v[++i];
        out += e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e === '0' ? '\0' : e;
      } else if (c === '"') {
        if (v[i + 1] === '"') {
          out += '"';
          i++;
        } else return { value: out, closed: true };
      } else out += c;
    }
    return { value: out, closed: false };
  }
  return { value: v.replace(/;\s*$/, '').trim(), closed: true };
}

function psString(v: string): string {
  return psParse(v).value;
}

function parsePowershellInput(text: string): Parsed {
  const warnings: string[] = [];
  const pairs: EnvPair[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line || line.startsWith('#')) continue;
    let m = /^\$\{?env:([^\s=}]+)\}?\s*=\s*(.*)$/i.exec(line);
    if (m) {
      let rhs = m[2];
      let r = psParse(rhs);
      let extra = 0;
      while (!r.closed && idx + 1 < lines.length && extra < MAX_MULTILINE) {
        idx++;
        extra++;
        rhs += '\n' + lines[idx];
        r = psParse(rhs);
      }
      pairs.push({ key: m[1], value: r.value });
      continue;
    }
    m = /^\[(?:System\.)?Environment\]::SetEnvironmentVariable\(\s*("(?:[^"]*)"|'(?:[^']*)')\s*,\s*((?:"(?:[^"`]|`.)*"|'(?:[^']|'')*'|[^,)]+))/i.exec(line);
    if (m) {
      pairs.push({ key: psString(m[1]), value: psString(m[2]) });
      continue;
    }
    warnings.push(`Dòng ${idx + 1} không nhận diện được: ${line.slice(0, 50)}`);
  }
  return { pairs, warnings };
}

export function parseEnvInput(text: string, format: Exclude<InFormat, 'auto'>): Parsed {
  try {
    switch (format) {
      case 'dotenv': {
        const p = parseDotenv(text);
        const warnings: string[] = [];
        const bad = p.items.filter((i) => i.kind === 'invalid');
        if (bad.length) warnings.push(`Có ${bad.length} dòng không hợp lệ bị bỏ qua (vd. dòng ${bad[0].line}).`);
        if (p.items.some((i) => i.kind === 'entry' && i.unterminated)) warnings.push('Có giá trị mở nháy nhưng không đóng.');
        return { pairs: pairsFromDotenv(text), warnings };
      }
      case 'json':
        return parseJsonInput(text);
      case 'yaml':
        return parseYamlInput(text);
      case 'compose':
        return parseComposeInput(text);
      case 'k8s':
        return parseK8sInput(text);
      case 'docker':
        return parseDockerInput(text);
      case 'shell':
        return parseShellInput(text);
      case 'cmd':
        return parseCmdInput(text);
      case 'powershell':
        return parsePowershellInput(text);
    }
  } catch (e) {
    return { pairs: [], warnings: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function inferValue(v: string): string | number | boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?(0|[1-9]\d{0,14})(\.\d{1,10})?$/.test(v) && v !== '-0') return Number(v);
  return v;
}

function psQuote(v: string): string {
  return "'" + v.replace(/'/g, "''") + "'";
}

export function formatEnvOutput(pairs: EnvPair[], opts: ConvertOptions): { output: string; warnings: string[] } {
  const warnings: string[] = [];
  const name = opts.name.trim() || 'app-config';
  const obj = () => {
    const o: Record<string, unknown> = {};
    for (const p of pairs) o[p.key] = opts.inferTypes ? inferValue(p.value) : p.value;
    return o;
  };
  const strObj = () => {
    const o: Record<string, string> = {};
    for (const p of pairs) o[p.key] = p.value;
    return o;
  };
  const meta = () => {
    const m: Record<string, string> = { name };
    if (opts.namespace.trim()) m.namespace = opts.namespace.trim();
    return m;
  };
  const checkK8sKeys = () => {
    const bad = pairs.filter((p) => !/^[-._a-zA-Z0-9]+$/.test(p.key) || p.key.length > 253);
    if (bad.length) warnings.push(`Khóa không hợp lệ cho Kubernetes: ${bad.slice(0, 3).map((b) => b.key).join(', ')}${bad.length > 3 ? '…' : ''} (chỉ cho phép chữ, số, "-", "_", ".").`);
    if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(name)) warnings.push(`Tên "${name}" không hợp lệ cho Kubernetes (chữ thường, số, "-" và ".").`);
  };
  switch (opts.to) {
    case 'dotenv': {
      const lines: string[] = [];
      for (const p of pairs) {
        if (opts.keepComments && p.comment) lines.push(p.comment);
        if (!NAME_RE.test(p.key)) warnings.push(`Tên biến "${p.key}" không hợp lệ cho shell.`);
        lines.push(formatDotenvLine(p.key, p.value, opts.exportPrefix));
      }
      return { output: lines.join('\n') + (lines.length ? '\n' : ''), warnings };
    }
    case 'json':
      return { output: JSON.stringify(obj(), null, 2) + '\n', warnings };
    case 'yaml':
      return { output: pairs.length ? stringifyYaml(obj()) : '{}\n', warnings };
    case 'docker': {
      const parts = pairs.map((p) => `-e ${shQuote(`${p.key}=${p.value}`)}`);
      return { output: parts.join(opts.dockerOneLine ? ' ' : ' \\\n') + (parts.length ? '\n' : ''), warnings };
    }
    case 'compose-map':
      return { output: pairs.length ? stringifyYaml({ environment: strObj() }) : 'environment: {}\n', warnings };
    case 'compose-list':
      return { output: pairs.length ? stringifyYaml({ environment: pairs.map((p) => `${p.key}=${p.value}`) }) : 'environment: []\n', warnings };
    case 'k8s-configmap':
      checkK8sKeys();
      return { output: stringifyYaml({ apiVersion: 'v1', kind: 'ConfigMap', metadata: meta(), data: strObj() }), warnings };
    case 'k8s-secret-string':
      checkK8sKeys();
      return { output: stringifyYaml({ apiVersion: 'v1', kind: 'Secret', metadata: meta(), type: 'Opaque', stringData: strObj() }), warnings };
    case 'k8s-secret-data': {
      checkK8sKeys();
      const d: Record<string, string> = {};
      for (const p of pairs) d[p.key] = encodeB64Utf8(p.value);
      warnings.push('base64 chỉ là mã hóa, không phải bảo mật — đừng commit Secret lên git.');
      return { output: stringifyYaml({ apiVersion: 'v1', kind: 'Secret', metadata: meta(), type: 'Opaque', data: d }), warnings };
    }
    case 'shell': {
      const lines: string[] = [];
      for (const p of pairs) {
        if (!NAME_RE.test(p.key)) {
          warnings.push(`Tên biến "${p.key}" không hợp lệ cho shell — đã chuyển thành comment.`);
          lines.push(`# ${p.key}=${p.value.replace(/\n/g, ' ')}`);
          continue;
        }
        if (opts.keepComments && p.comment) lines.push(p.comment);
        lines.push(`export ${p.key}=${shQuote(p.value)}`);
      }
      return { output: lines.join('\n') + (lines.length ? '\n' : ''), warnings };
    }
    case 'cmd': {
      const lines: string[] = [];
      for (const p of pairs) {
        if (/[\r\n"]/.test(p.value)) warnings.push(`Giá trị của "${p.key}" chứa xuống dòng hoặc dấu " — CMD không biểu diễn tốt.`);
        else if (/[%!]/.test(p.value)) warnings.push(`Giá trị của "${p.key}" chứa % hoặc ! — cần gấp đôi (%%) khi dùng trong file .bat.`);
        lines.push(`set "${p.key}=${p.value.replace(/\r?\n/g, ' ')}"`);
      }
      return { output: lines.join('\r\n').replace(/\r\n/g, '\n') + (lines.length ? '\n' : ''), warnings };
    }
    case 'powershell': {
      const lines = pairs.map((p) => {
        const k = /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.key) ? `$env:${p.key}` : `\${env:${p.key}}`;
        return `${k} = ${psQuote(p.value)}`;
      });
      return { output: lines.join('\n') + (lines.length ? '\n' : ''), warnings };
    }
  }
}

export function convertEnv(text: string, options: Partial<ConvertOptions> = {}): ConvertResult {
  const opts = { ...DEFAULT_CONVERT, ...options };
  if (!text.trim()) return { ok: true, output: '', pairs: [], warnings: [] };
  if (text.length > MAX_ENV_INPUT) {
    return { ok: false, output: '', pairs: [], warnings: [], error: `Đầu vào quá lớn (tối đa ${Math.round(MAX_ENV_INPUT / 1000)} KB).` };
  }
  try {
    const detected = opts.from === 'auto' ? detectEnvFormat(text) : opts.from;
    const parsed = parseEnvInput(text, detected);
    if (parsed.error) return { ok: false, output: '', pairs: [], warnings: parsed.warnings, error: parsed.error, detected };
    // khử trùng: giữ vị trí đầu, giá trị cuối
    const idx = new Map<string, number>();
    let pairs: EnvPair[] = [];
    let dups = 0;
    for (const p of parsed.pairs) {
      if (!p.key) continue;
      const at = idx.get(p.key);
      if (at !== undefined) {
        pairs[at] = { ...pairs[at], value: p.value };
        dups++;
      } else {
        idx.set(p.key, pairs.length);
        pairs.push(p);
      }
    }
    const warnings = [...parsed.warnings];
    if (dups) warnings.push(`Có ${dups} khóa trùng — giá trị sau ghi đè giá trị trước.`);
    if (opts.sort) pairs = [...pairs].sort((a, b) => cmp(a.key, b.key));
    const out = formatEnvOutput(pairs, opts);
    return { ok: true, output: out.output, pairs, warnings: [...warnings, ...out.warnings], detected };
  } catch (e) {
    return { ok: false, output: '', pairs: [], warnings: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------- Mẫu ---------------- */

export const SAMPLE_ENV = `# Ứng dụng
APP_NAME="Cửa hàng của tôi"
APP_ENV=production
PORT=3000
DEBUG=false

# Cơ sở dữ liệu
DB_HOST=localhost
DB_USER=app
DB_PASSWORD='p@ss w0rd#1'
DATABASE_URL=postgres://\${DB_USER}:secret@\${DB_HOST}:5432/app

# Khóa bên thứ ba
STRIPE_SECRET_KEY=sk_example_replace_me_not_a_real_key
LOG_FILE=\${LOG_DIR:-/var/log}/app.log
WELCOME="Xin chào\\nThế giới" # lời chào
`;
