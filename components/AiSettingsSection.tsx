'use client';

import { useState } from 'react';
import { Check, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useAiSettings } from '@/lib/use-ai-config';
import { AI_PROVIDERS, AiProvider, PROVIDER_INFO } from '@/lib/ai-providers';
import { aiHeaders } from '@/lib/ai-client';

type TestState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; model: string } | { status: 'error'; message: string };

/** Phần "Khóa AI" trong hộp thoại Cài đặt: chọn nhà cung cấp, nhập khóa / model, kiểm tra khóa. */
export function AiSettingsSection() {
  const ai = useAiSettings();
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  const provider = ai.settings.provider;
  const info = PROVIDER_INFO[provider];
  const key = ai.keyFor(provider);
  const model = ai.settings.models[provider] || '';

  const selectProvider = (p: AiProvider) => {
    ai.setProvider(p);
    setTest({ status: 'idle' });
    setShow(false);
  };

  const runTest = async () => {
    setTest({ status: 'loading' });
    try {
      const res = await fetch('/api/ai/test', { method: 'POST', headers: aiHeaders(ai.config) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; model?: string };
      if (res.ok && data.ok) setTest({ status: 'ok', model: data.model || ai.config.model || info.defaultModel });
      else setTest({ status: 'error', message: data.error || 'Không kiểm tra được khóa. Vui lòng thử lại.' });
    } catch {
      setTest({ status: 'error', message: 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.' });
    }
  };

  return (
    <div className="grid gap-2.5 pt-1 border-t border-slate-100">
      <div className="flex items-center gap-2">
        <Label className="text-xs font-medium">Khóa AI của bạn</Label>
        <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200/50">Tùy chọn</span>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Dùng cho các tool AI (tóm tắt, dịch, OCR, commit message). Chọn nhà cung cấp rồi dán khóa của bạn.
      </p>

      {/* Chọn nhà cung cấp */}
      <div className="grid grid-cols-2 gap-1.5">
        {AI_PROVIDERS.map((p) => {
          const hasKey = !!ai.keyFor(p).trim();
          const active = p === provider;
          return (
            <button
              key={p}
              type="button"
              onClick={() => selectProvider(p)}
              aria-pressed={active}
              className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium text-left transition ${
                active ? 'border-indigo-400 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-300' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="truncate">{PROVIDER_INFO[p].label}</span>
              {hasKey && <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-label="Đã có khóa" />}
            </button>
          );
        })}
      </div>

      {/* Khóa */}
      <div className="grid gap-1.5">
        <Label htmlFor="ai-key" className="text-xs font-medium">API Key — {info.label}</Label>
        <div className="flex gap-1.5">
          <Input
            id="ai-key"
            type={show ? 'text' : 'password'}
            value={key}
            onChange={(e) => {
              ai.setKey(provider, e.target.value);
              setTest({ status: 'idle' });
            }}
            placeholder={info.keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className="text-xs font-mono"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setShow(!show)} title={show ? 'Ẩn khóa' : 'Hiện khóa'} className="px-2">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          {key && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                ai.setKey(provider, '');
                setTest({ status: 'idle' });
              }}
              title="Xóa khóa đã lưu"
              className="px-2 text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Base URL (tùy chỉnh) */}
      {provider === 'custom' && (
        <div className="grid gap-1.5">
          <Label htmlFor="ai-base" className="text-xs font-medium">Base URL</Label>
          <Input
            id="ai-base"
            value={ai.settings.customBaseUrl}
            onChange={(e) => {
              ai.setCustomBaseUrl(e.target.value);
              setTest({ status: 'idle' });
            }}
            placeholder="https://openrouter.ai/api/v1"
            autoComplete="off"
            spellCheck={false}
            className="text-xs font-mono"
          />
          <p className="text-[11px] text-muted-foreground">Chỉ nhận địa chỉ https công khai; địa chỉ nội bộ (localhost, mạng LAN) bị chặn.</p>
        </div>
      )}

      {/* Model */}
      <div className="grid gap-1.5">
        <Label htmlFor="ai-model" className="text-xs font-medium">
          Model {provider !== 'custom' && <span className="text-muted-foreground font-normal">(để trống = {info.defaultModel})</span>}
        </Label>
        <Input
          id="ai-model"
          list="ai-model-suggestions"
          value={model}
          onChange={(e) => {
            ai.setModel(provider, e.target.value);
            setTest({ status: 'idle' });
          }}
          placeholder={info.defaultModel || 'Tên model, ví dụ: openai/gpt-4o-mini'}
          autoComplete="off"
          spellCheck={false}
          className="text-xs font-mono"
        />
        <datalist id="ai-model-suggestions">
          {info.suggestedModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      {/* Ghi chú + liên kết lấy khóa */}
      <p className="text-[11px] text-muted-foreground">
        {info.keyUrl && (
          <>
            Lấy khóa tại{' '}
            <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{info.keyUrlLabel}</a>.{' '}
          </>
        )}
        {info.note}
      </p>

      {/* Kiểm tra */}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={runTest} disabled={!ai.ready || test.status === 'loading'}>
          {test.status === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Kiểm tra khóa
        </Button>
        {test.status === 'ok' && (
          <span className="text-[11px] text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Hoạt động tốt (model {test.model})
          </span>
        )}
        {test.status === 'error' && (
          <span className="text-[11px] text-red-700 flex items-start gap-1">
            <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {test.message}
          </span>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Khóa chỉ được lưu trong trình duyệt này. Khi dùng tool AI, khóa và nội dung của bạn được gửi qua máy chủ của ứng dụng để chuyển tiếp tới nhà cung cấp; máy chủ không lưu và không ghi log chúng.
      </p>
    </div>
  );
}
