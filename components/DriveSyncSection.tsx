'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CloudDownload, CloudUpload, Loader2, LogOut, RefreshCw, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/AppContext';
import {
  connectDrive,
  deleteDriveData,
  disconnectDrive,
  getDriveSyncSnapshot,
  getServerDriveSyncSnapshot,
  initDriveSync,
  setDriveSyncOption,
  subscribeDriveSync,
  syncDrive,
  undoLastDriveSync,
} from '@/lib/drive-sync-client';
import type { SyncDirection } from '@/lib/drive-sync';

function DriveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" className={className} aria-hidden="true">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'chưa đồng bộ';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return new Date(iso).toLocaleString('vi-VN');
}

const RESULT_TEXT: Record<SyncDirection, string> = {
  sync: 'Đã đồng bộ',
  push: 'Đã ghi đè bản trên Drive',
  pull: 'Đã lấy bản trên Drive về máy',
};

/** Thẻ "Đồng bộ Google Drive" trong Cài đặt → Dữ liệu */
export function DriveSyncSection() {
  const { showToast } = useApp();
  const s = useSyncExternalStore(subscribeDriveSync, getDriveSyncSnapshot, getServerDriveSyncSnapshot);
  const [confirm, setConfirm] = useState<'push' | 'pull' | 'delete' | null>(null);
  const [, setNow] = useState(0);

  useEffect(() => {
    initDriveSync();
    const id = setInterval(() => setNow((n) => n + 1), 30_000); // cập nhật "x phút trước"
    return () => clearInterval(id);
  }, []);

  const busy = s.status !== 'idle';
  const ready = s.setup === 'ready';

  // Các hàm gọi Google phải chạy ngay trong sự kiện click để popup đăng nhập không bị chặn
  const run = (p: Promise<void>, done?: () => string) =>
    p.then(() => done && showToast(done())).catch(() => { /* lỗi đã hiện trong thẻ */ });

  const doSync = (direction: SyncDirection) => {
    setConfirm(null);
    run(syncDrive(direction), () => {
      const r = getDriveSyncSnapshot().lastResult;
      return r ? `${RESULT_TEXT[r.direction]}: ${r.pulled} mục cập nhật trên máy, ${r.pushed} mục lên Drive.` : 'Đã đồng bộ.';
    });
  };

  const askOrRun = (kind: 'push' | 'pull' | 'delete') => {
    if (confirm !== kind) {
      setConfirm(kind);
      setTimeout(() => setConfirm((c) => (c === kind ? null : c)), 5000);
      return;
    }
    if (kind === 'delete') {
      setConfirm(null);
      run(deleteDriveData(), () => 'Đã xóa dữ liệu đồng bộ trên Drive.');
    } else doSync(kind);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <DriveIcon className="h-4 w-4" /> Đồng bộ Google Drive
        </div>
        {s.connected && (
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${s.needsAuth ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {s.needsAuth ? 'Cần kết nối lại' : 'Đã kết nối'}
          </span>
        )}
      </div>

      {s.setup === 'loading' && (
        <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang chuẩn bị…</p>
      )}

      {s.setup === 'unconfigured' && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
          <div className="font-medium text-slate-700">Máy chủ chưa bật tính năng này</div>
          <div>
            Người quản trị cần tạo OAuth Client ID trên Google Cloud và đặt biến môi trường <code>GOOGLE_CLIENT_ID</code>, rồi khởi động lại
            ứng dụng. Xem hướng dẫn trong <code>docs/google-drive-sync.md</code>.
          </div>
        </div>
      )}

      {s.setup === 'error' && (
        <div role="alert" className="flex gap-2 rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {s.setupError}
        </div>
      )}

      {ready && !s.connected && (
        <>
          <p className="text-xs text-slate-500">
            Lưu cài đặt, snippets, dấu trang, checklist… vào Google Drive của bạn và tự đồng bộ giữa các máy. Dữ liệu nằm trong thư mục ẩn
            dành riêng cho GeTools: ứng dụng <strong>không</strong> đọc được file nào khác trong Drive của bạn.
          </p>
          <Button size="sm" onClick={() => run(connectDrive(), () => 'Đã kết nối và đồng bộ với Google Drive.')} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DriveIcon className="h-3.5 w-3.5" />}
            Kết nối Google Drive
          </Button>
        </>
      )}

      {ready && s.connected && (
        <>
          <div className="text-xs text-slate-600">
            {s.email ? <span className="font-medium">{s.email}</span> : 'Tài khoản Google'} · đồng bộ lần cuối: {timeAgo(s.lastSyncAt)}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => doSync('sync')} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {s.status === 'authorizing' ? 'Đang đăng nhập…' : s.status === 'syncing' ? 'Đang đồng bộ…' : s.needsAuth ? 'Kết nối lại & đồng bộ' : 'Đồng bộ ngay'}
            </Button>
            {s.canUndo && (
              <Button size="sm" variant="outline" onClick={() => showToast(`Đã hoàn tác ${undoLastDriveSync()} mục.`)} disabled={busy}>
                <RotateCcw className="h-3.5 w-3.5" /> Hoàn tác lần đồng bộ
              </Button>
            )}
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={s.auto} onChange={(e) => setDriveSyncOption({ auto: e.target.checked })} />
            <span>
              <span className="font-medium">Tự động đồng bộ</span>
              <span className="block text-slate-500">Đẩy lên vài giây sau khi dữ liệu đổi, kéo bản mới khi quay lại tab. Phiên Google hết hạn sau ~1 giờ thì cần bấm kết nối lại.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-red-700">
            <input type="checkbox" className="mt-0.5" checked={s.includeSecrets} onChange={(e) => setDriveSyncOption({ includeSecrets: e.target.checked })} />
            <span>
              <span className="font-medium">Đồng bộ cả khóa API / token Git</span>
              <span className="block text-slate-500">Mặc định tắt: khóa chỉ nằm trên máy này.</span>
            </span>
          </label>
          {s.includeSecrets && (
            <div role="alert" className="flex gap-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-800">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              Khóa sẽ được lưu dạng văn bản thuần trong Drive của bạn. Chỉ bật trên máy cá nhân và tài khoản Google có bật xác minh 2 bước.
            </div>
          )}

          {s.error && (
            <div role="alert" className="flex gap-2 rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {s.error}
            </div>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-700">Tùy chọn nâng cao</summary>
            <div className="mt-2 space-y-2">
              <p className="text-slate-500">
                &quot;Đồng bộ ngay&quot; tự gộp thay đổi của các máy. Dùng các nút dưới khi muốn một bên thắng hoàn toàn.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => askOrRun('push')} disabled={busy} className={confirm === 'push' ? 'text-amber-700 border-amber-300' : ''}>
                  <CloudUpload className="h-3.5 w-3.5" /> {confirm === 'push' ? 'Bấm lần nữa để ghi đè Drive' : 'Ghi đè Drive bằng máy này'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => askOrRun('pull')} disabled={busy} className={confirm === 'pull' ? 'text-amber-700 border-amber-300' : ''}>
                  <CloudDownload className="h-3.5 w-3.5" /> {confirm === 'pull' ? 'Bấm lần nữa để thay dữ liệu máy này' : 'Thay máy này bằng bản Drive'}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => askOrRun('delete')} disabled={busy} className={confirm === 'delete' ? 'text-red-700 bg-red-50' : 'text-slate-600'}>
                  <Trash2 className="h-3.5 w-3.5" /> {confirm === 'delete' ? 'Bấm lần nữa để xóa trên Drive' : 'Xóa dữ liệu trên Drive'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(disconnectDrive(), () => 'Đã ngắt kết nối Google Drive.')} disabled={busy} className="text-slate-600">
                  <LogOut className="h-3.5 w-3.5" /> Ngắt kết nối
                </Button>
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
