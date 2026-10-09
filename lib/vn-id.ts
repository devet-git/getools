// Kiểm tra CẤU TRÚC giấy tờ / số điện thoại Việt Nam. Không xác nhận giấy tờ có thật hay còn hiệu lực.

// ─── Mã số thuế ──────────────────────────────────────────────────────────────

export interface MstResult { valid: boolean; kind: '10' | '13' | null; reason?: string }

const MST_W = [31, 29, 23, 19, 17, 13, 7, 5, 3];

export function checkMst(raw: string): MstResult {
  const s = raw.trim().replace(/[\s.]/g, '').replace(/^(\d{10})-(\d{3})$/, '$1$2');
  if (!/^\d+$/.test(s)) return { valid: false, kind: null, reason: 'Chỉ gồm chữ số (có thể có dấu "-" trước 3 số chi nhánh).' };
  if (s.length !== 10 && s.length !== 13) return { valid: false, kind: null, reason: 'Mã số thuế gồm 10 hoặc 13 chữ số.' };
  const sum = MST_W.reduce((acc, w, i) => acc + w * Number(s[i]), 0);
  // c = 10 − (sum mod 11); hợp lệ khi c ≤ 9 và trùng chữ số thứ 10
  const c = 10 - (sum % 11);
  if (c > 9 || c !== Number(s[9])) return { valid: false, kind: s.length === 13 ? '13' : '10', reason: `Chữ số kiểm tra không khớp (mong đợi ${c > 9 ? 'không có giá trị hợp lệ' : c}).` };
  return { valid: true, kind: s.length === 13 ? '13' : '10' };
}

// ─── CCCD 12 số ──────────────────────────────────────────────────────────────

/** Mã tỉnh/thành theo CCCD 12 số (theo đơn vị hành chính cũ, trước sáp nhập 2025 — mã trên thẻ không đổi). */
export const PROVINCES: Record<string, string> = {
  '001': 'Hà Nội', '002': 'Hà Giang', '004': 'Cao Bằng', '006': 'Bắc Kạn', '008': 'Tuyên Quang', '010': 'Lào Cai',
  '011': 'Điện Biên', '012': 'Lai Châu', '014': 'Sơn La', '015': 'Yên Bái', '017': 'Hòa Bình', '019': 'Thái Nguyên',
  '020': 'Lạng Sơn', '022': 'Quảng Ninh', '024': 'Bắc Giang', '025': 'Phú Thọ', '026': 'Vĩnh Phúc', '027': 'Bắc Ninh',
  '030': 'Hải Dương', '031': 'Hải Phòng', '033': 'Hưng Yên', '034': 'Thái Bình', '035': 'Hà Nam', '036': 'Nam Định',
  '037': 'Ninh Bình', '038': 'Thanh Hóa', '040': 'Nghệ An', '042': 'Hà Tĩnh', '044': 'Quảng Bình', '045': 'Quảng Trị',
  '046': 'Thừa Thiên Huế', '048': 'Đà Nẵng', '049': 'Quảng Nam', '051': 'Quảng Ngãi', '052': 'Bình Định', '054': 'Phú Yên',
  '056': 'Khánh Hòa', '058': 'Ninh Thuận', '060': 'Bình Thuận', '062': 'Kon Tum', '064': 'Gia Lai', '066': 'Đắk Lắk',
  '067': 'Đắk Nông', '068': 'Lâm Đồng', '070': 'Bình Phước', '072': 'Tây Ninh', '074': 'Bình Dương', '075': 'Đồng Nai',
  '077': 'Bà Rịa - Vũng Tàu', '079': 'TP. Hồ Chí Minh', '080': 'Long An', '082': 'Tiền Giang', '083': 'Bến Tre',
  '084': 'Trà Vinh', '086': 'Vĩnh Long', '087': 'Đồng Tháp', '089': 'An Giang', '091': 'Kiên Giang', '092': 'Cần Thơ',
  '093': 'Hậu Giang', '094': 'Sóc Trăng', '095': 'Bạc Liêu', '096': 'Cà Mau',
};

export interface CccdResult {
  valid: boolean;
  reason?: string;
  province?: string;
  gender?: 'Nam' | 'Nữ';
  birthYear?: number;
}

/** Ký tự thứ 4 mã hóa giới tính + thế kỷ sinh: 0/1 = thế kỷ 20, 2/3 = 21, ... (chẵn = nam, lẻ = nữ). */
export function checkCccd(raw: string, nowYear = new Date().getFullYear()): CccdResult {
  const s = raw.trim().replace(/\s/g, '');
  if (!/^\d{12}$/.test(s)) return { valid: false, reason: 'CCCD gồm đúng 12 chữ số (CMND cũ 9 số có cấu trúc khác, không hỗ trợ).' };
  const province = PROVINCES[s.slice(0, 3)];
  if (!province) return { valid: false, reason: `Mã tỉnh ${s.slice(0, 3)} không tồn tại.` };
  const g = Number(s[3]);
  const century = 19 + Math.floor(g / 2);
  const birthYear = century * 100 + Number(s.slice(4, 6));
  if (birthYear > nowYear) return { valid: false, reason: `Năm sinh suy ra (${birthYear}) ở tương lai.`, province };
  return { valid: true, province, gender: g % 2 === 0 ? 'Nam' : 'Nữ', birthYear };
}

// ─── Số điện thoại ───────────────────────────────────────────────────────────

const CARRIERS: Record<string, string> = {};
const add = (name: string, prefixes: string[]) => prefixes.forEach((p) => { CARRIERS[p] = name; });
add('Viettel', ['032', '033', '034', '035', '036', '037', '038', '039', '086', '096', '097', '098']);
add('VinaPhone', ['081', '082', '083', '084', '085', '088', '091', '094']);
add('MobiFone', ['070', '076', '077', '078', '079', '089', '090', '093']);
add('Vietnamobile', ['052', '056', '058', '092']);
add('Gmobile', ['059', '099']);

export interface PhoneResult { valid: boolean; reason?: string; national?: string; international?: string; carrier?: string }

/** Chuẩn hóa số di động VN: chấp nhận 0xxxxxxxxx, +84xxxxxxxxx, 84xxxxxxxxx, có khoảng trắng/dấu chấm. */
export function checkPhone(raw: string): PhoneResult {
  let s = raw.trim().replace(/[\s.\-()]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('0084')) s = '0' + s.slice(4);
  else if (/^84\d{9}$/.test(s)) s = '0' + s.slice(2);
  if (!/^\d+$/.test(s)) return { valid: false, reason: 'Chỉ gồm chữ số (và dấu +84 ở đầu).' };
  if (s.length !== 10) return { valid: false, reason: 'Số di động Việt Nam gồm 10 chữ số (sau khi bỏ +84 thành 0).' };
  const carrier = CARRIERS[s.slice(0, 3)];
  if (!carrier) return { valid: false, reason: `Đầu số ${s.slice(0, 3)} không phải đầu số di động đang dùng.` };
  return { valid: true, national: s, international: '+84' + s.slice(1), carrier };
}
