import { apiFetch } from '@/lib/api-client';

/** Trạng thái khóa AI phía máy chủ (chỉ biết có/không), lấy một lần và dùng chung toàn app. */
let loaded = false;
let geminiOnServer = false;
let started = false;
const listeners = new Set<() => void>();

export function subscribeAiServerStatus(cb: () => void) {
  listeners.add(cb);
  if (!started && typeof window !== 'undefined') {
    started = true;
    apiFetch('/api/ai/status')
      .then((r) => (r.ok ? r.json() : { gemini: false }))
      .then((d: { gemini?: boolean }) => {
        geminiOnServer = !!d.gemini;
      })
      .catch(() => {
        geminiOnServer = false;
      })
      .finally(() => {
        loaded = true;
        listeners.forEach((l) => l());
      });
  }
  return () => {
    listeners.delete(cb);
  };
}

export const getAiServerStatusSnapshot = () => (loaded ? (geminiOnServer ? 'server-gemini' : 'none') : 'loading');
export const getAiServerStatusServerSnapshot = () => 'loading';
