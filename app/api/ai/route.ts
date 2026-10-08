import { GoogleGenAI, ApiError } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { GEMINI_TEXT_MODEL, buildPrompt, validateAiRequest } from '@/lib/ai-prompts';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BODY_BYTES = 12 * 1024 * 1024;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

// Cùng cách kiểm tra khoá như route TTS
function isValidGoogleApiKey(key?: string | null): key is string {
  if (!key) return false;
  const t = key.trim();
  return t.startsWith('AIza') && t.length >= 35;
}

export async function POST(req: NextRequest) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) return fail('Dữ liệu gửi lên quá lớn.', 413);

  const apiKey = (req.headers.get('x-gemini-key') || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return fail('Chưa có Gemini API Key. Vui lòng nhập khoá trong Cài đặt rồi thử lại.', 401);
  }
  if (!isValidGoogleApiKey(apiKey)) {
    return fail('Gemini API Key không hợp lệ (khoá phải bắt đầu bằng "AIza"). Vui lòng kiểm tra lại trong Cài đặt.', 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('Yêu cầu không hợp lệ (JSON sai định dạng).', 400);
  }

  const v = validateAiRequest(body);
  if (!v.ok) return fail(v.error, v.status);
  const { task, image } = v.value;
  const prompt = buildPrompt(v.value);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const parts: Array<Record<string, unknown>> = [{ text: prompt.user }];
    if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });

    const response = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [{ role: 'user', parts }] as never,
      config: {
        systemInstruction: prompt.system,
        temperature: task === 'ocr' || task === 'translate' ? 0.1 : 0.4,
        maxOutputTokens: 16384,
        abortSignal: req.signal,
      },
    });

    const blocked = response.promptFeedback?.blockReason;
    if (blocked) return fail('Gemini từ chối xử lý nội dung này (bị chặn bởi bộ lọc an toàn).', 422);

    const text = (response.text || '').trim();
    if (!text) return fail('Gemini không trả về nội dung. Vui lòng thử lại.', 502);
    return NextResponse.json({ text });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    const msg = err instanceof Error ? err.message : '';
    // Chỉ log loại lỗi, không log khoá hay nội dung người dùng
    console.warn('AI route error:', status || 'unknown');
    if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(msg)) {
      return fail('Gemini API Key không hợp lệ hoặc không có quyền. Vui lòng kiểm tra lại trong Cài đặt.', 401);
    }
    if (status === 429) return fail('Đã vượt hạn mức Gemini hoặc gửi quá nhanh. Vui lòng đợi một lát rồi thử lại.', 429);
    if (status === 400) return fail('Gemini không chấp nhận yêu cầu này (nội dung hoặc ảnh có thể không hợp lệ).', 400);
    if (req.signal.aborted) return fail('Yêu cầu đã bị huỷ.', 499);
    if (status >= 500 || status === 404) return fail('Dịch vụ Gemini đang gặp sự cố hoặc model không khả dụng. Vui lòng thử lại sau.', 502);
    return fail('Không thể xử lý yêu cầu AI. Vui lòng thử lại.', 500);
  }
}
