'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Workflow,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  Download,
  ShieldCheck,
  AlertTriangle,
  Info,
  XCircle,
  ChevronDown,
  Sparkles,
  Clock,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  PRESETS,
  RUNNERS,
  PERMISSION_SCOPES,
  PR_TYPES,
  RELEASE_TYPES,
  DEPENDABOT_ECOSYSTEMS,
  RULE_DOCS,
  buildPreset,
  findPreset,
  generateWorkflowYaml,
  generateDependabot,
  lintWorkflow,
  explainWorkflow,
  validateCron,
  safeFileName,
  newJob,
  newStep,
  newService,
  newInput,
  newDependabotEntry,
  uid,
  type WorkflowDef,
  type JobDef,
  type StepDef,
  type KV,
  type FilterTrigger,
  type InputDef,
  type LintIssue,
  type Explanation,
  type DependabotEntry,
  type PermMode,
} from '@/lib/github-actions';

/* ------------------------------------------------------------------ */
/*  Giao diện dùng chung                                               */
/* ------------------------------------------------------------------ */

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400';
const monoCls = inputCls + ' font-mono';
const btnCls =
  'px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition inline-flex items-center gap-1';
const btnPrimary =
  'px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition inline-flex items-center gap-1';
const iconBtn = 'p-1 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 transition';

const SNIPPETS: { label: string; step: () => StepDef }[] = [
  { label: 'actions/checkout', step: () => newStep({ name: 'Checkout', uses: 'actions/checkout@v4' }) },
  { label: 'actions/setup-node', step: () => newStep({ name: 'Cài Node.js', uses: 'actions/setup-node@v4', with: [{ k: 'node-version', v: '22' }, { k: 'cache', v: 'npm' }] }) },
  { label: 'actions/setup-python', step: () => newStep({ name: 'Cài Python', uses: 'actions/setup-python@v5', with: [{ k: 'python-version', v: '3.12' }] }) },
  { label: 'actions/cache', step: () => newStep({ name: 'Cache', uses: 'actions/cache@v4', with: [{ k: 'path', v: '~/.cache' }, { k: 'key', v: "${{ runner.os }}-cache-${{ hashFiles('**/lockfile') }}" }] }) },
  { label: 'actions/upload-artifact', step: () => newStep({ name: 'Upload artifact', uses: 'actions/upload-artifact@v4', with: [{ k: 'name', v: 'build' }, { k: 'path', v: 'dist/' }] }) },
  { label: 'actions/download-artifact', step: () => newStep({ name: 'Download artifact', uses: 'actions/download-artifact@v4', with: [{ k: 'name', v: 'build' }] }) },
  { label: 'Lệnh shell (run)', step: () => newStep({ name: 'Chạy lệnh', run: 'echo "xin chào"' }) },
];

function Card({ title, children, right, defaultOpen = true }: { title: string; children: React.ReactNode; right?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-xs">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-100">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? '' : '-rotate-90'}`} />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="p-3.5 space-y-3">{children}</div>}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10.5px] text-slate-400 mt-0.5">{hint}</span>}
    </label>
  );
}

function KVEditor({ items, onChange, kPlaceholder = 'khóa', vPlaceholder = 'giá trị', addLabel = 'Thêm' }: { items: KV[]; onChange: (v: KV[]) => void; kPlaceholder?: string; vPlaceholder?: string; addLabel?: string }) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex gap-1.5 items-start">
          <input className={monoCls + ' w-2/5'} value={it.k} placeholder={kPlaceholder} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
          <textarea
            className={monoCls + ' resize-y min-h-[30px]'}
            rows={it.v.includes('\n') ? Math.min(6, it.v.split('\n').length) : 1}
            value={it.v}
            placeholder={vPlaceholder}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))}
          />
          <button className={iconBtn} onClick={() => onChange(items.filter((_, j) => j !== i))} title="Xóa">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button className={btnCls} onClick={() => onChange([...items, { k: '', v: '' }])}>
        <Plus className="h-3 w-3" /> {addLabel}
      </button>
    </div>
  );
}

function PermEditor({ items, onChange }: { items: KV[]; onChange: (v: KV[]) => void }) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <select className={inputCls} value={it.k} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))}>
            <option value="">-- scope --</option>
            {PERMISSION_SCOPES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className={inputCls + ' w-28'} value={it.v} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))}>
            <option>read</option>
            <option>write</option>
            <option>none</option>
          </select>
          <button className={iconBtn} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <button className={btnCls} onClick={() => onChange([...items, { k: 'contents', v: 'read' }])}>
          <Plus className="h-3 w-3" /> Thêm quyền
        </button>
        {[['pull-requests', 'write'], ['packages', 'write'], ['id-token', 'write'], ['pages', 'write']].map(([k, v]) => (
          <button key={k} className={btnCls} onClick={() => onChange([...items.filter((x) => x.k !== k), { k, v }])}>
            +{k}: {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function Check1({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
      <input type="checkbox" className="accent-indigo-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const sevStyle = {
  error: { cls: 'bg-red-50 border-red-200 text-red-700', badge: 'bg-red-600 text-white', Icon: XCircle, label: 'Lỗi' },
  warning: { cls: 'bg-amber-50 border-amber-200 text-amber-800', badge: 'bg-amber-500 text-white', Icon: AlertTriangle, label: 'Cảnh báo' },
  info: { cls: 'bg-slate-50 border-slate-200 text-slate-700', badge: 'bg-slate-500 text-white', Icon: Info, label: 'Gợi ý' },
} as const;

function IssueList({ issues, onJump }: { issues: LintIssue[]; onJump?: (line: number) => void }) {
  if (!issues.length)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs px-3 py-2">
        <ShieldCheck className="h-4 w-4" /> Không phát hiện vấn đề nào.
      </div>
    );
  return (
    <ul className="space-y-1.5">
      {issues.slice(0, 200).map((i, idx) => {
        const st = sevStyle[i.severity];
        return (
          <li key={idx} className={`rounded-lg border px-2.5 py-1.5 text-xs ${st.cls}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`px-1.5 py-px rounded text-[10px] font-bold ${st.badge}`}>{st.label}</span>
              <button className="font-mono text-[11px] underline decoration-dotted" onClick={() => onJump?.(i.line)} title={RULE_DOCS[i.rule]}>
                {i.rule} · dòng {i.line}:{i.col}
              </button>
              <span className="text-[10.5px] opacity-70">{RULE_DOCS[i.rule]}</span>
            </div>
            <p className="mt-1">{i.message}</p>
            {i.fix && <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] opacity-90">Cách sửa: {i.fix}</pre>}
          </li>
        );
      })}
      {issues.length > 200 && <li className="text-xs text-slate-500">... và {issues.length - 200} vấn đề khác.</li>}
    </ul>
  );
}

function CountBadges({ counts }: { counts: { error: number; warning: number; info: number } }) {
  return (
    <div className="flex gap-1.5 text-[11px] font-semibold">
      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700">{counts.error} lỗi</span>
      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{counts.warning} cảnh báo</span>
      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{counts.info} gợi ý</span>
    </div>
  );
}

function ExplainPanel({ ex }: { ex: Explanation }) {
  if (!ex.ok) return <p className="text-xs text-slate-500">{ex.error}</p>;
  const nodeW = 170;
  const nodeH = 40;
  const pos = new Map(ex.nodes.map((n) => [n.id, n]));
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-slate-700 mb-1">Khi nào chạy?</h4>
        {ex.triggers.length ? (
          <ul className="list-disc pl-4 text-xs text-slate-700 space-y-0.5">
            {ex.triggers.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">Chưa có sự kiện kích hoạt.</p>
        )}
      </div>
      <div>
        <h4 className="text-xs font-semibold text-slate-700 mb-1">
          Sơ đồ job ({ex.nodes.length} job, song song tối đa ~{ex.maxParallel} runner)
        </h4>
        {ex.nodes.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50">
            <svg width={ex.width + 8} height={ex.height} role="img" aria-label="Sơ đồ phụ thuộc giữa các job">
              {ex.edges.map((e, i) => {
                const a = pos.get(e.from);
                const b = pos.get(e.to);
                if (!a || !b) return null;
                const x1 = a.x + nodeW;
                const y1 = a.y + nodeH / 2;
                const x2 = b.x;
                const y2 = b.y + nodeH / 2;
                const mx = (x1 + x2) / 2;
                return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="#6366f1" strokeWidth={1.5} />;
              })}
              {ex.nodes.map((n) => (
                <g key={n.id}>
                  <rect x={n.x} y={n.y} width={nodeW} height={nodeH} rx={8} fill="#ffffff" stroke="#94a3b8" />
                  <text x={n.x + 8} y={n.y + 16} fontSize={11} fontWeight={600} fill="#1e293b">
                    {n.id.length > 22 ? n.id.slice(0, 21) + '…' : n.id}
                    {n.matrixSize > 1 ? ` ×${n.matrixSize}` : ''}
                  </text>
                  <text x={n.x + 8} y={n.y + 31} fontSize={9.5} fill="#64748b">
                    {(n.runsOn.length > 20 ? n.runsOn.slice(0, 19) + '…' : n.runsOn) + ' · ' + n.steps + ' step'}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        )}
        <pre className="mt-2 text-[11px] font-mono bg-slate-900 text-slate-100 rounded-lg p-2.5 overflow-x-auto whitespace-pre">{ex.ascii || '(không có job)'}</pre>
        <p className="text-[10.5px] text-slate-400 mt-1">Các job cùng tầng chạy song song; tầng sau chờ tầng trước (needs). Ma trận nhân số lượt chạy (×N).</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trình soạn trigger                                                 */
/* ------------------------------------------------------------------ */

function FilterEditor({ title, t, onChange, withTags, withTypes, typeSuggest }: { title: string; t: FilterTrigger; onChange: (t: FilterTrigger) => void; withTags?: boolean; withTypes?: boolean; typeSuggest?: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5 space-y-2">
      <Check1 checked={t.on} onChange={(v) => onChange({ ...t, on: v })} label={title} />
      {t.on && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="Nhánh (branches)" hint="Phân tách bằng dấu phẩy. Hỗ trợ mẫu như releases/**">
            <input className={monoCls} value={t.branches} onChange={(e) => onChange({ ...t, branches: e.target.value })} placeholder="main, develop" />
          </Field>
          {withTags && (
            <Field label="Tag (tags)">
              <input className={monoCls} value={t.tags} onChange={(e) => onChange({ ...t, tags: e.target.value })} placeholder="v*.*.*" />
            </Field>
          )}
          {withTypes && (
            <Field label="Loại (types)" hint={typeSuggest ? `Gợi ý: ${typeSuggest.join(', ')}` : undefined}>
              <input className={monoCls} value={t.types} onChange={(e) => onChange({ ...t, types: e.target.value })} placeholder="opened, synchronize" />
            </Field>
          )}
          <Field label="Đường dẫn (paths)">
            <input className={monoCls} value={t.paths} onChange={(e) => onChange({ ...t, paths: e.target.value })} placeholder="src/**, package.json" />
          </Field>
        </div>
      )}
    </div>
  );
}

function InputsEditor({ inputs, onChange, forCall }: { inputs: InputDef[]; onChange: (v: InputDef[]) => void; forCall?: boolean }) {
  const types = forCall ? ['string', 'boolean', 'number'] : ['string', 'boolean', 'choice', 'environment', 'number'];
  const set = (i: number, p: Partial<InputDef>) => onChange(inputs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="space-y-2">
      {inputs.map((inp, i) => (
        <div key={i} className="rounded-lg bg-slate-50 border border-slate-200 p-2 space-y-1.5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <input className={monoCls} value={inp.name} placeholder="tên input" onChange={(e) => set(i, { name: e.target.value })} />
            <select className={inputCls} value={inp.type} onChange={(e) => set(i, { type: e.target.value as InputDef['type'] })}>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {inp.type === 'boolean' ? (
              <select className={inputCls} value={inp.default} onChange={(e) => set(i, { default: e.target.value })}>
                <option value="">(mặc định: không)</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              inp.type !== 'environment' && <input className={monoCls} value={inp.default} placeholder="giá trị mặc định" onChange={(e) => set(i, { default: e.target.value })} />
            )}
            <div className="flex items-center justify-between gap-2">
              <Check1 checked={inp.required} onChange={(v) => set(i, { required: v })} label="Bắt buộc" />
              <button className={iconBtn} onClick={() => onChange(inputs.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <input className={inputCls} value={inp.description} placeholder="Mô tả" onChange={(e) => set(i, { description: e.target.value })} />
          {inp.type === 'choice' && !forCall && <input className={monoCls} value={inp.options} placeholder="Các lựa chọn: staging, production" onChange={(e) => set(i, { options: e.target.value })} />}
        </div>
      ))}
      <button className={btnCls} onClick={() => onChange([...inputs, newInput({ name: `input${inputs.length + 1}` })])}>
        <Plus className="h-3 w-3" /> Thêm input
      </button>
    </div>
  );
}

function ScheduleEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const lines = value.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <div className="space-y-1.5">
      <textarea className={monoCls} rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder={'30 1 * * 1\n0 3 * * *'} />
      <ul className="space-y-0.5">
        {lines.map((l, i) => {
          const r = validateCron(l);
          return (
            <li key={i} className={`text-[11px] flex items-start gap-1 ${r.ok ? (r.minGap !== undefined && r.minGap < 5 ? 'text-amber-600' : 'text-emerald-600') : 'text-red-600'}`}>
              {r.ok ? <Check className="h-3 w-3 mt-0.5 shrink-0" /> : <XCircle className="h-3 w-3 mt-0.5 shrink-0" />}
              <span>
                <code className="font-mono">{l}</code>: {r.ok ? (r.minGap !== undefined && r.minGap < 5 ? `chạy mỗi ${r.minGap} phút — GitHub tối thiểu 5 phút.` : 'hợp lệ.') : r.error}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[10.5px] text-slate-400 flex items-center gap-1">
        <Clock className="h-3 w-3" /> Mỗi dòng một cron 5 trường, tính theo UTC (giờ VN = UTC+7). Khoảng cách tối thiểu 5 phút; lượt chạy có thể bị trễ khi GitHub tải cao.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trình soạn job / step                                              */
/* ------------------------------------------------------------------ */

function StepEditor({ s, index, total, onChange, onMove, onRemove }: { s: StepDef; index: number; total: number; onChange: (p: Partial<StepDef>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold text-slate-400 w-5">#{index + 1}</span>
        <input className={inputCls} value={s.name} placeholder="Tên step (name)" onChange={(e) => onChange({ name: e.target.value })} />
        <button className={iconBtn} disabled={index === 0} onClick={() => onMove(-1)} title="Lên">
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button className={iconBtn} disabled={index === total - 1} onClick={() => onMove(1)} title="Xuống">
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button className={iconBtn} onClick={onRemove} title="Xóa step">
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="uses" hint="owner/repo@phiên_bản (nếu có uses thì run bị bỏ qua)">
          <input className={monoCls} value={s.uses} placeholder="actions/checkout@v4" onChange={(e) => onChange({ uses: e.target.value })} />
        </Field>
        <Field label="id (tùy chọn)">
          <input className={monoCls} value={s.id} onChange={(e) => onChange({ id: e.target.value })} />
        </Field>
      </div>
      {s.uses.trim() ? (
        <Field label="with (đầu vào của action)">
          <KVEditor items={s.with} onChange={(with_) => onChange({ with: with_ })} kPlaceholder="tham số" />
        </Field>
      ) : (
        <Field label="run (nhiều dòng được hỗ trợ)">
          <textarea className={monoCls} rows={Math.min(10, Math.max(2, s.run.split('\n').length))} value={s.run} placeholder="npm ci" onChange={(e) => onChange({ run: e.target.value })} spellCheck={false} />
        </Field>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Nâng cao: if, env, shell, working-directory, continue-on-error</summary>
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="if">
              <input className={monoCls} value={s.if} placeholder="github.ref == 'refs/heads/main'" onChange={(e) => onChange({ if: e.target.value })} />
            </Field>
            <Field label="shell">
              <select className={inputCls} value={s.shell} onChange={(e) => onChange({ shell: e.target.value })}>
                <option value="">(mặc định)</option>
                {['bash', 'sh', 'pwsh', 'powershell', 'python', 'cmd'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="working-directory">
              <input className={monoCls} value={s.workingDirectory} onChange={(e) => onChange({ workingDirectory: e.target.value })} />
            </Field>
          </div>
          {s.uses.trim() && (
            <Field label="run (đang bị bỏ qua vì có uses)">
              <textarea className={monoCls} rows={2} value={s.run} onChange={(e) => onChange({ run: e.target.value })} />
            </Field>
          )}
          <Field label="env">
            <KVEditor items={s.env} onChange={(env) => onChange({ env })} kPlaceholder="BIẾN" />
          </Field>
          <Check1 checked={s.continueOnError} onChange={(v) => onChange({ continueOnError: v })} label="continue-on-error" />
        </div>
      </details>
    </div>
  );
}

function JobEditor({
  job,
  index,
  total,
  allIds,
  onChange,
  onRename,
  onMove,
  onRemove,
}: {
  job: JobDef;
  index: number;
  total: number;
  allIds: string[];
  onChange: (p: Partial<JobDef>) => void;
  onRename: (id: string) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const setStep = (si: number, p: Partial<StepDef>) => onChange({ steps: job.steps.map((s, j) => (j === si ? { ...s, ...p } : s)) });
  const moveStep = (si: number, d: -1 | 1) => {
    const arr = [...job.steps];
    const t = si + d;
    if (t < 0 || t >= arr.length) return;
    [arr[si], arr[t]] = [arr[t], arr[si]];
    onChange({ steps: arr });
  };
  const m = job.matrix;
  const setM = (p: Partial<typeof m>) => onChange({ matrix: { ...m, ...p } });
  const others = allIds.filter((x) => x !== job.id);
  return (
    <div className="rounded-xl border border-indigo-200/70 bg-white">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50/60 rounded-t-xl border-b border-indigo-100">
        <button onClick={() => setOpen(!open)} className={iconBtn}>
          <ChevronDown className={`h-4 w-4 transition ${open ? '' : '-rotate-90'}`} />
        </button>
        <span className="text-xs font-bold text-indigo-700">job</span>
        <input className={monoCls + ' max-w-[200px]'} value={job.id} onChange={(e) => onRename(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} />
        <span className="text-[11px] text-slate-500 truncate hidden sm:inline">{job.steps.length} step</span>
        <div className="ml-auto flex">
          <button className={iconBtn} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button className={iconBtn} disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button className={iconBtn} disabled={total <= 1} onClick={onRemove} title="Xóa job">
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </button>
        </div>
      </div>
      {open && (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="name (hiển thị)">
              <input className={inputCls} value={job.name} onChange={(e) => onChange({ name: e.target.value })} />
            </Field>
            <Field label="runs-on" hint="Chọn sẵn hoặc gõ nhãn self-hosted / nhiều nhãn cách nhau bằng dấu phẩy">
              <input className={monoCls} list="gha-runners" value={job.runsOn} onChange={(e) => onChange({ runsOn: e.target.value })} />
            </Field>
            <Field label="if (điều kiện chạy job)">
              <input className={monoCls} value={job.if} placeholder="github.ref == 'refs/heads/main'" onChange={(e) => onChange({ if: e.target.value })} />
            </Field>
            <Field label="timeout-minutes">
              <input className={monoCls} value={job.timeout} onChange={(e) => onChange({ timeout: e.target.value })} placeholder="15" />
            </Field>
            <Field label="environment" hint="Tên environment (có thể cần duyệt thủ công)">
              <input className={monoCls} value={job.environment} onChange={(e) => onChange({ environment: e.target.value })} placeholder="production" />
            </Field>
            {job.environment && (
              <Field label="environment url">
                <input className={monoCls} value={job.environmentUrl} onChange={(e) => onChange({ environmentUrl: e.target.value })} />
              </Field>
            )}
          </div>
          <Field label="needs (chạy sau các job)">
            {others.length ? (
              <div className="flex flex-wrap gap-3">
                {others.map((o) => (
                  <Check1 key={o} checked={job.needs.includes(o)} label={o} onChange={(v) => onChange({ needs: v ? [...job.needs, o] : job.needs.filter((x) => x !== o) })} />
                ))}
              </div>
            ) : (
              <span className="text-[11px] text-slate-400">Chưa có job khác.</span>
            )}
          </Field>
          <details className="text-xs" open={job.permissions.length > 0}>
            <summary className="cursor-pointer font-medium text-slate-600">permissions riêng cho job (ghi đè cấp workflow)</summary>
            <div className="mt-2">
              <PermEditor items={job.permissions} onChange={(permissions) => onChange({ permissions })} />
            </div>
          </details>
          <details className="text-xs" open={m.enabled}>
            <summary className="cursor-pointer font-medium text-slate-600">strategy.matrix {m.enabled ? '(đang bật)' : ''}</summary>
            <div className="mt-2 space-y-2">
              <Check1 checked={m.enabled} onChange={(v) => setM({ enabled: v, axes: v && m.axes.length === 0 ? [{ key: 'os', values: 'ubuntu-latest, windows-latest' }] : m.axes })} label="Bật ma trận" />
              {m.enabled && (
                <>
                  {m.axes.map((ax, i) => (
                    <div key={i} className="flex gap-1.5">
                      <input className={monoCls + ' w-1/3'} value={ax.key} placeholder="khóa (node-version)" onChange={(e) => setM({ axes: m.axes.map((a, j) => (j === i ? { ...a, key: e.target.value } : a)) })} />
                      <input className={monoCls} value={ax.values} placeholder="giá trị: 18, 20, 22" onChange={(e) => setM({ axes: m.axes.map((a, j) => (j === i ? { ...a, values: e.target.value } : a)) })} />
                      <button className={iconBtn} onClick={() => setM({ axes: m.axes.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button className={btnCls} onClick={() => setM({ axes: [...m.axes, { key: '', values: '' }] })}>
                    <Plus className="h-3 w-3" /> Thêm trục
                  </button>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Field label="include (mỗi dòng: khóa=giá trị, khóa=giá trị)">
                      <textarea className={monoCls} rows={2} value={m.include} onChange={(e) => setM({ include: e.target.value })} placeholder="os=ubuntu-latest, experimental=true" />
                    </Field>
                    <Field label="exclude">
                      <textarea className={monoCls} rows={2} value={m.exclude} onChange={(e) => setM({ exclude: e.target.value })} placeholder="os=windows-latest, node-version=18" />
                    </Field>
                    <Field label="fail-fast">
                      <select className={inputCls} value={m.failFast} onChange={(e) => setM({ failFast: e.target.value as typeof m.failFast })}>
                        <option value="default">(mặc định: true)</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    </Field>
                    <Field label="max-parallel">
                      <input className={monoCls} value={m.maxParallel} onChange={(e) => setM({ maxParallel: e.target.value })} placeholder="(không giới hạn)" />
                    </Field>
                  </div>
                </>
              )}
            </div>
          </details>
          <details className="text-xs" open={job.services.length > 0}>
            <summary className="cursor-pointer font-medium text-slate-600">services (container dịch vụ) {job.services.length ? `(${job.services.length})` : ''}</summary>
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(['postgres', 'redis', 'mysql', 'mongo', 'custom'] as const).map((p) => (
                  <button key={p} className={btnCls} onClick={() => onChange({ services: [...job.services, newService(p)] })}>
                    <Plus className="h-3 w-3" /> {p}
                  </button>
                ))}
              </div>
              {job.services.map((sv, i) => {
                const setS = (p: Partial<typeof sv>) => onChange({ services: job.services.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <div key={sv.uid} className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                      <input className={monoCls} value={sv.name} placeholder="tên service" onChange={(e) => setS({ name: e.target.value })} />
                      <input className={monoCls} value={sv.image} placeholder="image" onChange={(e) => setS({ image: e.target.value })} />
                      <div className="flex gap-1.5">
                        <input className={monoCls} value={sv.ports} placeholder="5432:5432" onChange={(e) => setS({ ports: e.target.value })} />
                        <button className={iconBtn} onClick={() => onChange({ services: job.services.filter((_, j) => j !== i) })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <input className={monoCls} value={sv.options} placeholder="options (health check...)" onChange={(e) => setS({ options: e.target.value })} />
                    <KVEditor items={sv.env} onChange={(env) => setS({ env })} kPlaceholder="BIẾN" addLabel="Thêm env" />
                  </div>
                );
              })}
              {job.services.length > 0 && <p className="text-[10.5px] text-slate-400">Từ step, truy cập qua localhost:&lt;cổng&gt; (job chạy trên runner) — health check giúp job chờ service sẵn sàng.</p>}
            </div>
          </details>
          <details className="text-xs" open={job.outputs.length > 0 || job.env.length > 0}>
            <summary className="cursor-pointer font-medium text-slate-600">outputs &amp; env của job</summary>
            <div className="mt-2 space-y-2">
              <Field label="outputs" hint="vd: version = ${{ steps.ver.outputs.version }}">
                <KVEditor items={job.outputs} onChange={(outputs) => onChange({ outputs })} kPlaceholder="tên" />
              </Field>
              <Field label="env">
                <KVEditor items={job.env} onChange={(env) => onChange({ env })} kPlaceholder="BIẾN" />
              </Field>
            </div>
          </details>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-700">Steps</h4>
            {job.steps.map((s, si) => (
              <StepEditor key={s.uid} s={s} index={si} total={job.steps.length} onChange={(p) => setStep(si, p)} onMove={(d) => moveStep(si, d)} onRemove={() => onChange({ steps: job.steps.filter((_, j) => j !== si) })} />
            ))}
            <div className="flex flex-wrap gap-1.5 items-center">
              <button className={btnCls} onClick={() => onChange({ steps: [...job.steps, newStep({ name: '', run: '' })] })}>
                <Plus className="h-3 w-3" /> Step trống
              </button>
              <select
                className={inputCls + ' !w-auto'}
                value=""
                onChange={(e) => {
                  const sn = SNIPPETS.find((x) => x.label === e.target.value);
                  if (sn) onChange({ steps: [...job.steps, sn.step()] });
                }}
              >
                <option value="">+ Thêm step mẫu...</option>
                {SNIPPETS.map((x) => (
                  <option key={x.label}>{x.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trang chính                                                        */
/* ------------------------------------------------------------------ */

type Tab = 'builder' | 'linter' | 'dependabot';

const SAMPLE_BAD = `name: CI
on:
  pull_request_target:
    types: [opened]
jobs:
  build:
    runs-on: ubuntu-20.04
    steps:
      - uses: actions/checkout@v2
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - name: In tiêu đề
        run: echo "PR: \${{ github.event.pull_request.title }}"
      - run: echo "::set-output name=ok::true"
      - uses: actions/upload-artifact@v3
  deploy:
    needs: [buid]
    runs-on: ubuntu-latest
    steps:
      - uses: some-org/deploy-action@main
`;

function download(text: string, name: string) {
  const blob = new Blob([text], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function GithubActionsPage() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<Tab>('builder');
  const [presetId, setPresetId] = useState('node');
  const [opt, setOpt] = useState('');
  const [branch, setBranch] = useState('main');
  const [wf, setWf] = useState<WorkflowDef>(() => buildPreset('node', '', 'main'));
  const [copied, setCopied] = useState(false);
  const [lintText, setLintText] = useState('');
  const [deps, setDeps] = useState<DependabotEntry[]>(() => [newDependabotEntry('npm'), newDependabotEntry('github-actions')]);
  const lintRef = useRef<HTMLTextAreaElement>(null);

  // Khởi tạo từ link chia sẻ
  useEffect(() => {
    const q = readShareParams();
    const p = q.get('preset');
    if (!p || !findPreset(p)) return;
    const o = q.get('opt') ?? '';
    const b = q.get('branch') ?? 'main';
    const built = buildPreset(p, o, b);
    const fn = q.get('name');
    if (fn) built.fileName = fn.slice(0, 60);
    setPresetId(p);
    setOpt(o);
    setBranch(b);
    setWf(built);
  }, []);

  const preset = findPreset(presetId) ?? PRESETS[0];
  const yamlText = useMemo(() => generateWorkflowYaml(wf), [wf]);
  const fileName = safeFileName(wf.fileName);
  const genLint = useMemo(() => lintWorkflow(yamlText), [yamlText]);
  const genExplain = useMemo(() => explainWorkflow(yamlText), [yamlText]);
  const depsYaml = useMemo(() => generateDependabot(deps), [deps]);

  const deferredLint = useDeferredValue(lintText);
  const userLint = useMemo(() => lintWorkflow(deferredLint), [deferredLint]);
  const userExplain = useMemo(() => explainWorkflow(deferredLint), [deferredLint]);

  const applyPreset = (id: string, o: string, b: string) => {
    const p = findPreset(id) ?? PRESETS[0];
    const optId = p.option ? (p.option.choices.some((c) => c.id === o) ? o : p.option.choices[0].id) : '';
    setPresetId(id);
    setOpt(optId);
    setWf(buildPreset(id, optId, b));
  };

  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast(msg);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const patch = (p: Partial<WorkflowDef>) => setWf((w) => ({ ...w, ...p }));
  const setJob = (i: number, p: Partial<JobDef>) => setWf((w) => ({ ...w, jobs: w.jobs.map((j, k) => (k === i ? { ...j, ...p } : j)) }));
  const renameJob = (i: number, id: string) =>
    setWf((w) => {
      const old = w.jobs[i].id;
      return { ...w, jobs: w.jobs.map((j, k) => (k === i ? { ...j, id } : { ...j, needs: j.needs.map((n) => (n === old ? id : n)) })) };
    });
  const moveJob = (i: number, d: -1 | 1) =>
    setWf((w) => {
      const a = [...w.jobs];
      const t = i + d;
      if (t < 0 || t >= a.length) return w;
      [a[i], a[t]] = [a[t], a[i]];
      return { ...w, jobs: a };
    });
  const removeJob = (i: number) =>
    setWf((w) => {
      const gone = w.jobs[i].id;
      return { ...w, jobs: w.jobs.filter((_, k) => k !== i).map((j) => ({ ...j, needs: j.needs.filter((n) => n !== gone) })) };
    });
  const addJob = () =>
    setWf((w) => {
      let n = w.jobs.length + 1;
      while (w.jobs.some((j) => j.id === `job${n}`)) n++;
      return { ...w, jobs: [...w.jobs, newJob({ id: `job${n}`, needs: w.jobs.length ? [w.jobs[w.jobs.length - 1].id] : [] })] };
    });
  const setTrig = <K extends keyof WorkflowDef['triggers']>(k: K, v: WorkflowDef['triggers'][K]) => setWf((w) => ({ ...w, triggers: { ...w.triggers, [k]: v } }));

  const jumpTo = (line: number) => {
    const ta = lintRef.current;
    if (!ta) return;
    const lines = lintText.split('\n');
    let start = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) start += lines[i].length + 1;
    const end = start + (lines[line - 1]?.length ?? 0);
    ta.focus();
    ta.setSelectionRange(start, end);
    const lh = 16;
    ta.scrollTop = Math.max(0, (line - 4) * lh);
  };

  const t = wf.triggers;

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Workflow className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">GitHub Actions Builder</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">Tạo workflow .github/workflows/*.yml, kiểm tra lỗi &amp; bảo mật, sinh dependabot.yml. Xử lý hoàn toàn trên trình duyệt.</p>
          </div>
        </div>
        <div className="flex gap-1 bg-slate-800 rounded-lg p-0.5">
          {([['builder', 'Trình tạo'], ['linter', 'Linter'], ['dependabot', 'Dependabot']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3 py-1 rounded-md text-xs font-medium transition ${tab === id ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <datalist id="gha-runners">
        {RUNNERS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      {tab === 'builder' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5 items-start">
          <div className="space-y-3 min-w-0">
            <Card title="Mẫu có sẵn (preset)">
              <div className="flex flex-wrap gap-1.5">
                {['Cơ bản', 'Ngôn ngữ', 'Triển khai', 'Bảo mật & bot'].map((g) => (
                  <div key={g} className="w-full">
                    <div className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{g}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESETS.filter((p) => p.group === g).map((p) => (
                        <button key={p.id} onClick={() => applyPreset(p.id, opt, branch)} className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${presetId === p.id ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {preset.option && (
                  <Field label={preset.option.label}>
                    <select className={inputCls} value={opt} onChange={(e) => applyPreset(presetId, e.target.value, branch)}>
                      {preset.option.choices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Nhánh chính" hint="Áp dụng khi chọn lại preset">
                  <input className={monoCls} value={branch} onChange={(e) => setBranch(e.target.value)} onBlur={() => applyPreset(presetId, opt, branch)} />
                </Field>
              </div>
              <p className="text-[11px] text-slate-500 flex gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-px" />
                {preset.note} Phiên bản action (v4, v5, ...) có thể đã đổi — hãy kiểm tra lại trên trang Marketplace của từng action.
              </p>
              <div className="flex justify-end">
                <ShareLinkButton params={{ preset: presetId, opt, branch, name: wf.fileName }} />
              </div>
            </Card>

            <Card title="Thông tin chung">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Field label="Tên file" hint={`.github/workflows/${fileName}`}>
                  <input className={monoCls} value={wf.fileName} onChange={(e) => patch({ fileName: e.target.value })} />
                </Field>
                <Field label="name">
                  <input className={inputCls} value={wf.name} onChange={(e) => patch({ name: e.target.value })} />
                </Field>
                <Field label="run-name (tùy chọn)">
                  <input className={monoCls} value={wf.runName} onChange={(e) => patch({ runName: e.target.value })} placeholder="Deploy by @${{ github.actor }}" />
                </Field>
              </div>
            </Card>

            <Card title="Sự kiện kích hoạt (on)">
              <FilterEditor title="push" t={t.push} onChange={(v) => setTrig('push', v)} withTags />
              <FilterEditor title="pull_request" t={t.pull_request} onChange={(v) => setTrig('pull_request', v)} withTypes typeSuggest={PR_TYPES} />
              <FilterEditor title="pull_request_target (cẩn thận: chạy với quyền repo gốc)" t={t.pull_request_target} onChange={(v) => setTrig('pull_request_target', v)} withTypes typeSuggest={PR_TYPES} />
              <div className="rounded-lg border border-slate-200 p-2.5 space-y-2">
                <Check1 checked={t.schedule.on} onChange={(v) => setTrig('schedule', { ...t.schedule, on: v, crons: v && !t.schedule.crons ? '0 3 * * 1-5' : t.schedule.crons })} label="schedule (cron, UTC)" />
                {t.schedule.on && <ScheduleEditor value={t.schedule.crons} onChange={(v) => setTrig('schedule', { ...t.schedule, crons: v })} />}
              </div>
              <div className="rounded-lg border border-slate-200 p-2.5 space-y-2">
                <Check1 checked={t.workflow_dispatch.on} onChange={(v) => setTrig('workflow_dispatch', { ...t.workflow_dispatch, on: v })} label="workflow_dispatch (chạy thủ công, có input)" />
                {t.workflow_dispatch.on && <InputsEditor inputs={t.workflow_dispatch.inputs} onChange={(inputs) => setTrig('workflow_dispatch', { ...t.workflow_dispatch, inputs })} />}
              </div>
              <div className="rounded-lg border border-slate-200 p-2.5 space-y-2">
                <Check1 checked={t.release.on} onChange={(v) => setTrig('release', { ...t.release, on: v })} label="release" />
                {t.release.on && (
                  <Field label="types" hint={`Gợi ý: ${RELEASE_TYPES.join(', ')}`}>
                    <input className={monoCls} value={t.release.types} onChange={(e) => setTrig('release', { ...t.release, types: e.target.value })} />
                  </Field>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 p-2.5 space-y-2">
                <Check1 checked={t.workflow_call.on} onChange={(v) => setTrig('workflow_call', { ...t.workflow_call, on: v })} label="workflow_call (reusable workflow)" />
                {t.workflow_call.on && (
                  <>
                    <InputsEditor forCall inputs={t.workflow_call.inputs} onChange={(inputs) => setTrig('workflow_call', { ...t.workflow_call, inputs })} />
                    <Field label="secrets (mỗi dòng/dấu phẩy một tên)">
                      <input className={monoCls} value={t.workflow_call.secrets} onChange={(e) => setTrig('workflow_call', { ...t.workflow_call, secrets: e.target.value })} placeholder="DEPLOY_TOKEN" />
                    </Field>
                  </>
                )}
              </div>
            </Card>

            <Card title="Quyền, concurrency, env, defaults" defaultOpen={false}>
              <Field label="permissions (cấp workflow)" hint="Nguyên tắc đặc quyền tối thiểu: bắt đầu từ contents: read, rồi nâng quyền theo từng job.">
                <select className={inputCls} value={wf.permMode} onChange={(e) => patch({ permMode: e.target.value as PermMode })}>
                  <option value="read">contents: read (khuyến nghị)</option>
                  <option value="empty">{'{}'} (không quyền nào)</option>
                  <option value="read-all">read-all</option>
                  <option value="custom">Tùy chỉnh...</option>
                  <option value="none">Không khai báo (dùng mặc định repo)</option>
                </select>
              </Field>
              {wf.permMode === 'custom' && <PermEditor items={wf.permissions} onChange={(permissions) => patch({ permissions })} />}
              <div className="rounded-lg border border-slate-200 p-2.5 space-y-2">
                <Check1 checked={wf.concurrency.on} onChange={(v) => patch({ concurrency: { ...wf.concurrency, on: v, group: v && !wf.concurrency.group ? '${{ github.workflow }}-${{ github.ref }}' : wf.concurrency.group } })} label="concurrency" />
                {wf.concurrency.on && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Field label="group">
                      <input className={monoCls} value={wf.concurrency.group} onChange={(e) => patch({ concurrency: { ...wf.concurrency, group: e.target.value } })} />
                    </Field>
                    <Field label="cancel-in-progress">
                      <select className={inputCls} value={wf.concurrency.cancel} onChange={(e) => patch({ concurrency: { ...wf.concurrency, cancel: e.target.value } })}>
                        <option value="true">true (hủy lượt cũ)</option>
                        <option value="false">false (xếp hàng)</option>
                      </select>
                    </Field>
                  </div>
                )}
              </div>
              <Field label="env (cấp workflow)">
                <KVEditor items={wf.env} onChange={(env) => patch({ env })} kPlaceholder="BIẾN" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="defaults.run.shell">
                  <select className={inputCls} value={wf.defaultsShell} onChange={(e) => patch({ defaultsShell: e.target.value })}>
                    <option value="">(mặc định)</option>
                    {['bash', 'sh', 'pwsh', 'powershell'].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <Field label="defaults.run.working-directory">
                  <input className={monoCls} value={wf.defaultsWorkingDir} onChange={(e) => patch({ defaultsWorkingDir: e.target.value })} placeholder="./app" />
                </Field>
              </div>
            </Card>

            <Card title={`Jobs (${wf.jobs.length})`} right={<button className={btnPrimary} onClick={addJob}><Plus className="h-3 w-3" /> Thêm job</button>}>
              {wf.jobs.map((j, i) => (
                <JobEditor key={j.uid} job={j} index={i} total={wf.jobs.length} allIds={wf.jobs.map((x) => x.id)} onChange={(p) => setJob(i, p)} onRename={(id) => renameJob(i, id)} onMove={(d) => moveJob(i, d)} onRemove={() => removeJob(i)} />
              ))}
            </Card>
          </div>

          <div className="space-y-3 min-w-0 xl:sticky xl:top-3">
            <section className="bg-white rounded-xl border border-slate-200 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-slate-100">
                <div className="text-xs font-mono text-slate-600 truncate">.github/workflows/{fileName}</div>
                <div className="flex gap-1.5">
                  <button className={btnCls} onClick={() => copy(yamlText, 'Đã sao chép workflow!')}>
                    {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />} Sao chép
                  </button>
                  <button className={btnCls} onClick={() => download(yamlText, fileName)}>
                    <Download className="h-3 w-3" /> Tải .yml
                  </button>
                  <button
                    className={btnCls}
                    onClick={() => {
                      setLintText(yamlText);
                      setTab('linter');
                    }}
                  >
                    <ShieldCheck className="h-3 w-3" /> Mở trong Linter
                  </button>
                </div>
              </div>
              <pre className="p-3.5 text-[11.5px] leading-relaxed font-mono bg-slate-900 text-slate-100 rounded-b-xl overflow-auto max-h-[460px] whitespace-pre">{yamlText}</pre>
            </section>
            <Card title="Kiểm tra tự động" right={<CountBadges counts={genLint.counts} />}>
              <IssueList issues={genLint.issues} />
            </Card>
            <Card title="Giải thích workflow" defaultOpen={false}>
              <ExplainPanel ex={genExplain} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'linter' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5 items-start">
          <section className="bg-white rounded-xl border border-slate-200 shadow-xs min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Dán workflow cần kiểm tra</h2>
              <div className="flex gap-1.5">
                <button className={btnCls} onClick={() => setLintText(yamlText)}>
                  Dùng workflow đã tạo
                </button>
                <button className={btnCls} onClick={() => setLintText(SAMPLE_BAD)}>
                  <Sparkles className="h-3 w-3 text-amber-500" /> Mẫu có lỗi
                </button>
                <button className={btnCls} onClick={() => setLintText('')}>
                  <Trash2 className="h-3 w-3" /> Xóa
                </button>
              </div>
            </div>
            <textarea
              ref={lintRef}
              value={lintText}
              onChange={(e) => setLintText(e.target.value)}
              spellCheck={false}
              placeholder={'name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4'}
              className="w-full h-[460px] p-3.5 text-[12px] leading-4 font-mono bg-slate-50 text-slate-800 rounded-b-xl resize-y focus:outline-hidden"
              style={{ tabSize: 2 }}
            />
            <p className="px-3.5 pb-2.5 text-[11px] text-slate-400">Mẹo: bấm vào mã quy tắc (vd GHA061 · dòng 12) để nhảy tới dòng đó. Kiểm tra mang tính tham khảo; hãy dùng thêm actionlint cho CI thực tế.</p>
          </section>
          <div className="space-y-3 min-w-0">
            <Card title="Kết quả" right={<CountBadges counts={userLint.counts} />}>
              {lintText.trim() ? <IssueList issues={userLint.issues} onJump={jumpTo} /> : <p className="text-xs text-slate-500">Hãy dán nội dung workflow để bắt đầu kiểm tra.</p>}
            </Card>
            <Card title="Giải thích workflow">
              {lintText.trim() ? <ExplainPanel ex={userExplain} /> : <p className="text-xs text-slate-500">Chưa có nội dung.</p>}
            </Card>
          </div>
        </div>
      )}

      {tab === 'dependabot' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5 items-start">
          <Card
            title="Cấu hình Dependabot"
            right={
              <div className="flex gap-1.5">
                {DEPENDABOT_ECOSYSTEMS.filter((e) => !deps.some((d) => d.ecosystem === e.id)).slice(0, 4).map((e) => (
                  <button key={e.id} className={btnCls} onClick={() => setDeps([...deps, newDependabotEntry(e.id)])}>
                    <Plus className="h-3 w-3" /> {e.id}
                  </button>
                ))}
              </div>
            }
          >
            {deps.map((d, i) => {
              const set = (p: Partial<DependabotEntry>) => setDeps(deps.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={d.uid} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                    <Field label="package-ecosystem">
                      <select className={inputCls} value={d.ecosystem} onChange={(e) => set({ ecosystem: e.target.value })}>
                        {DEPENDABOT_ECOSYSTEMS.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.id} — {e.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="directory">
                      <input className={monoCls} value={d.directory} onChange={(e) => set({ directory: e.target.value })} />
                    </Field>
                    <button className={iconBtn} onClick={() => setDeps(deps.filter((_, j) => j !== i))} title="Xóa">
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Field label="Tần suất">
                      <select className={inputCls} value={d.interval} onChange={(e) => set({ interval: e.target.value as DependabotEntry['interval'] })}>
                        <option value="daily">daily</option>
                        <option value="weekly">weekly</option>
                        <option value="monthly">monthly</option>
                      </select>
                    </Field>
                    <Field label="Ngày (weekly)">
                      <select className={inputCls} disabled={d.interval !== 'weekly'} value={d.day} onChange={(e) => set({ day: e.target.value })}>
                        {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Giờ (HH:MM)">
                      <input className={monoCls} value={d.time} placeholder="09:00" onChange={(e) => set({ time: e.target.value })} />
                    </Field>
                    <Field label="Giới hạn PR mở">
                      <input className={monoCls} value={d.limit} placeholder="5" onChange={(e) => set({ limit: e.target.value })} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Field label="labels">
                      <input className={monoCls} value={d.labels} placeholder="dependencies" onChange={(e) => set({ labels: e.target.value })} />
                    </Field>
                    <Field label="commit-message prefix">
                      <input className={monoCls} value={d.commitPrefix} placeholder="chore(deps)" onChange={(e) => set({ commitPrefix: e.target.value })} />
                    </Field>
                  </div>
                  <Check1 checked={d.groupMinorPatch} onChange={(v) => set({ groupMinorPatch: v })} label="Gộp các bản minor + patch vào một PR (groups)" />
                </div>
              );
            })}
            <div className="flex flex-wrap gap-1.5">
              <button className={btnPrimary} onClick={() => setDeps([...deps, { ...newDependabotEntry('npm'), uid: uid() }])}>
                <Plus className="h-3 w-3" /> Thêm hệ sinh thái
              </button>
            </div>
            <p className="text-[11px] text-slate-500">Dependabot cũng cập nhật phiên bản GitHub Actions (github-actions) — nên bật để các action trong workflow luôn mới. Thời gian tính theo UTC.</p>
          </Card>
          <section className="bg-white rounded-xl border border-slate-200 shadow-xs min-w-0 xl:sticky xl:top-3">
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-100">
              <div className="text-xs font-mono text-slate-600">.github/dependabot.yml</div>
              <div className="flex gap-1.5">
                <button className={btnCls} onClick={() => copy(depsYaml, 'Đã sao chép dependabot.yml!')}>
                  <Copy className="h-3 w-3" /> Sao chép
                </button>
                <button className={btnCls} onClick={() => download(depsYaml, 'dependabot.yml')}>
                  <Download className="h-3 w-3" /> Tải .yml
                </button>
              </div>
            </div>
            <pre className="p-3.5 text-[11.5px] leading-relaxed font-mono bg-slate-900 text-slate-100 rounded-b-xl overflow-auto max-h-[560px] whitespace-pre">{depsYaml}</pre>
          </section>
        </div>
      )}
    </div>
  );
}
