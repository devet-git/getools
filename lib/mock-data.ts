/**
 * Sinh dữ liệu giả (mock data) — thuần logic, không phụ thuộc React.
 * - PRNG có seed (mulberry32): cùng seed + cùng schema => cùng dữ liệu.
 * - KHÔNG dùng cho mục đích bảo mật (không phải ngẫu nhiên mật mã).
 */
import YAML from 'yaml';

/* ------------------------------------------------------------------ */
/* PRNG                                                                */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chuyển chuỗi seed bất kỳ thành số nguyên 32 bit (FNV-1a; số nguyên giữ nguyên). */
export function seedToInt(seed: string): number {
  const s = seed.trim();
  if (/^-?\d{1,15}$/.test(s)) return Number(s) >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  /** Số nguyên trong [min, max] (bao gồm hai đầu). */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  bool(p = 0.5): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }
  digits(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += this.int(0, 9);
    return s;
  }
  chars(n: number, alphabet: string): string {
    let s = '';
    for (let i = 0; i < n; i++) s += alphabet[Math.floor(this.next() * alphabet.length)];
    return s;
  }
}

/* ------------------------------------------------------------------ */
/* Tiện ích chuỗi                                                      */
/* ------------------------------------------------------------------ */

export function removeDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function slugify(s: string): string {
  return removeDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function asciiWord(s: string): string {
  return removeDiacritics(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function luhnValid(num: string): boolean {
  if (!/^\d{12,19}$/.test(num)) return false;
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function luhnComplete(prefixAndBody: string): string {
  // thêm chữ số kiểm tra vào cuối
  let sum = 0;
  let alt = true;
  for (let i = prefixAndBody.length - 1; i >= 0; i--) {
    let d = prefixAndBody.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return prefixAndBody + ((10 - (sum % 10)) % 10);
}

function mod97(numeric: string): number {
  let rem = 0;
  for (let i = 0; i < numeric.length; i++) rem = (rem * 10 + (numeric.charCodeAt(i) - 48)) % 97;
  return rem;
}

/** Kiểm tra IBAN bằng mod-97 (dùng cho test). */
export function ibanValid(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return mod97(numeric) === 1;
}

/* ------------------------------------------------------------------ */
/* Kho dữ liệu                                                         */
/* ------------------------------------------------------------------ */

const VI_LAST = ['Nguyễn', 'Nguyễn', 'Nguyễn', 'Trần', 'Trần', 'Lê', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Đinh', 'Trịnh', 'Lương', 'Mai', 'Tạ', 'Cao', 'Châu', 'Lâm', 'Trương', 'Đoàn', 'Phùng', 'Tô'];
const VI_MID_M = ['Văn', 'Văn', 'Hữu', 'Đức', 'Minh', 'Quang', 'Thanh', 'Công', 'Ngọc', 'Xuân', 'Anh', 'Gia', 'Đình', 'Quốc', 'Thành', 'Tuấn', 'Bảo', 'Trọng'];
const VI_MID_F = ['Thị', 'Thị', 'Ngọc', 'Thu', 'Thanh', 'Minh', 'Hồng', 'Mai', 'Kim', 'Bảo', 'Phương', 'Diệu', 'Khánh', 'Thùy', 'Hải', 'Quỳnh', 'Tuyết'];
const VI_FIRST_M = ['Hùng', 'Dũng', 'Nam', 'Tuấn', 'Long', 'Phúc', 'Khoa', 'Bình', 'Hải', 'Sơn', 'Thành', 'Trung', 'Hiếu', 'Đạt', 'Kiên', 'Việt', 'Quân', 'Huy', 'Khang', 'Minh', 'Nghĩa', 'Phong', 'Tài', 'Toàn', 'Thắng', 'Vinh', 'Lâm', 'Bảo', 'Cường', 'Duy', 'Đức', 'Hoàng', 'Khánh', 'Lộc', 'Nhân', 'Tú', 'Quang', 'Thịnh', 'Tâm', 'Hậu'];
const VI_FIRST_F = ['Lan', 'Hoa', 'Hương', 'Linh', 'Mai', 'Ngọc', 'Phương', 'Thảo', 'Trang', 'Anh', 'Chi', 'Dung', 'Hà', 'Hạnh', 'Huyền', 'Loan', 'My', 'Nhung', 'Oanh', 'Quỳnh', 'Thu', 'Thủy', 'Trâm', 'Uyên', 'Vân', 'Yến', 'Hằng', 'Giang', 'Diệp', 'Ngân', 'Nga', 'Tâm', 'Tuyết', 'Vy', 'Xuân', 'Trinh', 'Châu', 'Ly', 'Nhi', 'Thanh'];

const EN_FIRST_M = ['James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Steven', 'Paul', 'Andrew', 'Kevin', 'Brian', 'George', 'Edward', 'Henry', 'Samuel', 'Oliver', 'Ethan'];
const EN_FIRST_F = ['Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Nancy', 'Emily', 'Olivia', 'Emma', 'Sophia', 'Isabella', 'Grace', 'Hannah', 'Laura', 'Rachel', 'Anna', 'Julia', 'Alice', 'Charlotte'];
const EN_LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green'];
const EN_MID = ['Lee', 'James', 'Ann', 'Marie', 'Grace', 'Alan', 'Rose', 'Paul', 'Jane', 'Ray'];

const OCCUPATIONS_VI = ['Kỹ sư phần mềm', 'Giáo viên', 'Bác sĩ', 'Kế toán', 'Nhân viên văn phòng', 'Luật sư', 'Kiến trúc sư', 'Thiết kế đồ họa', 'Nông dân', 'Tài xế', 'Đầu bếp', 'Dược sĩ', 'Sinh viên', 'Nhà báo', 'Y tá', 'Chuyên viên marketing', 'Nhân viên kinh doanh', 'Công nhân', 'Kỹ thuật viên', 'Chủ cửa hàng', 'Nhiếp ảnh gia', 'Biên dịch viên'];
const OCCUPATIONS_EN = ['Software engineer', 'Teacher', 'Doctor', 'Accountant', 'Office clerk', 'Lawyer', 'Architect', 'Graphic designer', 'Farmer', 'Driver', 'Chef', 'Pharmacist', 'Student', 'Journalist', 'Nurse', 'Marketing specialist', 'Sales representative', 'Technician', 'Shop owner', 'Photographer', 'Translator'];

const EMAIL_DOMAINS = ['gmail.com', 'gmail.com', 'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'fpt.com.vn', 'vnu.edu.vn', 'example.com'];
const DOMAIN_WORDS = ['saomai', 'vietnet', 'minhlong', 'hoanggia', 'thanglong', 'binhminh', 'phuongnam', 'dailoi', 'kimcuong', 'anphat', 'techviet', 'greenfarm', 'blueocean', 'sunrise', 'nextwave', 'codehub'];
const TLDS = ['com', 'vn', 'com.vn', 'net', 'io', 'org', 'dev'];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'curl/8.5.0',
  'Googlebot/2.1 (+http://www.google.com/bot.html)',
];

interface Province {
  name: string;
  postal: string;
  lat: number;
  lng: number;
  districts: string[];
}

const PROVINCES: Province[] = [
  { name: 'Hà Nội', postal: '10', lat: 21.03, lng: 105.85, districts: ['Ba Đình', 'Hoàn Kiếm', 'Đống Đa', 'Cầu Giấy', 'Thanh Xuân', 'Hai Bà Trưng', 'Hà Đông', 'Tây Hồ'] },
  { name: 'TP. Hồ Chí Minh', postal: '70', lat: 10.78, lng: 106.7, districts: ['Quận 1', 'Quận 3', 'Quận 7', 'Bình Thạnh', 'Tân Bình', 'Phú Nhuận', 'Gò Vấp', 'TP. Thủ Đức'] },
  { name: 'Đà Nẵng', postal: '55', lat: 16.06, lng: 108.22, districts: ['Hải Châu', 'Thanh Khê', 'Sơn Trà', 'Ngũ Hành Sơn', 'Liên Chiểu', 'Cẩm Lệ'] },
  { name: 'Hải Phòng', postal: '18', lat: 20.84, lng: 106.69, districts: ['Hồng Bàng', 'Ngô Quyền', 'Lê Chân', 'Kiến An', 'Hải An'] },
  { name: 'Cần Thơ', postal: '90', lat: 10.03, lng: 105.78, districts: ['Ninh Kiều', 'Bình Thủy', 'Cái Răng', 'Ô Môn', 'Thốt Nốt'] },
  { name: 'Thừa Thiên Huế', postal: '49', lat: 16.46, lng: 107.59, districts: ['TP. Huế', 'Hương Thủy', 'Hương Trà', 'Phong Điền'] },
  { name: 'Quảng Ninh', postal: '20', lat: 21.01, lng: 107.29, districts: ['Hạ Long', 'Cẩm Phả', 'Uông Bí', 'Móng Cái'] },
  { name: 'Thanh Hóa', postal: '40', lat: 19.81, lng: 105.78, districts: ['TP. Thanh Hóa', 'Sầm Sơn', 'Bỉm Sơn', 'Nghi Sơn'] },
  { name: 'Nghệ An', postal: '43', lat: 18.67, lng: 105.69, districts: ['Vinh', 'Cửa Lò', 'Diễn Châu', 'Quỳnh Lưu'] },
  { name: 'Khánh Hòa', postal: '57', lat: 12.24, lng: 109.19, districts: ['Nha Trang', 'Cam Ranh', 'Ninh Hòa', 'Diên Khánh'] },
  { name: 'Lâm Đồng', postal: '67', lat: 11.94, lng: 108.44, districts: ['Đà Lạt', 'Bảo Lộc', 'Đức Trọng', 'Di Linh'] },
  { name: 'Đồng Nai', postal: '76', lat: 10.95, lng: 106.82, districts: ['Biên Hòa', 'Long Khánh', 'Nhơn Trạch', 'Trảng Bom'] },
  { name: 'Bình Dương', postal: '75', lat: 10.99, lng: 106.65, districts: ['Thủ Dầu Một', 'Dĩ An', 'Thuận An', 'Bến Cát'] },
  { name: 'Bà Rịa - Vũng Tàu', postal: '79', lat: 10.35, lng: 107.08, districts: ['Vũng Tàu', 'Bà Rịa', 'Phú Mỹ', 'Long Điền'] },
  { name: 'Kiên Giang', postal: '92', lat: 10.01, lng: 105.08, districts: ['Rạch Giá', 'Phú Quốc', 'Hà Tiên'] },
  { name: 'An Giang', postal: '88', lat: 10.52, lng: 105.13, districts: ['Long Xuyên', 'Châu Đốc', 'Tân Châu'] },
  { name: 'Bình Định', postal: '59', lat: 13.78, lng: 109.22, districts: ['Quy Nhơn', 'An Nhơn', 'Tuy Phước'] },
  { name: 'Đắk Lắk', postal: '63', lat: 12.67, lng: 108.04, districts: ['Buôn Ma Thuột', 'Buôn Hồ', 'Krông Pắc'] },
  { name: 'Thái Nguyên', postal: '24', lat: 21.59, lng: 105.84, districts: ['TP. Thái Nguyên', 'Sông Công', 'Phổ Yên'] },
  { name: 'Lào Cai', postal: '33', lat: 22.48, lng: 103.97, districts: ['TP. Lào Cai', 'Sa Pa', 'Bát Xát'] },
  { name: 'Quảng Nam', postal: '56', lat: 15.57, lng: 108.47, districts: ['Tam Kỳ', 'Hội An', 'Điện Bàn'] },
  { name: 'Hải Dương', postal: '17', lat: 20.94, lng: 106.33, districts: ['TP. Hải Dương', 'Chí Linh', 'Kinh Môn'] },
  { name: 'Bắc Ninh', postal: '22', lat: 21.19, lng: 106.07, districts: ['TP. Bắc Ninh', 'Từ Sơn', 'Yên Phong'] },
  { name: 'Long An', postal: '82', lat: 10.54, lng: 106.41, districts: ['Tân An', 'Bến Lức', 'Đức Hòa'] },
];

const STREETS = ['Lê Lợi', 'Nguyễn Huệ', 'Trần Hưng Đạo', 'Lý Thường Kiệt', 'Hai Bà Trưng', 'Phạm Văn Đồng', 'Võ Văn Tần', 'Nguyễn Trãi', 'Điện Biên Phủ', 'Cách Mạng Tháng Tám', 'Hoàng Diệu', 'Lê Duẩn', 'Nguyễn Văn Linh', 'Phan Chu Trinh', 'Tô Hiến Thành', 'Quang Trung', 'Láng Hạ', 'Giải Phóng', 'Hùng Vương', 'Trường Chinh', 'Nguyễn Thị Minh Khai', 'Pasteur'];

const COUNTRIES_VI = ['Việt Nam', 'Hoa Kỳ', 'Nhật Bản', 'Hàn Quốc', 'Singapore', 'Thái Lan', 'Pháp', 'Đức', 'Anh', 'Úc', 'Canada', 'Trung Quốc', 'Ấn Độ', 'Malaysia', 'Indonesia'];
const COUNTRIES_EN = ['Vietnam', 'United States', 'Japan', 'South Korea', 'Singapore', 'Thailand', 'France', 'Germany', 'United Kingdom', 'Australia', 'Canada', 'China', 'India', 'Malaysia', 'Indonesia'];

const COMPANY_PREFIX = ['Công ty TNHH', 'Công ty Cổ phần', 'Tập đoàn', 'Công ty TNHH MTV'];
const COMPANY_FIELD = ['Công nghệ', 'Thương mại', 'Xây dựng', 'Dịch vụ', 'Vận tải', 'Thực phẩm', 'Phần mềm', 'Đầu tư', 'Giáo dục', 'Du lịch', 'Nông nghiệp'];
const COMPANY_CORE = ['An Phát', 'Minh Long', 'Đại Việt', 'Hoàng Gia', 'Sao Mai', 'Thăng Long', 'Phương Nam', 'Việt Tiến', 'Bình Minh', 'Hải Âu', 'Kim Cương', 'Tân Thành', 'Hưng Thịnh', 'Thiên Phú', 'Nam Việt', 'Á Châu', 'Phú Gia', 'Đông Dương'];
const COMPANY_EN_CORE = ['Apex', 'Nova', 'Blue Harbor', 'Summit', 'Pioneer', 'Vertex', 'Lumen', 'Orbit', 'Evergreen', 'Silverline'];
const COMPANY_EN_SUFFIX = ['Ltd.', 'Inc.', 'Group', 'Corp.', 'Holdings', 'Labs'];

const JOB_TITLES_VI = ['Giám đốc điều hành', 'Trưởng phòng kinh doanh', 'Kỹ sư phần mềm', 'Chuyên viên nhân sự', 'Kế toán trưởng', 'Nhân viên chăm sóc khách hàng', 'Quản lý dự án', 'Chuyên viên phân tích dữ liệu', 'Lập trình viên Frontend', 'Lập trình viên Backend', 'Kỹ sư DevOps', 'Chuyên viên marketing', 'Thiết kế UI/UX', 'Kiểm thử phần mềm', 'Trợ lý giám đốc', 'Chuyên viên pháp chế'];
const JOB_TITLES_EN = ['Chief Executive Officer', 'Sales Manager', 'Software Engineer', 'HR Specialist', 'Chief Accountant', 'Customer Support Agent', 'Project Manager', 'Data Analyst', 'Frontend Developer', 'Backend Developer', 'DevOps Engineer', 'Marketing Specialist', 'UI/UX Designer', 'QA Engineer', 'Executive Assistant', 'Legal Counsel'];
const DEPARTMENTS_VI = ['Kinh doanh', 'Kỹ thuật', 'Nhân sự', 'Tài chính - Kế toán', 'Marketing', 'Chăm sóc khách hàng', 'Vận hành', 'Pháp chế', 'Nghiên cứu và phát triển', 'Mua hàng', 'Hành chính'];
const DEPARTMENTS_EN = ['Sales', 'Engineering', 'Human Resources', 'Finance', 'Marketing', 'Customer Support', 'Operations', 'Legal', 'R&D', 'Procurement', 'Administration'];

const BANKS = ['VCB', 'TCB', 'BIDV', 'ACB', 'MBB', 'VPB', 'CTG', 'STB', 'TPB', 'VIB', 'HDB', 'SHB', 'OCB', 'MSB', 'EIB', 'SCB'];
const CURRENCIES = ['VND', 'USD', 'EUR', 'JPY', 'GBP', 'KRW', 'SGD', 'AUD', 'CNY', 'THB'];
const CARD_PREFIX: Record<string, { prefixes: string[]; len: number }> = {
  visa: { prefixes: ['411111', '400000'], len: 16 },
  mastercard: { prefixes: ['555555', '510510'], len: 16 },
  amex: { prefixes: ['378282', '371449'], len: 15 },
  jcb: { prefixes: ['353011', '356600'], len: 16 },
};

const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');

const VI_SUBJECT = ['Chúng tôi', 'Khách hàng', 'Đội ngũ kỹ thuật', 'Công ty', 'Người dùng', 'Bộ phận kinh doanh', 'Ban giám đốc', 'Nhóm dự án', 'Các thành viên', 'Cửa hàng'];
const VI_VERB = ['đã hoàn thành', 'đang triển khai', 'sẽ cập nhật', 'vừa phát hành', 'luôn cải thiện', 'đã thảo luận về', 'chuẩn bị ra mắt', 'tiếp tục hoàn thiện', 'đánh giá cao', 'quan tâm đến'];
const VI_OBJECT = ['dự án mới', 'hệ thống quản lý', 'kế hoạch quý tới', 'chất lượng dịch vụ', 'trải nghiệm người dùng', 'sản phẩm chủ lực', 'chương trình khuyến mãi', 'quy trình làm việc', 'báo cáo tài chính', 'ứng dụng di động', 'tài liệu hướng dẫn'];
const VI_TAIL = ['trong tháng này', 'theo đúng tiến độ', 'với nhiều tính năng hữu ích', 'để đáp ứng nhu cầu thị trường', 'nhờ sự nỗ lực của cả nhóm', 'tại nhiều tỉnh thành', 'một cách hiệu quả', 'sau nhiều lần thử nghiệm'];
const EN_SUBJECT = ['Our team', 'The customer', 'The company', 'Every user', 'The sales department', 'The project group', 'Our engineers', 'The store'];
const EN_VERB = ['has finished', 'is deploying', 'will update', 'just released', 'keeps improving', 'discussed', 'is about to launch', 'highly values'];
const EN_OBJECT = ['the new project', 'the management system', 'next quarter plan', 'service quality', 'the user experience', 'our flagship product', 'the promotion campaign', 'the mobile app', 'the documentation'];
const EN_TAIL = ['this month', 'on schedule', 'with many useful features', 'to meet market demand', 'thanks to the whole team', 'in several regions', 'very effectively'];

const VI_KEYWORDS = ['công nghệ', 'kinh doanh', 'du lịch', 'ẩm thực', 'giáo dục', 'sức khỏe', 'tài chính', 'thể thao', 'âm nhạc', 'thời trang', 'khởi nghiệp', 'lập trình', 'thiết kế', 'đời sống', 'văn hóa', 'khoa học'];
const EN_KEYWORDS = ['technology', 'business', 'travel', 'food', 'education', 'health', 'finance', 'sports', 'music', 'fashion', 'startup', 'coding', 'design', 'lifestyle', 'culture', 'science'];

const TITLE_VI_A = ['Hướng dẫn', 'Kinh nghiệm', 'Bí quyết', 'Những điều cần biết về', 'Tổng quan về', 'Cách bắt đầu với', 'Review chi tiết', '10 mẹo hay về'];
const TITLE_VI_B = ['lập trình web', 'quản lý thời gian', 'du lịch bụi', 'nấu ăn tại nhà', 'đầu tư tài chính', 'chăm sóc sức khỏe', 'học tiếng Anh', 'thiết kế giao diện', 'xây dựng thương hiệu', 'làm việc từ xa', 'trí tuệ nhân tạo', 'chụp ảnh bằng điện thoại'];
const TITLE_EN_A = ['A guide to', 'Lessons learned from', 'Secrets of', 'Everything about', 'An overview of', 'Getting started with', 'A detailed review of', '10 tips for'];
const TITLE_EN_B = ['web development', 'time management', 'budget travel', 'home cooking', 'smart investing', 'staying healthy', 'learning languages', 'interface design', 'building a brand', 'remote work', 'artificial intelligence', 'mobile photography'];

const PRODUCT_TYPE_VI = ['Áo thun', 'Giày thể thao', 'Tai nghe', 'Bàn phím cơ', 'Balo laptop', 'Đồng hồ thông minh', 'Bình giữ nhiệt', 'Ốp lưng điện thoại', 'Sạc dự phòng', 'Chuột không dây', 'Nồi chiên không dầu', 'Máy xay sinh tố', 'Cà phê rang xay', 'Trà thảo mộc', 'Sách kỹ năng'];
const PRODUCT_ATTR_VI = ['Cao cấp', 'Phiên bản 2024', 'Chính hãng', 'Bản giới hạn', 'Pro', 'Mini', 'Tiết kiệm', 'Siêu bền', 'Thế hệ mới', 'Classic'];
const PRODUCT_TYPE_EN = ['T-shirt', 'Running shoes', 'Headphones', 'Mechanical keyboard', 'Laptop backpack', 'Smartwatch', 'Thermos bottle', 'Phone case', 'Power bank', 'Wireless mouse', 'Air fryer', 'Blender', 'Ground coffee', 'Herbal tea', 'Self-help book'];
const PRODUCT_ATTR_EN = ['Premium', '2024 Edition', 'Genuine', 'Limited', 'Pro', 'Mini', 'Eco', 'Durable', 'Next-gen', 'Classic'];

/* ------------------------------------------------------------------ */
/* Kiểu trường & tuỳ chọn                                             */
/* ------------------------------------------------------------------ */

export interface OptDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select' | 'area';
  def: string;
  choices?: { v: string; l: string }[];
  placeholder?: string;
  wide?: boolean;
}

export interface TypeDef {
  id: string;
  label: string;
  group: string;
  opts?: OptDef[];
}

const o = {
  num: (key: string, label: string, def: string, placeholder?: string): OptDef => ({ key, label, kind: 'number', def, placeholder }),
  txt: (key: string, label: string, def: string, placeholder?: string, wide = false): OptDef => ({ key, label, kind: 'text', def, placeholder, wide }),
  sel: (key: string, label: string, def: string, choices: [string, string][]): OptDef => ({ key, label, kind: 'select', def, choices: choices.map(([v, l]) => ({ v, l })) }),
  area: (key: string, label: string, def: string, placeholder?: string): OptDef => ({ key, label, kind: 'area', def, placeholder, wide: true }),
};

const DATE_FMT: [string, string][] = [['iso', 'YYYY-MM-DD'], ['dmy', 'DD/MM/YYYY'], ['mdy', 'MM/DD/YYYY']];

export const G_ID = 'ID';
export const G_PERSON = 'Người';
export const G_CONTACT = 'Liên hệ';
export const G_GEO = 'Địa lý';
export const G_WORK = 'Công việc';
export const G_FIN = 'Tài chính';
export const G_TIME = 'Thời gian';
export const G_TEXT = 'Văn bản';
export const G_LOGIC = 'Số & logic';
export const G_STRUCT = 'Cấu trúc';

export const FIELD_TYPES: TypeDef[] = [
  { id: 'autoinc', label: 'Số tự tăng', group: G_ID, opts: [o.num('start', 'Bắt đầu', '1'), o.num('step', 'Bước nhảy', '1')] },
  { id: 'uuid', label: 'UUID v4', group: G_ID },
  { id: 'ulid', label: 'ULID (giống)', group: G_ID },
  { id: 'nanoid', label: 'NanoID (giống)', group: G_ID, opts: [o.num('length', 'Độ dài', '21')] },
  { id: 'hash', label: 'Mã băm ngắn (hex)', group: G_ID, opts: [o.num('length', 'Độ dài', '8')] },

  { id: 'fullName', label: 'Họ và tên', group: G_PERSON },
  { id: 'lastName', label: 'Họ', group: G_PERSON },
  { id: 'middleName', label: 'Tên đệm', group: G_PERSON },
  { id: 'firstName', label: 'Tên', group: G_PERSON },
  { id: 'fullNameAscii', label: 'Họ tên không dấu', group: G_PERSON },
  { id: 'gender', label: 'Giới tính', group: G_PERSON, opts: [o.sel('format', 'Định dạng', 'vi', [['vi', 'Nam / Nữ'], ['en', 'male / female'], ['code', 'M / F']])] },
  { id: 'birthdate', label: 'Ngày sinh', group: G_PERSON, opts: [o.num('minAge', 'Tuổi tối thiểu', '', 'mặc định 18'), o.num('maxAge', 'Tuổi tối đa', '', 'mặc định 65'), o.sel('format', 'Định dạng', 'iso', DATE_FMT)] },
  { id: 'age', label: 'Tuổi', group: G_PERSON, opts: [o.num('minAge', 'Tối thiểu', '', 'mặc định 18'), o.num('maxAge', 'Tối đa', '', 'mặc định 65')] },
  { id: 'avatar', label: 'Avatar URL (placeholder)', group: G_PERSON, opts: [o.num('size', 'Kích thước', '128')] },
  { id: 'username', label: 'Tên đăng nhập', group: G_PERSON },
  { id: 'occupation', label: 'Nghề nghiệp', group: G_PERSON },

  { id: 'email', label: 'Email (theo tên)', group: G_CONTACT, opts: [o.txt('domain', 'Tên miền cố định', '', 'để trống = ngẫu nhiên')] },
  { id: 'phone', label: 'SĐT Việt Nam', group: G_CONTACT, opts: [o.sel('format', 'Định dạng', 'local', [['local', '0912345678'], ['intl', '+84912345678'], ['spaced', '0912 345 678']])] },
  { id: 'cccd', label: 'CCCD (12 số)', group: G_CONTACT },
  { id: 'website', label: 'Website', group: G_CONTACT },
  { id: 'ipv4', label: 'IPv4', group: G_CONTACT },
  { id: 'ipv6', label: 'IPv6', group: G_CONTACT },
  { id: 'mac', label: 'Địa chỉ MAC', group: G_CONTACT },
  { id: 'url', label: 'URL', group: G_CONTACT },
  { id: 'userAgent', label: 'User-Agent', group: G_CONTACT },

  { id: 'province', label: 'Tỉnh / Thành phố', group: G_GEO },
  { id: 'district', label: 'Quận / Huyện', group: G_GEO },
  { id: 'address', label: 'Địa chỉ Việt Nam', group: G_GEO },
  { id: 'postal', label: 'Mã bưu chính', group: G_GEO },
  { id: 'lat', label: 'Vĩ độ (lat)', group: G_GEO },
  { id: 'lng', label: 'Kinh độ (lng)', group: G_GEO },
  { id: 'country', label: 'Quốc gia', group: G_GEO },

  { id: 'company', label: 'Công ty', group: G_WORK },
  { id: 'jobTitle', label: 'Chức danh', group: G_WORK },
  { id: 'department', label: 'Phòng ban', group: G_WORK },

  { id: 'moneyVnd', label: 'Số tiền VND', group: G_FIN, opts: [o.num('min', 'Tối thiểu', '10000'), o.num('max', 'Tối đa', '50000000'), o.num('round', 'Làm tròn tới', '1000')] },
  { id: 'moneyUsd', label: 'Số tiền USD', group: G_FIN, opts: [o.num('min', 'Tối thiểu', '1'), o.num('max', 'Tối đa', '5000')] },
  { id: 'card', label: 'Số thẻ (Luhn)', group: G_FIN, opts: [o.sel('brand', 'Loại thẻ', 'any', [['any', 'Ngẫu nhiên'], ['visa', 'Visa'], ['mastercard', 'Mastercard'], ['amex', 'Amex'], ['jcb', 'JCB']])] },
  { id: 'iban', label: 'IBAN (giống)', group: G_FIN },
  { id: 'bankCode', label: 'Mã ngân hàng VN', group: G_FIN },
  { id: 'color', label: 'Màu hex', group: G_FIN },
  { id: 'currency', label: 'Tiền tệ (mã)', group: G_FIN },

  { id: 'date', label: 'Ngày trong khoảng', group: G_TIME, opts: [o.txt('from', 'Từ (YYYY-MM-DD)', '2020-01-01'), o.txt('to', 'Đến', '2025-12-31'), o.sel('format', 'Định dạng', 'iso', DATE_FMT)] },
  { id: 'time', label: 'Giờ (HH:mm:ss)', group: G_TIME },
  { id: 'datetime', label: 'ISO timestamp', group: G_TIME, opts: [o.txt('from', 'Từ (YYYY-MM-DD)', '2024-01-01'), o.txt('to', 'Đến', '2025-12-31')] },
  { id: 'unix', label: 'Unix timestamp', group: G_TIME, opts: [o.txt('from', 'Từ', '2024-01-01'), o.txt('to', 'Đến', '2025-12-31'), o.sel('unit', 'Đơn vị', 's', [['s', 'giây'], ['ms', 'mili giây']])] },
  { id: 'future', label: 'Thời điểm tương lai', group: G_TIME, opts: [o.num('days', 'Tối đa (ngày)', '365')] },
  { id: 'past', label: 'Thời điểm quá khứ', group: G_TIME, opts: [o.num('days', 'Tối đa (ngày)', '365')] },

  { id: 'lorem', label: 'Lorem ipsum', group: G_TEXT, opts: [o.num('min', 'Số từ tối thiểu', '5'), o.num('max', 'Số từ tối đa', '12')] },
  { id: 'sentence', label: 'Câu (theo ngôn ngữ)', group: G_TEXT },
  { id: 'paragraph', label: 'Đoạn văn', group: G_TEXT, opts: [o.num('min', 'Số câu tối thiểu', '3'), o.num('max', 'Số câu tối đa', '6')] },
  { id: 'title', label: 'Tiêu đề', group: G_TEXT },
  { id: 'slug', label: 'Slug', group: G_TEXT },
  { id: 'keywords', label: 'Từ khóa', group: G_TEXT, opts: [o.num('min', 'Tối thiểu', '2'), o.num('max', 'Tối đa', '4'), o.txt('sep', 'Ngăn cách', ', ')] },
  { id: 'productName', label: 'Tên sản phẩm', group: G_TEXT },

  { id: 'int', label: 'Số nguyên', group: G_LOGIC, opts: [o.num('min', 'Tối thiểu', '0'), o.num('max', 'Tối đa', '1000')] },
  { id: 'float', label: 'Số thực', group: G_LOGIC, opts: [o.num('min', 'Tối thiểu', '0'), o.num('max', 'Tối đa', '100'), o.num('precision', 'Số lẻ', '2')] },
  { id: 'bool', label: 'Boolean', group: G_LOGIC, opts: [o.num('p', 'Xác suất true (%)', '50')] },
  { id: 'enum', label: 'Chọn từ danh sách', group: G_LOGIC, opts: [o.area('items', 'Giá trị (phẩy; thêm =trọng số)', 'mới=60, đang xử lý=30, hoàn tất=10')] },
  { id: 'nullable', label: 'Có thể null', group: G_LOGIC, opts: [o.sel('inner', 'Kiểu giá trị', 'int', []), o.num('p', 'Xác suất null (%)', '20')] },
  { id: 'pattern', label: 'Mẫu (regex-lite)', group: G_LOGIC, opts: [o.txt('pattern', 'Mẫu: # số, ? chữ HOA, @ chữ thường, * chữ-số, \\ thoát', 'ABC-####-??', undefined, true)] },

  { id: 'array', label: 'Mảng N giá trị', group: G_STRUCT, opts: [o.sel('inner', 'Kiểu phần tử', 'int', []), o.num('min', 'Số phần tử tối thiểu', '1'), o.num('max', 'Tối đa', '5')] },
  { id: 'object', label: 'Đối tượng lồng nhau', group: G_STRUCT, opts: [o.area('fields', 'Trường con: mỗi dòng "tên=kiểu"', 'street=address\ncity=province')] },
  { id: 'ref', label: 'Tham chiếu trường khác', group: G_STRUCT, opts: [o.txt('from', 'Trường nguồn', 'first_name'), o.txt('from2', 'Trường nguồn 2 (tuỳ chọn)', 'last_name'), o.sel('transform', 'Biến đổi', 'email', [['same', 'Giữ nguyên'], ['upper', 'IN HOA'], ['lower', 'in thường'], ['ascii', 'Không dấu'], ['slug', 'Slug'], ['email', 'Email'], ['username', 'Username']]), o.txt('domain', 'Tên miền email', 'example.com')] },
  { id: 'formula', label: 'Công thức', group: G_STRUCT, opts: [o.txt('expr', 'Biểu thức (+ - * / % ( ) round floor ceil abs min max sqrt)', 'price*qty', undefined, true), o.num('decimals', 'Số lẻ', '0')] },
];

export const TYPE_BY_ID: Record<string, TypeDef> = Object.fromEntries(FIELD_TYPES.map((t) => [t.id, t]));
export const TYPE_GROUPS: string[] = Array.from(new Set(FIELD_TYPES.map((t) => t.group)));

/** Các kiểu có thể làm kiểu "bên trong" (mảng / nullable / đối tượng): loại trừ kiểu cấu trúc phức tạp. */
export const INNER_TYPES = FIELD_TYPES.filter((t) => !['array', 'object', 'ref', 'formula', 'nullable'].includes(t.id));

for (const t of FIELD_TYPES) {
  for (const op of t.opts ?? []) {
    if (op.key === 'inner') op.choices = INNER_TYPES.map((x) => ({ v: x.id, l: x.label }));
  }
}

export function defaultOpts(type: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const op of TYPE_BY_ID[type]?.opts ?? []) r[op.key] = op.def;
  return r;
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export interface FieldDef {
  id: string;
  name: string;
  type: string;
  opts: Record<string, string>;
  unique?: boolean;
  /** Tỉ lệ null (0-100) áp dụng cho mọi kiểu. */
  nullPct?: number;
}

export const MAX_ROWS = 10000;
export const MAX_FIELDS = 60;

let idCounter = 0;
export function newFieldId(): string {
  idCounter += 1;
  return 'f' + idCounter.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

export function makeField(name: string, type: string, opts: Record<string, string> = {}, extra: Partial<FieldDef> = {}): FieldDef {
  return { id: newFieldId(), name, type, opts: { ...defaultOpts(type), ...opts }, ...extra };
}

export function validateSchema(fields: FieldDef[]): string[] {
  const errors: string[] = [];
  if (fields.length === 0) errors.push('Cần ít nhất một trường.');
  if (fields.length > MAX_FIELDS) errors.push(`Tối đa ${MAX_FIELDS} trường.`);
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    const n = f.name.trim();
    if (!n) errors.push(`Trường #${i + 1} chưa có tên.`);
    else if (seen.has(n)) errors.push(`Tên trường "${n}" bị trùng.`);
    seen.add(n);
    if (!TYPE_BY_ID[f.type]) errors.push(`Trường "${n || i + 1}" có kiểu không hợp lệ.`);
  });
  return errors;
}

/* ------------------------------------------------------------------ */
/* Công thức                                                           */
/* ------------------------------------------------------------------ */

type Tok = { t: 'n'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(expr: string): Tok[] | null {
  const toks: Tok[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([\p{L}_][\p{L}\p{N}_]*)|([-+*/%(),]))/uy;
  let pos = 0;
  while (pos < expr.length) {
    if (/^\s*$/.test(expr.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(expr);
    if (!m) return null;
    if (m[1] !== undefined) toks.push({ t: 'n', v: Number(m[1]) });
    else if (m[2] !== undefined) toks.push({ t: 'id', v: m[2] });
    else toks.push({ t: 'op', v: m[3] });
    pos = re.lastIndex;
  }
  return toks;
}

const FUNCS: Record<string, (...a: number[]) => number> = {
  round: (x, n = 0) => {
    const p = Math.pow(10, Math.max(0, Math.min(10, n)));
    return Math.round(x * p) / p;
  },
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  sqrt: Math.sqrt,
  min: Math.min,
  max: Math.max,
};

/** Tính biểu thức số học đơn giản an toàn (không dùng eval). Trả null nếu lỗi. */
export function evalFormula(expr: string, get: (name: string) => unknown): number | null {
  if (expr.length > 300) return null;
  const parsed = tokenize(expr);
  if (!parsed || parsed.length === 0) return null;
  const toks: Tok[] = parsed;
  let i = 0;
  let steps = 0;
  const fail = Symbol('fail');
  const peek = () => toks[i];
  const isOp = (v: string) => {
    const t = peek();
    return !!t && t.t === 'op' && t.v === v;
  };

  function parseExpr(): number {
    let v = parseTerm();
    while (isOp('+') || isOp('-')) {
      const op = (toks[i++] as { v: string }).v;
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseUnary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (toks[i++] as { v: string }).v;
      const r = parseUnary();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function parseUnary(): number {
    if (isOp('-')) {
      i++;
      return -parseUnary();
    }
    if (isOp('+')) {
      i++;
      return parseUnary();
    }
    return parseAtom();
  }
  function parseAtom(): number {
    if (++steps > 500) throw fail;
    const t = toks[i++];
    if (!t) throw fail;
    if (t.t === 'n') return t.v;
    if (t.t === 'op' && t.v === '(') {
      const v = parseExpr();
      if (!isOp(')')) throw fail;
      i++;
      return v;
    }
    if (t.t === 'id') {
      if (isOp('(')) {
        i++;
        const args: number[] = [];
        if (!isOp(')')) {
          args.push(parseExpr());
          while (isOp(',')) {
            i++;
            args.push(parseExpr());
          }
        }
        if (!isOp(')')) throw fail;
        i++;
        const fn = Object.prototype.hasOwnProperty.call(FUNCS, t.v) ? FUNCS[t.v] : undefined;
        if (!fn || args.length === 0) throw fail;
        return fn(...args);
      }
      const val = get(t.v);
      if (val === null || val === undefined || val === '' || typeof val === 'boolean') throw fail;
      const n = Number(val);
      if (!Number.isFinite(n)) throw fail;
      return n;
    }
    throw fail;
  }

  try {
    const v = parseExpr();
    if (i < toks.length || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Ngữ cảnh sinh                                                       */
/* ------------------------------------------------------------------ */

export type Locale = 'vi' | 'en';

interface Person {
  male: boolean;
  last: string;
  middle: string;
  first: string;
  birth: number; // ms UTC
}

interface Place {
  province: Province;
  district: string;
  lat: number;
  lng: number;
}

interface Ctx {
  rng: Rng;
  locale: Locale;
  index: number;
  attempt: number;
  now: number;
  depth: number;
  person(): Person;
  resetPerson(): void;
  place(): Place;
  get(name: string): unknown;
}

export const DEFAULT_NOW = Date.UTC(2026, 0, 1);
const DAY = 86400000;

function numOpt(opts: Record<string, string>, key: string, def: number): number {
  const raw = opts[key];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function strOpt(opts: Record<string, string>, key: string, def = ''): string {
  const v = opts[key];
  return v === undefined ? def : v;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseDateMs(s: string, fallback: number): number {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) return fallback;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : fallback;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function fmtDate(ms: number, fmt: string): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const da = pad(d.getUTCDate());
  if (fmt === 'dmy') return `${da}/${mo}/${y}`;
  if (fmt === 'mdy') return `${mo}/${da}/${y}`;
  return `${y}-${mo}-${da}`;
}

function rangeMs(opts: Record<string, string>, df: string, dt: string, rng: Rng): number {
  let a = parseDateMs(strOpt(opts, 'from', df), parseDateMs(df, DEFAULT_NOW));
  let b = parseDateMs(strOpt(opts, 'to', dt), parseDateMs(dt, DEFAULT_NOW)) + DAY - 1;
  if (b < a) [a, b] = [b, a];
  return Math.floor(a + rng.float() * (b - a));
}

function makePerson(ctx: { rng: Rng; locale: Locale; now: number }): Person {
  const { rng, locale, now } = ctx;
  const male = rng.bool(0.5);
  let last: string, middle: string, first: string;
  if (locale === 'vi') {
    last = rng.pick(VI_LAST);
    middle = rng.pick(male ? VI_MID_M : VI_MID_F);
    first = rng.pick(male ? VI_FIRST_M : VI_FIRST_F);
  } else {
    last = rng.pick(EN_LAST);
    middle = rng.pick(EN_MID);
    first = rng.pick(male ? EN_FIRST_M : EN_FIRST_F);
  }
  const age = rng.int(18, 65);
  const birth = now - age * 365.25 * DAY - rng.int(0, 364) * DAY;
  return { male, last, middle, first, birth: Math.floor(birth / DAY) * DAY };
}

function ageOf(birth: number, now: number): number {
  return Math.floor((now - birth) / (365.25 * DAY));
}

function personFull(p: Person, locale: Locale): string {
  return locale === 'vi' ? `${p.last} ${p.middle} ${p.first}` : `${p.first} ${p.last}`;
}

function sentence(ctx: Ctx): string {
  const { rng, locale } = ctx;
  if (locale === 'vi') {
    const s = `${rng.pick(VI_SUBJECT)} ${rng.pick(VI_VERB)} ${rng.pick(VI_OBJECT)}${rng.bool(0.7) ? ' ' + rng.pick(VI_TAIL) : ''}.`;
    return s;
  }
  return `${rng.pick(EN_SUBJECT)} ${rng.pick(EN_VERB)} ${rng.pick(EN_OBJECT)}${rng.bool(0.7) ? ' ' + rng.pick(EN_TAIL) : ''}.`;
}

function titleText(ctx: Ctx): string {
  const { rng, locale } = ctx;
  return locale === 'vi' ? `${rng.pick(TITLE_VI_A)} ${rng.pick(TITLE_VI_B)}` : `${rng.pick(TITLE_EN_A)} ${rng.pick(TITLE_EN_B)}`;
}

function emailLocal(ctx: Ctx): string {
  const p = ctx.person();
  const f = asciiWord(p.first) || 'user';
  const l = asciiWord(p.last) || 'x';
  const m = asciiWord(p.middle);
  const { rng } = ctx;
  let local: string;
  switch (rng.int(0, 4)) {
    case 0:
      local = `${f}.${l}`;
      break;
    case 1:
      local = `${f}${l}`;
      break;
    case 2:
      local = `${f}${l.charAt(0)}${m.charAt(0)}`;
      break;
    case 3:
      local = `${l}.${f}`;
      break;
    default:
      local = `${f}_${l}`;
  }
  if (ctx.attempt > 0 || rng.bool(0.4)) local += rng.int(1, ctx.attempt > 2 ? 99999 : 99);
  return local;
}

function usernameOf(ctx: Ctx): string {
  const p = ctx.person();
  const f = asciiWord(p.first) || 'user';
  const l = asciiWord(p.last) || 'x';
  const { rng } = ctx;
  const base = rng.pick([`${f}${l.charAt(0)}`, `${f}_${l}`, `${f}.${l}`, `${l}${f}`]);
  return base + (ctx.attempt > 0 || rng.bool(0.6) ? rng.int(1, ctx.attempt > 2 ? 99999 : 999) : '');
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const VN_PHONE_PREFIX = ['032', '033', '034', '035', '036', '037', '038', '039', '056', '058', '059', '070', '076', '077', '078', '079', '081', '082', '083', '084', '085', '086', '088', '089', '090', '091', '092', '093', '094', '096', '097', '098', '099'];
export const VN_PHONE_REGEX = /^0(3[2-9]|5[689]|7[06-9]|8[1-9]|9[0-4]|9[6-9])\d{7}$/;

const enumCache = new Map<string, { items: (string | number)[]; weights: number[] }>();
function parseEnum(src: string): { items: (string | number)[]; weights: number[] } {
  const cached = enumCache.get(src);
  if (cached) return cached;
  const items: (string | number)[] = [];
  const weights: number[] = [];
  for (const raw of src.split(/[,\n]/)) {
    let s = raw.trim();
    if (!s) continue;
    let w = 1;
    const eq = s.lastIndexOf('=');
    if (eq > 0) {
      const wn = Number(s.slice(eq + 1).trim());
      if (Number.isFinite(wn) && wn >= 0 && s.slice(eq + 1).trim() !== '') {
        w = wn;
        s = s.slice(0, eq).trim();
      }
    }
    items.push(s !== '' && String(Number(s)) === s ? Number(s) : s);
    weights.push(w);
  }
  const r = { items, weights };
  if (enumCache.size > 200) enumCache.clear();
  enumCache.set(src, r);
  return r;
}

function genPattern(pat: string, rng: Rng): string {
  let out = '';
  for (let i = 0; i < pat.length && out.length < 500; i++) {
    const c = pat[i];
    if (c === '\\' && i + 1 < pat.length) {
      out += pat[++i];
    } else if (c === '#') out += rng.int(0, 9);
    else if (c === '?') out += rng.chars(1, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    else if (c === '@') out += rng.chars(1, 'abcdefghijklmnopqrstuvwxyz');
    else if (c === '*') out += rng.chars(1, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    else out += c;
  }
  return out;
}

function applyTransform(val: string, val2: string | null, transform: string, domain: string): string {
  switch (transform) {
    case 'upper':
      return val.toUpperCase();
    case 'lower':
      return val.toLowerCase();
    case 'ascii':
      return removeDiacritics(val);
    case 'slug':
      return slugify(val);
    case 'username':
      return [val, val2].filter((x): x is string => !!x).map(asciiWord).join('.');
    case 'email': {
      const local = [val, val2].filter((x): x is string => !!x).map(asciiWord).filter(Boolean).join('.') || 'user';
      return `${local}@${domain.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'example.com'}`;
    }
    default:
      return val;
  }
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Sinh một giá trị cho một kiểu trường (dùng chung cho kiểu con trong mảng / đối tượng). */
function genType(type: string, opts: Record<string, string>, ctx: Ctx): unknown {
  const { rng, locale } = ctx;
  switch (type) {
    /* ID */
    case 'autoinc':
      return numOpt(opts, 'start', 1) + ctx.index * numOpt(opts, 'step', 1);
    case 'uuid': {
      const b: number[] = [];
      for (let i = 0; i < 16; i++) b.push(rng.int(0, 255));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    case 'ulid': {
      let t = ctx.now + ctx.index * 1000 + rng.int(0, 999);
      let ts = '';
      for (let i = 0; i < 10; i++) {
        ts = B32[t % 32] + ts;
        t = Math.floor(t / 32);
      }
      return ts + rng.chars(16, B32);
    }
    case 'nanoid':
      return rng.chars(clampInt(numOpt(opts, 'length', 21), 1, 128), B64URL);
    case 'hash':
      return rng.chars(clampInt(numOpt(opts, 'length', 8), 1, 128), '0123456789abcdef');

    /* Người */
    case 'fullName':
      return personFull(ctx.person(), locale);
    case 'lastName':
      return ctx.person().last;
    case 'middleName':
      return ctx.person().middle;
    case 'firstName':
      return ctx.person().first;
    case 'fullNameAscii':
      return removeDiacritics(personFull(ctx.person(), locale));
    case 'gender': {
      const male = ctx.person().male;
      const f = strOpt(opts, 'format', 'vi');
      if (f === 'en') return male ? 'male' : 'female';
      if (f === 'code') return male ? 'M' : 'F';
      return male ? 'Nam' : 'Nữ';
    }
    case 'birthdate': {
      const p = ctx.person();
      const minA = strOpt(opts, 'minAge').trim();
      const maxA = strOpt(opts, 'maxAge').trim();
      if (minA !== '' || maxA !== '') {
        const a = clampInt(numOpt(opts, 'minAge', 18), 0, 120);
        const b = clampInt(numOpt(opts, 'maxAge', 65), 0, 120);
        const age = rng.int(Math.min(a, b), Math.max(a, b));
        p.birth = Math.floor((ctx.now - age * 365.25 * DAY - rng.int(0, 364) * DAY) / DAY) * DAY;
      }
      return fmtDate(p.birth, strOpt(opts, 'format', 'iso'));
    }
    case 'age': {
      const p = ctx.person();
      const minA = strOpt(opts, 'minAge').trim();
      const maxA = strOpt(opts, 'maxAge').trim();
      if (minA !== '' || maxA !== '') {
        const a = clampInt(numOpt(opts, 'minAge', 18), 0, 120);
        const b = clampInt(numOpt(opts, 'maxAge', 65), 0, 120);
        const age = rng.int(Math.min(a, b), Math.max(a, b));
        p.birth = Math.floor((ctx.now - age * 365.25 * DAY - rng.int(0, 364) * DAY) / DAY) * DAY;
      }
      return ageOf(p.birth, ctx.now);
    }
    case 'avatar': {
      const size = clampInt(numOpt(opts, 'size', 128), 16, 1024);
      return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(removeDiacritics(personFull(ctx.person(), locale)))}&size=${size}`;
    }
    case 'username':
      return usernameOf(ctx);
    case 'occupation':
      return rng.pick(locale === 'vi' ? OCCUPATIONS_VI : OCCUPATIONS_EN);

    /* Liên hệ */
    case 'email': {
      const d = strOpt(opts, 'domain').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
      return `${emailLocal(ctx)}@${d || rng.pick(EMAIL_DOMAINS)}`;
    }
    case 'phone': {
      const p = rng.pick(VN_PHONE_PREFIX);
      const rest = rng.digits(7);
      const f = strOpt(opts, 'format', 'local');
      if (f === 'intl') return `+84${p.slice(1)}${rest}`;
      if (f === 'spaced') return `${p}${rest.slice(0, 1)} ${rest.slice(1, 4)} ${rest.slice(4)}`;
      return p + rest;
    }
    case 'cccd': {
      const p = ctx.person();
      const year = new Date(p.birth).getUTCFullYear();
      const century = Math.floor(year / 100) - 19; // 0 => 1900s, 1 => 2000s
      const code = rng.int(1, 96);
      const gc = Math.max(0, Math.min(1, century)) * 2 + (p.male ? 0 : 1);
      return `${pad(code, 3)}${gc}${pad(year % 100)}${rng.digits(6)}`;
    }
    case 'website':
      return `https://www.${rng.pick(DOMAIN_WORDS)}.${rng.pick(TLDS)}`;
    case 'ipv4': {
      const a = rng.pick([1, 14, 27, 42, 58, 103, 113, 171, 203, 210, 8, 34, 52, 104, 142, 172, 185]);
      return `${a}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`;
    }
    case 'ipv6': {
      const g: string[] = [];
      for (let i = 0; i < 8; i++) g.push(rng.int(0, 0xffff).toString(16));
      return g.join(':');
    }
    case 'mac': {
      const g: string[] = [];
      for (let i = 0; i < 6; i++) g.push(rng.int(0, 255).toString(16).padStart(2, '0'));
      g[0] = (parseInt(g[0], 16) & 0xfc).toString(16).padStart(2, '0');
      return g.join(':');
    }
    case 'url': {
      const parts = rng.int(1, 3);
      const segs: string[] = [];
      for (let i = 0; i < parts; i++) segs.push(rng.pick(LOREM));
      return `https://${rng.pick(DOMAIN_WORDS)}.${rng.pick(TLDS)}/${segs.join('/')}`;
    }
    case 'userAgent':
      return rng.pick(USER_AGENTS);

    /* Địa lý */
    case 'province':
      return ctx.place().province.name;
    case 'district':
      return ctx.place().district;
    case 'address': {
      const pl = ctx.place();
      const num = rng.int(1, 250);
      const alley = rng.bool(0.3) ? `/${rng.int(1, 60)}` : '';
      return `${num}${alley} ${rng.pick(STREETS)}, Phường ${rng.int(1, 15)}, ${pl.district}, ${pl.province.name}`;
    }
    case 'postal':
      return ctx.place().province.postal + rng.digits(4);
    case 'lat':
      return ctx.place().lat;
    case 'lng':
      return ctx.place().lng;
    case 'country':
      return rng.pick(locale === 'vi' ? COUNTRIES_VI : COUNTRIES_EN);

    /* Công việc */
    case 'company':
      if (locale === 'vi') return `${rng.pick(COMPANY_PREFIX)} ${rng.pick(COMPANY_FIELD)} ${rng.pick(COMPANY_CORE)}`;
      return `${rng.pick(COMPANY_EN_CORE)} ${rng.pick(COMPANY_EN_SUFFIX)}`;
    case 'jobTitle':
      return rng.pick(locale === 'vi' ? JOB_TITLES_VI : JOB_TITLES_EN);
    case 'department':
      return rng.pick(locale === 'vi' ? DEPARTMENTS_VI : DEPARTMENTS_EN);

    /* Tài chính */
    case 'moneyVnd': {
      let a = numOpt(opts, 'min', 10000);
      let b = numOpt(opts, 'max', 50000000);
      if (b < a) [a, b] = [b, a];
      const step = Math.max(1, Math.floor(numOpt(opts, 'round', 1000)));
      const v = Math.round((a + rng.float() * (b - a)) / step) * step;
      return Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
    }
    case 'moneyUsd': {
      let a = numOpt(opts, 'min', 1);
      let b = numOpt(opts, 'max', 5000);
      if (b < a) [a, b] = [b, a];
      return Math.round((a + rng.float() * (b - a)) * 100) / 100;
    }
    case 'card': {
      let brand = strOpt(opts, 'brand', 'any');
      if (!CARD_PREFIX[brand]) brand = rng.pick(Object.keys(CARD_PREFIX));
      const spec = CARD_PREFIX[brand];
      const prefix = rng.pick(spec.prefixes);
      return luhnComplete(prefix + rng.digits(spec.len - prefix.length - 1));
    }
    case 'iban': {
      const country = rng.pick(['DE', 'FR', 'GB', 'NL']);
      const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const bb = country === 'GB' ? rng.chars(4, L) + rng.digits(14) : country === 'NL' ? rng.chars(4, L) + rng.digits(10) : rng.digits(country === 'DE' ? 18 : 23);
      const numeric = (bb + country + '00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
      const check = 98 - mod97(numeric);
      return `${country}${pad(check)}${bb}`;
    }
    case 'bankCode':
      return rng.pick(BANKS);
    case 'color':
      return '#' + rng.int(0, 0xffffff).toString(16).padStart(6, '0');
    case 'currency':
      return rng.pick(CURRENCIES);

    /* Thời gian */
    case 'date':
      return fmtDate(rangeMs(opts, '2020-01-01', '2025-12-31', rng), strOpt(opts, 'format', 'iso'));
    case 'time':
      return `${pad(rng.int(0, 23))}:${pad(rng.int(0, 59))}:${pad(rng.int(0, 59))}`;
    case 'datetime':
      return new Date(rangeMs(opts, '2024-01-01', '2025-12-31', rng)).toISOString();
    case 'unix': {
      const ms = rangeMs(opts, '2024-01-01', '2025-12-31', rng);
      return strOpt(opts, 'unit', 's') === 'ms' ? ms : Math.floor(ms / 1000);
    }
    case 'future': {
      const days = clampInt(numOpt(opts, 'days', 365), 1, 36500);
      return new Date(ctx.now + Math.floor(rng.float() * days * DAY) + 1000).toISOString();
    }
    case 'past': {
      const days = clampInt(numOpt(opts, 'days', 365), 1, 36500);
      return new Date(ctx.now - Math.floor(rng.float() * days * DAY) - 1000).toISOString();
    }

    /* Văn bản */
    case 'lorem': {
      const n = rng.int(clampInt(numOpt(opts, 'min', 5), 1, 200), clampInt(numOpt(opts, 'max', 12), 1, 200));
      const w: string[] = [];
      for (let i = 0; i < n; i++) w.push(rng.pick(LOREM));
      return capitalize(w.join(' ')) + '.';
    }
    case 'sentence':
      return sentence(ctx);
    case 'paragraph': {
      const n = rng.int(clampInt(numOpt(opts, 'min', 3), 1, 30), clampInt(numOpt(opts, 'max', 6), 1, 30));
      const s: string[] = [];
      for (let i = 0; i < n; i++) s.push(sentence(ctx));
      return s.join(' ');
    }
    case 'title':
      return titleText(ctx);
    case 'slug':
      return slugify(titleText(ctx));
    case 'keywords': {
      const n = rng.int(clampInt(numOpt(opts, 'min', 2), 1, 20), clampInt(numOpt(opts, 'max', 4), 1, 20));
      const pool = locale === 'vi' ? VI_KEYWORDS : EN_KEYWORDS;
      const set = new Set<string>();
      for (let i = 0; i < n * 3 && set.size < n; i++) set.add(rng.pick(pool));
      return Array.from(set).join(strOpt(opts, 'sep', ', '));
    }
    case 'productName':
      return locale === 'vi' ? `${rng.pick(PRODUCT_TYPE_VI)} ${rng.pick(PRODUCT_ATTR_VI)}` : `${rng.pick(PRODUCT_TYPE_EN)} ${rng.pick(PRODUCT_ATTR_EN)}`;

    /* Số & logic */
    case 'int': {
      const a = Math.floor(numOpt(opts, 'min', 0));
      const b = Math.floor(numOpt(opts, 'max', 1000));
      return rng.int(a, b);
    }
    case 'float': {
      let a = numOpt(opts, 'min', 0);
      let b = numOpt(opts, 'max', 100);
      if (b < a) [a, b] = [b, a];
      const prec = clampInt(numOpt(opts, 'precision', 2), 0, 10);
      return Number(rng.range(a, b).toFixed(prec));
    }
    case 'bool':
      return rng.bool(Math.max(0, Math.min(100, numOpt(opts, 'p', 50))) / 100);
    case 'enum': {
      const { items, weights } = parseEnum(strOpt(opts, 'items'));
      if (items.length === 0) return null;
      return rng.weighted(items, weights);
    }
    case 'nullable': {
      const p = Math.max(0, Math.min(100, numOpt(opts, 'p', 20))) / 100;
      const inner = strOpt(opts, 'inner', 'int');
      if (rng.bool(p)) return null;
      return TYPE_BY_ID[inner] && inner !== 'nullable' ? genType(inner, defaultOpts(inner), ctx) : null;
    }
    case 'pattern':
      return genPattern(strOpt(opts, 'pattern'), rng);

    /* Cấu trúc */
    case 'array': {
      const inner = strOpt(opts, 'inner', 'int');
      if (!TYPE_BY_ID[inner] || ctx.depth > 2) return [];
      const n = rng.int(clampInt(numOpt(opts, 'min', 1), 0, 100), clampInt(numOpt(opts, 'max', 5), 0, 100));
      const arr: unknown[] = [];
      ctx.depth++;
      for (let i = 0; i < n; i++) arr.push(genType(inner, defaultOpts(inner), ctx));
      ctx.depth--;
      return arr;
    }
    case 'object': {
      if (ctx.depth > 2) return {};
      const obj: Record<string, unknown> = {};
      ctx.depth++;
      for (const line of strOpt(opts, 'fields').split('\n').slice(0, 40)) {
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const k = line.slice(0, eq).trim();
        const t = line.slice(eq + 1).trim();
        if (!k || !TYPE_BY_ID[t]) continue;
        Object.defineProperty(obj, k, { value: genType(t, defaultOpts(t), ctx), enumerable: true, writable: true, configurable: true });
      }
      ctx.depth--;
      return obj;
    }
    case 'ref': {
      const from = strOpt(opts, 'from').trim();
      if (!from) return null;
      const a = ctx.get(from);
      if (a === null || a === undefined) return null;
      const from2 = strOpt(opts, 'from2').trim();
      const b = from2 ? ctx.get(from2) : null;
      const tr = strOpt(opts, 'transform', 'same');
      if (tr === 'same' && !from2) return a;
      return applyTransform(toStr(a), b === null || b === undefined ? null : toStr(b), tr, strOpt(opts, 'domain', 'example.com'));
    }
    case 'formula': {
      const v = evalFormula(strOpt(opts, 'expr'), (n) => ctx.get(n));
      if (v === null) return null;
      const dec = clampInt(numOpt(opts, 'decimals', 0), 0, 10);
      return Number(v.toFixed(dec));
    }
    default:
      return null;
  }
}

/** Các kiểu dựa trên "người": khi thử lại để đảm bảo duy nhất thì sinh người mới. */
const PERSON_TYPES = new Set(['fullName', 'fullNameAscii', 'lastName', 'middleName', 'firstName', 'cccd', 'avatar']);

/* ------------------------------------------------------------------ */
/* Bộ sinh dòng                                                        */
/* ------------------------------------------------------------------ */

export interface GenOptions {
  seed: string;
  locale: Locale;
  /** Mốc "hiện tại" cố định (ms) để dữ liệu tái lập được. */
  now?: number;
}

export interface Dataset {
  columns: string[];
  rows: unknown[][];
  /** Số giá trị phải thêm hậu tố / không thể duy nhất. */
  warnings: string[];
}

const UNIQUE_RETRIES = 40;

export class RowGenerator {
  readonly columns: string[];
  private fields: FieldDef[];
  private rng: Rng;
  private locale: Locale;
  private now: number;
  private index = 0;
  private seen: (Set<string> | null)[];
  private nameIdx = new Map<string, number>();
  private suffixed: number[];
  private failed: number[];

  constructor(fields: FieldDef[], opts: GenOptions) {
    this.fields = fields;
    this.columns = fields.map((f) => f.name.trim());
    this.rng = new Rng(seedToInt(opts.seed));
    this.locale = opts.locale;
    this.now = opts.now ?? DEFAULT_NOW;
    this.seen = fields.map((f) => (f.unique ? new Set<string>() : null));
    this.suffixed = fields.map(() => 0);
    this.failed = fields.map(() => 0);
    fields.forEach((f, i) => {
      const n = f.name.trim();
      if (!this.nameIdx.has(n)) this.nameIdx.set(n, i);
    });
  }

  get generated(): number {
    return this.index;
  }

  next(): unknown[] {
    const n = this.fields.length;
    const values: unknown[] = new Array(n);
    const state: number[] = new Array(n).fill(0); // 0 chưa, 1 đang, 2 xong
    let person: Person | null = null;
    let place: Place | null = null;
    const rng = this.rng;
    const locale = this.locale;
    const now = this.now;

    const ctx: Ctx = {
      rng,
      locale,
      index: this.index,
      attempt: 0,
      now,
      depth: 0,
      person: () => (person ??= makePerson({ rng, locale, now })),
      resetPerson: () => {
        person = null;
      },
      place: () => {
        if (!place) {
          const province = rng.pick(PROVINCES);
          const jitter = () => (rng.float() - 0.5) * 0.2;
          place = {
            province,
            district: rng.pick(province.districts),
            lat: Number((province.lat + jitter()).toFixed(6)),
            lng: Number((province.lng + jitter()).toFixed(6)),
          };
        }
        return place;
      },
      get: (name: string) => {
        const idx = this.nameIdx.get(name);
        if (idx === undefined) return null;
        resolve(idx);
        return state[idx] === 2 ? values[idx] : null;
      },
    };

    const resolve = (i: number) => {
      if (state[i] !== 0) return;
      state[i] = 1;
      const f = this.fields[i];
      let v: unknown;
      if (f.nullPct && f.nullPct > 0 && rng.bool(Math.min(100, f.nullPct) / 100)) {
        v = null;
      } else {
        const seen = this.seen[i];
        const tries = seen ? UNIQUE_RETRIES : 1;
        let attempt = 0;
        for (; attempt < tries; attempt++) {
          ctx.attempt = attempt;
          if (attempt > 0 && PERSON_TYPES.has(f.type)) ctx.resetPerson();
          v = genType(f.type, f.opts, ctx);
          if (!seen || v === null || v === undefined) break;
          const key = typeof v + ':' + (typeof v === 'object' ? JSON.stringify(v) : String(v));
          if (!seen.has(key)) {
            seen.add(key);
            break;
          }
        }
        if (seen && attempt >= tries) {
          if (typeof v === 'string') {
            let cand = `${v}-${this.index + 1}`;
            let k = 1;
            while (seen.has('string:' + cand)) cand = `${v}-${this.index + 1}-${++k}`;
            v = cand;
            seen.add('string:' + cand);
            this.suffixed[i]++;
          } else {
            this.failed[i]++;
          }
        }
        ctx.attempt = 0;
      }
      values[i] = v === undefined ? null : v;
      state[i] = 2;
    };

    for (let i = 0; i < n; i++) resolve(i);
    this.index++;
    return values;
  }

  warnings(): string[] {
    const w: string[] = [];
    this.fields.forEach((f, i) => {
      if (this.suffixed[i] > 0) w.push(`Trường "${f.name}": ${this.suffixed[i]} giá trị đã được thêm hậu tố số dòng để đảm bảo duy nhất (không đủ giá trị khả dĩ).`);
      if (this.failed[i] > 0) w.push(`Trường "${f.name}": không thể đảm bảo duy nhất cho ${this.failed[i]} giá trị (khoảng giá trị quá hẹp).`);
    });
    return w;
  }
}

export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_ROWS, Math.floor(n)));
}

/** Sinh đồng bộ toàn bộ (dùng cho test / số dòng nhỏ). */
export function generateDataset(fields: FieldDef[], count: number, opts: GenOptions): Dataset {
  const gen = new RowGenerator(fields, opts);
  const rows: unknown[][] = [];
  const total = clampCount(count);
  for (let i = 0; i < total; i++) rows.push(gen.next());
  return { columns: gen.columns, rows, warnings: gen.warnings() };
}

export interface CancelToken {
  cancelled: boolean;
}

/** Sinh theo từng khối để giao diện không bị đơ. Trả null nếu bị huỷ. */
export async function generateDatasetAsync(
  fields: FieldDef[],
  count: number,
  opts: GenOptions,
  token: CancelToken,
  onProgress?: (done: number, total: number) => void,
  chunk = 500
): Promise<Dataset | null> {
  const gen = new RowGenerator(fields, opts);
  const total = clampCount(count);
  const rows: unknown[][] = [];
  while (rows.length < total) {
    const end = Math.min(total, rows.length + chunk);
    while (rows.length < end) rows.push(gen.next());
    onProgress?.(rows.length, total);
    if (rows.length < total) {
      await new Promise<void>((r) => setTimeout(r, 0));
      if (token.cancelled) return null;
    }
  }
  if (token.cancelled) return null;
  return { columns: gen.columns, rows, warnings: gen.warnings() };
}

/* ------------------------------------------------------------------ */
/* Định dạng đầu ra                                                    */
/* ------------------------------------------------------------------ */

export type OutputFormat = 'json' | 'ndjson' | 'csv' | 'tsv' | 'sql' | 'yaml' | 'xml' | 'js' | 'ts' | 'md';
export type SqlDialect = 'mysql' | 'postgres' | 'sqlite' | 'mssql';

export interface FormatOptions {
  sqlTable: string;
  sqlDialect: SqlDialect;
  sqlBatch: number;
  csvHeader: boolean;
  constName: string;
  xmlRoot: string;
  xmlRow: string;
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  sqlTable: 'users',
  sqlDialect: 'mysql',
  sqlBatch: 100,
  csvHeader: true,
  constName: 'data',
  xmlRoot: 'rows',
  xmlRow: 'row',
};

export const OUTPUT_FORMATS: { id: OutputFormat; label: string; ext: string; mime: string }[] = [
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json' },
  { id: 'ndjson', label: 'NDJSON', ext: 'ndjson', mime: 'application/x-ndjson' },
  { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
  { id: 'tsv', label: 'TSV', ext: 'tsv', mime: 'text/tab-separated-values' },
  { id: 'sql', label: 'SQL INSERT', ext: 'sql', mime: 'application/sql' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', mime: 'application/yaml' },
  { id: 'xml', label: 'XML', ext: 'xml', mime: 'application/xml' },
  { id: 'js', label: 'JavaScript', ext: 'js', mime: 'text/javascript' },
  { id: 'ts', label: 'TypeScript', ext: 'ts', mime: 'text/typescript' },
  { id: 'md', label: 'Markdown', ext: 'md', mime: 'text/markdown' },
];

function jsonVal(v: unknown, indent: number | undefined): string {
  const s = JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? null : x), indent);
  return s === undefined ? 'null' : s;
}

function rowJson(columns: string[], row: unknown[], pretty: boolean, pad0: string): string {
  if (!pretty) {
    return '{' + columns.map((c, i) => `${JSON.stringify(c)}:${jsonVal(row[i], undefined)}`).join(',') + '}';
  }
  const inner = columns.map((c, i) => `${pad0}  ${JSON.stringify(c)}: ${jsonVal(row[i], 2).replace(/\n/g, '\n' + pad0 + '  ')}`);
  return `${pad0}{\n${inner.join(',\n')}\n${pad0}}`;
}

export function toJson(ds: Dataset): string {
  if (ds.rows.length === 0) return '[]';
  return '[\n' + ds.rows.map((r) => rowJson(ds.columns, r, true, '  ')).join(',\n') + '\n]';
}

export function toNdjson(ds: Dataset): string {
  return ds.rows.map((r) => rowJson(ds.columns, r, false, '')).join('\n');
}

export function csvCell(v: unknown, delim: string): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s === '') return '';
  if (s.includes(delim) || s.includes('"') || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toDelimited(ds: Dataset, delim: string, header: boolean): string {
  const lines: string[] = [];
  if (header) lines.push(ds.columns.map((c) => csvCell(c, delim)).join(delim));
  for (const r of ds.rows) lines.push(r.map((v) => csvCell(v, delim)).join(delim));
  return lines.join('\n');
}

export function sqlIdent(name: string, d: SqlDialect): string {
  const clean = name.replace(/\0/g, '');
  switch (d) {
    case 'mysql':
      return '`' + clean.replace(/`/g, '``') + '`';
    case 'mssql':
      return '[' + clean.replace(/\]/g, ']]') + ']';
    default:
      return '"' + clean.replace(/"/g, '""') + '"';
  }
}

export function sqlString(s: string, d: SqlDialect): string {
  let t = s.replace(/\0/g, '');
  if (d === 'mysql') t = t.replace(/\\/g, '\\\\');
  t = t.replace(/'/g, "''");
  return (d === 'mssql' ? "N'" : "'") + t + "'";
}

export function sqlValue(v: unknown, d: SqlDialect): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return d === 'postgres' || d === 'mysql' ? (v ? 'TRUE' : 'FALSE') : v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'object') return sqlString(JSON.stringify(v), d);
  return sqlString(String(v), d);
}

export function toSql(ds: Dataset, table: string, d: SqlDialect, batch: number): string {
  const tbl = table
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((p) => sqlIdent(p, d))
    .join('.') || sqlIdent('table_name', d);
  const cols = ds.columns.map((c) => sqlIdent(c, d)).join(', ');
  const size = Math.max(1, Math.min(5000, Math.floor(batch) || 1));
  const out: string[] = [];
  for (let i = 0; i < ds.rows.length; i += size) {
    const chunk = ds.rows.slice(i, i + size);
    const vals = chunk.map((r) => '  (' + r.map((v) => sqlValue(v, d)).join(', ') + ')');
    out.push(`INSERT INTO ${tbl} (${cols}) VALUES\n${vals.join(',\n')};`);
  }
  return out.join('\n\n');
}

function toYaml(ds: Dataset): string {
  const toNode = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(toNode);
    if (v && typeof v === 'object') return new Map(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toNode(x)]));
    return v;
  };
  const arr = ds.rows.map((r) => new Map(ds.columns.map((c, i) => [c, toNode(r[i])] as [string, unknown])));
  if (arr.length === 0) return '[]\n';
  return YAML.stringify(arr);
}

function xmlName(n: string, fallback: string): string {
  let s = n.replace(/[^\p{L}\p{N}_.-]/gu, '_');
  if (!s || !/^[\p{L}_]/u.test(s)) s = '_' + s;
  if (/^xml/i.test(s)) s = '_' + s;
  return s || fallback;
}

function xmlEscape(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function xmlNode(name: string, v: unknown, ind: string): string {
  if (v === null || v === undefined) return `${ind}<${name} nil="true"/>`;
  if (Array.isArray(v)) {
    if (v.length === 0) return `${ind}<${name}/>`;
    return `${ind}<${name}>\n${v.map((x) => xmlNode('item', x, ind + '  ')).join('\n')}\n${ind}</${name}>`;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return `${ind}<${name}/>`;
    return `${ind}<${name}>\n${entries.map(([k, x]) => xmlNode(xmlName(k, 'field'), x, ind + '  ')).join('\n')}\n${ind}</${name}>`;
  }
  return `${ind}<${name}>${xmlEscape(String(v))}</${name}>`;
}

export function toXml(ds: Dataset, root: string, rowName: string): string {
  const r = xmlName(root, 'rows');
  const rn = xmlName(rowName, 'row');
  const cols = ds.columns.map((c) => xmlName(c, 'field'));
  const body = ds.rows.map((row) => `  <${rn}>\n${row.map((v, i) => xmlNode(cols[i], v, '    ')).join('\n')}\n  </${rn}>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${r}>${body ? '\n' + body + '\n' : ''}</${r}>`;
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function jsIdent(n: string, fallback: string): string {
  const s = n.replace(/[^A-Za-z0-9_$]/g, '_');
  return IDENT_RE.test(s) ? s : fallback;
}

function tsTypeOf(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0 || depth > 3) return 'unknown[]';
    const ts = Array.from(new Set(v.slice(0, 5).map((x) => tsTypeOf(x, depth + 1))));
    return (ts.length > 1 ? `(${ts.join(' | ')})` : ts[0]) + '[]';
  }
  if (typeof v === 'object') {
    if (depth > 3) return 'Record<string, unknown>';
    const parts = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${IDENT_RE.test(k) ? k : JSON.stringify(k)}: ${tsTypeOf(x, depth + 1)}`);
    return parts.length ? `{ ${parts.join('; ')} }` : 'Record<string, unknown>';
  }
  return typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string';
}

export function toJs(ds: Dataset, constName: string, ts: boolean): string {
  const name = jsIdent(constName, 'data');
  const objs = '[\n' + ds.rows.map((r) => rowJson(ds.columns.map((c) => c), r, true, '  ')).join(',\n') + '\n]';
  if (!ts) return `export const ${name} = ${ds.rows.length ? objs : '[]'};\n`;
  const tname = name.charAt(0).toUpperCase() + name.slice(1) + 'Row';
  const lines = ds.columns.map((c, i) => {
    const types = new Set<string>();
    for (let r = 0; r < Math.min(ds.rows.length, 200); r++) types.add(tsTypeOf(ds.rows[r][i]));
    if (types.size === 0) types.add('unknown');
    return `  ${IDENT_RE.test(c) ? c : JSON.stringify(c)}: ${Array.from(types).join(' | ')};`;
  });
  return `export interface ${tname} {\n${lines.join('\n')}\n}\n\nexport const ${name}: ${tname}[] = ${ds.rows.length ? objs : '[]'};\n`;
}

function mdCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function toMarkdown(ds: Dataset): string {
  const head = '| ' + ds.columns.map(mdCell).join(' | ') + ' |';
  const sep = '| ' + ds.columns.map(() => '---').join(' | ') + ' |';
  const body = ds.rows.map((r) => '| ' + r.map(mdCell).join(' | ') + ' |');
  return [head, sep, ...body].join('\n');
}

export function formatDataset(ds: Dataset, fmt: OutputFormat, o: FormatOptions): string {
  switch (fmt) {
    case 'json':
      return toJson(ds);
    case 'ndjson':
      return toNdjson(ds);
    case 'csv':
      return toDelimited(ds, ',', o.csvHeader);
    case 'tsv':
      return toDelimited(ds, '\t', o.csvHeader);
    case 'sql':
      return toSql(ds, o.sqlTable, o.sqlDialect, o.sqlBatch);
    case 'yaml':
      return toYaml(ds);
    case 'xml':
      return toXml(ds, o.xmlRoot, o.xmlRow);
    case 'js':
      return toJs(ds, o.constName, false);
    case 'ts':
      return toJs(ds, o.constName, true);
    case 'md':
      return toMarkdown(ds);
  }
}

/* ------------------------------------------------------------------ */
/* Preset                                                              */
/* ------------------------------------------------------------------ */

export interface Preset {
  id: string;
  label: string;
  table: string;
  build: () => FieldDef[];
}

const f = makeField;

export const PRESETS: Preset[] = [
  {
    id: 'users',
    label: 'Người dùng',
    table: 'users',
    build: () => [
      f('id', 'autoinc'),
      f('uuid', 'uuid'),
      f('last_name', 'lastName'),
      f('first_name', 'firstName'),
      f('full_name', 'fullName'),
      f('gender', 'gender'),
      f('birthdate', 'birthdate'),
      f('email', 'email', {}, { unique: true }),
      f('phone', 'phone'),
      f('username', 'username', {}, { unique: true }),
      f('address', 'address'),
      f('avatar', 'avatar'),
      f('created_at', 'datetime'),
    ],
  },
  {
    id: 'products',
    label: 'Sản phẩm',
    table: 'products',
    build: () => [
      f('id', 'autoinc'),
      f('sku', 'pattern', { pattern: 'SKU-####-??' }, { unique: true }),
      f('name', 'productName'),
      f('category', 'enum', { items: 'Thời trang=30, Điện tử=25, Gia dụng=20, Thực phẩm=15, Sách=10' }),
      f('price', 'moneyVnd', { min: '50000', max: '20000000', round: '1000' }),
      f('stock', 'int', { min: '0', max: '500' }),
      f('rating', 'float', { min: '3', max: '5', precision: '1' }),
      f('tags', 'keywords'),
      f('active', 'bool', { p: '85' }),
      f('created_at', 'date'),
    ],
  },
  {
    id: 'orders',
    label: 'Đơn hàng',
    table: 'orders',
    build: () => [
      f('order_id', 'pattern', { pattern: 'DH########' }, { unique: true }),
      f('first_name', 'firstName'),
      f('last_name', 'lastName'),
      f('customer_email', 'ref', { from: 'first_name', from2: 'last_name', transform: 'email', domain: 'gmail.com' }),
      f('phone', 'phone'),
      f('price', 'moneyVnd', { min: '20000', max: '5000000', round: '1000' }),
      f('qty', 'int', { min: '1', max: '10' }),
      f('total', 'formula', { expr: 'price*qty', decimals: '0' }),
      f('status', 'enum', { items: 'mới=30, đang giao=30, hoàn tất=35, đã hủy=5' }),
      f('shipping_address', 'address'),
      f('created_at', 'datetime'),
    ],
  },
  {
    id: 'blog',
    label: 'Bài viết blog',
    table: 'posts',
    build: () => [
      f('id', 'uuid'),
      f('title', 'title'),
      f('slug', 'ref', { from: 'title', from2: '', transform: 'slug' }),
      f('author', 'fullName'),
      f('summary', 'sentence'),
      f('content', 'paragraph', { min: '3', max: '8' }),
      f('keywords', 'keywords'),
      f('views', 'int', { min: '0', max: '50000' }),
      f('published', 'bool', { p: '80' }),
      f('published_at', 'datetime', {}, { nullPct: 15 }),
    ],
  },
  {
    id: 'access-log',
    label: 'Log truy cập',
    table: 'access_logs',
    build: () => [
      f('ip', 'ipv4'),
      f('timestamp', 'datetime', { from: '2025-01-01', to: '2025-01-31' }),
      f('method', 'enum', { items: 'GET=70, POST=20, PUT=4, DELETE=3, PATCH=3' }),
      f('path', 'url'),
      f('status', 'enum', { items: '200=75, 301=5, 304=6, 400=3, 404=7, 500=4' }),
      f('bytes', 'int', { min: '120', max: '500000' }),
      f('response_ms', 'float', { min: '1', max: '1500', precision: '1' }),
      f('user_agent', 'userAgent'),
    ],
  },
  {
    id: 'bank-tx',
    label: 'Giao dịch ngân hàng',
    table: 'transactions',
    build: () => [
      f('tx_id', 'ulid'),
      f('account_no', 'pattern', { pattern: '##########' }),
      f('holder', 'fullNameAscii'),
      f('bank', 'bankCode'),
      f('type', 'enum', { items: 'chuyển khoản=50, thanh toán=30, rút tiền=12, nạp tiền=8' }),
      f('amount', 'moneyVnd', { min: '10000', max: '100000000', round: '1000' }),
      f('currency', 'enum', { items: 'VND' }),
      f('card', 'card', {}, { nullPct: 40 }),
      f('status', 'enum', { items: 'thành công=92, đang xử lý=5, thất bại=3' }),
      f('note', 'sentence'),
      f('created_at', 'datetime'),
    ],
  },
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
