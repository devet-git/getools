import { NextRequest, NextResponse } from 'next/server';
import { buildPrompt, validateAiRequest } from '@/lib/ai-prompts';
import { AiProviderError, generateText } from '@/lib/ai-server';
import { readAiConfig } from '@/lib/ai-request-config';
import { rateLimit, rejectForeign } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BODY_BYTES = 12 * 1024 * 1024;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Lượt dùng khóa Gemini của máy chủ cho mỗi IP */
const SERVER_KEY_LIMIT = { count: 30, windowMs: 10 * 60_000 };

export async function POST(req: NextRequest) {
  const foreign = rejectForeign(req);
  if (foreign) return foreign;
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) return fail('Dữ liệu gửi lên quá lớn.', 413);

  const cfg = readAiConfig(req.headers);
  if (!cfg.ok) return fail(cfg.error, cfg.status);
  if (cfg.usesServerKey) {
    const limited = rateLimit(req, 'ai', SERVER_KEY_LIMIT.count, SERVER_KEY_LIMIT.windowMs);
    if (limited) return limited;
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
    const text = await generateText(
      cfg.config,
      {
        system: prompt.system,
        user: prompt.user,
        image: image ? { mimeType: image.mimeType, data: image.data } : undefined,
        temperature: task === 'ocr' || task === 'translate' ? 0.1 : 0.4,
        maxTokens: 16384,
      },
      req.signal
    );
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof AiProviderError) {
      // Chỉ log loại lỗi, không log khóa hay nội dung người dùng
      console.warn('AI route error:', cfg.config.provider, err.status);
      return fail(err.message, err.status);
    }
    console.warn('AI route error:', cfg.config.provider, 'unknown');
    return fail('Không thể xử lý yêu cầu AI. Vui lòng thử lại.', 500);
  }
}
