'use client';

import { useState } from 'react';
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Trash2, XCircle } from 'lucide-react';
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

  const activeModel = ai.config.model || info.defaultModel || '(chưa chọn)';

  return (
    <div className="space-y-4">
      {/* Trạng thái hiện tại */}
      <div
        className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs ${
          ai.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'
        }`}
      >
        {ai.ready ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" /> : <KeyRound className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />}
        <div className="min-w-0">
          <div className="font-semibold">
            {ai.ready ? 'Sẵn sàng dùng các tool AI' : 'Chưa thể dùng các tool AI'}
          </div>
          <div className="text-[11px] opacity-80 leading-relaxed">
            Đang chọn <b>{info.label}</b> · model <code className="font-mono">{activeModel}</code>
            {!ai.ready && ' — nhập khóa bên dưới để mở khóa các tool AI.'}
          </div>
        </div>
      </div>

      {/* Chọn nhà cung cấp */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-slate-700">Nhà cung cấp</Label>
        <div role="radiogroup" aria-label="Nhà cung cấp AI" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {AI_PROVIDERS.map((p) => {
            const hasKey = !!ai.keyFor(p).trim();
            const active = p === provider;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => selectProvider(p)}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition ${
                  active ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 ${active ? 'border-indigo-600 bg-indigo-600 ring-2 ring-white ring-inset' : 'border-slate-300'}`} />
                  <span className={`text-xs font-semibold truncate ${active ? 'text-indigo-800' : 'text-slate-700'}`}>{PROVIDER_INFO[p].label}</span>
                </span>
                <span
                  className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                    hasKey ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'
                  }`}
                >
                  {hasKey ? 'Đã có khóa' : 'Chưa có'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cấu hình của nhà cung cấp đang chọn */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">{info.label}</div>
          {info.keyUrl && (
            <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
              Lấy khóa tại {info.keyUrlLabel} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ai-key" className="text-xs font-medium">API Key</Label>
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

        {info.note && <p className="text-[11px] text-muted-foreground leading-relaxed">{info.note}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
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
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Khi dùng tool AI, khóa và nội dung của bạn được gửi qua máy chủ của ứng dụng để chuyển tiếp tới nhà cung cấp; máy chủ không lưu và không ghi log chúng.
      </p>
    </div>
  );
}
