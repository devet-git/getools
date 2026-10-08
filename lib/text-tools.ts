/**
 * Công cụ xử lý văn bản: thống kê, làm sạch dòng, đổi kiểu chữ, tìm & thay thế.
 * Thuần logic, không phụ thuộc React.
 */

/* ------------------------------------------------------------------ */
/* Thống kê                                                            */
/* ------------------------------------------------------------------ */

const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

const STOPWORDS = new Set(
  (
    // Tiếng Việt
    'và là của có không được cho một những các này đó khi để với trong ra đã sẽ đang cũng như nhưng thì mà bị bởi từ tại về lên xuống nên rất còn hay hoặc nếu vì do theo cả đều mỗi người tôi bạn anh chị em ta họ nó chúng ' +
    'ông bà ấy đây kia sau trước lại vào ở đến rồi nữa lúc vẫn phải cần muốn đi làm ' +
    // English
    'the a an and or but of to in on at by for with from as is are was were be been being it its this that these those i you he she we they them his her our your their not no do does did have has had will would can could should may might so if then than too very just about into over under up down out'
  ).split(/\s+/)
);

export interface TextStats {
  chars: number;
  charsNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  bytes: number;
  readingMinutes: number;
  speakingMinutes: number;
  topWords: { word: string; count: number }[];
  uniqueWords: number;
}

/** Số ký tự theo "grapheme" gần đúng: đếm theo code point (không tính surrogate là 2). */
export function countCodePoints(text: string): number {
  let n = 0;
  for (const _ of text) {
    void _;
    n++;
  }
  return n;
}

export function utf8Bytes(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return unescape(encodeURIComponent(text)).length;
}

export const READING_WPM = 200;
export const SPEAKING_WPM = 130;

export function computeStats(text: string, opts: { noStopwords?: boolean; topN?: number } = {}): TextStats {
  const topN = opts.topN ?? 10;
  if (!text) {
    return {
      chars: 0,
      charsNoSpaces: 0,
      words: 0,
      sentences: 0,
      paragraphs: 0,
      lines: 0,
      bytes: 0,
      readingMinutes: 0,
      speakingMinutes: 0,
      topWords: [],
      uniqueWords: 0,
    };
  }
  const chars = countCodePoints(text);
  const charsNoSpaces = countCodePoints(text.replace(/\s+/g, ''));
  const wordList = text.match(WORD_RE) ?? [];
  const words = wordList.length;

  // Câu: đoạn kết thúc bằng . ! ? … hoặc phần còn lại có chữ
  const sentences = (text.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? []).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
  const paragraphs = text.split(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/).filter((p) => p.trim() !== '').length;
  const lines = text.split(/\r\n|\r|\n/).length;

  const freq = new Map<string, number>();
  for (const w of wordList) {
    const k = w.toLocaleLowerCase('vi');
    if (opts.noStopwords && (STOPWORDS.has(k) || /^\d+$/.test(k))) continue;
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'))
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));

  return {
    chars,
    charsNoSpaces,
    words,
    sentences,
    paragraphs,
    lines,
    bytes: utf8Bytes(text),
    readingMinutes: words / READING_WPM,
    speakingMinutes: words / SPEAKING_WPM,
    topWords,
    uniqueWords: freq.size,
  };
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0 giây';
  const totalSec = Math.round(minutes * 60);
  if (totalSec < 1) return '< 1 giây';
  if (totalSec < 60) return `${totalSec} giây`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m} phút ${s} giây` : `${m} phút`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} giờ ${mm} phút` : `${h} giờ`;
}

/* ------------------------------------------------------------------ */
/* Làm sạch dòng                                                       */
/* ------------------------------------------------------------------ */

export type SortMode = 'none' | 'asc' | 'desc' | 'length' | 'natural' | 'reverse' | 'shuffle';

export interface LineOptions {
  trim: boolean;
  collapseSpaces: boolean;
  removeEmpty: boolean;
  dedupe: boolean;
  caseSensitive: boolean;
  removeContaining: string;
  removeContainingCase: boolean;
  sort: SortMode;
  shuffleSeed: number;
  lineNumbers: boolean;
  prefix: string;
  suffix: string;
  splitOn: boolean;
  splitSep: string;
  joinOn: boolean;
  joinSep: string;
}

export const DEFAULT_LINE_OPTIONS: LineOptions = {
  trim: false,
  collapseSpaces: false,
  removeEmpty: false,
  dedupe: false,
  caseSensitive: true,
  removeContaining: '',
  removeContainingCase: false,
  sort: 'none',
  shuffleSeed: 1,
  lineNumbers: false,
  prefix: '',
  suffix: '',
  splitOn: false,
  splitSep: ',',
  joinOn: false,
  joinSep: ', ',
};

/** Hiểu \n, \t, \\ trong chuỗi phân tách người dùng nhập. */
export function unescapeSep(s: string): string {
  return s.replace(/\\(n|t|r|\\)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : '\\'));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split(/\r\n|\r|\n/);
}

export function countNonEmptyLines(text: string): number {
  let n = 0;
  for (const l of splitLines(text)) if (l.trim() !== '') n++;
  return n;
}

export function processLines(text: string, o: LineOptions): string {
  let lines = splitLines(text);
  if (o.splitOn && o.splitSep !== '') {
    const sep = unescapeSep(o.splitSep);
    if (sep !== '') lines = lines.flatMap((l) => l.split(sep));
  }
  if (o.trim) lines = lines.map((l) => l.trim());
  if (o.collapseSpaces) lines = lines.map((l) => l.replace(/[ \t ]{2,}/g, ' '));
  if (o.removeEmpty) lines = lines.filter((l) => l.trim() !== '');
  if (o.removeContaining !== '') {
    if (o.removeContainingCase) {
      const needle = o.removeContaining;
      lines = lines.filter((l) => !l.includes(needle));
    } else {
      const needle = o.removeContaining.toLocaleLowerCase('vi');
      lines = lines.filter((l) => !l.toLocaleLowerCase('vi').includes(needle));
    }
  }
  if (o.dedupe) {
    const seen = new Set<string>();
    lines = lines.filter((l) => {
      const k = o.caseSensitive ? l : l.toLocaleLowerCase('vi');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  switch (o.sort) {
    case 'asc':
    case 'desc': {
      const col = new Intl.Collator('vi');
      lines = [...lines].sort((a, b) => col.compare(a, b));
      if (o.sort === 'desc') lines.reverse();
      break;
    }
    case 'length':
      lines = [...lines].sort((a, b) => a.length - b.length);
      break;
    case 'natural': {
      const col = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
      lines = [...lines].sort((a, b) => col.compare(a, b));
      break;
    }
    case 'reverse':
      lines = [...lines].reverse();
      break;
    case 'shuffle': {
      const rnd = mulberry32(o.shuffleSeed);
      lines = [...lines];
      for (let i = lines.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }
      break;
    }
  }
  if (o.lineNumbers) lines = lines.map((l, i) => `${i + 1}. ${l}`);
  if (o.prefix !== '' || o.suffix !== '') {
    const p = unescapeSep(o.prefix);
    const s = unescapeSep(o.suffix);
    lines = lines.map((l) => p + l + s);
  }
  if (o.joinOn) return lines.join(unescapeSep(o.joinSep));
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Đổi kiểu chữ                                                        */
/* ------------------------------------------------------------------ */

export type CaseMode =
  | 'upper'
  | 'lower'
  | 'title'
  | 'sentence'
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'kebab'
  | 'constant'
  | 'dot'
  | 'swap'
  | 'noAccent'
  | 'slug';

export const CASE_LABELS: { id: CaseMode; label: string; example: string }[] = [
  { id: 'upper', label: 'IN HOA', example: 'XIN CHÀO' },
  { id: 'lower', label: 'in thường', example: 'xin chào' },
  { id: 'title', label: 'Title Case', example: 'Xin Chào Việt Nam' },
  { id: 'sentence', label: 'Sentence case', example: 'Xin chào. Việt Nam' },
  { id: 'camel', label: 'camelCase', example: 'xinChaoVietNam' },
  { id: 'pascal', label: 'PascalCase', example: 'XinChaoVietNam' },
  { id: 'snake', label: 'snake_case', example: 'xin_chao_viet_nam' },
  { id: 'kebab', label: 'kebab-case', example: 'xin-chao-viet-nam' },
  { id: 'constant', label: 'CONSTANT_CASE', example: 'XIN_CHAO_VIET_NAM' },
  { id: 'dot', label: 'dot.case', example: 'xin.chao.viet.nam' },
  { id: 'swap', label: 'Đảo hoa/thường', example: 'xIN cHÀO' },
  { id: 'noAccent', label: 'Bỏ dấu tiếng Việt', example: 'Xin chao Viet Nam' },
  { id: 'slug', label: 'Tạo slug', example: 'xin-chao-viet-nam' },
];

/** Bỏ dấu tiếng Việt (gồm đ/Đ), xử lý cả chuỗi NFC lẫn NFD. */
export function removeDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFC');
}

export function slugify(s: string): string {
  return removeDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const upperVi = (s: string) => s.toLocaleUpperCase('vi');
const lowerVi = (s: string) => s.toLocaleLowerCase('vi');

function capitalizeWord(w: string): string {
  const chars = Array.from(w);
  if (chars.length === 0) return w;
  return upperVi(chars[0]) + lowerVi(chars.slice(1).join(''));
}

/** Tách thành các từ: theo ký tự không phải chữ/số và ranh giới camelCase. */
export function splitWords(line: string): string[] {
  return (
    line
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function identifierCase(text: string, join: (words: string[]) => string, noAccent = false): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => {
      const src = noAccent ? removeDiacritics(line) : line;
      return join(splitWords(src));
    })
    .join('\n');
}

function sentenceCase(text: string): string {
  const lower = lowerVi(text);
  let capNext = true;
  let out = '';
  for (const ch of lower) {
    if (capNext && /\p{L}/u.test(ch)) {
      out += upperVi(ch);
      capNext = false;
    } else {
      out += ch;
      if (/[.!?…]/.test(ch) || ch === '\n') capNext = true;
      else if (/[\p{L}\p{N}]/u.test(ch)) capNext = false;
    }
  }
  return out;
}

function titleCase(text: string): string {
  return lowerVi(text).replace(/[\p{L}\p{N}]+/gu, (w) => capitalizeWord(w));
}

function swapCase(text: string): string {
  let out = '';
  for (const ch of text) {
    const up = upperVi(ch);
    const lo = lowerVi(ch);
    if (ch === up && ch !== lo) out += lo;
    else if (ch === lo && ch !== up) out += up;
    else out += ch;
  }
  return out;
}

export function convertCase(text: string, mode: CaseMode, opts: { nfc?: boolean; noAccentIdentifiers?: boolean } = {}): string {
  const src = opts.nfc ? text.normalize('NFC') : text;
  const na = !!opts.noAccentIdentifiers;
  switch (mode) {
    case 'upper':
      return upperVi(src);
    case 'lower':
      return lowerVi(src);
    case 'title':
      return titleCase(src);
    case 'sentence':
      return sentenceCase(src);
    case 'camel':
      return identifierCase(src, (w) => w.map((x, i) => (i === 0 ? lowerVi(x) : capitalizeWord(x))).join(''), na);
    case 'pascal':
      return identifierCase(src, (w) => w.map(capitalizeWord).join(''), na);
    case 'snake':
      return identifierCase(src, (w) => w.map(lowerVi).join('_'), na);
    case 'kebab':
      return identifierCase(src, (w) => w.map(lowerVi).join('-'), na);
    case 'constant':
      return identifierCase(src, (w) => w.map(upperVi).join('_'), na);
    case 'dot':
      return identifierCase(src, (w) => w.map(lowerVi).join('.'), na);
    case 'swap':
      return swapCase(src);
    case 'noAccent':
      return removeDiacritics(src);
    case 'slug':
      return src
        .split(/\r\n|\r|\n/)
        .map(slugify)
        .join('\n');
  }
}

/* ------------------------------------------------------------------ */
/* Tìm & thay thế                                                      */
/* ------------------------------------------------------------------ */

export interface ReplaceOptions {
  find: string;
  replace: string;
  regex: boolean;
  flags: string; // chỉ nhận m, s, u (g và i do tùy chọn điều khiển)
  wholeWord: boolean;
  caseSensitive: boolean;
}

export const DEFAULT_REPLACE_OPTIONS: ReplaceOptions = {
  find: '',
  replace: '',
  regex: false,
  flags: '',
  wholeWord: false,
  caseSensitive: false,
};

export interface ReplaceResult {
  output: string;
  count: number;
  error?: string;
}

const MAX_MATCHES = 2_000_000;

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findReplace(text: string, o: ReplaceOptions): ReplaceResult {
  if (o.find === '') return { output: text, count: 0 };
  let flags = 'g';
  if (!o.caseSensitive) flags += 'i';
  for (const f of new Set(o.flags.split(''))) {
    if ('msu'.includes(f) && !flags.includes(f)) flags += f;
  }
  if (o.wholeWord && !flags.includes('u')) flags += 'u';
  let source = o.regex ? o.find : escapeRegExp(o.find);
  if (o.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  let re: RegExp;
  try {
    re = new RegExp(source, flags);
  } catch (e) {
    return { output: text, count: 0, error: e instanceof Error ? e.message : 'Biểu thức chính quy không hợp lệ.' };
  }
  let count = 0;
  for (const _ of text.matchAll(re)) {
    void _;
    if (++count >= MAX_MATCHES) break;
  }
  if (count === 0) return { output: text, count: 0 };
  const output = o.regex ? text.replace(re, o.replace) : text.replace(re, () => o.replace);
  return { output, count };
}
