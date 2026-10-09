/**
 * Google Drive cho trình duyệt: đăng nhập bằng Google Identity Services (token model, không cần backend giữ bí mật)
 * và gọi Drive REST API v3 trong thư mục ẩn `appDataFolder` của ứng dụng.
 *
 * Scope `drive.appdata` (không nhạy cảm): ứng dụng CHỈ thấy dữ liệu do chính nó tạo trong thư mục ẩn,
 * không đọc được bất kỳ file nào khác trong Drive của người dùng.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const SYNC_FILE_NAME = 'getools-sync.json';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

/* ---------- Kiểu tối thiểu của Google Identity Services ---------- */

interface TokenResponse {
  access_token: string;
  expires_in: number | string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type: string; message?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(resp: TokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

/** Lỗi xác thực (token hết hạn / bị thu hồi): cần kết nối lại */
export class DriveAuthError extends Error {
  constructor(message = 'Phiên Google đã hết hạn, hãy kết nối lại.') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

/* ---------- Cấu hình (client ID đọc lúc chạy từ máy chủ) ---------- */

let clientIdPromise: Promise<string | null> | null = null;

/**
 * Client ID OAuth của ứng dụng (biến môi trường GOOGLE_CLIENT_ID trên máy chủ).
 * null = máy chủ trả lời được nhưng chưa đặt biến; lỗi = không đọc được cấu hình (route lỗi / mất mạng),
 * tách riêng để không báo nhầm "chưa cấu hình".
 */
export function getClientId(): Promise<string | null> {
  clientIdPromise ??= fetch('/api/drive/config', { cache: 'no-store' })
    .catch(() => {
      throw new Error('Không kết nối được máy chủ để đọc cấu hình Google Drive (mất mạng?).');
    })
    .then(async (r) => {
      if (!r.ok) throw new Error(`Không đọc được cấu hình Google Drive: /api/drive/config trả về lỗi ${r.status}.`);
      const j = (await r.json()) as { clientId?: string | null };
      return j.clientId || null;
    })
    .catch((e: Error) => {
      clientIdPromise = null; // lần sau thử lại
      throw e;
    });
  return clientIdPromise;
}

/* ---------- Nạp thư viện đăng nhập ---------- */

let gisPromise: Promise<GoogleOAuth2> | null = null;

export function loadGis(): Promise<GoogleOAuth2> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  gisPromise ??= new Promise<GoogleOAuth2>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google.accounts.oauth2) : reject(new Error('Không nạp được Google Identity Services.')));
    s.onerror = () => {
      gisPromise = null;
      s.remove();
      reject(new Error('Không tải được thư viện đăng nhập Google (mạng bị chặn?).'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/* ---------- Token ---------- */

export interface DriveToken {
  accessToken: string;
  /** Mốc hết hạn (ms) */
  expiresAt: number;
}

let tokenClient: TokenClient | null = null;
let tokenClientId = '';
let pending: { resolve: (t: DriveToken) => void; reject: (e: Error) => void } | null = null;

/**
 * Mở cửa sổ đăng nhập / cấp quyền của Google. PHẢI gọi trực tiếp trong sự kiện click (không await gì trước đó),
 * nếu không trình duyệt sẽ chặn popup — vì vậy cần `loadGis()` và `getClientId()` xong từ trước.
 */
export function requestToken(gis: GoogleOAuth2, clientId: string, loginHint?: string): Promise<DriveToken> {
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClientId = clientId;
    tokenClient = gis.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        const p = pending;
        pending = null;
        if (!p) return;
        if (resp.error) return p.reject(new Error(resp.error_description || resp.error));
        if (!gis.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
          return p.reject(new Error('Bạn chưa tích quyền "dữ liệu cấu hình của ứng dụng trong Google Drive".'));
        }
        // trừ hao 60 giây để không dùng token sát giờ hết hạn
        p.resolve({ accessToken: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) - 60) * 1000 });
      },
      error_callback: (err) => {
        const p = pending;
        pending = null;
        p?.reject(new Error(err.type === 'popup_closed' ? 'Đã đóng cửa sổ đăng nhập.' : err.type === 'popup_failed_to_open' ? 'Trình duyệt chặn cửa sổ đăng nhập — hãy cho phép popup.' : err.message || 'Đăng nhập Google thất bại.'));
      },
    });
  }
  pending?.reject(new Error('Đã hủy yêu cầu trước.'));
  return new Promise<DriveToken>((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient!.requestAccessToken({ prompt: '', login_hint: loginHint });
  });
}

export function revokeToken(gis: GoogleOAuth2 | undefined, accessToken: string): Promise<void> {
  return new Promise((resolve) => {
    if (!gis) return resolve();
    try {
      gis.revoke(accessToken, () => resolve());
    } catch {
      resolve();
    }
  });
}

/* ---------- Drive REST ---------- */

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Không kết nối được Google Drive (mất mạng?).');
  }
  if (res.status === 401) throw new DriveAuthError();
  if (!res.ok) {
    let msg = `Google Drive trả về lỗi ${res.status}.`;
    try {
      const j = await res.json();
      if (j?.error?.message) msg += ` ${j.error.message}`;
    } catch {
      /* không có thân JSON */
    }
    if (res.status === 403 && /has not been used|is disabled/i.test(msg)) {
      msg = 'Google Drive API chưa được bật cho dự án Google Cloud của ứng dụng (xem hướng dẫn cài đặt).';
    }
    throw new Error(msg);
  }
  return res;
}

export interface DriveFileMeta {
  id: string;
  modifiedTime: string;
  size?: string;
}

/** File đồng bộ trong appDataFolder (mới sửa gần nhất nếu lỡ có nhiều bản) */
export async function findSyncFile(token: string): Promise<DriveFileMeta | null> {
  const q = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${SYNC_FILE_NAME}' and trashed = false`,
    orderBy: 'modifiedTime desc',
    fields: 'files(id,modifiedTime,size)',
    pageSize: '10',
  });
  const res = await call(token, `${API}/files?${q}`);
  const j = (await res.json()) as { files?: DriveFileMeta[] };
  return j.files?.[0] ?? null;
}

export async function downloadFile(token: string, id: string): Promise<string> {
  const res = await call(token, `${API}/files/${encodeURIComponent(id)}?alt=media`);
  return res.text();
}

/** Tạo mới (id = null) hoặc ghi đè nội dung file đồng bộ; trả về metadata mới */
export async function uploadSyncFile(token: string, id: string | null, content: string): Promise<DriveFileMeta> {
  const fields = 'id,modifiedTime,size';
  if (id) {
    const res = await call(token, `${UPLOAD_API}/files/${encodeURIComponent(id)}?uploadType=media&fields=${fields}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: content,
    });
    return res.json();
  }
  const boundary = `getools-${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: SYNC_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  const res = await call(token, `${UPLOAD_API}/files?uploadType=multipart&fields=${fields}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.json();
}

export async function deleteFile(token: string, id: string): Promise<void> {
  await call(token, `${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Email tài khoản Google đang kết nối (để hiển thị); null nếu không lấy được */
export async function getAccountEmail(token: string): Promise<string | null> {
  try {
    const res = await call(token, `${API}/about?fields=user(emailAddress)`);
    const j = (await res.json()) as { user?: { emailAddress?: string } };
    return j.user?.emailAddress ?? null;
  } catch {
    return null;
  }
}
