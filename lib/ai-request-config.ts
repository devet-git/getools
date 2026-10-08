/** Đọc và kiểm tra cấu hình AI từ header của yêu cầu (dùng ở route handler). */
import { AiConfig, AiProvider, MODEL_NAME_RE, PROVIDER_INFO, isAiProvider } from '@/lib/ai-providers';
import { GEMINI_TEXT_MODEL } from '@/lib/ai-prompts';

export type ConfigResult = { ok: true; config: AiConfig } | { ok: false; error: string; status: number };

const KEY_RE = /^[\x21-\x7e]{8,512}$/; // ký tự in được, không khoảng trắng / điều khiển

export function readAiConfig(headers: Headers): ConfigResult {
  const rawProvider = headers.get('x-ai-provider') || 'gemini';
  if (!isAiProvider(rawProvider)) return { ok: false, error: 'Nhà cung cấp AI không hợp lệ.', status: 400 };
  const provider: AiProvider = rawProvider;
  const info = PROVIDER_INFO[provider];

  let key = (headers.get('x-ai-key') || headers.get('x-gemini-key') || '').trim();
  if (!key && provider === 'gemini') key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    return { ok: false, error: `Chưa có khóa ${info.label}. Vui lòng nhập khóa trong Cài đặt rồi thử lại.`, status: 401 };
  }
  if (!KEY_RE.test(key)) {
    return { ok: false, error: `Khóa ${info.label} không hợp lệ (chứa khoảng trắng hoặc ký tự lạ). Vui lòng kiểm tra lại.`, status: 401 };
  }
  if (provider === 'gemini' && !(key.startsWith('AIza') && key.length >= 35)) {
    return { ok: false, error: 'Gemini API Key không hợp lệ (khóa phải bắt đầu bằng "AIza"). Vui lòng kiểm tra lại trong Cài đặt.', status: 401 };
  }

  const rawModel = (headers.get('x-ai-model') || '').trim();
  const fallback = provider === 'gemini' ? GEMINI_TEXT_MODEL : info.defaultModel;
  const model = rawModel || fallback;
  if (!model) return { ok: false, error: 'Chưa nhập tên model. Vui lòng nhập trong Cài đặt.', status: 400 };
  if (!MODEL_NAME_RE.test(model)) return { ok: false, error: 'Tên model không hợp lệ.', status: 400 };

  const baseUrl = provider === 'custom' ? (headers.get('x-ai-base-url') || '').trim() : undefined;
  if (provider === 'custom' && !baseUrl) return { ok: false, error: 'Chưa nhập Base URL cho dịch vụ tùy chỉnh.', status: 400 };

  return { ok: true, config: { provider, key, model, baseUrl } };
}
