/**
 * Sao lưu / khôi phục dữ liệu ứng dụng (localStorage) — logic thuần, không phụ thuộc React.
 * Chỉ các khóa trong WHITELIST mới được đọc/ghi. Không bao giờ eval/thực thi nội dung file.
 */

export type BackupGroup = 'settings' | 'data' | 'secrets';
type Kind = 'array' | 'object' | 'json' | 'text' | 'theme' | 'bool' | 'flag';

export interface KeySpec {
  key: string;
  group: BackupGroup;
  label: string;
  kind: Kind;
  /** Giới hạn ký tự của giá trị khi nhập */
  maxChars: number;
}

const MB = 1024 * 1024;

export const BACKUP_KEYS: readonly KeySpec[] = [
  { key: 'getools_theme', group: 'settings', label: 'Giao diện sáng/tối', kind: 'theme', maxChars: 16 },
  { key: 'getools_sidebar_category_state', group: 'settings', label: 'Trạng thái nhóm thanh bên', kind: 'object', maxChars: 64 * 1024 },
  { key: 'git_downloader_sidebar_collapsed', group: 'settings', label: 'Thu gọn thanh bên', kind: 'bool', maxChars: 8 },
  { key: 'git_downloader_zip_options', group: 'settings', label: 'Tùy chọn ZIP', kind: 'object', maxChars: 64 * 1024 },
  { key: 'getools_ai_settings', group: 'settings', label: 'Cấu hình AI (không gồm khóa)', kind: 'object', maxChars: 256 * 1024 },
  { key: 'getools_recent_tools', group: 'settings', label: 'Công cụ dùng gần đây', kind: 'array', maxChars: 64 * 1024 },
  { key: 'getools_favorite_tools', group: 'settings', label: 'Công cụ yêu thích', kind: 'array', maxChars: 64 * 1024 },
  { key: 'getools_general_mode', group: 'settings', label: 'Chế độ Phổ thông', kind: 'flag', maxChars: 1 },
  { key: 'getools_tts_prefs_v1', group: 'settings', label: 'Tùy chọn giọng đọc (TTS)', kind: 'object', maxChars: 64 * 1024 },
  { key: 'getools_llm_pricing_overrides', group: 'settings', label: 'Bảng giá LLM tùy chỉnh', kind: 'object', maxChars: 256 * 1024 },
  { key: 'getools_snippets', group: 'data', label: 'Đoạn mã (snippets)', kind: 'json', maxChars: 4 * MB },
  { key: 'git_downloader_bookmarks', group: 'data', label: 'Dấu trang', kind: 'array', maxChars: 2 * MB },
  { key: 'git_downloader_history', group: 'data', label: 'Lịch sử tải', kind: 'array', maxChars: 2 * MB },
  { key: 'git_downloader_tts_history_v1', group: 'data', label: 'Lịch sử chuyển văn bản thành giọng nói', kind: 'array', maxChars: 4 * MB },
  { key: 'git_downloader_stt_history_v1', group: 'data', label: 'Lịch sử chuyển giọng nói thành văn bản', kind: 'array', maxChars: 4 * MB },
  { key: 'getools:markdown-preview:draft', group: 'data', label: 'Bản nháp Markdown', kind: 'text', maxChars: 2 * MB },
  { key: 'getools:readme-builder:draft', group: 'data', label: 'Bản nháp README', kind: 'object', maxChars: 2 * MB },
  { key: 'getools:readme-builder:tree', group: 'data', label: 'Cây thư mục cho README', kind: 'text', maxChars: 2 * MB },
  { key: 'mock-data:v1', group: 'data', label: 'Lược đồ dữ liệu giả', kind: 'json', maxChars: 2 * MB },
  { key: 'getools_checklists', group: 'data', label: 'Checklist', kind: 'array', maxChars: 2 * MB },
  { key: 'getools_split_bill', group: 'data', label: 'Chia tiền nhóm', kind: 'object', maxChars: 2 * MB },
  { key: 'getools_split_bill_banks', group: 'data', label: 'Tài khoản ngân hàng (Chia tiền nhóm)', kind: 'object', maxChars: 256 * 1024 },
  { key: 'git_downloader_keys', group: 'secrets', label: 'Token Git / khóa Gemini', kind: 'object', maxChars: 64 * 1024 },
];

const SPEC_BY_KEY: ReadonlyMap<string, KeySpec> = new Map(BACKUP_KEYS.map((s) => [s.key, s]));

/** Khóa chứa khóa API lồng bên trong (getools_ai_settings.keys) */
export const AI_SETTINGS_KEY = 'getools_ai_settings';

export const GROUP_LABELS: Record<BackupGroup, string> = {
  settings: 'Cài đặt & tùy chọn',
  data: 'Dữ liệu người dùng',
  secrets: 'Khóa API / token',
};

export const BACKUP_APP = 'getools';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_FILE_BYTES = 10 * MB;

export function getKeySpec(key: string): KeySpec | undefined {
  return SPEC_BY_KEY.has(key) ? SPEC_BY_KEY.get(key) : undefined;
}
export function classifyKey(key: string): BackupGroup | null {
  return getKeySpec(key)?.group ?? null;
}
export function keysOfGroup(group: BackupGroup): string[] {
  return BACKUP_KEYS.filter((s) => s.group === group).map((s) => s.key);
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BackupFile {
  app: 'getools';
  version: number;
  exportedAt: string;
  includesSecrets: boolean;
  entries: Record<string, string>;
}

/* ---------- tiện ích an toàn ---------- */

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeParse(raw: string | null | undefined): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Sao chép nông một object, bỏ khóa nguy hiểm, trả về object không prototype */
function cleanObject(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const k of Object.keys(src)) if (!BAD_KEYS.has(k)) out[k] = src[k];
  return out;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / MB).toFixed(2)} MB`;
}

/** Bỏ khóa API khỏi chuỗi JSON getools_ai_settings */
export function stripAiSecrets(raw: string): string {
  const o = safeParse(raw);
  if (!isPlainObject(o)) return raw;
  const c = cleanObject(o);
  c.keys = {};
  return JSON.stringify(c);
}

/** Phần khóa API (`keys`) trong chuỗi JSON getools_ai_settings; {} nếu không có */
export function aiKeysOf(raw: string | null | undefined): Record<string, unknown> {
  const o = safeParse(raw);
  return isPlainObject(o) && isPlainObject(o.keys) ? cleanObject(o.keys) : {};
}

function hasAiSecrets(raw: string | null): boolean {
  const o = safeParse(raw);
  if (!isPlainObject(o) || !isPlainObject(o.keys)) return false;
  return Object.values(o.keys).some((v) => typeof v === 'string' && v.length > 0);
}

/* ---------- thống kê ---------- */

export function countItems(spec: KeySpec, raw: string): number {
  if (spec.kind === 'text') return raw.length > 0 ? 1 : 0;
  const v = safeParse(raw);
  if (Array.isArray(v)) return v.length;
  if (isPlainObject(v)) return Object.keys(v).length;
  return raw.length > 0 ? 1 : 0;
}

export interface GroupSummary {
  group: BackupGroup;
  keys: number;
  items: number;
  bytes: number;
}

export function summarize(storage: StorageLike): Record<BackupGroup, GroupSummary> {
  const res: Record<BackupGroup, GroupSummary> = {
    settings: { group: 'settings', keys: 0, items: 0, bytes: 0 },
    data: { group: 'data', keys: 0, items: 0, bytes: 0 },
    secrets: { group: 'secrets', keys: 0, items: 0, bytes: 0 },
  };
  for (const spec of BACKUP_KEYS) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(spec.key);
    } catch {
      raw = null;
    }
    if (raw == null) continue;
    const g = res[spec.group];
    if (spec.key === AI_SETTINGS_KEY) {
      const stripped = stripAiSecrets(raw);
      g.keys++;
      g.items += countItems(spec, stripped);
      g.bytes += byteLength(stripped);
      if (hasAiSecrets(raw)) {
        const s = res.secrets;
        s.keys++;
        s.items += Object.values((safeParse(raw) as { keys: Record<string, unknown> }).keys).filter(Boolean).length;
        s.bytes += byteLength(raw) - byteLength(stripped);
      }
      continue;
    }
    g.keys++;
    g.items += countItems(spec, raw);
    g.bytes += byteLength(raw);
  }
  return res;
}

/* ---------- xuất ---------- */

export interface ExportOptions {
  settings: boolean;
  data: boolean;
  secrets: boolean;
}

export function buildBackup(storage: StorageLike, opts: ExportOptions, now: Date = new Date()): BackupFile {
  const entries: Record<string, string> = Object.create(null);
  for (const spec of BACKUP_KEYS) {
    if (spec.key === AI_SETTINGS_KEY ? !(opts.settings || opts.secrets) : !opts[spec.group]) continue;
    let raw: string | null = null;
    try {
      raw = storage.getItem(spec.key);
    } catch {
      raw = null;
    }
    if (raw == null) continue;
    if (spec.key === AI_SETTINGS_KEY) {
      if (opts.settings) entries[spec.key] = opts.secrets ? raw : stripAiSecrets(raw);
      else if (opts.secrets && hasAiSecrets(raw)) {
        // chỉ chọn khóa: xuất cấu hình AI nhưng chỉ giữ phần khóa
        const o = safeParse(raw) as Record<string, unknown>;
        entries[spec.key] = JSON.stringify({ keys: isPlainObject(o) ? o.keys : {} });
      }
      continue;
    }
    entries[spec.key] = raw;
  }
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    includesSecrets: opts.secrets,
    entries: { ...entries },
  };
}

export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `getools-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/* ---------- kiểm tra khi nhập ---------- */

export type ParseResult =
  | { ok: true; backup: BackupFile; ignoredKeys: string[] }
  | { ok: false; error: string };

function validateValue(spec: KeySpec, v: string): string | null {
  if (v.length > spec.maxChars) return `Giá trị "${spec.key}" quá lớn (tối đa ${formatBytes(spec.maxChars)}).`;
  switch (spec.kind) {
    case 'text':
      return null;
    case 'theme':
      return v === 'light' || v === 'dark' || v === 'system' ? null : `Giá trị "${spec.key}" không hợp lệ.`;
    case 'bool':
      return v === 'true' || v === 'false' ? null : `Giá trị "${spec.key}" không hợp lệ.`;
    case 'flag':
      return v === '0' || v === '1' ? null : `Giá trị "${spec.key}" không hợp lệ.`;
    case 'array':
      return Array.isArray(safeParse(v)) ? null : `"${spec.key}" phải là một mảng JSON.`;
    case 'object':
      return isPlainObject(safeParse(v)) ? null : `"${spec.key}" phải là một đối tượng JSON.`;
    case 'json': {
      const p = safeParse(v);
      return Array.isArray(p) || isPlainObject(p) ? null : `"${spec.key}" phải là JSON hợp lệ.`;
    }
  }
}

export function parseBackup(text: string): ParseResult {
  if (typeof text !== 'string') return { ok: false, error: 'Dữ liệu không hợp lệ.' };
  if (text.length > MAX_BACKUP_FILE_BYTES) return { ok: false, error: 'Tệp quá lớn (tối đa 10MB).' };
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Tệp không phải JSON hợp lệ.' };
  }
  if (!isPlainObject(root)) return { ok: false, error: 'Cấu trúc tệp không hợp lệ.' };
  if (root.app !== BACKUP_APP) return { ok: false, error: 'Đây không phải tệp sao lưu của Getools.' };
  if (typeof root.version !== 'number' || !Number.isInteger(root.version) || root.version < 1) {
    return { ok: false, error: 'Thiếu hoặc sai phiên bản tệp sao lưu.' };
  }
  if (root.version > BACKUP_VERSION) {
    return { ok: false, error: `Phiên bản sao lưu (${root.version}) mới hơn phiên bản ứng dụng hỗ trợ.` };
  }
  if (!isPlainObject(root.entries)) return { ok: false, error: 'Thiếu mục "entries" trong tệp.' };
  const entries: Record<string, string> = Object.create(null);
  const ignored: string[] = [];
  for (const k of Object.keys(root.entries)) {
    const spec = getKeySpec(k);
    if (!spec) {
      ignored.push(k);
      continue;
    }
    const v = root.entries[k];
    if (typeof v !== 'string') return { ok: false, error: `Giá trị của "${k}" phải là chuỗi.` };
    const err = validateValue(spec, v);
    if (err) return { ok: false, error: err };
    entries[k] = v;
  }
  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      version: root.version,
      exportedAt: typeof root.exportedAt === 'string' ? root.exportedAt.slice(0, 40) : '',
      includesSecrets: root.includesSecrets === true,
      entries: { ...entries },
    },
    ignoredKeys: ignored.slice(0, 20),
  };
}

/* ---------- gộp ---------- */

export type ImportMode = 'merge' | 'replace';

function itemId(x: unknown): string | null {
  if (isPlainObject(x)) {
    if (typeof x.id === 'string' || typeof x.id === 'number') return `id:${String(x.id)}`;
    if (typeof x.url === 'string') return `url:${x.url}`;
  }
  if (typeof x === 'string') return `s:${x}`;
  return null;
}

function mergeById(existing: unknown[], incoming: unknown[], cap: number, sortDesc: boolean): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  // dữ liệu nhập ưu tiên khi trùng id
  for (const x of [...incoming, ...existing]) {
    const id = itemId(x) ?? `j:${JSON.stringify(x)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(x);
  }
  if (sortDesc) {
    out.sort((a, b) => {
      const ta = isPlainObject(a) && typeof a.timestamp === 'number' ? a.timestamp : 0;
      const tb = isPlainObject(b) && typeof b.timestamp === 'number' ? b.timestamp : 0;
      return tb - ta;
    });
  }
  return out.slice(0, cap);
}

function mergeObjects(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = cleanObject(a);
  for (const k of Object.keys(b)) {
    if (BAD_KEYS.has(k)) continue;
    const av = out[k];
    const bv = b[k];
    out[k] = isPlainObject(av) && isPlainObject(bv) ? mergeObjects(av, bv) : bv;
  }
  return out;
}

/** Tính giá trị mới của một khóa khi nhập (chưa ghi). */
export function mergeValue(spec: KeySpec, existing: string | null, incoming: string, mode: ImportMode): string {
  if (mode === 'replace' || existing == null) return incoming;
  const e = safeParse(existing);
  const i = safeParse(incoming);
  switch (spec.key) {
    case 'getools_favorite_tools':
    case 'getools_recent_tools': {
      if (!Array.isArray(e) || !Array.isArray(i)) return incoming;
      const strs = (a: unknown[]) => a.filter((x): x is string => typeof x === 'string');
      const cap = spec.key === 'getools_recent_tools' ? 8 : 500;
      return JSON.stringify([...new Set([...strs(e), ...strs(i)])].slice(0, cap));
    }
    case 'git_downloader_history':
      if (Array.isArray(e) && Array.isArray(i)) return JSON.stringify(mergeById(e, i, 50, true));
      return incoming;
    case 'git_downloader_bookmarks':
      if (Array.isArray(e) && Array.isArray(i)) return JSON.stringify(mergeById(e, i, 1000, true));
      return incoming;
    case 'git_downloader_tts_history_v1':
    case 'git_downloader_stt_history_v1':
      if (Array.isArray(e) && Array.isArray(i)) return JSON.stringify(mergeById(e, i, 50, true));
      return incoming;
    case 'getools_checklists':
      if (Array.isArray(e) && Array.isArray(i)) return JSON.stringify(mergeById(e, i, 500, false));
      return incoming;
    case 'getools_snippets':
      if (Array.isArray(e) && Array.isArray(i)) return JSON.stringify(mergeById(e, i, 5000, false));
      if (isPlainObject(e) && isPlainObject(i)) return JSON.stringify(mergeObjects(e, i));
      return incoming;
  }
  if (spec.kind === 'object' || spec.kind === 'json') {
    if (isPlainObject(e) && isPlainObject(i)) return JSON.stringify(mergeObjects(e, i));
  }
  return incoming; // chuỗi đơn giản / bản nháp: giá trị nhập ghi đè
}

/* ---------- kế hoạch & áp dụng ---------- */

export interface ImportOptions {
  mode: ImportMode;
  settings: boolean;
  data: boolean;
  secrets: boolean;
}

export type ChangeStatus = 'added' | 'overwritten' | 'unchanged';

export interface PlanItem {
  key: string;
  group: BackupGroup;
  label: string;
  status: ChangeStatus;
  /** Giá trị sẽ ghi */
  next: string;
}

export interface ImportPlan {
  items: PlanItem[];
  counts: Record<BackupGroup, Record<ChangeStatus, number>>;
}

function readSafe(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function planImport(storage: StorageLike, backup: BackupFile, opts: ImportOptions): ImportPlan {
  const items: PlanItem[] = [];
  const counts = {} as ImportPlan['counts'];
  for (const g of ['settings', 'data', 'secrets'] as BackupGroup[]) counts[g] = { added: 0, overwritten: 0, unchanged: 0 };
  for (const spec of BACKUP_KEYS) {
    const incomingRaw = backup.entries[spec.key];
    if (typeof incomingRaw !== 'string') continue;
    const existing = readSafe(storage, spec.key);
    let incoming = incomingRaw;
    let group = spec.group;
    if (spec.key === AI_SETTINGS_KEY) {
      // cấu hình AI thuộc "cài đặt"; khóa bên trong thuộc "khóa API"
      const parsed = safeParse(incomingRaw);
      const inSecrets = isPlainObject(parsed) && isPlainObject(parsed.keys) ? cleanObject(parsed.keys) : {};
      const cur = safeParse(existing);
      const curKeys = isPlainObject(cur) && isPlainObject(cur.keys) ? cleanObject(cur.keys) : {};
      const base = isPlainObject(parsed) ? cleanObject(parsed) : {};
      if (!opts.secrets) {
        base.keys = curKeys; // giữ nguyên khóa hiện có
      } else if (opts.mode === 'merge') {
        base.keys = { ...curKeys, ...inSecrets };
      } else {
        base.keys = inSecrets;
      }
      if (!opts.settings) {
        if (!opts.secrets) continue;
        // chỉ áp dụng khóa
        const merged = isPlainObject(cur) ? cleanObject(cur) : {};
        merged.keys = base.keys;
        incoming = JSON.stringify(merged);
        group = 'secrets';
      } else {
        incoming = JSON.stringify(base);
      }
      const next = opts.settings ? mergeValue(spec, existing, incoming, opts.mode) : incoming;
      // mergeValue gộp lại đối tượng; cần đảm bảo phần khóa đúng như đã tính
      const final = fixAiKeys(next, base.keys as Record<string, unknown>);
      pushItem(items, counts, spec, group, existing, final);
      continue;
    }
    if (spec.group === 'secrets' ? !opts.secrets : !opts[spec.group]) continue;
    pushItem(items, counts, spec, group, existing, mergeValue(spec, existing, incoming, opts.mode));
  }
  return { items, counts };
}

/** Thay phần khóa API trong chuỗi JSON getools_ai_settings */
export function fixAiKeys(next: string, keys: Record<string, unknown>): string {
  const o = safeParse(next);
  if (!isPlainObject(o)) return next;
  const c = cleanObject(o);
  c.keys = keys;
  return JSON.stringify(c);
}

function pushItem(
  items: PlanItem[],
  counts: ImportPlan['counts'],
  spec: KeySpec,
  group: BackupGroup,
  existing: string | null,
  next: string,
) {
  const status: ChangeStatus = existing == null ? 'added' : existing === next ? 'unchanged' : 'overwritten';
  counts[group][status]++;
  items.push({ key: spec.key, group, label: spec.label, status, next });
}

/** Ảnh chụp giá trị trước đó (null = chưa có khóa) để hoàn tác */
export type UndoSnapshot = Record<string, string | null>;

export function applyPlan(storage: StorageLike, plan: ImportPlan): { undo: UndoSnapshot; written: number; failed: string[] } {
  const undo: UndoSnapshot = Object.create(null);
  const failed: string[] = [];
  let written = 0;
  for (const it of plan.items) {
    if (it.status === 'unchanged') continue;
    if (!getKeySpec(it.key)) continue; // phòng thủ: không bao giờ ghi ngoài whitelist
    undo[it.key] = readSafe(storage, it.key);
    try {
      storage.setItem(it.key, it.next);
      written++;
    } catch {
      failed.push(it.key);
      delete undo[it.key];
    }
  }
  return { undo: { ...undo }, written, failed };
}

export function applyUndo(storage: StorageLike, undo: UndoSnapshot): number {
  let n = 0;
  for (const key of Object.keys(undo)) {
    if (!getKeySpec(key)) continue;
    try {
      const v = undo[key];
      if (v == null) storage.removeItem(key);
      else storage.setItem(key, v);
      n++;
    } catch {
      /* bỏ qua */
    }
  }
  return n;
}

/** Xóa dữ liệu không phải bí mật; giữ lại khóa API (kể cả trong cấu hình AI). */
export function clearAppData(storage: StorageLike): { undo: UndoSnapshot; removed: number } {
  const undo: UndoSnapshot = Object.create(null);
  let removed = 0;
  for (const spec of BACKUP_KEYS) {
    if (spec.group === 'secrets') continue;
    const raw = readSafe(storage, spec.key);
    if (raw == null) continue;
    undo[spec.key] = raw;
    try {
      if (spec.key === AI_SETTINGS_KEY && hasAiSecrets(raw)) {
        const o = safeParse(raw) as Record<string, unknown>;
        storage.setItem(spec.key, JSON.stringify({ keys: o.keys }));
      } else {
        storage.removeItem(spec.key);
      }
      removed++;
    } catch {
      /* bỏ qua */
    }
  }
  return { undo: { ...undo }, removed };
}
