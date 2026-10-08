'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useApp } from '@/components/AppContext';
import {
  AI_SETTINGS_SERVER_SNAPSHOT,
  AiSettings,
  getAiSettingsSnapshot,
  parseAiSettings,
  saveAiSettings,
  subscribeAiSettings,
} from '@/lib/ai-settings';
import { AiConfig, AiProvider, PROVIDER_INFO } from '@/lib/ai-providers';
import { getAiServerStatusServerSnapshot, getAiServerStatusSnapshot, subscribeAiServerStatus } from '@/lib/ai-server-status';
import type { ToolDef } from '@/lib/tools';

const serverSnapshot = () => AI_SETTINGS_SERVER_SNAPSHOT;

export interface UseAiSettings {
  settings: AiSettings;
  /** Khóa đã lưu của một nhà cung cấp (gemini lấy từ kho khóa chung) */
  keyFor: (p: AiProvider) => string;
  modelFor: (p: AiProvider) => string;
  setProvider: (p: AiProvider) => void;
  setKey: (p: AiProvider, v: string) => void;
  setModel: (p: AiProvider, v: string) => void;
  setCustomBaseUrl: (v: string) => void;
  /** Cấu hình đang dùng cho các tool AI */
  config: AiConfig;
  /** Đã đủ thông tin để gọi AI (khóa, và với custom: base URL + model) */
  ready: boolean;
  providerLabel: string;
  /** Đã có khóa phù hợp để dùng tính năng AI này chưa ('gemini' = bắt buộc Gemini, mặc định: nhà cung cấp đang chọn) */
  isAiReady: (requires?: 'any' | 'gemini') => boolean;
  /** Tool này có đang bị khóa vì thiếu khóa AI không */
  isToolLocked: (tool?: Pick<ToolDef, 'requiresAi'> | null) => boolean;
}

export function useAiSettings(): UseAiSettings {
  const { keys, updateKey } = useApp();
  const raw = useSyncExternalStore(subscribeAiSettings, getAiSettingsSnapshot, serverSnapshot);
  const settings = useMemo(() => parseAiSettings(raw), [raw]);
  const serverStatus = useSyncExternalStore(subscribeAiServerStatus, getAiServerStatusSnapshot, getAiServerStatusServerSnapshot);
  const serverGemini = serverStatus === 'server-gemini';

  const keyFor = (p: AiProvider) => (p === 'gemini' ? keys.gemini || '' : settings.keys[p] || '');
  const modelFor = (p: AiProvider) => settings.models[p] || PROVIDER_INFO[p].defaultModel;

  const update = (patch: Partial<AiSettings>) => saveAiSettings({ ...settings, ...patch });

  const provider = settings.provider;
  const key = keyFor(provider).trim();
  // Chỉ gửi model khi người dùng tự chọn; để trống thì server dùng model mặc định của nhà cung cấp
  const model = (settings.models[provider] || '').trim();
  const baseUrl = settings.customBaseUrl.trim();
  // Gemini có thể dùng khóa môi trường của máy chủ (GEMINI_API_KEY) khi người dùng chưa nhập khóa riêng
  const hasKey = !!key || (provider === 'gemini' && serverGemini);
  const ready = hasKey && (provider !== 'custom' || (!!baseUrl && !!model));

  return {
    settings,
    keyFor,
    modelFor,
    setProvider: (p) => update({ provider: p }),
    setKey: (p, v) => {
      if (p === 'gemini') updateKey('gemini', v);
      else update({ keys: { ...settings.keys, [p]: v } });
    },
    setModel: (p, v) => update({ models: { ...settings.models, [p]: v } }),
    setCustomBaseUrl: (v) => update({ customBaseUrl: v }),
    config: { provider, key, model, baseUrl: provider === 'custom' ? baseUrl : undefined },
    ready,
    providerLabel: PROVIDER_INFO[provider].label,
    isAiReady: (requires = 'any') => (requires === 'gemini' ? !!(keys.gemini?.trim() || serverGemini) : ready),
    isToolLocked: (tool) => {
      if (!tool?.requiresAi) return false;
      if (tool.requiresAi === 'gemini') return !(keys.gemini?.trim() || serverGemini);
      return !ready;
    },
  };
}
