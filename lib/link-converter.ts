// Chuyển đổi link GitHub / GitLab / Bitbucket sang các dạng liên quan.
// Thuần chuỗi, chạy phía client, không gọi mạng.

export type Provider = 'github' | 'gitlab' | 'bitbucket';
export type LinkKind = 'repo' | 'dir' | 'file';
export type RefType = 'head' | 'branch' | 'tag' | 'commit';

export interface LineRange {
  start: number;
  end: number;
}

export interface ParsedLink {
  provider: Provider;
  host: string;
  /** GitHub/Bitbucket: owner. GitLab: namespace (có thể chứa nhiều cấp, ngăn cách bởi "/"). */
  owner: string;
  repo: string;
  kind: LinkKind;
  /** true nếu loại (file/thư mục) chỉ là đoán (Bitbucket). */
  kindGuessed: boolean;
  ref: string;
  path: string;
  refType: RefType;
  /** Gợi ý rõ ràng từ URL (refs/tags/..., releases/tag/...), null nếu không có. */
  refHint: RefType | null;
  /** Các đoạn "ref/path" gốc trong URL (đã bỏ tiền tố refs/heads|tags). */
  segments: string[];
  /** Tên nhánh có dấu "/" khiến việc tách ref/path chưa chắc chắn. */
  ambiguous: boolean;
  line: LineRange | null;
  notes: string[];
}

export type ParseResult = { ok: true; link: ParsedLink } | { ok: false; error: string };

export interface DerivedItem {
  id: string;
  label: string;
  value: string;
  type: 'url' | 'cmd';
  open: boolean;
  note?: string;
}

export interface DerivedGroup {
  id: string;
  title: string;
  hint?: string;
  items: DerivedItem[];
}

/* ------------------------------------------------------------------ */
/* Tiện ích chuỗi / quoting                                            */
/* ------------------------------------------------------------------ */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function stripControl(s: string): string {
  return s.replace(CONTROL_CHARS, '');
}

/** Quote an toàn cho POSIX shell (bash/zsh/sh). */
export function shq(s: string): string {
  return `'${stripControl(s).replace(/'/g, `'\\''`)}'`;
}

/** Quote an toàn cho PowerShell (kể cả dấu nháy cong). */
export function psq(s: string): string {
  return `'${stripControl(s).replace(/['‘’‚‛]/g, (m) => m + m)}'`;
}

function encSeg(x: string): string {
  return encodeURIComponent(x).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function encPath(p: string): string {
  return p
    .split('/')
    .filter((x) => x.length > 0)
    .map((x) => encSeg(x))
    .join('/');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, '');
}

function baseName(path: string): string {
  const last = path.split('/').filter(Boolean).pop() || '';
  const clean = stripControl(last).trim();
  return clean || 'download';
}

function slugRef(ref: string): string {
  return ref.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'HEAD';
}

/* ------------------------------------------------------------------ */
/* Ref                                                                 */
/* ------------------------------------------------------------------ */

export function isSha(s: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(s);
}

export function guessRefType(ref: string): RefType {
  if (!ref) return 'head';
  if (isSha(ref)) return 'commit';
  if (/^v\d+([.\-+_][\w.\-+]*)?$/i.test(ref) || /^\d+\.\d+(\.\d+)*([\-+][\w.\-+]*)?$/.test(ref)) return 'tag';
  return 'branch';
}

const BRANCH_PREFIXES = new Set([
  'feature', 'features', 'feat', 'fix', 'bugfix', 'hotfix', 'release', 'releases', 'dev',
  'chore', 'refactor', 'users', 'user', 'dependabot', 'renovate', 'topic', 'wip',
]);

function defaultSplit(
  segsIn: string[],
  kind: LinkKind
): { ref: string; path: string; hint: RefType | null; ambiguous: boolean; segments: string[] } {
  let segs = segsIn;
  let hint: RefType | null = null;
  if (segs[0] === 'refs' && segs.length >= 3 && (segs[1] === 'heads' || segs[1] === 'tags')) {
    hint = segs[1] === 'heads' ? 'branch' : 'tag';
    segs = segs.slice(2);
  }
  if (segs.length === 0) return { ref: '', path: '', hint, ambiguous: false, segments: [] };
  if (isSha(segs[0])) {
    return { ref: segs[0], path: segs.slice(1).join('/'), hint: hint ?? 'commit', ambiguous: false, segments: segs };
  }
  if (segs.length > 2 && kind !== 'repo' && BRANCH_PREFIXES.has(segs[0].toLowerCase())) {
    // Tiền tố nhánh phổ biến (feature/, fix/...): đoán nhánh gồm 2 đoạn, đánh dấu chưa chắc chắn.
    return { ref: segs.slice(0, 2).join('/'), path: segs.slice(2).join('/'), hint, ambiguous: true, segments: segs };
  }
  return { ref: segs[0], path: segs.slice(1).join('/'), hint, ambiguous: false, segments: segs };
}

/** Các cách tách ref/path khác có thể có (tối đa 6) khi tên nhánh chứa "/". */
export function splitCandidates(link: ParsedLink): { ref: string; path: string }[] {
  const segs = link.segments;
  if (segs.length < 2 || isSha(segs[0])) return [];
  const max = Math.min(link.kind === 'file' ? segs.length - 1 : segs.length, 6);
  const out: { ref: string; path: string }[] = [];
  for (let i = 1; i <= max; i++) {
    out.push({ ref: segs.slice(0, i).join('/'), path: segs.slice(i).join('/') });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Parse                                                               */
/* ------------------------------------------------------------------ */

const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

function validName(s: string): boolean {
  return NAME_RE.test(s) && s !== '.' && s !== '..';
}

function parseLine(hash: string): LineRange | null {
  const h = hash.replace(/^#/, '');
  let m = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/.exec(h);
  if (!m) m = /^lines-(\d+)(?:[:-](\d+))?$/.exec(h);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = m[2] ? parseInt(m[2], 10) : a;
  if (!Number.isFinite(a) || a < 1 || !Number.isFinite(b) || b < 1) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

function build(
  base: Pick<ParsedLink, 'provider' | 'host' | 'owner' | 'repo'>,
  kind: LinkKind,
  segs: string[],
  extra: { hint?: RefType | null; line: LineRange | null; notes: string[]; kindGuessed?: boolean }
): ParsedLink {
  const sp = defaultSplit(segs, kind);
  const hint = extra.hint ?? sp.hint;
  let finalKind = kind;
  if (kind !== 'repo' && !sp.path) finalKind = 'repo';
  return {
    ...base,
    kind: finalKind,
    kindGuessed: !!extra.kindGuessed && finalKind !== 'repo',
    ref: sp.ref,
    path: sp.path,
    refType: hint ?? guessRefType(sp.ref),
    refHint: hint,
    segments: sp.segments,
    ambiguous: sp.ambiguous && finalKind !== 'repo',
    line: finalKind === 'file' ? extra.line : null,
    notes: extra.notes,
  };
}

const UNRECOGNIZED =
  'Không nhận dạng được link. Hãy dán URL GitHub, GitLab hoặc Bitbucket (repo, nhánh/tag, file, thư mục), ví dụ https://github.com/owner/repo/blob/main/README.md hoặc dạng owner/repo.';

export function parseLink(inputRaw: string): ParseResult {
  let input = stripControl(inputRaw).trim();
  input = input.replace(/^[<"'`]+|[>"'`]+$/g, '').trim();
  if (!input) return { ok: false, error: 'Chưa nhập link.' };

  // SSH: git@host:owner/repo(.git)
  const ssh = /^(?:ssh:\/\/)?git@([\w.-]+)[:/](.+?)(?:\.git)?\/?$/i.exec(input);
  if (ssh) {
    input = `https://${ssh[1]}/${ssh[2]}`;
  }

  // owner/repo viết tắt (mặc định GitHub)
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    if (/^(www\.)?(github\.com|gitlab\.[\w.-]+|bitbucket\.org|raw\.githubusercontent\.com)\//i.test(input)) {
      input = `https://${input}`;
    } else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/.test(input)) {
      input = `https://github.com/${input}`;
    } else {
      return { ok: false, error: UNRECOGNIZED };
    }
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: UNRECOGNIZED };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: UNRECOGNIZED };

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean).map(safeDecode);
  const line = parseLine(url.hash);
  const notes: string[] = [];

  /* ---------------- raw.githubusercontent.com ---------------- */
  if (host === 'raw.githubusercontent.com') {
    if (parts.length < 3) return { ok: false, error: 'Link raw cần có dạng /owner/repo/ref/đường-dẫn-file.' };
    const [owner, repoRaw] = parts;
    const repo = repoRaw.replace(/\.git$/, '');
    if (!validName(owner) || !validName(repo)) return { ok: false, error: UNRECOGNIZED };
    return {
      ok: true,
      link: build({ provider: 'github', host: 'github.com', owner, repo }, 'file', parts.slice(2), { line, notes }),
    };
  }

  /* ---------------- GitHub ---------------- */
  if (host === 'github.com') {
    if (parts.length < 2) return { ok: false, error: 'Link GitHub cần có ít nhất owner và tên repo (github.com/owner/repo).' };
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, '');
    if (!validName(owner) || !validName(repo)) return { ok: false, error: UNRECOGNIZED };
    const base = { provider: 'github' as const, host: 'github.com', owner, repo };
    const section = parts[2];
    if (!section) return { ok: true, link: build(base, 'repo', [], { line: null, notes }) };

    if (section === 'tree') {
      return { ok: true, link: build(base, 'dir', parts.slice(3), { line: null, notes }) };
    }
    if (section === 'blob' || section === 'blame' || section === 'raw' || section === 'edit' || section === 'commits') {
      if (section === 'commits') {
        notes.push('Link lịch sử commit: chỉ lấy phần nhánh/đường dẫn.');
        return { ok: true, link: build(base, 'dir', parts.slice(3), { line: null, notes }) };
      }
      return { ok: true, link: build(base, 'file', parts.slice(3), { line, notes }) };
    }
    if (section === 'commit' && parts[3]) {
      notes.push('Link commit: dùng mã commit làm ref.');
      return { ok: true, link: build(base, 'repo', [parts[3]], { line: null, notes }) };
    }
    if (section === 'releases' && parts[3] === 'tag' && parts[4]) {
      notes.push('Link release: dùng tag làm ref.');
      return { ok: true, link: build(base, 'repo', [parts[4]], { hint: 'tag', line: null, notes }) };
    }
    notes.push(`Đã bỏ qua phần "/${parts.slice(2).join('/')}" - dùng thông tin repo.`);
    return { ok: true, link: build(base, 'repo', [], { line: null, notes }) };
  }

  /* ---------------- GitLab ---------------- */
  if (host === 'gitlab.com' || /^gitlab\.[\w.-]+$/.test(host) || /^[\w-]+\.gitlab\.[\w.-]+$/.test(host)) {
    const dash = parts.indexOf('-');
    let projectParts: string[];
    let rest: string[] = [];
    if (dash >= 0) {
      projectParts = parts.slice(0, dash);
      rest = parts.slice(dash + 1);
    } else {
      // Dạng cũ: /ns/repo/blob/ref/path
      const legacy = parts.findIndex((p, i) => i >= 2 && (p === 'blob' || p === 'tree' || p === 'raw'));
      if (legacy >= 0) {
        projectParts = parts.slice(0, legacy);
        rest = parts.slice(legacy);
      } else {
        projectParts = parts;
      }
    }
    if (projectParts.length < 2) return { ok: false, error: 'Link GitLab cần có dạng gitlab.com/namespace/repo.' };
    projectParts = projectParts.slice();
    projectParts[projectParts.length - 1] = projectParts[projectParts.length - 1].replace(/\.git$/, '');
    if (!projectParts.every(validName)) return { ok: false, error: UNRECOGNIZED };
    const repo = projectParts[projectParts.length - 1];
    const owner = projectParts.slice(0, -1).join('/');
    const base = { provider: 'gitlab' as const, host, owner, repo };
    const section = rest[0];
    if (section === 'tree') return { ok: true, link: build(base, 'dir', rest.slice(1), { line: null, notes }) };
    if (section === 'blob' || section === 'raw' || section === 'blame' || section === 'edit') {
      return { ok: true, link: build(base, 'file', rest.slice(1), { line, notes }) };
    }
    if (section === 'commit' && rest[1]) {
      notes.push('Link commit: dùng mã commit làm ref.');
      return { ok: true, link: build(base, 'repo', [rest[1]], { line: null, notes }) };
    }
    if (section === 'tags' && rest[1]) {
      return { ok: true, link: build(base, 'repo', [rest[1]], { hint: 'tag', line: null, notes }) };
    }
    if (section) notes.push(`Đã bỏ qua phần "/-/${rest.join('/')}" - dùng thông tin repo.`);
    return { ok: true, link: build(base, 'repo', [], { line: null, notes }) };
  }

  /* ---------------- Bitbucket ---------------- */
  if (host === 'bitbucket.org') {
    if (parts.length < 2) return { ok: false, error: 'Link Bitbucket cần có dạng bitbucket.org/workspace/repo.' };
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, '');
    if (!validName(owner) || !validName(repo)) return { ok: false, error: UNRECOGNIZED };
    const base = { provider: 'bitbucket' as const, host: 'bitbucket.org', owner, repo };
    const section = parts[2];
    if (section === 'src' || section === 'raw') {
      const segs = parts.slice(3);
      if (segs.length === 0) return { ok: true, link: build(base, 'repo', [], { line: null, notes }) };
      const last = segs[segs.length - 1];
      const isFile = section === 'raw' || (segs.length > 1 && /\.[A-Za-z0-9_-]+$/.test(last)) || /^(Makefile|Dockerfile|LICENSE|README)$/.test(last);
      if (section === 'src') notes.push('Bitbucket không phân biệt file/thư mục trong URL - loại được đoán, hãy chỉnh lại nếu sai.');
      return {
        ok: true,
        link: build(base, isFile ? 'file' : 'dir', segs, { line, notes, kindGuessed: section === 'src' }),
      };
    }
    if (section === 'commits' && parts[3] && isSha(parts[3])) {
      notes.push('Link commit: dùng mã commit làm ref.');
      return { ok: true, link: build(base, 'repo', [parts[3]], { line: null, notes }) };
    }
    if (section) notes.push(`Đã bỏ qua phần "/${parts.slice(2).join('/')}" - dùng thông tin repo.`);
    return { ok: true, link: build(base, 'repo', [], { line: null, notes }) };
  }

  return { ok: false, error: `Máy chủ "${url.hostname}" chưa được hỗ trợ. Hiện hỗ trợ github.com, gitlab.com và bitbucket.org.` };
}

/* ------------------------------------------------------------------ */
/* Chỉnh tay                                                           */
/* ------------------------------------------------------------------ */

export interface LinkEdits {
  ref: string;
  path: string;
  kind: LinkKind;
  /** 'auto' = tự đoán / theo gợi ý trong URL. */
  refType: RefType | 'auto';
}

export function editsFromLink(link: ParsedLink): LinkEdits {
  return { ref: link.ref, path: link.path, kind: link.kind, refType: 'auto' };
}

export function applyEdits(link: ParsedLink, e: LinkEdits): ParsedLink {
  const ref = stripControl(e.ref).trim();
  const path = trimSlashes(stripControl(e.path).trim());
  let kind = e.kind;
  if (kind !== 'repo' && !path) kind = 'repo';
  let refType: RefType;
  if (e.refType !== 'auto') refType = e.refType;
  else if (link.refHint && ref === link.ref) refType = link.refHint;
  else refType = guessRefType(ref);
  if (!ref) refType = 'head';
  return {
    ...link,
    ref,
    path,
    kind,
    refType,
    line: kind === 'file' ? link.line : null,
  };
}

/* ------------------------------------------------------------------ */
/* Dựng URL                                                            */
/* ------------------------------------------------------------------ */

function fullName(l: ParsedLink): string {
  return `${l.owner}/${l.repo}`;
}

function cloneHttps(l: ParsedLink): string {
  return `https://${l.host}/${fullName(l)}.git`;
}

function cloneSsh(l: ParsedLink): string {
  return `git@${l.host}:${fullName(l)}.git`;
}

export function getRawUrl(l: ParsedLink): string | null {
  if (l.kind !== 'file' || !l.path) return null;
  const ref = encPath(l.ref || 'HEAD');
  const p = encPath(l.path);
  switch (l.provider) {
    case 'github':
      return `https://raw.githubusercontent.com/${fullName(l)}/${ref}/${p}`;
    case 'gitlab':
      return `https://${l.host}/${fullName(l)}/-/raw/${ref}/${p}`;
    case 'bitbucket':
      return `https://bitbucket.org/${fullName(l)}/raw/${ref}/${p}`;
  }
}

export function getJsdelivrUrl(l: ParsedLink): string | null {
  if (l.kind !== 'file' || !l.path) return null;
  if (l.provider === 'bitbucket' || (l.provider === 'gitlab' && l.host !== 'gitlab.com')) return null;
  const prefix = l.provider === 'github' ? 'gh' : 'gl';
  const at = l.ref ? `@${encodeURIComponent(l.ref)}` : '';
  return `https://cdn.jsdelivr.net/${prefix}/${fullName(l)}${at}/${encPath(l.path)}`;
}

function archiveUrl(l: ParsedLink, ext: 'zip' | 'tar.gz'): string {
  const ref = l.ref;
  switch (l.provider) {
    case 'github': {
      const base = `https://github.com/${fullName(l)}/archive`;
      if (!ref) return `${base}/HEAD.${ext}`;
      if (l.refType === 'tag') return `${base}/refs/tags/${encPath(ref)}.${ext}`;
      if (l.refType === 'commit') return `${base}/${encodeURIComponent(ref)}.${ext}`;
      if (l.refType === 'head') return `${base}/HEAD.${ext}`;
      return `${base}/refs/heads/${encPath(ref)}.${ext}`;
    }
    case 'gitlab': {
      const r = ref || 'HEAD';
      return `https://${l.host}/${fullName(l)}/-/archive/${encPath(r)}/${l.repo}-${slugRef(r)}.${ext}`;
    }
    case 'bitbucket':
      return `https://bitbucket.org/${fullName(l)}/get/${encPath(ref || 'HEAD')}.${ext}`;
  }
}

export function getZipUrl(l: ParsedLink): string {
  return archiveUrl(l, 'zip');
}

function pageUrl(l: ParsedLink, withLine: boolean): string {
  const base = `https://${l.host}/${fullName(l)}`;
  const ref = encPath(l.ref || 'HEAD');
  const p = encPath(l.path);
  const ln = withLine && l.line ? l.line : null;
  switch (l.provider) {
    case 'github': {
      if (l.kind === 'repo') return l.ref ? `${base}/tree/${ref}` : base;
      const anchor = ln ? `#L${ln.start}${ln.end !== ln.start ? `-L${ln.end}` : ''}` : '';
      return `${base}/${l.kind === 'file' ? 'blob' : 'tree'}/${ref}/${p}${anchor}`;
    }
    case 'gitlab': {
      if (l.kind === 'repo') return l.ref ? `${base}/-/tree/${ref}` : base;
      const anchor = ln ? `#L${ln.start}${ln.end !== ln.start ? `-${ln.end}` : ''}` : '';
      return `${base}/-/${l.kind === 'file' ? 'blob' : 'tree'}/${ref}/${p}${anchor}`;
    }
    case 'bitbucket': {
      if (l.kind === 'repo') return l.ref ? `${base}/src/${ref}` : base;
      const anchor = ln ? `#lines-${ln.start}${ln.end !== ln.start ? `:${ln.end}` : ''}` : '';
      return `${base}/src/${ref}/${p}${anchor}`;
    }
  }
}

function url(id: string, label: string, value: string, note?: string): DerivedItem {
  return { id, label, value, type: 'url', open: true, note };
}

function cmd(id: string, label: string, value: string, note?: string): DerivedItem {
  return { id, label, value, type: 'cmd', open: false, note };
}

function cloneCommands(l: ParsedLink, shallow: boolean, sparse: boolean): string {
  const u = shq(cloneHttps(l));
  const dir = shq(l.repo);
  const needsCheckout = l.refType === 'commit';
  const branchOpt = l.ref && !needsCheckout && l.refType !== 'head' ? ` --branch=${shq(l.ref)}` : '';
  if (sparse) {
    const lines = [
      `git clone${shallow && !needsCheckout ? ' --depth 1' : ''} --filter=blob:none --sparse${branchOpt} ${u}`,
      `cd ${dir}`,
      `git sparse-checkout set -- ${shq(l.path)}`,
    ];
    if (needsCheckout) lines.push(`git checkout ${shq(l.ref)}`);
    return lines.join('\n');
  }
  if (needsCheckout) {
    return `git init ${dir} && cd ${dir} && git fetch --depth 1 ${u} ${shq(l.ref)} && git checkout FETCH_HEAD`;
  }
  return `git clone${shallow ? ' --depth 1' : ''}${branchOpt} ${u}`;
}

export function deriveOutputs(l: ParsedLink): DerivedGroup[] {
  const groups: DerivedGroup[] = [];
  const full = fullName(l);
  const base = `https://${l.host}/${full}`;
  const ref = encPath(l.ref || 'HEAD');
  const p = encPath(l.path);
  const raw = getRawUrl(l);
  const zip = getZipUrl(l);
  const tgz = archiveUrl(l, 'tar.gz');
  const archiveName = `${l.repo}-${slugRef(l.ref || 'HEAD')}`;
  const fileName = baseName(l.path);
  const isGithub = l.provider === 'github';

  /* --- Xem trên web --- */
  const web: DerivedItem[] = [];
  const typeLabel = l.kind === 'file' ? 'Trang file' : l.kind === 'dir' ? 'Trang thư mục' : 'Trang repo (ref hiện tại)';
  web.push(url('page', typeLabel, pageUrl(l, false)));
  if (l.kind === 'file' && l.line) {
    const lineLabel = l.line.start === l.line.end ? `dòng ${l.line.start}` : `dòng ${l.line.start}-${l.line.end}`;
    web.push(url('page-line', `Trang file kèm ${lineLabel}`, pageUrl(l, true)));
  }
  if (l.kind === 'file') {
    if (isGithub) web.push(url('blame', 'Blame (ai sửa dòng nào)', `${base}/blame/${ref}/${p}`));
    if (l.provider === 'gitlab') web.push(url('blame', 'Blame (ai sửa dòng nào)', `${base}/-/blame/${ref}/${p}`));
  }
  if (l.kind !== 'repo') {
    if (isGithub) web.push(url('history', 'Lịch sử commit của đường dẫn', `${base}/commits/${ref}/${p}`));
    if (l.provider === 'gitlab') web.push(url('history', 'Lịch sử commit của đường dẫn', `${base}/-/commits/${ref}/${p}`));
  }
  groups.push({
    id: 'web',
    title: 'Xem trên web',
    hint:
      l.refType === 'commit'
        ? 'Ref là mã commit nên các link bên dưới là permalink: nội dung không đổi theo thời gian.'
        : l.kind !== 'repo'
          ? 'Ref hiện chưa phải mã commit nên link có thể đổi nội dung theo thời gian. Muốn permalink, dùng mã commit làm ref (trên GitHub nhấn phím "y" khi xem file).'
          : undefined,
    items: web,
  });

  /* --- File --- */
  if (l.kind === 'file' && raw) {
    const items: DerivedItem[] = [url('raw', 'URL raw (nội dung thô)', raw)];
    const cdn = getJsdelivrUrl(l);
    if (cdn) {
      const slashNote = l.ref.includes('/') ? 'jsDelivr có thể không hỗ trợ tên nhánh chứa "/" - ưu tiên dùng tag hoặc commit.' : undefined;
      items.push(url('jsdelivr', 'jsDelivr CDN', cdn, slashNote));
      if (/\.(js|css)$/i.test(l.path) && !/\.min\.(js|css)$/i.test(l.path)) {
        items.push(url('jsdelivr-min', 'jsDelivr CDN (tự rút gọn .min)', cdn.replace(/\.(js|css)$/i, '.min.$1'), slashNote));
      }
    }
    if (isGithub) {
      items.push(
        url('api', 'GitHub API contents', `https://api.github.com/repos/${full}/contents/${p}${l.ref ? `?ref=${encodeURIComponent(l.ref)}` : ''}`)
      );
    } else if (l.provider === 'gitlab') {
      items.push(
        url(
          'api',
          'GitLab API (raw file)',
          `https://${l.host}/api/v4/projects/${encodeURIComponent(full)}/repository/files/${encodeURIComponent(l.path)}/raw?ref=${encodeURIComponent(l.ref || 'HEAD')}`
        )
      );
    } else {
      items.push(url('api', 'Bitbucket API (src)', `https://api.bitbucket.org/2.0/repositories/${full}/src/${ref}/${p}`));
    }
    if (l.line) {
      const range = l.line.start === l.line.end ? `${l.line.start}p` : `${l.line.start},${l.line.end}p`;
      items.push(cmd('sed', `Lấy riêng dòng ${l.line.start}${l.line.end !== l.line.start ? `-${l.line.end}` : ''}`, `curl -sL ${shq(raw)} | sed -n ${shq(range)}`));
    }
    groups.push({ id: 'file', title: 'Tệp', items });
  }

  /* --- Thư mục: API --- */
  if (l.kind === 'dir' || l.kind === 'repo') {
    const items: DerivedItem[] = [];
    if (isGithub) {
      items.push(
        url('api', 'GitHub API contents', `https://api.github.com/repos/${full}/contents${p ? `/${p}` : ''}${l.ref ? `?ref=${encodeURIComponent(l.ref)}` : ''}`)
      );
      items.push(url('api-tree', 'GitHub API cây thư mục (đệ quy)', `https://api.github.com/repos/${full}/git/trees/${encodeURIComponent(l.ref || 'HEAD')}?recursive=1`));
      items.push(url('cdn-list', 'jsDelivr danh sách file', `https://data.jsdelivr.com/v1/packages/gh/${full}${l.ref ? `@${encodeURIComponent(l.ref)}` : ''}?structure=flat`));
    } else if (l.provider === 'gitlab') {
      items.push(
        url(
          'api',
          'GitLab API cây thư mục',
          `https://${l.host}/api/v4/projects/${encodeURIComponent(full)}/repository/tree?ref=${encodeURIComponent(l.ref || 'HEAD')}${l.path ? `&path=${encodeURIComponent(l.path)}` : ''}&recursive=true`
        )
      );
    } else {
      items.push(url('api', 'Bitbucket API (src)', `https://api.bitbucket.org/2.0/repositories/${full}/src/${ref}/${p}`));
    }
    groups.push({ id: 'tree', title: 'API / danh sách file', items });
  }

  /* --- Tải về --- */
  const dl: DerivedItem[] = [];
  let dlHint: string | undefined;
  if (l.kind === 'file' && raw) {
    dl.push(cmd('curl', 'curl tải file', `curl -L -o ${shq(fileName)} ${shq(raw)}`));
    dl.push(cmd('wget', 'wget tải file', `wget -O ${shq(fileName)} ${shq(raw)}`));
    dl.push(cmd('ps', 'PowerShell tải file', `Invoke-WebRequest -Uri ${psq(raw)} -OutFile ${psq(fileName)}`));
  }
  const refLabel = l.ref ? `ref "${l.ref}"` : 'nhánh mặc định';
  dl.push(url('zip', `ZIP cả repo (${refLabel})`, zip));
  dl.push(url('tgz', 'Tarball .tar.gz cả repo', tgz));
  dl.push(cmd('curl-zip', 'curl tải ZIP', `curl -L -o ${shq(`${archiveName}.zip`)} ${shq(zip)}`));
  dl.push(cmd('curl-tar', 'curl tải và giải nén tarball', `curl -L ${shq(tgz)} | tar xz`));
  if (l.kind === 'dir') {
    dlHint = 'Archive luôn là cả repo, không có ZIP riêng cho thư mục. Muốn chỉ lấy thư mục, dùng lệnh sparse-checkout ở mục Git.';
  } else if (l.refType === 'head') {
    dlHint = 'Chưa có ref: dùng HEAD (nhánh mặc định của repo).';
  }
  if (l.provider === 'gitlab' && l.ref.includes('/')) {
    dlHint = (dlHint ? dlHint + ' ' : '') + 'Tên nhánh chứa "/" - nếu link lỗi 404, hãy kiểm tra lại ref.';
  }
  groups.push({ id: 'download', title: 'Tải về', hint: dlHint, items: dl });

  /* --- Git --- */
  const git: DerivedItem[] = [
    cmd('clone-https', 'git clone (HTTPS)', `git clone ${shq(cloneHttps(l))}`),
    cmd('clone-ssh', 'git clone (SSH)', `git clone ${shq(cloneSsh(l))}`),
  ];
  if (l.ref && l.refType !== 'head') {
    git.push(
      cmd(
        'clone-shallow',
        l.refType === 'commit' ? 'Tải nông đúng commit (--depth 1)' : `Clone nông --depth 1 --branch (${l.ref})`,
        cloneCommands(l, true, false),
        l.refType === 'commit' ? 'Máy chủ phải cho phép fetch theo mã commit (GitHub và GitLab hỗ trợ).' : undefined
      )
    );
  } else {
    git.push(cmd('clone-shallow', 'Clone nông --depth 1', cloneCommands(l, true, false)));
  }
  if (l.kind === 'dir' && l.path) {
    git.push(
      cmd('sparse', `Chỉ lấy thư mục "${l.path}" (sparse-checkout)`, cloneCommands(l, true, true), 'Cần Git 2.25 trở lên.')
    );
  }
  groups.push({ id: 'git', title: 'Git', items: git });

  /* --- Liên kết repo --- */
  const repoLinks: DerivedItem[] = [url('repo', 'Trang chính repo', base)];
  if (isGithub) {
    repoLinks.push(
      url('issues', 'Issues', `${base}/issues`),
      url('pulls', 'Pull requests', `${base}/pulls`),
      url('releases', 'Releases', `${base}/releases`),
      url('latest', 'Release mới nhất', `${base}/releases/latest`),
      url('actions', 'Actions', `${base}/actions`),
      url('tags', 'Tags', `${base}/tags`),
      url('branches', 'Branches', `${base}/branches`),
      url('api-repo', 'GitHub API thông tin repo', `https://api.github.com/repos/${full}`)
    );
  } else if (l.provider === 'gitlab') {
    repoLinks.push(
      url('issues', 'Issues', `${base}/-/issues`),
      url('pulls', 'Merge requests', `${base}/-/merge_requests`),
      url('releases', 'Releases', `${base}/-/releases`),
      url('actions', 'Pipelines', `${base}/-/pipelines`),
      url('tags', 'Tags', `${base}/-/tags`),
      url('branches', 'Branches', `${base}/-/branches`)
    );
  } else {
    repoLinks.push(
      url('issues', 'Issues', `${base}/issues`),
      url('pulls', 'Pull requests', `${base}/pull-requests`),
      url('releases', 'Downloads', `${base}/downloads`),
      url('actions', 'Pipelines', `${base}/pipelines`),
      url('branches', 'Branches', `${base}/branches`)
    );
  }
  groups.push({ id: 'repo', title: 'Liên kết repo', items: repoLinks });

  return groups;
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

export const KIND_LABEL: Record<LinkKind, string> = {
  repo: 'Repo',
  dir: 'Thư mục',
  file: 'File',
};

export const REF_TYPE_LABEL: Record<RefType, string> = {
  head: 'Mặc định (HEAD)',
  branch: 'Nhánh',
  tag: 'Tag',
  commit: 'Commit',
};

export const SAMPLE_LINKS: { label: string; url: string }[] = [
  { label: 'Repo gốc', url: 'https://github.com/facebook/react' },
  { label: 'File + dòng', url: 'https://github.com/vercel/next.js/blob/canary/packages/next/package.json#L1-L10' },
  { label: 'Thư mục (tag)', url: 'https://github.com/torvalds/linux/tree/v6.6/Documentation/admin-guide' },
  { label: 'Nhánh có dấu /', url: 'https://github.com/owner/repo/blob/feature/login-page/src/App.tsx' },
  { label: 'Commit', url: 'https://github.com/microsoft/vscode/blob/1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b/README.md' },
  { label: 'GitLab', url: 'https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md#L5-12' },
  { label: 'Bitbucket', url: 'https://bitbucket.org/atlassian/aui/src/master/package.json' },
  { label: 'Tên file lạ', url: "https://github.com/owner/repo/blob/main/docs/my file's $(x).md" },
];
