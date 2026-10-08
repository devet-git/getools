import YAML from 'yaml';

/* ============================================================
 * Docker run ⇄ Docker Compose — logic thuần (không phụ thuộc React)
 * ============================================================ */

export type WarnLevel = 'warn' | 'info';
export interface Warning {
  level: WarnLevel;
  message: string;
  service?: string;
}

export const MAX_INPUT = 300_000;
const MAX_SERVICES = 60;

/* ---------------- Shell: tách từ / trích dẫn ---------------- */

export interface ShellResult {
  commands: string[][];
  errors: string[];
}

/** Tách văn bản shell thành các lệnh (theo dòng / ; / && / ||), mỗi lệnh là danh sách từ. Không bao giờ ném lỗi. */
export function shellTokenize(input: string): ShellResult {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const commands: string[][] = [];
  const errors: string[] = [];
  let words: string[] = [];
  let cur = '';
  let inWord = false;
  let i = 0;
  const n = text.length;
  const endWord = () => {
    if (inWord) {
      words.push(cur);
      cur = '';
      inWord = false;
    }
  };
  const endCmd = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  while (i < n) {
    const c = text[i];
    if (c === '\\') {
      const nx = text[i + 1];
      if (nx === '\n') {
        i += 2;
        continue;
      }
      if (nx === undefined) {
        cur += '\\';
        inWord = true;
        i++;
        continue;
      }
      cur += nx;
      inWord = true;
      i += 2;
      continue;
    }
    // Nối dòng kiểu Windows (^) / PowerShell (`)
    if ((c === '^' || c === '`') && /^[ \t]*\n/.test(text.slice(i + 1, i + 40))) {
      const m = /^[ \t]*\n/.exec(text.slice(i + 1, i + 40));
      i += 1 + (m ? m[0].length : 0);
      continue;
    }
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      inWord = true;
      if (end < 0) {
        errors.push('Dấu nháy đơn \' chưa được đóng.');
        cur += text.slice(i + 1);
        i = n;
      } else {
        cur += text.slice(i + 1, end);
        i = end + 1;
      }
      continue;
    }
    if (c === '$' && text[i + 1] === "'") {
      // ANSI-C quoting $'...'
      i += 2;
      inWord = true;
      let closed = false;
      while (i < n) {
        const d = text[i];
        if (d === "'") {
          closed = true;
          i++;
          break;
        }
        if (d === '\\' && i + 1 < n) {
          const e = text[i + 1];
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', e: '\x1b' };
          cur += map[e] ?? '\\' + e;
          i += 2;
          continue;
        }
        cur += d;
        i++;
      }
      if (!closed) errors.push("Chuỗi $'...' chưa được đóng.");
      continue;
    }
    if (c === '"') {
      i++;
      inWord = true;
      let closed = false;
      while (i < n) {
        const d = text[i];
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === '\\' && i + 1 < n) {
          const e = text[i + 1];
          if (e === '\n') {
            i += 2;
            continue;
          }
          if (e === '"' || e === '\\' || e === '$' || e === '`') {
            cur += e;
            i += 2;
            continue;
          }
          cur += '\\';
          i++;
          continue;
        }
        cur += d;
        i++;
      }
      if (!closed) errors.push('Dấu nháy kép " chưa được đóng.');
      continue;
    }
    if (c === ' ' || c === '\t') {
      endWord();
      i++;
      continue;
    }
    if (c === '\n') {
      endCmd();
      i++;
      continue;
    }
    if (c === '#' && !inWord) {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === ';' || ((c === '&' || c === '|') && (text[i + 1] === c))) {
      endCmd();
      i += c === ';' ? 1 : 2;
      continue;
    }
    cur += c;
    inWord = true;
    i++;
  }
  endCmd();
  return { commands, errors };
}

/** Tách tất cả từ (gộp các lệnh) — tiện cho phân tích cờ. */
export function shellSplit(text: string): string[] {
  return shellTokenize(text).commands.flat();
}

const SAFE_SHELL = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Trích dẫn một tham số cho shell POSIX. */
export function shQuote(s: string): string {
  if (s === '') return "''";
  if (SAFE_SHELL.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/* ---------------- Bảng cờ docker run ---------------- */

const BOOL_FLAGS = new Set([
  'detach', 'interactive', 'tty', 'rm', 'privileged', 'init', 'read-only', 'publish-all',
  'oom-kill-disable', 'no-healthcheck', 'sig-proxy', 'quiet', 'disable-content-trust', 'help',
]);

const VALUE_FLAGS = new Set([
  'name', 'publish', 'volume', 'mount', 'env', 'env-file', 'network', 'link', 'restart', 'user', 'workdir',
  'entrypoint', 'hostname', 'cap-add', 'cap-drop', 'device', 'dns', 'dns-search', 'dns-option', 'add-host',
  'label', 'label-file', 'memory', 'memory-swap', 'memory-reservation', 'cpus', 'cpu-shares', 'cpuset-cpus',
  'health-cmd', 'health-interval', 'health-retries', 'health-timeout', 'health-start-period',
  'health-start-interval', 'log-driver', 'log-opt', 'ulimit', 'shm-size', 'pid', 'platform', 'tmpfs',
  'sysctl', 'security-opt', 'stop-signal', 'stop-timeout', 'gpus', 'ipc', 'uts', 'cgroup-parent', 'group-add',
  'expose', 'volumes-from', 'domainname', 'mac-address', 'ip', 'ip6', 'network-alias', 'pull', 'runtime',
  'userns', 'attach', 'annotation', 'cidfile', 'detach-keys', 'device-cgroup-rule', 'storage-opt', 'isolation',
  'kernel-memory', 'pids-limit', 'blkio-weight', 'oom-score-adj', 'cgroupns', 'cpu-period', 'cpu-quota',
  'memory-swappiness', 'link-local-ip', 'device-read-bps', 'device-write-bps', 'device-read-iops',
  'device-write-iops', 'blkio-weight-device', 'cpu-rt-period', 'cpu-rt-runtime', 'cpuset-mems', 'cpu-count',
  'cpu-percent', 'io-maxbandwidth', 'io-maxiops', 'use-api-socket',
]);

const ALIAS: Record<string, string> = { net: 'network', 'dns-opt': 'dns-option', 'security-opts': 'security-opt' };

const SHORT: Record<string, string> = {
  d: 'detach', i: 'interactive', t: 'tty', p: 'publish', P: 'publish-all', v: 'volume', e: 'env',
  w: 'workdir', u: 'user', h: 'hostname', l: 'label', m: 'memory', c: 'cpu-shares', a: 'attach',
};

/** Cờ hợp lệ của docker run nhưng không có tương đương trong Compose. */
const NO_COMPOSE_EQUIV = new Set([
  'attach', 'cidfile', 'detach-keys', 'sig-proxy', 'quiet', 'disable-content-trust', 'label-file',
  'kernel-memory', 'blkio-weight', 'oom-kill-disable', 'isolation', 'cpu-period', 'cpu-quota',
  'memory-swappiness', 'link-local-ip', 'device-read-bps', 'device-write-bps', 'device-read-iops',
  'device-write-iops', 'blkio-weight-device', 'cpu-rt-period', 'cpu-rt-runtime', 'cpuset-mems',
  'cpu-count', 'cpu-percent', 'io-maxbandwidth', 'io-maxiops', 'use-api-socket', 'help',
]);

export interface RunFlag {
  name: string;
  value: string;
}

export interface RunSpec {
  image: string;
  args: string[];
  flags: RunFlag[];
}

type WarnFn = (message: string, level?: WarnLevel) => void;

/** Phân tích danh sách từ của một lệnh `docker run`. */
export function parseRunWords(words: string[], warn: WarnFn): RunSpec | null {
  const flags: RunFlag[] = [];
  let image: string | undefined;
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (w === '--') {
      image = words[i + 1];
      i += 2;
      break;
    }
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const rawName = eq > 0 ? w.slice(2, eq) : w.slice(2);
      const name = ALIAS[rawName] ?? rawName;
      if (BOOL_FLAGS.has(name)) {
        let on = true;
        if (eq > 0) {
          const v = w.slice(eq + 1).toLowerCase();
          on = !(v === 'false' || v === '0');
        }
        flags.push({ name, value: on ? 'true' : 'false' });
        i++;
      } else if (VALUE_FLAGS.has(name)) {
        let value: string;
        if (eq > 0) {
          value = w.slice(eq + 1);
          i++;
        } else {
          if (i + 1 >= words.length) {
            warn(`Cờ --${rawName} thiếu giá trị.`);
            value = '';
          } else value = words[i + 1];
          i += 2;
        }
        flags.push({ name, value });
      } else {
        warn(`Cờ không nhận diện được: --${rawName}${eq > 0 ? '=…' : ''} (đã bỏ qua).`);
        i++;
      }
      continue;
    }
    if (w.startsWith('-') && w.length > 1) {
      let consumedNext = false;
      for (let k = 1; k < w.length; k++) {
        const ch = w[k];
        const name = SHORT[ch];
        if (!name) {
          warn(`Cờ ngắn không nhận diện được: -${ch} (đã bỏ qua).`);
          continue;
        }
        if (BOOL_FLAGS.has(name)) {
          flags.push({ name, value: 'true' });
          continue;
        }
        let rest = w.slice(k + 1);
        if (rest.startsWith('=')) rest = rest.slice(1);
        if (rest === '') {
          if (i + 1 >= words.length) {
            warn(`Cờ -${ch} thiếu giá trị.`);
          } else {
            rest = words[i + 1];
            consumedNext = true;
          }
        }
        flags.push({ name, value: rest });
        break;
      }
      i += consumedNext ? 2 : 1;
      continue;
    }
    image = w;
    i++;
    break;
  }
  if (!image) {
    warn('Không tìm thấy tên image trong lệnh docker run.');
    return null;
  }
  return { image, args: words.slice(i), flags };
}

/** Tách các lệnh docker run từ văn bản (mỗi lệnh một dòng hoặc cách nhau bởi dòng trống / `\`). */
export function parseDockerRunText(text: string): { runs: { spec: RunSpec; warnings: Warning[] }[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const runs: { spec: RunSpec; warnings: Warning[] }[] = [];
  const sh = shellTokenize(text);
  for (const e of sh.errors) warnings.push({ level: 'warn', message: e });
  for (const words of sh.commands) {
    if (runs.length >= MAX_SERVICES) {
      warnings.push({ level: 'warn', message: `Chỉ xử lý tối đa ${MAX_SERVICES} lệnh.` });
      break;
    }
    const local: Warning[] = [];
    const warn: WarnFn = (message, level = 'warn') => local.push({ level, message });
    let ws = words;
    // bỏ sudo / env var assignments đầu dòng
    while (ws.length && (ws[0] === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0]))) ws = ws.slice(1);
    const first = ws[0] ?? '';
    const base = first.split('/').pop() ?? first;
    if (base === 'docker' || base === 'podman' || base === 'nerdctl' || base === 'docker.exe') {
      let idx = 1;
      // bỏ qua tùy chọn toàn cục và "container"
      while (idx < ws.length && ws[idx] !== 'run') {
        if (ws[idx] === 'container' || ws[idx].startsWith('-')) {
          idx += ws[idx] === '--context' || ws[idx] === '-H' || ws[idx] === '--host' ? 2 : 1;
        } else break;
      }
      if (ws[idx] !== 'run') {
        warnings.push({ level: 'info', message: `Bỏ qua lệnh không phải "docker run": ${ws.slice(0, 3).join(' ')}…` });
        continue;
      }
      ws = ws.slice(idx + 1);
    } else if (base === 'run' || first === 'run') {
      ws = ws.slice(1);
    } else {
      local.push({ level: 'info', message: 'Không thấy "docker run" — coi toàn bộ là tham số của docker run.' });
    }
    const spec = parseRunWords(ws, warn);
    if (spec) runs.push({ spec, warnings: local });
    else warnings.push(...local);
  }
  return { runs, warnings };
}

/* ---------------- docker run → Compose ---------------- */

type Obj = Record<string, unknown>;

export interface DockerToComposeOptions {
  includeVersion: boolean;
  containerName: boolean;
  /** Đánh dấu volume/network tùy chỉnh là external */
  external: boolean;
}

export const DEFAULT_D2C: DockerToComposeOptions = { includeVersion: false, containerName: true, external: false };

export interface DockerToComposeResult {
  ok: boolean;
  yaml: string;
  services: string[];
  warnings: Warning[];
  error?: string;
}

const SERVICE_ORDER = [
  'image', 'build', 'container_name', 'hostname', 'domainname', 'user', 'working_dir', 'entrypoint', 'command',
  'restart', 'init', 'privileged', 'read_only', 'stdin_open', 'tty', 'platform', 'pull_policy', 'runtime', 'ports',
  'expose', 'volumes', 'volumes_from', 'tmpfs', 'environment', 'env_file', 'depends_on', 'links', 'networks',
  'network_mode', 'mac_address', 'dns', 'dns_search', 'dns_opt', 'extra_hosts', 'cap_add', 'cap_drop', 'devices',
  'security_opt', 'sysctls', 'ulimits', 'shm_size', 'pid', 'ipc', 'uts', 'userns_mode', 'cgroup', 'cgroup_parent',
  'group_add', 'stop_signal', 'stop_grace_period', 'pids_limit', 'oom_score_adj', 'cpu_shares', 'cpuset',
  'memswap_limit', 'healthcheck', 'logging', 'labels', 'annotations', 'deploy', 'device_cgroup_rules', 'storage_opt',
];

function orderObject(o: Obj, order: string[]): Obj {
  const out: Obj = {};
  for (const k of order) if (k in o) out[k] = o[k];
  for (const k of Object.keys(o)) if (!(k in out)) out[k] = o[k];
  return out;
}

function kvSplit(s: string): [string, string | null] {
  const i = s.indexOf('=');
  return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 1)];
}

const BIND_START = /^(\/|\.|~|\$|[A-Za-z]:[\\/]|\\\\)/;

function splitColon(s: string): string[] {
  const parts = s.split(':');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    // ghép ổ đĩa Windows C:\...
    if (parts[i].length === 1 && /[A-Za-z]/.test(parts[i]) && i + 1 < parts.length && /^[\\/]/.test(parts[i + 1]) && out.length === 0) {
      out.push(parts[i] + ':' + parts[i + 1]);
      i++;
    } else out.push(parts[i]);
  }
  return out;
}

export interface VolumeParts {
  src?: string;
  dst: string;
  opts?: string;
}

export function splitVolume(s: string): VolumeParts {
  const parts = splitColon(s);
  if (parts.length === 1) return { dst: parts[0] };
  if (parts.length === 2) return { src: parts[0], dst: parts[1] };
  return { src: parts[0], dst: parts[1], opts: parts.slice(2).join(':') };
}

export function isBindSource(src: string): boolean {
  return BIND_START.test(src);
}

function normalizePwd(src: string): { value: string; changed: boolean } {
  const v = src.replace(/^(\$\(pwd\)|`pwd`|\$\{PWD\}|\$PWD)(?=\/|\\|$)/, '.');
  return { value: v, changed: v !== src };
}

/** Phân tích chuỗi csv của --mount, tôn trọng dấu nháy kép */
function parseMountCsv(s: string): [string, string | null][] {
  const out: [string, string | null][] = [];
  let cur = '';
  let inQ = false;
  const flush = () => {
    if (cur !== '') out.push(kvSplit(cur));
    cur = '';
  };
  for (const ch of s) {
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return out;
}

interface Ctx {
  opts: DockerToComposeOptions;
  volumes: Map<string, Obj | null>;
  networks: Map<string, Obj | null>;
  warn: WarnFn;
}

function portWarn(p: string, warn: WarnFn) {
  let s = p;
  const slash = s.lastIndexOf('/');
  if (slash >= 0) {
    const proto = s.slice(slash + 1);
    if (!['tcp', 'udp', 'sctp'].includes(proto)) warn(`Giao thức cổng không hợp lệ trong "${p}".`);
    s = s.slice(0, slash);
  }
  let ip = '';
  if (s.startsWith('[')) {
    const e = s.indexOf(']');
    if (e > 0) {
      ip = s.slice(0, e + 1);
      s = s.slice(e + 1).replace(/^:/, '');
    }
  }
  const parts = s.split(':');
  const cont = parts[parts.length - 1];
  if (!/^\d+(-\d+)?$/.test(cont)) warn(`Cổng container không hợp lệ trong "${p}".`);
  if (parts.length >= 2 && !/^\d*(-\d+)?$/.test(parts[parts.length - 2]) && !ip && parts.length === 2) {
    warn(`Cổng host không hợp lệ trong "${p}".`);
  }
}

function deriveName(image: string): string {
  let s = image.split('@')[0];
  s = s.split('/').pop() ?? s;
  s = s.split(':')[0];
  s = s.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return s || 'app';
}

function parseUlimit(v: string): [string, unknown] | null {
  const [name, val] = kvSplit(v);
  if (val === null || !name) return null;
  const m = /^(-?\d+)(?::(-?\d+))?$/.exec(val);
  if (!m) return null;
  if (m[2] === undefined) return [name, Number(m[1])];
  return [name, { soft: Number(m[1]), hard: Number(m[2]) }];
}

function pushTo(o: Obj, key: string, v: unknown) {
  const arr = (o[key] as unknown[] | undefined) ?? [];
  arr.push(v);
  o[key] = arr;
}

function getObj(o: Obj, key: string): Obj {
  const cur = o[key];
  if (cur && typeof cur === 'object' && !Array.isArray(cur)) return cur as Obj;
  const n: Obj = {};
  o[key] = n;
  return n;
}

function registerVolume(name: string, ctx: Ctx, extra?: Obj) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) ctx.warn(`Tên volume "${name}" có thể không hợp lệ.`);
  const cur = ctx.volumes.get(name);
  const base: Obj = { ...(cur ?? {}), ...(extra ?? {}) };
  if (ctx.opts.external) base.external = true;
  ctx.volumes.set(name, Object.keys(base).length ? base : null);
}

function buildService(spec: RunSpec, ctx: Ctx): { name?: string; svc: Obj } {
  const svc: Obj = { image: spec.image };
  const warn = ctx.warn;
  let name: string | undefined;
  const hc: Obj = {};
  const nets = new Map<string, Obj | null>();
  let lastNet: string | undefined;
  let pendingAliases: string[] = [];
  let pendingIp: string | undefined;
  let pendingIp6: string | undefined;
  const limits: Obj = {};
  const reservations: Obj = {};

  if (!/^[^\s@]+(@sha256:[0-9a-fA-F]{16,})?$/.test(spec.image) || spec.image.includes('=')) {
    warn(`Image "${spec.image}" trông không hợp lệ.`);
  }
  if (spec.args.length) svc.command = spec.args;

  for (const f of spec.flags) {
    const v = f.value;
    switch (f.name) {
      case 'name':
        name = v;
        break;
      case 'detach':
        break;
      case 'interactive':
        if (v === 'true') svc.stdin_open = true;
        break;
      case 'tty':
        if (v === 'true') svc.tty = true;
        break;
      case 'rm':
        if (v === 'true') warn('--rm không có tương đương trong Compose (dùng `docker compose run --rm <service>`).');
        break;
      case 'publish': {
        portWarn(v, warn);
        pushTo(svc, 'ports', v);
        break;
      }
      case 'publish-all':
        if (v === 'true') warn('-P / --publish-all không có tương đương trong Compose — hãy khai báo cổng bằng ports.');
        break;
      case 'expose':
        pushTo(svc, 'expose', v);
        break;
      case 'volume': {
        const p = splitVolume(v);
        if (p.src === undefined) {
          pushTo(svc, 'volumes', p.dst);
          break;
        }
        const pw = normalizePwd(p.src);
        if (pw.changed) warn(`"${p.src}" đã được đổi thành "${pw.value}" (đường dẫn tương đối trong Compose).`, 'info');
        let src = pw.value;
        if (/\$\(|`/.test(src)) warn(`"${src}" chứa lệnh shell — Compose không chạy lệnh; hãy thay bằng đường dẫn cụ thể hoặc biến \${VAR}.`);
        if (!isBindSource(src)) registerVolume(src, ctx);
        pushTo(svc, 'volumes', p.opts ? `${src}:${p.dst}:${p.opts}` : `${src}:${p.dst}`);
        break;
      }
      case 'mount': {
        const kvs = parseMountCsv(v);
        const m: Record<string, string | true> = {};
        for (const [k, val] of kvs) m[k] = val === null ? true : val;
        const type = String(m.type ?? 'volume');
        const target = String(m.target ?? m.destination ?? m.dst ?? '');
        let source = m.source !== undefined ? String(m.source) : m.src !== undefined ? String(m.src) : undefined;
        const ro = m.readonly === true || m.ro === true || m.readonly === 'true' || m.ro === 'true' || m.readonly === '1' || m.ro === '1';
        const known = new Set(['type', 'target', 'destination', 'dst', 'source', 'src', 'readonly', 'ro', 'volume-subpath', 'volume-nocopy', 'bind-propagation', 'bind-create-host-path', 'tmpfs-size', 'tmpfs-mode', 'volume-driver', 'volume-opt', 'consistency', 'bind-nonrecursive']);
        for (const k of Object.keys(m)) if (!known.has(k)) warn(`Tùy chọn --mount "${k}" không được hỗ trợ (đã bỏ qua).`);
        if (!target) {
          warn('--mount thiếu target.');
          break;
        }
        if (source) {
          const pw = normalizePwd(source);
          if (pw.changed) warn(`"${source}" đã được đổi thành "${pw.value}".`, 'info');
          source = pw.value;
        }
        if (type === 'tmpfs') {
          if (m['tmpfs-size'] || m['tmpfs-mode']) {
            const t: Obj = {};
            if (m['tmpfs-size']) t.size = /^\d+$/.test(String(m['tmpfs-size'])) ? Number(m['tmpfs-size']) : String(m['tmpfs-size']);
            if (m['tmpfs-mode']) t.mode = Number.isNaN(parseInt(String(m['tmpfs-mode']), 8)) ? String(m['tmpfs-mode']) : parseInt(String(m['tmpfs-mode']), 8);
            pushTo(svc, 'volumes', { type: 'tmpfs', target, tmpfs: t });
          } else pushTo(svc, 'tmpfs', target);
          break;
        }
        if (type !== 'bind' && type !== 'volume') {
          warn(`Loại mount "${type}" không được hỗ trợ.`);
          break;
        }
        const extras: Obj = {};
        if (type === 'bind') {
          if (m['bind-propagation']) extras.bind = { ...(extras.bind as Obj), propagation: String(m['bind-propagation']) };
          if (m['bind-create-host-path'] === 'false') extras.bind = { ...(extras.bind as Obj), create_host_path: false };
        } else {
          const vol: Obj = {};
          if (m['volume-nocopy'] === true || m['volume-nocopy'] === 'true') vol.nocopy = true;
          if (m['volume-subpath']) vol.subpath = String(m['volume-subpath']);
          if (Object.keys(vol).length) extras.volume = vol;
          if (source) {
            const topExtra: Obj = {};
            if (m['volume-driver']) topExtra.driver = String(m['volume-driver']);
            if (m['volume-opt']) {
              const opts: Obj = {};
              for (const [k, val] of kvs) {
                if (k === 'volume-opt' && val) {
                  const [ok, ov] = kvSplit(val);
                  opts[ok] = ov ?? '';
                }
              }
              topExtra.driver_opts = opts;
            }
            registerVolume(source, ctx, topExtra);
          } else if (m['volume-driver']) warn('volume-driver cho volume ẩn danh không được chuyển.');
        }
        if (Object.keys(extras).length) {
          const o: Obj = { type };
          if (source) o.source = source;
          o.target = target;
          if (ro) o.read_only = true;
          Object.assign(o, extras);
          pushTo(svc, 'volumes', o);
        } else if (!source) {
          pushTo(svc, 'volumes', ro ? { type: 'volume', target, read_only: true } : target);
        } else {
          pushTo(svc, 'volumes', `${source}:${target}${ro ? ':ro' : ''}`);
        }
        break;
      }
      case 'tmpfs':
        pushTo(svc, 'tmpfs', v);
        break;
      case 'volumes-from':
        pushTo(svc, 'volumes_from', v);
        break;
      case 'env': {
        const [k, val] = kvSplit(v);
        if (!k) break;
        const env = getObj(svc, 'environment');
        env[k] = val === null ? null : val;
        if (val === null) warn(`-e ${k} (không có giá trị) lấy từ môi trường shell khi chạy; trong Compose sẽ là biến không giá trị.`, 'info');
        break;
      }
      case 'env-file':
        pushTo(svc, 'env_file', v);
        break;
      case 'network': {
        if (v === 'default') break;
        if (v === 'host' || v === 'none' || v === 'bridge' || v.startsWith('container:')) {
          svc.network_mode = v;
        } else if (v.startsWith('service:')) {
          svc.network_mode = v;
        } else {
          if (!nets.has(v)) nets.set(v, null);
          lastNet = v;
          if (!ctx.networks.has(v)) ctx.networks.set(v, ctx.opts.external ? { external: true } : null);
        }
        break;
      }
      case 'network-alias':
        pendingAliases.push(v);
        break;
      case 'ip':
        pendingIp = v;
        break;
      case 'ip6':
        pendingIp6 = v;
        break;
      case 'link':
        pushTo(svc, 'links', v);
        warn(`--link ("${v}") đã lỗi thời; nên dùng network tùy chỉnh (các service cùng network gọi nhau bằng tên) và depends_on.`, 'info');
        break;
      case 'restart':
        svc.restart = v;
        break;
      case 'user':
        svc.user = v;
        break;
      case 'workdir':
        svc.working_dir = v;
        break;
      case 'entrypoint':
        svc.entrypoint = /\s/.test(v) ? [v] : v;
        if (/\s/.test(v)) warn('--entrypoint chứa khoảng trắng — được giữ nguyên là một phần tử (docker run coi cả chuỗi là đường dẫn thực thi).', 'info');
        if (v === '') svc.entrypoint = [];
        break;
      case 'hostname':
        svc.hostname = v;
        break;
      case 'domainname':
        svc.domainname = v;
        break;
      case 'cap-add':
        pushTo(svc, 'cap_add', v);
        break;
      case 'cap-drop':
        pushTo(svc, 'cap_drop', v);
        break;
      case 'privileged':
        if (v === 'true') svc.privileged = true;
        break;
      case 'device':
        pushTo(svc, 'devices', v);
        break;
      case 'device-cgroup-rule':
        pushTo(svc, 'device_cgroup_rules', v);
        break;
      case 'dns':
        pushTo(svc, 'dns', v);
        break;
      case 'dns-search':
        pushTo(svc, 'dns_search', v);
        break;
      case 'dns-option':
        pushTo(svc, 'dns_opt', v);
        break;
      case 'add-host':
        pushTo(svc, 'extra_hosts', v.includes(':') || !v.includes('=') ? v : v.replace('=', ':'));
        break;
      case 'mac-address':
        svc.mac_address = v;
        break;
      case 'label': {
        const [k, val] = kvSplit(v);
        getObj(svc, 'labels')[k] = val ?? '';
        break;
      }
      case 'annotation': {
        const [k, val] = kvSplit(v);
        getObj(svc, 'annotations')[k] = val ?? '';
        break;
      }
      case 'memory':
        limits.memory = v;
        break;
      case 'cpus':
        limits.cpus = v;
        break;
      case 'memory-reservation':
        reservations.memory = v;
        break;
      case 'memory-swap':
        svc.memswap_limit = v;
        break;
      case 'cpu-shares':
        svc.cpu_shares = /^\d+$/.test(v) ? Number(v) : v;
        break;
      case 'cpuset-cpus':
        svc.cpuset = v;
        break;
      case 'pids-limit':
        svc.pids_limit = /^-?\d+$/.test(v) ? Number(v) : v;
        break;
      case 'oom-score-adj':
        svc.oom_score_adj = /^-?\d+$/.test(v) ? Number(v) : v;
        break;
      case 'health-cmd':
        hc.test = ['CMD-SHELL', v];
        break;
      case 'health-interval':
        hc.interval = v;
        break;
      case 'health-timeout':
        hc.timeout = v;
        break;
      case 'health-retries':
        hc.retries = /^\d+$/.test(v) ? Number(v) : v;
        break;
      case 'health-start-period':
        hc.start_period = v;
        break;
      case 'health-start-interval':
        hc.start_interval = v;
        break;
      case 'no-healthcheck':
        if (v === 'true') hc.disable = true;
        break;
      case 'log-driver':
        getObj(svc, 'logging').driver = v;
        break;
      case 'log-opt': {
        const [k, val] = kvSplit(v);
        getObj(getObj(svc, 'logging'), 'options')[k] = val ?? '';
        break;
      }
      case 'ulimit': {
        const u = parseUlimit(v);
        if (!u) warn(`--ulimit "${v}" không đúng dạng name=soft[:hard].`);
        else getObj(svc, 'ulimits')[u[0]] = u[1];
        break;
      }
      case 'shm-size':
        svc.shm_size = v;
        break;
      case 'pid':
        svc.pid = v;
        break;
      case 'ipc':
        svc.ipc = v;
        break;
      case 'uts':
        svc.uts = v;
        break;
      case 'userns':
        svc.userns_mode = v;
        break;
      case 'cgroupns':
        svc.cgroup = v;
        break;
      case 'cgroup-parent':
        svc.cgroup_parent = v;
        break;
      case 'group-add':
        pushTo(svc, 'group_add', v);
        break;
      case 'init':
        if (v === 'true') svc.init = true;
        break;
      case 'platform':
        svc.platform = v;
        break;
      case 'pull':
        svc.pull_policy = v;
        break;
      case 'runtime':
        svc.runtime = v;
        break;
      case 'read-only':
        if (v === 'true') svc.read_only = true;
        break;
      case 'sysctl': {
        const [k, val] = kvSplit(v);
        getObj(svc, 'sysctls')[k] = val ?? '';
        break;
      }
      case 'security-opt':
        pushTo(svc, 'security_opt', v);
        break;
      case 'storage-opt': {
        const [k, val] = kvSplit(v);
        getObj(svc, 'storage_opt')[k] = val ?? '';
        break;
      }
      case 'stop-signal':
        svc.stop_signal = v;
        break;
      case 'stop-timeout':
        svc.stop_grace_period = /^\d+$/.test(v) ? `${v}s` : v;
        break;
      case 'gpus': {
        const g = v.replace(/^["']|["']$/g, '');
        const dev: Obj = { driver: 'nvidia', capabilities: ['gpu'] };
        if (g === 'all') dev.count = 'all';
        else if (/^-?\d+$/.test(g)) dev.count = Number(g);
        else if (g.startsWith('device=')) dev.device_ids = g.slice(7).split(',').map((x) => x.replace(/^"|"$/g, ''));
        else dev.count = 'all';
        const res = getObj(getObj(getObj(svc, 'deploy'), 'resources'), 'reservations');
        res.devices = [dev];
        warn('--gpus được chuyển sang deploy.resources.reservations.devices (cần NVIDIA Container Toolkit; Compose mới còn hỗ trợ khóa `gpus`). Hãy kiểm tra lại.');
        break;
      }
      default:
        if (NO_COMPOSE_EQUIV.has(f.name)) warn(`--${f.name} không có tương đương trong Compose (đã bỏ qua).`);
        else warn(`Cờ --${f.name} chưa được hỗ trợ chuyển đổi (đã bỏ qua).`);
    }
  }

  if (lastNet) {
    const cfg: Obj = {};
    if (pendingAliases.length) cfg.aliases = pendingAliases;
    if (pendingIp) cfg.ipv4_address = pendingIp;
    if (pendingIp6) cfg.ipv6_address = pendingIp6;
    if (Object.keys(cfg).length) nets.set(lastNet, cfg);
  } else if (pendingAliases.length || pendingIp || pendingIp6) {
    warn('--network-alias / --ip chỉ có tác dụng với network tùy chỉnh (--network <tên>); đã bỏ qua.');
  }
  pendingAliases = [];

  if (nets.size) {
    const anyCfg = [...nets.values()].some((x) => x);
    svc.networks = anyCfg ? Object.fromEntries(nets) : [...nets.keys()];
    if (svc.network_mode) warn('network_mode và networks không dùng cùng nhau được.');
  }
  if (Object.keys(hc).length) svc.healthcheck = orderObject(hc, ['test', 'interval', 'timeout', 'retries', 'start_period', 'start_interval', 'disable']);
  if (Object.keys(limits).length || Object.keys(reservations).length) {
    const res = getObj(getObj(svc, 'deploy'), 'resources');
    const newRes: Obj = {};
    if (Object.keys(limits).length) newRes.limits = orderObject(limits, ['cpus', 'memory']);
    const existingRes = (res.reservations as Obj | undefined) ?? {};
    if (Object.keys(reservations).length || Object.keys(existingRes).length) newRes.reservations = { ...reservations, ...existingRes };
    getObj(svc, 'deploy').resources = newRes;
  }
  if (svc.deploy && (limits.memory || limits.cpus)) {
    warn('memory/cpus được đặt trong deploy.resources.limits (Docker Compose v2 áp dụng cả khi không dùng Swarm).', 'info');
  }
  return { name, svc };
}

/** Bảo vệ chuỗi dễ bị hiểu nhầm kiểu YAML (yes/no/on/off, 80:80...) bằng dấu nháy kép */
function protect(v: unknown): unknown {
  if (typeof v === 'string') {
    if (/^(y|yes|n|no|on|off|true|false|null|~)$/i.test(v) || /^[\d_.:,\-/]+$/.test(v) || /^0[0-7]+$/.test(v)) {
      const s = new YAML.Scalar(v);
      s.type = 'QUOTE_DOUBLE';
      return s;
    }
    return v;
  }
  if (Array.isArray(v)) return v.map(protect);
  if (v && typeof v === 'object') {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v as Obj)) out[k] = protect(x);
    return out;
  }
  return v;
}

export function stringifyYaml(o: unknown): string {
  return YAML.stringify(protect(o), { indent: 2, lineWidth: 0, nullStr: '' });
}

export function dockerRunToCompose(text: string, options: Partial<DockerToComposeOptions> = {}): DockerToComposeResult {
  const opts = { ...DEFAULT_D2C, ...options };
  const warnings: Warning[] = [];
  if (!text.trim()) return { ok: true, yaml: '', services: [], warnings };
  if (text.length > MAX_INPUT) {
    return { ok: false, yaml: '', services: [], warnings, error: `Đầu vào quá lớn (tối đa ${Math.round(MAX_INPUT / 1000)} KB).` };
  }
  try {
    const parsed = parseDockerRunText(text);
    warnings.push(...parsed.warnings);
    if (!parsed.runs.length) {
      return { ok: false, yaml: '', services: [], warnings, error: 'Không tìm thấy lệnh docker run hợp lệ.' };
    }
    const volumes = new Map<string, Obj | null>();
    const networks = new Map<string, Obj | null>();
    const services: Obj = {};
    const used = new Set<string>();
    for (const r of parsed.runs) {
      let svcName = '';
      const local: Warning[] = [];
      const ctx: Ctx = {
        opts,
        volumes,
        networks,
        warn: (message, level = 'warn') => local.push({ level, message }),
      };
      const { name, svc } = buildService(r.spec, ctx);
      svcName = (name ?? deriveName(r.spec.image)).replace(/[^A-Za-z0-9._-]/g, '-');
      if (!svcName) svcName = 'app';
      let unique = svcName;
      for (let k = 2; used.has(unique); k++) unique = `${svcName}-${k}`;
      used.add(unique);
      if (name && opts.containerName) svc.container_name = name;
      for (const w of [...r.warnings, ...local]) warnings.push({ ...w, service: unique });
      services[unique] = orderObject(svc, SERVICE_ORDER);
    }
    const doc: Obj = {};
    if (opts.includeVersion) doc.version = '3.8';
    doc.services = services;
    if (volumes.size) {
      doc.volumes = Object.fromEntries(volumes);
      if (!opts.external) {
        warnings.push({ level: 'info', message: 'Volume được Compose tạo với tiền tố tên project (vd. myproj_data). Bật "external" nếu muốn dùng volume đã tồn tại.' });
      }
    }
    if (networks.size) {
      doc.networks = Object.fromEntries(networks);
      if (opts.external) warnings.push({ level: 'info', message: 'Network đánh dấu external: cần `docker network create <tên>` trước khi `docker compose up`.' });
    }
    // Phát hiện lệnh dùng link tới container khác
    return { ok: true, yaml: stringifyYaml(doc), services: Object.keys(services), warnings };
  } catch (e) {
    return { ok: false, yaml: '', services: [], warnings, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------- Compose → docker run ---------------- */

export interface ComposeToRunOptions {
  detach: boolean;
  rm: boolean;
  multiline: boolean;
  setup: boolean;
}

export const DEFAULT_C2R: ComposeToRunOptions = { detach: true, rm: false, multiline: true, setup: true };

export interface RunItem {
  service: string;
  command: string;
  buildCommand?: string;
  dependsOn: string[];
  notes: string[];
}

export interface ComposeToRunResult {
  ok: boolean;
  output: string;
  items: RunItem[];
  setup: string[];
  warnings: Warning[];
  error?: string;
}

/** Trích dẫn một tham số, hiểu `${VAR}` của Compose (giữ nội suy) và marker \u0002 = $(pwd), \u0003 = $HOME */
export function shArg(s: string): string {
  if (s === '') return "''";
  let t = s.replace(/\$\$/g, '\u0001');
  const markers = /[\u0002\u0003]/.test(t);
  if (!t.includes('$') && !markers) return shQuote(t.replace(/\u0001/g, '$'));
  t = t
    .replace(/[\\"`]/g, (m) => '\\' + m)
    .replace(/\u0001/g, '\\$')
    .replace(/\u0002/g, '$(pwd)')
    .replace(/\u0003/g, '$HOME');
  return '"' + t + '"';
}

const HANDLED_SERVICE_KEYS = new Set([
  'image', 'build', 'container_name', 'hostname', 'domainname', 'user', 'working_dir', 'entrypoint', 'command',
  'restart', 'init', 'privileged', 'read_only', 'stdin_open', 'tty', 'platform', 'pull_policy', 'runtime', 'ports',
  'expose', 'volumes', 'volumes_from', 'tmpfs', 'environment', 'env_file', 'depends_on', 'links', 'networks',
  'network_mode', 'mac_address', 'dns', 'dns_search', 'dns_opt', 'extra_hosts', 'cap_add', 'cap_drop', 'devices',
  'security_opt', 'sysctls', 'ulimits', 'shm_size', 'pid', 'ipc', 'uts', 'userns_mode', 'cgroup', 'cgroup_parent',
  'group_add', 'stop_signal', 'stop_grace_period', 'pids_limit', 'oom_score_adj', 'cpu_shares', 'cpuset',
  'memswap_limit', 'mem_limit', 'mem_reservation', 'cpus', 'healthcheck', 'logging', 'labels', 'annotations',
  'deploy', 'device_cgroup_rules', 'storage_opt', 'gpus', 'name', 'cpu_count', 'cpu_percent',
]);

function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function durationToSeconds(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  if (/^\d+$/.test(v)) return Number(v);
  const re = /(\d+(?:\.\d+)?)(h|m(?!s)|s|ms)/g;
  let total = 0;
  let m: RegExpExecArray | null;
  let matched = 0;
  while ((m = re.exec(v))) {
    matched += m[0].length;
    const n = Number(m[1]);
    total += m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : m[2] === 's' ? n : n / 1000;
  }
  return matched === v.length ? Math.ceil(total) : null;
}

function relPath(p: string): string {
  if (p === '.') return '\u0002';
  if (p === '..') return '\u0002/..';
  if (p.startsWith('./')) return '\u0002/' + p.slice(2);
  if (p.startsWith('../')) return '\u0002/' + p;
  if (p === '~' || p.startsWith('~/')) return '\u0003' + p.slice(1);
  return p;
}

function portToString(p: unknown): string {
  if (p && typeof p === 'object') {
    const o = p as Obj;
    const target = str(o.target);
    const pub = o.published !== undefined ? str(o.published) : '';
    const ip = o.host_ip ? str(o.host_ip) : '';
    let s: string;
    if (pub) s = (ip ? ip + ':' : '') + pub + ':' + target;
    else s = ip ? ip + '::' + target : target;
    const proto = o.protocol ? str(o.protocol) : '';
    return proto && proto !== 'tcp' ? `${s}/${proto}` : s;
  }
  return str(p);
}

function toEnvPairs(v: unknown): [string, string | null][] {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map((x) => {
      const [k, val] = kvSplit(str(x));
      return [k, val] as [string, string | null];
    });
  }
  if (typeof v === 'object') {
    return Object.entries(v as Obj).map(([k, val]) => [k, val === null || val === undefined ? null : str(val)] as [string, string | null]);
  }
  return [];
}

function toKvPairs(v: unknown): [string, string][] {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map((x) => {
      const [k, val] = kvSplit(str(x));
      return [k, val ?? ''] as [string, string];
    });
  }
  if (typeof v === 'object') return Object.entries(v as Obj).map(([k, val]) => [k, val === null || val === undefined ? '' : str(val)] as [string, string]);
  return [];
}

export function composeToDockerRun(text: string, options: Partial<ComposeToRunOptions> = {}): ComposeToRunResult {
  const opts = { ...DEFAULT_C2R, ...options };
  const warnings: Warning[] = [];
  const fail = (error: string): ComposeToRunResult => ({ ok: false, output: '', items: [], setup: [], warnings, error });
  if (!text.trim()) return { ok: true, output: '', items: [], setup: [], warnings };
  if (text.length > MAX_INPUT) return fail(`Đầu vào quá lớn (tối đa ${Math.round(MAX_INPUT / 1000)} KB).`);
  let root: unknown;
  try {
    const doc = YAML.parseDocument(text, { merge: true, uniqueKeys: false });
    if (doc.errors.length) {
      const e = doc.errors[0];
      const lp = e.linePos?.[0];
      return fail(`YAML không hợp lệ${lp ? ` (dòng ${lp.line}, cột ${lp.col})` : ''}: ${e.message.split('\n')[0]}`);
    }
    root = doc.toJS({ maxAliasCount: 200 });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) return fail('File Compose phải là một map YAML có khóa "services".');
  const top = root as Obj;
  const servicesRaw = top.services;
  if (!servicesRaw || typeof servicesRaw !== 'object' || Array.isArray(servicesRaw)) return fail('Không tìm thấy mục "services" trong file Compose.');
  const topVolumes = (top.volumes && typeof top.volumes === 'object' ? top.volumes : {}) as Obj;
  const topNetworks = (top.networks && typeof top.networks === 'object' ? top.networks : {}) as Obj;
  if (top.version) warnings.push({ level: 'info', message: 'Khóa "version" đã lỗi thời và được bỏ qua.' });
  for (const k of Object.keys(top)) {
    if (!['services', 'volumes', 'networks', 'version', 'name'].includes(k) && !k.startsWith('x-')) {
      warnings.push({ level: 'info', message: `Mục cấp cao "${k}" không được chuyển đổi.` });
    }
  }

  const names = Object.keys(servicesRaw as Obj);
  if (names.length > MAX_SERVICES) warnings.push({ level: 'warn', message: `Chỉ xử lý ${MAX_SERVICES} service đầu tiên.` });
  const svcMap = servicesRaw as Obj;

  // dependency map & thứ tự
  const depsOf = (n: string): string[] => {
    const s = svcMap[n];
    if (!s || typeof s !== 'object') return [];
    const d = (s as Obj).depends_on;
    if (!d) return [];
    if (Array.isArray(d)) return d.map(str);
    if (typeof d === 'object') return Object.keys(d as Obj);
    return [];
  };
  const order: string[] = [];
  const state = new Map<string, number>();
  let cycle = false;
  const visit = (n: string) => {
    const st = state.get(n);
    if (st === 2) return;
    if (st === 1) {
      cycle = true;
      return;
    }
    state.set(n, 1);
    for (const d of depsOf(n)) if (d in svcMap) visit(d);
    state.set(n, 2);
    order.push(n);
  };
  for (const n of names.slice(0, MAX_SERVICES)) visit(n);
  if (cycle) warnings.push({ level: 'warn', message: 'Phát hiện vòng lặp trong depends_on; thứ tự có thể không chính xác.' });

  const usedNetworks = new Set<string>();
  const usedVolumes = new Set<string>();
  const items: RunItem[] = [];

  const netName = (n: string): string => {
    const cfg = topNetworks[n];
    if (cfg && typeof cfg === 'object') {
      const o = cfg as Obj;
      if (o.name) return str(o.name);
      if (o.external && typeof o.external === 'object' && (o.external as Obj).name) return str((o.external as Obj).name);
    }
    return n;
  };
  const volName = (n: string): string => {
    const cfg = topVolumes[n];
    if (cfg && typeof cfg === 'object') {
      const o = cfg as Obj;
      if (o.name) return str(o.name);
    }
    return n;
  };

  for (const sname of order) {
    const raw = svcMap[sname];
    const notes: string[] = [];
    const warn = (message: string, level: WarnLevel = 'warn') => warnings.push({ level, message, service: sname });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      warn('Service rỗng hoặc không hợp lệ, đã bỏ qua.');
      continue;
    }
    const s = raw as Obj;
    for (const k of Object.keys(s)) {
      if (!HANDLED_SERVICE_KEYS.has(k) && !k.startsWith('x-')) warn(`Khóa "${k}" không có tương đương trong docker run (đã bỏ qua).`, 'info');
    }
    const pieces: string[] = [];
    const add = (flag: string, value?: string) => pieces.push(value === undefined ? flag : `${flag} ${shArg(value)}`);

    // image / build
    let image = s.image !== undefined ? str(s.image) : '';
    let buildCommand: string | undefined;
    if (s.build !== undefined && s.build !== null) {
      let context = '.';
      let dockerfile: string | undefined;
      let target: string | undefined;
      let args: [string, string | null][] = [];
      if (typeof s.build === 'string') context = s.build;
      else if (typeof s.build === 'object') {
        const b = s.build as Obj;
        if (b.context) context = str(b.context);
        if (b.dockerfile) dockerfile = str(b.dockerfile);
        if (b.target) target = str(b.target);
        args = toEnvPairs(b.args);
        for (const k of Object.keys(b)) {
          if (!['context', 'dockerfile', 'target', 'args'].includes(k)) warn(`build.${k} không được chuyển sang docker build.`, 'info');
        }
      }
      if (!image) image = `${sname}:local`;
      const bp = ['docker build', '-t ' + shArg(image)];
      if (dockerfile) bp.push('-f ' + shArg(dockerfile));
      if (target) bp.push('--target ' + shArg(target));
      for (const [k, v] of args) bp.push('--build-arg ' + shArg(v === null ? k : `${k}=${v}`));
      bp.push(shArg(context));
      buildCommand = bp.join(' ');
      notes.push('Service dùng "build:" — cần chạy docker build trước khi docker run.');
      warn('Service này dùng build: nên cần chạy lệnh docker build (đã gợi ý) trước khi docker run.', 'info');
    }
    if (!image) {
      warn('Service không có image hoặc build, đã bỏ qua.');
      continue;
    }

    const cname = s.container_name ? str(s.container_name) : sname;
    if (!s.container_name) notes.push(`Compose sẽ đặt tên container là <project>-${sname}-1; ở đây dùng tên "${sname}".`);
    add('--name', cname);
    if (s.restart !== undefined && str(s.restart) !== 'no') add('--restart', str(s.restart));
    if (s.stdin_open === true) pieces.push('-i');
    if (s.tty === true) pieces.push('-t');
    if (s.privileged === true) pieces.push('--privileged');
    if (s.init === true) pieces.push('--init');
    if (s.read_only === true) pieces.push('--read-only');
    for (const [key, flag] of [
      ['hostname', '--hostname'], ['domainname', '--domainname'], ['user', '--user'], ['working_dir', '--workdir'],
      ['platform', '--platform'], ['pull_policy', '--pull'], ['runtime', '--runtime'], ['mac_address', '--mac-address'],
      ['shm_size', '--shm-size'], ['pid', '--pid'], ['ipc', '--ipc'], ['uts', '--uts'], ['userns_mode', '--userns'],
      ['cgroup', '--cgroupns'], ['cgroup_parent', '--cgroup-parent'], ['stop_signal', '--stop-signal'],
      ['pids_limit', '--pids-limit'], ['oom_score_adj', '--oom-score-adj'], ['cpu_shares', '--cpu-shares'],
      ['cpuset', '--cpuset-cpus'], ['memswap_limit', '--memory-swap'], ['mem_reservation', '--memory-reservation'],
    ] as const) {
      if (s[key] !== undefined && s[key] !== null) add(flag, str(s[key]));
    }
    if (s.pull_policy && !['always', 'missing', 'never'].includes(str(s.pull_policy))) {
      warn(`pull_policy "${str(s.pull_policy)}" không có tương đương trong docker run --pull.`);
    }
    if (s.stop_grace_period !== undefined) {
      const sec = durationToSeconds(s.stop_grace_period);
      if (sec === null) warn(`stop_grace_period "${str(s.stop_grace_period)}" không đổi được sang giây.`);
      else add('--stop-timeout', String(sec));
    }
    for (const g of asArray(s.group_add)) add('--group-add', str(g));
    if (s.mem_limit !== undefined) add('--memory', str(s.mem_limit));
    if (s.cpus !== undefined) add('--cpus', str(s.cpus));
    // deploy
    if (s.deploy && typeof s.deploy === 'object') {
      const d = s.deploy as Obj;
      const res = (d.resources && typeof d.resources === 'object' ? d.resources : {}) as Obj;
      const lim = (res.limits && typeof res.limits === 'object' ? res.limits : {}) as Obj;
      const rsv = (res.reservations && typeof res.reservations === 'object' ? res.reservations : {}) as Obj;
      if (lim.memory !== undefined && s.mem_limit === undefined) add('--memory', str(lim.memory));
      if (lim.cpus !== undefined && s.cpus === undefined) add('--cpus', str(lim.cpus));
      if (lim.pids !== undefined) add('--pids-limit', str(lim.pids));
      if (rsv.memory !== undefined && s.mem_reservation === undefined) add('--memory-reservation', str(rsv.memory));
      if (Array.isArray(rsv.devices)) {
        for (const dv of rsv.devices) {
          if (dv && typeof dv === 'object') {
            const o = dv as Obj;
            const caps = asArray(o.capabilities).map(str);
            if (caps.includes('gpu') || o.driver === 'nvidia') {
              if (Array.isArray(o.device_ids) && o.device_ids.length) add('--gpus', `"device=${o.device_ids.map(str).join(',')}"`);
              else add('--gpus', o.count === undefined ? 'all' : str(o.count));
              warn('GPU được chuyển thành --gpus (cần NVIDIA Container Toolkit).', 'info');
            }
          }
        }
      }
      for (const k of Object.keys(d)) {
        if (!['resources'].includes(k)) warn(`deploy.${k} chỉ có ý nghĩa với Swarm/Compose — đã bỏ qua trong docker run.`, 'info');
      }
      for (const k of Object.keys(res)) if (!['limits', 'reservations'].includes(k)) warn(`deploy.resources.${k} đã bỏ qua.`, 'info');
    }
    if (s.gpus !== undefined) {
      const g = s.gpus;
      if (g === 'all') add('--gpus', 'all');
      else if (Array.isArray(g)) add('--gpus', 'all');
      else add('--gpus', str(g));
      warn('gpus được chuyển thành --gpus (cần NVIDIA Container Toolkit).', 'info');
    }

    // ports
    for (const p of asArray(s.ports)) add('-p', portToString(p));
    for (const p of asArray(s.expose)) add('--expose', str(p));

    // volumes
    for (const v of asArray(s.volumes)) {
      if (v && typeof v === 'object') {
        const o = v as Obj;
        const type = o.type ? str(o.type) : 'volume';
        const target = str(o.target);
        if (type === 'tmpfs') {
          const t = (o.tmpfs && typeof o.tmpfs === 'object' ? o.tmpfs : {}) as Obj;
          const parts = [`type=tmpfs`, `target=${target}`];
          if (t.size !== undefined) parts.push(`tmpfs-size=${str(t.size)}`);
          if (t.mode !== undefined) parts.push(`tmpfs-mode=${Number(t.mode).toString(8)}`);
          add('--mount', parts.join(','));
          continue;
        }
        let source = o.source !== undefined ? str(o.source) : '';
        const extra = Object.keys(o).filter((k) => !['type', 'source', 'target', 'read_only'].includes(k));
        if (type === 'volume' && source) {
          usedVolumes.add(source);
          source = volName(source);
        }
        if (type === 'bind') source = relPath(source);
        if (!extra.length && type !== 'tmpfs') {
          if (!source) add('-v', target);
          else add('-v', `${source}:${target}${o.read_only ? ':ro' : ''}`);
        } else {
          const parts = [`type=${type}`];
          if (source) parts.push(`source=${source}`);
          parts.push(`target=${target}`);
          if (o.read_only) parts.push('readonly');
          const b = (o.bind && typeof o.bind === 'object' ? o.bind : {}) as Obj;
          if (b.propagation) parts.push(`bind-propagation=${str(b.propagation)}`);
          if (b.create_host_path === false) parts.push('bind-create-host-path=false');
          const vo = (o.volume && typeof o.volume === 'object' ? o.volume : {}) as Obj;
          if (vo.nocopy) parts.push('volume-nocopy');
          if (vo.subpath) parts.push(`volume-subpath=${str(vo.subpath)}`);
          for (const k of extra) if (!['bind', 'volume'].includes(k)) warn(`volumes[].${k} không được chuyển.`, 'info');
          add('--mount', parts.join(','));
        }
        continue;
      }
      const p = splitVolume(str(v));
      if (p.src === undefined) {
        add('-v', p.dst);
        continue;
      }
      let src = p.src;
      if (isBindSource(src)) src = relPath(src);
      else {
        usedVolumes.add(src);
        src = volName(src);
      }
      add('-v', `${src}:${p.dst}${p.opts ? ':' + p.opts : ''}`);
    }
    for (const t of asArray(s.tmpfs)) add('--tmpfs', str(t));
    for (const v of asArray(s.volumes_from)) add('--volumes-from', str(v));

    // env
    for (const [k, v] of toEnvPairs(s.environment)) add('-e', v === null ? k : `${k}=${v}`);
    for (const ef of asArray(s.env_file)) {
      if (ef && typeof ef === 'object') add('--env-file', str((ef as Obj).path));
      else add('--env-file', str(ef));
    }

    // network
    if (s.network_mode !== undefined) add('--network', str(s.network_mode));
    else if (s.networks !== undefined && s.networks !== null) {
      const entries: [string, Obj | null][] = Array.isArray(s.networks)
        ? s.networks.map((n) => [str(n), null] as [string, Obj | null])
        : Object.entries(s.networks as Obj).map(([n, c]) => [n, c && typeof c === 'object' ? (c as Obj) : null] as [string, Obj | null]);
      const real = entries.filter(([n]) => n !== 'default');
      if (real.length > 1) warn('Service dùng nhiều network: docker run nhiều --network cần Docker Engine 25+.', 'info');
      for (const [n, c] of real) {
        usedNetworks.add(n);
        add('--network', netName(n));
        if (c) {
          for (const a of asArray(c.aliases)) add('--network-alias', str(a));
          if (c.ipv4_address) add('--ip', str(c.ipv4_address));
          if (c.ipv6_address) add('--ip6', str(c.ipv6_address));
          if (c.priority !== undefined) warn('networks[].priority không có tương đương.', 'info');
        }
      }
      if (entries.length && !real.length) notes.push('Dùng network mặc định của Compose; docker run dùng bridge mặc định.');
    }
    for (const l of asArray(s.links)) add('--link', str(l));
    for (const d of asArray(s.dns)) add('--dns', str(d));
    for (const d of asArray(s.dns_search)) add('--dns-search', str(d));
    for (const d of asArray(s.dns_opt)) add('--dns-option', str(d));
    if (s.extra_hosts) {
      if (Array.isArray(s.extra_hosts)) for (const h of s.extra_hosts) add('--add-host', str(h).replace('=', ':'));
      else if (typeof s.extra_hosts === 'object') for (const [h, ip] of Object.entries(s.extra_hosts as Obj)) add('--add-host', `${h}:${str(ip)}`);
    }

    // security / devices
    for (const c of asArray(s.cap_add)) add('--cap-add', str(c));
    for (const c of asArray(s.cap_drop)) add('--cap-drop', str(c));
    for (const d of asArray(s.devices)) add('--device', typeof d === 'object' && d ? `${str((d as Obj).source)}:${str((d as Obj).target)}` : str(d));
    for (const d of asArray(s.device_cgroup_rules)) add('--device-cgroup-rule', str(d));
    for (const o of asArray(s.security_opt)) add('--security-opt', str(o));
    for (const [k, v] of toKvPairs(s.sysctls)) add('--sysctl', `${k}=${v}`);
    for (const [k, v] of toKvPairs(s.storage_opt)) add('--storage-opt', `${k}=${v}`);
    if (s.ulimits && typeof s.ulimits === 'object') {
      for (const [k, v] of Object.entries(s.ulimits as Obj)) {
        if (v && typeof v === 'object') add('--ulimit', `${k}=${str((v as Obj).soft)}:${str((v as Obj).hard)}`);
        else add('--ulimit', `${k}=${str(v)}`);
      }
    }

    // healthcheck
    if (s.healthcheck && typeof s.healthcheck === 'object') {
      const h = s.healthcheck as Obj;
      if (h.disable === true) pieces.push('--no-healthcheck');
      else if (h.test !== undefined) {
        const t = h.test;
        if (Array.isArray(t)) {
          const first = str(t[0]);
          if (first === 'NONE') pieces.push('--no-healthcheck');
          else if (first === 'CMD-SHELL') add('--health-cmd', t.slice(1).map(str).join(' '));
          else if (first === 'CMD') add('--health-cmd', t.slice(1).map((x) => shQuote(str(x))).join(' '));
          else add('--health-cmd', t.map((x) => shQuote(str(x))).join(' '));
        } else add('--health-cmd', str(t));
      }
      if (h.interval !== undefined) add('--health-interval', str(h.interval));
      if (h.timeout !== undefined) add('--health-timeout', str(h.timeout));
      if (h.retries !== undefined) add('--health-retries', str(h.retries));
      if (h.start_period !== undefined) add('--health-start-period', str(h.start_period));
      if (h.start_interval !== undefined) add('--health-start-interval', str(h.start_interval));
    }

    // logging
    if (s.logging && typeof s.logging === 'object') {
      const l = s.logging as Obj;
      if (l.driver) add('--log-driver', str(l.driver));
      for (const [k, v] of toKvPairs(l.options)) add('--log-opt', `${k}=${v}`);
    }
    for (const [k, v] of toKvPairs(s.labels)) add('--label', `${k}=${v}`);
    for (const [k, v] of toKvPairs(s.annotations)) add('--annotation', `${k}=${v}`);

    // entrypoint & command
    let args: string[] = [];
    if (s.command !== undefined && s.command !== null) {
      if (Array.isArray(s.command)) args = s.command.map(str);
      else {
        const tk = shellTokenize(str(s.command));
        args = tk.commands.flat();
        if (tk.errors.length) warn('command chứa dấu nháy chưa đóng.');
      }
    }
    if (s.entrypoint !== undefined && s.entrypoint !== null) {
      let ep: string[];
      if (Array.isArray(s.entrypoint)) ep = s.entrypoint.map(str);
      else ep = shellTokenize(str(s.entrypoint)).commands.flat();
      if (ep.length === 0) add('--entrypoint', '');
      else {
        add('--entrypoint', ep[0]);
        if (ep.length > 1) {
          args = [...ep.slice(1), ...args];
          notes.push('entrypoint có nhiều phần tử: phần tử đầu là --entrypoint, phần còn lại được đặt trước command.');
        }
      }
    }

    // depends_on
    const deps = depsOf(sname);
    if (deps.length) {
      let detail = '';
      if (s.depends_on && !Array.isArray(s.depends_on) && typeof s.depends_on === 'object') {
        detail = Object.entries(s.depends_on as Obj)
          .map(([n, c]) => `${n}${c && typeof c === 'object' && (c as Obj).condition ? ` (${str((c as Obj).condition)})` : ''}`)
          .join(', ');
      } else detail = deps.join(', ');
      notes.push(`depends_on: ${detail} — hãy chạy các service này trước (docker run không tự đảm bảo thứ tự/healthy).`);
    }

    const head: string[] = ['docker run'];
    if (opts.detach) head.push('-d');
    if (opts.rm) head.push('--rm');
    const imageArg = shArg(image);
    const all = [head.join(' '), ...pieces];
    const tail = [imageArg, ...args.map((a) => shArg(a))].join(' ');
    const command = opts.multiline ? [...all, tail].join(' \\\n  ') : [...all, tail].join(' ');
    items.push({ service: sname, command, buildCommand, dependsOn: deps, notes });
  }

  const setup: string[] = [];
  if (opts.setup) {
    for (const n of usedNetworks) {
      const cfg = topNetworks[n];
      const o = (cfg && typeof cfg === 'object' ? cfg : {}) as Obj;
      if (o.external) continue;
      const cmd = ['docker network create'];
      if (o.driver) cmd.push('--driver ' + shArg(str(o.driver)));
      cmd.push(shArg(netName(n)));
      setup.push(cmd.join(' '));
    }
    for (const v of usedVolumes) {
      const cfg = topVolumes[v];
      const o = (cfg && typeof cfg === 'object' ? cfg : {}) as Obj;
      if (o.external) continue;
      const cmd = ['docker volume create'];
      if (o.driver) cmd.push('--driver ' + shArg(str(o.driver)));
      for (const [k, val] of toKvPairs(o.driver_opts)) cmd.push('--opt ' + shArg(`${k}=${val}`));
      cmd.push(shArg(volName(v)));
      setup.push(cmd.join(' '));
    }
    if (usedVolumes.size) {
      warnings.push({ level: 'info', message: 'Compose đặt tên volume theo "<project>_<tên>"; docker run dùng đúng tên khai báo (hoặc name:).' });
    }
  }

  const blocks: string[] = [];
  if (setup.length) blocks.push(['# Chuẩn bị network / volume', ...setup].join('\n'));
  for (const it of items) {
    const lines: string[] = [`# --- ${it.service} ---`];
    for (const n of it.notes) lines.push(`# ${n}`);
    if (it.buildCommand) lines.push(it.buildCommand);
    lines.push(it.command);
    blocks.push(lines.join('\n'));
  }
  return { ok: true, output: blocks.join('\n\n') + (blocks.length ? '\n' : ''), items, setup, warnings };
}

/* ---------------- Mẫu ---------------- */

export const SAMPLE_RUN = `# Web server
docker run -d --name web --restart unless-stopped \\
  -p 8080:80 -p 443:443 \\
  -v $(pwd)/html:/usr/share/nginx/html:ro \\
  --network appnet \\
  -e NGINX_HOST=example.com \\
  nginx:1.27-alpine

# Database
docker run -d --name db --restart=always \\
  -e POSTGRES_USER=app -e POSTGRES_PASSWORD='s3cr3t pass' -e POSTGRES_DB=app \\
  -v pgdata:/var/lib/postgresql/data \\
  --network appnet \\
  --health-cmd "pg_isready -U app" --health-interval 10s --health-retries 5 \\
  -m 512m --cpus 1.5 \\
  postgres:16

docker run -d --name cache -p 127.0.0.1:6379:6379 redis:7 redis-server --appendonly yes`;

export const SAMPLE_COMPOSE = `services:
  web:
    image: nginx:1.27-alpine
    container_name: web
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    environment:
      NGINX_HOST: example.com
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    networks: [appnet]
  db:
    image: postgres:16
    environment:
      - POSTGRES_USER=app
      - POSTGRES_PASSWORD=secret
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 10s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.5"
    networks: [appnet]
  api:
    build:
      context: ./api
      dockerfile: Dockerfile.dev
      args:
        NODE_ENV: development
    command: ["node", "server.js"]
    ports: ["3000:3000"]
volumes:
  pgdata:
networks:
  appnet:
`;
