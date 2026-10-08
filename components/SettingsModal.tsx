'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Key } from 'lucide-react';
import { useApp } from '@/components/AppContext';

export function SettingsModal() {
  const { isSettingsOpen, setIsSettingsOpen, keys, updateKey, showToast } = useApp();

  return (
    <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
      <DialogContent className="sm:max-w-[460px] p-6">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Key className="h-5 w-5 text-primary" />
            Cấu hình Token & API Key
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Dùng để tăng giới hạn API rate limit hoặc truy cập repository riêng tư (Private). Token được lưu cục bộ trên trình duyệt của bạn.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-3">
          <div className="grid gap-1.5">
            <Label htmlFor="github" className="text-xs font-medium">GitHub Personal Access Token</Label>
            <Input
              id="github"
              type="password"
              value={keys.github || ''}
              onChange={(e) => updateKey('github', e.target.value)}
              placeholder="ghp_... hoặc github_pat_..."
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Tạo GitHub token
              </a> (cần quyền <code>repo</code> cho kho riêng tư). Tăng limit từ 60 lên 5,000 req/giờ.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="gitlab" className="text-xs font-medium">GitLab Personal Access Token</Label>
            <Input
              id="gitlab"
              type="password"
              value={keys.gitlab || ''}
              onChange={(e) => updateKey('gitlab', e.target.value)}
              placeholder="glpat-..."
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              <a href="https://gitlab.com/-/profile/personal_access_tokens" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Tạo GitLab token
              </a> (cần quyền <code>read_api</code>).
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bitbucket" className="text-xs font-medium">Bitbucket App Password</Label>
            <Input
              id="bitbucket"
              type="password"
              value={keys.bitbucket || ''}
              onChange={(e) => updateKey('bitbucket', e.target.value)}
              placeholder="username:app_password"
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              <a href="https://bitbucket.org/account/settings/app-passwords/" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Tạo Bitbucket app password
              </a> (cần quyền <code>Repositories: Read</code>). Định dạng <code>username:password</code>.
            </p>
          </div>

          <div className="grid gap-1.5 pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <Label htmlFor="gemini" className="text-xs font-medium flex items-center gap-1.5">
                <span>Google Gemini API Key</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200/50">Tùy chọn</span>
              </Label>
            </div>
            <Input
              id="gemini"
              type="password"
              value={keys.gemini || ''}
              onChange={(e) => updateKey('gemini', e.target.value)}
              placeholder="AIzaSy..."
              className="text-xs font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Dùng cho AI Neural Text-to-Speech (TTS). Lấy miễn phí tại{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Google AI Studio
              </a>.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t">
          <Button 
            size="sm" 
            onClick={() => {
              setIsSettingsOpen(false);
              showToast('Cài đặt đã được lưu!');
            }}
          >
            Đóng & Lưu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
