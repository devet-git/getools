'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  NotebookText,
  Copy,
  Download,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  RotateCcw,
  FolderTree,
  Eye,
  FileCode2,
  Trash2,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import { wrapForReadme } from '@/lib/tree-gen';
import {
  BADGE_DEFS,
  BADGE_STYLES,
  PROJECT_TYPES,
  SECTION_LABEL,
  SECTION_ORDER,
  badgeHtml,
  badgeMarkdown,
  badgeNeedMet,
  buildReadme,
  defaultEnabled,
  defaultStack,
  dynamicBadgeUrl,
  normalizeColor,
  sectionTemplate,
  slugName,
  staticBadgeUrl,
  type Badge,
  type BadgeCtx,
  type BadgeStyle,
  type Lang,
  type ProjectCtx,
  type ProjectType,
  type SectionId,
} from '@/lib/readme-builder';

import { SendToButton } from '@/components/SendToButton';
const DRAFT_KEY = 'getools:readme-builder:draft';
const TREE_KEY = 'getools:readme-builder:tree';

const inputCls =
  'w-full px-2 py-1 text-xs border border-slate-200 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const btn =
  'px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1 disabled:opacity-40';
const card = 'bg-white border border-slate-200 rounded-xl p-3 space-y-2';

const PREVIEW_CLASS =
  'max-w-none text-slate-800 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-extrabold [&_h1]:border-b [&_h1]:border-slate-200 [&_h1]:pb-1.5 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:border-b [&_h2]:border-slate-100 [&_h2]:pb-1 [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h4]:font-bold [&_h4]:mt-3 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 [&_ul.contains-task-list]:list-none [&_ul.contains-task-list]:pl-1 [&_li>input]:mr-2 [&_a]:text-indigo-600 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_code]:bg-slate-100 [&_code]:text-indigo-700 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.85em] [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-3 [&_pre_code]:bg-transparent [&_pre_code]:text-slate-100 [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_th]:bg-slate-100 [&_th]:p-2 [&_th]:border [&_th]:border-slate-200 [&_td]:p-2 [&_td]:border [&_td]:border-slate-200 [&_img]:inline-block [&_img]:max-w-full [&_img]:h-auto [&_p>img]:mr-1 [&_hr]:my-5 break-words';

type SelectedBadge =
  | { key: string; defId: string }
  | { key: string; custom: { label: string; message: string; color: string; logo: string; logoColor: string; style: BadgeStyle } };

interface Draft {
  type: ProjectType;
  lang: Lang;
  name: string;
  repo: string;
  description: string;
  stack: string[];
  license: string;
  order: SectionId[];
  enabled: Partial<Record<SectionId, boolean>>;
  edits: Partial<Record<SectionId, string>>;
  badges: SelectedBadge[];
  badgeStyle: BadgeStyle;
  extra: { npm: string; pypi: string; crate: string; docker: string; workflow: string; branch: string };
}

function enabledMap(type: ProjectType): Partial<Record<SectionId, boolean>> {
  return Object.fromEntries(defaultEnabled(type).map((i) => [i, true]));
}

function BadgeImg({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="text-[10px] text-red-600">Không tải được ảnh badge</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className="h-5 max-w-full" loading="lazy" onError={() => setFailed(true)} />;
}

export default function ReadmeBuilderPage() {
  const { showToast } = useApp();
  const [type, setType] = useState<ProjectType>('node');
  const [lang, setLang] = useState<Lang>('vi');
  const [name, setName] = useState('My Project');
  const [repo, setRepo] = useState('');
  const [description, setDescription] = useState('');
  const [stack, setStack] = useState<string[]>(defaultStack('node'));
  const [stackInput, setStackInput] = useState('');
  const [license, setLicense] = useState('MIT');
  const [order, setOrder] = useState<SectionId[]>(SECTION_ORDER);
  const [enabled, setEnabled] = useState<Partial<Record<SectionId, boolean>>>(enabledMap('node'));
  const [edits, setEdits] = useState<Partial<Record<SectionId, string>>>({});
  const [open, setOpen] = useState<SectionId | null>(null);
  const [badges, setBadges] = useState<SelectedBadge[]>([]);
  const [badgeStyle, setBadgeStyle] = useState<BadgeStyle>('flat');
  const [extra, setExtra] = useState({ npm: '', pypi: '', crate: '', docker: '', workflow: 'ci.yml', branch: '' });
  const [custom, setCustom] = useState({ label: 'build', message: 'passing', color: 'brightgreen', logo: '', logoColor: 'white' });
  const [view, setView] = useState<'preview' | 'markdown'>('preview');
  const [hydrated, setHydrated] = useState(false);

  // Khôi phục bản nháp và link chia sẻ (đọc sau khi mount để tránh lệch hydration)
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<Draft>;
        if (d.type && PROJECT_TYPES.some((t) => t.id === d.type)) setType(d.type);
        if (d.lang === 'vi' || d.lang === 'en') setLang(d.lang);
        if (typeof d.name === 'string') setName(d.name.slice(0, 200));
        if (typeof d.repo === 'string') setRepo(d.repo.slice(0, 200));
        if (typeof d.description === 'string') setDescription(d.description.slice(0, 2000));
        if (Array.isArray(d.stack)) setStack(d.stack.filter((s) => typeof s === 'string').slice(0, 30));
        if (typeof d.license === 'string') setLicense(d.license.slice(0, 100));
        if (Array.isArray(d.order) && d.order.length === SECTION_ORDER.length && SECTION_ORDER.every((s) => d.order?.includes(s))) setOrder(d.order);
        if (d.enabled && typeof d.enabled === 'object') setEnabled(d.enabled);
        if (d.edits && typeof d.edits === 'object') setEdits(d.edits);
        if (Array.isArray(d.badges)) setBadges(d.badges.slice(0, 40));
        if (d.badgeStyle && BADGE_STYLES.includes(d.badgeStyle)) setBadgeStyle(d.badgeStyle);
        if (d.extra && typeof d.extra === 'object') setExtra((e) => ({ ...e, ...d.extra }));
      }
    } catch {
      /* bỏ qua bản nháp hỏng */
    }
    const q = readShareParams();
    const qt = q.get('type') as ProjectType | null;
    if (qt && PROJECT_TYPES.some((t) => t.id === qt)) {
      setType(qt);
      if (!localStorage_has()) {
        setStack(defaultStack(qt));
        setEnabled(enabledMap(qt));
      }
    }
    const ql = q.get('lang');
    if (ql === 'vi' || ql === 'en') setLang(ql);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const d: Draft = { type, lang, name, repo, description, stack, license, order, enabled, edits, badges, badgeStyle, extra };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* bỏ qua */
    }
  }, [hydrated, type, lang, name, repo, description, stack, license, order, enabled, edits, badges, badgeStyle, extra]);

  const ctx: ProjectCtx = useMemo(
    () => ({ name, repo: repo.trim(), description, stack, license, type, lang }),
    [name, repo, description, stack, license, type, lang]
  );

  const badgeCtx: BadgeCtx = useMemo(
    () => ({
      repo: repo.trim(),
      npm: extra.npm || slugName(name),
      pypi: extra.pypi || slugName(name),
      crate: extra.crate || slugName(name),
      docker: extra.docker || (repo.trim() ? repo.trim().toLowerCase() : ''),
      workflow: extra.workflow,
      branch: extra.branch,
    }),
    [repo, name, extra]
  );

  const resolveBadge = useCallback(
    (b: SelectedBadge): Badge | null => {
      if ('defId' in b) {
        const def = BADGE_DEFS.find((d) => d.id === b.defId);
        if (!def || !badgeNeedMet(def.need, badgeCtx)) return null;
        return { key: b.key, alt: def.title, url: dynamicBadgeUrl(def, badgeCtx, badgeStyle), link: def.link(badgeCtx) };
      }
      const c = b.custom;
      return {
        key: b.key,
        alt: c.label ? `${c.label}: ${c.message}` : c.message,
        url: staticBadgeUrl(c.label, c.message, c.color, { style: c.style, logo: c.logo, logoColor: c.logoColor }),
      };
    },
    [badgeCtx, badgeStyle]
  );

  const resolved = useMemo(() => badges.map((b) => ({ sel: b, badge: resolveBadge(b) })), [badges, resolveBadge]);
  const badgesMd = useMemo(
    () => resolved.filter((r) => r.badge).map((r) => badgeMarkdown(r.badge as Badge)).join(' '),
    [resolved]
  );

  const templates = useMemo(() => {
    const out = {} as Record<SectionId, string>;
    for (const id of SECTION_ORDER) out[id] = sectionTemplate(id, ctx);
    return out;
  }, [ctx]);

  const bodyOf = (id: SectionId) => (id === 'badges' ? badgesMd : edits[id] ?? templates[id]);

  const readme = useMemo(() => {
    const bodies = {} as Record<SectionId, string>;
    for (const id of SECTION_ORDER) bodies[id] = id === 'badges' ? badgesMd : edits[id] ?? templates[id];
    return buildReadme({ ctx, order, enabled, bodies });
  }, [ctx, order, enabled, edits, templates, badgesMd]);
  const deferredReadme = useDeferredValue(readme);

  const changeType = (t: ProjectType) => {
    setType(t);
    setStack(defaultStack(t));
    setEnabled(enabledMap(t));
  };

  const move = (id: SectionId, dir: -1 | 1) => {
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const n = [...o];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };

  const addStack = () => {
    const v = stackInput.trim().slice(0, 40);
    if (v && !stack.includes(v) && stack.length < 30) setStack([...stack, v]);
    setStackInput('');
  };

  const addBadge = (sel: Omit<SelectedBadge, 'key'>) => {
    if (badges.length >= 40) {
      showToast('Tối đa 40 badge.');
      return;
    }
    setBadges((b) => [...b, { ...sel, key: Math.random().toString(36).slice(2, 9) } as SelectedBadge]);
  };

  const copy = async (text: string, msg = 'Đã sao chép!') => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(msg);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const downloadReadme = () => {
    const url = URL.createObjectURL(new Blob([readme], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'README.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTree = (id: SectionId) => {
    let t: string | null = null;
    try {
      t = localStorage.getItem(TREE_KEY);
    } catch {
      /* bỏ qua */
    }
    if (!t) {
      showToast('Chưa có sơ đồ nào. Hãy dùng công cụ “Sơ đồ cây thư mục” và bấm “Chèn vào README”.');
      return;
    }
    setEdits((e) => ({ ...e, [id]: wrapForReadme(t as string, false).trim() }));
    showToast('Đã lấy sơ đồ cây gần nhất.');
  };

  const resetAll = () => {
    setEdits({});
    setEnabled(enabledMap(type));
    setOrder(SECTION_ORDER);
    showToast('Đã đặt lại các mục về mẫu.');
  };

  const customBadge = useMemo<Badge>(
    () => ({
      key: 'custom',
      alt: custom.label ? `${custom.label}: ${custom.message}` : custom.message,
      url: staticBadgeUrl(custom.label, custom.message, custom.color, { style: badgeStyle, logo: custom.logo, logoColor: custom.logoColor }),
    }),
    [custom, badgeStyle]
  );
  const groups = useMemo(() => {
    const g = new Map<string, typeof BADGE_DEFS>();
    for (const d of BADGE_DEFS) g.set(d.group, [...(g.get(d.group) ?? []), d]);
    return Array.from(g.entries());
  }, []);
  const selectedList = resolved.filter((r) => r.badge) as { sel: SelectedBadge; badge: Badge }[];

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <NotebookText className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Tạo README & Badge</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Dựng README theo từng mục (bật/tắt, sắp xếp, sửa nội dung) và tạo badge shields.io. Bản nháp được lưu trong trình duyệt.
            </p>
          </div>
        </div>
        <ShareLinkButton params={{ type, lang }} />
      </div>

      <div className="grid xl:grid-cols-2 gap-3.5 items-start">
        <div className="space-y-3.5 min-w-0">
          {/* PROJECT */}
          <div className={card}>
            <h2 className="text-xs font-bold text-slate-700">Thông tin dự án</h2>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-[11px] text-slate-600 space-y-1">
                <span>Loại dự án</span>
                <select className={inputCls} value={type} onChange={(e) => changeType(e.target.value as ProjectType)}>
                  {PROJECT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-slate-600 space-y-1">
                <span>Ngôn ngữ README</span>
                <select className={inputCls} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="text-[11px] text-slate-600 space-y-1">
                <span>Tên dự án</span>
                <input className={inputCls} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="text-[11px] text-slate-600 space-y-1">
                <span>GitHub (owner/repo)</span>
                <input className={inputCls} value={repo} placeholder="octocat/hello-world" onChange={(e) => setRepo(e.target.value)} />
              </label>
              <label className="text-[11px] text-slate-600 space-y-1 sm:col-span-2">
                <span>Mô tả ngắn</span>
                <textarea rows={2} className={inputCls} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="text-[11px] text-slate-600 space-y-1">
                <span>Giấy phép</span>
                <input className={inputCls} value={license} list="rb-licenses" onChange={(e) => setLicense(e.target.value)} />
                <datalist id="rb-licenses">
                  {['MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'Unlicense'].map((l) => <option key={l} value={l} />)}
                </datalist>
              </label>
              <div className="text-[11px] text-slate-600 space-y-1">
                <span>Công nghệ (Enter để thêm)</span>
                <input className={inputCls} value={stackInput} placeholder="Ví dụ: PostgreSQL"
                  onChange={(e) => setStackInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStack(); } }} />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {stack.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {s}
                  <button type="button" aria-label={`Xóa ${s}`} onClick={() => setStack(stack.filter((x) => x !== s))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          </div>

          {/* BADGES */}
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-bold text-slate-700">Badge shields.io</h2>
              <div className="flex gap-1">
                {BADGE_STYLES.map((s) => (
                  <button key={s} type="button" onClick={() => setBadgeStyle(s)}
                    className={`px-2 py-0.5 rounded-md text-[11px] border ${badgeStyle === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {([
                ['npm', 'Gói npm'], ['pypi', 'Gói PyPI'], ['crate', 'Crate'], ['docker', 'Docker (user/image)'],
                ['workflow', 'File workflow'], ['branch', 'Nhánh (tùy chọn)'],
              ] as [keyof typeof extra, string][]).map(([k, label]) => (
                <label key={k} className="text-[11px] text-slate-600 space-y-1">
                  <span>{label}</span>
                  <input className={inputCls} value={extra[k]} placeholder={k === 'workflow' ? 'ci.yml' : slugName(name)}
                    onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} />
                </label>
              ))}
            </div>
            {!badgeNeedMet('repo', badgeCtx) && (
              <p className="text-[11px] text-amber-700">Nhập GitHub (owner/repo) ở trên để dùng các badge GitHub và Docker.</p>
            )}
            <div className="space-y-2">
              {groups.map(([group, defs]) => (
                <div key={group}>
                  <div className="text-[11px] font-semibold text-slate-500 mb-1">{group}</div>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {defs.map((d) => {
                      const ok = badgeNeedMet(d.need, badgeCtx);
                      return (
                        <div key={d.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-2 py-1">
                          <div className="min-w-0">
                            <div className="text-[11px] text-slate-600">{d.title}</div>
                            {ok ? <BadgeImg key={dynamicBadgeUrl(d, badgeCtx, badgeStyle)} url={dynamicBadgeUrl(d, badgeCtx, badgeStyle)} alt={d.title} /> : <span className="text-[10px] text-slate-400">Thiếu thông tin</span>}
                          </div>
                          <button type="button" className={btn} disabled={!ok} onClick={() => addBadge({ defId: d.id })} title="Thêm vào README">
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-2 space-y-2">
              <div className="text-[11px] font-semibold text-slate-500">Badge tùy chỉnh (static)</div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {([
                  ['label', 'Nhãn'], ['message', 'Nội dung'], ['color', 'Màu (tên hoặc hex)'], ['logo', 'Logo (vd: github)'], ['logoColor', 'Màu logo'],
                ] as [keyof typeof custom, string][]).map(([k, label]) => (
                  <label key={k} className="text-[11px] text-slate-600 space-y-1">
                    <span>{label}</span>
                    <input className={inputCls} value={custom[k]} onChange={(e) => setCustom({ ...custom, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
              {custom.color && !normalizeColor(custom.color) && (
                <p className="text-[11px] text-amber-700">Màu không hợp lệ, sẽ dùng màu “blue”.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <BadgeImg key={customBadge.url} url={customBadge.url} alt={customBadge.alt} />
                <button type="button" className={btn} onClick={() => addBadge({ custom: { ...custom, style: badgeStyle } })}>
                  <Plus className="h-3.5 w-3.5" /> Thêm vào README
                </button>
                <button type="button" className={btn} onClick={() => copy(badgeMarkdown(customBadge))}>Markdown</button>
                <button type="button" className={btn} onClick={() => copy(badgeHtml(customBadge))}>HTML</button>
                <button type="button" className={btn} onClick={() => copy(customBadge.url)}>URL</button>
              </div>
              <p className="text-[11px] text-slate-500 break-all font-mono">{customBadge.url}</p>
            </div>

            <div className="border-t border-slate-100 pt-2 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-slate-500">Đã chọn ({selectedList.length})</div>
                <div className="flex gap-1.5">
                  <button type="button" className={btn} disabled={!selectedList.length} onClick={() => copy(selectedList.map((r) => badgeMarkdown(r.badge)).join('\n'))}>Markdown</button>
                  <button type="button" className={btn} disabled={!selectedList.length} onClick={() => copy(selectedList.map((r) => badgeHtml(r.badge)).join('\n'))}>HTML</button>
                  <button type="button" className={btn} disabled={!selectedList.length} onClick={() => copy(selectedList.map((r) => r.badge.url).join('\n'))}>URL</button>
                  <button type="button" className={btn} disabled={!badges.length} onClick={() => setBadges([])}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              {selectedList.length === 0 ? (
                <p className="text-[11px] text-slate-400">Chưa chọn badge nào. Bấm dấu + ở bên trên để thêm.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selectedList.map(({ sel, badge }, i) => (
                    <span key={sel.key} className="inline-flex items-center gap-1 border border-slate-200 rounded-md px-1.5 py-0.5 bg-slate-50">
                      <BadgeImg key={badge.url} url={badge.url} alt={badge.alt} />
                      <button type="button" aria-label="Lên trước" disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        onClick={() => setBadges((b) => { const k = b.findIndex((x) => x.key === sel.key); if (k <= 0) return b; const n = [...b]; [n[k - 1], n[k]] = [n[k], n[k - 1]]; return n; })}>
                        <ArrowUp className="h-3 w-3 -rotate-90" />
                      </button>
                      <button type="button" aria-label="Xuống sau" disabled={i === selectedList.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        onClick={() => setBadges((b) => { const k = b.findIndex((x) => x.key === sel.key); if (k < 0 || k >= b.length - 1) return b; const n = [...b]; [n[k + 1], n[k]] = [n[k], n[k + 1]]; return n; })}>
                        <ArrowDown className="h-3 w-3 -rotate-90" />
                      </button>
                      <button type="button" aria-label="Xóa badge" className="text-slate-400 hover:text-red-600" onClick={() => setBadges((b) => b.filter((x) => x.key !== sel.key))}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* SECTIONS */}
          <div className={card}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-bold text-slate-700">Các mục README</h2>
              <button type="button" className={btn} onClick={resetAll}><RotateCcw className="h-3.5 w-3.5" /> Đặt lại tất cả</button>
            </div>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {order.map((id, i) => {
                const on = !!enabled[id];
                const isOpen = open === id;
                return (
                  <div key={id}>
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <input type="checkbox" checked={on} aria-label={`Bật ${SECTION_LABEL[id]}`} onChange={(e) => setEnabled({ ...enabled, [id]: e.target.checked })} />
                      <button type="button" className="flex-1 min-w-0 flex items-center gap-1 text-left text-xs text-slate-800" onClick={() => setOpen(isOpen ? null : id)}>
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                        <span className={`truncate ${on ? '' : 'text-slate-400'}`}>{SECTION_LABEL[id]}</span>
                        {edits[id] !== undefined && <span className="text-[10px] text-amber-600 shrink-0">đã sửa</span>}
                      </button>
                      <button type="button" aria-label="Lên" disabled={i === 0} className="p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-30" onClick={() => move(id, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" aria-label="Xuống" disabled={i === order.length - 1} className="p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-30" onClick={() => move(id, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
                    </div>
                    {isOpen && (
                      <div className="px-2 pb-2 space-y-1.5">
                        {id === 'toc' ? (
                          <p className="text-[11px] text-slate-500">Mục lục được tạo tự động từ các tiêu đề (cấp 2 và 3) của README, theo quy tắc anchor của GitHub.</p>
                        ) : id === 'badges' ? (
                          <p className="text-[11px] text-slate-500">Nội dung lấy từ phần “Badge shields.io” ở trên.</p>
                        ) : (
                          <>
                            <textarea rows={id === 'title' ? 3 : 8} spellCheck={false} className={inputCls + ' font-mono'}
                              value={bodyOf(id)}
                              onChange={(e) => setEdits({ ...edits, [id]: e.target.value })} />
                            <div className="flex flex-wrap gap-1.5">
                              <button type="button" className={btn} disabled={edits[id] === undefined}
                                onClick={() => setEdits((e) => { const n = { ...e }; delete n[id]; return n; })}>
                                <RotateCcw className="h-3.5 w-3.5" /> Đặt lại theo mẫu
                              </button>
                              {id === 'structure' && (
                                <button type="button" className={btn} onClick={() => importTree(id)}>
                                  <FolderTree className="h-3.5 w-3.5" /> Lấy từ Sơ đồ cây thư mục
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500">
              Mẹo: ở mục “Cấu trúc thư mục”, tạo sơ đồ bằng công cụ Sơ đồ cây thư mục, bấm “Chèn vào README” rồi quay lại đây và bấm “Lấy từ Sơ đồ cây thư mục”.
            </p>
          </div>
        </div>

        {/* OUTPUT */}
        <div className="xl:sticky xl:top-3 min-w-0">
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1">
                <button type="button" onClick={() => setView('preview')} className={`${btn} ${view === 'preview' ? '!bg-indigo-600 !text-white !border-indigo-600' : ''}`}><Eye className="h-3.5 w-3.5" /> Xem trước</button>
                <button type="button" onClick={() => setView('markdown')} className={`${btn} ${view === 'markdown' ? '!bg-indigo-600 !text-white !border-indigo-600' : ''}`}><FileCode2 className="h-3.5 w-3.5" /> Markdown</button>
              </div>
              <div className="flex gap-1.5">
                <SendToButton text={readme} fromToolId="readme-builder" />
                <button type="button" className={btn} onClick={() => copy(readme, 'Đã sao chép README!')}><Copy className="h-3.5 w-3.5" /> Sao chép</button>
                <button type="button" className={btn} onClick={downloadReadme}><Download className="h-3.5 w-3.5" /> README.md</button>
              </div>
            </div>
            <div className="border border-slate-200 rounded-lg overflow-auto max-h-[75vh] bg-white p-3">
              {view === 'preview' ? (
                <div className={PREVIEW_CLASS}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredReadme}</ReactMarkdown>
                </div>
              ) : (
                <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-words">{readme}</pre>
              )}
            </div>
            <p className="text-[11px] text-slate-500">Badge hiển thị ảnh từ img.shields.io nên cần kết nối mạng để xem trước.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function localStorage_has(): boolean {
  try {
    return localStorage.getItem(DRAFT_KEY) !== null;
  } catch {
    return false;
  }
}
