/**
 * Trạng thái "đang chuyển trang": ai bắt đầu điều hướng (click link, router.push) gọi `beginNavigation`,
 * thanh tiến trình và màn hình tải đọc trang đích qua `getPendingPath` để hiện hiệu ứng / tên công cụ.
 */

let pendingPath: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Bắt đầu chuyển sang `href`; bỏ qua link ra ngoài, link tải file, hoặc chỉ đổi query/hash trên cùng trang. */
export function beginNavigation(href: string) {
  if (typeof window === 'undefined') return;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return;
  }
  if (!/^https?:$/.test(url.protocol) || url.origin !== window.location.origin) return;
  if (url.pathname === window.location.pathname || url.pathname === pendingPath) return;
  pendingPath = url.pathname;
  emit();
}

export function endNavigation() {
  if (pendingPath === null) return;
  pendingPath = null;
  emit();
}

export function subscribeNavigation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getPendingPath = () => pendingPath;
export const getServerPendingPath = (): string | null => null;
