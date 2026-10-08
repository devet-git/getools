/**
 * Logic cho "Xem nhanh Repo": phân tích URL, gọi GitHub REST API công khai, dựng cây thư mục, thống kê.
 * Không phụ thuộc React.
 */

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;

/** Nhận `owner/repo`, link github.com (kể cả /tree/branch, /blob/branch/...), hoặc git@github.com:o/r.git */
export function parseRepoInput(input: string): RepoRef | null {
  let s = input.trim();
  if (!s) return null;
  const ssh = s.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) s = `${ssh[1]}/${ssh[2]}`;
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '');
  if (/^https?:\/\//i.test(s)) return null;
  s = s.split(/[?#]/)[0];
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return null;
  let ref: string | undefined;
  if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
    try {
      ref = decodeURIComponent(parts[3]);
    } catch {
      ref = parts[3];
    }
  }
  return { owner, repo, ref };
}

export class RepoError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export interface RateInfo {
  remaining: number | null;
  limit: number | null;
  reset: number | null; // epoch seconds
}

export function readRate(res: Response): RateInfo | null {
  const rem = res.headers.get('x-ratelimit-remaining');
  if (rem === null) return null;
  const lim = res.headers.get('x-ratelimit-limit');
  const reset = res.headers.get('x-ratelimit-reset');
  return {
    remaining: Number(rem),
    limit: lim ? Number(lim) : null,
    reset: reset ? Number(reset) : null,
  };
}

export function formatReset(reset: number | null): string {
  if (!reset) return '';
  const mins = Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000));
  return mins >= 60 ? `khoảng ${Math.ceil(mins / 60)} giờ nữa` : `khoảng ${mins} phút nữa`;
}

export interface GhOptions {
  token?: string;
  signal?: AbortSignal;
  onRate?: (r: RateInfo) => void;
}

/** GET tới api.github.com; token chỉ được gửi tới api.github.com. */
export async function ghGet(path: string, opts: GhOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, { headers, signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new RepoError('Lỗi mạng: không kết nối được tới GitHub. Vui lòng kiểm tra Internet và thử lại.');
  }
  const rate = readRate(res);
  if (rate && opts.onRate) opts.onRate(rate);
  if (res.ok) return res;
  if (res.status === 429 || (res.status === 403 && rate && rate.remaining === 0)) {
    const when = formatReset(rate?.reset ?? null);
    throw new RepoError(
      `Đã hết lượt gọi GitHub API${when ? ` (đặt lại sau ${when})` : ''}. Hãy thêm GitHub Token trong Cài đặt để tăng giới hạn lên 5.000 lượt/giờ.`,
      res.status
    );
  }
  if (res.status === 404) throw new RepoError('Không tìm thấy (404). Repo có thể không tồn tại, là riêng tư hoặc sai nhánh/đường dẫn.', 404);
  if (res.status === 401) throw new RepoError('GitHub Token không hợp lệ (401). Kiểm tra lại token trong Cài đặt.', 401);
  if (res.status === 403) throw new RepoError('Không có quyền truy cập (403). Với repo riêng tư, hãy thêm GitHub Token trong Cài đặt.', 403);
  if (res.status === 409) throw new RepoError('Repo trống (chưa có commit nào).', 409);
  throw new RepoError(`Lỗi GitHub API (${res.status}).`, res.status);
}

export async function ghJson<T>(path: string, opts: GhOptions = {}): Promise<T> {
  const res = await ghGet(path, opts);
  return (await res.json()) as T;
}

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
export const encRef = (r: string) => r.split('/').map(encodeURIComponent).join('/');

export interface RepoInfo {
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  license: { name: string; spdx_id: string } | null;
  default_branch: string;
  topics?: string[];
  created_at: string;
  pushed_at: string;
  size: number; // KB
  archived: boolean;
  fork: boolean;
  private: boolean;
  owner: { avatar_url: string };
}

export interface BranchItem {
  name: string;
}
export interface CommitItem {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string } | null;
}
export interface ReleaseItem {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  body: string | null;
}

export const getRepo = (o: string, r: string, opts: GhOptions) => ghJson<RepoInfo>(`/repos/${o}/${r}`, opts);
export const getLanguages = (o: string, r: string, opts: GhOptions) =>
  ghJson<Record<string, number>>(`/repos/${o}/${r}/languages`, opts);
export const getCommits = (o: string, r: string, ref: string, opts: GhOptions) =>
  ghJson<CommitItem[]>(`/repos/${o}/${r}/commits?per_page=10&sha=${encodeURIComponent(ref)}`, opts);

export async function getLatestRelease(o: string, r: string, opts: GhOptions): Promise<ReleaseItem | null> {
  try {
    return await ghJson<ReleaseItem>(`/repos/${o}/${r}/releases/latest`, opts);
  } catch (e) {
    if (e instanceof RepoError && e.status === 404) return null;
    throw e;
  }
}

/** Liệt kê nhánh hoặc tag, tối đa `maxItems` (phân trang 100/trang). */
export async function listRefs(
  o: string,
  r: string,
  kind: 'branches' | 'tags',
  opts: GhOptions,
  maxItems = 300
): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; out.length < maxItems; page++) {
    const data = await ghJson<BranchItem[]>(`/repos/${o}/${r}/${kind}?per_page=100&page=${page}`, opts);
    out.push(...data.map((b) => b.name));
    if (data.length < 100) break;
  }
  return out.slice(0, maxItems);
}

/** Giải mã base64 (có xuống dòng) sang chuỗi UTF-8 an toàn. */
export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export interface Readme {
  name: string;
  path: string;
  text: string;
}

export async function getReadme(o: string, r: string, ref: string, opts: GhOptions): Promise<Readme | null> {
  try {
    const d = await ghJson<{ name: string; path: string; content: string; encoding: string }>(
      `/repos/${o}/${r}/readme?ref=${encodeURIComponent(ref)}`,
      opts
    );
    if (d.encoding !== 'base64') return null;
    return { name: d.name, path: d.path, text: decodeBase64Utf8(d.content) };
  } catch (e) {
    if (e instanceof RepoError && e.status === 404) return null;
    throw e;
  }
}

/* ---------------- Cây thư mục ---------------- */

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  children?: TreeNode[]; // undefined khi thư mục chưa nạp
}

interface FlatEntry {
  path: string;
  type: string;
  size?: number;
}

export function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
}

/** Dựng cây từ danh sách phẳng của Git Trees API (recursive=1). */
export function buildTree(entries: FlatEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', type: 'dir', size: 0, children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);
  const ensureDir = (path: string): TreeNode => {
    const hit = dirs.get(path);
    if (hit) return hit;
    const i = path.lastIndexOf('/');
    const parent = ensureDir(i < 0 ? '' : path.slice(0, i));
    const node: TreeNode = { name: path.slice(i + 1), path, type: 'dir', size: 0, children: [] };
    parent.children!.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const e of entries) {
    if (e.type === 'tree') ensureDir(e.path);
    else if (e.type === 'blob') {
      const i = e.path.lastIndexOf('/');
      const parent = ensureDir(i < 0 ? '' : e.path.slice(0, i));
      parent.children!.push({ name: e.path.slice(i + 1), path: e.path, type: 'file', size: e.size ?? 0 });
    }
    // 'commit' (submodule) bỏ qua
  }
  const finish = (n: TreeNode): number => {
    if (n.type === 'file') return n.size;
    sortNodes(n.children!);
    n.size = n.children!.reduce((s, c) => s + finish(c), 0);
    return n.size;
  };
  finish(root);
  return root;
}

export interface FlatTree {
  tree: TreeNode;
  truncated: boolean;
  files: { path: string; size: number }[];
}

export async function getTree(o: string, r: string, ref: string, opts: GhOptions): Promise<FlatTree> {
  const d = await ghJson<{ tree: FlatEntry[]; truncated: boolean }>(
    `/repos/${o}/${r}/git/trees/${encRef(ref)}?recursive=1`,
    opts
  );
  const files = d.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, size: e.size ?? 0 }));
  if (d.truncated) {
    return { tree: { name: '', path: '', type: 'dir', size: 0 }, truncated: true, files };
  }
  return { tree: buildTree(d.tree), truncated: false, files };
}

/** Nạp một thư mục qua contents API (dùng khi cây bị cắt bớt). */
export async function getDirContents(o: string, r: string, ref: string, path: string, opts: GhOptions): Promise<TreeNode[]> {
  const d = await ghJson<{ name: string; path: string; type: string; size: number }[]>(
    `/repos/${o}/${r}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`,
    opts
  );
  if (!Array.isArray(d)) return [];
  const nodes: TreeNode[] = [];
  for (const e of d) {
    if (e.type === 'dir') nodes.push({ name: e.name, path: e.path, type: 'dir', size: 0 });
    else if (e.type === 'file') nodes.push({ name: e.name, path: e.path, type: 'file', size: e.size });
  }
  return sortNodes(nodes);
}

export interface FlatRow {
  node: TreeNode;
  depth: number;
}

/**
 * Làm phẳng cây thành các dòng hiển thị. Khi có `filter`, chỉ giữ file khớp (và thư mục tổ tiên), tự mở rộng.
 */
export function flattenVisible(root: TreeNode, expanded: Set<string>, filter: string): FlatRow[] {
  const q = filter.trim().toLowerCase();
  const rows: FlatRow[] = [];
  const walk = (n: TreeNode, depth: number): boolean => {
    let any = false;
    for (const c of n.children ?? []) {
      if (!q) {
        rows.push({ node: c, depth });
        if (c.type === 'dir' && expanded.has(c.path)) walk(c, depth + 1);
        any = true;
      } else if (c.type === 'file') {
        if (c.path.toLowerCase().includes(q)) {
          rows.push({ node: c, depth });
          any = true;
        }
      } else {
        const idx = rows.length;
        rows.push({ node: c, depth });
        if (walk(c, depth + 1)) any = true;
        else rows.length = idx;
      }
    }
    return any;
  };
  walk(root, 0);
  return rows;
}

/* ---------------- Thống kê ---------------- */

export interface RepoStats {
  fileCount: number;
  totalSize: number;
  largest: { path: string; size: number }[];
  extensions: { ext: string; count: number; size: number }[];
}

export function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const i = name.lastIndexOf('.');
  if (i <= 0) return '(không đuôi)';
  return name.slice(i).toLowerCase();
}

export function computeStats(files: { path: string; size: number }[]): RepoStats {
  let total = 0;
  const ext = new Map<string, { count: number; size: number }>();
  for (const f of files) {
    total += f.size;
    const k = extOf(f.path);
    const cur = ext.get(k) ?? { count: 0, size: 0 };
    cur.count++;
    cur.size += f.size;
    ext.set(k, cur);
  }
  const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 10);
  const extensions = [...ext.entries()]
    .map(([e, v]) => ({ ext: e, ...v }))
    .sort((a, b) => b.count - a.count || b.size - a.size);
  return { fileCount: files.length, totalSize: total, largest, extensions };
}

/* ---------------- Ngôn ngữ ---------------- */

/** Màu đủ tương phản trên nền sáng và tối (màu là nội dung của biểu đồ). */
const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#c9a800', Python: '#3572a5', Java: '#b07219', Go: '#00a4c4',
  Rust: '#c2623a', 'C++': '#d6336c', C: '#6b7280', 'C#': '#2f9e44', HTML: '#e34c26', CSS: '#7048e8',
  SCSS: '#c6538c', Shell: '#4caf50', Ruby: '#cc342d', PHP: '#6c78b8', Swift: '#f05138', Kotlin: '#a97bff',
  Vue: '#41b883', Dart: '#00b4ab', Lua: '#3b3b98', Dockerfile: '#2496ed', Makefile: '#427819',
  Jupyter: '#da5b0b', 'Jupyter Notebook': '#da5b0b', Markdown: '#083fa1', Svelte: '#ff3e00',
};
const FALLBACK = ['#0ea5e9', '#a855f7', '#f59e0b', '#14b8a6', '#ef4444', '#84cc16', '#ec4899', '#64748b'];

export interface LangShare {
  name: string;
  bytes: number;
  percent: number;
  color: string;
}

export function languageShares(langs: Record<string, number>): LangShare[] {
  const total = Object.values(langs).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return Object.entries(langs)
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes], i) => ({
      name,
      bytes,
      percent: (bytes / total) * 100,
      color: LANG_COLORS[name] ?? FALLBACK[i % FALLBACK.length],
    }));
}

/* ---------------- Định dạng & liên kết ---------------- */

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export const rawUrl = (o: string, r: string, ref: string, path: string) =>
  `https://raw.githubusercontent.com/${o}/${r}/${encRef(ref)}/${encPath(path)}`;
export const blobUrl = (o: string, r: string, ref: string, path: string) =>
  `https://github.com/${o}/${r}/blob/${encRef(ref)}/${encPath(path)}`;
export const treeUrl = (o: string, r: string, ref: string, path: string) =>
  `https://github.com/${o}/${r}/tree/${encRef(ref)}/${encPath(path)}`;

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
export const MARKDOWN_EXT = /\.(md|markdown|mdx)$/i;
const BINARY_EXT =
  /\.(zip|gz|tgz|tar|7z|rar|bz2|xz|jar|war|exe|dll|so|dylib|bin|class|o|a|wasm|pdf|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|webm|ogg|wav|psd|sketch|db|sqlite)$/i;
export const isBinaryPath = (p: string) => BINARY_EXT.test(p);

/**
 * Chuyển link tương đối trong README/Markdown thành tuyệt đối.
 * `baseDir` là thư mục chứa file markdown ('' = gốc repo).
 */
export function resolveRelative(
  href: string,
  o: string,
  r: string,
  ref: string,
  baseDir: string,
  kind: 'link' | 'image'
): string {
  if (!href) return href;
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return href;
  const fromRoot = href.startsWith('/');
  const segs = (fromRoot ? [] : baseDir.split('/').filter(Boolean)) as string[];
  for (const part of href.replace(/^\/+/, '').split(/[?#]/)[0].split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  let path = segs.join('/');
  try {
    path = segs.map((s) => decodeURIComponent(s)).join('/');
  } catch {
    /* giữ nguyên */
  }
  const tail = href.includes('#') ? '#' + href.split('#').slice(1).join('#') : '';
  if (kind === 'image') return rawUrl(o, r, ref, path);
  const hasExt = /\.[A-Za-z0-9]+$/.test(path);
  return (hasExt ? blobUrl(o, r, ref, path) : treeUrl(o, r, ref, path)) + tail;
}

export const MAX_PREVIEW_BYTES = 500 * 1024;

export interface PreviewResult {
  kind: 'text' | 'too-large' | 'binary';
  text?: string;
  size?: number;
}

/** Tải raw file; dừng ở 500KB. Trả 'binary' nếu có byte NUL. */
export async function fetchPreview(url: string, signal: AbortSignal): Promise<PreviewResult> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new RepoError('Lỗi mạng khi tải nội dung file.');
  }
  if (!res.ok) throw new RepoError(`Không tải được file (${res.status}).`, res.status);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_PREVIEW_BYTES) return { kind: 'too-large', size: len };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_PREVIEW_BYTES) return { kind: 'too-large', size: buf.length };
  const probe = buf.subarray(0, 8000);
  if (probe.includes(0)) return { kind: 'binary', size: buf.length };
  return { kind: 'text', text: new TextDecoder('utf-8').decode(buf), size: buf.length };
}
