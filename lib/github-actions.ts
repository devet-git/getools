import YAML, { LineCounter, isMap, isScalar, isSeq, Scalar, YAMLMap, Pair } from 'yaml';

/* ========================================================================== */
/*  Kiểu dữ liệu của trình tạo                                                 */
/* ========================================================================== */

export interface KV {
  k: string;
  v: string;
}

export type InputType = 'string' | 'boolean' | 'choice' | 'environment' | 'number';

export interface InputDef {
  name: string;
  description: string;
  required: boolean;
  default: string;
  type: InputType;
  /** Các lựa chọn (cho type = choice), ngăn cách bởi dấu phẩy / xuống dòng */
  options: string;
}

export interface FilterTrigger {
  on: boolean;
  branches: string;
  tags: string;
  paths: string;
  types: string;
}

export interface TriggerDef {
  push: FilterTrigger;
  pull_request: FilterTrigger;
  pull_request_target: FilterTrigger;
  schedule: { on: boolean; crons: string };
  workflow_dispatch: { on: boolean; inputs: InputDef[] };
  release: { on: boolean; types: string };
  workflow_call: { on: boolean; inputs: InputDef[]; secrets: string };
}

export interface StepDef {
  uid: string;
  name: string;
  id: string;
  if: string;
  uses: string;
  with: KV[];
  run: string;
  env: KV[];
  workingDirectory: string;
  continueOnError: boolean;
  shell: string;
}

export interface ServiceDef {
  uid: string;
  name: string;
  image: string;
  ports: string;
  env: KV[];
  options: string;
}

export interface MatrixAxis {
  key: string;
  values: string;
}

export interface MatrixDef {
  enabled: boolean;
  axes: MatrixAxis[];
  include: string;
  exclude: string;
  failFast: 'default' | 'true' | 'false';
  maxParallel: string;
}

export interface JobDef {
  uid: string;
  id: string;
  name: string;
  runsOn: string;
  needs: string[];
  if: string;
  timeout: string;
  permissions: KV[];
  environment: string;
  environmentUrl: string;
  outputs: KV[];
  env: KV[];
  matrix: MatrixDef;
  services: ServiceDef[];
  steps: StepDef[];
}

export type PermMode = 'none' | 'read' | 'read-all' | 'empty' | 'custom';

export interface WorkflowDef {
  fileName: string;
  name: string;
  runName: string;
  triggers: TriggerDef;
  permMode: PermMode;
  permissions: KV[];
  concurrency: { on: boolean; group: string; cancel: string };
  env: KV[];
  defaultsShell: string;
  defaultsWorkingDir: string;
  jobs: JobDef[];
}

/* ========================================================================== */
/*  Hằng số & tiện ích                                                          */
/* ========================================================================== */

let uidCounter = 0;
export function uid(): string {
  uidCounter += 1;
  return `u${uidCounter}`;
}

export const RUNNERS = [
  'ubuntu-latest',
  'ubuntu-24.04',
  'ubuntu-22.04',
  'ubuntu-24.04-arm',
  'macos-latest',
  'macos-14',
  'windows-latest',
  'windows-2022',
  'self-hosted',
];

export const PERMISSION_SCOPES = [
  'actions',
  'attestations',
  'checks',
  'contents',
  'deployments',
  'discussions',
  'id-token',
  'issues',
  'models',
  'packages',
  'pages',
  'pull-requests',
  'repository-projects',
  'security-events',
  'statuses',
];

export const KNOWN_EVENTS = [
  'branch_protection_rule', 'check_run', 'check_suite', 'create', 'delete', 'deployment',
  'deployment_status', 'discussion', 'discussion_comment', 'fork', 'gollum', 'image_version',
  'issue_comment', 'issues', 'label', 'merge_group', 'milestone', 'page_build', 'project',
  'project_card', 'project_column', 'public', 'pull_request', 'pull_request_review',
  'pull_request_review_comment', 'pull_request_target', 'push', 'registry_package', 'release',
  'repository_dispatch', 'schedule', 'status', 'watch', 'workflow_call', 'workflow_dispatch',
  'workflow_run',
];

export const PR_TYPES = ['opened', 'synchronize', 'reopened', 'ready_for_review', 'closed', 'labeled', 'edited'];
export const RELEASE_TYPES = ['published', 'created', 'released', 'prereleased', 'edited', 'deleted'];

const MAX_INPUT = 400_000;

export function kv(o: Record<string, string>): KV[] {
  return Object.entries(o).map(([k, v]) => ({ k, v }));
}

export function splitList(s: string): string[] {
  return s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Ép kiểu giá trị đơn giản: true/false → boolean, số nguyên → number, còn lại giữ chuỗi. */
export function coerceScalar(v: string): string | number | boolean {
  const t = v.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^(0|[1-9]\d{0,14})$/.test(t)) return Number(t);
  return v;
}

function kvToObject(list: KV[], coerce = true): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const { k, v } of list) {
    const key = k.trim();
    if (!key) continue;
    out[key] = coerce ? coerceScalar(v) : v;
    n++;
  }
  return n ? out : undefined;
}

function cleanRun(s: string): string {
  const lines = s.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  while (lines.length && lines[0] === '') lines.shift();
  const body = lines.join('\n');
  return lines.length > 1 ? body + '\n' : body;
}

function quoted(s: string): Scalar {
  const sc = new Scalar(s);
  sc.type = 'QUOTE_SINGLE';
  return sc;
}

/* ========================================================================== */
/*  Cron (5 trường, GitHub Actions)                                             */
/* ========================================================================== */

export interface CronCheck {
  ok: boolean;
  error?: string;
  /** Khoảng cách nhỏ nhất (phút) giữa hai lần chạy trong cùng giờ */
  minGap?: number;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function cronField(
  src: string,
  min: number,
  max: number,
  label: string,
  names?: string[],
  nameBase = 0
): { values: number[] } | { error: string } {
  const set = new Set<number>();
  const num = (t: string): number | null => {
    if (/^\d+$/.test(t)) return Number(t);
    if (names) {
      const i = names.indexOf(t.toUpperCase());
      if (i >= 0) return i + nameBase;
    }
    return null;
  };
  for (const part of src.split(',')) {
    if (!part) return { error: `Trường ${label} có phần tử rỗng.` };
    const [range, step, extra] = part.split('/');
    if (extra !== undefined) return { error: `Trường ${label}: "${part}" có quá nhiều dấu "/".` };
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const [a, b, c] = range.split('-');
      if (c !== undefined) return { error: `Trường ${label}: "${part}" không hợp lệ.` };
      const na = num(a);
      if (na === null) return { error: `Trường ${label}: "${a}" không phải giá trị hợp lệ.` };
      lo = na;
      if (b !== undefined) {
        const nb = num(b);
        if (nb === null) return { error: `Trường ${label}: "${b}" không phải giá trị hợp lệ.` };
        hi = nb;
      } else {
        hi = step !== undefined ? max : na;
      }
    }
    if (lo < min || hi > max) return { error: `Trường ${label}: giá trị ngoài khoảng ${min}-${max}.` };
    if (lo > hi) return { error: `Trường ${label}: khoảng "${part}" bị ngược.` };
    let st = 1;
    if (step !== undefined) {
      if (!/^\d+$/.test(step) || Number(step) < 1) return { error: `Trường ${label}: bước "/${step}" không hợp lệ.` };
      st = Number(step);
    }
    for (let v = lo; v <= hi; v += st) set.add(v);
  }
  return { values: [...set].sort((a, b) => a - b) };
}

export function validateCron(expr: string): CronCheck {
  const t = expr.trim().replace(/\s+/g, ' ');
  if (!t) return { ok: false, error: 'Biểu thức cron đang trống.' };
  if (t.startsWith('@')) return { ok: false, error: 'GitHub Actions không hỗ trợ macro như @daily; hãy dùng 5 trường.' };
  const f = t.split(' ');
  if (f.length === 6) return { ok: false, error: 'Cron của GitHub chỉ có 5 trường (phút giờ ngày tháng thứ), không có giây.' };
  if (f.length !== 5) return { ok: false, error: `Cần đúng 5 trường (phút giờ ngày tháng thứ), hiện có ${f.length}.` };
  const defs: [string, number, number, string[]?, number?][] = [
    ['phút', 0, 59],
    ['giờ', 0, 23],
    ['ngày trong tháng', 1, 31],
    ['tháng', 1, 12, MONTHS, 1],
    ['thứ', 0, 7, DAYS, 0],
  ];
  let minutes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const [label, lo, hi, names, base] = defs[i];
    const r = cronField(f[i], lo, hi, label, names, base ?? 0);
    if ('error' in r) return { ok: false, error: r.error };
    if (i === 0) minutes = r.values;
  }
  let minGap: number | undefined;
  if (minutes.length > 1) {
    minGap = 60;
    for (let i = 1; i < minutes.length; i++) minGap = Math.min(minGap, minutes[i] - minutes[i - 1]);
    if (f[1] === '*') minGap = Math.min(minGap, 60 - minutes[minutes.length - 1] + minutes[0]);
  }
  return { ok: true, minGap };
}

/* ========================================================================== */
/*  Sinh YAML                                                                   */
/* ========================================================================== */

function inputsObject(inputs: InputDef[], forCall: boolean): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const inp of inputs) {
    const name = inp.name.trim();
    if (!name) continue;
    const o: Record<string, unknown> = {};
    if (inp.description.trim()) o.description = inp.description.trim();
    o.required = inp.required;
    let type = inp.type;
    if (forCall && (type === 'choice' || type === 'environment')) type = 'string';
    o.type = type;
    if (inp.default !== '') {
      if (type === 'boolean') o.default = inp.default === 'true';
      else if (type === 'number') o.default = Number.isFinite(Number(inp.default)) ? Number(inp.default) : inp.default;
      else if (type !== 'environment') o.default = inp.default;
    }
    if (!forCall && type === 'choice') o.options = splitList(inp.options);
    out[name] = o;
  }
  return Object.keys(out).length ? out : undefined;
}

function filterObject(t: FilterTrigger, withTags: boolean, withTypes: boolean): Record<string, unknown> | null {
  const o: Record<string, unknown> = {};
  if (withTypes && splitList(t.types).length) o.types = splitList(t.types);
  if (splitList(t.branches).length) o.branches = splitList(t.branches);
  if (withTags && splitList(t.tags).length) o.tags = splitList(t.tags);
  if (splitList(t.paths).length) o.paths = splitList(t.paths);
  return Object.keys(o).length ? o : null;
}

function stepObject(s: StepDef): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (s.name.trim()) o.name = s.name.trim();
  if (s.id.trim()) o.id = s.id.trim();
  if (s.if.trim()) o.if = s.if.trim();
  if (s.uses.trim()) o.uses = s.uses.trim();
  const w = kvToObject(s.with);
  if (w && s.uses.trim()) o.with = w;
  if (s.run.trim() && !s.uses.trim()) o.run = cleanRun(s.run);
  if (s.shell.trim()) o.shell = s.shell.trim();
  if (s.workingDirectory.trim()) o['working-directory'] = s.workingDirectory.trim();
  const e = kvToObject(s.env);
  if (e) o.env = e;
  if (s.continueOnError) o['continue-on-error'] = true;
  return o;
}

function parseMatrixEntries(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    const entry: Record<string, unknown> = {};
    for (const part of line.split(',')) {
      const i = part.indexOf('=');
      if (i <= 0) continue;
      entry[part.slice(0, i).trim()] = coerceScalar(part.slice(i + 1).trim());
    }
    if (Object.keys(entry).length) out.push(entry);
  }
  return out;
}

function jobObject(j: JobDef): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (j.name.trim()) o.name = j.name.trim();
  if (j.needs.length) o.needs = j.needs.length === 1 ? j.needs[0] : j.needs;
  if (j.if.trim()) o.if = j.if.trim();
  const ro = j.runsOn.trim() || 'ubuntu-latest';
  if (ro.includes(',') && !ro.includes('${{')) o['runs-on'] = splitList(ro);
  else o['runs-on'] = ro;
  if (j.timeout.trim()) o['timeout-minutes'] = coerceScalar(j.timeout);
  const perms = kvToObject(j.permissions, false);
  if (perms) o.permissions = perms;
  if (j.environment.trim()) {
    o.environment = j.environmentUrl.trim()
      ? { name: j.environment.trim(), url: j.environmentUrl.trim() }
      : j.environment.trim();
  }
  const outs = kvToObject(j.outputs, false);
  if (outs) o.outputs = outs;
  const env = kvToObject(j.env);
  if (env) o.env = env;
  if (j.matrix.enabled) {
    const st: Record<string, unknown> = {};
    if (j.matrix.failFast !== 'default') st['fail-fast'] = j.matrix.failFast === 'true';
    if (j.matrix.maxParallel.trim()) st['max-parallel'] = coerceScalar(j.matrix.maxParallel);
    const m: Record<string, unknown> = {};
    for (const ax of j.matrix.axes) {
      if (!ax.key.trim()) continue;
      const vals = splitList(ax.values).map(coerceScalar);
      if (vals.length) m[ax.key.trim()] = vals;
    }
    const inc = parseMatrixEntries(j.matrix.include);
    const exc = parseMatrixEntries(j.matrix.exclude);
    if (inc.length) m.include = inc;
    if (exc.length) m.exclude = exc;
    if (Object.keys(m).length) st.matrix = m;
    if (Object.keys(st).length) o.strategy = st;
  }
  const services: Record<string, unknown> = {};
  for (const s of j.services) {
    if (!s.name.trim() || !s.image.trim()) continue;
    const so: Record<string, unknown> = { image: s.image.trim() };
    const e = kvToObject(s.env);
    if (e) so.env = e;
    const ports = splitList(s.ports);
    if (ports.length) so.ports = ports;
    if (s.options.trim()) so.options = s.options.trim();
    services[s.name.trim()] = so;
  }
  if (Object.keys(services).length) o.services = services;
  o.steps = j.steps.map(stepObject).filter((s) => Object.keys(s).length > 0);
  return o;
}

export function buildWorkflowObject(w: WorkflowDef): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  if (w.name.trim()) root.name = w.name.trim();
  if (w.runName.trim()) root['run-name'] = w.runName.trim();

  const t = w.triggers;
  const on: Record<string, unknown> = {};
  if (t.push.on) on.push = filterObject(t.push, true, false);
  if (t.pull_request.on) on.pull_request = filterObject(t.pull_request, false, true);
  if (t.pull_request_target.on) on.pull_request_target = filterObject(t.pull_request_target, false, true);
  if (t.release.on) on.release = splitList(t.release.types).length ? { types: splitList(t.release.types) } : null;
  if (t.schedule.on) {
    // cron có thể chứa dấu phẩy, nên chỉ tách theo dòng
    const list = t.schedule.crons.split('\n').map((x) => x.trim()).filter(Boolean);
    if (list.length) on.schedule = list.map((c) => ({ cron: quoted(c) }));
  }
  if (t.workflow_dispatch.on) {
    const inp = inputsObject(t.workflow_dispatch.inputs, false);
    on.workflow_dispatch = inp ? { inputs: inp } : null;
  }
  if (t.workflow_call.on) {
    const wc: Record<string, unknown> = {};
    const inp = inputsObject(t.workflow_call.inputs, true);
    if (inp) wc.inputs = inp;
    const secrets: Record<string, unknown> = {};
    for (const n of splitList(t.workflow_call.secrets)) secrets[n] = { required: true };
    if (Object.keys(secrets).length) wc.secrets = secrets;
    on.workflow_call = Object.keys(wc).length ? wc : null;
  }
  root.on = on;

  if (w.permMode === 'read') root.permissions = { contents: 'read' };
  else if (w.permMode === 'read-all') root.permissions = 'read-all';
  else if (w.permMode === 'empty') root.permissions = {};
  else if (w.permMode === 'custom') {
    const p = kvToObject(w.permissions, false);
    if (p) root.permissions = p;
  }

  if (w.concurrency.on && w.concurrency.group.trim()) {
    const cancel = w.concurrency.cancel.trim();
    root.concurrency = { group: w.concurrency.group.trim(), 'cancel-in-progress': cancel === '' ? false : coerceScalar(cancel) };
  }
  const env = kvToObject(w.env);
  if (env) root.env = env;
  if (w.defaultsShell.trim() || w.defaultsWorkingDir.trim()) {
    const run: Record<string, unknown> = {};
    if (w.defaultsShell.trim()) run.shell = w.defaultsShell.trim();
    if (w.defaultsWorkingDir.trim()) run['working-directory'] = w.defaultsWorkingDir.trim();
    root.defaults = { run };
  }
  const jobs: Record<string, unknown> = {};
  for (const j of w.jobs) {
    const id = j.id.trim() || 'job';
    jobs[id] = jobObject(j);
  }
  root.jobs = jobs;
  return root;
}

export function generateWorkflowYaml(w: WorkflowDef): string {
  const obj = buildWorkflowObject(w);
  return YAML.stringify(obj, { lineWidth: 0, nullStr: '', indent: 2 });
}

/** Tên file an toàn cho .github/workflows/<tên>.yml */
export function safeFileName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\.ya?ml$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || 'workflow') + '.yml';
}

/* ========================================================================== */
/*  Dependabot                                                                  */
/* ========================================================================== */

export const DEPENDABOT_ECOSYSTEMS = [
  { id: 'npm', label: 'npm / pnpm / yarn', dir: '/' },
  { id: 'pip', label: 'pip / poetry / uv (Python)', dir: '/' },
  { id: 'gomod', label: 'Go modules', dir: '/' },
  { id: 'cargo', label: 'Cargo (Rust)', dir: '/' },
  { id: 'docker', label: 'Docker', dir: '/' },
  { id: 'github-actions', label: 'GitHub Actions', dir: '/' },
  { id: 'composer', label: 'Composer (PHP)', dir: '/' },
  { id: 'bundler', label: 'Bundler (Ruby)', dir: '/' },
  { id: 'maven', label: 'Maven', dir: '/' },
  { id: 'gradle', label: 'Gradle', dir: '/' },
  { id: 'nuget', label: 'NuGet (.NET)', dir: '/' },
  { id: 'terraform', label: 'Terraform', dir: '/' },
];

export interface DependabotEntry {
  uid: string;
  ecosystem: string;
  directory: string;
  interval: 'daily' | 'weekly' | 'monthly';
  day: string;
  time: string;
  limit: string;
  groupMinorPatch: boolean;
  labels: string;
  commitPrefix: string;
}

export function newDependabotEntry(ecosystem = 'npm'): DependabotEntry {
  return {
    uid: uid(),
    ecosystem,
    directory: '/',
    interval: 'weekly',
    day: 'monday',
    time: '',
    limit: '',
    groupMinorPatch: false,
    labels: '',
    commitPrefix: '',
  };
}

export function generateDependabot(entries: DependabotEntry[]): string {
  const updates = entries.map((e) => {
    const o: Record<string, unknown> = {
      'package-ecosystem': e.ecosystem,
      directory: e.directory.trim() || '/',
    };
    const sch: Record<string, unknown> = { interval: e.interval };
    if (e.interval === 'weekly' && e.day) sch.day = e.day;
    if (/^\d{2}:\d{2}$/.test(e.time.trim())) sch.time = quoted(e.time.trim());
    o.schedule = sch;
    if (/^\d+$/.test(e.limit.trim())) o['open-pull-requests-limit'] = Number(e.limit.trim());
    if (splitList(e.labels).length) o.labels = splitList(e.labels);
    if (e.commitPrefix.trim()) o['commit-message'] = { prefix: e.commitPrefix.trim() };
    if (e.groupMinorPatch) {
      o.groups = { 'minor-and-patch': { 'update-types': ['minor', 'patch'] } };
    }
    return o;
  });
  return YAML.stringify({ version: 2, updates }, { lineWidth: 0, indent: 2 });
}

/* ========================================================================== */
/*  Linter                                                                      */
/* ========================================================================== */

export type Severity = 'error' | 'warning' | 'info';

export interface LintIssue {
  rule: string;
  severity: Severity;
  line: number;
  col: number;
  message: string;
  fix?: string;
}

export const RULE_DOCS: Record<string, string> = {
  YAML001: 'Lỗi cú pháp YAML',
  GHA001: 'Gốc workflow phải là mapping',
  GHA002: 'Khóa cấp cao không hợp lệ / gõ sai',
  GHA003: 'Thiếu hoặc sai `on`',
  GHA004: 'Thiếu `jobs`',
  GHA010: 'Job thiếu `runs-on`',
  GHA011: 'Khóa job không hợp lệ / gõ sai',
  GHA012: 'Job không có `steps`',
  GHA020: 'Step thiếu `uses`/`run` hoặc có cả hai',
  GHA021: 'Khóa step không hợp lệ / dùng sai ngữ cảnh',
  GHA022: 'Định dạng `uses` sai',
  GHA023: 'Trùng `id` của step',
  GHA030: '`needs` tham chiếu job không tồn tại',
  GHA031: 'Vòng lặp phụ thuộc `needs`',
  GHA040: 'Action phiên bản cũ / bị loại bỏ',
  GHA041: 'Action ghim vào nhánh (@main/@master)',
  GHA042: 'Action bên thứ ba chưa ghim SHA',
  GHA050: 'Lệnh workflow bị loại bỏ',
  GHA060: 'pull_request_target + checkout mã PR (pwn request)',
  GHA061: 'Nguy cơ chèn lệnh (script injection)',
  GHA062: 'Rò rỉ / dùng sai secrets',
  GHA070: 'Thiếu `permissions`',
  GHA071: 'Quyền quá rộng hoặc không hợp lệ',
  GHA080: 'Runner đã bị loại bỏ',
  GHA081: '`runs-on: *-latest` có thể thay đổi',
  GHA082: 'Khóa matrix không tồn tại / không khớp',
  GHA090: '`continue-on-error` có thể che lỗi',
  GHA100: 'Cron không hợp lệ',
  GHA101: 'Cron chạy quá dày',
  GHA110: 'Lỗi cú pháp biểu thức ${{ }}',
  GHA111: '`if` trộn biểu thức và văn bản',
  GHA120: 'Job gọi reusable workflow dùng sai khóa',
  GHA130: 'Job chưa có `timeout-minutes`',
  GHA131: 'Tải script rồi chạy thẳng (curl | sh)',
};

const TOP_KEYS = ['name', 'run-name', 'on', 'permissions', 'env', 'defaults', 'concurrency', 'jobs'];
const JOB_KEYS = [
  'name', 'permissions', 'needs', 'if', 'runs-on', 'snapshot', 'environment', 'concurrency', 'outputs',
  'env', 'defaults', 'steps', 'timeout-minutes', 'strategy', 'continue-on-error', 'container', 'services',
  'uses', 'with', 'secrets',
];
const STEP_KEYS = ['id', 'if', 'name', 'uses', 'run', 'shell', 'with', 'env', 'continue-on-error', 'timeout-minutes', 'working-directory'];
const PERM_VALUES = ['read', 'write', 'none'];

const TYPO_MAP: Record<string, string> = {
  runs_on: 'runs-on', 'runs-ons': 'runs-on', runson: 'runs-on', 'run-on': 'runs-on', 'runs-in': 'runs-on',
  step: 'steps', job: 'jobs', permission: 'permissions', perms: 'permissions', need: 'needs',
  timeout_minutes: 'timeout-minutes', timeout: 'timeout-minutes', 'continue_on_error': 'continue-on-error',
  working_directory: 'working-directory', 'run_name': 'run-name', trigger: 'on', triggers: 'on', environments: 'environment',
  service: 'services', output: 'outputs', stratergy: 'strategy', startegy: 'strategy', env_vars: 'env',
};

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function suggestKey(key: string, valid: string[]): string | undefined {
  const k = key.toLowerCase();
  if (TYPO_MAP[k] && valid.includes(TYPO_MAP[k])) return TYPO_MAP[k];
  const norm = k.replace(/_/g, '-');
  if (valid.includes(norm) && norm !== key) return norm;
  let best: string | undefined;
  let bd = 3;
  for (const v of valid) {
    const d = lev(k, v);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

/** Quét các biểu thức ${{ ... }} trong chuỗi. */
export function scanExpressions(s: string): { start: number; end: number; body: string; error?: string }[] {
  const out: { start: number; end: number; body: string; error?: string }[] = [];
  let i = 0;
  while (i < s.length) {
    const st = s.indexOf('${{', i);
    if (st < 0) break;
    let j = st + 3;
    let inStr = false;
    let end = -1;
    while (j < s.length) {
      const c = s[j];
      if (inStr) {
        if (c === "'") {
          if (s[j + 1] === "'") j++;
          else inStr = false;
        }
      } else if (c === "'") inStr = true;
      else if (c === '}' && s[j + 1] === '}') {
        end = j;
        break;
      }
      j++;
    }
    if (end < 0) {
      out.push({ start: st, end: s.length, body: s.slice(st + 3), error: inStr ? 'Chuỗi trong biểu thức chưa đóng dấu nháy đơn.' : 'Biểu thức "${{" chưa có "}}" đóng.' });
      break;
    }
    const body = s.slice(st + 3, end);
    out.push({ start: st, end: end + 2, body, error: exprError(body) });
    i = end + 2;
  }
  return out;
}

function exprError(body: string): string | undefined {
  if (!body.trim()) return 'Biểu thức ${{ }} đang trống.';
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === "'") {
        if (body[i + 1] === "'") i++;
        else inStr = false;
      }
      continue;
    }
    if (c === "'") inStr = true;
    else if (c === '(' || c === '[') stack.push(c);
    else if (c === ')' || c === ']') {
      const o = stack.pop();
      if ((c === ')' && o !== '(') || (c === ']' && o !== '[')) return `Ngoặc "${c}" không khớp trong biểu thức.`;
    }
  }
  if (inStr) return 'Chuỗi trong biểu thức chưa đóng dấu nháy đơn.';
  if (stack.length) return 'Biểu thức thiếu ngoặc đóng.';
  if (/(&&|\|\|)\s*$/.test(body.trim()) || /^\s*(&&|\|\|)/.test(body)) return 'Toán tử &&/|| thiếu vế.';
  return undefined;
}

const UNTRUSTED =
  /github\.head_ref|github\.event\.(issue\.(title|body)|pull_request\.(title|body|head\.(ref|label|repo\.default_branch))|comment\.body|review\.body|review_comment\.body|discussion\.(title|body)|pages\.[^\s}]*\.page_name|commits\.[^\s}]*\.(message|author\.(email|name))|head_commit\.(message|author\.(email|name))|workflow_run\.(head_branch|head_commit\.(message|author\.(email|name))|pull_requests\.[^\s}]*\.head\.ref)|client_payload\.[^\s}]*)/;

const RUNNER_REMOVED: [RegExp, string][] = [
  [/^ubuntu-(16|18)\.04$/, 'ubuntu-latest'],
  [/^ubuntu-20\.04$/, 'ubuntu-22.04 hoặc ubuntu-24.04'],
  [/^macos-(10\.15|11|12|13)$/, 'macos-latest (hoặc macos-14/15)'],
  [/^windows-2019$/, 'windows-2022 hoặc windows-latest'],
  [/^windows-2016$/, 'windows-latest'],
];

interface ActionRule {
  min: number;
  sev: Severity;
  note?: string;
}
const ACTION_MIN: Record<string, ActionRule> = {
  'actions/checkout': { min: 4, sev: 'warning' },
  'actions/setup-node': { min: 4, sev: 'warning' },
  'actions/setup-python': { min: 5, sev: 'warning' },
  'actions/setup-go': { min: 5, sev: 'warning' },
  'actions/setup-java': { min: 4, sev: 'warning' },
  'actions/setup-dotnet': { min: 4, sev: 'warning' },
  'actions/upload-artifact': { min: 4, sev: 'error', note: 'v1-v3 đã bị GitHub ngừng hỗ trợ và sẽ làm job thất bại.' },
  'actions/download-artifact': { min: 4, sev: 'error', note: 'v1-v3 đã bị GitHub ngừng hỗ trợ và sẽ làm job thất bại.' },
  'actions/cache': { min: 4, sev: 'error', note: 'v1-v3 đã bị ngừng hỗ trợ (backend cache cũ đã tắt).' },
  'actions/github-script': { min: 7, sev: 'info' },
  'actions/configure-pages': { min: 5, sev: 'info' },
  'actions/upload-pages-artifact': { min: 3, sev: 'warning' },
  'actions/deploy-pages': { min: 4, sev: 'warning' },
  'actions/labeler': { min: 5, sev: 'info' },
  'actions/stale': { min: 9, sev: 'info' },
  'github/codeql-action': { min: 3, sev: 'warning', note: 'CodeQL Action v1/v2 đã bị loại bỏ.' },
  'docker/login-action': { min: 3, sev: 'info' },
  'docker/setup-buildx-action': { min: 3, sev: 'info' },
  'docker/setup-qemu-action': { min: 3, sev: 'info' },
  'docker/metadata-action': { min: 5, sev: 'info' },
  'docker/build-push-action': { min: 6, sev: 'info' },
};

const TRUSTED_OWNERS = new Set(['actions', 'github']);

export interface LintResult {
  issues: LintIssue[];
  parsed: boolean;
  counts: { error: number; warning: number; info: number };
}

export function lintWorkflow(text: string): LintResult {
  const issues: LintIssue[] = [];
  const finish = (parsed: boolean): LintResult => {
    issues.sort((a, b) => a.line - b.line || a.col - b.col);
    const counts = { error: 0, warning: 0, info: 0 };
    for (const i of issues) counts[i.severity]++;
    return { issues, parsed, counts };
  };

  if (!text.trim()) {
    issues.push({ rule: 'GHA001', severity: 'error', line: 1, col: 1, message: 'Workflow đang trống.', fix: 'Dán nội dung file .github/workflows/*.yml.' });
    return finish(false);
  }
  if (text.length > MAX_INPUT) {
    issues.push({ rule: 'YAML001', severity: 'error', line: 1, col: 1, message: `Nội dung quá lớn (> ${MAX_INPUT / 1000} KB) để phân tích.` });
    return finish(false);
  }

  const lc = new LineCounter();
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(text, { lineCounter: lc, uniqueKeys: true, prettyErrors: false });
  } catch (e) {
    issues.push({ rule: 'YAML001', severity: 'error', line: 1, col: 1, message: `Không đọc được YAML: ${(e as Error).message}` });
    return finish(false);
  }

  const add = (rule: string, severity: Severity, offset: number, message: string, fix?: string) => {
    const p = lc.linePos(Math.max(0, Math.min(offset, text.length)));
    issues.push({ rule, severity, line: p.line, col: p.col, message, fix });
  };
  const offOf = (n: unknown): number => {
    const r = (n as { range?: number[] } | null | undefined)?.range;
    return r ? r[0] : 0;
  };

  for (const e of doc.errors) {
    const lp = e.linePos?.[0] ?? (e.pos ? lc.linePos(e.pos[0]) : undefined);
    issues.push({
      rule: 'YAML001',
      severity: 'error',
      line: lp?.line ?? 1,
      col: lp?.col ?? 1,
      message: `Lỗi cú pháp YAML: ${e.message.split('\n')[0]}`,
      fix: 'Kiểm tra thụt lề (dùng khoảng trắng, không dùng tab), dấu ":" và dấu nháy.',
    });
  }
  if (doc.errors.length) return finish(false);

  const root = doc.contents;
  if (!isMap(root)) {
    add('GHA001', 'error', offOf(root), 'Gốc của workflow phải là một mapping (name, on, jobs, ...).', 'Bắt đầu file bằng `name:`, `on:`, `jobs:`.');
    return finish(true);
  }

  const get = (m: YAMLMap, key: string): Pair | undefined =>
    m.items.find((p) => isScalar(p.key) && String(p.key.value) === key) as Pair | undefined;
  const keyOff = (p: Pair) => offOf(p.key);
  const strOf = (n: unknown): string | undefined =>
    isScalar(n) && n.value !== null && n.value !== undefined && typeof n.value !== 'object' ? String(n.value) : undefined;
  const srcOf = (n: unknown): { src: string; base: number } => {
    const r = (n as { range?: number[] } | null)?.range;
    if (!r) return { src: '', base: 0 };
    return { src: text.slice(r[0], r[1]), base: r[0] };
  };

  /* --- Biểu thức trong mọi scalar --- */
  YAML.visit(doc, {
    Scalar(key, node) {
      if (key === 'key' || typeof node.value !== 'string') return;
      const { src, base } = srcOf(node);
      if (!src.includes('${{')) return;
      for (const ex of scanExpressions(src)) {
        if (ex.error) add('GHA110', 'error', base + ex.start, ex.error, 'Mỗi biểu thức phải có dạng ${{ ... }} với ngoặc và dấu nháy cân đối.');
      }
    },
  });

  /* --- Lệnh bị loại bỏ trong toàn file --- */
  const depRe: [RegExp, Severity, string, string][] = [
    [/::set-output\b/g, 'warning', '`::set-output` đã bị loại bỏ.', 'Ghi vào tệp: `echo "name=value" >> "$GITHUB_OUTPUT"`.'],
    [/::save-state\b/g, 'warning', '`::save-state` đã bị loại bỏ.', 'Ghi vào tệp: `echo "name=value" >> "$GITHUB_STATE"`.'],
    [/::set-env\b/g, 'error', '`::set-env` đã bị vô hiệu hóa vì lỗ hổng bảo mật.', 'Dùng `echo "NAME=value" >> "$GITHUB_ENV"`.'],
    [/::add-path\b/g, 'error', '`::add-path` đã bị vô hiệu hóa vì lỗ hổng bảo mật.', 'Dùng `echo "/path" >> "$GITHUB_PATH"`.'],
    [/ACTIONS_ALLOW_UNSECURE_COMMANDS/g, 'error', '`ACTIONS_ALLOW_UNSECURE_COMMANDS` bật lại các lệnh workflow không an toàn.', 'Xóa biến này và chuyển sang GITHUB_ENV / GITHUB_PATH / GITHUB_OUTPUT.'],
  ];
  for (const [re, sev, msg, fix] of depRe) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) add('GHA050', sev, m.index, msg, fix);
  }

  /* --- Khóa cấp cao --- */
  for (const p of root.items) {
    const k = strOf(p.key);
    if (k === undefined) continue;
    if (!TOP_KEYS.includes(k)) {
      const s = suggestKey(k, TOP_KEYS);
      add('GHA002', 'error', keyOff(p), `Khóa cấp cao không hợp lệ: "${k}".${s ? ` Ý bạn là "${s}"?` : ''}`, s ? `Đổi "${k}" thành "${s}".` : `Các khóa hợp lệ: ${TOP_KEYS.join(', ')}.`);
    }
  }

  /* --- on --- */
  const onPair = get(root, 'on');
  const events = new Set<string>();
  if (!onPair) {
    add('GHA003', 'error', offOf(root), 'Thiếu khóa `on` (sự kiện kích hoạt workflow).', 'Thêm ví dụ:\non:\n  push:\n    branches: [main]');
  } else {
    const onv = onPair.value;
    const checkEvent = (name: string, off: number) => {
      events.add(name);
      if (!KNOWN_EVENTS.includes(name)) {
        const s = suggestKey(name, KNOWN_EVENTS);
        add('GHA003', 'error', off, `Sự kiện không hợp lệ: "${name}".${s ? ` Ý bạn là "${s}"?` : ''}`, s ? `Đổi thành "${s}".` : 'Xem danh sách sự kiện: push, pull_request, schedule, workflow_dispatch, release, workflow_call, ...');
      }
    };
    if (isScalar(onv) && typeof onv.value === 'string') checkEvent(onv.value, offOf(onv));
    else if (isSeq(onv)) {
      for (const it of onv.items) {
        const s = strOf(it);
        if (s !== undefined) checkEvent(s, offOf(it));
        else add('GHA003', 'error', offOf(it), 'Phần tử của `on` phải là tên sự kiện.');
      }
    } else if (isMap(onv)) {
      for (const p of onv.items) {
        const name = strOf(p.key);
        if (name === undefined) continue;
        checkEvent(name, keyOff(p));
        const ev = p.value;
        if ((name === 'push' || name === 'pull_request' || name === 'pull_request_target') && isMap(ev)) {
          for (const [a, b] of [['branches', 'branches-ignore'], ['tags', 'tags-ignore'], ['paths', 'paths-ignore']]) {
            if (get(ev, a) && get(ev, b)) add('GHA003', 'error', keyOff(get(ev, b)!), `Không thể dùng đồng thời \`${a}\` và \`${b}\` cho \`${name}\`.`, `Chỉ giữ một trong hai; dùng mẫu "!pattern" trong \`${a}\` để loại trừ.`);
          }
        }
        if (name === 'schedule') {
          if (!isSeq(ev)) add('GHA100', 'error', keyOff(p), '`schedule` phải là danh sách các mục có `cron`.', 'schedule:\n  - cron: \'0 3 * * 1\'');
          else {
            for (const it of ev.items) {
              const cp = isMap(it) ? get(it, 'cron') : undefined;
              const cs = cp ? strOf(cp.value) : undefined;
              if (!cp || cs === undefined) {
                add('GHA100', 'error', offOf(it), 'Mục `schedule` thiếu `cron`.');
                continue;
              }
              const r = validateCron(cs);
              if (!r.ok) add('GHA100', 'error', offOf(cp.value), `Cron "${cs}" không hợp lệ: ${r.error}`, "Ví dụ hợp lệ: '30 2 * * 1-5' (02:30 UTC, thứ 2-6).");
              else if (r.minGap !== undefined && r.minGap < 5)
                add('GHA101', 'warning', offOf(cp.value), `Cron "${cs}" chạy mỗi ${r.minGap} phút; GitHub chỉ cho phép tối thiểu 5 phút và có thể bỏ lỡ/trì hoãn lượt chạy.`, "Dùng khoảng cách ≥ 5 phút, ví dụ '*/15 * * * *'. Lưu ý cron chạy theo UTC.");
            }
          }
        }
        if (name === 'workflow_dispatch' && isMap(ev)) {
          const ip = get(ev, 'inputs');
          if (ip && isMap(ip.value)) {
            for (const q of ip.value.items) {
              const im = q.value;
              if (!isMap(im)) continue;
              const tp = get(im, 'type');
              const ts = tp ? strOf(tp.value) : undefined;
              if (ts && !['string', 'boolean', 'choice', 'environment', 'number'].includes(ts))
                add('GHA003', 'error', offOf(tp!.value), `Kiểu input không hợp lệ: "${ts}".`, 'Dùng một trong: string, boolean, choice, environment, number.');
              if (ts === 'choice' && !get(im, 'options')) add('GHA003', 'error', keyOff(q), 'Input kiểu `choice` cần danh sách `options`.');
            }
          }
        }
      }
    } else if (onv === null || (isScalar(onv) && onv.value === null)) {
      add('GHA003', 'error', keyOff(onPair), '`on` đang rỗng.', 'Khai báo ít nhất một sự kiện, ví dụ `on: push`.');
    }
  }

  /* --- permissions --- */
  const checkPerms = (p: Pair | undefined, scope: string) => {
    if (!p) return;
    const v = p.value;
    if (isScalar(v) && typeof v.value === 'string') {
      if (v.value === 'write-all')
        add('GHA071', 'warning', offOf(v), `\`permissions: write-all\` (${scope}) cấp toàn quyền ghi cho GITHUB_TOKEN.`, 'Đặt `contents: read` rồi chỉ thêm quyền cần thiết cho từng job.');
      else if (v.value !== 'read-all') add('GHA071', 'error', offOf(v), `Giá trị permissions không hợp lệ: "${v.value}".`, 'Dùng read-all, write-all hoặc mapping scope: read|write|none.');
    } else if (isMap(v)) {
      for (const q of v.items) {
        const sk = strOf(q.key);
        const sv = strOf(q.value);
        if (sk === undefined) continue;
        if (!PERMISSION_SCOPES.includes(sk)) add('GHA071', 'error', keyOff(q), `Scope permissions không hợp lệ: "${sk}".`, `Scope hợp lệ: ${PERMISSION_SCOPES.join(', ')}.`);
        if (sv !== undefined && !PERM_VALUES.includes(sv)) add('GHA071', 'error', offOf(q.value), `Giá trị permissions "${sv}" không hợp lệ cho "${sk}".`, 'Dùng read, write hoặc none.');
      }
    }
  };
  const topPerm = get(root, 'permissions');
  checkPerms(topPerm, 'workflow');

  /* --- jobs --- */
  const jobsPair = get(root, 'jobs');
  if (!jobsPair || !isMap(jobsPair.value) || jobsPair.value.items.length === 0) {
    add('GHA004', 'error', jobsPair ? keyOff(jobsPair) : offOf(root), jobsPair ? '`jobs` phải là mapping có ít nhất một job.' : 'Thiếu khóa `jobs`.', 'Thêm:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4');
    return finish(true);
  }
  const jobsMap = jobsPair.value;
  const jobIds = new Set<string>();
  for (const p of jobsMap.items) {
    const id = strOf(p.key);
    if (id !== undefined) jobIds.add(id);
  }
  const graph = new Map<string, string[]>();
  const jobKeyOff = new Map<string, number>();
  let jobsMissingPerms = 0;
  const hasPRT = events.has('pull_request_target') || events.has('workflow_run');

  for (const jp of jobsMap.items) {
    const jid = strOf(jp.key);
    const job = jp.value;
    if (jid === undefined) continue;
    jobKeyOff.set(jid, keyOff(jp));
    if (!isMap(job)) {
      add('GHA011', 'error', keyOff(jp), `Job "${jid}" phải là mapping.`);
      continue;
    }
    const isCall = !!get(job, 'uses');
    for (const p of job.items) {
      const k = strOf(p.key);
      if (k === undefined) continue;
      if (!JOB_KEYS.includes(k)) {
        const s = suggestKey(k, JOB_KEYS);
        add('GHA011', 'error', keyOff(p), `Khóa job không hợp lệ: "${k}" trong job "${jid}".${s ? ` Ý bạn là "${s}"?` : ''}`, s ? `Đổi "${k}" thành "${s}".` : `Khóa hợp lệ: ${JOB_KEYS.join(', ')}.`);
      }
    }
    const ro = get(job, 'runs-on');
    if (!ro && !isCall) {
      const typo = job.items.find((p) => ['runs_on', 'runson', 'run-on', 'runs-in'].includes(String(strOf(p.key)).toLowerCase()));
      if (!typo) add('GHA010', 'error', keyOff(jp), `Job "${jid}" thiếu \`runs-on\`.`, 'Thêm `runs-on: ubuntu-latest` (hoặc dùng `uses:` để gọi reusable workflow).');
    }
    if (isCall) {
      for (const bad of ['steps', 'runs-on']) {
        const bp = get(job, bad);
        if (bp) add('GHA120', 'error', keyOff(bp), `Job "${jid}" dùng \`uses\` (reusable workflow) nên không được có \`${bad}\`.`, `Xóa \`${bad}\` hoặc bỏ \`uses\`.`);
      }
    } else if (!get(job, 'steps')) {
      const typo = job.items.find((p) => ['step', 'stepss', 'steps_'].includes(String(strOf(p.key)).toLowerCase()));
      if (!typo) add('GHA012', 'error', keyOff(jp), `Job "${jid}" thiếu \`steps\`.`, 'Thêm danh sách `steps:` với ít nhất một step.');
    }

    // permissions
    const jperm = get(job, 'permissions');
    checkPerms(jperm, `job ${jid}`);
    if (!jperm) jobsMissingPerms++;

    // timeout
    if (!isCall && !get(job, 'timeout-minutes')) add('GHA130', 'info', keyOff(jp), `Job "${jid}" chưa đặt \`timeout-minutes\` (mặc định 360 phút).`, 'Thêm `timeout-minutes: 15` (hoặc phù hợp) để tránh job treo tốn phút chạy.');
    const coe = get(job, 'continue-on-error');
    if (coe && strOf(coe.value) === 'true') add('GHA090', 'info', keyOff(coe), `Job "${jid}" có \`continue-on-error: true\`: lỗi sẽ không làm workflow thất bại.`, 'Bỏ nếu job này là required check.');

    // needs
    const np = get(job, 'needs');
    const needs: string[] = [];
    if (np) {
      const items = isSeq(np.value) ? np.value.items : [np.value];
      for (const it of items) {
        const s = strOf(it);
        if (s === undefined) continue;
        needs.push(s);
        if (s === jid) add('GHA031', 'error', offOf(it), `Job "${jid}" tự phụ thuộc chính nó.`, 'Xóa phần tử này khỏi `needs`.');
        else if (!jobIds.has(s)) {
          const sg = suggestKey(s, [...jobIds]);
          add('GHA030', 'error', offOf(it), `\`needs\` tham chiếu job không tồn tại: "${s}".${sg ? ` Ý bạn là "${sg}"?` : ''}`, `Các job hiện có: ${[...jobIds].join(', ')}.`);
        }
      }
    }
    graph.set(jid, needs.filter((n) => jobIds.has(n) && n !== jid));

    // strategy.matrix
    const matrixKeys = new Set<string>();
    const matrixAxes = new Map<string, unknown[]>();
    const sp = get(job, 'strategy');
    if (sp && isMap(sp.value)) {
      const mp = get(sp.value, 'matrix');
      if (mp && isMap(mp.value)) {
        const m = mp.value;
        for (const q of m.items) {
          const k = strOf(q.key);
          if (k === undefined) continue;
          if (k !== 'include' && k !== 'exclude') {
            matrixKeys.add(k);
            if (isSeq(q.value)) matrixAxes.set(k, q.value.toJS(doc) as unknown[]);
          }
        }
        const inc = get(m, 'include');
        if (inc && isSeq(inc.value))
          for (const it of inc.value.items) if (isMap(it)) for (const q of it.items) { const k = strOf(q.key); if (k) matrixKeys.add(k); }
        const exc = get(m, 'exclude');
        if (exc && isSeq(exc.value)) {
          for (const it of exc.value.items) {
            if (!isMap(it)) continue;
            for (const q of it.items) {
              const k = strOf(q.key);
              if (!k) continue;
              if (!matrixAxes.has(k)) {
                add('GHA082', 'warning', keyOff(q), `\`exclude\` dùng khóa "${k}" không có trong ma trận nên sẽ không bao giờ khớp.`, `Khóa của ma trận: ${[...matrixAxes.keys()].join(', ') || '(không có)'}.`);
              } else if (isScalar(q.value)) {
                const vals = matrixAxes.get(k)!.map((x) => String(x));
                if (!vals.includes(String(q.value.value))) add('GHA082', 'warning', offOf(q.value), `\`exclude\`: giá trị "${String(q.value.value)}" không nằm trong danh sách "${k}" (${vals.join(', ')}) nên không có tác dụng.`);
              }
            }
          }
        }
      } else if (mp && !(isScalar(mp.value) && typeof mp.value.value === 'string')) {
        add('GHA082', 'error', keyOff(mp), '`strategy.matrix` phải là mapping hoặc biểu thức ${{ fromJSON(...) }}.');
      }
      const mpar = get(sp.value, 'max-parallel');
      const ff = get(sp.value, 'fail-fast');
      if (mpar && strOf(mpar.value) !== undefined && /^\d+$/.test(strOf(mpar.value)!) && Number(strOf(mpar.value)) < 1) add('GHA082', 'error', offOf(mpar.value), '`max-parallel` phải ≥ 1.');
      if (ff && strOf(ff.value) !== undefined && !['true', 'false'].includes(strOf(ff.value)!) && !strOf(ff.value)!.includes('${{')) add('GHA082', 'error', offOf(ff.value), '`fail-fast` phải là true/false.');
    }
    // matrix.<key> references
    {
      const { src, base } = srcOf(job);
      const re = /matrix\.([A-Za-z_][\w-]*)/g;
      let m: RegExpExecArray | null;
      const hasMatrix = !!sp;
      const dyn = sp && isMap(sp.value) && (() => { const mp = get(sp.value as YAMLMap, 'matrix'); return !!mp && !isMap(mp.value); })();
      if (hasMatrix && !dyn) {
        while ((m = re.exec(src))) {
          if (!matrixKeys.has(m[1])) add('GHA082', 'warning', base + m.index, `\`matrix.${m[1]}\` không được khai báo trong strategy.matrix của job "${jid}".`, `Khóa hiện có: ${[...matrixKeys].join(', ') || '(không có)'}.`);
        }
      }
    }

    // runs-on
    if (ro) {
      const labels: { s: string; off: number }[] = [];
      const collect = (n: unknown) => {
        if (isScalar(n) && typeof n.value === 'string') {
          const s = n.value;
          const mm = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(s.trim());
          if (mm && matrixAxes.has(mm[1])) for (const v of matrixAxes.get(mm[1])!) labels.push({ s: String(v), off: offOf(n) });
          else labels.push({ s, off: offOf(n) });
        } else if (isSeq(n)) n.items.forEach(collect);
        else if (isMap(n)) {
          const l = get(n, 'labels');
          if (l) collect(l.value);
        }
      };
      collect(ro.value);
      for (const { s, off } of labels) {
        const rm = RUNNER_REMOVED.find(([re]) => re.test(s));
        if (rm) add('GHA080', 'error', off, `Runner "${s}" đã bị GitHub loại bỏ, job sẽ không chạy.`, `Đổi sang ${rm[1]}.`);
        else if (/^(ubuntu|macos|windows)-latest$/.test(s)) add('GHA081', 'info', off, `\`${s}\` sẽ trỏ sang phiên bản OS mới khi GitHub cập nhật, có thể làm build thay đổi.`, 'Ghim phiên bản cụ thể (vd ubuntu-24.04) nếu cần build tái lập.');
      }
    }

    // steps
    const stepsPair = get(job, 'steps');
    if (stepsPair && !isSeq(stepsPair.value)) add('GHA012', 'error', keyOff(stepsPair), '`steps` phải là một danh sách (mỗi step bắt đầu bằng "- ").');
    if (stepsPair && isSeq(stepsPair.value)) {
      const seenIds = new Map<string, number>();
      for (const st of stepsPair.value.items) {
        if (!isMap(st)) {
          add('GHA020', 'error', offOf(st), 'Mỗi step phải là một mapping (name/uses/run...).');
          continue;
        }
        const up = get(st, 'uses');
        const rp = get(st, 'run');
        if (!up && !rp) {
          add('GHA020', 'error', offOf(st), 'Step phải có `uses` hoặc `run`.', 'Thêm `run: <lệnh>` hoặc `uses: owner/action@ref`.');
        } else if (up && rp) {
          add('GHA020', 'error', keyOff(rp), 'Step không được có đồng thời `uses` và `run`.', 'Tách thành hai step riêng.');
        }
        for (const p of st.items) {
          const k = strOf(p.key);
          if (k === undefined) continue;
          if (!STEP_KEYS.includes(k)) {
            const s = suggestKey(k, STEP_KEYS);
            add('GHA021', 'error', keyOff(p), `Khóa step không hợp lệ: "${k}".${s ? ` Ý bạn là "${s}"?` : ''}`, s ? `Đổi thành "${s}".` : `Khóa hợp lệ: ${STEP_KEYS.join(', ')}.`);
          }
        }
        const wp = get(st, 'with');
        if (wp && !up) add('GHA021', 'warning', keyOff(wp), '`with` chỉ có tác dụng với step dùng `uses`.', 'Dùng `env` cho step `run`.');
        if (up) {
          for (const bad of ['shell', 'working-directory']) {
            const bp = get(st, bad);
            if (bp) add('GHA021', 'warning', keyOff(bp), `\`${bad}\` chỉ áp dụng cho step \`run\`, không có tác dụng với \`uses\`.`);
          }
        }
        const idp = get(st, 'id');
        const ids = idp ? strOf(idp.value) : undefined;
        if (ids) {
          if (seenIds.has(ids)) add('GHA023', 'error', offOf(idp!.value), `Trùng \`id\` step "${ids}" trong job "${jid}".`, 'Mỗi step id phải duy nhất trong job.');
          seenIds.set(ids, 1);
        }
        const sc = get(st, 'continue-on-error');
        if (sc && strOf(sc.value) === 'true') add('GHA090', 'info', keyOff(sc), 'Step có `continue-on-error: true`: lỗi step này sẽ bị bỏ qua.', 'Chỉ dùng cho step không bắt buộc.');

        // if
        const ifp = get(st, 'if');
        if (ifp) checkIf(ifp);

        // uses
        if (up) {
          const u = strOf(up.value);
          if (u !== undefined) checkUses(u, offOf(up.value), st);
        }
        // run
        if (rp && isScalar(rp.value) && typeof rp.value.value === 'string') {
          checkRun(rp.value, rp.value.value);
        }
        // github-script
        if (up && (strOf(up.value) ?? '').startsWith('actions/github-script') && wp && isMap(wp.value)) {
          const scp = get(wp.value, 'script');
          if (scp && isScalar(scp.value)) checkInjection(scp.value);
        }
      }
    }
    const jif = get(job, 'if');
    if (jif) checkIf(jif);
  }

  function checkIf(p: Pair) {
    const s = strOf(p.value);
    if (s === undefined) return;
    const { src, base } = srcOf(p.value);
    if (/\bsecrets\./.test(s)) {
      const i = src.search(/\bsecrets\./);
      add('GHA062', 'error', base + Math.max(0, i), 'Không thể tham chiếu `secrets` trực tiếp trong `if`.', 'Gán secret vào `env` của job rồi kiểm tra `env.NAME != \'\'`, hoặc truyền qua output.');
    }
    const t = s.trim();
    if (t.startsWith('${{')) {
      const ex = scanExpressions(t);
      if (ex.length && !ex[0].error && ex[0].start === 0 && ex[0].end < t.length && t.slice(ex[0].end).trim() !== '') {
        add('GHA111', 'warning', base, '`if` có văn bản nằm ngoài ${{ }} nên luôn được hiểu là chuỗi (luôn đúng).', 'Đưa toàn bộ điều kiện vào trong một biểu thức, hoặc bỏ ${{ }}.');
      }
    } else if (!t.includes('${{')) {
      const e = exprError(t);
      if (e) add('GHA110', 'error', base, e);
    }
  }

  function checkUses(u: string, off: number, step: YAMLMap) {
    if (u.startsWith('./') || u.startsWith('docker://') || u.includes('${{')) return;
    const at = u.lastIndexOf('@');
    if (at < 0) {
      add('GHA022', 'error', off, `\`uses: ${u}\` thiếu phần @phiên_bản.`, `Thêm @ref, ví dụ ${u}@v4.`);
      return;
    }
    const name = u.slice(0, at);
    const ref = u.slice(at + 1);
    if (!/^[\w.-]+\/[\w.-]+(\/.+)?$/.test(name)) {
      add('GHA022', 'error', off, `\`uses: ${u}\` sai định dạng (cần owner/repo[/path]@ref).`);
      return;
    }
    if (/^(main|master|HEAD|develop|dev|trunk)$/.test(ref)) {
      add('GHA041', 'warning', off, `Action "${name}" ghim vào nhánh "${ref}": mã có thể thay đổi bất kỳ lúc nào.`, 'Dùng tag phiên bản hoặc SHA commit đầy đủ (40 ký tự).');
    }
    const parts = name.split('/');
    const base = parts.slice(0, 2).join('/');
    const owner = parts[0].toLowerCase();
    const rule = ACTION_MIN[base.toLowerCase()];
    const vm = /^v?(\d+)(?:\.\d+)*$/.exec(ref);
    if (rule && vm && Number(vm[1]) < rule.min) {
      add('GHA040', rule.sev, off, `${base}@${ref} là phiên bản cũ (khuyến nghị v${rule.min}+). ${rule.note ?? ''}`.trim(), `Nâng lên ${u.slice(0, at)}@v${rule.min}.`);
    }
    if (!TRUSTED_OWNERS.has(owner) && !/^[0-9a-f]{40}$/i.test(ref) && ref !== 'main' && ref !== 'master') {
      add('GHA042', 'info', off, `Action bên thứ ba "${base}" chưa ghim vào SHA commit.`, `Ghim ${base}@<sha 40 ký tự> # ${ref} để chống tấn công chuỗi cung ứng.`);
    }
    // pwn request
    if (hasPRT && base === 'actions/checkout') {
      const wp = get(step, 'with');
      if (wp && isMap(wp.value)) {
        for (const key of ['ref', 'repository']) {
          const rp = get(wp.value, key);
          const rs = rp ? strOf(rp.value) : undefined;
          if (rp && rs && /github\.event\.pull_request\.head|github\.head_ref|refs\/pull\/|github\.event\.workflow_run\.head|github\.event\.number/.test(rs)) {
            add('GHA060', 'error', offOf(rp.value), `Workflow dùng \`${events.has('pull_request_target') ? 'pull_request_target' : 'workflow_run'}\` nhưng checkout mã từ PR (\`${key}: ${rs}\`): mã không tin cậy chạy với quyền ghi và secrets ("pwn request").`, 'Dùng sự kiện `pull_request` cho build/test mã PR, hoặc tách thành 2 workflow (workflow_run) chỉ đọc artifact, không chạy mã PR.');
          }
        }
      }
    }
  }

  function checkInjection(node: unknown) {
    const { src, base } = srcOf(node);
    for (const ex of scanExpressions(src)) {
      if (ex.error) continue;
      const m = UNTRUSTED.exec(ex.body);
      if (m) {
        add('GHA061', 'error', base + ex.start, `Biểu thức \`${m[0]}\` do người dùng bên ngoài kiểm soát được chèn trực tiếp vào script: nguy cơ thực thi lệnh tùy ý.`, 'Truyền qua biến môi trường: `env:\n  VALUE: ${{ ' + m[0] + ' }}` rồi dùng "$VALUE" trong script.');
      }
    }
  }

  function checkRun(node: Scalar, script: string) {
    checkInjection(node);
    const { src, base } = srcOf(node);
    const re = /^.*\b(?:echo|printf|cat)\b.*\$\{\{\s*secrets\..*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) add('GHA062', 'warning', base + m.index, 'Secret được in ra log (echo/printf) qua `${{ secrets.* }}`; giá trị biến đổi có thể không bị che.', 'Truyền secret qua `env:` và không in ra; dùng `::add-mask::` nếu phải xử lý.');
    const re2 = /(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/g;
    while ((m = re2.exec(script))) {
      const idx = src.indexOf(m[0]);
      add('GHA131', 'info', base + Math.max(0, idx), 'Tải script từ mạng rồi chạy thẳng (curl | sh) rủi ro nếu nguồn bị xâm phạm.', 'Tải về, kiểm tra checksum/chữ ký rồi mới chạy, hoặc dùng action đã ghim SHA.');
    }
  }

  /* --- permissions thiếu --- */
  if (!topPerm && jobsMissingPerms > 0) {
    add('GHA070', 'warning', keyOff(jobsPair), 'Workflow chưa khai báo `permissions`: GITHUB_TOKEN có thể mang quyền mặc định rất rộng (tùy cài đặt repo).', 'Thêm ở cấp workflow:\npermissions:\n  contents: read');
  }

  /* --- chu trình needs --- */
  const state = new Map<string, number>();
  const reported = new Set<string>();
  const stack: string[] = [];
  const dfs = (n: string) => {
    state.set(n, 1);
    stack.push(n);
    for (const d of graph.get(n) ?? []) {
      if (state.get(d) === 1) {
        const cyc = stack.slice(stack.indexOf(d));
        const key = [...cyc].sort().join('>');
        if (!reported.has(key)) {
          reported.add(key);
          add('GHA031', 'error', jobKeyOff.get(d) ?? 0, `Vòng lặp phụ thuộc \`needs\`: ${[...cyc, d].join(' → ')}.`, 'Phá vòng bằng cách xóa một phụ thuộc.');
        }
      } else if (!state.get(d)) dfs(d);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const id of graph.keys()) if (!state.get(id)) dfs(id);

  return finish(true);
}

/* ========================================================================== */
/*  Giải thích workflow                                                         */
/* ========================================================================== */

export interface ExplainNode {
  id: string;
  name: string;
  needs: string[];
  level: number;
  runsOn: string;
  steps: number;
  matrixSize: number;
  x: number;
  y: number;
}

export interface Explanation {
  ok: boolean;
  error?: string;
  name: string;
  triggers: string[];
  nodes: ExplainNode[];
  edges: { from: string; to: string }[];
  levels: string[][];
  maxParallel: number;
  ascii: string;
  width: number;
  height: number;
}

function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return [v];
  return [];
}

function describeCronVi(c: string): string {
  const f = c.trim().split(/\s+/);
  if (f.length !== 5) return c;
  const [mi, h, dom, mo, dow] = f;
  const pad = (s: string) => s.padStart(2, '0');
  if (/^\d+$/.test(mi) && /^\d+$/.test(h)) {
    const t = `${pad(h)}:${pad(mi)} UTC`;
    if (dom === '*' && mo === '*' && dow === '*') return `mỗi ngày lúc ${t}`;
    if (dom === '*' && mo === '*') return `lúc ${t}, thứ (cron) ${dow}`;
    if (mo === '*' && dow === '*') return `lúc ${t}, ngày ${dom} hằng tháng`;
    return `lúc ${t} (ngày ${dom}, tháng ${mo}, thứ ${dow})`;
  }
  if (/^\*\/\d+$/.test(mi) && h === '*') return `mỗi ${mi.slice(2)} phút`;
  if (mi === '0' && /^\*\/\d+$/.test(h)) return `mỗi ${h.slice(2)} giờ`;
  return `theo lịch UTC "${c}"`;
}

export function explainWorkflow(text: string): Explanation {
  const empty: Explanation = { ok: false, name: '', triggers: [], nodes: [], edges: [], levels: [], maxParallel: 0, ascii: '', width: 0, height: 0 };
  if (!text.trim() || text.length > MAX_INPUT) return { ...empty, error: 'Không có nội dung để giải thích.' };
  let data: unknown;
  try {
    const doc = YAML.parseDocument(text);
    if (doc.errors.length) return { ...empty, error: 'YAML có lỗi cú pháp, hãy sửa trước khi giải thích.' };
    data = doc.toJS();
  } catch {
    return { ...empty, error: 'Không đọc được YAML.' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...empty, error: 'Gốc workflow phải là mapping.' };
  const root = data as Record<string, unknown>;
  const onv = root.on ?? root['true'];
  const triggers: string[] = [];
  const evs: Record<string, unknown> = {};
  if (typeof onv === 'string') evs[onv] = null;
  else if (Array.isArray(onv)) for (const e of onv) evs[String(e)] = null;
  else if (onv && typeof onv === 'object') Object.assign(evs, onv);
  for (const [name, cfgRaw] of Object.entries(evs)) {
    const cfg = (cfgRaw && typeof cfgRaw === 'object' ? cfgRaw : {}) as Record<string, unknown>;
    const parts: string[] = [];
    const br = arr(cfg.branches);
    const tg = arr(cfg.tags);
    const pa = arr(cfg.paths);
    if (br.length) parts.push(`nhánh ${br.join(', ')}`);
    if (tg.length) parts.push(`tag ${tg.join(', ')}`);
    if (pa.length) parts.push(`khi đổi file ${pa.join(', ')}`);
    const ty = arr(cfg.types);
    const filt = parts.length ? ` (${parts.join('; ')})` : '';
    switch (name) {
      case 'push': triggers.push(`Khi push${filt || ' lên bất kỳ nhánh nào'}.`); break;
      case 'pull_request': triggers.push(`Khi pull request${ty.length ? ` ${ty.join('/')}` : ' được mở/cập nhật/mở lại'}${filt}.`); break;
      case 'pull_request_target': triggers.push(`Khi pull_request_target${filt} (chạy với ngữ cảnh repo gốc, cần thận trọng).`); break;
      case 'schedule': {
        const list = Array.isArray(cfgRaw) ? cfgRaw : [];
        for (const it of list) {
          const c = (it as { cron?: unknown })?.cron;
          if (typeof c === 'string') triggers.push(`Theo lịch: ${describeCronVi(c)} (cron "${c}", múi giờ UTC).`);
        }
        break;
      }
      case 'workflow_dispatch': {
        const inp = cfg.inputs && typeof cfg.inputs === 'object' ? Object.keys(cfg.inputs as object) : [];
        triggers.push(`Chạy thủ công từ tab Actions${inp.length ? ` (input: ${inp.join(', ')})` : ''}.`);
        break;
      }
      case 'release': triggers.push(`Khi release ${ty.length ? ty.join('/') : 'được tạo/xuất bản'}.`); break;
      case 'workflow_call': triggers.push('Là reusable workflow, được workflow khác gọi bằng `uses`.'); break;
      case 'workflow_run': triggers.push('Khi một workflow khác chạy xong.'); break;
      case 'issues': triggers.push(`Khi issue có thay đổi${ty.length ? ` (${ty.join('/')})` : ''}.`); break;
      default: triggers.push(`Khi sự kiện \`${name}\` xảy ra.`);
    }
  }

  const jobsRaw = (root.jobs && typeof root.jobs === 'object' ? root.jobs : {}) as Record<string, unknown>;
  const ids = Object.keys(jobsRaw);
  const needsOf = new Map<string, string[]>();
  const info = new Map<string, { name: string; runsOn: string; steps: number; matrix: number }>();
  for (const id of ids) {
    const j = (jobsRaw[id] && typeof jobsRaw[id] === 'object' ? jobsRaw[id] : {}) as Record<string, unknown>;
    needsOf.set(id, arr(j.needs).filter((n) => ids.includes(n) && n !== id));
    let msize = 1;
    const st = j.strategy as { matrix?: unknown } | undefined;
    if (st && st.matrix && typeof st.matrix === 'object') {
      const m = st.matrix as Record<string, unknown>;
      let prod = 1;
      let axes = 0;
      for (const [k, v] of Object.entries(m)) {
        if (k === 'include' || k === 'exclude') continue;
        if (Array.isArray(v)) {
          prod *= Math.max(1, v.length);
          axes++;
        }
      }
      const exc = Array.isArray(m.exclude) ? m.exclude.length : 0;
      const inc = Array.isArray(m.include) ? m.include.length : 0;
      msize = Math.min(256, Math.max(1, (axes ? prod - exc : 0) + inc || 1));
    }
    const ro = j.uses ? `gọi ${String(j.uses)}` : Array.isArray(j['runs-on']) ? (j['runs-on'] as unknown[]).join('+') : typeof j['runs-on'] === 'object' && j['runs-on'] ? JSON.stringify(j['runs-on']) : String(j['runs-on'] ?? '?');
    info.set(id, { name: typeof j.name === 'string' ? j.name : id, runsOn: ro, steps: Array.isArray(j.steps) ? j.steps.length : 0, matrix: msize });
  }
  const levelMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const levelOf = (id: string): number => {
    if (levelMemo.has(id)) return levelMemo.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let l = 0;
    for (const n of needsOf.get(id) ?? []) l = Math.max(l, levelOf(n) + 1);
    visiting.delete(id);
    levelMemo.set(id, l);
    return l;
  };
  const levels: string[][] = [];
  for (const id of ids) {
    const l = levelOf(id);
    (levels[l] ||= []).push(id);
  }
  for (let i = 0; i < levels.length; i++) levels[i] ||= [];
  const nodes: ExplainNode[] = [];
  const colW = 200;
  const rowH = 58;
  levels.forEach((col, ci) => {
    col.forEach((id, ri) => {
      const inf = info.get(id)!;
      nodes.push({ id, name: inf.name, needs: needsOf.get(id) ?? [], level: ci, runsOn: inf.runsOn, steps: inf.steps, matrixSize: inf.matrix, x: ci * colW + 8, y: ri * rowH + 8 });
    });
  });
  const edges: { from: string; to: string }[] = [];
  for (const n of nodes) for (const d of n.needs) edges.push({ from: d, to: n.id });
  let maxParallel = 0;
  for (const col of levels) maxParallel = Math.max(maxParallel, col.reduce((s, id) => s + (info.get(id)?.matrix ?? 1), 0));
  const ascii = levels
    .map((col, i) => {
      const parts = col.map((id) => {
        const n = needsOf.get(id) ?? [];
        const mx = (info.get(id)?.matrix ?? 1) > 1 ? ` ×${info.get(id)!.matrix}` : '';
        return `${id}${mx}${n.length ? ` ← ${n.join(', ')}` : ''}`;
      });
      return `Tầng ${i + 1} ─ ${parts.join('  ║  ')}`;
    })
    .join('\n');
  return {
    ok: true,
    name: typeof root.name === 'string' ? root.name : '',
    triggers,
    nodes,
    edges,
    levels,
    maxParallel,
    ascii,
    width: Math.max(1, levels.length) * colW,
    height: Math.max(1, ...levels.map((c) => c.length)) * rowH + 16,
  };
}

/* ========================================================================== */
/*  Preset                                                                      */
/* ========================================================================== */

export function newStep(o: Partial<StepDef> = {}): StepDef {
  return { uid: uid(), name: '', id: '', if: '', uses: '', with: [], run: '', env: [], workingDirectory: '', continueOnError: false, shell: '', ...o };
}

export function newMatrix(o: Partial<MatrixDef> = {}): MatrixDef {
  return { enabled: false, axes: [], include: '', exclude: '', failFast: 'default', maxParallel: '', ...o };
}

export function newJob(o: Partial<JobDef> = {}): JobDef {
  return {
    uid: uid(), id: 'build', name: '', runsOn: 'ubuntu-latest', needs: [], if: '', timeout: '15', permissions: [],
    environment: '', environmentUrl: '', outputs: [], env: [], matrix: newMatrix(), services: [], steps: [newStep({ name: 'Checkout', uses: 'actions/checkout@v4' })], ...o,
  };
}

export function newService(preset: 'postgres' | 'redis' | 'mysql' | 'mongo' | 'custom'): ServiceDef {
  switch (preset) {
    case 'postgres':
      return { uid: uid(), name: 'postgres', image: 'postgres:16', ports: '5432:5432', env: kv({ POSTGRES_PASSWORD: 'postgres', POSTGRES_DB: 'test' }), options: '--health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5' };
    case 'redis':
      return { uid: uid(), name: 'redis', image: 'redis:7', ports: '6379:6379', env: [], options: '--health-cmd "redis-cli ping" --health-interval 10s --health-timeout 5s --health-retries 5' };
    case 'mysql':
      return { uid: uid(), name: 'mysql', image: 'mysql:8', ports: '3306:3306', env: kv({ MYSQL_ROOT_PASSWORD: 'root', MYSQL_DATABASE: 'test' }), options: '--health-cmd "mysqladmin ping -h 127.0.0.1" --health-interval 10s --health-timeout 5s --health-retries 5' };
    case 'mongo':
      return { uid: uid(), name: 'mongo', image: 'mongo:7', ports: '27017:27017', env: [], options: `--health-cmd "mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok'" --health-interval 10s --health-timeout 5s --health-retries 5` };
    default:
      return { uid: uid(), name: 'service', image: '', ports: '', env: [], options: '' };
  }
}

export function newInput(o: Partial<InputDef> = {}): InputDef {
  return { name: 'input', description: '', required: false, default: '', type: 'string', options: '', ...o };
}

function emptyFilter(): FilterTrigger {
  return { on: false, branches: '', tags: '', paths: '', types: '' };
}

export function emptyTriggers(): TriggerDef {
  return {
    push: emptyFilter(),
    pull_request: emptyFilter(),
    pull_request_target: emptyFilter(),
    schedule: { on: false, crons: '' },
    workflow_dispatch: { on: false, inputs: [] },
    release: { on: false, types: 'published' },
    workflow_call: { on: false, inputs: [], secrets: '' },
  };
}

export function newWorkflow(o: Partial<WorkflowDef> = {}): WorkflowDef {
  return {
    fileName: 'ci', name: 'CI', runName: '', triggers: emptyTriggers(), permMode: 'read', permissions: [],
    concurrency: { on: false, group: '', cancel: 'true' }, env: [], defaultsShell: '', defaultsWorkingDir: '', jobs: [newJob()], ...o,
  };
}

export interface PresetOptionDef {
  id: string;
  label: string;
  choices: { id: string; label: string }[];
}

export interface PresetDef {
  id: string;
  label: string;
  group: string;
  note: string;
  option?: PresetOptionDef;
  build: (opt: string, branch: string) => WorkflowDef;
}

const CONC = (on = true) => ({ on, group: '${{ github.workflow }}-${{ github.ref }}', cancel: 'true' });
const checkout = () => newStep({ name: 'Checkout', uses: 'actions/checkout@v4' });

function pushPr(branch: string): TriggerDef {
  const t = emptyTriggers();
  t.push = { ...emptyFilter(), on: true, branches: branch };
  t.pull_request = { ...emptyFilter(), on: true, branches: branch };
  return t;
}

function nodeSteps(pm: string, extra: StepDef[], nodeVer: string): StepDef[] {
  const steps: StepDef[] = [checkout()];
  if (pm === 'pnpm') steps.push(newStep({ name: 'Cài pnpm', uses: 'pnpm/action-setup@v4', with: kv({ version: '9' }) }));
  steps.push(newStep({ name: 'Cài Node.js', uses: 'actions/setup-node@v4', with: kv({ 'node-version': nodeVer, cache: pm }) }));
  const install = pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : pm === 'yarn' ? 'yarn install --frozen-lockfile' : 'npm ci';
  steps.push(newStep({ name: 'Cài dependencies', run: install }));
  return [...steps, ...extra];
}

function runner(pm: string, script: string): string {
  return pm === 'pnpm' ? `pnpm run ${script}` : pm === 'yarn' ? `yarn ${script}` : `npm run ${script}`;
}

const PM_OPTION: PresetOptionDef = {
  id: 'pm', label: 'Trình quản lý gói',
  choices: [{ id: 'npm', label: 'npm' }, { id: 'pnpm', label: 'pnpm' }, { id: 'yarn', label: 'yarn' }],
};

export const PRESETS: PresetDef[] = [
  {
    id: 'blank', label: 'Trống (1 job)', group: 'Cơ bản', note: 'Khung tối thiểu: checkout và một lệnh echo.',
    build: (_o, b) => newWorkflow({ name: 'CI', fileName: 'ci', triggers: pushPr(b), jobs: [newJob({ id: 'build', steps: [checkout(), newStep({ name: 'Chạy lệnh', run: 'echo "Hello, GitHub Actions!"' })] })] }),
  },
  {
    id: 'node', label: 'Node.js (lint, test, build)', group: 'Ngôn ngữ', note: 'setup-node có cache theo trình quản lý gói; ma trận Node 20 và 22.', option: PM_OPTION,
    build: (pm, b) => newWorkflow({
      name: 'Node CI', fileName: 'node-ci', triggers: pushPr(b), concurrency: CONC(),
      jobs: [newJob({
        id: 'test', name: 'Test (Node ${{ matrix.node-version }})', timeout: '15',
        matrix: newMatrix({ enabled: true, axes: [{ key: 'node-version', values: '20, 22' }], failFast: 'false' }),
        steps: nodeSteps(pm, [
          newStep({ name: 'Lint', run: `${runner(pm, 'lint')} --if-present`.replace('yarn lint --if-present', 'yarn lint') }),
          newStep({ name: 'Test', run: pm === 'npm' ? 'npm test --if-present' : runner(pm, 'test') }),
          newStep({ name: 'Build', run: pm === 'npm' ? 'npm run build --if-present' : runner(pm, 'build') }),
        ], '${{ matrix.node-version }}'),
      })],
    }),
  },
  {
    id: 'nextjs', label: 'Next.js build', group: 'Ngôn ngữ', note: 'Cache .next/cache giữa các lần chạy để build nhanh hơn.', option: PM_OPTION,
    build: (pm, b) => {
      const lock = pm === 'pnpm' ? 'pnpm-lock.yaml' : pm === 'yarn' ? 'yarn.lock' : 'package-lock.json';
      return newWorkflow({
        name: 'Next.js CI', fileName: 'nextjs', triggers: pushPr(b), concurrency: CONC(),
        jobs: [newJob({
          id: 'build', timeout: '20', env: kv({ NEXT_TELEMETRY_DISABLED: '1' }),
          steps: nodeSteps(pm, [
            newStep({
              name: 'Cache build Next.js', uses: 'actions/cache@v4',
              with: kv({
                path: '.next/cache',
                key: `\${{ runner.os }}-nextjs-\${{ hashFiles('**/${lock}') }}-\${{ hashFiles('**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx') }}`,
                'restore-keys': `\${{ runner.os }}-nextjs-\${{ hashFiles('**/${lock}') }}-`,
              }),
            }),
            newStep({ name: 'Lint', run: runner(pm, 'lint') }),
            newStep({ name: 'Build', run: runner(pm, 'build') }),
          ], '22'),
        })],
      });
    },
  },
  {
    id: 'python', label: 'Python (pytest)', group: 'Ngôn ngữ', note: 'Ma trận Python 3.11-3.13; chọn pip, poetry hoặc uv.',
    option: { id: 'tool', label: 'Công cụ', choices: [{ id: 'pip', label: 'pip' }, { id: 'poetry', label: 'poetry' }, { id: 'uv', label: 'uv' }] },
    build: (tool, b) => {
      let steps: StepDef[];
      if (tool === 'poetry') {
        steps = [
          checkout(),
          newStep({ name: 'Cài Poetry', run: 'pipx install poetry' }),
          newStep({ name: 'Cài Python', uses: 'actions/setup-python@v5', with: kv({ 'python-version': '${{ matrix.python-version }}', cache: 'poetry' }) }),
          newStep({ name: 'Cài dependencies', run: 'poetry install --no-interaction' }),
          newStep({ name: 'Chạy pytest', run: 'poetry run pytest' }),
        ];
      } else if (tool === 'uv') {
        steps = [
          checkout(),
          newStep({ name: 'Cài uv', uses: 'astral-sh/setup-uv@v5', with: kv({ 'enable-cache': 'true' }) }),
          newStep({ name: 'Cài Python', run: 'uv python install ${{ matrix.python-version }}' }),
          newStep({ name: 'Cài dependencies', run: 'uv sync --all-extras --dev', env: kv({ UV_PYTHON: '${{ matrix.python-version }}' }) }),
          newStep({ name: 'Chạy pytest', run: 'uv run pytest', env: kv({ UV_PYTHON: '${{ matrix.python-version }}' }) }),
        ];
      } else {
        steps = [
          checkout(),
          newStep({ name: 'Cài Python', uses: 'actions/setup-python@v5', with: kv({ 'python-version': '${{ matrix.python-version }}', cache: 'pip' }) }),
          newStep({ name: 'Cài dependencies', run: 'python -m pip install --upgrade pip\npip install -r requirements.txt\npip install pytest' }),
          newStep({ name: 'Chạy pytest', run: 'pytest' }),
        ];
      }
      return newWorkflow({
        name: 'Python CI', fileName: 'python-ci', triggers: pushPr(b), concurrency: CONC(),
        jobs: [newJob({ id: 'test', name: 'Test (Python ${{ matrix.python-version }})', timeout: '15', matrix: newMatrix({ enabled: true, axes: [{ key: 'python-version', values: '3.11, 3.12, 3.13' }], failFast: 'false' }), steps })],
      });
    },
  },
  {
    id: 'go', label: 'Go (vet, test -race)', group: 'Ngôn ngữ', note: 'setup-go tự cache module/build; đọc phiên bản từ go.mod.',
    build: (_o, b) => newWorkflow({
      name: 'Go CI', fileName: 'go-ci', triggers: pushPr(b), concurrency: CONC(),
      jobs: [newJob({
        id: 'test', timeout: '15',
        steps: [
          checkout(),
          newStep({ name: 'Cài Go', uses: 'actions/setup-go@v5', with: kv({ 'go-version-file': 'go.mod', cache: 'true' }) }),
          newStep({ name: 'go vet', run: 'go vet ./...' }),
          newStep({ name: 'Build', run: 'go build ./...' }),
          newStep({ name: 'Test (race)', run: 'go test -race -coverprofile=coverage.out ./...' }),
        ],
      })],
    }),
  },
  {
    id: 'rust', label: 'Rust (clippy, test)', group: 'Ngôn ngữ', note: 'Toolchain stable + rust-cache; clippy cảnh báo coi như lỗi.',
    build: (_o, b) => newWorkflow({
      name: 'Rust CI', fileName: 'rust-ci', triggers: pushPr(b), concurrency: CONC(), env: kv({ CARGO_TERM_COLOR: 'always' }),
      jobs: [newJob({
        id: 'check', timeout: '30',
        steps: [
          checkout(),
          newStep({ name: 'Cài Rust toolchain', uses: 'dtolnay/rust-toolchain@stable', with: kv({ components: 'clippy, rustfmt' }) }),
          newStep({ name: 'Cache cargo', uses: 'Swatinem/rust-cache@v2' }),
          newStep({ name: 'Kiểm tra định dạng', run: 'cargo fmt --all -- --check' }),
          newStep({ name: 'Clippy', run: 'cargo clippy --all-targets --all-features -- -D warnings' }),
          newStep({ name: 'Test', run: 'cargo test --all-features' }),
        ],
      })],
    }),
  },
  {
    id: 'java', label: 'Java (Maven / Gradle)', group: 'Ngôn ngữ', note: 'setup-java có cache cho Maven hoặc Gradle.',
    option: { id: 'tool', label: 'Công cụ build', choices: [{ id: 'maven', label: 'Maven' }, { id: 'gradle', label: 'Gradle' }] },
    build: (tool, b) => newWorkflow({
      name: 'Java CI', fileName: 'java-ci', triggers: pushPr(b), concurrency: CONC(),
      jobs: [newJob({
        id: 'build', timeout: '20', name: 'Build (JDK ${{ matrix.java }})',
        matrix: newMatrix({ enabled: true, axes: [{ key: 'java', values: '17, 21' }], failFast: 'false' }),
        steps: tool === 'gradle'
          ? [
              checkout(),
              newStep({ name: 'Cài JDK', uses: 'actions/setup-java@v4', with: kv({ distribution: 'temurin', 'java-version': '${{ matrix.java }}' }) }),
              newStep({ name: 'Cài Gradle', uses: 'gradle/actions/setup-gradle@v4' }),
              newStep({ name: 'Build', run: 'chmod +x gradlew\n./gradlew build' }),
            ]
          : [
              checkout(),
              newStep({ name: 'Cài JDK', uses: 'actions/setup-java@v4', with: kv({ distribution: 'temurin', 'java-version': '${{ matrix.java }}', cache: 'maven' }) }),
              newStep({ name: 'Build và test', run: 'mvn -B verify' }),
            ],
      })],
    }),
  },
  {
    id: 'dotnet', label: '.NET', group: 'Ngôn ngữ', note: 'restore → build → test với SDK 8.',
    build: (_o, b) => newWorkflow({
      name: '.NET CI', fileName: 'dotnet-ci', triggers: pushPr(b), concurrency: CONC(),
      jobs: [newJob({
        id: 'build', timeout: '15',
        steps: [
          checkout(),
          newStep({ name: 'Cài .NET', uses: 'actions/setup-dotnet@v4', with: kv({ 'dotnet-version': '8.0.x' }) }),
          newStep({ name: 'Restore', run: 'dotnet restore' }),
          newStep({ name: 'Build', run: 'dotnet build --no-restore --configuration Release' }),
          newStep({ name: 'Test', run: 'dotnet test --no-build --configuration Release --verbosity normal' }),
        ],
      })],
    }),
  },
  {
    id: 'php', label: 'PHP / Composer', group: 'Ngôn ngữ', note: 'shivammathur/setup-php + cache vendor theo composer.lock.',
    build: (_o, b) => newWorkflow({
      name: 'PHP CI', fileName: 'php-ci', triggers: pushPr(b), concurrency: CONC(),
      jobs: [newJob({
        id: 'test', timeout: '15', name: 'PHPUnit (PHP ${{ matrix.php }})',
        matrix: newMatrix({ enabled: true, axes: [{ key: 'php', values: '8.2, 8.3, 8.4' }], failFast: 'false' }),
        steps: [
          checkout(),
          newStep({ name: 'Cài PHP', uses: 'shivammathur/setup-php@v2', with: kv({ 'php-version': '${{ matrix.php }}', tools: 'composer:v2', coverage: 'none' }) }),
          newStep({ name: 'Cache vendor', uses: 'actions/cache@v4', with: kv({ path: 'vendor', key: "${{ runner.os }}-php-${{ matrix.php }}-${{ hashFiles('**/composer.lock') }}", 'restore-keys': '${{ runner.os }}-php-${{ matrix.php }}-' }) }),
          newStep({ name: 'Cài dependencies', run: 'composer install --prefer-dist --no-progress --no-interaction' }),
          newStep({ name: 'PHPUnit', run: 'vendor/bin/phpunit' }),
        ],
      })],
    }),
  },
  {
    id: 'ruby', label: 'Ruby / Bundler', group: 'Ngôn ngữ', note: 'ruby/setup-ruby với bundler-cache.',
    build: (_o, b) => newWorkflow({
      name: 'Ruby CI', fileName: 'ruby-ci', triggers: pushPr(b), concurrency: CONC(),
      jobs: [newJob({
        id: 'test', timeout: '15',
        steps: [
          checkout(),
          newStep({ name: 'Cài Ruby', uses: 'ruby/setup-ruby@v1', with: kv({ 'ruby-version': '3.3', 'bundler-cache': 'true' }) }),
          newStep({ name: 'Chạy test', run: 'bundle exec rake' }),
        ],
      })],
    }),
  },
  {
    id: 'docker', label: 'Docker build & push (GHCR)', group: 'Triển khai', note: 'Đẩy image lên ghcr.io; PR chỉ build, không push. Cần Dockerfile ở thư mục gốc.',
    build: (_o, b) => {
      const t = emptyTriggers();
      t.push = { ...emptyFilter(), on: true, branches: b, tags: 'v*.*.*' };
      t.pull_request = { ...emptyFilter(), on: true, branches: b };
      return newWorkflow({
        name: 'Docker', fileName: 'docker', triggers: t, permMode: 'read', concurrency: CONC(),
        env: kv({ REGISTRY: 'ghcr.io', IMAGE_NAME: '${{ github.repository }}' }),
        jobs: [newJob({
          id: 'build-and-push', timeout: '30', permissions: kv({ contents: 'read', packages: 'write' }),
          steps: [
            checkout(),
            newStep({ name: 'Cài Buildx', uses: 'docker/setup-buildx-action@v3' }),
            newStep({ name: 'Đăng nhập GHCR', if: "github.event_name != 'pull_request'", uses: 'docker/login-action@v3', with: kv({ registry: '${{ env.REGISTRY }}', username: '${{ github.actor }}', password: '${{ secrets.GITHUB_TOKEN }}' }) }),
            newStep({ name: 'Metadata (tag, label)', id: 'meta', uses: 'docker/metadata-action@v5', with: kv({ images: '${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}', tags: 'type=ref,event=branch\ntype=ref,event=pr\ntype=semver,pattern={{version}}\ntype=sha' }) }),
            newStep({ name: 'Build và push', uses: 'docker/build-push-action@v6', with: kv({ context: '.', push: "${{ github.event_name != 'pull_request' }}", tags: '${{ steps.meta.outputs.tags }}', labels: '${{ steps.meta.outputs.labels }}', 'cache-from': 'type=gha', 'cache-to': 'type=gha,mode=max' }) }),
          ],
        })],
      });
    },
  },
  {
    id: 'pages', label: 'Deploy GitHub Pages', group: 'Triển khai', note: 'Cần bật Settings → Pages → Source: GitHub Actions. Sửa lệnh build và thư mục output (dist).',
    build: (_o, b) => {
      const t = emptyTriggers();
      t.push = { ...emptyFilter(), on: true, branches: b };
      t.workflow_dispatch = { on: true, inputs: [] };
      return newWorkflow({
        name: 'Deploy Pages', fileName: 'pages', triggers: t, permMode: 'custom',
        permissions: kv({ contents: 'read', pages: 'write', 'id-token': 'write' }),
        concurrency: { on: true, group: 'pages', cancel: 'false' },
        jobs: [
          newJob({
            id: 'build', timeout: '15',
            steps: [
              checkout(),
              newStep({ name: 'Cài Node.js', uses: 'actions/setup-node@v4', with: kv({ 'node-version': '22', cache: 'npm' }) }),
              newStep({ name: 'Cài dependencies', run: 'npm ci' }),
              newStep({ name: 'Build', run: 'npm run build' }),
              newStep({ name: 'Cấu hình Pages', uses: 'actions/configure-pages@v5' }),
              newStep({ name: 'Upload artifact', uses: 'actions/upload-pages-artifact@v3', with: kv({ path: './dist' }) }),
            ],
          }),
          newJob({
            id: 'deploy', needs: ['build'], environment: 'github-pages', environmentUrl: '${{ steps.deployment.outputs.page_url }}', timeout: '10',
            steps: [newStep({ name: 'Deploy lên GitHub Pages', id: 'deployment', uses: 'actions/deploy-pages@v4' })],
          }),
        ],
      });
    },
  },
  {
    id: 'release', label: 'Release khi push tag', group: 'Triển khai', note: 'Push tag dạng v1.2.3 sẽ tạo GitHub Release kèm release notes tự động.',
    option: { id: 'tool', label: 'Cách tạo release', choices: [{ id: 'action', label: 'softprops/action-gh-release' }, { id: 'gh', label: 'gh CLI' }] },
    build: (tool) => {
      const t = emptyTriggers();
      t.push = { ...emptyFilter(), on: true, tags: 'v*' };
      return newWorkflow({
        name: 'Release', fileName: 'release', triggers: t, permMode: 'none',
        jobs: [newJob({
          id: 'release', timeout: '15', permissions: kv({ contents: 'write' }),
          steps: tool === 'gh'
            ? [checkout(), newStep({ name: 'Tạo release', run: 'gh release create "$GITHUB_REF_NAME" --generate-notes --verify-tag', env: kv({ GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }) })]
            : [checkout(), newStep({ name: 'Tạo release', uses: 'softprops/action-gh-release@v2', with: kv({ generate_release_notes: 'true' }) })],
        })],
      });
    },
  },
  {
    id: 'codeql', label: 'CodeQL (quét bảo mật)', group: 'Bảo mật & bot', note: 'Đổi `language` cho phù hợp (javascript-typescript, python, go, java-kotlin, ...). Cron chạy theo UTC.',
    build: (_o, b) => {
      const t = pushPr(b);
      t.schedule = { on: true, crons: '30 1 * * 1' };
      return newWorkflow({
        name: 'CodeQL', fileName: 'codeql', triggers: t, permMode: 'none',
        jobs: [newJob({
          id: 'analyze', name: 'Analyze (${{ matrix.language }})', timeout: '30',
          permissions: kv({ actions: 'read', contents: 'read', 'security-events': 'write' }),
          matrix: newMatrix({ enabled: true, axes: [{ key: 'language', values: 'javascript-typescript' }], failFast: 'false' }),
          steps: [
            checkout(),
            newStep({ name: 'Khởi tạo CodeQL', uses: 'github/codeql-action/init@v3', with: kv({ languages: '${{ matrix.language }}', 'build-mode': 'none' }) }),
            newStep({ name: 'Phân tích', uses: 'github/codeql-action/analyze@v3', with: kv({ category: '/language:${{ matrix.language }}' }) }),
          ],
        })],
      });
    },
  },
  {
    id: 'terraform', label: 'Terraform fmt / validate', group: 'Bảo mật & bot', note: 'Không cần credential: init với -backend=false.',
    build: (_o, b) => newWorkflow({
      name: 'Terraform', fileName: 'terraform', triggers: pushPr(b), concurrency: CONC(),
      jobs: [newJob({
        id: 'validate', timeout: '10',
        steps: [
          checkout(),
          newStep({ name: 'Cài Terraform', uses: 'hashicorp/setup-terraform@v3' }),
          newStep({ name: 'terraform fmt', run: 'terraform fmt -check -recursive' }),
          newStep({ name: 'terraform init', run: 'terraform init -backend=false' }),
          newStep({ name: 'terraform validate', run: 'terraform validate -no-color' }),
        ],
      })],
    }),
  },
  {
    id: 'lint-pr', label: 'Kiểm tra PR (lint + tiêu đề)', group: 'Bảo mật & bot', note: 'Job pr-title ghi đè permissions riêng (pull-requests: read).',
    build: (_o, b) => {
      const t = emptyTriggers();
      t.pull_request = { ...emptyFilter(), on: true, branches: b, types: 'opened, synchronize, reopened, edited' };
      return newWorkflow({
        name: 'PR Checks', fileName: 'pr-checks', triggers: t, concurrency: CONC(),
        jobs: [
          newJob({
            id: 'lint', timeout: '10',
            steps: nodeSteps('npm', [newStep({ name: 'Lint', run: 'npm run lint' }), newStep({ name: 'Kiểm tra kiểu', run: 'npx tsc --noEmit' })], '22'),
          }),
          newJob({
            id: 'pr-title', name: 'Tiêu đề PR (Conventional Commits)', timeout: '5', permissions: kv({ 'pull-requests': 'read' }),
            steps: [newStep({ name: 'Kiểm tra tiêu đề', uses: 'amannn/action-semantic-pull-request@v5', env: kv({ GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }) })],
          }),
        ],
      });
    },
  },
  {
    id: 'bots', label: 'Bot gắn nhãn & stale', group: 'Bảo mật & bot', note: 'Labeler cần file .github/labeler.yml. Không checkout mã PR nên an toàn với pull_request_target.',
    build: () => {
      const t = emptyTriggers();
      t.pull_request_target = { ...emptyFilter(), on: true, types: 'opened, synchronize, reopened' };
      t.schedule = { on: true, crons: '0 3 * * *' };
      return newWorkflow({
        name: 'Repo bots', fileName: 'bots', triggers: t, permMode: 'none',
        jobs: [
          newJob({
            id: 'label', if: "github.event_name == 'pull_request_target'", timeout: '5', permissions: kv({ contents: 'read', 'pull-requests': 'write' }),
            steps: [newStep({ name: 'Gắn nhãn theo file thay đổi', uses: 'actions/labeler@v5' })],
          }),
          newJob({
            id: 'stale', if: "github.event_name == 'schedule'", timeout: '10', permissions: kv({ issues: 'write', 'pull-requests': 'write' }),
            steps: [newStep({
              name: 'Đánh dấu stale', uses: 'actions/stale@v9',
              with: kv({ 'stale-issue-message': 'Issue này không có hoạt động trong 60 ngày và sẽ bị đóng nếu không có phản hồi.', 'days-before-stale': '60', 'days-before-close': '7' }),
            })],
          }),
        ],
      });
    },
  },
];

export function findPreset(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function buildPreset(id: string, opt = '', branch = 'main'): WorkflowDef {
  const p = findPreset(id) ?? PRESETS[0];
  const def = p.option?.choices.find((c) => c.id === opt) ? opt : p.option?.choices[0]?.id ?? '';
  const b = branch.trim() || 'main';
  return p.build(def, b);
}
