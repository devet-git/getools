/**
 * Bộ ƯỚC TÍNH số token cho LLM (không dùng từ điển BPE thật, chạy hoàn toàn client-side).
 *
 * ===== Cách hoạt động =====
 * 1. Cắt văn bản thành các "pre-token" bằng một regex xấp xỉ bước pre-tokenization của BPE:
 *    URL, chuỗi base64/hex dài, emoji, xuống dòng + thụt lề, từ (có dấu cách đứng trước, tách
 *    CamelCase / snake_case), nhóm chữ số <= 3, chuỗi dấu câu, chuỗi khoảng trắng.
 * 2. Mỗi pre-token được ước tính số token từ độ dài và hệ chữ viết, theo hằng số của từng "họ tokenizer".
 * 3. Cộng dồn (số thực) rồi trả về min / likely / max (biên sai số +-10..15% cho văn bản thường,
 *    rộng hơn cho thành phần bất định như CJK, emoji, base64, tokenizer đóng của Claude/Gemini).
 *
 * ===== Giả định hiệu chỉnh (CALIBRATION ASSUMPTIONS) =====
 * - Tiếng Anh thông thường: ~4 ký tự / token (kể cả dấu cách) với họ o200k/cl100k (số liệu công bố của OpenAI:
 *   "1 token ~ 4 ký tự tiếng Anh, 100 token ~ 75 từ"). Từ ngắn (<= 5 chữ cái) luôn = 1 token; từ dài
 *   tốn len / cpt token (cpt = "chữ cái mỗi token" của họ đó).
 * - Claude: tokenizer riêng, nhìn chung tạo nhiều token hơn GPT-4o khoảng 10-25% trên tiếng Anh, nhiều hơn nữa
 *   trên mã nguồn / ngôn ngữ phi Latin. Hằng số ở đây là ước lượng THẬN TRỌNG, không phải số đo chính thức.
 *   Muốn số chính xác hãy dùng API đếm token của Anthropic.
 * - Gemini (SentencePiece, từ vựng ~256k): hiệu quả tốt cho đa ngôn ngữ; chữ số tách từng chữ số.
 * - Llama (3.x, từ vựng 128k kiểu tiktoken): gần cl100k nhưng tiếng Việt/CJK kém hiệu quả hơn o200k. Dùng chung cho
 *   Mistral/DeepSeek ở mức "gần đúng nhất có thể", sai số có thể lớn hơn.
 * - Tiếng Việt: âm tiết có dấu thanh/dấu mũ tốn nhiều token hơn từ Latin thường. Từ vựng cũ (cl100k, Llama)
 *   ~1.5-1.8x, từ vựng mới (o200k, Gemini) ~1.15-1.3x.
 * - CJK: o200k/Gemini ~0.65-0.75 token/ký tự (nhiều từ ghép 2 ký tự là 1 token); cl100k/Claude/Llama ~1.0-1.3.
 * - Emoji: 2-3 token mỗi emoji, ZWJ / tông da cộng thêm 1.
 * - Chuỗi base64/hex/UUID: ~2.5 ký tự / token; URL ~3 ký tự / token.
 * - Số: o200k/cl100k/Llama gom tối đa 3 chữ số mỗi token; Gemini 1 chữ số / token; Claude giả định 2.
 * - Mọi con số chỉ là ƯỚC TÍNH (+-10..15%); đừng dùng để bảo đảm giới hạn cứng.
 */

export type FamilyId = 'o200k' | 'cl100k' | 'claude' | 'gemini' | 'llama';

export const FAMILIES: { id: FamilyId; label: string; note: string }[] = [
  { id: 'o200k', label: 'OpenAI o200k', note: 'GPT-4o, GPT-4.1, GPT-5, o-series' },
  { id: 'cl100k', label: 'OpenAI cl100k', note: 'GPT-4, GPT-3.5, tương tự Mistral' },
  { id: 'claude', label: 'Claude', note: 'Anthropic Claude (ước lượng thận trọng)' },
  { id: 'gemini', label: 'Gemini', note: 'Google Gemini (kiểu SentencePiece)' },
  { id: 'llama', label: 'Llama', note: 'Llama 3/4, DeepSeek (gần đúng)' },
];

export interface FamilyConfig {
  /** Số chữ cái Latin trung bình mỗi token cho từ dài. */
  cpt: number;
  /** Số chữ cái mỗi token cho từ VIẾT HOA TOÀN BỘ. */
  capsCpt: number;
  /** Token mỗi ký tự cho Hán / Kana. */
  han: number;
  hangul: number;
  cyrillic: number;
  arabic: number;
  indic: number;
  other: number;
  /** Hệ số nhân cho âm tiết tiếng Việt có dấu. */
  vi: number;
  /** Hệ số nhân cho chữ Latin có dấu khác (é, ü...). */
  diacritic: number;
  emoji: number;
  /** Số chữ số tối đa mỗi token. */
  digitsPerToken: number;
  /** Số ký tự / token cho base64/hex. */
  blobDiv: number;
  urlDiv: number;
  /** Dấu cách trong một token (chuỗi thụt lề). */
  wsRun: number;
  /** Biên sai số: thấp / cao cho thành phần thường và thành phần bất định. */
  lo: number;
  hi: number;
  loU: number;
  hiU: number;
  /** Phụ phí mỗi tin nhắn khi gọi API chat (ước tính). */
  perMessage: number;
  /** Phụ phí cố định cho cả hội thoại (priming trả lời, BOS...). */
  perConversation: number;
}

export const FAMILY_CONFIG: Record<FamilyId, FamilyConfig> = {
  o200k: {
    cpt: 5.0, capsCpt: 2.6, han: 0.7, hangul: 0.8, cyrillic: 0.28, arabic: 0.3, indic: 0.7, other: 0.6,
    vi: 1.25, diacritic: 1.12, emoji: 2, digitsPerToken: 3, blobDiv: 2.6, urlDiv: 3.2, wsRun: 8,
    lo: 0.1, hi: 0.15, loU: 0.2, hiU: 0.3, perMessage: 3, perConversation: 3,
  },
  cl100k: {
    cpt: 4.6, capsCpt: 2.4, han: 1.2, hangul: 1.4, cyrillic: 0.5, arabic: 0.55, indic: 1.2, other: 0.9,
    vi: 1.7, diacritic: 1.25, emoji: 3, digitsPerToken: 3, blobDiv: 2.5, urlDiv: 3.0, wsRun: 8,
    lo: 0.1, hi: 0.15, loU: 0.2, hiU: 0.3, perMessage: 3, perConversation: 3,
  },
  claude: {
    cpt: 4.2, capsCpt: 2.3, han: 1.15, hangul: 1.3, cyrillic: 0.5, arabic: 0.55, indic: 1.2, other: 0.9,
    vi: 1.6, diacritic: 1.25, emoji: 3, digitsPerToken: 2, blobDiv: 2.4, urlDiv: 2.8, wsRun: 8,
    lo: 0.12, hi: 0.18, loU: 0.22, hiU: 0.32, perMessage: 4, perConversation: 8,
  },
  gemini: {
    cpt: 4.9, capsCpt: 2.6, han: 0.65, hangul: 0.7, cyrillic: 0.25, arabic: 0.28, indic: 0.6, other: 0.5,
    vi: 1.15, diacritic: 1.08, emoji: 2, digitsPerToken: 1, blobDiv: 2.6, urlDiv: 3.2, wsRun: 16,
    lo: 0.12, hi: 0.18, loU: 0.22, hiU: 0.32, perMessage: 1, perConversation: 2,
  },
  llama: {
    cpt: 4.7, capsCpt: 2.5, han: 1.0, hangul: 1.2, cyrillic: 0.4, arabic: 0.45, indic: 1.0, other: 0.8,
    vi: 1.5, diacritic: 1.2, emoji: 3, digitsPerToken: 3, blobDiv: 2.5, urlDiv: 3.0, wsRun: 8,
    lo: 0.12, hi: 0.18, loU: 0.22, hiU: 0.32, perMessage: 5, perConversation: 6,
  },
};

export interface TokenEstimate {
  min: number;
  likely: number;
  max: number;
}

/* ------------------------------------------------------------------ */
/* Pre-tokenizer                                                       */
/* ------------------------------------------------------------------ */

type Kind = 'url' | 'blob' | 'emoji' | 'nl' | 'word' | 'num' | 'punct' | 'ws' | 'any';
const KINDS: Kind[] = ['url', 'blob', 'emoji', 'nl', 'word', 'num', 'punct', 'ws', 'any'];

const BLOB_CLS = '[A-Za-z0-9+/_=-]';
const PIECE_SRC = [
  String.raw`(https?:\/\/[^\s<>"')\]]+)`,
  `((?=${BLOB_CLS}{0,63}\\d)(?=${BLOB_CLS}{0,63}[A-Za-z])${BLOB_CLS}{28,})`,
  String.raw`((?:\p{RI}{2}|\p{Extended_Pictographic})(?:[️\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic})*)`,
  String.raw`([^\S\r\n]*(?:\r?\n[^\S\r\n]*)+)`,
  String.raw`( ?_*[\p{L}\p{M}]+(?:_+[\p{L}\p{M}]+)*)`,
  String.raw`(\p{N}{1,3})`,
  String.raw`( ?[^\s\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{RI}]+)`,
  String.raw`([^\S\r\n]+)`,
  String.raw`([\s\S])`,
].join('|');

const CAMEL_RE = new RegExp(String.raw`\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}+|\P{L}+`, 'gu');
const HAS_LOWER = new RegExp(String.raw`\p{Ll}`, 'u');
const HAS_UPPER = new RegExp(String.raw`\p{Lu}`, 'u');
const CAPITALIZED = new RegExp(String.raw`^\p{Lu}\p{Ll}+$`, 'u');
const NON_ASCII = /[^\x00-\x7f]/;
const ASCII_LETTERS = /^[A-Za-z]+$/;
const VI_CHARS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

/** Từ dài nhưng rất phổ biến: coi như 1 token. */
const COMMON_LONG = new Set(
  (
    'because between through another important information example different something without however development ' +
    'government company system program number question problem understand business children together national general ' +
    'service should against language several people through really probably between during before after little ' +
    'always sometimes everything everyone anything nothing following including support available provide process ' +
    'whether without almost enough already history research security ' +
    'function return string number boolean object import export default const class public private static void ' +
    'config value props state error result response request message data user title content'
  )
    .split(/\s+/)
    .filter(Boolean)
);

type Script = 'latin' | 'han' | 'hangul' | 'cyr' | 'arab' | 'indic' | 'other';

function scriptOf(cp: number): Script {
  if (cp < 0x250 || (cp >= 0x1e00 && cp <= 0x1eff) || (cp >= 0x250 && cp <= 0x36f)) return 'latin';
  if (
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2ffff)
  )
    return 'han';
  if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff)) return 'hangul';
  if ((cp >= 0x370 && cp <= 0x52f) || (cp >= 0x1f00 && cp <= 0x1fff)) return 'cyr';
  if ((cp >= 0x590 && cp <= 0x6ff) || (cp >= 0x750 && cp <= 0x77f) || (cp >= 0xfb50 && cp <= 0xfdff)) return 'arab';
  if (cp >= 0x900 && cp <= 0xe7f) return 'indic';
  return 'other';
}

/** Cờ "bất định" do hàm chi phí đặt lại mỗi lần gọi (tránh cấp phát đối tượng). */
let U = false;

function latinRunCost(s: string, F: FamilyConfig): number {
  if (!s) return 0;
  let str = s;
  const nonAscii = NON_ASCII.test(str);
  if (nonAscii) str = str.normalize('NFC');
  let total = 0;
  let parts: string[] = [str];
  if (str.length > 3 && HAS_LOWER.test(str) && HAS_UPPER.test(str) && !CAPITALIZED.test(str)) {
    const m = str.match(CAMEL_RE);
    if (m) parts = m;
  }
  for (const part of parts) {
    const L = part.length;
    const lower = part.toLowerCase();
    if (COMMON_LONG.has(lower)) total += 1;
    else if (L > 1 && part === part.toUpperCase() && part !== lower) total += Math.max(1, L / F.capsCpt);
    else total += Math.max(1, L / F.cpt);
  }
  if (nonAscii) {
    if (VI_CHARS.test(str)) total *= F.vi;
    else total *= F.diacritic;
    U = true;
  }
  return total;
}

function wordCost(w: string, F: FamilyConfig): number {
  if (ASCII_LETTERS.test(w)) return latinRunCost(w, F);
  let total = 0;
  for (const seg of w.split('_')) {
    if (!seg) continue;
    if (ASCII_LETTERS.test(seg)) {
      total += latinRunCost(seg, F);
      continue;
    }
    let latin = '';
    for (const ch of seg) {
      const cp = ch.codePointAt(0) as number;
      const sc = scriptOf(cp);
      if (sc === 'latin') {
        latin += ch;
        continue;
      }
      if (latin) {
        total += latinRunCost(latin, F);
        latin = '';
      }
      U = true;
      switch (sc) {
        case 'han': total += F.han; break;
        case 'hangul': total += F.hangul; break;
        case 'cyr': total += F.cyrillic; break;
        case 'arab': total += F.arabic; break;
        case 'indic': total += F.indic; break;
        default: total += F.other;
      }
    }
    if (latin) total += latinRunCost(latin, F);
  }
  return Math.max(total, 0.5);
}

function emojiCost(s: string, F: FamilyConfig): number {
  U = true;
  let cost = F.emoji;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x200d) cost += 1;
    else if (c === 0xd83c) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xdffb && n <= 0xdfff) cost += 1; // tông da
    }
  }
  if (/^\p{RI}/u.test(s)) cost += 1; // cờ quốc gia: 2 ký tự khu vực
  return cost;
}

/** Chi phí (số thực) của một pre-token. Đặt cờ U nếu bất định. */
function pieceCost(text: string, kind: Kind, s: number, e: number, F: FamilyConfig): number {
  U = false;
  switch (kind) {
    case 'url':
      U = true;
      return (e - s) / F.urlDiv;
    case 'blob':
      U = true;
      return (e - s) / F.blobDiv;
    case 'emoji':
      return emojiCost(text.slice(s, e), F);
    case 'nl': {
      let nl = 0;
      let lastNl = s;
      for (let i = s; i < e; i++) {
        if (text.charCodeAt(i) === 10) {
          nl++;
          lastNl = i;
        }
      }
      const indent = e - lastNl - 1;
      let c = Math.ceil(nl / 2);
      if (indent > 1) c += 0.6 * Math.ceil(indent / F.wsRun);
      return Math.max(c, 1);
    }
    case 'word': {
      const st = text.charCodeAt(s) === 32 ? s + 1 : s;
      return wordCost(text.slice(st, e), F);
    }
    case 'num': {
      return Math.ceil((e - s) / F.digitsPerToken);
    }
    case 'punct': {
      const st = text.charCodeAt(s) === 32 ? s + 1 : s;
      let n = 0;
      let extra = 0;
      for (let i = st; i < e; i++) {
        const c = text.charCodeAt(i);
        if (c >= 0xdc00 && c <= 0xdfff) continue;
        n++;
        if (c > 0x7f) extra += 0.7;
      }
      if (extra > 0) U = true;
      return Math.max(1, Math.round(n / 2.2 + 0.2)) + extra;
    }
    case 'ws': {
      let n = e - s;
      const next = e < text.length ? text.charCodeAt(e) : -1;
      if (next !== -1 && next !== 10 && next !== 13) n -= 1; // dấu cách cuối dính vào token kế tiếp
      return n <= 0 ? 0 : Math.ceil(n / F.wsRun);
    }
    default:
      U = true;
      return 1.5;
  }
}

function newPieceRe(): RegExp {
  return new RegExp(PIECE_SRC, 'gu');
}

function kindOf(m: RegExpExecArray): Kind {
  for (let i = 1; i <= 9; i++) if (m[i] !== undefined) return KINDS[i - 1];
  return 'any';
}

/** Ước tính cho nhiều họ tokenizer chỉ với một lần quét regex. */
export function estimateMany(text: string, families: FamilyId[]): Record<FamilyId, TokenEstimate> {
  const out = {} as Record<FamilyId, TokenEstimate>;
  const n = families.length;
  const Fs = families.map((f) => FAMILY_CONFIG[f]);
  const accN = new Array<number>(n).fill(0);
  const accU = new Array<number>(n).fill(0);
  if (text) {
    const re = newPieceRe();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const s = m.index;
      const e = s + m[0].length;
      const kind = kindOf(m);
      for (let i = 0; i < n; i++) {
        const c = pieceCost(text, kind, s, e, Fs[i]);
        if (U) accU[i] += c;
        else accN[i] += c;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const F = Fs[i];
    const tot = accN[i] + accU[i];
    const likely = tot <= 0 ? 0 : Math.max(1, Math.round(tot));
    const lo = accN[i] * (1 - F.lo) + accU[i] * (1 - F.loU);
    const hi = accN[i] * (1 + F.hi) + accU[i] * (1 + F.hiU);
    out[families[i]] = {
      min: Math.min(likely, Math.floor(lo)),
      likely,
      max: Math.max(likely, Math.ceil(hi)),
    };
  }
  return out;
}

export function estimateTokens(text: string, family: FamilyId): TokenEstimate {
  return estimateMany(text, [family])[family];
}

export function estimateLikely(text: string, family: FamilyId): number {
  return estimateTokens(text, family).likely;
}

export interface BudgetCut {
  /** Chỉ số UTF-16 (không bao giờ nằm giữa cặp surrogate). */
  index: number;
  /** Số token ước tính của text.slice(0, index). */
  tokens: number;
  /** true nếu cả văn bản nằm trong ngân sách. */
  fitsAll: boolean;
}

/** Tìm vị trí ký tự mà tại đó ngân sách token ước tính (likely) bị chạm tới. */
export function findBudgetIndex(text: string, family: FamilyId, budget: number): BudgetCut {
  const F = FAMILY_CONFIG[family];
  if (!text) return { index: 0, tokens: 0, fitsAll: true };
  if (budget <= 0) return { index: 0, tokens: 0, fitsAll: false };
  const re = newPieceRe();
  let m: RegExpExecArray | null;
  let cum = 0;
  while ((m = re.exec(text)) !== null) {
    const s = m.index;
    const e = s + m[0].length;
    const c = pieceCost(text, kindOf(m), s, e, F);
    if (cum + c > budget + 1e-9) {
      let idx = s;
      let tokens = cum;
      if (c > 6) {
        const frac = Math.max(0, (budget - cum) / c);
        idx = s + Math.floor((e - s) * frac);
        const cc = text.charCodeAt(idx);
        if (idx > s && cc >= 0xdc00 && cc <= 0xdfff) idx--;
        tokens = cum + c * ((idx - s) / (e - s));
      }
      if (idx === 0) {
        // luôn tiến được ít nhất một ký tự (code point)
        const cp = text.codePointAt(0) as number;
        idx = cp > 0xffff ? 2 : 1;
        tokens = Math.max(tokens, 1);
      }
      return { index: idx, tokens: Math.round(tokens), fitsAll: false };
    }
    cum += c;
  }
  return { index: text.length, tokens: Math.round(cum), fitsAll: true };
}

/** Lùi vị trí cắt về ranh giới dòng / câu gần nhất (trong cửa sổ 4000 ký tự). Không tìm thấy -> giữ nguyên. */
export function snapBack(text: string, idx: number): number {
  if (idx <= 0 || idx >= text.length) return idx;
  const base = Math.max(0, idx - 4000);
  const win = text.slice(base, idx);
  const re = /\n|[.!?…。！？]+["'”’)\]]*(?:\s|$)|[。！？]/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(win)) !== null) {
    last = base + m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  return last > 0 && last <= idx ? last : idx;
}

/* ------------------------------------------------------------------ */
/* Chunking                                                            */
/* ------------------------------------------------------------------ */

export type ChunkBoundary = 'paragraph' | 'sentence' | 'line';

export interface Chunk {
  index: number;
  start: number;
  end: number;
  text: string;
  tokens: number;
}

export interface ChunkOptions {
  size: number;
  overlap: number;
  boundary: ChunkBoundary;
}

interface Span {
  s: number;
  e: number;
  t: number;
}

type SplitLevel = 'paragraph' | 'sentence' | 'line' | 'word';

const LEVELS: Record<ChunkBoundary, SplitLevel[]> = {
  paragraph: ['paragraph', 'sentence', 'word'],
  sentence: ['sentence', 'word'],
  line: ['line', 'sentence', 'word'],
};

function levelRe(level: SplitLevel): RegExp {
  switch (level) {
    case 'paragraph':
      return /\n[^\S\n]*\n\s*/g;
    case 'line':
      return /\n/g;
    case 'sentence':
      return /[.!?…]+["'”’)\]]*\s+|[。！？]+["'”’)\]]*|\n/g;
    default:
      return /\S+\s*/g;
  }
}

function splitSpans(text: string, s: number, e: number, level: SplitLevel): Array<[number, number]> {
  const seg = text.slice(s, e);
  const re = levelRe(level);
  const out: Array<[number, number]> = [];
  let prev = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg)) !== null) {
    const end = m.index + m[0].length;
    if (end > prev) {
      out.push([s + prev, s + end]);
      prev = end;
    }
    if (m[0].length === 0) re.lastIndex++;
  }
  if (prev < seg.length) out.push([s + prev, e]);
  return out;
}

function buildUnits(text: string, family: FamilyId, size: number, levels: SplitLevel[]): Span[] {
  const out: Span[] = [];
  const refine = (s: number, e: number, li: number) => {
    const len = e - s;
    if (len <= 0) return;
    let t: number | null = null;
    if (len <= size * 40) {
      t = estimateLikely(text.slice(s, e), family);
      if (t <= size) {
        out.push({ s, e, t });
        return;
      }
    }
    if (li < levels.length) {
      const parts = splitSpans(text, s, e, levels[li]);
      if (parts.length > 1) {
        for (const [a, b] of parts) refine(a, b, li + 1);
      } else {
        refine(s, e, li + 1);
      }
      return;
    }
    // cắt cứng theo ngân sách (không tách cặp surrogate)
    let pos = s;
    while (pos < e) {
      const rest = text.slice(pos, e);
      const cut = findBudgetIndex(rest, family, size);
      const end = pos + Math.max(cut.index, 1);
      const fixed = end < e && isLowSurrogate(text.charCodeAt(end)) ? end + 1 : end;
      out.push({ s: pos, e: fixed, t: Math.min(cut.tokens, size) });
      pos = fixed;
    }
  };
  refine(0, text.length, 0);
  return out;
}

function isLowSurrogate(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

/** Chia văn bản thành các đoạn <= `size` token (ước tính), có overlap, theo ranh giới được chọn. */
export function chunkText(text: string, family: FamilyId, opts: ChunkOptions): Chunk[] {
  const size = Math.max(1, Math.floor(opts.size));
  const overlap = Math.max(0, Math.min(Math.floor(opts.overlap), size - 1));
  if (!text) return [];
  const units = buildUnits(text, family, size, LEVELS[opts.boundary]);
  const chunks: Chunk[] = [];
  const n = units.length;
  let i = 0;
  while (i < n) {
    let j = i;
    let sum = 0;
    while (j < n && (j === i || sum + units[j].t <= size)) {
      sum += units[j].t;
      j++;
    }
    const start = units[i].s;
    const end = units[j - 1].e;
    const ctext = text.slice(start, end);
    chunks.push({ index: chunks.length, start, end, text: ctext, tokens: estimateLikely(ctext, family) });
    if (j >= n) break;
    let k = j;
    let acc = 0;
    while (k - 1 > i && acc + units[k - 1].t <= overlap) {
      k--;
      acc += units[k].t;
    }
    while (k < j && acc + units[j].t > size) {
      acc -= units[k].t;
      k++;
    }
    i = k;
  }
  return chunks;
}

/* ------------------------------------------------------------------ */
/* Hội thoại (chat) & thống kê                                         */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: string;
  content: string;
}

const ROLE_RE = /^(system|user|assistant|tool|human|ai|developer)\s*:\s?/i;

/** Tách hội thoại dạng "user: ...", "assistant: ..." theo dòng. Không có nhãn -> 1 tin nhắn user. */
export function parseConversation(text: string): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  let cur: ChatMessage | null = null;
  for (const line of text.split('\n')) {
    const m = ROLE_RE.exec(line);
    if (m) {
      cur = { role: m[1].toLowerCase(), content: line.slice(m[0].length) };
      msgs.push(cur);
    } else if (cur) {
      cur.content += '\n' + line;
    } else if (line.trim()) {
      cur = { role: 'user', content: line };
      msgs.push(cur);
    }
  }
  return msgs;
}

/** Phụ phí định dạng chat (ước tính): số tin nhắn * perMessage + hằng số cả hội thoại. */
export function chatOverhead(family: FamilyId, messageCount: number): number {
  if (messageCount <= 0) return 0;
  const F = FAMILY_CONFIG[family];
  return messageCount * F.perMessage + F.perConversation;
}

export interface TextStats {
  chars: number;
  words: number;
  lines: number;
  bytes: number;
}

export function textStats(text: string): TextStats {
  if (!text) return { chars: 0, words: 0, lines: 0, bytes: 0 };
  let chars = 0;
  for (const _ of text) {
    void _;
    chars++;
  }
  const words = (text.match(/\S+/g) || []).length;
  const lines = text.split('\n').length;
  const bytes = new TextEncoder().encode(text).length;
  return { chars, words, lines, bytes };
}

/* ------------------------------------------------------------------ */
/* Tự kiểm tra                                                         */
/* ------------------------------------------------------------------ */

export interface SelfCheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const SAMPLE_EN =
  'The quick brown fox jumps over the lazy dog. Language models read text as tokens, which are pieces of words. ' +
  'A short sentence may take only a few tokens, while a long document can take thousands of them.';

/** Chạy các phép kiểm tra băng rộng (không khẳng định số chính xác). */
export function runSelfChecks(): SelfCheckResult[] {
  const res: SelfCheckResult[] = [];
  const check = (name: string, ok: boolean, detail: string) => res.push({ name, ok, detail });
  for (const f of FAMILIES.map((x) => x.id)) {
    const e0 = estimateTokens('', f);
    check(`${f}: chuỗi rỗng = 0`, e0.min === 0 && e0.likely === 0 && e0.max === 0, JSON.stringify(e0));
    const hw = estimateTokens('hello world', f).likely;
    check(`${f}: "hello world" ~ 2 token (băng 1-4)`, hw >= 1 && hw <= 4, String(hw));
    const fox = estimateTokens('The quick brown fox jumps over the lazy dog.', f).likely;
    check(`${f}: câu "quick brown fox" ~ 10 token (băng 7-16)`, fox >= 7 && fox <= 16, String(fox));
    const dg = estimateTokens('1234567890', f).likely;
    check(`${f}: dãy 10 chữ số (băng 3-10)`, dg >= 3 && dg <= 10, String(dg));
    const e = estimateTokens(SAMPLE_EN, f);
    const cpt = SAMPLE_EN.length / e.likely;
    check(`${f}: tiếng Anh ~3-6 ký tự/token`, cpt >= 3 && cpt <= 6, cpt.toFixed(2));
    check(`${f}: min <= likely <= max`, e.min <= e.likely && e.likely <= e.max, JSON.stringify(e));
    let mono = true;
    let prev = 0;
    for (let i = 0; i <= SAMPLE_EN.length; i += 7) {
      const c = estimateTokens(SAMPLE_EN.slice(0, i), f).likely;
      if (c < prev) mono = false;
      prev = c;
    }
    check(`${f}: đơn điệu (thêm chữ không giảm token)`, mono, '');
    const a = SAMPLE_EN;
    const b = 'Ghi chú: ' + SAMPLE_EN.toUpperCase().slice(0, 60) + ' 12345';
    const sum = estimateTokens(a, f).likely + estimateTokens(b, f).likely;
    const both = estimateTokens(a + '\n' + b, f).likely;
    check(`${f}: cộng gộp xấp xỉ (trong +-15%)`, Math.abs(both - sum) <= 0.15 * sum + 2, `${both} vs ${sum}`);
  }
  const vi = 'Xin chào, tôi là một người Việt Nam đang học lập trình';
  const viNoDia = 'Xin chao, toi la mot nguoi Viet Nam dang hoc lap trinh';
  check(
    'cl100k: tiếng Việt có dấu tốn nhiều token hơn không dấu',
    estimateTokens(vi, 'cl100k').likely > estimateTokens(viNoDia, 'cl100k').likely,
    ''
  );
  check(
    'tiếng Việt: o200k <= cl100k',
    estimateTokens(vi, 'o200k').likely <= estimateTokens(vi, 'cl100k').likely,
    ''
  );
  const zh = '你好，世界。今天天气很好。';
  const zhT = estimateTokens(zh, 'cl100k').likely;
  check('CJK ~ 0.5-2 token/ký tự', zhT >= zh.length * 0.5 && zhT <= zh.length * 2, String(zhT));
  const b64 = 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIGJhc2U2NCBibG9iIHRlc3Q9PQ==';
  const b64T = estimateTokens(b64, 'o200k').likely;
  check('base64 ~ len/3.5..len/1.5', b64T >= b64.length / 3.5 && b64T <= b64.length / 1.5, String(b64T));
  return res;
}
