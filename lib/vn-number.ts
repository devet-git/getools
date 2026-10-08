/** Đọc số thành chữ (tiếng Việt, kèm tiếng Anh cơ bản). Dùng BigInt nên không mất chính xác với số lớn. */

const D = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Đọc nhóm 3 chữ số (0–999). `full` = có chữ số hàng trăm đứng trước nhóm cao hơn → đọc "không trăm", "lẻ". */
function readTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  const out: string[] = [];
  if (h > 0 || full) out.push(D[h], 'trăm');
  if (t === 0) {
    if (u > 0) { if (h > 0 || full) out.push('lẻ'); out.push(D[u]); }
  } else if (t === 1) {
    out.push('mười');
    if (u === 5) out.push('lăm'); else if (u > 0) out.push(D[u]);
  } else {
    out.push(D[t], 'mươi');
    if (u === 1) out.push('mốt'); else if (u === 4) out.push('tư'); else if (u === 5) out.push('lăm'); else if (u > 0) out.push(D[u]);
  }
  return out.join(' ');
}

function readBlock(n: number, full: boolean): string {
  // n < 1e9: [triệu][nghìn][đơn vị]
  const parts = [Math.floor(n / 1e6), Math.floor((n % 1e6) / 1e3), n % 1e3];
  const names = ['triệu', 'nghìn', ''];
  const out: string[] = [];
  let started = full;
  parts.forEach((p, i) => {
    if (p === 0) return;
    out.push(readTriple(p, started), names[i]);
    started = true;
  });
  return out.filter(Boolean).join(' ');
}

export function intToVietnamese(v: bigint): string {
  if (v === BigInt(0)) return 'không';
  const neg = v < BigInt(0);
  let x = neg ? -v : v;
  const B = BigInt(1e9);
  const blocks: number[] = [];
  while (x > BigInt(0)) { blocks.push(Number(x % B)); x /= B; }
  const out: string[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b === 0) continue;
    // khối thấp hơn khối có giá trị phía trên → cần đọc "không trăm"
    out.push(readBlock(b, i < blocks.length - 1 && blocks.slice(i + 1).some((q) => q > 0)));
    for (let k = 0; k < i; k++) out.push('tỷ');
  }
  return (neg ? 'âm ' : '') + out.join(' ').replace(/\s+/g, ' ').trim();
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALE = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion'];

function enTriple(n: number): string {
  const out: string[] = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; if (n) out.push('and'); }
  if (n >= 20) { const t = TENS[Math.floor(n / 10)]; out.push(n % 10 ? `${t}-${ONES[n % 10]}` : t); }
  else if (n > 0) out.push(ONES[n]);
  return out.join(' ');
}

export function intToEnglish(v: bigint): string {
  if (v === BigInt(0)) return 'zero';
  const neg = v < BigInt(0);
  let x = neg ? -v : v;
  const T = BigInt(1000);
  const parts: string[] = [];
  let i = 0;
  while (x > BigInt(0)) {
    const g = Number(x % T);
    if (g) parts.unshift(`${enTriple(g)}${SCALE[i] ? ' ' + SCALE[i] : ''}`);
    x /= T; i++;
    if (i > SCALE.length) return '';
  }
  return (neg ? 'minus ' : '') + parts.join(' ');
}

export interface ParsedNumber { neg: boolean; int: bigint; frac: string }

/** Chấp nhận 1.234.567,89 · 1,234,567.89 · 1234567 · -5 · 2tr · 3k. Trả null nếu không hiểu. */
export function parseNumberInput(raw: string): ParsedNumber | null {
  let s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  let neg = false;
  if (s.startsWith('-') || s.startsWith('−')) { neg = true; s = s.slice(1); }
  // dạng rút gọn kiểu Việt: 2tr5 = 2,5 triệu, 1tỷ2 = 1,2 tỷ, 3k5 = 3,5 nghìn
  const short = s.match(/^(\d+)(k|nghìn|ngàn|tr|triệu|tỷ|ty)(\d+)$/);
  if (short) s = `${short[1]}.${short[3]}${short[2]}`;
  let mult = 1;
  const m = s.match(/(k|nghìn|ngàn|tr|triệu|tỷ|ty)$/);
  if (m) {
    mult = m[1] === 'k' || m[1] === 'nghìn' || m[1] === 'ngàn' ? 1e3 : m[1] === 'tr' || m[1] === 'triệu' ? 1e6 : 1e9;
    s = s.slice(0, -m[1].length);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let intPart = s, frac = '';
  const sepIdx = Math.max(lastDot, lastComma);
  if (sepIdx >= 0) {
    const after = s.slice(sepIdx + 1);
    const sepChar = s[sepIdx];
    const count = s.split(sepChar).length - 1;
    // một dấu duy nhất + đúng 3 chữ số sau = ngăn cách hàng nghìn; còn lại = phần thập phân
    const isThousands = count > 1 || after.length === 3;
    if (!isThousands || (lastDot >= 0 && lastComma >= 0)) { intPart = s.slice(0, sepIdx); frac = after; }
  }
  intPart = intPart.replace(/[.,]/g, '') || '0';
  frac = frac.replace(/[.,]/g, '');
  let int = BigInt(intPart);
  if (mult > 1) {
    const f = frac.padEnd(9, '0');
    const scaled = int * BigInt(mult) + BigInt(f.slice(0, 9)) * BigInt(mult) / BigInt(1e9);
    int = scaled; frac = '';
  }
  return { neg, int, frac };
}

export interface WordsOptions {
  lang: 'vi' | 'en';
  unit: string;
  capitalize: boolean;
  suffixChan: boolean;
}

export function numberToWords(p: ParsedNumber, o: WordsOptions): string {
  const sign = p.neg && (p.int > BigInt(0) || /[1-9]/.test(p.frac));
  const val = sign ? -p.int : p.int;
  let s: string;
  if (o.lang === 'vi') {
    s = intToVietnamese(val === BigInt(0) && sign ? BigInt(0) : val);
    if (p.frac) s += ' phẩy ' + p.frac.split('').map((c) => D[Number(c)]).join(' ');
  } else {
    s = intToEnglish(val);
    if (p.frac) s += ' point ' + p.frac.split('').map((c) => ONES[Number(c)]).join(' ');
  }
  if (o.unit.trim()) s += ' ' + o.unit.trim();
  if (o.lang === 'vi' && o.suffixChan && o.unit.trim() && !p.frac) s += ' chẵn';
  return o.capitalize && s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
