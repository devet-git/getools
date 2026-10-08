/** Helper fetch gọi /api/ai ở phía client. Khoá Gemini chỉ đi qua header, không bao giờ nhúng vào bundle. */
import type { AiImage, AiTask } from '@/lib/ai-prompts';

export interface CallAiParams {
  task: AiTask;
  input?: string;
  options?: Record<string, string | boolean>;
  image?: AiImage;
  /** Khoá Gemini của người dùng (keys.gemini); nếu trống server sẽ dùng khoá môi trường. */
  apiKey?: string;
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
    case 401: return 'Gemini API Key thiếu hoặc không hợp lệ. Vui lòng nhập khoá trong Cài đặt.';
    case 413: return 'Nội dung hoặc ảnh quá lớn.';
    case 429: return 'Đã vượt hạn mức hoặc gửi quá nhanh. Vui lòng thử lại sau.';
    case 502: return 'Dịch vụ Gemini đang gặp sự cố. Vui lòng thử lại sau.';
    default: return 'Đã xảy ra lỗi khi gọi AI. Vui lòng thử lại.';
  }
}

export async function callAi({ task, input = '', options = {}, image, apiKey, signal }: CallAiParams): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey.trim()) headers['x-gemini-key'] = apiKey.trim();

  let res: Response;
  try {
    res = await fetch('/api/ai', {
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
