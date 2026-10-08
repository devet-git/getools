/**
 * Helper thuần (không React) cho tool "PDF & ZIP":
 * phân tích khoảng trang, tách nhóm trang, làm sạch tên file trong ZIP, định dạng dung lượng.
 */

export type RangeResult =
  | { ok: true; pages: number[]; ranges: Array<[number, number]> }
  | { ok: false; error: string };

/**
 * Phân tích chuỗi khoảng trang kiểu "1-3, 5, 8-10" (số trang bắt đầu từ 1).
 * - Cho phép khoảng trắng; phân tách bằng dấu phẩy hoặc chấm phẩy.
 * - Trang trùng lặp được loại bỏ (giữ thứ tự xuất hiện đầu tiên).
 * - Khoảng ngược (5-3), vượt giới hạn, hoặc sai cú pháp -> lỗi tiếng Việt.
 */
export function parsePageRanges(input: string, total: number): RangeResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Chưa nhập khoảng trang (ví dụ: 1-3,5).' };
  if (!Number.isInteger(total) || total < 1) return { ok: false, error: 'File không có trang nào.' };
  const seen = new Set<number>();
  const pages: number[] = [];
  const ranges: Array<[number, number]> = [];
  const parts = text.split(/[,;]/).map((p) => p.trim());
  for (const part of parts) {
    if (part === '') return { ok: false, error: 'Có dấu phân cách thừa hoặc phần tử rỗng.' };
    const m = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(part);
    if (!m) return { ok: false, error: `Không hiểu "${part}". Dùng dạng 3 hoặc 2-5.` };
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    if (a < 1 || b < 1) return { ok: false, error: `Số trang phải từ 1 trở lên ("${part}").` };
    if (a > b) return { ok: false, error: `Khoảng ngược "${part}": số đầu phải nhỏ hơn hoặc bằng số cuối.` };
    if (b > total) return { ok: false, error: `Trang ${b} vượt quá số trang của file (${total}).` };
    ranges.push([a, b]);
    for (let p = a; p <= b; p++) {
      if (!seen.has(p)) {
        seen.add(p);
        pages.push(p);
      }
    }
  }
  return { ok: true, pages, ranges };
}

export type GroupsResult = { ok: true; groups: number[][] } | { ok: false; error: string };

/** Nhóm tùy chỉnh: mỗi nhóm một dòng (hoặc cách nhau bởi "|"), ví dụ "1-3 | 4,6 | 7-9". */
export function parsePageGroups(input: string, total: number): GroupsResult {
  const lines = input.split(/[\n|]/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { ok: false, error: 'Chưa nhập nhóm trang (mỗi nhóm một dòng, ví dụ: 1-3).' };
  const groups: number[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const r = parsePageRanges(lines[i], total);
    if (!r.ok) return { ok: false, error: `Nhóm ${i + 1}: ${r.error}` };
    groups.push(r.pages);
  }
  return { ok: true, groups };
}

/** Chia total trang thành các nhóm n trang liên tiếp. */
export function chunkPages(total: number, n: number): number[][] {
  const size = Math.max(1, Math.floor(n));
  const out: number[][] = [];
  for (let s = 1; s <= total; s += size) {
    const g: number[] = [];
    for (let p = s; p < s + size && p <= total; p++) g.push(p);
    out.push(g);
  }
  return out;
}

/** Rút gọn danh sách trang thành chuỗi khoảng, ví dụ [1,2,3,5] -> "1-3,5". */
export function formatPageList(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const out: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return out.join(',');
}

/** Đường dẫn trong ZIP có nguy hiểm (path traversal / tuyệt đối)? */
export function isUnsafeZipPath(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return true;
  if (n.split('/').some((seg) => seg === '..')) return true;
  return /[\u0000-\u001f]/.test(n);
}

/** Làm sạch đường dẫn khi nén lại: bỏ "..", "." , gốc tuyệt đối, ký tự điều khiển. */
export function sanitizeZipPath(name: string): string {
  const isDir = /[\\/]$/.test(name);
  const segs = name
    .replace(/\\/g, '/')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/^[a-zA-Z]:/, '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.' && s !== '..');
  const out = segs.join('/');
  if (!out) return '';
  return isDir ? out + '/' : out;
}

/** Tên file an toàn (không đường dẫn) dùng làm tên tải xuống. */
export function sanitizeFileName(name: string, fallback = 'file'): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
  return cleaned || fallback;
}

export function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, '');
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

/** Heuristic: dữ liệu có phải nhị phân? (NUL hoặc nhiều byte điều khiển trong 8KB đầu) */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  if (n === 0) return false;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) ctrl++;
  }
  return ctrl / n > 0.1;
}

/** Cho cùng đường dẫn xuất hiện nhiều lần, thêm hậu tố (2), (3)... */
export function dedupeName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const slash = name.lastIndexOf('/');
  const hasExt = dot > slash + 1;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const cand = `${stem} (${i})${ext}`;
    if (!used.has(cand)) {
      used.add(cand);
      return cand;
    }
  }
}
