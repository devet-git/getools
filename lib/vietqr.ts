// Tạo chuỗi VietQR (chuẩn EMVCo / NAPAS 247) để chuyển khoản nhanh tới tài khoản ngân hàng.

export interface Bank { code: string; name: string; bin: string }

/** Mã BIN do NAPAS cấp cho các ngân hàng phổ biến. Ngân hàng khác: nhập BIN thủ công. */
export const BANKS: Bank[] = [
  { code: 'VCB', name: 'Vietcombank', bin: '970436' },
  { code: 'CTG', name: 'VietinBank', bin: '970415' },
  { code: 'BIDV', name: 'BIDV', bin: '970418' },
  { code: 'AGR', name: 'Agribank', bin: '970405' },
  { code: 'TCB', name: 'Techcombank', bin: '970407' },
  { code: 'MB', name: 'MB Bank', bin: '970422' },
  { code: 'ACB', name: 'ACB', bin: '970416' },
  { code: 'VPB', name: 'VPBank', bin: '970432' },
  { code: 'TPB', name: 'TPBank', bin: '970423' },
  { code: 'STB', name: 'Sacombank', bin: '970403' },
  { code: 'HDB', name: 'HDBank', bin: '970437' },
  { code: 'VIB', name: 'VIB', bin: '970441' },
  { code: 'SHB', name: 'SHB', bin: '970443' },
  { code: 'OCB', name: 'OCB', bin: '970448' },
  { code: 'MSB', name: 'MSB', bin: '970426' },
  { code: 'SEAB', name: 'SeABank', bin: '970440' },
  { code: 'EIB', name: 'Eximbank', bin: '970431' },
  { code: 'LPB', name: 'LPBank', bin: '970449' },
  { code: 'NAB', name: 'Nam A Bank', bin: '970428' },
  { code: 'ABB', name: 'ABBank', bin: '970425' },
];

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — checksum bắt buộc của chuẩn EMVCo. */
export function crc16(s: string): string {
  let crc = 0xffff;
  const bytes = new TextEncoder().encode(s);
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id: string, value: string): string => {
  if (value.length > 99) throw new Error('Trường dữ liệu quá dài.');
  return id + String(value.length).padStart(2, '0') + value;
};

/** Bỏ dấu & ký tự đặc biệt để nội dung chuyển khoản tương thích mọi app ngân hàng. */
export function sanitizeMemo(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 .,\-_/]/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
}

export interface VietQrInput {
  bin: string;
  account: string;
  /** Số tiền (VND, số nguyên). Bỏ trống/0 = để người chuyển tự nhập. */
  amount?: number;
  memo?: string;
}

export function buildVietQr(i: VietQrInput): string {
  if (!/^\d{6}$/.test(i.bin)) throw new Error('Mã BIN gồm đúng 6 chữ số.');
  if (!/^[0-9A-Za-z]{4,19}$/.test(i.account)) throw new Error('Số tài khoản gồm 4–19 ký tự chữ/số.');
  if (i.amount !== undefined && i.amount !== 0 && (!Number.isInteger(i.amount) || i.amount < 0 || i.amount > 9_999_999_999_999)) {
    throw new Error('Số tiền phải là số nguyên đồng, không âm.');
  }
  const hasAmount = !!i.amount && i.amount > 0;
  const memo = sanitizeMemo(i.memo ?? '');
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', i.bin) + tlv('01', i.account)) + tlv('02', 'QRIBFTTA');
  let p = tlv('00', '01') + tlv('01', hasAmount ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (hasAmount) p += tlv('54', String(i.amount));
  p += tlv('58', 'VN');
  if (memo) p += tlv('62', tlv('08', memo));
  p += '6304';
  return p + crc16(p);
}

/** Đọc lại chuỗi VietQR để kiểm tra checksum (dùng cho tự kiểm thử). */
export function verifyVietQr(payload: string): boolean {
  return payload.length > 8 && crc16(payload.slice(0, -4)) === payload.slice(-4);
}
