'use client';

import { useState, useMemo, useSyncExternalStore, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  Download, 
  FolderDown, 
  Github, 
  Gitlab, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  Search, 
  Star, 
  FileArchive, 
  ChevronDown, 
  ChevronUp, 
  Clock, 
  Package, 
  RotateCcw,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  downloadFromUrl, 
  DownloadProgress, 
  parseUrl, 
  ZipOptions, 
  generateSmartZipName,
  formatBytes 
} from '@/lib/downloader';
import { 
  HistoryItem, 
  addHistoryItem, 
  toggleBookmarkItem,
  subscribeStorageSync,
  notifyStorageSync,
} from '@/lib/storage';
import { useApp } from '@/components/AppContext';
import Link from 'next/link';
import { toolHref } from '@/lib/tools';

const DEFAULT_ZIP_OPTIONS: ZipOptions = {
  namingRule: 'smart',
  customFilename: '',
  preserveStructure: false,
  compressionLevel: 6,
};

const emptyArrayString = () => '[]';
const emptyString = () => '';

function getZipOptionsSnapshot(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem('git_downloader_zip_options') || '';
  } catch {
    return '';
  }
}

function getBookmarksSnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  try {
    return localStorage.getItem('git_downloader_bookmarks') || '[]';
  } catch {
    return '[]';
  }
}

function getHistorySnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  try {
    return localStorage.getItem('git_downloader_history') || '[]';
  } catch {
    return '[]';
  }
}

function DownloaderContent() {
  const searchParams = useSearchParams();
  const initialUrl = searchParams.get('url') || '';

  const { keys, showToast, setIsHistoryModalOpen, setHistoryModalTab } = useApp();
  const [url, setUrl] = useState(initialUrl);

  const prevUrlParam = searchParams.get('url');
  const [prevParam, setPrevParam] = useState(prevUrlParam);
  if (prevUrlParam !== prevParam) {
    setPrevParam(prevUrlParam);
    if (prevUrlParam) {
      setUrl(prevUrlParam);
    }
  }

  // ZIP Options
  const rawZipOptions = useSyncExternalStore(subscribeStorageSync, getZipOptionsSnapshot, emptyString);
  const zipOptions: ZipOptions = useMemo(() => {
    if (!rawZipOptions) return DEFAULT_ZIP_OPTIONS;
    try {
      return JSON.parse(rawZipOptions);
    } catch {
      return DEFAULT_ZIP_OPTIONS;
    }
  }, [rawZipOptions]);

  const updateZipOptions = (updates: Partial<ZipOptions>) => {
    const next = { ...zipOptions, ...updates };
    if (typeof window !== 'undefined') {
      localStorage.setItem('git_downloader_zip_options', JSON.stringify(next));
      notifyStorageSync();
    }
  };

  const [isZipOptionsOpen, setIsZipOptionsOpen] = useState(false);

  // Bookmarks & History local state for quick access
  const rawBookmarks = useSyncExternalStore(subscribeStorageSync, getBookmarksSnapshot, emptyArrayString);
  const bookmarks: HistoryItem[] = useMemo(() => {
    try {
      const parsed = JSON.parse(rawBookmarks);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [rawBookmarks]);

  const rawHistory = useSyncExternalStore(subscribeStorageSync, getHistorySnapshot, emptyArrayString);
  const recentHistory: HistoryItem[] = useMemo(() => {
    try {
      const parsed = JSON.parse(rawHistory);
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
    } catch {
      return [];
    }
  }, [rawHistory]);

  const [progress, setProgress] = useState<DownloadProgress>({
    status: 'idle',
    message: '',
    progress: 0,
  });

  const parsed = useMemo(() => parseUrl(url), [url]);
  const isValid = parsed !== null;

  const isCurrentUrlBookmarked = useMemo(() => {
    if (!url) return false;
    return bookmarks.some(b => b.url === url.trim() && b.isBookmarked);
  }, [url, bookmarks]);

  const previewZipName = useMemo(() => {
    if (!parsed) return null;
    return generateSmartZipName(parsed, zipOptions);
  }, [parsed, zipOptions]);

  const handleToggleBookmarkCurrent = () => {
    if (!url) return;
    const cleanUrl = url.trim();
    const existing = bookmarks.find(b => b.url === cleanUrl);

    if (existing) {
      toggleBookmarkItem(existing);
      showToast('Đã bỏ ghim bookmark!');
    } else {
      addHistoryItem({
        url: cleanUrl,
        provider: parsed?.provider || 'github',
        type: parsed?.type === 'file' ? 'file' : 'folder',
        name: parsed?.path ? parsed.path.split('/').pop() || parsed.repo : (parsed?.repo || 'Repo folder'),
        repoName: parsed ? `${parsed.owner}/${parsed.repo}` : undefined,
        branch: parsed?.branch,
        isBookmarked: true,
      });
      showToast('Đã thêm vào Bookmark yêu thích ★!');
    }
  };

  const handleDownload = async () => {
    if (!url) return;

    try {
      setProgress({
        status: 'fetching_metadata',
        message: 'Đang chuẩn bị và phân tích đường dẫn...',
        progress: 0,
      });

      await downloadFromUrl(url, setProgress, keys, zipOptions);

      const targetName = previewZipName || (parsed?.path ? parsed.path.split('/').pop() || parsed.repo : (parsed?.repo || 'download.zip'));

      addHistoryItem({
        url: url.trim(),
        provider: parsed?.provider || 'github',
        type: parsed?.type === 'file' ? 'file' : 'folder',
        name: targetName,
        repoName: parsed ? `${parsed.owner}/${parsed.repo}` : undefined,
        branch: parsed?.branch,
      });
      showToast(`Đã tải xuống thành công file ${targetName}!`);
    } catch (error: unknown) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Có lỗi không xác định xảy ra khi tải';
      setProgress({
        status: 'error',
        message: errorMessage,
        progress: 0,
      });
    }
  };

  return (
    <div className="space-y-3.5">
      {/* COMPACT TOP BANNER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
            <FolderDown className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight">
                Tải Thư Mục & File Git
              </h1>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                GitHub · GitLab · Bitbucket
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Tải thư mục con hoặc file lẻ thành file ZIP tùy chỉnh hoặc tải trực tiếp
            </p>
          </div>
        </div>

        {/* Quick action button to Bookmarks modal */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setHistoryModalTab('bookmarks');
              setIsHistoryModalOpen(true);
            }}
            className="text-xs h-7.5 bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 hover:text-white"
          >
            <Star className="h-3 w-3 mr-1 text-amber-400 fill-amber-400" />
            Bookmarks ({bookmarks.length})
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setHistoryModalTab('history');
              setIsHistoryModalOpen(true);
            }}
            className="text-xs h-7.5 bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 hover:text-white"
          >
            <Clock className="h-3 w-3 mr-1 text-slate-300" />
            Lịch sử
          </Button>
        </div>
      </div>

      {/* Main Download Card */}
      <div className="bg-white rounded-xl border border-border shadow-xs p-5 sm:p-6 space-y-4">
        <div className="space-y-3">
          <label className="text-xs font-semibold text-slate-700 block">
            Nhập liên kết Repository, Thư mục hoặc File:
          </label>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="https://github.com/owner/repo/tree/main/path/to/folder"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isValid) handleDownload();
                }}
                className="pr-10 text-xs sm:text-sm font-mono"
                disabled={progress.status !== 'idle' && progress.status !== 'done' && progress.status !== 'error'}
              />
              {url && (
                <button
                  type="button"
                  onClick={handleToggleBookmarkCurrent}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-amber-500 transition-colors"
                  title={isCurrentUrlBookmarked ? "Bỏ ghim khỏi Bookmark" : "Ghim vào Bookmark yêu thích"}
                >
                  <Star className={`h-4 w-4 ${isCurrentUrlBookmarked ? 'text-amber-500 fill-amber-500' : ''}`} />
                </button>
              )}
            </div>

            <Button 
              onClick={handleDownload} 
              disabled={!url || !isValid || (progress.status !== 'idle' && progress.status !== 'done' && progress.status !== 'error')}
              className="sm:w-36 shrink-0"
            >
              {progress.status === 'fetching_metadata' || progress.status === 'downloading' || progress.status === 'zipping' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Tải Về ZIP
            </Button>
          </div>

          {/* Quick Access / Bookmarked Chips */}
          {(bookmarks.length > 0 || recentHistory.length > 0) && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium flex items-center gap-1 text-[11px] text-slate-500">
                  <Sparkles className="h-3 w-3 text-amber-500" />
                  Truy cập nhanh:
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {bookmarks.map((bm) => (
                  <button
                    key={bm.id}
                    type="button"
                    onClick={() => {
                      setUrl(bm.url);
                      showToast(`Đã nạp bookmark: ${bm.name}`);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-amber-50/80 text-amber-900 border border-amber-200/80 hover:bg-amber-100 transition-colors shadow-2xs"
                  >
                    <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                    <span className="font-semibold truncate max-w-[160px]">{bm.name}</span>
                  </button>
                ))}
                {recentHistory.filter(h => !bookmarks.some(b => b.url === h.url)).slice(0, 4).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      setUrl(h.url);
                      showToast(`Đã chọn từ gần đây: ${h.name}`);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors border border-slate-200"
                  >
                    <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                    <span className="truncate max-w-[160px]">{h.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* URL Detection & Info */}
          {url.includes('/releases') && (
            <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 mt-2">
              <span className="flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-600 shrink-0" />
                Phát hiện URL GitHub Releases! Bạn có muốn mở trang tải Assets/Releases chuyên dụng không?
              </span>
              <Link 
                href={toolHref('releases')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs bg-white text-blue-700 font-medium hover:bg-blue-100 border border-blue-200 shrink-0 ml-2 shadow-2xs"
              >
                Mở trang Releases
              </Link>
            </div>
          )}

          {url && !isValid && (
            <div className="mt-2 text-xs">
              <p className="text-destructive flex items-center font-medium">
                <AlertCircle className="h-4 w-4 mr-1 shrink-0" />
                Định dạng URL chưa hợp lệ. Vui lòng kiểm tra lại liên kết.
              </p>
              <div className="text-muted-foreground mt-1 ml-5 space-y-0.5">
                <p>Ví dụ hỗ trợ:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>GitHub: <code>https://github.com/owner/repo/tree/main/path/folder</code></li>
                  <li>GitLab: <code>https://gitlab.com/owner/repo/-/tree/main/path/folder</code></li>
                  <li>Bitbucket: <code>https://bitbucket.org/owner/repo/src/main/path/folder</code></li>
                </ul>
              </div>
            </div>
          )}

          {url && isValid && (
            <div className="flex items-center text-xs text-slate-600 mt-2 space-x-3 bg-slate-50 p-2.5 rounded-lg border">
              <div className="flex items-center font-medium">
                {parsed.provider === 'github' && <Github className="h-3.5 w-3.5 mr-1 text-slate-900" />}
                {parsed.provider === 'gitlab' && <Gitlab className="h-3.5 w-3.5 mr-1 text-orange-600" />}
                {parsed.provider === 'bitbucket' && <span className="font-bold mr-1 text-blue-600">B</span>}
                <span className="capitalize">{parsed.provider}</span>
              </div>
              <span className="text-slate-300">·</span>
              <div className="font-semibold text-slate-900">
                {parsed.owner}/{parsed.repo}
              </div>
              {parsed.path && (
                <>
                  <span className="text-slate-300">·</span>
                  <div className="truncate max-w-[280px] font-mono text-slate-700" title={parsed.path}>
                    /{parsed.path}
                  </div>
                </>
              )}
              {parsed.branch && (
                <>
                  <span className="text-slate-300">·</span>
                  <div className="text-slate-500">
                    Nhánh: <span className="font-mono text-slate-800">{parsed.branch}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ZIP Customization Options Panel */}
          <div className="border rounded-xl bg-slate-50/50 p-4 space-y-3 mt-3">
            <div 
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => setIsZipOptionsOpen(!isZipOptionsOpen)}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <FileArchive className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs sm:text-sm font-semibold text-slate-900">Tùy chỉnh file ZIP xuất ra</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-900 text-white font-medium">
                  {zipOptions.namingRule === 'smart' ? 'Tên thông minh' : zipOptions.namingRule === 'custom' ? 'Tên tùy chọn' : 'Tên đơn giản'}
                </span>
                {zipOptions.preserveStructure ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    Giữ cấu trúc gốc
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-white text-slate-700 border">
                    Chỉ thư mục con
                  </span>
                )}
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-white text-slate-600 border">
                  Nén cấp {zipOptions.compressionLevel ?? 6}
                </span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground shrink-0">
                {isZipOptionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>

            {/* Live preview name if URL is provided */}
            {previewZipName && (
              <div className="flex items-center gap-2 text-xs bg-white px-3 py-2 rounded-lg text-slate-700 border">
                <span className="font-medium text-slate-500 shrink-0">Tên file ZIP dự kiến:</span>
                <code className="font-mono font-semibold text-primary truncate">{previewZipName}</code>
              </div>
            )}

            {isZipOptionsOpen && (
              <div className="pt-3 border-t space-y-4">
                {/* Rule 1: Filename scheme */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-800">Quy tắc đặt tên file ZIP:</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => updateZipOptions({ namingRule: 'smart' })}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        zipOptions.namingRule === 'smart' 
                          ? 'border-slate-900 bg-slate-900 text-white font-medium shadow-xs' 
                          : 'border-border bg-white hover:bg-slate-50 text-muted-foreground'
                      }`}
                    >
                      <div className="font-semibold">Thông minh (Khuyên dùng)</div>
                      <div className={`text-[11px] mt-0.5 font-mono ${zipOptions.namingRule === 'smart' ? 'text-slate-300' : 'text-slate-500'}`}>
                        [repo]_[branch]_[subfolder].zip
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateZipOptions({ namingRule: 'simple' })}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        zipOptions.namingRule === 'simple' 
                          ? 'border-slate-900 bg-slate-900 text-white font-medium shadow-xs' 
                          : 'border-border bg-white hover:bg-slate-50 text-muted-foreground'
                      }`}
                    >
                      <div className="font-semibold">Đơn giản</div>
                      <div className={`text-[11px] mt-0.5 font-mono ${zipOptions.namingRule === 'simple' ? 'text-slate-300' : 'text-slate-500'}`}>
                        [subfolder/repo].zip
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateZipOptions({ namingRule: 'custom' })}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        zipOptions.namingRule === 'custom' 
                          ? 'border-slate-900 bg-slate-900 text-white font-medium shadow-xs' 
                          : 'border-border bg-white hover:bg-slate-50 text-muted-foreground'
                      }`}
                    >
                      <div className="font-semibold">Tự đặt tên (Custom)</div>
                      <div className={`text-[11px] mt-0.5 ${zipOptions.namingRule === 'custom' ? 'text-slate-300' : 'text-slate-500'}`}>
                        Nhập tên tùy ý theo ý bạn
                      </div>
                    </button>
                  </div>

                  {zipOptions.namingRule === 'custom' && (
                    <div className="mt-2 flex items-center gap-2">
                      <Input 
                        placeholder="ví dụ: my-specs-backup"
                        value={zipOptions.customFilename || ''}
                        onChange={(e) => updateZipOptions({ customFilename: e.target.value })}
                        className="h-8 text-xs font-mono bg-white"
                      />
                      <span className="text-xs text-muted-foreground font-mono font-medium">.zip</span>
                    </div>
                  )}
                </div>

                {/* Rule 2: Folder hierarchy */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-800">Cấu trúc thư mục bên trong file ZIP:</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => updateZipOptions({ preserveStructure: false })}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        !zipOptions.preserveStructure
                          ? 'border-slate-900 bg-white font-medium ring-1 ring-slate-900 text-slate-900 shadow-2xs' 
                          : 'border-border bg-white hover:bg-slate-50 text-muted-foreground'
                      }`}
                    >
                      <div className="font-semibold text-slate-900">Chỉ lấy nội dung thư mục con (Mặc định)</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Giải nén ra ngay các file bên trong thư mục, không bị lồng thư mục cha thừa thãi.
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateZipOptions({ preserveStructure: true })}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        zipOptions.preserveStructure
                          ? 'border-slate-900 bg-white font-medium ring-1 ring-slate-900 text-slate-900 shadow-2xs' 
                          : 'border-border bg-white hover:bg-slate-50 text-muted-foreground'
                      }`}
                    >
                      <div className="font-semibold text-slate-900">Giữ nguyên đường dẫn gốc (Full Path)</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Giữ nguyên cấu trúc cây thư mục từ gốc repository (dễ đè/merge vào source code).
                      </div>
                    </button>
                  </div>
                </div>

                {/* Rule 3: Compression level */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-800">Mức độ nén ZIP:</label>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => updateZipOptions({ compressionLevel: 1 })}
                      className={`p-2 rounded-lg border text-center transition-colors ${
                        zipOptions.compressionLevel === 1
                          ? 'border-slate-900 bg-white font-medium ring-1 ring-slate-900 text-slate-900' 
                          : 'border-border bg-white hover:bg-slate-50 text-muted-foreground'
                      }`}
                    >
                      <div className="font-medium">Nhanh nhất (Level 1)</div>
                      <div className="text-[10px] text-slate-500">Tối ưu tốc độ tải</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateZipOptions({ compressionLevel: 6 })}
                      className={`p-2 rounded-lg border text-center transition-colors ${
                        zipOptions.compressionLevel === 6
                          ? 'border-slate-900 bg-white font-medium ring-1 ring-slate-900 text-slate-900' 
                          : 'border-border bg-white hover:bg-slate-50 text-muted-foreground'
                      }`}
                    >
                      <div className="font-medium">Cân bằng (Level 6)</div>
                      <div className="text-[10px] text-slate-500">Tiêu chuẩn tối ưu</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateZipOptions({ compressionLevel: 9 })}
                      className={`p-2 rounded-lg border text-center transition-colors ${
                        zipOptions.compressionLevel === 9
                          ? 'border-slate-900 bg-white font-medium ring-1 ring-slate-900 text-slate-900' 
                          : 'border-border bg-white hover:bg-slate-50 text-muted-foreground'
                      }`}
                    >
                      <div className="font-medium">Tối đa (Level 9)</div>
                      <div className="text-[10px] text-slate-500">Dung lượng nhỏ nhất</div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Progress & Status Feedback */}
        {progress.status !== 'idle' && (
          <div className="space-y-4 p-4 bg-slate-50 rounded-xl border">
            {progress.status === 'error' ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Lỗi</AlertTitle>
                <AlertDescription>{progress.message}</AlertDescription>
              </Alert>
            ) : progress.status === 'done' ? (
              <Alert className="bg-emerald-50 text-emerald-900 border-emerald-200">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle className="text-emerald-800">Tải thành công</AlertTitle>
                <AlertDescription className="text-emerald-700">{progress.message}</AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-700">{progress.message}</span>
                  <span className="text-slate-500 font-mono">{progress.progress}%</span>
                </div>
                <Progress value={progress.progress} className="h-2" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Feature Guidance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <div className="p-4 rounded-xl border bg-white space-y-1.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <Github className="h-4 w-4 text-slate-900" />
            GitHub Repos
          </div>
          <p className="text-xs text-muted-foreground">
            Hỗ trợ cây thư mục sâu không giới hạn bằng GitHub Trees & Blobs API, tự động nén ZIP client-side.
          </p>
        </div>

        <div className="p-4 rounded-xl border bg-white space-y-1.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <Gitlab className="h-4 w-4 text-orange-600" />
            GitLab & Self-hosted
          </div>
          <p className="text-xs text-muted-foreground">
            Hỗ trợ cả gitlab.com lẫn các server nội bộ của doanh nghiệp. Sử dụng archive endpoint tốc độ cao.
          </p>
        </div>

        <div className="p-4 rounded-xl border bg-white space-y-1.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <FileArchive className="h-4 w-4 text-indigo-600" />
            Tùy Chỉnh ZIP & Nén
          </div>
          <p className="text-xs text-muted-foreground">
            Lựa chọn cấu trúc phẳng hoặc giữ đường dẫn gốc, đặt tên file thông minh theo nhánh và thư mục.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-muted-foreground">Đang tải ứng dụng...</div>}>
      <DownloaderContent />
    </Suspense>
  );
}
