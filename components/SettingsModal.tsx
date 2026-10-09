'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Database, GitBranch, Settings, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useApp, type SettingsTab } from '@/components/AppContext';
import { AiSettingsSection } from '@/components/AiSettingsSection';
import { BackupSection } from '@/components/BackupSection';
import { GitTokensSection } from '@/components/GitTokensSection';
import { useAiSettings } from '@/lib/use-ai-config';
import { AI_PROVIDERS } from '@/lib/ai-providers';
import { notifyStorageSync } from '@/lib/storage';

const TABS: { id: SettingsTab; label: string; icon: typeof GitBranch }[] = [
  { id: 'git', label: 'Token Git', icon: GitBranch },
  { id: 'ai', label: 'Khóa AI', icon: Sparkles },
  { id: 'data', label: 'Dữ liệu', icon: Database },
];

export function SettingsModal() {
  const { isSettingsOpen, setIsSettingsOpen, settingsTab, setSettingsTab, keys, showToast } = useApp();
  const ai = useAiSettings();
  const [confirmClear, setConfirmClear] = useState(false);
  const { openSettings } = useApp();

  // Cho phép mở Cài đặt từ nơi khác (Ctrl+K...) qua sự kiện, tùy chọn kèm tab
  useEffect(() => {
    const onOpen = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: SettingsTab }>).detail?.tab;
      openSettings(tab);
    };
    window.addEventListener('getools:open-settings', onOpen);
    return () => window.removeEventListener('getools:open-settings', onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gitCount = [keys.github, keys.gitlab, keys.bitbucket].filter((k) => k?.trim()).length;
  const aiCount = AI_PROVIDERS.filter((p) => ai.keyFor(p).trim()).length;
  const counts: Record<SettingsTab, string> = { git: `${gitCount}/3`, ai: `${aiCount}/${AI_PROVIDERS.length}`, data: '' };

  const clearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    try {
      localStorage.removeItem('git_downloader_keys');
      localStorage.removeItem('getools_ai_settings');
    } catch {
      /* bỏ qua */
    }
    notifyStorageSync();
    setConfirmClear(false);
    showToast('Đã xóa toàn bộ token và khóa AI khỏi trình duyệt này.');
  };

  return (
    <Dialog
      open={isSettingsOpen}
      onOpenChange={(open) => {
        setIsSettingsOpen(open);
        if (!open) setConfirmClear(false);
      }}
    >
      <DialogContent className="sm:max-w-xl p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 space-y-1 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <span className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Settings className="h-4 w-4" />
            </span>
            Cài đặt
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Token Git và khóa AI của riêng bạn. Mọi thay đổi được lưu tự động, chỉ trên trình duyệt này.
          </DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="Nhóm cài đặt" className="px-6 flex gap-1 border-b border-slate-200 shrink-0">
          {TABS.map((t) => {
            const active = settingsTab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setSettingsTab(t.id)}
                className={`-mb-px flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                  active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {counts[t.id] && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                    {counts[t.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" className="flex-1 overflow-y-auto px-6 py-4">
          {settingsTab === 'git' ? <GitTokensSection /> : settingsTab === 'ai' ? <AiSettingsSection /> : <BackupSection />}
        </div>

        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-6 py-3 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Lưu cục bộ, không gửi lên máy chủ GeTools
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clearAll}
              className={confirmClear ? 'text-red-700 bg-red-50 hover:bg-red-100' : 'text-slate-600'}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmClear ? 'Bấm lần nữa để xóa hết' : 'Xóa tất cả khóa'}
            </Button>
            <Button size="sm" onClick={() => setIsSettingsOpen(false)}>
              Xong
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
