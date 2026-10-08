/** Kiểm tra định dạng và thử token Git (chạy ở trình duyệt, chỉ gọi tới API chính thức của nhà cung cấp). */
export type GitProvider = 'github' | 'gitlab' | 'bitbucket';

export interface FormatCheck {
  ok: boolean;
  message?: string;
}

export function checkTokenFormat(provider: GitProvider, raw: string): FormatCheck {
  const v = raw.trim();
  if (!v) return { ok: true };
  if (/\s/.test(v) && provider !== 'bitbucket') return { ok: false, message: 'Token không được chứa khoảng trắng.' };
  switch (provider) {
    case 'github':
      return /^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}$/.test(v) || /^[a-f0-9]{40}$/.test(v)
        ? { ok: true }
        : { ok: false, message: 'Thường bắt đầu bằng ghp_ hoặc github_pat_. Hãy kiểm tra lại.' };
    case 'gitlab':
      return /^glpat-[A-Za-z0-9_-]{16,}$/.test(v) || /^[A-Za-z0-9_-]{20,}$/.test(v)
        ? { ok: true }
        : { ok: false, message: 'Thường bắt đầu bằng glpat-. Hãy kiểm tra lại.' };
    case 'bitbucket':
      return /^[^:\s]+:\S+$/.test(v) ? { ok: true } : { ok: false, message: 'Định dạng đúng: username:app_password.' };
  }
}

export type TokenTestResult = { ok: true; message: string } | { ok: false; message: string };

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms = 12_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

/** Thử token bằng một yêu cầu đọc nhẹ. Bitbucket không thử được an toàn qua trình duyệt nên chỉ kiểm tra định dạng. */
export async function testGitToken(provider: GitProvider, raw: string): Promise<TokenTestResult> {
  const token = raw.trim();
  if (!token) return { ok: false, message: 'Chưa nhập token.' };
  try {
    if (provider === 'github') {
      const res = await withTimeout((signal) =>
        fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
          signal,
        })
      );
      if (res.status === 401) return { ok: false, message: 'GitHub từ chối token (sai hoặc đã hết hạn).' };
      if (!res.ok && res.status !== 403) return { ok: false, message: `GitHub trả về lỗi ${res.status}.` };
      if (res.status === 403) return { ok: false, message: 'Token bị từ chối hoặc đã hết hạn mức. Thử lại sau.' };
      const data = (await res.json().catch(() => ({}))) as { login?: string };
      const left = res.headers.get('x-ratelimit-remaining');
      const limit = res.headers.get('x-ratelimit-limit');
      return {
        ok: true,
        message: `Hợp lệ${data.login ? ` — tài khoản ${data.login}` : ''}${limit ? ` · còn ${left}/${limit} request/giờ` : ''}.`,
      };
    }
    if (provider === 'gitlab') {
      const res = await withTimeout((signal) =>
        fetch('https://gitlab.com/api/v4/personal_access_tokens/self', { headers: { 'PRIVATE-TOKEN': token }, signal })
      );
      if (res.status === 401) return { ok: false, message: 'GitLab từ chối token (sai hoặc đã hết hạn).' };
      if (!res.ok) return { ok: false, message: `GitLab trả về lỗi ${res.status}.` };
      const data = (await res.json().catch(() => ({}))) as { name?: string; scopes?: string[]; expires_at?: string | null };
      const scopes = data.scopes?.length ? ` · quyền: ${data.scopes.join(', ')}` : '';
      const exp = data.expires_at ? ` · hết hạn ${data.expires_at}` : '';
      return { ok: true, message: `Hợp lệ${data.name ? ` — ${data.name}` : ''}${scopes}${exp}.` };
    }
    return checkTokenFormat('bitbucket', token).ok
      ? { ok: true, message: 'Định dạng hợp lệ (Bitbucket không hỗ trợ kiểm tra trực tiếp từ trình duyệt).' }
      : { ok: false, message: 'Định dạng đúng: username:app_password.' };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, message: 'Hết thời gian chờ. Thử lại sau.' };
    return { ok: false, message: 'Không kết nối được tới dịch vụ. Kiểm tra mạng rồi thử lại.' };
  }
}
