/**
 * Logic thuần cho giọng đọc miễn phí của trình duyệt (Web Speech API):
 * - chuẩn hóa văn bản để giọng tiếng Việt đọc tự nhiên (số, ngày giờ, tiền, đơn vị, viết tắt...);
 * - nhận diện ngôn ngữ, chia câu/cụm (<= ~200 ký tự) để tránh lỗi Chrome dừng sau ~15 giây;
 * - chọn / nhóm / lọc danh sách giọng.
 * Không phụ thuộc React hay DOM nên có thể kiểm thử bằng tsx.
 */

export type NormLang = 'vi' | 'en' | 'none';

/* ------------------------------------------------------------------ */
/* Tiện ích regex (xây từ chuỗi để không phụ thuộc target biên dịch)    */
/* ------------------------------------------------------------------ */

const NEVER = /(?!)/g;
function re(src: string, flags = 'gu'): RegExp {
  try {
    return new RegExp(src, flags);
  } catch {
    // Trình duyệt quá cũ (không hỗ trợ lookbehind / \p{}): bước này bị bỏ qua thay vì làm hỏng cả trang
    return new RegExp(NEVER.source, flags);
  }
}
/** Ký tự "thuộc từ": dùng trong lookaround thay cho \b (\b không hiểu tiếng Việt) */
const W = String.raw`\p{L}\p{N}_`;

/* ------------------------------------------------------------------ */
/* Đọc số thành chữ                                                    */
/* ------------------------------------------------------------------ */

const VI_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const VI_SCALES = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ', 'tỷ tỷ'];

function viTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const parts: string[] = [];
  if (h > 0 || full) parts.push(VI_DIGITS[h], 'trăm');
  if (t === 0) {
    if (u > 0) {
      if (h > 0 || full) parts.push('linh');
      parts.push(VI_DIGITS[u]);
    }
  } else if (t === 1) {
    parts.push('mười');
    if (u > 0) parts.push(u === 5 ? 'lăm' : VI_DIGITS[u]);
  } else {
    parts.push(VI_DIGITS[t], 'mươi');
    if (u > 0) parts.push(u === 1 ? 'mốt' : u === 4 ? 'tư' : u === 5 ? 'lăm' : VI_DIGITS[u]);
  }
  return parts.join(' ');
}

/** Số nguyên không âm (chuỗi chữ số) -> chữ tiếng Việt. Tới 21 chữ số; dài hơn thì đọc từng chữ số. */
export function intToWordsVi(digits: string): string {
  const d = digits.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(d)) return digits;
  if (d === '0') return VI_DIGITS[0];
  if (d.length > 21) return spellDigits(d, 'vi');
  const padded = d.padStart(Math.ceil(d.length / 3) * 3, '0');
  const groups: number[] = [];
  for (let i = 0; i < padded.length; i += 3) groups.push(parseInt(padded.slice(i, i + 3), 10));
  const out: string[] = [];
  let started = false;
  groups.forEach((g, i) => {
    if (g === 0) return;
    const scale = VI_SCALES[groups.length - 1 - i];
    out.push(viTriple(g, started));
    if (scale) out.push(scale);
    started = true;
  });
  return out.join(' ');
}

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion'];

function enTriple(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(EN_ONES[h], 'hundred');
  if (r > 0) {
    if (r < 20) parts.push(EN_ONES[r]);
    else parts.push(EN_TENS[Math.floor(r / 10)] + (r % 10 ? '-' + EN_ONES[r % 10] : ''));
  }
  return parts.join(' ');
}

export function intToWordsEn(digits: string): string {
  const d = digits.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(d)) return digits;
  if (d === '0') return 'zero';
  if (d.length > 21) return spellDigits(d, 'en');
  const padded = d.padStart(Math.ceil(d.length / 3) * 3, '0');
  const groups: number[] = [];
  for (let i = 0; i < padded.length; i += 3) groups.push(parseInt(padded.slice(i, i + 3), 10));
  const out: string[] = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    out.push(enTriple(g));
    const scale = EN_SCALES[groups.length - 1 - i];
    if (scale) out.push(scale);
  });
  return out.join(' ');
}

type L2 = 'vi' | 'en';

function spellDigits(d: string, lang: L2): string {
  const words = lang === 'vi' ? VI_DIGITS : EN_ONES;
  return d
    .split('')
    .map((c) => (c >= '0' && c <= '9' ? words[+c] : c))
    .join(' ');
}

function intWords(d: string, lang: L2): string {
  // "007", "0912" ... là mã / số thứ tự có số 0 đứng đầu: đọc từng chữ số
  if (d.length > 1 && d[0] === '0') return spellDigits(d, lang);
  // Chuỗi số quá dài không có dấu phân cách thường là mã (CCCD, tài khoản...)
  if (d.length >= 13) return spellDigits(d, lang);
  return lang === 'vi' ? intToWordsVi(d) : intToWordsEn(d);
}

function fracWords(frac: string, lang: L2): string {
  if (lang === 'en') return spellDigits(frac, 'en');
  const zeros = frac.match(/^0*/)![0];
  const rest = frac.slice(zeros.length);
  const parts: string[] = [];
  for (let i = 0; i < zeros.length; i++) parts.push(VI_DIGITS[0]);
  if (rest) parts.push(rest.length <= 2 ? intToWordsVi(rest) : spellDigits(rest, 'vi'));
  return parts.join(' ');
}

function validThousands(s: string, sep: string): boolean {
  const parts = s.split(sep);
  if (parts.length < 2) return false;
  if (!/^\d{1,3}$/.test(parts[0])) return false;
  return parts.slice(1).every((p) => /^\d{3}$/.test(p));
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

/**
 * Đọc một token số có thể chứa dấu . và , theo cả kiểu Việt (1.234.567,89) lẫn kiểu Anh (1,234,567.89).
 */
export function readNumberToken(tok: string, lang: L2 = 'vi'): string {
  const dec = lang === 'vi' ? 'phẩy' : 'point';
  const dots = count(tok, '.');
  const commas = count(tok, ',');
  if (dots === 0 && commas === 0) return intWords(tok, lang);

  let int: string | null = null;
  let frac: string | null = null;

  if (dots > 0 && commas > 0) {
    const last = Math.max(tok.lastIndexOf('.'), tok.lastIndexOf(','));
    const D = tok[last];
    const T = D === '.' ? ',' : '.';
    const head = tok.slice(0, last);
    const tail = tok.slice(last + 1);
    if (count(tok, D) === 1 && /^\d+$/.test(tail) && (count(head, T) === 0 ? /^\d+$/.test(head) : validThousands(head, T) && count(head, D) === 0)) {
      int = head.split(T).join('');
      frac = tail;
    }
  } else {
    const S = dots > 0 ? '.' : ',';
    const n = dots > 0 ? dots : commas;
    if (n >= 2) {
      if (validThousands(tok, S)) int = tok.split(S).join('');
    } else {
      const [a, b] = tok.split(S);
      const thousandLike = b.length === 3 && /^[1-9]\d{0,2}$/.test(a);
      if (thousandLike && (S === ',' || lang === 'vi')) int = a + b;
      else if (a !== '' && b !== '') {
        int = a;
        frac = b;
      }
    }
  }

  if (int !== null) {
    const w = intWords(int, lang);
    return frac !== null ? `${w} ${dec} ${fracWords(frac, lang)}` : w;
  }

  // Không phải định dạng số hợp lệ (vd. 1,2,3 hay 10.0.0.1): đọc từng phần, nối bằng dấu
  const out: string[] = [];
  const pieces = tok.split(/([.,])/);
  for (const p of pieces) {
    if (p === '.') out.push(lang === 'vi' ? 'chấm' : 'dot');
    else if (p === ',') out.push(lang === 'vi' ? 'phẩy' : 'comma');
    else if (p) out.push(intWords(p, lang));
  }
  return out.join(' ');
}

/* ------------------------------------------------------------------ */
/* Bảng đơn vị, tiền tệ, ký hiệu                                       */
/* ------------------------------------------------------------------ */

const UNITS: Record<string, [string, string]> = {
  '%': ['phần trăm', 'percent'],
  '°C': ['độ xê', 'degrees Celsius'],
  '℃': ['độ xê', 'degrees Celsius'],
  '°F': ['độ ép', 'degrees Fahrenheit'],
  '°': ['độ', 'degrees'],
  'km/h': ['ki lô mét trên giờ', 'kilometers per hour'],
  'mph': ['dặm trên giờ', 'miles per hour'],
  'm/s': ['mét trên giây', 'meters per second'],
  'km²': ['ki lô mét vuông', 'square kilometers'],
  'km2': ['ki lô mét vuông', 'square kilometers'],
  'm²': ['mét vuông', 'square meters'],
  'm2': ['mét vuông', 'square meters'],
  'cm²': ['xăng ti mét vuông', 'square centimeters'],
  'cm2': ['xăng ti mét vuông', 'square centimeters'],
  'm³': ['mét khối', 'cubic meters'],
  'm3': ['mét khối', 'cubic meters'],
  'cm³': ['xăng ti mét khối', 'cubic centimeters'],
  'cm3': ['xăng ti mét khối', 'cubic centimeters'],
  'ha': ['héc ta', 'hectares'],
  'km': ['ki lô mét', 'kilometers'],
  'dm': ['đề xi mét', 'decimeters'],
  'cm': ['xăng ti mét', 'centimeters'],
  'mm': ['mi li mét', 'millimeters'],
  'nm': ['na nô mét', 'nanometers'],
  'ft': ['phít', 'feet'],
  'inch': ['inh', 'inches'],
  'kg': ['ki lô gam', 'kilograms'],
  'mg': ['mi li gam', 'milligrams'],
  'lb': ['pao', 'pounds'],
  'ml': ['mi li lít', 'milliliters'],
  'KB/s': ['ki lô bai trên giây', 'kilobytes per second'],
  'MB/s': ['mê ga bai trên giây', 'megabytes per second'],
  'GB/s': ['ghi ga bai trên giây', 'gigabytes per second'],
  'Kbps': ['ki lô bít trên giây', 'kilobits per second'],
  'Mbps': ['mê ga bít trên giây', 'megabits per second'],
  'Gbps': ['ghi ga bít trên giây', 'gigabits per second'],
  'KB': ['ki lô bai', 'kilobytes'],
  'kB': ['ki lô bai', 'kilobytes'],
  'MB': ['mê ga bai', 'megabytes'],
  'GB': ['ghi ga bai', 'gigabytes'],
  'TB': ['tê ra bai', 'terabytes'],
  'PB': ['pê ta bai', 'petabytes'],
  'Kb': ['ki lô bít', 'kilobits'],
  'Mb': ['mê ga bít', 'megabits'],
  'Gb': ['ghi ga bít', 'gigabits'],
  'Hz': ['héc', 'hertz'],
  'kHz': ['ki lô héc', 'kilohertz'],
  'MHz': ['mê ga héc', 'megahertz'],
  'GHz': ['ghi ga héc', 'gigahertz'],
  'kWh': ['ki lô oát giờ', 'kilowatt hours'],
  'kW': ['ki lô oát', 'kilowatts'],
  'MW': ['mê ga oát', 'megawatts'],
  'mAh': ['mi li am pe giờ', 'milliamp hours'],
  'mA': ['mi li am pe', 'milliamps'],
  'kV': ['ki lô vôn', 'kilovolts'],
  'mV': ['mi li vôn', 'millivolts'],
  'ms': ['mi li giây', 'milliseconds'],
  'µs': ['mi crô giây', 'microseconds'],
  'ns': ['na nô giây', 'nanoseconds'],
  'px': ['pích xeo', 'pixels'],
  'dpi': ['đi pi ai', 'dots per inch'],
  'fps': ['ép pi ét', 'frames per second'],
  'rpm': ['vòng trên phút', 'revolutions per minute'],
  'dB': ['đề xi ben', 'decibels'],
  '$': ['đô la', 'dollars'],
  '€': ['ơ rô', 'euros'],
  '£': ['bảng Anh', 'pounds'],
  '¥': ['yên', 'yen'],
  '₫': ['đồng', 'dong'],
  'đ': ['đồng', 'dong'],
  'VNĐ': ['đồng', 'dong'],
  'vnđ': ['đồng', 'dong'],
  'VND': ['đồng', 'dong'],
  'vnd': ['đồng', 'dong'],
  'USD': ['đô la Mỹ', 'US dollars'],
  'EUR': ['ơ rô', 'euros'],
  'GBP': ['bảng Anh', 'pounds'],
  'JPY': ['yên Nhật', 'yen'],
  'CNY': ['nhân dân tệ', 'yuan'],
};
// Đơn vị một chữ cái: chỉ nhận khi dính liền số (5m, 3h) để không nhầm với chữ thường
const UNITS_NOSPACE: Record<string, [string, string]> = {
  m: ['mét', 'meters'],
  g: ['gam', 'grams'],
  l: ['lít', 'liters'],
  L: ['lít', 'liters'],
  s: ['giây', 'seconds'],
  h: ['giờ', 'hours'],
  W: ['oát', 'watts'],
  V: ['vôn', 'volts'],
  t: ['tấn', 'tons'],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const UNIT_ALT = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join('|');
const UNIT_NS_ALT = Object.keys(UNITS_NOSPACE).join('|');

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ------------------------------------------------------------------ */
/* Các bước chuẩn hóa                                                  */
/* ------------------------------------------------------------------ */

/** Bỏ markdown, khối code, thẻ HTML, emoji, ký tự điều khiển/ẩn */
export function stripMarkup(input: string): string {
  let s = input.replace(/\r\n?/g, '\n');
  s = s.replace(/```[\s\S]*?(```|$)/g, '\n');
  s = s.replace(/~~~[\s\S]*?(~~~|$)/g, '\n');
  s = s.replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1');
  s = s.replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1');
  s = s.replace(/`([^`\n]*)`/g, '$1');
  s = s.replace(/<\/?[a-zA-Z][^>\n]*>/g, ' ');
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/^\s*>+\s?/gm, '');
  s = s.replace(/^\s*([-*_]\s*){3,}$/gm, '');
  s = s.replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, (m) => (m.includes('|') ? '' : m));
  s = s.replace(/^\s*\|/gm, '').replace(/\|\s*$/gm, '').replace(/\s*\|\s*/g, ', ');
  s = s.replace(/^\s*[-*+•▪●◦‣]\s+/gm, '');
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2');
  s = s.replace(/\*(?=\S)([^*\n]*?\S)\*/g, '$1');
  s = s.replace(re(String.raw`(?<![${W}])_(?=\S)([^_\n]*?\S)_(?![${W}])`), '$1');
  s = s.replace(/~~(?=\S)([^~\n]*?\S)~~/g, '$1');
  // Emoji & ký tự ẩn
  s = s.replace(re(String.raw`[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}⃣︎️​-‍⁠﻿]`), '');
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return s;
}

function charWords(str: string, lang: L2): string {
  const vi = lang === 'vi';
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(buf);
    buf = '';
  };
  for (const ch of str) {
    if (ch === '.') (flush(), out.push(vi ? 'chấm' : 'dot'));
    else if (ch === '_') (flush(), out.push(vi ? 'gạch dưới' : 'underscore'));
    else if (ch === '-') (flush(), out.push(vi ? 'gạch ngang' : 'dash'));
    else if (ch === '+') (flush(), out.push(vi ? 'cộng' : 'plus'));
    else if (ch === '/') (flush(), out.push(vi ? 'gạch chéo' : 'slash'));
    else if (ch === '?') (flush(), out.push(vi ? 'hỏi' : 'question mark'));
    else if (ch === '=') (flush(), out.push(vi ? 'bằng' : 'equals'));
    else if (ch === '&') (flush(), out.push(vi ? 'và' : 'and'));
    else if (ch === '#') (flush(), out.push(vi ? 'thăng' : 'hash'));
    else if (ch === ':') (flush(), out.push(vi ? 'hai chấm' : 'colon'));
    else if (ch === '%') (flush(), out.push(vi ? 'phần trăm' : 'percent'));
    else if (ch >= '0' && ch <= '9') (flush(), out.push((vi ? VI_DIGITS : EN_ONES)[+ch]));
    else buf += ch;
  }
  flush();
  return out.join(' ');
}

function emailsAndUrls(s: string, lang: L2): string {
  const vi = lang === 'vi';
  // URL có giao thức hoặc www.
  s = s.replace(/\b(?:https?|ftp):\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/gi, (m) => {
    let url = m;
    let trail = '';
    const t = url.match(/[.,;:!?]+$/);
    if (t) {
      trail = t[0];
      url = url.slice(0, -trail.length);
    }
    url = url.replace(/^(?:https?|ftp):\/\//i, '');
    const slash = url.indexOf('/');
    const host = slash === -1 ? url : url.slice(0, slash);
    const path = slash === -1 ? '' : url.slice(slash);
    let spoken = charWords(host, lang);
    if (path.length > 1) {
      spoken += path.length <= 40 ? ' ' + charWords(path, lang) : vi ? ' và đường dẫn dài' : ' and a long path';
    }
    return ' ' + spoken + trail + ' ';
  });
  // Email
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, (m) => {
    const [local, domain] = m.split('@');
    return ` ${charWords(local, lang)} ${vi ? 'a còng' : 'at'} ${charWords(domain, lang)} `;
  });
  // Tên miền trần (example.com, abc.vn ...)
  s = s.replace(
    re(String.raw`(?<![${W}@/.-])([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|net|org|vn|io|dev|app|edu|gov|info|me|ai|xyz))(?![${W}])`),
    (_m, d: string) => ' ' + charWords(d, lang) + ' ',
  );
  return s;
}

function phoneDigits(raw: string, lang: L2, plus: boolean): string {
  const words = lang === 'vi' ? VI_DIGITS : EN_ONES;
  const groups = raw
    .replace(/[+()]/g, '')
    .split(/[\s.-]+/)
    .filter(Boolean);
  let parts = groups;
  if (groups.length === 1) {
    const d = groups[0];
    if (d.length === 10) parts = [d.slice(0, 4), d.slice(4, 7), d.slice(7)];
    else if (d.length === 11) parts = [d.slice(0, 4), d.slice(4, 7), d.slice(7)];
  }
  const spoken = parts.map((p) => p.split('').map((c) => words[+c]).join(' ')).join(', ');
  return (plus ? (lang === 'vi' ? 'cộng ' : 'plus ') : '') + spoken;
}

function phones(s: string, lang: L2): string {
  const digitCount = (x: string) => x.replace(/\D/g, '').length;
  // Quốc tế: +84 912 345 678
  s = s.replace(re(String.raw`(?<![${W}])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,6}(?![\d])`), (m) => {
    const n = digitCount(m);
    return n >= 8 && n <= 15 ? ' ' + phoneDigits(m, lang, true) + ' ' : m;
  });
  // (028) 3822 1234
  s = s.replace(re(String.raw`(?<![${W}])\(0\d{1,3}\)\s?\d{3,4}[ .-]?\d{3,4}(?![\d])`), (m) => ' ' + phoneDigits(m, lang, false) + ' ');
  // Việt Nam: 0912 345 678, 0912.345.678, 0912345678
  s = s.replace(re(String.raw`(?<![${W}.,/+-])0\d{2,3}[ .-]?\d{3}[ .-]?\d{3,4}(?![\d])`), (m) => {
    const n = digitCount(m);
    return n === 10 || n === 11 ? ' ' + phoneDigits(m, lang, false) + ' ' : m;
  });
  return s;
}

function viMonth(m: number): string {
  return m === 4 ? 'tư' : intToWordsVi(String(m));
}

function dayWords(d: string, lang: L2): string {
  return lang === 'vi' ? intToWordsVi(String(+d)) : intToWordsEn(String(+d));
}

function dates(s: string, lang: L2): string {
  const vi = lang === 'vi';
  const ok = (d: number, m: number) => d >= 1 && d <= 31 && m >= 1 && m <= 12;
  const fmt = (d: string, m: string, y?: string) => {
    const dn = +d;
    const mn = +m;
    if (vi) {
      return `ngày ${dayWords(d, lang)} tháng ${viMonth(mn)}` + (y ? ` năm ${readNumberToken(y, lang)}` : '');
    }
    return `${MONTHS_EN[mn - 1]} ${intToWordsEn(String(dn))}` + (y ? `, ${readNumberToken(y, lang)}` : '');
  };
  // yyyy-mm-dd
  s = s.replace(re(String.raw`(?<![\d/.-])(ngày\s+)?(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)`), (m, _p, y: string, mo: string, d: string) =>
    ok(+d, +mo) ? ' ' + fmt(d, mo, y) + ' ' : m,
  );
  // dd/mm/yyyy | dd-mm-yyyy | dd.mm.yyyy | dd/mm/yy
  s = s.replace(re(String.raw`(?<![${W}/.-])(ngày\s+)?(\d{1,2})([/.-])(\d{1,2})\3(\d{4}|\d{2})(?!\d)`), (m, _p, d: string, sep: string, mo: string, y: string) => {
    if (y.length === 2 && sep !== '/') return m;
    if (!ok(+d, +mo)) return m;
    return ' ' + fmt(d, mo, y.length === 2 ? String(2000 + +y) : y) + ' ';
  });
  // tháng/năm  (kèm "tháng" phía trước nếu có)
  s = s.replace(re(String.raw`(?<![${W}/.-])(tháng\s+|quý\s+)?(\d{1,2})/(\d{4})(?![\d/])`), (m, p: string | undefined, mo: string, y: string) => {
    if (p && p.startsWith('quý')) return ` quý ${readNumberToken(mo, lang)} năm ${readNumberToken(y, lang)} `;
    if (+mo < 1 || +mo > 12) return m;
    return vi ? ` tháng ${viMonth(+mo)} năm ${readNumberToken(y, lang)} ` : ` ${MONTHS_EN[+mo - 1]} ${readNumberToken(y, lang)} `;
  });
  // ngày 5/3, ngày 5-3, ngày 5.3 (bắt buộc có "ngày"); dd/mm trần chỉ nhận khi dd > 12 để không nhầm phân số
  s = s.replace(re(String.raw`(?<![${W}/.-])(ngày\s+)?(\d{1,2})([/.-])(\d{1,2})(?![\d/.-]|[${W}])`), (m, p: string | undefined, d: string, sep: string, mo: string) => {
    if (!ok(+d, +mo)) return m;
    if (p) return ' ' + fmt(d, mo) + ' ';
    if (sep === '/' && +d > 12 && !(d === '24' && mo === '7')) return ' ' + fmt(d, mo) + ' ';
    return m;
  });
  return s;
}

function times(s: string, lang: L2): string {
  const vi = lang === 'vi';
  const words = (n: number) => (vi ? intToWordsVi(String(n)) : intToWordsEn(String(n)));
  const minute = (n: number) => (n < 10 ? (vi ? 'không ' : 'oh ') + words(n) : words(n));
  const partOfDay = (h: number, suffix: string | undefined): string => {
    if (!suffix) return '';
    const pm = /^p/i.test(suffix);
    if (!vi) return pm ? ' P M' : ' A M';
    if (!pm) return ' sáng';
    return h < 18 ? ' chiều' : ' tối';
  };
  // hh:mm[:ss] [AM|PM]
  s = s.replace(re(String.raw`(?<![${W}:.])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])(?:\s?([AaPp]\.?[Mm]\.?)(?![${W}]))?`), (m, h: string, mi: string, se: string | undefined, ap: string | undefined) => {
    const hn = +h;
    const mn = +mi;
    if (hn > 24 || mn > 59 || (se !== undefined && +se > 59)) return m;
    if (se !== undefined) {
      return vi
        ? ` ${words(hn)} giờ ${words(mn)} phút ${words(+se)} giây${partOfDay(hn, ap)} `
        : ` ${words(hn)} hours ${words(mn)} minutes ${words(+se)} seconds${partOfDay(hn, ap)} `;
    }
    if (vi) return ` ${words(hn)} giờ${mn ? ' ' + minute(mn) : ''}${partOfDay(hn, ap)} `;
    return ` ${words(hn)}${mn ? ' ' + minute(mn) : " o'clock"}${partOfDay(hn, ap)} `;
  });
  // 14h30, 9h, 14h30p
  s = s.replace(re(String.raw`(?<![${W}.])(\d{1,2})[hH](?:(\d{2})(?:ph|p)?)?(?![${W}])`), (m, h: string, mi: string | undefined) => {
    const hn = +h;
    const mn = mi === undefined ? 0 : +mi;
    if (hn > 24 || mn > 59) return m;
    if (vi) return ` ${words(hn)} giờ${mn ? ' ' + minute(mn) : ''} `;
    return ` ${words(hn)}${mn ? ' ' + minute(mn) : " o'clock"} `;
  });
  return s;
}

function abbreviations(s: string): string {
  const rules: [RegExp, string][] = [
    [re(String.raw`(?<![${W}])(?:TP|Tp)\.?\s?(?:HCM|Hồ Chí Minh)(?![${W}])`), 'Thành phố Hồ Chí Minh'],
    [re(String.raw`(?<![${W}])TPHCM(?![${W}])`), 'Thành phố Hồ Chí Minh'],
    [re(String.raw`(?<![${W}])TP\.\s?(?=\p{Lu})`), 'Thành phố '],
    [re(String.raw`(?<![${W}])Tp\.\s?(?=\p{Lu})`), 'Thành phố '],
    [re(String.raw`(?<![${W}])TT\.\s?(?=\p{Lu})`), 'Thị trấn '],
    [re(String.raw`(?<![${W}])Q\.\s?(?=\d)`), 'quận '],
    [re(String.raw`(?<![${W}])Q\.\s?(?=\p{Lu})`), 'quận '],
    [re(String.raw`(?<![${W}])P\.\s?(?=\d)`), 'phường '],
    [re(String.raw`(?<![${W}])P\.\s?(?=\p{Lu})`), 'phường '],
    [re(String.raw`(?<![${W}])H\.\s?(?=\p{Lu})`), 'huyện '],
    [re(String.raw`(?<![${W}])Q([1-4])(?=\s?[/-]\s?\d{4})`), 'quý $1'],
    [re(String.raw`(?<![${W}])PGS\.?\s?TS\.?`), 'Phó giáo sư Tiến sĩ'],
    [re(String.raw`(?<![${W}])GS\.?\s?TS\.?`), 'Giáo sư Tiến sĩ'],
    [re(String.raw`(?<![${W}])PGS\.\s?`), 'Phó giáo sư '],
    [re(String.raw`(?<![${W}])GS\.\s?`), 'Giáo sư '],
    [re(String.raw`(?<![${W}])TS\.\s?`), 'Tiến sĩ '],
    [re(String.raw`(?<![${W}])ThS\.\s?`), 'Thạc sĩ '],
    [re(String.raw`(?<![${W}])BS\.\s?`), 'Bác sĩ '],
    [re(String.raw`(?<![${W}])KS\.\s?`), 'Kỹ sư '],
    [re(String.raw`(?<![${W}])(?:v\.v|vv)(?![${W}.])`), 'vân vân'],
    [re(String.raw`(?<![${W}])(?:VD|Vd|vd)\s?[:.]`), 'Ví dụ,'],
    [re(String.raw`(?<![${W}])SĐT\s?:?`), 'Số điện thoại: '],
    [re(String.raw`(?<![${W}])UBND(?![${W}])`), 'Ủy ban nhân dân'],
    [re(String.raw`(?<![${W}])HĐND(?![${W}])`), 'Hội đồng nhân dân'],
    [re(String.raw`(?<![${W}])TNHH(?![${W}])`), 'trách nhiệm hữu hạn'],
    [re(String.raw`(?<![${W}])CTCP(?![${W}])`), 'công ty cổ phần'],
    [re(String.raw`(?<![${W}])THPT(?![${W}])`), 'trung học phổ thông'],
    [re(String.raw`(?<![${W}])THCS(?![${W}])`), 'trung học cơ sở'],
    [re(String.raw`(?<![${W}])CSGT(?![${W}])`), 'cảnh sát giao thông'],
    [re(String.raw`(?<![${W}])BHXH(?![${W}])`), 'bảo hiểm xã hội'],
    [re(String.raw`(?<![${W}])BHYT(?![${W}])`), 'bảo hiểm y tế'],
    [re(String.raw`(?<![${W}])CCCD(?![${W}])`), 'căn cước công dân'],
    [re(String.raw`(?<![${W}])CMND(?![${W}])`), 'chứng minh nhân dân'],
    [re(String.raw`(?<![${W}])NXB(?![${W}])`), 'nhà xuất bản'],
    [re(String.raw`(?<![${W}])CLB(?![${W}])`), 'câu lạc bộ'],
    [re(String.raw`(?<![${W}])HĐQT(?![${W}])`), 'hội đồng quản trị'],
    [re(String.raw`(?<![${W}])ĐHQG(?![${W}])`), 'Đại học Quốc gia'],
    [re(String.raw`(?<![${W}])TW(?![${W}])`), 'trung ương'],
    [re(String.raw`(?<![${W}])VN(?![${W}])`), 'Việt Nam'],
    [re(String.raw`(?<![${W}])C#`), 'C thăng'],
  ];
  for (const [r, to] of rules) s = s.replace(r, to);
  s = s.replace(re(String.raw`(?<![${W}])v\.v\.(?=\s|$)`), 'vân vân.');
  return s;
}

/** "100k", "2tr", "2tr5", "1k5" -> số nguyên đầy đủ */
function shortScales(s: string, lang: L2): string {
  return s.replace(re(String.raw`(?<![${W}])(\d+(?:[.,]\d{1,3})?)\s?(k|K|tr|Tr|TR)(\d{1,3})?(?![${W}])`), (m, num: string, unit: string, extra: string | undefined) => {
    try {
      const mult = unit.toLowerCase() === 'k' ? 1000 : 1000000;
      let whole = num;
      let frac = '';
      const sep = num.match(/[.,]/);
      if (sep) {
        const idx = num.indexOf(sep[0]);
        whole = num.slice(0, idx);
        frac = num.slice(idx + 1);
        // 1.500k: dấu chấm ngăn cách hàng nghìn -> không phải số thập phân
        if (frac.length === 3 && sep[0] === '.' && !extra) {
          whole = whole + frac;
          frac = '';
        }
      }
      if (frac && extra) return m;
      const fracDigits = frac || extra || '';
      const padded = fracDigits.padEnd(3, '0');
      const total = BigInt(whole) * BigInt(mult) + BigInt(padded) * BigInt(mult / 1000);
      return ' ' + intWords(total.toString(), lang) + ' ';
    } catch {
      return m;
    }
  });
}

function numbers(s: string, lang: L2): string {
  const vi = lang === 'vi';
  // "thứ 3", "hạng 1": số thứ tự
  if (vi) {
    s = s.replace(re(String.raw`(?<![${W}])(thứ|Thứ|hạng|Hạng)\s+(\d{1,3})(?![\d.,]|[${W}])`), (_m, w: string, n: string) => {
      const v = +n;
      const word = v === 1 ? 'nhất' : v === 4 ? 'tư' : intToWordsVi(String(v));
      return `${w} ${word}`;
    });
    s = s.replace(re(String.raw`(?<![${W}])(tháng|Tháng)\s+(\d{1,2})(?![\d.,/-]|[${W}])`), (m, w: string, n: string) =>
      +n >= 1 && +n <= 12 ? `${w} ${viMonth(+n)}` : m,
    );
  }
  // Tiền ký hiệu đứng trước: $5, €20, US$1,200.50
  s = s.replace(re(String.raw`(US\$|[$€£¥])\s?(\d(?:[\d.,]*\d)?)(?![${W}])`), (_m, cur: string, num: string) => {
    const key = cur === 'US$' ? '$' : cur;
    return ` ${readNumberToken(num, lang)} ${UNITS[key][vi ? 0 : 1]} `;
  });
  // #1 -> số một
  s = s.replace(re(String.raw`#(\d+)(?![${W}])`), (_m, n: string) => ` ${vi ? 'số' : 'number'} ${intWords(n, lang)} `);
  // Phân số / tỉ lệ còn sót: 1/2, 24/7
  s = s.replace(re(String.raw`(?<![${W}.,/])(\d{1,3})/(\d{1,3})(?![\d/]|[${W}])`), (_m, a: string, b: string) => {
    if (vi && a === '24' && b === '7') return ' hai mươi bốn trên bảy ';
    return ` ${intWords(a, lang)} ${vi ? 'phần' : 'over'} ${intWords(b, lang)} `;
  });
  // 16:9 và các tỉ lệ còn sót
  s = s.replace(/(\d):(\d)/g, (_m, a: string, b: string) => `${a} ${vi ? 'trên' : 'to'} ${b}`);
  // Khoảng: 2020-2024, 3-5 ngày
  s = s.replace(/(\d)\s*[-–—]\s*(\d)/g, (_m, a: string, b: string) => `${a} ${vi ? 'đến' : 'to'} ${b}`);
  s = s.replace(/(\d)\s*[-–—]\s*(\d)/g, (_m, a: string, b: string) => `${a} ${vi ? 'đến' : 'to'} ${b}`);

  // Số + đơn vị / %, có thể mang dấu âm
  const main = re(
    String.raw`(?<![${W}])(?:(?<=^|[\s(\[=:>])([-−]))?(\d(?:[\d.,]*\d)?)(?:(?:\s?(${UNIT_ALT})|(${UNIT_NS_ALT}))(?![${W}]))?`,
  );
  s = s.replace(main, (_m, sign: string | undefined, num: string, u1: string | undefined, u2: string | undefined) => {
    const unit = u1 ?? u2;
    let out = readNumberToken(num, lang);
    if (unit) {
      const entry = u1 !== undefined ? UNITS[u1] : UNITS_NOSPACE[unit];
      if (entry) out += ' ' + entry[vi ? 0 : 1];
    }
    if (sign) out = (vi ? 'âm ' : 'minus ') + out;
    return ' ' + out + ' ';
  });
  // Còn sót chữ số dính liền chữ cái (H2O, mp3, iPhone15)
  s = s.replace(/\d+/g, (d) => ' ' + intWords(d, lang) + ' ');
  return s;
}

function symbols(s: string, lang: L2): string {
  const vi = lang === 'vi';
  const sy = (a: string, b: string) => ` ${vi ? a : b} `;
  s = s.replace(/->|=>|→|⇒|➜|➡/g, ', ');
  s = s.replace(/&/g, sy('và', 'and'));
  s = s.replace(/%/g, sy('phần trăm', 'percent'));
  s = s.replace(/≠/g, sy('khác', 'not equal to'));
  s = s.replace(/≤/g, sy('nhỏ hơn hoặc bằng', 'less than or equal to'));
  s = s.replace(/≥/g, sy('lớn hơn hoặc bằng', 'greater than or equal to'));
  s = s.replace(/=/g, sy('bằng', 'equals'));
  s = s.replace(/(^|\s)<(\s|$)/g, `$1${vi ? 'nhỏ hơn' : 'less than'}$2`);
  s = s.replace(/(^|\s)>(\s|$)/g, `$1${vi ? 'lớn hơn' : 'greater than'}$2`);
  s = s.replace(/\+/g, sy('cộng', 'plus'));
  s = s.replace(/×/g, sy('nhân', 'times'));
  s = s.replace(/÷/g, sy('chia', 'divided by'));
  s = s.replace(/@/g, sy('a còng', 'at'));
  s = s.replace(/~/g, sy('khoảng', 'about'));
  s = s.replace(/°/g, sy('độ', 'degrees'));
  s = s.replace(/(\p{L})\s?\/(?=\p{L})/gu, '$1 ');
  s = s.replace(/[“”„«»"]/g, ' ');
  s = s.replace(/[‘’]/g, "'");
  s = s.replace(/[\\^_{}[\]*#|]/g, ' ');
  s = s.replace(/\s[-–—]+\s/g, ', ');
  s = s.replace(/[–—]/g, ', ');
  s = s.replace(/^\s*[-–—]+\s*/gm, '');
  return s;
}

function tidy(s: string): string {
  return s
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t  -  　]+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
        .replace(/^[\s,;:]+/, '')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface NormalizeOptions {
  /** 'vi' | 'en': chuẩn hóa số/ngày/tiền...; 'none': chỉ bỏ markdown/emoji và gộp khoảng trắng */
  lang: NormLang;
}

/** Hàm thuần: chuẩn hóa văn bản để giọng đọc tự nhiên hơn. Không bao giờ ném lỗi. */
export function normalizeForSpeech(input: string, opts: NormalizeOptions = { lang: 'vi' }): string {
  try {
    let s = stripMarkup(input ?? '');
    if (opts.lang === 'none') return tidy(s);
    const lang: L2 = opts.lang;
    s = emailsAndUrls(s, lang);
    if (lang === 'vi') s = abbreviations(s);
    s = phones(s, lang);
    s = dates(s, lang);
    s = times(s, lang);
    s = shortScales(s, lang);
    s = numbers(s, lang);
    s = symbols(s, lang);
    return tidy(s);
  } catch {
    return tidy(input ?? '');
  }
}

/* ------------------------------------------------------------------ */
/* Nhận diện ngôn ngữ                                                  */
/* ------------------------------------------------------------------ */

export type DetectedLang = 'vi' | 'en' | 'zh' | 'ja' | 'ko' | 'ru' | 'th' | 'ar' | 'hi' | 'el' | 'he';

const VI_STRONG = /[đơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹĐƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]/g;
const VI_PLAIN_WORDS = new Set(['va', 'la', 'cua', 'khong', 'nguoi', 'duoc', 'nhung', 'voi', 'cho', 'mot', 'cac', 'trong', 'nay', 'toi', 'ban', 'cung', 'nhu', 'co', 'da', 'se', 'rat', 'nhieu', 'xin', 'chao', 'cam', 'on']);

export function detectLanguage(text: string): DetectedLang {
  const sample = text.slice(0, 3000);
  const c = { hangul: 0, kana: 0, han: 0, cyr: 0, thai: 0, arab: 0, deva: 0, greek: 0, hebrew: 0, latin: 0 };
  for (const ch of sample) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f)) c.hangul++;
    else if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff)) c.kana++;
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) c.han++;
    else if (cp >= 0x0400 && cp <= 0x052f) c.cyr++;
    else if (cp >= 0x0e00 && cp <= 0x0e7f) c.thai++;
    else if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f)) c.arab++;
    else if (cp >= 0x0900 && cp <= 0x097f) c.deva++;
    else if (cp >= 0x0370 && cp <= 0x03ff) c.greek++;
    else if (cp >= 0x0590 && cp <= 0x05ff) c.hebrew++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff)) c.latin++;
  }
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (total === 0) return 'en';
  if (c.kana > 0 && c.kana + c.han >= total * 0.3) return 'ja';
  const best = (Object.entries(c) as [keyof typeof c, number][]).filter(([k]) => k !== 'latin').sort((a, b) => b[1] - a[1])[0];
  if (best[1] > 0 && best[1] >= total * 0.3 && best[1] >= c.latin) {
    const map: Record<string, DetectedLang> = { hangul: 'ko', han: 'zh', cyr: 'ru', thai: 'th', arab: 'ar', deva: 'hi', greek: 'el', hebrew: 'he', kana: 'ja' };
    return map[best[0]];
  }
  // Chữ Latin: Việt hay Anh
  const strong = (sample.match(VI_STRONG) || []).length;
  if (strong >= 2 || (strong >= 1 && strong / Math.max(1, c.latin) > 0.02)) return 'vi';
  const words = sample.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length >= 4) {
    const hits = words.filter((w) => VI_PLAIN_WORDS.has(w)).length;
    if (hits >= 3 && hits / words.length > 0.15) return 'vi';
  }
  return 'en';
}

export const LANG_BCP47: Record<DetectedLang, string> = {
  vi: 'vi-VN', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ru: 'ru-RU', th: 'th-TH', ar: 'ar-SA', hi: 'hi-IN', el: 'el-GR', he: 'he-IL',
};

/* ------------------------------------------------------------------ */
/* Chia câu / cụm để đọc nối tiếp                                      */
/* ------------------------------------------------------------------ */

export interface SpeechChunk {
  text: string;
  /** Bắt đầu một đoạn mới (xuống dòng) - dùng để hiển thị */
  newPara: boolean;
}

const HARD_END = '.!?…。！？';
const CLOSERS = '"\')]”’»';

function splitByClauses(s: string, maxLen: number): string[] {
  if (s.length <= maxLen) return [s];
  // 1) theo dấu phẩy/chấm phẩy/hai chấm...
  const clauses: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    cur += s[i];
    const ch = s[i];
    const isCjk = '，；：、'.includes(ch);
    if ((isCjk || ',;:–—'.includes(ch)) && (isCjk || s[i + 1] === ' ' || s[i + 1] === undefined)) {
      clauses.push(cur);
      cur = '';
    }
  }
  if (cur) clauses.push(cur);
  // 2) gộp lại tới giới hạn, cụm quá dài thì cắt theo từ / cắt cứng
  const out: string[] = [];
  let buf = '';
  const pushBuf = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };
  for (const cl of clauses) {
    if (cl.length > maxLen) {
      pushBuf();
      let rest = cl;
      while (rest.length > maxLen) {
        let cut = rest.lastIndexOf(' ', maxLen);
        if (cut < maxLen * 0.4) cut = maxLen;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut);
      }
      buf = rest;
    } else if ((buf + cl).length > maxLen) {
      pushBuf();
      buf = cl;
    } else {
      buf += cl;
    }
  }
  pushBuf();
  return out;
}

/**
 * Chia văn bản thành các câu/cụm <= maxLen ký tự. Ranh giới câu: . ! ? … (khi theo sau là khoảng trắng/hết dòng),
 * dấu câu CJK và xuống dòng.
 */
export function splitIntoChunks(text: string, maxLen = 180): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let newPara = true;
  for (const line of lines) {
    if (!line.trim()) {
      newPara = true;
      continue;
    }
    const sentences: string[] = [];
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      cur += ch;
      if (HARD_END.includes(ch)) {
        const cjk = '。！？'.includes(ch);
        const next = line[i + 1];
        // gom chuỗi dấu kết thúc/ngoặc đóng ("...", "?!", .")
        if (next !== undefined && (HARD_END.includes(next) || CLOSERS.includes(next))) continue;
        if (cjk || next === undefined || /\s/.test(next)) {
          sentences.push(cur);
          cur = '';
        }
      }
    }
    if (cur.trim()) sentences.push(cur);
    for (const sen of sentences) {
      for (const piece of splitByClauses(sen.trim(), maxLen)) {
        if (!/[\p{L}\p{N}]/u.test(piece)) continue; // chỉ có dấu câu: bỏ
        chunks.push({ text: piece, newPara });
        newPara = false;
      }
    }
    newPara = true;
  }
  // Gộp mảnh quá ngắn (< 3 ký tự chữ) vào mảnh kế tiếp
  const merged: SpeechChunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const letters = ch.text.replace(/[^\p{L}\p{N}]/gu, '').length;
    if (letters < 3 && !/[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(ch.text) && i + 1 < chunks.length && !chunks[i + 1].newPara && (ch.text + ' ' + chunks[i + 1].text).length <= maxLen) {
      chunks[i + 1] = { text: ch.text + ' ' + chunks[i + 1].text, newPara: ch.newPara };
      continue;
    }
    merged.push(ch);
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Giọng đọc của trình duyệt                                           */
/* ------------------------------------------------------------------ */

export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default?: boolean;
}

const LANG3: Record<string, string> = { vie: 'vi', eng: 'en', zho: 'zh', cmn: 'zh', kor: 'ko', jpn: 'ja', rus: 'ru', tha: 'th', fra: 'fr', deu: 'de', spa: 'es' };

/** 'vi_VN' | 'vi-VN' | 'vie-VNM' -> 'vi' */
export function langPrimary(lang: string): string {
  const p = (lang || '').toLowerCase().replace('_', '-').split('-')[0];
  return LANG3[p] || p;
}

const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph)\b/i;

export function scoreVoice(v: VoiceLike, target: string): number {
  let score = 0;
  const tp = langPrimary(target);
  if (langPrimary(v.lang) === tp) score += 100;
  if (v.lang.toLowerCase().replace('_', '-') === (LANG_BCP47[tp as DetectedLang] || '').toLowerCase()) score += 8;
  if (/natural|neural|online|enhanced|premium/i.test(v.name)) score += 15;
  if (/google/i.test(v.name)) score += 8;
  if (/microsoft/i.test(v.name)) score += 5;
  if (v.localService) score += 6;
  if (v.default) score += 2;
  if (/compact/i.test(v.name)) score -= 3;
  if (NOVELTY.test(v.name)) score -= 100;
  return score;
}

/** Giọng phù hợp nhất cho một ngôn ngữ; fallbackToAny: nếu không có giọng đúng ngôn ngữ thì chọn giọng tốt nhất còn lại */
export function pickBestVoice<T extends VoiceLike>(voices: T[], lang: string, fallbackToAny = true): { voice: T | null; exact: boolean } {
  if (!voices.length) return { voice: null, exact: false };
  const tp = langPrimary(lang);
  const same = voices.filter((v) => langPrimary(v.lang) === tp);
  const pool = same.length ? same : fallbackToAny ? voices : [];
  if (!pool.length) return { voice: null, exact: false };
  const sorted = [...pool].sort((a, b) => scoreVoice(b, lang) - scoreVoice(a, lang));
  return { voice: sorted[0], exact: same.length > 0 };
}

export function langLabel(code: string): string {
  const p = langPrimary(code);
  try {
    const dn = new Intl.DisplayNames(['vi'], { type: 'language' });
    const name = dn.of(p);
    if (name && name !== p) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    /* môi trường không có Intl.DisplayNames */
  }
  return p.toUpperCase();
}

export interface VoiceGroup<T extends VoiceLike> {
  lang: string;
  label: string;
  voices: T[];
}

/** Nhóm theo ngôn ngữ: tiếng Việt đầu tiên, rồi các ngôn ngữ ưu tiên, còn lại theo bảng chữ cái */
export function groupVoicesByLang<T extends VoiceLike>(voices: T[], priority: string[] = ['vi', 'en']): VoiceGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const v of voices) {
    const k = langPrimary(v.lang) || 'other';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(v);
  }
  const groups: VoiceGroup<T>[] = [...map.entries()].map(([lang, vs]) => ({
    lang,
    label: langLabel(lang),
    voices: vs.sort((a, b) => scoreVoice(b, lang) - scoreVoice(a, lang) || a.name.localeCompare(b.name)),
  }));
  const rank = (g: VoiceGroup<T>) => {
    const i = priority.indexOf(g.lang);
    return i === -1 ? priority.length : i;
  };
  return groups.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'vi'));
}

export function filterVoices<T extends VoiceLike>(voices: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return voices;
  return voices.filter((v) => `${v.name} ${v.lang} ${langLabel(v.lang)}`.toLowerCase().includes(q));
}

/* ------------------------------------------------------------------ */
/* Hướng dẫn cài giọng tiếng Việt                                      */
/* ------------------------------------------------------------------ */

export interface VoiceGuide {
  os: string;
  steps: string;
}

export function viVoiceGuides(): VoiceGuide[] {
  return [
    { os: 'Windows 10/11', steps: 'Cài đặt → Thời gian & Ngôn ngữ → Giọng nói (Speech) → Thêm giọng → chọn Tiếng Việt (Vietnamese). Khởi động lại trình duyệt. Trên Microsoft Edge còn có giọng "HoaiMy" / "NamMinh" (Online/Natural) miễn phí.' },
    { os: 'macOS', steps: 'Cài đặt hệ thống → Trợ năng → Nội dung được đọc (Spoken Content) → Giọng hệ thống → Quản lý giọng nói → tải "Tiếng Việt - Linh". Khởi động lại trình duyệt.' },
    { os: 'Android', steps: 'Cài đặt → Hệ thống → Ngôn ngữ & nhập liệu → Đầu ra văn bản thành giọng nói → Công cụ ưu tiên: Dịch vụ giọng nói của Google → Cài đặt dữ liệu giọng nói → Tiếng Việt. Dùng Chrome để có nhiều giọng nhất.' },
    { os: 'iPhone / iPad', steps: 'Cài đặt → Trợ năng → Nội dung được đọc → Giọng nói → Tiếng Việt → tải giọng "Linh". Safari yêu cầu bấm nút đọc thủ công (không tự phát).' },
    { os: 'Linux / Firefox', steps: 'Cài speech-dispatcher và một công cụ như espeak-ng (có tiếng Việt) rồi khởi động lại Firefox; hoặc dùng Chrome / Edge.' },
  ];
}

/* ------------------------------------------------------------------ */
/* Tốc độ ước lượng thời gian đọc                                      */
/* ------------------------------------------------------------------ */

/** Ước lượng giây đọc (≈ 14 ký tự/giây ở rate 1) */
export function estimateSeconds(text: string, rate: number): number {
  const chars = text.replace(/\s+/g, ' ').length;
  const cps = /[぀-ヿ一-鿿가-힯]/.test(text) ? 5 : 14;
  return Math.round(chars / (cps * Math.max(0.1, rate)));
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} phút ${s} giây` : `${s} giây`;
}
