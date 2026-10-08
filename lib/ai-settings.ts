/**
 * Lưu cấu hình AI của người dùng trong localStorage (chỉ trên trình duyệt này).
 * Khóa Gemini dùng chung kho `git_downloader_keys` (đã có, TTS cũng dùng); các nhà cung cấp khác lưu ở đây.
 */
import { subscribeStorageSync, notifyStorageSync } from '@/lib/storage';
import { AI_PROVIDERS, AiProvider, isAiProvider } from '@/lib/ai-providers';

const STORAGE_KEY = 'getools_ai_settings';

export interface AiSettings {
  provider: AiProvider;
  /** Khóa của openai / anthropic / custom (gemini nằm ở kho khóa chung) */
  keys: Partial<Record<AiProvider, string>>;
  models: Partial<Record<AiProvider, string>>;
  customBaseUrl: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'gemini',
  keys: {},
  models: {},
  customBaseUrl: '',
};

export const AI_SETTINGS_SERVER_SNAPSHOT = JSON.stringify(DEFAULT_AI_SETTINGS);

export function getAiSettingsSnapshot(): string {
  if (typeof window === 'undefined') return AI_SETTINGS_SERVER_SNAPSHOT;
  try {
    return localStorage.getItem(STORAGE_KEY) || AI_SETTINGS_SERVER_SNAPSHOT;
  } catch {
    return AI_SETTINGS_SERVER_SNAPSHOT;
  }
}

export const subscribeAiSettings = subscribeStorageSync;

export function parseAiSettings(raw: string): AiSettings {
  try {
    const o = JSON.parse(raw) as Partial<AiSettings>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const pick = (src: unknown) => {
      const out: Partial<Record<AiProvider, string>> = {};
      if (src && typeof src === 'object') {
        for (const p of AI_PROVIDERS) {
          const v = (src as Record<string, unknown>)[p];
          if (typeof v === 'string' && v) out[p] = v;
        }
      }
      return out;
    };
    return {
      provider: isAiProvider(o.provider) ? o.provider : 'gemini',
      keys: pick(o.keys),
      models: pick(o.models),
      customBaseUrl: str(o.customBaseUrl),
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function saveAiSettings(next: AiSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* bỏ qua: không ghi được localStorage */
  }
  notifyStorageSync();
}
