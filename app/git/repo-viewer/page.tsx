'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  SearchCode,
  Star,
  GitFork,
  CircleDot,
  Scale,
  GitBranch,
  Tag,
  Folder,
  FolderOpen,
  File as FileIcon,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Search,
  X,
  Link as LinkIcon,
  GitCommit,
  Package,
  FileText,
  Info,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { Select } from '@/components/ui/searchable-select';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  parseRepoInput,
  RepoError,
  RateInfo,
  RepoInfo,
  CommitItem,
  ReleaseItem,
  Readme,
  TreeNode,
  RepoStats,
  GhOptions,
  getRepo,
  getLanguages,
  getCommits,
  getLatestRelease,
  listRefs,
  getReadme,
  getTree,
  getDirContents,
  computeStats,
  languageShares,
  flattenVisible,
  formatSize,
  formatReset,
  rawUrl,
  blobUrl,
  resolveRelative,
  fetchPreview,
  isBinaryPath,
  IMAGE_EXT,
  MARKDOWN_EXT,
  PreviewResult,
} from '@/lib/repo-viewer';

const SAMPLES = ['sindresorhus/is', 'sindresorhus/slugify', 'lukeed/clsx', 'tj/commander.js'];
const MAX_ROWS = 800;
const MAX_LINES = 5000;

const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('vi-VN') : '—');
const fmtNum = (n: number) => n.toLocaleString('vi-VN');

function errMsg(e: unknown): string {
  if (e instanceof RepoError) return e.message;
  return e instanceof Error ? e.message : 'Đã xảy ra lỗi không xác định.';
}
const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

function Markdown({
  text,
  owner,
  repo,
  gitRef,
  baseDir,
}: {
  text: string;
  owner: string;
  repo: string;
  gitRef: string;
  baseDir: string;
}) {
  return (
    <div className="text-sm text-slate-800 leading-relaxed wrap-break-word [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:pb-1 [&_h1]:border-b [&_h1]:border-slate-200 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-slate-200 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 [&_a]:text-indigo-600 [&_a]:underline [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-[12px] [&_pre]:bg-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_table]:border-collapse [&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-slate-50 [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_img]:max-w-full [&_img]:inline-block [&_hr]:my-4 [&_hr]:border-slate-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(u) => (/^\s*(javascript|data|vbscript):/i.test(u) && !/^data:image\//i.test(u) ? '' : u)}
        components={{
          a: ({ href, children }) => (
            <a
              href={resolveRelative(href ?? '', owner, repo, gitRef, baseDir, 'link')}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveRelative(typeof src === 'string' ? src : '', owner, repo, gitRef, baseDir, 'image')}
              alt={alt ?? ''}
              loading="lazy"
            />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

interface Target {
  owner: string;
  repo: string;
  ref: string; // '' = nhánh mặc định
}

export default function RepoViewerPage() {
  const { keys, showToast } = useApp();
  const token = keys.github || undefined;
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [input, setInput] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [gitRef, setGitRef] = useState('');
  const [rate, setRate] = useState<RateInfo | null>(null);
  const [inputError, setInputError] = useState('');

  const [info, setInfo] = useState<RepoInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [fatal, setFatal] = useState('');
  const [langs, setLangs] = useState<ReturnType<typeof languageShares>>([]);
  const [release, setRelease] = useState<ReleaseItem | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);

  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState('');
  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [readme, setReadme] = useState<Readme | null>(null);
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [, setBump] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [rowLimit, setRowLimit] = useState(MAX_ROWS);

  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const optsFor = useCallback(
    (signal: AbortSignal): GhOptions => ({ token: tokenRef.current, signal, onRate: setRate }),
    []
  );

  const start = useCallback((raw: string, forcedRef?: string) => {
    const p = parseRepoInput(raw);
    if (!p) {
      setInputError('Không nhận ra repo. Hãy nhập dạng owner/repo hoặc link github.com/owner/repo.');
      return;
    }
    setInputError('');
    setInput(`${p.owner}/${p.repo}`);
    const ref = forcedRef ?? p.ref ?? '';
    setGitRef(ref);
    setTarget((t) => (t && t.owner === p.owner && t.repo === p.repo && t.ref === ref ? { ...t } : { owner: p.owner, repo: p.repo, ref }));
  }, []);

  // Khôi phục từ link chia sẻ
  useEffect(() => {
    const sp = readShareParams();
    const r = sp.get('r');
    if (r) {
      start(r, sp.get('ref') || undefined);
    }
  }, [start]);

  // Tầng 1: thông tin repo (theo owner/repo)
  const ownerRepo = target ? `${target.owner}/${target.repo}` : '';
  useEffect(() => {
    if (!target) return;
    const ac = new AbortController();
    const { owner, repo } = target;
    const initialRef = target.ref;
    setInfoLoading(true);
    setFatal('');
    setInfo(null);
    setLangs([]);
    setRelease(null);
    setBranches([]);
    setTags([]);
    setRoot(null);
    setStats(null);
    setCommits([]);
    setReadme(null);
    setSelected(null);
    setRefError('');
    (async () => {
      try {
        const o = optsFor(ac.signal);
        const inf = await getRepo(owner, repo, o);
        if (ac.signal.aborted) return;
        setInfo(inf);
        setInfoLoading(false);
        setGitRef(initialRef || inf.default_branch);
        const soft = <T,>(p: Promise<T>, fb: T) =>
          p.catch((e) => {
            if (isAbort(e)) throw e;
            return fb;
          });
        const [lg, rel, br, tg] = await Promise.all([
          soft(getLanguages(owner, repo, o), {} as Record<string, number>),
          soft(getLatestRelease(owner, repo, o), null),
          soft(listRefs(owner, repo, 'branches', o), [] as string[]),
          soft(listRefs(owner, repo, 'tags', o), [] as string[]),
        ]);
        if (ac.signal.aborted) return;
        setLangs(languageShares(lg));
        setRelease(rel);
        setBranches(br);
        setTags(tg);
      } catch (e) {
        if (isAbort(e)) return;
        setInfoLoading(false);
        setFatal(errMsg(e));
      }
    })();
    return () => ac.abort();
  }, [ownerRepo, target, optsFor]);

  // Tầng 2: cây, commit, README theo nhánh/tag
  useEffect(() => {
    if (!target || !info || !gitRef) return;
    const ac = new AbortController();
    const { owner, repo } = target;
    setRefLoading(true);
    setRefError('');
    setRoot(null);
    setStats(null);
    setCommits([]);
    setReadme(null);
    setExpanded(new Set());
    setFilter('');
    setSelected(null);
    setTruncated(false);
    (async () => {
      try {
        const o = optsFor(ac.signal);
        const treeP = getTree(owner, repo, gitRef, o);
        const commitsP = getCommits(owner, repo, gitRef, o).catch((e) => {
          if (isAbort(e)) throw e;
          return [] as CommitItem[];
        });
        const readmeP = getReadme(owner, repo, gitRef, o).catch((e) => {
          if (isAbort(e)) throw e;
          return null;
        });
        commitsP.catch(() => {});
        readmeP.catch(() => {});
        const t = await treeP;
        if (ac.signal.aborted) return;
        setTruncated(t.truncated);
        if (t.truncated) {
          const kids = await getDirContents(owner, repo, gitRef, '', o);
          if (ac.signal.aborted) return;
          setRoot({ ...t.tree, children: kids });
          setStats(null);
        } else {
          setRoot(t.tree);
          setStats(computeStats(t.files));
        }
        const [cm, rd] = await Promise.all([commitsP, readmeP]);
        if (ac.signal.aborted) return;
        setCommits(cm);
        setReadme(rd);
        setRefLoading(false);
      } catch (e) {
        if (isAbort(e)) return;
        setRefLoading(false);
        setRefError(
          e instanceof RepoError && e.status === 404
            ? `Không tìm thấy nhánh/tag "${gitRef}" trong repo này.`
            : errMsg(e)
        );
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerRepo, gitRef, info, optsFor]);

  // Xem trước file
  const selectedPath = selected;
  useEffect(() => {
    if (!selectedPath || !target || !gitRef) return;
    setPreview(null);
    setPreviewError('');
    if (IMAGE_EXT.test(selectedPath)) {
      setPreviewLoading(false);
      return;
    }
    if (isBinaryPath(selectedPath)) {
      setPreview({ kind: 'binary' });
      setPreviewLoading(false);
      return;
    }
    const ac = new AbortController();
    setPreviewLoading(true);
    fetchPreview(rawUrl(target.owner, target.repo, gitRef, selectedPath), ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return;
        setPreview(r);
        setPreviewLoading(false);
      })
      .catch((e) => {
        if (isAbort(e)) return;
        setPreviewError(errMsg(e));
        setPreviewLoading(false);
      });
    return () => ac.abort();
  }, [selectedPath, target, gitRef]);

  const toggleDir = async (node: TreeNode) => {
    const isOpen = expanded.has(node.path);
    const next = new Set(expanded);
    if (isOpen) next.delete(node.path);
    else next.add(node.path);
    setExpanded(next);
    if (!isOpen && node.children === undefined && target) {
      setLoadingDirs((s) => new Set(s).add(node.path));
      try {
        const ac = new AbortController();
        node.children = await getDirContents(target.owner, target.repo, gitRef, node.path, optsFor(ac.signal));
        setBump((b) => b + 1);
      } catch (e) {
        showToast(errMsg(e));
        setExpanded((s) => {
          const n = new Set(s);
          n.delete(node.path);
          return n;
        });
      } finally {
        setLoadingDirs((s) => {
          const n = new Set(s);
          n.delete(node.path);
          return n;
        });
      }
    }
  };

  const rows = useMemo(
    () => (root ? flattenVisible(root, expanded, filter) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, expanded, filter, root?.children]
  );
  // Khi lọc, cây bị cắt bớt chỉ tìm được trong phần đã nạp
  const shownRows = rows.slice(0, rowLimit);
  const refOptions = useMemo(() => {
    const b = new Set(branches);
    const t = new Set(tags);
    const extra = gitRef && !b.has(gitRef) && !t.has(gitRef) ? [gitRef] : [];
    return { branches: [...extra, ...branches], tags };
  }, [branches, tags, gitRef]);

  const owner = target?.owner ?? '';
  const repoName = target?.repo ?? '';
  const selectedDir = selected && selected.includes('/') ? selected.slice(0, selected.lastIndexOf('/')) : '';
  const readmeDir = readme && readme.path.includes('/') ? readme.path.slice(0, readme.path.lastIndexOf('/')) : '';
  const selectedLines = preview?.kind === 'text' ? preview.text!.split('\n') : [];

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <SearchCode className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Xem nhanh Repo</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Xem cây thư mục, dung lượng, ngôn ngữ, README và commit của repo GitHub công khai mà không cần clone.
            </p>
          </div>
        </div>
        {target && info && <ShareLinkButton params={{ r: `${owner}/${repoName}`, ref: gitRef }} />}
      </div>

      {/* Nhập liệu */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="owner/repo hoặc https://github.com/owner/repo/tree/nhánh"
            aria-label="Repo GitHub"
            className="flex-1 min-w-60 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={infoLoading || !input.trim()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {infoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Xem repo
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500">Thử nhanh:</span>
          {SAMPLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => start(s)}
              className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
            >
              {s}
            </button>
          ))}
          {rate && rate.remaining !== null && (
            <span
              className={`ml-auto ${rate.remaining < 10 ? 'text-red-600' : 'text-slate-500'}`}
              title={rate.reset ? `Đặt lại ${formatReset(rate.reset)}` : undefined}
            >
              API còn {fmtNum(rate.remaining)}
              {rate.limit ? `/${fmtNum(rate.limit)}` : ''} lượt{token ? '' : ' (chưa dùng token)'}
            </span>
          )}
        </div>
        {inputError && <p className="text-xs text-red-600">{inputError}</p>}
      </div>

      {fatal && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex gap-2" role="alert">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{fatal}</span>
        </div>
      )}

      {!target && !fatal && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Nhập một repo GitHub (ví dụ <code className="bg-slate-100 px-1 rounded">sindresorhus/is</code>) để bắt đầu.
        </div>
      )}

      {infoLoading && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải thông tin repo...
        </div>
      )}

      {info && target && (
        <>
          {/* Header repo */}
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <a
                  href={info.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-lg font-bold text-indigo-600 hover:underline break-all"
                >
                  {info.full_name}
                </a>
                {info.archived && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Đã lưu trữ</span>}
                {info.fork && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Fork</span>}
                <p className="text-sm text-slate-600 mt-1">{info.description || 'Không có mô tả.'}</p>
              </div>
              {info.homepage && /^https?:\/\//i.test(info.homepage) && (
                <a
                  href={info.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:underline flex items-center gap-1 break-all"
                >
                  <LinkIcon className="h-3.5 w-3.5 shrink-0" /> {info.homepage}
                </a>
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-600">
              <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-amber-500" /> {fmtNum(info.stargazers_count)} sao</span>
              <span className="flex items-center gap-1"><GitFork className="h-3.5 w-3.5" /> {fmtNum(info.forks_count)} fork</span>
              <span className="flex items-center gap-1"><CircleDot className="h-3.5 w-3.5" /> {fmtNum(info.open_issues_count)} issue/PR mở</span>
              <span className="flex items-center gap-1"><Scale className="h-3.5 w-3.5" /> {info.license ? info.license.name : 'Không có license'}</span>
              <span className="flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" /> Mặc định: {info.default_branch}</span>
              <span>Dung lượng: {formatSize(info.size * 1024)}</span>
              <span>Tạo: {fmtDate(info.created_at)}</span>
              <span>Push gần nhất: {fmtDate(info.pushed_at)}</span>
            </div>
            {info.topics && info.topics.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {info.topics.map((t) => (
                  <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">{t}</span>
                ))}
              </div>
            )}

            {langs.length > 0 && (
              <div>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100" role="img" aria-label="Tỷ lệ ngôn ngữ lập trình">
                  {langs.map((l) => (
                    <div key={l.name} style={{ width: `${l.percent}%`, backgroundColor: l.color }} title={`${l.name} ${l.percent.toFixed(1)}%`} />
                  ))}
                </div>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-700">
                  {langs.map((l) => (
                    <li key={l.name} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                      <span className="font-medium">{l.name}</span>
                      <span className="text-slate-500">{l.percent.toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {release && (
              <div className="flex flex-wrap items-center gap-2 text-xs bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                <Package className="h-4 w-4 text-emerald-600" />
                <span className="text-slate-600">Bản phát hành mới nhất:</span>
                <a href={release.html_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 hover:underline">
                  {release.name || release.tag_name}
                </a>
                <span className="text-slate-500">({release.tag_name}{release.prerelease ? ', pre-release' : ''}) · {fmtDate(release.published_at)}</span>
              </div>
            )}
          </section>

          {/* Chọn nhánh */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4 text-slate-500" />
            <Select
              value={gitRef}
              onChange={(e) => setGitRef(e.target.value)}
              aria-label="Chọn nhánh hoặc tag"
              searchThreshold={0}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-sm max-w-full min-w-40"
            >
              {refOptions.branches.length > 0 && (
                <optgroup label="Nhánh">
                  {refOptions.branches.map((b) => (
                    <option key={`b-${b}`} value={b}>{b}</option>
                  ))}
                </optgroup>
              )}
              {refOptions.tags.length > 0 && (
                <optgroup label="Tag">
                  {refOptions.tags.map((t) => (
                    <option key={`t-${t}`} value={t}>{t}</option>
                  ))}
                </optgroup>
              )}
              {refOptions.branches.length === 0 && refOptions.tags.length === 0 && gitRef && <option value={gitRef}>{gitRef}</option>}
            </Select>
            <Tag className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-xs text-slate-500">
              {branches.length} nhánh, {tags.length} tag{branches.length >= 300 || tags.length >= 300 ? ' (hiển thị tối đa 300)' : ''}
            </span>
            {refLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>

          {refError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex gap-2" role="alert">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{refError}</span>
            </div>
          )}

          {/* Thống kê */}
          {stats && (
            <section className="bg-white rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-800 mb-2">Thống kê</h2>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Số file</div>
                  <div className="text-lg font-bold text-slate-800">{fmtNum(stats.fileCount)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Tổng dung lượng file</div>
                  <div className="text-lg font-bold text-slate-800">{formatSize(stats.totalSize)}</div>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-semibold text-slate-600 mb-1">10 file lớn nhất</h3>
                  <ul className="text-xs divide-y divide-slate-100">
                    {stats.largest.map((f) => (
                      <li key={f.path} className="flex justify-between gap-2 py-1">
                        <button type="button" onClick={() => setSelected(f.path)} className="text-left text-indigo-600 hover:underline truncate" title={f.path}>
                          {f.path}
                        </button>
                        <span className="text-slate-500 shrink-0">{formatSize(f.size)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-600 mb-1">Theo đuôi file (top 10)</h3>
                  <ul className="text-xs divide-y divide-slate-100">
                    {stats.extensions.slice(0, 10).map((x) => (
                      <li key={x.ext} className="flex justify-between gap-2 py-1">
                        <span className="font-mono text-slate-700">{x.ext}</span>
                        <span className="text-slate-500">{fmtNum(x.count)} file · {formatSize(x.size)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {/* Cây thư mục + xem trước */}
          {(root || refLoading) && (
            <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50">
                <h2 className="text-sm font-bold text-slate-800 mr-auto">Cây thư mục</h2>
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setRowLimit(MAX_ROWS);
                    }}
                    placeholder="Lọc theo tên/đường dẫn..."
                    aria-label="Lọc file"
                    className="pl-7 pr-7 py-1 text-xs border border-slate-300 rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {filter && (
                    <button type="button" onClick={() => setFilter('')} aria-label="Xóa bộ lọc" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {truncated && (
                <div className="px-3 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-100 flex gap-2">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>
                    Repo quá lớn nên GitHub chỉ trả về cây bị cắt bớt. Các thư mục được nạp dần khi bạn mở; thống kê tổng và bộ lọc chỉ áp dụng cho phần đã nạp.
                  </span>
                </div>
              )}
              <div className={`grid ${selected ? 'lg:grid-cols-2' : ''}`}>
                <div className="min-w-0 overflow-x-auto text-sm">
                  {refLoading && !root && (
                    <div className="p-4 text-xs text-slate-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải cây thư mục...</div>
                  )}
                  {root && rows.length === 0 && (
                    <div className="p-4 text-xs text-slate-500">{filter ? 'Không có file nào khớp bộ lọc.' : 'Thư mục trống.'}</div>
                  )}
                  <ul role="tree">
                    {shownRows.map(({ node, depth }) => {
                      const open = expanded.has(node.path) || (!!filter && node.type === 'dir');
                      const isSel = selected === node.path;
                      return (
                        <li
                          key={node.path}
                          role="treeitem"
                          aria-expanded={node.type === 'dir' ? open : undefined}
                          aria-selected={isSel}
                          className={`group flex items-center gap-1 pr-2 py-0.5 hover:bg-slate-50 ${isSel ? 'bg-indigo-50' : ''}`}
                          style={{ paddingLeft: 8 + depth * 16 }}
                        >
                          <button
                            type="button"
                            className="flex items-center gap-1.5 flex-1 min-w-0 text-left py-0.5"
                            onClick={() => (node.type === 'dir' ? toggleDir(node) : setSelected(node.path))}
                          >
                            {node.type === 'dir' ? (
                              <>
                                {loadingDirs.has(node.path) ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-slate-400" />
                                ) : open ? (
                                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                )}
                                {open ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" /> : <Folder className="h-4 w-4 shrink-0 text-amber-500" />}
                              </>
                            ) : (
                              <>
                                <span className="w-3.5 shrink-0" />
                                <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />
                              </>
                            )}
                            <span className="truncate text-slate-800" title={node.path}>{filter && node.type === 'file' ? node.path : node.name}</span>
                          </button>
                          {(node.type === 'file' || !truncated) && node.size > 0 && (
                            <span className="text-[11px] text-slate-400 shrink-0">{formatSize(node.size)}</span>
                          )}
                          <span className="hidden group-hover:flex items-center gap-1.5 shrink-0">
                            {node.type === 'file' && (
                              <>
                                <a href={blobUrl(owner, repoName, gitRef, node.path)} target="_blank" rel="noopener noreferrer" title="Mở trên GitHub" aria-label="Mở trên GitHub" className="text-slate-400 hover:text-indigo-600">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                                <a href={rawUrl(owner, repoName, gitRef, node.path)} target="_blank" rel="noopener noreferrer" title="Mở bản raw" aria-label="Mở bản raw" className="text-slate-400 hover:text-indigo-600">
                                  <FileText className="h-3.5 w-3.5" />
                                </a>
                              </>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {rows.length > rowLimit && (
                    <button type="button" onClick={() => setRowLimit((n) => n + MAX_ROWS)} className="w-full py-2 text-xs text-indigo-600 hover:bg-slate-50">
                      Hiển thị thêm ({fmtNum(rows.length - rowLimit)} mục còn lại)
                    </button>
                  )}
                </div>

                {selected && (
                  <div className="border-t lg:border-t-0 lg:border-l border-slate-200 min-w-0 flex flex-col">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs">
                      <span className="font-mono truncate mr-auto" title={selected}>{selected}</span>
                      <a href={blobUrl(owner, repoName, gitRef, selected)} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline shrink-0">GitHub</a>
                      <a href={rawUrl(owner, repoName, gitRef, selected)} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline shrink-0">Raw</a>
                      <button type="button" onClick={() => setSelected(null)} aria-label="Đóng xem trước" className="text-slate-400 hover:text-slate-700">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="overflow-x-auto flex-1">
                      {previewLoading && <div className="p-4 text-xs text-slate-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải file...</div>}
                      {previewError && <div className="p-4 text-xs text-red-600">{previewError}</div>}
                      {IMAGE_EXT.test(selected) && (
                        <div className="p-3 bg-slate-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={rawUrl(owner, repoName, gitRef, selected)} alt={selected} className="max-w-full h-auto mx-auto" />
                        </div>
                      )}
                      {preview?.kind === 'binary' && <div className="p-4 text-xs text-slate-500">File nhị phân, không thể xem trước. Dùng liên kết Raw để tải về.</div>}
                      {preview?.kind === 'too-large' && (
                        <div className="p-4 text-xs text-slate-500">File quá lớn để xem trước ({formatSize(preview.size ?? 0)} &gt; 500 KB). Hãy mở trên GitHub hoặc xem bản Raw.</div>
                      )}
                      {preview?.kind === 'text' && MARKDOWN_EXT.test(selected) && (
                        <div className="p-4">
                          <Markdown text={preview.text!} owner={owner} repo={repoName} gitRef={gitRef} baseDir={selectedDir} />
                        </div>
                      )}
                      {preview?.kind === 'text' && !MARKDOWN_EXT.test(selected) && (
                        <div className="font-mono text-[12px] leading-5 min-w-max">
                          {selectedLines.slice(0, MAX_LINES).map((ln, i) => (
                            <div key={i} className="flex">
                              <span className="select-none text-right text-slate-400 bg-slate-50 px-2 w-12 shrink-0 sticky left-0">{i + 1}</span>
                              <pre className="px-3 whitespace-pre text-slate-800">{ln || ' '}</pre>
                            </div>
                          ))}
                          {selectedLines.length > MAX_LINES && (
                            <div className="p-3 text-xs text-slate-500 font-sans">Đã hiển thị {fmtNum(MAX_LINES)}/{fmtNum(selectedLines.length)} dòng đầu.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Commit gần đây */}
          {commits.length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5"><GitCommit className="h-4 w-4" /> Commit gần đây ({gitRef})</h2>
              <ul className="divide-y divide-slate-100">
                {commits.map((c) => (
                  <li key={c.sha} className="py-1.5 flex flex-wrap items-baseline gap-x-3 text-xs">
                    <a href={c.html_url} target="_blank" rel="noopener noreferrer" className="font-mono text-indigo-600 hover:underline">{c.sha.slice(0, 7)}</a>
                    <span className="text-slate-800 truncate flex-1 min-w-48">{c.commit.message.split('\n')[0]}</span>
                    <span className="text-slate-500">{c.author?.login ?? c.commit.author?.name ?? '—'} · {fmtDate(c.commit.author?.date)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* README */}
          {readme && (
            <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <FileText className="h-4 w-4" /> {readme.name}
              </div>
              <div className="p-4">
                <Markdown text={readme.text} owner={owner} repo={repoName} gitRef={gitRef} baseDir={readmeDir} />
              </div>
            </section>
          )}
          {!refLoading && !refError && root && !readme && (
            <p className="text-xs text-slate-500">Repo này không có README.</p>
          )}
        </>
      )}
    </div>
  );
}
