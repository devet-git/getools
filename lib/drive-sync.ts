/**
 * Đồng bộ 3 chiều giữa dữ liệu trên máy (localStorage) và bản trên Google Drive — logic thuần, không gọi mạng.
 *
 * Mỗi máy nhớ "bản gốc" (base) = dấu vân tay (hash) của từng khóa ở lần đồng bộ thành công gần nhất.
 * Với mỗi khóa trong whitelist sao lưu:
 *   - chỉ máy này đổi so với base   → giữ bản trên máy (kể cả khi đã xóa)
 *   - chỉ Drive đổi so với base     → lấy bản Drive
 *   - cả hai cùng đổi (hoặc lần đầu) → gộp như "Khôi phục → Gộp" (snippet theo id, lịch sử loại trùng...)
 * Nhờ vậy xóa / sửa ở một máy được lan sang máy khác thay vì bị bản cũ "hồi sinh".
 */
import {
  AI_SETTINGS_KEY,
  BACKUP_APP,
  BACKUP_KEYS,
  BACKUP_VERSION,
  aiKeysOf,
  fixAiKeys,
  mergeValue,
  stripAiSecrets,
  type BackupFile,
  type StorageLike,
} from '@/lib/backup';

/** Hash 53-bit (cyrb53) — đủ để so sánh nội dung, không dùng cho mục đích bảo mật */
export function hashValue(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const h = (v: string | null | undefined) => (v == null ? null : hashValue(v));

/** Base: { [khóa]: hash } ở lần đồng bộ gần nhất; khóa vắng mặt = lúc đó không có giá trị */
export type SyncBase = Record<string, string>;

export type SyncDirection = 'sync' | 'push' | 'pull';

export interface SyncPlan {
  /** Giá trị cần ghi vào máy này (null = xóa khóa) */
  localWrites: Record<string, string | null>;
  /** Nội dung tải lên Drive */
  upload: BackupFile;
  /** Base mới, lưu lại sau khi tải lên thành công */
  base: SyncBase;
  /** Số khóa lấy từ Drive / đẩy lên Drive (để báo cho người dùng) */
  pulled: number;
  pushed: number;
}

function read(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Tính kết quả đồng bộ.
 * - `direction`: 'sync' = 3 chiều; 'push' = Drive lấy y nguyên máy này; 'pull' = máy này lấy y nguyên Drive.
 * - `includeSecrets`: false thì không đọc/ghi khóa API của máy này, nhưng GIỮ NGUYÊN khóa đang có trên Drive
 *   (do máy khác đồng bộ lên) để không xóa mất của máy đó.
 */
export function planSync(
  storage: StorageLike,
  remote: BackupFile | null,
  base: SyncBase,
  opts: { includeSecrets: boolean; direction: SyncDirection },
  now: Date = new Date(),
): SyncPlan {
  const { includeSecrets, direction } = opts;
  const localWrites: Record<string, string | null> = {};
  const uploadEntries: Record<string, string> = {};
  const nextBase: SyncBase = {};
  let pulled = 0;
  let pushed = 0;
  const remoteEntries = remote?.entries ?? {};

  for (const spec of BACKUP_KEYS) {
    const key = spec.key;
    const remoteRaw: string | null = typeof remoteEntries[key] === 'string' ? remoteEntries[key] : null;

    // Khóa bí mật thuần (token Git): không đồng bộ thì chỉ chuyển tiếp bản trên Drive
    if (spec.group === 'secrets' && !includeSecrets) {
      if (remoteRaw != null) uploadEntries[key] = remoteRaw;
      continue;
    }

    const rawLocal = read(storage, key);
    // Cấu hình AI khi không đồng bộ khóa: so sánh/đồng bộ phần cấu hình, khóa của máy nào giữ của máy đó
    const stripAi = key === AI_SETTINGS_KEY && !includeSecrets;
    const local = stripAi && rawLocal != null ? stripAiSecrets(rawLocal) : rawLocal;
    const remoteVal = stripAi && remoteRaw != null ? stripAiSecrets(remoteRaw) : remoteRaw;

    const hl = h(local);
    const hr = h(remoteVal);
    const hb = base[key] ?? null;

    let result: string | null;
    if (direction === 'push') result = local;
    else if (direction === 'pull') result = remoteVal;
    else if (hl === hr) result = local;
    else if (hr === hb) result = local; // chỉ máy này đổi
    else if (hl === hb) result = remoteVal; // chỉ Drive đổi
    else if (local == null) result = remoteVal; // lần đầu / xung đột: bên nào có thì lấy
    else if (remoteVal == null) result = local;
    else result = mergeValue(spec, local, remoteVal, 'merge');

    if (h(result) !== hl) {
      localWrites[key] = result == null ? null : stripAi ? fixAiKeys(result, aiKeysOf(rawLocal)) : result;
      pulled++;
    }
    if (h(result) !== hr) pushed++;

    if (result != null) {
      uploadEntries[key] = stripAi ? fixAiKeys(result, aiKeysOf(remoteRaw)) : result;
      nextBase[key] = hashValue(result);
    }
  }

  return {
    localWrites,
    upload: {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: now.toISOString(),
      includesSecrets: includeSecrets || !!remote?.includesSecrets,
      entries: uploadEntries,
    },
    base: nextBase,
    pulled,
    pushed,
  };
}

/** Có thay đổi trên máy này kể từ lần đồng bộ trước không (để tự động đồng bộ khỏi gọi mạng thừa). */
export function hasLocalChanges(storage: StorageLike, base: SyncBase, includeSecrets: boolean): boolean {
  for (const spec of BACKUP_KEYS) {
    if (spec.group === 'secrets' && !includeSecrets) continue;
    const raw = read(storage, spec.key);
    const v = spec.key === AI_SETTINGS_KEY && !includeSecrets && raw != null ? stripAiSecrets(raw) : raw;
    if (h(v) !== (base[spec.key] ?? null)) return true;
  }
  return false;
}

/** Ghi kết quả vào máy; trả về ảnh chụp giá trị cũ để hoàn tác. */
export function applyLocalWrites(storage: StorageLike, writes: Record<string, string | null>): Record<string, string | null> {
  const undo: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(writes)) {
    if (!BACKUP_KEYS.some((s) => s.key === key)) continue; // phòng thủ: chỉ ghi khóa trong whitelist
    undo[key] = read(storage, key);
    try {
      if (value == null) storage.removeItem(key);
      else storage.setItem(key, value);
    } catch {
      delete undo[key];
    }
  }
  return undo;
}
