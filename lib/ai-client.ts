/** Helper fetch gọi /api/ai ở phía client. Khoá Gemini chỉ đi qua header, không bao giờ nhúng vào bundle. */
import type { AiImage, AiTask } from '@/lib/ai-prompts';
import type { AiConfig } from '@/lib/ai-providers';
import { apiFetch } from '@/lib/api-client';

export interface CallAiParams {
  task: AiTask;
  input?: string;
  options?: Record<string, string | boolean>;
  image?: AiImage;
  /** Cấu hình AI của người dùng (nhà cung cấp, khóa, model). Nếu thiếu khóa Gemini, server dùng khóa môi trường. */
  ai: AiConfig;
  signal?: AbortSignal;
}

export class AiError extends Error {
  status: number;
  aborted: boolean;
  constructor(message: string, status = 0, aborted = false) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.aborted = aborted;
  }
}

export function aiErrorMessage(status: number): string {
  switch (status) {
    case 400: return 'Yêu cầu không hợp lệ.';
    case 401: return 'Khóa AI thiếu hoặc không hợp lệ. Vui lòng nhập khóa trong Cài đặt.';
    case 413: return 'Nội dung hoặc ảnh quá lớn.';
    case 429: return 'Đã vượt hạn mức hoặc gửi quá nhanh. Vui lòng thử lại sau.';
    case 502: return 'Dịch vụ AI đang gặp sự cố. Vui lòng thử lại sau.';
    default: return 'Đã xảy ra lỗi khi gọi AI. Vui lòng thử lại.';
  }
}

/** Header mang cấu hình AI tới server (khóa chỉ đi qua header, không bao giờ nằm trong URL hay bundle). */
export function aiHeaders(ai: AiConfig): Record<string, string> {
  const h: Record<string, string> = { 'x-ai-provider': ai.provider };
  if (ai.key.trim()) h['x-ai-key'] = ai.key.trim();
  if (ai.model.trim()) h['x-ai-model'] = ai.model.trim();
  if (ai.baseUrl?.trim()) h['x-ai-base-url'] = ai.baseUrl.trim();
  return h;
}

export async function callAi({ task, input = '', options = {}, image, ai, signal }: CallAiParams): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  Object.assign(headers, aiHeaders(ai));

  let res: Response;
  try {
    res = await apiFetch('/api/ai', {
      method: 'POST',
      headers,
      body: JSON.stringify({ task, input, options, image }),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new AiError('Đã huỷ yêu cầu.', 0, true);
    throw new AiError('Không kết nối được máy chủ. Kiểm tra mạng và thử lại.');
  }

  let data: { text?: string; error?: string } = {};
  try {
    data = await res.json();
  } catch {
    /* body không phải JSON */
  }
  if (!res.ok) throw new AiError(data.error || aiErrorMessage(res.status), res.status);
  if (!data.text) throw new AiError('AI không trả về nội dung.', 502);
  return data.text;
}

/** Hiển thị lỗi cho người dùng (bỏ qua lỗi do chính họ huỷ). */
export function toAiError(e: unknown): AiError {
  return e instanceof AiError ? e : new AiError('Đã xảy ra lỗi không mong muốn.');
}
