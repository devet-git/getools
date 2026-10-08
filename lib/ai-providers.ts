/**
 * Danh sách nhà cung cấp AI và kiểu cấu hình dùng chung cho client + server.
 * Không chứa bí mật.
 */
export const AI_PROVIDERS = ['gemini', 'openai', 'anthropic', 'custom'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface ProviderInfo {
  id: AiProvider;
  label: string;
  defaultModel: string;
  suggestedModels: string[];
  keyPlaceholder: string;
  keyUrl?: string;
  keyUrlLabel?: string;
  note?: string;
}

export const PROVIDER_INFO: Record<AiProvider, ProviderInfo> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
    keyPlaceholder: 'Dán Gemini API key',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyUrlLabel: 'Google AI Studio',
    note: 'Khóa Gemini cũng được dùng cho TTS (chuyển văn bản thành giọng nói).',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyUrlLabel: 'OpenAI Platform',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    defaultModel: 'claude-haiku-5-5',
    suggestedModels: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyUrlLabel: 'Anthropic Console',
  },
  custom: {
    id: 'custom',
    label: 'OpenAI-compatible',
    defaultModel: '',
    suggestedModels: [],
    keyPlaceholder: 'API key của dịch vụ',
    note: 'Dùng cho OpenRouter, Groq, Together, Mistral, DeepSeek... Nhập Base URL (ví dụ https://openrouter.ai/api/v1) và tên model.',
  },
};

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && (AI_PROVIDERS as readonly string[]).includes(v);
}

/** Cấu hình AI đã được giải quyết, gửi kèm mỗi yêu cầu. */
export interface AiConfig {
  provider: AiProvider;
  key: string;
  model: string;
  /** Chỉ dùng cho provider 'custom' */
  baseUrl?: string;
}

export const MODEL_NAME_RE = /^[A-Za-z0-9][\w.\-:/]{0,99}$/;
