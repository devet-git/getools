/**
 * Bảng giá & thông số model LLM (USD / 1 triệu token) + công thức chi phí.
 * GIÁ CHỈ MANG TÍNH THAM KHẢO: tổng hợp theo hiểu biết đến ~06/2026, có thể đã đổi.
 * Người dùng có thể sửa từng giá trị và thêm model riêng (lưu localStorage).
 */
import type { FamilyId } from './llm-tokens';

export const PRICING_AS_OF = '2026-06';
export const PRICING_STORAGE_KEY = 'getools_llm_pricing_overrides';

export type Confidence = 'tham khảo' | 'kém chắc chắn';

export interface LlmModel {
  id: string;
  provider: string;
  name: string;
  family: FamilyId;
  /** Cửa sổ ngữ cảnh (token). */
  context: number;
  /** Số token đầu ra tối đa. */
  maxOutput: number;
  /** USD / 1M token đầu vào. */
  input: number;
  /** USD / 1M token đầu ra. */
  output: number;
  /** USD / 1M token đầu vào đọc từ cache (nếu có). */
  cachedInput?: number;
  /** Tỉ lệ giảm giá Batch API (0.5 = giảm 50%). Không có = không hỗ trợ. */
  batchDiscount?: number;
  confidence: Confidence;
  asOf: string;
  source: string;
  custom?: boolean;
}

type Row = Omit<LlmModel, 'asOf'>;

const OPENAI_SRC = 'Bảng giá công khai của OpenAI (platform.openai.com/docs/pricing)';
const ANTH_SRC = 'Bảng giá công khai của Anthropic (docs.anthropic.com)';
const GOOG_SRC = 'Bảng giá Gemini API của Google (ai.google.dev/pricing)';
const HOST_SRC = 'Giá tham khảo từ các nhà host phổ biến (Together/Groq/Fireworks...), khác nhau theo nhà cung cấp';
const MISTRAL_SRC = 'Bảng giá công khai của Mistral AI (mistral.ai/pricing)';
const DEEPSEEK_SRC = 'Bảng giá công khai của DeepSeek (api-docs.deepseek.com)';

const ROWS: Row[] = [
  // OpenAI
  { id: 'gpt-5', provider: 'OpenAI', name: 'GPT-5', family: 'o200k', context: 400000, maxOutput: 128000, input: 1.25, output: 10, cachedInput: 0.125, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'gpt-5-mini', provider: 'OpenAI', name: 'GPT-5 mini', family: 'o200k', context: 400000, maxOutput: 128000, input: 0.25, output: 2, cachedInput: 0.025, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'gpt-5-nano', provider: 'OpenAI', name: 'GPT-5 nano', family: 'o200k', context: 400000, maxOutput: 128000, input: 0.05, output: 0.4, cachedInput: 0.005, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'gpt-4.1', provider: 'OpenAI', name: 'GPT-4.1', family: 'o200k', context: 1047576, maxOutput: 32768, input: 2, output: 8, cachedInput: 0.5, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'gpt-4.1-mini', provider: 'OpenAI', name: 'GPT-4.1 mini', family: 'o200k', context: 1047576, maxOutput: 32768, input: 0.4, output: 1.6, cachedInput: 0.1, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'gpt-4.1-nano', provider: 'OpenAI', name: 'GPT-4.1 nano', family: 'o200k', context: 1047576, maxOutput: 32768, input: 0.1, output: 0.4, cachedInput: 0.025, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'gpt-4o', provider: 'OpenAI', name: 'GPT-4o', family: 'o200k', context: 128000, maxOutput: 16384, input: 2.5, output: 10, cachedInput: 1.25, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'gpt-4o-mini', provider: 'OpenAI', name: 'GPT-4o mini', family: 'o200k', context: 128000, maxOutput: 16384, input: 0.15, output: 0.6, cachedInput: 0.075, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'o3', provider: 'OpenAI', name: 'o3', family: 'o200k', context: 200000, maxOutput: 100000, input: 2, output: 8, cachedInput: 0.5, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'o4-mini', provider: 'OpenAI', name: 'o4-mini', family: 'o200k', context: 200000, maxOutput: 100000, input: 1.1, output: 4.4, cachedInput: 0.275, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'o3-mini', provider: 'OpenAI', name: 'o3-mini', family: 'o200k', context: 200000, maxOutput: 100000, input: 1.1, output: 4.4, cachedInput: 0.55, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'o1', provider: 'OpenAI', name: 'o1', family: 'o200k', context: 200000, maxOutput: 100000, input: 15, output: 60, cachedInput: 7.5, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'gpt-4-turbo', provider: 'OpenAI', name: 'GPT-4 Turbo (cũ)', family: 'cl100k', context: 128000, maxOutput: 4096, input: 10, output: 30, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  { id: 'gpt-3.5-turbo', provider: 'OpenAI', name: 'GPT-3.5 Turbo (cũ)', family: 'cl100k', context: 16385, maxOutput: 4096, input: 0.5, output: 1.5, batchDiscount: 0.5, confidence: 'tham khảo', source: OPENAI_SRC },
  // Anthropic
  { id: 'claude-opus-4.5', provider: 'Anthropic', name: 'Claude Opus 4.5', family: 'claude', context: 200000, maxOutput: 64000, input: 5, output: 25, cachedInput: 0.5, batchDiscount: 0.5, confidence: 'kém chắc chắn', source: ANTH_SRC },
  { id: 'claude-opus-4.1', provider: 'Anthropic', name: 'Claude Opus 4.1', family: 'claude', context: 200000, maxOutput: 32000, input: 15, output: 75, cachedInput: 1.5, batchDiscount: 0.5, confidence: 'tham khảo', source: ANTH_SRC },
  { id: 'claude-sonnet-4.5', provider: 'Anthropic', name: 'Claude Sonnet 4.5', family: 'claude', context: 200000, maxOutput: 64000, input: 3, output: 15, cachedInput: 0.3, batchDiscount: 0.5, confidence: 'tham khảo', source: ANTH_SRC },
  { id: 'claude-haiku-4.5', provider: 'Anthropic', name: 'Claude Haiku 4.5', family: 'claude', context: 200000, maxOutput: 64000, input: 1, output: 5, cachedInput: 0.1, batchDiscount: 0.5, confidence: 'tham khảo', source: ANTH_SRC },
  { id: 'claude-haiku-3.5', provider: 'Anthropic', name: 'Claude 3.5 Haiku (cũ)', family: 'claude', context: 200000, maxOutput: 8192, input: 0.8, output: 4, cachedInput: 0.08, batchDiscount: 0.5, confidence: 'tham khảo', source: ANTH_SRC },
  // Google
  { id: 'gemini-2.5-pro', provider: 'Google', name: 'Gemini 2.5 Pro', family: 'gemini', context: 1048576, maxOutput: 65536, input: 1.25, output: 10, cachedInput: 0.125, batchDiscount: 0.5, confidence: 'tham khảo', source: GOOG_SRC + ' (giá cho prompt <= 200k token)' },
  { id: 'gemini-2.5-flash', provider: 'Google', name: 'Gemini 2.5 Flash', family: 'gemini', context: 1048576, maxOutput: 65536, input: 0.3, output: 2.5, cachedInput: 0.03, batchDiscount: 0.5, confidence: 'tham khảo', source: GOOG_SRC },
  { id: 'gemini-2.5-flash-lite', provider: 'Google', name: 'Gemini 2.5 Flash-Lite', family: 'gemini', context: 1048576, maxOutput: 65536, input: 0.1, output: 0.4, cachedInput: 0.01, batchDiscount: 0.5, confidence: 'tham khảo', source: GOOG_SRC },
  { id: 'gemini-2.0-flash', provider: 'Google', name: 'Gemini 2.0 Flash', family: 'gemini', context: 1048576, maxOutput: 8192, input: 0.1, output: 0.4, cachedInput: 0.025, batchDiscount: 0.5, confidence: 'tham khảo', source: GOOG_SRC },
  { id: 'gemini-2.0-flash-lite', provider: 'Google', name: 'Gemini 2.0 Flash-Lite', family: 'gemini', context: 1048576, maxOutput: 8192, input: 0.075, output: 0.3, batchDiscount: 0.5, confidence: 'tham khảo', source: GOOG_SRC },
  // Llama qua host
  { id: 'llama-3.1-405b', provider: 'Meta (qua host)', name: 'Llama 3.1 405B', family: 'llama', context: 131072, maxOutput: 4096, input: 3.5, output: 3.5, confidence: 'kém chắc chắn', source: HOST_SRC },
  { id: 'llama-3.3-70b', provider: 'Meta (qua host)', name: 'Llama 3.3 70B', family: 'llama', context: 131072, maxOutput: 8192, input: 0.88, output: 0.88, confidence: 'kém chắc chắn', source: HOST_SRC },
  { id: 'llama-3.1-8b', provider: 'Meta (qua host)', name: 'Llama 3.1 8B', family: 'llama', context: 131072, maxOutput: 8192, input: 0.18, output: 0.18, confidence: 'kém chắc chắn', source: HOST_SRC },
  { id: 'llama-4-maverick', provider: 'Meta (qua host)', name: 'Llama 4 Maverick', family: 'llama', context: 1000000, maxOutput: 8192, input: 0.27, output: 0.85, confidence: 'kém chắc chắn', source: HOST_SRC + '; context thực tế phụ thuộc host' },
  { id: 'llama-4-scout', provider: 'Meta (qua host)', name: 'Llama 4 Scout', family: 'llama', context: 328000, maxOutput: 8192, input: 0.18, output: 0.59, confidence: 'kém chắc chắn', source: HOST_SRC + '; context thực tế phụ thuộc host' },
  // Mistral
  { id: 'mistral-large', provider: 'Mistral', name: 'Mistral Large', family: 'cl100k', context: 128000, maxOutput: 8192, input: 2, output: 6, confidence: 'tham khảo', source: MISTRAL_SRC },
  { id: 'mistral-medium-3', provider: 'Mistral', name: 'Mistral Medium 3', family: 'cl100k', context: 128000, maxOutput: 8192, input: 0.4, output: 2, confidence: 'tham khảo', source: MISTRAL_SRC },
  { id: 'mistral-small-3.1', provider: 'Mistral', name: 'Mistral Small 3.1', family: 'cl100k', context: 128000, maxOutput: 8192, input: 0.1, output: 0.3, confidence: 'tham khảo', source: MISTRAL_SRC },
  { id: 'codestral', provider: 'Mistral', name: 'Codestral', family: 'cl100k', context: 256000, maxOutput: 8192, input: 0.3, output: 0.9, confidence: 'tham khảo', source: MISTRAL_SRC },
  // DeepSeek
  { id: 'deepseek-chat', provider: 'DeepSeek', name: 'DeepSeek V3.x (chat)', family: 'llama', context: 128000, maxOutput: 8192, input: 0.28, output: 0.42, cachedInput: 0.028, confidence: 'kém chắc chắn', source: DEEPSEEK_SRC },
  { id: 'deepseek-reasoner', provider: 'DeepSeek', name: 'DeepSeek V3.x (reasoner)', family: 'llama', context: 128000, maxOutput: 64000, input: 0.28, output: 0.42, cachedInput: 0.028, confidence: 'kém chắc chắn', source: DEEPSEEK_SRC },
];

export const DEFAULT_MODELS: LlmModel[] = ROWS.map((r) => ({ ...r, asOf: PRICING_AS_OF }));

/* ------------------------------------------------------------------ */
/* Ghi đè của người dùng                                               */
/* ------------------------------------------------------------------ */

export type EditableField = 'input' | 'output' | 'cachedInput' | 'context' | 'maxOutput';
export const EDITABLE_FIELDS: EditableField[] = ['input', 'output', 'cachedInput', 'context', 'maxOutput'];

export interface PricingState {
  overrides: Record<string, Partial<Record<EditableField, number>>>;
  custom: LlmModel[];
}

export const EMPTY_PRICING_STATE: PricingState = { overrides: {}, custom: [] };

const FAMILY_IDS: FamilyId[] = ['o200k', 'cl100k', 'claude', 'gemini', 'llama'];

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Làm sạch dữ liệu đọc từ localStorage (không bao giờ ném lỗi). */
export function sanitizePricingState(raw: unknown): PricingState {
  const out: PricingState = { overrides: {}, custom: [] };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { overrides?: unknown; custom?: unknown };
  if (r.overrides && typeof r.overrides === 'object') {
    for (const [id, v] of Object.entries(r.overrides as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const o: Partial<Record<EditableField, number>> = {};
      for (const f of EDITABLE_FIELDS) {
        const n = num((v as Record<string, unknown>)[f]);
        if (n !== undefined) o[f] = n;
      }
      if (Object.keys(o).length) out.overrides[id] = o;
    }
  }
  if (Array.isArray(r.custom)) {
    for (const c of r.custom.slice(0, 100)) {
      if (!c || typeof c !== 'object') continue;
      const m = c as Record<string, unknown>;
      const input = num(m.input);
      const output = num(m.output);
      const context = num(m.context);
      if (typeof m.id !== 'string' || typeof m.name !== 'string' || input === undefined || output === undefined || !context) continue;
      out.custom.push({
        id: m.id.slice(0, 64),
        provider: typeof m.provider === 'string' && m.provider ? m.provider.slice(0, 40) : 'Tùy chỉnh',
        name: m.name.slice(0, 60),
        family: FAMILY_IDS.includes(m.family as FamilyId) ? (m.family as FamilyId) : 'o200k',
        context,
        maxOutput: num(m.maxOutput) ?? context,
        input,
        output,
        cachedInput: num(m.cachedInput),
        batchDiscount: num(m.batchDiscount),
        confidence: 'kém chắc chắn',
        asOf: typeof m.asOf === 'string' ? m.asOf : PRICING_AS_OF,
        source: 'Do người dùng nhập',
        custom: true,
      });
    }
  }
  return out;
}

export function loadPricingState(): PricingState {
  try {
    const s = localStorage.getItem(PRICING_STORAGE_KEY);
    if (!s) return { overrides: {}, custom: [] };
    return sanitizePricingState(JSON.parse(s));
  } catch {
    return { overrides: {}, custom: [] };
  }
}

export function savePricingState(state: PricingState): void {
  try {
    if (!Object.keys(state.overrides).length && !state.custom.length) localStorage.removeItem(PRICING_STORAGE_KEY);
    else localStorage.setItem(PRICING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* bỏ qua: chế độ riêng tư / hết dung lượng */
  }
}

/** Áp ghi đè lên bảng mặc định + nối model tùy chỉnh. */
export function applyPricingState(base: LlmModel[], state: PricingState): LlmModel[] {
  const merged = base.map((m) => {
    const o = state.overrides[m.id];
    return o ? { ...m, ...o } : m;
  });
  return [...merged, ...state.custom];
}

/** Giá trị đã bị người dùng sửa? */
export function isOverridden(state: PricingState, id: string, field: EditableField): boolean {
  return state.overrides[id]?.[field] !== undefined;
}

/* ------------------------------------------------------------------ */
/* Công thức chi phí                                                   */
/* ------------------------------------------------------------------ */

export function tokensCost(tokens: number, pricePerMillion: number): number {
  return (Math.max(0, tokens) / 1_000_000) * Math.max(0, pricePerMillion);
}

export interface ScenarioInput {
  inputTokens: number;
  outputTokens: number;
  /** Tỉ lệ (0..1) token đầu vào là tiền tố được cache. */
  cachedShare: number;
  batch: boolean;
  callsPerDay: number;
  daysPerMonth: number;
}

export interface ScenarioCost {
  /** Chi phí đầu vào không cache / mỗi lần gọi. */
  inputFresh: number;
  /** Chi phí đầu vào đọc từ cache / mỗi lần gọi. */
  inputCached: number;
  output: number;
  perCall: number;
  callsPerMonth: number;
  monthly: number;
  monthlyInput: number;
  monthlyOutput: number;
  /** Hệ số giảm giá batch thực tế đã áp (1 = không giảm). */
  batchFactor: number;
  batchApplied: boolean;
  cacheApplied: boolean;
}

export function scenarioCost(m: Pick<LlmModel, 'input' | 'output' | 'cachedInput' | 'batchDiscount'>, s: ScenarioInput): ScenarioCost {
  const share = Math.min(1, Math.max(0, s.cachedShare));
  const cacheApplied = m.cachedInput !== undefined && share > 0;
  const cachedPrice = m.cachedInput ?? m.input;
  const batchApplied = s.batch && m.batchDiscount !== undefined && m.batchDiscount > 0;
  const batchFactor = batchApplied ? 1 - Math.min(1, m.batchDiscount as number) : 1;
  const inputFresh = tokensCost(s.inputTokens * (1 - share), m.input) * batchFactor;
  const inputCached = tokensCost(s.inputTokens * share, cachedPrice) * batchFactor;
  const output = tokensCost(s.outputTokens, m.output) * batchFactor;
  const perCall = inputFresh + inputCached + output;
  const callsPerMonth = Math.max(0, s.callsPerDay) * Math.max(0, s.daysPerMonth);
  return {
    inputFresh,
    inputCached,
    output,
    perCall,
    callsPerMonth,
    monthly: perCall * callsPerMonth,
    monthlyInput: (inputFresh + inputCached) * callsPerMonth,
    monthlyOutput: output * callsPerMonth,
    batchFactor,
    batchApplied,
    cacheApplied,
  };
}

export function formatUsd(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (v === 0) return '$0';
  const a = Math.abs(v);
  if (a >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 1) return '$' + v.toFixed(2);
  if (a >= 0.01) return '$' + v.toFixed(4);
  if (a >= 0.000001) return '$' + v.toFixed(6);
  return '<$0.000001';
}
