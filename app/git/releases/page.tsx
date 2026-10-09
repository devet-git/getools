'use client';

import { useState, useSyncExternalStore } from 'react';
import { 
  Package, 
  Search, 
  Download, 
  ExternalLink, 
  Calendar, 
  ChevronDown, 
  ChevronUp, 
  HardDrive, 
  Loader2, 
  AlertCircle,
  FileArchive
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  getGitHubReleases, 
  downloadReleaseAsset, 
  formatBytes, 
  GitHubRelease, 
  GitHubReleaseAsset 
} from '@/lib/downloader';
import { addHistoryItem } from '@/lib/storage';
import { useApp } from '@/components/AppContext';
import { showAlert } from '@/lib/dialog';
import { getJobsSnapshot, getServerJobsSnapshot, runJob, subscribeJobs } from '@/lib/background-jobs';

export default function ReleasesPage() {
  const { keys, showToast, refreshStats } = useApp();

  const [releaseInput, setReleaseInput] = useState('');
  const [isFetchingReleases, setIsFetchingReleases] = useState(false);
  const [releasesData, setReleasesData] = useState<{ owner: string; repo: string; releases: GitHubRelease[] } | null>(null);
  const [releasesError, setReleasesError] = useState('');
  const [expandedReleaseIds, setExpandedReleaseIds] = useState<number[]>([]);
  // Asset đang tải (từ tác vụ nền): quay lại trang vẫn thấy nút đang tải
  const jobs = useSyncExternalStore(subscribeJobs, getJobsSnapshot, getServerJobsSnapshot);
  const downloadingIds = new Set(jobs.filter((j) => j.toolId === 'releases' && j.status === 'running').map((j) => j.key));

  const handleFetchReleases = async (customRepo?: string) => {
    const target = customRepo || releaseInput;
    if (!target.trim()) return;

    if (customRepo) {
      setReleaseInput(customRepo);
    }

    setIsFetchingReleases(true);
    setReleasesError('');
    setReleasesData(null);

    try {
      const data = await getGitHubReleases(target, keys);
      setReleasesData(data);
      if (data.releases.length > 0) {
        setExpandedReleaseIds([data.releases[0].id]);
      }
      showToast(`Đã tìm thấy ${data.releases.length} releases cho ${data.owner}/${data.repo}!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể lấy thông tin GitHub Releases';
      setReleasesError(msg);
    } finally {
      setIsFetchingReleases(false);
    }
  };

  const toggleReleaseExpand = (id: number) => {
    setExpandedReleaseIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleDownloadReleaseAsset = async (asset: GitHubReleaseAsset, owner: string, repo: string) => {
    try {
      showToast(`Đang tải file ${asset.name}...`);

      addHistoryItem({
        url: asset.browser_download_url,
        provider: 'github',
        type: 'release',
        name: asset.name,
        repoName: `${owner}/${repo}`,
        size: formatBytes(asset.size),
      });
      refreshStats();

      // Chạy như tác vụ nền: rời trang vẫn tải tiếp, tiến trình hiện ở góc màn hình
      await runJob('releases', `Tải ${asset.name}`, async ({ report }) => {
        report({ percent: null, message: formatBytes(asset.size) });
        await downloadReleaseAsset(asset, owner, repo, keys, (percent) =>
          report({ percent, message: percent == null ? 'Đang tải…' : `${Math.round(percent)}% · ${formatBytes(asset.size)}` }));
        return `Đã tải xuống ${asset.name}`;
      }, String(asset.id));
      showToast(`Đã tải xuống thành công ${asset.name}!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi tải asset';
      void showAlert(`Không thể tải asset: ${msg}`, { title: 'Tải asset thất bại' });
    }
  };

  return (
    <div className="space-y-3.5">
      {/* COMPACT TOP BANNER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
            <Package className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight">
                Tải GitHub Releases & Assets
              </h1>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                Binaries & Assets
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Tìm kiếm các bản phát hành chính thức, tải file thực thi binary (.exe, .dmg, .apk, .zip) từ GitHub
            </p>
          </div>
        </div>
      </div>

      {/* Main Search Card */}
      <div className="bg-white rounded-xl border border-border shadow-xs p-5 sm:p-6 space-y-4">
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Nhập 'cli/cli', 'facebook/react' hoặc link 'https://github.com/cli/cli/releases'..."
              value={releaseInput}
              onChange={(e) => setReleaseInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFetchReleases();
              }}
              className="flex-1 text-xs sm:text-sm"
              disabled={isFetchingReleases}
            />
            <Button 
              onClick={() => handleFetchReleases()} 
              disabled={!releaseInput || isFetchingReleases}
              className="sm:w-36 bg-blue-600 hover:bg-blue-700 text-white shrink-0"
            >
              {isFetchingReleases ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Package className="mr-2 h-4 w-4" />
              )}
              Tìm Releases
            </Button>
          </div>

          {/* Quick Examples */}
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground pt-1">
            <span className="font-medium text-slate-500">Mẫu phổ biến:</span>
            <button
              onClick={() => handleFetchReleases('cli/cli')}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors text-[11px]"
            >
              cli/cli
            </button>
            <button
              onClick={() => handleFetchReleases('neovim/neovim')}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors text-[11px]"
            >
              neovim/neovim
            </button>
            <button
              onClick={() => handleFetchReleases('facebook/react')}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors text-[11px]"
            >
              facebook/react
            </button>
            <button
              onClick={() => handleFetchReleases('denoland/deno')}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors text-[11px]"
            >
              denoland/deno
            </button>
          </div>
        </div>

        {releasesError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Lỗi</AlertTitle>
            <AlertDescription>{releasesError}</AlertDescription>
          </Alert>
        )}

        {/* Releases Result */}
        {releasesData && (
          <div className="space-y-4 pt-3 border-t">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-slate-900">
                  {releasesData.owner}/{releasesData.repo}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({releasesData.releases.length} bản phát hành gần nhất)
                </span>
              </div>
              <a
                href={`https://github.com/${releasesData.owner}/${releasesData.repo}/releases`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Mở trang Releases trên GitHub <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {releasesData.releases.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground border rounded-lg bg-slate-50">
                Repository này chưa có bản phát hành (Release) nào.
              </div>
            ) : (
              <div className="space-y-3">
                {releasesData.releases.map((release) => {
                  const isExpanded = expandedReleaseIds.includes(release.id);
                  const pubDate = new Date(release.published_at).toLocaleDateString('vi-VN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  });

                  return (
                    <div key={release.id} className="border rounded-xl bg-white overflow-hidden shadow-xs">
                      {/* Release Item Header */}
                      <div 
                        onClick={() => toggleReleaseExpand(release.id)}
                        className="p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50 transition-colors select-none"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-slate-200 text-slate-500"
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>

                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-slate-900">
                                {release.tag_name}
                              </span>
                              {release.name && release.name !== release.tag_name && (
                                <span className="text-xs text-slate-600 truncate max-w-[280px]">
                                  {release.name}
                                </span>
                              )}
                              {release.prerelease && (
                                <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">
                                  Pre-release
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              <span>{pubDate}</span>
                              <span>·</span>
                              <span>{release.assets.length} file đính kèm</span>
                            </div>
                          </div>
                        </div>

                        <a
                          href={release.html_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-slate-500 hover:text-primary flex items-center gap-1 shrink-0 px-2 py-1 rounded hover:bg-slate-100"
                        >
                          <span className="hidden sm:inline">GitHub</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>

                      {/* Release Content (Expanded) */}
                      {isExpanded && (
                        <div className="p-4 pt-2 border-t bg-slate-50/50 space-y-3">
                          {release.body && (
                            <div className="text-xs text-slate-600 p-2.5 break-words bg-white rounded-lg border whitespace-pre-wrap font-sans">
                              {release.body}
                            </div>
                          )}

                          {/* Assets List */}
                          <div className="space-y-1.5">
                            <span className="text-xs font-semibold text-slate-700 block">
                              Files đính kèm ({release.assets.length}):
                            </span>

                            {release.assets.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">
                                Không có file binary đính kèm trong bản release này.
                              </p>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {release.assets.map((asset) => {
                                  const isDownloading = downloadingIds.has(String(asset.id));

                                  return (
                                    <div 
                                      key={asset.id} 
                                      className="p-2.5 bg-white border rounded-lg flex items-center justify-between gap-2 shadow-2xs hover:border-slate-300 transition-colors"
                                    >
                                      <div className="min-w-0 flex-1 space-y-0.5">
                                        <div className="flex items-center gap-1.5">
                                          <FileArchive className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                                          <span className="text-xs font-semibold text-slate-900 truncate block" data-tooltip={asset.name}>
                                            {asset.name}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                          <span className="flex items-center gap-1">
                                            <HardDrive className="h-3 w-3" />
                                            {formatBytes(asset.size)}
                                          </span>
                                          <span>·</span>
                                          <span>{asset.download_count.toLocaleString()} lượt tải</span>
                                        </div>
                                      </div>

                                      <Button
                                        size="sm"
                                        variant="default"
                                        className="h-7 px-2.5 text-xs bg-slate-900 hover:bg-slate-800 text-white shrink-0"
                                        onClick={() => handleDownloadReleaseAsset(asset, releasesData.owner, releasesData.repo)}
                                        disabled={isDownloading}
                                      >
                                        {isDownloading ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Download className="h-3.5 w-3.5 mr-1" />
                                        )}
                                        Tải
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Source Code Archives */}
                            <div className="pt-2 flex items-center gap-2 text-xs flex-wrap">
                              <span className="text-muted-foreground font-medium">Mã nguồn kho:</span>
                              {release.zipball_url && (
                                <a
                                  href={release.zipball_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white hover:bg-slate-100 text-slate-700 font-medium transition-colors border text-[11px]"
                                >
                                  <Download className="h-3 w-3" /> Source code (.zip)
                                </a>
                              )}
                              {release.tarball_url && (
                                <a
                                  href={release.tarball_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white hover:bg-slate-100 text-slate-700 font-medium transition-colors border text-[11px]"
                                >
                                  <Download className="h-3 w-3" /> Source code (.tar.gz)
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
