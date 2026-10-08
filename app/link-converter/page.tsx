'use client';

import { useMemo, useState } from 'react';
import {
  Link2,
  Copy,
  Check,
  ExternalLink,
  Trash2,
  AlertTriangle,
  Info,
  Terminal,
  ListChecks,
  ArrowRight,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import {
  parseLink,
  applyEdits,
  editsFromLink,
  deriveOutputs,
  splitCandidates,
  getRawUrl,
  getZipUrl,
  getJsdelivrUrl,
  PROVIDER_LABEL,
  KIND_LABEL,
  REF_TYPE_LABEL,
  SAMPLE_LINKS,
  type LinkEdits,
  type LinkKind,
  type ParsedLink,
  type RefType,
  type DerivedItem,
} from '@/lib/link-converter';

const INITIAL_TEXT = SAMPLE_LINKS[1].url;

const inputCls =
  'w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 text-slate-800';

type Line = { raw: string; result: ReturnType<typeof parseLink> };

export default function LinkConverterPage() {
  const { showToast } = useApp();
  const [text, setText] = useState(INITIAL_TEXT);
  const [editState, setEditState] = useState<{ key: string; edits: LinkEdits } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const lines: Line[] = useMemo(
    () =>
      text
        .split(/\r\n|\r|\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((raw) => ({ raw, result: parseLink(raw) })),
    [text]
  );

  const copy = async (value: string, id: string, message = 'Đã sao chép!') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      showToast(message);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const single = lines.length === 1 ? lines[0] : null;
  const singleLink = single && single.result.ok ? single.result.link : null;

  const edits: LinkEdits | null = singleLink
    ? editState && editState.key === single!.raw
      ? editState.edits
      : editsFromLink(singleLink)
    : null;

  const effective: ParsedLink | null = useMemo(
    () => (singleLink && edits ? applyEdits(singleLink, edits) : null),
    [singleLink, edits]
  );

  const groups = useMemo(() => (effective ? deriveOutputs(effective) : []), [effective]);
  const candidates = useMemo(() => (singleLink ? splitCandidates(singleLink) : []), [singleLink]);

  const setEdit = (patch: Partial<LinkEdits>) => {
    if (!single || !edits) return;
    setEditState({ key: single.raw, edits: { ...edits, ...patch } });
  };

  /* ---------- Batch ---------- */
  const batch = useMemo(() => {
    if (lines.length < 2) return [];
    return lines.map((l) => {
      if (!l.result.ok) return { line: l, link: null as ParsedLink | null, error: l.result.error, raw: null, zip: null, cdn: null };
      const link = l.result.link;
      return { line: l, link, error: null, raw: getRawUrl(link), zip: getZipUrl(link), cdn: getJsdelivrUrl(link) };
    });
  }, [lines]);

  const bulkCopy = (key: 'raw' | 'zip' | 'cdn', label: string) => {
    const list = batch.map((b) => b[key]).filter((v): v is string => !!v);
    if (list.length === 0) {
      showToast(`Không có ${label} nào để sao chép (chỉ link file mới có URL raw/CDN).`);
      return;
    }
    void copy(list.join('\n'), `bulk-${key}`, `Đã sao chép ${list.length} ${label}!`);
  };

  const okCount = batch.filter((b) => b.link).length;

  const CopyBtn = ({ id, value }: { id: string; value: string }) => (
    <button
      onClick={() => void copy(value, id)}
      title="Sao chép"
      className="px-2 py-1 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition flex items-center gap-1 shrink-0"
    >
      {copiedId === id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{copiedId === id ? 'Đã chép' : 'Chép'}</span>
    </button>
  );

  const OpenBtn = ({ href }: { href: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Mở link trong tab mới"
      className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg transition shrink-0"
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );

  const ItemRow = ({ item }: { item: DerivedItem }) => (
    <div className="px-3 py-2 border-b border-slate-100 last:border-b-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1 min-w-0">
          {item.type === 'cmd' && <Terminal className="h-3 w-3 text-slate-400 shrink-0" />}
          <span className="truncate">{item.label}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <CopyBtn id={`item-${item.id}`} value={item.value} />
          {item.open && <OpenBtn href={item.value} />}
        </div>
      </div>
      <pre
        className={`text-xs font-mono rounded-md px-2 py-1.5 whitespace-pre-wrap break-all select-all ${
          item.type === 'cmd' ? 'bg-slate-900 text-emerald-300' : 'bg-slate-50 text-slate-800 border border-slate-100'
        }`}
      >
        {item.value}
      </pre>
      {item.note && <p className="text-[11px] text-amber-700 mt-1">{item.note}</p>}
    </div>
  );

  return (
    <div className="space-y-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Link2 className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Chuyển đổi link GitHub</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Dán link GitHub, GitLab hoặc Bitbucket để lấy URL raw, CDN, ZIP, lệnh git clone, curl, wget... Xử lý hoàn toàn trên trình duyệt.
            </p>
          </div>
        </div>
      </div>

      {/* INPUT */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Link đầu vào</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">{lines.length} link (mỗi dòng một link)</span>
            <button
              onClick={() => setText('')}
              title="Xóa nội dung"
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={4}
          placeholder={'https://github.com/owner/repo/blob/main/src/index.ts#L10-L20\nDán nhiều link, mỗi dòng một link, để xử lý hàng loạt.'}
          className="w-full p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-y leading-relaxed text-slate-800 whitespace-pre"
        />
        <div className="px-3 py-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-400 mr-1">Ví dụ:</span>
          {SAMPLE_LINKS.map((s) => (
            <button
              key={s.label}
              onClick={() => setText(s.url)}
              title={s.url}
              className="px-2 py-0.5 text-[11px] font-medium rounded-full border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 text-slate-600 transition"
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => setText(SAMPLE_LINKS.slice(0, 7).map((s) => s.url).join('\n'))}
            className="px-2 py-0.5 text-[11px] font-medium rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition flex items-center gap-1"
          >
            <ListChecks className="h-3 w-3" />
            Nhiều link mẫu
          </button>
        </div>
      </div>

      {/* EMPTY */}
      {lines.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200/90 p-8 text-center text-sm text-slate-400">
          Dán một hoặc nhiều link vào ô phía trên để bắt đầu.
        </div>
      )}

      {/* SINGLE: ERROR */}
      {single && !single.result.ok && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm flex gap-2.5">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Không nhận dạng được link</p>
            <p className="text-xs mt-0.5">{single.result.error}</p>
          </div>
        </div>
      )}

      {/* SINGLE: DETAIL */}
      {effective && singleLink && edits && (
        <>
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="p-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-800 uppercase tracking-wider">Đã nhận dạng</span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-white font-semibold">{PROVIDER_LABEL[effective.provider]}</span>
              <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">{KIND_LABEL[effective.kind]}</span>
              <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
                {effective.owner}/{effective.repo}
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">
                {REF_TYPE_LABEL[effective.refType]}
                {effective.ref ? `: ${effective.ref}` : ''}
              </span>
              {effective.line && (
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                  Dòng {effective.line.start}
                  {effective.line.end !== effective.line.start ? `-${effective.line.end}` : ''}
                </span>
              )}
            </div>

            <div className="p-3 grid grid-cols-1 md:grid-cols-[1fr_1.5fr_auto_auto] gap-3">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Nhánh / tag / commit (ref)</span>
                <input value={edits.ref} onChange={(e) => setEdit({ ref: e.target.value })} spellCheck={false} className={inputCls} placeholder="để trống = nhánh mặc định" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Đường dẫn trong repo</span>
                <input value={edits.path} onChange={(e) => setEdit({ path: e.target.value })} spellCheck={false} className={inputCls} placeholder="src/index.ts" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Loại</span>
                <select value={edits.kind} onChange={(e) => setEdit({ kind: e.target.value as LinkKind })} className={inputCls}>
                  {(Object.keys(KIND_LABEL) as LinkKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Loại ref</span>
                <select value={edits.refType} onChange={(e) => setEdit({ refType: e.target.value as RefType | 'auto' })} className={inputCls}>
                  <option value="auto">Tự đoán ({REF_TYPE_LABEL[effective.refType]})</option>
                  {(Object.keys(REF_TYPE_LABEL) as RefType[]).map((k) => (
                    <option key={k} value={k}>
                      {REF_TYPE_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(singleLink.ambiguous || candidates.length > 1 || singleLink.kindGuessed || singleLink.notes.length > 0) && (
              <div className="px-3 pb-3 space-y-2">
                {singleLink.ambiguous && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs flex gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Tên nhánh có thể chứa dấu &quot;/&quot; nên không thể biết chắc đâu là ref, đâu là đường dẫn. Công cụ đang đoán ref là{' '}
                      <b className="font-mono">{singleLink.ref}</b>; hãy chỉnh ở các ô trên hoặc chọn cách tách khác bên dưới.
                    </span>
                  </div>
                )}
                {singleLink.kindGuessed && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs flex gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>Loại (file / thư mục) chỉ là đoán theo phần mở rộng của tên. Hãy chỉnh ở ô &quot;Loại&quot; nếu sai.</span>
                  </div>
                )}
                {singleLink.notes
                  .filter((n) => !n.startsWith('Bitbucket không phân biệt'))
                  .map((n) => (
                    <div key={n} className="bg-sky-50 border border-sky-200 text-sky-800 rounded-lg px-3 py-2 text-xs flex gap-2">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{n}</span>
                    </div>
                  ))}
                {candidates.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">Cách tách ref / đường dẫn khác:</span>
                    {candidates.map((c) => {
                      const active = c.ref === edits.ref && c.path === edits.path;
                      return (
                        <button
                          key={c.ref}
                          onClick={() => setEdit({ ref: c.ref, path: c.path, kind: c.path ? singleLink.kind : 'repo' })}
                          className={`px-2 py-0.5 text-[11px] font-mono rounded-full border transition ${
                            active
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
                          }`}
                          title={`ref = ${c.ref}, path = ${c.path || '(trống)'}`}
                        >
                          {c.ref}
                          <ArrowRight className="inline h-3 w-3 mx-0.5 opacity-60" />
                          {c.path || '(trống)'}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5 items-start">
            {groups.map((g) => (
              <div key={g.id} className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
                <div className="p-2.5 border-b border-slate-100 bg-slate-50/60">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">{g.title}</span>
                  {g.hint && <p className="text-[11px] text-slate-500 mt-1 leading-snug">{g.hint}</p>}
                </div>
                {g.items.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* BATCH */}
      {batch.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="p-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center flex-wrap gap-2 text-xs">
              <span className="font-bold text-slate-800 uppercase tracking-wider">Kết quả hàng loạt</span>
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">{okCount} hợp lệ</span>
              {batch.length - okCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">{batch.length - okCount} lỗi</span>
              )}
            </div>
            <div className="flex items-center flex-wrap gap-2">
              <button
                onClick={() => bulkCopy('raw', 'URL raw')}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition flex items-center gap-1"
              >
                {copiedId === 'bulk-raw' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                Chép tất cả URL raw
              </button>
              <button
                onClick={() => bulkCopy('cdn', 'URL jsDelivr')}
                className="px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-100 transition flex items-center gap-1"
              >
                {copiedId === 'bulk-cdn' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                Chép tất cả jsDelivr
              </button>
              <button
                onClick={() => bulkCopy('zip', 'URL ZIP')}
                className="px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-100 transition flex items-center gap-1"
              >
                {copiedId === 'bulk-zip' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                Chép tất cả ZIP
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-left">
                  <th className="px-3 py-2 font-semibold w-8">#</th>
                  <th className="px-3 py-2 font-semibold">Nhận dạng</th>
                  <th className="px-3 py-2 font-semibold">Ref</th>
                  <th className="px-3 py-2 font-semibold">Đường dẫn</th>
                  <th className="px-3 py-2 font-semibold">URL raw</th>
                  <th className="px-3 py-2 font-semibold">ZIP</th>
                  <th className="px-3 py-2 font-semibold w-20" />
                </tr>
              </thead>
              <tbody>
                {batch.map((b, i) => (
                  <tr key={i} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                    {b.link ? (
                      <>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">
                            {PROVIDER_LABEL[b.link.provider]} · {KIND_LABEL[b.link.kind]}
                          </div>
                          <div className="font-mono text-slate-500 break-all">
                            {b.link.owner}/{b.link.repo}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-700 break-all">
                          {b.link.ref || 'HEAD'}
                          {b.link.ambiguous && (
                            <span title="Tên nhánh có thể chứa dấu / - kiểm tra lại ở phần chi tiết" className="ml-1 text-amber-600">
                              ?
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-700 break-all">{b.link.path || '-'}</td>
                        <td className="px-3 py-2">
                          {b.raw ? (
                            <div className="flex items-start gap-1.5">
                              <span className="font-mono text-slate-600 break-all line-clamp-2 min-w-0">{b.raw}</span>
                              <button
                                onClick={() => void copy(b.raw!, `row-raw-${i}`)}
                                title="Sao chép URL raw"
                                className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition shrink-0"
                              >
                                {copiedId === `row-raw-${i}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-300">Không áp dụng</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => void copy(b.zip!, `row-zip-${i}`)}
                            title={b.zip ?? ''}
                            className="px-2 py-0.5 text-[11px] font-medium rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 transition flex items-center gap-1"
                          >
                            {copiedId === `row-zip-${i}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            ZIP
                          </button>
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="px-3 py-2 text-red-700">
                        <div className="font-mono break-all text-slate-500">{b.line.raw}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Không nhận dạng được link.
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      {b.link && (
                        <button
                          onClick={() => setText(b.line.raw)}
                          className="px-2 py-0.5 text-[11px] font-medium rounded-md text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition"
                        >
                          Chi tiết
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 border-t border-slate-100 text-[11px] text-slate-400">
            URL raw và jsDelivr chỉ có cho link trỏ tới file. Bấm &quot;Chi tiết&quot; để xem đầy đủ lệnh và chỉnh ref/đường dẫn cho từng link.
          </p>
        </div>
      )}
    </div>
  );
}
