'use client';

import { useEffect, useMemo, useState } from 'react';
import { GitBranch, Search, Copy, Check, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  CHEAT_ENTRIES,
  CHEAT_GROUPS,
  PLACEHOLDERS,
  entryMatches,
  fillCommand,
  CheatEntry,
} from '@/lib/git-cheatsheet';

const MAX_VALUE_LEN = 200;

export default function GitCheatsheetPage() {
  const { showToast } = useApp();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('all');
  const [values, setValues] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [onlyDanger, setOnlyDanger] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const p = readShareParams();
    const g = p.get('g');
    if (g && CHEAT_GROUPS.some((x) => x.id === g)) setGroup(g);
    const q = p.get('q');
    if (q) setQuery(q.slice(0, 100));
  }, []);

  const filtered = useMemo(
    () =>
      CHEAT_ENTRIES.filter(
        (e) =>
          (group === 'all' || e.group === group) &&
          (!onlyDanger || (e.danger && e.danger !== 'safe')) &&
          entryMatches(e, query)
      ),
    [group, query, onlyDanger]
  );

  const byGroup = useMemo(() => {
    return CHEAT_GROUPS.map((g) => ({
      group: g,
      entries: filtered.filter((e) => e.group === g.id),
    })).filter((x) => x.entries.length > 0);
  }, [filtered]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
      showToast('Đã sao chép lệnh!');
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs border transition ${
      active
        ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium'
        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
    }`;

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <GitBranch className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Cheat sheet lệnh Git</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Tra lệnh theo tình huống thực tế, điền sẵn tên nhánh, remote, message vào mọi lệnh và sao chép.
            </p>
          </div>
        </div>
        <ShareLinkButton params={{ g: group === 'all' ? '' : group, q: query }} />
      </div>

      {/* Search + filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="relative">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Tìm theo tình huống hoặc lệnh, ví dụ "hoan tac commit", "stash", "force"...'
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setGroup('all')} className={chip(group === 'all')}>
            Tất cả
          </button>
          {CHEAT_GROUPS.map((g) => (
            <button key={g.id} onClick={() => setGroup(g.id)} className={chip(group === g.id)}>
              {g.title}
            </button>
          ))}
          <button
            onClick={() => setOnlyDanger((v) => !v)}
            className={`px-2.5 py-1 rounded-full text-xs border transition flex items-center gap-1 ${
              onlyDanger
                ? 'bg-red-50 border-red-400 text-red-700 font-medium'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle className="h-3 w-3" />
            Chỉ lệnh nguy hiểm
          </button>
        </div>

        <details className="group" open>
          <summary className="cursor-pointer text-xs font-semibold text-slate-600 select-none">
            Điền giá trị vào lệnh (quote an toàn cho shell)
          </summary>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-2">
            {PLACEHOLDERS.map((p) => (
              <label key={p.key} className="block">
                <span className="text-[11px] text-slate-500">
                  {p.label} <code className="text-slate-400">&lt;{p.key}&gt;</code>
                </span>
                <input
                  value={values[p.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value.slice(0, MAX_VALUE_LEN) }))}
                  placeholder={p.example}
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-mono text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            Giá trị có khoảng trắng hoặc ký tự đặc biệt sẽ tự được bọc nháy đơn. Để trống thì giữ nguyên &lt;placeholder&gt;.
          </p>
        </details>
      </div>

      {byGroup.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Không tìm thấy tình huống nào phù hợp. Thử từ khóa khác hoặc bỏ bộ lọc.
        </div>
      )}

      {byGroup.map(({ group: g, entries }) => (
        <section key={g.id} className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800 px-1">
            {g.title} <span className="text-xs font-normal text-slate-400">({entries.length})</span>
          </h2>
          <div className="grid gap-2.5 lg:grid-cols-2">
            {entries.map((e) => (
              <EntryCard key={e.id} entry={e} values={values} copiedKey={copiedKey} onCopy={copy} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EntryCard({
  entry,
  values,
  copiedKey,
  onCopy,
}: {
  entry: CheatEntry;
  values: Record<string, string>;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const level = entry.danger ?? 'safe';
  const border =
    level === 'danger'
      ? 'border-red-300 bg-red-50/40'
      : level === 'caution'
        ? 'border-amber-300 bg-amber-50/40'
        : 'border-slate-200 bg-white';

  return (
    <div className={`rounded-xl border p-3.5 space-y-2 ${border}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{entry.want}</h3>
        {level === 'danger' && (
          <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-white bg-red-600 rounded-full px-2 py-0.5">
            <ShieldAlert className="h-3 w-3" />
            NGUY HIỂM
          </span>
        )}
        {level === 'caution' && (
          <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-200 rounded-full px-2 py-0.5">
            <AlertTriangle className="h-3 w-3" />
            CẨN THẬN
          </span>
        )}
      </div>

      <div className="space-y-1">
        {entry.commands.map((cmd, i) => {
          const filled = fillCommand(cmd, values);
          const key = `${entry.id}:${i}`;
          return (
            <div key={key} className="flex items-stretch gap-1">
              <pre className="flex-1 min-w-0 text-xs font-mono bg-slate-900 text-slate-100 rounded-md px-2.5 py-1.5 overflow-x-auto whitespace-pre">
                {filled}
              </pre>
              <button
                onClick={() => onCopy(filled, key)}
                title="Sao chép lệnh"
                aria-label="Sao chép lệnh"
                className="shrink-0 px-2 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 transition"
              >
                {copiedKey === key ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-600 leading-relaxed">{entry.explain}</p>
      {level !== 'safe' && entry.warning && (
        <p className={`text-xs font-medium ${level === 'danger' ? 'text-red-700' : 'text-amber-700'}`}>
          {entry.warning}
        </p>
      )}
    </div>
  );
}
