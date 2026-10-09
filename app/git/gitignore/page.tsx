'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileMinus, Copy, Download, RefreshCw, Search, X, Check, AlertTriangle } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  GITIGNORE_TEMPLATES,
  CATEGORY_LABEL,
  GitignoreCategory,
  GitignoreSection,
  SectionSource,
  fetchOfficialTemplate,
  findTemplate,
  mergeGitignore,
} from '@/lib/gitignore-templates';
import { LICENSE_TEMPLATES, renderLicense } from '@/lib/license-templates';

type Tab = 'gitignore' | 'license';

const SOURCE_LABEL: Record<SectionSource, string> = {
  builtin: 'Mẫu dựng sẵn',
  github: 'GitHub (mới nhất)',
  'builtin-fallback': 'Dựng sẵn (không tải được GitHub)',
};

function norm(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();
}

function saveFile(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function GitignorePage() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<Tab>('gitignore');

  // .gitignore
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // LICENSE
  const [licId, setLicId] = useState('mit');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [holder, setHolder] = useState('');

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const p = readShareParams();
    const t = p.get('tab');
    if (t === 'license') setTab('license');
    const sel = (p.get('t') || '').split(',').filter((id) => findTemplate(id));
    if (sel.length) setSelected(sel);
    const l = p.get('lic');
    if (l && LICENSE_TEMPLATES.some((x) => x.id === l)) setLicId(l);
    const y = p.get('year');
    if (y && /^[\d\-, ]{1,20}$/.test(y)) setYear(y);
    const h = p.get('holder');
    if (h) setHolder(h.slice(0, 100));
    return () => abortRef.current?.abort();
  }, []);

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return GITIGNORE_TEMPLATES.filter((t) => !q || norm(t.name).includes(q) || t.id.includes(q));
  }, [query]);

  const grouped = useMemo(() => {
    const m = new Map<GitignoreCategory, typeof filtered>();
    for (const t of filtered) {
      const arr = m.get(t.category) ?? [];
      arr.push(t);
      m.set(t.category, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const sections: GitignoreSection[] = useMemo(() => {
    return selected.flatMap((id) => {
      const tpl = findTemplate(id);
      if (!tpl) return [];
      const r = remote[id];
      const source: SectionSource = r ? 'github' : failed.includes(id) ? 'builtin-fallback' : 'builtin';
      return [{ name: tpl.name, source, content: r ?? tpl.content }];
    });
  }, [selected, remote, failed]);

  const merged = useMemo(() => mergeGitignore(sections), [sections]);

  const refresh = async () => {
    if (!selected.length) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setFetching(true);
    const nextRemote: Record<string, string> = {};
    const nextFailed: string[] = [];
    await Promise.all(
      selected.map(async (id) => {
        const tpl = findTemplate(id);
        if (!tpl) return;
        const txt = await fetchOfficialTemplate(tpl, ac.signal);
        if (txt) nextRemote[id] = txt;
        else nextFailed.push(id);
      })
    );
    if (ac.signal.aborted) return;
    setRemote((r) => ({ ...r, ...nextRemote }));
    setFailed(nextFailed);
    setFetching(false);
    const ok = Object.keys(nextRemote).length;
    showToast(
      ok === selected.length
        ? 'Đã làm mới từ GitHub.'
        : `Tải được ${ok}/${selected.length} mẫu từ GitHub, phần còn lại dùng mẫu dựng sẵn.`
    );
  };

  const lic = LICENSE_TEMPLATES.find((l) => l.id === licId) ?? LICENSE_TEMPLATES[0];
  const licText = useMemo(() => renderLicense(lic, year, holder), [lic, year, holder]);

  const output = tab === 'gitignore' ? merged.text : licText;
  const filename = tab === 'gitignore' ? '.gitignore' : 'LICENSE';

  const handleCopy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      showToast('Đã sao chép!');
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const handleDownload = () => {
    if (!output) return;
    saveFile(output, filename);
  };

  const btn =
    'px-2.5 py-1 rounded-lg text-xs font-medium border transition flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed';
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <FileMinus className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">.gitignore &amp; LICENSE</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Gộp nhiều mẫu .gitignore thành một file và tạo file LICENSE chuẩn. Chạy offline với mẫu dựng sẵn.
            </p>
          </div>
        </div>
        <div className="flex gap-1 bg-slate-800 rounded-lg p-0.5">
          {(['gitignore', 'license'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                tab === t ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              {t === 'gitignore' ? '.gitignore' : 'LICENSE'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        {/* LEFT: controls */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          {tab === 'gitignore' ? (
            <>
              <div className="relative">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm mẫu: Node, Python, macOS..."
                  className={inputCls + ' pl-9'}
                />
              </div>

              {selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500">Đã chọn:</span>
                  {selected.map((id) => (
                    <button
                      key={id}
                      onClick={() => toggle(id)}
                      className="px-2 py-0.5 rounded-full text-xs bg-indigo-600 text-white flex items-center gap-1"
                      data-tooltip="Bỏ chọn"
                    >
                      {findTemplate(id)?.name}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                  <button onClick={() => setSelected([])} className="text-xs text-slate-500 hover:text-red-600 underline ml-1">
                    Xóa hết
                  </button>
                </div>
              )}

              <div className="space-y-2.5">
                {grouped.length === 0 && <p className="text-sm text-slate-500">Không tìm thấy mẫu phù hợp.</p>}
                {grouped.map(([cat, list]) => (
                  <div key={cat}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                      {CATEGORY_LABEL[cat]}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((t) => {
                        const on = selected.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            onClick={() => toggle(t.id)}
                            aria-pressed={on}
                            className={`px-2.5 py-1 rounded-full text-xs border transition ${
                              on
                                ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-2">
                <button
                  onClick={refresh}
                  disabled={fetching || selected.length === 0}
                  className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-100`}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${fetching ? 'animate-spin' : ''}`} />
                  {fetching ? 'Đang tải...' : 'Làm mới từ GitHub'}
                </button>
                <p className="text-[11px] text-slate-500">
                  Tải mẫu mới nhất từ github/gitignore cho các mẫu đã chọn. Nếu lỗi mạng hoặc mẫu không có trên GitHub
                  (Next.js, React, Vue, Django, Docker), tool dùng mẫu dựng sẵn.
                </p>
                {sections.length > 0 && (
                  <ul className="text-xs text-slate-600 space-y-0.5">
                    {sections.map((s) => (
                      <li key={s.name} className="flex justify-between gap-2">
                        <span>{s.name}</span>
                        <span className={s.source === 'github' ? 'text-emerald-600' : 'text-slate-500'}>
                          {SOURCE_LABEL[s.source]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-slate-600">Giấy phép</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {LICENSE_TEMPLATES.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setLicId(l.id)}
                      aria-pressed={l.id === licId}
                      className={`px-2.5 py-1 rounded-full text-xs border transition ${
                        l.id === licId
                          ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-600">Năm</label>
                  <input value={year} onChange={(e) => setYear(e.target.value)} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-600">Chủ sở hữu bản quyền</label>
                  <input
                    value={holder}
                    onChange={(e) => setHolder(e.target.value)}
                    disabled={!lic.usesHolder}
                    placeholder={lic.usesHolder ? 'Nguyen Van A' : 'Giấy phép này không cần tên'}
                    className={inputCls + ' disabled:bg-slate-50'}
                  />
                </div>
              </div>

              {lic.kind === 'notice' && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs p-2.5 flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {lic.name} có văn bản rất dài nên tool chỉ tạo thông báo bản quyền chuẩn kèm liên kết. Hãy tải
                    văn bản đầy đủ chính thức tại{' '}
                    <a href={lic.officialUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium break-all">
                      {lic.officialUrl}
                    </a>{' '}
                    và đặt vào file LICENSE trước khi phát hành.
                  </span>
                </div>
              )}

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
                <p className="text-sm text-slate-700">{lic.summary}</p>
                <div className="grid sm:grid-cols-3 gap-2 text-xs">
                  <Facts title="Được phép" color="text-emerald-700" items={lic.permissions} />
                  <Facts title="Điều kiện" color="text-amber-700" items={lic.conditions} />
                  <Facts title="Hạn chế" color="text-red-700" items={lic.limitations} />
                </div>
                <p className="text-[11px] text-slate-500">
                  SPDX: <code>{lic.spdx}</code> · Tóm tắt chỉ mang tính tham khảo, không phải tư vấn pháp lý.
                </p>
              </div>

              <ShareLinkButton params={{ tab: 'license', lic: licId, year, holder }} />
            </>
          )}
        </div>

        {/* RIGHT: preview */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-800">
              Xem trước: <code className="text-indigo-600">{filename}</code>
              {tab === 'gitignore' && merged.removed > 0 && (
                <span className="ml-2 text-[11px] font-normal text-slate-500">
                  (đã loại {merged.removed} dòng trùng)
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              {tab === 'gitignore' && <ShareLinkButton params={{ t: selected.join(',') }} />}
              <button
                onClick={handleCopy}
                disabled={!output}
                className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-100`}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                Sao chép
              </button>
              <button
                onClick={handleDownload}
                disabled={!output}
                className={`${btn} bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700`}
              >
                <Download className="h-3.5 w-3.5" />
                Tải {filename}
              </button>
            </div>
          </div>
          {output ? (
            <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto max-h-[560px] whitespace-pre text-slate-800">
              {output}
            </pre>
          ) : (
            <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-8 text-center">
              Chọn ít nhất một mẫu ở bên trái để xem .gitignore được tạo.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Facts({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div>
      <div className={`font-semibold ${color}`}>{title}</div>
      {items.length ? (
        <ul className="list-disc pl-4 text-slate-600 space-y-0.5">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : (
        <div className="text-slate-400">Không có</div>
      )}
    </div>
  );
}
