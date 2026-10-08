/**
 * Sơ đồ cây thư mục: phân tích nhiều định dạng đầu vào thành cây, lọc/sắp xếp, và xuất ra nhiều kiểu.
 * Logic thuần (không React). Không ném lỗi với đầu vào xấu.
 */

export interface TreeNode {
  id: string;
  name: string;
  isDir: boolean;
  children: TreeNode[];
  comment?: string;
}

export type InputFormat = 'paths' | 'indent' | 'tree' | 'json' | 'empty';
export type OutputStyle = 'unicode' | 'ascii' | 'mdlist' | 'indent' | 'plain' | 'json' | 'dirs';
export type SortMode = 'folders' | 'alpha' | 'natural' | 'keep';

export interface ParseResult {
  root: TreeNode;
  format: InputFormat;
  /** Tên thư mục gốc phát hiện được (định dạng `tree`). */
  detectedRoot?: string;
  warnings: string[];
}

export const MAX_ENTRIES = 20000;
const MAX_LINES = 60000;
const MAX_LEVEL = 200;
const MAX_NAME = 500;

let seq = 0;
export function newId(): string {
  seq += 1;
  return 'n' + seq;
}

export function makeNode(name: string, isDir: boolean, comment?: string): TreeNode {
  const n: TreeNode = { id: newId(), name, isDir, children: [] };
  if (comment) n.comment = comment;
  return n;
}

/* ------------------------------------------------------------------ */
/* Phân tích                                                            */
/* ------------------------------------------------------------------ */

const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function cleanText(text: string): string {
  return stripAnsi(text).replace(/ /g, ' ').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

interface Ctx {
  count: number;
  truncated: boolean;
  maps: Map<TreeNode, Map<string, TreeNode>>;
}

function newCtx(): Ctx {
  return { count: 0, truncated: false, maps: new Map() };
}

function childOf(ctx: Ctx, parent: TreeNode, name: string): TreeNode | null {
  let m = ctx.maps.get(parent);
  if (!m) {
    m = new Map();
    for (const c of parent.children) m.set(c.name, c);
    ctx.maps.set(parent, m);
  }
  let c = m.get(name);
  if (c) return c;
  if (ctx.count >= MAX_ENTRIES) {
    ctx.truncated = true;
    return null;
  }
  c = makeNode(name, false);
  ctx.count += 1;
  parent.children.push(c);
  m.set(name, c);
  return c;
}

/** Gắn một chuỗi `a/b/c` dưới parent; trả về nút cuối. */
function attachChain(
  ctx: Ctx,
  parent: TreeNode,
  rawName: string,
  dirFlag: boolean,
  comment?: string
): TreeNode | null {
  const segs = rawName
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.' && s !== '..');
  if (segs.length === 0) return null;
  let cur = parent;
  for (let i = 0; i < segs.length; i++) {
    const n = childOf(ctx, cur, segs[i].slice(0, MAX_NAME));
    if (!n) return null;
    if (i < segs.length - 1) n.isDir = true;
    cur = n;
  }
  if (dirFlag) cur.isDir = true;
  if (comment) cur.comment = comment;
  return cur;
}

/** Tách chú thích `# ...`, hậu tố `/`, bọc markdown. */
function splitName(raw: string): { name: string; isDir: boolean; comment?: string } {
  let s = raw.trim();
  let comment: string | undefined;
  const m = /(^|\s)#\s?(.*)$/.exec(s);
  if (m && m.index !== undefined) {
    const c = m[2].trim();
    s = s.slice(0, m.index).trim();
    if (c) comment = c;
  }
  s = s.replace(/\s+->\s+.*$/, '');
  const bold = /^\*\*(.+)\*\*$/.exec(s);
  if (bold) s = bold[1];
  const code = /^`(.+)`$/.exec(s);
  if (code) s = code[1];
  let isDir = false;
  if (s.endsWith('/')) {
    isDir = true;
    s = s.replace(/\/+$/, '');
  }
  return { name: s, isDir, comment };
}

const UNZIP_RE = /^\s*\d+\s+(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\s+\d{2}:\d{2}\s+(.+)$/;
const TAR_RE = /^[-dlrwxsStTbcp?]{10}[.+@]?\s+\S+\s+\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(.+)$/;
const SUMMARY_RE = /^\s*\d+\s+(?:directories|directory|files?)(?:,\s*\d+\s+(?:files?|directories|directory))?\s*$/;
const SKIP_RE = /^\s*(?:Archive:|Length\s|-{3,}|\d+(?:\s+\d+)?\s+files?\s*$)/;

export function detectFormat(text: string): InputFormat {
  const t = cleanText(text);
  if (!t.trim()) return 'empty';
  const trimmed = t.trim();
  if (trimmed.startsWith('{')) {
    try {
      const v = JSON.parse(trimmed);
      if (v && typeof v === 'object' && !Array.isArray(v)) return 'json';
    } catch {
      /* không phải JSON */
    }
  }
  const lines = t.split('\n', MAX_LINES);
  if (lines.some((l) => UNZIP_RE.test(l) || TAR_RE.test(l))) return 'paths';
  if (/^[\s│|]*(?:[├└]─{1,2}|[|`+\\]-{2})/m.test(t)) return 'tree';
  const nonBlank = lines.filter((l) => l.trim() !== '');
  if (nonBlank.some((l) => /^\s/.test(l))) return 'indent';
  if (nonBlank.length > 0 && nonBlank.every((l) => /^[-*+]\s+\S/.test(l))) return 'indent';
  return 'paths';
}

function parsePaths(text: string, ctx: Ctx, root: TreeNode): void {
  const lines = text.split('\n', MAX_LINES);
  for (let line of lines) {
    if (!line.trim()) continue;
    if (SKIP_RE.test(line) || SUMMARY_RE.test(line)) continue;
    const u = UNZIP_RE.exec(line) ?? TAR_RE.exec(line);
    if (u) line = u[1];
    line = line.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '');
    const { name, isDir, comment } = splitName(line);
    if (!name || name === '.' || name === './') continue;
    attachChain(ctx, root, name.replace(/^\/+/, ''), isDir, comment);
    if (ctx.truncated) break;
  }
}

function parseIndent(text: string, ctx: Ctx, root: TreeNode): void {
  const lines = text.split('\n', MAX_LINES);
  const stack: { indent: number; node: TreeNode }[] = [];
  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const line = rawLine.replace(/\t/g, '    ');
    const m = /^(\s*)(?:[-*+]\s+)?(.*)$/.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    const { name, isDir, comment } = splitName(m[2].replace(/\\/g, '/'));
    if (!name) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[Math.min(stack.length, MAX_LEVEL) - 1].node : root;
    if (parent !== root) parent.isDir = true;
    const node = attachChain(ctx, parent, name, isDir, comment);
    if (ctx.truncated) break;
    if (node) stack.push({ indent, node });
  }
}

function parseTreeOutput(text: string, ctx: Ctx, root: TreeNode): string | undefined {
  const lines = text.split('\n', MAX_LINES);
  const stack: TreeNode[] = [];
  let detectedRoot: string | undefined;
  let started = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (SUMMARY_RE.test(line)) continue;
    const m = /^([\s│|]*)(?:[├└]─{1,2}|[|`+\\]-{2,})\s?(.*)$/.exec(line);
    if (!m) {
      if (!started && detectedRoot === undefined) {
        const { name } = splitName(line.replace(/\\/g, '/'));
        if (name) detectedRoot = name;
        started = true;
      }
      continue;
    }
    started = true;
    const level = Math.min(MAX_LEVEL, Math.round(m[1].length / 4));
    const { name, isDir, comment } = splitName(m[2].replace(/\\/g, '/'));
    if (!name) continue;
    stack.length = Math.min(stack.length, level);
    const parent = level === 0 || stack.length === 0 ? root : stack[stack.length - 1];
    if (parent !== root) parent.isDir = true;
    const node = attachChain(ctx, parent, name, isDir, comment);
    if (ctx.truncated) break;
    if (node) {
      while (stack.length < level) stack.push(stack[stack.length - 1] ?? root);
      stack[level] = node;
      stack.length = level + 1;
    }
  }
  return detectedRoot;
}

function parseJsonInto(ctx: Ctx, parent: TreeNode, value: unknown, depth: number): void {
  if (depth > MAX_LEVEL || ctx.truncated) return;
  if (Array.isArray(value)) {
    for (const el of value) {
      if (typeof el === 'string') attachChain(ctx, parent, el, el.endsWith('/'));
      else if (el && typeof el === 'object') parseJsonInto(ctx, parent, el, depth + 1);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const dirFlag = key.endsWith('/') || (val !== null && typeof val === 'object');
    const comment = typeof val === 'string' && val.trim() ? val.trim() : undefined;
    const node = attachChain(ctx, parent, key, dirFlag, comment);
    if (ctx.truncated) return;
    if (node && val !== null && typeof val === 'object') parseJsonInto(ctx, node, val, depth + 1);
  }
}

export function parseTree(input: string): ParseResult {
  const root = makeNode('', true);
  const warnings: string[] = [];
  const text = cleanText(input);
  const format = detectFormat(text);
  const ctx = newCtx();
  let detectedRoot: string | undefined;
  try {
    if (format === 'json') parseJsonInto(ctx, root, JSON.parse(text.trim()), 0);
    else if (format === 'tree') detectedRoot = parseTreeOutput(text, ctx, root);
    else if (format === 'indent') parseIndent(text, ctx, root);
    else if (format === 'paths') parsePaths(text, ctx, root);
  } catch {
    warnings.push('Không phân tích được toàn bộ dữ liệu đầu vào.');
  }
  if (ctx.truncated) warnings.push(`Quá nhiều mục: chỉ lấy ${MAX_ENTRIES.toLocaleString('vi-VN')} mục đầu tiên.`);
  if (text.split('\n').length > MAX_LINES) warnings.push('Đầu vào quá dài, các dòng cuối đã bị bỏ qua.');
  return { root, format, detectedRoot, warnings };
}

export function parsePathList(paths: string[]): ParseResult {
  return parseTree(paths.join('\n'));
}

/* ------------------------------------------------------------------ */
/* Bỏ qua (gitignore-like)                                              */
/* ------------------------------------------------------------------ */

export const IGNORE_PRESET = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '*.pyc',
  '.DS_Store',
  'coverage',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  'target',
].join('\n');

export function globToRegexSource(glob: string): string {
  let out = '';
  const g = glob.slice(0, 300);
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else if (ch === '[') {
      const end = g.indexOf(']', i + 2);
      if (end === -1) out += '\\[';
      else {
        let cls = g.slice(i + 1, end);
        if (cls.startsWith('!')) cls = '^' + cls.slice(1);
        out += '[' + cls.replace(/\\/g, '\\\\') + ']';
        i = end;
      }
    } else if (ch === '\\' && i + 1 < g.length) {
      i += 1;
      out += g[i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else out += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return out;
}

interface IgnoreRule {
  re: RegExp;
  dirOnly: boolean;
  anchored: boolean;
  negate: boolean;
}

export type IgnoreMatcher = (path: string, isDir: boolean) => boolean;

export function compileIgnore(text: string): IgnoreMatcher {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split('\n').slice(0, 500)) {
    let p = raw.trim();
    if (!p || p.startsWith('#')) continue;
    let negate = false;
    if (p.startsWith('!')) {
      negate = true;
      p = p.slice(1);
    }
    let dirOnly = false;
    if (p.endsWith('/')) {
      dirOnly = true;
      p = p.replace(/\/+$/, '');
    }
    let anchored = false;
    if (p.startsWith('/')) {
      anchored = true;
      p = p.replace(/^\/+/, '');
    } else if (p.includes('/')) anchored = true;
    if (!p) continue;
    try {
      rules.push({ re: new RegExp('^' + globToRegexSource(p) + '$'), dirOnly, anchored, negate });
    } catch {
      /* mẫu lỗi: bỏ qua */
    }
  }
  if (rules.length === 0) return () => false;
  return (path, isDir) => {
    const base = path.slice(path.lastIndexOf('/') + 1);
    let ignored = false;
    for (const r of rules) {
      if (r.dirOnly && !isDir) continue;
      if (r.re.test(r.anchored ? path : base)) ignored = !r.negate;
    }
    return ignored;
  };
}

/** Kiểm tra đường dẫn (từ danh sách file) có nằm trong thư mục bị bỏ qua không. */
export function isPathIgnored(m: IgnoreMatcher, path: string, isDir = false): boolean {
  const segs = path.split('/').filter(Boolean);
  let cur = '';
  for (let i = 0; i < segs.length; i++) {
    cur = cur ? cur + '/' + segs[i] : segs[i];
    const last = i === segs.length - 1;
    if (m(cur, last ? isDir : true)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Biến đổi                                                             */
/* ------------------------------------------------------------------ */

export interface TreeOptions {
  sort: SortMode;
  /** 0 = không giới hạn */
  maxDepth: number;
  collapse: boolean;
  showDotfiles: boolean;
  ignore: string;
  slash: boolean;
  rootName: string;
  showRoot: boolean;
  showComments: boolean;
  align: boolean;
}

export const DEFAULT_TREE_OPTIONS: TreeOptions = {
  sort: 'folders',
  maxDepth: 0,
  collapse: false,
  showDotfiles: true,
  ignore: '',
  slash: true,
  rootName: '',
  showRoot: true,
  showComments: true,
  align: true,
};

let collator: Intl.Collator | null = null;
function natural(a: string, b: string): number {
  if (!collator) {
    try {
      collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
    } catch {
      collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    }
  }
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function comparator(mode: SortMode): ((a: TreeNode, b: TreeNode) => number) | null {
  switch (mode) {
    case 'folders':
      return (a, b) => (a.isDir === b.isDir ? natural(a.name, b.name) : a.isDir ? -1 : 1);
    case 'alpha':
      return (a, b) => {
        const x = a.name.toLowerCase();
        const y = b.name.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      };
    case 'natural':
      return (a, b) => natural(a.name, b.name);
    default:
      return null;
  }
}

export interface Transformed {
  root: TreeNode;
  hidden: number;
}

/** Áp dụng lọc / sắp xếp / giới hạn độ sâu / gộp chuỗi thư mục. Không sửa cây gốc. */
export function transformTree(src: TreeNode, opts: TreeOptions): Transformed {
  const ignore = compileIgnore(opts.ignore);
  const cmp = comparator(opts.sort);
  let hidden = 0;

  const walk = (node: TreeNode, path: string, depth: number): TreeNode => {
    const out: TreeNode = { id: node.id, name: node.name, isDir: node.isDir, children: [] };
    if (node.comment) out.comment = node.comment;
    if (opts.maxDepth > 0 && depth >= opts.maxDepth) {
      hidden += node.children.length;
      return out;
    }
    for (const c of node.children) {
      if (!opts.showDotfiles && c.name.startsWith('.')) {
        hidden += 1;
        continue;
      }
      const p = path ? path + '/' + c.name : c.name;
      if (ignore(p, c.isDir)) {
        hidden += 1;
        continue;
      }
      out.children.push(walk(c, p, depth + 1));
    }
    if (cmp) out.children.sort(cmp);
    return out;
  };
  const root = walk(src, '', 0);

  if (opts.collapse) {
    const run = (n: TreeNode): void => {
      for (const c of n.children) {
        while (c.isDir && c.children.length === 1 && c.children[0].isDir && !c.comment) {
          const only = c.children[0];
          c.name = c.name + '/' + only.name;
          c.id = only.id;
          c.children = only.children;
          if (only.comment) c.comment = only.comment;
        }
        run(c);
      }
    };
    run(root);
  }
  return { root, hidden };
}

export interface TreeCounts {
  files: number;
  folders: number;
  depth: number;
}

export function countTree(root: TreeNode): TreeCounts {
  let files = 0;
  let folders = 0;
  let depth = 0;
  const walk = (n: TreeNode, d: number): void => {
    for (const c of n.children) {
      if (c.isDir || c.children.length) folders += 1;
      else files += 1;
      const segs = c.name.split('/').length;
      depth = Math.max(depth, d + segs);
      walk(c, d + segs);
    }
  };
  walk(root, 0);
  return { files, folders, depth };
}

/* ------------------------------------------------------------------ */
/* Xuất                                                                 */
/* ------------------------------------------------------------------ */

export const STYLE_LABELS: Record<OutputStyle, string> = {
  unicode: 'Unicode (├── └──)',
  ascii: 'ASCII (|-- `--)',
  mdlist: 'Danh sách Markdown',
  indent: 'Thụt lề + dấu / cho thư mục',
  plain: 'Văn bản thuần (thụt lề)',
  json: 'JSON lồng nhau',
  dirs: 'Mỗi thư mục một dòng',
};

interface Line {
  text: string;
  comment?: string;
}

function strLen(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x1f300) ? 2 : 1;
  }
  return n;
}

function joinLines(lines: Line[], opts: TreeOptions): string {
  let width = 0;
  if (opts.showComments && opts.align) {
    for (const l of lines) if (l.comment) width = Math.max(width, Math.min(strLen(l.text), 72));
  }
  return lines
    .map((l) => {
      if (!opts.showComments || !l.comment) return l.text;
      const c = l.comment.replace(/\s*\n\s*/g, ' ');
      if (!opts.align) return `${l.text}  # ${c}`;
      const pad = Math.max(2, width - strLen(l.text) + 2);
      return `${l.text}${' '.repeat(pad)}# ${c}`;
    })
    .join('\n');
}

function effectiveRootName(opts: TreeOptions, fallback?: string): string {
  return opts.rootName.trim() || fallback || 'project';
}

function toJsonValue(n: TreeNode, withComments: boolean): unknown {
  if (!n.isDir && n.children.length === 0) return withComments && n.comment ? n.comment : null;
  const obj: Record<string, unknown> = {};
  for (const c of n.children) obj[c.name] = toJsonValue(c, withComments);
  return obj;
}

/** Xuất cây đã biến đổi (`transformTree`) theo kiểu đã chọn. */
export function renderTree(root: TreeNode, style: OutputStyle, opts: TreeOptions, detectedRoot?: string): string {
  const rootName = effectiveRootName(opts, detectedRoot);
  const label = (n: TreeNode, forceSlash = false): string =>
    n.isDir || n.children.length ? n.name + (opts.slash || forceSlash ? '/' : '') : n.name;
  const rootLabel = rootName + ((opts.slash || style === 'indent') && rootName !== '.' ? '/' : '');
  const lines: Line[] = [];

  if (style === 'json') {
    const body = root.children.length === 0 && opts.showRoot ? {} : toJsonValue(root, opts.showComments);
    const val = opts.showRoot ? { [rootName]: body } : body;
    return JSON.stringify(val, null, 2);
  }

  if (style === 'dirs') {
    const walk = (n: TreeNode, path: string): void => {
      const files = n.children.filter((c) => !(c.isDir || c.children.length));
      const dirs = n.children.filter((c) => c.isDir || c.children.length);
      const p = path === '' ? './' : path + '/';
      if (files.length || dirs.length === 0 || n.comment) {
        lines.push({
          text: `${p}${files.length ? ': ' + files.map((f) => f.name).join(', ') : ''}`,
          comment: n.comment,
        });
      }
      for (const d of dirs) walk(d, path ? path + '/' + d.name : d.name);
    };
    if (opts.showRoot) {
      const sub = { ...root, name: rootName };
      const walkRoot = (n: TreeNode, path: string): void => {
        const files = n.children.filter((c) => !(c.isDir || c.children.length));
        const dirs = n.children.filter((c) => c.isDir || c.children.length);
        if (files.length || dirs.length === 0 || n.comment) {
          lines.push({ text: `${path}/${files.length ? ': ' + files.map((f) => f.name).join(', ') : ''}`, comment: n.comment });
        }
        for (const d of dirs) walkRoot(d, path + '/' + d.name);
      };
      walkRoot(sub, rootName);
    } else walk(root, '');
    return joinLines(lines, opts);
  }

  if (style === 'unicode' || style === 'ascii') {
    const [mid, last, bar, gap] = style === 'unicode' ? ['├── ', '└── ', '│   ', '    '] : ['|-- ', '`-- ', '|   ', '    '];
    const walk = (n: TreeNode, prefix: string): void => {
      n.children.forEach((c, i) => {
        const isLast = i === n.children.length - 1;
        lines.push({ text: prefix + (isLast ? last : mid) + label(c), comment: c.comment });
        walk(c, prefix + (isLast ? gap : bar));
      });
    };
    if (opts.showRoot) lines.push({ text: rootLabel, comment: root.comment });
    walk(root, '');
    return joinLines(lines, opts);
  }

  // mdlist / indent / plain
  const unit = '  ';
  const walk = (n: TreeNode, level: number): void => {
    for (const c of n.children) {
      const l = label(c, style === 'indent');
      const ind = unit.repeat(level);
      lines.push({ text: style === 'mdlist' ? `${ind}- ${l}` : `${ind}${style === 'plain' ? c.name : l}`, comment: c.comment });
      walk(c, level + 1);
    }
  };
  if (opts.showRoot) {
    const rl = style === 'plain' ? rootName : rootLabel;
    lines.push({ text: style === 'mdlist' ? `- ${rl}` : rl, comment: root.comment });
    walk(root, 1);
  } else walk(root, 0);
  return joinLines(lines, opts);
}

/** Danh sách đường dẫn đầy đủ (để ghi ngược vào ô nhập). Thư mục có `/` cuối; chú thích sau `  # `. */
export function toPathList(root: TreeNode): string {
  const out: string[] = [];
  const walk = (n: TreeNode, path: string): void => {
    for (const c of n.children) {
      const p = path ? path + '/' + c.name : c.name;
      const isDir = c.isDir || c.children.length > 0;
      if (c.children.length === 0 || c.comment) {
        out.push(`${p}${isDir ? '/' : ''}${c.comment ? '  # ' + c.comment.replace(/\s*\n\s*/g, ' ') : ''}`);
      }
      walk(c, p);
    }
  };
  walk(root, '');
  return out.join('\n');
}

export function wrapForReadme(tree: string, withHeading: boolean, heading = '## Cấu trúc thư mục'): string {
  let fence = '```';
  while (tree.includes(fence)) fence += '`';
  const block = `${fence}text\n${tree}\n${fence}`;
  return withHeading ? `${heading}\n\n${block}\n` : block + '\n';
}

/* ------------------------------------------------------------------ */
/* Chỉnh sửa (bất biến)                                                 */
/* ------------------------------------------------------------------ */

export function cloneTree(n: TreeNode): TreeNode {
  return { ...n, children: n.children.map(cloneTree) };
}

function mapNode(n: TreeNode, id: string, fn: (x: TreeNode) => TreeNode | null): TreeNode | null {
  if (n.id === id) return fn(n);
  let changed = false;
  const children: TreeNode[] = [];
  for (const c of n.children) {
    const r = mapNode(c, id, fn);
    if (r !== c) changed = true;
    if (r) children.push(r);
  }
  return changed ? { ...n, children } : n;
}

export function sanitizeName(s: string): string {
  return s.replace(/[\\/]/g, '').slice(0, MAX_NAME);
}

export function renameNode(root: TreeNode, id: string, name: string): TreeNode {
  const nm = sanitizeName(name).trim();
  if (!nm) return root;
  return mapNode(root, id, (n) => ({ ...n, name: nm })) ?? root;
}

export function deleteNode(root: TreeNode, id: string): TreeNode {
  if (root.id === id) return root;
  return mapNode(root, id, () => null) ?? root;
}

export function addChild(root: TreeNode, id: string, name: string, isDir: boolean): TreeNode {
  const nm = sanitizeName(name).trim();
  if (!nm) return root;
  return (
    mapNode(root, id, (n) => ({ ...n, isDir: true, children: [...n.children, makeNode(nm, isDir)] })) ?? root
  );
}

export function setComment(root: TreeNode, id: string, comment: string): TreeNode {
  return (
    mapNode(root, id, (n) => {
      const next = { ...n };
      if (comment) next.comment = comment;
      else delete next.comment;
      return next;
    }) ?? root
  );
}

export function toggleDir(root: TreeNode, id: string): TreeNode {
  return mapNode(root, id, (n) => (n.children.length ? n : { ...n, isDir: !n.isDir })) ?? root;
}

/** So sánh cấu trúc (tên, loại thư mục, thứ tự, chú thích) - dùng cho kiểm thử. */
export function structureOf(n: TreeNode, withComments = true): unknown {
  return {
    name: n.name,
    dir: n.isDir || n.children.length > 0,
    ...(withComments && n.comment ? { c: n.comment } : {}),
    children: n.children.map((c) => structureOf(c, withComments)),
  };
}
