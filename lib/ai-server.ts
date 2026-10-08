/**
 * Gọi các nhà cung cấp AI phía server (Gemini qua SDK; OpenAI / Anthropic / tương thích OpenAI qua fetch).
 * Chỉ import từ route handler. Không log khóa hay nội dung người dùng.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { GoogleGenAI, ApiError } from '@google/genai';
import { AiConfig, PROVIDER_INFO } from '@/lib/ai-providers';

export class AiProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AiProviderError';
    this.status = status;
  }
}

export interface GenerateRequest {
  system: string;
  user: string;
  image?: { mimeType: string; data: string };
  temperature: number;
  maxTokens: number;
}

const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 55_000;

/* ---------- Bảo vệ SSRF cho endpoint tùy chỉnh ---------- */

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateV4(mapped[1]);
    // Trình phân tích URL chuẩn hóa IPv4 nhúng trong IPv6 sang dạng hex (::ffff:7f00:1, ::7f00:1)
    const hex = s.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    // 6to4 (2002::/16) và Teredo (2001:0::/32) nhúng địa chỉ IPv4 tùy ý
    if (s.startsWith('2002:') || s.startsWith('2001:0:') || s.startsWith('2001::')) return true;
    if (s === '::' || s === '::1') return true;
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff') || s.startsWith('64:ff9b')) return true;
    return false;
  }
  return true;
}

/** Kiểm tra Base URL tùy chỉnh. Trả về URL đã chuẩn hóa (không có dấu / cuối). */
export async function validateCustomBaseUrl(raw: string): Promise<string> {
  if (process.env.AI_ALLOW_CUSTOM_ENDPOINT === 'false') {
    throw new AiProviderError('Máy chủ này không cho phép endpoint AI tùy chỉnh.', 403);
  }
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new AiProviderError('Base URL không hợp lệ. Ví dụ: https://openrouter.ai/api/v1', 400);
  }
  if (u.protocol !== 'https:') throw new AiProviderError('Base URL phải dùng https://', 400);
  if (u.username || u.password) throw new AiProviderError('Base URL không được chứa tên đăng nhập / mật khẩu.', 400);
  if (u.port && u.port !== '443') throw new AiProviderError('Base URL chỉ hỗ trợ cổng 443 (mặc định).', 400);
  if (u.search || u.hash) throw new AiProviderError('Base URL không được chứa query hoặc fragment.', 400);

  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) {
    throw new AiProviderError('Base URL trỏ tới địa chỉ nội bộ nên không được phép.', 400);
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new AiProviderError('Base URL trỏ tới địa chỉ nội bộ nên không được phép.', 400);
  } else {
    let addrs: { address: string }[];
    try {
      addrs = await lookup(host, { all: true });
    } catch {
      throw new AiProviderError('Không phân giải được tên miền của Base URL.', 400);
    }
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      throw new AiProviderError('Base URL trỏ tới địa chỉ nội bộ nên không được phép.', 400);
    }
  }
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

/* ---------- Tiện ích chung ---------- */

function mapHttpError(status: number, label: string): AiProviderError {
  if (status === 401 || status === 403) {
    return new AiProviderError(`Khóa ${label} không hợp lệ hoặc không có quyền. Vui lòng kiểm tra lại trong Cài đặt.`, 401);
  }
  if (status === 429) {
    return new AiProviderError(`Đã vượt hạn mức ${label} hoặc gửi quá nhanh. Vui lòng đợi một lát rồi thử lại.`, 429);
  }
  if (status === 404) {
    return new AiProviderError(`${label}: model hoặc đường dẫn không tồn tại. Hãy kiểm tra tên model (và Base URL nếu có).`, 400);
  }
  if (status === 413) return new AiProviderError('Nội dung hoặc ảnh quá lớn cho model này.', 413);
  if (status === 400 || status === 422) {
    return new AiProviderError(`${label} không chấp nhận yêu cầu này (model có thể không hỗ trợ ảnh hoặc nội dung không hợp lệ).`, 400);
  }
  return new AiProviderError(`Dịch vụ ${label} đang gặp sự cố. Vui lòng thử lại sau.`, 502);
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal, label: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    });
  } catch (e) {
    if (signal.aborted) throw new AiProviderError('Yêu cầu đã bị huỷ.', 499);
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new AiProviderError(`${label} phản hồi quá lâu. Vui lòng thử lại.`, 504);
    throw new AiProviderError(`Không kết nối được tới ${label}. Vui lòng thử lại sau.`, 502);
  }
  if (!res.ok) throw mapHttpError(res.status, label);
  const text = await res.text();
  if (text.length > MAX_UPSTREAM_BYTES) throw new AiProviderError(`Phản hồi từ ${label} quá lớn.`, 502);
  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError(`${label} trả về dữ liệu không hợp lệ.`, 502);
  }
}

/* ---------- Từng nhà cung cấp ---------- */

async function callGemini(cfg: AiConfig, r: GenerateRequest, signal: AbortSignal): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: cfg.key });
    const parts: Array<Record<string, unknown>> = [{ text: r.user }];
    if (r.image) parts.push({ inlineData: { mimeType: r.image.mimeType, data: r.image.data } });
    const response = await ai.models.generateContent({
      model: cfg.model,
      contents: [{ role: 'user', parts }] as never,
      config: { systemInstruction: r.system, temperature: r.temperature, maxOutputTokens: r.maxTokens, abortSignal: signal },
    });
    if (response.promptFeedback?.blockReason) {
      throw new AiProviderError('Gemini từ chối xử lý nội dung này (bị chặn bởi bộ lọc an toàn).', 422);
    }
    const text = (response.text || '').trim();
    if (!text) throw new AiProviderError('Gemini không trả về nội dung. Vui lòng thử lại.', 502);
    return text;
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    if (signal.aborted) throw new AiProviderError('Yêu cầu đã bị huỷ.', 499);
    const status = err instanceof ApiError ? err.status : 0;
    const msg = err instanceof Error ? err.message : '';
    if (/API_KEY_INVALID|API key not valid/i.test(msg)) throw mapHttpError(401, 'Gemini');
    throw mapHttpError(status || 500, 'Gemini');
  }
}

function openAiText(data: unknown): string {
  const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '')).join('').trim();
  }
  return '';
}

async function callOpenAiCompatible(cfg: AiConfig, r: GenerateRequest, signal: AbortSignal, baseUrl: string, official: boolean): Promise<string> {
  const label = official ? 'OpenAI' : 'dịch vụ AI tùy chỉnh';
  const userContent: unknown = r.image
    ? [
        { type: 'text', text: r.user },
        { type: 'image_url', image_url: { url: `data:${r.image.mimeType};base64,${r.image.data}` } },
      ]
    : r.user;
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: r.system },
      { role: 'user', content: userContent },
    ],
  };
  if (official) {
    body.max_completion_tokens = r.maxTokens;
    // Các model suy luận (o*, gpt-5*) không nhận temperature tùy chỉnh
    if (!/^(o\d|gpt-5)/i.test(cfg.model)) body.temperature = r.temperature;
  } else {
    body.max_tokens = r.maxTokens;
    body.temperature = r.temperature;
  }
  const data = await postJson(`${baseUrl}/chat/completions`, { Authorization: `Bearer ${cfg.key}` }, body, signal, label);
  const text = openAiText(data);
  if (!text) throw new AiProviderError(`${label} không trả về nội dung. Vui lòng thử lại.`, 502);
  return text;
}

async function callAnthropic(cfg: AiConfig, r: GenerateRequest, signal: AbortSignal): Promise<string> {
  const content: unknown[] = [];
  if (r.image) content.push({ type: 'image', source: { type: 'base64', media_type: r.image.mimeType, data: r.image.data } });
  content.push({ type: 'text', text: r.user });
  const data = (await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' },
    { model: cfg.model, max_tokens: r.maxTokens, temperature: r.temperature, system: r.system, messages: [{ role: 'user', content }] },
    signal,
    'Anthropic'
  )) as { content?: { type?: string; text?: string }[] };
  const text = (data.content || []).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('').trim();
  if (!text) throw new AiProviderError('Anthropic không trả về nội dung. Vui lòng thử lại.', 502);
  return text;
}

export async function generateText(cfg: AiConfig, r: GenerateRequest, signal: AbortSignal): Promise<string> {
  switch (cfg.provider) {
    case 'gemini':
      return callGemini(cfg, r, signal);
    case 'openai':
      return callOpenAiCompatible(cfg, r, signal, 'https://api.openai.com/v1', true);
    case 'anthropic':
      return callAnthropic(cfg, r, signal);
    case 'custom': {
      const base = await validateCustomBaseUrl(cfg.baseUrl || '');
      return callOpenAiCompatible(cfg, r, signal, base, false);
    }
  }
}

export function providerLabel(p: AiConfig['provider']): string {
  return PROVIDER_INFO[p].label;
}
