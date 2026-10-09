/**
 * Điều phối đồng bộ Google Drive phía trình duyệt: giữ trạng thái (dùng với useSyncExternalStore),
 * token đăng nhập, tùy chọn của máy này và chạy một lượt đồng bộ (tải về → gộp 3 chiều → ghi máy → tải lên).
 */
import { notifyStorageSync, subscribeStorageSync } from '@/lib/storage';
import { parseBackup, type StorageLike } from '@/lib/backup';
import { applyLocalWrites, hasLocalChanges, planSync, type SyncBase, type SyncDirection } from '@/lib/drive-sync';
import {
  DriveAuthError,
  deleteFile,
  downloadFile,
  findSyncFile,
  getAccountEmail,
  getClientId,
  loadGis,
  requestToken,
  revokeToken,
  uploadSyncFile,
  type DriveToken,
} from '@/lib/google-drive';

/** Thiết lập riêng của máy này — KHÔNG nằm trong dữ liệu sao lưu/đồng bộ */
const PREFS_KEY = 'getools_drive_sync';
/** Token chỉ sống ~1 giờ; để ở sessionStorage cho tải lại trang không phải đăng nhập lại */
const TOKEN_KEY = 'getools_drive_token';

interface Prefs {
  connected: boolean;
  email: string | null;
  fileId: string | null;
  base: SyncBase;
  lastSyncAt: string | null;
  includeSecrets: boolean;
  auto: boolean;
}

const DEFAULT_PREFS: Prefs = { connected: false, email: null, fileId: null, base: {}, lastSyncAt: null, includeSecrets: false, auto: true };

export interface DriveSyncState extends Prefs {
  /** 'loading' = đang nạp cấu hình; 'unconfigured' = máy chủ chưa đặt GOOGLE_CLIENT_ID */
  setup: 'loading' | 'ready' | 'unconfigured' | 'error';
  setupError: string | null;
  status: 'idle' | 'authorizing' | 'syncing';
  /** Đã kết nối nhưng token hết hạn: cần bấm kết nối lại (không tự mở popup) */
  needsAuth: boolean;
  error: string | null;
  lastResult: { direction: SyncDirection; pulled: number; pushed: number } | null;
  canUndo: boolean;
}

/* ---------- lưu trữ ---------- */

function storage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (!p || typeof p !== 'object') return DEFAULT_PREFS;
    return {
      connected: p.connected === true,
      email: typeof p.email === 'string' ? p.email : null,
      fileId: typeof p.fileId === 'string' ? p.fileId : null,
      base: p.base && typeof p.base === 'object' && !Array.isArray(p.base) ? p.base : {},
      lastSyncAt: typeof p.lastSyncAt === 'string' ? p.lastSyncAt : null,
      includeSecrets: p.includeSecrets === true,
      auto: p.auto !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* bị chặn / đầy bộ nhớ */
  }
}

function readToken(): DriveToken | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    return t && typeof t.accessToken === 'string' && typeof t.expiresAt === 'number' && t.expiresAt > Date.now() ? t : null;
  } catch {
    return null;
  }
}

function writeToken(t: DriveToken | null) {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* bỏ qua */
  }
}

/* ---------- store ---------- */

const SERVER_STATE: DriveSyncState = {
  ...DEFAULT_PREFS,
  setup: 'loading',
  setupError: null,
  status: 'idle',
  needsAuth: false,
  error: null,
  lastResult: null,
  canUndo: false,
};

let state: DriveSyncState = SERVER_STATE;
let initialized = false;
const listeners = new Set<() => void>();
let undoSnapshot: Record<string, string | null> | null = null;
let gis: Awaited<ReturnType<typeof loadGis>> | undefined;
let clientId: string | null = null;

function set(patch: Partial<DriveSyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function setPrefs(patch: Partial<Prefs>) {
  const next: Prefs = { ...pickPrefs(state), ...patch };
  writePrefs(next);
  set(next);
}

function pickPrefs(s: DriveSyncState): Prefs {
  const { connected, email, fileId, base, lastSyncAt, includeSecrets, auto } = s;
  return { connected, email, fileId, base, lastSyncAt, includeSecrets, auto };
}

export function subscribeDriveSync(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const getDriveSyncSnapshot = () => state;
export const getServerDriveSyncSnapshot = () => SERVER_STATE;

/** Nạp tùy chọn đã lưu + cấu hình + thư viện Google (gọi sớm để nút "Kết nối" mở popup ngay khi bấm). */
export function initDriveSync() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const prefs = readPrefs();
  set({ ...prefs, needsAuth: prefs.connected && !readToken() });
  getClientId()
    .then(async (id) => {
      clientId = id;
      if (!id) return set({ setup: 'unconfigured' });
      gis = await loadGis();
      set({ setup: 'ready', setupError: null });
    })
    .catch((e: Error) => set({ setup: 'error', setupError: e.message }));
}

/* ---------- đăng nhập ---------- */

function validToken(): DriveToken | null {
  return readToken();
}

/** Mở popup Google (gọi đồng bộ trong sự kiện click) */
function authorize(): Promise<DriveToken> {
  if (!gis || !clientId) return Promise.reject(new Error('Google Drive chưa sẵn sàng, thử lại sau giây lát.'));
  set({ status: 'authorizing', error: null });
  return requestToken(gis, clientId, state.email ?? undefined).then(
    (t) => {
      writeToken(t);
      set({ status: 'idle', needsAuth: false });
      return t;
    },
    (e: Error) => {
      set({ status: 'idle', error: e.message });
      throw e;
    },
  );
}

/** Token hợp lệ, hoặc mở popup đăng nhập (chỉ dùng trong sự kiện click) */
function tokenInteractive(): Promise<DriveToken> {
  const t = validToken();
  return t ? Promise.resolve(t) : authorize();
}

/* ---------- đồng bộ ---------- */

let running: Promise<void> | null = null;

async function runSync(token: DriveToken, direction: SyncDirection, silent: boolean): Promise<void> {
  if (running) return running;
  const st = storage();
  if (!st) {
    set({ error: 'Không truy cập được bộ nhớ trình duyệt.' });
    return;
  }
  running = (async () => {
    set({ status: 'syncing', error: null });
    try {
      const file = await findSyncFile(token.accessToken);
      let remote = null;
      if (file) {
        const parsed = parseBackup(await downloadFile(token.accessToken, file.id));
        if (!parsed.ok) throw new Error(`Bản trên Drive không hợp lệ: ${parsed.error}`);
        remote = parsed.backup;
      }
      if (direction === 'pull' && !remote) throw new Error('Chưa có dữ liệu nào trên Drive.');
      // File trên Drive đã bị xóa/thay (vd. "Xóa dữ liệu trên Drive" ở máy khác): base cũ không còn đúng
      const base = file && file.id === state.fileId ? state.base : {};

      const plan = planSync(st, remote, base, { includeSecrets: state.includeSecrets, direction });
      const undo = applyLocalWrites(st, plan.localWrites);
      if (Object.keys(undo).length) {
        undoSnapshot = undo;
        notifyStorageSync();
      }
      const meta = await uploadSyncFile(token.accessToken, file?.id ?? null, JSON.stringify(plan.upload));
      setPrefs({ fileId: meta.id, base: plan.base, lastSyncAt: new Date().toISOString() });
      set({
        status: 'idle',
        lastResult: { direction, pulled: Object.keys(undo).length, pushed: plan.pushed },
        canUndo: !!undoSnapshot,
      });
    } catch (e) {
      if (e instanceof DriveAuthError) {
        writeToken(null);
        set({ status: 'idle', needsAuth: true, error: silent ? null : e.message });
      } else {
        set({ status: 'idle', error: (e as Error).message || 'Đồng bộ thất bại.' });
      }
      if (!silent) throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Kết nối tài khoản Google rồi đồng bộ lần đầu (gọi trong sự kiện click) */
export function connectDrive(): Promise<void> {
  return authorize().then(async (t) => {
    const email = await getAccountEmail(t.accessToken);
    setPrefs({ connected: true, email });
    await runSync(t, 'sync', false);
  });
}

/** Đồng bộ ngay theo hướng chọn (gọi trong sự kiện click: token hết hạn thì mở popup đăng nhập lại) */
export function syncDrive(direction: SyncDirection = 'sync'): Promise<void> {
  return tokenInteractive().then((t) => runSync(t, direction, false));
}

export function setDriveSyncOption(patch: Partial<Pick<Prefs, 'includeSecrets' | 'auto'>>) {
  // đổi phạm vi khóa API thì base cũ không còn so sánh được → lần sau gộp lại toàn bộ
  setPrefs(patch.includeSecrets !== undefined && patch.includeSecrets !== state.includeSecrets ? { ...patch, base: {} } : patch);
}

/** Hoàn tác các thay đổi mà lần đồng bộ gần nhất ghi vào máy này */
export function undoLastDriveSync(): number {
  const st = storage();
  if (!st || !undoSnapshot) return 0;
  const n = Object.keys(applyLocalWrites(st, undoSnapshot)).length;
  undoSnapshot = null;
  notifyStorageSync();
  set({ canUndo: false });
  return n;
}

/** Ngắt kết nối: thu hồi quyền của ứng dụng và quên trạng thái đồng bộ (dữ liệu trên Drive vẫn giữ) */
export async function disconnectDrive(): Promise<void> {
  const t = validToken();
  if (t) await revokeToken(gis, t.accessToken);
  writeToken(null);
  undoSnapshot = null;
  writePrefs({ ...DEFAULT_PREFS, includeSecrets: state.includeSecrets, auto: state.auto });
  set({ ...DEFAULT_PREFS, includeSecrets: state.includeSecrets, auto: state.auto, needsAuth: false, error: null, lastResult: null, canUndo: false });
}

/** Xóa file đồng bộ trên Drive (dữ liệu trên máy giữ nguyên) */
export function deleteDriveData(): Promise<void> {
  return tokenInteractive().then(async (t) => {
    const file = await findSyncFile(t.accessToken);
    if (file) await deleteFile(t.accessToken, file.id);
    setPrefs({ fileId: null, base: {}, lastSyncAt: null });
  });
}

/* ---------- tự động đồng bộ ---------- */

const AUTO_DEBOUNCE_MS = 8_000;
/** Quay lại tab sau ít nhất chừng này thì kéo bản mới từ Drive */
const PULL_INTERVAL_MS = 2 * 60_000;

function autoSync(onlyIfLocalChanges: boolean) {
  if (!state.connected || !state.auto || state.status !== 'idle') return;
  const t = validToken();
  if (!t) {
    if (!state.needsAuth) set({ needsAuth: true });
    return;
  }
  const st = storage();
  if (onlyIfLocalChanges && (!st || !hasLocalChanges(st, state.base, state.includeSecrets))) return;
  if (!onlyIfLocalChanges && state.lastSyncAt && Date.now() - Date.parse(state.lastSyncAt) < PULL_INTERVAL_MS) return;
  void runSync(t, 'sync', true);
}

/**
 * Bật tự động đồng bộ trong phiên: dữ liệu đổi → đẩy lên (sau vài giây), quay lại tab → kéo về.
 * Không bao giờ tự mở popup: token hết hạn thì chỉ báo "cần kết nối lại".
 */
export function startDriveAutoSync(): () => void {
  // Chưa từng kết nối thì không nạp thư viện Google lúc mở app (thẻ Cài đặt sẽ tự nạp khi cần)
  if (readPrefs().connected) initDriveSync();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => autoSync(true), AUTO_DEBOUNCE_MS);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') autoSync(false);
  };
  const unsub = subscribeStorageSync(onChange);
  document.addEventListener('visibilitychange', onVisible);
  autoSync(false);
  return () => {
    clearTimeout(timer);
    unsub();
    document.removeEventListener('visibilitychange', onVisible);
  };
}
