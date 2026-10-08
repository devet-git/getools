/**
 * Xử lý văn bản / mã nguồn hoàn toàn cục bộ (không mạng, không khóa AI).
 *  - Tóm tắt trích xuất (TextRank + TF-IDF + vị trí + MMR), từ khóa, thống kê, nhận diện ngôn ngữ.
 *  - Bọc các API AI tích hợp của trình duyệt (Summarizer / Translator / LanguageDetector) có kiểm tra tính năng.
 *  - Phân tích tĩnh mã nguồn: nhận diện ngôn ngữ, dàn ý, độ phức tạp, mùi mã.
 * Thuần logic, không phụ thuộc React.
 */

/* ========================================================================== */
/* 1. Tách câu                                                                 */
/* ========================================================================== */

export interface Sentence {
  text: string;
  /** Thứ tự câu trong văn bản (0-based) */
  index: number;
  /** Chỉ số đoạn */
  para: number;
  /** Câu đầu của đoạn */
  first: boolean;
  /** Câu đến từ một dòng gạch đầu dòng */
  bullet: boolean;
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'fig', 'no', 'inc', 'ltd', 'co', 'corp', 'approx', 'dept', 'est', 'vol', 'rev', 'gen', 'col', 'lt', 'sgt', 'mt', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  // Tiếng Việt
  'tp', 'ts', 'gs', 'pgs', 'ths', 'ks', 'bs', 'cty', 'tr', 'q', 'p', 'tx', 'tt', 'đc', 'đ/c', 'nxb', 'tel', 'ông', 'bà', 'cn', 'nv', 'vn', 'ubnd', 'tw', 'hn', 'sg', 'đt', 'sđt', 'stt', 'tl', 'th', 'qđ',
]);

const CLOSERS = '"\'”’»)]}›';
const SENT_END_CJK = /[。！？]/;
const SENT_END = /[.!?…]/;

function isUpperOrDigit(ch: string): boolean {
  if (!ch) return true;
  return ch !== ch.toLowerCase() || /[0-9]/.test(ch) || !/\p{L}/u.test(ch) ? true : false;
}
function isLowerLetter(ch: string): boolean {
  return !!ch && ch === ch.toLowerCase() && ch !== ch.toUpperCase();
}

/** Tách đoạn thành các câu (một dòng/đoạn đã gộp, không chứa xuống dòng). */
function splitInline(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  const n = s.length;
  let i = 0;
  while (i < n) {
    const ch = s[i];
    if (SENT_END_CJK.test(ch)) {
      let j = i + 1;
      while (j < n && (SENT_END_CJK.test(s[j]) || CLOSERS.includes(s[j]) || s[j] === '」' || s[j] === '』')) j++;
      out.push(s.slice(start, j));
      start = j;
      i = j;
      continue;
    }
    if (SENT_END.test(ch)) {
      let j = i + 1;
      while (j < n && (SENT_END.test(s[j]) || s[j] === '.')) j++;
      const endsEllipsis = j - i >= 2;
      while (j < n && CLOSERS.includes(s[j])) j++;
      // phải là cuối chuỗi hoặc theo sau là khoảng trắng
      if (j >= n || /\s/.test(s[j])) {
        let k = j;
        while (k < n && /\s/.test(s[k])) k++;
        const next = s[k] ?? '';
        let boundary = true;
        if (ch === '.' && !endsEllipsis) {
          // lấy từ đứng trước dấu chấm
          let b = i;
          while (b > start && /[\p{L}\p{N}.'’/]/u.test(s[b - 1])) b--;
          const word = s.slice(b, i);
          const lw = word.toLowerCase();
          if (ABBREVIATIONS.has(lw)) boundary = false;
          else if (word.length === 1 && /\p{L}/u.test(word) && word !== word.toLowerCase()) boundary = false; // chữ cái viết tắt "A. Nguyen"
          else if (/^\d+$/.test(word) && /^[a-zà-ỹ]/i.test(next) && isLowerLetter(next)) boundary = false;
          else if (isLowerLetter(next)) boundary = false;
        } else if (isLowerLetter(next)) {
          boundary = false; // "Vậy à? tôi nghĩ" -> giữ nguyên
        }
        if (k >= n) boundary = true;
        if (boundary && !(next && !isUpperOrDigit(next) && !isLowerLetter(next) && !/["'“‘(\[«\-–—*•]/.test(next))) {
          out.push(s.slice(start, j));
          start = k;
          i = k;
          continue;
        }
      }
      i = j;
      continue;
    }
    i++;
  }
  if (start < n) out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

const BULLET_RE = /^\s*(?:[-*•▪◦‣●–—+]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/;

/** Tách văn bản thành câu, tôn trọng đoạn, gạch đầu dòng, tiêu đề ngắn, dấu câu Việt/Anh/CJK. */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  if (!text || !text.trim()) return out;
  const src = text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ');
  const paragraphs = src.split(/\n\s*\n/);
  let para = 0;
  let idx = 0;
  for (const p of paragraphs) {
    const lines = p.split('\n');
    const units: { text: string; bullet: boolean }[] = [];
    let buf = '';
    const flush = () => {
      if (buf.trim()) units.push({ text: buf.trim(), bullet: false });
      buf = '';
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (BULLET_RE.test(raw)) {
        flush();
        units.push({ text: line.replace(BULLET_RE, '').trim(), bullet: true });
        continue;
      }
      const terminated = /[.!?…。！？"”'’)\]»:;]$/.test(line);
      if (!terminated && line.length < 60 && !buf) {
        // tiêu đề ngắn: đứng riêng
        units.push({ text: line, bullet: false });
        continue;
      }
      buf = buf ? buf + ' ' + line : line;
    }
    flush();
    let first = true;
    for (const u of units) {
      const parts = u.bullet ? [u.text] : splitInline(u.text);
      for (const part of parts) {
        if (!part) continue;
        out.push({ text: part, index: idx++, para, first, bullet: u.bullet });
        first = false;
      }
    }
    if (units.length) para++;
  }
  return out;
}

/* ========================================================================== */
/* 2. Stopword, token hoá                                                      */
/* ========================================================================== */

const STOP_VI =
  'và của là có không được cho một những các này đó trong với để khi đã sẽ đang rất cũng như nhưng thì mà ở tại từ về theo bị bởi nên vì nếu hay hoặc còn lại ra vào lên xuống đến tới ai gì nào đâu sao bao nhiều ít mỗi mọi tất cả chỉ đều cùng nữa vẫn đây kia ấy họ tôi chúng bạn anh chị em ông bà mình ta nó cái con việc điều sự người khác thế vậy đi rồi lúc nhất hơn sau trước qua làm phải thật quá lắm luôn ngay chưa cần muốn biết nói thấy trên dưới giữa ngoài hết nhờ do dù tuy mặc dầu kể cùng nhau đã từng sẽ đều chính trừ cả';
const STOP_EN =
  'a an the and or but if then else of to in on at by for with about against between into through during before after above below from up down out off over under again further once here there when where why how all any both each few more most other some such no nor not only own same so than too very can will just don should now is are was were be been being have has had having do does did doing i me my we our you your he him his she her it its they them their what which who whom this that these those am would could may might must shall also as while because until s t';
const STOP = new Set([...STOP_VI.split(/\s+/), ...STOP_EN.split(/\s+/)]);

export const STOPWORDS: ReadonlySet<string> = STOP;

const WORD_RE = new RegExp('[\\p{L}\\p{N}_]+', 'gu');
const CJK_RE = new RegExp('[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Thai}]', 'u');

interface Tok {
  w: string;
  stop: boolean;
  cjk: boolean;
  /** vị trí liền kề với token trước (không bị ngắt) */
  adj: boolean;
}

/** Hạ chữ thường có xét dấu tiếng Việt (chuẩn hoá NFC). */
export function lowerVi(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

function tokenize(sentence: string): Tok[] {
  const out: Tok[] = [];
  const lower = lowerVi(sentence);
  let m: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  let prevEnd = -1;
  while ((m = WORD_RE.exec(lower))) {
    const w = m[0];
    const adjacentToPrev = prevEnd >= 0 && /^[\s'’\-]*$/.test(lower.slice(prevEnd, m.index));
    prevEnd = m.index + w.length;
    if (CJK_RE.test(w)) {
      const chars = Array.from(w);
      chars.forEach((c, k) => out.push({ w: c, stop: false, cjk: true, adj: k > 0 || adjacentToPrev }));
      continue;
    }
    const isNum = /^\d+$/.test(w);
    const stop = STOP.has(w) || (w.length < 2 && !isNum) || w === '_';
    out.push({ w, stop, cjk: false, adj: adjacentToPrev });
  }
  return out;
}

/* ========================================================================== */
/* 3. Xếp hạng câu                                                             */
/* ========================================================================== */

export type SummaryLength = 'short' | 'medium' | 'long';
export type SummaryStyle = 'paragraph' | 'bullets' | 'tldr';

export interface SummarizeOptions {
  length?: SummaryLength;
  style?: SummaryStyle;
  /** Ghi đè: số câu cụ thể */
  sentences?: number;
  /** Ghi đè: phần trăm số câu (1-100) */
  percent?: number;
  /** Tham số MMR (0..1, càng cao càng bám điểm, thấp = đa dạng hơn) */
  lambda?: number;
  keywords?: number;
}

export interface RankedSentence extends Sentence {
  score: number;
}

export interface LocalSummary {
  /** Các câu được chọn theo thứ tự gốc */
  picked: RankedSentence[];
  total: number;
  text: string;
  keywords: Keyword[];
  readingMinutes: number;
  /** Điểm của mọi câu (theo thứ tự gốc) */
  all: RankedSentence[];
}

export interface Keyword {
  term: string;
  score: number;
  count: number;
  phrase: boolean;
}

function termId(map: Map<string, number>, t: string): number {
  let id = map.get(t);
  if (id === undefined) {
    id = map.size;
    map.set(t, id);
  }
  return id;
}

interface Model {
  sents: Sentence[];
  toks: Tok[][];
  vecs: Map<number, number>[];
  norms: number[];
  termNames: string[];
  df: number[];
  tfDoc: number[];
  lenWords: number[];
}

function buildModel(sents: Sentence[]): Model {
  const ids = new Map<string, number>();
  const toks = sents.map((s) => tokenize(s.text));
  const sentTerms: Map<number, number>[] = [];
  const df: number[] = [];
  const tfDoc: number[] = [];
  const BIGRAM_BOOST = 1.4;
  for (const tk of toks) {
    const tf = new Map<number, number>();
    const bump = (id: number, v: number) => tf.set(id, (tf.get(id) ?? 0) + v);
    for (let i = 0; i < tk.length; i++) {
      const t = tk[i];
      if (!t.stop && !t.cjk) {
        const id = termId(ids, t.w);
        bump(id, 1);
        tfDoc[id] = (tfDoc[id] ?? 0) + 1;
      }
      if (i > 0) {
        const p = tk[i - 1];
        if (t.adj && !t.stop && !p.stop) {
          const id = termId(ids, p.w + ' ' + t.w);
          bump(id, BIGRAM_BOOST);
          tfDoc[id] = (tfDoc[id] ?? 0) + 1;
        }
      }
    }
    sentTerms.push(tf);
    for (const id of tf.keys()) df[id] = (df[id] ?? 0) + 1;
  }
  const N = sents.length;
  const vecs = sentTerms.map((tf) => {
    const v = new Map<number, number>();
    for (const [id, c] of tf) v.set(id, (1 + Math.log(c)) * Math.log(1 + N / (df[id] ?? 1)));
    return v;
  });
  const norms = vecs.map((v) => {
    let s = 0;
    for (const x of v.values()) s += x * x;
    return Math.sqrt(s);
  });
  const termNames: string[] = [];
  for (const [t, id] of ids) termNames[id] = t;
  return { sents, toks, vecs, norms, termNames, df, tfDoc, lenWords: toks.map((t) => t.length) };
}

function cosine(a: Map<number, number>, na: number, b: Map<number, number>, nb: number): number {
  if (!na || !nb) return 0;
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of s) {
    const o = l.get(k);
    if (o !== undefined) dot += v * o;
  }
  return dot / (na * nb);
}

function textRank(m: Model): number[] {
  const n = m.sents.length;
  const adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  const postings = new Map<number, number[]>();
  m.vecs.forEach((v, i) => {
    for (const id of v.keys()) {
      let p = postings.get(id);
      if (!p) postings.set(id, (p = []));
      p.push(i);
    }
  });
  const dots = new Map<number, number>();
  const CAP = 60;
  for (const [id, list] of postings) {
    if (list.length < 2 || list.length > CAP) continue;
    for (let a = 0; a < list.length; a++) {
      const i = list[a];
      const wi = m.vecs[i].get(id)!;
      for (let b = a + 1; b < list.length; b++) {
        const j = list[b];
        const key = i * n + j;
        dots.set(key, (dots.get(key) ?? 0) + wi * m.vecs[j].get(id)!);
      }
    }
  }
  for (const [key, d] of dots) {
    const i = Math.floor(key / n);
    const j = key % n;
    const w = d / (m.norms[i] * m.norms[j] || 1);
    if (w < 0.03) continue;
    adj[i].set(j, w);
    adj[j].set(i, w);
  }
  const outSum = adj.map((a) => {
    let s = 0;
    for (const w of a.values()) s += w;
    return s;
  });
  const d = 0.85;
  let score = new Array<number>(n).fill(1 / n);
  for (let it = 0; it < 30; it++) {
    const next = new Array<number>(n).fill((1 - d) / n);
    for (let j = 0; j < n; j++) {
      if (!outSum[j]) continue;
      const share = (d * score[j]) / outSum[j];
      for (const [i, w] of adj[j]) next[i] += share * w;
    }
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(next[i] - score[i]);
    score = next;
    if (diff < 1e-6) break;
  }
  return score;
}

function normalizeMax(a: number[]): number[] {
  let mx = 0;
  for (const x of a) if (x > mx) mx = x;
  return mx > 0 ? a.map((x) => x / mx) : a.map(() => 0);
}

/** Chấm điểm mọi câu (0..1). Xác định (deterministic). */
export function rankSentences(sents: Sentence[]): RankedSentence[] {
  const n = sents.length;
  if (!n) return [];
  const m = buildModel(sents);
  const tr = normalizeMax(n > 1 ? textRank(m) : [1]);
  // trọng tâm: tổng tf-idf toàn văn của các thuật ngữ trong câu / sqrt(độ dài)
  const cent = normalizeMax(
    m.vecs.map((v, i) => {
      let s = 0;
      for (const id of v.keys()) {
        if ((m.tfDoc[id] ?? 0) >= 2) s += (m.tfDoc[id] ?? 0) * Math.log(1 + n / (m.df[id] ?? 1));
      }
      return s / Math.sqrt(m.lenWords[i] + 4);
    }),
  );
  return sents.map((s, i) => {
    const pos = Math.min(1, 0.3 * (1 - i / n) + (s.first ? 0.3 : 0) + (i === 0 ? 0.4 : 0));
    const w = m.lenWords[i];
    const lenF = w < 4 ? 0.25 : w < 7 ? 0.65 : w > 100 ? 0.5 : w > 60 ? 0.75 : 1;
    const score = (0.45 * tr[i] + 0.3 * cent[i] + 0.25 * pos) * lenF;
    return { ...s, score };
  });
}

function targetCount(n: number, o: SummarizeOptions): number {
  if (o.sentences && o.sentences > 0) return Math.min(n, Math.floor(o.sentences));
  if (o.percent && o.percent > 0) return Math.min(n, Math.max(1, Math.round((n * Math.min(100, o.percent)) / 100)));
  if ((o.style ?? 'paragraph') === 'tldr') return 1;
  const len = o.length ?? 'medium';
  if (len === 'short') return Math.min(n, Math.max(1, Math.min(3, Math.ceil(n * 0.15))));
  if (len === 'long') return Math.min(n, Math.max(3, Math.min(15, Math.ceil(n * 0.4))));
  return Math.min(n, Math.max(2, Math.min(7, Math.ceil(n * 0.25))));
}

/** Tóm tắt trích xuất. Giữ nguyên thứ tự câu gốc. */
export function summarizeLocal(text: string, opts: SummarizeOptions = {}): LocalSummary {
  const sents = splitSentences(text);
  const n = sents.length;
  const empty: LocalSummary = { picked: [], total: n, text: '', keywords: [], readingMinutes: 0, all: [] };
  if (!n) return empty;
  const ranked = rankSentences(sents);
  const k = targetCount(n, opts);
  const lambda = opts.lambda ?? 0.72;
  const model = n > 1 && k < n ? buildModel(sents) : null;
  let chosen: number[];
  if (!model) {
    chosen = ranked.map((_, i) => i).slice(0, k);
  } else {
    chosen = [];
    const remaining = new Set(ranked.map((_, i) => i));
    // câu đầu: điểm cao nhất (ổn định theo chỉ số khi bằng điểm)
    while (chosen.length < k && remaining.size) {
      let best = -1;
      let bestVal = -Infinity;
      for (const i of remaining) {
        let red = 0;
        for (const j of chosen) {
          const c = cosine(model.vecs[i], model.norms[i], model.vecs[j], model.norms[j]);
          if (c > red) red = c;
        }
        const val = lambda * ranked[i].score - (1 - lambda) * red;
        if (val > bestVal + 1e-12) {
          bestVal = val;
          best = i;
        }
      }
      if (best < 0) break;
      // loại câu gần như trùng lặp (>0.8) khi còn lựa chọn khác
      chosen.push(best);
      remaining.delete(best);
      for (const i of Array.from(remaining)) {
        if (remaining.size <= k - chosen.length) break;
        if (cosine(model.vecs[i], model.norms[i], model.vecs[best], model.norms[best]) > 0.85) remaining.delete(i);
      }
    }
  }
  chosen.sort((a, b) => a - b);
  const picked = chosen.map((i) => ranked[i]);
  const style = opts.style ?? 'paragraph';
  let out: string;
  if (style === 'bullets') out = picked.map((p) => `- ${p.text}`).join('\n');
  else if (style === 'tldr') {
    const top = picked.slice().sort((a, b) => b.score - a.score)[0];
    out = top ? `TL;DR: ${top.text}` : '';
  } else {
    // giữ ngắt đoạn khi các câu thuộc đoạn khác nhau
    out = '';
    picked.forEach((p, i) => {
      if (i === 0) out = p.text;
      else out += (p.para !== picked[i - 1].para ? '\n\n' : ' ') + p.text;
    });
  }
  return {
    picked: style === 'tldr' ? picked.slice().sort((a, b) => b.score - a.score).slice(0, 1) : picked,
    total: n,
    text: out,
    keywords: extractKeywords(text, opts.keywords ?? 10, sents),
    readingMinutes: readingMinutes(text),
    all: ranked,
  };
}

/* ========================================================================== */
/* 4. Từ khóa, thống kê, thời gian đọc                                         */
/* ========================================================================== */

export function extractKeywords(text: string, topN = 10, preSplit?: Sentence[]): Keyword[] {
  const sents = preSplit ?? splitSentences(text);
  if (!sents.length) return [];
  const uni = new Map<string, number>();
  const bi = new Map<string, number>();
  for (const s of sents) {
    const tk = tokenize(s.text);
    for (let i = 0; i < tk.length; i++) {
      const t = tk[i];
      if (!t.stop && !t.cjk && !/^\d+$/.test(t.w)) uni.set(t.w, (uni.get(t.w) ?? 0) + 1);
      if (i > 0 && t.adj && !t.stop && !tk[i - 1].stop && !(/^\d+$/.test(t.w) && /^\d+$/.test(tk[i - 1].w))) {
        const key = tk[i - 1].w + ' ' + t.w;
        bi.set(key, (bi.get(key) ?? 0) + 1);
      }
    }
  }
  const cands: Keyword[] = [];
  const viLike = detectLanguage(text.slice(0, 3000)).code === 'vi';
  // nối các bigram chồng nhau có tần suất gần bằng nhau thành cụm dài hơn (trí tuệ + tuệ nhân + nhân tạo)
  const phrases = new Map<string, number>();
  for (const [t, c] of bi) if (c >= 2) phrases.set(t, c);
  for (let round = 0; round < 3; round++) {
    let merged = false;
    for (const [a, ca] of Array.from(phrases)) {
      const aw = a.split(' ');
      for (const [b, cb] of Array.from(phrases)) {
        if (a === b || !phrases.has(a) || !phrases.has(b)) continue;
        const bw = b.split(' ');
        if (aw.length > 3 || aw[aw.length - 1] !== bw[0] || bw.length !== 2 || Math.abs(ca - cb) > 1) continue;
        const m = [...aw, bw[1]].join(' ');
        if (phrases.has(m) || new Set([...aw, bw[1]]).size !== aw.length + 1) continue;
        phrases.set(m, Math.min(ca, cb));
        phrases.delete(a);
        phrases.delete(b);
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }
  for (const [t, c] of phrases) cands.push({ term: t, count: c, score: c * 2.2 + t.split(' ').length * 0.5, phrase: true });
  for (const [t, c] of uni) if (c >= (viLike ? 3 : 1)) cands.push({ term: t, count: c, score: c + Math.min(2, t.length / 6), phrase: false });
  cands.sort((a, b) => b.score - a.score || (a.term < b.term ? -1 : 1));
  const out: Keyword[] = [];
  for (const c of cands) {
    if (out.length >= topN) break;
    if (!c.phrase) {
      const covered = out.some((o) => o.phrase && o.term.split(' ').includes(c.term) && o.count >= c.count * 0.6);
      if (covered) continue;
    } else if (out.some((o) => o.phrase && (o.term.includes(c.term) || c.term.includes(o.term)))) continue;
    out.push(c);
  }
  return out;
}

export function countWords(text: string): number {
  let n = 0;
  WORD_RE.lastIndex = 0;
  const lower = text;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(lower))) {
    if (CJK_RE.test(m[0])) n += Array.from(m[0]).length * 0.6;
    else n++;
  }
  return Math.round(n);
}

/** Thời gian đọc (phút): ~200 âm tiết/từ mỗi phút, ~400 ký tự CJK mỗi phút. */
export function readingMinutes(text: string): number {
  if (!text.trim()) return 0;
  let cjk = 0;
  let other = 0;
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text))) {
    if (CJK_RE.test(m[0])) cjk += Array.from(m[0]).length;
    else other++;
  }
  return other / 200 + cjk / 400;
}

export function formatMinutes(min: number): string {
  if (min <= 0) return '0 giây';
  if (min < 1) return `${Math.max(1, Math.round(min * 60))} giây`;
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return s ? `${m} phút ${s} giây` : `${m} phút`;
}

export interface TextStats {
  chars: number;
  charsNoSpace: number;
  words: number;
  uniqueWords: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  avgSentenceWords: number;
  readingMinutes: number;
  speakingMinutes: number;
}

export function textStats(text: string): TextStats {
  const sents = splitSentences(text);
  const words = countWords(text);
  const uniq = new Set<string>();
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const lower = lowerVi(text);
  while ((m = WORD_RE.exec(lower))) uniq.add(m[0]);
  const paragraphs = text.trim() ? text.split(/\n\s*\n/).filter((p) => p.trim()).length : 0;
  return {
    chars: text.length,
    charsNoSpace: text.replace(/\s/g, '').length,
    words,
    uniqueWords: uniq.size,
    sentences: sents.length,
    paragraphs,
    lines: text ? text.split('\n').length : 0,
    avgSentenceWords: sents.length ? Math.round((words / sents.length) * 10) / 10 : 0,
    readingMinutes: readingMinutes(text),
    speakingMinutes: words / 130,
  };
}

/* ========================================================================== */
/* 5. Nhận diện ngôn ngữ (script / dấu / stopword)                             */
/* ========================================================================== */

export const LANG_LABELS: Record<string, string> = {
  vi: 'Tiếng Việt', en: 'Tiếng Anh', zh: 'Tiếng Trung', ja: 'Tiếng Nhật', ko: 'Tiếng Hàn', fr: 'Tiếng Pháp', de: 'Tiếng Đức', es: 'Tiếng Tây Ban Nha',
  pt: 'Tiếng Bồ Đào Nha', it: 'Tiếng Ý', ru: 'Tiếng Nga', th: 'Tiếng Thái', ar: 'Tiếng Ả Rập', hi: 'Tiếng Hindi', el: 'Tiếng Hy Lạp', he: 'Tiếng Do Thái',
  id: 'Tiếng Indonesia', nl: 'Tiếng Hà Lan', tr: 'Tiếng Thổ Nhĩ Kỳ', pl: 'Tiếng Ba Lan', uk: 'Tiếng Ukraina',
};

export interface DetectedLang {
  code: string;
  label: string;
  confidence: number;
  method: 'script' | 'diacritics' | 'stopwords' | 'browser' | 'none';
}

const LATIN_HINTS: Record<string, string> = {
  en: 'the and of to in is that it for was on with as are this be by at from have not but they you which an or his her we their there been has would what will can more',
  fr: 'le la les des du de un une et est en que qui dans pour pas sur au avec ce il elle nous vous sont mais ou plus par être très cette ces comme',
  de: 'der die das und ist nicht ein eine zu den mit auf für von sich dem des auch es im ich sie wir aber wie oder noch nach bei zum zur wird sind',
  es: 'el la los las de que y en un una es por con para no se su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre',
  pt: 'o a os as de que e do da em um uma para é com não os se na por mais mas como foi ao ele das tem à seu sua ou ser quando muito já também',
  it: 'il lo la i gli le di che e un una è per in con non si da come ma più al del della sono anche ha questo questa nel nella',
  id: 'yang dan di ke dari ini itu dengan untuk tidak akan pada adalah juga atau saya kami mereka dalam oleh sudah bisa karena ada lebih',
  nl: 'de het een en van ik te dat die in is niet op aan met als voor zijn er maar om hij zij ze ook dan wordt naar bij',
  tr: 'bir ve bu da de için ile ne ben sen o çok daha gibi ama var mı değil olarak kadar sonra',
  pl: 'i w nie na to się z że do jest jak ale po co tak za od czy dla tym przez',
};
const LATIN_HINT_SETS = Object.fromEntries(Object.entries(LATIN_HINTS).map(([k, v]) => [k, new Set(v.split(' '))]));

const VI_SPECIFIC = new RegExp('[ăâđêôơưĂÂĐÊÔƠƯ]', 'u');
const VI_TONES = new RegExp('[ạảãàáậẩẫầấặẳẵằắẹẻẽèéệểễềếịỉĩìíọỏõòóộổỗồốợởỡờớụủũùúựửữừứỵỷỹỳýẠẢÃÀÁẬẨẪẦẤẶẲẴẰẮẸẺẼÈÉỆỂỄỀẾỊỈĨÌÍỌỎÕÒÓỘỔỖỒỐỢỞỠỜỚỤỦŨÙÚỰỬỮỪỨỴỶỸỲÝ]', 'gu');

export function detectLanguage(text: string): DetectedLang {
  const sample = text.slice(0, 8000);
  const none: DetectedLang = { code: 'und', label: 'Không xác định', confidence: 0, method: 'none' };
  const counts: Record<string, number> = { han: 0, kana: 0, hangul: 0, cyr: 0, arab: 0, thai: 0, deva: 0, greek: 0, hebrew: 0, latin: 0 };
  const tests: [string, RegExp][] = [
    ['han', new RegExp('\\p{Script=Han}', 'u')], ['kana', new RegExp('[\\p{Script=Hiragana}\\p{Script=Katakana}]', 'u')], ['hangul', new RegExp('\\p{Script=Hangul}', 'u')],
    ['cyr', new RegExp('\\p{Script=Cyrillic}', 'u')], ['arab', new RegExp('\\p{Script=Arabic}', 'u')], ['thai', new RegExp('\\p{Script=Thai}', 'u')],
    ['deva', new RegExp('\\p{Script=Devanagari}', 'u')], ['greek', new RegExp('\\p{Script=Greek}', 'u')], ['hebrew', new RegExp('\\p{Script=Hebrew}', 'u')], ['latin', new RegExp('\\p{Script=Latin}', 'u')],
  ];
  let letters = 0;
  for (const ch of sample) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    for (const [k, re] of tests) {
      if (re.test(ch)) {
        counts[k]++;
        break;
      }
    }
  }
  if (!letters) return none;
  const frac = (k: string) => counts[k] / letters;
  if (frac('kana') > 0.05) return { code: 'ja', label: LANG_LABELS.ja, confidence: Math.min(1, 0.7 + frac('kana')), method: 'script' };
  if (frac('hangul') > 0.2) return { code: 'ko', label: LANG_LABELS.ko, confidence: Math.min(1, frac('hangul') + 0.2), method: 'script' };
  if (frac('han') > 0.2) return { code: 'zh', label: LANG_LABELS.zh, confidence: Math.min(1, frac('han') + 0.2), method: 'script' };
  const scriptMap: [string, string][] = [['cyr', 'ru'], ['arab', 'ar'], ['thai', 'th'], ['deva', 'hi'], ['greek', 'el'], ['hebrew', 'he']];
  for (const [k, c] of scriptMap) {
    if (frac(k) > 0.4) {
      if (c === 'ru' && /[іїєґ]/i.test(sample)) return { code: 'uk', label: LANG_LABELS.uk, confidence: 0.75, method: 'script' };
      return { code: c, label: LANG_LABELS[c], confidence: Math.min(1, frac(k) + 0.1), method: 'script' };
    }
  }
  // chữ Latin
  const words = lowerVi(sample).match(WORD_RE) ?? [];
  const viSpecific = (sample.match(new RegExp('[ăâđêôơưĂÂĐÊÔƠƯ]', 'gu')) ?? []).length;
  const tones = (sample.match(VI_TONES) ?? []).length;
  if (VI_SPECIFIC.test(sample) || tones > 0) {
    const ratio = (viSpecific + tones) / Math.max(1, words.length);
    if (viSpecific >= 1 && (tones >= 1 || ratio > 0.1)) {
      return { code: 'vi', label: LANG_LABELS.vi, confidence: Math.min(0.99, 0.6 + ratio), method: 'diacritics' };
    }
  }
  const scores: Record<string, number> = {};
  for (const [lang, set] of Object.entries(LATIN_HINT_SETS)) {
    let s = 0;
    for (const w of words) if (set.has(w)) s++;
    scores[lang] = s / Math.max(1, words.length);
  }
  // dấu đặc trưng
  if (/[ñ¿¡]/i.test(sample)) scores.es += 0.1;
  if (/[ß]/.test(sample) || /[äöü]/i.test(sample)) scores.de += 0.06;
  if (/[çœ]/i.test(sample) || /[èêëàâîôû]/i.test(sample)) scores.fr += 0.04;
  if (/[ãõ]/i.test(sample)) scores.pt += 0.08;
  if (/[ğışİ]/.test(sample)) scores.tr += 0.1;
  if (/[ąęłńśźż]/i.test(sample)) scores.pl += 0.1;
  // Tiếng Việt không dấu: nhiều âm tiết VN phổ biến
  const viNoTone = new Set('va cua la co khong duoc cho mot nhung cac nay do trong voi de khi da se dang rat cung nhu nhung thi ma o tai tu ve theo bi boi nen vi neu hay hoac toi ban anh chi em'.split(' '));
  let vn = 0;
  for (const w of words) if (viNoTone.has(w)) vn++;
  scores.vi = (vn / Math.max(1, words.length)) * 0.9;
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = sorted[0];
  const second = sorted[1]?.[1] ?? 0;
  if (bestScore < 0.05) return { code: 'en', label: LANG_LABELS.en, confidence: 0.2, method: 'stopwords' };
  return { code: best, label: LANG_LABELS[best] ?? best, confidence: Math.min(0.97, 0.4 + (bestScore - second) * 2 + bestScore), method: 'stopwords' };
}

/* ========================================================================== */
/* 6. API AI tích hợp trình duyệt (Summarizer / Translator / LanguageDetector) */
/* ========================================================================== */

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface MonitorLike {
  addEventListener(type: 'downloadprogress', cb: (e: { loaded: number }) => void): void;
}
interface BaseCreateOpts {
  monitor?: (m: MonitorLike) => void;
  signal?: AbortSignal;
}
interface SummarizerInstance {
  summarize(text: string, o?: { context?: string; signal?: AbortSignal }): Promise<string>;
  summarizeStreaming?(text: string, o?: { context?: string; signal?: AbortSignal }): ReadableStream<string>;
  inputQuota?: number;
  destroy?(): void;
}
interface SummarizerStatic {
  availability(o?: Record<string, unknown>): Promise<Availability>;
  create(o?: BaseCreateOpts & Record<string, unknown>): Promise<SummarizerInstance>;
}
interface TranslatorInstance {
  translate(text: string, o?: { signal?: AbortSignal }): Promise<string>;
  translateStreaming?(text: string, o?: { signal?: AbortSignal }): ReadableStream<string>;
  inputQuota?: number;
  destroy?(): void;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(o: BaseCreateOpts & { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorInstance>;
}
interface LanguageDetectorInstance {
  detect(text: string, o?: { signal?: AbortSignal }): Promise<{ detectedLanguage: string; confidence: number }[]>;
  destroy?(): void;
}
interface LanguageDetectorStatic {
  availability(o?: Record<string, unknown>): Promise<Availability>;
  create(o?: BaseCreateOpts & Record<string, unknown>): Promise<LanguageDetectorInstance>;
}
interface BrowserAiGlobals {
  Summarizer?: SummarizerStatic;
  Translator?: TranslatorStatic;
  LanguageDetector?: LanguageDetectorStatic;
}

function aiGlobals(): BrowserAiGlobals {
  return (typeof globalThis !== 'undefined' ? (globalThis as unknown as BrowserAiGlobals) : {}) ?? {};
}

export interface BrowserAiSupport {
  summarizer: boolean;
  translator: boolean;
  languageDetector: boolean;
}

export function detectBrowserAi(): BrowserAiSupport {
  const g = aiGlobals();
  return {
    summarizer: typeof g.Summarizer === 'object' || typeof g.Summarizer === 'function',
    translator: typeof g.Translator === 'object' || typeof g.Translator === 'function',
    languageDetector: typeof g.LanguageDetector === 'object' || typeof g.LanguageDetector === 'function',
  };
}

export const BROWSER_AI_OK_MESSAGE = 'Trình duyệt hỗ trợ dịch tích hợp';
export const BROWSER_AI_NO_MESSAGE = 'Chưa hỗ trợ — dùng Chrome 138+ trên máy tính hoặc thêm khóa AI';

export type BrowserAiAvailability = Availability | 'unsupported';

async function safeAvail<T>(fn: () => Promise<T>): Promise<T | 'unsupported'> {
  try {
    return await fn();
  } catch {
    return 'unsupported';
  }
}

export async function translatorAvailability(source: string, target: string): Promise<BrowserAiAvailability> {
  const T = aiGlobals().Translator;
  if (!T) return 'unsupported';
  return safeAvail(() => T.availability({ sourceLanguage: source, targetLanguage: target }));
}
export async function summarizerAvailability(): Promise<BrowserAiAvailability> {
  const S = aiGlobals().Summarizer;
  if (!S) return 'unsupported';
  return safeAvail(() => S.availability());
}

/** Dịch lỗi của API tích hợp sang tiếng Việt. */
export function describeBrowserAiError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  const msg = (e as { message?: string })?.message ?? '';
  if (name === 'AbortError') return 'Đã huỷ.';
  if (name === 'NotAllowedError') return 'Trình duyệt chặn thao tác này. Hãy bấm lại nút (cần thao tác trực tiếp của bạn để tải mô hình) hoặc kiểm tra quyền/cờ tính năng của Chrome.';
  if (name === 'QuotaExceededError') return 'Văn bản vượt giới hạn của bộ xử lý tích hợp. Hãy rút ngắn văn bản.';
  if (name === 'NotSupportedError') return 'Cặp ngôn ngữ hoặc tuỳ chọn này chưa được bộ xử lý tích hợp hỗ trợ.';
  if (name === 'NetworkError') return 'Không tải được mô hình ngôn ngữ (lỗi mạng). Kiểm tra kết nối rồi thử lại.';
  if (name === 'InvalidStateError') return 'Phiên làm việc không còn hợp lệ. Hãy thử lại.';
  return `Lỗi bộ xử lý tích hợp của trình duyệt${msg ? `: ${msg}` : ''}`;
}

/** Chia văn bản thành các khối <= limit ký tự, ưu tiên ngắt ở đoạn rồi tới câu. */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return text.trim() ? [text] : [];
  const chunks: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur);
    cur = '';
  };
  const addPiece = (piece: string, sep: string) => {
    if (cur && (cur + sep + piece).length > limit) push();
    cur = cur ? cur + sep + piece : piece;
  };
  for (const para of text.split(/\n{2,}/)) {
    if (para.length <= limit) {
      addPiece(para, '\n\n');
      continue;
    }
    for (const s of splitInline(para.replace(/\n/g, ' '))) {
      if (s.length <= limit) addPiece(s, ' ');
      else for (let i = 0; i < s.length; i += limit) addPiece(s.slice(i, i + limit), ' ');
    }
  }
  push();
  return chunks;
}

async function readStream(stream: ReadableStream<string>, onText: (acc: string) => void, signal?: AbortSignal): Promise<string> {
  const reader = stream.getReader();
  let acc = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      // Chrome cũ trả về văn bản tích luỹ, bản mới trả về phần tăng thêm
      acc = acc && value.startsWith(acc) ? value : acc + value;
      onText(acc);
    }
  } finally {
    reader.releaseLock?.();
  }
  return acc;
}

export interface BrowserRunOpts {
  signal?: AbortSignal;
  /** 0..1 khi mô hình đang tải */
  onDownload?: (fraction: number) => void;
  /** Văn bản kết quả hiện có (stream) */
  onText?: (partial: string) => void;
}

function monitorFor(onDownload?: (f: number) => void) {
  return (m: MonitorLike) => {
    m.addEventListener('downloadprogress', (e) => onDownload?.(Math.max(0, Math.min(1, e.loaded))));
  };
}

export async function detectLanguageBrowser(text: string): Promise<DetectedLang | null> {
  const D = aiGlobals().LanguageDetector;
  if (!D || !text.trim()) return null;
  try {
    const av = await D.availability();
    if (av === 'unavailable') return null;
    const det = await D.create();
    try {
      const res = await det.detect(text.slice(0, 2000));
      const top = res?.[0];
      if (!top || !top.detectedLanguage || top.detectedLanguage === 'und') return null;
      const code = top.detectedLanguage.split('-')[0];
      return { code, label: LANG_LABELS[code] ?? code, confidence: top.confidence, method: 'browser' };
    } finally {
      det.destroy?.();
    }
  } catch {
    return null;
  }
}

/** Dịch bằng Translator tích hợp. `source` có thể là 'auto' (tự phát hiện). */
export async function translateWithBrowser(text: string, source: string, target: string, opts: BrowserRunOpts = {}): Promise<string> {
  const T = aiGlobals().Translator;
  if (!T) throw new Error('Trình duyệt chưa hỗ trợ Translator tích hợp.');
  let src = source;
  if (src === 'auto') {
    const b = await detectLanguageBrowser(text);
    src = b && b.confidence > 0.5 ? b.code : detectLanguage(text).code;
    if (src === 'und') throw new Error('Không xác định được ngôn ngữ nguồn. Hãy chọn thủ công.');
  }
  if (src === target) return text;
  const av = await T.availability({ sourceLanguage: src, targetLanguage: target });
  if (av === 'unavailable') throw Object.assign(new Error('unsupported pair'), { name: 'NotSupportedError' });
  const tr = await T.create({ sourceLanguage: src, targetLanguage: target, monitor: monitorFor(opts.onDownload), signal: opts.signal });
  try {
    let limit = 1800;
    if (typeof tr.inputQuota === 'number' && tr.inputQuota > 0) limit = Math.max(300, Math.min(limit, Math.floor(tr.inputQuota * 0.8)));
    const doAll = async (lim: number): Promise<string> => {
      const chunks = chunkText(text, lim);
      const results: string[] = [];
      for (const c of chunks) {
        if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const base = results.join('\n\n');
        const emit = (part: string) => opts.onText?.(base ? base + '\n\n' + part : part);
        let r: string;
        if (tr.translateStreaming) r = await readStream(tr.translateStreaming(c, { signal: opts.signal }), emit, opts.signal);
        else {
          r = await tr.translate(c, { signal: opts.signal });
          emit(r);
        }
        results.push(r);
      }
      return results.join('\n\n');
    };
    try {
      return await doAll(limit);
    } catch (e) {
      if ((e as { name?: string })?.name === 'QuotaExceededError' && limit > 400) return await doAll(Math.floor(limit / 3));
      throw e;
    }
  } finally {
    tr.destroy?.();
  }
}

export interface BrowserSummarizeOpts extends BrowserRunOpts {
  type?: 'key-points' | 'tldr' | 'teaser' | 'headline';
  length?: SummaryLength;
  format?: 'markdown' | 'plain-text';
  outputLanguage?: string;
  context?: string;
}

/** Tóm tắt trừu tượng bằng Summarizer tích hợp (chia khối nếu dài). */
export async function summarizeWithBrowser(text: string, opts: BrowserSummarizeOpts = {}): Promise<string> {
  const S = aiGlobals().Summarizer;
  if (!S) throw new Error('Trình duyệt chưa hỗ trợ Summarizer tích hợp.');
  const detected = detectLanguage(text).code;
  const outLang = opts.outputLanguage && ['en', 'es', 'ja'].includes(opts.outputLanguage) ? opts.outputLanguage : ['es', 'ja'].includes(detected) ? detected : 'en';
  const createOpts = {
    type: opts.type ?? 'key-points',
    format: opts.format ?? 'markdown',
    length: opts.length ?? 'medium',
    outputLanguage: outLang,
    expectedInputLanguages: [detected === 'und' ? 'en' : detected],
    expectedContextLanguages: [detected === 'und' ? 'en' : detected],
    sharedContext: opts.context,
    monitor: monitorFor(opts.onDownload),
    signal: opts.signal,
  };
  const av = await S.availability({ type: createOpts.type, format: createOpts.format, length: createOpts.length, outputLanguage: outLang });
  if (av === 'unavailable') throw Object.assign(new Error('unavailable'), { name: 'NotSupportedError' });
  const sm = await S.create(createOpts);
  try {
    let limit = 4000;
    if (typeof sm.inputQuota === 'number' && sm.inputQuota > 0) limit = Math.max(400, Math.min(12000, Math.floor(sm.inputQuota * 2.5)));
    const one = async (chunk: string, emit?: (s: string) => void): Promise<string> => {
      if (sm.summarizeStreaming && emit) return readStream(sm.summarizeStreaming(chunk, { signal: opts.signal }), emit, opts.signal);
      const r = await sm.summarize(chunk, { signal: opts.signal });
      emit?.(r);
      return r;
    };
    const chunks = chunkText(text, limit);
    if (chunks.length <= 1) return await one(chunks[0] ?? text, opts.onText);
    const partials: string[] = [];
    for (const c of chunks) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      partials.push(await one(c));
      opts.onText?.(partials.join('\n\n'));
    }
    const merged = partials.join('\n\n');
    if (merged.length > limit) return merged;
    return await one(merged, opts.onText);
  } finally {
    sm.destroy?.();
  }
}

/* ========================================================================== */
/* 7. Phân tích mã tĩnh                                                        */
/* ========================================================================== */

export type CodeLang =
  | 'javascript' | 'typescript' | 'python' | 'go' | 'rust' | 'java' | 'csharp' | 'c' | 'cpp' | 'php' | 'ruby' | 'kotlin' | 'swift' | 'sql' | 'bash' | 'html' | 'css' | 'json' | 'yaml' | 'unknown';

export const CODE_LANG_LABELS: Record<CodeLang, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', go: 'Go', rust: 'Rust', java: 'Java', csharp: 'C#', c: 'C', cpp: 'C++', php: 'PHP', ruby: 'Ruby',
  kotlin: 'Kotlin', swift: 'Swift', sql: 'SQL', bash: 'Bash / Shell', html: 'HTML', css: 'CSS', json: 'JSON', yaml: 'YAML', unknown: 'Không xác định',
};

type Sig = [RegExp, number];
const SIGS: Partial<Record<CodeLang, Sig[]>> = {
  javascript: [
    [/\b(?:const|let|var)\s+[\w$]+\s*=/g, 1], [/=>/g, 1], [/\bfunction\b/g, 1], [/console\.(?:log|error|warn)\(/g, 3], [/\brequire\(\s*['"]/g, 3], [/module\.exports/g, 4],
    [/\bdocument\.|\bwindow\./g, 3], [/={3}/g, 1], [/\bimport\s+.+\s+from\s+['"]/g, 2], [/\bexport\s+(?:default|const|function|class)\b/g, 2], [/\bawait\b|\bPromise\b/g, 1], [/\.then\(/g, 1],
  ],
  typescript: [
    [/:\s*(?:string|number|boolean|void|any|unknown|never)\b/g, 3], [/\binterface\s+\w+\s*(?:extends\s+[\w, ]+)?\{/g, 4], [/\btype\s+\w+\s*(?:<[^>]*>)?\s*=/g, 4], [/<\w+(?:\s*,\s*\w+)*>\(/g, 1], [/\bas\s+(?:const|\w+)\b/g, 2],
    [/\benum\s+\w+\s*\{/g, 2], [/\bexport\s+(?:type|interface)\b/g, 4], [/\b(?:public|private|protected|readonly)\s+\w+\s*[:(]/g, 2], [/\w\?:\s*\w/g, 3], [/!\./g, 1], [/\bimplements\s+\w+/g, 1],
  ],
  python: [
    [/^\s*def\s+\w+\s*\(.*\)\s*(?:->\s*[^:]+)?:\s*$/gm, 5], [/^\s*(?:from\s+[\w.]+\s+import\s+|import\s+[\w.]+\s*(?:as\s+\w+)?\s*$)/gm, 4], [/^\s*(?:elif\b|else:\s*$)/gm, 3], [/\bself\b/g, 2], [/\bprint\(/g, 2],
    [/__name__\s*==|__init__/g, 4], [/\b(?:None|True|False)\b/g, 2], [/^\s*class\s+\w+(?:\([^)]*\))?:\s*$/gm, 5], [/^\s*(?:if|for|while|with|try|except[^:\n]*|finally)\b[^\n{;]*:\s*$/gm, 3], [/\blen\(|\brange\(/g, 1], [/^\s*@\w+/gm, 1],
  ],
  go: [[/^package\s+\w+/gm, 6], [/\bfunc\s+(?:\([^)]*\)\s*)?\w+\s*\(/g, 5], [/:=/g, 3], [/\bfmt\.\w+\(/g, 4], [/\bif\s+err\s*!=\s*nil/g, 5], [/^import\s*\(/gm, 4], [/\bgo\s+func\b|\bchan\b|\bdefer\b/g, 3], [/\bstruct\s*\{/g, 2], [/\bmake\(/g, 1]],
  rust: [[/\bfn\s+\w+/g, 4], [/\blet\s+mut\b/g, 5], [/\b\w+!\(/g, 2], [/\buse\s+(?:std|crate|super)::/g, 5], [/\bimpl\b(?:\s*<[^>]*>)?\s+\w+/g, 3], [/\bpub\s+(?:fn|struct|enum|mod|trait)\b/g, 4], [/->\s*(?:Result|Option|Self|&|\w+)/g, 2], [/&(?:mut\s+)?(?:str|self)\b/g, 3], [/\bOption<|\bResult<|\bVec<|\bBox</g, 3], [/\bmatch\s+\w+.*\{/g, 2], [/#\[derive/g, 5]],
  java: [[/\bpublic\s+(?:static\s+)?(?:final\s+)?(?:class|interface|enum)\b/g, 4], [/System\.out\.print/g, 6], [/\bimport\s+java[x]?\./g, 6], [/public\s+static\s+void\s+main/g, 6], [/@Override\b/g, 4], [/\b(?:private|protected)\s+(?:final\s+)?\w+(?:<[^>]*>)?\s+\w+\s*[;=(]/g, 2], [/\bString\[\]\s+\w+/g, 2], [/\bnew\s+\w+(?:<[^>]*>)?\(/g, 1], [/\bthrows\s+\w+/g, 3], [/@(?:Autowired|Service|RestController|Entity)\b/g, 3], [/\bList<|\bMap<|\bArrayList</g, 2]],
  csharp: [[/\busing\s+System/g, 6], [/\bnamespace\s+[\w.]+/g, 3], [/Console\.Write(?:Line)?\(/g, 6], [/\{\s*get;\s*(?:set;|init;)?\s*\}/g, 6], [/\bpublic\s+(?:async\s+)?(?:static\s+)?(?:class|interface|enum|struct|record|Task|void)\b/g, 2], [/\basync\s+Task\b/g, 4], [/\bvar\s+\w+\s*=\s*new\b/g, 2], [/\[Http(?:Get|Post|Put|Delete)/g, 5], [/\bstring\s+\w+/g, 1], [/\bforeach\s*\(\s*(?:var|\w+)\s+\w+\s+in\b/g, 4], [/\block\s*\(|\bIEnumerable</g, 3]],
  c: [[/#include\s*<(?:stdio|stdlib|string|stdint|math|unistd)\.h>/g, 6], [/\bint\s+main\s*\(/g, 3], [/\bprintf\s*\(/g, 3], [/\bmalloc\s*\(|\bfree\s*\(/g, 3], [/\btypedef\s+(?:struct|enum|union)\b/g, 3], [/\bchar\s*\*+\s*\w+/g, 2], [/->\w+/g, 1], [/#define\s+\w+/g, 2], [/\bsizeof\s*\(/g, 2]],
  cpp: [[/#include\s*<(?:iostream|vector|string|map|memory|algorithm|set|unordered_map)>/g, 7], [/\bstd::/g, 5], [/\bcout\s*<<|\bcin\s*>>/g, 5], [/\btemplate\s*<[^>]*>/g, 4], [/\busing\s+namespace\s+std/g, 6], [/\bclass\s+\w+\s*(?::\s*public\s+\w+)?\s*\{/g, 2], [/\bnullptr\b|\bconstexpr\b|\bauto\s+\w+\s*=/g, 3], [/\w+::\w+\s*\(/g, 2], [/\bvirtual\b|\boverride\b/g, 2]],
  php: [[/<\?php/g, 8], [/\$\w+\s*=/g, 3], [/\$this->/g, 4], [/\bfunction\s+\w+\s*\(.*\)\s*(?::\s*\??\w+)?\s*\{?/g, 1], [/\becho\b/g, 2], [/\bnamespace\s+[\w\\]+;/g, 3], [/\buse\s+[\w\\]+;/g, 1], [/\barray\(|\bforeach\s*\(\s*\$/g, 3], [/::\w+/g, 1], [/\bpublic\s+function\b/g, 3], [/\$_(?:GET|POST|SERVER|SESSION|REQUEST)/g, 5]],
  ruby: [[/^\s*def\s+\w+[?!]?(?:\s*\([^)]*\))?\s*$/gm, 4], [/^\s*end\s*$/gm, 3], [/\bputs\b/g, 3], [/\battr_(?:accessor|reader|writer)\b/g, 6], [/\bdo\s*\|[^|]*\|/g, 4], [/^\s*require(?:_relative)?\s+['"]/gm, 5], [/@\w+\s*=/g, 2], [/\.each\s+do\b|\.map\s*\{/g, 3], [/\bunless\b|\belsif\b/g, 4], [/^\s*(?:class|module)\s+[A-Z]\w*(?:\s*<\s*[\w:]+)?\s*$/gm, 4], [/:\w+\s*=>|\w+:\s+:\w+/g, 1]],
  kotlin: [[/\bfun\s+(?:<[^>]*>\s*)?\w+(?:\.\w+)?\s*\(/g, 6], [/\b(?:val|var)\s+\w+\s*(?::\s*[\w<>?]+)?\s*=/g, 2], [/\bdata\s+class\b|\bcompanion\s+object\b|\bsealed\s+class\b/g, 6], [/\bprintln\(/g, 2], [/\bwhen\s*(?:\([^)]*\))?\s*\{/g, 5], [/\?\.|\?:/g, 2], [/\bpackage\s+[\w.]+\s*$/gm, 1], [/\bimport\s+(?:kotlin|android|androidx)[x]?\./g, 5], [/\bit\b\./g, 1], [/\boverride\s+fun\b/g, 4]],
  swift: [[/\bfunc\s+\w+\s*(?:<[^>]*>)?\s*\(/g, 5], [/\bimport\s+(?:Foundation|SwiftUI|UIKit|Combine|AppKit)\b/g, 8], [/\bguard\s+(?:let|var)\b|\bif\s+let\b/g, 6], [/\blet\s+\w+\s*(?::\s*[\w\[\]?<>]+)?\s*=/g, 1], [/@(?:State|Binding|Published|ObservedObject|main|StateObject)\b/g, 6], [/\bstruct\s+\w+\s*:\s*View\b/g, 8], [/->\s*(?:Void|Int|String|Bool|some|\w+)/g, 1], [/\bvar\s+body\s*:\s*some\b/g, 8], [/\bextension\s+\w+/g, 3], [/\bprotocol\s+\w+/g, 4]],
  sql: [[/\bSELECT\b[\s\S]{0,200}?\bFROM\b/gi, 6], [/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/gi, 6], [/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|INDEX|PROCEDURE|FUNCTION|DATABASE)\b/gi, 7], [/\bALTER\s+TABLE\b|\bDROP\s+TABLE\b/gi, 6], [/\b(?:WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LEFT\s+JOIN|INNER\s+JOIN)\b/gi, 3], [/\b(?:PRIMARY\s+KEY|FOREIGN\s+KEY|NOT\s+NULL|VARCHAR|INT)\b/gi, 2]],
  bash: [[/^#!\s*\/(?:usr\/)?(?:bin|env)\/(?:env\s+)?(?:ba|z)?sh/gm, 10], [/\$\([^)]*\)|\$\{[^}]*\}/g, 3], [/^\s*(?:if\s+\[|fi\s*$|then\s*$|done\s*$|esac\s*$)/gm, 5], [/\becho\s+/g, 2], [/^\s*(?:export|alias|source|set -[euxo]+|cd|mkdir|chmod|grep|sed|awk|curl|sudo|apt(?:-get)?|npm|git)\s/gm, 3], [/\|\s*(?:grep|awk|sed|sort|xargs|head|tail|wc)\b/g, 4], [/\[\[\s.*\s\]\]/g, 4], [/^\w+\(\)\s*\{/gm, 3], [/\bfor\s+\w+\s+in\b[^\n]*;\s*do\b|^\s*do\s*$/gm, 4]],
  html: [[/<!doctype\s+html/gi, 10], [/<\/?(?:html|head|body|div|span|p|a|ul|li|script|style|meta|link|table|form|input|button|h[1-6]|img)\b[^>]*>/gi, 2], [/<\w+[^>]*\s(?:class|id|href|src)=["'][^"']*["'][^>]*>/g, 3]],
  css: [[/[.#]?[\w-]+(?:\s*[>+~,]\s*[.#]?[\w-]+)*\s*\{\s*[\w-]+\s*:[^;{}]+;/g, 5], [/@(?:media|keyframes|import|font-face|tailwind|apply)\b/g, 5], [/\b(?:margin|padding|display|color|background(?:-color)?|font-size|border|flex|grid|width|height)\s*:\s*[^;{}]+;/g, 2], [/:(?:hover|focus|root|before|after|nth-child)\b/g, 2], [/var\(--[\w-]+\)/g, 2]],
  yaml: [[/^---\s*$/gm, 3], [/^\s*[\w.-]+:\s+\S/gm, 1], [/^\s*-\s+[\w.-]+:\s/gm, 2], [/^\s*-\s+\S/gm, 1], [/^\s*[\w.-]+:\s*$/gm, 1], [/^\s*(?:apiVersion|kind|metadata|services|version|name|on|jobs|steps):\s/gm, 3]],
};

export interface LangGuess {
  lang: CodeLang;
  confidence: number;
  scores: { lang: CodeLang; score: number }[];
}

function countMatches(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(s)) {
    n++;
    if (!re.global) break;
    if (re.lastIndex === 0 || n > 400) break;
  }
  return n;
}

export function detectCodeLanguage(code: string): LangGuess {
  const sample = code.slice(0, 40000);
  const trimmed = sample.trim();
  const none: LangGuess = { lang: 'unknown', confidence: 0, scores: [] };
  if (trimmed.length < 3) return none;
  // JSON thuần
  if (/^[[{]/.test(trimmed) && trimmed.length < 400000) {
    try {
      JSON.parse(code.trim());
      return { lang: 'json', confidence: 1, scores: [{ lang: 'json', score: 100 }] };
    } catch {
      /* không phải JSON hợp lệ */
    }
  }
  const scores = new Map<CodeLang, number>();
  for (const [lang, sigs] of Object.entries(SIGS) as [CodeLang, Sig[]][]) {
    let s = 0;
    for (const [re, w] of sigs) s += Math.min(8, countMatches(re, sample)) * w;
    scores.set(lang, s);
  }
  // TypeScript kế thừa một phần điểm JavaScript
  const js = scores.get('javascript') ?? 0;
  const ts = scores.get('typescript') ?? 0;
  if (ts > 0) scores.set('typescript', ts + js * 0.8);
  // C++ kế thừa một phần điểm C; ưu tiên cpp nếu có dấu hiệu riêng
  const cpp = scores.get('cpp') ?? 0;
  if (cpp > 0) scores.set('cpp', cpp + (scores.get('c') ?? 0) * 0.6);
  // Java vs C#/Kotlin: không cần xử lý thêm
  // Dòng JSON-with-comments / object-literal bị nhầm sang yaml: yaml bị phạt nếu có dấu ngoặc nhọn/chấm phẩy
  const braces = (sample.match(/[{};]/g) ?? []).length;
  if (braces > sample.split('\n').length * 0.3) scores.set('yaml', (scores.get('yaml') ?? 0) * 0.2);
  // YAML cần cấu trúc "key: value" chiếm đa số dòng
  const lines = sample.split('\n').filter((l) => l.trim());
  const kv = lines.filter((l) => /^\s*(?:-\s+)?[\w.-]+:\s*(?:\S.*)?$/.test(l)).length;
  if (lines.length && kv / lines.length < 0.5) scores.set('yaml', (scores.get('yaml') ?? 0) * 0.3);
  // Python vs YAML khi có "def"
  const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  const [best, bs] = sorted[0];
  const second = sorted[1]?.[1] ?? 0;
  if (bs < 4) return { ...none, scores: sorted.slice(0, 4).map(([lang, score]) => ({ lang, score })) };
  const confidence = Math.max(0.1, Math.min(0.99, (bs - second) / bs * 0.6 + Math.min(0.4, bs / 60)));
  return { lang: best, confidence, scores: sorted.slice(0, 4).map(([lang, score]) => ({ lang, score })) };
}

/* ---- Bóc chú thích / chuỗi ------------------------------------------------ */

interface StyleCfg {
  line: string[];
  block: [string, string][];
  quotes: string[];
  triple: boolean;
  backtick: boolean;
  charQuote: boolean;
  /** chuỗi nháy đơn là chuỗi thường (không phải ký tự) */
  noEscapeSingle?: boolean;
}

function styleFor(lang: CodeLang): StyleCfg {
  const cLike: StyleCfg = { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], triple: false, backtick: false, charQuote: false };
  switch (lang) {
    case 'javascript':
    case 'typescript':
      return { ...cLike, backtick: true };
    case 'python':
      return { line: ['#'], block: [], quotes: ['"', "'"], triple: true, backtick: false, charQuote: false };
    case 'ruby':
      return { line: ['#'], block: [['=begin', '=end']], quotes: ['"', "'"], triple: false, backtick: false, charQuote: false };
    case 'bash':
      return { line: ['#'], block: [], quotes: ['"', "'"], triple: false, backtick: false, charQuote: false, noEscapeSingle: true };
    case 'yaml':
      return { line: ['#'], block: [], quotes: ['"', "'"], triple: false, backtick: false, charQuote: false };
    case 'go':
      return { ...cLike, backtick: true, charQuote: true };
    case 'rust':
    case 'c':
    case 'cpp':
    case 'java':
    case 'csharp':
      return { ...cLike, charQuote: true };
    case 'kotlin':
    case 'swift':
      return { ...cLike, triple: true };
    case 'php':
      return { ...cLike, line: ['//', '#'] };
    case 'sql':
      return { line: ['--', '#'], block: [['/*', '*/']], quotes: ['"', "'"], triple: false, backtick: true, charQuote: false };
    case 'css':
      return { line: [], block: [['/*', '*/']], quotes: ['"', "'"], triple: false, backtick: false, charQuote: false };
    case 'html':
      return { line: [], block: [['<!--', '-->']], quotes: [], triple: false, backtick: false, charQuote: false };
    case 'json':
      return { line: [], block: [], quotes: ['"'], triple: false, backtick: false, charQuote: false };
    default:
      return cLike;
  }
}

interface StringLit {
  value: string;
  line: number;
}
interface Scanned {
  /** chú thích -> khoảng trắng, chuỗi -> khoảng trắng (giữ nháy) */
  blanked: string;
  /** chú thích -> khoảng trắng, chuỗi giữ nguyên */
  noComments: string;
  hasCode: boolean[];
  hasComment: boolean[];
  strings: StringLit[];
  lineStarts: number[];
}

function scanCode(src: string, lang: CodeLang): Scanned {
  const cfg = styleFor(lang);
  const n = src.length;
  const blanked: string[] = [];
  const noC: string[] = [];
  const lineStarts = [0];
  const hasCode: boolean[] = [false];
  const hasComment: boolean[] = [false];
  const strings: StringLit[] = [];
  let line = 0;
  let i = 0;
  const emit = (b: string, c: string, kind: 'code' | 'comment' | 'doc') => {
    blanked.push(b);
    noC.push(c);
    if (b === '\n') {
      line++;
      lineStarts.push(blanked.length);
      hasCode.push(false);
      hasComment.push(false);
    } else if (kind === 'code' && !/\s/.test(c)) hasCode[line] = true;
    else if (kind !== 'code') hasComment[line] = true;
  };
  const startsWith = (s: string) => src.startsWith(s, i);
  let lineOnlyWs = true; // đến đây trên dòng hiện tại chỉ có khoảng trắng
  while (i < n) {
    const ch = src[i];
    if (ch === '\n') {
      emit('\n', '\n', 'code');
      lineOnlyWs = true;
      i++;
      continue;
    }
    // chú thích dòng
    const lc = cfg.line.find((p) => startsWith(p) && !(lang === 'php' && p === '#' && startsWith('#[')) && !(p === '#' && lang === 'bash' && false));
    if (lc && !(lang === 'bash' && lc === '#' && i > 0 && /[$\w]/.test(src[i - 1]) && src[i - 1] !== ' ')) {
      while (i < n && src[i] !== '\n') {
        emit(' ', src[i], 'comment');
        i++;
      }
      continue;
    }
    // chú thích khối
    const bc = cfg.block.find(([o]) => startsWith(o) && (o !== '=begin' || lineOnlyWs));
    if (bc) {
      const close = src.indexOf(bc[1], i + bc[0].length);
      const end = close < 0 ? n : close + bc[1].length;
      for (; i < end; i++) {
        if (src[i] === '\n') emit('\n', '\n', 'comment');
        else emit(' ', src[i], 'comment');
      }
      continue;
    }
    // chuỗi
    let quote = '';
    if (cfg.triple && (startsWith('"""') || startsWith("'''"))) quote = src.slice(i, i + 3);
    else if (cfg.quotes.includes(ch)) quote = ch;
    else if (cfg.backtick && ch === '`') quote = ch;
    if (quote) {
      if (quote === "'" && cfg.charQuote) {
        // ký tự 'x' / '\n' / '\u{1F600}' hoặc lifetime 'a
        const m = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|.)|[^\\'\n])'/.exec(src.slice(i, i + 12));
        if (!m) {
          emit(ch, ch, 'code');
          lineOnlyWs = false;
          i++;
          continue;
        }
      }
      const multi = quote.length === 3 || quote === '`';
      const isDoc = lang === 'python' && quote.length === 3 && lineOnlyWs;
      const kind = isDoc ? 'doc' : 'code';
      const startLine = line;
      let j = i + quote.length;
      let value = '';
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === '\\' && !(quote === "'" && cfg.noEscapeSingle) && quote !== '`' || (c === '\\' && quote === '`' && lang !== 'go')) {
          value += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (src.startsWith(quote, j)) {
          closed = true;
          break;
        }
        if (c === '\n' && !multi) break;
        value += c;
        j++;
      }
      const end = closed ? j + quote.length : Math.min(j, n);
      // phát ra
      const openLen = quote.length;
      for (let k = i; k < end; k++) {
        const c = src[k];
        if (c === '\n') emit('\n', '\n', kind);
        else if (k < i + openLen || (closed && k >= end - quote.length)) emit(c, c, kind);
        else emit(isDoc ? ' ' : ' ', c, kind);
      }
      if (!isDoc && value.length > 0) strings.push({ value, line: startLine });
      i = end;
      lineOnlyWs = false;
      continue;
    }
    emit(ch, ch, 'code');
    if (!/\s/.test(ch)) lineOnlyWs = false;
    i++;
  }
  return { blanked: blanked.join(''), noComments: noC.join(''), hasCode, hasComment, strings, lineStarts };
}

function lineOf(starts: number[], idx: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

function matchBalanced(s: string, openIdx: number, open: string, close: string, cap = 60000): number {
  let depth = 0;
  const end = Math.min(s.length, openIdx + cap);
  for (let i = openIdx; i < end; i++) {
    const c = s[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if ('([{<'.includes(c)) depth++;
    else if (')]}>'.includes(c)) depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/* ---- Hàm / lớp ------------------------------------------------------------ */

export interface FunctionInfo {
  name: string;
  /** "Lớp.phương_thức" khi nằm trong lớp */
  fullName: string;
  line: number;
  endLine: number;
  lines: number;
  params: string[];
  paramCount: number;
  complexity: number;
  maxDepth: number;
  kind: 'function' | 'method' | 'arrow';
  className?: string;
}

export interface OutlineItem {
  kind: 'import' | 'export' | 'class' | 'function' | 'constant' | 'route' | 'sql' | 'todo' | 'section';
  name: string;
  line: number;
  detail?: string;
}

const CONTROL_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try', 'finally', 'with', 'synchronized', 'new', 'throw', 'await', 'case', 'typeof', 'sizeof', 'delete', 'yield', 'foreach', 'using', 'lock', 'when', 'match', 'elif', 'except', 'unless', 'in', 'is', 'as', 'and', 'or', 'not', 'print', 'echo', 'function', 'fn', 'func', 'fun', 'def', 'super', 'this', 'import', 'from', 'assert', 'guard', 'defer', 'go', 'select', 'unsafe', 'fixed', 'checked', 'where', 'extends', 'implements', 'static', 'class']);
const NON_TYPE_WORDS = new Set(['return', 'new', 'else', 'throw', 'await', 'case', 'delete', 'typeof', 'yield', 'goto', 'in', 'is', 'as', 'not', 'and', 'or', 'using', 'import', 'package', 'namespace', 'extends', 'implements']);

interface Header {
  name: string;
  offset: number; // vị trí bắt đầu header
  open: number; // vị trí '('
  kind: FunctionInfo['kind'];
  /** header đã biết body (vd. arrow đơn tham số) */
  paramsOverride?: string[];
  arrowAt?: number;
}

const MODS = '(?:(?:public|private|protected|internal|static|final|abstract|virtual|override|async|sealed|extern|inline|const|unsafe|partial|synchronized|default|readonly|get|set|export|open|suspend|tailrec|operator|infix|external|lateinit|nonisolated|mutating|@\\w+|pub(?:\\([^)]*\\))?)\\s+)*';

function findHeaders(lang: CodeLang, blanked: string): Header[] {
  const out: Header[] = [];
  const add = (re: RegExp, build: (m: RegExpExecArray) => Header | null) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(blanked)) && guard++ < 5000) {
      if (m[0].length === 0) re.lastIndex++;
      const h = build(m);
      if (h) out.push(h);
    }
  };
  const openOf = (m: RegExpExecArray) => m.index + m[0].length - 1;
  switch (lang) {
    case 'javascript':
    case 'typescript':
      add(/^[ \t]*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?\s*\(/gm, (m) => ({ name: m[1], offset: m.index, open: openOf(m), kind: 'function' }));
      add(/^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s+)?(?:function\s*\*?\s*[\w$]*\s*\(|\()/gm, (m) => ({ name: m[1], offset: m.index, open: openOf(m), kind: 'arrow', arrowAt: m[0].includes('function') ? undefined : 0 }));
      add(/^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/gm, (m) => ({ name: m[1], offset: m.index, open: m.index + m[0].length - 2, kind: 'arrow', paramsOverride: [m[2]], arrowAt: m.index + m[0].length - 2 }));
      add(new RegExp('^[ \\t]+' + MODS + '([A-Za-z_$#][\\w$]*)\\s*(?:<[^>\\n]*>)?\\s*\\(', 'gm'), (m) => (CONTROL_WORDS.has(m[1]) ? null : { name: m[1], offset: m.index, open: openOf(m), kind: 'method' }));
      break;
    case 'python':
      add(/^[ \t]*(?:async\s+)?def\s+(\w+)\s*\(/gm, (m) => ({ name: m[1], offset: m.index, open: openOf(m), kind: 'function' }));
      break;
    case 'go':
      add(/^func\s+(?:\(([^)]*)\)\s*)?(\w+)\s*(?:\[[^\]]*\])?\s*\(/gm, (m) => ({ name: m[2], offset: m.index, open: openOf(m), kind: m[1] ? 'method' : 'function' }));
      break;
    case 'rust':
      add(/^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(\w+)\s*(?:<[^{(]*>)?\s*\(/gm, (m) => ({ name: m[1], offset: m.index, open: openOf(m), kind: 'function' }));
      break;
    case 'kotlin':
      add(/^[ \t]*(?:(?:public|private|protected|internal|override|open|abstract|suspend|inline|operator|infix|tailrec)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)\s*\(/gm, (m) => ({ name: m[1], offset: m.index, open: openOf(m), kind: 'function' }));
      break;
    case 'swift':
      add(/^[ \t]*(?:(?:public|private|fileprivate|internal|open|static|class|final|override|mutating|nonmutating|@\w+)\s+)*func\s+(\w+)\s*(?:<[^>]*>)?\s*\(/gm, (m) => ({ name: m[1], offset: m.index, open: openOf(m), kind: 'function' }));
      break;
    case 'php':
      add(/^[ \t]*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?(\w+)\s*\(/gm, (m) => ({ name: m[1], offset: m.index, open: openOf(m), kind: 'function' }));
      break;
    case 'ruby':
      add(/^[ \t]*def\s+(?:self\.)?([\w]+[?!=]?)[ \t]*(\()?/gm, (m) => ({ name: m[1], offset: m.index, open: m[2] ? m.index + m[0].length - 1 : -1, kind: 'function' }));
      break;
    case 'bash':
      add(/^[ \t]*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*(?=\{|$)/gm, (m) => ({ name: m[1], offset: m.index, open: m.index + m[0].lastIndexOf('('), kind: 'function' }));
      add(/^[ \t]*function\s+([A-Za-z_][\w-]*)\s*(?=\{|$)/gm, (m) => ({ name: m[1], offset: m.index, open: -1, kind: 'function' }));
      break;
    case 'java':
    case 'csharp':
    case 'c':
    case 'cpp':
      add(new RegExp('^[ \\t]*' + MODS + '(?:([A-Za-z_][\\w.<>\\[\\],?*&:~ ]*?)\\s+)?([~]?[A-Za-z_]\\w*(?:::[~]?\\w+)*)\\s*\\(', 'gm'), (m) => {
        const name = m[2];
        const typ = (m[1] ?? '').trim();
        const lastWord = typ.split(/\s+/).pop() ?? '';
        if (CONTROL_WORDS.has(name) || NON_TYPE_WORDS.has(lastWord) || NON_TYPE_WORDS.has(typ)) return null;
        if (!typ && !/^[A-Z]/.test(name) && !name.includes('::') && lang !== 'cpp' && lang !== 'c') return null; // hàm tạo: Tên viết hoa
        if (!typ && (lang === 'c')) return null;
        return { name, offset: m.index, open: openOf(m), kind: 'method' };
      });
      break;
    default:
      break;
  }
  return out;
}

const INDENT_LANGS = new Set<CodeLang>(['python', 'ruby']);

interface Extent {
  startLine: number; // 1-based
  endLine: number;
  bodyStart: number; // offset
  bodyEnd: number;
}

function indentOf(l: string): number {
  let n = 0;
  for (const c of l) {
    if (c === ' ') n++;
    else if (c === '\t') n += 4;
    else break;
  }
  return n;
}

function findBodyExtent(lang: CodeLang, s: Scanned, h: Header, lines: string[]): { ext: Extent; params: string; oneLiner: boolean } | null {
  const code = s.blanked;
  const startLine = lineOf(s.lineStarts, h.offset);
  let params = '';
  let afterParams = h.open >= 0 ? h.open + 1 : h.offset;
  if (h.paramsOverride) {
    params = h.paramsOverride[0];
    afterParams = h.open;
  } else if (h.open >= 0) {
    const close = matchBalanced(code, h.open, '(', ')');
    if (close < 0) return null;
    params = code.slice(h.open + 1, close);
    afterParams = close + 1;
  } else {
    // ruby không ngoặc / bash function
    const eol = code.indexOf('\n', h.offset);
    const lineText = code.slice(h.offset, eol < 0 ? code.length : eol);
    const pm = /def\s+(?:self\.)?[\w?!=]+\s+([^\n#]+)/.exec(lineText);
    params = pm && lang === 'ruby' ? pm[1] : '';
    afterParams = eol < 0 ? code.length : eol;
    if (lang === 'bash') afterParams = h.offset + lineText.search(/function\s+[\w-]+/) + lineText.match(/function\s+[\w-]+/)![0].length;
  }
  if (INDENT_LANGS.has(lang)) {
    const hdrLine = lines[startLine - 1] ?? '';
    const base = indentOf(hdrLine);
    // Python: kết thúc header ở ':' ; thân là các dòng thụt vào sâu hơn
    let endLine = startLine;
    // bỏ qua phần header kéo dài nhiều dòng
    const afterLine = lineOf(s.lineStarts, afterParams);
    endLine = afterLine;
    for (let k = afterLine; k < lines.length; k++) {
      const l = lines[k];
      if (!l.trim()) continue;
      const ind = indentOf(l);
      if (ind > base) endLine = k + 1;
      else {
        if (lang === 'ruby' && ind === base && /^\s*end\b/.test(l)) endLine = k + 1;
        break;
      }
    }
    // một dòng: "def f(): return 1"
    const oneLiner = endLine === afterLine && /:\s*\S/.test(code.slice(afterParams, afterParams + 200).split('\n')[0] ?? '') && lang === 'python';
    const bodyStart = s.lineStarts[afterLine] ?? code.length;
    const bodyEnd = s.lineStarts[endLine] ?? code.length;
    return { ext: { startLine, endLine: Math.max(endLine, startLine), bodyStart: Math.min(bodyStart, code.length), bodyEnd: Math.min(bodyEnd, code.length) }, params, oneLiner };
  }
  // ngôn ngữ ngoặc nhọn
  const limit = Math.min(code.length, afterParams + 600);
  let k = afterParams;
  let brace = -1;
  let arrowExpr = false;
  for (; k < limit; k++) {
    const c = code[k];
    if (c === '{') {
      brace = k;
      break;
    }
    if (c === ';') return null;
    if (c === '=' && code[k + 1] === '>') {
      let q = k + 2;
      while (q < limit && /\s/.test(code[q])) q++;
      if (code[q] === '{') {
        brace = q;
        break;
      }
      arrowExpr = true;
      break;
    }
    if (c === '=' && code[k + 1] !== '=' && code[k - 1] !== '=' && !'!<>='.includes(code[k - 1] ?? '')) {
      arrowExpr = true; // thân biểu thức (Kotlin) hoặc khai báo
      if (lang !== 'kotlin') return null;
      break;
    }
    if (c === '\n' && (lang === 'bash') && brace < 0) {
      // bash: '{' có thể ở dòng kế
      continue;
    }
  }
  if (arrowExpr) {
    const eol = code.indexOf('\n', k);
    const endOff = eol < 0 ? code.length : eol;
    // biểu thức nhiều dòng: kéo đến hết lệnh (cân bằng ngoặc)
    let depth = 0;
    let e = k;
    for (; e < code.length; e++) {
      const c = code[e];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (depth === 0) break;
        depth--;
      } else if ((c === ';' || c === '\n') && depth === 0) break;
    }
    const end = Math.max(e, Math.min(endOff, e));
    return { ext: { startLine, endLine: lineOf(s.lineStarts, end), bodyStart: k, bodyEnd: end }, params, oneLiner: true };
  }
  if (brace < 0) return null;
  const close = matchBalanced(code, brace, '{', '}', 400000);
  const bodyEnd = close < 0 ? code.length : close;
  return { ext: { startLine, endLine: lineOf(s.lineStarts, bodyEnd), bodyStart: brace + 1, bodyEnd }, params, oneLiner: false };
}

/* ---- Độ phức tạp --------------------------------------------------------- */

const BRANCH_WORDS: Partial<Record<CodeLang, string[]>> = {
  javascript: ['if', 'for', 'while', 'case', 'catch'],
  typescript: ['if', 'for', 'while', 'case', 'catch'],
  python: ['if', 'elif', 'for', 'while', 'except', 'case', 'and', 'or'],
  go: ['if', 'for', 'case', 'select'],
  rust: ['if', 'for', 'while', 'loop'],
  java: ['if', 'for', 'while', 'case', 'catch'],
  csharp: ['if', 'for', 'foreach', 'while', 'case', 'catch'],
  c: ['if', 'for', 'while', 'case'],
  cpp: ['if', 'for', 'while', 'case', 'catch'],
  php: ['if', 'elseif', 'for', 'foreach', 'while', 'case', 'catch'],
  ruby: ['if', 'elsif', 'unless', 'for', 'while', 'until', 'when', 'rescue', 'and', 'or'],
  kotlin: ['if', 'for', 'while', 'when', 'catch'],
  swift: ['if', 'for', 'while', 'case', 'catch', 'guard'],
  bash: ['if', 'elif', 'for', 'while', 'until', 'case'],
};

/**
 * Độ phức tạp chu trình xấp xỉ = 1 + số nhánh/vòng lặp/toán tử boolean/catch/case.
 * `body` nên là mã đã bóc chú thích và chuỗi.
 */
export function cyclomaticComplexity(body: string, lang: CodeLang): number {
  const words = BRANCH_WORDS[lang] ?? ['if', 'for', 'while', 'case', 'catch'];
  const re = new RegExp('(?<![\\w$.])(?:' + words.join('|') + ')(?![\\w$])', 'g');
  let n = 1;
  n += (body.match(re) ?? []).length;
  if (lang !== 'python' && lang !== 'ruby') n += (body.match(/&&|\|\|/g) ?? []).length;
  else if (lang === 'ruby') n += (body.match(/&&|\|\|/g) ?? []).length;
  if (lang === 'bash') n += (body.match(/&&|\|\|/g) ?? []).length;
  if (lang === 'javascript' || lang === 'typescript' || lang === 'csharp' || lang === 'kotlin' || lang === 'swift' || lang === 'php') n += (body.match(/\?\?(?!=)/g) ?? []).length;
  if (['javascript', 'typescript', 'java', 'csharp', 'c', 'cpp', 'php', 'kotlin', 'swift'].includes(lang)) n += (body.match(/\s\?\s/g) ?? []).length; // toán tử ba ngôi
  if (lang === 'python') n += (body.match(/\s(?:if)\s[^\n]*\selse\s/g) ?? []).length - 0; // if-else inline đã tính ở 'if'
  if (lang === 'rust') n += (body.match(/=>/g) ?? []).length;
  return n;
}

/** Độ sâu lồng tối đa. Với ngôn ngữ ngoặc: theo { }; với Python/Ruby: theo thụt lề. */
export function maxNestingDepth(body: string, lang: CodeLang, indentUnit = 0): number {
  if (INDENT_LANGS.has(lang)) {
    const ls = body.split('\n').filter((l) => l.trim());
    if (!ls.length) return 0;
    const base = Math.min(...ls.map(indentOf));
    let unit = indentUnit;
    if (!unit) {
      const diffs = ls.map(indentOf).filter((x) => x > base).map((x) => x - base);
      unit = diffs.length ? Math.min(...diffs) : 4;
    }
    let mx = 0;
    for (const l of ls) mx = Math.max(mx, Math.floor((indentOf(l) - base) / Math.max(1, unit)));
    return mx;
  }
  let d = 0;
  let mx = 0;
  for (const c of body) {
    if (c === '{') {
      d++;
      if (d > mx) mx = d;
    } else if (c === '}') d = Math.max(0, d - 1);
  }
  return mx;
}

/* ---- Phân tích tổng ------------------------------------------------------- */

export type Severity = 'info' | 'warn' | 'danger';

export interface CodeSmell {
  id: string;
  severity: Severity;
  title: string;
  /** Giải thích tiếng Việt */
  explain: string;
  line?: number;
  detail?: string;
}

export interface CodeAnalysis {
  lang: CodeLang;
  langLabel: string;
  langConfidence: number;
  detected: boolean;
  lines: { total: number; code: number; comment: number; blank: number };
  commentRatio: number;
  outline: OutlineItem[];
  functions: FunctionInfo[];
  classes: { name: string; line: number; endLine: number }[];
  maxNesting: number;
  totalComplexity: number;
  smells: CodeSmell[];
  truncated: boolean;
}

const MAX_ANALYZE = 300_000;

function pushUniq<T>(arr: T[], v: T, key: (x: T) => string, seen: Set<string>) {
  const k = key(v);
  if (!seen.has(k)) {
    seen.add(k);
    arr.push(v);
  }
}

function extractImports(lang: CodeLang, nc: string, starts: number[], out: OutlineItem[]) {
  const L = (idx: number) => lineOf(starts, idx);
  const run = (re: RegExp, f: (m: RegExpExecArray) => OutlineItem | null) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let g = 0;
    while ((m = re.exec(nc)) && g++ < 2000) {
      if (m[0].length === 0) re.lastIndex++;
      const it = f(m);
      if (it) out.push(it);
    }
  };
  switch (lang) {
    case 'javascript':
    case 'typescript':
      run(/^[ \t]*import\s+([^'";]{0,400}?)\s+from\s+['"]([^'"\n]+)['"]/gm, (m) => ({ kind: 'import', name: m[2], line: L(m.index), detail: m[1].trim().replace(/\s+/g, ' ').slice(0, 80) }));
      run(/^[ \t]*import\s+['"]([^'"\n]+)['"]/gm, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      run(/\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      break;
    case 'python':
      run(/^[ \t]*from\s+([\w.]+)\s+import\s+([^\n#]+)/gm, (m) => ({ kind: 'import', name: m[1], line: L(m.index), detail: m[2].trim().slice(0, 80) }));
      run(/^[ \t]*import\s+([\w., ]+?)(?:\s+as\s+\w+)?\s*$/gm, (m) => ({ kind: 'import', name: m[1].trim(), line: L(m.index) }));
      break;
    case 'go': {
      run(/^import\s+(?:\w+\s+)?"([^"\n]+)"/gm, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      run(/^import\s*\(([^)]*)\)/gm, (m) => {
        const base = m.index;
        const lines = m[1].split('\n');
        let off = base + m[0].indexOf('(') + 1;
        for (const ln of lines) {
          const mm = /"([^"\n]+)"/.exec(ln);
          if (mm) out.push({ kind: 'import', name: mm[1], line: L(off) });
          off += ln.length + 1;
        }
        return null;
      });
      break;
    }
    case 'rust':
      run(/^[ \t]*(?:pub\s+)?use\s+([^;\n]+);/gm, (m) => ({ kind: 'import', name: m[1].trim(), line: L(m.index) }));
      run(/^[ \t]*(?:pub\s+)?mod\s+(\w+)\s*;/gm, (m) => ({ kind: 'import', name: 'mod ' + m[1], line: L(m.index) }));
      break;
    case 'java':
    case 'kotlin':
    case 'swift':
      run(/^[ \t]*import\s+(?:static\s+)?([\w.*]+)/gm, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      break;
    case 'csharp':
      run(/^[ \t]*using\s+(?:static\s+)?([\w.]+)\s*;/gm, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      break;
    case 'c':
    case 'cpp':
      run(/^[ \t]*#\s*include\s*([<"][^>"\n]+[>"])/gm, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      break;
    case 'php':
      run(/^[ \t]*use\s+([\w\\]+)(?:\s+as\s+\w+)?;/gm, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      run(/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"\n]+)['"]/g, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      break;
    case 'ruby':
      run(/^[ \t]*require(?:_relative)?\s+['"]([^'"\n]+)['"]/gm, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      break;
    case 'bash':
      run(/^[ \t]*(?:source|\.)\s+([^\s;#]+)/gm, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      break;
    case 'html':
      run(/<(?:script)[^>]*\ssrc=["']([^"']+)["']/gi, (m) => ({ kind: 'import', name: m[1], line: L(m.index), detail: 'script' }));
      run(/<link[^>]*\shref=["']([^"']+)["']/gi, (m) => ({ kind: 'import', name: m[1], line: L(m.index), detail: 'link' }));
      break;
    case 'css':
      run(/@import\s+(?:url\()?['"]?([^'")\s;]+)/g, (m) => ({ kind: 'import', name: m[1], line: L(m.index) }));
      break;
    default:
      break;
  }
}

function extractExports(lang: CodeLang, nc: string, starts: number[], out: OutlineItem[]) {
  const L = (idx: number) => lineOf(starts, idx);
  const run = (re: RegExp, f: (m: RegExpExecArray) => OutlineItem | null) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let g = 0;
    while ((m = re.exec(nc)) && g++ < 2000) {
      if (m[0].length === 0) re.lastIndex++;
      const it = f(m);
      if (it) out.push(it);
    }
  };
  if (lang === 'javascript' || lang === 'typescript') {
    run(/^[ \t]*export\s+(default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm, (m) => ({ kind: 'export', name: m[3], line: L(m.index), detail: (m[1] ? 'default ' : '') + m[2] }));
    run(/^[ \t]*export\s+default\s+(?!function|class|async)([A-Za-z_$][\w$.]*)/gm, (m) => ({ kind: 'export', name: m[1], line: L(m.index), detail: 'default' }));
    run(/^[ \t]*export\s*\{([^}]*)\}/gm, (m) => ({ kind: 'export', name: m[1].trim().replace(/\s+/g, ' ').slice(0, 100), line: L(m.index) }));
    run(/\bmodule\.exports(?:\.(\w+))?\s*=/g, (m) => ({ kind: 'export', name: m[1] ? 'module.exports.' + m[1] : 'module.exports', line: L(m.index) }));
  } else if (lang === 'python') {
    run(/^__all__\s*=\s*[[(]([^\])]*)[\])]/gm, (m) => ({ kind: 'export', name: m[1].replace(/['"\s]/g, '').slice(0, 100), line: L(m.index), detail: '__all__' }));
  } else if (lang === 'rust') {
    run(/^[ \t]*pub(?:\([^)]*\))?\s+(?:async\s+)?(fn|struct|enum|trait|mod|const|static|type)\s+(\w+)/gm, (m) => ({ kind: 'export', name: m[2], line: L(m.index), detail: 'pub ' + m[1] }));
  } else if (lang === 'ruby') {
    run(/^[ \t]*module_function\b/gm, (m) => ({ kind: 'export', name: 'module_function', line: L(m.index) }));
  }
}

const ROUTE_RES: { re: RegExp; f: (m: RegExpExecArray) => { method: string; path: string } }[] = [
  { re: /\b(?:app|router|server|api|r|e|g|route|fastify|mux)\.(get|post|put|delete|patch|options|head|all|use)\s*\(\s*['"`]([^'"`\n]*)['"`]/gi, f: (m) => ({ method: m[1].toUpperCase(), path: m[2] }) },
  { re: /@\w+\.(route|get|post|put|delete|patch)\(\s*['"]([^'"\n]*)['"]/g, f: (m) => ({ method: m[1] === 'route' ? 'ROUTE' : m[1].toUpperCase(), path: m[2] }) },
  { re: /@(Get|Post|Put|Delete|Patch|Request)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"'\n]*)["']/g, f: (m) => ({ method: m[1].toUpperCase(), path: m[2] }) },
  { re: /\bHandleFunc\(\s*"([^"\n]*)"/g, f: (m) => ({ method: 'HANDLE', path: m[1] }) },
  { re: /\bRoute::(get|post|put|delete|patch|any|resource)\(\s*['"]([^'"\n]*)['"]/g, f: (m) => ({ method: m[1].toUpperCase(), path: m[2] }) },
  { re: /\[Http(Get|Post|Put|Delete|Patch)(?:\(\s*"([^"\n]*)"\s*\))?\]/g, f: (m) => ({ method: m[1].toUpperCase(), path: m[2] ?? '' }) },
  { re: /^[ \t]*(get|post|put|delete|patch)\s+['"](\/[^'"\n]*)['"]/gm, f: (m) => ({ method: m[1].toUpperCase(), path: m[2] }) },
];

function extractRoutes(nc: string, starts: number[], out: OutlineItem[]) {
  for (const { re, f } of ROUTE_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let g = 0;
    while ((m = re.exec(nc)) && g++ < 500) {
      const r = f(m);
      out.push({ kind: 'route', name: `${r.method} ${r.path}`.trim(), line: lineOf(starts, m.index) });
    }
  }
}

function extractSql(nc: string, starts: number[], out: OutlineItem[]) {
  const id = '([\\w."`\\[\\]]+)';
  const defs: [RegExp, (m: RegExpExecArray) => { name: string; detail: string }][] = [
    [new RegExp('\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TEMP(?:ORARY)?\\s+)?(?:UNIQUE\\s+)?(TABLE|VIEW|INDEX|FUNCTION|PROCEDURE|TRIGGER|DATABASE|SCHEMA)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?' + id, 'gi'), (m) => ({ name: m[2], detail: 'CREATE ' + m[1].toUpperCase() })],
    [new RegExp('\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?' + id, 'gi'), (m) => ({ name: m[1], detail: 'ALTER TABLE' })],
    [new RegExp('\\bDROP\\s+(TABLE|VIEW|INDEX|DATABASE)\\s+(?:IF\\s+EXISTS\\s+)?' + id, 'gi'), (m) => ({ name: m[2], detail: 'DROP ' + m[1].toUpperCase() })],
    [new RegExp('\\bINSERT\\s+INTO\\s+' + id, 'gi'), (m) => ({ name: m[1], detail: 'INSERT' })],
    [new RegExp('\\bUPDATE\\s+' + id + '\\s+SET\\b', 'gi'), (m) => ({ name: m[1], detail: 'UPDATE' })],
    [new RegExp('\\bDELETE\\s+FROM\\s+' + id, 'gi'), (m) => ({ name: m[1], detail: 'DELETE' })],
    [new RegExp('\\bSELECT\\b[^;]{0,2000}?\\bFROM\\s+' + id, 'gi'), (m) => ({ name: m[1], detail: 'SELECT' })],
  ];
  for (const [re, f] of defs) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let g = 0;
    while ((m = re.exec(nc)) && g++ < 500) {
      const r = f(m);
      out.push({ kind: 'sql', name: r.name.replace(/[`"[\]]/g, ''), line: lineOf(starts, m.index), detail: r.detail });
    }
  }
}

function extractConstants(lang: CodeLang, nc: string, starts: number[], out: OutlineItem[]) {
  const L = (idx: number) => lineOf(starts, idx);
  const run = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let g = 0;
    while ((m = re.exec(nc)) && g++ < 500) out.push({ kind: 'constant', name: m[1], line: L(m.index), detail: (m[2] ?? '').trim().slice(0, 40) });
  };
  switch (lang) {
    case 'javascript':
    case 'typescript':
      run(/^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::[^=\n]+)?=\s*([^\n]*)/gm);
      break;
    case 'python':
    case 'ruby':
      run(/^([A-Z][A-Z0-9_]{2,})\s*=\s*([^\n]*)/gm);
      break;
    case 'go':
      run(/^const\s+(\w+)\s*(?:\w+\s*)?=\s*([^\n]*)/gm);
      break;
    case 'rust':
      run(/^(?:pub\s+)?(?:const|static)\s+(\w+)\s*:\s*([^=\n]+)=/gm);
      break;
    case 'java':
    case 'csharp':
    case 'kotlin':
      run(/^[ \t]*(?:(?:public|private|protected|internal)\s+)?(?:static\s+)?(?:final\s+|readonly\s+)?(?:const\s+)?(?:val\s+)?(?:[\w<>[\]]+\s+)?([A-Z][A-Z0-9_]{2,})\s*=\s*([^\n;]*)/gm);
      break;
    case 'c':
    case 'cpp':
      run(/^[ \t]*#\s*define\s+(\w+)\s+([^\n]*)/gm);
      break;
    case 'php':
      run(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;\n]*)/g);
      run(/\bdefine\(\s*['"](\w+)['"]\s*,\s*([^)\n]*)/g);
      break;
    case 'bash':
      run(/^(?:export\s+)?([A-Z][A-Z0-9_]{2,})=([^\n]*)/gm);
      break;
    default:
      break;
  }
}

function extractClasses(lang: CodeLang, blanked: string, s: Scanned, lines: string[]): { name: string; line: number; endLine: number; kind: string }[] {
  const out: { name: string; line: number; endLine: number; kind: string }[] = [];
  const re =
    lang === 'go'
      ? /^type\s+(\w+)\s+(struct|interface)\b/gm
      : lang === 'rust'
        ? /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|impl)\s+(?:<[^>]*>\s*)?(\w+)/gm
        : lang === 'python' || lang === 'ruby'
          ? /^[ \t]*(class|module)\s+(\w+)/gm
          : lang === 'swift'
            ? /^[ \t]*(?:(?:public|private|internal|open|final|fileprivate)\s+)*(class|struct|enum|protocol|extension|actor)\s+(\w+)/gm
            : /^[ \t]*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|open|data|inner|export|default|declare)\s+)*(class|interface|enum|struct|record|object|trait|namespace)\s+(\w+)/gm;
  if (!['javascript', 'typescript', 'python', 'go', 'rust', 'java', 'csharp', 'cpp', 'php', 'ruby', 'kotlin', 'swift'].includes(lang)) return out;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let g = 0;
  while ((m = re.exec(blanked)) && g++ < 1000) {
    const [kind, name] = lang === 'go' ? [m[2], m[1]] : [m[1], m[2]];
    const startLine = lineOf(s.lineStarts, m.index);
    let endLine = startLine;
    if (INDENT_LANGS.has(lang)) {
      const base = indentOf(lines[startLine - 1] ?? '');
      for (let k = startLine; k < lines.length; k++) {
        if (!lines[k].trim()) continue;
        const ind = indentOf(lines[k]);
        if (ind > base) endLine = k + 1;
        else {
          if (lang === 'ruby' && ind === base && /^\s*end\b/.test(lines[k])) endLine = k + 1;
          break;
        }
      }
    } else {
      const lim = Math.min(blanked.length, m.index + m[0].length + 400);
      let brace = -1;
      let pd = 0;
      for (let k = m.index + m[0].length; k < lim; k++) {
        const ch = blanked[k];
        if (ch === '(') pd++;
        else if (ch === ')') pd--;
        if (ch === '{') {
          brace = k;
          break;
        }
        if (ch === ';') break;
        if (ch === '\n' && pd <= 0) {
          const nxt = /^\s*(\{|:|,|extends\b|implements\b|where\b|<|where)/.exec(blanked.slice(k + 1, k + 40));
          if (!nxt) break;
        }
      }
      if (brace >= 0) {
        const close = matchBalanced(blanked, brace, '{', '}', 400000);
        endLine = lineOf(s.lineStarts, close < 0 ? blanked.length - 1 : close);
      }
    }
    out.push({ name, line: startLine, endLine, kind });
  }
  return out;
}

const SECRET_RES: { re: RegExp; label: string }[] = [
  { re: /\b(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|token|private[_-]?key|client[_-]?secret)\w*["']?\s*[:=]\s*["']([^"'\s$<{][^"'\s]{5,})["']/gi, label: 'khóa/mật khẩu gán trực tiếp' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS Access Key' },
  { re: /\bghp_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, label: 'GitHub token' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, label: 'khóa riêng tư (private key)' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, label: 'khóa dạng sk-…' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: 'Google API key' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, label: 'Slack token' },
];

function maskSecret(s: string): string {
  return s.length <= 6 ? '***' : s.slice(0, 3) + '***' + s.slice(-1);
}

const PLACEHOLDER_RE = /^(?:xxx+|\*+|changeme|change_me|your[_-]?\w*|<.*>|example|placeholder|todo|test|password|secret|dummy|\$\{.*\}|%s)$/i;

function analyzeSmells(lang: CodeLang, s: Scanned, rawLines: string[], fns: FunctionInfo[], push: (sm: CodeSmell) => void, maxNesting: number) {
  const bl = s.blanked.split('\n');
  const nc = s.noComments.split('\n');
  const codeLang = !['json', 'yaml', 'html', 'css'].includes(lang);
  // 1. hàm dài / nhiều tham số / phức tạp
  for (const f of fns) {
    if (f.lines > 100) push({ id: 'long-function', severity: 'danger', line: f.line, title: `Hàm quá dài: ${f.fullName} (${f.lines} dòng)`, explain: 'Hàm hơn 100 dòng thường làm quá nhiều việc, khó đọc và khó kiểm thử. Hãy tách thành các hàm nhỏ, mỗi hàm một nhiệm vụ.' });
    else if (f.lines > 50) push({ id: 'long-function', severity: 'warn', line: f.line, title: `Hàm dài: ${f.fullName} (${f.lines} dòng)`, explain: 'Hàm trên 50 dòng nên được xem xét tách nhỏ để dễ đọc và dễ kiểm thử hơn.' });
    const pc = f.params.filter((p) => !/^(?:self|cls|this)\b/.test(p)).length;
    if (pc > 5) push({ id: 'long-params', severity: pc > 8 ? 'danger' : 'warn', line: f.line, title: `Quá nhiều tham số: ${f.fullName} (${pc})`, explain: 'Danh sách tham số dài dễ gọi sai thứ tự. Cân nhắc gom thành một đối tượng/struct cấu hình hoặc tách hàm.' });
    if (f.complexity > 20) push({ id: 'complexity', severity: 'danger', line: f.line, title: `Độ phức tạp rất cao: ${f.fullName} (${f.complexity})`, explain: 'Rất nhiều nhánh rẽ (if/vòng lặp/&&/||/case). Hàm khó kiểm thử đủ mọi đường chạy; nên tách logic và dùng early-return.' });
    else if (f.complexity > 10) push({ id: 'complexity', severity: 'warn', line: f.line, title: `Độ phức tạp cao: ${f.fullName} (${f.complexity})`, explain: 'Độ phức tạp chu trình trên 10 là ngưỡng thường được khuyến nghị tối đa. Hãy giảm số nhánh hoặc tách hàm.' });
    if (f.maxDepth >= 5) push({ id: 'deep-nesting', severity: 'warn', line: f.line, title: `Lồng sâu ${f.maxDepth} cấp trong ${f.fullName}`, explain: 'Khối lồng nhau quá sâu làm mã khó theo dõi. Dùng early-return/guard clause hoặc tách hàm con để giảm độ sâu.' });
  }
  if (!fns.length && maxNesting >= 6) push({ id: 'deep-nesting', severity: 'warn', title: `Lồng sâu ${maxNesting} cấp`, explain: 'Khối lồng nhau quá sâu làm mã khó theo dõi. Hãy giảm độ sâu bằng early-return hoặc tách hàm.' });

  if (!codeLang) return;

  // 2. chuỗi lặp
  const freq = new Map<string, number[]>();
  for (const st of s.strings) {
    if (st.value.length < 8 || /^[\s\\nrt/.#-]+$/.test(st.value)) continue;
    const line = rawLines[st.line] ?? '';
    if (/^\s*(?:import|from|using|use|require|#include)\b/.test(line)) continue;
    const arr = freq.get(st.value) ?? [];
    arr.push(st.line + 1);
    freq.set(st.value, arr);
  }
  const dups = Array.from(freq.entries()).filter(([, l]) => l.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 4);
  for (const [v, ls] of dups) push({ id: 'dup-string', severity: 'info', line: ls[0], title: `Chuỗi lặp ${ls.length} lần: "${v.length > 40 ? v.slice(0, 40) + '…' : v}"`, explain: 'Cùng một chuỗi xuất hiện nhiều lần dễ gây sai lệch khi sửa. Hãy gom vào một hằng số được đặt tên.', detail: 'Dòng ' + ls.slice(0, 8).join(', ') });

  // 3. số "ma thuật"
  if (lang !== 'sql' && lang !== 'bash') {
    const magic: { n: string; line: number }[] = [];
    bl.forEach((l, i) => {
      if (/^\s*(?:export\s+)?(?:const|final|static|#\s*define|val|let|pub\s+const|[A-Z][A-Z0-9_]+\s*=)/.test(l) && /[A-Z_]{3,}|const|final/.test(l)) return;
      if (/^\s*(?:import|from|#include|package|using)\b/.test(l)) return;
      const re = /(?<![\w.$#-])(\d+(?:\.\d+)?)(?![\w.])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(l))) {
        const v = m[1];
        if (['0', '1', '2', '-1', '10', '100', '0.5', '1000', '3', '4'].includes(v)) continue;
        if (/\[\s*\d+\s*\]/.test(l.slice(Math.max(0, m.index - 1), m.index + v.length + 1))) continue;
        magic.push({ n: v, line: i + 1 });
      }
    });
    if (magic.length >= 3) push({ id: 'magic-numbers', severity: 'info', line: magic[0].line, title: `${magic.length} số "ma thuật" (vd. ${Array.from(new Set(magic.map((x) => x.n))).slice(0, 4).join(', ')})`, explain: 'Số xuất hiện trực tiếp trong logic khó hiểu ý nghĩa. Hãy đặt tên bằng hằng số (vd. MAX_RETRY = 5).', detail: 'Dòng ' + magic.slice(0, 8).map((x) => x.line).join(', ') });
  }

  // 4. catch rỗng
  const emptyCatch: [RegExp, string][] = [
    [/\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g, 'catch'],
    [/\bexcept[^:\n]*:\s*\n\s*pass\b/g, 'except'],
    [/\brescue(?:\s+[\w:, =>]+)?\s*\n\s*end\b/g, 'rescue'],
    [/\.catch\(\s*\(?\s*\w*\s*\)?\s*=>\s*\{\s*\}\s*\)/g, '.catch'],
  ];
  for (const [re, name] of emptyCatch) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let g = 0;
    while ((m = re.exec(s.blanked)) && g++ < 20) {
      push({ id: 'empty-catch', severity: 'warn', line: lineOf(s.lineStarts, m.index), title: `Khối ${name} rỗng (nuốt lỗi)`, explain: 'Bắt lỗi mà không xử lý/ghi log sẽ che giấu sự cố, khiến việc gỡ lỗi rất khó. Hãy ghi log, xử lý hoặc ném lại lỗi.' });
    }
  }

  // 5. eval
  const evalRe: Partial<Record<CodeLang, RegExp>> = {
    javascript: /(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(/g, typescript: /(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(/g, python: /(?<![\w.])(?:eval|exec)\s*\(/g, php: /(?<![\w$>:])eval\s*\(/g, ruby: /(?<![\w.])(?:eval|instance_eval|class_eval)\b/g, bash: /^\s*eval\s/gm,
  };
  const er = evalRe[lang];
  if (er) {
    er.lastIndex = 0;
    let m: RegExpExecArray | null;
    let g = 0;
    while ((m = er.exec(s.blanked)) && g++ < 10) push({ id: 'eval', severity: 'danger', line: lineOf(s.lineStarts, m.index), title: 'Dùng eval/exec', explain: 'Chạy chuỗi như mã lệnh là rủi ro bảo mật lớn (chèn mã) và làm khó tối ưu. Hãy dùng cấu trúc dữ liệu (JSON.parse, ánh xạ hàm…) thay thế.' });
  }

  // 6. khóa bí mật
  for (const { re, label } of SECRET_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let g = 0;
    while ((m = re.exec(s.noComments)) && g++ < 10) {
      const val = m[1] ?? m[0];
      if (PLACEHOLDER_RE.test(val)) continue;
      push({ id: 'secret', severity: 'danger', line: lineOf(s.lineStarts, m.index), title: `Có thể lộ bí mật: ${label}`, explain: 'Khóa/mật khẩu viết cứng trong mã sẽ bị lộ khi chia sẻ hoặc đẩy lên Git. Hãy đưa vào biến môi trường/kho bí mật và thu hồi khóa nếu đã công khai.', detail: maskSecret(val) });
    }
  }

  // 7. nối chuỗi SQL
  nc.forEach((l, i) => {
    const hasSql = /\b(?:SELECT\s[\s\S]*\sFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(l);
    if (!hasSql) return;
    const concat = /["'`]\s*(?:\+|\.)\s*[\w$(]/.test(l) || /[\w$)]\s*(?:\+|\.)\s*["'`]/.test(l);
    const tmpl = /\$\{[^}]+\}/.test(l) && l.includes('`');
    const fstr = (lang === 'python' && /\bf["']/.test(l) && /\{[^}]+\}/.test(l)) || (lang === 'python' && /["']\s*%\s*[\w(]/.test(l)) || (lang === 'python' && /\.format\(/.test(l));
    const csInterp = (lang === 'csharp' || lang === 'kotlin' || lang === 'swift') && /\$"|\\\(|\$\{?\w/.test(l);
    if ((concat && lang !== 'sql' && lang !== 'bash' && lang !== 'ruby') || tmpl || fstr || csInterp || (lang === 'ruby' && /#\{[^}]+\}/.test(l))) {
      push({ id: 'sql-concat', severity: 'danger', line: i + 1, title: 'Ghép chuỗi vào câu SQL', explain: 'Nối dữ liệu người dùng vào câu SQL gây lỗ hổng SQL injection. Hãy dùng truy vấn tham số hoá (prepared statement, ?, $1, :name).' });
    }
  });
  if (lang === 'sql') {
    s.blanked.split(';').forEach((st) => {
      if (/^\s*(?:UPDATE|DELETE)\b/i.test(st) && !/\bWHERE\b/i.test(st)) {
        const idx = s.blanked.indexOf(st);
        push({ id: 'sql-no-where', severity: 'danger', line: lineOf(s.lineStarts, Math.max(0, idx) + (st.length - st.trimStart().length)), title: `${/^\s*UPDATE/i.test(st) ? 'UPDATE' : 'DELETE'} không có WHERE`, explain: 'Câu lệnh này tác động lên toàn bộ bảng. Hầu như luôn cần điều kiện WHERE để tránh mất/ghi đè dữ liệu.' });
      }
    });
    bl.forEach((l, i) => {
      if (/\bSELECT\s+\*/i.test(l)) push({ id: 'select-star', severity: 'info', line: i + 1, title: 'SELECT *', explain: 'Lấy mọi cột gây tốn băng thông và dễ vỡ khi bảng đổi cấu trúc. Hãy liệt kê các cột cần dùng.' });
    });
  }

  // 8. == vs ===
  if (lang === 'javascript' || lang === 'typescript') {
    const hits: number[] = [];
    bl.forEach((l, i) => {
      const t = l.replace(/===|!==|=>|<=|>=/g, '  ');
      if (/(?<![=!<>])==(?!=)|!=(?!=)/.test(t) && !/(?:==|!=)\s*null\b/.test(t)) hits.push(i + 1);
    });
    if (hits.length) push({ id: 'loose-eq', severity: 'warn', line: hits[0], title: `Dùng == / != (${hits.length} chỗ)`, explain: 'So sánh lỏng (==) tự ép kiểu nên cho kết quả bất ngờ (0 == "" là true). Hãy dùng === và !== trừ khi cố ý so sánh với null.', detail: 'Dòng ' + hits.slice(0, 8).join(', ') });
    const vars = bl.map((l, i) => (/^\s*var\s/.test(l) ? i + 1 : 0)).filter(Boolean);
    if (vars.length) push({ id: 'var', severity: 'info', line: vars[0], title: `Dùng var (${vars.length} chỗ)`, explain: 'var có phạm vi hàm và bị hoisting, dễ gây lỗi. Hãy dùng const (mặc định) hoặc let.', detail: 'Dòng ' + vars.slice(0, 8).join(', ') });
    const logs = bl.map((l, i) => (/\bconsole\.(?:log|debug)\(/.test(l) ? i + 1 : 0)).filter(Boolean);
    if (logs.length >= 3) push({ id: 'console', severity: 'info', line: logs[0], title: `${logs.length} lệnh console.log`, explain: 'Log gỡ lỗi nên được dọn trước khi triển khai hoặc thay bằng bộ ghi log có cấp độ.', detail: 'Dòng ' + logs.slice(0, 8).join(', ') });
  }
  if (lang === 'typescript') {
    const anys = bl.map((l, i) => (/:\s*any\b|\bas\s+any\b|<any>/.test(l) ? i + 1 : 0)).filter(Boolean);
    if (anys.length >= 2) push({ id: 'ts-any', severity: 'info', line: anys[0], title: `Dùng any (${anys.length} chỗ)`, explain: 'any tắt kiểm tra kiểu của TypeScript. Dùng unknown + thu hẹp kiểu hoặc khai báo kiểu cụ thể.', detail: 'Dòng ' + anys.slice(0, 8).join(', ') });
  }

  // 9. tham số mặc định có thể thay đổi (Python)
  if (lang === 'python') {
    for (const f of fns) {
      for (const p of f.params) {
        if (/=\s*(?:\[\s*\]|\{\s*\}|set\(\s*\)|dict\(\s*\)|list\(\s*\))\s*$/.test(p)) {
          push({ id: 'mutable-default', severity: 'warn', line: f.line, title: `Tham số mặc định có thể thay đổi: ${f.name}(${p.trim()})`, explain: 'Giá trị mặc định như [] hoặc {} chỉ được tạo một lần và dùng chung giữa mọi lần gọi hàm. Hãy dùng None rồi khởi tạo trong thân hàm.' });
        }
      }
    }
    bl.forEach((l, i) => {
      if (/^\s*except\s*:/.test(l)) push({ id: 'bare-except', severity: 'warn', line: i + 1, title: 'except trần', explain: 'except: bắt cả KeyboardInterrupt/SystemExit và che giấu lỗi. Hãy bắt kiểu lỗi cụ thể (except ValueError).' });
    });
  }

  // 10. Go: bỏ qua lỗi
  if (lang === 'go') {
    bl.forEach((l, i) => {
      if (/(?:^|[\s,])_\s*(?:,\s*\w+\s*)?:?=\s*[\w.]+\(/.test(l) || /\b\w+\s*,\s*_\s*:?=\s*[\w.]+\(/.test(l)) {
        if (!/for\s+.*range/.test(l)) push({ id: 'go-ignored-err', severity: 'warn', line: i + 1, title: 'Bỏ qua giá trị trả về (có thể là error)', explain: 'Gán kết quả cho _ có thể làm mất lỗi. Trong Go nên kiểm tra if err != nil và xử lý/trả lỗi lên trên.' });
      }
      if (/\berr\b\s*:?=\s*[\w.]+\(/.test(l) || /,\s*err\s*:?=/.test(l)) {
        const next = bl.slice(i + 1, i + 4).join('\n');
        if (!/\berr\b/.test(next)) push({ id: 'go-unchecked-err', severity: 'warn', line: i + 1, title: 'Biến err không được kiểm tra ngay sau đó', explain: 'Sau khi gọi hàm có thể lỗi, cần kiểm tra if err != nil ngay. Không kiểm tra sẽ dẫn tới hành vi sai thầm lặng.' });
      }
    });
  }
  if (lang === 'rust') {
    const unw = bl.map((l, i) => (/\.unwrap\(\)|\.expect\(/.test(l) ? i + 1 : 0)).filter(Boolean);
    if (unw.length >= 2) push({ id: 'rust-unwrap', severity: 'info', line: unw[0], title: `unwrap()/expect() (${unw.length} chỗ)`, explain: 'unwrap làm chương trình panic khi gặp None/Err. Trong mã sản phẩm hãy dùng ? hoặc match để xử lý lỗi.', detail: 'Dòng ' + unw.slice(0, 8).join(', ') });
  }
  if (lang === 'php') {
    const md = bl.map((l, i) => (/\bmysql_query\(|\$_(?:GET|POST|REQUEST)\[[^\]]+\]/.test(l) && /\b(?:query|echo)\b/.test(l) ? i + 1 : 0)).filter(Boolean);
    if (md.length) push({ id: 'php-input', severity: 'warn', line: md[0], title: 'Dùng dữ liệu $_GET/$_POST trực tiếp', explain: 'Dữ liệu đầu vào chưa kiểm tra/thoát ký tự dễ dẫn tới XSS/SQL injection. Hãy xác thực và dùng truy vấn tham số hoá.' });
  }
  if (lang === 'bash') {
    if (!/^\s*set\s+-[a-z]*e/m.test(s.blanked) && s.blanked.split('\n').length > 15) push({ id: 'bash-no-set-e', severity: 'info', title: 'Chưa có set -e / set -euo pipefail', explain: 'Không có set -e thì script vẫn chạy tiếp khi một lệnh lỗi. Với script quan trọng hãy thêm set -euo pipefail.' });
    const unq = bl.map((l, i) => (/\brm\s+-[a-z]*r[a-z]*f?\s+\$\w+(?!["}])/.test(l) ? i + 1 : 0)).filter(Boolean);
    if (unq.length) push({ id: 'bash-rm', severity: 'danger', line: unq[0], title: 'rm -rf với biến không đặt trong ngoặc kép', explain: 'Nếu biến rỗng hoặc chứa dấu cách, lệnh có thể xoá nhầm dữ liệu. Luôn dùng "$VAR" và kiểm tra biến không rỗng.' });
  }
  if (lang === 'java' || lang === 'csharp' || lang === 'kotlin') {
    const gen = bl.map((l, i) => (/\bcatch\s*\(\s*(?:final\s+)?(?:Exception|Throwable|System\.Exception)\s+\w+\s*\)/.test(l) ? i + 1 : 0)).filter(Boolean);
    if (gen.length) push({ id: 'catch-generic', severity: 'info', line: gen[0], title: 'Bắt Exception tổng quát', explain: 'Bắt Exception/Throwable gom mọi loại lỗi lại. Hãy bắt các ngoại lệ cụ thể mà bạn thực sự xử lý được.' });
  }
}

/** Phân tích tĩnh mã nguồn. Không bao giờ ném lỗi. */
export function analyzeCode(codeIn: string, forceLang?: CodeLang | ''): CodeAnalysis {
  const truncated = codeIn.length > MAX_ANALYZE;
  const code = (truncated ? codeIn.slice(0, MAX_ANALYZE) : codeIn).replace(/\r\n?/g, '\n');
  const guess = forceLang ? ({ lang: forceLang, confidence: 1, scores: [] } as LangGuess) : detectCodeLanguage(code);
  const lang = guess.lang;
  const empty: CodeAnalysis = {
    lang, langLabel: CODE_LANG_LABELS[lang], langConfidence: guess.confidence, detected: !forceLang && lang !== 'unknown', lines: { total: 0, code: 0, comment: 0, blank: 0 }, commentRatio: 0, outline: [], functions: [], classes: [], maxNesting: 0, totalComplexity: 0, smells: [], truncated,
  };
  if (!code.trim()) return empty;
  try {
    const sc = scanCode(code, lang);
    const rawLines = code.split('\n');
    const total = rawLines.length;
    let blank = 0;
    let codeL = 0;
    let comm = 0;
    for (let i = 0; i < total; i++) {
      if (!rawLines[i].trim()) blank++;
      else if (sc.hasCode[i]) codeL++;
      else if (sc.hasComment[i]) comm++;
      else codeL++;
    }
    const outline: OutlineItem[] = [];
    extractImports(lang, sc.noComments, sc.lineStarts, outline);
    extractExports(lang, sc.noComments, sc.lineStarts, outline);

    // lớp
    const classRows = extractClasses(lang, sc.blanked, sc, rawLines);
    for (const c of classRows) outline.push({ kind: 'class', name: c.name, line: c.line, detail: c.kind });

    // hàm
    const fns: FunctionInfo[] = [];
    if (lang !== 'sql' && lang !== 'json' && lang !== 'yaml' && lang !== 'html' && lang !== 'css') {
      const headers = findHeaders(lang, sc.blanked).sort((a, b) => a.offset - b.offset);
      const seenLine = new Set<number>();
      for (const h of headers) {
        const hl = lineOf(sc.lineStarts, h.offset);
        if (seenLine.has(hl)) continue;
        let info = findBodyExtent(lang, sc, h, rawLines);
        if (!info) continue;
        // arrow: phải có dấu =>
        if (h.kind === 'arrow' && h.arrowAt === 0) {
          const after = sc.blanked.slice(h.open, h.open + 2000);
          const close = matchBalanced(after, 0, '(', ')');
          const rest = close < 0 ? '' : after.slice(close + 1, close + 200);
          if (!/^\s*(?::[^=\n{]+)?=>/.test(rest)) continue;
          // thân sau =>
          const arrowIdx = h.open + close + 1 + rest.indexOf('=>');
          const refined = findBodyExtent(lang, sc, { ...h, open: h.open }, rawLines);
          if (refined && sc.blanked.slice(h.open, arrowIdx).length >= 0) {
            // findBodyExtent đã duyệt từ sau ')' ; bảo đảm thân bắt đầu sau '=>'
            info = refined;
          }
        }
        seenLine.add(hl);
        const body = sc.blanked.slice(info.ext.bodyStart, info.ext.bodyEnd);
        const paramsList = splitTopLevel(info.params.replace(/\s+/g, ' '));
        const indentUnit = INDENT_LANGS.has(lang) ? 0 : 0;
        const cls = classRows
          .filter((c) => c.line < hl && c.endLine >= hl && c.kind !== 'namespace' && c.kind !== 'module')
          .sort((a, b) => b.line - a.line)[0];
        const lines = Math.max(1, info.ext.endLine - info.ext.startLine + 1);
        fns.push({
          name: h.name,
          fullName: cls && !(lang === 'go') ? `${cls.name}.${h.name}` : h.name,
          line: info.ext.startLine,
          endLine: info.ext.endLine,
          lines,
          params: paramsList,
          paramCount: paramsList.length,
          complexity: cyclomaticComplexity(body, lang),
          maxDepth: maxNestingDepth(body, lang, indentUnit),
          kind: h.kind === 'method' || cls ? 'method' : h.kind,
          className: cls?.name,
        });
      }
    }
    for (const f of fns) outline.push({ kind: 'function', name: f.fullName, line: f.line, detail: `(${f.params.map((p) => p.replace(/\s*=.*$/, '').slice(0, 24)).join(', ')})` });
    extractConstants(lang, sc.noComments, sc.lineStarts, outline);
    if (!['json', 'yaml', 'css', 'html', 'sql', 'bash', 'c'].includes(lang)) extractRoutes(sc.noComments, sc.lineStarts, outline);
    if (lang === 'sql') extractSql(sc.noComments, sc.lineStarts, outline);
    // TODO/FIXME
    rawLines.forEach((l, i) => {
      const m = /(?:\/\/|#|--|\/\*|\*|<!--|;)\s*(TODO|FIXME|HACK|XXX|BUG)\b[:\s-]*(.*)$/i.exec(l);
      if (m && sc.hasComment[i]) outline.push({ kind: 'todo', name: m[1].toUpperCase(), line: i + 1, detail: m[2].replace(/\*\/|-->/g, '').trim().slice(0, 100) });
    });
    // cấu trúc đặc thù
    if (lang === 'json') {
      try {
        const v = JSON.parse(code);
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).slice(0, 40).forEach((k) => outline.push({ kind: 'section', name: k, line: 1, detail: Array.isArray(v[k]) ? `mảng (${v[k].length})` : typeof v[k] }));
        else if (Array.isArray(v)) outline.push({ kind: 'section', name: '(mảng gốc)', line: 1, detail: `${v.length} phần tử` });
      } catch {
        /* bỏ qua */
      }
    } else if (lang === 'yaml') {
      rawLines.forEach((l, i) => {
        const m = /^([\w.-]+):(?:\s|$)/.exec(l);
        if (m) outline.push({ kind: 'section', name: m[1], line: i + 1 });
      });
    } else if (lang === 'html') {
      rawLines.forEach((l, i) => {
        const re = /<(title|h[1-6]|form|nav|header|footer|main|section|table)\b([^>]*)>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(l))) {
          const id = /\bid=["']([^"']+)/.exec(m[2]);
          outline.push({ kind: 'section', name: `<${m[1].toLowerCase()}>`, line: i + 1, detail: id ? '#' + id[1] : undefined });
        }
      });
    } else if (lang === 'css') {
      const re = /(^|\})\s*([^{}@\s][^{}]*)\{/g;
      let m: RegExpExecArray | null;
      let g = 0;
      while ((m = re.exec(sc.blanked)) && g++ < 80) outline.push({ kind: 'section', name: m[2].trim().replace(/\s+/g, ' ').slice(0, 60), line: lineOf(sc.lineStarts, m.index + m[1].length) });
      const mm = /@(media|keyframes|font-face)[^{]*/g;
      while ((m = mm.exec(sc.blanked)) && g++ < 120) outline.push({ kind: 'section', name: m[0].trim().replace(/\s+/g, ' ').slice(0, 60), line: lineOf(sc.lineStarts, m.index) });
    }
    outline.sort((a, b) => a.line - b.line);

    const maxNesting = lang === 'json' || lang === 'yaml' || lang === 'html' ? 0 : maxNestingDepth(sc.blanked, lang);
    const smells: CodeSmell[] = [];
    const seen = new Set<string>();
    analyzeSmells(lang, sc, rawLines, fns, (sm) => pushUniq(smells, sm, (x) => `${x.id}:${x.line ?? 0}:${x.title}`, seen), maxNesting);
    const sevRank: Record<Severity, number> = { danger: 0, warn: 1, info: 2 };
    smells.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || (a.line ?? 0) - (b.line ?? 0));

    return {
      lang,
      langLabel: CODE_LANG_LABELS[lang],
      langConfidence: guess.confidence,
      detected: !forceLang && lang !== 'unknown',
      lines: { total, code: codeL, comment: comm, blank },
      commentRatio: codeL + comm ? comm / (codeL + comm) : 0,
      outline,
      functions: fns,
      classes: classRows.map((c) => ({ name: c.name, line: c.line, endLine: c.endLine })),
      maxNesting,
      totalComplexity: fns.reduce((a, f) => a + f.complexity, 0),
      smells: smells.slice(0, 80),
      truncated,
    };
  } catch {
    return empty;
  }
}

/** Gợi ý ngôn ngữ cho Gemini/AI từ nhãn. */
export function codeLangForAi(lang: CodeLang): string {
  return lang === 'unknown' ? '' : CODE_LANG_LABELS[lang];
}
