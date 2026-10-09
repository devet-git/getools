// Cụm từ mật khẩu (passphrase) và ước lượng độ mạnh mật khẩu.
import { randomInt } from '@/lib/encoders';

/** Từ tiếng Việt thông dụng, không dấu, dễ gõ & dễ nhớ (~8 bit entropy mỗi từ, tính chính xác theo số từ khác nhau bên dưới). */
export const WORDS: readonly string[] = [
  'an', 'anh', 'ao', 'bac', 'ban', 'bang', 'bao', 'bay', 'be', 'bep', 'bien', 'binh', 'bo', 'boi', 'bong', 'buoi',
  'bup', 'but', 'ca', 'cam', 'can', 'cao', 'cat', 'cay', 'cha', 'chai', 'chan', 'chao', 'chim', 'cho', 'chua', 'chuoi',
  'chuot', 'co', 'coc', 'cong', 'cu', 'cua', 'cuoi', 'da', 'dai', 'dao', 'dat', 'den', 'dep', 'dinh', 'do', 'doi',
  'dong', 'du', 'dua', 'duong', 'e', 'em', 'ga', 'gai', 'gao', 'gay', 'gia', 'giay', 'gio', 'giong', 'goi', 'gom',
  'gong', 'gu', 'ha', 'hai', 'han', 'hat', 'hay', 'he', 'hoa', 'hoc', 'hong', 'hop', 'hu', 'huong', 'khach', 'khan',
  'khe', 'khi', 'kho', 'khoai', 'khuon', 'kim', 'kinh', 'ky', 'la', 'lan', 'lang', 'lau', 'le', 'len', 'lieu', 'linh',
  'lo', 'loa', 'long', 'lua', 'luoi', 'ly', 'ma', 'mai', 'mam', 'mang', 'mat', 'may', 'me', 'mia', 'mo', 'moc',
  'mua', 'muoi', 'mut', 'na', 'nam', 'nap', 'nen', 'ngan', 'ngoi', 'ngua', 'nguoi', 'nha', 'nhan', 'nhat', 'nhim', 'nho',
  'nhom', 'non', 'nong', 'nu', 'nui', 'nuoc', 'oc', 'om', 'pho', 'phong', 'pin', 'qua', 'quan', 'que', 'quyen', 'rau',
  'ray', 'ren', 'rong', 'ru', 'rua', 'ruou', 'sach', 'sang', 'sao', 'sau', 'se', 'si', 'song', 'su', 'suoi', 'sua',
  'ta', 'tai', 'tam', 'tay', 'te', 'tem', 'thang', 'thanh', 'thap', 'thu', 'thuyen', 'tim', 'tinh', 'to', 'toi', 'tom',
  'ton', 'tra', 'tranh', 'tre', 'tro', 'troi', 'trung', 'tu', 'tua', 'tui', 'tuong', 'ty', 'va', 'vai', 'van', 'vang',
  've', 'vi', 'vien', 'vit', 'vo', 'voi', 'vuon', 'vui', 'xa', 'xanh', 'xe', 'xem', 'xep', 'xinh', 'xoai', 'xuan',
  'y', 'yen', 'ban', 'chieu', 'cua so', 'dem', 'dieu', 'gac', 'giang', 'hien', 'khoa', 'lop', 'mua he', 'ngay', 'oanh', 'phao',
  'quat', 'rem', 'son', 'tap', 'thung', 'ut', 'vach', 'xuong', 'banh', 'canh', 'dua hau', 'gach', 'khay', 'lich', 'mien', 'nhac',
].map((w) => w.replace(/\s+/g, ''));

// Loại từ trùng để entropy tính theo số từ thật sự khác nhau.
const UNIQUE = Array.from(new Set(WORDS));
export const WORD_LIST: readonly string[] = UNIQUE;
export const WORD_BITS = Math.log2(WORD_LIST.length);

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  appendNumber: boolean;
}

export const DEFAULT_PASSPHRASE: PassphraseOptions = { words: 6, separator: '-', capitalize: false, appendNumber: true };

export function generatePassphrase(o: PassphraseOptions): string {
  const n = Math.max(2, Math.min(12, Math.floor(o.words) || 2));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const w = WORD_LIST[randomInt(WORD_LIST.length)];
    out.push(o.capitalize ? w[0].toUpperCase() + w.slice(1) : w);
  }
  if (o.appendNumber) out.push(String(randomInt(100)));
  return out.join(o.separator);
}

export function passphraseEntropyBits(o: PassphraseOptions): number {
  const n = Math.max(2, Math.min(12, Math.floor(o.words) || 2));
  return Math.round(n * WORD_BITS + (o.appendNumber ? Math.log2(100) : 0));
}

export type Strength = { bits: number; label: string; level: 0 | 1 | 2 | 3 | 4; warnings: string[] };

const COMMON = ['password', 'matkhau', '123456', '12345678', 'qwerty', 'abc123', 'iloveyou', 'admin', 'letmein', '111111', 'welcome', '000000'];

/**
 * Ước lượng thô entropy của một mật khẩu do người dùng tự nghĩ ra.
 * Không thay thế công cụ như zxcvbn: chỉ trừ điểm cho các mẫu hiển nhiên (từ phổ biến, lặp, dãy liên tiếp).
 */
export function estimateStrength(pw: string): Strength {
  const warnings: string[] = [];
  if (!pw) return { bits: 0, label: 'Chưa nhập', level: 0, warnings };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
  let bits = pw.length * Math.log2(Math.max(pool, 2));

  const lower = pw.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) { bits = Math.min(bits, 20); warnings.push('Chứa chuỗi rất phổ biến (vd. password, 123456).'); }
  if (/^(.)\1+$/.test(pw)) { bits = Math.min(bits, 8); warnings.push('Chỉ gồm một ký tự lặp lại.'); }
  else if (/(.)\1{2,}/.test(pw)) { bits *= 0.85; warnings.push('Có ký tự lặp ≥ 3 lần liên tiếp.'); }
  if (hasSequence(lower)) { bits *= 0.85; warnings.push('Có dãy liên tiếp (abc, 123, qwe...).'); }
  if (/^[A-Za-z]+\d{1,4}$/.test(pw)) { bits *= 0.8; warnings.push('Dạng "chữ + vài số" rất dễ đoán.'); }
  if (pw.length < 10) warnings.push('Nên dài ít nhất 12 ký tự.');

  bits = Math.round(bits);
  const level = bits < 28 ? 1 : bits < 50 ? 2 : bits < 75 ? 3 : 4;
  return { bits, level, label: ['Chưa nhập', 'Rất yếu', 'Yếu', 'Khá', 'Mạnh'][level], warnings };
}

function hasSequence(s: string): boolean {
  const runs = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  for (const r of runs) {
    for (let i = 0; i + 3 <= r.length; i++) {
      const seg = r.slice(i, i + 3);
      if (s.includes(seg) || s.includes([...seg].reverse().join(''))) return true;
    }
  }
  return false;
}

/** Thời gian thô để dò hết ở tốc độ 10^10 phép thử/giây (GPU hash nhanh) — mang tính minh họa. */
export function crackTimeLabel(bits: number): string {
  const seconds = 2 ** Math.max(0, bits - 1) / 1e10;
  if (seconds < 1) return 'dưới 1 giây';
  const units: [number, string][] = [[31_557_600 * 1e9, 'tỷ năm'], [31_557_600 * 1e6, 'triệu năm'], [31_557_600 * 1e3, 'nghìn năm'], [31_557_600, 'năm'], [86400, 'ngày'], [3600, 'giờ'], [60, 'phút'], [1, 'giây']];
  for (const [sec, name] of units) if (seconds >= sec) return `~${Math.round(seconds / sec).toLocaleString('vi-VN')} ${name}`;
  return 'dưới 1 giây';
}
