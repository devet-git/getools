'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, FileUp, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/AppContext';
import { DriveSyncSection } from '@/components/DriveSyncSection';
import { notifyStorageSync, subscribeStorageSync } from '@/lib/storage';
import {
  GROUP_LABELS,
  MAX_BACKUP_FILE_BYTES,
  applyPlan,
  applyUndo,
  backupFileName,
  buildBackup,
  clearAppData,
  formatBytes,
  parseBackup,
  planImport,
  summarize,
  type BackupFile,
  type BackupGroup,
  type GroupSummary,
  type ImportMode,
  type StorageLike,
  type UndoSnapshot,
} from '@/lib/backup';

const GROUPS: BackupGroup[] = ['settings', 'data', 'secrets'];

function getStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const EMPTY_SUMMARY: Record<BackupGroup, GroupSummary> = {
  settings: { group: 'settings', keys: 0, items: 0, bytes: 0 },
  data: { group: 'data', keys: 0, items: 0, bytes: 0 },
  secrets: { group: 'secrets', keys: 0, items: 0, bytes: 0 },
};

const STATUS_LABEL = { added: 'thêm mới', overwritten: 'ghi đè', unchanged: 'không đổi' } as const;

export function BackupSection() {
  const { showToast } = useApp();
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [exp, setExp] = useState({ settings: true, data: true, secrets: false });

  const [backup, setBackup] = useState<BackupFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [ignored, setIgnored] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [imp, setImp] = useState({ settings: true, data: true, secrets: false });
  const [undo, setUndo] = useState<UndoSnapshot | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [tick, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    const st = getStorage();
    setSummary(st ? summarize(st) : EMPTY_SUMMARY);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    refresh();
    return subscribeStorageSync(refresh);
  }, [refresh]);

  const plan = useMemo(() => {
    const st = getStorage();
    if (!backup || !st) return null;
    return planImport(st, backup, { mode, ...imp });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backup, mode, imp, tick]);

  const doExport = () => {
    const st = getStorage();
    if (!st) {
      showToast('Không truy cập được bộ nhớ trình duyệt.');
      return;
    }
    const data = buildBackup(st, exp);
    const n = Object.keys(data.entries).length;
    if (n === 0) {
      showToast('Không có dữ liệu nào để sao lưu.');
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Đã xuất ${n} mục dữ liệu.`);
  };

  const onFile = async (file: File | undefined) => {
    setError('');
    setBackup(null);
    setIgnored([]);
    if (!file) return;
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setError('Tệp quá lớn (tối đa 10MB).');
      return;
    }
    try {
      const res = parseBackup(await file.text());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBackup(res.backup);
      setIgnored(res.ignoredKeys);
      setFileName(file.name);
      setImp({ settings: true, data: true, secrets: false });
    } catch {
      setError('Không đọc được tệp.');
    }
  };

  const doImport = () => {
    const st = getStorage();
    if (!st || !plan) return;
    const res = applyPlan(st, plan);
    notifyStorageSync();
    if (res.written > 0) setUndo(res.undo);
    refresh();
    showToast(
      res.failed.length
        ? `Đã áp dụng ${res.written} mục, ${res.failed.length} mục lỗi (bộ nhớ đầy?).`
        : res.written
          ? `Đã nhập ${res.written} mục dữ liệu.`
          : 'Không có gì thay đổi.',
    );
    setBackup(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const doUndo = () => {
    const st = getStorage();
    if (!st || !undo) return;
    const n = applyUndo(st, undo);
    notifyStorageSync();
    setUndo(null);
    refresh();
    showToast(`Đã hoàn tác ${n} mục.`);
  };

  const doClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    const st = getStorage();
    if (!st) return;
    const res = clearAppData(st);
    notifyStorageSync();
    setConfirmClear(false);
    if (res.removed > 0) setUndo(res.undo);
    refresh();
    showToast(`Đã xóa ${res.removed} mục dữ liệu ứng dụng (giữ lại khóa/token).`);
  };

  const planTotals = plan
    ? plan.items.reduce(
        (acc, i) => {
          acc[i.status]++;
          return acc;
        },
        { added: 0, overwritten: 0, unchanged: 0 },
      )
    : null;

  return (
    <div className="space-y-5 text-sm">
      <DriveSyncSection />

      {/* XUẤT */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <Download className="h-4 w-4 text-indigo-600" /> Sao lưu dữ liệu
        </div>
        <p className="text-xs text-slate-500">
          Xuất cài đặt và dữ liệu của bạn ra tệp JSON <code>getools-backup-YYYY-MM-DD.json</code> để chuyển sang trình duyệt khác.
        </p>
        <div className="space-y-1.5">
          {GROUPS.filter((g) => g !== 'secrets').map((g) => (
            <label key={g} className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={exp[g]} onChange={(e) => setExp({ ...exp, [g]: e.target.checked })} />
              <span className="font-medium">{GROUP_LABELS[g]}</span>
              <span className="text-slate-500">
                {summary[g].items} mục · {formatBytes(summary[g].bytes)}
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-xs text-red-700">
            <input type="checkbox" checked={exp.secrets} onChange={(e) => setExp({ ...exp, secrets: e.target.checked })} />
            <span className="font-medium">Bao gồm khóa API / token (không khuyến nghị)</span>
            <span className="text-slate-500">
              {summary.secrets.items} khóa · {formatBytes(summary.secrets.bytes)}
            </span>
          </label>
        </div>
        {exp.secrets && (
          <div role="alert" className="flex gap-2 rounded-lg border-2 border-red-300 bg-red-50 p-3 text-red-800">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <div className="text-xs space-y-1">
              <div className="text-sm font-bold">Cảnh báo: tệp sẽ chứa khóa dạng văn bản thuần</div>
              <div>
                Bất kỳ ai có tệp này đều dùng được token Git và khóa AI của bạn. Không chia sẻ, không đưa lên kho mã hay dịch vụ lưu trữ công khai.
              </div>
            </div>
          </div>
        )}
        <Button size="sm" onClick={doExport} disabled={!exp.settings && !exp.data && !exp.secrets}>
          <Download className="h-3.5 w-3.5" /> Tải tệp sao lưu
        </Button>
      </section>

      {/* NHẬP */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <FileUp className="h-4 w-4 text-indigo-600" /> Khôi phục từ tệp
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-200 file:bg-slate-50 file:px-3 file:py-1.5 file:text-xs file:font-medium"
        />
        <p className="text-[11px] text-slate-500">Tối đa 10MB. Chỉ các khóa dữ liệu của Getools được chấp nhận; nội dung không bao giờ được thực thi.</p>
        {error && (
          <div role="alert" className="flex gap-2 rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        {backup && plan && planTotals && (
          <div className="space-y-3">
            <div className="text-xs text-slate-600">
              Tệp <span className="font-medium">{fileName}</span>
              {backup.exportedAt && ` · xuất lúc ${backup.exportedAt.replace('T', ' ').slice(0, 16)}`}
              {backup.includesSecrets && <span className="text-red-600"> · có chứa khóa API</span>}
            </div>
            {ignored.length > 0 && (
              <div className="text-[11px] text-amber-700">Bỏ qua {ignored.length} khóa không được hỗ trợ.</div>
            )}
            <div className="flex gap-3 text-xs">
              {(['merge', 'replace'] as ImportMode[]).map((m) => (
                <label key={m} className="flex items-center gap-1.5">
                  <input type="radio" name="backup-mode" checked={mode === m} onChange={() => setMode(m)} />
                  {m === 'merge' ? 'Gộp' : 'Thay thế'}
                </label>
              ))}
            </div>
            <div className="text-[11px] text-slate-500">
              {mode === 'merge'
                ? 'Gộp: snippets theo id, yêu thích hợp nhất, lịch sử loại trùng; cài đặt dạng đối tượng được trộn.'
                : 'Thay thế: ghi đè giá trị của từng mục có trong tệp bằng nội dung trong tệp.'}
            </div>
            <div className="space-y-1.5">
              {GROUPS.map((g) => {
                const present = g === 'secrets' ? Object.keys(backup.entries).some((k) => k === 'git_downloader_keys' || k === 'getools_ai_settings') : plan.counts[g].added + plan.counts[g].overwritten + plan.counts[g].unchanged > 0;
                if (!present) return null;
                const c = plan.counts[g];
                return (
                  <label key={g} className={`flex items-center gap-2 text-xs ${g === 'secrets' ? 'text-red-700' : 'text-slate-700'}`}>
                    <input type="checkbox" checked={imp[g]} onChange={(e) => setImp({ ...imp, [g]: e.target.checked })} />
                    <span className="font-medium">{g === 'secrets' ? 'Áp dụng khóa API / token trong tệp' : GROUP_LABELS[g]}</span>
                    {g !== 'secrets' && (
                      <span className="text-slate-500">
                        {c.added} thêm · {c.overwritten} ghi đè · {c.unchanged} không đổi
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            {plan.items.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 text-[11px]">
                {plan.items.map((i) => (
                  <li key={i.key} className="flex justify-between gap-2 px-2 py-1">
                    <span className="truncate text-slate-700">{i.label}</span>
                    <span className={i.status === 'overwritten' ? 'text-amber-700' : i.status === 'added' ? 'text-emerald-700' : 'text-slate-400'}>
                      {STATUS_LABEL[i.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {imp.secrets && (
              <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-800">
                Các khóa / token hiện có trong trình duyệt sẽ bị thay bằng giá trị trong tệp.
              </div>
            )}
            <Button size="sm" onClick={doImport} disabled={planTotals.added + planTotals.overwritten === 0}>
              Áp dụng ({planTotals.added + planTotals.overwritten} mục)
            </Button>
          </div>
        )}
        {undo && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs">
            <span className="text-slate-600">Vừa thay đổi {Object.keys(undo).length} mục. Có thể hoàn tác trong phiên này.</span>
            <Button size="sm" variant="outline" onClick={doUndo}>
              <RotateCcw className="h-3.5 w-3.5" /> Hoàn tác
            </Button>
          </div>
        )}
      </section>

      {/* XÓA */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <Trash2 className="h-4 w-4 text-red-600" /> Xóa dữ liệu ứng dụng
        </div>
        <p className="text-xs text-slate-500">
          Xóa cài đặt, snippets, dấu trang, lịch sử và bản nháp. Khóa API / token được giữ nguyên (dùng nút &quot;Xóa tất cả khóa&quot; để xóa).
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={doClear}
          className={confirmClear ? 'text-red-700 bg-red-50 hover:bg-red-100' : 'text-slate-600'}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {confirmClear ? 'Bấm lần nữa để xóa' : 'Xóa dữ liệu ứng dụng'}
        </Button>
      </section>
    </div>
  );
}
