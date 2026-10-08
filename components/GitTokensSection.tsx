'use client';

import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, ExternalLink, Github, Gitlab, Loader2, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/AppContext';
import type { ApiKeys } from '@/lib/downloader';
import { GitProvider, TokenTestResult, checkTokenFormat, testGitToken } from '@/lib/git-token-check';

interface ProviderDef {
  id: GitProvider;
  label: string;
  icon: ComponentType<{ className?: string }>;
  placeholder: string;
  helpUrl: string;
  helpLabel: string;
  help: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'github',
    label: 'GitHub',
    icon: Github,
    placeholder: 'ghp_... hoặc github_pat_...',
    helpUrl: 'https://github.com/settings/tokens',
    helpLabel: 'Tạo token',
    help: 'Cần quyền repo cho kho riêng tư. Tăng giới hạn từ 60 lên 5.000 request/giờ.',
  },
  {
    id: 'gitlab',
    label: 'GitLab',
    icon: Gitlab,
    placeholder: 'glpat-...',
    helpUrl: 'https://gitlab.com/-/profile/personal_access_tokens',
    helpLabel: 'Tạo token',
    help: 'Cần quyền read_api (hoặc read_repository để tải file).',
  },
  {
    id: 'bitbucket',
    label: 'Bitbucket',
    icon: ShieldCheck,
    placeholder: 'username:app_password',
    helpUrl: 'https://bitbucket.org/account/settings/app-passwords/',
    helpLabel: 'Tạo app password',
    help: 'Cần quyền Repositories: Read. Định dạng username:app_password.',
  },
];

function TokenRow({ def }: { def: ProviderDef }) {
  const { keys, updateKey } = useApp();
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TokenTestResult | null>(null);

  const value = (keys as ApiKeys)[def.id] || '';
  const has = !!value.trim();
  const format = checkTokenFormat(def.id, value);
  const Icon = def.icon;

  const run = async () => {
    setTesting(true);
    setResult(null);
    setResult(await testGitToken(def.id, value));
    setTesting(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-8 w-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800">{def.label}</div>
            <div className="text-[11px] text-slate-500 leading-tight">{def.help}</div>
          </div>
        </div>
        <span
          className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            has ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'
          }`}
        >
          {has ? 'Đã lưu' : 'Chưa có'}
        </span>
      </div>

      <div className="flex gap-1.5">
        <Input
          id={`token-${def.id}`}
          aria-label={`${def.label} token`}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => {
            updateKey(def.id, e.target.value);
            setResult(null);
          }}
          placeholder={def.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="text-xs font-mono"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setShow(!show)} title={show ? 'Ẩn token' : 'Hiện token'} className="px-2">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        {has && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              updateKey(def.id, '');
              setResult(null);
            }}
            title="Xóa token đã lưu"
            className="px-2 text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-h-6">
        <a href={def.helpUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
          {def.helpLabel} <ExternalLink className="h-3 w-3" />
        </a>
        {has && (
          <Button type="button" size="xs" variant="outline" onClick={run} disabled={testing}>
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
            Kiểm tra token
          </Button>
        )}
        {has && !format.ok && !result && <span className="text-[11px] text-amber-700">{format.message}</span>}
        {result && (
          <span className={`text-[11px] flex items-start gap-1 ${result.ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {result.ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
            {result.message}
          </span>
        )}
      </div>
    </div>
  );
}

/** Tab "Token Git": mỗi nhà cung cấp một thẻ với trạng thái, ẩn/hiện, kiểm tra và liên kết tạo token. */
export function GitTokensSection() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600 leading-relaxed">
        Token Git là tùy chọn. Có token thì tăng giới hạn API và truy cập được kho riêng tư (private) khi tải file, quét organization và xem repo.
      </p>
      {PROVIDERS.map((p) => (
        <TokenRow key={p.id} def={p} />
      ))}
    </div>
  );
}
