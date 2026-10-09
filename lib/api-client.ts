/**
 * Gọi API nội bộ của GeTools từ trình duyệt. Mọi request tới /api/* phải đi qua đây: header nhận diện
 * khiến trình duyệt chặn trang web khác gọi sang (CORS preflight thất bại), và route từ chối request
 * không có header (vd. mở thẳng URL trên thanh địa chỉ) — xem lib/api-guard.ts.
 */
export const API_CLIENT_HEADER = 'x-getools-client';

export function apiFetch(path: `/api/${string}`, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(API_CLIENT_HEADER, '1');
  return fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
}
