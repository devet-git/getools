export const ALL_FLAGS = ['g', 'i', 'm', 's', 'u', 'y'] as const;

export const MAX_MATCHES = 1000;
export const MAX_TIME_MS = 300;
const MAX_SPLIT_PARTS = 1000;

export interface RegexMatch {
  /** Thứ tự khớp (bắt đầu từ 1) */
  no: number;
  index: number;
  end: number;
  text: string;
  /** Các nhóm đánh số 1..n (undefined nếu nhóm không tham gia khớp) */
  groups: (string | undefined)[];
  /** Các nhóm đặt tên */
  named: Record<string, string | undefined>;
}

export interface MatchResult {
  matches: RegexMatch[];
  /** Dừng vì đạt giới hạn số lượng khớp */
  capped: boolean;
  /** Dừng vì quá thời gian cho phép */
  timedOut: boolean;
}

export type BuildResult = { regex: RegExp; error?: undefined } | { regex?: undefined; error: string };

/** Chuẩn hoá flags: bỏ trùng, bỏ ký tự lạ, giữ thứ tự cố định */
export function normalizeFlags(flags: string): string {
  return ALL_FLAGS.filter((f) => flags.includes(f)).join('');
}

export function buildRegex(pattern: string, flags: string): BuildResult {
  if (pattern === '') return { error: '' };
  try {
    return { regex: new RegExp(pattern, normalizeFlags(flags)) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.replace(/^Invalid regular expression:\s*/i, '').replace(/^\/[\s\S]*\/[a-z]*:\s*/, '') };
  }
}

export function formatRegexLiteral(pattern: string, flags: string): string {
  return `/${pattern}/${normalizeFlags(flags)}`;
}

/** Tìm tất cả các khớp, an toàn với khớp rỗng, giới hạn số lượng và thời gian */
export function findMatches(
  source: RegExp,
  text: string,
  maxMatches: number = MAX_MATCHES,
  maxTimeMs: number = MAX_TIME_MS
): MatchResult {
  const re = new RegExp(source.source, source.flags);
  re.lastIndex = 0;
  const loop = re.global || re.sticky;
  const matches: RegexMatch[] = [];
  const start = Date.now();
  let capped = false;
  let timedOut = false;
  let guard = 0;
  const hardLimit = text.length * 2 + maxMatches + 10;

  while (true) {
    if (matches.length >= maxMatches) {
      capped = true;
      break;
    }
    if (++guard > hardLimit || Date.now() - start > maxTimeMs) {
      timedOut = true;
      break;
    }
    const m = re.exec(text);
    if (!m) break;
    matches.push({
      no: matches.length + 1,
      index: m.index,
      end: m.index + m[0].length,
      text: m[0],
      groups: m.slice(1),
      named: m.groups ? { ...m.groups } : {},
    });
    if (!loop) break;
    if (m[0] === '') {
      // Khớp rỗng: phải tiến lastIndex để tránh vòng lặp vô hạn
      if (re.lastIndex >= text.length) break;
      re.lastIndex = advance(text, re.lastIndex, re.unicode);
    }
  }
  return { matches, capped, timedOut };
}

function advance(text: string, i: number, unicode: boolean): number {
  if (unicode) {
    const cp = text.codePointAt(i);
    if (cp !== undefined && cp > 0xffff) return i + 2;
  }
  return i + 1;
}

export interface HighlightPart {
  text: string;
  /** Chỉ số (0-based) của khớp nếu là phần được tô, ngược lại null */
  match: number | null;
  /** Khớp rỗng: hiển thị như dấu chèn */
  empty?: boolean;
}

/** Chia văn bản thành các đoạn thường / đoạn khớp để render bằng React */
export function toHighlightParts(text: string, matches: RegexMatch[]): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let pos = 0;
  matches.forEach((m, i) => {
    if (m.index < pos) return;
    if (m.index > pos) parts.push({ text: text.slice(pos, m.index), match: null });
    if (m.text === '') parts.push({ text: '', match: i, empty: true });
    else parts.push({ text: m.text, match: i });
    pos = m.end;
  });
  if (pos < text.length) parts.push({ text: text.slice(pos), match: null });
  return parts;
}

export interface ReplaceResult {
  output: string;
  error?: string;
}

/** Thay thế; replacement hỗ trợ $1, $<name>, $&, $$ theo chuẩn JavaScript */
export function replaceAll(regex: RegExp, text: string, replacement: string): ReplaceResult {
  try {
    const re = new RegExp(regex.source, regex.flags);
    return { output: text.replace(re, replacement) };
  } catch (e) {
    return { output: '', error: e instanceof Error ? e.message : String(e) };
  }
}

export interface SplitResult {
  parts: string[];
  truncated: boolean;
  total: number;
}

export function splitText(regex: RegExp, text: string): SplitResult {
  try {
    const re = new RegExp(regex.source, regex.flags);
    const all = text.split(re);
    return {
      parts: all.slice(0, MAX_SPLIT_PARTS),
      truncated: all.length > MAX_SPLIT_PARTS,
      total: all.length,
    };
  } catch {
    return { parts: [], truncated: false, total: 0 };
  }
}

export interface ExamplePattern {
  name: string;
  pattern: string;
  flags: string;
  sample: string;
}

export const EXAMPLES: ExamplePattern[] = [
  {
    name: 'Email',
    pattern: '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+',
    flags: 'g',
    sample: 'Liên hệ: an.nguyen@example.com, hotro+vip@congty.vn hoặc sai@@x.',
  },
  {
    name: 'URL',
    pattern: 'https?:\\/\\/[^\\s/$.?#].[^\\s]*',
    flags: 'gi',
    sample: 'Xem https://example.com/path?q=1 và http://getools.dev, không phải ftp://abc.',
  },
  {
    name: 'Ngày dd/mm/yyyy',
    pattern: '\\b(?<ngay>0[1-9]|[12]\\d|3[01])\\/(?<thang>0[1-9]|1[0-2])\\/(?<nam>\\d{4})\\b',
    flags: 'g',
    sample: 'Sinh ngày 05/09/1995, hết hạn 31/12/2030, sai: 32/13/2020.',
  },
  {
    name: 'Số điện thoại VN',
    pattern: '(?:\\+84|0)(?:3|5|7|8|9)\\d{8}\\b',
    flags: 'g',
    sample: 'Gọi 0912345678 hoặc +84987654321, số 0123 không hợp lệ.',
  },
  {
    name: 'Màu hex',
    pattern: '#(?:[0-9a-fA-F]{3}){1,2}\\b',
    flags: 'g',
    sample: 'color: #fff; background: #1E293B; border: #12; fill: #abcdef;',
  },
];

export const CHEATSHEET: { token: string; desc: string }[] = [
  { token: '.', desc: 'Một ký tự bất kỳ (trừ xuống dòng, trừ khi có cờ s)' },
  { token: '\\d  \\w  \\s', desc: 'Chữ số / ký tự chữ-số-gạch dưới / khoảng trắng' },
  { token: '\\D  \\W  \\S', desc: 'Phủ định của các lớp trên' },
  { token: '^  $', desc: 'Đầu / cuối chuỗi (đầu / cuối dòng khi có cờ m)' },
  { token: '\\b  \\B', desc: 'Ranh giới từ / không phải ranh giới từ' },
  { token: '[abc]  [^abc]', desc: 'Một trong / không thuộc các ký tự trong ngoặc' },
  { token: '[a-z0-9]', desc: 'Khoảng ký tự' },
  { token: '*  +  ?', desc: '0 trở lên / 1 trở lên / 0 hoặc 1 lần' },
  { token: '{n}  {n,}  {n,m}', desc: 'Đúng n / ít nhất n / từ n đến m lần' },
  { token: '*?  +?  ??', desc: 'Lười (khớp ít nhất có thể)' },
  { token: '(abc)', desc: 'Nhóm bắt, tham chiếu bằng $1' },
  { token: '(?<ten>abc)', desc: 'Nhóm đặt tên, tham chiếu bằng $<ten>' },
  { token: '(?:abc)', desc: 'Nhóm không bắt' },
  { token: 'a|b', desc: 'a hoặc b' },
  { token: '(?=x)  (?!x)', desc: 'Nhìn trước khẳng định / phủ định' },
  { token: '(?<=x)  (?<!x)', desc: 'Nhìn sau khẳng định / phủ định' },
  { token: '\\1  \\k<ten>', desc: 'Tham chiếu ngược tới nhóm đã bắt' },
  { token: '\\p{L}', desc: 'Thuộc tính Unicode (cần cờ u), ví dụ chữ cái có dấu' },
];

export const FLAG_INFO: Record<string, { label: string; desc: string }> = {
  g: { label: 'g', desc: 'Toàn cục: tìm mọi khớp' },
  i: { label: 'i', desc: 'Không phân biệt hoa/thường' },
  m: { label: 'm', desc: 'Nhiều dòng: ^ và $ theo từng dòng' },
  s: { label: 's', desc: 'Dấu chấm khớp cả xuống dòng' },
  u: { label: 'u', desc: 'Unicode đầy đủ' },
  y: { label: 'y', desc: 'Sticky: chỉ khớp tại vị trí lastIndex' },
};
