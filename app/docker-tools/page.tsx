'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Container, Copy, Check, Download, Trash2, Sparkles, AlertTriangle, Info, ArrowRight, Hammer } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  composeToDockerRun,
  dockerRunToCompose,
  DEFAULT_C2R,
  DEFAULT_D2C,
  SAMPLE_COMPOSE,
  SAMPLE_RUN,
  Warning,
} from '@/lib/docker-tools';

type Mode = 'run2compose' | 'compose2run';

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
      />
      {label}
    </label>
  );
}

function WarningList({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null;
  const warns = warnings.filter((w) => w.level === 'warn');
  const infos = warnings.filter((w) => w.level === 'info');
  const row = (w: Warning, i: number, warn: boolean) => (
    <li key={i} className="flex items-start gap-2 text-xs">
      {warn ? (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
      ) : (
        <Info className="h-3.5 w-3.5 text-indigo-400 shrink-0 mt-0.5" />
      )}
      <span className="text-slate-700">
        {w.service && <span className="font-mono font-semibold text-slate-900 mr-1">[{w.service}]</span>}
        {w.message}
      </span>
    </li>
  );
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60 text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
        Cảnh báo &amp; ghi chú
        {warns.length > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 normal-case">{warns.length} cảnh báo</span>}
        {infos.length > 0 && <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 normal-case">{infos.length} ghi chú</span>}
      </div>
      <ul className="p-3 space-y-1.5 max-h-60 overflow-auto">
        {warns.map((w, i) => row(w, i, true))}
        {infos.map((w, i) => row(w, i + 1000, false))}
      </ul>
    </div>
  );
}

export default function DockerToolsPage() {
  const { showToast } = useApp();
  const [mode, setMode] = useState<Mode>('run2compose');
  const [runText, setRunText] = useState(SAMPLE_RUN);
  const [composeText, setComposeText] = useState(SAMPLE_COMPOSE);
  const [includeVersion, setIncludeVersion] = useState(DEFAULT_D2C.includeVersion);
  const [containerName, setContainerName] = useState(DEFAULT_D2C.containerName);
  const [external, setExternal] = useState(DEFAULT_D2C.external);
  const [detach, setDetach] = useState(DEFAULT_C2R.detach);
  const [rm, setRm] = useState(DEFAULT_C2R.rm);
  const [multiline, setMultiline] = useState(DEFAULT_C2R.multiline);
  const [setup, setSetup] = useState(DEFAULT_C2R.setup);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const q = readShareParams();
    /* eslint-disable react-hooks/set-state-in-effect */
    const m = q.get('m');
    if (m === 'run2compose' || m === 'compose2run') setMode(m);
    if (q.get('v') === '1') setIncludeVersion(true);
    if (q.get('cn') === '0') setContainerName(false);
    if (q.get('ex') === '1') setExternal(true);
    if (q.get('d') === '0') setDetach(false);
    if (q.get('rm') === '1') setRm(true);
    if (q.get('ml') === '0') setMultiline(false);
    if (q.get('su') === '0') setSetup(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const input = mode === 'run2compose' ? runText : composeText;
  const deferred = useDeferredValue(input);
  const pending = deferred !== input;

  const d2c = useMemo(
    () => (mode === 'run2compose' ? dockerRunToCompose(deferred, { includeVersion, containerName, external }) : null),
    [mode, deferred, includeVersion, containerName, external]
  );
  const c2r = useMemo(
    () => (mode === 'compose2run' ? composeToDockerRun(deferred, { detach, rm, multiline, setup }) : null),
    [mode, deferred, detach, rm, multiline, setup]
  );

  const output = (mode === 'run2compose' ? d2c?.yaml : c2r?.output) ?? '';
  const error = (mode === 'run2compose' ? d2c?.error : c2r?.error) ?? null;
  const warnings = (mode === 'run2compose' ? d2c?.warnings : c2r?.warnings) ?? [];

  const copy = async (text: string, id: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      showToast('Đã sao chép!');
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const download = () => {
    if (!output) return;
    const isYaml = mode === 'run2compose';
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isYaml ? 'docker-compose.yml' : 'docker-run.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(isYaml ? 'Đã tải xuống docker-compose.yml!' : 'Đã tải xuống docker-run.sh!');
  };

  const setInput = (v: string) => (mode === 'run2compose' ? setRunText(v) : setComposeText(v));

  return (
    <div className="space-y-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Container className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Docker run ⇄ Compose</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Đổi lệnh <code>docker run</code> thành <code>docker-compose.yml</code> (gộp nhiều lệnh thành nhiều service) và ngược lại. Xử lý ngay trên trình duyệt.
            </p>
          </div>
        </div>
        <button
          onClick={() => (mode === 'run2compose' ? setRunText(SAMPLE_RUN) : setComposeText(SAMPLE_COMPOSE))}
          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
        >
          <Sparkles className="h-3 w-3 text-amber-400" />
          Dùng mẫu thử
        </button>
      </div>

      {/* OPTIONS */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs px-3 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs">
          {(
            [
              ['run2compose', 'docker run → Compose'],
              ['compose2run', 'Compose → docker run'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                mode === id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'run2compose' ? (
          <>
            <Toggle checked={includeVersion} onChange={setIncludeVersion} label='Thêm khóa "version" (lỗi thời)' />
            <Toggle checked={containerName} onChange={setContainerName} label="Giữ --name thành container_name" />
            <Toggle checked={external} onChange={setExternal} label="Volume/network là external" />
          </>
        ) : (
          <>
            <Toggle checked={detach} onChange={setDetach} label="Thêm -d" />
            <Toggle checked={rm} onChange={setRm} label="Thêm --rm" />
            <Toggle checked={multiline} onChange={setMultiline} label="Mỗi cờ một dòng (\)" />
            <Toggle checked={setup} onChange={setSetup} label="Kèm lệnh tạo network/volume" />
          </>
        )}
        <div className="ml-auto">
          <ShareLinkButton
            params={{
              m: mode,
              v: includeVersion ? '1' : undefined,
              cn: containerName ? undefined : '0',
              ex: external ? '1' : undefined,
              d: detach ? undefined : '0',
              rm: rm ? '1' : undefined,
              ml: multiline ? undefined : '0',
              su: setup ? undefined : '0',
            }}
          />
        </div>
      </div>
      <p className="text-[11px] text-slate-500 -mt-2 px-1">Link chia sẻ chỉ lưu các tùy chọn, không chứa nội dung lệnh/file của bạn.</p>

      {/* EDITORS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col overflow-hidden h-[420px]">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              {mode === 'run2compose' ? 'Lệnh docker run (một hoặc nhiều)' : 'docker-compose.yml'}
            </span>
            <button
              onClick={() => setInput('')}
              title="Xóa nội dung"
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            aria-label="Đầu vào"
            placeholder={
              mode === 'run2compose'
                ? 'Dán lệnh docker run vào đây, ví dụ:\ndocker run -d --name web -p 8080:80 nginx'
                : 'Dán nội dung docker-compose.yml vào đây...'
            }
            className="flex-1 w-full p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-none leading-relaxed text-slate-800 whitespace-pre"
          />
          <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
            <span>{input ? input.split(/\r\n|\r|\n/).length : 0} dòng</span>
            <span>{pending ? 'Đang xử lý…' : `${input.length} ký tự`}</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col overflow-hidden h-[420px]">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <ArrowRight className="h-3.5 w-3.5 text-indigo-500" />
              {mode === 'run2compose' ? 'docker-compose.yml' : 'Lệnh docker run'}
              {mode === 'run2compose' && d2c?.ok && d2c.services.length > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 normal-case font-semibold">
                  {d2c.services.length} service
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => copy(output, 'all')}
                disabled={!output}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white shadow-xs transition flex items-center gap-1"
              >
                {copied === 'all' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === 'all' ? 'Đã chép!' : 'Sao chép'}
              </button>
              <button
                onClick={download}
                disabled={!output}
                title={mode === 'run2compose' ? 'Tải docker-compose.yml' : 'Tải docker-run.sh'}
                className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg transition disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {error ? (
            <div className="flex-1 p-4 text-sm text-red-700 bg-red-50/60 overflow-auto">
              <div className="font-semibold mb-1">Không chuyển đổi được</div>
              {error}
            </div>
          ) : !output ? (
            <div className="flex-1 flex items-center justify-center p-6 text-sm text-slate-400 text-center">
              {input.trim() ? 'Không có kết quả.' : 'Nhập nội dung ở bên trái để xem kết quả.'}
            </div>
          ) : (
            <pre className="flex-1 overflow-auto p-3 text-xs font-mono bg-slate-900 text-slate-100 leading-relaxed whitespace-pre">{output}</pre>
          )}
        </div>
      </div>

      {/* Per-service commands */}
      {mode === 'compose2run' && c2r?.ok && c2r.items.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60 text-xs font-bold text-slate-800 uppercase tracking-wider">
            Theo từng service (thứ tự chạy gợi ý)
          </div>
          <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
            {c2r.items.map((it, idx) => {
              const text = (it.buildCommand ? it.buildCommand + '\n' : '') + it.command;
              return (
                <div key={it.service} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-2.5 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5 min-w-0">
                      <span className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-700 text-[11px] flex items-center justify-center shrink-0">{idx + 1}</span>
                      <span className="font-mono truncate">{it.service}</span>
                      {it.buildCommand && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium flex items-center gap-1 shrink-0">
                          <Hammer className="h-3 w-3" />
                          cần build
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => copy(text, it.service)}
                      className="px-2 py-0.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md border border-indigo-200 flex items-center gap-1 shrink-0"
                    >
                      {copied === it.service ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      Chép
                    </button>
                  </div>
                  {it.notes.length > 0 && (
                    <ul className="px-2.5 py-1.5 text-[11px] text-slate-600 bg-amber-50/50 border-b border-slate-100 space-y-0.5">
                      {it.notes.map((n, i) => (
                        <li key={i}>• {n}</li>
                      ))}
                    </ul>
                  )}
                  <pre className="p-2.5 text-xs font-mono bg-slate-900 text-slate-100 overflow-auto whitespace-pre max-h-64">{text}</pre>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <WarningList warnings={warnings} />

      <p className="text-[11px] text-slate-500 px-1 leading-relaxed">
        <b>Mẹo:</b> dán nhiều lệnh <code>docker run</code> (mỗi lệnh một dòng hoặc ngăn cách bằng dòng trống / dấu <code>\</code>) để gộp thành một file nhiều service;
        volume đặt tên và network tùy chỉnh được gom vào mục <code>volumes:</code> / <code>networks:</code>. Cờ lạ hoặc không có tương đương sẽ được báo trong phần cảnh báo.
      </p>
    </div>
  );
}
