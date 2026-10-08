/**
 * Xử lý văn bản sau nhận diện giọng nói — hoàn toàn cục bộ, không cần khóa AI.
 * Gồm: lệnh giọng nói (dấu câu/định dạng), làm sạch, chia đoạn, thống kê,
 * tìm & thay, mốc thời gian và xuất .txt/.md/.srt/.vtt.
 * Mọi hàm là hàm thuần (không React, không DOM).
 */

/* ------------------------------------------------------------------ */
/* Kiểu dữ liệu                                                        */
/* ------------------------------------------------------------------ */

/** Một kết quả nhận diện cuối cùng (final). start/end là mili-giây tính từ lúc bắt đầu phiên ghi. */
export interface SttSegment {
  text: string;
  start: number;
  end: number;
}

export type CommandMode = 'off' | 'conservative' | 'aggressive';
export type CommandLang = 'all' | 'vi' | 'en';

export const MAX_TEXT_CHARS = 2_000_000;

/* ------------------------------------------------------------------ */
/* Lệnh giọng nói                                                      */
/* ------------------------------------------------------------------ */

interface Cmd {
  out: string;
  /** 'space': cần khoảng trắng phía trước (mở ngoặc); 'none': dính vào chữ trước */
  before: 'space' | 'none';
  /** 'space': sau đó có khoảng trắng; 'none': dính vào chữ sau */
  after: 'space' | 'none';
  /** viết hoa chữ tiếp theo */
  cap: boolean;
}

const C = {
  period: { out: '.', before: 'none', after: 'space', cap: true } as Cmd,
  comma: { out: ',', before: 'none', after: 'space', cap: false } as Cmd,
  question: { out: '?', before: 'none', after: 'space', cap: true } as Cmd,
  exclaim: { out: '!', before: 'none', after: 'space', cap: true } as Cmd,
  colon: { out: ':', before: 'none', after: 'space', cap: false } as Cmd,
  semicolon: { out: ';', before: 'none', after: 'space', cap: false } as Cmd,
  ellipsis: { out: '…', before: 'none', after: 'space', cap: true } as Cmd,
  openParen: { out: '(', before: 'space', after: 'none', cap: false } as Cmd,
  closeParen: { out: ')', before: 'none', after: 'space', cap: false } as Cmd,
  openQuote: { out: '“', before: 'space', after: 'none', cap: false } as Cmd,
  closeQuote: { out: '”', before: 'none', after: 'space', cap: false } as Cmd,
  newline: { out: '\n', before: 'none', after: 'none', cap: true } as Cmd,
  paragraph: { out: '\n\n', before: 'none', after: 'none', cap: true } as Cmd,
  bullet: { out: '\n- ', before: 'none', after: 'none', cap: true } as Cmd,
};

interface CommandDef {
  say: string[];
  lang: 'vi' | 'en';
  cmd: Cmd;
  label: string;
}

const COMMAND_DEFS: CommandDef[] = [
  // Tiếng Việt
  { say: ['chấm', 'dấu chấm', 'chấm câu'], lang: 'vi', cmd: C.period, label: 'Dấu chấm' },
  { say: ['phẩy', 'dấu phẩy'], lang: 'vi', cmd: C.comma, label: 'Dấu phẩy' },
  { say: ['hỏi chấm', 'chấm hỏi', 'dấu hỏi', 'dấu chấm hỏi'], lang: 'vi', cmd: C.question, label: 'Dấu hỏi chấm' },
  { say: ['chấm than', 'dấu chấm than', 'than chấm'], lang: 'vi', cmd: C.exclaim, label: 'Dấu chấm than' },
  { say: ['hai chấm', 'dấu hai chấm'], lang: 'vi', cmd: C.colon, label: 'Dấu hai chấm' },
  { say: ['chấm phẩy', 'dấu chấm phẩy'], lang: 'vi', cmd: C.semicolon, label: 'Chấm phẩy' },
  { say: ['ba chấm', 'chấm lửng', 'dấu ba chấm'], lang: 'vi', cmd: C.ellipsis, label: 'Dấu ba chấm' },
  { say: ['mở ngoặc', 'mở ngoặc đơn', 'mở dấu ngoặc'], lang: 'vi', cmd: C.openParen, label: 'Mở ngoặc' },
  { say: ['đóng ngoặc', 'đóng ngoặc đơn', 'đóng dấu ngoặc'], lang: 'vi', cmd: C.closeParen, label: 'Đóng ngoặc' },
  { say: ['mở ngoặc kép', 'mở nháy'], lang: 'vi', cmd: C.openQuote, label: 'Mở ngoặc kép' },
  { say: ['đóng ngoặc kép', 'đóng nháy'], lang: 'vi', cmd: C.closeQuote, label: 'Đóng ngoặc kép' },
  { say: ['xuống dòng', 'sang dòng', 'dòng mới'], lang: 'vi', cmd: C.newline, label: 'Xuống dòng' },
  { say: ['đoạn mới', 'xuống đoạn', 'đoạn văn mới'], lang: 'vi', cmd: C.paragraph, label: 'Đoạn mới (dòng trống)' },
  { say: ['gạch đầu dòng'], lang: 'vi', cmd: C.bullet, label: 'Gạch đầu dòng' },
  // English
  { say: ['period', 'full stop'], lang: 'en', cmd: C.period, label: 'Period' },
  { say: ['comma'], lang: 'en', cmd: C.comma, label: 'Comma' },
  { say: ['question mark'], lang: 'en', cmd: C.question, label: 'Question mark' },
  { say: ['exclamation mark', 'exclamation point'], lang: 'en', cmd: C.exclaim, label: 'Exclamation mark' },
  { say: ['colon'], lang: 'en', cmd: C.colon, label: 'Colon' },
  { say: ['semicolon', 'semi colon'], lang: 'en', cmd: C.semicolon, label: 'Semicolon' },
  { say: ['ellipsis', 'dot dot dot'], lang: 'en', cmd: C.ellipsis, label: 'Ellipsis' },
  { say: ['open parenthesis', 'open bracket', 'left parenthesis'], lang: 'en', cmd: C.openParen, label: 'Open parenthesis' },
  { say: ['close parenthesis', 'close bracket', 'right parenthesis'], lang: 'en', cmd: C.closeParen, label: 'Close parenthesis' },
  { say: ['open quote'], lang: 'en', cmd: C.openQuote, label: 'Open quote' },
  { say: ['close quote', 'end quote'], lang: 'en', cmd: C.closeQuote, label: 'Close quote' },
  { say: ['new line', 'newline'], lang: 'en', cmd: C.newline, label: 'New line' },
  { say: ['new paragraph'], lang: 'en', cmd: C.paragraph, label: 'New paragraph' },
  { say: ['bullet point', 'bullet'], lang: 'en', cmd: C.bullet, label: 'Bullet point' },
];

/** Bảng tra cứu nhanh để hiển thị "cheat-sheet" trong giao diện. */
export const VOICE_COMMAND_SHEET: { label: string; say: string[]; out: string; lang: 'vi' | 'en' }[] =
  COMMAND_DEFS.map((d) => ({
    label: d.label,
    say: d.say,
    out: d.cmd.out === '\n' ? '↵' : d.cmd.out === '\n\n' ? '↵↵' : d.cmd.out === '\n- ' ? '↵ -' : d.cmd.out,
    lang: d.lang,
  }));

const PUNCT_EDGE = /^[.,;:!?…"“”()]+|[.,;:!?…"“”()]+$/g;

function wordKey(w: string): string {
  return w.normalize('NFC').toLowerCase().replace(PUNCT_EDGE, '');
}

type PhraseIndex = Map<string, { words: string[]; cmd: Cmd }[]>;
const indexCache = new Map<CommandLang, PhraseIndex>();

function getPhraseIndex(lang: CommandLang): PhraseIndex {
  const cached = indexCache.get(lang);
  if (cached) return cached;
  const idx: PhraseIndex = new Map();
  for (const d of COMMAND_DEFS) {
    if (lang !== 'all' && d.lang !== lang) continue;
    for (const phrase of d.say) {
      const words = phrase.normalize('NFC').toLowerCase().split(' ');
      const list = idx.get(words[0]) ?? [];
      list.push({ words, cmd: d.cmd });
      idx.set(words[0], list);
    }
  }
  for (const list of idx.values()) list.sort((a, b) => b.words.length - a.words.length);
  indexCache.set(lang, idx);
  return idx;
}

type Item = { type: 'word'; w: string } | { type: 'cmd'; cmd: Cmd };

interface Match {
  start: number;
  end: number; // exclusive
  cmd: Cmd;
}

function findMatches(words: string[], lang: CommandLang): Match[] {
  const idx = getPhraseIndex(lang);
  const keys = words.map(wordKey);
  const out: Match[] = [];
  let i = 0;
  while (i < words.length) {
    const cands = idx.get(keys[i]);
    let hit: Match | null = null;
    if (cands) {
      for (const c of cands) {
        let ok = i + c.words.length <= words.length;
        for (let k = 1; ok && k < c.words.length; k++) if (keys[i + k] !== c.words[k]) ok = false;
        if (ok) {
          hit = { start: i, end: i + c.words.length, cmd: c.cmd };
          break;
        }
      }
    }
    if (hit) {
      out.push(hit);
      i = hit.end;
    } else i++;
  }
  return out;
}

function tokenizeWithCommands(text: string, mode: CommandMode, lang: CommandLang): Item[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (mode === 'off') return words.map((w) => ({ type: 'word', w }));
  let matches = findMatches(words, lang);
  if (mode === 'conservative') {
    // chỉ nhận lệnh nằm ở mép đoạn (đầu hoặc cuối), có thể nhiều lệnh liên tiếp
    const accepted: Match[] = [];
    let pos = 0;
    let used = 0;
    for (const m of matches) {
      if (m.start === pos) {
        accepted.push(m);
        pos = m.end;
        used++;
      } else break;
    }
    let tail = words.length;
    const rest = matches.slice(used);
    const tailAcc: Match[] = [];
    for (let k = rest.length - 1; k >= 0; k--) {
      if (rest[k].end === tail) {
        tailAcc.unshift(rest[k]);
        tail = rest[k].start;
      } else break;
    }
    matches = [...accepted, ...tailAcc];
  }
  const items: Item[] = [];
  let mi = 0;
  for (let i = 0; i < words.length; ) {
    if (mi < matches.length && matches[mi].start === i) {
      items.push({ type: 'cmd', cmd: matches[mi].cmd });
      i = matches[mi].end;
      mi++;
    } else {
      items.push({ type: 'word', w: words[i] });
      i++;
    }
  }
  return items;
}

function upperFirst(w: string): string {
  const chars = Array.from(w);
  for (let i = 0; i < chars.length; i++) {
    if (/\p{L}/u.test(chars[i])) {
      chars[i] = chars[i].toLocaleUpperCase();
      return chars.join('');
    }
    if (/\p{N}/u.test(chars[i])) return w;
  }
  return w;
}

export interface RenderOptions {
  mode: CommandMode;
  lang?: CommandLang;
  /** viết hoa chữ đầu câu */
  capitalize?: boolean;
}

/** Điểm bắt đầu khi nối tiếp sau văn bản đã có. */
function initialState(prev: string): { glue: boolean; cap: boolean } {
  if (!prev.trim()) return { glue: true, cap: true };
  const glue = /[\s(\[“«]$/.test(prev);
  const cap = /(?:[.!?…]["”')\]]*|\n)\s*$/.test(prev);
  return { glue, cap };
}

function renderItems(prev: string, items: Item[], capitalize: boolean): string {
  let out = prev.replace(/[ \t]+$/, '');
  let { glue, cap } = initialState(out);
  for (const it of items) {
    if (it.type === 'word') {
      let w = it.w;
      if (cap && capitalize) w = upperFirst(w);
      else if (cap && !capitalize) cap = false;
      if (!glue && out) out += ' ';
      out += w;
      glue = false;
      cap = false;
    } else {
      const c = it.cmd;
      if (c.before === 'none') out = out.replace(/[ \t]+$/, '');
      else if (!glue && out && !/\s$/.test(out)) out += ' ';
      // tránh trùng dấu giống nhau liên tiếp (".." do nói "chấm" hai lần)
      if (c.out.length === 1 && /[.,;:!?]/.test(c.out) && out.endsWith(c.out)) {
        // bỏ qua
      } else {
        out += c.out;
      }
      glue = c.after === 'none';
      if (c.cap) cap = true;
    }
  }
  return out;
}

/** Áp lệnh giọng nói lên một đoạn văn (nhiều dòng được xử lý từng dòng). */
export function applyVoiceCommands(text: string, opts: RenderOptions): string {
  const input = text.slice(0, MAX_TEXT_CHARS);
  const lang = opts.lang ?? 'all';
  return input
    .split('\n')
    .map((line) => renderItems('', tokenizeWithCommands(line, opts.mode, lang), opts.capitalize ?? true))
    .join('\n');
}

/**
 * Nối một kết quả nhận diện mới vào văn bản đang có, áp lệnh giọng nói
 * (theo chế độ), giữ khoảng trắng và viết hoa đúng.
 * Trả về văn bản mới và phần vừa thêm (để lưu theo từng segment).
 */
export function appendSegment(prev: string, raw: string, opts: RenderOptions): { text: string; piece: string } {
  const items = tokenizeWithCommands(raw.slice(0, 20_000), opts.mode, opts.lang ?? 'all');
  if (items.length === 0) return { text: prev, piece: '' };
  const prevTrim = prev.replace(/[ \t]+$/, '');
  const text = renderItems(prevTrim, items, opts.capitalize ?? true);
  return { text, piece: text.slice(prevTrim.length).replace(/^[ \t]+/, '') };
}

/* ------------------------------------------------------------------ */
/* Làm sạch                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_FILLERS = ['ừm', 'ờm', 'ờ', 'ừ thì', 'à', 'ơ', 'kiểu như', 'uh', 'uhm', 'um', 'erm', 'you know'];

export interface CleanupOptions {
  removeFillers?: boolean;
  fillers?: string[];
  collapseRepeats?: boolean;
  fixSpacing?: boolean;
  capitalize?: boolean;
  /** viết hoa "i" đứng riêng (chỉ nên bật cho tiếng Anh) */
  englishI?: boolean;
}

/** Chuẩn hoá danh sách từ đệm do người dùng nhập (tách bằng dấu phẩy hoặc xuống dòng). */
export function parseFillerList(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of s.split(/[,\n]/)) {
    const p = part.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
    if (p && p.length <= 40 && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out.slice(0, 100);
}

function removeFillerTokens(tokens: string[], fillers: string[]): string[] {
  const phrases = fillers
    .map((f) => f.split(' ').filter(Boolean))
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);
  if (phrases.length === 0) return tokens;
  const keys = tokens.map(wordKey);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let len = 0;
    for (const p of phrases) {
      if (i + p.length > tokens.length) continue;
      let ok = true;
      for (let k = 0; k < p.length; k++) {
        if (keys[i + k] !== p[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        len = p.length;
        break;
      }
    }
    if (len > 0) {
      // giữ lại dấu câu kết thúc đi kèm từ đệm ("ừm." / "um,")
      const last = tokens[i + len - 1];
      const m = /[.,;:!?…]+$/.exec(last);
      if (m && out.length > 0) {
        const prevTok = out[out.length - 1];
        if (!/[.,;:!?…]$/.test(prevTok)) out[out.length - 1] = prevTok + m[0];
        else if (/[,;:]$/.test(prevTok) && /[.!?…]/.test(m[0])) out[out.length - 1] = prevTok.slice(0, -1) + m[0];
      }
      i += len;
    } else {
      out.push(tokens[i]);
      i++;
    }
  }
  return out;
}

function collapseRepeatTokens(tokens: string[]): string[] {
  const out: string[] = [];
  const keyOf = (t: string) => wordKey(t);
  for (const t of tokens) {
    const k = keyOf(t);
    const prev = out[out.length - 1];
    if (prev !== undefined && k && k === keyOf(prev) && !/\d/.test(k)) {
      // giữ dấu câu của lần xuất hiện cuối
      const m = /[.,;:!?…]+$/.exec(t);
      if (m && !/[.,;:!?…]$/.test(prev)) out[out.length - 1] = prev + m[0];
      continue;
    }
    out.push(t);
  }
  // lặp cụm 2 từ: "tôi nghĩ tôi nghĩ" -> "tôi nghĩ"
  const res: string[] = [];
  for (let i = 0; i < out.length; i++) {
    res.push(out[i]);
    while (
      res.length >= 4 &&
      keyOf(res[res.length - 1]) === keyOf(res[res.length - 3]) &&
      keyOf(res[res.length - 2]) === keyOf(res[res.length - 4]) &&
      keyOf(res[res.length - 1]) &&
      keyOf(res[res.length - 2]) &&
      !/[.!?…]$/.test(res[res.length - 3])
    ) {
      res.splice(res.length - 4, 2);
    }
  }
  return res;
}

/** Sửa khoảng trắng quanh dấu câu và dòng trống. Không đổi chữ. */
export function fixSpacing(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]+/g, ' ')
        .replace(/ +([,.;:!?…)”\]])/g, '$1')
        .replace(/([(“\[]) +/g, '$1')
        .replace(/([,;!?])(?=\p{L})/gu, '$1 ')
        .replace(/(\p{L}):(?=\p{L})/gu, '$1: ')
        .replace(/^ +| +$/g, ''),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

/** Viết hoa chữ đầu văn bản, sau . ! ? … và sau xuống dòng. */
export function capitalizeSentences(text: string): string {
  const chars = Array.from(text);
  let cap = true;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (cap && /\p{L}/u.test(ch)) {
      chars[i] = ch.toLocaleUpperCase();
      cap = false;
    } else if (/\p{N}/u.test(ch)) {
      cap = false;
    } else if (ch === '\n') {
      cap = true;
    } else if (/[.!?…]/.test(ch)) {
      // chỉ tính là hết câu nếu theo sau là khoảng trắng/hết chuỗi (tránh "3.5", "a.b")
      const next = chars[i + 1];
      if (next === undefined || /[\s"”')\]]/.test(next) || /[.!?…]/.test(next)) cap = true;
    } else if (/[\s"“‘'(\[\-•*]/.test(ch)) {
      // giữ nguyên trạng thái
    } else {
      cap = false;
    }
  }
  return chars.join('');
}

function fixEnglishI(text: string): string {
  return text
    .replace(/(^|[^\p{L}\p{N}'’])i(?=$|[^\p{L}\p{N}'’])/gu, '$1I')
    .replace(/(^|[^\p{L}\p{N}'’])i(?=['’](?:m|ll|ve|d)(?![\p{L}\p{N}]))/giu, '$1I');
}

export function cleanupText(text: string, opts: CleanupOptions = {}): string {
  const o = {
    removeFillers: true,
    fillers: DEFAULT_FILLERS,
    collapseRepeats: true,
    fixSpacing: true,
    capitalize: true,
    englishI: false,
    ...opts,
  };
  let lines = text.slice(0, MAX_TEXT_CHARS).replace(/\r\n?/g, '\n').split('\n');
  lines = lines.map((line) => {
    let tokens = line.split(/\s+/).filter(Boolean);
    if (o.removeFillers) tokens = removeFillerTokens(tokens, o.fillers);
    if (o.collapseRepeats) tokens = collapseRepeatTokens(tokens);
    return tokens.join(' ');
  });
  let out = lines.join('\n');
  if (o.fixSpacing) out = fixSpacing(out);
  if (o.englishI) out = fixEnglishI(out);
  if (o.capitalize) out = capitalizeSentences(out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Chia đoạn                                                           */
/* ------------------------------------------------------------------ */

/** Tách câu: kết thúc ở . ! ? … theo sau là khoảng trắng hoặc hết chuỗi. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (/[.!?…]/.test(ch)) {
      let j = i;
      while (j + 1 < n && /[.!?…"”')\]]/.test(text[j + 1])) j++;
      if (j + 1 >= n || /\s/.test(text[j + 1])) {
        const s = text.slice(start, j + 1).trim();
        if (s) out.push(s);
        start = j + 1;
        i = j;
      }
    }
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

function wordCountOf(s: string): number {
  const m = s.match(/\S+/g);
  return m ? m.length : 0;
}

/** Chia một câu quá dài (không dấu câu) thành các khối ~maxWords từ. */
function chunkWords(s: string, maxWords: number): string[] {
  const w = s.split(/\s+/).filter(Boolean);
  if (w.length <= maxWords * 1.5) return [s];
  const out: string[] = [];
  for (let i = 0; i < w.length; i += maxWords) out.push(w.slice(i, i + maxWords).join(' '));
  return out;
}

/** Chia đoạn theo số câu (không cần mốc thời gian). Giữ nguyên đoạn đã có (dòng trống). */
export function paragraphizeText(text: string, sentencesPerParagraph = 4, maxWordsNoPunct = 45): string {
  const n = Math.max(1, Math.floor(sentencesPerParagraph));
  const existing = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const result: string[] = [];
  for (const block of existing) {
    const flat = block.replace(/\s*\n\s*/g, ' ').trim();
    if (!flat) continue;
    const sentences = splitSentences(flat).flatMap((s) => chunkWords(s, maxWordsNoPunct));
    for (let i = 0; i < sentences.length; i += n) result.push(sentences.slice(i, i + n).join(' '));
  }
  return result.join('\n\n');
}

function joinPieces(pieces: string[]): string {
  let out = '';
  for (const p of pieces) {
    if (!p) continue;
    if (!out || /\s$/.test(out) || /^[\s.,;:!?…)”]/.test(p)) out += p;
    else out += ' ' + p;
  }
  return out;
}

/**
 * Chia đoạn theo khoảng lặng giữa các kết quả nhận diện (gap >= pauseMs).
 * Nếu không tìm thấy khoảng lặng nào đủ dài thì quay về chia theo số câu.
 */
export function paragraphizeSegments(
  segments: SttSegment[],
  opts: { pauseMs?: number; sentencesPerParagraph?: number } = {},
): string {
  const pauseMs = opts.pauseMs ?? 2500;
  const spp = opts.sentencesPerParagraph ?? 4;
  const segs = segments.filter((s) => s.text.trim());
  if (segs.length === 0) return '';
  const groups: string[][] = [[]];
  for (let i = 0; i < segs.length; i++) {
    if (i > 0 && segs[i].start - segs[i - 1].end >= pauseMs) groups.push([]);
    groups[groups.length - 1].push(segs[i].text.trim());
  }
  if (groups.length === 1) return paragraphizeText(joinPieces(groups[0]), spp);
  return groups
    .map((g) => joinPieces(g).replace(/\s*\n+\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Thống kê                                                            */
/* ------------------------------------------------------------------ */

export interface SttStats {
  words: number;
  chars: number;
  sentences: number;
  paragraphs: number;
  /** thời lượng (ms) dùng để tính tốc độ: tổng thời gian nói, hoặc khoảng đầu-cuối, hoặc dự phòng */
  durationMs: number;
  wpm: number | null;
}

export function countWords(text: string): number {
  if (!text.trim()) return 0;
  const hasCjk = /[぀-ヿ㐀-鿿가-힯]/.test(text);
  if (hasCjk && typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
      let n = 0;
      for (const s of seg.segment(text)) if (s.isWordLike) n++;
      return n;
    } catch {
      /* dùng cách đếm khoảng trắng */
    }
  }
  return wordCountOf(text);
}

export function computeStats(text: string, segments: SttSegment[] | null, fallbackDurationSec = 0): SttStats {
  const words = countWords(text);
  let durationMs = 0;
  if (segments && segments.length > 0) {
    const speech = segments.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
    const span = Math.max(...segments.map((s) => s.end)) - Math.min(...segments.map((s) => s.start));
    durationMs = speech > 1000 ? speech : span;
  }
  if (durationMs < 1000) durationMs = Math.max(0, fallbackDurationSec) * 1000;
  const wpm = durationMs >= 3000 && words > 0 ? Math.round((words / durationMs) * 60000) : null;
  return {
    words,
    chars: text.length,
    sentences: text.trim() ? splitSentences(text).length : 0,
    paragraphs: text.trim() ? text.split(/\n{2,}/).filter((p) => p.trim()).length : 0,
    durationMs,
    wpm,
  };
}

/* ------------------------------------------------------------------ */
/* Tìm & thay                                                          */
/* ------------------------------------------------------------------ */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

function buildFinder(find: string, o: FindOptions): RegExp | null {
  if (!find || find.length > 200) return null;
  const body = escapeRegex(find.normalize('NFC'));
  const src = o.wholeWord ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body;
  try {
    return new RegExp(src, o.caseSensitive ? 'gu' : 'giu');
  } catch {
    return null;
  }
}

export function countMatches(text: string, find: string, o: FindOptions = {}): number {
  const re = buildFinder(find, o);
  if (!re) return 0;
  let n = 0;
  for (const _m of text.normalize('NFC').matchAll(re)) {
    void _m;
    n++;
    if (n >= 100_000) break;
  }
  return n;
}

export function replaceAllText(text: string, find: string, replacement: string, o: FindOptions = {}): { text: string; count: number } {
  const re = buildFinder(find, o);
  if (!re) return { text, count: 0 };
  let count = 0;
  const out = text.normalize('NFC').replace(re, () => {
    count++;
    return replacement;
  });
  return count === 0 ? { text, count: 0 } : { text: out, count };
}

/* ------------------------------------------------------------------ */
/* Mốc thời gian & xuất file                                           */
/* ------------------------------------------------------------------ */

const pad = (n: number, w = 2) => String(Math.max(0, Math.floor(n))).padStart(w, '0');

/** mm:ss (hoặc h:mm:ss khi từ 1 giờ). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function srtTime(ms: number, sep: ',' | '.' = ','): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(t % 1000, 3)}`;
}

/** Mỗi segment một dòng, đầu dòng là `[mm:ss]`. */
export function withTimestamps(segments: SttSegment[]): string {
  return segments
    .filter((s) => s.text.trim())
    .map((s) => `[${formatClock(s.start)}] ${s.text.trim().replace(/\s*\n+\s*/g, ' ')}`)
    .join('\n');
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export const CUE_LINE_CHARS = 42;
export const CUE_MAX_LINES = 2;

/** Bẻ dòng tham lam theo từ, mỗi dòng tối đa maxChars ký tự (từ quá dài bị cắt cứng). */
export function wrapLines(text: string, maxChars = CUE_LINE_CHARS): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (Array.from(w).length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      const cs = Array.from(w);
      lines.push(cs.slice(0, maxChars).join(''));
      w = cs.slice(maxChars).join('');
    }
    if (!w) continue;
    if (!cur) cur = w;
    else if (Array.from(cur).length + 1 + Array.from(w).length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function segmentToCues(seg: SttSegment): Cue[] {
  const flat = seg.text.replace(/\s*\n+\s*/g, ' ').trim();
  if (!flat) return [];
  const lines = wrapLines(flat);
  const groups: string[] = [];
  for (let i = 0; i < lines.length; i += CUE_MAX_LINES) groups.push(lines.slice(i, i + CUE_MAX_LINES).join('\n'));
  const chars = flat.length;
  let end = seg.end;
  if (!(end > seg.start)) end = seg.start + Math.max(1200, chars * 60);
  const total = end - seg.start;
  const weights = groups.map((g) => Math.max(1, g.replace(/\n/g, ' ').length));
  const sum = weights.reduce((a, b) => a + b, 0);
  const cues: Cue[] = [];
  let t = seg.start;
  groups.forEach((g, i) => {
    const d = i === groups.length - 1 ? end - t : Math.round((total * weights[i]) / sum);
    cues.push({ start: t, end: t + Math.max(d, 1), text: g });
    t += d;
  });
  return cues;
}

/** Tạo các cue phụ đề (≤ 42 ký tự × 2 dòng) từ segment có mốc thời gian. */
export function buildCues(segments: SttSegment[]): Cue[] {
  const cues = segments
    .filter((s) => s.text.trim())
    .slice()
    .sort((a, b) => a.start - b.start)
    .flatMap(segmentToCues);
  for (let i = 0; i < cues.length - 1; i++) {
    const a = cues[i];
    const b = cues[i + 1];
    if (a.end > b.start) {
      if (b.start - a.start >= 300) a.end = b.start;
      else {
        const shift = a.end - b.start;
        b.start += shift;
        if (b.end <= b.start) b.end = b.start + 300;
      }
    }
  }
  return cues;
}

/** Khi không còn mốc theo segment (văn bản đã chỉnh sửa): rải đều theo độ dài câu trên tổng thời lượng. */
export function segmentsFromText(text: string, totalMs: number): SttSegment[] {
  const sentences = splitSentences(text.replace(/\s*\n+\s*/g, ' ')).flatMap((s) => chunkWords(s, 18));
  if (sentences.length === 0) return [];
  const total = totalMs > 0 ? totalMs : sentences.reduce((a, s) => a + Math.max(1200, s.length * 60), 0);
  const weights = sentences.map((s) => Math.max(1, s.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return sentences.map((s, i) => {
    const d = i === sentences.length - 1 ? total - t : Math.round((total * weights[i]) / sum);
    const seg = { text: s, start: t, end: t + d };
    t += d;
    return seg;
  });
}

export function toSrt(cues: Cue[]): string {
  return (
    cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`).join('\n\n') + (cues.length ? '\n' : '')
  );
}

export function toVtt(cues: Cue[]): string {
  return 'WEBVTT\n\n' + cues.map((c) => `${srtTime(c.start, '.')} --> ${srtTime(c.end, '.')}\n${c.text}`).join('\n\n') + (cues.length ? '\n' : '');
}

export interface MarkdownMeta {
  title?: string;
  language?: string;
  durationSec?: number;
  dateIso?: string;
}

export function toMarkdown(text: string, segments: SttSegment[] | null, meta: MarkdownMeta = {}): string {
  const lines: string[] = [`# ${meta.title ?? 'Bản ghi giọng nói'}`, ''];
  const info: string[] = [];
  if (meta.dateIso) info.push(`Ngày: ${meta.dateIso}`);
  if (meta.language) info.push(`Ngôn ngữ: ${meta.language}`);
  if (meta.durationSec && meta.durationSec > 0) info.push(`Thời lượng: ${formatClock(meta.durationSec * 1000)}`);
  if (info.length) lines.push(info.map((i) => `- ${i}`).join('\n'), '');
  if (segments && segments.length > 0) {
    lines.push(
      segments
        .filter((s) => s.text.trim())
        .map((s) => `**[${formatClock(s.start)}]** ${s.text.trim().replace(/\s*\n+\s*/g, ' ')}`)
        .join('\n\n'),
    );
  } else {
    lines.push(text.trim());
  }
  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------------ */
/* Phát hiện trình duyệt (cho hướng dẫn)                              */
/* ------------------------------------------------------------------ */

export type BrowserKind = 'firefox' | 'safari' | 'chromium' | 'other';

export function detectBrowser(ua: string): BrowserKind {
  if (/firefox|fxios/i.test(ua)) return 'firefox';
  if (/edg\/|edga\/|edgios|chrome|chromium|crios|opr\//i.test(ua)) return 'chromium';
  if (/safari/i.test(ua)) return 'safari';
  return 'other';
}
