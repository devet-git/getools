/**
 * Chia sẻ trạng thái tool qua URL (query string).
 * Dùng cùng `ShareLinkButton`. Chỉ đưa dữ liệu nhỏ (cấu hình, mẫu ngắn) vào link.
 */
const MAX_URL_LENGTH = 6000;

export function readShareParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/** Trả về URL đầy đủ của trang hiện tại kèm tham số; null nếu quá dài. Giá trị rỗng bị bỏ qua. */
export function buildShareUrl(params: Record<string, string | undefined | null>): string | null {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const out = url.toString();
  return out.length > MAX_URL_LENGTH ? null : out;
}
