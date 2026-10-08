/**
 * Logic cho "Phân tích Repo": tính toán thuần (median, bus factor, semver, cadence, tuổi issue, heatmap...)
 * và bộ điều phối gọi GitHub REST API công khai (giới hạn đồng thời, hủy khi đổi repo, xử lý 202 của /stats).
 * Không phụ thuộc React.
 */
import {
  GhOptions,
  LangShare,
  RateInfo,
  RepoError,
  RepoInfo,
  ghGet,
  ghJson,
  languageShares,
} from '@/lib/repo-viewer';

/* ---------------- Toán học cơ bản ---------------- */

export const DAY_MS = 86_400_000;

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function mean(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function daysBetween(a: string | number | Date, b: string | number | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS;
}

/** Định dạng số ngày (có thể lẻ) thành chuỗi tiếng Việt. */
export function formatDays(d: number | null | undefined): string {
  if (d === null || d === undefined || !Number.isFinite(d)) return '—';
  if (d < 1 / 24) return `${Math.max(1, Math.round(d * 1440))} phút`;
  if (d < 1) return `${Math.round(d * 24)} giờ`;
  if (d < 10) return `${d.toFixed(1).replace(/\.0$/, '')} ngày`;
  if (d < 365) return `${Math.round(d)} ngày`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')} năm`;
}

/* ---------------- Semver & release cadence ---------------- */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  pre: string;
}

/** Phân tích tag dạng v1.2.3, 1.2, release-1.2.3, pkg@1.2.3-beta.1. Trả null nếu không giống semver. */
export function parseSemver(tag: string): Semver | null {
  if (typeof tag !== 'string' || tag.length > 120) return null;
  const rest = tag.trim().replace(/^\D*/, '');
  const m = rest.match(/^(\d{1,9})\.(\d{1,9})(?:\.(\d{1,9}))?(?:[-+]([0-9A-Za-z.+-]{0,60}))?$/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: m[3] ? +m[3] : 0, pre: m[4] ?? '' };
}

export interface SemverMix {
  major: number;
  minor: number;
  patch: number;
  other: number; // bản không tăng (backport, tag lệch)
  parseable: number; // số release ổn định phân tích được
  total: number;
}

/** `tagsChrono`: tag theo thứ tự thời gian tăng dần. Chỉ tính bản ổn định (không có hậu tố pre-release). */
export function semverBumpMix(tagsChrono: string[]): SemverMix {
  const parsed = tagsChrono.map(parseSemver).filter((s): s is Semver => !!s && !s.pre);
  const mix: SemverMix = { major: 0, minor: 0, patch: 0, other: 0, parseable: parsed.length, total: tagsChrono.length };
  for (let i = 1; i < parsed.length; i++) {
    const p = parsed[i - 1];
    const c = parsed[i];
    if (c.major > p.major) mix.major++;
    else if (c.major === p.major && c.minor > p.minor) mix.minor++;
    else if (c.major === p.major && c.minor === p.minor && c.patch > p.patch) mix.patch++;
    else mix.other++;
  }
  return mix;
}

export interface ReleaseLite {
  tag: string;
  name: string | null;
  url: string;
  date: string; // ISO
  prerelease: boolean;
}

export interface Cadence {
  count: number;
  gaps: number[]; // ngày giữa 2 release liên tiếp (cũ -> mới)
  medianDays: number | null;
  meanDays: number | null;
  daysSinceLast: number | null;
  perYear: number | null; // ước lượng số release/năm theo cadence trung vị
  first: string | null;
  last: string | null;
}

export function releaseCadence(dates: string[], now: number = Date.now()): Cadence {
  const t = dates.map((d) => Date.parse(d)).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < t.length; i++) gaps.push((t[i] - t[i - 1]) / DAY_MS);
  const med = median(gaps);
  return {
    count: t.length,
    gaps,
    medianDays: med,
    meanDays: mean(gaps),
    daysSinceLast: t.length ? (now - t[t.length - 1]) / DAY_MS : null,
    perYear: med && med > 0 ? 365 / med : null,
    first: t.length ? new Date(t[0]).toISOString() : null,
    last: t.length ? new Date(t[t.length - 1]).toISOString() : null,
  };
}

/* ---------------- Tuổi issue / PR ---------------- */

export const AGE_BUCKETS = [
  { label: '≤ 7 ngày', maxDays: 7 },
  { label: '8–30 ngày', maxDays: 30 },
  { label: '31–90 ngày', maxDays: 90 },
  { label: '91–365 ngày', maxDays: 365 },
  { label: '> 1 năm', maxDays: Infinity },
] as const;

export function ageBuckets(createdAt: string[], now: number = Date.now()): number[] {
  const out = AGE_BUCKETS.map(() => 0);
  for (const s of createdAt) {
    const t = Date.parse(s);
    if (!Number.isFinite(t)) continue;
    const age = Math.max(0, (now - t) / DAY_MS);
    const i = AGE_BUCKETS.findIndex((b) => age <= b.maxDays);
    out[i < 0 ? out.length - 1 : i]++;
  }
  return out;
}

/** Từ số đếm "tạo trong ≤7/30/90/365 ngày" (cộng dồn) và tổng, suy ra số lượng theo từng nhóm tuổi. */
export function bucketsFromCumulative(newerThan: [number, number, number, number], total: number): number[] {
  const [c7, c30, c90, c365] = newerThan;
  const cum = [c7, Math.max(c7, c30), Math.max(c7, c30, c90), Math.max(c7, c30, c90, c365), Math.max(total, c7, c30, c90, c365)];
  return cum.map((c, i) => c - (i ? cum[i - 1] : 0));
}

/* ---------------- Contributors & bus factor ---------------- */

export interface Contributor {
  login: string;
  url: string;
  commits: number;
  additions?: number;
  deletions?: number;
  share: number; // 0..100
}

export interface StatsContributor {
  total: number;
  weeks?: { w: number; a: number; d: number; c: number }[];
  author: { login: string; html_url: string } | null;
}

export function contributorsFromStats(raw: StatsContributor[]): Contributor[] {
  const total = raw.reduce((s, c) => s + (c.total || 0), 0);
  return raw
    .filter((c) => c.total > 0)
    .map((c) => ({
      login: c.author?.login ?? '(đã xóa tài khoản)',
      url: c.author?.html_url ?? '',
      commits: c.total,
      additions: c.weeks?.reduce((s, w) => s + (w.a || 0), 0),
      deletions: c.weeks?.reduce((s, w) => s + (w.d || 0), 0),
      share: total ? (c.total / total) * 100 : 0,
    }))
    .sort((a, b) => b.commits - a.commits);
}

export function contributorsFromList(raw: { login: string; html_url: string; contributions: number }[]): Contributor[] {
  const total = raw.reduce((s, c) => s + (c.contributions || 0), 0);
  return raw
    .filter((c) => c.contributions > 0)
    .map((c) => ({
      login: c.login,
      url: c.html_url,
      commits: c.contributions,
      share: total ? (c.contributions / total) * 100 : 0,
    }))
    .sort((a, b) => b.commits - a.commits);
}

export interface BusFactor {
  n: number; // số người tối thiểu để phủ >= threshold commit
  total: number;
  covered: number;
  threshold: number;
}

/** Số contributor ít nhất mà tổng commit chiếm >= `threshold` (mặc định 50%) tổng commit. */
export function busFactor(commits: number[], threshold = 0.5): BusFactor {
  const v = commits.filter((x) => x > 0).sort((a, b) => b - a);
  const total = v.reduce((a, b) => a + b, 0);
  if (!total) return { n: 0, total: 0, covered: 0, threshold };
  let acc = 0;
  let n = 0;
  for (const c of v) {
    acc += c;
    n++;
    if (acc >= total * threshold) break;
  }
  return { n, total, covered: acc, threshold };
}

export function busFactorRisk(n: number): { level: 'high' | 'medium' | 'low'; text: string } {
  if (n <= 1) return { level: 'high', text: 'Rủi ro cao: một người làm ra phần lớn commit.' };
  if (n <= 3) return { level: 'medium', text: 'Rủi ro trung bình: vài người gánh phần lớn công việc.' };
  return { level: 'low', text: 'Công việc được chia khá đều cho nhiều người.' };
}

/* ---------------- Heatmap punch card ---------------- */

export interface Heatmap {
  /** matrix[day][hour], day 0 = Chủ nhật (theo GitHub), giờ theo UTC */
  matrix: number[][];
  max: number;
  total: number;
  peak: { day: number; hour: number; count: number } | null;
  byDay: number[];
  byHour: number[];
}

export function heatmapMatrix(punch: [number, number, number][]): Heatmap {
  const matrix = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const e of punch) {
    if (!Array.isArray(e)) continue;
    const [d, h, c] = e;
    if (Number.isInteger(d) && Number.isInteger(h) && d >= 0 && d < 7 && h >= 0 && h < 24 && c > 0) matrix[d][h] += c;
  }
  let max = 0;
  let total = 0;
  let peak: Heatmap['peak'] = null;
  const byDay = new Array<number>(7).fill(0);
  const byHour = new Array<number>(24).fill(0);
  for (let d = 0; d < 7; d++)
    for (let h = 0; h < 24; h++) {
      const c = matrix[d][h];
      total += c;
      byDay[d] += c;
      byHour[h] += c;
      if (c > max) {
        max = c;
        peak = { day: d, hour: h, count: c };
      }
    }
  return { matrix, max, total, peak, byDay, byHour };
}

export const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
/** Thứ tự hiển thị: T2..CN */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/* ---------------- Hoạt động theo tuần / code frequency ---------------- */

export interface WeekPoint {
  week: number; // epoch giây, đầu tuần
  total: number;
}

export function weeklyFromActivity(raw: { week: number; total: number }[]): WeekPoint[] {
  return raw.filter((w) => w && Number.isFinite(w.week)).map((w) => ({ week: w.week, total: w.total || 0 }));
}

export interface CodeFreqPoint {
  week: number;
  additions: number;
  deletions: number; // số dương
}

export function codeFrequencyFromRaw(raw: [number, number, number][]): CodeFreqPoint[] {
  return raw
    .filter((r) => Array.isArray(r) && r.length >= 3)
    .map(([week, a, d]) => ({ week, additions: Math.max(0, a), deletions: Math.abs(d) }));
}

export function commitsPerWeek(weeks: WeekPoint[]): number | null {
  if (!weeks.length) return null;
  return weeks.reduce((s, w) => s + w.total, 0) / weeks.length;
}

/* ---------------- Trạng thái hoạt động ---------------- */

export type ActivityLevel = 'active' | 'slowing' | 'dormant';

export interface ActivityStatus {
  level: ActivityLevel;
  label: string;
  reason: string;
  daysSincePush: number;
  recent12: number | null;
  prev12: number | null;
}

export function activityStatus(
  pushedAt: string,
  archived: boolean,
  weekly: WeekPoint[] | null,
  now: number = Date.now()
): ActivityStatus {
  const since = Math.max(0, (now - Date.parse(pushedAt)) / DAY_MS);
  const sum = (a: WeekPoint[]) => a.reduce((s, w) => s + w.total, 0);
  const w = weekly && weekly.length >= 4 ? weekly : null;
  const recent12 = w ? sum(w.slice(-12)) : null;
  const prev12 = w ? sum(w.slice(-24, -12)) : null;
  const last26 = w ? sum(w.slice(-26)) : null;
  const base = { daysSincePush: since, recent12, prev12 };
  if (archived) return { ...base, level: 'dormant', label: 'Ngừng hoạt động', reason: 'Repo đã được lưu trữ (archived).' };
  if (!Number.isFinite(since)) return { ...base, level: 'slowing', label: 'Chậm lại', reason: 'Không xác định được lần push gần nhất.' };
  if (since > 180 || (last26 === 0 && since > 60))
    return { ...base, level: 'dormant', label: 'Ngừng hoạt động', reason: `Lần push cuối cách đây ${formatDays(since)}${last26 === 0 ? ', không có commit trong 26 tuần qua' : ''}.` };
  const declining = recent12 !== null && prev12 !== null && prev12 > 0 && recent12 < prev12 * 0.5;
  if (since > 30 || declining) {
    const why = declining ? `commit 12 tuần gần nhất (${recent12}) giảm hơn một nửa so với 12 tuần trước đó (${prev12})` : `lần push cuối cách đây ${formatDays(since)}`;
    return { ...base, level: 'slowing', label: 'Chậm lại', reason: `Đang chậm lại: ${why}.` };
  }
  return {
    ...base,
    level: 'active',
    label: 'Đang hoạt động',
    reason: `Lần push cuối cách đây ${formatDays(since)}${recent12 !== null ? `, ${recent12} commit trong 12 tuần qua` : ''}.`,
  };
}

/* ---------------- PR / issue ---------------- */

export function medianTimeToMergeDays(prs: { created_at: string; merged_at: string | null }[]): { median: number | null; mean: number | null; merged: number; sample: number } {
  const days = prs.filter((p) => p.merged_at).map((p) => daysBetween(p.created_at, p.merged_at as string)).filter((d) => d >= 0);
  return { median: median(days), mean: mean(days), merged: days.length, sample: prs.length };
}

export interface FirstResponseSample {
  created_at: string;
  user: string;
  comments: { created_at: string; user: string; isBot: boolean }[];
}

/** Ước lượng thời gian phản hồi đầu tiên (không tính chính tác giả và bot). Chỉ là ước lượng từ mẫu nhỏ. */
export function estimateFirstResponse(samples: FirstResponseSample[]): {
  medianDays: number | null;
  responded: number;
  sample: number;
  unanswered: number;
} {
  const times: number[] = [];
  for (const s of samples) {
    const first = s.comments
      .filter((c) => !c.isBot && c.user !== s.user)
      .map((c) => daysBetween(s.created_at, c.created_at))
      .filter((d) => d >= 0)
      .sort((a, b) => a - b)[0];
    if (first !== undefined) times.push(first);
  }
  return { medianDays: median(times), responded: times.length, sample: samples.length, unanswered: samples.length - times.length };
}

/* ---------------- Sức khỏe cộng đồng ---------------- */

export interface CommunityItem {
  key: 'readme' | 'license' | 'contributing' | 'code_of_conduct';
  label: string;
  present: boolean;
}

export interface Community {
  healthPercentage: number | null;
  items: CommunityItem[];
}

export function parseCommunity(raw: {
  health_percentage?: number;
  files?: Record<string, unknown>;
}): Community {
  const f = raw.files ?? {};
  const has = (k: string) => f[k] !== null && f[k] !== undefined;
  return {
    healthPercentage: typeof raw.health_percentage === 'number' ? raw.health_percentage : null,
    items: [
      { key: 'readme', label: 'README', present: has('readme') },
      { key: 'license', label: 'LICENSE', present: has('license') },
      { key: 'contributing', label: 'CONTRIBUTING', present: has('contributing') },
      { key: 'code_of_conduct', label: 'CODE_OF_CONDUCT', present: has('code_of_conduct') || has('code_of_conduct_file') },
    ],
  };
}

/* ---------------- Điều phối & fetch ---------------- */

export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= max) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Gọi endpoint /stats/*: GitHub trả 202 khi đang tính -> thử lại với backoff, tối đa `maxWaitMs`. 204 = không có dữ liệu. */
export async function fetchStats<T>(
  path: string,
  opts: GhOptions,
  onWaiting?: () => void,
  maxWaitMs = 20_000,
  sleepFn: (ms: number, s?: AbortSignal) => Promise<void> = sleep,
  gate: <U>(fn: () => Promise<U>) => Promise<U> = (fn) => fn()
): Promise<T | null> {
  let waited = 0;
  for (let i = 0; ; i++) {
    let res: Response;
    try {
      res = await gate(() => ghGet(path, opts));
    } catch (e) {
      if (e instanceof RepoError && e.status === 422) throw new RepoError('Repo quá lớn: GitHub không cung cấp thống kê này.', 422);
      throw e;
    }
    if (res.status === 204) return null;
    if (res.status !== 202) {
      const data = (await res.json()) as T;
      return data;
    }
    onWaiting?.();
    const delay = Math.min(1000 * Math.pow(1.5, i), 4000);
    if (waited + delay > maxWaitMs) throw new RepoError('GitHub vẫn đang tính thống kê (202). Hãy thử lại sau ít phút.', 202);
    await sleepFn(delay, opts.signal);
    waited += delay;
  }
}

export interface OpenItem {
  number: number;
  title: string;
  url: string;
  created_at: string;
  user: string;
  comments: number;
}

export interface OpenSummary {
  total: number;
  buckets: number[];
  bucketsExact: boolean; // false nếu thiếu lượt search để đếm chính xác
  oldest: OpenItem[];
}

export interface Analysis {
  fullName: string;
  fetchedAt: string;
  info: RepoInfo;
  languages?: LangShare[];
  contributors?: Contributor[];
  contributorsSource?: 'stats' | 'list';
  contributorsTruncated?: boolean;
  bus?: BusFactor;
  heatmap?: Heatmap;
  weekly?: WeekPoint[];
  codeFreq?: CodeFreqPoint[];
  releases?: { list: ReleaseLite[]; cadence: Cadence; mix: SemverMix };
  issues?: OpenSummary;
  prs?: OpenSummary;
  prMerge?: ReturnType<typeof medianTimeToMergeDays>;
  firstResponse?: ReturnType<typeof estimateFirstResponse>;
  community?: Community;
  status?: ActivityStatus;
  /** Lỗi theo mục (khóa = tên mục) */
  errors: Record<string, string>;
  /** Mục bị bỏ qua vì cạn quota */
  skipped: string[];
  computing: boolean; // GitHub đang tính thống kê
}

export interface AnalyzeHooks {
  onUpdate: (a: Analysis) => void;
  onRate?: (r: RateInfo) => void;
  onSearchRate?: (r: RateInfo) => void;
}

interface RawIssue {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  comments: number;
  user: { login: string; type?: string } | null;
  pull_request?: unknown;
}

const asItem = (i: RawIssue): OpenItem => ({
  number: i.number,
  title: i.title,
  url: i.html_url,
  created_at: i.created_at,
  user: i.user?.login ?? '?',
  comments: i.comments ?? 0,
});

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function analyzeRepo(
  owner: string,
  repo: string,
  base: { token?: string; signal: AbortSignal },
  hooks: AnalyzeHooks,
  light = false
): Promise<Analysis> {
  const o = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  const p = `/repos/${o}/${r}`;
  let remaining: number | null = null;
  const opts: GhOptions = {
    token: base.token,
    signal: base.signal,
    onRate: (rt) => {
      remaining = rt.remaining;
      hooks.onRate?.(rt);
    },
  };
  const searchOpts: GhOptions = {
    token: base.token,
    signal: base.signal,
    onRate: (rt) => {
      searchRemaining = rt.remaining;
      hooks.onSearchRate?.(rt);
    },
  };
  let searchRemaining: number | null = null;
  const limit = createLimiter(4);
  const now = Date.now();

  const info = await ghJson<RepoInfo>(p, opts);
  const a: Analysis = {
    fullName: info.full_name,
    fetchedAt: new Date().toISOString(),
    info,
    errors: {},
    skipped: [],
    computing: false,
  };
  const emit = () => {
    if (base.signal.aborted) return;
    a.status = activityStatus(info.pushed_at, info.archived, a.weekly ?? null, now);
    if (a.contributors) a.bus = busFactor(a.contributors.map((c) => c.commits));
    hooks.onUpdate({ ...a, errors: { ...a.errors }, skipped: [...a.skipped] });
  };
  emit();

  const section = async (key: string, need: number, fn: () => Promise<void>) => {
    if (base.signal.aborted) return;
    if (remaining !== null && remaining < need) {
      a.skipped.push(key);
      emit();
      return;
    }
    try {
      await limit(fn);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      a.errors[key] = e instanceof Error ? e.message : 'Lỗi không xác định.';
    }
    emit();
  };
  const onWaiting = () => {
    if (!a.computing) {
      a.computing = true;
      emit();
    }
  };
  // fetchStats ngủ ngoài limiter để không chiếm slot: gọi qua section chỉ cho phần mạng thật
  const stats = <T,>(path: string) => fetchStats<T>(path, opts, onWaiting, 20_000, sleep, limit);

  const tasks: Promise<void>[] = [];

  tasks.push(
    section('Ngôn ngữ', 5, async () => {
      const l = await ghJson<Record<string, number>>(`${p}/languages`, opts);
      a.languages = languageShares(l);
    })
  );

  tasks.push(
    (async () => {
      if (base.signal.aborted) return;
      if (remaining !== null && remaining < 8) {
        a.skipped.push('Contributor');
        return emit();
      }
      try {
        const raw = await stats<StatsContributor[]>(`${p}/stats/contributors`);
        if (raw && Array.isArray(raw) && raw.length) {
          a.contributors = contributorsFromStats(raw);
          a.contributorsSource = 'stats';
        } else throw new RepoError('Không có dữ liệu thống kê contributor.');
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        try {
          const raw = await limit(() => ghJson<{ login: string; html_url: string; contributions: number }[]>(`${p}/contributors?per_page=100`, opts));
          a.contributors = contributorsFromList(Array.isArray(raw) ? raw : []);
          a.contributorsSource = 'list';
          a.contributorsTruncated = raw.length >= 100;
        } catch (e2) {
          if ((e2 as Error)?.name === 'AbortError') return;
          a.errors['Contributor'] = e2 instanceof Error ? e2.message : 'Lỗi không xác định.';
        }
      }
      emit();
    })()
  );

  tasks.push(
    (async () => {
      if (base.signal.aborted) return;
      if (remaining !== null && remaining < 8) {
        a.skipped.push('Hoạt động theo tuần');
        return emit();
      }
      try {
        const raw = await stats<{ week: number; total: number }[]>(`${p}/stats/commit_activity`);
        a.weekly = raw ? weeklyFromActivity(raw) : [];
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        a.errors['Hoạt động theo tuần'] = e instanceof Error ? e.message : 'Lỗi không xác định.';
      }
      emit();
    })()
  );

  tasks.push(
    section('Releases', 5, async () => {
      const raw = await ghJson<
        { tag_name: string; name: string | null; html_url: string; published_at: string | null; created_at: string; prerelease: boolean; draft: boolean }[]
      >(`${p}/releases?per_page=100`, opts);
      const list: ReleaseLite[] = (Array.isArray(raw) ? raw : [])
        .filter((x) => !x.draft && (x.published_at || x.created_at))
        .map((x) => ({ tag: x.tag_name, name: x.name, url: x.html_url, date: (x.published_at || x.created_at) as string, prerelease: x.prerelease }))
        .sort((x, y) => Date.parse(x.date) - Date.parse(y.date));
      const stable = list.filter((x) => !x.prerelease);
      a.releases = {
        list,
        cadence: releaseCadence(stable.map((x) => x.date), now),
        mix: semverBumpMix(stable.map((x) => x.tag)),
      };
    })
  );

  if (!light) {
    tasks.push(
      (async () => {
        if (base.signal.aborted) return;
        if (remaining !== null && remaining < 8) {
          a.skipped.push('Punch card');
          return emit();
        }
        try {
          const raw = await stats<[number, number, number][]>(`${p}/stats/punch_card`);
          a.heatmap = heatmapMatrix(raw ?? []);
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return;
          a.errors['Punch card'] = e instanceof Error ? e.message : 'Lỗi không xác định.';
        }
        emit();
      })(),
      (async () => {
        if (base.signal.aborted) return;
        if (remaining !== null && remaining < 8) {
          a.skipped.push('Code frequency');
          return emit();
        }
        try {
          const raw = await stats<[number, number, number][]>(`${p}/stats/code_frequency`);
          a.codeFreq = codeFrequencyFromRaw(raw ?? []);
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return;
          a.errors['Code frequency'] = e instanceof Error ? e.message : 'Lỗi không xác định.';
        }
        emit();
      })()
    );

    tasks.push(
      section('Sức khỏe cộng đồng', 5, async () => {
        const raw = await ghJson<{ health_percentage?: number; files?: Record<string, unknown> }>(`${p}/community/profile`, opts);
        a.community = parseCommunity(raw);
      })
    );

    tasks.push(
      section('PR đã đóng', 8, async () => {
        const raw = await ghJson<{ created_at: string; merged_at: string | null }[]>(
          `${p}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
          opts
        );
        a.prMerge = medianTimeToMergeDays(Array.isArray(raw) ? raw : []);
      })
    );

    // Search API: quota riêng (10/phút khi chưa token, 30/phút khi có token) -> chạy tuần tự
    const searchOpen = async (kind: 'issue' | 'pr'): Promise<OpenSummary> => {
      const q = `repo:${owner}/${repo} is:${kind} is:open`;
      const first = await ghJson<{ total_count: number; items: RawIssue[] }>(
        `/search/issues?q=${encodeURIComponent(q)}&sort=created&order=asc&per_page=100`,
        searchOpts
      );
      const items = (first.items ?? []).map(asItem);
      const total = first.total_count ?? items.length;
      if (total <= items.length) {
        return { total, buckets: ageBuckets(items.map((i) => i.created_at), now), bucketsExact: true, oldest: items.slice(0, 10) };
      }
      // Quá 100 mục: đếm theo ngưỡng thời gian
      const counts: number[] = [];
      let exact = true;
      for (const d of [7, 30, 90, 365]) {
        if (searchRemaining !== null && searchRemaining < 1) {
          exact = false;
          counts.push(0);
          continue;
        }
        try {
          const c = await ghJson<{ total_count: number }>(
            `/search/issues?q=${encodeURIComponent(`${q} created:>=${isoDay(now - d * DAY_MS)}`)}&per_page=1`,
            searchOpts
          );
          counts.push(c.total_count ?? 0);
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') throw e;
          exact = false;
          counts.push(0);
        }
      }
      return {
        total,
        buckets: exact ? bucketsFromCumulative(counts as [number, number, number, number], total) : [],
        bucketsExact: exact,
        oldest: items.slice(0, 10),
      };
    };
    tasks.push(
      (async () => {
        for (const kind of ['issue', 'pr'] as const) {
          const key = kind === 'issue' ? 'Issue đang mở' : 'PR đang mở';
          if (base.signal.aborted) return;
          if (searchRemaining !== null && searchRemaining < 2) {
            a.skipped.push(key);
            continue;
          }
          try {
            const s = await limit(() => searchOpen(kind));
            if (kind === 'issue') a.issues = s;
            else a.prs = s;
          } catch (e) {
            if ((e as Error)?.name === 'AbortError') return;
            const msg = e instanceof Error ? e.message : 'Lỗi không xác định.';
            a.errors[key] = /hết lượt/.test(msg) ? 'Đã hết lượt Search API của GitHub (rất thấp: 10 lượt/phút nếu chưa có token). Thử lại sau 1 phút.' : msg;
          }
          emit();
        }
      })()
    );

    // Ước lượng thời gian phản hồi đầu tiên: nhiều lệnh gọi -> chỉ chạy khi quota còn dư
    tasks.push(
      section('Phản hồi issue đầu tiên', 80, async () => {
        const raw = await ghJson<RawIssue[]>(`${p}/issues?state=all&sort=created&direction=desc&per_page=60`, opts);
        const issues = (Array.isArray(raw) ? raw : []).filter((i) => !i.pull_request).slice(0, 30);
        const samples: FirstResponseSample[] = [];
        const lim = createLimiter(4);
        await Promise.all(
          issues.map((i) =>
            lim(async () => {
              const s: FirstResponseSample = { created_at: i.created_at, user: i.user?.login ?? '', comments: [] };
              if (i.comments > 0) {
                const cs = await ghJson<{ created_at: string; user: { login: string; type?: string } | null }[]>(
                  `${p}/issues/${i.number}/comments?per_page=10`,
                  opts
                );
                s.comments = cs.map((c) => ({
                  created_at: c.created_at,
                  user: c.user?.login ?? '',
                  isBot: c.user?.type === 'Bot' || /\[bot\]$/.test(c.user?.login ?? ''),
                }));
              }
              samples.push(s);
            })
          )
        );
        a.firstResponse = estimateFirstResponse(samples);
      })
    );
  }

  await Promise.allSettled(tasks);
  if (!base.signal.aborted) {
    a.computing = false;
    emit();
  }
  return a;
}

/* ---------------- So sánh ---------------- */

export interface KeyMetrics {
  stars: number;
  forks: number;
  contributors: number | null;
  commitsPerWeek: number | null;
  releaseIntervalDays: number | null;
  openIssues: number;
}

export function keyMetrics(a: Analysis): KeyMetrics {
  return {
    stars: a.info.stargazers_count,
    forks: a.info.forks_count,
    contributors: a.contributors ? a.contributors.length : null,
    commitsPerWeek: a.weekly ? commitsPerWeek(a.weekly) : null,
    releaseIntervalDays: a.releases?.cadence.medianDays ?? null,
    openIssues: a.info.open_issues_count,
  };
}

/* ---------------- Xuất ---------------- */

function csvCell(v: string | number | undefined): string {
  let s = v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // chống công thức trong Excel
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function contributorsCsv(list: Contributor[]): string {
  const rows = [['login', 'commits', 'share_percent', 'additions', 'deletions', 'url']];
  for (const c of list) rows.push([c.login, String(c.commits), c.share.toFixed(2), String(c.additions ?? ''), String(c.deletions ?? ''), c.url]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function analysisJson(a: Analysis): string {
  return JSON.stringify(
    {
      repo: a.fullName,
      fetchedAt: a.fetchedAt,
      note: 'Giờ trong punch card tính theo UTC. Phản hồi issue đầu tiên chỉ là ước lượng từ mẫu nhỏ.',
      info: {
        stars: a.info.stargazers_count,
        forks: a.info.forks_count,
        openIssuesAndPrs: a.info.open_issues_count,
        license: a.info.license?.spdx_id ?? null,
        createdAt: a.info.created_at,
        pushedAt: a.info.pushed_at,
        archived: a.info.archived,
      },
      status: a.status,
      languages: a.languages?.map((l) => ({ name: l.name, bytes: l.bytes, percent: +l.percent.toFixed(2) })),
      contributors: a.contributors,
      contributorsSource: a.contributorsSource,
      busFactor: a.bus,
      weeklyCommits: a.weekly,
      codeFrequency: a.codeFreq,
      punchCard: a.heatmap ? { matrix: a.heatmap.matrix, timezone: 'UTC', dayIndex: '0 = Chủ nhật' } : undefined,
      releases: a.releases && {
        cadence: { ...a.releases.cadence, gaps: undefined },
        semverMix: a.releases.mix,
        latest: a.releases.list.slice(-10).reverse().map((x) => ({ tag: x.tag, date: x.date, prerelease: x.prerelease })),
      },
      openIssues: a.issues,
      openPrs: a.prs,
      prMerge: a.prMerge,
      firstResponseEstimate: a.firstResponse,
      community: a.community,
      skipped: a.skipped,
      errors: a.errors,
    },
    null,
    2
  );
}

const mdEsc = (s: string) => s.replace(/[|\\`*_[\]<>]/g, '\\$&').replace(/\s+/g, ' ');

export function analysisMarkdown(a: Analysis): string {
  const L: string[] = [];
  const i = a.info;
  L.push(`# Phân tích repo ${a.fullName}`, '');
  L.push(`_Dữ liệu lấy từ GitHub API lúc ${new Date(a.fetchedAt).toLocaleString('vi-VN')}._`, '');
  if (i.description) L.push(`> ${mdEsc(i.description)}`, '');
  L.push('## Tổng quan', '');
  L.push(`- Sao: ${i.stargazers_count.toLocaleString('vi-VN')} | Fork: ${i.forks_count.toLocaleString('vi-VN')} | Issue + PR mở: ${i.open_issues_count.toLocaleString('vi-VN')}`);
  L.push(`- Giấy phép: ${i.license?.name ?? 'không rõ'} | Tạo: ${i.created_at.slice(0, 10)} | Push cuối: ${i.pushed_at.slice(0, 10)}`);
  if (a.status) L.push(`- Trạng thái: **${a.status.label}** — ${a.status.reason}`);
  L.push('');
  if (a.languages?.length) {
    L.push('## Ngôn ngữ', '', a.languages.slice(0, 8).map((l) => `${l.name} ${l.percent.toFixed(1)}%`).join(', '), '');
  }
  if (a.contributors?.length) {
    L.push('## Contributor', '');
    if (a.bus) L.push(`**Bus factor (ước lượng): ${a.bus.n}** — số người ít nhất cùng đóng góp >= 50% tổng ${a.bus.total.toLocaleString('vi-VN')} commit.`, '');
    L.push('| # | Tài khoản | Commit | Tỷ lệ |', '|---|---|---:|---:|');
    a.contributors.slice(0, 10).forEach((c, k) => L.push(`| ${k + 1} | ${mdEsc(c.login)} | ${c.commits.toLocaleString('vi-VN')} | ${c.share.toFixed(1)}% |`));
    L.push('');
  }
  if (a.weekly?.length) {
    const cpw = commitsPerWeek(a.weekly);
    L.push('## Hoạt động commit (52 tuần)', '', `- Tổng: ${a.weekly.reduce((s, w) => s + w.total, 0).toLocaleString('vi-VN')} commit, trung bình ${cpw?.toFixed(1)} commit/tuần`, '');
  }
  if (a.heatmap?.peak) {
    const pk = a.heatmap.peak;
    L.push('## Giờ commit (UTC)', '', `- Cao điểm: ${DAY_NAMES[pk.day]} lúc ${String(pk.hour).padStart(2, '0')}:00 UTC (${pk.count} commit)`, '');
  }
  if (a.releases) {
    const c = a.releases.cadence;
    L.push('## Release', '');
    L.push(`- ${c.count} bản phát hành ổn định; trung vị ${formatDays(c.medianDays)}, trung bình ${formatDays(c.meanDays)} giữa hai bản; bản gần nhất cách đây ${formatDays(c.daysSinceLast)}`);
    const m = a.releases.mix;
    if (m.parseable > 1) L.push(`- Semver: major ${m.major}, minor ${m.minor}, patch ${m.patch}, khác ${m.other} (trên ${m.parseable} bản phân tích được)`);
    L.push(`- Mới nhất: ${a.releases.list.slice(-5).reverse().map((x) => mdEsc(x.tag)).join(', ') || '—'}`, '');
  }
  for (const [t, s] of [['Issue đang mở', a.issues], ['PR đang mở', a.prs]] as const) {
    if (!s) continue;
    L.push(`## ${t}`, '', `- Tổng: ${s.total.toLocaleString('vi-VN')}`);
    if (s.bucketsExact && s.buckets.length) L.push(`- Phân bố tuổi: ${AGE_BUCKETS.map((b, k) => `${b.label}: ${s.buckets[k]}`).join('; ')}`);
    if (s.oldest.length) {
      L.push('- Lâu nhất:');
      for (const it of s.oldest) L.push(`  - #${it.number} ${mdEsc(it.title)} (${it.created_at.slice(0, 10)})`);
    }
    L.push('');
  }
  if (a.prMerge) L.push('## Thời gian merge PR', '', `- Trung vị ${formatDays(a.prMerge.median)} (mẫu ${a.prMerge.sample} PR đã đóng gần nhất, ${a.prMerge.merged} đã merge)`, '');
  if (a.firstResponse)
    L.push('## Phản hồi issue đầu tiên (ước lượng)', '', `- Trung vị ~${formatDays(a.firstResponse.medianDays)}; ${a.firstResponse.responded}/${a.firstResponse.sample} issue trong mẫu có người khác phản hồi. Chỉ là ước lượng từ mẫu nhỏ.`, '');
  if (a.community) {
    L.push('## Sức khỏe cộng đồng', '', ...(a.community.healthPercentage !== null ? [`- Điểm: ${a.community.healthPercentage}%`] : []), ...a.community.items.map((x) => `- ${x.label}: ${x.present ? 'có' : 'thiếu'}`), '');
  }
  if (a.skipped.length) L.push(`_Bỏ qua do gần hết quota API: ${a.skipped.join(', ')}._`, '');
  return L.join('\n');
}
