import { NextRequest, NextResponse } from 'next/server';
import { AiProviderError, generateText } from '@/lib/ai-server';
import { readAiConfig } from '@/lib/ai-request-config';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Kiểm tra nhanh khóa + model bằng một yêu cầu rất nhỏ. */
export async function POST(req: NextRequest) {
  const cfg = readAiConfig(req.headers);
  if (!cfg.ok) return NextResponse.json({ ok: false, error: cfg.error }, { status: cfg.status });
  try {
    await generateText(
      cfg.config,
      { system: 'Reply with the single word OK.', user: 'ping', temperature: 0, maxTokens: 16 },
      req.signal
    );
    return NextResponse.json({ ok: true, provider: cfg.config.provider, model: cfg.config.model });
  } catch (err) {
    if (err instanceof AiProviderError) {
      console.warn('AI test error:', cfg.config.provider, err.status);
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    return NextResponse.json({ ok: false, error: 'Không thể kiểm tra khóa. Vui lòng thử lại.' }, { status: 500 });
  }
}
