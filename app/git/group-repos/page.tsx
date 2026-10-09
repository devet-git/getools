'use client';

import { useState } from 'react';
import { 
  Github, 
  Gitlab, 
  Search, 
  Terminal, 
  Code2, 
  Copy, 
  ExternalLink, 
  Star, 
  Lock, 
  Sparkles, 
  FolderDown, 
  Loader2, 
  AlertCircle,
  FileCode,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchGroupOrOrgRepos, GitRepoItem } from '@/lib/downloader';
import { useApp } from '@/components/AppContext';
import { useAppRouter } from '@/hooks/use-app-router';
import { toolHref } from '@/lib/tools';

export default function GroupReposPage() {
  const router = useAppRouter();
  const { keys, showToast } = useApp();

  const [groupUrl, setGroupUrl] = useState('');
  const [providerType, setProviderType] = useState<'auto' | 'github' | 'gitlab'>('auto');
  const [detectedProvider, setDetectedProvider] = useState<'github' | 'gitlab'>('github');
  const [groupProjects, setGroupProjects] = useState<GitRepoItem[]>([]);
  const [isFetchingGroup, setIsFetchingGroup] = useState(false);
  const [groupError, setGroupError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [protocol, setProtocol] = useState<'https' | 'ssh'>('https');
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([]);
  const [isScriptModalOpen, setIsScriptModalOpen] = useState(false);
  const [scriptType, setScriptType] = useState<'bash' | 'powershell'>('bash');

  const copyToClipboard = (text: string, message: string) => {
    navigator.clipboard.writeText(text);
    showToast(message);
  };

  const handleFetchGroup = async (customUrl?: string) => {
    const targetUrl = customUrl || groupUrl;
    if (!targetUrl.trim()) return;

    if (customUrl) {
      setGroupUrl(customUrl);
    }

    setIsFetchingGroup(true);
    setGroupError('');
    setGroupProjects([]);
    setSelectedRepoIds([]);

    try {
      const result = await fetchGroupOrOrgRepos(targetUrl, providerType, keys);
      setGroupProjects(result.repos);
      setDetectedProvider(result.provider);
      setSelectedRepoIds(result.repos.map((p) => p.id));
      showToast(`Đã tìm thấy ${result.repos.length} repositories!`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Không thể lấy danh sách repositories';
      setGroupError(errorMsg);
    } finally {
      setIsFetchingGroup(false);
    }
  };

  const getRepoUrl = (project: GitRepoItem, proto: 'https' | 'ssh') => {
    if (proto === 'ssh' && project.ssh_url_to_repo) {
      return project.ssh_url_to_repo;
    }
    return project.http_url_to_repo || project.web_url;
  };

  const filteredProjects = groupProjects.filter(p => {
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.path_with_namespace.toLowerCase().includes(q) ||
      (p.description && p.description.toLowerCase().includes(q)) ||
      (p.language && p.language.toLowerCase().includes(q))
    );
  });

  const activeSelectedProjects = filteredProjects.filter(p => selectedRepoIds.includes(p.id));

  const toggleRepoSelection = (id: number) => {
    setSelectedRepoIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredProjects.map(p => p.id);
    const allVisibleSelected = visibleIds.every(id => selectedRepoIds.includes(id));

    if (allVisibleSelected) {
      setSelectedRepoIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedRepoIds(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleCopyCloneCommands = () => {
    const targets = activeSelectedProjects.length > 0 ? activeSelectedProjects : filteredProjects;
    const commands = targets.map(p => `git clone ${getRepoUrl(p, protocol)}`).join('\n');
    copyToClipboard(commands, `Đã copy lệnh git clone cho ${targets.length} repos!`);
  };

  const handleCopyUrls = () => {
    const targets = activeSelectedProjects.length > 0 ? activeSelectedProjects : filteredProjects;
    const urlsText = targets.map(p => getRepoUrl(p, protocol)).join('\n');
    copyToClipboard(urlsText, `Đã copy ${targets.length} ${protocol.toUpperCase()} URLs!`);
  };

  const handleSendToDownloader = (webUrl: string) => {
    router.push(toolHref('download', { url: webUrl }));
    showToast('Đã chuyển liên kết sang trang Tải file/folder!');
  };

  const generateCloneScript = (type: 'bash' | 'powershell') => {
    const targets = activeSelectedProjects.length > 0 ? activeSelectedProjects : filteredProjects;
    const urls = targets.map(p => ({
      name: p.path_with_namespace || p.name,
      url: getRepoUrl(p, protocol)
    }));

    if (type === 'bash') {
      return `#!/usr/bin/env bash
# Clone all repositories (${detectedProvider === 'github' ? 'GitHub' : 'GitLab'})
# Generated at ${new Date().toLocaleString()}
set -e

REPOS=(
${urls.map(u => `  "${u.url}"`).join('\n')}
)

echo "Starting batch clone of \${#REPOS[@]} repositories..."

for repo in "\${REPOS[@]}"; do
  echo "Cloning \${repo}..."
  git clone "\$repo" || echo "Failed to clone \$repo"
done

echo "Done!"
`;
    } else {
      return `# Batch Clone Repositories (${detectedProvider === 'github' ? 'GitHub' : 'GitLab'})
# Generated at ${new Date().toLocaleString()}
$ErrorActionPreference = "Continue"

$repos = @(
${urls.map(u => `    "${u.url}"`).join('\n')}
)

Write-Host "Starting batch clone of $($repos.Count) repositories..." -ForegroundColor Cyan

foreach ($repo in $repos) {
    Write-Host "Cloning $repo..." -ForegroundColor Yellow
    git clone $repo
}

Write-Host "Done!" -ForegroundColor Green
`;
    }
  };

  return (
    <div className="space-y-3.5">
      {/* COMPACT TOP BANNER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
            <Code2 className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight">
                Quét Repos từ GitHub Org & GitLab Group
              </h1>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                Bulk Clone & Export
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Quét toàn bộ repositories từ Organization hoặc Group và tạo script clone hàng loạt
            </p>
          </div>
        </div>
      </div>

      {/* Main Input Card */}
      <div className="bg-white rounded-xl border border-border shadow-xs p-5 sm:p-6 space-y-4">
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex rounded-md border bg-slate-100/60 p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setProviderType('auto')}
                className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                  providerType === 'auto'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Tự nhận diện
              </button>
              <button
                type="button"
                onClick={() => setProviderType('github')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded transition-colors flex items-center gap-1 ${
                  providerType === 'github'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Github className="h-3.5 w-3.5" /> GitHub
              </button>
              <button
                type="button"
                onClick={() => setProviderType('gitlab')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded transition-colors flex items-center gap-1 ${
                  providerType === 'gitlab'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Gitlab className="h-3.5 w-3.5 text-orange-600" /> GitLab
              </button>
            </div>

            <Input
              placeholder="Nhập URL (vd: https://github.com/vercel hoặc https://gitlab.com/gitlab-org)"
              value={groupUrl}
              onChange={(e) => setGroupUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFetchGroup();
              }}
              className="flex-1 text-xs sm:text-sm"
              disabled={isFetchingGroup}
            />

            <Button 
              onClick={() => handleFetchGroup()} 
              disabled={!groupUrl || isFetchingGroup}
              className="sm:w-36 shrink-0"
            >
              {isFetchingGroup ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Lấy Danh Sách
            </Button>
          </div>

          {/* Quick suggestions */}
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground pt-1">
            <span className="font-medium text-slate-500">Gợi ý thử nghiệm:</span>
            <button
              onClick={() => handleFetchGroup('https://github.com/vercel')}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1 text-[11px]"
            >
              <Github className="h-3 w-3" /> vercel
            </button>
            <button
              onClick={() => handleFetchGroup('https://github.com/facebook')}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1 text-[11px]"
            >
              <Github className="h-3 w-3" /> facebook
            </button>
            <button
              onClick={() => handleFetchGroup('https://github.com/torvalds')}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1 text-[11px]"
            >
              <Github className="h-3 w-3" /> torvalds
            </button>
            <button
              onClick={() => handleFetchGroup('https://gitlab.com/gitlab-org')}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1 text-[11px]"
            >
              <Gitlab className="h-3 w-3 text-orange-600" /> gitlab-org
            </button>
          </div>
        </div>

        {groupError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Lỗi</AlertTitle>
            <AlertDescription>{groupError}</AlertDescription>
          </Alert>
        )}

        {/* Results Area */}
        {groupProjects.length > 0 && (
          <div className="space-y-4 pt-3 border-t">
            {/* Controls Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border">
              <div className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white border text-xs font-semibold text-slate-800 shadow-2xs whitespace-nowrap">
                  {detectedProvider === 'github' ? (
                    <>
                      <Github className="h-3.5 w-3.5" />
                      <span>GitHub</span>
                    </>
                  ) : (
                    <>
                      <Gitlab className="h-3.5 w-3.5 text-orange-600" />
                      <span>GitLab</span>
                    </>
                  )}
                  <span className="text-slate-300">·</span>
                  <span>{groupProjects.length} repos</span>
                </div>

                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Lọc theo tên, ngôn ngữ, mô tả..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 bg-white h-8 text-xs"
                  />
                </div>
              </div>

              {/* Protocol Switcher */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Giao thức:</span>
                <div className="flex rounded-md border bg-white p-0.5">
                  <button
                    onClick={() => setProtocol('https')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                      protocol === 'https' 
                        ? 'bg-slate-900 text-white shadow-xs' 
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    HTTPS
                  </button>
                  <button
                    onClick={() => setProtocol('ssh')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                      protocol === 'ssh' 
                        ? 'bg-slate-900 text-white shadow-xs' 
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    SSH
                  </button>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleSelectAll}
                  className="text-xs h-8"
                >
                  {selectedRepoIds.length === filteredProjects.length && filteredProjects.length > 0
                    ? 'Bỏ chọn tất cả'
                    : `Chọn tất cả (${filteredProjects.length})`}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Đã chọn <strong className="text-foreground">{activeSelectedProjects.length}</strong> / {groupProjects.length} repos
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setIsScriptModalOpen(true)}
                  className="text-xs h-8 bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Terminal className="h-3.5 w-3.5 mr-1.5" />
                  Tạo Script Clone (.sh / .ps1)
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCloneCommands}
                  className="text-xs h-8"
                >
                  <Code2 className="h-3.5 w-3.5 mr-1.5" />
                  Copy lệnh clone
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyUrls}
                  className="text-xs h-8"
                >
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                  Copy URLs
                </Button>
              </div>
            </div>

            {/* Projects List */}
            <div className="max-h-[500px] overflow-y-auto border rounded-xl divide-y divide-border bg-white shadow-xs">
              {filteredProjects.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  Không tìm thấy repository nào khớp với từ khóa &quot;{searchQuery}&quot;.
                </div>
              ) : (
                filteredProjects.map((project) => {
                  const isSelected = selectedRepoIds.includes(project.id);
                  const repoUrl = getRepoUrl(project, protocol);

                  return (
                    <div 
                      key={project.id} 
                      className={`p-3.5 transition-colors flex items-start gap-3 hover:bg-slate-50 ${
                        isSelected ? 'bg-primary/[0.02]' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRepoSelection(project.id)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer"
                      />

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <a 
                            href={project.web_url} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="font-semibold text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            {project.path_with_namespace}
                            <ExternalLink className="h-3 w-3 opacity-60" />
                          </a>

                          {project.is_private && (
                            <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded flex items-center gap-0.5 border border-amber-200">
                              <Lock className="h-2.5 w-2.5" /> Private
                            </span>
                          )}

                          {project.stars !== undefined && project.stars > 0 && (
                            <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                              <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
                              {project.stars.toLocaleString()}
                            </span>
                          )}

                          {project.language && (
                            <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                              {project.language}
                            </span>
                          )}
                        </div>

                        {project.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {project.description}
                          </p>
                        )}

                        <div className="flex items-center gap-2 pt-1 font-mono text-[11px] text-slate-600">
                          <span className="truncate bg-slate-100 px-2 py-0.5 rounded border">
                            {repoUrl}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 pt-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => copyToClipboard(`git clone ${repoUrl}`, 'Đã copy lệnh clone!')}
                          data-tooltip="Copy git clone command" aria-label="Copy git clone command"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-7 px-2 text-xs flex items-center gap-1 text-slate-700" 
                          onClick={() => handleSendToDownloader(project.web_url)}
                          data-tooltip="Mở trong trang Tải File/Folder để tải từng thư mục con"
                        >
                          <FolderDown className="h-3.5 w-3.5 text-primary" />
                          <span className="hidden sm:inline">Tải folder</span>
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Script Preview Modal */}
      <Dialog open={isScriptModalOpen} onOpenChange={setIsScriptModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-6">
          <DialogHeader className="space-y-1">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <Terminal className="h-5 w-5 text-primary" />
              Script Clone Hàng Loạt ({scriptType === 'bash' ? 'Bash .sh' : 'PowerShell .ps1'})
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Tự động clone {activeSelectedProjects.length > 0 ? activeSelectedProjects.length : filteredProjects.length} repositories ({detectedProvider === 'github' ? 'GitHub' : 'GitLab'}) đã chọn vào thư mục máy tính của bạn.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2 pt-2">
            <div className="flex rounded-md border p-1 bg-muted/40">
              <button
                onClick={() => setScriptType('bash')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  scriptType === 'bash' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Bash Script (.sh)
              </button>
              <button
                onClick={() => setScriptType('powershell')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  scriptType === 'powershell' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                PowerShell (.ps1)
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const script = generateCloneScript(scriptType);
                  copyToClipboard(script, 'Đã copy script vào bộ nhớ tạm!');
                }}
                className="text-xs h-8"
              >
                <Copy className="h-3.5 w-3.5 mr-1" /> Copy Script
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-[220px] max-h-[350px] overflow-auto bg-slate-900 text-slate-100 rounded-lg p-3 font-mono text-xs border border-slate-800">
            <pre className="whitespace-pre">{generateCloneScript(scriptType)}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
