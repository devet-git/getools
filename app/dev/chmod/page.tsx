'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileLock, Copy, AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  PRESETS,
  PermBit,
  PermClass,
  analyzeMode,
  applySymbolic,
  dockerSnippets,
  explainMode,
  generateChown,
  generateCommands,
  generateIcacls,
  hasPerm,
  modeToLs,
  modeToOctal,
  modeToSymbolic,
  parseOctal,
  parseSymbolic,
  parseUmask,
  setPerm,
  toggleSpecial,
  umaskFromDirMode,
  umaskFromFileMode,
  umaskToDefaults,
  S_ISGID,
  S_ISUID,
  S_ISVTX,
  GeneratedCommand,
} from '@/lib/chmod';

const CLASSES: { id: PermClass; label: string }[] = [
  { id: 'u', label: 'Chủ sở hữu (u)' },
  { id: 'g', label: 'Nhóm (g)' },
  { id: 'o', label: 'Người khác (o)' },
];
const BITS: { id: PermBit; label: string }[] = [
  { id: 'r', label: 'Đọc (r)' },
  { id: 'w', label: 'Ghi (w)' },
  { id: 'x', label: 'Thực thi (x)' },
];

const levelStyle = {
  danger: 'bg-red-50 border-red-200 text-red-800',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-indigo-50 border-indigo-200 text-indigo-800',
} as const;

function CmdList({ items, onCopy }: { items: GeneratedCommand[]; onCopy: (t: string) => void }) {
  return (
    <div className="space-y-1.5">
      {items.map((c, i) => (
        <div key={i}>
          <div className="text-[11px] text-slate-500 mb-0.5">{c.label}</div>
          <div className="flex items-start gap-2 bg-slate-900 text-slate-100 rounded-lg px-3 py-2">
            <pre className="flex-1 min-w-0 text-xs font-mono whitespace-pre-wrap break-all">{c.command}</pre>
            <button onClick={() => onCopy(c.command)} className="text-slate-400 hover:text-white shrink-0" title="Sao chép" aria-label="Sao chép lệnh">
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-white rounded-xl border shadow-xs p-4 space-y-3 ${className}`}>
      <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">{title}</h2>
      {children}
    </section>
  );
}

const inputCls =
  'w-full px-2.5 py-1.5 text-sm font-mono border border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-hidden';

export default function ChmodPage() {
  const { showToast } = useApp();
  const [mode, setMode] = useState(0o644);
  const [isDir, setIsDir] = useState(false);
  const [octalDraft, setOctalDraft] = useState<string | null>(null);
  const [symDraft, setSymDraft] = useState<string | null>(null);
  const [path, setPath] = useState('file.txt');
  const [expr, setExpr] = useState('u+x,g-w,o=r');
  const [exprStart, setExprStart] = useState('644');
  const [exprUmask, setExprUmask] = useState('022');
  const [umaskText, setUmaskText] = useState('022');
  const [wantDir, setWantDir] = useState('750');
  const [wantFile, setWantFile] = useState('640');
  const [owner, setOwner] = useState('www-data');
  const [group, setGroup] = useState('www-data');
  const [recursive, setRecursive] = useState(false);
  const [winUser, setWinUser] = useState('Users');
  const [winPath, setWinPath] = useState('C:\\data\\file.txt');
  const [winR, setWinR] = useState(true);
  const [winW, setWinW] = useState(false);
  const [winX, setWinX] = useState(false);
  const [winRec, setWinRec] = useState(false);
  const [winNoInherit, setWinNoInherit] = useState(false);
  const [dockSrc, setDockSrc] = useState('./entrypoint.sh');
  const [dockDest, setDockDest] = useState('/usr/local/bin/entrypoint.sh');

  useEffect(() => {
    const p = readShareParams();
    const m = p.get('m');
    if (m) {
      const r = parseOctal(m);
      if (r.ok) {
        /* eslint-disable react-hooks/set-state-in-effect */
        setMode(r.value);
        setExprStart(modeToOctal(r.value));
      }
    }
    if (p.get('d') === '1') setIsDir(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      showToast('Đã sao chép!');
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const octalShown = octalDraft ?? modeToOctal(mode);
  const symShown = symDraft ?? modeToSymbolic(mode);
  const octalErr = octalDraft !== null ? (parseOctal(octalDraft) as { ok: boolean; error?: string }).error : undefined;
  const symErr = symDraft !== null ? (parseSymbolic(symDraft) as { ok: boolean; error?: string }).error : undefined;

  const update = (m: number) => {
    setMode(m);
    setOctalDraft(null);
    setSymDraft(null);
  };

  const warnings = useMemo(() => analyzeMode(mode, { isDir }), [mode, isDir]);
  const why = useMemo(() => explainMode(mode, { isDir }), [mode, isDir]);
  const commands = useMemo(() => generateCommands(mode, path, undefined), [mode, path]);

  const startParsed = parseOctal(exprStart);
  const umaskForExpr = parseUmask(exprUmask);
  const exprResult = useMemo(() => {
    if (!startParsed.ok) return null;
    return applySymbolic(startParsed.value, expr, { isDir, umask: umaskForExpr.ok ? umaskForExpr.value : 0o022 });
  }, [startParsed, expr, isDir, umaskForExpr]);

  const umask = parseUmask(umaskText);
  const dirWant = parseOctal(wantDir);
  const fileWant = parseOctal(wantFile);
  const fileUm = fileWant.ok ? umaskFromFileMode(fileWant.value) : null;

  const chown = generateChown(owner, group, path, recursive);
  const icacls = generateIcacls({ path: winPath, principal: winUser, read: winR, write: winW, execute: winX, recursive: winRec, removeInheritance: winNoInherit });
  const docker = dockerSnippets(mode, dockSrc, dockDest);

  const special = [
    { id: 'suid' as const, label: 'setuid (4000)', on: !!(mode & S_ISUID) },
    { id: 'sgid' as const, label: 'setgid (2000)', on: !!(mode & S_ISGID) },
    { id: 'sticky' as const, label: 'sticky (1000)', on: !!(mode & S_ISVTX) },
  ];

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <FileLock className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Chmod & Quyền Unix</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Chuyển đổi rwx, số bát phân, lệnh chmod, umask, setuid/setgid/sticky. Mọi thứ xử lý ngay trên trình duyệt.
            </p>
          </div>
        </div>
        <ShareLinkButton params={{ m: modeToOctal(mode, true), d: isDir ? '1' : '' }} />
      </div>

      <div className="grid lg:grid-cols-2 gap-3.5">
        <Panel title="Ma trận quyền">
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="text-left font-medium py-1" />
                  {BITS.map((b) => (
                    <th key={b.id} className="font-medium py-1 px-2">{b.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CLASSES.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="py-2 pr-2 text-slate-700 font-medium whitespace-nowrap">{c.label}</td>
                    {BITS.map((b) => (
                      <td key={b.id} className="text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-indigo-600"
                          checked={hasPerm(mode, c.id, b.id)}
                          onChange={(e) => update(setPerm(mode, c.id, b.id, e.target.checked))}
                          aria-label={`${c.label} ${b.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1 border-t border-slate-100">
            {special.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={s.on} onChange={(e) => update(toggleSpecial(mode, s.id, e.target.checked))} />
                {s.label}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={isDir} onChange={(e) => setIsDir(e.target.checked)} />
            Đối tượng là thư mục (ảnh hưởng giải thích và cảnh báo)
          </label>
        </Panel>

        <Panel title="Giá trị tương đương">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-500">Bát phân (3 hoặc 4 chữ số)</label>
              <input
                value={octalShown}
                maxLength={4}
                inputMode="numeric"
                onChange={(e) => {
                  const v = e.target.value;
                  setOctalDraft(v);
                  const r = parseOctal(v);
                  if (r.ok) {
                    setMode(r.value);
                    setSymDraft(null);
                  }
                }}
                onBlur={() => setOctalDraft(null)}
                className={inputCls}
                aria-label="Số bát phân"
              />
              {octalErr && <p className="text-[11px] text-red-600 mt-1">{octalErr}</p>}
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Ký hiệu (rwxr-xr-x hoặc -rwxr-xr-x)</label>
              <input
                value={symShown}
                maxLength={10}
                onChange={(e) => {
                  const v = e.target.value;
                  setSymDraft(v);
                  const r = parseSymbolic(v);
                  if (r.ok) {
                    setMode(r.value);
                    setOctalDraft(null);
                  }
                }}
                onBlur={() => setSymDraft(null)}
                className={inputCls}
                aria-label="Chuỗi ký hiệu"
              />
              {symErr && <p className="text-[11px] text-red-600 mt-1">{symErr}</p>}
            </div>
          </div>
          <div className="bg-slate-900 text-slate-100 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
            <code className="text-xs font-mono break-all">
              {modeToLs(mode, isDir ? 'd' : '-')} 1 user group 4096 Jan 1 12:00 {path || 'file'}
            </code>
            <button onClick={() => copy(modeToLs(mode, isDir ? 'd' : '-'))} className="text-slate-400 hover:text-white shrink-0" aria-label="Sao chép chuỗi ls -l">
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[11px] text-slate-500">Tên file/thư mục:</span>
            <input value={path} onChange={(e) => setPath(e.target.value.slice(0, 300))} className={inputCls + ' max-w-xs'} aria-label="Đường dẫn" />
          </div>
          <p className="text-[11px] text-slate-400">
            Mẹo: chữ hoa S/T nghĩa là có bit đặc biệt nhưng thiếu quyền x tương ứng; chữ thường s/t là có cả hai.
          </p>
        </Panel>
      </div>

      <Panel title="Vì sao? Giải thích và cảnh báo">
        <ul className="text-sm text-slate-700 space-y-1 list-disc pl-5">
          {why.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        {warnings.length > 0 ? (
          <div className="space-y-1.5">
            {warnings.map((w, i) => (
              <div key={i} className={`flex gap-2 text-xs border rounded-lg px-3 py-2 ${levelStyle[w.level]}`}>
                {w.level === 'danger' ? <ShieldAlert className="h-4 w-4 shrink-0" /> : w.level === 'warn' ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Info className="h-4 w-4 shrink-0" />}
                <span>{w.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Không có cảnh báo nào cho mode này.</p>
        )}
      </Panel>

      <Panel title="Mẫu thường dùng">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                update(p.mode);
                if (p.isDir !== undefined && p.mode > 0o777) setIsDir(!!p.isDir);
              }}
              className={`text-left border rounded-lg px-3 py-2 transition hover:border-indigo-300 hover:bg-indigo-50/50 ${mode === p.mode ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'}`}
            >
              <div className="text-sm font-mono font-bold text-slate-800">
                {p.label} <span className="font-normal text-slate-500">{modeToSymbolic(p.mode)}</span>
              </div>
              <div className="text-[11px] text-slate-500 leading-snug">{p.useCase}</div>
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid lg:grid-cols-2 gap-3.5">
        <Panel title="Lệnh chmod được tạo">
          <CmdList items={commands} onCopy={copy} />
          <p className="text-[11px] text-slate-400">Tên file được tự động đặt trong dấu nháy khi chứa ký tự đặc biệt.</p>
        </Panel>

        <Panel title="Biểu thức chmod ký hiệu, từng bước">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-slate-500">Mode ban đầu</label>
              <input value={exprStart} onChange={(e) => setExprStart(e.target.value)} className={inputCls} maxLength={4} aria-label="Mode ban đầu" />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] text-slate-500">Biểu thức (u+x,g-w,o=r, a+rX, +t...)</label>
              <input value={expr} onChange={(e) => setExpr(e.target.value)} className={inputCls} aria-label="Biểu thức chmod" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setExprStart(modeToOctal(mode))} className="px-2 py-1 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg">
              Lấy mode từ ma trận
            </button>
            <label className="text-[11px] text-slate-500 flex items-center gap-1">
              umask khi không ghi ugoa:
              <input value={exprUmask} onChange={(e) => setExprUmask(e.target.value)} className="w-14 px-1.5 py-0.5 text-xs font-mono border border-slate-200 rounded-sm" />
            </label>
          </div>
          {!startParsed.ok ? (
            <p className="text-xs text-red-600">{startParsed.error}</p>
          ) : exprResult && !exprResult.ok ? (
            <p className="text-xs text-red-600">{exprResult.error}</p>
          ) : exprResult && exprResult.ok ? (
            <div className="space-y-1.5">
              {exprResult.steps.map((s, i) => (
                <div key={i} className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-slate-50">
                  <div className="font-mono text-slate-800">
                    {s.clause}: {modeToOctal(s.before, true)} ({modeToSymbolic(s.before)}) → {modeToOctal(s.after, true)} ({modeToSymbolic(s.after)})
                  </div>
                  <div className="text-slate-600">{s.description}</div>
                </div>
              ))}
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <span className="text-sm font-mono text-emerald-800">
                  Kết quả: {modeToOctal(exprResult.mode, true)} = {modeToSymbolic(exprResult.mode)}
                </span>
                <button onClick={() => update(exprResult.mode)} className="px-2 py-1 text-xs text-emerald-700 bg-white hover:bg-emerald-100 border border-emerald-300 rounded-lg">
                  Áp vào ma trận
                </button>
              </div>
            </div>
          ) : null}
          <p className="text-[11px] text-slate-400">Mẹo: X chỉ thêm quyền thực thi cho thư mục hoặc file đã có x; = không kèm quyền sẽ xóa sạch lớp đó.</p>
        </Panel>
      </div>

      <Panel title="Máy tính umask">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[11px] text-slate-500">Nhập umask để xem quyền mặc định</label>
            <input value={umaskText} onChange={(e) => setUmaskText(e.target.value)} maxLength={4} className={inputCls + ' max-w-40'} aria-label="umask" />
            {umask.ok ? (
              <div className="text-sm text-slate-700 space-y-1">
                <div>File mới: <b className="font-mono">{modeToOctal(umaskToDefaults(umask.value).file)}</b> ({modeToSymbolic(umaskToDefaults(umask.value).file)}) = 666 &amp; ~{umaskText.padStart(3, '0')}</div>
                <div>Thư mục mới: <b className="font-mono">{modeToOctal(umaskToDefaults(umask.value).dir)}</b> ({modeToSymbolic(umaskToDefaults(umask.value).dir)}) = 777 &amp; ~{umaskText.padStart(3, '0')}</div>
                <div className="flex gap-1.5 pt-1">
                  {['022', '002', '027', '077'].map((u) => (
                    <button key={u} onClick={() => setUmaskText(u)} className="px-2 py-0.5 text-xs font-mono border border-slate-200 rounded-sm hover:bg-slate-50">{u}</button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-red-600">{umask.error}</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-[11px] text-slate-500">Ngược lại: quyền mong muốn → umask</label>
            <div className="flex gap-2">
              <input value={wantDir} onChange={(e) => setWantDir(e.target.value)} maxLength={4} className={inputCls} aria-label="Quyền thư mục mong muốn" />
              <input value={wantFile} onChange={(e) => setWantFile(e.target.value)} maxLength={4} className={inputCls} aria-label="Quyền file mong muốn" />
            </div>
            <div className="text-sm text-slate-700 space-y-1">
              <div>
                Thư mục {wantDir} → umask{' '}
                <b className="font-mono">{dirWant.ok ? umaskFromDirMode(dirWant.value).toString(8).padStart(3, '0') : '?'}</b>
              </div>
              <div>
                File {wantFile} → umask{' '}
                <b className="font-mono">{fileUm ? fileUm.umask.toString(8).padStart(3, '0') : '?'}</b>
                {fileUm && !fileUm.exact && <span className="text-amber-700 text-xs"> (file mới không bao giờ có x, bit x bị bỏ qua)</span>}
              </div>
              {dirWant.ok && fileUm && umaskFromDirMode(dirWant.value) !== fileUm.umask && (
                <p className="text-[11px] text-amber-700">Hai giá trị khác nhau: umask chung chỉ đáp ứng được một trong hai.</p>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid lg:grid-cols-2 gap-3.5">
        <Panel title="chown / chgrp">
          <div className="grid grid-cols-2 gap-2">
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Người dùng" className={inputCls} aria-label="Người dùng" />
            <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Nhóm" className={inputCls} aria-label="Nhóm" />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
            Đệ quy (-R)
          </label>
          {chown.ok ? <CmdList items={chown.value} onCopy={copy} /> : <p className="text-xs text-red-600">{chown.error}</p>}
          <p className="text-[11px] text-slate-400">Đường dẫn dùng chung với ô &quot;Tên file/thư mục&quot; ở trên. Thường cần sudo để chown.</p>
        </Panel>

        <Panel title="Windows icacls">
          <div className="grid grid-cols-2 gap-2">
            <input value={winPath} onChange={(e) => setWinPath(e.target.value)} className={inputCls} aria-label="Đường dẫn Windows" />
            <input value={winUser} onChange={(e) => setWinUser(e.target.value)} className={inputCls} aria-label="Người dùng Windows" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
            {[
              ['Đọc (R)', winR, setWinR],
              ['Ghi (W)', winW, setWinW],
              ['Thực thi (RX)', winX, setWinX],
              ['Áp cho mục con (/T, OI, CI)', winRec, setWinRec],
              ['Tắt kế thừa', winNoInherit, setWinNoInherit],
            ].map(([label, val, set]) => (
              <label key={label as string} className="flex items-center gap-1.5">
                <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={val as boolean} onChange={(e) => (set as (b: boolean) => void)(e.target.checked)} />
                {label as string}
              </label>
            ))}
          </div>
          {icacls.ok ? <CmdList items={icacls.value} onCopy={copy} /> : <p className="text-xs text-red-600">{icacls.error}</p>}
          <p className="text-[11px] text-slate-400">Windows dùng ACL, không có bit rwx; đây chỉ là phép tương ứng gần đúng.</p>
        </Panel>
      </div>

      <Panel title="Docker / Dockerfile">
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={dockSrc} onChange={(e) => setDockSrc(e.target.value)} className={inputCls} aria-label="Nguồn" />
          <input value={dockDest} onChange={(e) => setDockDest(e.target.value)} className={inputCls} aria-label="Đích" />
        </div>
        <CmdList items={docker} onCopy={copy} />
        <p className="text-[11px] text-slate-400">--chmod cần BuildKit (mặc định từ Docker 23); dạng bát phân hoạt động ở mọi phiên bản BuildKit.</p>
      </Panel>
    </div>
  );
}
