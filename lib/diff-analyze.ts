/**
 * Phân tích unified diff HOÀN TOÀN cục bộ (heuristic, không gọi mạng, không AI):
 * parser diff, thống kê theo file, suy luận type/scope, sinh commit message và mô tả PR,
 * phát hiện BREAKING CHANGE, bump dependency, cờ rủi ro và cảnh báo (secret/debug/TODO).
 * Logic thuần, không React. Không bao giờ throw với dữ liệu xấu.
 */

/* ------------------------------------------------------------------ */
/* Kiểu dữ liệu                                                        */
/* ------------------------------------------------------------------ */

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C';
export type FileCategory =
  | 'source' | 'test' | 'docs' | 'config' | 'ci' | 'build' | 'lockfile' | 'migration' | 'asset' | 'generated';

export interface LineRef { no: number; text: string }
export interface HunkInfo { context: string; removed: string[]; added: string[] }

export interface FileDiff {
  path: string;
  oldPath: string;
  status: FileStatus;
  binary: boolean;
  modeChange: boolean;
  similarity?: number;
  added: number;
  removed: number;
  language: string;
  category: FileCategory;
  addedLines: LineRef[];
  removedLines: LineRef[];
  hunks: HunkInfo[];
}

export interface ParsedDiff {
  files: FileDiff[];
  preamble: string;
  totalAdded: number;
  totalRemoved: number;
  lineCount: number;
}

export type CommitType = 'feat' | 'fix' | 'docs' | 'style' | 'refactor' | 'perf' | 'test' | 'build' | 'ci' | 'chore' | 'revert';
export type CommitStyle = 'conventional' | 'short' | 'detailed';
export type Lang = 'en' | 'vi';

export type SymKind = 'function' | 'class' | 'component' | 'hook' | 'type' | 'interface' | 'enum' | 'constant' | 'route' | 'struct' | 'trait' | 'module' | 'style' | 'method' | 'page' | 'endpoint';
export interface Sym { name: string; kind: SymKind; exported: boolean; file: string; line: number; params?: string }

export interface DepChange {
  name: string;
  from?: string;
  to?: string;
  kind: 'bump' | 'add' | 'remove';
  major: boolean;
  file: string;
}

export interface Finding { kind: 'secret' | 'debug' | 'todo'; rule: string; file: string; line: number; text: string }

export interface Risk {
  id: string;
  level: 'high' | 'medium' | 'low';
  en: string;
  vi: string;
  items?: string[];
}

export interface AnalyzeOptions {
  style?: CommitStyle;
  language?: Lang;
  /** Ghi đè scope (để trống = tự suy luận). */
  scope?: string;
  /** Ô issue/branch/trailer người dùng dán. */
  issue?: string;
}

export interface IssueRefs { refs: string[]; closes: string[] }

export interface Analysis {
  ok: boolean;
  error?: string;
  parsed: ParsedDiff;
  type: CommitType;
  confidence: number;
  reasons: string[];
  scope: string;
  scopeSource: 'override' | 'monorepo' | 'directory' | 'file' | 'deps' | 'none';
  breaking: boolean;
  breakingReasons: string[];
  subject: string;
  body: string;
  footers: string[];
  commitMessage: string;
  prTitle: string;
  prDescription: string;
  deps: DepChange[];
  symbols: Sym[];
  risks: Risk[];
  findings: Finding[];
  issues: IssueRefs;
  categoryStats: { category: FileCategory; files: number; added: number; removed: number }[];
}

/* ------------------------------------------------------------------ */
/* Tiện ích                                                            */
/* ------------------------------------------------------------------ */

const MAX_STORED_LINE = 500;
const MAX_MATCH_LINE = 600;
const MAX_FINDINGS = 200;

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}
function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}
function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
function unquoteGit(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t
      .slice(1, -1)
      .replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\(["\\])/g, '$1')
      .replace(/\\t/g, '\t')
      .replace(/\\n/g, '\n');
  }
  return t;
}
function stripPrefix(p: string, pre: 'a/' | 'b/'): string {
  return p.startsWith(pre) ? p.slice(2) : p;
}
function uniq<T>(a: T[]): T[] {
  return Array.from(new Set(a));
}
function cap(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}
function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function fmt(n: number): string {
  return String(n);
}

/* ------------------------------------------------------------------ */
/* Ngôn ngữ & phân loại file                                           */
/* ------------------------------------------------------------------ */

const LANGS: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX', mjs: 'JavaScript', cjs: 'JavaScript', mts: 'TypeScript', cts: 'TypeScript',
  py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', cs: 'C#', php: 'PHP', rb: 'Ruby', swift: 'Swift',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', css: 'CSS', scss: 'SCSS', sass: 'SCSS', less: 'Less', html: 'HTML', htm: 'HTML',
  vue: 'Vue', svelte: 'Svelte', md: 'Markdown', mdx: 'Markdown', rst: 'reStructuredText', json: 'JSON', yml: 'YAML', yaml: 'YAML',
  toml: 'TOML', sql: 'SQL', sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell', xml: 'XML', gradle: 'Gradle', tf: 'Terraform',
  lua: 'Lua', dart: 'Dart', scala: 'Scala', r: 'R', ex: 'Elixir', exs: 'Elixir', txt: 'Text', ini: 'INI', env: 'Env', proto: 'Protobuf',
  graphql: 'GraphQL', gql: 'GraphQL', lock: 'Lockfile',
};

export function languageOf(path: string): string {
  const base = basename(path).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.') || base.endsWith('.dockerfile')) return 'Dockerfile';
  if (base === 'makefile') return 'Makefile';
  if (base.startsWith('.env')) return 'Env';
  const i = base.lastIndexOf('.');
  if (i < 0) return '';
  return LANGS[base.slice(i + 1)] || '';
}

type Family = 'js' | 'py' | 'go' | 'rs' | 'jvm' | 'php' | 'rb' | 'css' | 'sh' | 'other';
function familyOf(lang: string): Family {
  switch (lang) {
    case 'TypeScript': case 'TSX': case 'JavaScript': case 'JSX': case 'Vue': case 'Svelte': return 'js';
    case 'Python': return 'py';
    case 'Go': return 'go';
    case 'Rust': return 'rs';
    case 'Java': case 'Kotlin': case 'C#': case 'Scala': case 'Swift': return 'jvm';
    case 'PHP': return 'php';
    case 'Ruby': return 'rb';
    case 'CSS': case 'SCSS': case 'Less': return 'css';
    case 'Shell': return 'sh';
    default: return 'other';
  }
}

const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'cargo.lock', 'poetry.lock', 'composer.lock', 'go.sum', 'gemfile.lock',
  'pipfile.lock', 'bun.lockb', 'bun.lock', 'uv.lock', 'flake.lock', 'npm-shrinkwrap.json', 'packages.lock.json', 'mix.lock', 'pubspec.lock',
]);
const BUILD_FILES = new Set([
  'package.json', 'composer.json', 'go.mod', 'cargo.toml', 'pyproject.toml', 'setup.py', 'setup.cfg', 'pipfile', 'gemfile', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'makefile', 'cmakelists.txt', '.dockerignore',
  '.nvmrc', '.node-version', '.tool-versions', 'rollup.config.js', 'rollup.config.mjs', 'rollup.config.ts', 'webpack.config.js',
  'webpack.config.ts', 'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'esbuild.config.js', 'next.config.js', 'next.config.mjs',
  'next.config.ts', 'nuxt.config.ts', 'nuxt.config.js', 'tsup.config.ts', 'turbo.json', 'lerna.json', 'nx.json', 'mix.exs', 'build.sbt',
]);
const CONFIG_BASES = [
  '.env', '.eslintrc', '.prettierrc', '.editorconfig', '.gitignore', '.gitattributes', 'tsconfig', 'jsconfig', 'eslint.config',
  'tailwind.config', 'postcss.config', 'jest.config', 'vitest.config', 'babel.config', '.babelrc', '.browserslistrc', '.stylelintrc',
  '.npmrc', '.yarnrc', 'renovate.json', 'nginx.conf', '.prettierignore', '.eslintignore',
];

export function classifyPath(path: string): FileCategory {
  const lp = path.toLowerCase();
  const base = basename(lp);
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';

  if (LOCKFILES.has(base)) return 'lockfile';
  if (
    /(^|\/)(node_modules|vendor|dist|build|out|\.next|coverage|__generated__|generated|\.nuxt|target\/(debug|release))\//.test(lp) ||
    /\.min\.(js|css)$|\.map$|\.pb\.go$|_pb2(_grpc)?\.py$|\.generated\.\w+$|\.g\.dart$|\.designer\.cs$|\.d\.ts\.map$/.test(base)
  ) return 'generated';
  if (
    /^\.github\/(workflows|actions)\//.test(lp) ||
    /(^|\/)(\.gitlab-ci\.ya?ml|\.travis\.ya?ml|azure-pipelines\.ya?ml|bitbucket-pipelines\.ya?ml|cloudbuild\.ya?ml|\.drone\.ya?ml|jenkinsfile)$/.test(lp) ||
    /(^|\/)(\.circleci|\.buildkite|\.gitlab)\//.test(lp) ||
    lp === '.github/dependabot.yml' || lp === '.github/dependabot.yaml'
  ) return 'ci';
  if (/(^|\/)(migrations?|migrate|alembic\/versions|db\/migrate|prisma\/migrations|flyway|liquibase)\//.test(lp)) return 'migration';
  if (
    /(^|\/)(__tests__|__mocks__|tests?|spec|specs|e2e|cypress|playwright|testing|__snapshots__)\//.test(lp) ||
    /\.(test|spec)\.[a-z0-9]+$/.test(base) ||
    /_test\.(go|py|rb|exs?|rs|js|ts|php)$/.test(base) ||
    /^test_.*\.py$/.test(base) ||
    /(test|tests|it)\.(java|kt|cs|scala|swift)$/.test(base) ||
    /_spec\.rb$/.test(base) || ext === 'snap'
  ) {
    if (ext !== 'md' && ext !== 'mdx') return 'test';
  }
  if (
    ['md', 'mdx', 'rst', 'adoc', 'markdown'].includes(ext) ||
    (ext === 'txt' && !/^(requirements|constraints|robots|cmakelists)/.test(base)) ||
    /^(readme|changelog|contributing|license|licence|authors|code_of_conduct|security|notice|history)(\.|$)/.test(base) ||
    /^(docs?|documentation|wiki)\//.test(lp)
  ) {
    if (!['js', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs'].includes(ext)) return 'docs';
  }
  if (
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'mp3', 'mp4', 'mov', 'webm', 'wav', 'ogg', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'pdf', 'zip', 'tar', 'gz', '7z', 'psd', 'ai', 'sketch', 'fig', 'icns', 'jar', 'exe', 'dll', 'so', 'bin'].includes(ext)
  ) return 'asset';
  if (
    BUILD_FILES.has(base) || base === 'dockerfile' || base.startsWith('dockerfile.') || base.endsWith('.dockerfile') ||
    /^docker-compose.*\.ya?ml$/.test(base) || /^compose(\.[\w-]+)?\.ya?ml$/.test(base) ||
    /^requirements[\w.-]*\.txt$/.test(base) || /^constraints[\w.-]*\.txt$/.test(base) || ext === 'csproj' || ext === 'sln'
  ) return 'build';
  if (
    ['json', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'plist', 'editorconfig'].includes(ext) ||
    CONFIG_BASES.some((b) => base === b || base.startsWith(b + '.') || base.startsWith(b)) ||
    /\.config\.(js|ts|mjs|cjs)$/.test(base) || /^\.[a-z]+rc(\.(js|json|ya?ml|cjs))?$/.test(base)
  ) return 'config';
  return 'source';
}

/* ------------------------------------------------------------------ */
/* Parser unified diff                                                 */
/* ------------------------------------------------------------------ */

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const COMBINED_HUNK_RE = /^@{3,} (?:-\d+(?:,\d+)? )+\+(\d+)(?:,\d+)? @{3,} ?(.*)$/;

function newFile(path: string, oldPath: string): FileDiff {
  return {
    path, oldPath, status: 'M', binary: false, modeChange: false, added: 0, removed: 0,
    language: '', category: 'source', addedLines: [], removedLines: [], hunks: [],
  };
}

function splitGitHeader(rest: string): [string, string] {
  const r = rest.trim();
  if (r.startsWith('"')) {
    // "a/x y" "b/x y"
    const m = /^("(?:[^"\\]|\\.)*")\s+("(?:[^"\\]|\\.)*"|\S.*)$/.exec(r);
    if (m) return [stripPrefix(unquoteGit(m[1]), 'a/'), stripPrefix(unquoteGit(m[2]), 'b/')];
  }
  // tìm cặp "a/X b/X" đối xứng (xử lý tên có khoảng trắng)
  let idx = r.indexOf(' b/');
  while (idx >= 0) {
    const left = r.slice(0, idx);
    const right = r.slice(idx + 1);
    if (left.startsWith('a/') && left.slice(2) === right.slice(2)) return [left.slice(2), right.slice(2)];
    idx = r.indexOf(' b/', idx + 1);
  }
  idx = r.indexOf(' b/');
  if (idx >= 0) return [stripPrefix(r.slice(0, idx), 'a/'), r.slice(idx + 3)];
  const sp = r.indexOf(' ');
  if (sp > 0 && r.indexOf(' ', sp + 1) < 0) return [stripPrefix(r.slice(0, sp), 'a/'), stripPrefix(r.slice(sp + 1), 'b/')];
  const half = Math.floor(r.length / 2);
  const a = r.slice(0, half).trim();
  const b = r.slice(half).trim();
  return [stripPrefix(a, 'a/'), stripPrefix(b, 'b/')];
}

function cleanMarkerPath(raw: string): string | null {
  let s = raw;
  const tab = s.indexOf('\t');
  if (tab >= 0) s = s.slice(0, tab);
  s = unquoteGit(s.trimEnd());
  if (s === '/dev/null') return null;
  return s;
}

export function parseDiff(input: string): ParsedDiff {
  const text = typeof input === 'string' ? input : '';
  const raw = text.split('\n');
  let crlfLines = 0;
  let nonEmpty = 0;
  for (const l of raw) {
    if (l.length) {
      nonEmpty++;
      if (l.charCodeAt(l.length - 1) === 13) crlfLines++;
    }
  }
  const stripAll = nonEmpty > 0 && crlfLines / nonEmpty > 0.8;

  const files: FileDiff[] = [];
  const preamble: string[] = [];
  let cur = null as FileDiff | null;
  let gitHeader = false; // cur do `diff --git` tạo ra
  let sawMarkers = false; // cur đã có ---/+++
  let inHunk = false;
  let combined = false;
  let oldRemain = 0;
  let newRemain = 0;
  let oldNo = 0;
  let newNo = 0;
  let hunk = null as HunkInfo | null;
  let skipBinaryBody = false;

  const begin = (path: string, oldPath: string, viaGit: boolean) => {
    cur = newFile(path, oldPath);
    files.push(cur);
    gitHeader = viaGit;
    sawMarkers = false;
    inHunk = false;
    combined = false;
    hunk = null;
    skipBinaryBody = false;
  };

  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    const cr = line.length > 0 && line.charCodeAt(line.length - 1) === 13;

    if (inHunk && cur) {
      if (!line.startsWith('diff --git ') && !(combined && (line.startsWith('@@') || line.startsWith('diff ')))) {
        if (line.startsWith('\\')) continue; // "\ No newline at end of file"
        const c = line.length ? line[0] : ' ';
        if (combined) {
          const prefixLen = 2;
          const prefix = line.slice(0, prefixLen);
          let content = line.slice(prefixLen);
          if (cr && stripAll) content = content.slice(0, -1);
          const stored = cap(content, MAX_STORED_LINE);
          if (prefix.includes('+')) {
            cur.added++; cur.addedLines.push({ no: newNo, text: stored }); hunk?.added.push(stored); newNo++;
          } else if (prefix.includes('-')) {
            cur.removed++; cur.removedLines.push({ no: oldNo, text: stored }); hunk?.removed.push(stored); oldNo++;
          } else { newNo++; oldNo++; }
          continue;
        }
        if (c === ' ' || line === '') {
          if (oldRemain > 0 && newRemain > 0) { oldRemain--; newRemain--; oldNo++; newNo++; if (oldRemain <= 0 && newRemain <= 0) inHunk = false; continue; }
        } else if (c === '+' && newRemain > 0) {
          let content = line.slice(1);
          if (cr && stripAll) content = content.slice(0, -1);
          const stored = cap(content, MAX_STORED_LINE);
          cur.added++; cur.addedLines.push({ no: newNo, text: stored }); hunk?.added.push(stored);
          newRemain--; newNo++;
          if (oldRemain <= 0 && newRemain <= 0) inHunk = false;
          continue;
        } else if (c === '-' && oldRemain > 0) {
          let content = line.slice(1);
          if (cr && stripAll) content = content.slice(0, -1);
          const stored = cap(content, MAX_STORED_LINE);
          cur.removed++; cur.removedLines.push({ no: oldNo, text: stored }); hunk?.removed.push(stored);
          oldRemain--; oldNo++;
          if (oldRemain <= 0 && newRemain <= 0) inHunk = false;
          continue;
        }
      }
      // dòng không hợp lệ trong hunk (diff bị cắt/lỗi): thoát hunk và xử lý như header
      inHunk = false;
    }

    if (cr) line = line.slice(0, -1);

    if (line.startsWith('diff --git ')) {
      const [a, b] = splitGitHeader(line.slice(11));
      begin(b || a, a || b, true);
      continue;
    }
    if (line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      const p = unquoteGit(line.slice(line.indexOf(' ', 7) + 1));
      begin(p, p, true);
      if (cur) (cur as FileDiff).modeChange = false;
      combined = true;
      continue;
    }

    if (cur && gitHeader && !sawMarkers) {
      const c: FileDiff = cur;
      if (line.startsWith('new file mode')) { c.status = 'A'; continue; }
      if (line.startsWith('deleted file mode')) { c.status = 'D'; continue; }
      if (line.startsWith('old mode ') || line.startsWith('new mode ')) { c.modeChange = true; continue; }
      if (line.startsWith('similarity index ')) { c.similarity = parseInt(line.slice(17), 10); continue; }
      if (line.startsWith('rename from ')) { c.oldPath = unquoteGit(line.slice(12)); c.status = 'R'; continue; }
      if (line.startsWith('rename to ')) { c.path = unquoteGit(line.slice(10)); c.status = 'R'; continue; }
      if (line.startsWith('copy from ')) { c.oldPath = unquoteGit(line.slice(10)); c.status = 'C'; continue; }
      if (line.startsWith('copy to ')) { c.path = unquoteGit(line.slice(8)); c.status = 'C'; continue; }
    }

    if (cur && (line.startsWith('Binary files ') || line.startsWith('GIT binary patch'))) {
      (cur as FileDiff).binary = true;
      if (line.startsWith('Binary files ')) {
        if (/ and \/dev\/null differ$/.test(line) || / \/dev\/null and /.test(line)) {
          if (/^Binary files \/dev\/null and /.test(line)) (cur as FileDiff).status = 'A';
          else if (/ and \/dev\/null differ$/.test(line)) (cur as FileDiff).status = 'D';
        }
      }
      skipBinaryBody = line.startsWith('GIT binary patch');
      continue;
    }
    if (skipBinaryBody && cur) continue;

    if (line.startsWith('--- ') && i + 1 < raw.length && raw[i + 1].startsWith('+++ ')) {
      const oldP = cleanMarkerPath(line.slice(4));
      const newP = cleanMarkerPath(raw[i + 1].replace(/\r$/, '').slice(4));
      i++;
      const oldClean = oldP === null ? null : stripPrefix(oldP, 'a/');
      const newClean = newP === null ? null : stripPrefix(newP, 'b/');
      if (cur && gitHeader && !sawMarkers) {
        const c: FileDiff = cur;
        if (oldClean === null && c.status === 'M') c.status = 'A';
        if (newClean === null && c.status === 'M') c.status = 'D';
        if (newClean && !c.path) c.path = newClean;
      } else {
        const p = newClean ?? oldClean ?? '(không rõ)';
        begin(p, oldClean ?? p, false);
        const c: FileDiff = cur as unknown as FileDiff;
        if (oldClean === null) c.status = 'A';
        else if (newClean === null) c.status = 'D';
      }
      sawMarkers = true;
      continue;
    }

    const hm = HUNK_RE.exec(line);
    const cm = hm ? null : COMBINED_HUNK_RE.exec(line);
    if (hm || cm) {
      if (!cur) begin('(không rõ)', '(không rõ)', false);
      const c: FileDiff = cur as unknown as FileDiff;
      skipBinaryBody = false;
      if (hm) {
        oldNo = parseInt(hm[1], 10);
        oldRemain = hm[2] === undefined ? 1 : parseInt(hm[2], 10);
        newNo = parseInt(hm[3], 10);
        newRemain = hm[4] === undefined ? 1 : parseInt(hm[4], 10);
        hunk = { context: cap(hm[5].trim(), 200), removed: [], added: [] };
        combined = false;
        inHunk = oldRemain > 0 || newRemain > 0;
      } else if (cm) {
        newNo = parseInt(cm[1], 10);
        oldNo = newNo;
        hunk = { context: cap(cm[2].trim(), 200), removed: [], added: [] };
        combined = true;
        inHunk = true;
      }
      if (hunk) c.hunks.push(hunk);
      sawMarkers = true;
      continue;
    }

    if (!cur && preamble.length < 400) preamble.push(line);
  }

  let totalAdded = 0;
  let totalRemoved = 0;
  for (const f of files) {
    f.language = languageOf(f.path);
    f.category = classifyPath(f.path);
    totalAdded += f.added;
    totalRemoved += f.removed;
  }
  return { files, preamble: preamble.join('\n').trim(), totalAdded, totalRemoved, lineCount: raw.length };
}

/* ------------------------------------------------------------------ */
/* Trích symbol / route / tên test (regex nhẹ, theo dòng)               */
/* ------------------------------------------------------------------ */

const GENERIC_NAMES = new Set([
  'default', 'handler', 'main', 'index', 'page', 'layout', 'get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'test', 'run', 'init',
  'setup', 'render', 'constructor', 'app', 'new', 'call', 'self', 'it', 'describe', 'before', 'after', 'tostring', 'equals', 'hashcode',
  'loading', 'error', 'notfound', 'home', 'template', 'middleware',
]);

const RE_JS_FN = /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(([^)]*)/;
const RE_JS_CLASS = /^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const RE_JS_TYPE = /^\s*(export\s+)?(?:declare\s+)?(interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const RE_JS_ARROW = /^\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/;
const RE_JS_CONST = /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;

const RE_ROUTES: RegExp[] = [
  /\b(?:app|router|server|api|r|e|g|route|routes|fastify)\.(get|post|put|delete|patch|all|head)\s*\(\s*['"`]([^'"`]{1,120})['"`]/,
  /@\w+\.route\(\s*['"]([^'"]{1,120})['"]/,
  /@\w+\.(get|post|put|delete|patch)\(\s*['"]([^'"]{1,120})['"]/,
  /@(Get|Post|Put|Delete|Patch|Request)Mapping\(\s*(?:value\s*=\s*)?["']([^"']{1,120})["']/,
  /Route::(get|post|put|delete|patch|any)\(\s*['"]([^'"]{1,120})['"]/,
  /HandleFunc\(\s*"([^"]{1,120})"/,
  /\.(GET|POST|PUT|DELETE|PATCH)\(\s*"([^"]{1,120})"/,
];
const RE_RAILS_ROUTE = /^\s*(get|post|put|patch|delete)\s+['"]([^'"]{1,120})['"]/;

function declOfLine(f: Family, lang: string, line: string, file: string, no: number): Sym | null {
  if (line.length > MAX_MATCH_LINE) return null;
  let m: RegExpExecArray | null;
  const mk = (name: string, kind: SymKind, exported: boolean, params?: string): Sym => ({ name, kind, exported, file, line: no, params });
  switch (f) {
    case 'js': {
      if ((m = RE_JS_FN.exec(line))) {
        const name = m[2];
        const kind: SymKind = /^use[A-Z]/.test(name) ? 'hook' : /^[A-Z]/.test(name) && (lang === 'TSX' || lang === 'JSX') ? 'component' : 'function';
        return mk(name, kind, !!m[1] || /^\s*export\b/.test(line), m[3]);
      }
      if ((m = RE_JS_CLASS.exec(line))) return mk(m[2], 'class', !!m[1]);
      if ((m = RE_JS_TYPE.exec(line))) return mk(m[3], m[2] === 'interface' ? 'interface' : m[2] === 'enum' ? 'enum' : 'type', !!m[1]);
      if ((m = RE_JS_ARROW.exec(line))) {
        const name = m[2];
        const kind: SymKind = /^use[A-Z]/.test(name) ? 'hook' : /^[A-Z]/.test(name) && (lang === 'TSX' || lang === 'JSX') ? 'component' : 'function';
        return mk(name, kind, !!m[1], m[3]);
      }
      if ((m = RE_JS_CONST.exec(line))) return mk(m[1], 'constant', true);
      return null;
    }
    case 'py': {
      if ((m = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)/.exec(line))) return mk(m[2], m[1].length ? 'method' : 'function', !m[1].length && !m[2].startsWith('_'), m[3]);
      if ((m = /^class\s+([A-Za-z_]\w*)/.exec(line))) return mk(m[1], 'class', !m[1].startsWith('_'));
      return null;
    }
    case 'go': {
      if ((m = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\(([^)]*)/.exec(line))) return mk(m[1], 'function', /^[A-Z]/.test(m[1]), m[2]);
      if ((m = /^type\s+([A-Za-z_]\w*)\s+(struct|interface)/.exec(line))) return mk(m[1], m[2] === 'struct' ? 'struct' : 'interface', /^[A-Z]/.test(m[1]));
      return null;
    }
    case 'rs': {
      if ((m = /^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)/.exec(line))) return mk(m[2], 'function', !!m[1], m[3]);
      if ((m = /^\s*(pub(?:\([^)]*\))?\s+)?(struct|enum|trait|mod)\s+([A-Za-z_]\w*)/.exec(line))) return mk(m[3], m[2] === 'struct' ? 'struct' : m[2] === 'enum' ? 'enum' : m[2] === 'trait' ? 'trait' : 'module', !!m[1]);
      return null;
    }
    case 'jvm': {
      if ((m = /^\s*(?:(public|protected|internal|open)\s+)?(?:(?:static|final|abstract|sealed|partial|data)\s+)*(class|interface|enum|record|struct|object)\s+([A-Za-z_]\w*)/.exec(line))) {
        return mk(m[3], m[2] === 'interface' ? 'interface' : m[2] === 'enum' ? 'enum' : m[2] === 'struct' ? 'struct' : 'class', m[1] === 'public' || m[1] === 'protected' || m[1] === 'open' || m[1] === 'internal' || (lang !== 'Java' && lang !== 'C#'));
      }
      if ((m = /^\s*(?:(?:public|internal|override|suspend|private|open)\s+)*(?:fun|func)\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(([^)]*)/.exec(line))) {
        return mk(m[1], 'function', !/^\s*private\b/.test(line), m[2]);
      }
      if ((m = /^\s*(public|protected)\s+(?:(?:static|final|abstract|virtual|override|async)\s+)*[\w<>[\],.?]+\s+([A-Za-z_]\w*)\s*\(([^)]*)/.exec(line))) return mk(m[2], 'method', true, m[3]);
      return null;
    }
    case 'php': {
      if ((m = /^\s*(?:abstract\s+|final\s+)?(class|interface|trait)\s+([A-Za-z_]\w*)/.exec(line))) return mk(m[2], m[1] === 'interface' ? 'interface' : m[1] === 'trait' ? 'trait' : 'class', true);
      if ((m = /^\s*(?:(public|protected|private)\s+)?(?:static\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)/.exec(line))) return mk(m[2], 'function', m[1] !== 'private' && m[1] !== 'protected', m[3]);
      return null;
    }
    case 'rb': {
      if ((m = /^\s*(class|module)\s+([A-Z]\w*)/.exec(line))) return mk(m[2], m[1] === 'module' ? 'module' : 'class', true);
      if ((m = /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)\s*(?:\(([^)]*)\))?/.exec(line))) return mk(m[1], 'method', !m[1].startsWith('_'), m[2]);
      return null;
    }
    case 'css': {
      if ((m = /^\s*@keyframes\s+([\w-]+)/.exec(line))) return mk(m[1], 'style', true);
      if ((m = /^\s*\.([A-Za-z_][\w-]*)\s*(?:[{,:]|$)/.exec(line))) return mk(m[1], 'style', true);
      return null;
    }
    case 'sh': {
      if ((m = /^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/.exec(line))) return mk(m[1], 'function', true);
      return null;
    }
    default:
      return null;
  }
}

function routeOfLine(lang: string, line: string, file: string, no: number): Sym | null {
  if (line.length > MAX_MATCH_LINE) return null;
  let m: RegExpExecArray | null;
  for (const re of RE_ROUTES) {
    m = re.exec(line);
    if (m) {
      const path = m[m.length - 1];
      const method = m.length > 2 && m[1] ? m[1].toUpperCase() : 'ANY';
      return { name: `${method} ${path}`, kind: 'route', exported: true, file, line: no };
    }
  }
  if (lang === 'Ruby' && (m = RE_RAILS_ROUTE.exec(line))) return { name: `${m[1].toUpperCase()} ${m[2]}`, kind: 'route', exported: true, file, line: no };
  return null;
}

function humanizeTestTitle(title: string): string {
  let t = title.trim().replace(/^test[_\s]+/i, '').replace(/_/g, ' ');
  t = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(/^(it\s+)?(should|must|can|will|correctly|properly|handles?|supports?|parses?|returns?|throws?|works?|does|do|is|are)\s+/i, '');
  }
  t = t.toLowerCase().trim();
  return cap(t, 40).trim();
}

const RE_TEST_TITLES: RegExp[] = [
  /\b(?:it|test|describe)(?:\.each)?\s*\(\s*['"`]([^'"`]{3,80})['"`]/,
  /^\s*(?:async\s+)?def\s+test_(\w+)/,
  /^func\s+Test(\w+)\s*\(/,
  /^\s*it\s+['"]([^'"]{3,80})['"]/,
  /@Test[\s\S]{0,40}?void\s+(\w+)/,
  /^\s*(?:public\s+)?void\s+(test\w+)\s*\(/,
];

function testTitleOfLine(line: string): string | null {
  if (line.length > MAX_MATCH_LINE) return null;
  for (const re of RE_TEST_TITLES) {
    const m = re.exec(line);
    if (m) return m[1];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Dependency bumps                                                    */
/* ------------------------------------------------------------------ */

const NPM_SKIP_KEYS = new Set(['node', 'npm', 'yarn', 'pnpm', 'php', 'name', 'description', 'license', 'main', 'module', 'types', 'type', 'author', 'homepage', 'repository', 'private', 'packagemanager', 'bun', 'deno']);
const TOML_SKIP_KEYS = new Set(['name', 'edition', 'license', 'description', 'rust-version', 'readme', 'repository', 'homepage', 'documentation', 'resolver', 'path', 'python', 'authors', 'requires-python', 'build-backend', 'channel']);
const VERSION_SPEC = /^(?:[\^~<>=v]+\s*)?\d[\w.\-+*xX]*(?:\s*(?:\|\||,|\s)\s*(?:[\^~<>=v]+\s*)?\d[\w.\-+*xX]*)*$/;
const VERSION_SPECIAL = /^(workspace:|npm:|file:|link:|github:|git\+|git:|https?:|latest$|next$|\*$)/;

type DepLine = { kind: 'dep'; name: string; version: string } | { kind: 'own'; version: string } | null;

function parseDepLine(base: string, text: string): DepLine {
  if (text.length > MAX_MATCH_LINE) return null;
  let m: RegExpExecArray | null;
  if (base === 'package.json' || base === 'composer.json') {
    m = /^\s*"([^"]+)"\s*:\s*"([^"]*)"\s*,?\s*$/.exec(text);
    if (!m) return null;
    const key = m[1];
    const val = m[2];
    if (key === 'version' && /^\d/.test(val)) return { kind: 'own', version: val };
    if (NPM_SKIP_KEYS.has(key.toLowerCase())) return null;
    if (!/^(@[\w.-]+\/)?[\w.-]+(\/[\w.-]+)?$/.test(key)) return null;
    if (VERSION_SPEC.test(val) || VERSION_SPECIAL.test(val)) return { kind: 'dep', name: key, version: val };
    return null;
  }
  if (/^(requirements|constraints)[\w.-]*\.txt$/.test(base)) {
    m = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(==|>=|<=|~=|>|<|!=)\s*([\w.*+!-]+)/.exec(text);
    if (m) return { kind: 'dep', name: m[1], version: (m[2] === '==' ? '' : m[2]) + m[3] };
    m = /^\s*([A-Za-z0-9_.-]+)\s*$/.exec(text);
    if (m) return { kind: 'dep', name: m[1], version: '' };
    return null;
  }
  if (base === 'go.mod') {
    m = /^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[\w.\-/~]+)\s+(v[\w.\-+]+)/.exec(text);
    if (m && !text.includes('=>')) return { kind: 'dep', name: m[1], version: m[2] };
    return null;
  }
  if (base === 'cargo.toml' || base === 'pyproject.toml') {
    m = /^\s*version\s*=\s*"([^"]+)"\s*$/.exec(text);
    if (m) return { kind: 'own', version: m[1] };
    m = /^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"\s*$/.exec(text);
    if (m && !TOML_SKIP_KEYS.has(m[1].toLowerCase()) && (VERSION_SPEC.test(m[2]) || m[2] === '*')) return { kind: 'dep', name: m[1], version: m[2] };
    m = /^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*\bversion\s*=\s*"([^"]+)"/.exec(text);
    if (m && !TOML_SKIP_KEYS.has(m[1].toLowerCase())) return { kind: 'dep', name: m[1], version: m[2] };
    m = /^\s*"([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(==|>=|<=|~=|>|<)\s*([^",\s;]+)[^"]*"\s*,?\s*$/.exec(text);
    if (m) return { kind: 'dep', name: m[1], version: (m[2] === '==' ? '' : m[2]) + m[3] };
    return null;
  }
  if (base === 'gemfile') {
    m = /^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/.exec(text);
    if (m) return { kind: 'dep', name: m[1], version: m[2] || '' };
    return null;
  }
  if (base.startsWith('build.gradle')) {
    m = /['"]([\w.-]+:[\w.-]+):([\w.+-]+)['"]/.exec(text);
    if (m) return { kind: 'dep', name: m[1], version: m[2] };
    return null;
  }
  return null;
}

function cleanVer(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const s = v.replace(/^[\^~=]+\s*/, '');
  return s === '' ? undefined : s;
}
function majorOf(v: string | undefined): number | null {
  if (!v) return null;
  const m = /(\d+)/.exec(v);
  return m ? parseInt(m[1], 10) : null;
}

interface ManifestResult {
  deps: DepChange[];
  ownVersion?: { from?: string; to?: string };
  depLines: number;
  ownLines: number;
  otherLines: number;
  touchedKeys: string[];
}

function analyzeManifest(f: FileDiff): ManifestResult {
  const base = basename(f.path).toLowerCase();
  const rem = new Map<string, string>();
  const add = new Map<string, string>();
  const res: ManifestResult = { deps: [], depLines: 0, ownLines: 0, otherLines: 0, touchedKeys: [] };
  let ownFrom: string | undefined;
  let ownTo: string | undefined;
  const handle = (text: string, side: 'r' | 'a') => {
    if (!text.trim() || /^[\s{}[\],()]*$/.test(text)) return;
    const d = parseDepLine(base, text);
    if (!d) {
      res.otherLines++;
      const km = /^\s*"([^"]+)"\s*:/.exec(text);
      if (km) res.touchedKeys.push(km[1]);
      return;
    }
    if (d.kind === 'own') {
      res.ownLines++;
      if (side === 'r') ownFrom = d.version; else ownTo = d.version;
      return;
    }
    res.depLines++;
    (side === 'r' ? rem : add).set(d.name, d.version);
  };
  for (const l of f.removedLines) handle(l.text, 'r');
  for (const l of f.addedLines) handle(l.text, 'a');
  const names = uniq([...rem.keys(), ...add.keys()]).sort();
  for (const name of names) {
    const a = add.get(name);
    const r = rem.get(name);
    if (a !== undefined && r !== undefined) {
      if (a === r) continue;
      const from = cleanVer(r);
      const to = cleanVer(a);
      const fm = majorOf(from);
      const tm = majorOf(to);
      res.deps.push({ name, from, to, kind: 'bump', major: fm !== null && tm !== null && tm > fm, file: f.path });
    } else if (a !== undefined) {
      res.deps.push({ name, to: cleanVer(a), kind: 'add', major: false, file: f.path });
    } else if (r !== undefined) {
      res.deps.push({ name, from: cleanVer(r), kind: 'remove', major: false, file: f.path });
    }
  }
  if (ownFrom !== undefined || ownTo !== undefined) res.ownVersion = { from: ownFrom, to: ownTo };
  return res;
}

/* ------------------------------------------------------------------ */
/* Style-only                                                          */
/* ------------------------------------------------------------------ */

function styleKind(f: FileDiff): 'whitespace' | 'format' | null {
  if (f.binary || f.category === 'lockfile' || f.category === 'generated') return null;
  if (!f.added && !f.removed) return null;
  let rs = 0;
  let as = 0;
  for (const l of f.removedLines) rs += l.text.length;
  for (const l of f.addedLines) as += l.text.length;
  if (rs > 2_000_000 || as > 2_000_000) return null;
  const strip = (arr: LineRef[]) => arr.map((l) => l.text).join('\n').replace(/\s+/g, '');
  const r1 = strip(f.removedLines);
  const a1 = strip(f.addedLines);
  if (r1 === a1) return 'whitespace';
  const norm = (s: string) => s.replace(/[,;'"`]/g, '');
  if (norm(r1) === norm(a1)) return 'format';
  return null;
}

/* ------------------------------------------------------------------ */
/* Cảnh báo (chỉ quét dòng THÊM)                                       */
/* ------------------------------------------------------------------ */

const PLACEHOLDER = /^(x+|\*+|\.+|-+|<.*>|\$\{.*\}|\$\(.*\)|\{\{.*\}\}|%.*%|\[.*\]|your[_-]?.*|<your.*|changeme|change[_-]?me|example.*|dummy.*|placeholder.*|sample.*|todo|null|undefined|none|true|false|process\.env.*|os\.environ.*|env\(.*|import\.meta\.env.*|getenv.*|secrets\..*|config\..*|settings\..*)$/i;

function looksSecretValue(v: string): boolean {
  if (v.length < 8 || PLACEHOLDER.test(v)) return false;
  if (/^(.)\1+$/.test(v)) return false;
  const hasDigit = /\d/.test(v);
  const mixed = /[a-z]/.test(v) && /[A-Z]/.test(v);
  const sym = /[^\w]/.test(v);
  return hasDigit || mixed || sym;
}

const SECRET_RULES: { id: string; re: RegExp }[] = [
  { id: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/ },
  { id: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'Stripe key', re: /\b[sr]k_live_[0-9a-zA-Z]{16,}\b/ },
  { id: 'API key (sk-...)', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}\b/ },
  { id: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/ },
  { id: 'URL kèm mật khẩu', re: /[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]{1,60}:[^\s:/@'"]{3,80}@[^\s'"]+/i },
];
const RE_SECRET_ASSIGN = /(?:password|passwd|pwd|secret|api[_-]?key|apikey|auth[_-]?token|access[_-]?token|private[_-]?key|client[_-]?secret|token)[\w-]{0,20}["']?\s*[:=]\s*(["'`])([^"'`\s]{8,100})\1/i;
const RE_SECRET_ENV = /^\s*(?:export\s+)?[A-Z][A-Z0-9_]{0,40}(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]{0,20}\s*=\s*(["']?)([^\s"'#]{8,100})\1\s*(?:#.*)?$/;

function maskSecret(line: string, secret: string): string {
  const shown = secret.length > 6 ? secret.slice(0, 3) + '***' : '***';
  return cap(line.replace(secret, shown).trim(), 110);
}

const DEBUG_RULES: { lang: Family[]; re: RegExp; id: string }[] = [
  { lang: ['js'], re: /\bconsole\.(?:log|debug|trace|dir)\s*\(/, id: 'console.log' },
  { lang: ['js'], re: /^\s*debugger\s*;?\s*$/, id: 'debugger' },
  { lang: ['php'], re: /\b(?:var_dump|print_r|dd|dump)\s*\(/, id: 'var_dump/dd' },
  { lang: ['rb'], re: /\b(?:binding\.pry|byebug|debugger)\b/, id: 'debugger' },
  { lang: ['py'], re: /\b(?:pdb\.set_trace|ipdb\.set_trace)\s*\(|^\s*import\s+i?pdb\b|\bbreakpoint\s*\(\s*\)/, id: 'pdb/breakpoint' },
  { lang: ['jvm'], re: /System\.(?:out|err)\.print(?:ln)?\s*\(|\.printStackTrace\s*\(/, id: 'System.out' },
  { lang: ['rs'], re: /\bdbg!\s*\(/, id: 'dbg!' },
];
const RE_TODO = /\b(TODO|FIXME|HACK|XXX)\b/;

function isCommentLine(t: string): boolean {
  return /^\s*(\/\/|#|\*|\/\*|--|<!--)/.test(t);
}

function scanFindings(files: FileDiff[]): Finding[] {
  const out: Finding[] = [];
  for (const f of files) {
    if (f.binary || f.category === 'lockfile' || f.category === 'generated') continue;
    const fam = familyOf(f.language);
    const isDocs = f.category === 'docs';
    const isTest = f.category === 'test';
    for (const l of f.addedLines) {
      if (out.length >= MAX_FINDINGS) return out;
      const text = l.text.length > MAX_MATCH_LINE ? l.text.slice(0, MAX_MATCH_LINE) : l.text;
      if (!text.trim()) continue;
      // secrets
      let secretDone = false;
      for (const r of SECRET_RULES) {
        const m = r.re.exec(text);
        if (m) {
          out.push({ kind: 'secret', rule: r.id, file: f.path, line: l.no, text: maskSecret(text, m[0]) });
          secretDone = true;
          break;
        }
      }
      if (!secretDone) {
        let m = RE_SECRET_ASSIGN.exec(text);
        if (m && looksSecretValue(m[2])) {
          out.push({ kind: 'secret', rule: 'Gán giá trị bí mật cứng', file: f.path, line: l.no, text: maskSecret(text, m[2]) });
          secretDone = true;
        } else if ((m = RE_SECRET_ENV.exec(text)) && looksSecretValue(m[2])) {
          out.push({ kind: 'secret', rule: 'Biến môi trường chứa bí mật', file: f.path, line: l.no, text: maskSecret(text, m[2]) });
          secretDone = true;
        }
      }
      if (isDocs) continue;
      if (!isTest && !isCommentLine(text)) {
        for (const r of DEBUG_RULES) {
          if (r.lang.includes(fam) && r.re.test(text)) {
            out.push({ kind: 'debug', rule: r.id, file: f.path, line: l.no, text: cap(text.trim(), 110) });
            break;
          }
        }
      }
      const tm = RE_TODO.exec(text);
      if (tm) out.push({ kind: 'todo', rule: tm[1], file: f.path, line: l.no, text: cap(text.trim(), 110) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Issue / PR number                                                   */
/* ------------------------------------------------------------------ */

const ISSUE_TOKEN = /(?:[\w.-]+\/[\w.-]+)?#\d{1,7}|\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b|\bGH-\d{1,7}\b/g;

export function inferIssues(input: string): IssueRefs {
  const refs: string[] = [];
  const closes: string[] = [];
  const text = typeof input === 'string' ? input.slice(0, 5000) : '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^co-authored-by:/i.test(line)) continue;
    let m = /^(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[:\s]+(.+)$/i.exec(line);
    if (m) {
      for (const t of m[1].match(ISSUE_TOKEN) || []) closes.push(t.replace(/^GH-/, '#'));
      continue;
    }
    m = /^(?:refs?|see|related(?: to)?|relates to|issue|pr|ticket)\b[:\s]+(.+)$/i.exec(line);
    if (m) {
      for (const t of m[1].match(ISSUE_TOKEN) || []) refs.push(t.replace(/^GH-/, '#'));
      continue;
    }
    // dòng tự do: số issue, tên nhánh
    const tokens = line.match(ISSUE_TOKEN);
    if (tokens) for (const t of tokens) refs.push(t.replace(/^GH-/, '#'));
    if (!/\s/.test(line) && !tokens) {
      const b =
        /(?:^|\/)(\d{1,6})(?=[-_]|$)/.exec(line) ||
        /(?:issue|gh|pr|bug|ticket)[-_](\d{1,6})(?=[-_/]|$)/i.exec(line);
      if (b && line !== b[1]) refs.push('#' + b[1]);
      else if (/^\d{1,7}$/.test(line)) refs.push('#' + line);
    } else if (!tokens && /^\d{1,7}$/.test(line)) {
      refs.push('#' + line);
    }
  }
  return { refs: uniq(refs).filter((r) => !closes.includes(r)).slice(0, 6), closes: uniq(closes).slice(0, 6) };
}

/* ------------------------------------------------------------------ */
/* Từ điển cụm từ en / vi                                              */
/* ------------------------------------------------------------------ */

const KIND_VI: Record<string, string> = {
  function: 'hàm', class: 'lớp', component: 'component', hook: 'hook', type: 'kiểu', interface: 'interface', enum: 'enum', constant: 'hằng số',
  route: 'route', struct: 'struct', trait: 'trait', module: 'module', style: 'style', method: 'phương thức', page: 'trang', endpoint: 'endpoint',
};
const KIND_EN: Record<string, string> = {
  function: 'function', class: 'class', component: 'component', hook: 'hook', type: 'type', interface: 'interface', enum: 'enum', constant: 'constant',
  route: 'route', struct: 'struct', trait: 'trait', module: 'module', style: 'style', method: 'method', page: 'page', endpoint: 'endpoint',
};
const CAT_LABEL: Record<FileCategory, { en: string; vi: string }> = {
  source: { en: 'Source', vi: 'Mã nguồn' },
  test: { en: 'Tests', vi: 'Kiểm thử' },
  docs: { en: 'Docs', vi: 'Tài liệu' },
  config: { en: 'Config', vi: 'Cấu hình' },
  ci: { en: 'CI', vi: 'CI/CD' },
  build: { en: 'Build', vi: 'Build/phụ thuộc' },
  lockfile: { en: 'Lockfiles', vi: 'Lockfile' },
  migration: { en: 'Migrations', vi: 'Migration' },
  asset: { en: 'Assets', vi: 'Tài nguyên' },
  generated: { en: 'Generated', vi: 'File sinh tự động' },
};
export const CATEGORY_ORDER: FileCategory[] = ['source', 'test', 'docs', 'config', 'build', 'ci', 'migration', 'asset', 'lockfile', 'generated'];
export function categoryLabel(c: FileCategory, lang: Lang = 'vi'): string {
  return CAT_LABEL[c][lang];
}

function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function kindPhrase(L: Lang, kind: SymKind, name: string): string {
  return L === 'vi' ? `${KIND_VI[kind] || kind} ${name}` : `${name} ${KIND_EN[kind] || kind}`;
}

/* ------------------------------------------------------------------ */
/* Scope                                                               */
/* ------------------------------------------------------------------ */

const STRIP_DIRS = new Set(['src', 'lib', 'app', 'source', 'sources', 'packages', 'internal', 'pkg', 'cmd', 'main', 'java', 'kotlin', 'com', 'org', 'io', 'net', 'test', 'tests', '__tests__', 'spec', 'specs', 'docs', 'doc', 'resources', 'e2e']);
const GENERIC_DIRS = new Set(['components', 'utils', 'util', 'helpers', 'handlers', 'hooks', 'types', 'models', 'controllers', 'services', 'common', 'shared', 'core', 'lib', 'scripts', 'public']);
const GENERIC_FILES = new Set(['index', 'main', 'mod', '__init__', 'app', 'page', 'route', 'layout', 'readme', 'utils', 'helpers', 'types', 'config']);
const MONO_RE = /^(packages|apps|libs|services|modules|crates|plugins)\/([^/]+)\//;

function cleanScope(s: string): string {
  return s.replace(/[^\w\-./@]/g, '').replace(/^[-./@]+|[-./@]+$/g, '').slice(0, 30);
}

function testBaseName(name: string): string {
  let n = stripExt(name);
  n = n.replace(/\.(test|spec)$/i, '').replace(/[._-](test|spec|tests)$/i, '').replace(/^test[_-]/i, '').replace(/(Tests?|IT)$/, '');
  return n || stripExt(name);
}

function inferScope(files: FileDiff[], isTestType: boolean): { scope: string; source: Analysis['scopeSource'] } {
  if (!files.length) return { scope: '', source: 'none' };
  const paths = files.map((f) => f.path);
  const mono = paths.map((p) => MONO_RE.exec(p));
  if (mono.every(Boolean)) {
    const names = uniq(mono.map((m) => (m as RegExpExecArray)[2]));
    if (names.length === 1) return { scope: cleanScope(names[0]), source: 'monorepo' };
    return { scope: '', source: 'none' };
  }
  const segs = paths.map((p) => {
    const parts = p.split('/').filter(Boolean);
    const dirs = parts.slice(0, -1);
    let k = 0;
    while (k < dirs.length && STRIP_DIRS.has(dirs[k].toLowerCase())) k++;
    return { dirs: dirs.slice(k), file: parts[parts.length - 1] || '' };
  });
  let common = segs[0].dirs.slice();
  for (const s of segs.slice(1)) {
    let k = 0;
    while (k < common.length && k < s.dirs.length && common[k] === s.dirs[k]) k++;
    common = common.slice(0, k);
  }
  if (common.length) {
    let pick = common[common.length - 1];
    if (GENERIC_DIRS.has(pick.toLowerCase()) && common.length > 1) pick = common[common.length - 2];
    return { scope: cleanScope(pick), source: 'directory' };
  }
  const tops = uniq(segs.map((s) => s.dirs[0] || ''));
  if (tops.length === 1 && tops[0]) return { scope: cleanScope(tops[0]), source: 'directory' };
  if (segs.length === 1) {
    const s = segs[0];
    let name = isTestType ? testBaseName(s.file) : stripExt(s.file);
    if (GENERIC_FILES.has(name.toLowerCase())) {
      const d = s.dirs[s.dirs.length - 1];
      name = d || '';
    }
    if (!name || GENERIC_FILES.has(name.toLowerCase())) return { scope: '', source: 'none' };
    return { scope: cleanScope(name), source: 'file' };
  }
  return { scope: '', source: 'none' };
}

/* ------------------------------------------------------------------ */
/* Wrap text                                                           */
/* ------------------------------------------------------------------ */

function wrap(text: string, width = 72, indent = ''): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if ((line + ' ' + w).length <= width) line += ' ' + w;
    else { out.push(line); line = indent + w; }
  }
  if (line) out.push(line);
  return out;
}

function shortList(items: string[], max: number, L: Lang): string {
  if (items.length <= max) return items.join(', ');
  const rest = items.length - max;
  return `${items.slice(0, max).join(', ')} ${L === 'vi' ? `và ${rest} mục khác` : `and ${rest} more`}`;
}

/* ------------------------------------------------------------------ */
/* Phân tích chính                                                     */
/* ------------------------------------------------------------------ */

const FIX_WORDS = /\b(fix(?:es|ed)?|bug(?:s|fix)?|crash(?:es)?|regression|hotfix|workaround|off[- ]by[- ]one|incorrect(?:ly)?|broken|race condition|null pointer|npe|memory leak|overflow)\b/i;
const PERF_COMMENT = /\b(perf(?:ormance)?|optimi[sz]e[ds]?|optimi[sz]ation|faster|speed[- ]?up|cach(?:e|ed|ing)|memoi[sz](?:e|ed|ation)|lazy|debounce|throttle|batch(?:ing)?|O\((?:n|1|log))/i;
const PERF_COMMENT_G = new RegExp(PERF_COMMENT.source, 'gi');
const PERF_CODE = /\b(useMemo|useCallback|React\.memo|lru_cache|functools\.cache|Promise\.all|CREATE\s+(?:UNIQUE\s+)?INDEX|sync\.Pool|WeakMap|requestIdleCallback)\b/;
const GUARD_RE = /(?:\b(?:if|unless|while)\b.*(?:===?|!==?|!=|==)\s*(?:null|undefined|nil|None|nullptr)\b|\bis\s+(?:not\s+)?None\b|\?\?|\?\.[A-Za-z_$[(]|\bif\s*\(\s*!\s*[\w.$]+\s*\)|\bif\s+err\s*!=\s*nil|Objects\.requireNonNull|\.isEmpty\(\)|\bguard\s+let\b|\bif\s+not\s+\w)/;
const TRY_RE = /\b(?:try\s*\{|try:|catch\s*\(|\bexcept\b|\brescue\b)/;
const CMP_RE = /<=|>=|<|>/g;

function offByOne(hunks: HunkInfo[]): number {
  let n = 0;
  const normalize = (s: string) => s.replace(/\s+/g, '').replace(CMP_RE, 'OP').replace(/[+-]1(?!\d)/g, 'PM1');
  for (const h of hunks) {
    if (!h.removed.length || !h.added.length || h.removed.length > 200 || h.added.length > 200) continue;
    const rm = new Map<string, string>();
    for (const r of h.removed) if (r.length < MAX_MATCH_LINE) rm.set(normalize(r), r.replace(/\s+/g, ''));
    for (const a of h.added) {
      if (a.length >= MAX_MATCH_LINE) continue;
      const key = normalize(a);
      const orig = rm.get(key);
      if (orig !== undefined && orig !== a.replace(/\s+/g, '') && (/<=|>=|<|>|[+-]\s*1\b/.test(a))) n++;
    }
  }
  return n;
}

function scopeFor<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

interface TypeInfo { type: CommitType; confidence: number; reasons: string[] }

export function analyzeDiff(input: string, opts: AnalyzeOptions = {}): Analysis {
  const style: CommitStyle = opts.style || 'conventional';
  const L: Lang = opts.language === 'vi' ? 'vi' : 'en';
  const t = (en: string, vi: string) => (L === 'vi' ? vi : en);
  const parsed = parseDiff(typeof input === 'string' ? input : '');
  const issuesIn = inferIssues(opts.issue || '');
  const empty: Analysis = {
    ok: false, parsed, type: 'chore', confidence: 0, reasons: [], scope: '', scopeSource: 'none', breaking: false, breakingReasons: [],
    subject: '', body: '', footers: [], commitMessage: '', prTitle: '', prDescription: '', deps: [], symbols: [], risks: [], findings: [],
    issues: issuesIn, categoryStats: [],
  };
  if (!parsed.files.length) {
    return { ...empty, error: input && input.trim() ? 'Không nhận ra unified diff nào (cần dòng "diff --git", "--- / +++" hoặc "@@").' : 'Chưa có diff để phân tích.' };
  }

  const files = parsed.files;
  const byCat = (c: FileCategory) => files.filter((f) => f.category === c);
  const churn = (f: FileDiff) => f.added + f.removed;
  const sum = (arr: FileDiff[]) => arr.reduce((s, f) => s + churn(f), 0);
  const totalChurn = parsed.totalAdded + parsed.totalRemoved;

  const categoryStats = CATEGORY_ORDER.map((category) => {
    const fs = byCat(category);
    return { category, files: fs.length, added: fs.reduce((s, f) => s + f.added, 0), removed: fs.reduce((s, f) => s + f.removed, 0) };
  }).filter((c) => c.files > 0);

  const reasons: string[] = [];

  /* ---------- symbol / route / tests ---------- */
  const addedSyms: Sym[] = [];
  const removedSyms: Sym[] = [];
  const addedTests: string[] = [];
  const removedTests: string[] = [];
  const headings: string[] = [];
  const contexts: string[] = [];
  for (const f of files) {
    if (f.binary || f.category === 'lockfile' || f.category === 'generated') continue;
    const fam = familyOf(f.language);
    const isCode = f.category === 'source' || f.category === 'test' || f.category === 'migration';
    if (isCode) {
      let nA = 0;
      for (const l of f.addedLines) {
        if (nA >= 300) break;
        const s = declOfLine(fam, f.language, l.text, f.path, l.no) || routeOfLine(f.language, l.text, f.path, l.no);
        if (s) { addedSyms.push(s); nA++; }
        if (f.category === 'test') {
          const tt = testTitleOfLine(l.text);
          if (tt) addedTests.push(tt);
        } else if (f.category === 'source') {
          const rt = routeOfLine(f.language, l.text, f.path, l.no);
          if (rt && !s) { addedSyms.push(rt); nA++; }
        }
      }
      let nR = 0;
      for (const l of f.removedLines) {
        if (nR >= 300) break;
        const s = declOfLine(fam, f.language, l.text, f.path, l.no) || routeOfLine(f.language, l.text, f.path, l.no);
        if (s) { removedSyms.push(s); nR++; }
        if (f.category === 'test') {
          const tt = testTitleOfLine(l.text);
          if (tt) removedTests.push(tt);
        }
      }
      for (const h of f.hunks) {
        if (!h.context) continue;
        const s = declOfLine(fam, f.language, h.context, f.path, 0);
        if (s && !GENERIC_NAMES.has(s.name.toLowerCase())) contexts.push(s.name);
      }
    }
    if (f.category === 'docs') {
      for (const l of f.addedLines) {
        const hm = /^#{1,6}\s+(.{2,60}?)\s*#*\s*$/.exec(l.text);
        if (hm) headings.push(hm[1]);
      }
      for (const h of f.hunks) {
        const hm = /^#{1,6}\s+(.{2,60}?)\s*#*\s*$/.exec(h.context);
        if (hm) headings.push(hm[1]);
      }
    }
  }
  const removedNames = new Set(removedSyms.map((s) => s.name));
  const addedNames = new Set(addedSyms.map((s) => s.name));
  const nonTestSrcFiles = files.filter((f) => f.category === 'source' || f.category === 'migration');
  const newSyms = uniq(
    addedSyms
      .filter((s) => !removedNames.has(s.name) && !GENERIC_NAMES.has(s.name.toLowerCase()) && s.kind !== 'method' && s.kind !== 'style' && nonTestSrcFiles.some((f) => f.path === s.file))
      .sort((a, b) => Number(b.exported) - Number(a.exported))
      .map((s) => s.name),
  ).map((n) => addedSyms.find((s) => s.name === n) as Sym);
  const newRoutes = addedSyms.filter((s) => s.kind === 'route' && !removedNames.has(s.name));

  /* ---------- deps ---------- */
  const deps: DepChange[] = [];
  let ownVersion: { from?: string; to?: string } | undefined;
  let manifestDepLines = 0;
  let manifestOtherLines = 0;
  let manifestOwnLines = 0;
  const manifestKeys: string[] = [];
  for (const f of files) {
    if (f.category !== 'build') continue;
    const base = basename(f.path).toLowerCase();
    if (parseDepCapable(base)) {
      const m = analyzeManifest(f);
      deps.push(...m.deps);
      manifestDepLines += m.depLines;
      manifestOtherLines += m.otherLines;
      manifestOwnLines += m.ownLines;
      manifestKeys.push(...m.touchedKeys);
      if (m.ownVersion) ownVersion = m.ownVersion;
    } else {
      manifestOtherLines += f.added + f.removed;
    }
  }

  /* ---------- style ---------- */
  const styleCandidates = files.filter((f) => !f.binary && f.category !== 'generated' && f.category !== 'lockfile');
  const styleKinds = styleCandidates.map(styleKind);
  const allStyle = styleCandidates.length > 0 && styleKinds.every((k) => k !== null) && totalChurn > 0;
  const styleType: 'whitespace' | 'format' = styleKinds.includes('format') ? 'format' : 'whitespace';

  /* ---------- preamble / issue hints ---------- */
  const hintText = `${parsed.preamble}\n${opts.issue || ''}`;
  const revertMatch = /^\s*(?:Subject:\s*(?:\[PATCH[^\]]*\]\s*)?)?Revert\s+"([^"\n]{3,120})"/im.exec(parsed.preamble) || /^\s*(?:Subject:\s*(?:\[PATCH[^\]]*\]\s*)?)?Revert\s+"([^"\n]{3,120})"/im.exec(opts.issue || '');
  const isRevert = !!revertMatch || /this reverts commit/i.test(hintText);
  const branchHint = (() => {
    const m = /(?:^|[\s/])(fix|bugfix|hotfix|feat|feature|refactor|perf|docs?|chore|test|style|ci|build)[/_-]/i.exec(opts.issue || '');
    return m ? m[1].toLowerCase() : '';
  })();

  /* ---------- type ---------- */
  let ti: TypeInfo;
  const code = files.filter((f) => f.category === 'source' || f.category === 'migration');
  const nonNoise = files.filter((f) => f.category !== 'lockfile' && f.category !== 'generated');
  const catsNonNoise = uniq(nonNoise.map((f) => f.category));

  // các scores cho phân loại code (dùng cả khi chỉ để hiển thị lý do)
  let featScore = 0, fixScore = 0, perfScore = 0, refactorScore = 0;
  const featWhy: string[] = [], fixWhy: string[] = [], perfWhy: string[] = [], refWhy: string[] = [];
  let guardHits = 0, tryHits = 0, fixWordHits = 0, perfHits = 0, perfCodeHits = 0;
  const perfKeywords: string[] = [];
  let off1 = 0;
  {
    const aSrc = code.filter((f) => f.status === 'A' && !f.binary);
    const withDecl = aSrc.filter((f) => addedSyms.some((s) => s.file === f.path));
    if (withDecl.length) { featScore += 4 * Math.min(2, withDecl.length); featWhy.push(t(`${withDecl.length} file mới có khai báo mới`, `${withDecl.length} file mới có khai báo hàm/lớp/component mới`)); }
    else if (aSrc.length) { featScore += 2; featWhy.push(`${aSrc.length} file mã nguồn mới`); }
    const expNew = newSyms.filter((s) => s.exported && code.some((f) => f.path === s.file && f.status !== 'A'));
    if (expNew.length) { featScore += Math.min(expNew.length, 4) * 1.5; featWhy.push(`thêm symbol public mới: ${scopeFor(expNew, 3).map((s) => s.name).join(', ')}`); }
    if (newRoutes.length) { featScore += 3; featWhy.push(`thêm route: ${newRoutes[0].name}`); }
    if (code.some((f) => f.category === 'migration' && f.status === 'A')) { featScore += 2; featWhy.push('thêm migration mới'); }
    if (/^(feat|feature)$/.test(branchHint)) { featScore += 2; featWhy.push('tên nhánh gợi ý feat'); }

    for (const f of code) {
      if (f.status === 'A' || f.binary) continue;
      let g = 0;
      for (const l of f.addedLines) {
        if (l.text.length > MAX_MATCH_LINE) continue;
        const comment = isCommentLine(l.text);
        if (comment) {
          if (FIX_WORDS.test(l.text)) fixWordHits++;
          if (PERF_COMMENT.test(l.text)) { perfHits++; for (const pm of l.text.matchAll(PERF_COMMENT_G)) perfKeywords.push(pm[1].toLowerCase()); }
        } else {
          if (g < 3 && GUARD_RE.test(l.text)) g++;
          if (TRY_RE.test(l.text)) tryHits++;
          if (PERF_CODE.test(l.text)) { perfCodeHits++; const pm = PERF_CODE.exec(l.text); if (pm) perfKeywords.push(pm[1].toLowerCase()); }
        }
      }
      guardHits += g;
      off1 += offByOne(f.hunks);
    }
    guardHits = Math.min(guardHits, 3);
    if (guardHits) { fixScore += guardHits; fixWhy.push(t(`thêm ${guardHits} điều kiện/kiểm tra null`, `thêm điều kiện/kiểm tra null (${guardHits})`)); }
    if (off1) { fixScore += 3; fixWhy.push('mẫu sửa lỗi lệch chỉ số (off-by-one) / đổi toán tử so sánh'); }
    if (fixWordHits) { fixScore += 3; fixWhy.push('chú thích mới nhắc tới fix/bug'); }
    if (tryHits) { fixScore += 1; fixWhy.push('thêm xử lý lỗi (try/catch)'); }
    if (/^(fix|bugfix|hotfix)$/.test(branchHint) || /(^|[\s/_-])(fix|bug|hotfix)(es|ed)?[\s/_-]/i.test(parsed.preamble + ' ')) { fixScore += 3; fixWhy.push('nhánh/tiêu đề gợi ý sửa lỗi'); }

    perfScore = Math.min(4, perfHits * 2) + Math.min(3, perfCodeHits);
    if (perfScore) perfWhy.push(`từ khoá hiệu năng: ${uniq(perfKeywords).slice(0, 3).join(', ')}`);
    if (/^perf$/.test(branchHint)) { perfScore += 2; perfWhy.push('tên nhánh gợi ý perf'); }

    // refactor: đổi tên/di chuyển, code chuyển chỗ
    const renamed = code.filter((f) => f.status === 'R' || (f.status === 'C'));
    if (renamed.length && renamed.length === code.length) { refactorScore += 6; refWhy.push('chỉ đổi tên/di chuyển file'); }
    else if (renamed.length) { refactorScore += 2; refWhy.push(`${renamed.length} file đổi tên/di chuyển`); }
    const remSet = new Set<string>();
    for (const f of code) for (const l of f.removedLines) { const s = l.text.trim(); if (s.length >= 12) remSet.add(s); }
    if (remSet.size >= 6) {
      let moved = 0, addCnt = 0;
      for (const f of code) for (const l of f.addedLines) { const s = l.text.trim(); if (s.length >= 12) { addCnt++; if (remSet.has(s)) moved++; } }
      if (addCnt && moved / addCnt >= 0.6 && moved >= 5) { refactorScore += 4; refWhy.push('phần lớn dòng thêm vào là code được chuyển chỗ'); }
    }
    const cA = sum(code) ? code.reduce((s, f) => s + f.added, 0) : 0;
    const cR = code.reduce((s, f) => s + f.removed, 0);
    if (cA && cR && cA / cR >= 0.5 && cA / cR <= 2 && !newSyms.length && !fixScore) { refactorScore += 2; refWhy.push('số dòng thêm/xóa cân bằng, không có symbol mới'); }
    if (code.length && code.every((f) => f.status === 'D')) { refactorScore += 4; refWhy.push('xóa file mã nguồn'); }
    if (/^refactor$/.test(branchHint)) { refactorScore += 2; refWhy.push('tên nhánh gợi ý refactor'); }
  }

  if (isRevert) {
    ti = { type: 'revert', confidence: 0.9, reasons: ['phát hiện "Revert" / "This reverts commit" trong phần mô tả'] };
  } else if (files.every((f) => !f.binary && !f.added && !f.removed && f.modeChange && f.status === 'M')) {
    ti = { type: 'chore', confidence: 0.8, reasons: ['chỉ đổi quyền file (mode), không đổi nội dung'] };
  } else if (allStyle) {
    ti = {
      type: 'style',
      confidence: styleType === 'whitespace' ? 0.9 : 0.72,
      reasons: [styleType === 'whitespace' ? 'mọi thay đổi chỉ khác nhau về khoảng trắng (đã so sánh sau khi chuẩn hoá whitespace)' : 'mọi thay đổi chỉ khác dấu nháy/dấu phẩy/chấm phẩy/khoảng trắng (format lại code)'],
    };
  } else if (catsNonNoise.length === 0) {
    const isLock = files.every((f) => f.category === 'lockfile');
    ti = { type: isLock ? 'chore' : 'build', confidence: 0.6, reasons: [isLock ? 'chỉ có lockfile thay đổi' : 'chỉ có file sinh tự động thay đổi'] };
  } else if (catsNonNoise.every((c) => c === 'docs')) {
    ti = { type: 'docs', confidence: 0.95, reasons: ['tất cả file thay đổi đều là tài liệu (md/rst/txt/docs)'] };
  } else if (catsNonNoise.every((c) => c === 'test')) {
    ti = { type: 'test', confidence: 0.92, reasons: ['tất cả file thay đổi đều là test'] };
  } else if (catsNonNoise.every((c) => c === 'ci')) {
    ti = { type: 'ci', confidence: 0.92, reasons: ['chỉ đổi file CI/workflow'] };
  } else if (catsNonNoise.every((c) => c === 'docs' || c === 'test')) {
    const d = sum(byCat('docs')), te = sum(byCat('test'));
    ti = { type: d >= te ? 'docs' : 'test', confidence: 0.6, reasons: ['chỉ có tài liệu và test; chọn nhóm có nhiều thay đổi hơn'] };
  } else if (catsNonNoise.every((c) => c === 'build')) {
    if (deps.length && manifestDepLines >= manifestOtherLines) ti = { type: 'build', confidence: 0.9, reasons: [`chỉ đổi phiên bản dependency (${deps.length} gói)`] };
    else if (ownVersion && manifestDepLines === 0 && manifestOtherLines === 0) ti = { type: 'chore', confidence: 0.85, reasons: ['chỉ đổi số phiên bản của chính dự án'] };
    else ti = { type: 'build', confidence: 0.85, reasons: ['chỉ đổi file build/đóng gói (package.json, Dockerfile, Makefile...)'] };
  } else if (catsNonNoise.every((c) => c === 'build' || c === 'config' || c === 'ci')) {
    const b = sum(byCat('build')), c = sum(byCat('config')), ci = sum(byCat('ci'));
    if (ci >= b && ci >= c) ti = { type: 'ci', confidence: 0.7, reasons: ['chủ yếu đổi CI kèm cấu hình'] };
    else if (b >= c) ti = { type: 'build', confidence: 0.7, reasons: ['chủ yếu đổi build kèm cấu hình'] };
    else ti = { type: 'chore', confidence: 0.7, reasons: ['chủ yếu đổi file cấu hình'] };
  } else if (catsNonNoise.every((c) => c === 'config')) {
    ti = { type: 'chore', confidence: 0.75, reasons: ['chỉ đổi file cấu hình'] };
  } else if (catsNonNoise.every((c) => c === 'asset')) {
    ti = { type: 'chore', confidence: 0.7, reasons: ['chỉ đổi tài nguyên (ảnh/font/media)'] };
  } else if (!code.length) {
    // asset/config/docs/test/ci lẫn lộn, không có source
    const order: [CommitType, number][] = [
      ['ci', sum(byCat('ci'))], ['build', sum(byCat('build'))], ['chore', sum(byCat('config')) + sum(byCat('asset'))],
      ['docs', sum(byCat('docs'))], ['test', sum(byCat('test'))],
    ];
    order.sort((a, b) => b[1] - a[1]);
    ti = { type: order[0][0], confidence: 0.5, reasons: ['nhiều nhóm file không phải mã nguồn; chọn nhóm có nhiều thay đổi nhất'] };
  } else {
    const sc: [CommitType, number, string[]][] = [
      ['fix', fixScore, fixWhy], ['feat', featScore, featWhy], ['perf', perfScore, perfWhy], ['refactor', refactorScore, refWhy],
    ];
    sc.sort((a, b) => b[1] - a[1]);
    const [best, second] = sc;
    if (best[1] > 0) {
      const margin = best[1] - second[1];
      ti = { type: best[0], confidence: Math.max(0.35, Math.min(0.92, 0.42 + 0.05 * best[1] + 0.05 * margin)), reasons: best[2].slice() };
    } else {
      const a = code.reduce((s, f) => s + f.added, 0);
      const r = code.reduce((s, f) => s + f.removed, 0);
      if (a > 2 * r) ti = { type: 'feat', confidence: 0.35, reasons: ['chủ yếu thêm dòng mới, không thấy mẫu sửa lỗi rõ ràng'] };
      else ti = { type: 'refactor', confidence: 0.3, reasons: ['sửa đổi mã nguồn không có tín hiệu feat/fix rõ ràng; coi là refactor'] };
    }
  }
  reasons.push(...ti.reasons);
  const type = ti.type;
  if (code.length && !['feat', 'fix', 'perf', 'refactor'].includes(type)) { /* nothing */ }
  if (['feat', 'fix', 'perf', 'refactor'].includes(type) && (byCat('test').length)) reasons.push(`có kèm ${byCat('test').length} file test`);
  if (type === 'fix' && fixScore === 0) reasons.push('(không có bằng chứng rõ ràng)');

  /* ---------- scope ---------- */
  let scope = '';
  let scopeSource: Analysis['scopeSource'] = 'none';
  const override = cleanScope(opts.scope || '');
  if (override) { scope = override; scopeSource = 'override'; }
  else if (type === 'build' && deps.length && manifestDepLines >= manifestOtherLines) { scope = 'deps'; scopeSource = 'deps'; }
  else if (type === 'chore' && ownVersion && catsNonNoise.every((c) => c === 'build')) { scope = 'release'; scopeSource = 'deps'; }
  else if (type === 'ci') {
    const ciFiles = byCat('ci');
    if (ciFiles.length === 1) {
      const n = stripExt(basename(ciFiles[0].path));
      if (!/^(ci|main|workflow|build|test|tests|\.gitlab-ci|jenkinsfile)$/i.test(n) && !n.startsWith('.')) { scope = cleanScope(n); scopeSource = 'file'; }
    }
  } else {
    let pool: FileDiff[];
    if (type === 'test') pool = byCat('test');
    else if (type === 'docs') pool = byCat('docs');
    else if (type === 'style') pool = styleCandidates;
    else if (type === 'chore' || type === 'build') pool = nonNoise.filter((f) => f.category !== 'docs');
    else pool = nonNoise.filter((f) => f.category !== 'test' && f.category !== 'docs' && f.category !== 'asset');
    if (!pool.length) pool = nonNoise;
    if (type === 'build' || (type === 'chore' && pool.every((f) => f.category === 'config' || f.category === 'build' || f.category === 'asset'))) {
      // build/config ở thư mục gốc không cần scope
      const sc = inferScope(pool.filter((f) => f.path.includes('/')), false);
      if (pool.every((f) => f.path.includes('/'))) { scope = sc.scope; scopeSource = sc.source; }
    } else {
      const sc = inferScope(pool, type === 'test');
      scope = sc.scope; scopeSource = sc.source;
    }
  }
  if (type === 'revert' && !override) {
    const m = revertMatch ? /^\w+\(([^)]+)\)!?:/.exec(revertMatch[1]) : null;
    scope = m ? cleanScope(m[1]) : '';
    scopeSource = scope ? 'file' : 'none';
  }

  /* ---------- BREAKING ---------- */
  const breakingReasons: string[] = [];
  const breakAllowed = !['docs', 'test', 'style', 'ci', 'revert'].includes(type);
  if (breakAllowed) {
    const exportedRemoved = removedSyms.filter((s) => s.exported && s.kind !== 'method' && s.kind !== 'style' && s.kind !== 'route' && nonTestSrcFiles.some((f) => f.path === s.file));
    const addedByName = new Map<string, Sym>();
    for (const s of addedSyms) if (s.exported) addedByName.set(s.name, s);
    const seen = new Set<string>();
    for (const s of exportedRemoved) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      const a = addedByName.get(s.name);
      if (!a) {
        const fileGone = files.find((f) => f.path === s.file && f.status === 'D');
        breakingReasons.push(fileGone ? `removed ${s.name} (file ${basename(s.file)} deleted)` : `removed export ${s.name} from ${s.file}`);
      } else if (s.params !== undefined && a.params !== undefined && s.params.replace(/\s+/g, '') !== a.params.replace(/\s+/g, '')) {
        breakingReasons.push(`changed signature of ${s.name} in ${s.file}`);
      }
      if (breakingReasons.length >= 5) break;
    }
    const removedRoutes = removedSyms.filter((s) => s.kind === 'route' && !addedNames.has(s.name));
    for (const r of removedRoutes.slice(0, 2)) breakingReasons.push(`removed route ${r.name}`);
    for (const f of files) {
      if (f.status === 'D' && f.category === 'source' && /(^|\/)(api|routes)\/.+|(^|\/)route\.(ts|js)$/.test(f.path) && !breakingReasons.some((r) => r.includes(f.path))) {
        breakingReasons.push(`removed route file ${f.path}`);
      }
    }
    for (const f of files) {
      if (f.category !== 'config' || !/config|settings|\.env/i.test(basename(f.path)) || f.status === 'D') continue;
      const isJson = f.language === 'JSON';
      const keyOf = (txt: string) => {
        const m = isJson ? /^ {0,2}"([\w.-]+)"\s*:/.exec(txt) : /^([A-Za-z_][\w.-]*)\s*[:=]/.exec(txt);
        return m ? m[1] : null;
      };
      const addedKeys = new Set(f.addedLines.map((l) => keyOf(l.text)).filter(Boolean));
      const gone = f.removedLines.map((l) => keyOf(l.text)).filter((k): k is string => !!k && !addedKeys.has(k));
      if (gone.length) breakingReasons.push(`removed config key ${gone[0]}${gone.length > 1 ? ` (+${gone.length - 1})` : ''} in ${basename(f.path)}`);
    }
    if (ownVersion && ownVersion.from && ownVersion.to) {
      const fm = majorOf(ownVersion.from), tm = majorOf(ownVersion.to);
      if (fm !== null && tm !== null && tm > fm && fm >= 1) breakingReasons.push(`major version bump ${ownVersion.from} -> ${ownVersion.to}`);
    }
    for (const f of files) {
      if (f.category === 'docs' || f.category === 'lockfile' || f.category === 'generated') continue;
      if (f.addedLines.some((l) => /\bBREAKING[ -]CHANGE\b/.test(l.text))) { breakingReasons.push(`BREAKING CHANGE noted in ${basename(f.path)}`); break; }
    }
    if (/\bBREAKING[ -]CHANGE\b/.test(hintText)) breakingReasons.push('BREAKING CHANGE noted in commit description');
  }
  const breaking = breakingReasons.length > 0;

  /* ---------- subject ---------- */
  const mainFiles = (() => {
    if (type === 'test') return byCat('test');
    if (type === 'docs') return byCat('docs');
    if (type === 'ci') return byCat('ci');
    const p = nonNoise.filter((f) => f.category !== 'test' && f.category !== 'docs');
    return p.length ? p : nonNoise.length ? nonNoise : files;
  })();
  const bigFile = [...mainFiles].sort((a, b) => churn(b) - churn(a))[0] || files[0];
  const fileLabel = (f: FileDiff) => {
    const b = basename(f.path);
    const n = stripExt(b);
    if (['index', 'page', 'route', 'main', 'mod', 'layout', '__init__'].includes(n.toLowerCase())) {
      const d = basename(dirname(f.path));
      return d || b;
    }
    return type === 'test' ? testBaseName(b) : n;
  };
  const targetNames = uniq(contexts).slice(0, 2);
  const target = targetNames.length ? targetNames.join(' / ') : fileLabel(bigFile);
  const targetScoped = scope && scope.toLowerCase() === target.toLowerCase() ? target : target;

  const cands: string[] = [];
  const pushC = (...c: (string | undefined | false)[]) => { for (const x of c) if (x) cands.push(x); };

  switch (type) {
    case 'revert': {
      const inner = revertMatch ? revertMatch[1].replace(/^\w+(?:\([^)]*\))?!?:\s*/, '') : '';
      pushC(inner && `revert ${inner}`, inner && inner, t('revert previous change', 'hoàn tác thay đổi trước đó'));
      if (inner) { cands.length = 0; pushC(inner, t('revert previous change', 'hoàn tác thay đổi trước đó')); }
      break;
    }
    case 'style': {
      const tgt = files.length === 1 ? basename(files[0].path) : t(`${files.length} files`, `${files.length} file`);
      if (styleType === 'whitespace') pushC(t(`fix whitespace in ${tgt}`, `chuẩn hoá khoảng trắng trong ${tgt}`), t('fix whitespace', 'chuẩn hoá khoảng trắng'));
      else pushC(t(`reformat ${tgt}`, `định dạng lại ${tgt}`), t('reformat code', 'định dạng lại code'));
      break;
    }
    case 'docs': {
      const dfs = byCat('docs');
      const verb = dfs.every((f) => f.status === 'A') ? t('add', 'thêm') : dfs.every((f) => f.status === 'D') ? t('remove', 'xóa') : t('update', 'cập nhật');
      const label = (f: FileDiff) => {
        const b = stripExt(basename(f.path));
        return /^(readme|changelog|contributing|license|authors|security|code_of_conduct)$/i.test(b) ? b.toUpperCase() === 'README' ? 'README' : b.toUpperCase().replace(/_/g, '_') : b;
      };
      if (dfs.length === 1) {
        const l = label(dfs[0]);
        const isStd = /^(README|CHANGELOG|CONTRIBUTING|LICENSE|AUTHORS|SECURITY|CODE_OF_CONDUCT)$/.test(l);
        const hs = uniq(headings.map((h) => h.toLowerCase()));
        if (hs.length === 1 && verb !== t('remove', 'xóa')) pushC(t(`${verb} ${l} ${hs[0]} section`, `${verb} ${l} mục ${hs[0]}`));
        if (hs.length === 2) pushC(t(`${verb} ${l}: ${hs.join(' and ')}`, `${verb} ${l}: ${hs.join(' và ')}`));
        pushC(isStd ? `${verb} ${l}` : t(`${verb} ${l} docs`, `${verb} tài liệu ${l}`));
      } else {
        const names = uniq(dfs.map(label));
        pushC(t(`${verb} ${shortList(names, 3, L).replace(/, ([^,]*)$/, ' and $1')}`, `${verb} ${shortList(names, 3, L)}`), t(`${verb} documentation`, `${verb} tài liệu`));
      }
      break;
    }
    case 'test': {
      const tfs = byCat('test');
      const allDel = tfs.every((f) => f.status === 'D');
      const titles = uniq(addedTests.map(humanizeTestTitle).filter(Boolean));
      if (allDel) pushC(t(`remove obsolete tests for ${target}`, `xóa test lỗi thời của ${target}`), t('remove obsolete tests', 'xóa test lỗi thời'));
      else if (tfs.every((f) => f.status === 'A') || (addedTests.length > removedTests.length && addedTests.length > 0)) {
        if (titles.length === 1) pushC(t(`add cases for ${titles[0]}`, `thêm test cho ${titles[0]}`));
        if (titles.length === 2) pushC(t(`add cases for ${titles[0]} and ${titles[1]}`, `thêm test cho ${titles[0]} và ${titles[1]}`));
        if (addedTests.length > 1) pushC(t(`add ${addedTests.length} test cases for ${target}`, `thêm ${addedTests.length} test case cho ${target}`));
        pushC(t(`add tests for ${target}`, `thêm test cho ${target}`), t('add tests', 'thêm test'));
      } else pushC(t(`update tests for ${target}`, `cập nhật test cho ${target}`), t('update tests', 'cập nhật test'));
      break;
    }
    case 'ci': {
      const cfs = byCat('ci');
      const verb = cfs.every((f) => f.status === 'A') ? t('add', 'thêm') : cfs.every((f) => f.status === 'D') ? t('remove', 'xóa') : t('update', 'cập nhật');
      if (cfs.length === 1) {
        const n = stripExt(basename(cfs[0].path));
        const wf = /\.github\/workflows\//.test(cfs[0].path);
        pushC(wf ? t(`${verb} ${n} workflow`, `${verb} workflow ${n}`) : t(`${verb} ${basename(cfs[0].path)}`, `${verb} ${basename(cfs[0].path)}`));
      }
      pushC(t(`${verb} CI configuration`, `${verb} cấu hình CI`), t(`${verb} CI`, `${verb} CI`));
      break;
    }
    case 'build': {
      if (deps.length && manifestDepLines >= manifestOtherLines) {
        const bumps = deps.filter((d) => d.kind === 'bump'), adds = deps.filter((d) => d.kind === 'add'), rems = deps.filter((d) => d.kind === 'remove');
        const nm = (d: DepChange) => d.name;
        if (deps.length === 1) {
          const d = deps[0];
          if (d.kind === 'bump') {
            if (d.from && d.to) pushC(t(`bump ${d.name} from ${d.from} to ${d.to}`, `nâng cấp ${d.name} từ ${d.from} lên ${d.to}`));
            if (d.to) pushC(t(`bump ${d.name} to ${d.to}`, `nâng cấp ${d.name} lên ${d.to}`));
            pushC(t(`bump ${d.name}`, `nâng cấp ${d.name}`));
          } else if (d.kind === 'add') pushC(t(`add ${d.name}${d.to ? ` ${d.to}` : ''}`, `thêm ${d.name}${d.to ? ` ${d.to}` : ''}`), t(`add ${d.name}`, `thêm ${d.name}`));
          else pushC(t(`remove ${d.name}`, `gỡ ${d.name}`));
        } else {
          const verb = bumps.length === deps.length ? t('bump', 'nâng cấp') : adds.length === deps.length ? t('add', 'thêm') : rems.length === deps.length ? t('remove', 'gỡ') : t('update', 'cập nhật');
          const names = deps.map(nm);
          const join = (arr: string[]) => (L === 'vi' ? arr.join(', ').replace(/, ([^,]*)$/, ' và $1') : arr.join(', ').replace(/, ([^,]*)$/, ' and $1'));
          if (names.length <= 3) pushC(`${verb} ${join(names)}`);
          if (names.length > 3) pushC(t(`${verb} ${names.slice(0, 2).join(', ')} and ${names.length - 2} more dependencies`, `${verb} ${names.slice(0, 2).join(', ')} và ${names.length - 2} dependency khác`));
          pushC(t(`${verb} ${names.length} dependencies`, `${verb} ${names.length} dependency`), t('update dependencies', 'cập nhật dependency'));
        }
      } else {
        const bfs = byCat('build').filter((f) => f.category === 'build');
        const names = uniq(bfs.map((f) => basename(f.path)));
        const scriptKeys = manifestKeys.some((k) => /^(build|dev|start|test|lint|prepare|postinstall|scripts?|[a-z]+:[a-z]+)$/i.test(k));
        if (names.length === 1 && names[0] === 'package.json' && scriptKeys) pushC(t('update package.json scripts', 'cập nhật scripts trong package.json'));
        if (names.length <= 2) pushC(t(`update ${names.join(' and ')}`, `cập nhật ${names.join(' và ')}`));
        pushC(t('update build configuration', 'cập nhật cấu hình build'));
      }
      break;
    }
    case 'chore': {
      if (files.every((f) => !f.binary && !f.added && !f.removed && f.modeChange)) {
        pushC(files.length === 1 ? t(`change mode of ${basename(files[0].path)}`, `đổi quyền file ${basename(files[0].path)}`) : t(`change file modes (${files.length} files)`, `đổi quyền ${files.length} file`));
      } else if (ownVersion && ownVersion.to && catsNonNoise.every((c) => c === 'build')) {
        pushC(t(`bump version to ${cleanVer(ownVersion.to)}`, `nâng phiên bản lên ${cleanVer(ownVersion.to)}`));
      } else if (files.every((f) => f.category === 'lockfile')) {
        pushC(t('update lockfile', 'cập nhật lockfile'));
      } else if (catsNonNoise.every((c) => c === 'asset')) {
        const afs = byCat('asset');
        const verb = afs.every((f) => f.status === 'A') ? t('add', 'thêm') : afs.every((f) => f.status === 'D') ? t('remove', 'xóa') : t('update', 'cập nhật');
        const names = afs.map((f) => basename(f.path));
        if (names.length <= 2) pushC(`${verb} ${names.join(t(' and ', ' và '))}`);
        pushC(t(`${verb} ${names.length} assets`, `${verb} ${names.length} tài nguyên`));
      } else {
        const names = uniq(nonNoise.map((f) => basename(f.path)));
        const verb = nonNoise.every((f) => f.status === 'A') ? t('add', 'thêm') : nonNoise.every((f) => f.status === 'D') ? t('remove', 'xóa') : t('update', 'cập nhật');
        if (names.length <= 2) pushC(`${verb} ${names.join(t(' and ', ' và '))}`);
        pushC(t(`${verb} ${names.length} config files`, `${verb} ${names.length} file cấu hình`), t(`${verb} configuration`, `${verb} cấu hình`));
      }
      break;
    }
    case 'feat': {
      const srcNew = code.filter((f) => f.status === 'A');
      const migration = srcNew.find((f) => f.category === 'migration');
      const fileKind = (f: FileDiff): SymKind | null => {
        const p = f.path.toLowerCase();
        if (/(^|\/)app\/.*\/route\.(ts|js)$/.test(p) || /(^|\/)(pages\/)?api\//.test(p) || /(^|\/)routes?\//.test(p)) return 'endpoint';
        if (/(^|\/)page\.(tsx|jsx|ts|js)$/.test(p) || /(^|\/)pages\//.test(p)) return 'page';
        return null;
      };
      const fileNoun = (f: FileDiff) => {
        let n = stripExt(basename(f.path));
        if (['route', 'page', 'index'].includes(n.toLowerCase())) n = basename(dirname(f.path)) || n;
        return /^[A-Z]/.test(n) ? n : kebab(n);
      };
      const topSyms = newSyms.slice(0, 4);
      const kinds = srcNew.map(fileKind);
      if (srcNew.length === 1 && kinds[0]) pushC(kindPhrase(L, kinds[0] as SymKind, fileNoun(srcNew[0])).replace(/^/, t('add ', 'thêm ')));
      else if (newRoutes.length && !topSyms.some((s) => s.kind !== 'route')) {
        const r = newRoutes[0];
        pushC(t(`add ${r.name} endpoint`, `thêm endpoint ${r.name}`));
      }
      if (migration && srcNew.length === 1) pushC(t(`add ${fileNoun(migration)} migration`, `thêm migration ${fileNoun(migration)}`));
      if (topSyms.length === 1) pushC(t('add ', 'thêm ') + kindPhrase(L, topSyms[0].kind, topSyms[0].name));
      if (topSyms.length >= 2) {
        const a = topSyms[0], b = topSyms[1];
        const same = a.kind === b.kind && topSyms.length === 2;
        if (same) pushC(t(`add ${a.name} and ${b.name} ${KIND_EN[a.kind]}s`, `thêm ${KIND_VI[a.kind]} ${a.name} và ${b.name}`));
        pushC(t(`add ${a.name}, ${b.name}${newSyms.length > 2 ? ` and ${newSyms.length - 2} more` : ''}`, `thêm ${a.name}, ${b.name}${newSyms.length > 2 ? ` và ${newSyms.length - 2} mục khác` : ''}`));
        pushC(t('add ', 'thêm ') + kindPhrase(L, a.kind, a.name));
      }
      if (srcNew.length >= 1 && !topSyms.length) {
        const f = srcNew[0];
        pushC(srcNew.length === 1 ? t(`add ${fileNoun(f)}`, `thêm ${fileNoun(f)}`) : t(`add ${srcNew.length} files`, `thêm ${srcNew.length} file`));
      }
      pushC(t(`add ${target} support`, `bổ sung ${target}`), t('add new functionality', 'thêm chức năng mới'));
      break;
    }
    case 'fix': {
      const phrase = guardHits ? t('missing null check', 'lỗi thiếu kiểm tra null') : off1 ? t('off-by-one error', 'lỗi lệch chỉ số (off-by-one)') : tryHits ? t('unhandled error', 'lỗi chưa xử lý ngoại lệ') : t('bug', 'lỗi');
      pushC(t(`fix ${phrase} in ${targetScoped}`, `sửa ${phrase} trong ${targetScoped}`), t(`fix ${phrase}`, `sửa ${phrase}`), t('fix bug', 'sửa lỗi'));
      break;
    }
    case 'perf': {
      const kws = uniq(perfKeywords);
      const kw = ['cache', 'caching', 'cached', 'lru_cache', 'functools.cache', 'usememo', 'react.memo', 'memoize', 'memoise', 'memoization', 'lazy', 'debounce', 'throttle', 'batch', 'batching'].find((k) => kws.includes(k)) || kws[0] || '';
      if (/cach/.test(kw) || kw === 'lru_cache') pushC(t(`add caching to ${target}`, `thêm cache cho ${target}`));
      else if (/memo/.test(kw)) pushC(t(`memoize ${target}`, `memoize ${target}`));
      else if (kw === 'lazy') pushC(t(`lazy-load ${target}`, `lazy-load ${target}`));
      else if (kw === 'debounce') pushC(t(`debounce ${target}`, `debounce ${target}`));
      else if (kw === 'throttle') pushC(t(`throttle ${target}`, `throttle ${target}`));
      else if (kw.startsWith('batch')) pushC(t(`batch ${target} operations`, `gộp batch cho ${target}`));
      pushC(t(`improve ${target} performance`, `cải thiện hiệu năng ${target}`), t('improve performance', 'cải thiện hiệu năng'));
      break;
    }
    case 'refactor': {
      const rfs = files.filter((f) => f.status === 'R' || f.status === 'C');
      const dels = files.filter((f) => f.status === 'D' && f.category !== 'test');
      const verbMove = (f: FileDiff, full: boolean) => {
        const od = dirname(f.oldPath), nd = dirname(f.path);
        const ob = basename(f.oldPath), nb = basename(f.path);
        if (od === nd) return t(`rename ${full ? f.oldPath : ob} to ${full ? f.path : nb}`, `đổi tên ${full ? f.oldPath : ob} thành ${full ? f.path : nb}`);
        if (ob === nb) return t(`move ${ob} to ${nd || '/'}`, `chuyển ${ob} sang ${nd || '/'}`);
        return t(`move ${full ? f.oldPath : ob} to ${full ? f.path : nb}`, `chuyển ${full ? f.oldPath : ob} sang ${full ? f.path : nb}`);
      };
      if (rfs.length === 1) pushC(verbMove(rfs[0], true), verbMove(rfs[0], false));
      else if (rfs.length > 1) {
        const nds = uniq(rfs.map((f) => dirname(f.path)));
        if (nds.length === 1) pushC(t(`move ${rfs.length} files to ${nds[0] || '/'}`, `chuyển ${rfs.length} file sang ${nds[0] || '/'}`));
        pushC(t(`rename ${rfs.length} files`, `đổi tên ${rfs.length} file`));
      } else if (dels.length && dels.length === code.length) {
        const names = uniq(dels.map((f) => basename(f.path)));
        if (names.length <= 2) pushC(t(`remove ${names.join(' and ')}`, `xóa ${names.join(' và ')}`));
        pushC(t(`remove ${names.length} unused files`, `xóa ${names.length} file không dùng`));
      } else {
        const ns = newSyms[0];
        if (ns && removedSyms.length) pushC(t(`extract ${ns.name} from ${fileLabel(bigFile)}`, `tách ${ns.name} khỏi ${fileLabel(bigFile)}`));
        pushC(t(`refactor ${target}`, `tái cấu trúc ${target}`));
      }
      pushC(t('refactor code', 'tái cấu trúc code'));
      break;
    }
    default:
      pushC(t(`update ${target}`, `cập nhật ${target}`));
  }
  pushC(t(`update ${files.length} file${files.length === 1 ? '' : 's'}`, `cập nhật ${files.length} file`), t('update code', 'cập nhật code'));

  const bang = breaking ? '!' : '';
  const prefix = style === 'short' ? '' : `${type}${scope ? `(${scope})` : ''}${bang}: `;
  const fitSubject = (): string => {
    const norm = (s: string) => (style === 'short' ? capitalize(s) : s);
    for (const c of cands) {
      const s = prefix + norm(c);
      if (s.length <= 72) return s;
    }
    let s = prefix + norm(cands[0] || '');
    if (s.length > 72) {
      s = s.slice(0, 72);
      const sp = s.lastIndexOf(' ');
      if (sp > prefix.length + 8) s = s.slice(0, sp);
    }
    return s.replace(/[\s.,:;(\-/]+$/, '');
  };
  const subject = fitSubject().normalize('NFC');
  const desc = style === 'short' ? subject : subject.slice(prefix.length);

  /* ---------- issues & footers ---------- */
  const footers: string[] = [];
  const issues = issuesIn;
  for (const c of issues.closes) footers.push(`Closes ${c}`);
  for (const r of issues.refs) footers.push(`${type === 'fix' ? 'Fixes' : 'Refs'} ${r}`);
  const breakingFooters = breakingReasons.slice(0, 3).map((r) => wrap(`BREAKING CHANGE: ${r}`, 72, ' ').join('\n'));
  if (style !== 'short') footers.push(...breakingFooters);

  /* ---------- body ---------- */
  const bodyLines: string[] = [];
  const bullet = (s: string) => { bodyLines.push(...wrap(`- ${s}`, 72, '  ')); };
  const wantBody = style === 'detailed' || (style === 'conventional' && (files.length >= 3 || breaking));
  if (wantBody) {
    if (type === 'build' && deps.length) {
      for (const d of deps.slice(0, 8)) {
        if (d.kind === 'bump') bullet(t(`bump ${d.name}${d.from ? ` from ${d.from}` : ''}${d.to ? ` to ${d.to}` : ''}${d.major ? ' (major)' : ''}`, `nâng cấp ${d.name}${d.from ? ` từ ${d.from}` : ''}${d.to ? ` lên ${d.to}` : ''}${d.major ? ' (major)' : ''}`));
        else if (d.kind === 'add') bullet(t(`add ${d.name}${d.to ? ` ${d.to}` : ''}`, `thêm ${d.name}${d.to ? ` ${d.to}` : ''}`));
        else bullet(t(`remove ${d.name}`, `gỡ ${d.name}`));
      }
      if (deps.length > 8) bullet(t(`and ${deps.length - 8} more`, `và ${deps.length - 8} dependency khác`));
    } else {
      if (newSyms.length && (type === 'feat' || style === 'detailed')) {
        bullet(t(`add ${shortList(newSyms.slice(0, 6).map((s) => s.name), 5, L)}`, `thêm ${shortList(newSyms.slice(0, 6).map((s) => s.name), 5, L)}`));
      }
      for (const cs of categoryStats.filter((c) => c.category !== 'generated')) {
        const fs = byCat(cs.category);
        const names = fs.map((f) => (f.status === 'R' ? `${basename(f.oldPath)} -> ${basename(f.path)}` : basename(f.path)));
        bullet(`${categoryLabel(cs.category, L)} (${cs.files}): ${shortList(names, 3, L)} (+${cs.added}/-${cs.removed})`);
      }
    }
    if (bodyLines.length > 12) bodyLines.length = 12;
  }
  const body = bodyLines.join('\n').normalize('NFC');
  const commitMessage = [subject, body, footers.join('\n')].filter(Boolean).join('\n\n');

  /* ---------- findings & risks ---------- */
  const findings = scanFindings(files);
  const risks: Risk[] = [];
  const ref = (f: Finding) => `${f.file}:${f.line}`;
  const mig = byCat('migration');
  if (mig.length) risks.push({ id: 'migration', level: 'high', en: 'Touches database migrations: verify rollback and data impact', vi: 'Có thay đổi migration cơ sở dữ liệu: kiểm tra rollback và ảnh hưởng dữ liệu', items: mig.map((f) => f.path).slice(0, 8) });
  const locks = byCat('lockfile');
  const manifests = files.filter((f) => f.category === 'build' && /package\.json|go\.mod|cargo\.toml|pyproject|requirements|composer\.json|gemfile|pipfile/i.test(basename(f.path)));
  if (locks.length && files.every((f) => f.category === 'lockfile')) risks.push({ id: 'lockfile-only', level: 'medium', en: 'Only lockfiles changed: dependency resolution changed without a manifest edit', vi: 'Chỉ lockfile thay đổi: phiên bản dependency đổi mà không sửa manifest', items: locks.map((f) => f.path) });
  else if (locks.length && !manifests.length) risks.push({ id: 'lockfile-no-manifest', level: 'low', en: 'Lockfile changed without package manifest', vi: 'Lockfile thay đổi nhưng manifest (package.json...) không đổi', items: locks.map((f) => f.path) });
  const cfg = byCat('config');
  if (cfg.length) {
    const env = cfg.filter((f) => /(^|\/)\.env(\.|$)/.test(f.path) && !/\.(example|sample|template)$/.test(f.path));
    risks.push({ id: 'config', level: env.length ? 'high' : 'low', en: env.length ? 'Environment file (.env) is part of the diff' : 'Touches configuration/env files: check per-environment values', vi: env.length ? 'File môi trường (.env) nằm trong diff' : 'Có thay đổi cấu hình/biến môi trường: kiểm tra giá trị từng môi trường', items: cfg.map((f) => f.path).slice(0, 8) });
  }
  const ci = byCat('ci');
  if (ci.length) risks.push({ id: 'ci', level: 'medium', en: 'Touches CI/CD pipeline: it can change release behaviour', vi: 'Có thay đổi CI/CD: có thể ảnh hưởng quy trình build/release', items: ci.map((f) => f.path).slice(0, 8) });
  const authFiles = files.filter((f) => f.category !== 'docs' && f.category !== 'lockfile' && /(^|[/._-])(auth\w*|login|logout|session\w*|password\w*|passwd|oauth\w*|jwt|token\w*|crypto\w*|security|permission\w*|acl|rbac|secrets?|credentials?)([/._-]|$)/i.test(f.path));
  if (authFiles.length) risks.push({ id: 'auth', level: 'medium', en: 'Touches auth/security-related paths: needs careful review', vi: 'Chạm vào đường dẫn liên quan xác thực/bảo mật: cần review kỹ', items: authFiles.map((f) => f.path).slice(0, 8) });
  if (totalChurn > 800) risks.push({ id: 'large', level: 'medium', en: `Large diff (${totalChurn} changed lines): consider splitting`, vi: `Diff lớn (${totalChurn} dòng thay đổi): cân nhắc tách thành nhiều PR` });
  const delTests = byCat('test').filter((f) => f.status === 'D');
  if (delTests.length || (removedTests.length > addedTests.length && removedTests.length >= 1)) {
    risks.push({
      id: 'deleted-tests', level: 'medium', en: delTests.length ? 'Test files deleted' : 'More test cases removed than added',
      vi: delTests.length ? 'Có file test bị xóa' : 'Số test case bị xóa nhiều hơn số thêm',
      items: delTests.length ? delTests.map((f) => f.path).slice(0, 8) : removedTests.slice(0, 5),
    });
  }
  const srcChurn = sum(byCat('source'));
  if (srcChurn >= 3 && !byCat('test').length) risks.push({ id: 'no-tests', level: srcChurn >= 50 ? 'medium' : 'low', en: 'Source changed but no tests were added or updated', vi: 'Có thay đổi mã nguồn nhưng không thêm/cập nhật test' });
  const depAdd = deps.filter((d) => d.kind === 'add');
  const depRem = deps.filter((d) => d.kind === 'remove');
  const depMajor = deps.filter((d) => d.major);
  if (depAdd.length) risks.push({ id: 'deps-added', level: 'low', en: `New dependencies added: ${shortList(depAdd.map((d) => d.name), 5, 'en')}`, vi: `Thêm dependency mới: ${shortList(depAdd.map((d) => d.name), 5, 'vi')}`, items: depAdd.map((d) => d.name) });
  if (depRem.length) risks.push({ id: 'deps-removed', level: 'low', en: `Dependencies removed: ${shortList(depRem.map((d) => d.name), 5, 'en')}`, vi: `Gỡ dependency: ${shortList(depRem.map((d) => d.name), 5, 'vi')}`, items: depRem.map((d) => d.name) });
  if (depMajor.length) risks.push({ id: 'deps-major', level: 'medium', en: `Major version bump: ${shortList(depMajor.map((d) => `${d.name} ${d.from}->${d.to}`), 4, 'en')}`, vi: `Nâng cấp major: ${shortList(depMajor.map((d) => `${d.name} ${d.from}->${d.to}`), 4, 'vi')}`, items: depMajor.map((d) => d.name) });
  if (breaking) risks.push({ id: 'breaking', level: 'high', en: 'Possible breaking change (see footer)', vi: 'Có thể là breaking change (xem footer BREAKING CHANGE)', items: breakingReasons.slice(0, 5) });
  const sec = findings.filter((f) => f.kind === 'secret');
  if (sec.length) risks.push({ id: 'secret', level: 'high', en: `Possible hard-coded secret on ${sec.length} added line(s)`, vi: `Nghi ngờ lộ bí mật (khóa/mật khẩu) ở ${sec.length} dòng thêm mới`, items: sec.slice(0, 8).map((f) => `${ref(f)} (${f.rule})`) });
  const dbg = findings.filter((f) => f.kind === 'debug');
  if (dbg.length) risks.push({ id: 'debug', level: 'low', en: `Debug statements added (${dbg.length})`, vi: `Có lệnh debug được thêm vào (${dbg.length})`, items: dbg.slice(0, 8).map((f) => `${ref(f)} ${f.rule}`) });
  const todo = findings.filter((f) => f.kind === 'todo');
  if (todo.length) risks.push({ id: 'todo', level: 'low', en: `TODO/FIXME markers introduced (${todo.length})`, vi: `Có ghi chú TODO/FIXME mới (${todo.length})`, items: todo.slice(0, 8).map((f) => `${ref(f)} ${f.rule}`) });
  const bin = files.filter((f) => f.binary);
  if (bin.length && bin.some((f) => f.category !== 'asset')) risks.push({ id: 'binary', level: 'low', en: 'Binary files in diff cannot be reviewed as text', vi: 'Có file nhị phân (không review được dạng text)', items: bin.map((f) => f.path).slice(0, 8) });
  const lvl = { high: 0, medium: 1, low: 2 };
  risks.sort((a, b) => lvl[a.level] - lvl[b.level]);

  /* ---------- PR ---------- */
  const prTitle = style === 'short' ? subject : subject;
  const pr: string[] = [];
  const H = (en: string, vi: string) => `## ${t(en, vi)}`;
  pr.push(H('Summary', 'Tóm tắt'));
  pr.push('');
  pr.push(`${capitalize(desc)}.`);
  pr.push('');
  pr.push(t(
    `${files.length} file${files.length === 1 ? '' : 's'} changed, +${fmt(parsed.totalAdded)} / -${fmt(parsed.totalRemoved)} lines.`,
    `${files.length} file thay đổi, +${fmt(parsed.totalAdded)} / -${fmt(parsed.totalRemoved)} dòng.`,
  ));
  if (newSyms.length) pr.push('', t(`New: ${shortList(newSyms.slice(0, 8).map((s) => `\`${s.name}\``), 6, L)}`, `Mới: ${shortList(newSyms.slice(0, 8).map((s) => `\`${s.name}\``), 6, L)}`));
  if (deps.length) {
    pr.push('');
    for (const d of deps.slice(0, 12)) {
      pr.push(d.kind === 'bump' ? `- ${t('Bump', 'Nâng cấp')} \`${d.name}\`: ${d.from ?? '?'} -> ${d.to ?? '?'}${d.major ? ' (major)' : ''}` : d.kind === 'add' ? `- ${t('Add', 'Thêm')} \`${d.name}\`${d.to ? ` ${d.to}` : ''}` : `- ${t('Remove', 'Gỡ')} \`${d.name}\``);
    }
  }
  if (breaking) {
    pr.push('', `**${t('Breaking change', 'Breaking change')}**`);
    for (const r of breakingReasons.slice(0, 5)) pr.push(`- ${r}`);
  }
  pr.push('', H('Changes', 'Thay đổi'), '');
  for (const cs of categoryStats) {
    const fs = byCat(cs.category).slice().sort((a, b) => churn(b) - churn(a));
    pr.push(`**${categoryLabel(cs.category, L)}** (${cs.files} ${t(cs.files === 1 ? 'file' : 'files', 'file')}, +${cs.added}/-${cs.removed})`);
    for (const f of fs.slice(0, 15)) {
      const st = f.status === 'A' ? t('new', 'mới') : f.status === 'D' ? t('deleted', 'xóa') : f.status === 'R' ? t('renamed', 'đổi tên') : f.status === 'C' ? t('copied', 'sao chép') : '';
      const name = f.status === 'R' && f.oldPath !== f.path ? `\`${f.oldPath}\` -> \`${f.path}\`` : `\`${f.path}\``;
      pr.push(`- ${name} (+${f.added}/-${f.removed}${st ? `, ${st}` : ''}${f.binary ? t(', binary', ', nhị phân') : ''})`);
    }
    if (fs.length > 15) pr.push(`- ${t(`... and ${fs.length - 15} more`, `... và ${fs.length - 15} file khác`)}`);
    pr.push('');
  }
  pr.push(H('Risks', 'Rủi ro cần lưu ý'), '');
  if (!risks.length) pr.push(`- [x] ${t('No obvious risk detected (local heuristic)', 'Chưa phát hiện rủi ro rõ ràng (heuristic cục bộ)')}`);
  for (const r of risks) {
    pr.push(`- [ ] **${t(r.level === 'high' ? 'High' : r.level === 'medium' ? 'Medium' : 'Low', r.level === 'high' ? 'Cao' : r.level === 'medium' ? 'Trung bình' : 'Thấp')}**: ${r[L]}`);
    if (r.items && r.items.length) for (const it of r.items.slice(0, 5)) pr.push(`  - \`${it}\``);
  }
  pr.push('', H('Testing', 'Kiểm thử'), '');
  const tests: string[] = [];
  if (byCat('test').length) tests.push(t('Run the test suite and confirm the new/updated tests pass', 'Chạy bộ test và xác nhận các test mới/đã sửa đều pass'));
  else if (code.length) tests.push(t('Add or run tests covering the changed behaviour', 'Bổ sung hoặc chạy test cho phần hành vi đã thay đổi'));
  if (code.length) tests.push(t('Manually verify the affected flow end to end', 'Kiểm tra thủ công luồng bị ảnh hưởng từ đầu đến cuối'));
  if (type === 'fix') tests.push(t('Reproduce the original bug and confirm it is fixed', 'Tái hiện lỗi ban đầu và xác nhận đã được sửa'));
  if (mig.length) tests.push(t('Run migrations on a clean database and test the rollback', 'Chạy migration trên DB sạch và thử rollback'));
  if (deps.length || locks.length) tests.push(t('Reinstall dependencies and make sure the build and tests still pass', 'Cài lại dependency và chắc chắn build/test vẫn pass'));
  if (ci.length) tests.push(t('Check that the CI pipeline runs green on this branch', 'Kiểm tra pipeline CI chạy xanh trên nhánh này'));
  if (byCat('docs').length) tests.push(t('Preview the rendered documentation and check links', 'Xem trước tài liệu đã render và kiểm tra liên kết'));
  if (cfg.length) tests.push(t('Verify configuration values in each environment', 'Kiểm tra giá trị cấu hình ở từng môi trường'));
  if (breaking) tests.push(t('Check callers/consumers of the changed public API', 'Kiểm tra nơi gọi/consumer của API công khai đã thay đổi'));
  if (!tests.length) tests.push(t('Smoke test the application', 'Chạy thử nhanh ứng dụng'));
  for (const x of tests) pr.push(`- [ ] ${x}`);
  if (footers.length) {
    pr.push('');
    for (const f of footers.filter((x) => !x.startsWith('BREAKING'))) pr.push(f);
  }
  const prDescription = pr.join('\n').normalize('NFC');

  const symbols = newSyms;
  return {
    ok: true, parsed, type, confidence: Math.round(ti.confidence * 100) / 100, reasons, scope, scopeSource, breaking, breakingReasons,
    subject, body, footers, commitMessage, prTitle, prDescription, deps, symbols, risks, findings, issues, categoryStats,
  };
}

function parseDepCapable(base: string): boolean {
  return base === 'package.json' || base === 'composer.json' || base === 'go.mod' || base === 'cargo.toml' || base === 'pyproject.toml' ||
    base === 'gemfile' || base.startsWith('build.gradle') || /^(requirements|constraints)[\w.-]*\.txt$/.test(base);
}

/* ------------------------------------------------------------------ */
/* Gợi ý cục bộ để "mồi" cho AI (chèn đầu input)                       */
/* ------------------------------------------------------------------ */

/** Dòng chú thích đặt trước diff khi gửi AI (server vẫn coi là DỮ LIỆU). Không chứa mã nguồn. */
export function buildAiHint(a: Analysis): string {
  if (!a.ok) return '';
  const lines = [
    `# Local heuristic hint (may be wrong): type=${a.type}${a.scope ? `, scope=${a.scope}` : ''}${a.breaking ? ', breaking=yes' : ''}`,
    `# Suggested subject: ${a.subject}`,
    `# Files: ${a.parsed.files.length}, +${a.parsed.totalAdded}/-${a.parsed.totalRemoved}`,
  ];
  return lines.join('\n') + '\n';
}
