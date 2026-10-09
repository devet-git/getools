/** Đọc và kiểm tra cấu hình AI từ header của yêu cầu (dùng ở route handler). */
import { AiConfig, AiProvider, MODEL_NAME_RE, PROVIDER_INFO, isAiProvider } from '@/lib/ai-providers';
import { GEMINI_TEXT_MODEL } from '@/lib/ai-prompts';

/** usesServerKey: đang dùng khóa GEMINI_API_KEY của máy chủ (route phải giới hạn tần suất) */
export type ConfigResult = { ok: true; config: AiConfig; usesServerKey: boolean } | { ok: false; error: string; status: number };

const KEY_RE = /^[\x21-\x7e]{8,512}$/; // ký tự in được, không khoảng trắng / điều khiển

/**
 * Chuẩn hóa khóa người dùng dán vào: bỏ khoảng trắng/xuống dòng ở hai đầu, dấu nháy bao quanh
 * (vd. "AIza..." hay `...`), tiền tố "Bearer " và "key=" thường bị dán nhầm.
 * Cố ý KHÔNG kiểm tra tiền tố/độ dài đặc thù của nhà cung cấp: định dạng khóa thay đổi theo thời gian
 * (Google đã đổi dạng khóa), nên để chính nhà cung cấp xác nhận khóa có hợp lệ hay không.
 */
export function normalizeApiKey(raw: string | null | undefined): string {
  let k = (raw ?? '').trim();
  k = k.replace(/^bearer\s+/i, '').replace(/^(?:x-goog-api-key|api[_-]?key|key)\s*[:=]\s*/i, '');
  for (let i = 0; i < 2; i++) k = k.replace(/^["'`]+|["'`]+$/g, '').trim();
  return k;
}

export function readAiConfig(headers: Headers): ConfigResult {
  const rawProvider = headers.get('x-ai-provider') || 'gemini';
  if (!isAiProvider(rawProvider)) return { ok: false, error: 'Nhà cung cấp AI không hợp lệ.', status: 400 };
  const provider: AiProvider = rawProvider;
  const info = PROVIDER_INFO[provider];

  let key = normalizeApiKey(headers.get('x-ai-key') || headers.get('x-gemini-key'));
  let usesServerKey = false;
  if (!key && provider === 'gemini') {
    key = normalizeApiKey(process.env.GEMINI_API_KEY);
    usesServerKey = !!key;
  }
  if (!key) {
    return { ok: false, error: `Chưa có khóa ${info.label}. Vui lòng nhập khóa trong Cài đặt rồi thử lại.`, status: 401 };
  }
  if (!KEY_RE.test(key)) {
    return { ok: false, error: `Khóa ${info.label} không hợp lệ (chứa khoảng trắng hoặc ký tự lạ). Vui lòng kiểm tra lại.`, status: 401 };
  }
  const rawModel = (headers.get('x-ai-model') || '').trim();
  const fallback = provider === 'gemini' ? GEMINI_TEXT_MODEL : info.defaultModel;
  const model = rawModel || fallback;
  if (!model) return { ok: false, error: 'Chưa nhập tên model. Vui lòng nhập trong Cài đặt.', status: 400 };
  if (!MODEL_NAME_RE.test(model)) return { ok: false, error: 'Tên model không hợp lệ.', status: 400 };

  const baseUrl = provider === 'custom' ? (headers.get('x-ai-base-url') || '').trim() : undefined;
  if (provider === 'custom' && !baseUrl) return { ok: false, error: 'Chưa nhập Base URL cho dịch vụ tùy chỉnh.', status: 400 };

  return { ok: true, config: { provider, key, model, baseUrl }, usesServerKey };
}
