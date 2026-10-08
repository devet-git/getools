import { shellSplit } from '@/lib/docker-tools';

/* ============================================================
 * Dockerfile Generator & Linter — logic thuần (không phụ thuộc React)
 *  1. Parser Dockerfile (chỉ thị, tiếp dòng, heredoc, escape directive, JSON/shell form, multi-stage)
 *  2. Linter mô phỏng hadolint (id, mức độ, giải thích tiếng Việt, gợi ý tự sửa)
 *  3. Generator Dockerfile multi-stage theo stack + .dockerignore + lệnh build/run/compose
 * ============================================================ */

export const MAX_DOCKERFILE_CHARS = 300_000;
export const MAX_DOCKERFILE_LINES = 6000;

/* ---------------- 1. Parser ---------------- */

export interface Directive {
  name: string;
  value: string;
  line: number;
}

export interface InstrFlag {
  name: string;
  value: string;
  raw: string;
}

export interface Heredoc {
  name: string;
  body: string;
  line: number;
  strip: boolean;
}

export interface Instruction {
  /** Từ khóa viết hoa (FROM, RUN...). Chuỗi rỗng nếu không xác định. */
  cmd: string;
  keyword: string;
  line: number;
  endLine: number;
  /** Tham số sau từ khóa, đã nối các dòng tiếp và bỏ comment chen giữa. */
  args: string;
  /** Văn bản gốc của các dòng line..endLine. */
  raw: string;
  flags: InstrFlag[];
  /** Phần tham số sau các flag `--x=y` ở đầu. */
  rest: string;
  json: string[] | null;
  jsonInvalid: boolean;
  heredocs: Heredoc[];
  onbuild?: Instruction;
  /** ID rule bị bỏ qua qua `# hadolint ignore=...`. */
  ignore: string[];
}

export interface ParseError {
  line: number;
  message: string;
}

export interface Stage {
  index: number;
  name: string | null;
  fromLine: number;
  image: string;
  platform: string | null;
  /** Chỉ số stage cha nếu FROM tham chiếu stage trước đó. */
  parent: number | null;
  instructions: Instruction[];
}

export interface ParsedDockerfile {
  directives: Directive[];
  escape: string;
  instructions: Instruction[];
  /** Các chỉ thị trước FROM đầu tiên (thường là ARG). */
  preFrom: Instruction[];
  stages: Stage[];
  errors: ParseError[];
  lineCount: number;
}

export const KNOWN_INSTRUCTIONS = new Set([
  'FROM', 'RUN', 'CMD', 'LABEL', 'MAINTAINER', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER',
  'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL',
]);

const FLAG_CMDS = new Set(['FROM', 'RUN', 'COPY', 'ADD', 'HEALTHCHECK']);
const JSON_CMDS = new Set(['RUN', 'CMD', 'ENTRYPOINT', 'COPY', 'ADD', 'VOLUME', 'SHELL', 'HEALTHCHECK']);
const HEREDOC_CMDS = new Set(['RUN', 'COPY', 'ADD']);

export function parseJsonArray(s: string): string[] | null {
  const t = s.trim();
  if (!t.startsWith('[')) return null;
  try {
    const v: unknown = JSON.parse(t);
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
    return null;
  } catch {
    return null;
  }
}

function takeFlags(args: string): { flags: InstrFlag[]; rest: string } {
  const flags: InstrFlag[] = [];
  let rest = args;
  for (let guard = 0; guard < 50; guard++) {
    const m = rest.match(/^--([A-Za-z][\w-]*)(?:=((?:"[^"]*"|'[^']*'|[^\s"'])*))?(?:\s+|$)/);
    if (!m) break;
    flags.push({ name: m[1].toLowerCase(), value: m[2] ?? '', raw: m[0].trim() });
    rest = rest.slice(m[0].length);
  }
  return { flags, rest: rest.trim() };
}

function makeInstruction(keyword: string, args: string, line: number, endLine: number, raw: string): Instruction {
  const cmd = KNOWN_INSTRUCTIONS.has(keyword.toUpperCase()) ? keyword.toUpperCase() : '';
  const inst: Instruction = {
    cmd, keyword, line, endLine, args, raw, flags: [], rest: args, json: null, jsonInvalid: false, heredocs: [], ignore: [],
  };
  if (FLAG_CMDS.has(cmd)) {
    const t = takeFlags(args);
    inst.flags = t.flags;
    inst.rest = t.rest;
  }
  if (JSON_CMDS.has(cmd)) {
    let body = inst.rest;
    if (cmd === 'HEALTHCHECK') body = body.replace(/^CMD\s+/i, '');
    if (body.startsWith('[')) {
      const j = parseJsonArray(body);
      if (j) inst.json = j;
      else inst.jsonInvalid = true;
    }
  }
  if (cmd === 'ONBUILD') {
    const m = args.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    if (m) inst.onbuild = makeInstruction(m[1], (m[2] ?? '').trim(), line, endLine, raw);
  }
  return inst;
}

function escapeRe(ch: string): string {
  return ch === '`' ? '`' : '\\\\';
}

/** Phân tích Dockerfile. Không bao giờ ném lỗi. */
export function parseDockerfile(input: string): ParsedDockerfile {
  const text = input.replace(/^\uFEFF/, '');
  const lines = text.split(/\r\n|\n/);
  const n = lines.length;
  const errors: ParseError[] = [];
  const directives: Directive[] = [];
  const instructions: Instruction[] = [];
  let escape = '\\';
  let i = 0;

  // Parser directives: chỉ hợp lệ ở đầu file, liên tiếp
  while (i < n) {
    const m = lines[i].match(/^\s*#\s*([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*?)\s*$/);
    if (!m) break;
    const name = m[1].toLowerCase();
    if (name !== 'syntax' && name !== 'escape' && name !== 'check') break;
    directives.push({ name, value: m[2], line: i + 1 });
    if (name === 'escape') {
      if (m[2] === '\\' || m[2] === '`') escape = m[2];
      else errors.push({ line: i + 1, message: 'Directive `escape` chỉ nhận ký tự \\ hoặc `.' });
    }
    i++;
  }

  const contRe = new RegExp(escapeRe(escape) + '[ \\t]*$');
  let pendingIgnore: string[] = [];

  while (i < n) {
    const line = lines[i];
    const t = line.trim();
    if (t === '') {
      i++;
      continue;
    }
    if (t.startsWith('#')) {
      const im = t.match(/^#\s*hadolint\s+ignore\s*=\s*([\w,\s-]+)/i);
      if (im) pendingIgnore.push(...im[1].split(/[\s,]+/).filter(Boolean));
      i++;
      continue;
    }
    const start = i;
    let cur = i;
    let logical = '';
    for (let guard = 0; guard < MAX_DOCKERFILE_LINES + 10; guard++) {
      const ln = lines[cur];
      const cm = contRe.exec(ln);
      if (cm) {
        logical += ln.slice(0, cm.index);
        cur++;
        while (cur < n && (lines[cur].trim() === '' || lines[cur].trim().startsWith('#'))) cur++;
        if (cur >= n) {
          errors.push({ line: start + 1, message: 'Dòng tiếp (\\) ở cuối file nhưng không có dòng nào theo sau.' });
          cur = n - 1;
          break;
        }
        continue;
      }
      logical += ln;
      break;
    }
    let end = cur;
    const lm = logical.trimStart().match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const keyword = lm ? lm[1] : '';
    const args = (lm?.[2] ?? '').trim();
    const inst = makeInstruction(keyword, args, start + 1, end + 1, '');

    // Heredoc
    if (HEREDOC_CMDS.has(inst.cmd) && !args.startsWith('[')) {
      const found: { name: string; strip: boolean }[] = [];
      const re = /(^|\s)<<(-?)(["']?)([A-Za-z_]\w*)\3/g;
      let hm: RegExpExecArray | null;
      let guard = 0;
      while ((hm = re.exec(args)) && guard++ < 10) found.push({ name: hm[4], strip: hm[2] === '-' });
      if (found.length) {
        let p = end + 1;
        const bodies: Heredoc[] = [];
        let ok = true;
        for (const f of found) {
          const bodyStart = p;
          const buf: string[] = [];
          let closed = false;
          while (p < n) {
            const l = lines[p];
            const cmp = f.strip ? l.replace(/^\t+/, '') : l;
            p++;
            if (cmp === f.name) {
              closed = true;
              break;
            }
            buf.push(f.strip ? l.replace(/^\t+/, '') : l);
          }
          if (!closed) {
            ok = false;
            break;
          }
          bodies.push({ name: f.name, body: buf.join('\n'), line: bodyStart + 1, strip: f.strip });
        }
        if (ok) {
          inst.heredocs = bodies;
          end = p - 1;
        }
      }
    }
    inst.endLine = end + 1;
    inst.raw = lines.slice(start, end + 1).join('\n');
    inst.ignore = pendingIgnore;
    pendingIgnore = [];
    instructions.push(inst);
    i = end + 1;
  }

  // Stages
  const preFrom: Instruction[] = [];
  const stages: Stage[] = [];
  let curStage: Stage | null = null;
  for (const inst of instructions) {
    if (inst.cmd === 'FROM') {
      const toks = inst.rest.split(/\s+/).filter(Boolean);
      const image = toks[0] ?? '';
      let name: string | null = null;
      if (toks.length >= 3 && toks[1].toUpperCase() === 'AS') name = toks[2];
      if (!image) errors.push({ line: inst.line, message: 'FROM thiếu tên image.' });
      else if (toks.length === 2 || (toks.length >= 3 && toks[1].toUpperCase() !== 'AS') || toks.length > 3) {
        errors.push({ line: inst.line, message: 'Cú pháp FROM không hợp lệ. Dạng đúng: FROM [--platform=...] image[:tag] [AS tên].' });
      }
      const plat = inst.flags.find((f) => f.name === 'platform');
      let parent: number | null = null;
      for (const s of stages) if (s.name && s.name.toLowerCase() === image.toLowerCase()) parent = s.index;
      curStage = {
        index: stages.length, name, fromLine: inst.line, image, platform: plat ? plat.value : null, parent, instructions: [],
      };
      stages.push(curStage);
    } else if (curStage) curStage.instructions.push(inst);
    else preFrom.push(inst);
  }
  return { directives, escape, instructions, preFrom, stages, errors, lineCount: n };
}

/* ---------------- Shell trong RUN ---------------- */

export interface ShCmd {
  words: string[];
  /** Toán tử đứng ngay sau lệnh: '&&' '||' ';' '|' '&' hoặc ''. */
  next: string;
  /** Toán tử đứng ngay trước lệnh. */
  prev: string;
}

/** Tách script shell thành các lệnh đơn giản (có quan tâm quote / comment / pipe). Không ném lỗi, có giới hạn kích thước. */
export function shCommands(script: string): ShCmd[] {
  const s = script.length > 100_000 ? script.slice(0, 100_000) : script;
  const out: ShCmd[] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let prevOp = '';
  const endWord = () => {
    if (inWord) {
      words.push(word);
      word = '';
      inWord = false;
    }
  };
  const endCmd = (op: string) => {
    endWord();
    if (words.length) out.push({ words, next: op, prev: prevOp });
    else if (out.length && op) out[out.length - 1].next = out[out.length - 1].next || op;
    words = [];
    prevOp = op;
  };
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i++;
    } else if (c === '\n') {
      endCmd(';');
      i++;
    } else if (c === '#' && !inWord) {
      while (i < n && s[i] !== '\n') i++;
    } else if (c === '\\') {
      if (s[i + 1] === '\n') i += 2;
      else {
        if (i + 1 < n) {
          word += s[i + 1];
          inWord = true;
        }
        i += 2;
      }
    } else if (c === "'") {
      inWord = true;
      i++;
      while (i < n && s[i] !== "'") word += s[i++];
      i++;
    } else if (c === '"') {
      inWord = true;
      i++;
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < n) {
          if ('"\\$`\n'.includes(s[i + 1])) {
            if (s[i + 1] !== '\n') word += s[i + 1];
            i += 2;
            continue;
          }
        }
        word += s[i++];
      }
      i++;
    } else if (c === '$' && s[i + 1] === '(') {
      inWord = true;
      let depth = 0;
      while (i < n) {
        const d = s[i];
        word += d;
        i++;
        if (d === '(') depth++;
        else if (d === ')') {
          depth--;
          if (depth <= 0) break;
        }
      }
    } else if (c === '`') {
      inWord = true;
      word += c;
      i++;
      while (i < n && s[i] !== '`') word += s[i++];
      if (i < n) word += s[i++];
    } else if (c === '&' && s[i + 1] === '&') {
      endCmd('&&');
      i += 2;
    } else if (c === '|' && s[i + 1] === '|') {
      endCmd('||');
      i += 2;
    } else if (c === '|') {
      endCmd('|');
      i++;
    } else if (c === ';') {
      endCmd(';');
      i += s[i + 1] === ';' ? 2 : 1;
    } else if (c === '&') {
      if (s[i - 1] === '>' || s[i - 1] === '<' || s[i + 1] === '>') {
        word += c;
        inWord = true;
        i++;
      } else {
        endCmd('&');
        i++;
      }
    } else if (c === '(' || c === ')') {
      endCmd(';');
      i++;
    } else {
      word += c;
      inWord = true;
      i++;
    }
  }
  endCmd('');
  return out;
}

const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'in', 'case', 'esac', '!', '{', '}', 'time']);
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'nice', 'ionice', 'xargs', 'builtin']);

export interface CmdInfo {
  name: string;
  args: string[];
  sudo: boolean;
}

export function baseName(w: string): string {
  const k = w.lastIndexOf('/');
  return k >= 0 ? w.slice(k + 1) : w;
}

/** Xác định tên lệnh thật (bỏ biến môi trường đứng trước, từ khóa shell, env/command...). */
export function cmdInfo(words: string[]): CmdInfo | null {
  let i = 0;
  let sudo = false;
  for (let guard = 0; guard < 40 && i < words.length; guard++) {
    const w = words[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || SHELL_KEYWORDS.has(w)) {
      i++;
      continue;
    }
    if (baseName(w) === 'sudo') {
      sudo = true;
      i++;
      while (i < words.length && words[i].startsWith('-')) i++;
      continue;
    }
    if (WRAPPERS.has(baseName(w))) {
      i++;
      while (i < words.length && (words[i].startsWith('-') || /^[A-Za-z_]\w*=/.test(words[i]))) i++;
      continue;
    }
    break;
  }
  if (i >= words.length) return sudo ? { name: 'sudo', args: [], sudo: true } : null;
  return { name: baseName(words[i]), args: words.slice(i + 1), sudo };
}

export interface RunMount {
  type: string;
  target: string;
}

export function parseMounts(inst: Instruction): RunMount[] {
  const res: RunMount[] = [];
  for (const f of inst.flags) {
    if (f.name !== 'mount') continue;
    const kv: Record<string, string> = {};
    for (const part of f.value.replace(/^["']|["']$/g, '').split(',')) {
      const k = part.indexOf('=');
      if (k > 0) kv[part.slice(0, k).trim()] = part.slice(k + 1).trim();
    }
    res.push({ type: kv.type ?? 'bind', target: kv.target ?? kv.dst ?? kv.destination ?? '' });
  }
  return res;
}

/** Script shell thực sự của một RUN (xử lý heredoc / exec form). null nếu không phân tích được. */
export function runScript(inst: Instruction): string | null {
  if (inst.json) return inst.json.map((w) => (/[\s'"$]/.test(w) ? `'${w.replace(/'/g, "'\\''")}'` : w)).join(' ');
  if (inst.heredocs.length && inst.rest.trimStart().startsWith('<<')) {
    const body = inst.heredocs[0].body;
    if (/^#!/.test(body) && !/^#!.*\b(sh|bash|ash|dash|zsh)\b/.test(body)) return null;
    return body;
  }
  return inst.rest;
}

/** Tách tham số theo khoảng trắng, tôn trọng dấu nháy (dùng cho COPY/ADD/EXPOSE/ENV...). */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inW = false;
  let q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = '';
      else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      inW = true;
    } else if (/\s/.test(c)) {
      if (inW) out.push(cur);
      cur = '';
      inW = false;
    } else {
      cur += c;
      inW = true;
    }
  }
  if (inW) out.push(cur);
  return out;
}

export interface KV {
  key: string;
  value: string;
  hasValue: boolean;
}

/** Phân tích ENV / ARG / LABEL: hỗ trợ `k=v k2="v 2"` và dạng cũ `ENV k v v v`. */
export function parseKeyValues(args: string, cmd: string): { pairs: KV[]; legacy: boolean } {
  const toks = splitArgs(args);
  if (!toks.length) return { pairs: [], legacy: false };
  const allEq = toks.every((t) => t.includes('=') && !t.startsWith('='));
  if (cmd === 'ARG') {
    return { pairs: toks.map((t) => { const k = t.indexOf('='); return k < 0 ? { key: t, value: '', hasValue: false } : { key: t.slice(0, k), value: t.slice(k + 1), hasValue: true }; }), legacy: false };
  }
  if (allEq) {
    return { pairs: toks.map((t) => { const k = t.indexOf('='); return { key: t.slice(0, k), value: t.slice(k + 1), hasValue: true }; }), legacy: false };
  }
  const m = args.match(/^(\S+)\s+([\s\S]*)$/);
  if (m && !m[1].includes('=')) {
    const v = m[2].trim();
    const unq = splitArgs(v);
    return { pairs: [{ key: m[1], value: unq.length === 1 ? unq[0] : v, hasValue: true }], legacy: true };
  }
  return { pairs: toks.map((t) => { const k = t.indexOf('='); return k < 0 ? { key: t, value: '', hasValue: false } : { key: t.slice(0, k), value: t.slice(k + 1), hasValue: true }; }), legacy: false };
}

/* ---------------- 2. Linter ---------------- */

export type Severity = 'error' | 'warning' | 'info' | 'style';

export interface LintFix {
  description: string;
  startLine: number;
  endLine: number;
  /** Văn bản thay thế cho các dòng startLine..endLine (có thể nhiều dòng). */
  replacement: string;
  /** safe=true: thay đổi gần như chắc chắn không đổi hành vi. */
  safe: boolean;
}

export interface LintIssue {
  id: string;
  severity: Severity;
  line: number;
  endLine: number;
  message: string;
  explain: string;
  fix?: LintFix;
}

export interface LintResult {
  issues: LintIssue[];
  counts: Record<Severity, number>;
  score: number;
  parsed: ParsedDockerfile;
}

export const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info', 'style'];
export const SEVERITY_LABEL: Record<Severity, string> = { error: 'Lỗi', warning: 'Cảnh báo', info: 'Gợi ý', style: 'Phong cách' };
const PENALTY: Record<Severity, number> = { error: 15, warning: 6, info: 2, style: 1 };

/** Danh mục rule (mô phỏng hadolint; DFxxxx là rule bổ sung của công cụ này). */
export const RULES: Record<string, { severity: Severity; title: string }> = {
  DL3000: { severity: 'error', title: 'WORKDIR phải là đường dẫn tuyệt đối' },
  DL3002: { severity: 'warning', title: 'USER cuối cùng không nên là root' },
  DL3003: { severity: 'warning', title: 'Dùng WORKDIR thay vì `cd` trong RUN' },
  DL3004: { severity: 'error', title: 'Không dùng sudo' },
  DL3005: { severity: 'error', title: 'Không dùng apt-get upgrade / dist-upgrade' },
  DL3006: { severity: 'warning', title: 'Image gốc chưa ghim tag' },
  DL3007: { severity: 'warning', title: 'Image gốc dùng tag :latest' },
  DL3009: { severity: 'info', title: 'Xóa /var/lib/apt/lists sau khi cài' },
  DL3011: { severity: 'error', title: 'Cổng EXPOSE không hợp lệ' },
  DL3014: { severity: 'error', title: 'apt-get install thiếu -y' },
  DL3015: { severity: 'info', title: 'Thiếu --no-install-recommends' },
  DL3017: { severity: 'error', title: 'Không dùng apk upgrade' },
  DL3019: { severity: 'info', title: 'apk add thiếu --no-cache' },
  DL3020: { severity: 'error', title: 'Dùng COPY thay vì ADD cho file/thư mục' },
  DL3021: { severity: 'error', title: 'COPY nhiều nguồn cần đích kết thúc bằng /' },
  DL3022: { severity: 'warning', title: 'COPY --from tham chiếu stage không tồn tại' },
  DL3023: { severity: 'error', title: 'COPY --from tham chiếu chính stage hiện tại' },
  DL3024: { severity: 'error', title: 'Tên stage bị trùng' },
  DL3025: { severity: 'warning', title: 'CMD/ENTRYPOINT nên dùng dạng JSON (exec form)' },
  DL3027: { severity: 'error', title: 'Dùng apt-get thay cho apt' },
  DL3029: { severity: 'warning', title: 'FROM --platform bị gán cứng' },
  DL3030: { severity: 'error', title: 'yum install thiếu -y' },
  DL3032: { severity: 'warning', title: 'Thiếu yum clean all' },
  DL3038: { severity: 'error', title: 'dnf install thiếu -y' },
  DL3040: { severity: 'warning', title: 'Thiếu dnf clean all' },
  DL3042: { severity: 'warning', title: 'pip install thiếu --no-cache-dir' },
  DL3043: { severity: 'error', title: 'ONBUILD không được chứa FROM/MAINTAINER/ONBUILD' },
  DL3044: { severity: 'error', title: 'ENV tham chiếu biến trong cùng một chỉ thị' },
  DL3045: { severity: 'warning', title: 'COPY vào đường dẫn tương đối khi chưa có WORKDIR' },
  DL3048: { severity: 'style', title: 'Khóa LABEL không đúng định dạng' },
  DL3057: { severity: 'info', title: 'Thiếu HEALTHCHECK' },
  DL3059: { severity: 'style', title: 'Nhiều RUN liên tiếp có thể gộp' },
  DL3060: { severity: 'info', title: 'Thiếu yarn cache clean' },
  DL3061: { severity: 'error', title: 'Thứ tự chỉ thị không hợp lệ' },
  DL4000: { severity: 'error', title: 'MAINTAINER đã lỗi thời' },
  DL4001: { severity: 'warning', title: 'Dùng cả wget và curl' },
  DL4003: { severity: 'warning', title: 'Nhiều CMD trong một stage' },
  DL4004: { severity: 'error', title: 'Nhiều ENTRYPOINT trong một stage' },
  DL4006: { severity: 'warning', title: 'Pipe trong RUN thiếu pipefail' },
  DF0001: { severity: 'error', title: 'Dockerfile quá lớn' },
  DF1001: { severity: 'info', title: 'ADD tải file từ URL' },
  DF1002: { severity: 'warning', title: 'Tải script từ mạng rồi chạy thẳng (curl | sh)' },
  DF1003: { severity: 'warning', title: 'COPY toàn bộ mã nguồn trước khi cài dependency' },
  DF1004: { severity: 'info', title: 'chown -R tạo lớp thừa, dùng COPY --chown' },
  DF2001: { severity: 'warning', title: 'Bí mật trong ENV/ARG' },
  DF2002: { severity: 'warning', title: 'chmod 777' },
  DF2003: { severity: 'warning', title: 'Container chạy bằng root (không có USER)' },
  DF2005: { severity: 'error', title: 'Chuỗi giống khóa/bí mật thật trong Dockerfile' },
  DF2007: { severity: 'warning', title: 'Tắt kiểm tra chứng chỉ TLS' },
  DF3001: { severity: 'warning', title: 'npm install thay vì npm ci' },
  DF3002: { severity: 'info', title: 'yarn/pnpm install chưa khóa lockfile' },
  DF3003: { severity: 'info', title: 'Thiếu dọn cache npm' },
  DF6001: { severity: 'info', title: 'ONBUILD sẽ chạy ở image con' },
  DF6002: { severity: 'error', title: 'Chỉ thị không xác định' },
  DF6003: { severity: 'error', title: 'Cú pháp chỉ thị không hợp lệ' },
  DF6005: { severity: 'style', title: 'Tên stage nên viết thường' },
  DF6006: { severity: 'style', title: 'LABEL nên dùng cú pháp key=value' },
  DF7002: { severity: 'warning', title: 'Nhiều HEALTHCHECK trong một stage' },
  DF7004: { severity: 'warning', title: 'apt-get update đứng riêng một RUN' },
};

const SECRET_NAME = /(PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL|SIGNING[_-]?KEY|ENCRYPTION[_-]?KEY|(^|[_-])PASS$|(^|[_-])KEY$)/i;
const SECRET_NAME_SAFE = /(_FILE|_PATH|_DIR|_URL|_NAME|_ID|PUBLIC|_ENDPOINT|_HOST|_PORT|_FROM)$/i;
const SECRET_VALUE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
  { re: /gh[pousr]_[A-Za-z0-9]{30,}/, label: 'GitHub token' },
  { re: /github_pat_[A-Za-z0-9_]{20,}/, label: 'GitHub fine-grained token' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}/, label: 'API key dạng sk-…' },
  { re: /AIza[0-9A-Za-z_-]{35}/, label: 'Google API key' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./, label: 'JWT' },
  { re: /[a-z][a-z0-9+.-]*:\/\/[^\s:/@$]+:[^\s@$/]{3,}@/i, label: 'URL chứa user:password' },
];

const ARCHIVE_RE = /\.(tar|tgz|tbz2?|tb2|txz|tar\.(gz|bz2|xz|zst|lz|lzma|z))$/i;
const URL_RE = /^(https?:\/\/|git@|git:\/\/|ssh:\/\/)/i;

function validPort(tok: string): boolean {
  const m = tok.match(/^(\d{1,6})(?:-(\d{1,6}))?(?:\/(tcp|udp|sctp))?$/i);
  if (!m) return false;
  const a = Number(m[1]);
  const b = m[2] !== undefined ? Number(m[2]) : a;
  return a <= 65535 && b <= 65535 && a <= b;
}

function shortTag(image: string): { name: string; tag: string | null; digest: string | null } {
  let rest = image;
  let digest: string | null = null;
  const at = rest.indexOf('@');
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  const lastSlash = rest.lastIndexOf('/');
  const colon = rest.indexOf(':', lastSlash + 1);
  if (colon >= 0) return { name: rest.slice(0, colon), tag: rest.slice(colon + 1), digest };
  return { name: rest, tag: null, digest };
}

function expandVars(s: string, vars: Map<string, string | null>): string | null {
  let unresolved = false;
  const out = s.replace(/\$\{([A-Za-z_]\w*)(?::?-([^}]*))?\}|\$([A-Za-z_]\w*)/g, (_m, a: string | undefined, def: string | undefined, b: string | undefined) => {
    const name = a ?? b ?? '';
    const v = vars.get(name);
    if (v !== undefined && v !== null && v !== '') return v;
    if (def !== undefined) return def;
    unresolved = true;
    return '';
  });
  return unresolved ? null : out;
}

const DEP_INSTALL = (c: CmdInfo): boolean => {
  const a = c.args.filter((x) => !x.startsWith('-'));
  switch (c.name) {
    case 'npm': return ['ci', 'install', 'i', 'clean-install'].includes(a[0] ?? '') && !c.args.some((x) => x === '-g' || x === '--global');
    case 'yarn': return a.length === 0 || a[0] === 'install';
    case 'pnpm': return ['install', 'i'].includes(a[0] ?? '');
    case 'bun': return ['install', 'i'].includes(a[0] ?? '');
    case 'pip': case 'pip3': return a[0] === 'install' && c.args.some((x) => x === '-r' || x === '--requirement' || x === '.' || x === '-e');
    case 'poetry': return a[0] === 'install';
    case 'pipenv': return a[0] === 'install' || a[0] === 'sync';
    case 'uv': return a[0] === 'sync' || (a[0] === 'pip' && a[1] === 'install');
    case 'bundle': case 'bundler': return a[0] === 'install' || a.length === 0;
    case 'composer': return a[0] === 'install';
    case 'go': return a[0] === 'mod' && (a[1] === 'download' || a[1] === 'vendor');
    case 'cargo': return a[0] === 'fetch';
    case 'dotnet': return a[0] === 'restore';
    case 'mvn': case 'mvnw': return a.some((x) => x.startsWith('dependency:')) || false;
    case 'gradle': case 'gradlew': return a[0] === 'dependencies';
    default: return false;
  }
};

function pipInstall(c: CmdInfo): boolean {
  if (/^pip[0-9.]*$/.test(c.name)) return c.args.filter((x) => !x.startsWith('-'))[0] === 'install';
  if (/^python[0-9.]*$/.test(c.name)) {
    const i = c.args.indexOf('-m');
    return i >= 0 && c.args[i + 1] === 'pip' && c.args.slice(i + 2).filter((x) => !x.startsWith('-'))[0] === 'install';
  }
  return false;
}

/** Tiện ích: thay thế regex nhưng chỉ khi đoạn lệnh phía sau chưa có cờ. */
function patchCommands(
  src: string,
  re: RegExp,
  hasFlag: (segment: string) => boolean,
  insert: (m: RegExpExecArray) => string
): string {
  re.lastIndex = 0;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(src)) && guard++ < 200) {
    const afterIdx = m.index + m[0].length;
    const seg = src.slice(m.index, afterIdx) + src.slice(afterIdx).split(/&&|\|\||;|\|\s|\n(?!\s*[\w-])/)[0];
    out += src.slice(last, afterIdx);
    if (!hasFlag(seg)) out += insert(m);
    last = afterIdx;
  }
  return out + src.slice(last);
}

export function lintDockerfile(input: string, opts: { ignore?: string[] } = {}): LintResult {
  const empty = (): Record<Severity, number> => ({ error: 0, warning: 0, info: 0, style: 0 });
  if (input.length > MAX_DOCKERFILE_CHARS || input.split('\n').length > MAX_DOCKERFILE_LINES) {
    const parsed = parseDockerfile('');
    const issue: LintIssue = {
      id: 'DF0001', severity: 'error', line: 1, endLine: 1,
      message: 'Dockerfile quá lớn để phân tích trong trình duyệt.',
      explain: `Giới hạn ${MAX_DOCKERFILE_CHARS.toLocaleString('vi-VN')} ký tự / ${MAX_DOCKERFILE_LINES} dòng. Hãy tách nhỏ hoặc cắt bớt rồi kiểm tra lại.`,
    };
    return { issues: [issue], counts: { ...empty(), error: 1 }, score: 85, parsed };
  }
  const parsed = parseDockerfile(input);
  const issues: LintIssue[] = [];
  const globalIgnore = new Set((opts.ignore ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean));

  const add = (
    id: string,
    at: { line: number; endLine: number; ignore?: string[] },
    message: string,
    explain: string,
    fix?: LintFix,
    severity?: Severity
  ) => {
    if (globalIgnore.has(id)) return;
    if (at.ignore && at.ignore.some((x) => x.toUpperCase() === id)) return;
    issues.push({ id, severity: severity ?? RULES[id]?.severity ?? 'warning', line: at.line, endLine: at.endLine, message, explain, fix });
  };

  const fixOf = (
    inst: Instruction,
    transform: (src: string) => string | null,
    description: string,
    safe: boolean
  ): LintFix | undefined => {
    if (inst.heredocs.length) return undefined;
    const out = transform(inst.raw);
    if (out === null || out === inst.raw) return undefined;
    return { description, startLine: inst.line, endLine: inst.endLine, replacement: out, safe };
  };

  for (const e of parsed.errors) add('DF6003', { line: e.line, endLine: e.line }, e.message, 'Docker sẽ từ chối build hoặc hiểu sai Dockerfile ở vị trí này.');

  // ARG toàn cục
  const globalArgs = new Map<string, string | null>();
  for (const a of parsed.preFrom) {
    if (a.cmd === 'ARG') for (const kv of parseKeyValues(a.rest, 'ARG').pairs) globalArgs.set(kv.key, kv.hasValue ? kv.value : null);
  }
  // Biến môi trường tắt cache pip
  let pipNoCacheEnv = false;
  for (const inst of parsed.instructions) {
    if (inst.cmd === 'ENV' || inst.cmd === 'ARG') {
      for (const kv of parseKeyValues(inst.rest, inst.cmd).pairs) {
        if (kv.key === 'PIP_NO_CACHE_DIR' && kv.hasValue && !/^(0|false|off|no|)$/i.test(kv.value)) pipNoCacheEnv = true;
      }
    }
  }

  // Thứ tự chỉ thị: phải bắt đầu bằng FROM (hoặc ARG)
  if (parsed.stages.length === 0) {
    if (parsed.instructions.length === 0) {
      add('DL3061', { line: 1, endLine: 1 }, 'Dockerfile trống.', 'Một Dockerfile hợp lệ phải có ít nhất một chỉ thị FROM.');
    } else {
      add('DL3061', { line: parsed.instructions[0].line, endLine: parsed.instructions[0].endLine }, 'Dockerfile không có chỉ thị FROM.', 'Mỗi Dockerfile phải bắt đầu bằng FROM (chỉ ARG được phép đứng trước).');
    }
  }
  for (const inst of parsed.preFrom) {
    if (inst.cmd !== 'ARG') {
      add('DL3061', inst, `${inst.keyword.toUpperCase()} xuất hiện trước FROM.`, 'Trước FROM chỉ được phép có ARG (và comment / parser directive). Hãy đặt FROM lên đầu.');
    }
  }

  const stageNames = new Map<string, number>();
  const stateOf: { workdir: boolean; user: string | null; userInst: Instruction | null; health: boolean; pipefail: boolean; winShell: boolean }[] = [];
  let seenCurl = false;
  let seenWget = false;
  const lastStage = parsed.stages.length - 1;

  for (const st of parsed.stages) {
    const parentState = st.parent !== null ? stateOf[st.parent] : null;
    const state = {
      workdir: parentState?.workdir ?? false,
      user: parentState?.user ?? null,
      userInst: parentState?.userInst ?? null,
      health: parentState?.health ?? false,
      pipefail: parentState?.pipefail ?? false,
      winShell: parentState?.winShell ?? false,
    };
    stateOf.push(state);
    const fromInst = parsed.instructions.find((x) => x.cmd === 'FROM' && x.line === st.fromLine) as Instruction;
    let cmdCount = 0;
    let entryCount = 0;
    let healthCount = 0;
    const stageEnv = new Map<string, string | null>(globalArgs);

    // --- FROM ---
    if (st.image) {
      const expanded = st.image.includes('$') ? expandVars(st.image, globalArgs) : st.image;
      const lowerImg = st.image.toLowerCase();
      const isScratch = lowerImg === 'scratch';
      if (expanded && !isScratch && st.parent === null) {
        const t = shortTag(expanded);
        if (!t.tag && !t.digest) {
          add('DL3006', fromInst, `Image gốc \`${t.name}\` chưa ghim tag phiên bản.`,
            'Không ghi tag nghĩa là Docker lấy `latest`, nên mỗi lần build có thể ra một kết quả khác. Hãy ghim phiên bản cụ thể, ví dụ `node:24-bookworm-slim`, hoặc ghim theo digest `@sha256:...` để build tái lập được.');
        } else if (t.tag && t.tag.toLowerCase() === 'latest' && !t.digest) {
          add('DL3007', fromInst, `Image gốc \`${t.name}:latest\` dùng tag latest.`,
            'Tag `latest` trôi theo thời gian: build hôm nay và tuần sau có thể khác nhau, khó tái lập và khó rollback. Ghim một phiên bản cụ thể (hoặc digest).');
        }
      }
      if (st.platform && !st.platform.includes('$')) {
        add('DL3029', fromInst, `FROM --platform=${st.platform} bị gán cứng.`,
          'Gán cứng nền tảng làm image không build được tự nhiên trên kiến trúc khác (ví dụ Apple Silicon / ARM). Dùng `--platform=$BUILDPLATFORM` cho stage build, hoặc bỏ cờ và truyền `--platform` khi chạy `docker buildx build`.');
      }
    }
    if (st.name) {
      const key = st.name.toLowerCase();
      if (stageNames.has(key)) {
        add('DL3024', fromInst, `Tên stage \`${st.name}\` bị trùng với stage ở trên.`, 'Mỗi stage phải có tên duy nhất, nếu không `COPY --from=` sẽ tham chiếu mơ hồ.');
      } else stageNames.set(key, st.index);
      if (st.name !== st.name.toLowerCase() || !/^[A-Za-z][\w.-]*$/.test(st.name)) {
        add('DF6005', fromInst, `Tên stage \`${st.name}\` nên viết thường (chỉ a-z, 0-9, _ . -).`, 'BuildKit khuyến nghị tên stage viết thường để nhất quán và tránh lỗi phân biệt hoa/thường.');
      }
    }

    let prevRun: Instruction | null = null;
    let firstCopyAll: Instruction | null = null;
    let firstDepInstall = -1;
    let copyAllIdx = -1;
    const aptInstalls: { idx: number; inst: Instruction }[] = [];

    st.instructions.forEach((inst, idx) => {
      // --- kiểm tra chung ---
      if (!inst.cmd) {
        add('DF6002', inst, `Chỉ thị không xác định: \`${inst.keyword}\`.`, 'Docker không có chỉ thị này. Có thể bạn gõ sai tên, thiếu ký tự tiếp dòng `\\`, hoặc dòng tiếp của lệnh trước bị ngắt.');
        prevRun = null;
        return;
      }
      if (inst.cmd !== 'RUN') prevRun = inst.cmd === 'RUN' ? inst : null;
      const noArg = !inst.rest && !inst.heredocs.length;
      if (noArg && inst.cmd !== 'ONBUILD') {
        add('DF6003', inst, `${inst.cmd} thiếu tham số.`, 'Chỉ thị này bắt buộc có tham số.');
      }
      if (inst.jsonInvalid && inst.cmd !== 'RUN') {
        add('DF6003', inst, `${inst.cmd}: trông như JSON nhưng không hợp lệ.`, 'Dạng exec form phải là mảng JSON hợp lệ với dấu nháy kép: `["a", "b"]`. Nháy đơn hoặc dấu phẩy thừa khiến Docker coi đó là shell form và chạy sai.');
      }
      scanSecretsInText(inst);

      switch (inst.cmd) {
        case 'MAINTAINER': {
          add('DL4000', inst, 'MAINTAINER đã lỗi thời.', 'Thay bằng nhãn OCI: `LABEL org.opencontainers.image.authors="..."`.',
            fixOf(inst, () => `LABEL org.opencontainers.image.authors=${JSON.stringify(inst.rest.replace(/^["']|["']$/g, ''))}`, 'Đổi sang LABEL org.opencontainers.image.authors', true));
          break;
        }
        case 'WORKDIR': {
          const v = inst.rest.replace(/^["']|["']$/g, '');
          if (v && !v.startsWith('/') && !v.includes('$') && !/^[A-Za-z]:[\\/]/.test(v)) {
            add('DL3000', inst, `WORKDIR \`${v}\` là đường dẫn tương đối.`, 'Dùng đường dẫn tuyệt đối để rõ ràng và tránh phụ thuộc vào WORKDIR trước đó.',
              fixOf(inst, () => `${inst.keyword} /${v.replace(/^\.\//, '')}`, 'Thêm / ở đầu đường dẫn', true));
          }
          state.workdir = true;
          break;
        }
        case 'USER': {
          const u = splitArgs(inst.rest)[0] ?? '';
          const name = u.split(':')[0];
          state.user = name;
          state.userInst = inst;
          break;
        }
        case 'HEALTHCHECK': {
          healthCount++;
          state.health = true;
          if (healthCount === 2) add('DF7002', inst, 'Có nhiều HEALTHCHECK trong cùng một stage.', 'Chỉ HEALTHCHECK cuối cùng có hiệu lực; các cái trước bị bỏ qua.');
          const body = inst.rest;
          if (!/^NONE$/i.test(body) && !/^CMD\b/i.test(body) && body) {
            add('DF6003', inst, 'HEALTHCHECK phải là `NONE` hoặc `CMD ...`.', 'Cú pháp: HEALTHCHECK [--interval=30s --timeout=3s --start-period=10s --retries=3] CMD lệnh.');
          }
          break;
        }
        case 'SHELL': {
          if (!inst.json) add('DF6003', inst, 'SHELL bắt buộc ở dạng JSON.', 'Ví dụ: `SHELL ["/bin/bash", "-o", "pipefail", "-c"]`.');
          else {
            state.pipefail = inst.json.some((x) => x.includes('pipefail'));
            state.winShell = /powershell|cmd/i.test(inst.json[0] ?? '');
          }
          break;
        }
        case 'EXPOSE': {
          const toks = splitArgs(inst.rest);
          for (const t of toks) {
            if (t.includes('$')) continue;
            if (!validPort(t)) {
              add('DL3011', inst, `Cổng EXPOSE \`${t}\` không hợp lệ.`, 'Cổng hợp lệ nằm trong khoảng 0–65535, tùy chọn kèm giao thức: `8080`, `53/udp`, `8000-8010`.');
            }
          }
          break;
        }
        case 'CMD':
        case 'ENTRYPOINT': {
          if (inst.cmd === 'CMD') {
            cmdCount++;
            if (cmdCount === 2) add('DL4003', inst, 'Có nhiều hơn một CMD trong stage này.', 'Chỉ CMD cuối cùng có hiệu lực. Xóa các CMD thừa để tránh hiểu nhầm.');
          } else {
            entryCount++;
            if (entryCount === 2) add('DL4004', inst, 'Có nhiều hơn một ENTRYPOINT trong stage này.', 'Chỉ ENTRYPOINT cuối cùng có hiệu lực. Xóa các ENTRYPOINT thừa.');
          }
          if (!inst.json && inst.rest && !inst.jsonInvalid) {
            const simple = !/[$&|;<>()*?~`\\{}!]/.test(inst.rest);
            add('DL3025', inst, `${inst.cmd} đang ở shell form.`,
              'Shell form chạy qua `/bin/sh -c`, nên tiến trình của bạn không phải PID 1 và không nhận SIGTERM khi `docker stop` (tắt chậm 10 giây, mất kết nối đang xử lý). Dùng exec form: `["node", "server.js"]`.',
              simple ? fixOf(inst, () => `${inst.keyword} [${splitArgs(inst.rest).map((x) => JSON.stringify(x)).join(', ')}]`, 'Đổi sang exec form (JSON)', true) : undefined);
          }
          break;
        }
        case 'ONBUILD': {
          const inner = inst.onbuild;
          if (!inner || !inner.keyword) {
            add('DF6003', inst, 'ONBUILD thiếu chỉ thị đi kèm.', 'Cú pháp: ONBUILD <chỉ thị>.');
          } else {
            if (['FROM', 'MAINTAINER', 'ONBUILD'].includes(inner.cmd)) {
              add('DL3043', inst, `ONBUILD không được chứa ${inner.cmd}.`, 'Docker cấm các trigger ONBUILD lồng nhau và FROM / MAINTAINER.');
            } else if (!inner.cmd) {
              add('DF6002', inst, `ONBUILD chứa chỉ thị không xác định: \`${inner.keyword}\`.`, 'Kiểm tra lại tên chỉ thị.');
            }
            add('DF6001', inst, `ONBUILD ${inner.keyword.toUpperCase()} sẽ chạy khi image này được dùng làm base.`, 'Trigger ONBUILD gây hành vi bất ngờ ở image con (nhất là COPY/RUN). Chỉ nên dùng cho image "builder" dùng nội bộ, ghi rõ trong tài liệu.');
          }
          break;
        }
        case 'LABEL': {
          const { pairs, legacy } = parseKeyValues(inst.rest, 'LABEL');
          if (legacy) add('DF6006', inst, 'LABEL dạng cũ `LABEL key value`.', 'Dùng cú pháp `LABEL key="value"` — dạng cũ dễ sai khi giá trị có khoảng trắng và đã bị BuildKit cảnh báo.');
          for (const kv of pairs) {
            const k = kv.key;
            const bad = !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(k) || /(\.\.|--)/.test(k);
            const reserved = /^(com\.docker|io\.docker|org\.dockerproject)\./.test(k);
            if (bad || reserved) {
              add('DL3048', inst, `Khóa LABEL \`${k}\` không đúng định dạng.`,
                reserved ? 'Không dùng các namespace dành riêng của Docker (com.docker.*, io.docker.*, org.dockerproject.*).' : 'Khóa LABEL chỉ nên gồm chữ thường, số, dấu chấm và gạch ngang, bắt đầu và kết thúc bằng chữ/số (khuyến nghị dạng tên miền ngược: `org.opencontainers.image.title`).');
            }
            checkValueSecret(inst, kv.value);
          }
          break;
        }
        case 'ENV':
        case 'ARG': {
          const { pairs } = parseKeyValues(inst.rest, inst.cmd);
          const definedHere = new Set<string>();
          for (const kv of pairs) {
            if (!kv.key) continue;
            if (inst.cmd === 'ENV') {
              for (const rm of kv.value.matchAll(/\$\{?([A-Za-z_]\w*)/g)) {
                if (definedHere.has(rm[1])) {
                  add('DL3044', inst, `ENV dùng biến \`${rm[1]}\` ngay trong chỉ thị đã định nghĩa nó.`, 'Trong một chỉ thị ENV, mọi biến đều được tính theo giá trị TRƯỚC chỉ thị đó, nên `$' + rm[1] + '` sẽ rỗng hoặc cũ. Tách thành hai chỉ thị ENV.');
                }
              }
              definedHere.add(kv.key);
            }
            stageEnv.set(kv.key, kv.hasValue ? kv.value : null);
            const looksSecretName = SECRET_NAME.test(kv.key) && !SECRET_NAME_SAFE.test(kv.key);
            const literal = kv.hasValue && kv.value !== '' && !kv.value.includes('$');
            if (looksSecretName && inst.cmd === 'ENV' && literal) {
              add('DF2001', inst, `ENV \`${kv.key}\` có vẻ chứa bí mật được ghi thẳng vào image.`,
                'Giá trị ENV được lưu vĩnh viễn trong image (xem bằng `docker inspect` / `docker history`). Hãy truyền bí mật lúc chạy (`docker run -e`, secret của orchestrator) hoặc dùng `RUN --mount=type=secret` khi build.');
            } else if (looksSecretName && inst.cmd === 'ARG') {
              if (literal) {
                add('DF2001', inst, `ARG \`${kv.key}\` có giá trị mặc định giống bí mật.`, 'Giá trị ARG vẫn lộ trong `docker history`. Đừng đặt mặc định bí mật; dùng `RUN --mount=type=secret,id=...` để đưa bí mật vào lúc build.');
              } else {
                add('DF2001', inst, `ARG \`${kv.key}\` truyền bí mật qua build-arg.`, 'Build-arg được ghi lại trong lịch sử image (`docker history`). Với bí mật, dùng `docker build --secret id=...` kết hợp `RUN --mount=type=secret`.', undefined, 'info');
              }
            }
            if (kv.hasValue) checkValueSecret(inst, kv.value);
          }
          break;
        }
        case 'ADD':
        case 'COPY': {
          const toks = inst.json ?? splitArgs(inst.rest);
          const dest = toks.length >= 2 ? toks[toks.length - 1] : '';
          const sources = toks.slice(0, Math.max(0, toks.length - 1)).filter((x) => !x.startsWith('<<'));
          const from = inst.flags.find((f) => f.name === 'from');
          if (toks.length === 1 && !inst.heredocs.length) {
            add('DF6003', inst, `${inst.cmd} cần ít nhất một nguồn và một đích.`, `Cú pháp: ${inst.cmd} [--chown=u:g] nguồn... đích.`);
          }
          if (inst.cmd === 'ADD') {
            const urlSrc = sources.some((s) => URL_RE.test(s));
            const allArchive = sources.length > 0 && sources.every((s) => ARCHIVE_RE.test(s) || URL_RE.test(s));
            if (sources.length && !allArchive && !urlSrc && !inst.heredocs.length) {
              add('DL3020', inst, 'Dùng COPY thay cho ADD khi chỉ sao chép file/thư mục.',
                'ADD có thêm "phép màu" (tự giải nén, tải URL) gây bất ngờ. COPY rõ ràng và dự đoán được hơn; chỉ dùng ADD để tự giải nén tar cục bộ.',
                fixOf(inst, (s) => s.replace(/^(\s*)ADD\b/i, '$1COPY'), 'Đổi ADD thành COPY', true));
            }
            if (urlSrc && !inst.flags.some((f) => f.name === 'checksum') && sources.some((s) => /^https?:\/\//i.test(s) && !/\.git(#|$)/.test(s))) {
              add('DF1001', inst, 'ADD tải file từ URL từ xa mà không kiểm checksum.',
                'File tải về không được xác minh và nằm thẳng trong layer. Dùng `ADD --checksum=sha256:... URL dest` (BuildKit) hoặc `RUN curl ... && sha256sum -c` rồi xóa file tạm trong cùng RUN.');
            }
          }
          if (from) {
            const v = from.value.replace(/^["']|["']$/g, '');
            const lower = v.toLowerCase();
            if (/^\d+$/.test(v)) {
              if (Number(v) >= st.index) add('DL3022', inst, `COPY --from=${v} tham chiếu stage chưa tồn tại.`, 'Chỉ số stage phải nhỏ hơn stage hiện tại (đếm từ 0).');
            } else if (st.name && lower === st.name.toLowerCase()) {
              add('DL3023', inst, `COPY --from=${v} tham chiếu chính stage đang build.`, 'Một stage không thể sao chép từ chính nó. Hãy tách thành stage khác.');
            } else if (stageNames.has(lower)) {
              // ok
            } else if (parsed.stages.some((s) => s.name && s.name.toLowerCase() === lower && s.index > st.index)) {
              add('DL3022', inst, `COPY --from=${v} trỏ tới stage được định nghĩa SAU stage này.`, 'Chỉ có thể sao chép từ stage nằm phía trên. Đổi thứ tự các stage.');
            } else if (!/[/:.@$]/.test(v)) {
              add('DL3022', inst, `COPY --from=${v} không khớp tên stage nào.`, 'Nếu muốn sao chép từ một image ngoài, hãy ghi đầy đủ tên (ví dụ `nginx:1.29`). Nếu là stage thì kiểm tra lại chính tả.');
            }
          }
          const wild = sources.filter((s) => /[*?[]/.test(s));
          const destOk = dest.endsWith('/') || dest === '.' || dest === '..' || dest.includes('$');
          if (sources.length > 1 && !destOk && !inst.heredocs.length) {
            add('DL3021', inst, `${inst.cmd} có nhiều nguồn nhưng đích \`${dest}\` không kết thúc bằng /.`, 'Khi có nhiều nguồn, đích phải là thư mục và kết thúc bằng `/`, nếu không Docker báo lỗi.',
              fixOf(inst, (s) => s.replace(/(\S+)\s*$/, (m0, d: string) => (d === dest ? `${d}/` : m0)), 'Thêm / vào cuối đích', true));
          } else if (wild.length && !destOk && sources.length === 1) {
            add('DL3021', inst, `${inst.cmd} dùng wildcard nhưng đích \`${dest}\` không kết thúc bằng /.`, 'Nếu wildcard khớp nhiều file, build sẽ lỗi. Thêm `/` vào cuối đích để chắc chắn đích là thư mục.',
              fixOf(inst, (s) => s.replace(/(\S+)\s*$/, (m0, d: string) => (d === dest ? `${d}/` : m0)), 'Thêm / vào cuối đích', true), 'warning');
          }
          if (dest && !state.workdir && !dest.startsWith('/') && !dest.startsWith('$') && !dest.startsWith('~') && !/^[A-Za-z]:[\\/]/.test(dest)) {
            add('DL3045', inst, `${inst.cmd} vào \`${dest}\` (tương đối) nhưng stage chưa đặt WORKDIR.`, 'Đích tương đối được tính từ thư mục gốc `/` của image nếu chưa có WORKDIR, rất dễ làm file nằm sai chỗ. Đặt WORKDIR trước hoặc dùng đường dẫn tuyệt đối.');
          }
          if (!from) {
            const isAll = sources.some((s) => s === '.' || s === './' || s === '*' || s === './*');
            if (isAll && !firstCopyAll) {
              firstCopyAll = inst;
              copyAllIdx = idx;
            }
          }
          break;
        }
        case 'RUN': {
          analyzeRun(inst, idx);
          break;
        }
        default:
          break;
      }
      if (inst.cmd !== 'RUN') prevRun = null;
    });

    // DF1003 sau khi biết vị trí cài dependency
    if (firstCopyAll && firstDepInstall > copyAllIdx) {
      add('DF1003', firstCopyAll, '`COPY . .` đứng trước bước cài dependency làm mất cache layer.',
        'Mỗi lần sửa bất kỳ file nào, layer COPY thay đổi và toàn bộ bước cài dependency phía sau chạy lại. Hãy COPY riêng file khai báo (package.json + lockfile, requirements.txt, go.mod...) → cài dependency → rồi mới COPY mã nguồn.');
    }
    // DL3009: kiểm tra từng RUN cài apt đã dọn lists trong stage chưa
    for (const a of aptInstalls) {
      const cleaned = st.instructions.some((x, j) => j >= a.idx && x.cmd === 'RUN' && runCleansAptLists(x));
      if (!cleaned) {
        add('DL3009', a.inst, 'Chưa xóa danh sách gói apt (/var/lib/apt/lists) sau khi cài.',
          'Thư mục này chỉ phục vụ lúc cài đặt nhưng bị giữ lại trong layer, làm image to thêm vài chục MB. Thêm `&& rm -rf /var/lib/apt/lists/*` vào cùng lệnh RUN (hoặc dùng cache mount).',
          fixOf(a.inst, (s) => (/(^|[^\\])#/.test(s.split('\n').pop() ?? '') ? null : `${s.replace(/\s+$/, '')} && \\\n    rm -rf /var/lib/apt/lists/*`), 'Thêm && rm -rf /var/lib/apt/lists/*', false));
      }
    }

    function checkValueSecret(inst: Instruction, value: string) {
      for (const p of SECRET_VALUE_PATTERNS) {
        if (p.re.test(value)) {
          add('DF2005', inst, `Giá trị giống ${p.label} thật được ghi trong Dockerfile.`, 'Bí mật nằm trong Dockerfile sẽ vào lịch sử Git và mọi layer của image. Hãy thu hồi/đổi khóa này ngay và dùng secret mount hoặc biến môi trường lúc chạy.');
          return;
        }
      }
    }
    function scanSecretsInText(inst: Instruction) {
      if (inst.cmd === 'RUN' || inst.cmd === 'CMD' || inst.cmd === 'ENTRYPOINT') checkValueSecret(inst, inst.args);
    }
    function runCleansAptLists(x: Instruction): boolean {
      const script = runScript(x) ?? '';
      if (/rm\s+(-\S+\s+)*[^;&|\n]*\/var\/lib\/apt\/lists/.test(script)) return true;
      return parseMounts(x).some((m) => m.type === 'cache' && m.target.startsWith('/var/lib/apt'));
    }

    function analyzeRun(inst: Instruction, idx: number) {
      const script = runScript(inst);
      // Gộp RUN liên tiếp
      const flagKey = inst.flags.map((f) => f.raw).join(' ');
      if (prevRun && !inst.heredocs.length && !prevRun.heredocs.length && !inst.json && !prevRun.json && prevRun.flags.map((f) => f.raw).join(' ') === flagKey && !inst.jsonInvalid) {
        const first = prevRun;
        add('DL3059', inst, 'Nhiều RUN liên tiếp có thể gộp thành một.',
          'Mỗi RUN tạo một layer. Gộp các lệnh liên quan bằng `&&` giảm số layer và đảm bảo bước dọn dẹp thực sự giảm kích thước.',
          (() => {
            if (first.cmd !== 'RUN' || first.endLine + 1 > inst.line) return undefined;
            // chỉ gộp nếu hai RUN liền nhau (cho phép dòng trống)
            const body2 = inst.raw.replace(/^\s*RUN\s+/i, '').trim();
            const head = first.raw.replace(/\s+$/, '');
            return {
              description: 'Gộp hai RUN liền nhau', startLine: first.line, endLine: inst.endLine,
              replacement: `${head} && \\\n    ${body2}`, safe: false,
            } as LintFix;
          })());
      }
      prevRun = inst;
      if (inst.jsonInvalid) {
        add('DF6003', inst, 'RUN: trông như JSON nhưng không hợp lệ.', 'Mảng JSON phải dùng nháy kép. Nếu bạn muốn shell form, đừng bắt đầu bằng `[`.');
      }
      if (script === null || state.winShell) return;
      const cmds = shCommands(script);
      const mounts = parseMounts(inst);
      const cacheTargets = mounts.filter((m) => m.type === 'cache').map((m) => m.target);
      const hasCache = cacheTargets.length > 0;
      const reportedApt = { y: false, nir: false, upgrade: false };
      let didAptInstall = false;
      let didAptUpdate = false;
      const reported = new Set<string>();
      const once = (key: string, fn: () => void) => {
        if (reported.has(key)) return;
        reported.add(key);
        fn();
      };

      const infos = cmds.map((c) => ({ c, info: cmdInfo(c.words) }));
      const pipefailInline = infos.some(({ info }) => info?.name === 'set' && info.args.some((a) => a.includes('pipefail')));
      let pipeInfo = null as { left: string; right: string } | null;

      infos.forEach(({ c, info }, k) => {
        if (!info) return;
        const name = info.name;
        const args = info.args;
        const words = c.words;
        const nonFlag = args.filter((a) => !a.startsWith('-'));

        if (info.sudo || name === 'sudo') {
          once('sudo', () => add('DL3004', inst, 'Không dùng `sudo` trong Dockerfile.',
            'RUN đã chạy bằng root (hoặc USER hiện tại) nên sudo thừa, kéo thêm gói và có thể gây lỗi tty. Cần quyền khác thì đổi bằng USER.',
            fixOf(inst, (s) => s.replace(/\bsudo\s+(-\S+\s+)*/g, ''), 'Bỏ sudo', true)));
        }
        if (name === 'cd') {
          once('cd', () => add('DL3003', inst, 'Dùng WORKDIR thay vì `cd` trong RUN.',
            'WORKDIR rõ ràng, tái sử dụng được cho các lệnh sau và tự tạo thư mục. `cd` chỉ có hiệu lực trong một RUN.',
            fixOf(inst, (s) => {
              const m = s.match(/^(\s*RUN\s+)cd\s+(\S+)\s*&&\s*([\s\S]+)$/i);
              if (!m || /[$`]/.test(m[2])) return null;
              const dir = m[2].replace(/^["']|["']$/g, '');
              if (!dir.startsWith('/')) return null;
              return `WORKDIR ${dir}\n${m[1]}${m[3].replace(/^\\\s*\n\s*/, '')}`;
            }, 'Đổi `RUN cd X && lệnh` thành WORKDIR X + RUN lệnh', false)));
        }
        if (name === 'chmod' && args.some((a) => /^0?777$/.test(a) || /^(a|ugo)?\+rwx$/.test(a) || /^a=rwx$/.test(a))) {
          once('chmod', () => add('DF2002', inst, 'chmod 777 cấp quyền ghi cho tất cả mọi người.',
            'Quyền 777 cho phép bất kỳ tiến trình nào trong container ghi/sửa file, mở đường leo thang khi có lỗ hổng. Dùng 755 (thư mục/chương trình) hoặc 644 (file), hoặc chown cho đúng user.',
            fixOf(inst, (s) => s.replace(/(chmod\s+(?:-\S+\s+)*)0?777\b/g, '$1755'), 'Đổi 777 thành 755', false)));
        }
        if (name === 'chown' && args.some((a) => a === '-R' || a === '-r' || a === '--recursive')) {
          once('chown', () => add('DF1004', inst, '`chown -R` trong RUN nhân đôi dữ liệu vào một layer mới.',
            'Đổi chủ file sau khi COPY làm layer mới chứa lại toàn bộ file. Dùng `COPY --chown=uid:gid` ngay lúc sao chép.'));
        }
        if ((name === 'curl' && args.some((a) => a === '-k' || a === '--insecure' || /^-[a-zA-Z]*k[a-zA-Z]*$/.test(a))) || (name === 'wget' && args.includes('--no-check-certificate'))) {
          once('tls', () => add('DF2007', inst, 'Tắt kiểm tra chứng chỉ TLS khi tải file.',
            'Cho phép kẻ tấn công man-in-the-middle thay file tải về (có thể là mã độc chạy trong build). Cài `ca-certificates` thay vì dùng `-k` / `--no-check-certificate`.'));
        }
        if (name === 'curl' || name === 'wget') {
          if (name === 'curl') {
            if (seenWget && !seenCurl) once('dl4001', () => add('DL4001', inst, 'Dockerfile dùng cả wget và curl.', 'Chọn một công cụ duy nhất để không phải cài cả hai (giảm kích thước và bề mặt tấn công).'));
            seenCurl = true;
          } else {
            if (seenCurl && !seenWget) once('dl4001', () => add('DL4001', inst, 'Dockerfile dùng cả wget và curl.', 'Chọn một công cụ duy nhất để không phải cài cả hai (giảm kích thước và bề mặt tấn công).'));
            seenWget = true;
          }
        }
        // apt-get / apt
        if (name === 'apt') {
          const sub = nonFlag[0];
          if (sub && ['install', 'update', 'upgrade', 'remove', 'purge', 'autoremove', 'full-upgrade', 'dist-upgrade'].includes(sub)) {
            once('apt', () => add('DL3027', inst, 'Dùng `apt-get` thay cho `apt` trong script.',
              '`apt` là giao diện cho người dùng tương tác, đầu ra không ổn định và Docker/apt cảnh báo khi dùng trong script. Dùng `apt-get`.',
              fixOf(inst, (s) => s.replace(/\bapt(\s+(?:-\S+\s+)*)(install|update|upgrade|remove|purge|autoremove|full-upgrade|dist-upgrade)\b/g, 'apt-get$1$2'), 'Đổi apt thành apt-get', true)));
          }
        }
        if (name === 'apt-get' || name === 'apt') {
          let sub = '';
          for (let a = 0; a < args.length; a++) {
            if (args[a] === '-o' || args[a] === '-c' || args[a] === '-t') {
              a++;
              continue;
            }
            if (args[a].startsWith('-')) continue;
            sub = args[a];
            break;
          }
          if (sub === 'update') didAptUpdate = true;
          if (['upgrade', 'dist-upgrade', 'full-upgrade'].includes(sub) && !reportedApt.upgrade) {
            reportedApt.upgrade = true;
            add('DL3005', inst, `Không dùng \`apt-get ${sub}\` trong Dockerfile.`,
              'Nâng cấp toàn bộ gói làm build không tái lập được và có thể phá vỡ image gốc. Hãy cập nhật bằng cách dùng tag image gốc mới hơn.');
          }
          if (sub === 'install') {
            didAptInstall = true;
            const hasY = words.some((w) => /^-[a-zA-Z]*y[a-zA-Z]*$/.test(w) || w === '--yes' || w === '--assume-yes' || w === '-qq' || /^--quiet=2$/.test(w) || w === '--force-yes');
            const hasNir = words.some((w) => w === '--no-install-recommends' || /Install-Recommends[=\s]*(false|0)/i.test(w));
            if (!hasY && !reportedApt.y) {
              reportedApt.y = true;
              add('DL3014', inst, '`apt-get install` thiếu cờ `-y`.', 'Không có -y, apt chờ xác nhận tương tác và build sẽ thất bại hoặc treo.',
                fixOf(inst, (s) => patchCommands(s, /\bapt-get(?:\s+(?:-o\s+\S+|-\S+))*\s+install\b/g, (seg) => /\s(-[a-zA-Z]*y[a-zA-Z]*|--yes|--assume-yes|-qq)(\s|$)/.test(seg), () => ' -y'), 'Thêm -y', true));
            }
            if (!hasNir && !reportedApt.nir) {
              reportedApt.nir = true;
              add('DL3015', inst, '`apt-get install` thiếu `--no-install-recommends`.', 'Mặc định apt cài thêm cả các gói "khuyến nghị", làm image phình to. Thêm `--no-install-recommends` và liệt kê rõ gói thật sự cần.',
                fixOf(inst, (s) => patchCommands(s, /\bapt-get(?:\s+(?:-o\s+\S+|-\S+))*\s+install\b/g, (seg) => /--no-install-recommends|Install-Recommends[=\s]*(false|0)/i.test(seg), () => ' --no-install-recommends'), 'Thêm --no-install-recommends', true));
            }
          }
        }
        // apk
        if (name === 'apk') {
          const sub = nonFlag[0];
          if (sub === 'upgrade') once('apkup', () => add('DL3017', inst, 'Không dùng `apk upgrade`.', 'Nâng cấp toàn bộ gói làm build khó tái lập. Dùng tag image Alpine mới hơn.'));
          if (sub === 'add') {
            const ok = words.includes('--no-cache') || cacheTargets.some((t) => t.startsWith('/var/cache/apk')) || /rm\s+(-\S+\s+)*[^;&|\n]*\/var\/cache\/apk/.test(script);
            if (!ok) {
              once('apk', () => add('DL3019', inst, '`apk add` thiếu `--no-cache`.', '`--no-cache` bỏ qua cache chỉ mục gói, không cần `apk update` hay `rm /var/cache/apk/*` và giữ image nhỏ.',
                fixOf(inst, (s) => patchCommands(s, /\bapk(?:\s+-\S+)*\s+add\b/g, (seg) => /--no-cache/.test(seg), () => ' --no-cache'), 'Thêm --no-cache', true)));
            }
          }
        }
        // yum / dnf
        if (name === 'yum' || name === 'dnf' || name === 'microdnf') {
          const sub = nonFlag[0];
          if (sub === 'install') {
            const hasY = words.some((w) => /^-[a-zA-Z]*y[a-zA-Z]*$/.test(w) || w === '--assumeyes' || w === '--assume-yes');
            if (!hasY) once('yum-y', () => add(name === 'yum' ? 'DL3030' : 'DL3038', inst, `\`${name} install\` thiếu \`-y\`.`, 'Không có -y, lệnh chờ xác nhận và build thất bại.',
              fixOf(inst, (s) => patchCommands(s, new RegExp(`\\b${name}(?:\\s+-\\S+)*\\s+install\\b`, 'g'), (seg) => /\s-[a-zA-Z]*y|--assumeyes/.test(seg), () => ' -y'), 'Thêm -y', true)));
            const cleaned = /(yum|dnf|microdnf)\s+clean\s+all/.test(script) || /rm\s+(-\S+\s+)*[^;&|\n]*\/var\/cache\/(yum|dnf)/.test(script);
            if (!cleaned) once('yum-clean', () => add(name === 'yum' ? 'DL3032' : 'DL3040', inst, `Thiếu \`${name} clean all\` sau khi cài.`, 'Cache gói bị giữ trong layer làm image to. Thêm `&& ' + name + ' clean all` vào cùng RUN.'));
          }
        }
        // pip
        if (pipInstall(info)) {
          const ok = args.includes('--no-cache-dir') || pipNoCacheEnv || cacheTargets.some((t) => /pip/.test(t)) || args.includes('--no-cache');
          const viaUv = baseName(words[0] ?? '') === 'uv';
          if (!ok && !viaUv) {
            once('pip', () => add('DL3042', inst, '`pip install` thiếu `--no-cache-dir`.', 'pip lưu file tải về trong ~/.cache/pip và nằm lại trong layer. Thêm `--no-cache-dir` (hoặc dùng `RUN --mount=type=cache,target=/root/.cache/pip`).',
              fixOf(inst, (s) => patchCommands(s, /\b(?:pip[0-9.]*|python[0-9.]*\s+-m\s+pip)(?:\s+-\S+)*\s+install\b/g, (seg) => /--no-cache-dir|--no-cache/.test(seg), () => ' --no-cache-dir'), 'Thêm --no-cache-dir', true)));
          }
        }
        // npm / yarn / pnpm
        if (name === 'npm') {
          const sub = nonFlag[0];
          const global = args.includes('-g') || args.includes('--global');
          if ((sub === 'install' || sub === 'i') && !global && nonFlag.length === 1) {
            once('npm-i', () => add('DF3001', inst, 'Dùng `npm install` thay vì `npm ci`.', '`npm ci` cài đúng theo package-lock.json (tái lập, nhanh hơn, lỗi nếu lock lệch) — phù hợp cho build image. `npm install` có thể sửa lockfile và cài khác nhau giữa các lần build.',
              fixOf(inst, (s) => s.replace(/\bnpm\s+(?:install|i)\b(?!\s+[^-\s&|;])/, 'npm ci'), 'Đổi sang npm ci (cần package-lock.json)', false)));
          }
          if ((sub === 'install' || sub === 'i' || sub === 'ci') && !global && si_final()) {
            const cleaned = /npm\s+cache\s+(clean|rm)/.test(script) || /rm\s+(-\S+\s+)*[^;&|\n]*\.npm/.test(script) || hasCache || args.includes('--cache') || words.some((w) => w.startsWith('--cache='));
            if (!cleaned) once('npm-cache', () => add('DF3003', inst, 'Chưa dọn cache npm trong stage cuối.', 'Cache ~/.npm nằm lại trong layer. Thêm `&& npm cache clean --force`, hoặc dùng `RUN --mount=type=cache,target=/root/.npm`, hoặc tách thành stage build rồi chỉ COPY kết quả.'));
          }
        }
        if (name === 'yarn') {
          const sub = nonFlag[0];
          if ((nonFlag.length === 0 || sub === 'install') && !words.some((w) => w === '--frozen-lockfile' || w === '--immutable')) {
            once('yarn-i', () => add('DF3002', inst, '`yarn install` chưa khóa lockfile.', 'Thêm `--frozen-lockfile` (Yarn 1) hoặc `--immutable` (Yarn Berry) để build lỗi khi lockfile lệch, đảm bảo tái lập.'));
          }
          if ((nonFlag.length === 0 || sub === 'install' || sub === 'add') && si_final()) {
            const cleaned = /yarn\s+cache\s+clean/.test(script) || hasCache || /rm\s+(-\S+\s+)*[^;&|\n]*(\.yarn|yarn)/.test(script);
            if (!cleaned) once('yarn-cache', () => add('DL3060', inst, 'Thiếu `yarn cache clean` sau khi cài.', 'Cache của yarn bị giữ trong layer. Thêm `&& yarn cache clean` vào cùng RUN hoặc dùng cache mount.'));
          }
        }
        if (name === 'pnpm') {
          const sub = nonFlag[0];
          if ((sub === 'install' || sub === 'i') && !words.some((w) => w === '--frozen-lockfile')) {
            once('pnpm-i', () => add('DF3002', inst, '`pnpm install` chưa có `--frozen-lockfile`.', 'Trong môi trường CI pnpm tự bật frozen-lockfile, nhưng khi build Docker nên ghi rõ `--frozen-lockfile` để tái lập.'));
          }
        }
        // cài dependency (cho DF1003)
        if (firstDepInstall < 0 && DEP_INSTALL(info)) firstDepInstall = idx;
        // pipe
        if (c.next === '|' && !pipeInfo) {
          const nxt = infos[k + 1]?.info;
          pipeInfo = { left: name, right: nxt?.name ?? '' };
        }
      });

      if (didAptInstall) {
        aptInstalls.push({ idx, inst });
      }
      if (didAptUpdate && !didAptInstall && !cmds.some((c) => cmdInfo(c.words)?.name === 'apt-get' && /upgrade/.test(c.words.join(' ')))) {
        add('DF7004', inst, '`apt-get update` đứng riêng trong một RUN.',
          'Layer `apt-get update` bị cache lại; lần sau thêm gói ở RUN khác sẽ dùng danh sách gói cũ và lỗi 404. Luôn gộp `apt-get update && apt-get install ...` trong cùng một RUN.');
      }
      if (pipeInfo && !state.pipefail && !pipefailInline && !state.winShell) {
        const shellDl = /^(curl|wget)$/.test(pipeInfo.left) && /^(sh|bash|zsh|dash|ash|python[0-9.]*|perl|ruby|node)$/.test(pipeInfo.right);
        add('DL4006', inst, shellDl ? 'Pipe `curl | sh` không có pipefail: nếu tải lỗi, build vẫn "thành công".' : 'RUN có pipe `|` nhưng chưa bật `pipefail`.',
          'Shell chỉ trả về mã thoát của lệnh CUỐI trong pipe, nên lỗi của lệnh đầu bị nuốt mất. Đặt `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` trước RUN này (cần có bash; trên Alpine hãy `apk add bash`) hoặc tách bước tải và bước xử lý.',
          {
            description: 'Chèn SHELL ["/bin/bash", "-o", "pipefail", "-c"] trước RUN (cần bash trong image)',
            startLine: inst.line, endLine: inst.endLine,
            replacement: `SHELL ["/bin/bash", "-o", "pipefail", "-c"]\n${inst.raw}`, safe: false,
          });
        if (shellDl) {
          add('DF1002', inst, 'Tải script từ mạng rồi chạy thẳng (`curl … | sh`).',
            'Nội dung script có thể đổi hoặc bị tấn công chuỗi cung ứng, và bạn không kiểm tra được trước khi chạy. Tải về file, kiểm checksum (`sha256sum -c`), rồi mới chạy; hoặc dùng gói chính thức / image đã build sẵn.');
        }
      }
    }
    function si_final() {
      return st.index === lastStage;
    }
  }

  // Kiểm tra stage cuối
  if (lastStage >= 0) {
    const st = parsed.stages[lastStage];
    const state = stateOf[lastStage];
    const fromInst = parsed.instructions.find((x) => x.cmd === 'FROM' && x.line === st.fromLine) as Instruction;
    const nonRootBase = /nonroot|unprivileged|rootless|chainguard|cgr\.dev\//i.test(st.image);
    if (state.user !== null && (state.user.toLowerCase() === 'root' || state.user === '0') && state.userInst) {
      add('DL3002', state.userInst, 'USER cuối cùng trong stage cuối là root.',
        'Container chạy bằng root: khi tiến trình bị khai thác, kẻ tấn công có quyền cao nhất trong container (và dễ thoát ra host hơn). Tạo user thường và `USER 10001:10001` ở cuối.',
        undefined);
    } else if (state.user === null && !nonRootBase && st.image.toLowerCase() !== '') {
      add('DF2003', fromInst, 'Stage cuối không có USER, container sẽ chạy bằng root.',
        'Chạy bằng root là rủi ro bảo mật phổ biến nhất của container. Tạo user với UID cố định (ví dụ 10001), `COPY --chown`, rồi `USER 10001:10001` trước CMD/ENTRYPOINT.',
        (() => {
          // chèn USER trước CMD/ENTRYPOINT cuối (hoặc cuối stage)
          const tail = [...st.instructions].reverse().find((x) => x.cmd === 'CMD' || x.cmd === 'ENTRYPOINT');
          if (tail && !tail.heredocs.length) {
            return { description: 'Chèn USER 10001:10001 trước CMD/ENTRYPOINT (cần chắc UID này đọc được file ứng dụng)', startLine: tail.line, endLine: tail.endLine, replacement: `USER 10001:10001\n${tail.raw}`, safe: false } as LintFix;
          }
          return undefined;
        })());
    }
    if (!state.health) {
      add('DL3057', fromInst, 'Stage cuối chưa có HEALTHCHECK.', 'HEALTHCHECK giúp Docker/Compose/Swarm biết ứng dụng thật sự sẵn sàng (không chỉ tiến trình còn sống). Bỏ qua nếu orchestrator (Kubernetes) tự dùng probe riêng.');
    }
  }

  issues.sort((a, b) => a.line - b.line || SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.id.localeCompare(b.id));
  const counts = empty();
  let penalty = 0;
  for (const it of issues) {
    counts[it.severity]++;
    penalty += PENALTY[it.severity];
  }
  return { issues, counts, score: Math.max(0, 100 - penalty), parsed };
}

/** Áp dụng một sửa chữa lên văn bản gốc. */
export function applyFix(text: string, fix: LintFix): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\n/);
  const out = [...lines.slice(0, fix.startLine - 1), ...fix.replacement.split('\n'), ...lines.slice(fix.endLine)];
  return out.join(eol);
}

/** Áp dụng lặp các sửa chữa (không chồng lấn) cho đến khi hết. safeOnly=true: chỉ sửa an toàn. */
export function applyAllFixes(text: string, opts: { safeOnly?: boolean; ignore?: string[] } = {}): { text: string; applied: number } {
  let cur = text;
  let applied = 0;
  for (let pass = 0; pass < 8; pass++) {
    const res = lintDockerfile(cur, { ignore: opts.ignore });
    const fixes = res.issues.map((i) => i.fix).filter((f): f is LintFix => !!f && (!opts.safeOnly || f.safe));
    if (!fixes.length) break;
    fixes.sort((a, b) => b.startLine - a.startLine);
    let lastStart = Infinity;
    let did = 0;
    for (const f of fixes) {
      if (f.endLine >= lastStart) continue;
      const next = applyFix(cur, f);
      if (next === cur) continue;
      cur = next;
      lastStart = f.startLine;
      did++;
    }
    applied += did;
    if (!did) break;
  }
  return { text: cur, applied };
}

/* ---------------- 3. Generator ---------------- */

export type StackId =
  | 'node' | 'nextjs' | 'vite' | 'python' | 'go' | 'rust' | 'java' | 'dotnet' | 'php' | 'ruby' | 'bun' | 'deno' | 'static';
export type Variant = 'slim' | 'alpine' | 'distroless' | 'debian' | 'scratch';
export type InitMode = 'none' | 'tini' | 'dumb-init';

export interface GenOptions {
  stack: StackId;
  variant: Variant;
  pm: string;
  framework: string;
  /** '' = tự động theo stack. */
  port: string;
  appDir: string;
  uid: string;
  appName: string;
  entry: string;
  buildCmd: string;
  outDir: string;
  testCmd: string;
  healthPath: string;
  /** Image tùy chỉnh (để trống = mặc định đã ghim). */
  buildImage: string;
  runImage: string;
  buildkit: boolean;
  healthcheck: boolean;
  labels: boolean;
  init: InitMode;
  tests: boolean;
  multiarch: boolean;
  spa: boolean;
  tz: string;
  /** Danh sách `TEN=giatri` cách nhau bởi dấu phẩy hoặc xuống dòng. */
  buildArgs: string;
  repoUrl: string;
}

export const DEFAULT_GEN: GenOptions = {
  stack: 'node', variant: 'slim', pm: 'npm', framework: '', port: '', appDir: '/app', uid: '10001', appName: 'app',
  entry: '', buildCmd: '', outDir: '', testCmd: '', healthPath: '', buildImage: '', runImage: '',
  buildkit: true, healthcheck: true, labels: true, init: 'none', tests: false, multiarch: false, spa: true,
  tz: '', buildArgs: '', repoUrl: '',
};

export interface StackDef {
  id: StackId;
  label: string;
  hint: string;
  variants: Variant[];
  pms: { id: string; label: string }[];
  frameworks: { id: string; label: string }[];
}

export const VARIANT_LABEL: Record<Variant, string> = {
  slim: 'Debian slim', alpine: 'Alpine', distroless: 'Distroless', debian: 'Debian (đầy đủ)', scratch: 'scratch',
};

export const STACKS: StackDef[] = [
  { id: 'node', label: 'Node.js', hint: 'API / worker Node (Express, Fastify, NestJS...)', variants: ['slim', 'alpine', 'distroless', 'debian'], pms: [{ id: 'npm', label: 'npm' }, { id: 'yarn', label: 'Yarn' }, { id: 'pnpm', label: 'pnpm' }], frameworks: [] },
  { id: 'nextjs', label: 'Next.js (standalone)', hint: 'Cần `output: "standalone"` trong next.config', variants: ['slim', 'alpine', 'distroless', 'debian'], pms: [{ id: 'npm', label: 'npm' }, { id: 'yarn', label: 'Yarn' }, { id: 'pnpm', label: 'pnpm' }], frameworks: [] },
  { id: 'vite', label: 'Vite / SPA → nginx', hint: 'Build tĩnh rồi phục vụ bằng nginx không đặc quyền', variants: ['alpine'], pms: [{ id: 'npm', label: 'npm' }, { id: 'yarn', label: 'Yarn' }, { id: 'pnpm', label: 'pnpm' }], frameworks: [] },
  { id: 'python', label: 'Python', hint: 'pip / Poetry / uv, venv tách riêng', variants: ['slim', 'alpine', 'debian'], pms: [{ id: 'pip', label: 'pip' }, { id: 'poetry', label: 'Poetry' }, { id: 'uv', label: 'uv' }], frameworks: [{ id: 'fastapi', label: 'FastAPI (uvicorn)' }, { id: 'django', label: 'Django (gunicorn)' }, { id: 'flask', label: 'Flask (gunicorn)' }, { id: 'plain', label: 'Script thường' }] },
  { id: 'go', label: 'Go', hint: 'Binary tĩnh → distroless / scratch / alpine', variants: ['distroless', 'scratch', 'alpine', 'slim'], pms: [], frameworks: [] },
  { id: 'rust', label: 'Rust', hint: 'Cache dependency bằng bản dựng giả + cache mount', variants: ['distroless', 'slim', 'alpine'], pms: [], frameworks: [] },
  { id: 'java', label: 'Java', hint: 'Maven / Gradle → JRE; Spring Boot layered jar', variants: ['debian', 'alpine', 'distroless'], pms: [{ id: 'maven', label: 'Maven' }, { id: 'gradle', label: 'Gradle' }], frameworks: [{ id: 'spring', label: 'Spring Boot (layered jar)' }, { id: 'plain', label: 'Jar thường' }] },
  { id: 'dotnet', label: '.NET', hint: 'sdk → aspnet', variants: ['debian', 'alpine', 'distroless'], pms: [], frameworks: [] },
  { id: 'php', label: 'PHP-FPM + nginx', hint: 'Hai target: app (php-fpm) và web (nginx)', variants: ['alpine', 'debian'], pms: [{ id: 'composer', label: 'Composer' }], frameworks: [] },
  { id: 'ruby', label: 'Ruby / Rails', hint: 'Bundler, precompile assets cho Rails', variants: ['slim', 'alpine', 'debian'], pms: [], frameworks: [{ id: 'rails', label: 'Rails (rails server)' }, { id: 'rack', label: 'Rack / Sinatra (puma)' }] },
  { id: 'bun', label: 'Bun', hint: 'oven/bun, cài bằng bun install', variants: ['slim', 'alpine', 'distroless', 'debian'], pms: [], frameworks: [] },
  { id: 'deno', label: 'Deno', hint: 'denoland/deno, cache dependency khi build', variants: ['debian', 'alpine', 'distroless'], pms: [], frameworks: [] },
  { id: 'static', label: 'Site tĩnh → nginx', hint: 'Sao chép thư mục HTML/CSS/JS vào nginx', variants: ['alpine'], pms: [], frameworks: [] },
];

export function stackDef(id: StackId): StackDef {
  return STACKS.find((s) => s.id === id) ?? STACKS[0];
}

export const STACK_IDS = new Set<string>(STACKS.map((s) => s.id));
export const VARIANT_IDS = new Set<string>(['slim', 'alpine', 'distroless', 'debian', 'scratch']);

/** Giá trị tự động (hiển thị làm placeholder, dùng khi người dùng để trống). */
export interface AutoValues {
  port: string;
  entry: string;
  buildCmd: string;
  outDir: string;
  testCmd: string;
  healthPath: string;
}

export function autoValues(o: GenOptions): AutoValues {
  const pm = o.pm;
  const run = (s: string) => (pm === 'yarn' ? `yarn ${s}` : pm === 'pnpm' ? `pnpm ${s}` : `npm run ${s}`);
  const test = pm === 'yarn' ? 'yarn test' : pm === 'pnpm' ? 'pnpm test' : 'npm test';
  const name = o.appName;
  switch (o.stack) {
    case 'node': return { port: '3000', entry: 'node index.js', buildCmd: '', outDir: 'dist', testCmd: test, healthPath: '/' };
    case 'nextjs': return { port: '3000', entry: 'node server.js', buildCmd: run('build'), outDir: '', testCmd: test, healthPath: '/' };
    case 'vite': return { port: '8080', entry: 'nginx -g "daemon off;"', buildCmd: run('build'), outDir: 'dist', testCmd: test, healthPath: '/' };
    case 'python': {
      const fw = o.framework;
      const port = '8000';
      const entry = fw === 'django' ? `gunicorn myproject.wsgi:application --bind 0.0.0.0:${o.port || port}`
        : fw === 'flask' ? `gunicorn app:app --bind 0.0.0.0:${o.port || port}`
        : fw === 'plain' ? 'python main.py'
        : `uvicorn main:app --host 0.0.0.0 --port ${o.port || port}`;
      return { port, entry, buildCmd: '', outDir: '', testCmd: 'python -m pytest -q', healthPath: '/' };
    }
    case 'go': return { port: '8080', entry: `${o.appDir}/${name}`, buildCmd: `go build -trimpath -ldflags="-s -w" -o /out/${name} .`, outDir: '', testCmd: 'go test ./...', healthPath: '/' };
    case 'rust': return { port: '8080', entry: `${o.appDir}/${name}`, buildCmd: 'cargo build --release --locked', outDir: '', testCmd: 'cargo test --release', healthPath: '/' };
    case 'java': return {
      port: '8080', entry: 'java -jar application.jar',
      buildCmd: pm === 'gradle' ? 'gradle --no-daemon build -x test' : 'mvn -B -ntp package -DskipTests',
      outDir: '', testCmd: pm === 'gradle' ? 'gradle --no-daemon test' : 'mvn -B -ntp test',
      healthPath: o.framework === 'plain' ? '/' : '/actuator/health',
    };
    case 'dotnet': return { port: '8080', entry: `dotnet ${name}.dll`, buildCmd: 'dotnet publish -c Release -o /out --no-restore -p:UseAppHost=false', outDir: '', testCmd: 'dotnet test', healthPath: '/' };
    case 'php': return { port: '8080', entry: 'php-fpm', buildCmd: '', outDir: 'public', testCmd: 'vendor/bin/phpunit', healthPath: '/' };
    case 'ruby': return {
      port: '3000',
      entry: o.framework === 'rack' ? 'bundle exec puma -b tcp://0.0.0.0:3000' : './bin/rails server -b 0.0.0.0 -p 3000',
      buildCmd: o.framework === 'rack' ? '' : 'SECRET_KEY_BASE_DUMMY=1 bundle exec rails assets:precompile',
      outDir: '', testCmd: o.framework === 'rack' ? 'bundle exec rspec' : 'bin/rails test', healthPath: o.framework === 'rack' ? '/' : '/up',
    };
    case 'bun': return { port: '3000', entry: 'bun run index.ts', buildCmd: '', outDir: 'dist', testCmd: 'bun test', healthPath: '/' };
    case 'deno': return { port: '8000', entry: 'deno run --allow-net --allow-env --allow-read=. main.ts', buildCmd: '', outDir: '', testCmd: 'deno test', healthPath: '/' };
    case 'static': return { port: '8080', entry: 'nginx -g "daemon off;"', buildCmd: '', outDir: 'public', testCmd: '', healthPath: '/' };
  }
}

const DQ = (s: string) => '"' + s.replace(/[\\"$]/g, (c) => '\\' + c) + '"';
const JARR = (a: string[]) => '[' + a.map((x) => JSON.stringify(x)).join(', ') + ']';
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const imgOk = (s: string) => /^[A-Za-z0-9][A-Za-z0-9._/:@${}-]*$/.test(s);

/** Làm sạch & chuẩn hóa tuỳ chọn (không bao giờ ném lỗi). */
export function sanitizeOptions(input: Partial<GenOptions>): GenOptions {
  const o: GenOptions = { ...DEFAULT_GEN, ...input };
  if (!STACK_IDS.has(o.stack)) o.stack = 'node';
  const def = stackDef(o.stack);
  if (!def.variants.includes(o.variant)) o.variant = def.variants[0];
  if (def.pms.length) {
    if (!def.pms.some((p) => p.id === o.pm)) o.pm = def.pms[0].id;
  } else o.pm = o.stack === 'bun' ? 'bun' : '';
  if (def.frameworks.length) {
    if (!def.frameworks.some((f) => f.id === o.framework)) o.framework = def.frameworks[0].id;
  } else o.framework = '';
  o.port = /^\d{1,5}$/.test(o.port) && Number(o.port) >= 1 && Number(o.port) <= 65535 ? String(Number(o.port)) : '';
  o.appDir = /^\/[A-Za-z0-9_./-]*$/.test(o.appDir) && !o.appDir.includes('..') ? o.appDir.replace(/(.)\/+$/, '$1') : '/app';
  if (o.appDir === '/') o.appDir = '/app';
  o.uid = /^\d{1,5}$/.test(o.uid) && Number(o.uid) >= 1 && Number(o.uid) <= 65534 ? String(Number(o.uid)) : '10001';
  o.appName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(o.appName) ? o.appName : 'app';
  o.entry = oneLine(o.entry).slice(0, 400);
  o.buildCmd = oneLine(o.buildCmd).slice(0, 400);
  o.testCmd = oneLine(o.testCmd).slice(0, 400);
  o.outDir = /^[A-Za-z0-9_./-]*$/.test(o.outDir) && !o.outDir.includes('..') && !o.outDir.startsWith('/') ? o.outDir.replace(/\/+$/, '') : '';
  o.healthPath = /^\/[A-Za-z0-9_./%~-]*$/.test(o.healthPath) ? o.healthPath : '';
  o.buildImage = imgOk(o.buildImage.trim()) ? o.buildImage.trim() : '';
  o.runImage = imgOk(o.runImage.trim()) ? o.runImage.trim() : '';
  if (!['none', 'tini', 'dumb-init'].includes(o.init)) o.init = 'none';
  o.tz = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(o.tz) ? o.tz : '';
  o.repoUrl = /^https?:\/\/[^\s"'$`\\]+$/.test(o.repoUrl.trim()) ? o.repoUrl.trim() : '';
  o.buildArgs = o.buildArgs.slice(0, 2000);
  return o;
}

export function parseBuildArgs(text: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const part of text.split(/[\n,]+/)) {
    const t = part.trim();
    if (!t) continue;
    const k = t.indexOf('=');
    const name = (k < 0 ? t : t.slice(0, k)).trim();
    const value = k < 0 ? '' : t.slice(k + 1).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !out.some((x) => x.name === name) && out.length < 20) out.push({ name, value });
  }
  return out;
}

type Fam = 'apt' | 'apk' | 'none';

interface Images {
  build: string;
  run: string;
}

function pinnedImages(o: GenOptions): Images {
  const v = o.variant;
  const alp = v === 'alpine';
  switch (o.stack) {
    case 'node':
    case 'nextjs':
      return {
        build: alp ? 'node:24-alpine' : v === 'debian' ? 'node:24-bookworm' : 'node:24-bookworm-slim',
        run: v === 'distroless' ? 'gcr.io/distroless/nodejs24-debian12:nonroot' : alp ? 'node:24-alpine' : v === 'debian' ? 'node:24-bookworm' : 'node:24-bookworm-slim',
      };
    case 'vite': return { build: 'node:24-alpine', run: 'nginxinc/nginx-unprivileged:1.29-alpine' };
    case 'static': return { build: '', run: 'nginxinc/nginx-unprivileged:1.29-alpine' };
    case 'python': {
      const t = alp ? 'python:3.13-alpine' : v === 'debian' ? 'python:3.13-bookworm' : 'python:3.13-slim-bookworm';
      return { build: t, run: t };
    }
    case 'go':
      return {
        build: 'golang:1.25-alpine',
        run: v === 'scratch' ? 'scratch' : v === 'alpine' ? 'alpine:3.22' : v === 'slim' ? 'debian:bookworm-slim' : 'gcr.io/distroless/static-debian12:nonroot',
      };
    case 'rust':
      return {
        build: alp ? 'rust:1.90-alpine' : 'rust:1.90-slim-bookworm',
        run: v === 'distroless' ? 'gcr.io/distroless/cc-debian12:nonroot' : alp ? 'alpine:3.22' : 'debian:bookworm-slim',
      };
    case 'java':
      return {
        build: o.pm === 'gradle' ? 'gradle:8-jdk21' : 'maven:3.9-eclipse-temurin-21',
        run: v === 'distroless' ? 'gcr.io/distroless/java21-debian12:nonroot' : alp ? 'eclipse-temurin:21-jre-alpine' : 'eclipse-temurin:21-jre',
      };
    case 'dotnet':
      return {
        build: alp ? 'mcr.microsoft.com/dotnet/sdk:10.0-alpine' : 'mcr.microsoft.com/dotnet/sdk:10.0',
        run: v === 'distroless' ? 'mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled' : alp ? 'mcr.microsoft.com/dotnet/aspnet:10.0-alpine' : 'mcr.microsoft.com/dotnet/aspnet:10.0',
      };
    case 'php':
      return { build: 'composer:2', run: v === 'debian' ? 'php:8.4-fpm' : 'php:8.4-fpm-alpine' };
    case 'ruby': {
      const t = alp ? 'ruby:3.4-alpine' : v === 'debian' ? 'ruby:3.4-bookworm' : 'ruby:3.4-slim-bookworm';
      return { build: t, run: t };
    }
    case 'bun':
      return {
        build: alp ? 'oven/bun:1-alpine' : v === 'debian' ? 'oven/bun:1' : 'oven/bun:1-slim',
        run: v === 'distroless' ? 'oven/bun:1-distroless' : alp ? 'oven/bun:1-alpine' : v === 'debian' ? 'oven/bun:1' : 'oven/bun:1-slim',
      };
    case 'deno':
      return {
        build: alp ? 'denoland/deno:alpine-2.5.0' : 'denoland/deno:2.5.0',
        run: v === 'distroless' ? 'denoland/deno:distroless-2.5.0' : alp ? 'denoland/deno:alpine-2.5.0' : 'denoland/deno:2.5.0',
      };
  }
}

export function defaultImages(o: GenOptions): Images {
  return pinnedImages(sanitizeOptions(o));
}

export interface GenResult {
  options: GenOptions;
  auto: AutoValues;
  dockerfile: string;
  dockerignore: string;
  commands: string;
  compose: string;
  extras: { name: string; content: string; note: string }[];
  notes: string[];
  stages: string[];
  images: Images;
  port: string;
}

/** Trình dựng dòng Dockerfile với các helper dùng chung. */
class Builder {
  readonly o: GenOptions;
  readonly auto: AutoValues;
  readonly img: Images;
  readonly fam: Fam;
  readonly uid: string;
  readonly port: string;
  readonly bk: boolean;
  readonly L: string[] = [];
  readonly notes: string[] = [];
  readonly stages: string[] = [];
  readonly extras: { name: string; content: string; note: string }[] = [];

  constructor(o: GenOptions) {
    this.o = o;
    this.auto = autoValues(o);
    const pin = pinnedImages(o);
    this.img = { build: o.buildImage || pin.build, run: o.runImage || pin.run };
    const runImg = this.img.run;
    const distroless = o.variant === 'distroless' || o.variant === 'scratch' || /distroless|chiseled/.test(runImg) || runImg === 'scratch';
    const alpine = o.variant === 'alpine' || /alpine/.test(runImg);
    this.fam = distroless ? 'none' : alpine ? 'apk' : 'apt';
    this.uid = o.stack === 'vite' || o.stack === 'static' ? '101' : o.variant === 'distroless' && !o.runImage ? '65532' : o.uid;
    this.port = o.port || this.auto.port;
    this.bk = o.buildkit;
  }

  add(...ls: string[]) { this.L.push(...ls); }
  blank() { if (this.L.length && this.L[this.L.length - 1] !== '') this.L.push(''); }

  mount(target: string, extra = ''): string {
    return `--mount=type=cache,target=${target}${extra ? ',' + extra : ''}`;
  }

  /** RUN nhiều lệnh, tùy chọn kèm mount (bỏ qua khi tắt BuildKit). */
  run(cmds: string[], mounts: string[] = []): string[] {
    const items: { t: string; cmd: boolean }[] = [];
    if (this.bk) for (const m of mounts) items.push({ t: m, cmd: false });
    for (const c of cmds) items.push({ t: c, cmd: true });
    return items.map((it, i) => {
      const last = i === items.length - 1;
      const prefix = i === 0 ? 'RUN ' : '    ';
      return prefix + it.t + (last ? '' : it.cmd ? ' && \\' : ' \\');
    });
  }

  /** RUN cài gói hệ thống + lệnh phụ (tạo user...). */
  sysRun(pkgs: string[], extra: string[]): string[] {
    const p = Array.from(new Set(pkgs)).sort();
    if (this.fam === 'apt') {
      const cmds: string[] = [];
      if (p.length) {
        if (this.bk) cmds.push('rm -f /etc/apt/apt.conf.d/docker-clean', `echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache`);
        cmds.push('apt-get update', `apt-get install -y --no-install-recommends ${p.join(' ')}`);
      }
      cmds.push(...extra);
      if (p.length && !this.bk) cmds.push('rm -rf /var/lib/apt/lists/*');
      if (!cmds.length) return [];
      return this.run(cmds, p.length ? [this.mount('/var/cache/apt', 'sharing=locked'), this.mount('/var/lib/apt', 'sharing=locked')] : []);
    }
    if (this.fam === 'apk') {
      const cmds: string[] = [];
      if (p.length) cmds.push(`apk add --no-cache ${p.join(' ')}`);
      cmds.push(...extra);
      return cmds.length ? this.run(cmds) : [];
    }
    return [];
  }

  userCmds(): string[] {
    const { appDir } = this.o;
    const u = this.uid;
    if (this.fam === 'apt') {
      return [
        `groupadd --system --gid ${u} app`,
        `useradd --system --uid ${u} --gid app --no-create-home --home-dir ${appDir} --shell /usr/sbin/nologin app`,
        `mkdir -p ${appDir}`,
        `chown ${u}:${u} ${appDir}`,
      ];
    }
    if (this.fam === 'apk') {
      return [
        `addgroup -S -g ${u} app`,
        `adduser -S -u ${u} -G app -H -h ${appDir} -s /sbin/nologin app`,
        `mkdir -p ${appDir}`,
        `chown ${u}:${u} ${appDir}`,
      ];
    }
    return [];
  }

  /** Cặp [đường dẫn init, gói] theo family. */
  initInfo(): { path: string; pkg: string } | null {
    if (this.o.init === 'none' || this.fam === 'none') return null;
    if (this.o.init === 'tini') return { path: this.fam === 'apk' ? '/sbin/tini' : '/usr/bin/tini', pkg: 'tini' };
    return { path: '/usr/bin/dumb-init', pkg: 'dumb-init' };
  }

  envLines(pairs: [string, string][]): string[] {
    if (!pairs.length) return [];
    return pairs.map(([k, v], i) => (i === 0 ? 'ENV ' : '    ') + `${k}=${/^[A-Za-z0-9_./:@+-]*$/.test(v) && v !== '' ? v : '"' + v.replace(/[\\"]/g, (ch) => '\\' + ch) + '"'}` + (i < pairs.length - 1 ? ' \\' : ''));
  }

  copyFlags(from?: string): string {
    return `COPY ${from ? `--from=${from} ` : ''}--chown=${this.uid}:${this.uid}`;
  }

  buildArgLines(): string[] {
    const args = parseBuildArgs(this.o.buildArgs);
    return args.map((a) => (a.value ? `ARG ${a.name}=${/^[A-Za-z0-9_./:@+-]+$/.test(a.value) ? a.value : DQ(a.value)}` : `ARG ${a.name}`));
  }

  stage(name: string, from: string, note?: string) {
    this.blank();
    this.stages.push(name);
    if (note) this.add(`# ${note}`);
    this.add(`FROM ${from} AS ${name}`);
  }

  tzLines(): { pkgs: string[]; env: [string, string][] } {
    if (!this.o.tz) return { pkgs: [], env: [] };
    return { pkgs: this.fam === 'none' ? [] : ['tzdata'], env: [['TZ', this.o.tz]] };
  }

  healthSpec(): { argv: string[]; pkgs: string[]; startPeriod: string } | null {
    const o = this.o;
    if (!o.healthcheck) return null;
    const path = o.healthPath || this.auto.healthPath;
    const url = `http://127.0.0.1:${this.port}${path}`;
    const sp = o.stack === 'java' || o.stack === 'dotnet' || o.stack === 'ruby' ? '30s' : '10s';
    const run = this.img.run;
    const distro = this.fam === 'none';
    switch (o.stack) {
      case 'node':
      case 'nextjs': {
        const code = `fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(2500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`;
        return { argv: [distro ? '/nodejs/bin/node' : 'node', '-e', code], pkgs: [], startPeriod: sp };
      }
      case 'bun': {
        const code = `fetch(${JSON.stringify(url)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`;
        return { argv: ['bun', '-e', code], pkgs: [], startPeriod: sp };
      }
      case 'deno': {
        const code = `fetch(${JSON.stringify(url)}).then(r=>Deno.exit(r.ok?0:1)).catch(()=>Deno.exit(1))`;
        return { argv: ['deno', 'eval', code], pkgs: [], startPeriod: sp };
      }
      case 'python': {
        const code = `import sys,urllib.request as u; sys.exit(0 if u.urlopen('${url}',timeout=2.5).status<400 else 1)`;
        return { argv: ['python', '-c', code], pkgs: [], startPeriod: sp };
      }
      case 'php': return null;
      case 'vite':
      case 'static': return { argv: ['wget', '-q', '--spider', url], pkgs: [], startPeriod: sp };
      default:
        if (distro || run === 'scratch') return null;
        if (this.fam === 'apk') return { argv: ['wget', '-q', '--spider', url], pkgs: [], startPeriod: sp };
        return { argv: ['curl', '-fsS', '-o', '/dev/null', url], pkgs: ['curl'], startPeriod: sp };
    }
  }

  /** Argv cho CMD từ chuỗi lệnh người dùng. stripBin: bỏ tên binary đầu nếu ENTRYPOINT của image đã là binary đó. */
  execArgv(cmd: string, stripBin?: string): { argv: string[]; usesShell: boolean } {
    const text = cmd || this.auto.entry;
    let argv: string[];
    let usesShell = false;
    if (/[;&|<>`]|\$\(|\$\{?[A-Za-z_]/.test(text)) {
      argv = ['sh', '-c', text];
      usesShell = true;
    } else {
      argv = shellSplit(text);
      if (!argv.length) argv = shellSplit(this.auto.entry);
    }
    if (stripBin && argv[0] === stripBin) argv = argv.slice(1);
    return { argv, usesShell };
  }

  labelLines(): string[] {
    if (!this.o.labels) return [];
    const title = this.o.appName;
    const l = [
      'ARG APP_VERSION=dev',
      'ARG VCS_REF=unknown',
      'ARG BUILD_DATE=unknown',
      `LABEL org.opencontainers.image.title=${DQ(title)} \\`,
      '      org.opencontainers.image.version="${APP_VERSION}" \\',
      '      org.opencontainers.image.revision="${VCS_REF}" \\',
      this.o.repoUrl ? `      org.opencontainers.image.created="\${BUILD_DATE}" \\` : '      org.opencontainers.image.created="${BUILD_DATE}"',
    ];
    if (this.o.repoUrl) l.push(`      org.opencontainers.image.source=${DQ(this.o.repoUrl)}`);
    return l;
  }

  /** Phần cuối stage runtime: labels, USER, EXPOSE, HEALTHCHECK, init, CMD. */
  tail(opts: { cmd: string[]; entrypoint?: string[]; expose?: string; user?: boolean; health?: boolean; comment?: string }) {
    const o = this.o;
    this.add(...this.labelLines());
    if (opts.user !== false) this.add(`USER ${this.uid}:${this.uid}`);
    this.add(`EXPOSE ${opts.expose ?? this.port}`);
    if (opts.health !== false) {
      const hs = this.healthSpec();
      if (hs) {
        this.add(`HEALTHCHECK --interval=30s --timeout=3s --start-period=${hs.startPeriod} --retries=3 \\`, `    CMD ${JARR(hs.argv)}`);
      } else if (o.healthcheck) {
        this.add('# HEALTHCHECK: image này không có shell/curl. Hãy để orchestrator (Kubernetes probe, Compose healthcheck từ service khác)', '# kiểm tra, hoặc thêm lệnh `--healthcheck` vào chính binary của ứng dụng rồi dùng HEALTHCHECK CMD ["/app/app", "--healthcheck"].');
      }
    }
    const init = this.initInfo();
    if (init) this.add(`ENTRYPOINT ${JARR([init.path, '--'])}`);
    else if (o.init !== 'none') this.add('# Init (tini/dumb-init) không có trong image này: chạy với `docker run --init` hoặc `init: true` trong Compose.');
    if (opts.entrypoint) this.add(`ENTRYPOINT ${JARR(opts.entrypoint)}`);
    this.add(`CMD ${JARR(opts.cmd)}`);
  }

  /** Phần đầu của stage runtime: ENV, gói hệ thống, user, WORKDIR. */
  head(env: [string, string][], extraPkgs: string[] = []) {
    const tz = this.tzLines();
    const init = this.initInfo();
    const hs = this.healthSpec();
    const pkgs = [...extraPkgs, ...tz.pkgs, ...(init ? [init.pkg] : []), ...(hs ? hs.pkgs : [])];
    this.add(...this.envLines([...env, ...tz.env]));
    this.add(...this.sysRun(pkgs, this.userCmds()));
    this.add(`WORKDIR ${this.o.appDir}`);
  }
}

function header(b: Builder, title: string) {
  if (b.bk) b.add('# syntax=docker/dockerfile:1');
  b.add(`# ${title}`, '# Sinh bởi getools — Dockerfile Generator. Kiểm tra lại image/tag và đường dẫn cho khớp dự án của bạn.');
}

/* ---- Node / Bun ---- */
function nodeLike(b: Builder, kind: 'node' | 'bun') {
  const o = b.o;
  const pm = kind === 'bun' ? 'bun' : o.pm;
  const cfg: Record<string, { files: string[]; setup: string[]; env: [string, string][]; install: string; prod: string; cache: string; cacheExtra?: string }> = {
    npm: { files: ['package.json', 'package-lock.json'], setup: [], env: [], install: 'npm ci', prod: 'npm ci --omit=dev', cache: '/root/.npm' },
    yarn: { files: ['package.json', 'yarn.lock'], setup: ['corepack enable'], env: [['COREPACK_ENABLE_DOWNLOAD_PROMPT', '0']], install: 'yarn install --frozen-lockfile', prod: 'yarn install --frozen-lockfile --production', cache: '/usr/local/share/.cache/yarn' },
    pnpm: { files: ['package.json', 'pnpm-lock.yaml'], setup: ['corepack enable pnpm'], env: [['COREPACK_ENABLE_DOWNLOAD_PROMPT', '0'], ['PNPM_HOME', '/pnpm'], ['PATH', '/pnpm:$PATH']], install: 'pnpm install --frozen-lockfile', prod: 'pnpm install --frozen-lockfile --prod', cache: '/pnpm/store', cacheExtra: 'id=pnpm' },
    bun: { files: ['package.json', 'bun.lock*'], setup: [], env: [], install: 'bun install --frozen-lockfile', prod: 'bun install --frozen-lockfile --production', cache: '/root/.bun/install/cache' },
  };
  const c = cfg[pm] ?? cfg.npm;
  const build = o.buildCmd || b.auto.buildCmd;
  const outDir = o.outDir || b.auto.outDir;
  const manifests = `COPY ${c.files.join(' ')} ./`;
  const cacheMount = b.mount(c.cache, c.cacheExtra);
  const args = b.buildArgLines();

  header(b, kind === 'bun' ? 'Bun — multi-stage' : 'Node.js — multi-stage');
  b.stage('base', b.img.build, 'Stage nền dùng chung cho deps/build');
  b.add(...b.envLines(c.env));
  b.add('WORKDIR /app');
  if (c.setup.length) b.add(...b.run(c.setup));

  b.stage('deps', 'base', 'Cài toàn bộ dependency (kể cả dev) — chỉ phụ thuộc file khai báo nên cache tốt');
  b.add(manifests, ...b.run([c.install], [cacheMount]));

  b.stage('prod-deps', 'base', 'Chỉ dependency production cho image cuối');
  b.add(manifests, ...b.run([c.prod], [cacheMount]));

  const needBuild = !!build;
  if (needBuild || o.tests) {
    b.stage('build', 'deps', needBuild ? 'Build mã nguồn' : 'Mã nguồn đầy đủ (dùng cho stage test)');
    b.add('COPY . .');
    if (needBuild) {
      b.add(...args);
      b.add(...b.run([build]));
    }
  }
  if (o.tests) {
    b.stage('test', 'build', 'Chạy test: docker build --target test .');
    b.add(...b.run([o.testCmd || b.auto.testCmd]));
  }

  b.stage('runtime', b.img.run, 'Image cuối — nhỏ, không có compiler/dev dependency');
  const env: [string, string][] = [['PORT', b.port]];
  if (kind === 'node') env.unshift(['NODE_ENV', 'production']);
  if (kind === 'bun') env.unshift(['NODE_ENV', 'production']);
  b.head(env);
  b.add(`${b.copyFlags('prod-deps')} /app/node_modules ./node_modules`);
  if (needBuild) {
    b.add(`${b.copyFlags('build')} /app/package.json ./package.json`);
    if (outDir) b.add(`${b.copyFlags('build')} /app/${outDir} ./${outDir}`);
  } else {
    b.add(`${b.copyFlags()} . .`);
  }
  const strip = b.fam === 'none' ? (kind === 'bun' ? 'bun' : 'node') : undefined;
  const ex = b.execArgv(o.entry, strip);
  if (ex.usesShell && b.fam === 'none') b.notes.push('Lệnh khởi chạy có toán tử shell nhưng image distroless không có `sh`: hãy dùng một lệnh đơn giản hoặc đổi sang biến thể có shell.');
  b.tail({ cmd: ex.argv });
  if (kind === 'node') {
    b.notes.push('Nếu dự án TypeScript: đặt "Lệnh build" là `npm run build`, "Thư mục kết quả" là `dist` và lệnh chạy là `node dist/index.js`.');
  }
}

function nextjs(b: Builder) {
  const o = b.o;
  const pm = o.pm;
  const files = pm === 'yarn' ? ['package.json', 'yarn.lock'] : pm === 'pnpm' ? ['package.json', 'pnpm-lock.yaml'] : ['package.json', 'package-lock.json'];
  const install = pm === 'yarn' ? 'yarn install --frozen-lockfile' : pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'npm ci';
  const cache = pm === 'yarn' ? b.mount('/usr/local/share/.cache/yarn') : pm === 'pnpm' ? b.mount('/pnpm/store', 'id=pnpm') : b.mount('/root/.npm');
  header(b, 'Next.js (output: standalone) — multi-stage');
  b.stage('base', b.img.build);
  if (pm !== 'npm') b.add(...b.envLines([['COREPACK_ENABLE_DOWNLOAD_PROMPT', '0'], ...(pm === 'pnpm' ? ([['PNPM_HOME', '/pnpm'], ['PATH', '/pnpm:$PATH']] as [string, string][]) : [])]));
  b.add('WORKDIR /app');
  if (pm !== 'npm') b.add(...b.run([pm === 'pnpm' ? 'corepack enable pnpm' : 'corepack enable']));
  b.stage('deps', 'base', 'Cài dependency');
  b.add(`COPY ${files.join(' ')} ./`, ...b.run([install], [cache]));
  b.stage('build', 'deps', 'Build Next.js');
  b.add('COPY . .', 'ENV NEXT_TELEMETRY_DISABLED=1', ...b.buildArgLines(), ...b.run([o.buildCmd || b.auto.buildCmd]));
  if (o.tests) {
    b.stage('test', 'build', 'Chạy test: docker build --target test .');
    b.add(...b.run([o.testCmd || b.auto.testCmd]));
  }
  b.stage('runtime', b.img.run, 'Image cuối chỉ chứa server standalone');
  b.head([['NODE_ENV', 'production'], ['NEXT_TELEMETRY_DISABLED', '1'], ['PORT', b.port], ['HOSTNAME', '0.0.0.0']]);
  b.add(
    `${b.copyFlags('build')} /app/public ./public`,
    `${b.copyFlags('build')} /app/.next/standalone ./`,
    `${b.copyFlags('build')} /app/.next/static ./.next/static`
  );
  const ex = b.execArgv(o.entry, b.fam === 'none' ? 'node' : undefined);
  b.tail({ cmd: ex.argv });
  b.notes.push('Bật `output: "standalone"` trong next.config.js/ts, nếu không thư mục `.next/standalone` sẽ không tồn tại. Cần có thư mục `public/` (tạo thư mục rỗng nếu chưa có).');
}

function vite(b: Builder) {
  const o = b.o;
  const pm = o.pm;
  const files = pm === 'yarn' ? ['package.json', 'yarn.lock'] : pm === 'pnpm' ? ['package.json', 'pnpm-lock.yaml'] : ['package.json', 'package-lock.json'];
  const install = pm === 'yarn' ? 'yarn install --frozen-lockfile' : pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'npm ci';
  const cache = pm === 'yarn' ? b.mount('/usr/local/share/.cache/yarn') : pm === 'pnpm' ? b.mount('/pnpm/store', 'id=pnpm') : b.mount('/root/.npm');
  const out = o.outDir || b.auto.outDir;
  header(b, 'Vite / SPA → nginx — multi-stage');
  b.stage('build', b.img.build, 'Build bản tĩnh');
  if (pm !== 'npm') b.add(...b.envLines([['COREPACK_ENABLE_DOWNLOAD_PROMPT', '0'], ...(pm === 'pnpm' ? ([['PNPM_HOME', '/pnpm'], ['PATH', '/pnpm:$PATH']] as [string, string][]) : [])]));
  b.add('WORKDIR /app');
  if (pm !== 'npm') b.add(...b.run([pm === 'pnpm' ? 'corepack enable pnpm' : 'corepack enable']));
  b.add(`COPY ${files.join(' ')} ./`, ...b.run([install], [cache]));
  b.add('COPY . .', ...b.buildArgLines(), ...b.run([o.buildCmd || b.auto.buildCmd]));
  if (o.tests) {
    b.stage('test', 'build', 'Chạy test: docker build --target test .');
    b.add(...b.run([o.testCmd || b.auto.testCmd]));
  }
  b.stage('runtime', b.img.run, 'nginx không đặc quyền (UID 101, lắng nghe cổng > 1024)');
  b.add(...b.envLines(b.tzLines().env));
  b.add(`COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf`);
  b.add(`${b.copyFlags('build')} /app/${out} /usr/share/nginx/html`);
  b.tail({ cmd: ['nginx', '-g', 'daemon off;'] });
  b.extras.push({ name: 'nginx.conf', content: nginxConf(b.port, o.spa, true), note: 'Đặt cạnh Dockerfile (được COPY vào /etc/nginx/conf.d/default.conf).' });
  b.notes.push('Biến môi trường kiểu `VITE_*` được nhúng vào bundle lúc build (không đổi được lúc chạy) và ai cũng đọc được: chỉ truyền giá trị công khai qua build ARG.');
}

function nginxConf(port: string, spa: boolean, assets: boolean): string {
  return [
    'server {',
    `    listen ${port};`,
    '    server_name _;',
    '    root /usr/share/nginx/html;',
    '    index index.html;',
    '',
    '    gzip on;',
    '    gzip_types text/plain text/css application/javascript application/json image/svg+xml;',
    '',
    '    add_header X-Content-Type-Options "nosniff" always;',
    '    add_header X-Frame-Options "SAMEORIGIN" always;',
    '    add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    '',
    ...(assets ? [
      '    # File có hash trong tên (Vite/webpack) có thể cache vô thời hạn',
      '    location ~* \\.(?:js|css|woff2?|svg|png|jpe?g|gif|ico|webp)$ {',
      '        expires 1y;',
      '        add_header Cache-Control "public, immutable";',
      '        try_files $uri =404;',
      '    }',
      '',
    ] : []),
    '    location / {',
    spa ? '        try_files $uri $uri/ /index.html;' : '        try_files $uri $uri/ =404;',
    '    }',
    '}',
    '',
  ].join('\n');
}

function python(b: Builder) {
  const o = b.o;
  const pm = o.pm;
  header(b, 'Python — multi-stage (venv được sao chép sang image cuối)');
  const uvVer = '0.9';
  if (pm === 'uv') b.add(`ARG UV_VERSION=${uvVer}`);
  if (pm === 'uv') {
    b.blank();
    b.add('# Binary uv chính thức (ghim phiên bản qua ARG)', 'FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv');
  }
  b.stage('builder', b.img.build, 'Tạo virtualenv /opt/venv chứa dependency');
  b.add(...b.envLines([['PYTHONDONTWRITEBYTECODE', '1'], ['PYTHONUNBUFFERED', '1'], ['PIP_DISABLE_PIP_VERSION_CHECK', '1']]));
  b.add('WORKDIR /app');
  const pipFlags = b.bk ? '' : ' --no-cache-dir';
  const pipCache = b.mount('/root/.cache/pip');
  if (pm === 'pip') {
    b.add(...b.run(['python -m venv /opt/venv']), 'ENV PATH="/opt/venv/bin:$PATH"');
    b.add('COPY requirements.txt ./', ...b.run([`pip install${pipFlags} -r requirements.txt`], [pipCache]));
  } else if (pm === 'poetry') {
    b.add('ARG POETRY_VERSION=2.1.3');
    b.add(...b.run(['python -m venv /opt/poetry', 'python -m venv /opt/venv', `/opt/poetry/bin/pip install${pipFlags} "poetry==\${POETRY_VERSION}"`], [pipCache]));
    b.add('ENV VIRTUAL_ENV=/opt/venv \\', '    PATH="/opt/venv/bin:$PATH"');
    b.add('COPY pyproject.toml poetry.lock ./', ...b.run(['/opt/poetry/bin/poetry install --only main --no-root --no-interaction'], [b.mount('/root/.cache/pypoetry')]));
  } else {
    b.add('COPY --from=uv /uv /uvx /bin/');
    b.add(...b.envLines([['UV_COMPILE_BYTECODE', '1'], ['UV_LINK_MODE', 'copy'], ['UV_PROJECT_ENVIRONMENT', '/opt/venv']]), 'ENV PATH="/opt/venv/bin:$PATH"');
    if (b.bk) {
      b.add(...b.run(['uv sync --locked --no-install-project --no-dev'], [b.mount('/root/.cache/uv'), '--mount=type=bind,source=uv.lock,target=uv.lock', '--mount=type=bind,source=pyproject.toml,target=pyproject.toml']));
    } else {
      b.add('COPY pyproject.toml uv.lock ./', 'ENV UV_NO_CACHE=1', ...b.run(['uv sync --locked --no-install-project --no-dev']));
    }
  }
  if (o.tests) {
    b.stage('test', 'builder', 'Chạy test: docker build --target test .');
    b.add('COPY . .', ...b.run([o.testCmd || b.auto.testCmd]));
    b.notes.push('Stage test cần pytest (hoặc công cụ test của bạn) nằm trong dependency; với Poetry/uv hãy thêm nhóm dev vào lệnh test.');
  }
  b.stage('runtime', b.img.run, 'Image cuối — chỉ copy venv và mã nguồn');
  b.head([['PYTHONDONTWRITEBYTECODE', '1'], ['PYTHONUNBUFFERED', '1'], ['PATH', '/opt/venv/bin:$PATH']]);
  b.add('COPY --from=builder /opt/venv /opt/venv', `${b.copyFlags()} . .`);
  const ex = b.execArgv(o.entry);
  b.tail({ cmd: ex.argv });
  if (o.variant === 'alpine') b.notes.push('Alpine dùng musl libc: nhiều wheel dựng sẵn (numpy, pandas, cryptography...) không có bản musl nên phải biên dịch, build lâu hơn. Nếu gặp khó, chọn Debian slim.');
  if (o.framework === 'django') b.notes.push('Django: nhớ chạy `python manage.py collectstatic --noinput` (trong stage builder hoặc lúc deploy) và đặt `ALLOWED_HOSTS`. Thay `myproject.wsgi` bằng module thật.');
  if (pm !== 'pip') b.notes.push(pm === 'poetry' ? 'Poetry: cần `pyproject.toml` và `poetry.lock`; phiên bản Poetry ghim qua ARG POETRY_VERSION.' : 'uv: cần `pyproject.toml` và `uv.lock`; phiên bản uv ghim qua ARG UV_VERSION (sửa theo bản bạn dùng).');
  b.notes.push('Thư viện cần biên dịch (psycopg2, lxml...) có thể cần `build-essential`/`libpq-dev` ở stage builder và thư viện runtime tương ứng ở stage cuối.');
}

function golang(b: Builder) {
  const o = b.o;
  const name = o.appName;
  const mod = b.mount('/go/pkg/mod');
  const buildCache = b.mount('/root/.cache/go-build');
  const cross = o.multiarch;
  header(b, 'Go — binary tĩnh multi-stage');
  b.stage('build', cross ? `--platform=$BUILDPLATFORM ${b.img.build}` : b.img.build, 'Biên dịch binary tĩnh (CGO tắt)');
  if (cross) b.add('ARG TARGETOS', 'ARG TARGETARCH');
  b.add('ENV CGO_ENABLED=0', 'WORKDIR /src');
  if (o.variant === 'scratch' && o.tz) b.add(...b.run(['apk add --no-cache ca-certificates tzdata']));
  b.add('COPY go.mod go.sum ./', ...b.run(['go mod download'], [mod]));
  const bc = o.buildCmd || b.auto.buildCmd;
  const prefix = cross ? 'GOOS=${TARGETOS} GOARCH=${TARGETARCH} ' : '';
  b.add('COPY . .', ...b.buildArgLines(), ...b.run([prefix + bc], [mod, buildCache]));
  if (o.tests) {
    b.stage('test', 'build', 'Chạy test: docker build --target test .');
    b.add(...b.run([o.testCmd || b.auto.testCmd], [mod, buildCache]));
  }
  b.stage('runtime', b.img.run, o.variant === 'scratch' ? 'Image rỗng — chỉ có binary (+ CA certs)' : 'Image cuối');
  const tz = b.tzLines();
  if (b.fam === 'none') {
    b.add(...b.envLines(tz.env));
    if (b.img.run === 'scratch') {
      b.add('COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt');
      if (o.tz) b.add('COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo');
    }
    b.add(`WORKDIR ${o.appDir}`);
  } else {
    b.head([], b.fam === 'apt' ? ['ca-certificates'] : []);
  }
  const bin = o.entry ? null : `${o.appDir}/${name}`;
  b.add(`${b.copyFlags('build')} /out/${name} ${o.appDir}/${name}`);
  const ex = b.execArgv(o.entry || bin || '');
  b.tail({ cmd: ex.argv });
  if (cross) b.notes.push('Đã bật cross-compile: stage build chạy trên máy build (`$BUILDPLATFORM`) và biên dịch cho `$TARGETARCH`, nhanh hơn nhiều so với giả lập QEMU.');
  b.notes.push(`Lệnh build mặc định ghi binary ra /out/${name}; nếu bạn đổi lệnh build, hãy giữ đường dẫn đầu ra này.`);
  if (o.variant === 'scratch') b.notes.push('scratch không có shell, không có /etc/passwd: USER dùng UID số, CA certs được copy từ stage build. Ứng dụng cần CGO / thư viện động sẽ không chạy được.');
}

function rust(b: Builder) {
  const o = b.o;
  const name = o.appName;
  const reg = [b.mount('/usr/local/cargo/registry'), b.mount('/usr/local/cargo/git')];
  header(b, 'Rust — cache dependency bằng bản dựng giả');
  b.stage('build', b.img.build, 'Build: dependency được cache ở layer riêng');
  b.add('WORKDIR /app');
  if (o.variant === 'alpine' || /alpine/.test(b.img.build)) b.add(...b.run(['apk add --no-cache musl-dev']));
  b.add(
    'COPY Cargo.toml Cargo.lock ./',
    ...b.run(['mkdir src', `echo 'fn main() {}' > src/main.rs`, 'cargo build --release --locked', 'rm -rf src'], reg)
  );
  const bc = o.buildCmd || b.auto.buildCmd;
  b.add('COPY src ./src', ...b.buildArgLines(), ...b.run(['touch src/main.rs', bc, `install -D -m 0755 target/release/${name} /out/${name}`], reg));
  if (o.tests) {
    b.stage('test', 'build', 'Chạy test: docker build --target test .');
    b.add('COPY . .', ...b.run([o.testCmd || b.auto.testCmd], reg));
  }
  b.stage('runtime', b.img.run, 'Image cuối chỉ chứa binary');
  if (b.fam === 'none') {
    b.add(...b.envLines(b.tzLines().env), `WORKDIR ${o.appDir}`);
  } else {
    b.head([], b.fam === 'apt' ? ['ca-certificates'] : []);
  }
  b.add(`${b.copyFlags('build')} /out/${name} ${o.appDir}/${name}`);
  const ex = b.execArgv(o.entry || `${o.appDir}/${name}`);
  b.tail({ cmd: ex.argv });
  b.notes.push(`"Tên ứng dụng" phải trùng tên binary trong Cargo.toml (hiện: ${name}). Workspace nhiều crate cần chỉnh lại bước copy Cargo.toml.`);
  b.notes.push('Crate dùng OpenSSL / thư viện C cần thêm `pkg-config libssl-dev` ở stage build (hoặc chuyển sang rustls) và thư viện runtime tương ứng ở stage cuối.');
  if (o.variant === 'distroless') b.notes.push('distroless/cc cung cấp glibc + libgcc; build trên Debian bookworm để tương thích glibc.');
}

function java(b: Builder) {
  const o = b.o;
  const gradle = o.pm === 'gradle';
  const spring = o.framework === 'spring';
  const build = o.buildCmd || b.auto.buildCmd;
  const m2 = b.mount(gradle ? '/root/.gradle' : '/root/.m2');
  header(b, `Java (${gradle ? 'Gradle' : 'Maven'}) — multi-stage${spring ? ', Spring Boot layered jar' : ''}`);
  b.stage('build', b.img.build, 'Build jar');
  b.add('WORKDIR /build');
  if (gradle) b.add('ENV GRADLE_USER_HOME=/root/.gradle', 'USER root');
  if (gradle) {
    b.add('COPY build.gradle* settings.gradle* gradle.properties* ./', ...b.run(['gradle --no-daemon --quiet dependencies > /dev/null'], [m2]));
    b.add('COPY src ./src');
  } else {
    b.add('COPY pom.xml ./', ...b.run(['mvn -B -ntp dependency:go-offline'], [m2]));
    b.add('COPY src ./src');
  }
  const findJar = gradle
    ? "find build/libs -maxdepth 1 -name '*.jar' ! -name '*-plain.jar' -exec cp {} application.jar \\;"
    : "find target -maxdepth 1 -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar' -exec cp {} application.jar \\;";
  const cmds = [build, findJar];
  if (spring) cmds.push('java -Djarmode=tools -jar application.jar extract --layers --destination extracted');
  b.add(...b.buildArgLines(), ...b.run(cmds, [m2]));
  if (o.tests) {
    b.stage('test', 'build', 'Chạy test: docker build --target test .');
    b.add(...b.run([o.testCmd || b.auto.testCmd], [m2]));
  }
  b.stage('runtime', b.img.run, 'JRE gọn — không có JDK/Maven/Gradle');
  b.head([['JAVA_TOOL_OPTIONS', '-XX:MaxRAMPercentage=75.0']]);
  if (spring) {
    for (const d of ['dependencies', 'spring-boot-loader', 'snapshot-dependencies', 'application']) {
      b.add(`${b.copyFlags('build')} /build/extracted/${d}/ ./`);
    }
  } else {
    b.add(`${b.copyFlags('build')} /build/application.jar ./application.jar`);
  }
  const ex = b.execArgv(o.entry);
  b.tail({ cmd: ex.argv });
  if (spring) b.notes.push('Layered jar cần Spring Boot 3.3+ (dùng `-Djarmode=tools`). Các layer ít đổi (dependencies) được cache riêng nên đẩy/kéo image rất nhanh khi chỉ sửa code.');
  b.notes.push('Đặt `-XX:MaxRAMPercentage` để JVM tôn trọng giới hạn bộ nhớ của container. Dự án multi-module cần chỉnh bước COPY pom/build file cho từng module.');
  if (spring) b.notes.push('HEALTHCHECK mặc định gọi `/actuator/health`: cần thêm spring-boot-starter-actuator (hoặc đổi "Đường dẫn healthcheck").');
}

function dotnet(b: Builder) {
  const o = b.o;
  const nuget = b.mount('/root/.nuget/packages');
  header(b, '.NET — sdk → aspnet');
  b.stage('build', b.img.build, 'Restore và publish');
  b.add('WORKDIR /src', 'COPY *.csproj ./', ...b.run(['dotnet restore'], [nuget]));
  b.add('COPY . .', ...b.buildArgLines(), ...b.run([o.buildCmd || b.auto.buildCmd], [nuget]));
  if (o.tests) {
    b.stage('test', 'build', 'Chạy test: docker build --target test .');
    b.add(...b.run([o.testCmd || b.auto.testCmd]));
  }
  b.stage('runtime', b.img.run, 'ASP.NET runtime — không có SDK');
  const env: [string, string][] = [['ASPNETCORE_URLS', `http://+:${b.port}`], ['DOTNET_EnableDiagnostics', '0']];
  if (o.variant === 'alpine') env.push(['DOTNET_SYSTEM_GLOBALIZATION_INVARIANT', 'true']);
  b.head(env);
  b.add(`${b.copyFlags('build')} /out ./`);
  const ex = b.execArgv(o.entry);
  b.tail({ cmd: ex.argv });
  b.notes.push(`Giả định một project (*.csproj) ở thư mục gốc; "Tên ứng dụng" (hiện: ${o.appName}) phải trùng tên assembly (${o.appName}.dll). Solution nhiều project cần COPY từng .csproj trước khi restore.`);
  if (o.variant === 'alpine') b.notes.push('Alpine: đã bật DOTNET_SYSTEM_GLOBALIZATION_INVARIANT (không cần ICU). Nếu cần định dạng văn hóa đầy đủ, cài `icu-libs` và bỏ biến này.');
  if (o.variant === 'distroless') b.notes.push('Image "chiseled" của Microsoft không có shell/gói quản lý: rất nhỏ và bề mặt tấn công thấp, nhưng khó gỡ lỗi.');
}

function php(b: Builder) {
  const o = b.o;
  const web = 'nginxinc/nginx-unprivileged:1.29-alpine';
  const out = o.outDir || b.auto.outDir;
  header(b, 'PHP-FPM + nginx — hai target (app, web)');
  b.stage('vendor', b.img.build, 'Cài dependency bằng Composer');
  b.add('WORKDIR /app', 'ENV COMPOSER_CACHE_DIR=/tmp/cache');
  b.add('COPY composer.json composer.lock ./', ...b.run(['composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction'], [b.mount('/tmp/cache')]));
  b.add('COPY . .', ...b.run(['composer dump-autoload --optimize --classmap-authoritative --no-dev']));
  if (o.tests) {
    b.stage('test', 'vendor', 'Chạy test: docker build --target test .');
    b.add(...b.run(['composer install --no-interaction', o.testCmd || b.auto.testCmd]));
  }
  b.stage('web', web, 'Target web: nginx không đặc quyền, chuyển PHP sang service app qua FastCGI');
  b.add('COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf', `COPY --from=vendor --chown=101:101 /app/${out} /usr/share/nginx/html`);
  b.add('EXPOSE ' + b.port, 'USER 101:101');
  const hs = o.healthcheck ? ['HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\', `    CMD ${JARR(['wget', '-q', '--spider', `http://127.0.0.1:${b.port}/`])}`] : [];
  b.add(...hs, 'CMD ["nginx", "-g", "daemon off;"]');
  b.stage('app', b.img.run, 'Target app (mặc định): php-fpm lắng nghe cổng 9000');
  const init = b.initInfo();
  const tz = b.tzLines();
  const pkgs = [...tz.pkgs, ...(init ? [init.pkg] : [])];
  b.add(...b.envLines([...tz.env]));
  b.add(...b.sysRun(pkgs, b.userCmds()));
  b.add('# Cài extension PHP cần thiết, ví dụ: RUN docker-php-ext-install pdo_mysql opcache', `WORKDIR ${o.appDir}`);
  b.add(`${b.copyFlags('vendor')} /app ./`);
  b.add(...b.labelLines(), `USER ${b.uid}:${b.uid}`, 'EXPOSE 9000');
  if (init) b.add(`ENTRYPOINT ${JARR([init.path, '--'])}`);
  b.add('CMD ["php-fpm"]');
  b.extras.push({ name: 'nginx.conf', content: phpNginxConf(b.port, o.appDir, out), note: 'Cấu hình nginx cho target web (fastcgi_pass tới service `app`).' });
  b.notes.push('PHP-FPM không nói HTTP, nên cần nginx phía trước: build hai target từ cùng Dockerfile (`--target web` và mặc định `app`), chạy bằng Compose (xem tab Lệnh & Compose).');
  b.notes.push('Healthcheck được đặt ở target web; php-fpm không có lệnh kiểm tra HTTP nội bộ. Laravel: đảm bảo `storage/` và `bootstrap/cache` ghi được cho UID ứng dụng.');
}

function phpNginxConf(port: string, appDir: string, out: string): string {
  return [
    'server {',
    `    listen ${port};`,
    '    server_name _;',
    '    root /usr/share/nginx/html;',
    '    index index.php index.html;',
    '',
    '    location / {',
    '        try_files $uri $uri/ /index.php?$query_string;',
    '    }',
    '',
    '    location ~ \\.php$ {',
    '        fastcgi_pass app:9000;',
    '        include fastcgi_params;',
    `        fastcgi_param SCRIPT_FILENAME ${appDir}/${out}$fastcgi_script_name;`,
    '        fastcgi_param DOCUMENT_ROOT ' + `${appDir}/${out};`,
    '    }',
    '',
    '    location ~ /\\.(?!well-known) {',
    '        deny all;',
    '    }',
    '}',
    '',
  ].join('\n');
}

function ruby(b: Builder) {
  const o = b.o;
  const rails = o.framework !== 'rack';
  const apk = b.fam === 'apk';
  const env: [string, string][] = [['BUNDLE_DEPLOYMENT', '1'], ['BUNDLE_PATH', '/usr/local/bundle'], ['BUNDLE_WITHOUT', 'development:test']];
  if (rails) env.push(['RAILS_ENV', 'production']);
  header(b, rails ? 'Ruby on Rails — multi-stage' : 'Ruby (Rack) — multi-stage');
  b.stage('build', b.img.build, 'Cài gem (cần compiler cho native extension)');
  b.add(...b.envLines(env), 'WORKDIR /app');
  b.add(...b.sysRun(apk ? ['build-base', 'git', 'yaml-dev'] : ['build-essential', 'git', 'libyaml-dev', 'pkg-config'], []));
  b.add('COPY Gemfile Gemfile.lock ./', ...b.run(['bundle install'], [b.mount('/usr/local/bundle/cache')]));
  b.add('COPY . .', ...b.buildArgLines());
  const build = o.buildCmd || b.auto.buildCmd;
  if (build) b.add(...b.run([build]));
  if (o.tests) {
    b.stage('test', 'build', 'Chạy test: docker build --target test .');
    b.add('ENV BUNDLE_WITHOUT=""', ...b.run(['bundle install', o.testCmd || b.auto.testCmd], [b.mount('/usr/local/bundle/cache')]));
  }
  b.stage('runtime', b.img.run, 'Image cuối — không có compiler');
  const renv: [string, string][] = [...env.filter(([k]) => k !== 'RAILS_ENV')];
  if (rails) renv.push(['RAILS_ENV', 'production'], ['RAILS_LOG_TO_STDOUT', '1'], ['RAILS_SERVE_STATIC_FILES', '1']);
  b.head(renv);
  b.add(`${b.copyFlags('build')} /usr/local/bundle /usr/local/bundle`, `${b.copyFlags('build')} /app ./`);
  const ex = b.execArgv(o.entry);
  b.tail({ cmd: ex.argv });
  b.notes.push('Gem có native extension cần thư viện runtime (libpq5, libvips...) ở stage cuối: thêm vào lệnh cài gói hệ thống.');
  if (rails) b.notes.push('Rails: cần `SECRET_KEY_BASE` lúc chạy (truyền bằng secret/biến môi trường, đừng đưa vào image). Precompile dùng `SECRET_KEY_BASE_DUMMY=1` nên không cần khóa thật.');
}

function deno(b: Builder) {
  const o = b.o;
  const ex = b.execArgv(o.entry, b.fam === 'none' ? 'deno' : undefined);
  const file = shellSplit(o.entry || b.auto.entry).find((t) => /\.(ts|tsx|js|jsx|mjs)$/.test(t)) ?? 'main.ts';
  header(b, 'Deno — multi-stage');
  b.stage('build', b.img.build, 'Cache dependency vào DENO_DIR');
  b.add('ENV DENO_DIR=/deno-dir', 'WORKDIR /app', 'COPY . .', ...b.buildArgLines(), ...b.run([`deno cache ${file}`]));
  if (o.tests) {
    b.stage('test', 'build', 'Chạy test: docker build --target test .');
    b.add(...b.run([o.testCmd || b.auto.testCmd]));
  }
  b.stage('runtime', b.img.run, 'Image cuối');
  b.head([['DENO_DIR', '/deno-dir']]);
  b.add(`${b.copyFlags('build')} /deno-dir /deno-dir`, `${b.copyFlags('build')} /app ./`);
  b.tail({ cmd: ex.argv });
  b.notes.push('Giới hạn quyền Deno bằng các cờ `--allow-*` cụ thể thay vì `--allow-all`.');
}

function staticSite(b: Builder) {
  const o = b.o;
  const out = o.outDir || b.auto.outDir;
  header(b, 'Site tĩnh trên nginx không đặc quyền');
  b.stage('runtime', b.img.run);
  b.add(...b.envLines(b.tzLines().env));
  b.add('COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf', `${b.copyFlags()} ${out === '.' ? '.' : out + '/'} /usr/share/nginx/html/`);
  b.tail({ cmd: ['nginx', '-g', 'daemon off;'] });
  b.extras.push({ name: 'nginx.conf', content: nginxConf(b.port, o.spa, false), note: 'Đặt cạnh Dockerfile (được COPY vào /etc/nginx/conf.d/default.conf).' });
}

function variantNote(o: GenOptions, b: Builder): string {
  switch (o.variant) {
    case 'alpine': return 'Alpine: image gốc rất nhỏ nhưng dùng musl libc — một số binary/wheel dựng sẵn cho glibc không chạy, DNS và hiệu năng có thể khác biệt. Có shell + apk nên vẫn dễ gỡ lỗi.';
    case 'distroless': return 'Distroless: không shell, không package manager → bề mặt tấn công thấp và image nhỏ, nhưng không `docker exec sh` được (dùng tag `:debug` khi cần gỡ lỗi) và HEALTHCHECK dạng lệnh shell không dùng được.';
    case 'scratch': return 'scratch: image rỗng hoàn toàn — nhỏ nhất có thể, chỉ chạy được binary tĩnh.';
    case 'debian': return 'Debian đầy đủ: nhiều công cụ sẵn có (dễ build/gỡ lỗi) nhưng image lớn nhất trong các lựa chọn; chỉ chọn khi thật sự cần các công cụ đó.';
    default: return b.fam === 'apt' ? 'Debian slim: cân bằng tốt giữa kích thước và tương thích glibc; ít công cụ hơn bản đầy đủ nên cần tự cài khi cần.' : '';
  }
}

const COMMON_IGNORE = [
  '# Kiểm soát phiên bản & IDE', '.git', '.gitignore', '.gitattributes', '.github', '.vscode', '.idea', '*.swp', '.DS_Store', '',
  '# Docker', 'Dockerfile*', '!Dockerfile', 'docker-compose*.yml', 'docker-compose*.yaml', '.dockerignore', '',
  '# Bí mật & cấu hình cục bộ (đừng đưa vào image)', '.env', '.env.*', '!.env.example', '*.pem', '*.key', '',
  '# Tài liệu & log', '*.md', '!README.md', 'LICENSE', '*.log', 'logs', 'coverage', '',
];

const STACK_IGNORE: Record<StackId, string[]> = {
  node: ['# Node', 'node_modules', 'npm-debug.log*', 'yarn-error.log', '.npm', '.next', 'dist', 'build'],
  nextjs: ['# Next.js', 'node_modules', '.next', 'out', 'npm-debug.log*', 'yarn-error.log', '.vercel'],
  vite: ['# Vite', 'node_modules', 'dist', '.vite', 'npm-debug.log*', 'yarn-error.log'],
  python: ['# Python', '__pycache__', '*.py[cod]', '.venv', 'venv', '.pytest_cache', '.mypy_cache', '.ruff_cache', '*.egg-info', 'dist', 'build', '.tox'],
  go: ['# Go', 'bin', 'vendor', '*.test', '*.out', 'tmp'],
  rust: ['# Rust', 'target', '**/*.rs.bk'],
  java: ['# Java', 'target', 'build', '.gradle', '.mvn/wrapper/maven-wrapper.jar', '*.class', '*.iml', 'out'],
  dotnet: ['# .NET', '**/bin', '**/obj', '*.user', '.vs', 'TestResults'],
  php: ['# PHP', 'vendor', 'node_modules', 'storage/logs/*', 'storage/framework/cache/*', 'storage/framework/sessions/*', '.phpunit.result.cache'],
  ruby: ['# Ruby', 'vendor/bundle', '.bundle', 'log/*', 'tmp/*', 'node_modules', 'public/assets', 'public/packs'],
  bun: ['# Bun', 'node_modules', 'dist', 'bun-debug.log*'],
  deno: ['# Deno', 'node_modules', '.deno', 'vendor'],
  static: ['# Site tĩnh', 'node_modules', 'src', '*.psd', '*.sketch'],
};

export function generateDockerignore(stack: StackId): string {
  return [...COMMON_IGNORE, ...STACK_IGNORE[stack]].join('\n') + '\n';
}

const imageSlug = (n: string) => n.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '') || 'app';

function buildCommands(b: Builder): string {
  const o = b.o;
  const name = imageSlug(o.appName);
  const tag = `${name}:1.0.0`;
  const args = parseBuildArgs(o.buildArgs);
  const lines: string[] = [];
  const buildArgs: string[] = [];
  if (o.labels) buildArgs.push('--build-arg APP_VERSION=1.0.0', '--build-arg VCS_REF=$(git rev-parse --short HEAD)', '--build-arg BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)');
  for (const a of args) buildArgs.push(`--build-arg ${a.name}=${a.value ? shQuoteLite(a.value) : '"$' + a.name + '"'}`);
  const join = (head: string, rest: string[]) => [head + (rest.length ? ' \\' : ''), ...rest.map((r, i) => `  ${r}${i < rest.length - 1 ? ' \\' : ''}`)].join('\n');
  lines.push('# 1) Build image');
  lines.push(join(`docker build -t ${tag}`, [...buildArgs, '.']));
  if (o.tests) lines.push('', '# Chạy stage test (không tạo image runtime)', 'docker build --target test .');
  if (o.stack === 'php') lines.push('', '# PHP: build riêng target web', join(`docker build --target web -t ${name}-web:1.0.0`, ['.']));
  if (o.multiarch) {
    lines.push('', '# 2) Build đa kiến trúc (cần buildx + builder docker-container)', 'docker buildx create --use --name multiarch 2>/dev/null || docker buildx use multiarch', join(`docker buildx build --platform linux/amd64,linux/arm64 -t REGISTRY/${tag}`, [...buildArgs, '--push', '.']));
  }
  lines.push('', `# ${o.multiarch ? '3' : '2'}) Chạy container (cấu hình cứng: chỉ đọc, bỏ capability, không leo thang đặc quyền)`);
  const runFlags = [`-p ${b.port}:${b.port}`, '--restart unless-stopped', '--read-only', '--tmpfs /tmp', '--cap-drop ALL', '--security-opt no-new-privileges:true'];
  if (o.init !== 'none' && b.fam === 'none') runFlags.push('--init');
  if (o.stack === 'php') {
    lines.push('# PHP cần hai container trong cùng mạng — dùng Compose bên dưới.');
  } else {
    lines.push(join(`docker run -d --name ${name}`, [...runFlags, tag]));
  }
  lines.push('', '# Xem log / kiểm tra sức khỏe', `docker logs -f ${name}`, `docker inspect --format '{{.State.Health.Status}}' ${name}`);
  return lines.join('\n') + '\n';
}

function shQuoteLite(v: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/.test(v) ? v : "'" + v.replace(/'/g, "'\\''") + "'";
}

function yamlStr(v: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/.test(v) && !/^(true|false|null|yes|no|on|off|\d+(\.\d+)?)$/i.test(v) ? v : JSON.stringify(v);
}

function buildCompose(b: Builder): string {
  const o = b.o;
  const name = imageSlug(o.appName);
  const args = parseBuildArgs(o.buildArgs);
  const L: string[] = ['services:'];
  const buildBlock = (indent: string, target?: string) => {
    const out = [`${indent}build:`, `${indent}  context: .`];
    if (target) out.push(`${indent}  target: ${target}`);
    if (args.length) {
      out.push(`${indent}  args:`);
      for (const a of args) out.push(`${indent}    ${a.name}: ${a.value ? yamlStr(a.value) : '${' + a.name + '}'}`);
    }
    return out;
  };
  const hardening = (indent: string) => [
    `${indent}restart: unless-stopped`,
    ...(o.init !== 'none' && b.fam === 'none' ? [`${indent}init: true`] : []),
    `${indent}read_only: true`,
    `${indent}tmpfs:`,
    `${indent}  - /tmp`,
    `${indent}cap_drop:`,
    `${indent}  - ALL`,
    `${indent}security_opt:`,
    `${indent}  - no-new-privileges:true`,
  ];
  if (o.stack === 'php') {
    L.push('  app:', ...buildBlock('    ', 'app'), `    image: ${name}-app:1.0.0`, ...hardening('    '));
    L.push('  web:', ...buildBlock('    ', 'web'), `    image: ${name}-web:1.0.0`, '    ports:', `      - "${b.port}:${b.port}"`, '    depends_on:', '      - app', ...hardening('    '));
  } else {
    L.push(`  ${name}:`, ...buildBlock('    '), `    image: ${name}:1.0.0`, '    ports:', `      - "${b.port}:${b.port}"`, ...hardening('    '));
    if (o.healthcheck && !b.healthSpec()) {
      L.push('    # Image không có shell: healthcheck cần binary riêng của ứng dụng, ví dụ:', '    # healthcheck:', `    #   test: ["CMD", "${o.appDir}/${o.appName}", "--healthcheck"]`, '    #   interval: 30s');
    }
  }
  return L.join('\n') + '\n';
}

/** Sinh Dockerfile + .dockerignore + lệnh + compose + ghi chú. Không ném lỗi. */
export function generateDockerfile(input: Partial<GenOptions>): GenResult {
  const o = sanitizeOptions(input);
  const b = new Builder(o);
  switch (o.stack) {
    case 'node': nodeLike(b, 'node'); break;
    case 'bun': nodeLike(b, 'bun'); break;
    case 'nextjs': nextjs(b); break;
    case 'vite': vite(b); break;
    case 'python': python(b); break;
    case 'go': golang(b); break;
    case 'rust': rust(b); break;
    case 'java': java(b); break;
    case 'dotnet': dotnet(b); break;
    case 'php': php(b); break;
    case 'ruby': ruby(b); break;
    case 'deno': deno(b); break;
    case 'static': staticSite(b); break;
  }
  const dockerfile = b.L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';

  const notes: string[] = [];
  const stageList = b.stages.join(' → ');
  notes.push(`Cấu trúc ${b.stages.length} stage: ${stageList}. Mỗi chỉ thị RUN/COPY/ADD tạo một layer; chỉ các layer của stage cuối (runtime) nằm trong image bạn đẩy lên registry — compiler, dev dependency và cache của các stage trước bị loại bỏ.`);
  notes.push('Thứ tự lớp tối ưu cache: file khai báo dependency được COPY và cài trước, mã nguồn COPY sau cùng — sửa code chỉ build lại các layer cuối, layer dependency được tái sử dụng.');
  const vn = variantNote(o, b);
  if (vn) notes.push(vn);
  if (o.stack === 'vite' || o.stack === 'static') notes.push('nginx không đặc quyền (UID 101) lắng nghe cổng cao (mặc định 8080) nên không cần quyền root hay capability NET_BIND_SERVICE.');
  if (b.bk) notes.push('BuildKit: `# syntax=docker/dockerfile:1` + `RUN --mount=type=cache` giữ cache gói (npm/pip/cargo/apt...) giữa các lần build mà không làm phình image. Cache mount nằm ngoài layer nên không có trong image cuối. Cần Docker 18.09+ (BuildKit mặc định từ Docker 23).');
  else notes.push('Đã tắt BuildKit: Dockerfile dùng cờ làm sạch cache trong cùng lệnh RUN (không dùng cache mount) — tương thích builder cũ nhưng build lại chậm hơn khi dependency đổi.');
  if (o.tests) notes.push('Stage `test` không nằm trên đường phụ thuộc của stage cuối nên BuildKit bỏ qua nó khi build thường; chạy `docker build --target test .` (ví dụ trong CI) để thực thi test.');
  const init = b.initInfo();
  if (init) notes.push(`Đã cài ${init.pkg} làm PID 1 (ENTRYPOINT): chuyển tiếp tín hiệu SIGTERM và thu dọn tiến trình zombie.`);
  else if (o.init !== 'none') notes.push('Image này không có package manager nên không cài được tini/dumb-init: dùng `docker run --init` hoặc `init: true` trong Compose.');
  else notes.push('Không dùng init: ứng dụng là PID 1. Nếu nó sinh tiến trình con hoặc không xử lý SIGTERM, bật tuỳ chọn tini/dumb-init hoặc chạy với `--init`.');
  if (o.tz) notes.push(`Múi giờ: ENV TZ=${o.tz}${b.fam === 'none' ? ' (image này tự có tzdata hoặc đã copy zoneinfo)' : ' và cài gói tzdata'}. Locale: các image chính thức đã đặt LANG=C.UTF-8; muốn locale khác (vi_VN.UTF-8) phải cài gói locales và chạy locale-gen.`);
  else notes.push('Múi giờ & locale: container mặc định chạy UTC; hãy lưu thời gian UTC trong dữ liệu. Muốn đổi, nhập múi giờ (ví dụ Asia/Ho_Chi_Minh) để thêm ENV TZ + tzdata.');
  if (o.multiarch) notes.push('Đa kiến trúc: dùng `docker buildx build --platform linux/amd64,linux/arm64`. Image gốc phải có manifest cho cả hai kiến trúc; tránh tải binary gắn cứng amd64 trong Dockerfile. Build giả lập (QEMU) chậm hơn cross-compile.');
  notes.push('Ghim tag image gốc tới phiên bản cụ thể (đã làm sẵn, có thể sửa). Với production nên ghim thêm digest `@sha256:…` (xem `docker buildx imagetools inspect <image>`) và để Renovate/Dependabot cập nhật.');
  notes.push(...b.notes);
  notes.push('Kích thước image: chỉ có thể so sánh định tính — distroless/scratch/alpine thường nhỏ hơn slim, slim nhỏ hơn bản đầy đủ. Hãy đo thực tế bằng `docker image ls` và phân tích từng layer bằng `docker history` hoặc công cụ dive.');

  return {
    options: o,
    auto: b.auto,
    dockerfile,
    dockerignore: generateDockerignore(o.stack),
    commands: buildCommands(b),
    compose: buildCompose(b),
    extras: b.extras,
    notes,
    stages: b.stages,
    images: b.img,
    port: b.port,
  };
}

/** Danh sách tổ hợp (stack × variant × pm × framework) hợp lệ — dùng cho test và preset. */
export function allStackCombos(): Partial<GenOptions>[] {
  const out: Partial<GenOptions>[] = [];
  for (const s of STACKS) {
    const pms = s.pms.length ? s.pms.map((p) => p.id) : [''];
    const fws = s.frameworks.length ? s.frameworks.map((f) => f.id) : [''];
    for (const variant of s.variants) for (const pm of pms) for (const framework of fws) out.push({ stack: s.id, variant, pm, framework });
  }
  return out;
}
