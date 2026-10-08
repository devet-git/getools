import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export type DownloadProgress = {
  status: 'idle' | 'fetching_metadata' | 'downloading' | 'zipping' | 'done' | 'error';
  message: string;
  progress: number; // 0 to 100
};

export type Provider = 'github' | 'gitlab' | 'bitbucket';

export interface ParsedUrl {
  provider: Provider;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  type: 'file' | 'dir' | 'repo';
  apiUrl: string;
}

export interface GitRepoItem {
  id: number;
  name: string;
  path_with_namespace: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
  web_url: string;
  description?: string;
  default_branch?: string;
  provider: 'github' | 'gitlab';
  stars?: number;
  language?: string;
  is_private?: boolean;
}

export type GitLabProject = GitRepoItem;

export async function getGitLabGroupProjects(groupUrl: string, keys?: ApiKeys): Promise<GitRepoItem[]> {
  const headers: Record<string, string> = {};
  if (keys?.gitlab) headers['Authorization'] = `Bearer ${keys.gitlab}`;

  try {
    const url = new URL(groupUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    
    // Support gitlab.com and self-hosted
    const isGitLab = url.hostname === 'gitlab.com' || url.hostname.includes('gitlab');
    if (!isGitLab || parts.length === 0) {
      throw new Error('Đường dẫn GitLab group không hợp lệ.');
    }

    const groupPath = parts.join('/');
    const encodedId = encodeURIComponent(groupPath);
    
    let page = 1;
    let allProjects: GitRepoItem[] = [];
    let hasNextPage = true;

    while (hasNextPage && page <= 10) {
      const apiUrl = `${url.origin}/api/v4/groups/${encodedId}/projects?include_subgroups=true&per_page=100&page=${page}`;
      const res = await fetch(apiUrl, { headers });
      
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Không tìm thấy group. Nếu group là riêng tư (Private), hãy nhập GitLab Token trong Cài đặt.');
        }
        throw new Error(`Lỗi khi lấy danh sách repos từ GitLab: ${res.statusText}`);
      }
      
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        hasNextPage = false;
      } else {
        const mapped: GitRepoItem[] = data.map((item: any) => ({
          id: item.id,
          name: item.name,
          path_with_namespace: item.path_with_namespace || `${item.namespace?.name}/${item.name}`,
          http_url_to_repo: item.http_url_to_repo,
          ssh_url_to_repo: item.ssh_url_to_repo,
          web_url: item.web_url,
          description: item.description || '',
          default_branch: item.default_branch || 'main',
          provider: 'gitlab',
          stars: item.star_count,
          is_private: item.visibility === 'private',
        }));
        allProjects = allProjects.concat(mapped);
        if (data.length < 100) {
          hasNextPage = false;
        } else {
          page++;
        }
      }
    }

    return allProjects;
  } catch (e: any) {
    throw new Error(e.message || 'Không thể lấy danh sách repos từ GitLab');
  }
}

export async function getGitHubOrgOrUserProjects(input: string, keys?: ApiKeys): Promise<GitRepoItem[]> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
  };
  if (keys?.github) {
    headers['Authorization'] = keys.github.startsWith('ghp_') || keys.github.startsWith('github_pat_')
      ? `Bearer ${keys.github}`
      : `token ${keys.github}`;
  }

  let target = input.trim();
  try {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      const url = new URL(target);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'orgs' || parts[0] === 'users') {
        target = parts[1] || '';
      } else {
        target = parts[0] || '';
      }
    }
  } catch (e) {
    // Treat as raw organization or user name
  }

  if (!target) {
    throw new Error('Vui lòng nhập tên Organization/User hoặc URL GitHub hợp lệ.');
  }

  const mapGitHub = (item: any): GitRepoItem => ({
    id: item.id,
    name: item.name,
    path_with_namespace: item.full_name || `${target}/${item.name}`,
    http_url_to_repo: item.clone_url || (item.html_url ? `${item.html_url}.git` : `https://github.com/${item.full_name}.git`),
    ssh_url_to_repo: item.ssh_url || `git@github.com:${item.full_name}.git`,
    web_url: item.html_url,
    description: item.description || '',
    default_branch: item.default_branch || 'main',
    provider: 'github',
    stars: item.stargazers_count,
    language: item.language,
    is_private: item.private,
  });

  // Try Org endpoint first
  let endpoint = `https://api.github.com/orgs/${encodeURIComponent(target)}/repos?per_page=100&type=all`;
  let page = 1;
  let allRepos: GitRepoItem[] = [];

  let firstRes = await fetch(`${endpoint}&page=1`, { headers });

  if (firstRes.status === 404) {
    // Fallback to User endpoint
    endpoint = `https://api.github.com/users/${encodeURIComponent(target)}/repos?per_page=100&type=all`;
    firstRes = await fetch(`${endpoint}&page=1`, { headers });
  }

  if (!firstRes.ok) {
    if (firstRes.status === 403) {
      const remaining = firstRes.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        throw new Error('Đã đạt giới hạn gọi GitHub API (Rate Limit). Vui lòng thêm GitHub Personal Access Token trong Cài đặt để tăng giới hạn lên 5.000 lượt/giờ.');
      }
      throw new Error('Không có quyền truy cập (403 Forbidden). Nếu là kho riêng tư, vui lòng cấu hình GitHub Token.');
    }
    if (firstRes.status === 404) {
      throw new Error(`Không tìm thấy Organization hoặc User GitHub "${target}".`);
    }
    throw new Error(`Lỗi gọi GitHub API: ${firstRes.statusText}`);
  }

  const firstData = await firstRes.json();
  if (Array.isArray(firstData)) {
    allRepos = allRepos.concat(firstData.map(mapGitHub));
  }

  // Paginate if more pages (up to 5 pages / 500 repos max)
  let hasMore = Array.isArray(firstData) && firstData.length === 100;
  while (hasMore && page < 5) {
    page++;
    try {
      const res = await fetch(`${endpoint}&page=${page}`, { headers });
      if (!res.ok) break;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      allRepos = allRepos.concat(data.map(mapGitHub));
      if (data.length < 100) hasMore = false;
    } catch {
      break;
    }
  }

  return allRepos;
}

export async function fetchGroupOrOrgRepos(
  input: string,
  providerType: 'auto' | 'github' | 'gitlab',
  keys?: ApiKeys
): Promise<{ provider: 'github' | 'gitlab'; repos: GitRepoItem[] }> {
  const trimmed = input.trim();
  let resolvedProvider = providerType;

  if (resolvedProvider === 'auto') {
    if (trimmed.toLowerCase().includes('gitlab')) {
      resolvedProvider = 'gitlab';
    } else if (trimmed.toLowerCase().includes('github')) {
      resolvedProvider = 'github';
    } else if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      // Default plain username or org to github
      resolvedProvider = 'github';
    } else {
      resolvedProvider = 'gitlab';
    }
  }

  if (resolvedProvider === 'github') {
    const repos = await getGitHubOrgOrUserProjects(trimmed, keys);
    return { provider: 'github', repos };
  } else {
    const repos = await getGitLabGroupProjects(trimmed, keys);
    return { provider: 'gitlab', repos };
  }
}

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  download_count: number;
  created_at: string;
  browser_download_url: string;
  content_type: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string;
  html_url: string;
  tarball_url: string;
  zipball_url: string;
  assets: GitHubReleaseAsset[];
}

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function parseGitHubReleaseUrl(input: string): { owner: string; repo: string; tag?: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const url = new URL(trimmed);
      if (url.hostname !== 'github.com') return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/, '');
      
      let tag: string | undefined = undefined;
      const releasesIndex = parts.indexOf('releases');
      if (releasesIndex !== -1 && parts[releasesIndex + 1]) {
        if (parts[releasesIndex + 1] === 'tag' && parts[releasesIndex + 2]) {
          tag = parts[releasesIndex + 2];
        } else if (parts[releasesIndex + 1] === 'download' && parts[releasesIndex + 2]) {
          tag = parts[releasesIndex + 2];
        } else if (parts[releasesIndex + 1] !== 'latest') {
          tag = parts[releasesIndex + 1];
        }
      }
      return { owner, repo, tag };
    } else {
      // Plain format: owner/repo or owner/repo@tag
      if (trimmed.includes('/')) {
        const [owner, rest] = trimmed.split('/');
        if (!rest) return null;
        if (rest.includes('@')) {
          const [repo, tag] = rest.split('@');
          return { owner, repo, tag };
        }
        return { owner, repo: rest };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function getGitHubReleases(
  input: string,
  keys?: ApiKeys
): Promise<{ owner: string; repo: string; releases: GitHubRelease[] }> {
  const parsed = parseGitHubReleaseUrl(input);
  if (!parsed) {
    throw new Error('Định dạng URL hoặc repository GitHub không hợp lệ. Vui lòng nhập dạng owner/repo hoặc link GitHub Releases.');
  }

  const { owner, repo, tag } = parsed;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
  };
  if (keys?.github) {
    headers['Authorization'] = keys.github.startsWith('ghp_') || keys.github.startsWith('github_pat_')
      ? `Bearer ${keys.github}`
      : `token ${keys.github}`;
  }

  let releases: GitHubRelease[] = [];

  if (tag) {
    // Specific tag
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, { headers });
    if (res.ok) {
      const data = await res.json();
      releases = [data];
    }
  }

  // If no tag or tag fetch resulted in empty list, fetch all recent releases
  if (releases.length === 0) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=15`, { headers });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Không tìm thấy repository hoặc release nào cho "${owner}/${repo}". Kho có thể là riêng tư hoặc chưa tạo release.`);
      }
      if (res.status === 403) {
        throw new Error('Đã đạt giới hạn gọi GitHub API. Vui lòng thêm GitHub Personal Access Token trong Cài đặt.');
      }
      throw new Error(`Lỗi gọi GitHub API: ${res.statusText}`);
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      releases = data;
    }
  }

  if (releases.length === 0) {
    throw new Error(`Repository "${owner}/${repo}" hiện chưa có bản phát hành (Release) nào.`);
  }

  return { owner, repo, releases };
}

export async function downloadReleaseAsset(
  asset: GitHubReleaseAsset,
  owner: string,
  repo: string,
  keys?: ApiKeys
) {
  if (keys?.github) {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/octet-stream',
        'Authorization': keys.github.startsWith('ghp_') || keys.github.startsWith('github_pat_')
          ? `Bearer ${keys.github}`
          : `token ${keys.github}`,
      };
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`, { headers });
      if (res.ok) {
        const blob = await res.blob();
        saveAs(blob, asset.name);
        return;
      }
    } catch (e) {
      console.warn('API asset download fallback to browser URL', e);
    }
  }

  // Standard direct download
  const a = document.createElement('a');
  a.href = asset.browser_download_url;
  a.download = asset.name;
  a.target = '_blank';
  a.rel = 'noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export interface ApiKeys {
  github?: string;
  gitlab?: string;
  bitbucket?: string;
  gemini?: string;
}

export function parseUrl(urlStr: string): ParsedUrl | null {
  try {
    const url = new URL(urlStr);
    const parts = url.pathname.split('/').filter(Boolean);

    if (url.hostname === 'github.com') {
      if (parts.length < 2) return null;
      const owner = parts[0];
      const repo = parts[1];
      let type: 'repo' | 'dir' | 'file' = 'repo';
      let branch = 'HEAD'; // Default branch
      let path = '';

      if (parts.length >= 4) {
        type = parts[2] === 'blob' ? 'file' : 'dir';
        branch = parts[3];
        path = parts.slice(4).join('/');
      }

      return {
        provider: 'github',
        owner,
        repo,
        branch,
        path,
        type,
        apiUrl: `https://api.github.com/repos/${owner}/${repo}`,
      };
    }

    if (url.hostname === 'bitbucket.org') {
      if (parts.length < 2) return null;
      const owner = parts[0];
      const repo = parts[1];
      let type: 'repo' | 'dir' | 'file' = 'repo';
      let branch = 'HEAD';
      let path = '';

      if (parts.length >= 4 && parts[2] === 'src') {
        type = 'dir'; // Bitbucket doesn't distinguish in URL easily, assume dir, will check later or just fetch
        branch = parts[3];
        path = parts.slice(4).join('/');
      }

      return {
        provider: 'bitbucket',
        owner,
        repo,
        branch,
        path,
        type,
        apiUrl: `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}`,
      };
    }

    if (url.hostname === 'gitlab.com') {
      if (parts.length < 2) return null;
      const owner = parts[0];
      const repo = parts[1];
      let type: 'repo' | 'dir' | 'file' = 'repo';
      let branch = 'HEAD';
      let path = '';

      if (parts.length >= 5 && parts[2] === '-') {
        type = parts[3] === 'blob' ? 'file' : 'dir';
        branch = parts[4];
        path = parts.slice(5).join('/');
      }

      return {
        provider: 'gitlab',
        owner,
        repo,
        branch,
        path,
        type,
        apiUrl: `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}`,
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

export interface ZipOptions {
  namingRule?: 'smart' | 'simple' | 'custom';
  customFilename?: string;
  preserveStructure?: boolean; // false = strip parent subfolder (default), true = keep full path from repo root
  compressionLevel?: 1 | 6 | 9; // 1 = Fast, 6 = Standard, 9 = Maximum
}

export function generateSmartZipName(parsed: ParsedUrl, options?: ZipOptions): string {
  const rule = options?.namingRule || 'smart';
  if (rule === 'custom' && options?.customFilename?.trim()) {
    let name = options.customFilename.trim();
    if (name.endsWith('.zip')) name = name.slice(0, -4);
    return `${name}.zip`;
  }

  if (rule === 'smart') {
    const cleanRepo = parsed.repo.replace(/[^a-zA-Z0-9._-]/g, '_');
    const cleanBranch = (parsed.branch || 'main').replace(/[^a-zA-Z0-9._-]/g, '_');
    const subfolder = parsed.path
      ? parsed.path.split('/').filter(Boolean).pop()?.replace(/[^a-zA-Z0-9._-]/g, '_')
      : '';

    if (subfolder) {
      return `${cleanRepo}_${cleanBranch}_${subfolder}.zip`;
    }
    return `${cleanRepo}_${cleanBranch}.zip`;
  }

  // Simple rule
  const base = parsed.path ? parsed.path.split('/').filter(Boolean).pop() : parsed.repo;
  return `${base || 'download'}.zip`;
}

export async function downloadFromUrl(
  urlStr: string,
  onProgress: (progress: DownloadProgress) => void,
  keys?: ApiKeys,
  options?: ZipOptions
) {
  const parsed = parseUrl(urlStr);
  if (!parsed) {
    throw new Error('Unsupported or invalid URL');
  }

  try {
    if (parsed.provider === 'github') {
      await downloadGitHub(parsed, onProgress, keys, options);
    } else if (parsed.provider === 'gitlab') {
      await downloadGitLab(parsed, onProgress, keys, options);
    } else if (parsed.provider === 'bitbucket') {
      await downloadBitbucket(parsed, onProgress, keys, options);
    }
  } catch (error: any) {
    onProgress({
      status: 'error',
      message: error.message || 'An error occurred during download',
      progress: 0,
    });
    throw error;
  }
}

async function downloadGitHub(
  parsed: ParsedUrl, 
  onProgress: (progress: DownloadProgress) => void, 
  keys?: ApiKeys,
  options?: ZipOptions
) {
  const headers: Record<string, string> = {};
  if (keys?.github) headers['Authorization'] = `Bearer ${keys.github}`;

  onProgress({ status: 'fetching_metadata', message: 'Fetching repository metadata...', progress: 10 });

  let branch = parsed.branch;
  if (branch === 'HEAD') {
    const repoInfo = await fetch(parsed.apiUrl, { headers }).then((res) => {
      if (!res.ok) throw new Error('Failed to fetch repo info. Check if it is public or if your token is valid.');
      return res.json();
    });
    branch = repoInfo.default_branch;
  }

  if (parsed.type === 'file') {
    onProgress({ status: 'downloading', message: `Downloading file: ${parsed.path}`, progress: 50 });
    let res;
    if (keys?.github) {
      res = await fetch(`${parsed.apiUrl}/contents/${parsed.path}?ref=${branch}`, {
        headers: { ...headers, 'Accept': 'application/vnd.github.v3.raw' }
      });
    } else {
      const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${parsed.path}`;
      res = await fetch(rawUrl);
    }
    if (!res.ok) throw new Error('Failed to download file.');
    const blob = await res.blob();
    const filename = parsed.path.split('/').pop() || 'file';
    saveAs(blob, filename);
    onProgress({ status: 'done', message: 'Download complete!', progress: 100 });
    return;
  }

  // It's a directory or repo
  onProgress({ status: 'fetching_metadata', message: 'Fetching file tree...', progress: 20 });
  const treeUrl = `${parsed.apiUrl}/git/trees/${branch}?recursive=1`;
  const treeRes = await fetch(treeUrl, { headers });
  if (!treeRes.ok) {
     if (treeRes.status === 403) {
         throw new Error('GitHub API rate limit exceeded. Please provide a token in settings or try again later.');
     }
     throw new Error('Failed to fetch file tree. The repository might be too large or private.');
  }
  const treeData = await treeRes.json();

  let filesToDownload = treeData.tree.filter((item: any) => item.type === 'blob');

  if (parsed.path) {
    const prefix = parsed.path + '/';
    filesToDownload = filesToDownload.filter((item: any) => item.path.startsWith(prefix));
  }

  if (filesToDownload.length === 0) {
    throw new Error('No files found to download.');
  }

  const zip = new JSZip();
  let downloadedCount = 0;
  const totalFiles = filesToDownload.length;
  let hasErrors = false;

  onProgress({ status: 'downloading', message: `Downloading ${totalFiles} files...`, progress: 30 });

  // Download in batches to avoid overwhelming the browser/network
  const BATCH_SIZE = 10;
  for (let i = 0; i < filesToDownload.length; i += BATCH_SIZE) {
    const batch = filesToDownload.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (file: any) => {
        let fileData: ArrayBuffer;
        try {
          if (keys?.github && file.url) {
            const res = await fetch(file.url, { 
              headers: { ...headers, 'Accept': 'application/vnd.github.v3.raw' } 
            });
            if (!res.ok) throw new Error(`Failed to fetch ${file.path} from API`);
            fileData = await res.arrayBuffer();
          } else {
            const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${file.path}`;
            const res = await fetch(rawUrl);
            if (!res.ok) throw new Error(`Failed to fetch ${file.path} from raw`);
            fileData = await res.arrayBuffer();
          }
          
          // Determine path inside zip
          let zipPath = file.path;
          if (!options?.preserveStructure && parsed.path) {
             zipPath = file.path.substring(parsed.path.length + 1);
          }
          if (zipPath.startsWith('/')) zipPath = zipPath.substring(1);
          
          if (!zipPath) {
             console.warn('Skipping empty zipPath for file:', file.path);
             return;
          }
          
          zip.file(zipPath, fileData);
        } catch (e) {
          console.error(`Error processing file ${file.path}:`, e);
          hasErrors = true;
        }
        downloadedCount++;
        const progress = 30 + Math.floor((downloadedCount / totalFiles) * 60);
        onProgress({ status: 'downloading', message: `Downloaded ${downloadedCount}/${totalFiles} files...`, progress });
      })
    );
  }

  if (Object.keys(zip.files).length === 0) {
    throw new Error('Failed to download any files. Check console for details.');
  }

  onProgress({ status: 'zipping', message: 'Zipping files...', progress: 95 });
  const zipBlob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: options?.compressionLevel ?? 6 }
  });
  
  const zipName = generateSmartZipName(parsed, options);
  saveAs(zipBlob, zipName);
  
  onProgress({ 
    status: 'done', 
    message: hasErrors ? 'Download complete with some errors.' : 'Download complete!', 
    progress: 100 
  });
}


async function downloadGitLab(
  parsed: ParsedUrl, 
  onProgress: (progress: DownloadProgress) => void, 
  keys?: ApiKeys,
  options?: ZipOptions
) {
  const headers: Record<string, string> = {};
  if (keys?.gitlab) headers['Authorization'] = `Bearer ${keys.gitlab}`;

  onProgress({ status: 'fetching_metadata', message: 'Fetching repository metadata...', progress: 10 });

  let branch = parsed.branch;
  if (branch === 'HEAD') {
    const repoInfo = await fetch(parsed.apiUrl, { headers }).then((res) => {
      if (!res.ok) throw new Error('Failed to fetch repo info. Check if it is public or if your token is valid.');
      return res.json();
    });
    branch = repoInfo.default_branch;
  }

  if (parsed.type === 'file') {
    onProgress({ status: 'downloading', message: `Downloading file: ${parsed.path}`, progress: 50 });
    const rawUrl = `${parsed.apiUrl}/repository/files/${encodeURIComponent(parsed.path)}/raw?ref=${branch}`;
    const res = await fetch(rawUrl, { headers });
    if (!res.ok) throw new Error('Failed to download file.');
    const blob = await res.blob();
    const filename = parsed.path.split('/').pop() || 'file';
    saveAs(blob, filename);
    onProgress({ status: 'done', message: 'Download complete!', progress: 100 });
    return;
  }

  // GitLab has an archive endpoint!
  // GET /projects/:id/repository/archive[.format]?sha=<sha>&path=<path>
  onProgress({ status: 'downloading', message: 'Requesting archive from GitLab...', progress: 50 });
  
  let archiveUrl = `${parsed.apiUrl}/repository/archive.zip?sha=${branch}`;
  if (parsed.path) {
      archiveUrl += `&path=${encodeURIComponent(parsed.path)}`;
  }

  const res = await fetch(archiveUrl, { headers });
  if (!res.ok) throw new Error('Failed to fetch archive from GitLab.');
  
  onProgress({ status: 'downloading', message: 'Downloading archive...', progress: 80 });
  let blob = await res.blob();
  
  // If user wants to flatten/strip subfolder prefix (!options?.preserveStructure) and parsed.path is given
  if (!options?.preserveStructure && parsed.path) {
    onProgress({ status: 'zipping', message: 'Adjusting folder structure...', progress: 90 });
    try {
      const loadedZip = await JSZip.loadAsync(blob);
      const newZip = new JSZip();
      const files = Object.keys(loadedZip.files);
      let copiedCount = 0;

      for (const filePath of files) {
        const zipEntry = loadedZip.files[filePath];
        if (zipEntry.dir) continue;

        const matchIdx = filePath.indexOf(parsed.path);
        let newPath = filePath;
        if (matchIdx !== -1) {
          newPath = filePath.substring(matchIdx + parsed.path.length);
          if (newPath.startsWith('/')) newPath = newPath.substring(1);
        }
        if (newPath) {
          const content = await zipEntry.async('arraybuffer');
          newZip.file(newPath, content);
          copiedCount++;
        }
      }

      if (copiedCount > 0) {
        blob = await newZip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: options?.compressionLevel ?? 6 }
        });
      }
    } catch (e) {
      console.warn('Failed to repackage GitLab archive, using standard archive:', e);
    }
  }
  
  const zipName = generateSmartZipName(parsed, options);
  saveAs(blob, zipName);
  
  onProgress({ status: 'done', message: 'Download complete!', progress: 100 });
}

async function downloadBitbucket(
  parsed: ParsedUrl, 
  onProgress: (progress: DownloadProgress) => void, 
  keys?: ApiKeys,
  options?: ZipOptions
) {
    const headers: Record<string, string> = {};
    if (keys?.bitbucket) {
      const encoded = btoa(keys.bitbucket);
      headers['Authorization'] = `Basic ${encoded}`;
    }

    onProgress({ status: 'fetching_metadata', message: 'Fetching repository metadata...', progress: 10 });

    let branch = parsed.branch;
    if (branch === 'HEAD') {
      const repoInfo = await fetch(parsed.apiUrl, { headers }).then((res) => {
        if (!res.ok) throw new Error('Failed to fetch repo info. Check if it is public or if your token is valid.');
        return res.json();
      });
      branch = repoInfo.mainbranch.name;
    }

    if (!parsed.path) {
        onProgress({ status: 'downloading', message: 'Requesting archive from Bitbucket...', progress: 50 });
        const archiveUrl = `https://bitbucket.org/${parsed.owner}/${parsed.repo}/get/${branch}.zip`;
        const res = await fetch(archiveUrl, { headers });
        if (!res.ok) throw new Error('Failed to fetch archive from Bitbucket.');
        const blob = await res.blob();
        const zipName = generateSmartZipName(parsed, options);
        saveAs(blob, zipName);
        onProgress({ status: 'done', message: 'Download complete!', progress: 100 });
        return;
    }

    // If there is a path, we need to traverse the API.
    onProgress({ status: 'fetching_metadata', message: 'Fetching file tree...', progress: 20 });
    
    const filesToDownload: string[] = [];
    
    async function traverse(path: string) {
        const url = `${parsed.apiUrl}/src/${branch}/${path}`;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`Failed to fetch path: ${path}`);
        const data = await res.json();
        
        if (data.type === 'commit_file') {
            // It's a single file
            filesToDownload.push(path);
        } else if (data.values) {
            // It's a directory
            for (const item of data.values) {
                if (item.type === 'commit_file') {
                    filesToDownload.push(item.path);
                } else if (item.type === 'commit_directory') {
                    await traverse(item.path);
                }
            }
        }
    }

    await traverse(parsed.path);

    if (filesToDownload.length === 0) {
        throw new Error('No files found to download.');
    }

    const zip = new JSZip();
    let downloadedCount = 0;
    const totalFiles = filesToDownload.length;

    onProgress({ status: 'downloading', message: `Downloading ${totalFiles} files...`, progress: 30 });

    const BATCH_SIZE = 5;
    for (let i = 0; i < filesToDownload.length; i += BATCH_SIZE) {
        const batch = filesToDownload.slice(i, i + BATCH_SIZE);
        await Promise.all(
            batch.map(async (filePath: string) => {
                // Raw URL for Bitbucket
                const rawUrl = `https://bitbucket.org/${parsed.owner}/${parsed.repo}/raw/${branch}/${filePath}`;
                try {
                    const res = await fetch(rawUrl, { headers });
                    if (!res.ok) throw new Error(`Failed to fetch ${filePath}`);
                    const fileData = await res.arrayBuffer();
                    
                    let zipPath = filePath;
                    if (!options?.preserveStructure && parsed.path) {
                        zipPath = filePath.substring(parsed.path.length + 1);
                    }
                    if (zipPath.startsWith('/')) zipPath = zipPath.substring(1);
                    
                    if (!zipPath) {
                       console.warn('Skipping empty zipPath for file:', filePath);
                       return;
                    }
                    
                    zip.file(zipPath, fileData);
                } catch (e) {
                    console.error(`Error processing file ${filePath}:`, e);
                }
                downloadedCount++;
                const progress = 30 + Math.floor((downloadedCount / totalFiles) * 60);
                onProgress({ status: 'downloading', message: `Downloaded ${downloadedCount}/${totalFiles} files...`, progress });
            })
        );
    }

    onProgress({ status: 'zipping', message: 'Zipping files...', progress: 95 });
    const zipBlob = await zip.generateAsync({ 
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: options?.compressionLevel ?? 6 }
    });
    
    const zipName = generateSmartZipName(parsed, options);
    saveAs(zipBlob, zipName);
    
    onProgress({ status: 'done', message: 'Download complete!', progress: 100 });
}
